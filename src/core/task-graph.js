// @ts-check
// The task graph (HarnessV3-TaskGraph), core to every session (the owner's word of 10-29: always on, never switched off):
// the agent has the `tasks` tool beside its checklist, and keeps work whose pieces depend on each other, or could run
// side by side, as a graph: tasks, each with the tasks it needs — it starts once they are done — and the files it
// writes. The graph is plain JSON kept with the session (its chain's meta), so it outlives a turn and a restart; a
// task's state is set by the agent's own calls, never guessed from its words. An edit is checked whole and refused in
// words, the graph left as it was. Pure: nothing here runs anything.
//
// A task may go to a sub-agent (G2): a writing one in its own worktree, or an explorer that changes nothing. Filament
// starts it once its needs are done (the graph runner, app/agent/graph-runner.js, asks `jobs`), hands it the brief
// written here, and its `report` ends it: done with its check passed, a change in its worktree is ready and waits there
// for its apply (`step` "yours", the owner's of 11-02) — the main agent's call, or the developer's Apply; nothing of
// Filament's writes into the folder they work in — and the tasks that need it wait for that apply; anything else fails
// it, and the agent chooses what comes next. Each of those steps is a transition here, so the graph's state is set by
// what Filament saw happen, never by a sub-agent's words alone.
//
// A team's lead plans on the graph too (G3): each of its tasks names a worker's role, and Filament starts that worker of
// the team. Whoever leads starts a task by what it does — it writes, or it reads — so a graph outlives a change of who
// leads. A writer's task may ask for a review: its change goes to a reviewer before it merges, and back to the same
// worker with the changes asked, two rounds at most; then the lead decides, and `merge` takes a change as it stands.
//
// A coding agent plans on it alone (`solo`, HarnessV3-ACP AC4-5): every task is its own, as G1's were — Filament starts
// no sub-agent for a session that has no loop to run one.
//
// The developer may run the planner's own ready tasks side by side themselves (the Designer's of 10-27, built 10-28):
// the Plan page's sheet gives each to a sub-agent on the model they chose, in its own copy or their folder, under any
// planner — a coding agent's too. The task keeps the claim (`side`): its planner is told once, and a start, a change or a
// drop of it is refused in the claim's words; its end comes back as any sub-agent task's does, a change in its copy
// waiting there for its apply.
//
// A task may carry a check (HarnessV3-TaskGraph-v2 V2-1, TG2-D1): one to five commands that prove it done, which Filament
// runs itself — a worker's in its worktree once it reports, the agent's own in a copy of the folder once it marks the
// task done, the task `checking` meanwhile — and done means they passed. Its verdict is kept with the task. At close,
// each distinct command runs once more on the folder as it stands.
//
// A worker's change merges, once applied (`applyAsked`), through the folder's check (HarnessV3-TaskGraph-v2 V2-2,
// TG2-D2): Filament checks the folder with it as it does a lead's apply (TG2-D55), and a merge that broke a command that
// passed without it is undone — the
// task waits, merging, step `back`, until its worker takes the output back (`gate`), twice at most; then it fails, and
// whoever plans decides. The task keeps the newest verdict (`gate`).
//
// A task may be Filament's own (HarnessV3-TaskGraph-v2 V2-3, TG2-D4): `by: "command"`, with commands to `run` and the
// `items` that fill `{item}` in them. No model does it: Filament runs the commands once for each item in copies of the
// folder, several at once on lanes of their own (the runner's), and the task's result is the table of its runs — done
// when every run passed, failed naming those that did not. A command that starts `! ` passes when it fails.
//
// A task may name the open thread of memory it finishes (HarnessV4_GraphThreads E28): `thread`, by its id, checked by
// memory's word as the call is read (`ThreadOf`) — a thread of the session's project, still open, one open task each.
// Once the task is done the runner closes the thread with its summary (`threadsToClose`), and what came of it is kept
// on the task (`threadEnded`); a drop, a failure or a close leaves it open.
//
// A task may take up what a Hunter found (the owner's of 11-02): `found_by`, the id of a Hunter the developer fired
// from a task of the graph on the Plan: as a task of the graph keeps that hunt already, else checked by the registry's
// word as the call is read (`FoundOf`) — a hunt of this chat's, fired from a task this graph still holds. The task
// needs that one — the line on the Plan, ready at once behind a done one; another hunt in its place, that hunt's task in
// the place of the need the first added, never of one the planner named (`foundNeeds`) — and keeps what found it
// (`foundBy`): the hunt's id, its name as shown, the task it was fired from, which every reading of the graph says, and
// whether the need is the hunt's. A found_by is read one way (`foundByOf`).
//
// A task may be a step's sub-task (`under`, the owner's plan mode of 11-06): the planner lays out high-level steps of
// its own, and adds each one's sub-tasks as it reaches it — one level: a sub-task holds none. A sub-task starts after
// its step's needs (`needsOf`); a step with sub-tasks does no work of its own: it runs once one begins and is done once
// they all are (`settleSteps`; the runner's every keep rolls it up, `rollUp`), and what needs it waits for them all.
// Its words fold: the step a line with how many are done, its open sub-tasks under it, its done ones counted. `find`
// looks through the tasks' own words, and what is kept behind them, for the lines that hold every word given.
import { builderOf, doesWords, isShippedRoster, memberOf, reviewerOf, scoutOf, writes as editsFiles } from "./roster.js";
import { globToRegExp } from "./path-glob.js";
import { aOrAn, cut, durationWords, listed, squash } from "./text.js";
import { SUBAGENT_EFFORTS } from "./schema.js";

/** A graph's backstop: the most tasks it holds, done and dropped ones included. */
export const MAX_TASKS = 400;
/**
 * What the agent's tasks tool does (TG-D8); `pause` leaves a task of its own with its checkpoint (E36, E41 P1); `find`
 * looks for words in the tasks and what is kept behind them (11-06); `offer` asks the person, on a card under the reply,
 * whether to plan the work first (the owner's plan mode of 11-06); `parallel` suggests to the person, on a card, the
 * ready tasks that can run at once, whose Accept starts each on a sub-agent (the owner's of 11-10: the agent puts it,
 * never Filament by itself).
 */
export const TASK_ACTIONS = Object.freeze(["add", "start", "pause", "done", "change", "drop", "close", "show", "keep", "read", "find", "offer", "parallel"]);
/** The agent's when it reads along with its graph's sub-agents (HarnessV3-TaskGraph-v2 TG2-D20): a line to the one at work. */
export const READS_ACTIONS = Object.freeze([...TASK_ACTIONS, "note"]);
/** A team's lead's: the agent's but pause — a lead does no task itself — and its word over a change that fell short (G3-4). */
export const LEAD_ACTIONS = Object.freeze([...TASK_ACTIONS.filter((a) => a !== "pause" && a !== "offer" && a !== "parallel"), "merge"]);
/** How deep a plan goes (the owner's plan mode of 11-06): the offer's card and `/plan light|deep` choose one. */
export const PLAN_DEPTHS = Object.freeze(/** @type {const} */ (["light", "standard", "deep"]));
/** Who does a task, in the agent's words (G2-1): itself, a writing sub-agent in its own worktree, or an explorer that only reads. */
export const TASK_BY = Object.freeze(["you", "sub-agent", "explorer"]);
/** A task no model does (HarnessV3-TaskGraph-v2 V2-3, TG2-D4): Filament runs its commands itself — `by` in any planner's words. */
export const COMMAND = "command";
/** The most items a command task runs its commands for (TG2-D4). */
export const MAX_ITEMS = 500;
/** An item is one plain word (TG2-D66): it fills `{item}` as it is, the same in any shell, and cannot change what a command does. */
const ITEM = /^[A-Za-z0-9._\-/:@+=,]{1,200}$/;
/** The runs of a command task that did not pass whose output's end it keeps, and how much of each (V2-3). */
const KEEP_RED_RUNS = 20;
const RED_RUN_LINES = 20;
const RED_RUN_CHARS = 2000;
/** A command task's fields, and a worker's, which a command task never takes (V2-3). */
const COMMAND_FIELDS = Object.freeze(["name", "needs", "run", "items"]);
const WORKER_FIELDS = Object.freeze(["writes", "goal", "steps", "acceptance", "check", "review"]);
/** How many times a reviewer reads a task's change before the lead decides (G3-3). */
export const REVIEW_ROUNDS = 2;
/** How many times the folder's check sends a task's change back to its worker before whoever plans decides (V2-2): the registry's `CHECK_RETURNS`. */
const GATE_RETURNS = 2;
/** How many times Filament sends a change whose merge overlapped the folder's edits back to redo, by itself (11-09). */
export const MERGE_RETURNS = 2;
/** How a sub-agent's report says its task went (G2-4). */
export const REPORT_STATUSES = Object.freeze(["done", "blocked", "failed"]);
const GRAPH_VERSION = 1;
/** The fields of a task someone does, besides its id; a command task's own come after them (V2-3). */
const WORK_FIELDS = Object.freeze(["name", "needs", "writes", "acceptance", "check", "by", "goal", "steps"]);
/** The fields the agent's task's input may give besides its id. */
const FIELDS = Object.freeze([...WORK_FIELDS, "run", "items", "thread", "found_by", "under"]);
/**
 * A coding agent's (`solo`): who does a task is never asked — every task is its own —, but its goal and steps are, the
 * brief of a sub-agent the person's Accept runs it on (FabeleHelper's of 11-10: the card's sub-agent got its name alone).
 */
const SOLO_FIELDS = Object.freeze(["name", "needs", "writes", "acceptance", "check", "goal", "steps", "thread", "found_by", "under"]);
/** The most commands a task's check holds (V2-1). */
export const CHECK_COMMANDS = 5;
/** The lines of a red check's output a task keeps, and the close's verdict says of each red one. */
const RED_LINES = 40;
const CLOSE_RED_LINES = 20;
/** A lead's: the agent's, and whether a reviewer reads its change before it merges (G3-3). */
const LEAD_FIELDS = Object.freeze([...WORK_FIELDS, "review", "run", "items", "thread", "found_by"]);
const ID = /^[a-z][a-z0-9_-]{0,23}$/i;
/**
 * How long each text the agent or a sub-agent writes for the graph may run (G2-13): kept whole up to it, and refused past
 * it in words — never cut, since the plan's words are a sub-agent's work order, and what a task reported is the brief
 * of the tasks after it.
 */
const LIMIT = Object.freeze({ goal: 1000, name: 120, acceptance: 1000, command: 500, summary: 4000, reason: 1000, taskGoal: 2000, step: 2000, note: 2000, did: 8000, evidence: 2000, left: 2000 });
/** How much Filament keeps of its own records of a run — why it failed, its last words, its commands, its calls: past it the text is cut, an ellipsis saying so. */
const KEEP = Object.freeze({ why: 300, words: 1000, command: 200, call: 160 });
/** The most steps a sub-agent's task lists. */
const MAX_STEPS = 20;
/** What a task keeps of a sub-agent's run: its first files, and its newest commands — the checks it ran last. */
const KEEP_FILES = 50;
const KEEP_RAN = 30;
/** What a try keeps of its tool calls, for the brief of a new worker after it (HarnessV3-FailurePoints §6 item 3): the newest. */
const KEEP_CALLS = 30;

/** @typedef {"waiting" | "running" | "paused" | "checking" | "review" | "merging" | "done" | "failed" | "dropped"} TaskState */
/**
 * @typedef {object} CheckRun  one command of a check, as Filament ran it: its exit (null where it had none — a stop, a
 *   shell that could not start), its time, the end of what it printed, whether a stop ended it — and, where it failed and
 *   ran once more, how its first run ended (`first`), and what it printed
 * @property {string} command
 * @property {number | null} exit
 * @property {number} ms
 * @property {string} output
 * @property {boolean} stopped
 * @property {{ exit: number | null, ms: number, output?: string } | null} [first]
 */
/**
 * @typedef {{ ran: true, commands: string[], runs: CheckRun[], bounces: number, stopped: boolean } | { ran: false, words: string }} CheckOutcome
 *   how Filament's run of a check went (the registry's word): the commands, those it ran in order — up to the first that
 *   failed, or every one where all were asked — how often it went back to its worker first, and whether a stop cut it;
 *   or why it did not run, as a reason ("this folder is not in git, …")
 */
/**
 * @typedef {object} Verdict  what Filament's check of a task found (V2-1): passed, flaky (a command failed, then passed on
 *   its second run), failed, or not run (`words` says why); each command it ran, with its first run where it ran twice;
 *   the commands not run after a red one; the end of a red one's output; how often it went back to its worker
 * @property {"passed" | "flaky" | "failed" | "not"} kind
 * @property {{ command: string, exit: number | null, ms: number, first: { exit: number | null, ms: number } | null }[]} runs
 * @property {string[]} unrun
 * @property {string} output  the end of what the command that failed printed; for a flaky verdict, of its first run
 * @property {string} words
 * @property {number} back
 * @property {number} at
 */
/**
 * @typedef {object} Gate  what Filament's check of the folder found as a task's change merged (V2-2, TG2-D2): it passed;
 *   the folder was red already, so the merge stands (`red`); the merge broke a command and was undone — the change sent
 *   back to its worker (`back.n`), or not: twice already, or why it could not go; the undo would not come through
 *   cleanly, so it stands red (`stuck`); it stands red for a lead's reason; or not checked, and why (`words`). Each
 *   command with its exit after the merge — and before it, where it ran there — the one the merge broke, the end of a
 *   red one's output, and the commands a rule of the session's kept from running, in sentences
 * @property {"passed" | "red" | "undone" | "stuck" | "reason" | "not"} kind
 * @property {{ command: string, exit: number | null, ms: number, before: number | null, own?: boolean }[]} runs  `own`
 *   on a red one that is the change's own check alone
 * @property {{ command: string, exit: number | null, ms: number, own: boolean, before: number | null } | null} broke
 *   `own`: the change's own check alone, which passed in its worktree
 * @property {string} output
 * @property {string} words
 * @property {string[]} ruled
 * @property {{ n: number } | { twice: true } | { why: string } | null} back
 * @property {{ path: string, why: string }[]} conflicts  an undo that would not come through: where, and why
 * @property {string[]} stuck  the files an undo could not put back
 * @property {number} at
 */
/**
 * @typedef {{ command: string, after: { exit: number | null, ms: number, output: string }, before: { exit: number | null, ms: number, output: string } | null, own: boolean }} FolderRunOf
 *   one command of the folder's check as the registry ran it: with the change, and on the folder before it where it
 *   failed with it
 */
/**
 * @typedef {object} FolderOutcome  what the registry's checked merge says of the folder (V2-2): its kind, as a gate's,
 *   and what it ran — `check.js`'s FolderCheck, read here without its kinds of a lead's call
 * @property {Gate["kind"]} kind
 * @property {FolderRunOf[]} [runs]
 * @property {string[]} [ruled]
 * @property {FolderRunOf} [broke]
 * @property {Gate["back"]} [back]
 * @property {{ path: string, why: string }[]} [conflicts]
 * @property {string[]} [stuck]
 * @property {string} [words]
 */
/**
 * @typedef {object} ProviderEnd  a worker's run that stopped on its provider (TG2-D3, in TG2-D54's words), as the
 *   registry says it: the cause and whether it was tried again; when its worker can go on (`later`); where a new one
 *   would run (`fresh`); and, for a model its provider refuses the account, what to tell the developer (`tell`)
 * @property {string} said
 * @property {boolean} wall  the provider cannot serve the account (an out or an account): a new worker comes first
 * @property {string} later
 * @property {string} fresh
 * @property {string | null} tell
 */
/** @typedef {string} TaskBy  who does a task: `you`, `sub-agent` or `explorer` in the agent's words, or the tag of a member of the team that leads */
/** @typedef {import("./roster.js").Member} Member */
/**
 * @typedef {"agent" | readonly Member[]} Crew  who plans the graph now: the agent, in its own words, or a team's lead —
 *   then its team's members, whose tags its tasks name (G3; HarnessV4_Tasks E15 step 6)
 */
/**
 * @typedef {object} TaskReport  what a sub-agent's `report` gave (G2-4)
 * @property {"done" | "blocked" | "failed"} status
 * @property {string} did
 * @property {boolean} met  whether the acceptance check passed
 * @property {string} evidence  the check it ran and what that showed
 * @property {string} left  what is left ("" for nothing)
 * @property {string[]} [checked]  the commands it checked its work with, each as it ran them: a writing task with no check
 *   takes them as its check (HarnessV3-TaskGraph-v2 TG2-D63); none when it named none
 */
/**
 * @typedef {object} Attempt  one sub-agent's run of a task: its report — status null when it gave none, its last words
 *   kept instead — beside Filament's own record of what it changed and ran, never taken from its words
 * @property {"done" | "blocked" | "failed" | null} status
 * @property {string} did
 * @property {boolean | null} met
 * @property {string} evidence
 * @property {string} left
 * @property {string} words
 * @property {{ path: string, added: number, removed: number }[]} files
 * @property {string[]} unnamed  the files it changed that its task's writes did not name (G2-5): said, never refused —
 *   who owns a file while the work runs is §6's
 * @property {{ command: string, exit: number | null }[]} ran
 * @property {string[]} calls  its newest tool calls in a card's words ("Read src/a.js"): a new worker's brief carries
 *   them, and the try outlives the worker (HarnessV3-FailurePoints §6 item 3)
 * @property {number} callsMade  how many tool calls it made in all
 * @property {boolean} inFolder  it worked in the session's folder, so its changes went there as it made them
 * @property {string[]} written  in the folder, the files its write and edit calls named: its change, where no git
 *   records it (§8 item 2)
 * @property {boolean} wrote  its hands changed the folder it worked in
 * @property {number} spentUsd
 * @property {number} ms
 * @property {number} endedAt
 * @property {ProviderEnd | null} [provider]  its run stopped on its provider (TG2-D3)
 */
/**
 * @typedef {object} Review  a reviewer's reading of a task's change, one round of it (G3-3): its report — status null
 *   when it gave none, its last words kept instead
 * @property {number} round
 * @property {string} agent  the reviewer
 * @property {"done" | "blocked" | "failed" | null} status
 * @property {boolean | null} met  the change does what the task asks, so it merges
 * @property {string} did  what it checked
 * @property {string} evidence  what it read and ran, and what that showed
 * @property {string} left  the changes it asks for
 * @property {string} words
 * @property {number} spentUsd
 * @property {number} endedAt
 */
/**
 * @typedef {object} TaskEnd  how a task's sub-agent ended, as the registry hands it over
 * @property {string} agent
 * @property {string} status  the loop's word ("done", "stopped", "failed", …)
 * @property {string | null} stoppedBy  whose stop ended it: "harness" is the developer's, "lead" its team's lead's own,
 *   "agent" the session's agent's (its agent tool's stop — or the runner's, of a task it dropped)
 * @property {string | null} error
 * @property {TaskReport | null} report  what its report tool kept, or null when it gave none
 * @property {string} words  its final words
 * @property {{ path: string, added: number, removed: number }[]} files  its worktree's change, which waits to be merged
 *   (none when it had no worktree)
 * @property {boolean} shared  it worked in the session's folder, so its changes are there already
 * @property {boolean} wrote  its hands changed the folder it worked in
 * @property {string | null} workError  its worktree's work could not be captured
 * @property {{ command: string, exit: number | null }[]} ran  the commands it ran to their end, with their exits
 * @property {string[]} calls  its tool calls in a card's words, oldest first
 * @property {string[]} written  the files its write and edit calls named, relative to the folder it worked in
 * @property {{ by: string, paths: string[], command?: boolean }} [writes]  in the session's folder (`shared`): the files
 *   its calls named, absolute, and whether it ran commands — the round of the turn that hears of its end records them
 *   as its (HarnessV4_Git_Plan GWC-16)
 * @property {number} spentUsd
 * @property {number} ms
 * @property {boolean} cut  a Filament restart cut it
 * @property {CheckOutcome | null} [check]  Filament's run of its task's check once it reported done (V2-1), or null
 * @property {string[]} [taken]  the commands its report named, which the registry took as its task's check — a writing
 *   task with none (TG2-D63)
 * @property {ProviderEnd | null} [provider]  its run stopped on its provider (TG2-D3)
 */
/**
 * @typedef {object} Task
 * @property {string} id  the agent's own, lower-cased
 * @property {string} name
 * @property {string[]} needs  the tasks it builds on: it starts once they are done
 * @property {string[]} writes  the files and globs it changes, relative to the project's folder
 * @property {string} acceptance  what shows it done ("" when none was given)
 * @property {string[]} check  the commands that prove it done, which Filament runs itself (V2-1); none for a task with
 *   none — a graph kept before V2-1 has the field missing (`checkOf`)
 * @property {"worker"} [checkBy]  who named its check where its planner gave none: its worker's report (TG2-D63). Its
 *   planner's change of the check takes it away
 * @property {Verdict | null} verdict  what Filament's check of it found, the newest; null before one ran
 * @property {TaskBy} by  who does it (G2-1)
 * @property {string} goal  what must be true when it is done — a sub-agent's brief needs it
 * @property {string[]} steps  what to do, in order — a sub-agent's brief needs them
 * @property {TaskState} state
 * @property {string} summary  what was done, once it is
 * @property {string} why  why it was dropped, or why it failed
 * @property {number} addedAt
 * @property {number | null} startedAt
 * @property {number | null} endedAt
 * @property {string | null} agent  the sub-agent that runs it now, or ran it last
 * @property {number} tries  how many tries it had: a sub-agent took it, or went on with it
 * @property {string | null} resume  sent back, or stopped by the developer and let go again (HarnessV4_Tasks B4), the
 *   sub-agent that goes on with it in its own conversation once it starts (HarnessV3-FailurePoints §6 item 2); null
 *   when a new one takes it
 * @property {{ cause: string, times: number } | null} failures  how it failed last, as a cause two failures share
 *   when they failed the same way, and how many times in a row it did (§8 item 3)
 * @property {string} unreviewed  why its review could not run though it asked for one, "" when it ran or none was
 *   asked (§8 item 2)
 * @property {string} note  the agent's note for the next sub-agent, given as it sent the task back
 * @property {Attempt | null} report  its newest sub-agent's try
 * @property {{ agent: string | null, ranAs: TaskBy | null, report: Attempt | null, why: string, reviews: Review[], stopped?: StoppedBy, rebased?: true, sentBy?: "filament" | "planner", done?: DoneRound } | null} earlier
 *   the try before a send-back or a stop (`stopped`: whose), with its reviews: the next sub-agent's brief carries it;
 *   `rebased`, its change was sent back to rebase, its worktree holding the folder with it brought on — by the
 *   developer, or, where its merge overlapped the folder's edits (11-09), by Filament itself or its planner (`sentBy`);
 *   `done`, the round a start reopened (11-09), as it was done
 * @property {number} [rebases]  how many times Filament sent its change back by itself to redo on the folder, its merge
 *   overlapping the folder's edits (the owner's of 11-09): twice at most (`MERGE_RETURNS`); missing before the first
 * @property {true} [overlapped]  its change did not merge, overlapping the folder's edits: its planner's apply takes
 *   overlap (11-09); missing on any other failure to merge
 * @property {{ files: number, added: number, removed: number, marked?: string[], kept?: string[] } | null} merged  what its change brought into the folder
 *   — `marked`, the files it came in with git's conflict markers, for the developer — or its planner, whose apply asked
 *   for them (11-09) — to resolve (10-28); `kept`, those its planner's apply kept as the folder had them, its change to
 *   them set aside
 * @property {false | StoppedBy} stopped  whose stop set its sub-agent aside — the developer's, its lead's own
 *   (HarnessV4_Tasks B11), or the agent's with its agent tool (ag-stop): it starts again with the planner's next
 *   tasks call, or the developer's own start of it from the page
 * @property {number} spentUsd  what its sub-agents spent
 * @property {TaskBy | null} ranAs  what its newest sub-agent ran as (G3-2): the agent's sub-agent or explorer, or the
 *   team's role — as whoever led when it started
 * @property {boolean} review  a reviewer reads its change before it merges (G3-3)
 * @property {Review[]} reviews  this try's reviews, round by round
 * @property {string | null} reviewer  the reviewer of this try's change: the same one reads every round
 * @property {"queued" | "reading" | "asked" | "back" | "yours" | null} step  in review: its reviewer is to start, reads, or asked
 *   for changes that are to reach its sub-agent; merging: the folder's check undid its merge, and its change is to go
 *   back to its sub-agent (`back`, V2-2) — or its change is ready and waits in its copy for its apply, the main agent's
 *   or the developer's (`yours`, the owner's of 11-02); with none, an apply of it runs
 * @property {string} overruled  the reason its change goes in as it stood (G3-4), "" for none
 * @property {"lead" | "planner"} [overruledBy]  who asked its change in as it stood, applying it (`applyAsked`) — a
 *   failed task's, or one with a reason: a team's lead, or the planner, whose asked change then stands whatever the
 *   folder's check finds. Missing on a lead's `merge`, whose reason `overruled` is, and where none asked
 * @property {Gate | null} [gate]  what Filament's check of the folder found as its change merged, the newest (V2-2); null
 *   before one ran, and for a try that has not merged yet — missing in a graph kept before V2-2
 * @property {string[]} [run]  a command task's commands, in order, as its planner gave them — `{item}` and a `! ` in them
 *   (V2-3); only a command task has it
 * @property {string[]} [items]  what fills `{item}` in its run, one run each; none for a task run once
 * @property {CommandResult | null} [result]  its newest run's table; null before one ended
 * @property {CommandProgress | null} [progress]  how its runs go while it runs; null otherwise
 * @property {string} [checklist]  the item of the agent's checklist that names it (V2-5): the text its task was made from,
 *   or took; a change of its name keeps it (TG2-D78). Missing on a task no checklist named
 * @property {boolean} [took]  its checklist item was taken, not made of: a task added otherwise that an item named, the
 *   agent's own work still, whose steps a checklist can be (`listMade`; the review of 4ce8b5f22..ca1b9f200, sa_093fa3ef).
 *   Missing on one its checklist made, and on one named before 11-11
 * @property {string} [item]  the status its checklist item had at the checklist's last send (11-10): an item moves its
 *   task as its status changes. Missing on a task no checklist named, and on one kept before
 * @property {boolean} [blocked]  its checklist item says blocked, while it is open
 * @property {{ text: string, status: string }[]} [list]  its steps (the owner's of 11-11): the agent's checklist while it
 *   ran, naming none of the graph's tasks (`applyPlan`), each with its status, as the checklist last said them — kept
 *   once it ends, and replaced by its steps sent again while it holds them (the graph's `stepsOf`, `holdsStill`). Missing
 *   on a task no checklist ran beside
 * @property {number} [againAt]  when it last started again from a pause (E36), `startedAt` keeping its first start: what
 *   the one started last of the planner's own is read by (`lastStart`); missing on a task never started again
 * @property {TaskThread} [thread]  the open thread of memory it finishes (E28); missing on a task that names none
 * @property {TaskFound} [foundBy]  the Hunter whose finding it takes up (11-02): missing on a task no hunt found
 * @property {Checkpoint | null} [checkpoint]  its newest checkpoint (E36, E41 P1): the pause that left it, its words kept
 *   behind it as a note of that title; missing on a task never paused
 * @property {string} [evidence]  what shows its acceptance holds, given with its done (HarnessV4_TaskGraphPlus_Plan E41
 *   P2 case 9): a task with acceptance and no check is done with it; missing where none was given
 * @property {string[]} [changed]  the files its folder changed while it ran, from git, relative to the folder (E41 P2
 *   case 11): a task of the planner's own, read as it paused and as it was marked done; missing where git told none.
 *   The first CHANGED_KEPT by path, where it changed more
 * @property {boolean} [changedMore]  it changed more files than `changed` keeps; missing where those are all
 * @property {SpanBase | null} [base]  where the folder stood, from git, as its running began (case 11): what its next
 *   pause or done reads its change from — missing where the folder is no git repository
 * @property {number} [quiet]  the turns begun while it ran since its last checkpoint — a pause, or a keep behind it —
 *   (E41 P2 case 13); missing on a task no turn began under
 * @property {boolean} [idle]  of the planner's own: the turn ended with it running and nothing at work that could wake
 *   the planner (d-idle, `leftIdle`), until the next turn's start says so
 * @property {boolean} [idleTold]  a turn's start said it was left so, which it says once a task
 * @property {boolean} [outsideTold]  of the planner's own: it was told a file the planner changed lies outside every
 *   open task's writes (d-writes, `outsideHeard`), which it is told once a task
 * @property {SideClaim} [side]  the developer's side run of it (10-28): missing on a task they never ran themselves
 * @property {TaskHelper} [helper]  the sub-agent a coding agent's launch named this task of its own for (10-28): the task
 *   stays the planner's — it applies the change and marks it done — and its box says who works on it; missing where none
 * @property {TaskSlot | null} [slot]  the worker, or the reader, its step went to waits for a slot: it starts by itself
 *   once one is free (the bug hunt of 10-30, SUB-3); missing or null while none waits
 * @property {TaskProposed} [proposed]  a task the fork that weighed the person's message planned for the agent (the
 *   owner's forked steer of 11-04): never ready — nothing starts it, nor offers it side by side — until the agent takes
 *   it on, starting it or changing it; missing on any other task
 * @property {string} [under]  the step it is a sub-task of (the owner's plan mode of 11-06): a task of the planner's own,
 *   under none itself. It starts after its step's needs, and its step is done once its sub-tasks are; missing on a task
 *   under none
 * @property {number} [round]  the round it is on (11-09): a start of it once done reopens it as the next, the round
 *   before kept in `earlier`; missing on a task never reopened
 * @property {number} [addedTurn]  the chat's turn the call that added it came in (11-09), so its words can be recalled
 *   after a compaction; missing where the call told none — a graph kept before
 * @property {number} [changedTurn]  the turn of the newest call that changed it — its add's where none did since
 * @property {string[]} [brought]  of the planner's own, the files the graph's merges and the developer's applies brought
 *   into the folder while its span was open (11-09): none of them is said as changed beyond its writes; missing where
 *   none came
 * @property {string[]} [uncommitted]  of its merged change, the files the folder's newest read found uncommitted
 *   (11-09): "applied, not committed"; missing once they are committed, or never read
 * @property {"folder" | "worktree" | "patch"} [workspace]  where its newest worker works, as its launch chose it (11-09,
 *   workspace-kind.js): read where tasks meet in place of a guess; missing before a launch said
 */
/**
 * @typedef {{ round: number, summary: string, at: number | null, evidence?: string, verdict?: Verdict, merged?: Task["merged"], changed?: string[], changedMore?: boolean }} DoneRound
 *   a round of a task as it was done, kept once a start reopened it (11-09): which round, what was done, when, and what
 *   showed it — its evidence, its check's verdict, what its change merged, what its folder changed
 */
/**
 * @typedef {object} TaskProposed  where a proposed task came from
 * @property {"steer"} from  a message the person sent while the agent worked, weighed aside by a fork
 * @property {number} at
 */
/**
 * @typedef {object} TaskSlot  a task's worker, or its reader, waiting for a slot: its launch or its going on found none
 *   free (the bug hunt of 10-30, SUB-3)
 * @property {string} agent  the sub-agent that waits: the task's worker, or its reviewer
 * @property {string} why  what holds it back, in the registry's words: a model's slots
 * @property {number} since
 */
/**
 * @typedef {object} TaskHelper  Filament's sub-agent a coding agent launched for a task of its own (the Designer's of 10-27):
 *   its id, its model, whether it works in its own copy, and when it started
 * @property {string} agent
 * @property {string} model
 * @property {boolean} copy
 * @property {number} at
 */
/**
 * @typedef {object} SideClaim  the developer's side run of a task of the planner's own (the Designer's of 10-27): the model
 *   its sub-agent runs on, where it works — its own copy, or the developer's folder — and whether its launch waits for
 *   the planner's turn to end (`pending` until it starts). `was`: the brief as its planner left it, given back where a
 *   restart cut the claim before its launch
 * @property {number} at
 * @property {string} model
 * @property {string} [effort]  how hard its sub-agent thinks, where the developer picked (one of SUBAGENT_EFFORTS); none,
 *   the main agent's (the owner's word of 11-05: "include reasoning effort across every model picker")
 * @property {"copy" | "yours"} folder
 * @property {"now" | "turn"} starts
 * @property {boolean} pending
 * @property {{ goal: string, steps: string[], acceptance: string }} was
 */
/**
 * @typedef {object} SidePick  one task of the developer's side run, as the Plan page's sheet gives it: its id, the model,
 *   where it works, and the brief they edited — what is missing comes from the task
 * @property {string} id
 * @property {string} model
 * @property {string} [effort]  how hard it thinks: one of SUBAGENT_EFFORTS; left out, the main agent's
 * @property {"copy" | "yours"} folder
 * @property {string} [goal]
 * @property {string[]} [steps]
 * @property {string} [acceptance]
 */
/**
 * @typedef {object} SpanBase  the folder's snapshot as a task's running began (E41 P2 case 11): the repository, the
 *   commit that holds the tree as it stood (no ref keeps it), and the folder the task ran in; the HEAD it was taken on
 *   and when, so a close finds the commits a merge or a rebase brought in (FabeleHelper's of 11-10) — missing on a
 *   base kept before; and the round of the task it is of, so a round reopened never reads on from the one before's
 *   (`spanOpened`) — missing on a base kept before, which is read as its task's first round's
 * @property {string} repo
 * @property {string} commit
 * @property {string} folder
 * @property {string | null} [head]
 * @property {number} [at]
 * @property {number} [round]
 */
/**
 * @typedef {object} Checkpoint  where a paused task stood (E36): which pause, the title of its note behind the task, when
 * @property {number} n
 * @property {string} title
 * @property {number} at
 */
/**
 * @typedef {object} TaskThread  the open thread of memory a task finishes (HarnessV4_GraphThreads E28): its id; its words
 *   as memory held them when the task took it; whether it is the user's own, so memory asks them to close it; and, once
 *   the task is done, what came of the close (null before)
 * @property {string} id
 * @property {string} text
 * @property {boolean} own
 * @property {ThreadEnd | null} end
 */
/**
 * @typedef {{ how: "closed" | "asked" | "already" | "not", words: string, at: number }} ThreadEnd  what came of a done
 *   task's close of its thread: closed; the user's own, asked about; closed already by someone else; or not closed, and why
 */
/**
 * @typedef {(id: string) => { id: string, text: string, own: boolean } | { error: string }} ThreadOf  memory's word on the
 *   thread a task names (E28), read only: the thread, or why it can be none — the runner's, which knows the session's project
 */
/**
 * @typedef {object} TaskFound  the Hunter whose finding a task takes up (11-02): its id, its name as shown, and the task
 *   of the graph it was fired from — which the task needs
 * @property {string} agent
 * @property {string} name
 * @property {string} task
 * @property {boolean} [added]  the task's need of `task` is the hunt's, its needs lacking it as the planner named them
 *   — another hunt in its place takes that need's place. Every mark a call gives carries it; one kept before the
 *   field was there has none, and takes no need away
 */
/**
 * @typedef {(agent: string) => { agent: string, name: string, task: string, graph: number | null } | { error: string }} FoundOf
 *   the registry's word on the Hunter a task's `found_by` names (11-02), read only: its id, its name as shown, the task it
 *   was fired from and the start of the graph that held that task as it was fired (null where its launch did not say) —
 *   or what that id is instead, in words
 */
/**
 * @typedef {object} CommandStep  one command of a command task's run (V2-3): as the shell runs it, `{item}` filled in and
 *   a leading `! ` taken off — `invert`: it passes when it fails (TG2-D67)
 * @property {string} command
 * @property {boolean} invert
 */
/**
 * @typedef {object} CommandRun  one run of a command task (V2-3): its item (null for a task run once), the command that
 *   ended it — the first that did not pass, else its last — its exit (null where it had none), its time, whether it
 *   passed, and the end of what that command printed: kept for the first runs that did not pass, "" for the rest
 * @property {string | null} item
 * @property {string} command
 * @property {boolean} invert
 * @property {number | null} exit
 * @property {number} ms
 * @property {boolean} passed
 * @property {string} output
 * @property {boolean} [stopped]  a stop ended it before it finished — the registry's word, never kept
 */
/**
 * @typedef {object} CommandResult  a command task's table (V2-3): its runs that ended, in item order; how many it had; on
 *   how many lanes; how long it took; whether the developer's stop cut it; when
 * @property {CommandRun[]} runs
 * @property {number} of
 * @property {number} lanes
 * @property {number} ms
 * @property {boolean} cut
 * @property {number} at
 */
/** @typedef {{ ran: number, passed: number, of: number, lanes: number }} CommandProgress  a running command task's runs so far */
/**
 * @typedef {{ ran: true, runs: CommandRun[], of: number, lanes: number, ms: number, cut: "developer" | null } | { ran: false, words: string }} CommandOutcome
 *   how the runner's run of a command task went: its runs — cut by the developer's stop, or not — or why it did not run
 */
/**
 * @typedef {object} Graph
 * @property {number} version
 * @property {string} goal  what the work is for
 * @property {Task[]} tasks  in the order the agent added them
 * @property {number} startedAt
 * @property {{ at: number, reason: string, checks?: CloseChecks, to?: string } | null} closed  a closed graph stays readable and takes
 *   nothing more: the next add starts another. `checks`: what its checks found on the folder after the close (V2-1);
 *   `to`: the chat it was carried on in (the owner's plan mode of 11-06, piece E)
 * @property {{ at: number } | null} held  no sub-agent's task starts until the agent's next tasks call: since the
 *   developer's Stop (G2-8)
 * @property {{ at: number } | null} [planning]  a plan waits for the person's Approve (the owner's plan mode of 11-06): a
 *   planning turn changed the graph, and Filament starts no sub-agent's task until they approve it, or say go and its
 *   planner starts a task; missing or null while none waits
 * @property {number} rev  how many times the session kept its graph: a page never draws an older one over a newer one
 * @property {{ chain: string, title: string, at: number, heard?: boolean }} [from]  the chat it was carried over from,
 *   and when (piece E): its planner hears so at the new chat's first turn (`heard` once it has)
 * @property {string[]} [told]  what its answers said once a graph (E41 P2): "line", that its open tasks were one straight
 *   line (case 14); missing until one was said. `side:<ids>`: every task its answers said may run side by side;
 *   `meets:<pairs>`: every two tasks its answers said meet over files; `ignored:<id>`: a task the person ignored on a card;
 *   `steps:<id>`: a task at work whose steps were all done was told to mark it done, until one of its steps is open again
 * @property {string | null} [stepsOf]  the task that holds the agent's checklist as its steps (the owner's of 11-11): set
 *   as a list becomes a task's steps (`applyPlan`), and kept as that task is done or paused and as the graph closes, so its
 *   steps sent again are routed by it and never by their words. It names none once its task is dropped: read it through
 *   `stepsHolder`, which no drop has to tell. Missing on a graph no list was a task's steps on, and on one kept before
 *   11-11, whose holder `stepsHolder` works out
 * @property {boolean} [stepsListed]  whether the checklist as last sent is its holder's steps: false once a later list
 *   was the checklist of the graph's tasks, its holder keeping its steps for a list of them sent again. The Plan page
 *   shows the graph by it (`graphView`). Missing with no holder, and on a graph kept before 11-11
 * @property {SideOffer} [offer]  the side-by-side card that stands in the chat's transcript, until the developer accepts
 *   or ignores it, or a newer one takes its place
 * @property {true} [shared]  the session's writing sub-agents share its folder, as Filament last kept the graph (the
 *   review of g1): what a reader with no word of its own — a show, the Plan, a compaction's text — says where tasks meet
 *   by (`sharingOf`); missing where they work in copies of their own
 */
/**
 * @typedef {object} SideOffer  the side-by-side card (Phase 5): the planner's own ready tasks that can run at once, when
 *   it was offered, and the chat's turn it stands after
 * @property {string[]} ids
 * @property {number} at
 * @property {number} turn
 * @property {string | null} [model]  the model its tasks run on where it answers itself: the turn's or the chat's, as it was suggested
 * @property {number} [until]  when it answers itself, `SIDE_ANSWER_MS` after `at` (the plan of 11-14); missing on a card
 *   kept before then, which waits for the person alone
 * @property {"accept" | "decline"} [onTimeout]  what it does then: starts its tasks, as the person's Accept does, where
 *   a model is known; else they stay the agent's, as an Ignore keeps them
 * @property {string} [why]  why it declines then, in the card's words (`sideTimeoutWhy`)
 */
/**
 * @typedef {{ at: number, ran: true, runs: (Verdict["runs"][number] & { tasks: string[], output: string })[] } | { at: number, ran: false, words: string }} CloseChecks
 *   the close's run of its done tasks' checks on the folder as it stood (V2-1): each distinct command once, with the
 *   tasks whose check holds it and a red one's output end; or why it did not run
 */
/** @typedef {(agent: string) => string | null} Resumable  why a task's last worker can't go on with it, or null when it
 *  can: the registry's word (HarnessV3-FailurePoints §6 item 4) */
/** @typedef {(commands: readonly string[], field?: "check" | "run") => string | null} Vet  why a check's commands cannot be,
 *  as a brief's would not (TG2-D44) — or a command task's run's, each with its item filled in (V2-3) — or null: the
 *  registry's word, which knows the session's rules (V2-1) */
/** @typedef {{ ok: false, error: string }} Refusal */
/**
 * @typedef {{ id: string, agent: string, review: boolean, text: string }} NoteOrder  a line the planner sends to whoever
 *   works on a task now (`note`): the task, the sub-agent at work on it — its reviewer while one reads (`review`) — and
 *   the words, as written
 */
/**
 * @typedef {object} NotesAsk  a keep or a read of what is kept behind a task (HarnessV4_TaskNotes_Plan E33), checked —
 *   the runner keeps or reads it, nothing in the graph changes: the task, or null for the graph itself; a note's title
 *   and text; the files to copy in, by their paths; a picture to keep, by its name; what to forget — or a find of words
 *   (11-06), in one task, or in every one with none
 * @property {"keep" | "read" | "find"} kind
 * @property {string | null} task
 * @property {number} graph  the graph's start: notes belong to their graph
 * @property {string} title
 * @property {string | null} text
 * @property {string[]} files
 * @property {string} picture
 * @property {string[]} forget
 * @property {number} from  a read's: where in a long note or text file its part starts, a character's place
 * @property {string[]} [words]  a find's: the words each line found holds, lower-cased
 */
/** @typedef {{ ok: true, graph: Graph | null, text: string, changed: boolean, note?: NoteOrder, notes?: NotesAsk, offer?: PlanOffer }} Applied */
/** @typedef {{ depth: "light" | "standard" | "deep", side: boolean }} PlanOffer  a plan offered on a card under the reply (11-06): the depth and the side by side the agent suggests */

/** @param {string} error @returns {Refusal} */
const refused = (error) => ({ ok: false, error });

/** What a keep or a read takes (E33 cases 13): the store's own limits say what it holds. */
const NOTES_ASK = Object.freeze({ title: 120, text: 200_000, files: 20, forget: 50 });
/** How long a find's words may run (11-06): a few words, never a passage. */
const FIND_WORDS = 200;
/**
 * A keep or a read, checked as every call is (E33): a graph to keep it with, a task of it — or none, for the graph
 * itself — and what it keeps or reads, each problem said. A closed graph, a done or a dropped task keep and read the
 * same: what was learned stays (case 10).
 * @param {Graph | null} graph @param {Record<string, any>} i @returns {NotesAsk | Refusal}
 */
function notesAsk(graph, i) {
  if (!graph) return refused("No graph yet: tasks add starts one, with its goal — then keep what its tasks need behind them.");
  const id = i.id === undefined || i.id === null || i.id === "" ? null : String(i.id).toLowerCase();
  if (id !== null && !graph.tasks.some((t) => t.id === id)) return refused(`${text(String(i.id))} is no task in the graph: keep and read name a task by its id, or none for the graph itself`);
  /** @type {string[]} */
  const problems = [];
  const title = i.title === undefined || i.title === null ? "" : typeof i.title === "string" ? i.title.replace(/\s+/g, " ").trim() : (problems.push("title is text: a note's title, or a file's name"), "");
  if (title.length > NOTES_ASK.title) problems.push(`title is ${title.length} characters: a title is ${NOTES_ASK.title} at most`);
  /** @param {string} field @param {number} most */
  const list = (field, most) => {
    const v = i[field];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x.trim())) {
      problems.push(`${field} is a list of ${field === "files" ? "paths" : "titles or file names"}`);
      return [];
    }
    if (v.length > most) problems.push(`${field} names ${v.length}: ${most} at most in one call`);
    return v.map((x) => x.trim());
  };
  if (i.action === "find") {
    const words = typeof i.words === "string" ? i.words.toLowerCase().split(/\s+/).filter(Boolean) : [];
    for (const f of ["title", "text", "files", "picture", "forget", "from"]) if (i[f] !== undefined && i[f] !== null) problems.push(`find takes words, and id alone: ${f} is ${f === "title" || f === "from" ? "read's" : "keep's"}`);
    if (i.words !== undefined && i.words !== null && typeof i.words !== "string") problems.push("words is text: what to look for, each word on the lines found");
    else if (!words.length) return shaped("find", "find needs words: what to look for — each line found holds every one of them", i);
    if (words.join(" ").length > FIND_WORDS) problems.push(`words is ${FIND_WORDS} characters at most: a few words that the lines you look for hold`);
    return problems.length ? refusedAll(problems) : { kind: "find", task: id, graph: graph.startedAt, title: "", text: null, files: [], picture: "", forget: [], from: 0, words };
  }
  if (i.action === "read") {
    for (const f of ["text", "files", "picture", "forget"]) if (i[f] !== undefined && i[f] !== null) problems.push(`read takes id, title and from alone: ${f} is keep's`);
    const from = i.from === undefined || i.from === null ? 0 : Number.isInteger(i.from) && i.from >= 0 ? i.from : (problems.push("from is a whole number: where a long note's or file's next part starts, as its last part said"), 0);
    if (from > 0 && !title) problems.push("from reads on in one note or file: give its title too");
    return problems.length ? refusedAll(problems) : { kind: "read", task: id, graph: graph.startedAt, title, text: null, files: [], picture: "", forget: [], from };
  }
  const body = i.text === undefined || i.text === null ? null : typeof i.text === "string" ? i.text : (problems.push("text is a note's words, whole"), null);
  if (body !== null && body.length > NOTES_ASK.text) problems.push(`text is ${body.length.toLocaleString("en-US")} characters: a note is ${NOTES_ASK.text.toLocaleString("en-US")} at most — keep it as two notes`);
  if (body !== null && !body.trim()) problems.push("text is empty: give the note's words, or forget it by its title");
  if (body !== null && !title) problems.push("a note needs title: the name you read it back by");
  const files = list("files", NOTES_ASK.files);
  const forget = list("forget", NOTES_ASK.forget);
  const picture = i.picture === undefined || i.picture === null ? "" : typeof i.picture === "string" ? i.picture.trim() : (problems.push("picture is a picture's name, as its agent's report gives it"), "");
  const empty = body === null && !files.length && !picture && !forget.length && !problems.length;
  if (empty) problems.push("keep takes something to keep: title and text (a note), files (paths), picture (a picture's name) — or forget");
  if (i.from !== undefined && i.from !== null) problems.push("from is read's: where a long note's next part starts");
  if (problems.length) return empty ? shaped("keep", refusedAll(problems).error, i) : refusedAll(problems);
  return { kind: "keep", task: id, graph: graph.startedAt, title, text: body, files, picture, forget, from: 0 };
}
/**
 * A call's problems, every one (HarnessV3-FailurePoints §8 item 1): one is said as it is, several as a list, so a
 * single call can fix them all. A refused call changes nothing, and the words say so where an agent could read the
 * call as taken in part (E41 P5's measure: of a change of six tasks with two problems, the agent took the other four as
 * changed): always with several problems, and with one where the call named several tasks (`many`).
 * @param {string[]} problems @param {boolean} [many] @returns {Refusal}
 */
const refusedAll = (problems, many = false) =>
  refused(
    problems.length === 1
      ? `${many ? "Nothing of this call changed: " : ""}${problems[0]}`
      : `${problems.length} problems, so nothing of this call changed — one call can fix them all:\n${problems.map((p) => `- ${p}`).join("\n")}`,
  );
/** @param {unknown} v */
const text = (v) => (typeof v === "string" ? squash(v) : "");
/** A sub-agent's words with their lines kept: trimmed, each line's trailing blanks gone, no run of blank lines. @param {unknown} v */
const prose = (v) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim() : "");
/** Words that end a sentence of Filament's own, their own last period dropped. @param {string} s */
const sentence = (s) => s.replace(/[.\s]+$/, "");
/** @param {Graph} graph */
const indexOf = (graph) => new Map(graph.tasks.map((t) => [t.id, t]));
/**
 * The steps of a graph (the owner's plan mode of 11-06): each task some sub-task not dropped is under, by its id, with
 * those sub-tasks in the order they were added. @param {Graph} graph @returns {Map<string, Task[]>}
 */
function kidsOf(graph) {
  /** @type {Map<string, Task[]>} */
  const out = new Map();
  for (const t of graph.tasks) {
    if (!t.under || t.state === "dropped") continue;
    const ks = out.get(t.under);
    if (ks) ks.push(t);
    else out.set(t.under, [t]);
  }
  return out;
}
/**
 * The needs a task waits on (11-06): its own, and — a sub-task — its step's, which it starts after.
 * @param {Task} t @param {Map<string, Task>} byId @returns {string[]}
 */
const needsOf = (t, byId) => {
  const step = t.under ? byId.get(t.under) : undefined;
  return step?.needs.length ? [...new Set([...t.needs, ...step.needs])].filter((n) => n !== t.id) : t.needs;
};
/**
 * What each task comes after, for the order and its loops (11-06): its needs with its step's, and — a step — its
 * sub-tasks, which it is done once they all are. @param {Graph} graph @returns {Map<string, string[]>}
 */
function edgesOf(graph) {
  const byId = indexOf(graph);
  const kids = kidsOf(graph);
  return new Map(graph.tasks.map((t) => [t.id, [...needsOf(t, byId), ...(kids.get(t.id) || []).map((k) => k.id)]]));
}
/** Ids in a line, the first few, the rest counted (11-06): a step's done sub-tasks, a long list's. @param {readonly string[]} ids @param {number} [most] */
const fewIds = (ids, most = 10) => (ids.length > most ? `${ids.slice(0, most).join(", ")} and ${ids.length - most} more` : ids.join(", "));
/**
 * Whether a task will still run, or is running: waiting, running, paused (E36), in review, merging, or failed and
 * waiting for the agent. @param {Task} t
 */
const isOpen = (t) => t.state === "waiting" || t.state === "running" || t.state === "paused" || t.state === "review" || t.state === "merging" || t.state === "failed";
/** A time of day, as a checkpoint's title and the graph's words give it: "14:02", the machine's own clock. @param {number} at */
const clockOf = (at) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
/** A checkpoint in words: "checkpoint 2 (14:40)". @param {Checkpoint} c */
const checkpointWords = (c) => `checkpoint ${c.n} (${clockOf(c.at)})`;
/**
 * Whether a sub-agent's run holds the task now: it runs, a reviewer reads its change, or it merges — not one whose merge
 * the folder's check undid, whose change waits to go back to its worker (V2-2). @param {Task} t
 */
const isLive = (t) => t.by !== "you" && (t.state === "running" || (t.state === "merging" && t.step !== "back" && t.step !== "yours") || (t.state === "review" && t.step === "reading"));
/**
 * Whether a worker's change is ready and waits in its copy for its apply (the owner's of 11-02): the main agent's, or the
 * developer's — nothing of Filament's writes it into the folder. @param {Task} t
 */
const yours = (t) => t.state === "merging" && t.step === "yours";
/** Whether the developer's side run holds a task (10-28): it waits for its launch, or its sub-agent works on it. @param {Task} t */
const claimed = (t) => !!t.side && (t.side.pending || t.state === "running");
/** Whether the folder's check undid the task's merge, and its change waits to go back to its worker (V2-2). @param {Task} t */
const goesBack = (t) => t.state === "merging" && t.step === "back";
/** Whether a team's lead plans: the crew is its team's members. @param {Crew} crew @returns {crew is readonly Member[]} */
const led = (crew) => Array.isArray(crew);
/**
 * Whether a task's work changes files that are kept (G3-2): another's task that names the files it writes — a task
 * given to one that changes nothing names none (`readFields`). @param {{ by: TaskBy, writes: readonly string[] }} t
 */
const changes = (t) => t.by !== "you" && t.writes.length > 0;
/**
 * Whether whoever a task names changes files: a member of the team that leads by its card, the agent's sub-agent, and
 * never its explorer — and a task that keeps another planner's word for who does it, as the task stood.
 * @param {TaskBy} by @param {Crew} crew @param {Partial<Task>} base
 */
const writesAs = (by, crew, base) => {
  if (by === "you") return false;
  const m = led(crew) ? memberOf(crew, by) : null;
  return m ? editsFiles(m) : by === "sub-agent" ? true : by === "explorer" ? false : base.by === by && (base.writes?.length ?? 0) > 0;
};
/** @param {number} n @param {string} one */
const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
/**
 * How many of a command task's runs go side by side, as the Plan page says it (views/task-graph.js `atATime`): never on
 * "lanes", the field's name, a lane being a folder or worktree a chat works in (d-word, 11-12). @param {number} n
 */
const atATime = (n) => (n === 1 ? "one at a time" : `${n} at a time`);
/** A worker's task in words: whose it is. @param {TaskBy} by */
const whose = (by) => `${aOrAn(by)}'s task`;
/**
 * How a lead is told to hand a task on: "a role" under the four members that ship, in the words written for them
 * (AG-171), "to a worker" under any other team. @param {Crew} crew
 */
const handWord = (crew) => (led(crew) && !isShippedRoster(crew) ? "to a worker" : "a role");
/** What ran a task, as its words name it (G3-2): the agent's sub-agent — an explorer is one — or the team's role. @param {TaskBy | null} as */
const workerWord = (as) => (!as || TASK_BY.includes(as) ? "sub-agent" : as);
/** @param {string} s */
const capital = (s) => `${s[0].toUpperCase()}${s.slice(1)}`;
/** How a task stands, in a word or two. @param {Task} t */
const stateWord = (t) => (t.state === "review" ? "in review" : t.state === "checking" ? "being checked" : yours(t) ? "ready, its change waiting for its apply" : t.state);
/** Dollars as a line says them. @param {number} n */
const usd = (n) => (n >= 0.01 ? `$${n.toFixed(2)}` : "under $0.01");

/** A task's check: none for a task kept before V2-1, which has no field. @param {Partial<Task>} t @returns {string[]} */
const checkOf = (t) => (Array.isArray(t.check) ? t.check : []);
/** A command as the words quote it. @param {string} c */
const q = (c) => `\`${c}\``;
/** A check's commands in the order Filament runs them: "`npm run build`, then `npm test`". @param {readonly string[]} check */
const inOrder = (check) => check.map(q).join(", then ");
/** An exit in words. @param {number | null} exit */
const exitWords = (exit) => (exit === null ? "no exit code" : `exit ${exit}`);
/** How a command's run ended, as its kind says it. @param {number | null} exit @param {number} ms */
const endedWords = (exit, ms) => (exit === 0 ? `passed (exit 0, ${durationWords(ms)})` : `failed (${exitWords(exit)}, ${durationWords(ms)})`);
/**
 * One command of a check in words: how it ran — once, or a red one and its second run: "and again on a second run", or
 * "then passed … on a second run" (flaky).
 * @param {Verdict["runs"][number]} r
 */
const runWords = (r) => {
  if (!r.first) return `${q(r.command)} ${endedWords(r.exit, r.ms)}`;
  const first = `${q(r.command)} ${endedWords(r.first.exit, r.first.ms)}`;
  return r.exit === 0 ? `${first}, then ${endedWords(0, r.ms)} on a second run` : `${first}, and again on a second run (${exitWords(r.exit)}, ${durationWords(r.ms)})`;
};
/** A verdict's commands in words: each that ran, then those not run. @param {Verdict} v */
const verdictRuns = (v) => [...v.runs.map(runWords), ...v.unrun.map((c) => `${q(c)} not run`)].join("; ");
/** The end of an output: its last `n` lines, blank ones at its end aside. @param {string} text @param {number} n */
const lastLines = (text, n) => String(text || "").replace(/\s+$/, "").split(/\r?\n/).slice(-n).join("\n");

/**
 * What Filament's run of a check found (V2-1), as a task keeps it: passed, flaky, failed — the first command that did,
 * after its second run — or not run, with why. A stop that cut it is a check not run.
 * @param {CheckOutcome} o @param {number} at @param {string} [cutWords]  why it is not run, where a stop cut it
 * @returns {Verdict}
 */
export function verdictOf(o, at, cutWords = "a stop cut its check") {
  const none = { runs: [], unrun: [], output: "", back: 0, at };
  if (!o.ran) return { kind: "not", ...none, words: String(o.words || "") };
  if (o.stopped) return { kind: "not", ...none, words: cutWords, back: o.bounces || 0 };
  const runs = o.runs.map((r) => ({ command: r.command, exit: r.exit, ms: r.ms, first: r.first ? { exit: r.first.exit, ms: r.first.ms } : null }));
  const red = o.runs.find((r) => r.exit !== 0);
  const unrun = o.commands.slice(o.runs.length);
  const flake = o.runs.find((r) => r.first && r.first.exit !== 0);
  const kind = red || unrun.length ? "failed" : flake ? "flaky" : "passed";
  // Flaky: the end of what its first run printed, which says what failed where the second passed (the owner's of 11-06).
  const output = red ? lastLines(red.output, RED_LINES) : kind === "flaky" ? lastLines(flake?.first?.output || "", RED_LINES) : "";
  return { kind, runs, unrun, output, words: "", back: o.bounces || 0, at };
}
/** Whether a verdict lets the task be done: its check passed, flaky or not. @param {Verdict | null} v */
const passedOf = (v) => !!v && (v.kind === "passed" || v.kind === "flaky");

/**
 * What Filament's check of the folder found as a task's change merged (V2-2), as the task keeps it: each command with its
 * exit after the merge and before it where it ran there, the one the merge broke, the end of the output of that one —
 * or of the first red one — and why none ran.
 * @param {FolderOutcome} o @param {number} at @returns {Gate}
 */
export function gateOf(o, at) {
  const runs = o.runs || [];
  const b = o.broke || null;
  const red = b || runs.find((r) => r.after.exit !== 0) || null;
  return {
    kind: o.kind,
    runs: runs.map((r) => ({ command: r.command, exit: r.after.exit, ms: r.after.ms, before: r.before ? r.before.exit : null, ...(r.own && r.after.exit !== 0 ? { own: true } : {}) })),
    broke: b ? { command: b.command, exit: b.after.exit, ms: b.after.ms, own: !!b.own, before: b.before ? b.before.exit : null } : null,
    output: red && red.after.exit !== 0 ? lastLines(red.after.output, RED_LINES) : "",
    words: o.kind === "not" ? String(o.words || "") : "",
    ruled: [...(o.ruled || [])],
    back: o.back ?? null,
    conflicts: (o.conflicts || []).map(({ path, why }) => ({ path, why })),
    stuck: [...(o.stuck || [])],
    at,
  };
}
/** Commands as a gate's words list them, each with how it ended in parentheses: "a, and b", "a, b, and c". @param {readonly string[]} items */
const runList = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}` : items.join(""));
/** One command of the folder's check in words: "`npm test` passed (exit 0, 6 s)". @param {Gate["runs"][number]} r */
const gateRun = (r) => `${q(r.command)} ${endedWords(r.exit, r.ms)}`;
/** The commands that failed with a task's change, in words. @param {Gate} g */
const gateReds = (g) => runList(g.runs.filter((r) => r.exit !== 0).map(gateRun));
/** Whether a command the merge broke failed on the folder before it too. @param {NonNullable<Gate["broke"]>} b */
const redBefore = (b) => b.before !== null && b.before !== 0;
/**
 * The command a merge broke, in words, with `folder` the developer's folder as whoever plans names it: one that passes
 * without the change and fails with it — or the change's own check, which passed in its worktree and fails with the rest
 * of the folder, without the change too where it did.
 * @param {NonNullable<Gate["broke"]>} b @param {string} folder
 */
const brokeSaid = (b, folder) =>
  b.own
    ? `its own check ${q(b.command)} passed in its worktree, and fails with the rest of ${folder} (${exitWords(b.exit)}, ${durationWords(b.ms)})${redBefore(b) ? ", and without the change too" : ""}`
    : `${q(b.command)} ${b.before === 0 ? "passes without it and fails with it" : "fails with it"} (${exitWords(b.exit)}, ${durationWords(b.ms)})`;
/**
 * The change's own checks red in a merge that stands red, in words: each failed the same way with the change and
 * without it — the registry's `failedAlike`, the owner's of 11-10 —, so the failure is the environment's, not the
 * change's, and the task was not sent back. "" for none.
 * @param {Gate} g @param {string} folder @param {string} it
 */
const alikeSaid = (g, folder, it) => {
  const own = g.runs.filter((r) => r.own && r.exit !== 0 && r.before !== null && r.before !== 0).map((r) => q(r.command));
  if (!own.length) return "";
  const one = own.length === 1;
  return ` Its own check${one ? "" : "s"} ${runList(own)} passed in its worktree, and fail${one ? "s" : ""} the same way with ${it} and without ${it}: the failure is the environment's — ${folder}'s, or what its checks run with, a missing dependency folder say — not the change's, so the task was not sent back.`;
};
/** Which return this is, in words: "first", "second". @param {number} n */
const nth = (n) => (n === 1 ? "first" : n === 2 ? "second" : `${n}th`);
/**
 * What Filament's check of the folder found as the task's change merged and stood (V2-2), in a sentence or more — `it`
 * names the change ("it" after "its change is merged", "its change" in a show) and `folder` the developer's folder.
 * A merge undone is said where its task is (`endText`, `gateLines`). `reasoned`: one that stands red was asked in
 * with a reason; else its planner asked it in as it stood, with none (`stoodBare`).
 * @param {Gate} g @param {string} folder @param {string} it @param {boolean} [reasoned]
 */
function gateSaid(g, folder, it, reasoned = true) {
  const ruled = g.ruled.map((s) => ` ${s}`).join("");
  if (g.kind === "not") return g.words;
  if (g.kind === "passed") return `Filament's check of the folder with ${it} passed: ${runList(g.runs.map(gateRun))}.${ruled}`;
  const reds = g.runs.filter((r) => r.exit !== 0).length;
  if (g.kind === "red") return `Filament's check of the folder fails with ${it}, and failed before it too: ${gateReds(g)}. ${capital(folder)} was red on ${reds === 1 ? "it" : "them"} already, so the merge stands.${alikeSaid(g, folder, it)}${ruled}`;
  if (g.kind === "reason") return `Filament's check of the folder fails with ${it} — ${gateReds(g)} — and it stands, ${reasoned ? "for your reason" : "red, as you asked for it as it stood"}.${ruled}`;
  const b = g.broke;
  if (g.kind !== "stuck" || !b) return "";
  const how = b.own
    ? `Its own check ${q(b.command)} passed in its worktree, and fails with the rest of ${folder} (${exitWords(b.exit)}, ${durationWords(b.ms)}),`
    : `With ${it} ${folder}'s check fails, and without ${it} the check passes — ${q(b.command)} ${endedWords(b.exit, b.ms)} —`;
  const n = g.stuck.length;
  const stuck = n ? ` ${plural(n, "file")} could not be put back as ${n === 1 ? "it was" : "they were"} — ${g.stuck.join(", ")}: check ${n === 1 ? "it" : "them"} by hand.` : "";
  return `${how} and Filament could not undo the merge cleanly, since ${folder} changed there after it${g.conflicts.length ? `: ${g.conflicts.map((c) => `${c.path}: ${c.why}`).join("; ")}` : ""}.${stuck} It stands, red.${ruled}`;
}

/**
 * A failure's words as a cause two failures share when they failed the same way (HarnessV3-FailurePoints §8 item 3):
 * the words that tell one try from another — ids, counts, durations, anything with a digit — left out.
 * @param {string} kind @param {string} [words]
 */
const causeOf = (kind, words = "") => `${kind}${words ? ` ${squash(words).toLowerCase().split(" ").map((w) => (/\d/.test(w) ? "#" : w)).join(" ")}` : ""}`;
/** The task failed, `cause` the way: how many times in a row it failed so. @param {Task} t @param {string} cause */
const failedAgain = (t, cause) => {
  t.failures = { cause, times: t.failures?.cause === cause ? t.failures.times + 1 : 1 };
};

/** A count of characters as the words say it. @param {number} n */
const chars = (n) => n.toLocaleString("en-US");
/** The words that refuse a text past its limit (G2-13), or null. @param {string} what @param {string} t @param {number} max */
const over = (what, t, max) => (t.length > max ? `${what} is up to ${chars(max)} characters (this one has ${chars(t.length)})` : null);

/** A task's id from its input, lower-cased, or the refusal. @param {unknown} input @returns {{ id: string } | { error: string }} */
function readId(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "each task is an object: its id, its name, and the ids of the tasks it needs" };
  const raw = /** @type {Record<string, unknown>} */ (input).id;
  if (raw === undefined || raw === null || raw === "") return { error: "each task needs an id: a short name of your own, like t1 or parser-fix (a letter, then letters, digits, - or _; up to 24 characters)" };
  const id = String(raw).trim();
  if (!ID.test(id)) return { error: `"${id}" is no task id: a letter, then letters, digits, - or _ (up to 24 characters), like t1 or parser-fix` };
  return { id: id.toLowerCase() };
}

/**
 * The keys a task's input gives that are no field of a task, said, or null.
 * @param {string} id @param {object} input @param {readonly string[]} fields
 */
function unknownField(id, input, fields) {
  const keys = Object.keys(input).filter((k) => k !== "id" && !fields.includes(k));
  // A state set by hand (E40 case 11): it moves by its own actions, never as a field.
  const state = keys.includes("status") || keys.includes("state") ? ` — a task's state moves by its own actions: done ends it (${callFor("done", { id })}), start starts it, drop drops it` : "";
  return keys.length ? `${id}: ${keys.join(", ")} ${keys.length === 1 ? "is no field" : "are no fields"} of a task — its fields are id, ${fields.join(", ")}${state}` : null;
}

/** The words of a thread's id where memory is not there to say (E28): the runner's word replaces it. @type {ThreadOf} */
const noThreads = () => ({ error: "memory is off for this session, so no thread of it can go on the graph" });

/**
 * The thread a task's input names (E28), read apart from its other fields: kept as its base had it where the input
 * gives none, taken away by "" or null, else memory's word on it (`threadOf`) — the thread, or the refusal in words.
 * @param {string} id @param {Record<string, any>} input @param {Partial<Task>} base @param {readonly string[]} known @param {ThreadOf} threadOf
 * @returns {{ thread: TaskThread | null } | { error: string }}
 */
function readThread(id, input, base, known, threadOf) {
  const v = known.includes("thread") ? input.thread : undefined;
  if (v === undefined) return { thread: base.thread ?? null };
  if (v === null || v === "") return { thread: null };
  if (typeof v !== "string" || !text(v)) return { error: `${id}: thread is the id of an open thread of memory, as its line shows it — like i98` };
  const ref = text(v);
  if (base.thread && base.thread.id === ref) return { thread: base.thread };
  const r = threadOf(ref);
  if ("error" in r) return { error: `${id}: ${r.error}` };
  return { thread: { id: r.id, text: cut(squash(r.text), 160), own: r.own, end: null } };
}

/**
 * Two open tasks that finish one thread (E28, GT-D5), said for the tasks a call gave: a thread closes at the first
 * one's done. @param {Graph} graph @param {readonly string[]} ids @returns {string[]}
 */
function threadClashes(graph, ids) {
  /** @type {string[]} */
  const problems = [];
  for (const id of ids) {
    const t = graph.tasks.find((x) => x.id === id);
    const other = t?.thread && isOpen(t) ? graph.tasks.find((x) => x !== t && x.thread?.id === t.thread?.id && (isOpen(x) || x.state === "checking")) : null;
    if (other && t?.thread) problems.push(`${id}: memory's thread ${t.thread.id} is ${other.id}'s already — one task finishes a thread`);
  }
  return problems;
}

/** What an add or a change says of the threads it gave (E28): who closes each, and when. "" where none. @param {readonly Task[]} tasks @param {Crew} crew */
function threadWords(tasks, crew) {
  return tasks
    .filter((t) => t.thread && !t.thread.end)
    .map((t) => {
      const th = /** @type {TaskThread} */ (t.thread);
      return th.own
        ? ` ${t.id} finishes memory's thread ${th.id}, which is the ${led(crew) ? "developer" : "user"}'s own: once it is done, memory asks them to close it.`
        : ` ${t.id} finishes memory's thread ${th.id}: once it is done, Filament closes the thread with its summary.`;
    })
    .join("");
}

/** The words of a found_by where no registry is there to say (11-02): the runner's word replaces it. @type {FoundOf} */
const noHunts = () => ({ error: "Filament runs no bug hunts here, so found_by can name none" });

/**
 * A task's found_by as the graph reads it (11-02) — the one reading: "" or null takes the mark away (`off`), a
 * hunt's agent id names the hunt (`agent`), anything else is no found_by, in words. Null where the call gives none.
 * @param {unknown} v
 * @returns {{ off: true } | { agent: string } | { error: string } | null}
 */
export function foundByOf(v) {
  if (v === undefined) return null;
  if (v === null || v === "") return { off: true };
  if (typeof v !== "string" || !text(v)) return { error: "found_by is the id of a bug hunt sent from a task on the Plan, as its report names it — like sa_4ff20533" };
  return { agent: text(v) };
}

/**
 * What found a task (11-02), read apart from its other fields as its thread is: kept as its base had it where the input
 * gives none, taken away by "" or null, else the hunt it names (`foundByOf`) — as a task of `graph`, the graph the task
 * goes into, keeps it already, which holds once the registry has let that Hunter go; or the registry's word on it
 * (`foundOf`), fired from a task of that graph. The task fired from is done, so never the one a call gives. Whether its
 * found_by gave the task its need (`added`) is the call's to say, `foundNeeds`.
 * @param {string} id @param {Record<string, any>} input @param {Partial<Task>} base @param {readonly string[]} known
 * @param {FoundOf} foundOf @param {Graph} graph
 * @returns {{ found: TaskFound | null } | { error: string }}
 */
function readFound(id, input, base, known, foundOf, graph) {
  const v = foundByOf(known.includes("found_by") ? input.found_by : undefined);
  if (!v) return { found: base.foundBy ?? null };
  if ("off" in v) return { found: null };
  if ("error" in v) return { error: `${id}: ${v.error}` };
  const { agent } = v;
  if (base.foundBy && base.foundBy.agent === agent) return { found: base.foundBy };
  const kept = graph.tasks.find((t) => t.foundBy?.agent === agent)?.foundBy;
  if (kept) return { found: { agent: kept.agent, name: kept.name, task: kept.task } };
  const r = foundOf(agent);
  if ("error" in r) return { error: `${id}: ${r.error}` };
  const node = graph.tasks.find((t) => t.id === r.task);
  if (!node || (r.graph !== null && r.graph !== graph.startedAt))
    return { error: `${id}: ${r.name} ${r.agent} was sent from task ${r.task}, which is gone from the graph — add the task without found_by, and say in it what was found` };
  return { found: { agent: r.agent, name: r.name, task: node.id } };
}

/** What found a task, as every reading of the graph says it (11-02): "found by Hunter's hunt on t1". @param {TaskFound} f */
const foundSaid = (f) => `found by ${f.name}'s hunt on ${f.task}`;

/**
 * A task's needs once a tasks call gave what found it (11-02), and what found it with whether its found_by gave it that
 * need (`added`): it needs the task its hunt was fired from, added where its needs lack it. A hunt that takes the place
 * of another's takes the place of the need that one added — never of one the planner named itself — where the task's
 * needs stand as they were (`how`: "kept"); needs the call names stand as named ("named"), a running task's too (g1).
 * `was`: what found it before the call, null for an add.
 * @param {readonly string[]} needs  its needs as the call's other fields leave them
 * @param {TaskFound | null} was @param {TaskFound | null} found  what found it once the call is in
 * @param {"named" | "kept"} how
 * @returns {{ needs: string[], found: TaskFound | null }}
 */
function foundNeeds(needs, was, found, how) {
  if (!found) return { needs: [...needs], found: null };
  const same = !!was && was.task === found.task;
  const kept = how === "kept" && was?.added && !same ? needs.filter((n) => n !== was.task) : [...needs];
  if (!kept.includes(found.task)) return { needs: [...kept, found.task], found: { ...found, added: true } };
  return { needs: kept, found: { ...found, added: how !== "named" && same && was?.added === true } };
}

/**
 * What an add or a change says of the tasks it gave a hunt's finding (11-02), and the need a hunt in another's place
 * took the place of (`before`: the tasks as the graph held them). "" where none.
 * @param {readonly Task[]} tasks @param {readonly Task[]} [before]
 */
function foundWords(tasks, before = []) {
  return tasks
    .filter((t) => t.foundBy)
    .map((t) => {
      const f = /** @type {TaskFound} */ (t.foundBy);
      const was = before.find((o) => o.id === t.id);
      const left = was?.foundBy && was.needs.includes(was.foundBy.task) && !t.needs.includes(was.foundBy.task) ? ` in place of ${was.foundBy.task}` : "";
      return ` ${t.id} takes up what ${f.name} ${f.agent} found on ${f.task}: it needs ${f.task}${left}, and the Plan marks it as that hunt's finding.`;
    })
    .join("");
}

/** Whether a path a task names leaves the project: absolute, or climbing out. @param {string} p */
const outside = (p) => /^([\\/~]|[a-z]:)/i.test(p) || p.replace(/\\/g, "/").split("/").includes("..");

/**
 * A task's fields from its input over `base` (the task a change edits; `{}` for an add): a field the input gives
 * replaces base's, and the whole is checked — every problem, each in words naming the task (§8 item 1 of
 * HarnessV3-FailurePoints: a lead resent a long add once a problem, three times). A task a sub-agent does needs a brief:
 * its goal, its steps and its acceptance check, and a writing one the files it writes (G2-2). Who does it is said in
 * the words of whoever plans now (`crew`): the agent's, itself by default, or a lead's, always a member of its team
 * (G3-1); a task keeps the words it was given, whoever plans it later (G3-2). Only a change that is kept is reviewed,
 * and only where a member of the team reviews. Only the fields its
 * planner may give (`known`) are read: another key is no field — unknownField says so — and brings no rule of its own.
 * A check (V2-1) is one to five commands, for a task whose change is kept — the planner's own, or a worker's that
 * changes files; each command the call gives is vetted (`vet`: the session's rules and a brief's rule, TG2-D44).
 * @param {string} id @param {Record<string, any>} input @param {Partial<Task>} base @param {Crew} crew
 * @param {readonly string[]} known @param {Vet} vet
 * @returns {Pick<Task, "name" | "needs" | "writes" | "acceptance" | "check" | "by" | "goal" | "steps" | "review"> | string[]}
 */
function readFields(id, input, base, crew, known, vet) {
  /** The input's value for a field its planner may give. @param {string} key @returns {any} */
  const given = (key) => (known.includes(key) ? input[key] : undefined);
  /** @param {string} key @returns {any} */
  const pick = (key) => (given(key) !== undefined ? given(key) : /** @type {Record<string, any>} */ (base)[key]);
  const words = [...(led(crew) ? crew.map((m) => m.tag) : TASK_BY), COMMAND];
  // A command task is no worker's (V2-3): read apart, its own fields alone.
  if (known.includes("by") && pick("by") === COMMAND) return commandFields(id, given, pick, vet);
  /** @type {string[]} */
  const problems = [];
  /** The fields given as the wrong kind of value: said once, and not asked for again. @type {Set<string>} */
  const bad = new Set();
  /** @param {string} key @param {string} words */
  const wrong = (key, words) => {
    problems.push(`${id}: ${words}`);
    bad.add(key);
  };
  const name = text(pick("name"));
  if (!name) problems.push(`${id}: name is required: a few words naming the task`);
  /** @type {Record<string, string[]>} */
  const lists = { needs: [], writes: [] };
  for (const key of ["needs", "writes"]) {
    const v = pick(key);
    if (v === undefined || v === null) continue;
    if (!Array.isArray(v) || v.some((x) => !text(x))) {
      wrong(key, key === "needs" ? "needs is a list of task ids" : "writes is a list of files or globs");
      continue;
    }
    const items = [...new Set(v.map((x) => (key === "needs" ? text(x).toLowerCase() : text(x))))];
    const away = key === "writes" ? items.filter(outside) : [];
    if (away.length) {
      wrong(key, `writes names files inside the project, relative to its folder — ${away.join(", ")} ${away.length === 1 ? "is" : "are"} not`);
      continue;
    }
    lists[key] = items;
  }
  const acceptance = pick("acceptance");
  if (acceptance !== undefined && acceptance !== null && typeof acceptance !== "string") wrong("acceptance", "acceptance is text: what shows the task done");
  const unknownBy = given("by") !== undefined && given("by") !== null && !words.includes(given("by"));
  // Command is no worker: said apart, after those who do a task (V2-3).
  const whoWords = `${words.filter((w) => w !== COMMAND).join(", ")} — or command, for a task Filament runs itself`;
  if (unknownBy) wrong("by", `by is who does the task — ${whoWords}`);
  /** @type {TaskBy | null} */
  const by = unknownBy ? null : (pick("by") ?? (led(crew) ? null : "you"));
  if (by === null && !unknownBy)
    wrong("by", `by is required: ${led(crew) && !isShippedRoster(crew) ? "the worker of your team that does the task, by its tag" : "the role of the worker that does the task"} — ${whoWords}`);
  // Run and items are a command task's alone (V2-3).
  if (COMMAND_FIELDS.slice(2).some((k) => meant(given(k)))) problems.push(`${id}: run and items are a command task's — give it by: command, or leave them out`);
  const writer = by !== null && writesAs(by, crew, base);
  const member = by !== null && led(crew) ? memberOf(crew, by) : null;
  const goal = pick("goal");
  if (goal !== undefined && goal !== null && typeof goal !== "string") wrong("goal", "goal is text: what must be true when the task is done");
  const steps = pick("steps");
  if (steps !== undefined && steps !== null && (!Array.isArray(steps) || steps.some((s) => !text(s)))) wrong("steps", "steps is a list of what to do, in order — one step per item");
  else if (Array.isArray(steps) && steps.length > MAX_STEPS) wrong("steps", `steps holds at most ${MAX_STEPS} — make them fewer and larger`);
  // A task given to a reader, or kept by the agent, leaves its review behind: it makes no change apart to read.
  const reviewer = led(crew) ? reviewerOf(crew) : null;
  const review = given("review") !== undefined ? given("review") : !!base.review && writer && (!led(crew) || !!reviewer);
  if (typeof review !== "boolean") wrong("review", "review is true or false: whether a reviewer reads its change before it merges");
  else if (review && led(crew) && !reviewer) wrong("review", "review needs a worker that reviews, and your team has none: leave review out");
  else if (review && by !== null && !writer) {
    const ws = led(crew) ? crew.filter(editsFiles).map((m) => `${aOrAn(m.tag)}'s`) : [];
    wrong("review", `review is ${ws.length ? ws.join(" or ") : "for a task that changes files"}: ${reviewer ? aOrAn(reviewer.tag) : "a reviewer"} reads the change it makes before it merges`);
  }
  const check = pick("check");
  /** @type {string[]} */
  let commands = [];
  if (check !== undefined && check !== null) {
    if (!Array.isArray(check) || check.some((c) => typeof c !== "string" || !c.trim())) wrong("check", "check is a list of commands, one to five — the ones that prove the task done");
    else if (check.length > CHECK_COMMANDS) wrong("check", `check holds at most ${CHECK_COMMANDS} commands — the ones that prove the task done`);
    else commands = check.map((c) => c.trim());
  }
  const longCommand = commands.map((c) => over(`${id}: a command of check`, c, LIMIT.command)).find(Boolean);
  if (longCommand) {
    problems.push(longCommand);
    bad.add("check");
  }
  if (commands.length && by !== null && by !== "you" && !writer)
    wrong("check", `check is for a task whose change is kept — your own, or one that changes files — and ${aOrAn(by)} ${member ? doesWords(member) : "changes nothing"}: its report is what is read`);
  // Only a check the call gives is vetted: one it keeps was, when it came.
  const vetted = !bad.has("check") && commands.length && given("check") !== undefined ? vet(commands) : null;
  if (vetted) wrong("check", vetted);
  const fields = {
    name,
    needs: lists.needs,
    writes: lists.writes,
    acceptance: bad.has("acceptance") ? "" : text(acceptance),
    check: bad.has("check") ? [] : commands,
    by: /** @type {TaskBy} */ (by),
    goal: bad.has("goal") ? "" : text(goal),
    steps: !bad.has("steps") && Array.isArray(steps) ? steps.map((s) => text(s)) : [],
    review: review === true,
  };
  for (const long of [over(`${id}: name`, fields.name, LIMIT.name), over(`${id}: goal`, fields.goal, LIMIT.taskGoal), ...fields.steps.map((s, k) => over(`${id}: step ${k + 1}`, s, LIMIT.step)), over(`${id}: acceptance`, fields.acceptance, LIMIT.acceptance)])
    if (long) problems.push(long);
  if (by !== null && by !== "you") {
    if (!fields.goal && !bad.has("goal")) problems.push(`${id}: ${whose(by)} needs goal: what must be true when it is done`);
    if (!fields.steps.length && !bad.has("steps")) problems.push(`${id}: ${whose(by)} needs steps: what to do, in order`);
    if (!fields.acceptance && !bad.has("acceptance")) problems.push(`${id}: ${whose(by)} needs acceptance: the check that proves it done`);
    if (writer && !fields.writes.length && !bad.has("writes")) problems.push(`${id}: ${whose(by)} needs writes: the files it changes, so tasks that run at once stay apart`);
    if (!writer && fields.writes.length) {
      const other = led(crew) ? builderOf(crew) : null;
      const to = !led(crew) ? "give the task to a sub-agent to change files" : other ? `give the task to ${aOrAn(other.tag)} to change files` : "no worker of your team changes files";
      problems.push(`${id}: ${aOrAn(by)} ${member ? doesWords(member) : "changes nothing"}, so it names no writes — ${to}`);
    }
  }
  return problems.length ? problems : fields;
}

/** Whether a field's value says something: given, and not empty. @param {unknown} v */
const meant = (v) => v !== undefined && v !== null && v !== "" && v !== false && !(Array.isArray(v) && !v.length);

/**
 * A command task's fields (HarnessV3-TaskGraph-v2 V2-3): its name, its needs, its run — one to five commands, each one
 * line — and its items — up to 500 plain words, each once (TG2-D66) — `{item}` named in run exactly when items are
 * given. A worker's field given is refused; one a change's base carried goes. Each command is vetted with each item
 * filled in and a leading `! ` taken off (`vet`, field "run"): the commands Filament will run, as it runs them.
 * @param {string} id @param {(key: string) => any} given @param {(key: string) => any} pick @param {Vet} vet
 * @returns {Pick<Task, "name" | "needs" | "writes" | "acceptance" | "check" | "by" | "goal" | "steps" | "review" | "run" | "items"> | string[]}
 */
function commandFields(id, given, pick, vet) {
  /** @type {string[]} */
  const problems = [];
  const name = text(pick("name"));
  if (!name) problems.push(`${id}: name is required: a few words naming the task`);
  const longName = over(`${id}: name`, name, LIMIT.name);
  if (longName) problems.push(longName);
  /** @type {string[]} */
  let needs = [];
  const n = pick("needs");
  if (n !== undefined && n !== null) {
    if (!Array.isArray(n) || n.some((x) => !text(x))) problems.push(`${id}: needs is a list of task ids`);
    else needs = [...new Set(n.map((x) => text(x).toLowerCase()))];
  }
  const worker = WORKER_FIELDS.filter((k) => meant(given(k)));
  if (worker.length) problems.push(`${id}: a command task takes name, needs, run and items — ${listed(worker)} ${worker.length === 1 ? "is a worker's: leave it out" : "are a worker's: leave them out"}`);
  const r = pick("run");
  /** @type {string[]} */
  let run = [];
  if (r === undefined || r === null) problems.push(`${id}: a command task needs run: one to five commands, in order — Filament runs them itself, once for each item`);
  else if (!Array.isArray(r) || !r.length || r.some((c) => typeof c !== "string" || !c.trim())) problems.push(`${id}: run is a list of commands, one to five — Filament runs them in order`);
  else if (r.length > CHECK_COMMANDS) problems.push(`${id}: run holds at most ${CHECK_COMMANDS} commands — Filament runs them in order, once for each item`);
  else if (r.some((c) => /[\r\n]/.test(c.trim()))) problems.push(`${id}: a command of run is one line: give each command its own entry`);
  else run = r.map((c) => c.trim());
  const longCommand = run.map((c) => over(`${id}: a command of run`, c, LIMIT.command)).find(Boolean);
  if (longCommand) problems.push(longCommand);
  const it = pick("items");
  /** @type {string[]} */
  let items = [];
  if (it !== undefined && it !== null) {
    if (!Array.isArray(it) || it.some((x) => typeof x !== "string")) problems.push(`${id}: items is a list of plain words, one run each`);
    else if (it.length > MAX_ITEMS) problems.push(`${id}: items holds at most ${MAX_ITEMS} — one run each`);
    else {
      const bad = it.map((x) => x.trim()).find((x) => !ITEM.test(x));
      /** @type {Map<string, string>} */
      const seen = new Map();
      const twice = it.map((x) => x.trim()).find((x) => (seen.has(x.toLowerCase()) ? true : (seen.set(x.toLowerCase(), x), false)));
      if (bad !== undefined) problems.push(`${id}: an item is one plain word — letters, digits and . _ - / : @ + = , — so it fills {item} the same in any shell: "${cut(bad, 60)}" is not`);
      else if (twice !== undefined) problems.push(`${id}: item ${seen.get(twice.toLowerCase())} is given twice`);
      else items = it.map((x) => x.trim());
    }
  }
  const named = run.some((c) => c.includes("{item}"));
  if (run.length && !items.length && named && (it === undefined || it === null || (Array.isArray(it) && !it.length))) problems.push(`${id}: run names {item}, and the task has no items: give items, or leave {item} out`);
  if (run.length && items.length && !named) problems.push(`${id}: items fill {item} in run, and no command of run names it: name {item} where each item goes, or leave items out`);
  if (!problems.length) {
    const vetted = vet([...new Set(commandRuns({ run, items }).flatMap((x) => x.steps.map((st) => st.command)))], "run");
    if (vetted) problems.push(`${id}: ${vetted}`);
  }
  return problems.length ? problems : { name, needs, writes: [], acceptance: "", check: [], by: COMMAND, goal: "", steps: [], review: false, run, items };
}

/** A command of a command task's run, as Filament runs it (TG2-D67): a leading `! ` taken off, said as `invert`. @param {string} c @returns {CommandStep} */
const stepOf = (c) => {
  const m = /^!\s+(\S[\s\S]*)$/.exec(c);
  return m ? { command: m[1], invert: true } : { command: c, invert: false };
};

/**
 * A command task's runs (V2-3), in item order: each item with its run's commands, `{item}` filled in — one run with no
 * item where it has none.
 * @param {{ run?: readonly string[], items?: readonly string[] }} t @returns {{ item: string | null, steps: CommandStep[] }[]}
 */
export function commandRuns(t) {
  const run = t.run || [];
  const items = t.items || [];
  if (!items.length) return [{ item: null, steps: run.map(stepOf) }];
  return items.map((item) => ({ item, steps: run.map((c) => stepOf(c.replaceAll("{item}", item))) }));
}

/**
 * Whether one command of a run passed (TG2-D67): exit 0 — or, inverted, an exit that is not 0. One with no exit (it
 * could not start, or a stop ended it) never passes.
 * @param {number | null} exit @param {boolean} invert
 */
export const commandPassed = (exit, invert) => exit !== null && (invert ? exit !== 0 : exit === 0);

/** Each task the graph holds, with every task it needs — directly or through others. @param {Graph} graph */
function upstream(graph) {
  const byId = indexOf(graph);
  // A sub-task comes after its step's needs, and a step after its sub-tasks (11-06): a step and its own are linked.
  const edges = edgesOf(graph);
  /** @type {Map<string, Set<string>>} */
  const up = new Map();
  /** @param {Task} t @returns {Set<string>} */
  const of = (t) => {
    const known = up.get(t.id);
    if (known) return known;
    /** @type {Set<string>} */
    const all = new Set();
    up.set(t.id, all);
    for (const n of edges.get(t.id) || []) {
      all.add(n);
      for (const x of of(/** @type {Task} */ (byId.get(n)))) all.add(x);
    }
    return all;
  };
  for (const t of graph.tasks) of(t);
  return up;
}
/** Whether one of two tasks needs the other, so they never run at the same time. @param {Map<string, Set<string>>} up @param {string} a @param {string} b */
const linked = (up, a, b) => !!(up.get(a)?.has(b) || up.get(b)?.has(a));

const GLOB = /[*?{]/;
/** A path or glob as compared: forward slashes, no leading ./, lower case, a folder (a trailing /) as everything in it. @param {string} p */
const norm = (p) => {
  const s = p.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/{2,}/g, "/").toLowerCase();
  return s.endsWith("/") ? `${s}**` : s;
};
/** A glob's literal head and tail: what every path it names starts and ends with. @param {string} g */
const endsOf = (g) => {
  let last = g.length - 1;
  while (last >= 0 && !/[*?{}]/.test(g[last])) last--;
  return [g.slice(0, g.search(GLOB)), g.slice(last + 1)];
};
/** The most spellings `under` reads a glob's braces into; past it, the glob may name anything. */
const SPELLINGS = 64;
/**
 * A glob's braces read out, as `globToRegExp` reads them (the first "}" closes): each spelling a brace-free glob, or
 * null past `SPELLINGS`. @param {string} g @returns {string[] | null}
 */
const spellings = (g) => {
  const open = g.indexOf("{");
  const close = open < 0 ? -1 : g.indexOf("}", open);
  if (close < 0) return [g];
  const rest = spellings(g.slice(close + 1));
  const all = rest && g.slice(open + 1, close).split(",").flatMap((alt) => rest.map((r) => g.slice(0, open) + alt + r));
  return all && all.length <= SPELLINGS ? all : null;
};
/**
 * Whether a glob names something under a folder: its segments take the folder's one for one — a "**" among them none
 * or more — and some are left for what lies beneath. @param {string} glob @param {string} folder
 */
const under = (glob, folder) => {
  const all = spellings(glob);
  return !all || all.some((g) => {
    const segs = g.split("/");
    /** the glob's segments that may take the folder's next one @type {Set<number>} */
    let at = new Set([0]);
    for (const seg of folder.split("/")) {
      /** @type {Set<number>} */
      const next = new Set();
      for (let i of at) {
        for (; i < segs.length && segs[i].includes("**"); i++) next.add(i);
        if (i < segs.length && globToRegExp(segs[i]).test(seg)) next.add(i + 1);
      }
      at = next;
    }
    return [...at].some((i) => i < segs.length);
  });
};
/**
 * Whether a write names a path: the path, or a folder it lies in, is the write or one the write's glob matches — what a
 * write names counting as everything under it. @param {string} w @param {string} p  both as `norm` gives them
 */
const names = (w, p) => {
  if (!GLOB.test(w)) return p === w || p.startsWith(`${w}/`);
  const re = globToRegExp(w);
  return p.split("/").some((_, i, segs) => re.test(segs.slice(0, i + 1).join("/")));
};
/**
 * Whether one of a task's writes names a path, each as written: what the report of a task's end checks its changed
 * files with, and what a sign on a running worker's trail reads (core/signs.js). @param {string} w @param {string} p
 */
export const writeNames = (w, p) => names(norm(w), norm(p));
/**
 * Whether two paths or globs a task names may name one file: "same" for one path, true when they may, false when they
 * cannot. A path, and each name a glob matches, counts as everything under it too, so a folder named without its slash
 * still clashes with a glob that names something in it (the bug report's L8); two globs are judged by their literal
 * heads and tails — a clash when both nest, which never misses one.
 * @param {string} p @param {string} q @returns {"same" | boolean}
 */
function overlap(p, q) {
  const a = norm(p);
  const b = norm(q);
  const globA = GLOB.test(a);
  const globB = GLOB.test(b);
  if (!globA && !globB) return a === b ? "same" : names(a, b) || names(b, a);
  if (!globA || !globB) {
    const [path, glob] = globA ? [b, a] : [a, b];
    return names(glob, path) || under(glob, path);
  }
  const [headA, tailA] = endsOf(a);
  const [headB, tailB] = endsOf(b);
  return (headA.startsWith(headB) || headB.startsWith(headA)) && (tailA.endsWith(tailB) || tailB.endsWith(tailA));
}

/**
 * The needs of the tasks just added or changed, checked against the graph they land in: every problem. `given`: the
 * ids the call gave whose tasks it could not take, which are still no unknown need.
 * @param {Graph} graph @param {string[]} ids @param {ReadonlySet<string>} [given]
 */
function linkProblems(graph, ids, given = new Set()) {
  const byId = indexOf(graph);
  /** @type {string[]} */
  const problems = [];
  for (const id of ids) {
    const t = /** @type {Task} */ (byId.get(id));
    for (const n of t.needs) {
      const need = byId.get(n);
      if (n === id) problems.push(`${id} needs itself`);
      else if (!need && !given.has(n)) problems.push(`${id} needs ${n}, which is no task in the graph`);
      else if (need?.state === "dropped") problems.push(`${id} needs ${n}, which was dropped (${need.why}) — leave it out, or add a task in its place`);
    }
  }
  return problems;
}

/** A loop the needs go round, as its tasks in order, or null. @param {Graph} graph */
function loopOf(graph) {
  const byId = indexOf(graph);
  const edges = edgesOf(graph);
  /** @type {Map<string, 1 | 2>} */
  const seen = new Map();
  /** @type {string[]} */
  const path = [];
  /** @param {Task} t @returns {string[] | null} */
  const visit = (t) => {
    seen.set(t.id, 1);
    path.push(t.id);
    for (const n of edges.get(t.id) || []) {
      if (seen.get(n) === 1) return path.slice(path.indexOf(n));
      const found = seen.has(n) ? null : visit(/** @type {Task} */ (byId.get(n)));
      if (found) return found;
    }
    path.pop();
    seen.set(t.id, 2);
    return null;
  };
  for (const t of graph.tasks) {
    const found = seen.has(t.id) ? null : visit(t);
    if (found) return found;
  }
  return null;
}

/**
 * @typedef {object} Sharing  where a session's tasks work (g1): `shared`, its writing sub-agents share its folder
 *   (the chat's workspace is its folder: subagents.workspace, else subagents.worktree off), so none works in a copy of
 *   its own; missing, the graph's own word (`sharingOf`)
 * @property {boolean} [shared]
 */
/**
 * Whether a task's work is done in a copy of its own (g1, the owner's of 11-09): a writing worker's — the agent's
 * sub-agent, a team's member that changes files — in its own worktree, unless the session's sub-agents share its folder;
 * one of the developer's side run in its copy, never in their folder; and a task of the planner's own a coding agent's
 * helper took in its own copy. Anything else is done in the folder. A worker launched already says where (`workspace`,
 * 11-09): that, in place of the guess.
 * @param {Task} t @param {Sharing} o
 */
const apart = (t, o) => {
  if (t.by === "you") return t.helper?.copy === true;
  if (!changes(t)) return false;
  if (t.workspace) return t.workspace !== "folder";
  return t.side ? t.side.folder === "copy" : !o.shared;
};
/**
 * The session's sharing as a reader of its graph takes it (the review of g1): the live word where the caller has one — an
 * add's, a change's, a show's, a side run's — else the word Filament kept on the graph (`shared`), so the answers, a
 * show, the Plan and a compaction's text all say where tasks meet by the one rule.
 * @param {Graph} graph @param {Sharing} o @returns {Sharing}
 */
const sharingOf = (graph, o) => ({ shared: o.shared ?? graph.shared === true });
/**
 * How two open tasks that could run at once meet over the files they both write (g1, the owner's of 11-09: "if all
 * builders are running in their own worktree then at the end it would simply be resolving merge conflicts … if there
 * is conflicts simply resolve and merge"): "merge" where one of them works in a copy of its own — whichever lands second
 * merges three-way at its apply; "turns" where both are the planner's own, which it does one at a time; "folder" where
 * another hand works in the one folder beside the other — a coding agent's helper in it, the developer's side run in it,
 * or the session's sub-agents where they share it — and may write over what it leaves. Writes are a forecast: nothing
 * is refused for them in the graph. The one place it is decided: `files`, what they share, is given for a rule that
 * weighs them.
 * @param {Task} a @param {Task} b @param {readonly string[]} files @param {Sharing} o @returns {"merge" | "turns" | "folder"}
 */
const meetAs = (a, b, files, o) => (apart(a, o) || apart(b, o) ? "merge" : [a, b].every((t) => t.by === "you" && !t.helper) ? "turns" : "folder");
/**
 * Of two writes that may name one file, what they share as written (g1): the one that lies within the other — a path a
 * glob or a folder holds, a glob under a folder — or, of two globs, both. @param {string} p @param {string} q @returns {string[]}
 */
const narrower = (p, q) => {
  const a = norm(p);
  const b = norm(q);
  if (GLOB.test(a) && GLOB.test(b)) return [p, q];
  if (!GLOB.test(a) && !GLOB.test(b)) return [names(a, b) ? q : p];
  const [path, glob, pathAs, globAs] = GLOB.test(a) ? [b, a, q, p] : [a, b, p, q];
  return [names(glob, path) ? pathAs : globAs];
};
/**
 * What two tasks' writes have in common (g1): each file both name, as written (`narrower`), and whether only maybe — two
 * globs judged by their ends. Null where none. @param {Task} a @param {Task} b @returns {{ files: string[], maybe: boolean } | null}
 */
function sharedOf(a, b) {
  /** @type {string[]} */
  const files = [];
  let maybe = false;
  for (const p of a.writes)
    for (const q of b.writes) {
      const o = overlap(p, q);
      if (!o) continue;
      const named = o === "same" ? [p] : narrower(p, q);
      if (named.length > 1) maybe = true;
      for (const f of named) if (!files.includes(f)) files.push(f);
    }
  return files.length ? { files, maybe } : null;
}
/**
 * @typedef {{ a: Task, b: Task, files: string[], maybe: boolean, as: "merge" | "turns" | "folder" }} Meeting
 *   two open tasks that could run at once and write files in common (g1): what they share, and how they meet (`meetAs`)
 */
/**
 * Every two open tasks that could run at once and write files in common (g1), in the graph's order — a step's writes are
 * what its sub-tasks write (11-06): they claim the files, the step does no work of its own — each with how they meet;
 * none of the planner's own two, which it does one at a time. The merge points the answers, a show and the page say all
 * read this, and nothing else.
 * @param {Graph} graph @param {Sharing} o @returns {Meeting[]}
 */
function meetings(graph, o) {
  const up = upstream(graph);
  const steps = kidsOf(graph);
  const writers = graph.tasks.filter((t) => isOpen(t) && t.writes.length && !steps.has(t.id));
  const sharing = sharingOf(graph, o);
  /** @type {Meeting[]} */
  const out = [];
  for (let i = 0; i < writers.length; i++)
    for (let j = i + 1; j < writers.length; j++) {
      const [a, b] = [writers[i], writers[j]];
      if (linked(up, a.id, b.id)) continue;
      const s = sharedOf(a, b);
      if (s) out.push({ a, b, ...s, as: meetAs(a, b, s.files, sharing) });
    }
  return out.filter((m) => m.as !== "turns");
}
/**
 * Each task's merge points (g1): the tasks that could run beside it writing files it writes, with those files — and
 * `folder` where the two work in the one folder (`meetAs`). Read from the graph as it stands, never kept on a task.
 * @param {Graph} graph @param {Sharing} [o] @returns {Map<string, { task: string, files: string[], folder?: true }[]>}
 */
function mergePoints(graph, o = {}) {
  /** @type {Map<string, { task: string, files: string[], folder?: true }[]>} */
  const out = new Map();
  /** @param {string} id @param {string} task @param {Meeting} m */
  const put = (id, task, m) => out.set(id, [...(out.get(id) || []), { task, files: [...m.files], ...(m.as === "folder" ? { folder: /** @type {const} */ (true) } : {}) }]);
  for (const m of meetings(graph, o)) {
    put(m.a.id, m.b.id, m);
    put(m.b.id, m.a.id, m);
  }
  return out;
}
/** Files in a line, the first few, the rest counted. @param {readonly string[]} files */
const fewFiles = (files) => (files.length > 5 ? `${files.slice(0, 5).join(", ")} and ${files.length - 5} more` : listed(files));
/**
 * The most rows a list in an answer's tail names, the rest counted with where they all are (the nudge map of 11-10: an
 * answer's own words lead it, and a list after them stays short): what else is open beside the graph, the groups of
 * tasks that meet over files.
 */
export const TAIL_MOST = 3;
/** The most groups of tasks meeting over files an answer names (FabeleHelper's of 11-10), the rest counted; a show names them all. */
const MEETS_MOST = TAIL_MOST;
/**
 * Meetings as they are said (FabeleHelper's of 11-10: every two tasks a line was quadratic): tasks that each meet every
 * other over one file, together — "t1, t2 and t3 all write src/a.js" —, the two of a meeting else; and the files the
 * same tasks meet over, together. Each with how they meet, in the order the meetings come.
 * @param {readonly Meeting[]} ms @returns {{ ids: string[], files: string[], maybe: boolean, as: "merge" | "turns" | "folder" }[]}
 */
function meetGroups(ms) {
  /** @type {Map<string, Meeting[]>} */
  const byFile = new Map();
  for (const m of ms) for (const f of m.files) byFile.set(`${m.as}\0${m.maybe}\0${f}`, [...(byFile.get(`${m.as}\0${m.maybe}\0${f}`) || []), m]);
  /** @type {Map<string, { ids: string[], files: string[], maybe: boolean, as: "merge" | "turns" | "folder" }>} */
  const units = new Map();
  for (const [key, pairs] of byFile) {
    const file = key.split("\0")[2];
    const ids = [...new Set(pairs.flatMap((m) => [m.a.id, m.b.id]))];
    const each = pairs.length === (ids.length * (ids.length - 1)) / 2 ? [ids] : pairs.map((m) => [m.a.id, m.b.id]);
    for (const set of each) {
      const k = `${pairs[0].as}\0${pairs[0].maybe}\0${set.join(",")}`;
      const u = units.get(k) || { ids: set, files: [], maybe: pairs[0].maybe, as: pairs[0].as };
      if (!u.files.includes(file)) u.files.push(file);
      units.set(k, u);
    }
  }
  return [...units.values()];
}
/**
 * Where tasks meet over their files, in a line (g1): the merge points — whichever lands second merges three-way at its
 * apply — and those that write in the one folder at once, grouped (`meetGroups`), `most` groups at most — the rest
 * counted. "" for none. @param {readonly Meeting[]} ms @param {Crew} crew @param {{ most?: number }} [o]
 */
function meetsWords(ms, crew, { most = Infinity } = {}) {
  const groups = meetGroups(ms);
  const merge = groups.filter((g) => g.as === "merge");
  const folder = groups.filter((g) => g.as === "folder");
  const shownMerge = merge.slice(0, most);
  const shownFolder = folder.slice(0, Math.max(0, most - shownMerge.length));
  const rest = groups.length - shownMerge.length - shownFolder.length;
  /** @param {{ ids: string[], files: string[], maybe: boolean }} g */
  const said = (g) => `${listedIds(g.ids)} ${g.maybe ? "may " : ""}${g.ids.length === 2 ? "both" : "all"} write ${fewFiles(g.files)}`;
  return [
    shownMerge.length ? `${shownMerge.map(said).join("; ")}: whichever ${shownMerge.length === 1 && shownMerge[0].ids.length === 2 ? "" : "of each two "}lands second merges three-way at its apply.` : "",
    shownFolder.length ? `${shownFolder.map(said).join("; ")}, in ${folderOf(crew)} at once: one may write over the other's edits — have one need the other, or work one in its own copy.` : "",
    rest > 0 ? `And ${rest} more ${rest === 1 ? "group" : "groups"} of tasks that meet over files: tasks show names ${rest === 1 ? "it" : "them"}.` : "",
  ].filter(Boolean).join(" ");
}
/** Task ids in a line: "a and b", "a, b and c". @param {readonly string[]} ids */
const listedIds = (ids) => (ids.length < 2 ? ids.join("") : `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`);
/** The key `told`'s mark keeps of a meeting an answer said. @param {Meeting} m */
const meetKey = (m) => `${m.a.id}+${m.b.id}${m.as === "folder" ? "!" : ""}`;
/**
 * What an add's or a change's answer says of where tasks meet (g1): only where two tasks meet that no answer said meet
 * before — as the side-by-side set is said (`withSide`; FabeleHelper's of 11-10: the whole set again at each change was
 * noise) —, then every meeting over the files those touch, `MEETS_MOST` groups at most; every meeting said kept in
 * `told`'s mark while its two tasks meet: one that meets no more goes from it — a mark that kept every pair ever said
 * only grew, and two tasks that met again were not said to (the review of 67038d835). Its line, with the newline
 * before it, or "".
 * @param {Graph} next  the graph the call made, its mark set in place @param {Crew} crew @param {Sharing} o
 */
function meetsOnce(next, crew, o) {
  const ms = meetings(next, o);
  const told = next.told || [];
  const was = told.find((m) => m.startsWith("meets:"));
  const said = new Set(was ? was.slice(6).split(",").filter(Boolean) : []);
  const fresh = ms.filter((m) => !said.has(meetKey(m)));
  const still = new Set(ms.map(meetKey));
  const keys = [...[...said].filter((k) => still.has(k)), ...fresh.map(meetKey)];
  const marks = [...told.filter((m) => !m.startsWith("meets:")), ...(keys.length ? [`meets:${keys.join(",")}`] : [])];
  if (marks.length) next.told = marks;
  else delete next.told;
  if (!fresh.length) return "";
  const files = new Set(fresh.flatMap((m) => m.files));
  // The new ones first, so a cap never leaves them out (the review of d81fdac5e).
  const old = ms.filter((m) => !fresh.includes(m) && m.files.some((f) => files.has(f)));
  return `\n${meetsWords([...fresh, ...old], crew, { most: MEETS_MOST })}`;
}

/**
 * What makes a graph one Filament cannot keep in order: a loop. Writes are a forecast (g1): two tasks that could run at
 * once may write one file, and meet where `meetings` says. None when it can.
 * @param {Graph} graph @returns {string[]}
 */
function graphProblems(graph) {
  const loop = loopOf(graph);
  if (loop) {
    const byId = indexOf(graph);
    /** A link of the loop in words: a need, a step's need its sub-task waits on, or a step's sub-task (11-06). @param {string} a @param {string} b */
    const link = (a, b) => {
      const t = byId.get(a);
      if (byId.get(b)?.under === a) return `${a} ends with its sub-task ${b}`;
      if (t?.under && !t.needs.includes(b)) return `${a} waits on ${b} as its step ${t.under} needs it`;
      return `${a} needs ${b}`;
    };
    const links = loop.map((id, i) => link(id, loop[(i + 1) % loop.length]));
    return [`the needs go round in a loop: ${links.slice(0, -1).join(", ")}, and ${links[links.length - 1]} — one of these needs must go`];
  }
  return [];
}

/** The tasks in the order they may start: by depth (a task after everything it needs), then as the agent added them. @param {Graph} graph */
function order(graph) {
  const depths = depthsOf(graph);
  return graph.tasks
    .map((t, i) => ({ t, i, d: /** @type {number} */ (depths.get(t.id)) }))
    .sort((x, y) => x.d - y.d || x.i - y.i)
    .map((x) => x.t);
}

/** Each task's depth: 0 with no needs, else one past its deepest need — its layer in the drawing. @param {Graph} graph */
function depthsOf(graph) {
  const byId = indexOf(graph);
  const edges = edgesOf(graph);
  /** @type {Map<string, number>} */
  const depths = new Map();
  /** @param {Task} t @returns {number} */
  const depth = (t) => {
    const known = depths.get(t.id);
    if (known !== undefined) return known;
    let d = 0;
    for (const n of edges.get(t.id) || []) d = Math.max(d, depth(/** @type {Task} */ (byId.get(n))) + 1);
    depths.set(t.id, d);
    return d;
  };
  for (const t of graph.tasks) depth(t);
  return depths;
}

/**
 * Whether a need lets a task start: it is done — or, for a task of the planner's own, it is being checked (V2-1): the
 * planner's own tasks share its folder already, while a worker branches from the folder and starts from checked work.
 * @param {Task} need @param {Task} t
 */
const needMet = (need, t) => need.state === "done" || (need.state === "checking" && t.by === "you");

/** The waiting tasks whose needs are all met — a sub-task's step's too — in the order they may start; but one the
 *  developer stopped, one proposed that the agent has not taken on, and a step, whose sub-tasks start in its place
 *  (11-06). @param {Graph} graph */
function ready(graph) {
  const byId = indexOf(graph);
  const steps = kidsOf(graph);
  return order(graph).filter((t) => t.state === "waiting" && !t.stopped && !t.proposed && !steps.has(t.id) && needsOf(t, byId).every((n) => needMet(/** @type {Task} */ (byId.get(n)), t)));
}

/** The waiting tasks that cannot start yet, each with the needs it waits on and how they stand — no step's (11-06). @param {Graph} graph */
function blocked(graph) {
  const byId = indexOf(graph);
  const steps = kidsOf(graph);
  return order(graph)
    .filter((t) => t.state === "waiting" && !steps.has(t.id))
    .map((t) => ({ id: t.id, on: needsOf(t, byId).map((n) => /** @type {Task} */ (byId.get(n))).filter((n) => !needMet(n, t)).map((n) => ({ id: n.id, state: yours(n) ? "ready to apply" : n.state })) }))
    .filter((b) => b.on.length);
}

/** The longest chain of tasks still to run, first to last: what bounds the time left. A tie goes to the first added. @param {Graph} graph */
function criticalPath(graph) {
  const edges = edgesOf(graph);
  /** @type {Map<string, string[]>} */
  const chains = new Map();
  /** @param {Task} t @returns {string[]} */
  const chain = (t) => {
    const known = chains.get(t.id);
    if (known) return known;
    const after = new Set(edges.get(t.id) || []);
    /** @type {string[]} */
    let longest = [];
    for (const u of graph.tasks) {
      if (!after.has(u.id) || !isOpen(u)) continue;
      const c = chain(u);
      if (c.length > longest.length) longest = c;
    }
    const own = [...longest, t.id];
    chains.set(t.id, own);
    return own;
  };
  /** @type {string[]} */
  let path = [];
  for (const t of graph.tasks) {
    if (!isOpen(t)) continue;
    const c = chain(t);
    if (c.length > path.length) path = c;
  }
  return path;
}

/** What the graph's sub-agents spent, every try counted. @param {Graph} graph */
const spentOf = (graph) => Math.round(graph.tasks.reduce((n, t) => n + t.spentUsd, 0) * 1e6) / 1e6;

/** How a proposed task stands (the forked steer of 11-04): the agent's to take on, or to drop. */
const PROPOSED_WORDS = "proposed from the person's message — start it, or change it, to take it on; drop it if it is not to be done";

/** How a task stands, in words: ready is a waiting task whose needs are done. @param {Task} t @param {Map<string, Task>} byId */
function standing(t, byId) {
  if (t.state === "waiting") {
    if (t.stopped) return stoppedWords(t.stopped);
    if (t.proposed) return PROPOSED_WORDS;
    // Held only by needs whose changes wait for their apply (the owner's of 11-02): said, so the planner knows what frees it.
    const open = needsOf(t, byId).filter((n) => !needMet(/** @type {Task} */ (byId.get(n)), t));
    const unapplied = open.filter((n) => byId.get(n)?.state === "merging" && byId.get(n)?.step === "yours");
    const due = !open.length ? "ready" : unapplied.length === open.length ? `waiting for the apply of ${unapplied.join(", ")}` : "waiting";
    // Sent back from its merge (11-09): said, its count with it.
    const redo = redoWords(t) ? `, ${redoWords(t)}` : "";
    return t.resume ? `${due} — ${t.resume} goes on with it${redo}` : `${due}${redo}`;
  }
  if (t.state === "checking") return `being checked: ${inOrder(checkOf(t))}`;
  if (t.state === "paused") return t.checkpoint ? `paused — ${checkpointWords(t.checkpoint)}` : "paused";
  if (t.state === "done") return `done${verdictMark(t.verdict ?? null)}: ${cut(squash(t.summary), 100)}`;
  if (t.state === "dropped") return `dropped: ${cut(t.why, 100)}`;
  if (t.state === "failed") return `failed: ${cut(t.why, 100)}`;
  if (goesBack(t)) return `the folder's check undid its merge: it goes back to ${t.agent} next`;
  if (yours(t)) return `ready: its change waits in ${t.agent}'s copy for its apply`;
  if (t.state === "merging") return "merging into the folder";
  if (t.state === "review") return reviewStanding(t);
  if (t.by === COMMAND) return t.progress ? `running: ${t.progress.ran} of ${plural(t.progress.of, "run")}, ${t.progress.passed} passed` : "running";
  if (t.by !== "you" && t.reviews.length) return `fixing its review (round ${t.reviews.length} of ${REVIEW_ROUNDS}) on ${t.agent}${slotWords(t)}`;
  if (redoing(t)) return `redoing its change on ${t.agent}, ${redoWords(t)}${slotWords(t)}`;
  return t.by === "you" ? "running" : `running on ${t.agent}${slotWords(t)}`;
}

/**
 * What a task whose worker or reader waits for a slot says of it (SUB-3), while that one has the task's step: ", which
 * waits for a slot (…) and starts by itself once one is free"; "" otherwise. @param {Task} t
 */
const slotWords = (t) => (t.slot && atWork(t) === t.slot.agent ? `, which waits for a slot (${t.slot.why}) and starts by itself once one is free` : "");

/**
 * How an open step stands (11-06): waiting, paused or under way, and how many of its sub-tasks are done.
 * @param {Task} t @param {readonly Task[]} ks
 */
function stepStanding(t, ks) {
  const word = t.state === "waiting" ? "waiting" : t.state === "paused" ? "paused" : "under way";
  return `${word} — ${ks.filter((k) => k.state === "done").length} of ${plural(ks.length, "sub-task")} done`;
}

/** How a task in review stands (G3-3): its round, and who has it. @param {Task} t */
function reviewStanding(t) {
  const n = t.reviews.length;
  if (t.step === "asked") return `its review asked for changes (round ${n} of ${REVIEW_ROUNDS}): they go to ${t.agent} next`;
  const round = `in review (round ${n + 1} of ${REVIEW_ROUNDS})`;
  if (t.step === "reading") return `${round} by ${t.reviewer}${slotWords(t)}`;
  return t.stopped ? `${round}, ${stoppedWords(t.stopped)}` : `${round}: its reviewer starts next`;
}

/**
 * What is kept behind each task of a graph, by its id — the graph's own under "" (HarnessV4_TaskNotes_Plan E33): the
 * store's count, which the runner reads; a task that keeps nothing is not there. `titles`: its notes' titles and its
 * files' names, which a graph's words after a compaction name (11-09).
 * @typedef {Record<string, { notes: number, files: number, bytes?: number, titles?: string[] }>} Kept
 */
/** What one task keeps, in words: "2 notes, 1 file". @param {{ notes: number, files: number }} c */
const keptWords = (c) => [c.notes ? plural(c.notes, "note") : "", c.files ? plural(c.files, "file") : ""].filter(Boolean).join(", ");
/**
 * What one task keeps, by title, as the graph's words after a compaction say it (11-09): the first five, the rest
 * counted — its counts where the store named none. @param {{ notes: number, files: number, titles?: string[] }} c
 */
const keptTitles = (c) => {
  if (!c.titles?.length) return keptWords(c);
  const named = c.titles.slice(0, 5).map((s) => `"${s}"`);
  return c.titles.length > 5 ? `${named.join(", ")} and ${c.titles.length - 5} more` : listed(named);
};

/**
 * A task in a line: its id and name, how it stands, what it keeps, who does it, the hunt that found it, its needs and
 * its files. Under a lead (`crew`), a task the agent kept for itself says it waits to be handed on (G3-2).
 * A step with sub-tasks (`kids`, 11-06) stands as they do. `back`: the words come back after a compaction (11-09), so
 * the line names what is kept behind it by title, and the turns it was added and changed in.
 * @param {Task} t @param {Map<string, Task>} byId @param {Crew} crew @param {Kept | null} [kept] @param {Map<string, Task[]> | null} [kids] @param {boolean} [back]
 */
function taskLine(t, byId, crew, kept = null, kids = null, back = false) {
  // A step with sub-tasks stands as they do (11-06): it does no work of its own.
  const ks = kids?.get(t.id);
  // Where its worker works, as its launch chose (11-09).
  const where = t.workspace && t.state === "running" && t.by !== "you" && t.by !== COMMAND ? `, ${workspaceWords(t.workspace, crew)}` : "";
  const parts = [`${t.id} "${t.name}" — ${ks && isOpen(t) ? stepStanding(t, ks) : standing(t, byId)}${where}${t.blocked && isOpen(t) ? ", blocked" : ""}`];
  // Reopened (11-09): the round it is on; and a merged change the folder holds uncommitted.
  if ((t.round ?? 1) > 1) parts.push(`round ${t.round}`);
  if (t.uncommitted?.length) parts.push("applied, not committed");
  // What is kept behind it (E33, TN-D6): marked, never read out — the planner reads one when it needs it.
  if (kept?.[t.id]) parts.push(`keeps ${back ? keptTitles(kept[t.id]) : keptWords(kept[t.id])}`);
  if (t.by !== "you") parts.push(`by ${t.by}${t.review ? ", with review" : ""}`);
  else if (led(crew) && isOpen(t) && !ks) parts.push(`the agent's own: give it ${handWord(crew)}, or drop it`);
  // An item of the agent's checklist (V2-5), and one it marked blocked.
  if (t.checklist) parts.push(`from ${led(crew) ? "the agent's" : "your"} checklist`);
  if (t.thread) parts.push(`finishes memory's thread ${t.thread.id}`);
  if (t.foundBy) parts.push(foundSaid(t.foundBy));
  if (t.needs.length) parts.push(`needs ${t.needs.join(", ")}`);
  if (t.writes.length) parts.push(`writes ${t.writes.slice(0, 4).join(", ")}${t.writes.length > 4 ? ` +${t.writes.length - 4}` : ""}`);
  // After a compaction (11-09): the turns that hold what was said of it, which the recall tool brings back.
  if (back && t.addedTurn != null) parts.push(`added turn ${t.addedTurn}${t.changedTurn != null && t.changedTurn !== t.addedTurn ? `, changed turn ${t.changedTurn}` : ""}`);
  return parts.join(" · ");
}

/** Where a worker works, as its launch chose (11-09), in the words of whoever plans. @param {NonNullable<Task["workspace"]>} ws @param {Crew} crew */
const workspaceWords = (ws, crew) => (ws === "folder" ? `in ${folderOf(crew)}` : `in a ${ws} of its own`);

/**
 * How the work stands in a line: done of all, what runs, is in review, merges, failed or was stopped, and what is ready
 * — but the ready ones its answer names in another place (`named`, a done's: each is said once).
 * @param {Graph} graph @param {ReadonlySet<string> | null} [named]
 */
function progressLine(graph, named = null) {
  // A step with sub-tasks is counted by them (11-06), and each list is cut short: a graph of 400 tasks says it in a line.
  const steps = kidsOf(graph);
  const work = graph.tasks.filter((t) => !steps.has(t.id));
  const live = work.filter((t) => t.state !== "dropped");
  /** @param {TaskState} s */
  const ids = (s) => work.filter((t) => t.state === s).map((t) => t.id);
  /** @type {[string, string[]][]} */
  const groups = [
    ["running", ids("running")],
    ["paused", ids("paused")],
    ["checking", ids("checking")],
    ["in review", ids("review")],
    ["merging", work.filter((t) => t.state === "merging" && !yours(t)).map((t) => t.id)],
    ["ready to apply", work.filter(yours).map((t) => t.id)],
    ["failed", ids("failed")],
    ["stopped", work.filter((t) => t.state === "waiting" && t.stopped).map((t) => t.id)],
    ["proposed", work.filter((t) => t.state === "waiting" && !t.stopped && t.proposed).map((t) => t.id)],
    ["ready", ready(graph).filter((t) => !named?.has(t.id)).map((t) => t.id)],
  ];
  return [`${live.filter((t) => t.state === "done").length} of ${live.length} done`, ...groups.flatMap(([s, ids]) => (ids.length ? [`${s}: ${fewIds(ids)}`] : []))].join(" · ");
}

/**
 * The planner's own tasks at work at once, none of them a helper's (the owner's of 11-10: "sometimes in Plan view
 * multiple tasks are spinning, what does that mean?"): each reads as at work, so one at a time — the one it is on —
 * said where a start or a checklist leaves more than one. "" where one or none is. A step runs as its sub-tasks do, and a
 * helper at work does its task (`helping`): one whose helper ended is the planner's again (FabeleHelper's of 11-10).
 * @param {Graph} graph @param {"tasks" | "checklist"} via @param {HelperAtWork} [helping]
 */
function atOnceWords(graph, via, helping = helpersWork) {
  const mine = ownRunning(graph, helping).map((t) => t.id);
  if (mine.length < 2) return "";
  const all = mine.length === 2 ? "both" : "all";
  return via === "checklist"
    ? `${andWords(mine)} are ${all} doing, and each reads as at work: one item doing at a time — the one you are on. Tick done what is done; one you have not taken up yet waits paused on your graph until you do (tasks pause, one call a task, each with its checkpoint).`
    : `${andWords(mine)} ${all} read as at work now: one task of yours at a time — the one you are on. Pause the others until you take them up (tasks pause, one call a task, each with its checkpoint), unless a sub-agent or a command works one meanwhile.`;
}

/**
 * What comes next of the planner's own, by name, where a done or a tick left none of its own at work (the owner's of
 * 11-10: an agent that drifted in a long context, with no compaction to remind it, hears only its tools' answers — and an
 * id alone says nothing to it): the first of its own that is ready, in the graph's order. "" where one of its own runs,
 * or none is ready. A step's is not its own work, nor one a helper works on now (`helping`); once its helper ended it
 * is, so it holds Next back as any of its own at work does. @param {Graph} graph @param {"tasks" | "checklist"} via
 * @param {HelperAtWork} [helping]
 */
function nextWords(graph, via, helping = helpersWork) {
  const r = nextOwn(graph, helping);
  if (!r) return "";
  return `Next of yours: ${r.id} "${cut(r.name, 80)}" — ${via === "checklist" && r.checklist ? "its item to doing" : "start it"} as you take it up.`;
}
/**
 * The task `nextWords` names, or null: the first of the planner's own that is ready, where none of its own is at work.
 * One that waits with a helper at work on it is that helper's; one whose helper ended is the planner's to start (the
 * review of 67038d835: any helper it ever had kept it from being named for good).
 * @param {Graph} graph @param {HelperAtWork} [helping] @returns {Task | null}
 */
function nextOwn(graph, helping = helpersWork) {
  if (ownRunning(graph, helping).length) return null;
  const steps = kidsOf(graph);
  return ready(graph).find((t) => t.by === "you" && !(t.helper && helping(t.helper.agent)) && !steps.has(t.id)) ?? null;
}

/** The graph's work: its tasks but the dropped, a step counted by its sub-tasks (11-06). @param {Graph} graph */
const liveWork = (graph) => {
  const steps = kidsOf(graph);
  return graph.tasks.filter((t) => t.state !== "dropped" && !steps.has(t.id));
};
/** Whether every task of the graph's work is done, and it has one. @param {Graph} graph */
const allDone = (graph) => {
  const live = liveWork(graph);
  return live.length > 0 && live.every((t) => t.state === "done");
};
/**
 * The marks `told` keeps of a graph come to all done (the owner's of 11-10): "end", that an answer weighed its work against
 * the ask (`weighWords`); "end:turn", that a turn's start did once more (`whereText`). Both go as the graph opens again,
 * so its next all done weighs again (`withEnd`).
 */
const END_SAID = "end";
const END_HEARD = "end:turn";
/** @param {string} m */
const isEndMark = (m) => m === END_SAID || m === END_HEARD;
/** How many are done, as the all-done words begin. @param {number} n */
const allDoneHead = (n) => (n === 1 ? "Its one task is done" : `All ${n} tasks are done`);
/** Whether the person wrote since the graph began (`personAt`: when they last wrote, service.js `personWrote`). @param {Graph} graph @param {number | null | undefined} personAt */
const askedSince = (graph, personAt) => Number(personAt) > graph.startedAt;
/**
 * The words that weigh the work against the ask, as every task comes to done (the owner's of 11-10: an agent that drifted
 * in a long context, with no compaction to remind it, hears only its tools' answers — "close" alone let it close on what
 * its tasks said, never on what was asked): the graph's goal, and what the person asked since it began where they wrote
 * since (`asked`); a graph with no goal — a checklist's — against what the person asked.
 * @param {Graph} graph @param {number} n @param {boolean} asked
 */
const weighWords = (graph, n, asked) =>
  `${allDoneHead(n)}. Before you close, weigh what was done against ${graph.goal ? `the goal "${cut(graph.goal, 200)}"${asked ? " and what the person asked since the graph began" : ""}` : "what the person asked"}: ${leftWords(graph)}; if nothing is left, close the graph with its outcome (tasks close).`;
/**
 * Where what was asked that no task did goes: a graph's tasks; a checklist's graph — steps taken one after another, which
 * go on the checklist and never on a graph — its checklist, as items, which the next list it sends carries (FabeleHelper's
 * of 11-10: a task added there was no item of the list, which never dropped it).
 * @param {Graph} graph
 */
const leftWords = (graph) => (graph.goal ? "what was asked that no task did goes in as tasks (tasks add)" : "what was asked that no item did goes on your checklist as items (send the whole list with them)");

/**
 * The words after an edit: how the work stands now, or — nothing left open — that it is time to close: weighed against the
 * ask the first time all is done (`weighWords`, its mark `END_SAID`), else said in a line. `personAt`: when the person
 * last wrote, where the caller knows. `named`: the ready tasks the answer names in another place (`progressLine`).
 * @param {Graph} graph @param {number | null} [personAt] @param {ReadonlySet<string> | null} [named]
 */
function afterText(graph, personAt = null, named = null) {
  const live = liveWork(graph);
  if (!live.length) return "No task is left: close the graph with its outcome (tasks close), or add more.";
  if (live.every((t) => t.state === "done")) return (graph.told || []).includes(END_SAID) ? `${allDoneHead(live.length)} — close the graph with its outcome (tasks close).` : weighWords(graph, live.length, askedSince(graph, personAt));
  return `${progressLine(graph, named)}.`;
}
/**
 * How the work stands after one of Filament's own words of it — a start, a check's verdict, a worker's or a command's end
 * (the owner's of 11-10): as a call's answer says it (`afterText`), all done included. @param {Graph} graph @param {number | null} [personAt]
 */
const nowWords = (graph, personAt = null) => (allDone(graph) ? afterText(graph, personAt) : `Now: ${progressLine(graph)}.`);

/**
 * A call's answer as its graph comes to all done, or leaves it (the owner's of 11-10): the answer that makes every task
 * done weighs the work against the ask, said by `afterText` — with what the person asked since, where they wrote since the
 * graph began (`personAt`) —, and its mark keeps a later answer to "close" alone; a graph that opens again loses its marks.
 * The answer's words are as its action wrote them: each gives `afterText` when the person last wrote, and only the
 * mark is set here, where the answer holds those words — one that says nothing of how the work stands weighs nothing.
 * Nothing is written into the answer: the weighing holds the graph's goal, the model's own words, which no pattern
 * may read (the review of 67038d835: a goal with "$&" in it came out with the answer spliced into it).
 * @template {{ graph: Graph | null, text: string, changed: boolean }} R @param {R} r @param {number | null | undefined} personAt @returns {R}
 */
function withEnd(r, personAt) {
  const g = r.graph;
  if (!r.changed || !g || g.closed) return r;
  const told = g.told || [];
  if (!allDone(g)) {
    if (!told.some(isEndMark)) return r;
    const rest = told.filter((m) => !isEndMark(m));
    const { told: _, ...bare } = g;
    return { ...r, graph: rest.length ? { ...g, told: rest } : bare };
  }
  if (told.includes(END_SAID) || !r.text.includes(afterText(g, personAt ?? null))) return r;
  return { ...r, graph: { ...g, told: [...told, END_SAID] } };
}

/**
 * A checklist tick's words apart (`applyPlan`), each a block of checkpoint.js "tick": the answer's own — what moved,
 * what is checked, what stays —, the planner's own tasks at work at once, what comes next of its own, and how the work
 * stands now or weighs it as all is done. "" where one says nothing.
 * @typedef {{ answer: string, atOnce: string, next: string, now: string }} TickParts
 */
/** The graph with its all done marked said by Filament's own words of an end (`nowWords`), or null where it is not all done or was said. @param {Graph | null | undefined} graph */
export const endSaid = (graph) => (graph && !graph.closed && allDone(graph) && !(graph.told || []).includes(END_SAID) ? { ...structuredClone(graph), told: [...(graph.told || []), END_SAID] } : null);
/** The graph with its all done marked said once more by a turn's start (`whereText`), or null where it is not all done or was. @param {Graph | null | undefined} graph */
export const endHeard = (graph) => (graph && !graph.closed && allDone(graph) && !(graph.told || []).includes(END_HEARD) ? { ...structuredClone(graph), told: [...new Set([...(graph.told || []), END_SAID, END_HEARD])] } : null);

/** A change list in a line: how many files, the lines, the first names. @param {readonly { path: string, added: number, removed: number }[]} files */
const filesWords = (files) => {
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  return `${plural(files.length, "file")} (+${added} −${removed}): ${files.slice(0, 8).map((f) => f.path).join(", ")}${files.length > 8 ? `, and ${files.length - 8} more` : ""}`;
};

/** A sub-agent's try in lines: what it reported — or its last words, when it gave no report — then Filament's record. @param {Attempt} a */
function attemptLines(a) {
  /** @type {string[]} */
  const lines = [];
  if (a.status) {
    lines.push(`Did: ${a.did}`);
    lines.push(`Acceptance: ${a.met ? "met" : "not met"} — ${a.evidence}`);
    if (a.left) lines.push(`Left: ${a.left}`);
  } else if (a.words) lines.push(`Its last words: ${a.words}`);
  if (a.files.length) lines.push(`Files: ${filesWords(a.files)}`);
  if (a.inFolder && a.written.length) lines.push(`Wrote, in the folder: ${a.written.slice(0, 8).join(", ")}${a.written.length > 8 ? `, and ${a.written.length - 8} more` : ""}`);
  if (a.unnamed.length) lines.push(`Outside its writes: ${a.unnamed.slice(0, 8).join(", ")}${a.unnamed.length > 8 ? `, and ${a.unnamed.length - 8} more` : ""}`);
  if (a.ran.length) lines.push(`Ran: ${a.ran.map((r) => `${r.command} (${r.exit === null ? "no exit code" : `exit ${r.exit}`})`).join("; ")}`);
  return lines;
}

/** A reviewer's round in lines (G3-3): its verdict, then what it checked, found and asked — or its last words. @param {Review} r */
function reviewLines(r) {
  const verdict = r.status === "done" ? (r.met ? "the change does what the task asks" : "it asks for changes") : r.status ? `it reported ${r.status}` : "it gave no report";
  const lines = [`Review, round ${r.round} of ${REVIEW_ROUNDS}, by ${r.agent}: ${verdict}`];
  if (r.status) {
    lines.push(`Checked: ${r.did}`, `Found: ${r.evidence}`);
    if (r.left) lines.push(`${r.met ? "Left" : "Asked"}: ${r.left}`);
  } else if (r.words) lines.push(`Its last words: ${r.words}`);
  return lines;
}

/**
 * Who does a task, in the words of whoever plans now (G3-2): the agent's for a sub-agent or an explorer, the team's
 * for a member — and, for a task planned in the other's words, who does it now.
 * @param {Task} t @param {Crew} crew
 */
function byWords(t, crew) {
  const by = t.by;
  const as = runsAs(t, crew);
  if (as === null) return `${aOrAn(by)} as another planner named it (no worker of your team can take it: give it to one with tasks change, or drop it)`;
  if (as !== by) return `${aOrAn(by)} as ${led(crew) ? "the agent" : "a team's lead"} planned it (${aOrAn(as)}${led(crew) ? " of your team" : ""} does it under you)`;
  if (!led(crew)) return by === "explorer" ? "an explorer, a sub-agent that changes nothing" : "a sub-agent";
  const m = memberOf(crew, by);
  return `${aOrAn(by)} of your team${m && !editsFiles(m) ? `, which ${doesWords(m)}` : ""}`;
}

/**
 * The whole graph as whoever plans it reads it (`crew`): the goal, every task in a line, what is ready and what waits
 * on what, and the critical path still to go — and, where `kept` says so, what is kept behind the graph and its tasks
 * (E33), marked. `back`: it comes back after a compaction (11-09) — what is kept is named by title, and each task's line
 * says the turns it was added and changed in, for the recall tool to bring their words back. `shared`: the caller's live
 * word on where the session's sub-agents work, else the graph's own (`sharingOf`).
 * @param {Graph} graph @param {Crew} crew @param {Kept | null} [kept] @param {{ back?: boolean, shared?: boolean }} [o]
 */
export function showText(graph, crew, kept = null, { back = false, shared } = {}) {
  const byId = indexOf(graph);
  const dropped = graph.tasks.filter((t) => t.state === "dropped").length;
  const lines = [`The task graph — ${graph.goal || (led(crew) ? "the agent's checklist" : "your checklist")}`];
  lines.push(graph.closed ? `Closed: ${graph.closed.reason} (${graph.tasks.filter((t) => t.state === "done").length} done${dropped ? `, ${dropped} dropped` : ""}).` : `${progressLine(graph)}${dropped ? ` · ${dropped} dropped` : ""}.`);
  if (!graph.closed && graph.held) lines.push(`Held since the developer's stop: Filament starts no ${led(crew) ? "worker" : "sub-agent"}'s task until your next tasks call.`);
  if (!graph.closed && graph.planning) lines.push(planWaitsWords(crew));
  // The agent's suggestion, while its card stands (the review of ef73c2a9d): its tasks wait for the person's answer.
  const card = sideOfferOf(graph);
  if (card) lines.push(`A card in the chat suggests ${andWords(card.ids)} to the person: leave them until they Accept or Ignore it.`);
  const spent = spentOf(graph);
  if (spent > 0) lines.push(`Its ${led(crew) ? "workers" : "sub-agents"} spent ${usd(spent)}.`);
  if (kept?.[""]) lines.push(`Kept behind the graph itself: ${back ? keptTitles(kept[""]) : keptWords(kept[""])}.`);
  // A step's sub-tasks under it (11-06): its open ones a line each, its done and dropped ones counted.
  const kids = kidsOf(graph);
  /** @type {Map<string, Task[]>} */
  const under = new Map();
  for (const t of graph.tasks) if (t.under && byId.has(t.under)) under.set(t.under, (under.get(t.under) || []).concat(t));
  for (const t of graph.tasks) {
    if (t.under && byId.has(t.under)) continue;
    lines.push(`- ${taskLine(t, byId, crew, kept, kids, back)}`);
    const ks = under.get(t.id) || [];
    const done = ks.filter((k) => k.state === "done").map((k) => k.id);
    const dropped = ks.filter((k) => k.state === "dropped").map((k) => k.id);
    if (done.length) lines.push(`  - done: ${fewIds(done)}`);
    for (const k of ks) if (k.state !== "done" && k.state !== "dropped") lines.push(`  - ${taskLine(k, byId, crew, kept, null, back)}`);
    if (dropped.length) lines.push(`  - dropped: ${fewIds(dropped)}`);
  }
  if (!graph.closed) {
    const b = blocked(graph);
    if (b.length) lines.push(`Waiting on others: ${b.map((x) => `${x.id} on ${x.on.map((o) => `${o.id} (${o.state})`).join(", ")}`).join("; ")}.`);
    const path = criticalPath(graph);
    if (path.length > 1) lines.push(`Critical path still to go: ${path.join(" → ")}.`);
    // Where tasks meet over their files (g1): a show says it whenever it holds.
    const meets = meetsWords(meetings(graph, { shared }), crew);
    if (meets) lines.push(meets);
  }
  if (graph.tasks.length) lines.push("A task whole: tasks show with its id.");
  if (kept && Object.keys(kept).length) lines.push("What is kept: tasks read with a task's id — none for the graph's own — lists it; with a title too, reads that one.");
  if (back && graph.tasks.some((t) => t.addedTurn != null)) lines.push("filament_recall with a turn's number brings back what was said as a task was added or changed.");
  return lines.join("\n");
}

/**
 * One task whole: its line, who does it and its brief, what it needs and how those stand, what needs it, its
 * acceptance, its sub-agent's report and its reviews, and its outcome — in the words of whoever plans now (`crew`).
 * `reads`: the agent reads along with its graph's sub-agents, and is told who works on the task now.
 * `kept`: what is kept behind each task (E33), its line marking it.
 * @param {Graph} graph @param {string} id @param {Crew} crew @param {boolean} [reads] @param {Kept | null} [kept]
 */
function taskText(graph, id, crew, reads = false, kept = null) {
  const byId = indexOf(graph);
  const t = byId.get(String(id).trim().toLowerCase());
  if (!t) return null;
  const lines = [taskLine(t, byId, crew, kept)];
  if (kept?.[t.id]) lines.push(`Kept behind it: ${keptWords(kept[t.id])} — tasks read with id ${t.id} lists them`);
  const working = reads ? atWork(t) : null;
  if (working) lines.push(`At work now: ${t.state === "review" ? "its reviewer" : "sub-agent"} ${working} — tasks note with this id reaches it at its next step`);
  if (t.by === COMMAND) lines.push(...commandLines(t, crew));
  else if (t.by !== "you") lines.push(`By: ${byWords(t, crew)} — Filament starts it once its needs are done`);
  if (t.review) lines.push(`Review: ${led(crew) ? `${aOrAn(reviewerOf(crew)?.tag ?? "reviewer")} of your team` : "an explorer"} reads its change before it merges, ${REVIEW_ROUNDS} rounds at most`);
  if (t.goal) lines.push(`Goal: ${t.goal}`);
  if (t.steps.length) lines.push(`Steps:\n${t.steps.map((s, n) => `${n + 1}. ${s}`).join("\n")}`);
  if (t.needs.length) lines.push(`Needs: ${t.needs.map((n) => `${n} (${/** @type {Task} */ (byId.get(n)).state})`).join(", ")}`);
  // A step and its sub-tasks (11-06): what it is part of, or what it holds.
  const step = t.under ? byId.get(t.under) : undefined;
  if (step) lines.push(`Under: ${step.id} "${step.name}" (${stateWord(step)}) — it starts after ${step.id}'s needs${step.needs.length ? ` (${step.needs.join(", ")})` : ""}, and ${step.id} is done once its sub-tasks are`);
  const ks = graph.tasks.filter((x) => x.under === t.id);
  if (ks.length) lines.push(`Sub-tasks: ${ks.slice(0, 40).map((k) => `${k.id} (${stateWord(k)})`).join(", ")}${ks.length > 40 ? `, and ${ks.length - 40} more` : ""} — ${t.id} is done once those not dropped are`);
  const after = graph.tasks.filter((x) => x.needs.includes(t.id) && x.state !== "dropped").map((x) => x.id);
  if (after.length) lines.push(`Needed by: ${after.join(", ")}`);
  if (t.writes.length) lines.push(`Writes: ${t.writes.join(", ")}`);
  if (t.acceptance) lines.push(`Acceptance: ${t.acceptance}`);
  if (t.thread) lines.push(`Memory's thread: ${t.thread.id} "${t.thread.text}" — ${threadSaid(t.thread, crew)}`);
  // The hunt whose finding it takes up (11-02): the Hunter's id, to ask it more.
  if (t.foundBy) lines.push(`Found by: ${t.foundBy.name}'s hunt on ${t.foundBy.task}${byId.get(t.foundBy.task) ? ` "${/** @type {Task} */ (byId.get(t.foundBy.task)).name}"` : ""} — ${t.foundBy.agent}, whose report named what it found`);
  if (checkOf(t).length) lines.push(`Check: ${inOrder(checkOf(t))}${t.checkBy === "worker" ? ` — named by its ${workerWord(t.ranAs)}` : ""}`);
  lines.push(...verdictLines(t));
  if (t.note) lines.push(`Your note for its ${led(crew) ? "worker" : "sub-agent"}: ${t.note}`);
  if (t.report) lines.push(`${capital(workerWord(t.ranAs))} ${t.agent}${t.report.status ? ` reported ${t.report.status}` : " gave no report"}:`, ...attemptLines(t.report));
  for (const r of t.reviews) lines.push(...reviewLines(r));
  if (t.merged) lines.push(`Merged: ${plural(t.merged.files, "file")} (+${t.merged.added} −${t.merged.removed})`);
  if (t.uncommitted?.length) lines.push(`Applied, not committed: ${listed(t.uncommitted)} ${t.uncommitted.length === 1 ? "is" : "are"} uncommitted in the folder.`);
  lines.push(...gateLines(t, crew));
  if (t.overruled || t.overruledBy) lines.push(`${t.state === "merging" ? "Merging" : "Merged"} ${asItStood(t)}`);
  if (t.state === "done" && t.by === "you") lines.push(`Done: ${t.summary}`);
  if (t.evidence) lines.push(`Evidence: ${t.evidence}`);
  if (t.changed?.length) lines.push(`Changed while it ran: ${pathsWords(t.changed)}${t.changedMore ? ` — the first ${CHANGED_KEPT} by path of more than ${CHANGED_KEPT}` : ""}`);
  if (t.state === "dropped") lines.push(`Dropped: ${t.why}`);
  if (t.state === "failed") lines.push(`Failed: ${whyFor(t, crew)}${t.failures && t.failures.times > 1 ? ` — the same way ${t.failures.times} times in a row` : ""}`);
  if (t.unreviewed) lines.push(`Not reviewed: ${t.unreviewed}`);
  if (t.earlier?.done) lines.push(`Round ${t.earlier.done.round}, done${t.earlier.agent ? ` by ${workerWord(t.earlier.ranAs)} ${t.earlier.agent}` : ""}: ${t.earlier.done.summary}`);
  else if (t.earlier) {
    lines.push(`Before that, ${t.earlier.agent ? `${workerWord(t.earlier.ranAs)} ${t.earlier.agent}` : "a try"} ended: ${t.earlier.why}`);
    for (const r of t.earlier.reviews) lines.push(...reviewLines(r));
  }
  if (t.spentUsd > 0) lines.push(`Spent: ${usd(t.spentUsd)} over ${t.tries} ${t.tries === 1 ? "try" : "tries"}`);
  return lines.join("\n");
}

/** How a task's thread stands, in a show's words (E28). @param {TaskThread} th @param {Crew} crew */
function threadSaid(th, crew) {
  const user = led(crew) ? "the developer" : "the user";
  if (!th.end) return th.own ? `${user}'s own: once the task is done, memory asks them to close it` : "Filament closes it with the task's summary once the task is done";
  if (th.end.how === "closed") return "closed when the task was done";
  if (th.end.how === "asked") return `${user}'s own: memory asked them to close it`;
  if (th.end.how === "already") return "it was closed already when the task was done";
  return `not closed: ${th.end.words}`;
}

/**
 * What a show of a command task says (V2-3): who runs it, its run and items, its runs — as they go, as the developer's
 * stop left them, or as they ended — each run that did not pass, and the end of the output each kept.
 * @param {Task} t @param {Crew} crew @returns {string[]}
 */
function commandLines(t, crew) {
  const items = t.items || [];
  const lines = [
    `By: Filament itself, no model: it runs the commands ${items.length ? `once for each item, in copies of ${folderOf(crew)}` : `in a copy of ${folderOf(crew)}`}, once its needs are done`,
    `Run: ${inOrder(t.run || [])}`,
  ];
  if (items.length) lines.push(`Items: ${items.length} — ${items.slice(0, 20).join(", ")}${items.length > 20 ? `, and ${items.length - 20} more` : ""}`);
  const p = t.progress ?? null;
  if (t.state === "running" && p) lines.push(`Runs: ${p.ran} of ${p.of} so far, ${p.passed} passed, ${atATime(p.lanes)}`);
  const r = t.result ?? null;
  if (!r || t.state === "running") return lines;
  const reds = r.runs.filter((x) => !x.passed);
  const passed = r.runs.length - reds.length;
  if (t.state === "done" && reds.length) lines.push(`Taken as done: ${t.summary}`);
  lines.push(r.cut ? `Runs, before the developer's stop: ${r.runs.length} of ${r.of}, ${passed} passed, ${reds.length} not` : `Runs: ${r.of}, ${atATime(r.lanes)}, ${passed} passed, ${reds.length} not (${durationWords(r.ms)})`);
  if (reds.length) lines.push(`Did not pass:\n${reds.slice(0, 100).map((x) => `- ${x.item === null ? "" : `${x.item}: `}${runSaid(x)}`).join("\n")}${reds.length > 100 ? `\n- and ${reds.length - 100} more: ${reds.slice(100).map((x) => x.item).join(", ")}` : ""}`);
  for (const x of reds) if (x.output) lines.push(`The end of ${x.item === null ? "its" : `${x.item}'s`} output:\n${x.output}`);
  return lines;
}

/**
 * What a task's show says of its check's verdict (V2-1): checked, flaky with the end of its first run's output, failed
 * with the end of its output, or not run and why — and, for a done task whose change is kept with no check, that it is
 * unchecked.
 * @param {Task} t @returns {string[]}
 */
function verdictLines(t) {
  const v = t.verdict ?? null;
  if (!v) return t.state === "done" && !checkOf(t).length && (t.by === "you" || changes(t)) ? ["Unchecked: the task has no check."] : [];
  if (v.kind === "not") return [`Not checked: ${v.words}`];
  if (v.kind === "failed") return [`Check failed: ${verdictRuns(v)}`, ...(v.output ? [`The end of its output:\n${v.output}`] : [])];
  // Flaky: what its first run printed, which names what failed (the hunt of check-wake: only its end's words said it).
  return [`${v.kind === "flaky" ? "Checked, flaky" : "Checked"}: ${verdictRuns(v)}`, ...(v.kind === "flaky" && v.output ? [`The end of its first run's output:\n${v.output}`] : [])];
}

/**
 * What a task's show says of Filament's check of the folder as its change merged (V2-2): the newest verdict, and the end
 * of a red command's output. @param {Task} t @param {Crew} crew @returns {string[]}
 */
function gateLines(t, crew) {
  const g = t.gate ?? null;
  if (!g) return [];
  const folder = folderOf(crew);
  const said = g.kind === "undone" ? undoneSaid(t, g, folder) : gateSaid(g, folder, "its change", !stoodBare(t));
  return [`Folder: ${sentence(said)}`, ...(g.output ? [`The end of its output:\n${g.output}`] : [])];
}
/**
 * A merge the folder's check undid, in a show's words (V2-2): the command it broke, and where its change went.
 * @param {Task} t @param {Gate} g @param {string} folder
 */
function undoneSaid(t, g, folder) {
  const b = g.broke;
  const back = g.back;
  if (!b || !back) return "Filament undid its merge";
  const worker = workerWord(t.ranAs);
  const where = "n" in back ? `it went back to its ${worker} ${t.agent} (the ${nth(back.n)} time of ${GATE_RETURNS})` : "twice" in back ? `it went back to its ${worker} twice already` : `it could not go back to its ${worker} (${back.why})`;
  return `Filament undid its merge: ${brokeSaid(b, folder)}; ${where}`;
}
/**
 * Why a task failed, in the words of whoever plans now: one the folder's check failed was said to the agent, and a lead
 * reads of the folder, not its own (V2-2). @param {Task} t @param {Crew} crew
 */
const whyFor = (t, crew) => (led(crew) && t.failures?.cause === "gate" ? t.why.replaceAll("your folder", "the folder") : t.why);

/** The words for a graph a call cannot edit: none yet, or closed. @param {Graph | null} graph */
const noGraph = (graph) => (graph ? `the graph is closed (${graph.closed?.reason}) — tasks add starts a new one, with its goal` : "there is no graph yet — tasks add starts one, with its goal");

/**
 * The step a task's input puts it under (the owner's plan mode of 11-06): its id, null to take it out of its step, or
 * undefined where the input leaves it as it was — or the problem.
 * @param {string} id @param {Record<string, any>} input @param {readonly string[]} known
 * @returns {{ under: string | null | undefined } | { error: string }}
 */
function readUnder(id, input, known) {
  if (!known.includes("under") || input.under === undefined) return { under: undefined };
  if (input.under === null || input.under === "") return { under: null };
  if (typeof input.under !== "string" || !text(input.under)) return { error: `${id}: under is a step's id — the task of yours it is a sub-task of — or "" to take it out of its step` };
  return { under: text(input.under).toLowerCase() };
}

/**
 * What the steps and sub-tasks of a call cannot be (11-06), for the tasks it added or changed: a sub-task's step is a
 * task of the graph, open — waiting, paused, or under way — the planner's own, with no check of its own, under none
 * itself, no helper of a coding agent's at work on it; a sub-task holds none, and neither it nor its step needs the other. A step keeps its sub-tasks only while it
 * is the planner's own, with no check: its sub-tasks carry who does the work, and what proves it.
 * @param {Graph} graph @param {readonly string[]} ids @returns {string[]}
 */
function underProblems(graph, ids) {
  const byId = indexOf(graph);
  const kids = kidsOf(graph);
  /** @type {Set<string>} */
  const problems = new Set();
  for (const id of ids) {
    const t = byId.get(id);
    if (!t) continue;
    const ks = kids.get(id);
    if (ks && t.by !== "you") problems.add(`${id} has sub-tasks (${fewIds(ks.map((k) => k.id), 5)}), so it stays your own: each sub-task names who does it`);
    if (ks && checkOf(t).length) problems.add(`${id} has sub-tasks, so it takes no check of its own: give it to the sub-task that proves it`);
    for (const k of ks || []) if (t.needs.includes(k.id)) problems.add(`${id} needs ${k.id}, its own sub-task: a step is done once its sub-tasks are — take ${k.id} out of its needs`);
    if (!t.under) continue;
    const s = byId.get(t.under);
    if (t.under === id) problems.add(`${id} is under itself — under names the step it is a sub-task of`);
    else if (!s) problems.add(`${id} is under ${t.under}, which is no task in the graph — add the step first, or in the same call`);
    else if (s.under) problems.add(`${id} is under ${s.id}, a sub-task of ${s.under} itself: one level only — put ${id} under ${s.under}`);
    else if (ks) problems.add(`${id} has sub-tasks of its own, so it can't be under ${s.id}: one level only`);
    else if (s.state !== "waiting" && s.state !== "running" && s.state !== "paused") problems.add(`${id} is under ${s.id}, which is ${stateWord(s)} — add the work under an open step, or as a task of its own`);
    else if (s.by !== "you") problems.add(`${id} is under ${s.id}, which is ${whose(s.by)}: a step is your own — each sub-task names who does it`);
    // Its helper's work would end as the sub-tasks do, whatever it still did (the review of 7d8059000).
    else if (s.helper && s.state === "running") problems.add(`${id} is under ${s.id}, which is under way with ${s.helper.agent}, the sub-agent you launched for it: a step's work is its sub-tasks — add ${id} as a task of its own`);
    else if (checkOf(s).length) problems.add(`${id} is under ${s.id}, which has a check: a step's sub-tasks carry the checks — give ${s.id}'s to the sub-task that proves it (tasks change ${s.id} with check: [])`);
    else if (t.needs.includes(s.id)) problems.add(`${id} is under ${s.id}, so it needs no ${s.id}: a sub-task starts after its step's needs, and ${s.id} is done once its sub-tasks are`);
    else if (s.needs.includes(id)) problems.add(`${s.id} needs ${id}, its own sub-task: a step is done once its sub-tasks are — take ${id} out of its needs`);
    else if (t.state !== "waiting") {
      // Begun, it would start the step — and its done end it — before the step's needs are (the review of 11-06).
      const open = s.needs.filter((n) => byId.has(n) && !needMet(/** @type {Task} */ (byId.get(n)), t));
      if (open.length) problems.add(`${id} is ${stateWord(t)}, and ${s.id} still needs ${fewIds(open, 5)} done: a task begun goes under a step only once the step's needs are done — keep it a task of its own`);
    }
  }
  return [...problems];
}

/**
 * The steps as their sub-tasks stand (the owner's plan mode of 11-06), in place: a step none of whose sub-tasks has begun
 * stays as it was; one with a sub-task begun is under way (running); one whose sub-tasks are all done — those not
 * dropped, one at least — is done, its summary saying so where it had none. → the steps it made done.
 * @param {Graph} graph @param {number} at @returns {string[]}
 */
function settleSteps(graph, at) {
  const byId = indexOf(graph);
  /** @type {string[]} */
  const ended = [];
  for (const [id, ks] of kidsOf(graph)) {
    const s = byId.get(id);
    if (!s || (s.state !== "waiting" && s.state !== "running" && s.state !== "paused")) continue;
    if (ks.every((k) => k.state === "done")) {
      const first = Math.min(...ks.map((k) => k.startedAt ?? at));
      Object.assign(s, { state: "done", summary: s.summary || `Its ${plural(ks.length, "sub-task")} ${ks.length === 1 ? "is" : "are"} done: ${fewIds(ks.map((k) => k.id))}.`, why: "", startedAt: s.startedAt ?? first, endedAt: at });
      delete s.quiet;
      ended.push(id);
    } else if (s.state !== "running" && ks.some((k) => k.state !== "waiting")) {
      Object.assign(s, { state: "running", startedAt: s.startedAt ?? at });
      delete s.quiet;
    }
  }
  return ended;
}

/**
 * The graph with its steps as their sub-tasks stand (`settleSteps`, 11-06) — what the runner's every keep does, so a
 * sub-task its worker, its check or its merge ended moves its step too. Null where nothing moved.
 * @param {Graph | null | undefined} graph @param {number} at @returns {Graph | null}
 */
export function rollUp(graph, at) {
  if (!graph || graph.closed || !graph.tasks.some((t) => t.under) || !unsettled(graph)) return null;
  const next = structuredClone(graph);
  settleSteps(next, at);
  return next;
}

/**
 * Whether a step stands otherwise than its sub-tasks do (`settleSteps`'s rule, read): the runner's every keep asks it,
 * a command's progress every two seconds among them, so nothing is cloned where nothing moves. @param {Graph} graph
 */
function unsettled(graph) {
  const byId = indexOf(graph);
  for (const [id, ks] of kidsOf(graph)) {
    const s = byId.get(id);
    if (!s || (s.state !== "waiting" && s.state !== "running" && s.state !== "paused")) continue;
    if (ks.every((k) => k.state === "done") || (s.state !== "running" && ks.some((k) => k.state !== "waiting"))) return true;
  }
  return false;
}

/**
 * What a call says of the steps it left with no sub-task (the review of 11-06): each is its planner's own task again,
 * standing as it stood. "" for none. @param {Graph} before @param {Graph} next
 */
function freedWords(before, next) {
  const had = kidsOf(before);
  const has = kidsOf(next);
  const byId = indexOf(next);
  const ids = [...had.keys()].filter((id) => !has.has(id) && isOpen(/** @type {Task} */ (byId.get(id) || { state: "dropped" })));
  if (!ids.length) return "";
  const one = ids.length === 1;
  const it = one ? "it" : "them";
  return ` ${andWords(ids)} ${one ? "has" : "have"} no sub-task left, so ${one ? "it is your own task" : "they are your own tasks"} again: do ${it}, put sub-tasks under ${it}, or drop ${it}.`;
}

/**
 * What a sub-task's end says of the step it finished (the review of 11-06): its step is done with it — the last of
 * them to end, the last in order of those that ended at once. "" where it finished none. @param {Graph} graph @param {Task} t
 */
function stepEndWords(graph, t) {
  if (!t.under || t.state !== "done") return "";
  const s = indexOf(graph).get(t.under);
  const ks = kidsOf(graph).get(t.under) || [];
  // Of those that ended at once — a restart ends every check it cut at its own time —, the last in the graph's order.
  const last = ks.reduce((a, k) => ((k.endedAt ?? 0) >= (a.endedAt ?? 0) ? k : a), t);
  return s?.state === "done" && last.id === t.id ? stepsDoneWords([s.id]) : "";
}

/**
 * Whether an open task waits on a task's end (the review of 11-06): one that needs it, or — a sub-task — one that needs
 * its step, which its end may finish, or hold for its apply. The runner never holds such an end.
 * @param {Graph} graph @param {string} id
 */
export function waitedOn(graph, id) {
  const step = graph.tasks.find((x) => x.id === id)?.under || null;
  return graph.tasks.some((x) => (x.needs.includes(id) || (step !== null && x.needs.includes(step))) && x.state !== "done" && x.state !== "dropped");
}

/** What an answer says of the steps a call made done (11-06): "" for none. @param {readonly string[]} ids */
const stepsDoneWords = (ids) => (ids.length ? ` ${andWords(ids)} ${ids.length === 1 ? "is" : "are"} done with it: every sub-task of ${ids.length === 1 ? "it" : "them"} is.` : "");

/** What an add says of the sub-tasks it put under steps (11-06): each step's, and — once a graph — how a step runs. @param {Graph} next @param {readonly Task[]} added */
function underWords(next, added) {
  /** @type {Map<string, string[]>} */
  const by = new Map();
  for (const t of added) if (t.under) by.set(t.under, [...(by.get(t.under) || []), t.id]);
  if (!by.size) return "";
  const first = !next.told?.includes("under");
  if (first) next.told = [...(next.told || []), "under"];
  const said = [...by].map(([s, ids]) => `${andWords(ids)} under ${s}`).join("; ");
  return ` Sub-tasks: ${said}${first ? " — each starts after its step's needs, and the step is done once its sub-tasks are: what needs it waits for them all" : ""}.`;
}

/** The ids a start or a drop names: ids, or one id. @param {Record<string, any>} i @param {string} action @returns {string[] | string} */
function readIds(i, action) {
  const raw = Array.isArray(i.ids) ? i.ids : i.id !== undefined && i.id !== null && i.id !== "" ? [i.id] : null;
  if (!raw || !raw.length || raw.some((x) => !text(x))) return `${action} needs ids: the tasks to ${action}`;
  return [...new Set(raw.map((x) => text(x).toLowerCase()))];
}

/**
 * @typedef {{ id: string, summary?: unknown, evidence?: unknown, note?: unknown, reason?: unknown }} Entry  one task a
 *   done, a start or a drop names (11-09), with what goes with it alone: a done's summary and evidence, a start's note, a
 *   drop's reason
 */
/**
 * The tasks a done, a start or a drop names (11-09): its tasks entries — each an id, or an id with its own summary,
 * evidence, note or reason — where it names no ids, else its ids. The first entry of an id stands. Refused in words.
 * @param {Record<string, any>} i @param {string} action @returns {Entry[] | string}
 */
function entriesOf(i, action) {
  const named = i.ids !== undefined && i.ids !== null ? true : i.id !== undefined && i.id !== null && i.id !== "";
  if (named || !Array.isArray(i.tasks) || !i.tasks.length) {
    const ids = readIds(i, action);
    return typeof ids === "string" ? ids : ids.map((id) => ({ id }));
  }
  /** @type {Entry[]} */
  const out = [];
  for (const e of i.tasks) {
    const id = typeof e === "string" ? text(e) : e && typeof e === "object" && !Array.isArray(e) ? text(String(e.id ?? "")) : "";
    if (!id) return `${action} needs ids: the tasks to ${action}`;
    if (!out.some((x) => x.id === id.toLowerCase())) out.push(typeof e === "string" ? { id: id.toLowerCase() } : { ...e, id: id.toLowerCase() });
  }
  return out;
}

/**
 * A new task's needed_by (g1): the tasks that then need it, by their ids — none where it gives none — or the refusal.
 * @param {string} id @param {unknown} v @returns {{ ids: string[] } | { error: string }}
 */
function readNeededBy(id, v) {
  if (v === undefined || v === null) return { ids: [] };
  if (!Array.isArray(v) || v.some((x) => !text(x))) return { error: `${id}: needed_by is a list of task ids: the tasks that then need it` };
  return { ids: [...new Set(v.map((x) => text(x).toLowerCase()))] };
}
/**
 * Why a task's fields can't change now, in words — the developer's side run holds it, its change waits for its apply,
 * it is done, being checked, dropped, merging, in review, or Filament or its worker has it — or null where they may: a
 * change's word, and an add's needed_by's (g1).
 * @param {Task} t
 */
const fixedWhy = (t) =>
  claimed(t)
    ? claimedWords(t)
    : yours(t)
      ? `${t.id}'s change is ready and waits for its apply — it can't change now: apply it, send it back with a note (tasks start with its id and note), or drop it`
      : t.state === "done"
        ? `${t.id} is done — start it to reopen it, or add a new task for other work`
        : t.state === "checking"
          ? `${t.id} is being checked now — wait for its verdict`
          : t.state === "dropped"
            ? `${t.id} was dropped (${t.why}) — add a new task for that work`
            : t.state === "merging"
              ? `${t.id} is merging into the folder — it can't change now`
              : t.state === "review"
                ? `${t.id} is in review — wait for its end, or drop it`
                : t.state === "running" && t.by === COMMAND
                  ? `${t.id} is being run by Filament now — wait for its end, or drop it`
                  : t.state === "running" && t.by !== "you"
                    ? `${t.id} is with its ${workerWord(t.ranAs)} now — wait for its end, or drop it`
                    : null;
/**
 * What became of the planner's own running task a call gave other needs or another hand (g1, the owner's of 11-09):
 * handed on, it waits, and Filament starts it once its needs are done; its needs changed, it runs on — a need holds back
 * a start, not work begun. "" where neither changed. @param {Task} t  as the call left it
 * @param {{ needs: readonly string[], by: TaskBy }} was @param {Map<string, Task>} byId
 */
function runningChanged(t, was, byId) {
  if (t.by !== was.by) return ` ${t.id} was running, and is ${othersWords(t)} now: it waits, and Filament starts it once its needs are done.`;
  if (t.needs.length === was.needs.length && t.needs.every((n) => was.needs.includes(n))) return "";
  const open = t.needs.filter((n) => {
    const need = byId.get(n);
    return !!need && !needMet(need, t);
  });
  return ` ${t.id} runs on, needing ${t.needs.length ? andWords(t.needs) : "nothing"} now${open.length ? `: ${andWords(open)} ${open.length === 1 ? "is" : "are"} not done, and a need holds back a start, not work begun` : ""}.`;
}

/**
 * Add tasks: each waits until its needs are done. An add with no open graph starts one, and needs its goal; a goal
 * given later restates it. A task that takes up a hunt's finding needs the task the hunt was fired from (`foundOf`).
 * A new task's needed_by makes the tasks it names need it (g1) — those of the graph, refused as a change of their
 * needs is, or of the call — and the whole is checked as one graph. `o`: whether the session's sub-agents share its
 * folder (`shared`), which says where two tasks writing one file meet; `neededBy`, whether the input may name it at all;
 * `turn`, the chat's turn the call came in, kept on each task it adds or gives a need (11-09); `kept`, what is kept
 * behind the graph — {} where nothing is, null where Filament keeps no notes —, so an add of three or more says once to
 * keep the design behind it; `personAt`, when the person last wrote (`afterText`).
 * @param {Graph | null} graph @param {Record<string, any>} i @param {number} at @param {readonly string[]} fields @param {Crew} crew
 * @param {Vet} vet @param {ThreadOf} threadOf @param {FoundOf} foundOf @param {{ shared?: boolean, neededBy?: boolean, turn?: number | null, kept?: Kept | null, personAt?: number | null }} [o]
 * @returns {Applied | Refusal}
 */
function add(graph, i, at, fields, crew, vet, threadOf, foundOf, { shared, neededBy = true, turn = null, kept = null, personAt = null } = {}) {
  const open = graph && !graph.closed ? graph : null;
  const goal = text(i.goal);
  if (!open && !goal) return shaped("add", `add ${graph ? "starts a new graph, since this one is closed" : "starts the graph"}, so it needs goal: what the work is for, in a sentence`);
  const longGoal = over("goal", goal, LIMIT.goal);
  if (longGoal) return refused(longGoal);
  if (!Array.isArray(i.tasks) || !i.tasks.length) return shaped("add", "add needs tasks: a list of one or more, each with an id, a name, and the ids of the tasks it needs");
  // A graph that follows a closed one carries the session's revision on: a page never draws an older one over it.
  /** @type {Graph} */
  const next = open ? structuredClone(open) : { version: GRAPH_VERSION, goal: "", tasks: [], startedAt: at, closed: null, held: null, rev: graph ? graph.rev : 0 };
  /** @type {string[]} */
  const problems = [];
  /** Every id the call gave, its task taken or not. @type {Set<string>} */
  const given = new Set();
  /** @type {Task[]} */
  const added = [];
  /** Whether a task's own shape was wrong — no object, no id, a field no task has —: the refusal ends with the call (TG2). */
  let form = false;
  /** Each new task's needed_by, as given (g1). @type {Map<string, string[]>} */
  const wants = new Map();
  for (const [k, input] of i.tasks.entries()) {
    const read = readId(input);
    if ("error" in read) {
      form = true;
      problems.push(i.tasks.length > 1 ? `task ${k + 1} of the list: ${read.error}` : read.error);
      continue;
    }
    const { id } = read;
    if (given.has(id)) {
      problems.push(`${id} is given twice`);
      continue;
    }
    given.add(id);
    if (next.tasks.some((x) => x.id === id)) problems.push(`${id} is a task in the graph already — give the new one another id, or change ${id}`);
    // needed_by is the add's, read apart: no field the task keeps (g1).
    const { needed_by: needed, ...own } = input;
    const unknown = unknownField(id, neededBy ? own : input, fields);
    if (unknown) {
      form = true;
      problems.push(unknown);
    }
    const nb = neededBy ? readNeededBy(id, needed) : { ids: [] };
    if ("error" in nb) problems.push(nb.error);
    else if (nb.ids.length) wants.set(id, nb.ids);
    const fieldsOf = readFields(id, input, {}, crew, fields, vet);
    const th = readThread(id, input, {}, fields, threadOf);
    if ("error" in th) problems.push(th.error);
    // A hunt's finding needs the task the hunt was fired from: the line on the Plan.
    const fo = readFound(id, input, {}, fields, foundOf, next);
    if ("error" in fo) problems.push(fo.error);
    // The step it is a sub-task of (11-06): checked once the call's tasks are all in (`underProblems`).
    const un = readUnder(id, input, fields);
    if ("error" in un) problems.push(un.error);
    if (Array.isArray(fieldsOf)) problems.push(...fieldsOf);
    else if (!unknown && !("error" in th) && !("error" in fo) && !("error" in un)) {
      const fn = foundNeeds(fieldsOf.needs, null, fo.found, "named");
      added.push({ id, ...fieldsOf, needs: fn.needs, ...(un.under ? { under: un.under } : {}), ...(fn.found ? { foundBy: fn.found } : {}), ...(th.thread ? { thread: th.thread } : {}), verdict: null, state: "waiting", summary: "", why: "", addedAt: at, startedAt: null, endedAt: null, agent: null, tries: 0, resume: null, failures: null, unreviewed: "", note: "", report: null, earlier: null, merged: null, stopped: false, spentUsd: 0, ranAs: null, reviews: [], reviewer: null, step: null, overruled: "", gate: null, ...(fieldsOf.by === COMMAND ? { result: null, progress: null } : {}), ...(turn != null ? { addedTurn: turn, changedTurn: turn } : {}) });
    }
  }
  const total = next.tasks.length + i.tasks.length;
  if (total > MAX_TASKS) problems.push(`a graph holds at most ${MAX_TASKS} tasks, and this would make ${total} — make them fewer and larger, or close this graph and start another`);
  const fresh = added.filter((t) => !next.tasks.some((x) => x.id === t.id));
  if (goal) next.goal = goal;
  next.tasks.push(...fresh);
  // needed_by (g1): the tasks named need the new one in the graph the whole call is checked as — one the call gave but
  // could not take is said already.
  const byId = indexOf(next);
  /** The tasks a needed_by gave a need, and what each new task's said. @type {Set<string>} */
  const needing = new Set();
  /** @type {string[]} */
  const neededSaid = [];
  for (const [id, ids] of wants) {
    if (!fresh.some((t) => t.id === id)) continue;
    /** @type {string[]} */
    const took = [];
    /** What became of a running one of the planner's own among them. @type {string[]} */
    const ran = [];
    for (const x of ids) {
      const t = byId.get(x);
      const stuck = !t ? (given.has(x) ? "" : `${x} is no task in the graph`) : x === id ? null : fixedWhy(t);
      if (stuck !== null || !t) {
        if (stuck) problems.push(`${id}'s needed_by: ${stuck}`);
        continue;
      }
      const was = { needs: [...t.needs], by: t.by };
      if (!t.needs.includes(id)) t.needs = [...t.needs, id];
      if (x !== id && turn != null) t.changedTurn = turn;
      needing.add(x);
      if (x !== id) took.push(x);
      if (x !== id && t.state === "running" && t.by === "you") ran.push(runningChanged(t, was, byId));
    }
    if (took.length) neededSaid.push(` ${andWords(took)} now need${took.length === 1 ? "s" : ""} ${id}.${ran.join("")}`);
  }
  const touched = [...fresh.map((t) => t.id), ...[...needing].filter((x) => !fresh.some((t) => t.id === x))];
  problems.push(...linkProblems(next, touched, given));
  problems.push(...threadClashes(next, fresh.map((t) => t.id)));
  if (!problems.length) problems.push(...underProblems(next, touched));
  const many = i.tasks.length > 1;
  if (problems.length) return form ? shaped("add", refusedAll(problems, many).error) : refusedAll(problems, many);
  const clashes = graphProblems(next);
  if (clashes.length) return refusedAll(clashes, many);
  const under = underWords(next, added);
  const path = criticalPath(next);
  // Open tasks that are one straight line are a checklist drawn as a graph (E41 P2 case 14): said once a graph, in place
  // of the critical path it is.
  const line = next.told?.includes("line") ? null : straightLine(next);
  if (line) next.told = [...(next.told || []), "line"];
  // A plan of steps with sub-tasks (11-06) is no checklist, however its steps line up.
  const after = line ? ` ${lineWords(line, crew, next.tasks.some((t) => t.under))}` : path.length > 1 ? ` Critical path still to go: ${path.join(" → ")}.` : "";
  // A plan of three or more with nothing kept behind it (11-09): its design lives in the conversation alone until a
  // compaction takes it — said once a graph, where notes can be kept.
  const design = kept && !kept[""] && added.length >= 3 && !next.told?.includes("design");
  if (design) next.told = [...(next.told || []), "design"];
  return { ok: true, graph: next, text: `Added ${added.map((t) => t.id).join(", ")}.${neededSaid.join("")}${under}${namesItsCheck(added, crew)}${runsWords(added, crew)}${threadWords(added, crew)}${foundWords(added)}${unprovenWords(added)} ${afterText(next, personAt)}${after}${meetsOnce(next, crew, { shared })}${design ? DESIGN_WORDS : ""}`, changed: true };
}

/** What an add of a plan with nothing kept behind it says once a graph (11-09). */
const DESIGN_WORDS = " Keep the design behind it: tasks keep with no id, titled Design.";

/** The fields a proposed task carries (the forked steer of 11-04): what it is, what it needs, what it writes and what
 *  shows it done. Who does it, and its check's commands, are the agent's to give as it takes the task on. */
const PROPOSE_FIELDS = Object.freeze(["name", "needs", "writes", "acceptance"]);

/**
 * Tasks the fork that weighed the person's message planned for the agent (the owner's forked steer of 11-04), added as
 * an add adds them, and each marked proposed: none is ready until the agent takes it on. A graph that is none yet, or
 * closed, starts with `goal`; an open one keeps the agent's own. The graph after it, or the refusal's words, the graph
 * left as it was.
 * `turn`: the chat's turn the person's message came in (11-09), kept on each task.
 * @param {Graph | null} graph @param {{ goal?: string, tasks: unknown[] }} input @param {{ at: number, crew: Crew, turn?: number | null }} o
 * @returns {Applied | Refusal}
 */
export function proposeTasks(graph, { goal = "", tasks }, { at, crew, turn = null }) {
  const open = !!graph && !graph.closed;
  const r = add(graph, { action: "add", goal: open ? "" : goal, tasks }, at, PROPOSE_FIELDS, crew, () => null, noThreads, noHunts, { neededBy: false, turn });
  if (!r.ok || !r.graph) return r;
  const had = new Set((graph && !graph.closed ? graph.tasks : []).map((t) => t.id));
  for (const t of r.graph.tasks) if (!had.has(t.id)) t.proposed = { from: "steer", at };
  return r;
}

/**
 * The open tasks of a graph as one straight line (E41 P2 case 14), in order: each needs the one before it and no other
 * open task, and none stands beside them — three or more of them. Null for any other shape.
 * @param {Graph} graph @returns {string[] | null}
 */
function straightLine(graph) {
  // A step stands for its sub-tasks here (11-06): the line is read on the top level.
  const open = graph.tasks.filter((t) => isOpen(t) && !t.under);
  if (open.length < 3) return null;
  const ids = new Set(open.map((t) => t.id));
  const needsOf = new Map(open.map((t) => [t.id, t.needs.filter((n) => ids.has(n))]));
  const roots = open.filter((t) => !needsOf.get(t.id)?.length);
  if (roots.length !== 1 || open.some((t) => (needsOf.get(t.id)?.length ?? 0) > 1)) return null;
  /** The task that needs each one. @type {Map<string, string>} */
  const nextOf = new Map();
  for (const t of open)
    for (const n of needsOf.get(t.id) || []) {
      if (nextOf.has(n)) return null;
      nextOf.set(n, t.id);
    }
  const line = [roots[0].id];
  for (let n = nextOf.get(line[0]); n; n = nextOf.get(n)) line.push(n);
  return line.length === open.length ? line : null;
}

/** What an add says of a straight line it left (E41 P2 case 14): real needs, or the checklist — which a lead has none of. @param {string[]} line @param {Crew} crew */
const lineWords = (line, crew, steps = false) =>
  `${line.length > 6 ? `${line.slice(0, 3).join(" → ")} → … → ${line.at(-1)} (${line.length} tasks)` : line.join(" → ")} is one straight line. Give a task only the needs it truly waits on: tasks that don't wait on each other can then run side by side.${led(crew) || steps ? "" : " If the work is a straight list, your checklist keeps it with less."}`;

/**
 * What an add says of the tasks of the planner's own it added that change files and say nothing that shows them done
 * (E41 P2 case 15): no acceptance, no check — their done could prove nothing. "" where none.
 * @param {readonly Task[]} added
 */
function unprovenWords(added) {
  // A step the same add gives sub-tasks proves nothing itself: they carry its done-when (11-06).
  const steps = new Set(added.map((t) => t.under));
  const ids = added.filter((t) => t.by === "you" && t.writes.length && !t.acceptance && !checkOf(t).length && !steps.has(t.id)).map((t) => t.id);
  if (!ids.length) return "";
  return ids.length === 1
    ? ` ${ids[0]} writes files and says no done-when: give it acceptance or a check, so its done can prove it.`
    : ` ${ids.join(", ")} write files and say no done-when: give each acceptance or a check, so its done can prove it.`;
}

/**
 * The ready tasks of the planner's own that can run side by side (HarnessV4_TaskGraphPlus_Plan E41 P3, cases 16–18,
 * GX-D5): each names the files it writes, and goes to a sub-agent of its own at once — in its own worktree, so two may
 * share a file, the second to land merging at its apply (the owner's of 11-09, g3b); the planner's own, done one at a
 * time, never meet. A task that names no writes is never one: what it may write is not known. Ready tasks need none of
 * each other. Not "the same step" (D1-5): ready tasks may sit in different ones. Fewer than two: none.
 * `skip`: tasks left out — those the person ignored on a card (`offerIgnored`). `o`: where the session's sub-agents share
 * its folder (`shared`), there are no copies to merge: one that writes a file a task before it in the set writes is left
 * out, as two would write there at once. `helping`: whether a helper is at work now — a task one works on is that
 * sub-agent's, and a card or a side run would start a second on it (the review of 67038d835); once it ended, the task
 * is the planner's again.
 * @param {Graph | null | undefined} graph @param {ReadonlySet<string>} [skip] @param {Sharing} [o] @param {HelperAtWork} [helping]
 * @returns {string[]}
 */
export function sideBySide(graph, skip = /** @type {ReadonlySet<string>} */ (new Set()), o = {}, helping = helpersWork) {
  if (!graph || graph.closed) return [];
  /** @type {Task[]} */
  const set = [];
  for (const t of ready(graph).filter((x) => x.by === "you" && x.writes.length && !skip.has(x.id) && !(x.helper && helping(x.helper.agent)))) if (!o.shared || set.every((a) => !sharedOf(a, t))) set.push(t);
  return set.length >= 2 ? set.map((t) => t.id) : [];
}

/** Ids in a sentence: "t3 and t4", "t3, t4 and t5". @param {readonly string[]} ids */
const andWords = (ids) => (ids.length > 1 ? `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}` : ids.join(""));

/**
 * What a tasks call's answer says of its ready tasks that can run side by side (E41 P3 case 16): which, and what to do.
 * `on`: Parallelize tasks is on — the person's consent (the owner's of 11-09) —, so it says to run them at once now,
 * unless one truly waits on another — sub-agents of the graph for your agent, Filament's agent tool for a coding agent
 * (`solo`), whose tasks are all its own, on its own model (the owner's word of 10-26: the work the planner laid out side
 * by side is the planner's model's). Off, the person has given no consent (the owner's of 11-10: a sub-agent started
 * on a task the agent does itself is the danger): the agent may suggest them to the person with `parallel`, a card whose
 * Accept starts them, or which starts them by itself after 60 seconds — a builder it
 * launches for one is held on a card the same way (the owner's of 11-14) —, else it does them itself, in order. Either
 * way the graph says only that they may (the owner's of 11-10: "only the agent should be able to judge itself about the
 * parallelism"): whether they should is the agent's call.
 * `bare`: those of them with no steps, which a card refuses (`suggestSide`) — the call it prints names the others,
 * where two or more are left, and the words say what these lack; else no call is printed, as none would be taken (the
 * review of 67038d835: the graph printed a call it then refused).
 * @param {readonly string[]} ids @param {boolean} solo @param {boolean} [on] @param {readonly string[]} [bare]
 */
const sideWords = (ids, solo, on = false, bare = []) => {
  const may = `The graph lets ${andWords(ids)} run side by side: none needs another's work. Whether they should is your call — truly independent, each worth a sub-agent of its own, none you are working on yourself.`;
  if (!on) {
    const card = "puts a card in the chat that starts each on a sub-agent on their Accept, or by itself after 60 seconds; a builder you launch for one yourself is held on a card the same way";
    if (!bare.length) return `${may} If so, suggest them to the person: ${JSON.stringify({ action: "parallel", ids })} ${card}. If not, do them yourself, in order.`;
    const one = bare.length === 1;
    const lack = `${andWords(bare)} ${one ? "has" : "have"} no steps, which the sub-agent a card starts is briefed with: give ${one ? "it" : "each"} goal and steps (tasks change)`;
    const full = ids.filter((id) => !bare.includes(id));
    return full.length >= 2
      ? `${may} If so, suggest ${andWords(full)} to the person: ${JSON.stringify({ action: "parallel", ids: full })} ${card}. ${lack} first to suggest ${one ? "it" : "them"} too. If not, do them yourself, in order.`
      : `${may} If so, ${lack}, then suggest them to the person with parallel and their ids, which ${card}. If not, do them yourself, in order.`;
  }
  const how = solo ? "give them to Filament's agent tool, one each, on your own model — name it in model, and the task in task, so the work you planned stays yours and its box shows who works on it" : "change them to by: sub-agent with goal, steps and acceptance — Filament starts each";
  return `${may} If so, Parallelize tasks is on, so run them at once now: ${how}; if not, go on.`;
};

/**
 * The loop's line in its graph's section while Parallelize tasks is on (the owner's of 11-09: "turning that on is
 * considered to be a consent"; "do in parallel if you think those are trully independent tasks"): the agent starts the
 * tasks that can run at once on sub-agents itself, and no card asks the person. Its main agent's alone — never a lead's,
 * whose workers' tasks Filament starts, nor a sub-agent's. One fixed sentence says where they edit both ways (the owner's
 * of 11-09, D5): the prompt is the same bytes whatever folder the chat's sub-agents work in.
 */
export const PARALLEL_CONSENT =
  "- Parallelize tasks is on: the person turned it on, and that is their consent. When tasks of your graph can run at once — truly independent: none needs another's work — give them to sub-agents yourself, now, without asking: by: sub-agent, each with its goal, steps and acceptance, and Filament starts them side by side. Each works in its own worktree, so they may share a file — unless the chat's sub-agents work in its folder: then tasks that share a file stay in order. Tasks that need each other stay in order.";

/** The mark `told` keeps of every task an answer said may run side by side, so each is said once. @param {readonly string[]} ids */
const sideMark = (ids) => `side:${ids.join(",")}`;
/** The tasks that mark holds. @param {Graph} graph @returns {Set<string>} */
const sideSaid = (graph) => {
  const was = (graph.told || []).find((m) => m.startsWith("side:"));
  return new Set(was ? was.slice(5).split(",").filter(Boolean) : []);
};
/**
 * The set a call's answer says may run side by side (`withSide`), or none: never a lead's, and only where one of them
 * was never said so. A done reads it before it writes its own words, so it names none of them a second time.
 * @param {Graph} graph @param {Crew} crew @param {boolean} [on] @param {Sharing} [o] @param {HelperAtWork} [helping] @returns {string[]}
 */
function sideToSay(graph, crew, on = false, o = {}, helping = helpersWork) {
  if (led(crew)) return [];
  // Never the tasks the person ignored on a card: those stay the agent's own (the hunt of side-card) — unless Parallelize
  // tasks is on, their consent since.
  const ids = sideBySide(graph, ignoredOf(graph, on), o, helping);
  const said = sideSaid(graph);
  return ids.some((id) => !said.has(id)) ? ids : [];
}

/**
 * A call's answer after it changed the graph (E41 P3 case 16): where its ready tasks of the planner's own can now run
 * side by side, and one of them was never said so, it says the set — each task once in the graph's life (FabeleHelper's
 * of 11-10: a set said again as each start or end changed it was noise; the standing block says it as it stands). A
 * lead's tasks are its workers', which Filament starts: never said to it. No card offers the set unless the agent
 * suggests it (`parallel`, the owner's of 11-10). `on`: Parallelize tasks is on, and the words say to run them now. `o`:
 * whether the session's sub-agents share its folder (`sideBySide`). `helping`: whether a helper is at work now.
 * @param {Applied} r @param {Crew} crew @param {boolean} solo @param {boolean} [on] @param {Sharing} [o] @param {HelperAtWork} [helping]
 * @returns {Applied}
 */
function withSide(r, crew, solo, on = false, o = {}, helping = helpersWork) {
  if (!r.changed || !r.graph) return r;
  const ids = sideToSay(r.graph, crew, on, o, helping);
  if (!ids.length) return r;
  const said = sideSaid(r.graph);
  const graph = { ...r.graph, told: [...(r.graph.told || []).filter((m) => !m.startsWith("side:")), sideMark([...said, ...ids.filter((id) => !said.has(id))])] };
  // A card's sub-agent is briefed with its task's steps, and a suggestion of one with none is refused (`suggestSide`).
  const byId = indexOf(graph);
  const bare = on ? [] : ids.filter((id) => !byId.get(id)?.steps.length);
  return { ...r, graph, text: `${r.text}\n${sideWords(ids, solo, on, bare)}` };
}

/** The mark `told` keeps of a task the person ignored on a card: it stays the planner's, in no later card by itself. @param {string} id */
const ignoredMark = (id) => `ignored:${id}`;
/**
 * The tasks the person ignored on a card: never said to the agent, the Plan or the standing block as ones to run side by
 * side — Ignore keeps them the agent's own, until the agent suggests them again, as the person asked in words. `on`:
 * Parallelize tasks is on, the person's consent given since (the review of 11-09): none is held back while it is.
 * @param {Graph | null | undefined} graph @param {boolean} [on] @returns {Set<string>}
 */
export const ignoredOf = (graph, on = false) => new Set(on ? [] : (graph?.told || []).filter((m) => m.startsWith("ignored:")).map((m) => m.slice(8)));

/**
 * How long the side-by-side card waits for the person's answer before it answers itself (the plan of 11-14: while
 * Parallelize tasks is off, a sub-agent that changes files starts on the person's yes on a card, or after this).
 */
export const SIDE_ANSWER_MS = 60_000;

/**
 * Why a card left unanswered keeps its tasks the agent's rather than starting them, or "" where it starts them: only
 * that no model is known for them to run on. Wherever they would work — each in its own copy, or the chat's folder
 * where no git repository holds it or its editing sub-agents work there — the card starts them, as an Accept would
 * (the owner's of 11-14: "if user don't accept or reject in 60 seconds then consider it to accept"; their choice, of
 * the review of fc944b32, to start them all).
 * @param {string | null | undefined} model
 */
export const sideTimeoutWhy = (model) => (model ? "" : "no model is known for them to run on");

/**
 * The agent's suggestion (the owner's of 11-10: the card is the agent's to put, never Filament's by itself; that the graph
 * lets tasks run at once does not say they should — the agent judges): the tasks it names become the card after turn
 * `turn`, in the graph's order — one the person ignored on a card before too: the agent asks again, and the person
 * chooses again. A newer card takes an older one's place. Only what cannot be is refused, in words: a plan that waits for
 * the person's Approve, fewer than two, a task that is none, one that is not the agent's own or not ready (its needs
 * done, not started), one a sub-agent the agent launched for it works on now (`helping`), one with no steps, whose
 * sub-agent would get its name alone, or two that write one file where the session's sub-agents share its folder, and
 * would write it at once. The card answers itself `SIDE_ANSWER_MS` after it is put (the plan of 11-14): it starts them
 * on `model`, the turn's or the chat's, where one is known, else they stay the agent's (`sideTimeoutWhy`).
 * @param {Graph} graph @param {readonly string[]} ids @param {{ at: number, turn?: number | null, shared?: boolean, helping?: HelperAtWork, model?: string | null }} o
 * @returns {{ ok: true, graph: Graph, ids: string[] } | { ok: false, error: string }}
 */
export function suggestSide(graph, ids, { at, turn = null, shared, helping = helpersWork, model = null }) {
  // A plan that waits for the person's Approve (11-06) starts nothing: no card stands while it waits.
  if (graph.planning) return { ok: false, error: "the plan waits for the person's Approve: suggest nothing to start until it goes" };
  const want = [...new Set(ids)];
  if (want.length < 2) return { ok: false, error: "name two or more ready tasks of yours that can run at once" };
  const byId = indexOf(graph);
  const none = want.filter((id) => !byId.has(id));
  if (none.length) return { ok: false, error: `${andWords(none)} ${none.length === 1 ? "is no task" : "are no tasks"} in the graph` };
  const own = ready(graph).filter((t) => t.by === "you");
  const not = want.filter((id) => !own.some((t) => t.id === id));
  if (not.length) return { ok: false, error: `${andWords(not)} ${not.length === 1 ? "is not a ready task" : "are not ready tasks"} of yours: a card offers your own tasks whose needs are done and that have not started` };
  const picked = own.filter((t) => want.includes(t.id));
  // One that carries a helper at work — a graph kept before a launch was refused for a task that cannot start yet
  // (`helperRefusal`) — is that sub-agent's: the card's Accept would start a second one on it (the review of 67038d835).
  const helped = picked.find((t) => t.helper && helping(t.helper.agent));
  if (helped) return { ok: false, error: `${helped.id} has the sub-agent ${helped.helper?.agent} at work on it, launched for it: a card would start a second one on it — suggest it once that one has ended, or leave it out` };
  // Its Accept starts each on a sub-agent, briefed with the task's goal and steps (`claimSide`): one with no steps would
  // get its name alone (FabeleHelper's of 11-10).
  const bare = picked.filter((t) => !t.steps.length).map((t) => t.id);
  if (bare.length)
    return { ok: false, error: `${andWords(bare)} ${bare.length === 1 ? "has" : "have"} no steps: a sub-agent the card starts would get ${bare.length === 1 ? "its" : "their"} name alone — give ${bare.length === 1 ? "it" : "each"} goal and steps (tasks change), then suggest again` };
  // Where the session's sub-agents share its folder, two that write one file would write it there at once (g1).
  if (sharingOf(graph, { shared }).shared)
    for (const [i, a] of picked.entries())
      for (const b of picked.slice(i + 1)) {
        const both = sharedOf(a, b);
        if (both) return { ok: false, error: `${a.id} and ${b.id} both write ${both.files.join(", ")}, and this chat's sub-agents work in its folder, where they would write it at once: suggest one of them` };
      }
  const order = picked.map((t) => t.id);
  const told = (graph.told || []).filter((m) => !(m.startsWith("ignored:") && order.includes(m.slice(8))));
  const why = sideTimeoutWhy(model);
  /** @type {SideOffer} */
  const offer = { ids: order, at, turn: Number(turn) || 0, model: model || null, until: at + SIDE_ANSWER_MS, onTimeout: why ? "decline" : "accept", ...(why ? { why } : {}) };
  const next = { ...graph, offer };
  if (told.length) next.told = told;
  else delete next.told;
  return { ok: true, ids: order, graph: next };
}

/**
 * What a suggestion's answer says (the owner's of 11-10): where the card is, what its buttons do, that it answers itself
 * after 60 seconds (the owner's of 11-14), and to do none of its tasks' work until it is answered — an Ignore is told to
 * the agent too (`ignoredNote`, the review of ef73c2a9d). A task that names no writes runs read-only on Accept
 * (`sideRun`, an explorer): said, so one meant to change files names them first.
 * @param {readonly string[]} ids @param {readonly string[]} [quiet]  those that name no writes
 */
const suggestedWords = (ids, quiet = []) =>
  `Suggested ${andWords(ids)} to the person on a card in the chat: its Accept starts each on a sub-agent, its Ignore keeps them yours, and with no answer it answers itself in 60 seconds. Do none of their work until it is answered — go on with your other work, or end your turn where none is left: the answer is told to you.${
    quiet.length ? ` ${andWords(quiet)} ${quiet.length === 1 ? "names" : "name"} no writes, so on Accept ${quiet.length === 1 ? "it runs" : "they run"} read-only: ${quiet.length === 1 ? "it reads and reports" : "each reads and reports"}, changing nothing. If ${quiet.length === 1 ? "it changes" : "one changes"} files, name them (change, writes): the card shows ${quiet.length === 1 ? "it" : "each"} as it stands.` : ""
  }`;

/**
 * What the agent hears of the person's Ignore (the review of ef73c2a9d): the card it was told to leave its tasks for is
 * gone, and they are its own again. `on`: Parallelize tasks is on — the card stood from before it went on —, where a
 * suggestion is refused whoever asks (`tasksCall`): the note says that, never to suggest again where the person asks
 * (the review of 67038d835).
 * @param {readonly string[]} ids @param {boolean} [on]
 */
export const ignoredNote = (ids, on = false) =>
  `[Filament: the person ignored the card that suggested ${andWords(ids)}: ${ids.length === 1 ? "it stays" : "they stay"} yours — do ${ids.length === 1 ? "it" : "them"} yourself, as you planned; ${
    on ? `Parallelize tasks is on, so no card can suggest ${ids.length === 1 ? "it" : "them"} again` : `suggest ${ids.length === 1 ? "it" : "them"} again only if the person asks`
  }]`;

/**
 * What the agent hears where the card answered itself (the plan of 11-14): no answer came in 60 seconds
 * (`SIDE_ANSWER_MS`), and it started `ids` on sub-agents, as an Accept does — or, `why`, it started nothing, and the
 * tasks it offered stay the agent's, as an Ignore keeps them.
 * @param {readonly string[]} ids @param {string} [why]
 */
export const sideTimedNote = (ids, why) =>
  why
    ? `[Filament: the card that suggested ${andWords(ids)} had no answer in 60 seconds, and ${why}, so nothing started: ${ids.length === 1 ? "it stays" : "they stay"} yours — do ${ids.length === 1 ? "it" : "them"} yourself, as you planned; suggest ${ids.length === 1 ? "it" : "them"} again only if the person asks]`
    : `[Filament: the card that suggested ${andWords(ids)} had no answer in 60 seconds, so it started ${ids.length === 1 ? "it on a sub-agent" : "them on sub-agents"} by itself; leave ${ids.length === 1 ? "it" : "them"} — ${ids.length === 1 ? "its report comes" : "their reports come"} to you]`;

/**
 * Whether the card still stands: each task it offered is the planner's own and ready still — none claimed, started,
 * dropped or waiting on another since — and the plan is not being reworked: a plan that waits for the person's Approve
 * starts nothing (the owner's of 11-06), so no card stands then — a planning turn's change lets it go for good, and the
 * agent suggests again once the plan goes (the review of ef73c2a9d).
 * @param {Graph | null | undefined} graph
 */
function offerStands(graph) {
  const o = graph?.offer;
  if (!graph || graph.closed || graph.planning || !o || o.ids.length < 2) return false;
  const own = new Set(ready(graph).filter((t) => t.by === "you").map((t) => t.id));
  return o.ids.every((id) => own.has(id));
}

/**
 * The card as the transcript draws it (Phase 5): its tasks, each with its name and the files it writes, when it was
 * offered and the turn it stands after — and when it answers itself and how (the plan of 11-14), so every page counts
 * down from the server's deadline. Null where none stands.
 * @param {Graph | null | undefined} graph
 * @returns {(Omit<SideOffer, "model"> & { tasks: { id: string, name: string, writes: string[] }[] }) | null}
 */
export function sideOfferOf(graph) {
  if (!graph || !offerStands(graph)) return null;
  const o = /** @type {SideOffer} */ (graph.offer);
  const byId = indexOf(graph);
  const tasks = o.ids.map((id) => {
    const t = /** @type {Task} */ (byId.get(id));
    return { id, name: t.name, writes: [...t.writes] };
  });
  const answers = typeof o.until === "number" && o.onTimeout ? { until: o.until, onTimeout: o.onTimeout, ...(o.why ? { why: o.why } : {}) } : {};
  return { ids: [...o.ids], at: o.at, turn: o.turn, ...answers, tasks };
}

/**
 * The developer's Ignore (Phase 5): the card goes, each of its tasks kept as ignored — the planner's to do, never said
 * to it again as ones to run side by side (`withSide`) until it suggests them again. `at` names the card: another card took the place
 * of one whose `at` differs. Null where that card stands no more — its tasks started, changed, the plan reworked
 * (`cardGone`, as an Accept's; the hunt of side-card: a page that had not heard the graph Ignored a card gone since).
 * `on`: Parallelize tasks is on — the card stood from before it went on —, so the card goes and nothing is marked: no
 * mark holds under the person's consent, and one kept would hold the tasks back, unseen, once it goes off (the review
 * of 11-09).
 * @param {Graph | null | undefined} graph @param {number} at @param {boolean} [on] @returns {Graph | null}
 */
export function offerIgnored(graph, at, on = false) {
  if (!graph?.offer || cardGone(graph, at)) return null;
  const told = graph.told || [];
  const next = on ? { ...graph } : { ...graph, told: [...told, ...graph.offer.ids.map(ignoredMark).filter((m) => !told.includes(m))] };
  delete next.offer;
  return next;
}

/**
 * Why a card's Accept starts nothing (the owner's of 11-06: a card may stand for hours): the card it names is not the
 * one that stands now — its tasks started, changed or were ignored since, another card took its place, or the plan
 * waits for the person's Approve. Null where it stands. `nothing`: what was not done — an Ignore's "nothing ignored".
 * @param {Graph | null | undefined} graph @param {number} at @param {string} [nothing]
 */
export function cardGone(graph, at, nothing = "nothing started") {
  if (offerStands(graph) && graph?.offer?.at === at) return null;
  return graph?.planning
    ? `that card is gone: the plan is being reworked and waits for your Approve — ${nothing}`
    : `that card is gone: its tasks were started, changed or ignored since, or another card took its place — ${nothing}; the Plan shows them as they are now`;
}

/** Why a chat's agent has no task graph to plan on, as `/plan`'s line says it. @param {"plain" | "words" | "agent"} off */
const noGraphWhy = (off) =>
  off === "agent"
    ? "this chat's coding agent takes no MCP server over HTTP, and Filament's task graph reaches a coding agent that way alone"
    : off === "words"
      ? "this chat's model takes no tools"
      : "this chat is a plain chat, whose model runs no tools";

/**
 * The line ahead of a `/plan` message (the owner's of 11-05: "ask the agent to plan out the whole thing in todo or task
 * graph based on the complexity... prepare the whole graph with a summary of the whole plan"): plan the work whole, by
 * its size — the checklist for a short job, the graph for complex work, the plan's summary kept behind it —, start none
 * of it, and end the reply with the summary; Filament's card after it opens the Plan, with Approve and Amend. The turn
 * is read-only (the owner's plan mode of 11-06). How deep it goes is in the person's words, in any language — the
 * line says what a light and a deep plan are, and the agent weighs their words: Filament reads none of them. `side`:
 * Parallelize tasks is on in Settings › Experimental — their consent (the owner's of 11-09): the tasks that wait on no
 * other go to sub-agents, and start at once when the plan is approved. Where the chat's agent has no task graph (`off`),
 * it plans in its reply.
 * @param {{ off?: false | "plain" | "words" | "agent", side?: boolean }} [o]
 */
export function planAskLine({ off = false, side = false } = {}) {
  if (off) return `[Filament: the person typed /plan, asking you to plan the work before any of it starts — but ${noGraphWhy(off)}, so you have no checklist or task graph. Plan it in your reply: the steps in order, what each changes, what is still open; start none of it. ${PLAN_WORDS_WHERE}]`;
  return [
    "[Filament: the person typed /plan. Plan the work before any of it starts — read what you need, then plan it whole, by its size:",
    "- Steps you take yourself one after another: on your checklist.",
    `- Work that branches (a step with steps of its own), or is otherwise complex: on your task graph — its goal; each task with the tasks it needs, the files it writes and the check that proves it done; a big part as a step, its pieces sub-tasks under it; and the plan's summary kept behind the graph (keep, titled "${PLAN_NOTE}").`,
    "- Where their words ask for a light plan: a few tasks, a line each, no notes behind them. For a deep one: map the code widely first — sub-agents that read, side by side, where it is big —, weigh the ways to do it and keep the one you chose with its why, and give each task its risks and the tests that prove it, in a note behind it. Weigh what they ask against the work.",
    ...(side ? ["- Parallelize tasks is on, which is their consent: give each task only the needs it truly waits on and the files it writes, and put the ones that wait on no other on sub-agents (by: sub-agent), so they start at once when the person approves the plan — a coding agent then gives each to Filament's agent tool."] : []),
    `This turn is read-only: read and search all you need, but change no file and start no task — the person approves the plan first. End your reply with its summary — what gets done, in what order, what is still open. Filament shows them a card that opens the Plan, with Approve and Amend. ${PLAN_WORDS_WHERE}]`,
  ].join("\n");
}

/**
 * Where a `/plan`'s work is said (the owner's of 11-06): its words after /plan, or — the offer card's Plan sends /plan
 * with how deep alone, never the message again — the message before it, which the agent has right above.
 */
const PLAN_WORDS_WHERE = "Their words, if any, follow /plan in their message below; where those say only how deep, or nothing, plan the work their message before it asks for.";

// The line that rode ahead of a message of the person's own while Parallelize tasks was on (piece D), until the
// system prompt said it once (the owner's of 11-09, `PARALLEL_CONSENT`): standing words, kept with the ask line in
// core/messages.js, whose readers leave both out of the messages that carried it.
export { SIDE_BY_SIDE_LINE } from "./messages.js";

/** The title of the note a `/plan` keeps behind its graph: the plan's summary. */
export const PLAN_NOTE = "Plan";

/**
 * What a `/plan`'s card says of the plan its turn made (the owner's of 11-05: "a card asking that graph is ready to view
 * which just opens the Plan tab"): the open tasks it added since `since` — the agent's own (`tasks`) and its checklist's
 * items (`steps`, p1, p2, …) —, or, where it added none but changed the graph since its `rev`, the graph's open tasks (a
 * re-plan of work on it); and the graph's goal. None where it made no plan — it asked first, or planned in its reply —,
 * and never the tasks done before it. A step is counted by its sub-tasks, as the graph beside it counts it.
 * @param {Graph | null | undefined} graph @param {{ since?: number, rev?: number | null }} [o]
 * @returns {{ tasks: number, steps: number, goal: string }}
 */
export function planReadyOf(graph, { since = 0, rev = null } = {}) {
  const none = { tasks: 0, steps: 0, goal: "" };
  if (!graph || graph.closed || !Array.isArray(graph.tasks)) return none;
  const kids = kidsOf(graph);
  const open = graph.tasks.filter((t) => t.state !== "done" && t.state !== "dropped" && !kids.has(t.id));
  const fresh = open.filter((t) => Number(t.addedAt) >= since);
  const counted = fresh.length ? fresh : rev != null && Number(graph.rev) !== rev ? open : [];
  /** A checklist's own item, not a task of the graph's the checklist names. @param {Task} t */
  const step = (t) => !!t.checklist && /^p\d+$/.test(t.id);
  return counted.length ? { tasks: counted.filter((t) => !step(t)).length, steps: counted.filter(step).length, goal: String(graph.goal || "") } : none;
}

/**
 * The claim's words (10-28): what the planner hears of the developer's side run, and what a start, a change or a drop
 * of a claimed task is refused in. `later`: their launches wait for the planner's turn to end.
 * @param {readonly string[]} ids @param {boolean} later
 */
export const sideNote = (ids, later) =>
  later
    ? `[Filament: the developer gave ${andWords(ids)} to sub-agents, which start when your turn ends; leave ${ids.length === 1 ? "it" : "them"} — ${ids.length === 1 ? "its report comes" : "their reports come"} to you]`
    : `[Filament: the developer started ${andWords(ids)} on sub-agents; leave ${ids.length === 1 ? "it" : "them"} — ${ids.length === 1 ? "its report comes" : "their reports come"} to you]`;

/**
 * What the planner hears where a side run's launch it was told of never came (10-28): a restart came first, or — `why`
 * — the launch was refused at the turn's end (the Hunter's of 10-28); the tasks are its own again.
 * @param {readonly string[]} ids @param {string} [why]
 */
export const sideBackNote = (ids, why) =>
  `[Filament: ${why ? `the developer's side run of ${andWords(ids)} could not start (${why})` : `a Filament restart came before the developer's side run of ${andWords(ids)} started`}, so ${ids.length === 1 ? "it is" : "they are"} yours again, as you left ${ids.length === 1 ? "it" : "them"}]`;

/** A side run's claim let go before its launch: the task is its planner's again, its brief as it left it. @param {Task} t */
const giveBack = (t) => {
  if (!t.side) return;
  Object.assign(t, { by: "you", ...t.side.was });
  delete t.side;
};

/**
 * The side run's tasks whose launches were refused (the Hunter's of 10-28: one refused failed its task while the others
 * ran, and the sheet said all had started): each still waiting for its launch goes back to its planner, as restart does.
 * Null where none of them waits for its launch. @param {Graph | null} graph @param {readonly string[]} ids
 */
export function sideBack(graph, ids) {
  if (!graph || !ids.length) return null;
  const next = structuredClone(graph);
  let any = false;
  for (const t of next.tasks)
    if (ids.includes(t.id) && t.side?.pending && t.state === "waiting") {
      giveBack(t);
      any = true;
    }
  return any ? next : null;
}

/** A claimed task's refusal, in the claim's words. @param {Task} t */
const claimedWords = (t) =>
  t.side?.pending && t.side.starts === "turn"
    ? `the developer gave ${t.id} to a sub-agent, which starts when your turn ends; leave it — its report comes to you`
    : `the developer started ${t.id} on a sub-agent; leave it — its report comes to you`;

/**
 * The developer's side run (the Designer's of 10-27, built 10-28): the tasks they picked on the Plan page go to
 * sub-agents of their own — each on the model they chose, in its own copy or their folder, a change in its copy waiting
 * there for its apply as every worker's does (the owner's of 11-02) — all or none. Each must be the planner's own and ready; a team's lead's graph has
 * workers for that. Two in their folder at once may not write one file (g1): writes are a forecast elsewhere. The brief they edited stands, else the task's own — its name the
 * goal where it has none. Each task keeps the claim (`side`), pending until its launch (`launched`). `card`: the
 * side-by-side card's Accept, by the card's `at` — it starts its own tasks while that card stands, else nothing
 * (`cardGone`): one pressed hours after it was drawn starts only what it still offers. `shared`: the session's sub-agents
 * share its folder, the live word (`sharingOf`). `helping`: whether a helper is at work now — a ready task one works
 * on is refused, as a second sub-agent would start on it (the review of 67038d835).
 * @param {Graph | null} graph @param {readonly SidePick[]} picks @param {{ at: number, crew: Crew, starts: "now" | "turn", card?: number, shared?: boolean, helping?: HelperAtWork }} o
 * @returns {{ ok: true, graph: Graph } | { ok: false, error: string, gone?: true }}  `gone`: the card named stands no more
 */
export function sideRun(graph, picks, { at, crew, starts, card, shared, helping = helpersWork }) {
  if (card !== undefined) {
    const gone = cardGone(graph, card);
    if (gone) return { ok: false, error: gone, gone: true };
  }
  if (!graph || graph.closed) return { ok: false, error: "this chat has no open task graph" };
  if (led(crew)) return { ok: false, error: "a team's lead plans this graph: its workers take its tasks" };
  if (!picks.length) return { ok: false, error: "no task is picked" };
  if (card !== undefined) {
    const other = picks.filter((p) => !graph.offer?.ids.includes(p.id)).map((p) => p.id);
    if (other.length) return { ok: false, error: `the card offers ${andWords(graph.offer?.ids || [])}, not ${andWords(other)} — nothing started` };
  }
  const next = structuredClone(graph);
  const byId = indexOf(next);
  const now = new Set(ready(next).map((t) => t.id));
  /** @type {string[]} */
  const problems = [];
  /** @type {Task[]} */
  const going = [];
  for (const p of picks) {
    const t = byId.get(p.id);
    if (going.some((g) => g.id === p.id)) problems.push(`${p.id} is picked twice`);
    else if (!t) problems.push(`${p.id} is no task in the graph`);
    else if (t.by === COMMAND) problems.push(`${p.id} is a command task: Filament runs it itself`);
    else if (t.by !== "you") problems.push(`${p.id} is ${claimed(t) ? "the developer's side run already" : whose(t.by)} — only the planner's own task goes to a sub-agent here`);
    else if (!now.has(p.id)) problems.push(t.state !== "waiting" ? `${p.id} is ${stateWord(t)} — only a task that waits to start goes to a sub-agent` : notReady(t, byId, "start") || sideBlock(next, t));
    else if (t.helper && helping(t.helper.agent)) problems.push(`${p.id} has the sub-agent ${t.helper.agent} at work on it, which the agent launched for it — only a task nobody works on goes to a sub-agent here`);
    else going.push(t);
    if (!p.model || typeof p.model !== "string") problems.push(`${p.id}: name the model its sub-agent runs on`);
    if (p.effort !== undefined && !SUBAGENT_EFFORTS.includes(/** @type {any} */ (p.effort))) problems.push(`${p.id}: how hard it thinks is one of ${SUBAGENT_EFFORTS.join(", ")}`);
    if (p.folder !== "copy" && p.folder !== "yours") problems.push(`${p.id}: it works in its own copy or your folder`);
    for (const long of [over(`${p.id}: goal`, text(p.goal), LIMIT.taskGoal), over(`${p.id}: acceptance`, text(p.acceptance), LIMIT.acceptance), ...(p.steps || []).map((s, k) => over(`${p.id}: step ${k + 1}`, text(s), LIMIT.step))]) if (long) problems.push(long);
    if ((p.steps || []).length > MAX_STEPS) problems.push(`${p.id}: up to ${MAX_STEPS} steps`);
  }
  // Two in their folder at once that write one file (g1): the one guard writes keep, where it happens — each would write
  // over the other's edits. Every hand at work there now counts too, as `apart` reads where each works (the review of
  // g1): a side run's, the agent at work on one of its own, a coding agent's helper there, a worker launched there — or
  // not said where, the session's sub-agents sharing it. In its own copy, a change merges at its apply.
  const mine = going.filter((t) => picks.some((p) => p.id === t.id && p.folder === "yours"));
  const steps = kidsOf(next);
  const sharing = sharingOf(next, { shared });
  const there = next.tasks.filter((t) => !going.includes(t) && !steps.has(t.id) && t.writes.length && (claimed(t) || t.state === "running") && !apart(t, sharing));
  for (let a = 0; a < mine.length; a++)
    for (const b of [...mine.slice(a + 1), ...there]) {
      const s = sharedOf(mine[a], b);
      if (s) problems.push(`${mine[a].id} and ${b.id} ${s.maybe ? "may both write" : "both write"} ${fewFiles(s.files)}, both in your folder at once: one would write over the other's edits — run one in its own copy, or one at a time`);
    }
  if (problems.length) return { ok: false, error: problems.join("; ") };
  for (const p of picks) {
    const t = /** @type {Task} */ (byId.get(p.id));
    const steps = Array.isArray(p.steps) ? p.steps.map((s) => text(s)).filter(Boolean) : t.steps;
    t.side = { at, model: p.model, ...(p.effort ? { effort: p.effort } : {}), folder: p.folder, starts, pending: true, was: { goal: t.goal, steps: [...t.steps], acceptance: t.acceptance } };
    Object.assign(t, { by: t.writes.length ? "sub-agent" : "explorer", goal: text(p.goal) || t.goal || t.name, steps, acceptance: p.acceptance === undefined ? t.acceptance : text(p.acceptance) });
  }
  // The side-by-side card that offered any of them is answered: it goes, whether its Accept or the Plan page's sheet ran them.
  if (next.offer?.ids.some((id) => picks.some((p) => p.id === id))) delete next.offer;
  return { ok: true, graph: next };
}

/**
 * Why a coding agent's launch may not name this task (10-28), or null: the planner's own, open and not the developer's
 * side run — a task another runs, or one done, is no helper's. Nor one whose needs are not done: it cannot start, so
 * the helper kept on it waited with it, and once its needs were done it read as nobody's — a card or a side run gave
 * it a second sub-agent (the review of 67038d835). @param {Graph | null} graph @param {string} id
 */
export function helperRefusal(graph, id) {
  if (!graph || graph.closed) return `task names a task of your graph, and this chat has no open one: leave task out`;
  const t = graph.tasks.find((x) => x.id === id);
  if (!t) return `${id} is no task in your graph: name one of its open tasks, or leave task out`;
  if (claimed(t)) return claimedWords(t);
  if (t.by !== "you") return `${id} is ${t.by === COMMAND ? "a command task, Filament's own" : whose(t.by)} — task names one of your own`;
  if (t.state === "done" || t.state === "dropped" || t.state === "checking") return `${id} is ${stateWord(t)} — task names one that is still to do`;
  const waits = t.state === "waiting" || t.state === "paused" ? notReady(t, indexOf(graph), "start") : null;
  if (waits) return `${waits} — task names one that can start now, or leave task out`;
  const ks = kidsOf(graph).get(id);
  if (ks) return `${id} is a step with sub-tasks (${fewIds(ks.map((k) => k.id), 5)}), which do its work — task names the one the helper takes`;
  return null;
}

/**
 * Why a waiting task whose needs are done is not ready for a side run (the review of 11-06): a step, whose sub-tasks do
 * its work; one stopped; one proposed. @param {Graph} graph @param {Task} t
 */
function sideBlock(graph, t) {
  const ks = kidsOf(graph).get(t.id);
  if (ks) return `${t.id} is a step with sub-tasks (${fewIds(ks.map((k) => k.id), 5)}), which do its work — run one of them`;
  if (t.stopped) return `${t.id} was stopped — it waits for the next tasks call of whoever plans`;
  return t.proposed ? `${t.id} is only proposed — the agent has not taken it on` : `${t.id} can't start now`;
}

/**
 * A coding agent's launch named a task of its own (10-28): the task keeps who works on it — its box says so — and one
 * that waited to start runs from now, as the planner's own start of it would. Null where the launch may not name it.
 * @param {Graph} graph @param {string} id @param {TaskHelper} helper
 */
export function helperTook(graph, id, helper) {
  if (helperRefusal(graph, id)) return null;
  const w = withTask(graph, id);
  if (!w) return null;
  w.t.helper = { ...helper };
  // A task proposed from the person's message is taken on.
  delete w.t.proposed;
  if (w.t.state === "waiting" && !notReady(w.t, indexOf(w.next), "start")) Object.assign(w.t, { state: "running", why: "", startedAt: helper.at });
  return w.next;
}

/** The tasks the developer's side run gave sub-agents whose launches wait still (10-28). @param {Graph | null} graph */
export const sidePending = (graph) => (graph ? graph.tasks.filter((t) => t.side?.pending && t.state === "waiting").map((t) => t.id) : []);

/** Whether a task failed because its change did not merge, the change waiting still in its copy (10-28). @param {Task} t */
const unmerged = (t) => t.state === "failed" && t.failures?.cause === "merge";
/**
 * Whether a worker's change waits in its copy for an apply that ends its task: ready (`yours`), or its task failed with
 * the change there — one that did not merge, one the folder's check undid, one its own check failed — which its
 * planner's apply takes in as it stood. A mark of it as applied, where whoever plans brought it in itself, ends its task
 * as an apply does (the bug report of 11-10). @param {Task} t
 */
const waitsApply = (t) => t.by !== "you" && (yours(t) || (t.state === "failed" && !!t.report?.files.length));
/** What becomes of a change that did not merge, in the words its planner hears (the Hunter's of 10-28). */
const UNMERGED_WAYS =
  "It waits in its worker's copy: apply it again once the files it overlaps in the folder are as its change needs them, or the developer resolves it from Changes — their choice for each file that overlaps theirs, or Send back to rebase, which redoes it on the folder as it is now and gives it back to its worker.";
/**
 * How whoever plans applies a worker's change that waits (the owner's of 11-02): the agent's — a coding agent's too —
 * through its agent tool, a team's lead through its worker tool. @param {Crew} crew @param {string} agent
 */
const applyWords = (crew, agent) => `${led(crew) ? "worker" : "agent"} with agent_id "${agent}" and apply_changes: true`;
/**
 * The ways on a change whose merge overlapped the folder's edits (the owner's of 11-09): its apply again with
 * `overlap` — a lead's takes send_back alone, as its applies are checked. @param {Crew} crew @param {string} agent
 */
const overlapWays = (crew, agent) =>
  led(crew)
    ? `Apply it with overlap — worker with agent_id "${agent}", apply_changes: true and overlap: "send_back" has its worker redo it on the folder as it stands.`
    : `Apply it with overlap — agent with agent_id "${agent}", apply_changes: true and overlap: "markers" writes it all, git's conflict markers in the files that overlap for you to resolve; "mine" keeps your folder's version of those, its change to them set aside; "send_back" has its sub-agent redo it on your folder as it stands.`;

/**
 * Whether `agent`'s change waits for an apply in the graph (the owner's of 11-02): ready in its copy, or one that did not
 * merge. Its thread is then kept across a restart, as a helper's is.
 * @param {Graph | null} graph @param {string} agent
 */
export const waitsForYou = (graph, agent) => !!graph?.tasks.some((t) => t.agent === agent && (yours(t) || unmerged(t)));

/**
 * A worker's change waits for its apply, and the developer applied it (10-28) — from the band or the thread: the task is
 * done, as a merge's is, unchecked — their press is their word. And a task whose change did not merge, which the developer
 * applied with their own choices for the files that overlapped theirs (the Designer's of 10-27, built 10-28): done too,
 * its summary saying so; so is one that failed otherwise with its change in its copy, brought in as it stood. A mark of
 * it as applied ends it the same way (the bug report of 11-10). Null for any other task. `marked`: the files it left
 * with git's conflict markers in the folder — the developer's "both", or a rebase's not yet resolved — which its summary
 * names for its planner (the Hunter's of 10-28: the task read as done and clean).
 * @param {Graph} graph @param {string} agent @param {readonly { path: string, added: number, removed: number }[]} files @param {number} at
 * @param {readonly string[]} [marked]
 */
export function sideApplied(graph, agent, files, at, marked = []) {
  const t = graph.tasks.find((x) => x.agent === agent && waitsApply(x));
  if (!t) return null;
  const markers = marked.length ? `\nGit's conflict markers stand in ${listed([...marked.slice(0, 10), ...(marked.length > 10 ? [`${marked.length - 10} more`] : [])])}, for the developer to resolve.` : "";
  // Its box names them too, so a done task never reads as applied clean (the Hunter's of 10-28).
  const named = marked.length ? { marked: marked.slice(0, 10) } : {};
  if (yours(t)) {
    const next = taskMerged(graph, t.id, files, at);
    const done = next && markers ? indexOf(next).get(t.id) : null;
    if (done) {
      done.summary = `${done.summary}${markers}`.trim();
      if (done.merged) Object.assign(done.merged, named);
    }
    return next;
  }
  const w = /** @type {NonNullable<ReturnType<typeof withTask>>} */ (withTask(graph, t.id));
  const merged = { files: files.length, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0), ...named };
  const how = unmerged(t) ? "Its change did not merge as it stood; the developer applied it with their own choices." : "Its task had failed; its change was brought into the folder as it stood.";
  Object.assign(w.t, { state: "done", step: null, why: "", summary: `${w.t.report?.did || ""}\n${how}${markers}`.trim(), merged, endedAt: at, gate: null });
  broughtIn(w.next, t.id, files);
  return w.next;
}

/**
 * Why a mark of `agent`'s change as applied can't end its task now, or null where it can (the bug report of 11-10: a
 * change its planner brought in by hand left its task merging, every way out refused): its change waits for an apply
 * (`waitsApply`), which the mark stands for (`sideApplied`) — or no task of the graph's waits on that worker's change,
 * which makes its mark no graph's. Else in an apply's refusal words: its worker at work, its change in review, merging,
 * or going back to its worker. @param {Graph | null} graph @param {string} agent
 */
export function markRefusal(graph, agent) {
  const t = graph?.tasks.find((x) => x.agent === agent && x.by !== "you" && (x.state === "running" || x.state === "review" || x.state === "merging"));
  if (!graph || !t || waitsApply(t)) return null;
  const asked = applyAsked(graph, agent);
  return asked && !asked.ok ? asked.error : `task ${t.id}'s change is merging into your folder now — wait for its end`;
}

/**
 * Whose word a change went in on as it stood, with its reason where one was given: "on the agent's word: …", "on the
 * lead's word". @param {Task} t
 */
const asItStood = (t) => `as it stood, on ${t.overruledBy === "planner" ? "the agent's" : "the lead's"} word${t.overruled ? `: ${t.overruled}` : ""}`;
/** Its planner asked its change in as it stood, giving no reason. @param {Task} t */
const stoodBare = (t) => t.overruledBy === "planner" && !t.overruled;
/** A task's change goes in on nobody's word: a new try of it, or one sent back. @param {Task} t */
const unruled = (t) => {
  t.overruled = "";
  delete t.overruledBy;
};

/**
 * The main agent — or a team's lead — applies the change of `agent`'s task (the owner's of 11-02): one ready in its copy,
 * one that did not merge and is tried again, or a failed one's that waits in its copy — merged as it stands, on the
 * word of `by`, who applied it (G3-4) — merges now: the graph's merge, the folder checked with it (V2-2), and its end
 * told with the check's verdict. `reason`: why a change whose check failed goes in all the same. A failed one's, or one
 * with a reason, is asked in as it stood (`overruledBy`). One whose merge runs already is that merge. Null where no
 * task of the graph's waits on `agent`'s change — its apply is no graph's; a refusal, in words, where its task holds
 * that worker for another step.
 * @param {Graph} graph @param {string} agent @param {{ reason?: string | null, by?: "lead" | "planner" }} [o]
 * @returns {{ ok: true, id: string, graph: Graph } | { ok: false, error: string } | null}  `graph` the one given where it
 *   merges already
 */
export function applyAsked(graph, agent, { reason = null, by = "planner" } = {}) {
  const t = graph.tasks.find((x) => x.agent === agent && x.by !== "you" && (x.state === "running" || x.state === "review" || x.state === "merging" || x.state === "failed"));
  const failed = !!t && t.state === "failed" && !unmerged(t);
  if (!t || (failed && !t.report?.files.length)) return null;
  if (t.state === "running") return { ok: false, error: `its worker is still at work on task ${t.id}: its change waits for its report` };
  if (t.state === "review") return { ok: false, error: `task ${t.id}'s change is in review: it is ready to apply once its reviewer finds it does what the task asks` };
  if (goesBack(t)) return { ok: false, error: `task ${t.id}'s change goes back to its ${workerWord(t.ranAs)}: the folder's check undid its merge, and its report comes again` };
  if (t.state === "merging" && !yours(t)) return { ok: true, id: t.id, graph };
  const w = /** @type {NonNullable<ReturnType<typeof withTask>>} */ (withTask(graph, t.id));
  Object.assign(w.t, { state: "merging", step: null, why: "", endedAt: null });
  unruled(w.t);
  if (reason || failed) Object.assign(w.t, { overruled: reason ? cut(squash(reason), LIMIT.reason) : "", overruledBy: by });
  return { ok: true, id: t.id, graph: w.next };
}

/**
 * Why the change of `agent`'s task `id` can't go back to it to rebase now, or null (the Hunter's of 10-28: one sent back
 * that could not go on left its work stuck, no Apply's): the task's change did not merge, or is a side run's that waits
 * for the developer's Apply, and the role it ran as takes it still. Its worker's own state — Filament holds it, its model
 * runs — is the runner's to ask. `merge`: its merge running now overlapped the folder's edits (the owner's of 11-09),
 * and it goes back from that merge — by itself twice at most, or as its planner asked (`asked`).
 * @param {Graph} graph @param {string} agent @param {string} id @param {Crew} crew @param {MergeBack | null} [merge]
 */
export function rebaseRefusal(graph, agent, id, crew, merge = null) {
  const t = graph.tasks.find((x) => x.id === id);
  if (!t || t.agent !== agent) return `task ${id} is no longer ${agent}'s`;
  if (goesBack(t)) return `task ${id}'s change goes back to its ${workerWord(t.ranAs)} already: the folder's check undid its merge`;
  if (merge) {
    if (t.state !== "merging" || yours(t)) return `task ${id} is no longer merging`;
  } else if (t.state === "merging" && !yours(t)) return `task ${id}'s change is merging into your folder now — wait for its end`;
  if (!merge && !unmerged(t) && !yours(t)) return `task ${id} is no longer one whose change waits for you`;
  if (merge && !merge.asked && (t.rebases ?? 0) >= MERGE_RETURNS) return MERGED_TWICE;
  const as = runsAs(t, crew);
  if (as === null) return `no worker of the team that leads now takes task ${id}`;
  if (as !== t.ranAs) return `task ${id} goes to ${aOrAn(as)} now, and ${agent} is ${aOrAn(/** @type {TaskBy} */ (t.ranAs))}`;
  return null;
}

/**
 * A merge that overlapped the folder's edits, sending its change back to redo (the owner's of 11-09): as its planner
 * asked (`asked`, its apply's send_back), or by Filament itself; `why`, the files that overlapped, each with why.
 * @typedef {{ asked: boolean, why: string }} MergeBack
 */
/** Why a change sent back from its merge did not merge, as its earlier try keeps it (11-09). */
const OVERLAPPED = "its change overlapped edits made in the folder since it began";
/** Why Filament sends a change back by itself no more: twice already (`MERGE_RETURNS`). */
export const MERGED_TWICE = "Filament sent it back to redo on the folder twice already";
/**
 * How a task sent back from its merge stands, in words (11-09): "sent back to redo on the folder, 1 of 2", or "…, as
 * you asked"; "" for one no merge sent back. @param {Task} t
 */
const redoWords = (t) => (!t.earlier?.sentBy ? "" : `sent back to redo on the folder, ${t.earlier.sentBy === "planner" ? "as you asked" : `${t.rebases ?? 1} of ${MERGE_RETURNS}`}`);
/** Whether a task's change went back from its merge to redo on the folder, and is not merged since. @param {Task} t */
const redoing = (t) => !!t.earlier?.sentBy && (t.state === "waiting" || t.state === "running");
/**
 * A new try of a task's change begins — its change merged, a done one reopened, a failed one started again (the hunt on
 * g2): Filament's send-backs from its merge count afresh, and what its last merge overlapped goes. Not at an apply asked
 * again, which would take the count's bound away; a restart keeps it (`restartCut`). @param {Task} t
 */
const forgetRebases = (t) => {
  delete t.rebases;
  delete t.overlapped;
};

/**
 * The developer sent the change of a task back to rebase (the Designer's of 10-27, built 10-28) — one that did not
 * merge, or a side run's that waited for their Apply (the Hunter's of 10-28): the graph sends it back as it sends tasks
 * back — it waits again, its last worker to go on with it in its own conversation, reading what failed and `note` (its
 * copy holds their folder now, its change brought onto it, the overlaps marked). Null for any other task. `merge`: sent
 * back from its merge, which overlapped the folder's edits (the owner's of 11-09) — by Filament itself, counted on the
 * task (`rebases`), or as its planner asked — the merge's words its earlier try's why.
 * @param {Graph} graph @param {string} agent @param {string} note @param {MergeBack | null} [merge]
 * @returns {{ graph: Graph, id: string } | null}
 */
export function sentToRebase(graph, agent, note, merge = null) {
  const found = graph.tasks.find((x) => x.agent === agent && (merge ? x.state === "merging" && !goesBack(x) && !yours(x) : unmerged(x) || yours(x)));
  const w = found ? withTask(graph, found.id) : null;
  if (!w) return null;
  const t = w.t;
  const how = merge ? { sentBy: merge.asked ? /** @type {const} */ ("planner") : /** @type {const} */ ("filament") } : {};
  const earlier = { agent: t.agent, ranAs: t.ranAs, report: t.report, why: merge ? cut(`${OVERLAPPED} — ${merge.why}`, KEEP.why) : t.why, reviews: t.reviews, rebased: /** @type {const} */ (true), ...how };
  if (merge && !merge.asked) t.rebases = (t.rebases ?? 0) + 1;
  // The note is Filament's, naming each marked file: kept whole as a report's words are, not cut as a planner's note.
  Object.assign(t, { state: "waiting", stopped: false, earlier, report: null, why: "", note: cut(note, LIMIT.did), resume: agent, startedAt: null, endedAt: null, reviews: [], reviewer: null, step: null });
  unruled(t);
  return { graph: w.next, id: t.id };
}

/**
 * What an add says of the writing tasks of workers it added with no check (HarnessV3-TaskGraph-v2 TG2-D63): their
 * workers' reports name the commands that prove them done, which Filament runs as their check — "" where none.
 * @param {readonly Task[]} added @param {Crew} crew
 */
function namesItsCheck(added, crew) {
  const ids = added.filter((t) => changes(t) && !checkOf(t).length).map((t) => t.id);
  const worker = led(crew) ? "worker" : "sub-agent";
  if (!ids.length) return "";
  return ids.length === 1
    ? ` ${ids[0]} has no check: its ${worker} names the commands that prove it done in its report, and Filament runs them as its check.`
    : ` ${ids.join(", ")} have no check: their ${worker}s name the commands that prove them done in their reports, and Filament runs them as their check.`;
}

/**
 * What an add says of the command tasks it added (V2-3): what Filament runs, how often and where — no model — and what
 * its end says. "" where none.
 * @param {readonly Task[]} added @param {Crew} crew
 */
function runsWords(added, crew) {
  return added
    .filter((t) => t.by === COMMAND)
    .map((t) => {
      const items = t.items || [];
      const run = inOrder(t.run || []);
      return items.length
        ? ` ${t.id} is a command task: Filament runs ${run} once for each of its ${plural(items.length, "item")}, in copies of ${folderOf(crew)}, as many at once as there is room for — no model — and its end says which runs did not pass.`
        : ` ${t.id} is a command task: Filament runs ${run} in a copy of ${folderOf(crew)} — no model — and its end says whether it passed.`;
    })
    .join("");
}

/** Why a task cannot start now — or be done straight from waiting — or null. @param {Task} t @param {Map<string, Task>} byId @param {"start" | "be done"} verb */
function notReady(t, byId, verb) {
  const open = needsOf(t, byId).map((n) => /** @type {Task} */ (byId.get(n))).filter((n) => !needMet(n, t));
  return open.length ? `${t.id} can't ${verb} yet: it needs ${open.map((n) => `${n.id} (${n.state})`).join(", ")} done first` : null;
}

/**
 * Why a task can't start now, or null: a failed sub-agent's task always may — it is sent back — and so may one whose
 * change is ready and not applied: its worker goes on with it. A done one reopens as its next round (11-09), but a
 * step, whose sub-tasks do its work. @param {Task | undefined} t
 * @param {string} id @param {Map<string, Task>} byId @param {Crew} crew @param {Map<string, Task[]>} [kids] a step's
 *   sub-tasks (11-06): a step does no work of its own
 */
function cannotStart(t, id, byId, crew, kids = new Map()) {
  if (!t) return `${id} is no task in the graph`;
  if (t.state === "dropped") return `${id} was dropped (${t.why})`;
  if (claimed(t)) return claimedWords(t);
  // A step's work is its sub-tasks (11-06): it runs as they begin.
  const open = (kids.get(id) || []).filter((k) => k.state !== "done");
  if (open.length) return `${id} is a step: its work is its sub-tasks — start ${fewIds(open.map((k) => k.id), 5)} as their needs allow, and ${id} runs as they do`;
  if (t.state === "done" && kids.has(id)) return `${id} is a step: its work is its sub-tasks — start one of them (${fewIds((kids.get(id) || []).map((k) => k.id), 5)}) to reopen it`;
  // A command task is Filament's (V2-3): one that failed, or that the developer stopped — its stop let go by the call
  // already (`release`), its runs cut — runs again; and one done, reopened (11-09).
  if (t.by === COMMAND) {
    if (t.state === "failed" || t.state === "done" || (t.state === "waiting" && (t.stopped || t.result?.cut))) return null;
    return t.state === "waiting" ? `${id} is a command task: Filament runs it by itself once its needs are done` : `${id} is ${stateWord(t)} already`;
  }
  // A task another planner's words name, which no worker of the team that leads now can take.
  if (t.by !== "you" && runsAs(t, crew) === null) return `${id} is ${whose(t.by)}, and no worker of your team ${changes(t) ? "changes files" : "does a task that changes none"} — give it to a worker (tasks change with by), or drop it`;
  if (t.by !== "you" && (t.state === "failed" || t.state === "done" || yours(t))) return null;
  // One the developer stopped, or one its last worker is to go on with: a start says who takes it (HarnessV4_Tasks B4).
  if (t.by !== "you" && t.state === "waiting" && (t.stopped || t.resume)) return null;
  if (t.by !== "you" && t.state === "waiting") return `${id} is ${whose(t.by)}: Filament starts it by itself once its needs are done`;
  if (led(crew) && t.by === "you") return `${id} is the agent's own task, and a lead does no work itself — give it ${handWord(crew)} (tasks change with by), and Filament starts its worker`;
  // A paused task starts again as a waiting one does (E36 case 4): once its needs — those given while it was paused too — are done.
  if (t.state !== "waiting" && t.state !== "failed" && t.state !== "paused" && t.state !== "done") return `${id} is ${stateWord(t)} already`;
  return notReady(t, byId, "start");
}

/** Why a reopened round's earlier try ended, as its record and a new worker's brief say it (11-09). @param {string} summary */
const reopenedWhy = (summary) => `it was done: ${cut(squash(summary), 200)}`;

/**
 * A done task reopened as its next round (11-09), in place: its done record — what was done, when, what showed it —
 * moves to `earlier`, as a send-back keeps a try, and the task is open again, its round one on. A sub-task's step done
 * with it is under way again. → its new round. The caller sets how it goes on: running, or waiting for its worker.
 * @param {Task} t @param {Map<string, Task>} byId @returns {number}
 */
function reopen(t, byId) {
  const round = t.round ?? 1;
  /** @type {DoneRound} */
  const done = { round, summary: t.summary, at: t.endedAt, ...(t.evidence ? { evidence: t.evidence } : {}), ...(t.verdict ? { verdict: t.verdict } : {}), ...(t.merged ? { merged: t.merged } : {}), ...(t.changed?.length ? { changed: t.changed } : {}), ...(t.changedMore ? { changedMore: true } : {}) };
  t.earlier = { agent: t.agent, ranAs: t.ranAs, report: t.report, why: reopenedWhy(t.summary), reviews: t.reviews, done };
  Object.assign(t, { round: round + 1, summary: "", why: "", endedAt: null, verdict: null, merged: null, gate: null });
  for (const k of ["evidence", "changed", "changedMore", "brought", "uncommitted"]) delete (/** @type {Record<string, unknown>} */ (t))[k];
  forgetRebases(t);
  const step = t.under ? byId.get(t.under) : undefined;
  if (step?.state === "done") Object.assign(step, { state: "waiting", endedAt: null });
  return round + 1;
}

/** Why a ready change's try ended, as its worker reads it when its planner sends it back before applying it. */
const READY_BACK = "its change was ready, and its planner sent it back before applying it";

/**
 * Why a ready task can't be sent back, or null: its change waits in its worker's copy, so it goes back to that worker
 * or nowhere — a new one, asked `fresh` or because that one can't go on, would start from the folder without it, and
 * the change would stay in a copy the graph no longer names. Its change stays ready.
 * @param {Task | undefined} t @param {{ fresh: boolean, crew: Crew, resumable: Resumable }} o
 */
function readyStays(t, { fresh, crew, resumable }) {
  if (!t || t.by === "you" || !yours(t)) return null;
  const agent = String(t.agent);
  const { resume, why } = goesOn(t, agent, { fresh, crew, resumable });
  if (resume) return null;
  const cant = fresh ? `fresh would give the task to a new ${workerWord(t.ranAs)} from the folder as it stands, without it` : `its ${workerWord(t.ranAs)} ${agent} can't take it back — ${why}`;
  return `${t.id}'s change is ready in ${agent}'s copy, and ${cant}: apply it (${applyWords(crew, agent)}), or drop it and add the task again`;
}

/**
 * Who goes on with a task set aside — failed, or stopped by the developer — once it starts again
 * (HarnessV3-FailurePoints §6 items 2–4; HarnessV4_Tasks B4): its last worker, in its own conversation, unless a new
 * one is asked (`fresh`), its try left none to go on from (`last` null), the task goes to another role now, or
 * `resumable` says why not. `why`: why a new worker takes it though none was asked.
 * @param {Task} t @param {string | null} last @param {{ fresh: boolean, crew: Crew, resumable: Resumable }} o
 * @returns {{ resume: string | null, why: string | null }}
 */
function goesOn(t, last, { fresh, crew, resumable }) {
  if (fresh || !last) return { resume: null, why: null };
  const as = runsAs(t, crew);
  // No member of the team that leads now can take it: its start says so (`cannotStart`, the runner's launch).
  if (as === null) return { resume: null, why: null };
  // Its change did not merge (the Hunter's of 10-28): its worktree holds the folder as it was, so its last worker going
  // on there makes a change that meets the same overlap. The developer's Send back to rebase, in Changes, is the one
  // that redoes it on the folder first.
  if (unmerged(t)) return { resume: null, why: `its change did not merge, and ${last}'s worktree holds the folder as it was before — a new one starts from the folder as it stands` };
  const why = as !== t.ranAs ? `the task goes to ${aOrAn(as)} now, and ${last} is ${aOrAn(/** @type {TaskBy} */ (t.ranAs))}` : resumable(last);
  return { resume: why ? null : last, why };
}

/**
 * Start tasks whose needs are done, as work on each begins: several at once where sub-agents or commands work them. A sub-agent's task is Filament's to
 * start; one that failed is sent back (G2-6) and waits again. Its last worker goes on with it in its own conversation
 * — its finished rounds, what it read, its worktree — once its needs are done and a slot is free, reading what failed
 * and the planner's note (HarnessV3-FailurePoints §6 item 2). With `fresh`, or when that worker can't go on — the
 * task now goes to another role, or `resumable` says why — a new one takes it, the earlier try, its reviews and the
 * note in its brief (§6 items 3–4); the words say which, and why. One the developer stopped, or one that waits for
 * its last worker, is started again the same way (HarnessV4_Tasks B4): the call says who takes it, and a stopped one
 * is let go. A lead does no work itself (G3-1): the agent's own task is no lead's to start. Every problem of the call
 * is said at once (§8 item 1). A done task reopens as its next round (11-09): the planner's own runs again, its span
 * opening anew; a worker's goes back to its last worker, in its own conversation, with the note — a new one with
 * `fresh` — as a failed one's does; and what waits on it waits for its new round, one of the planner's own the same call
 * starts too (the review of g3), said so. A failed one sent back is a new try: its merge's send-backs count afresh (the
 * hunt on g2). Its tasks entries each may carry a
 * note of its own, the call's note going to those that carry none.
 * `helping`: whether a helper is at work now (`HelperAtWork`). `personAt`: when the person last wrote (`afterText`).
 * @param {Graph} graph @param {Record<string, any>} i @param {number} at @param {Crew} crew @param {Resumable} resumable
 * @param {HelperAtWork} [helping] @param {number | null} [personAt] @returns {Applied | Refusal}
 */
function start(graph, i, at, crew, resumable, helping = helpersWork, personAt = null) {
  const entries = entriesOf(i, "start");
  if (typeof entries === "string") return shaped("start", entries);
  const ids = entries.map((e) => e.id);
  const next = structuredClone(graph);
  const byId = indexOf(next);
  const kids = kidsOf(next);
  const problems = ids.flatMap((id) => cannotStart(byId.get(id), id, byId, crew, kids) || readyStays(byId.get(id), { fresh: i.fresh === true, crew, resumable }) || []);
  const callNote = text(i.note);
  /** Each task's note: its entry's own, else the call's. */
  const notes = new Map(entries.map((e) => [e.id, text(e.note) || callNote]));
  for (const n of new Set(notes.values())) {
    const longNote = over("note", n, LIMIT.note);
    if (longNote) problems.push(longNote);
  }
  const anyNote = [...notes.values()].some(Boolean);
  if (i.fresh !== undefined && i.fresh !== null && typeof i.fresh !== "boolean") problems.push("fresh is true or false: true gives a failed or a stopped task to a new worker instead of its last one");
  // A note and fresh are a worker's: a call that starts only command tasks has no one to give them to (V2-3).
  const runs = ids.filter((id) => byId.get(id)?.by === COMMAND);
  if (runs.length && runs.length === ids.length && (anyNote || meant(i.fresh)))
    problems.push(`${runs.join(", ")} ${runs.length === 1 ? "is a command task" : "are command tasks"}: no worker reads a note, and none is fresh — leave note and fresh out`);
  if (problems.length) return refusedAll(problems, ids.length > 1);
  const sent = ids.filter((id) => /** @type {Task} */ (byId.get(id)).by !== "you");
  /** Those set aside already — the developer stopped them, or their last worker is to go on: started again, not sent back. */
  const again = new Set(sent.filter((id) => /** @type {Task} */ (byId.get(id)).state === "waiting"));
  /** Why each task sent back goes to a new worker though it was not asked to, by id. @type {Map<string, string>} */
  const wont = new Map();
  /** The paused ones of the planner's own, started again (E36): their checkpoint comes with the answer (the runner's). */
  const resumed = ids.filter((id) => /** @type {Task} */ (byId.get(id)).state === "paused");
  /** The done ones, reopened (11-09), each with the round it is on now. @type {Map<string, number>} */
  const reopened = new Map();
  /** What waits on each one reopened: the waiting tasks that need it, or its step it made done. @type {Map<string, string[]>} */
  const waitsAgain = new Map();
  /** What the call reopens, each done one's step it made done with it. @type {Set<string>} */
  const reopening = new Set();
  for (const id of ids) {
    const t = /** @type {Task} */ (byId.get(id));
    if (t.state !== "done") continue;
    const step = t.under ? byId.get(t.under) : undefined;
    const on = new Set([id, ...(step?.state === "done" ? [step.id] : [])]);
    for (const n of on) reopening.add(n);
    waitsAgain.set(id, next.tasks.filter((x) => x.state === "waiting" && !ids.includes(x.id) && x.needs.some((n) => on.has(n))).map((x) => x.id));
  }
  // One of the planner's own it starts that needs one it reopens (the review of g3) waits for that round: it would run
  // beside the round it needs. By id, the needs reopened.
  /** @type {Map<string, string[]>} */
  const held = new Map();
  for (const id of ids) {
    const t = /** @type {Task} */ (byId.get(id));
    const on = t.by === "you" ? needsOf(t, byId).filter((n) => reopening.has(n)) : [];
    if (on.length) held.set(id, on);
  }
  /** What a held one's words say of it. @param {string} id */
  const heldWords = (id) => {
    const on = /** @type {string[]} */ (held.get(id));
    return `it needs ${andWords(on)}, reopened in this call — start it once ${on.length === 1 ? "that round is" : "those rounds are"} done`;
  };
  for (const id of ids) {
    const t = /** @type {Task} */ (byId.get(id));
    const note = /** @type {string} */ (notes.get(id));
    // A proposed task started is taken on.
    delete t.proposed;
    // A done one's record goes to `earlier`, the round before (11-09): it goes on below as any start of it does.
    if (t.state === "done") reopened.set(id, reopen(t, byId));
    // Held for the round it needs: one reopened waits, one waiting or paused stays as it was.
    if (held.has(id)) {
      if (reopened.has(id)) Object.assign(t, { state: "waiting", why: "", startedAt: null });
      continue;
    }
    if (!sent.includes(id)) {
      // A paused one keeps when it first started: it ran, was left, and goes on — its turns counted afresh (E41 P2 case 13).
      // When it started again is kept beside it: the one started last takes a new list of steps (`lastStart`).
      Object.assign(t, { state: "running", why: "", startedAt: t.state === "paused" ? t.startedAt ?? at : at }, t.state === "paused" ? { againAt: at } : {});
      delete t.quiet;
      continue;
    }
    // A command task runs again, whole, on the folder as it then stands (TG2-D69).
    if (t.by === COMMAND) {
      Object.assign(t, { state: "waiting", stopped: false, why: "", startedAt: null, endedAt: null, progress: null });
      continue;
    }
    // Its try ran (a refused launch, or a restart's cut while it ran, left none to go on from), on the role the task
    // goes to now. One set aside already has its try in `earlier`: the worker named to go on, else the one stopped.
    const last = again.has(id) ? t.resume || t.earlier?.agent || null : t.report && t.agent ? t.agent : null;
    const { resume, why } = goesOn(t, last, { fresh: i.fresh === true, crew, resumable });
    if (why) wont.set(id, why);
    // The try the next one builds on is this failure's — or a ready change's its planner sent back before its apply — or,
    // when this one left no record (it never ran, or a restart cut it as it ran), the try before it, which did; a
    // reopened one's, the round it reopened (11-09).
    const earlier = reopened.has(id) || again.has(id) || (!t.report && t.earlier) ? t.earlier : { agent: t.agent, ranAs: t.ranAs, report: t.report, why: yours(t) ? READY_BACK : t.why, reviews: t.reviews };
    // A failed one's new try: Filament's send-backs from its merge count afresh (the hunt on g2).
    if (t.state === "failed") forgetRebases(t);
    Object.assign(t, { state: "waiting", stopped: false, earlier, report: null, why: "", note: again.has(id) && !note ? t.note : note, resume, startedAt: null, endedAt: null, reviews: [], reviewer: null, step: null });
    unruled(t);
  }
  const worker = led(crew) ? "worker" : "sub-agent";
  const when = "once its needs are done and a slot is free";
  /** @param {readonly string[]} of */
  const brief = (of) => `with the earlier try${of.some((id) => notes.get(id)) ? " and your note" : ""} in its brief`;
  /** @param {string[]} of */
  const said = (of) => (again.has(of[0]) ? `Started ${of.join(", ")} again` : `Sent ${of.join(", ")} back`);
  const anew = sent.filter((id) => !byId.get(id)?.resume && !wont.has(id) && !runs.includes(id) && !reopened.has(id));
  const begun = ids.filter((id) => !sent.includes(id) && !resumed.includes(id) && !reopened.has(id) && !held.has(id));
  const words = [
    // Reopened (11-09): its new round, who takes it, and what waits on it again.
    ...[...reopened].map(([id, round]) => {
      const t = /** @type {Task} */ (byId.get(id));
      const head = `Reopened ${id} for round ${round}`;
      const note = notes.get(id);
      const how =
        t.by === "you"
          ? held.has(id)
            ? `${head}: yours, and it waits: ${heldWords(id)}.`
            : `${head}: yours, so you do it now — its done record is kept as the round before.`
          : t.by === COMMAND
            ? `${head}: Filament runs ${t.items?.length ? "every item" : "it"} again on ${folderOf(crew)} as it stands, once its needs are done and there is room.`
            : t.resume
              ? `${head}: ${workerWord(t.ranAs)} ${t.resume} goes on with it ${when}, in its own conversation — what it did is there${note ? ", and it reads your note" : ""}.`
              : wont.has(id)
                ? `${head}: ${t.earlier?.agent} can't go on with it — ${wont.get(id)} — so a new ${worker} takes it ${when}, with the earlier rounds${note ? " and your note" : ""} in its brief.`
                : `${head}: a new ${worker} takes it ${when}, with the earlier rounds${note ? " and your note" : ""} in its brief.`;
      const waits = waitsAgain.get(id) || [];
      return `${how}${waits.length ? ` ${andWords(waits)} ${waits.length === 1 ? "waits" : "wait"} again, for ${id}'s new round${changes(t) ? " and its apply" : ""}.` : ""}`;
    }),
    // Held for a round the call reopened (the review of g3).
    ...[...held.keys()].filter((id) => !reopened.has(id)).map((id) => `${id} waits: ${heldWords(id)}.`),
    // Its own, and said so (E41 P5's measure: an agent started two of its own tasks as if sub-agents would do them).
    ...(begun.length ? [`Started ${begun.join(", ")}: yours, so you do ${begun.length === 1 ? "it" : "them"} now.`] : []),
    ...resumed.filter((id) => !held.has(id)).map((id) => {
      const c = /** @type {Task} */ (byId.get(id)).checkpoint;
      return `Started ${id} again${c ? `, from its ${checkpointWords(c)}` : ""}.`;
    }),
    // Two of its own at work at once (the owner's of 11-10: two spinners read as two things being done) — one begun, one
    // started again from its checkpoint, or one reopened beside the one it is on (Fable52's of 11-10).
    ...(begun.length || resumed.some((id) => !held.has(id)) || [...reopened.keys()].some((id) => byId.get(id)?.by === "you" && !held.has(id)) ? [atOnceWords(next, "tasks", helping)].filter(Boolean) : []),
    ...runs.filter((id) => !reopened.has(id)).map((id) => `${again.has(id) ? `Started ${id} again` : `Set ${id} to run again`}: Filament runs ${byId.get(id)?.items?.length ? "every item" : "it"} again on ${folderOf(crew)} as it stands, once its needs are done and there is room.`),
    ...sent.flatMap((id) => {
      const t = /** @type {Task} */ (byId.get(id));
      if (t.by === COMMAND || reopened.has(id)) return [];
      const note = notes.get(id);
      // A ready change sent back failed nothing: its worker reads why it came back.
      const what = t.earlier?.why === READY_BACK ? "why it came back" : "what failed";
      const reads = again.has(id) ? (note ? ", and it reads your note" : "") : `, and it reads ${what}${note ? " and your note" : ""}`;
      if (t.resume) return [`${said([id])}: ${workerWord(t.ranAs)} ${t.resume} goes on with it ${when}, in its own conversation — what it did is there${reads}.`];
      const why = wont.get(id);
      return why ? [`${said([id])}: ${t.earlier?.agent} can't go on with it — ${why} — so a new ${worker} takes it ${when}, ${brief([id])}.`] : [];
    }),
    ...[anew.filter((id) => !again.has(id)), anew.filter((id) => again.has(id))].filter((of) => of.length).map((of) => `${said(of)}: a new ${worker} takes ${of.length === 1 ? "it" : "each"} ${when}, ${brief(of)}.`),
  ];
  // A sub-task begun sets its step under way (11-06) — and one reopened, the step it had made done.
  settleSteps(next, at);
  return { ok: true, graph: next, text: `${words.join(" ")} ${afterText(next, personAt)}`, changed: true };
}

/**
 * A task done, with what was done: a running one, or a waiting one whose needs are done. A sub-agent's task is ended
 * by its report, never by this call; a lead may mark one of the agent's own done that it found done (G3-2). `fields`:
 * what a change of its planner's takes, which its refusal's ways keep to. `helping`: whether a helper is at work now.
 * `personAt`: when the person last wrote (`afterText`). `side`: its answer goes on to say what may run side by side
 * (`withSide`) — whether Parallelize tasks is on, and whether the session's sub-agents share its folder; null where it
 * says none, a planning turn's.
 * @param {Graph} graph @param {Record<string, any>} i @param {number} at @param {Crew} crew @param {readonly string[]} fields
 * @param {HelperAtWork} [helping] @param {{ personAt?: number | null, side?: { on: boolean, shared?: boolean } | null }} [o]
 * @returns {Applied | Refusal}
 */
function done(graph, i, at, crew, fields, helping = helpersWork, { personAt = null, side = null } = {}) {
  const entries = entriesOf(i, "done");
  if (typeof entries === "string") return shaped("done", "done needs id: the task that is done, with its summary");
  // Several in one call go as tasks entries, each with its own summary (11-09): ids share none.
  const asEntries = Array.isArray(i.tasks) && (i.ids === undefined || i.ids === null) && (i.id === undefined || i.id === null || i.id === "");
  if (entries.length > 1 && !asEntries) return shaped("done", DONE_SEVERAL, { id: entries[0].id });
  const many = entries.length > 1;
  const next = structuredClone(graph);
  /** @type {string[]} */
  const problems = [];
  /** @type {{ id: string, summary: string, evidence: unknown }[]} */
  const asked = [];
  for (const e of entries) {
    const summary = text(e.summary) || text(i.summary);
    if (!summary && !many) return shaped("done", "done needs summary: what was done, in a line or two", { id: e.id });
    const longSummary = over("summary", summary, LIMIT.summary);
    if (!summary) problems.push(`${e.id}: done needs its summary — what was done, in a line or two`);
    else if (longSummary) problems.push(many ? `${e.id}: ${longSummary}` : longSummary);
    else asked.push({ id: e.id, summary, evidence: e.evidence !== undefined ? e.evidence : i.evidence });
  }
  if (problems.length) return refusedAll(problems, many);
  const before = new Set(ready(next).map((x) => x.id));
  /** @type {{ id: string, kind: "done" | "checking" | "taken", check?: string[], reds?: number, of?: number }[]} */
  const marked = [];
  /** @type {string[]} */
  const ended = [];
  for (const a of asked) {
    const r = markDone(next, a.id, a.summary, a.evidence, at, crew, fields);
    if ("error" in r) {
      if (!many) return refused(r.call ? `${r.error}\nThe call: ${r.call}` : r.error);
      problems.push(r.error);
      continue;
    }
    marked.push({ id: a.id, ...r });
    ended.push(...r.ended);
  }
  if (problems.length) return refusedAll(problems, many);
  const now = ready(next).filter((x) => !before.has(x.id)).map((x) => x.id);
  const plain = marked.filter((m) => m.kind === "done").map((m) => m.id);
  const heads = [
    ...(plain.length ? [`Done: ${plain.join(", ")}.`] : []),
    ...marked.filter((m) => m.kind === "taken").map((m) => `Taken as done: ${m.id} — ${m.reds} of its ${plural(/** @type {number} */ (m.of), "run")} did not pass, kept in its table.`),
    ...marked.filter((m) => m.kind === "checking").map((m) => checkingWords(m.id, /** @type {string[]} */ (m.check), crew)),
  ];
  // Each task the done leaves ready is named once, in the place that says the most of it (the review of 67038d835: one
  // answer named the task that comes next up to four times): the set that may run side by side, said after these words
  // (`withSide`), names its tasks and what to do with them; what comes next of the planner's own says its name; what the
  // done made ready, that it did; and the line of how the work stands, the ready ones none of those named.
  const named = new Set(side ? sideToSay(next, crew, side.on, { shared: side.shared }, helping) : []);
  // A lead does no work itself: nothing of its own comes next.
  const coming = led(crew) ? null : nextOwn(next, helping);
  const then = coming && !named.has(coming.id) ? nextWords(next, "tasks", helping) : "";
  if (coming) named.add(coming.id);
  const fresh = now.filter((id) => !named.has(id));
  for (const id of fresh) named.add(id);
  return { ok: true, graph: next, text: `${heads.join(" ")}${stepsDoneWords(ended)}${fresh.length ? ` Ready now: ${fresh.join(", ")}.` : ""}${then ? ` ${then}` : ""} ${afterText(next, personAt, named)}`, changed: true };
}

/** What a done of several by ids says (11-09): each takes its own summary. */
const DONE_SEVERAL = 'done takes each task with its own summary — tasks: [{"id": …, "summary": …}, …] marks several in one call, or call it once a task';

/**
 * How whoever plans ends a sub-agent's or an explorer's task itself, as a done's refusal says it: only a way that works
 * now (the bug report of 11-10: it named a change with by: you, which a coding agent's change takes no by for, nor any
 * change of a task at work, merging or ready). Its change that waits applied, or marked applied where the planner
 * brought it in itself; at work, its end waited for; else taken on, where a change takes by, or dropped for a task of
 * the planner's own. @param {Task} t @param {readonly string[]} fields  what a change of the planner's takes
 */
function ownWay(t, fields) {
  if (waitsApply(t)) return `its change waits in ${t.agent}'s own copy: apply it — agent with agent_id "${t.agent}" and apply_changes: true — or, where you brought it into your folder yourself, mark it applied — the same with mark_applied: true in apply_changes' place`;
  if (goesBack(t)) return `its change goes back to its ${workerWord(t.ranAs)}: wait for its report, or drop it`;
  if (t.state === "merging") return "its change is merging into your folder now: its verdict ends it";
  if (claimed(t)) return "the developer's side run has it: leave it — its report comes to you";
  if (t.state === "review") return "it is in review: wait for its end, or drop it";
  if (t.state === "running") return `it is with its ${workerWord(t.ranAs)} now: wait for its end, or drop it`;
  return fields.includes("by") ? "to finish it yourself, change it to by: you" : "to do it yourself, drop it and add a task of your own for the work";
}

/**
 * One task of a done marked, in place (`done`): done, being checked, or — a failed command task — taken as done, with the
 * steps it made done; or why not, in words, with the call to copy where one helps.
 * @param {Graph} next @param {string} id @param {string} summary @param {unknown} given  its evidence, as the call gave it
 * @param {number} at @param {Crew} crew @param {readonly string[]} fields  what a change of the planner's takes
 * @returns {{ kind: "done" | "checking" | "taken", ended: string[], check?: string[], reds?: number, of?: number } | { error: string, call?: string }}
 */
function markDone(next, id, summary, given, at, crew, fields) {
  const byId = indexOf(next);
  const t = byId.get(id);
  if (!t) return { error: `${id} is no task in the graph` };
  if (t.state === "done") return { error: `${id} is done already` };
  if (t.state === "checking") return { error: `${id} is being checked now — its verdict reaches you as a message` };
  if (t.state === "dropped") return { error: `${id} was dropped (${t.why}) — add a new task for that work` };
  if (t.by === COMMAND) return takenAsDone(next, t, summary, at);
  if (t.by !== "you") return { error: led(crew) ? `${id} is ${whose(t.by)}: its worker's report ends it` : `${id} is ${whose(t.by)}: its report ends it — ${ownWay(t, fields)}` };
  // A step is done once its sub-tasks are (11-06): never by a call of its own.
  const open = (kidsOf(next).get(id) || []).filter((k) => k.state !== "done");
  if (open.length) return { error: `${id} is a step whose sub-tasks are still open — ${fewIds(open.map((k) => `${k.id} (${stateWord(k)})`), 5)}: it is done once they are. Mark each done, or drop those that go` };
  const why = t.state === "waiting" || t.state === "failed" || t.state === "paused" ? notReady(t, byId, "be done") : null;
  if (why) return { error: why };
  // A task with a check is done once Filament's run of it passes (V2-1): it is checked meanwhile, and the call answers now.
  const check = checkOf(t);
  // One that says what shows it done and has no check is done with what shows it (E41 P2 case 9, GX-D3): the planner's
  // words, kept on the task — Filament proves only what a check runs.
  const evidence = typeof given === "string" ? prose(given) : "";
  const longEvidence = over("evidence", evidence, LIMIT.evidence);
  if (longEvidence) return { error: longEvidence };
  if (t.acceptance && !check.length && !evidence) return { error: `${id} has acceptance — "${cut(t.acceptance, 200)}" — and no check, so its done needs evidence too: what shows that holds — a test's output, a command you ran, what you saw`, call: provenCall(id) };
  Object.assign(t, { state: check.length ? "checking" : "done", summary, why: "", startedAt: t.startedAt ?? at, endedAt: at, ...(check.length ? { verdict: null } : {}), ...(evidence ? { evidence } : {}) });
  // Its turns at work end with it (case 13): a check that fails reopens it counted afresh.
  delete t.quiet;
  const ended = settleSteps(next, at);
  return check.length ? { kind: "checking", check, ended } : { kind: "done", ended };
}

/** How long a checkpoint's words may run (E36 case 1): a note's own limit. */
const CHECKPOINT_CHARS = 200_000;

/**
 * A running task of the planner's own left on purpose (E36 cases 1–3, 5): paused, with its checkpoint — where it
 * stands, what is next, what to re-read — kept behind it as the note "Checkpoint n · 14:02" (CP-D2), which the runner
 * keeps (`notes`). A paused task's needs and writes may change, so the work that came in goes in before it; it starts
 * again as a waiting one does, its checkpoint handed back. Only the planner pauses (CP-D1): a sub-agent's task, a
 * command task, one that is not running are refused in words. `personAt`: when the person last wrote (`afterText`).
 * @param {Graph} graph @param {Record<string, any>} i @param {number} at @param {number | null} [personAt] @returns {Applied | Refusal}
 */
function pause(graph, i, at, personAt = null) {
  const ids = readIds(i, "pause");
  if (typeof ids === "string") return shaped("pause", "pause needs id: the running task you leave, with its checkpoint");
  if (ids.length > 1) return shaped("pause", "pause takes one task at a time, each with its own checkpoint — call it once a task", { id: ids[0] });
  const id = ids[0];
  const words = typeof i.checkpoint === "string" ? prose(i.checkpoint) : "";
  if (!words) return shaped("pause", "pause needs checkpoint: where the task stands — what is done, what is next, what to re-read — so you can come back to it", { id });
  if (words.length > CHECKPOINT_CHARS) return refused(`checkpoint is ${words.length.toLocaleString("en-US")} characters: ${CHECKPOINT_CHARS.toLocaleString("en-US")} at most — keep the rest behind the task as a note of its own (tasks keep)`);
  const next = structuredClone(graph);
  const t = indexOf(next).get(id);
  if (!t) return refused(`${id} is no task in the graph`);
  if (t.by === COMMAND) return refused(`${id} is a command task: Filament's runs end it — drop it to stop them`);
  if (t.by !== "you") return refused(`${id} is ${whose(t.by)}: its report ends it — drop it to stop its work, or let it finish`);
  // A step does no work of its own (11-06): the sub-task the planner is on is what pauses.
  const open = (kidsOf(next).get(id) || []).filter((k) => k.state !== "done");
  if (open.length) return refused(`${id} is a step: its work is its sub-tasks — pause the one you are on (${fewIds(open.filter((k) => k.state === "running").map((k) => k.id), 5) || "none of them runs"})`);
  if (t.state === "paused") return refused(`${id} is paused already${t.checkpoint ? `, with its ${checkpointWords(t.checkpoint)}` : ""} — start it to go on, or keep more behind it (tasks keep)`);
  if (t.state !== "running") return refused(`${id} is ${stateWord(t)}: only a running task is paused`);
  const n = (t.checkpoint?.n ?? 0) + 1;
  const title = `Checkpoint ${n} · ${clockOf(at)}`;
  Object.assign(t, { state: "paused", checkpoint: { n, title, at } });
  delete t.quiet;
  return {
    ok: true,
    graph: next,
    text: `Paused ${id} with its checkpoint ${n}, kept behind it as the note "${title}". Its needs and writes may change while it waits: the work that came in goes in as tasks it needs. tasks start with id ${id} starts it again, its checkpoint with it. ${afterText(next, personAt)}`,
    changed: true,
    notes: { kind: "keep", task: id, graph: next.startedAt, title, text: words, files: [], picture: "", forget: [], from: 0 },
  };
}

/**
 * What a done of a task with a check says (V2-1): Filament checks it now, and when it is done — its verdict comes either
 * way, and wakes the chat where no turn runs (the owner's of 11-06), so nothing waits for it.
 * @param {string} id @param {readonly string[]} check @param {Crew} crew
 */
const checkingWords = (id, check, crew) => `Checking ${id}: Filament runs its check in a copy of ${folderOf(crew)} now (${inOrder(check)}); it is done once that passes. Its verdict reaches you either way, and wakes this chat if your turn has ended: go on with what does not need it.`;

/**
 * A failed command task taken as done (HarnessV3-TaskGraph-v2 TG2-D73): the runs that did not pass are what it was run
 * to find — a mutation pass's survivors — so its planner's done ends it with its table as it ended, and the tasks that
 * need it start. Refused while it waits or runs — Filament ends it by its runs — and when it did not run, or its runs did
 * not all end: nothing stands to be taken. In place, as `markDone`'s.
 * @param {Graph} next @param {Task} t @param {string} summary @param {number} at
 * @returns {{ kind: "taken", ended: string[], reds: number, of: number } | { error: string }}
 */
function takenAsDone(next, t, summary, at) {
  const id = t.id;
  if (t.state === "running") return { error: `${id} is a command task: Filament runs it now, and its runs end it` };
  if (t.state !== "failed") return { error: `${id} is a command task: Filament ends it by its runs — ${t.stopped || t.result?.cut ? "it waits to run again, whole" : "it has not run yet"}` };
  const r = t.result ?? null;
  if (!r || r.runs.length < r.of) return { error: `${id} is a command task whose runs did not all end: start it to run it again, or drop it` };
  Object.assign(t, { state: "done", summary, why: "", endedAt: at });
  return { kind: "taken", ended: settleSteps(next, at), reds: r.runs.filter((x) => !x.passed).length, of: r.of };
}

/**
 * Change tasks that are not finished: a waiting or failed task any field, a running one of the agent's own too — its
 * needs, and it runs on; who does it, and it waits for its worker (g1, the owner's of 11-09), the answer saying which. A
 * sub-agent's task changes only while no sub-agent holds it. A goal given restates the
 * graph's. Under a lead nobody runs the agent's own task, even one it left running (G3-2): the lead may change all of
 * it, and given to a member it waits for its worker. A hunt's finding given to a task makes it need the task the hunt
 * was fired from; given in another
 * hunt's place, it takes the place of the need that hunt added, never one the planner named, unless the call names the
 * task's needs (`foundNeeds`). "" takes the mark away and leaves its needs as they stand. needed_by is an add's (g1).
 * `o`: whether the session's sub-agents share its folder (`shared`), which the merge points' words weigh, as an add's;
 * the chat's turn the call came in (`turn`), kept on each task it changed (11-09); when the person last wrote
 * (`personAt`, `afterText`).
 * @param {Graph} graph @param {Record<string, any>} i @param {readonly string[]} fields @param {Crew} crew @param {Vet} vet
 * @param {ThreadOf} threadOf @param {FoundOf} foundOf @param {number} at @param {{ shared?: boolean, turn?: number | null, personAt?: number | null }} [o]
 * @returns {Applied | Refusal}
 */
function change(graph, i, fields, crew, vet, threadOf, foundOf, at, { shared, turn = null, personAt = null } = {}) {
  const goal = text(i.goal);
  const longGoal = over("goal", goal, LIMIT.goal);
  if (longGoal) return refused(longGoal);
  const inputs = Array.isArray(i.tasks) ? i.tasks : [];
  if (!inputs.length && !goal) return shaped("change", "change needs tasks: each with the id of a task to change and the fields that change — or goal, to restate the graph's");
  const next = structuredClone(graph);
  const byId = indexOf(next);
  /** @type {string[]} */
  const problems = [];
  /** @type {Set<string>} */
  const given = new Set();
  /** @type {string[]} */
  const changed = [];
  /** The tasks sent back whose last worker can't go on with them now. @type {string[]} */
  const anew = [];
  /** What became of the planner's own running tasks the call changed (g1). @type {string[]} */
  const heard = [];
  /** Whether a task's own shape was wrong: the refusal ends with the call (TG2). */
  let form = false;
  for (const [k, input] of inputs.entries()) {
    const mark = problems.length;
    const read = readId(input);
    if ("error" in read) {
      form = true;
      problems.push(inputs.length > 1 ? `task ${k + 1} of the list: ${read.error}` : read.error);
      continue;
    }
    const { id } = read;
    if (given.has(id)) {
      problems.push(`${id} is given twice`);
      continue;
    }
    given.add(id);
    const { needed_by: needed, ...own } = input;
    const unknown = unknownField(id, own, fields);
    if (unknown) {
      form = true;
      problems.push(unknown);
    }
    // needed_by is an add's, for a new task (g1): a change names the needs of the tasks that need it.
    if (needed !== undefined) {
      const ts = readNeededBy(id, needed);
      const ids = "ids" in ts ? ts.ids.filter((x) => x !== id) : [];
      problems.push(`${id}: needed_by is add's, for a new task — ${ids.length ? `to have ${andWords(ids)} need ${id}, change ${ids.length === 1 ? `${ids[0]}'s` : "their"} needs` : `to have tasks need ${id}, change their needs`}`);
      continue;
    }
    if (!fields.some((key) => input[key] !== undefined)) {
      if (!unknown) problems.push(`change ${id} how? Give the fields that change`);
      continue;
    }
    const t = byId.get(id);
    const stuck = !t ? `${id} is no task in the graph` : fixedWhy(t);
    if (stuck || !t) {
      problems.push(/** @type {string} */ (stuck));
      continue;
    }
    // The planner's own task that runs may change its needs and who does it too (g1): said in the answer.
    const was = t.state === "running" && t.by === "you" ? { needs: [...t.needs], by: t.by } : null;
    const fieldsOf = readFields(id, input, t, crew, fields, vet);
    const th = readThread(id, input, t, fields, threadOf);
    if ("error" in th) problems.push(th.error);
    const fo = readFound(id, input, t, fields, foundOf, graph);
    if ("error" in fo) problems.push(fo.error);
    const un = readUnder(id, input, fields);
    if ("error" in un) problems.push(un.error);
    if (Array.isArray(fieldsOf)) {
      problems.push(...fieldsOf);
      continue;
    }
    if (problems.length > mark || "error" in th || "error" in fo || "error" in un) continue;
    // A task sent back to its last worker, given to another role now, goes to a new worker of that role.
    if (t.resume && runsAs(fieldsOf, crew) !== t.ranAs) {
      t.resume = null;
      anew.push(id);
    }
    Object.assign(t, fieldsOf);
    // Under a step, or out of its step (11-06): checked once the call's tasks are all changed.
    if (!("error" in un) && un.under !== undefined) {
      if (un.under) t.under = un.under;
      else delete t.under;
    }
    // A proposed task changed is taken on: it starts, or is offered, as any other task.
    delete t.proposed;
    // A command task's fields are its alone (V2-3): one that is no command task any more keeps none of them.
    if (t.by === COMMAND) Object.assign(t, { result: t.result ?? null, progress: null });
    else for (const k of ["run", "items", "result", "progress"]) delete (/** @type {Record<string, unknown>} */ (t))[k];
    // A check the planner gives is its own, whoever named the one before (TG2-D63).
    if (fields.includes("check") && input.check !== undefined) delete t.checkBy;
    if (t.state === "running" && t.by !== "you") Object.assign(t, { state: "waiting", startedAt: null });
    // A paused task given to another waits for its worker: the pause was the planner's own (E36).
    if (t.state === "paused" && t.by !== "you") Object.assign(t, { state: "waiting", startedAt: null });
    if (th.thread) t.thread = th.thread;
    else delete t.thread;
    const fn = foundNeeds(t.needs, t.foundBy ?? null, fo.found, input.needs !== undefined ? "named" : "kept");
    t.needs = fn.needs;
    if (fn.found) t.foundBy = fn.found;
    else delete t.foundBy;
    if (turn != null) t.changedTurn = turn;
    if (was) heard.push(runningChanged(t, was, byId));
    changed.push(id);
  }
  if (goal) next.goal = goal;
  problems.push(...linkProblems(next, changed));
  problems.push(...threadClashes(next, changed));
  if (!problems.length) problems.push(...underProblems(next, changed));
  // A goal beside its tasks is one more thing the call changes.
  const many = inputs.length + (goal ? 1 : 0) > 1;
  if (problems.length) return form ? shaped("change", refusedAll(problems, many).error) : refusedAll(problems, many);
  const clashes = graphProblems(next);
  if (clashes.length) return refusedAll(clashes, many);
  // A sub-task moved out of its step may leave the step's others all done (11-06).
  const ended = settleSteps(next, at);
  const what = [...(changed.length ? [changed.join(", ")] : []), ...(goal ? ["the goal"] : [])].join(" and ");
  const worker = led(crew) ? "worker" : "sub-agent";
  // The threads this change gave anew: said as an add says them.
  const newThreads = changed.map((id) => /** @type {Task} */ (byId.get(id))).filter((t) => t.thread && graph.tasks.find((o) => o.id === t.id)?.thread?.id !== t.thread.id);
  // And the hunts' findings it gave anew.
  const newFound = changed.map((id) => /** @type {Task} */ (byId.get(id))).filter((t) => t.foundBy && graph.tasks.find((o) => o.id === t.id)?.foundBy?.agent !== t.foundBy.agent);
  return { ok: true, graph: next, text: `Changed ${what}.${heard.join("")}${stepsDoneWords(ended)}${freedWords(graph, next)}${threadWords(newThreads, crew)}${foundWords(newFound, graph.tasks)}${anew.length ? ` ${anew.join(", ")} ${anew.length === 1 ? "goes" : "go"} to a new ${worker} now, of the role ${anew.length === 1 ? "it names" : "each names"}: the last one can't go on with ${anew.length === 1 ? "it" : "them"}.` : ""} ${afterText(next, personAt)}${meetsOnce(next, crew, { shared })}`, changed: true };
}

/**
 * Drop tasks that are not done, with the reason — each of its tasks entries may give its own (11-09). A task not done
 * that needs one loses that need, and is named (the owner's of 11-09): it waits on the dropped one no more.
 * A sub-agent running a dropped task is stopped by the runner; a change that merges is let finish. `personAt`: when
 * the person last wrote (`afterText`).
 * @param {Graph} graph @param {Record<string, any>} i @param {number} at @param {number | null} [personAt] @returns {Applied | Refusal}
 */
function drop(graph, i, at, personAt = null) {
  const entries = entriesOf(i, "drop");
  if (typeof entries === "string") return shaped("drop", entries);
  const ids = entries.map((e) => e.id);
  const callWhy = text(i.reason);
  /** Each task's reason: its entry's own, else the call's. */
  const whys = new Map(entries.map((e) => [e.id, text(e.reason) || callWhy]));
  if ([...whys.values()].some((w) => !w)) return shaped("drop", "drop needs reason: why the tasks go", { ids });
  for (const w of new Set(whys.values())) {
    const longWhy = over("reason", w, LIMIT.reason);
    if (longWhy) return refused(longWhy);
  }
  const why = callWhy || /** @type {string} */ (whys.get(ids[0]));
  const next = structuredClone(graph);
  const byId = indexOf(next);
  /** @param {string} id @returns {string | null} */
  const stays = (id) => {
    const t = byId.get(id);
    if (!t) return `${id} is no task in the graph`;
    if (t.state === "dropped") return `${id} is dropped already`;
    if (t.state === "done") return `${id} is done, so there is nothing to drop`;
    if (t.state === "checking") return `${id} is being checked now — wait for its verdict`;
    if (claimed(t)) return claimedWords(t);
    // One whose merge the folder's check undid holds nothing in the folder: it may go (V2-2) — and one whose change waits
    // for its apply, which stays in its copy.
    if (t.state === "merging" && !goesBack(t) && !yours(t)) return `${id} is merging into the folder — it can't be dropped now`;
    return null;
  };
  // A step's open sub-tasks go with it (11-06).
  const kids = kidsOf(next);
  // One being checked is named too, so the drop waits for its verdict: it would open again under a dropped step.
  const withIt = ids.flatMap((id) => (kids.get(id) || []).filter((k) => (isOpen(k) || k.state === "checking") && !ids.includes(k.id)).map((k) => k.id));
  const all = [...ids, ...withIt];
  const problems = all.flatMap((id) => stays(id) || []);
  if (problems.length) return refusedAll(problems, all.length > 1);
  for (const id of all) {
    const t = /** @type {Task} */ (byId.get(id));
    Object.assign(t, { state: "dropped", why: whys.get(id) || why, endedAt: at, ...(goesBack(t) || yours(t) ? { step: null } : {}) });
  }
  // What needed one that went needs it no more (11-09): a task not done loses that need — one done keeps what it built on.
  /** @type {[string, string[]][]} */
  const unneeded = [];
  for (const t of next.tasks) {
    if (all.includes(t.id) || t.state === "done" || t.state === "dropped") continue;
    const gone = t.needs.filter((n) => all.includes(n));
    if (!gone.length) continue;
    t.needs = t.needs.filter((n) => !gone.includes(n));
    unneeded.push([t.id, gone]);
  }
  const one = unneeded.length === 1;
  const cutWords = !unneeded.length ? "" : all.length === 1 ? ` ${andWords(unneeded.map(([id]) => id))} needed it: ${one ? "that need is" : "those needs are"} cut.` : ` ${unneeded.map(([id, gone]) => `${id} needed ${andWords(gone)}`).join("; ")}: ${one && unneeded[0][1].length === 1 ? "that need is" : "those needs are"} cut.`;
  // A sub-task dropped may leave its step's others all done.
  const ended = settleSteps(next, at);
  const along = withIt.length ? `, and with ${ids.length === 1 ? "it" : "them"} the open sub-tasks ${fewIds(withIt)}` : "";
  return { ok: true, graph: next, text: `Dropped ${ids.join(", ")}${along}.${cutWords}${stepsDoneWords(ended)}${freedWords(graph, next)} ${afterText(next, personAt)}`, changed: true };
}

/**
 * Close the graph with its outcome: what is still open is dropped with it, and the next add starts another. Its done
 * tasks' checks run once more on the folder as it stands (the runner's, V2-1), which the words say.
 * @param {Graph} graph @param {Record<string, any>} i @param {number} at @param {Crew} crew @returns {Applied | Refusal}
 */
function close(graph, i, at, crew) {
  // A close that names a task meant that task, most likely (the Hunter on E40): it ends the whole graph, so it is
  // refused with the done of the task it named.
  const ids = readIds(i, "close");
  if (typeof ids !== "string") return shaped("close", `close names no task: it ends the whole graph and drops what is still open. To end ${ids[0]} alone: ${callFor("done", { id: ids[0] })}`);
  const reason = text(i.reason);
  if (!reason) return shaped("close", "close needs reason: the outcome in a sentence — what was done, and why anything left goes");
  const longReason = over("reason", reason, LIMIT.reason);
  if (longReason) return refused(longReason);
  const merging = graph.tasks.find((t) => t.state === "merging" && !goesBack(t));
  // A ready change is never done without its apply: the planner applies it or lets it go first.
  if (merging && yours(merging)) return refused(`${merging.id}'s change is ready and waits for its apply — apply it (${applyWords(crew, String(merging.agent))}), or drop it, then close the graph`);
  if (merging) return refused(`${merging.id} is merging into the folder — close the graph once it is done`);
  const next = structuredClone(graph);
  const open = next.tasks.filter(isOpen);
  for (const t of open) Object.assign(t, { state: "dropped", why: `closed: ${reason}`, endedAt: at, ...(goesBack(t) ? { step: null } : {}) });
  // A task still being checked is done: the close's run is its check (V2-1).
  for (const t of next.tasks) if (t.state === "checking") t.state = "done";
  next.closed = { at, reason };
  // A plan that waited for the person's go waits no more once it is closed (the review of the words rework).
  next.planning = null;
  const doneN = next.tasks.filter((t) => t.state === "done").length;
  return { ok: true, graph: next, text: `Closed the graph: ${doneN} done${open.length ? `, ${open.length} still open dropped with it` : ""}.${closeRunsWords(next, crew)}`, changed: true };
}

/** What a close says of its checks (V2-1): each distinct one runs once more, and is told — "" where none. @param {Graph} closed @param {Crew} crew */
function closeRunsWords(closed, crew) {
  const runs = closeRuns(closed);
  return runs.length ? ` Filament runs their checks once more on ${folderOf(crew)} as it stands — ${runs.map((r) => q(r.command)).join(", ")} — and you hear what comes.` : "";
}

/** The developer's folder, in the words of whoever plans (`crew`). @param {Crew} crew */
const folderOf = (crew) => (led(crew) ? "the folder" : "your folder");

/**
 * The checks a closed graph's run takes (V2-1): each distinct command of its done tasks' checks, in the order the tasks
 * were added and their commands given, with the tasks whose check holds it.
 * @param {Graph | null} graph @returns {{ command: string, tasks: string[] }[]}
 */
export function closeRuns(graph) {
  /** @type {Map<string, string[]>} */
  const by = new Map();
  for (const t of graph?.tasks || []) if (t.state === "done") for (const c of checkOf(t)) by.set(c, [...(by.get(c) || []), t.id]);
  return [...by].map(([command, tasks]) => ({ command, tasks }));
}

/**
 * What the close's run found (V2-1), kept with the closed graph — and, for a task whose own check had not run (it was
 * being checked as the graph closed), its verdict: passed where each of its commands did. A red command keeps the end
 * of its output; a flaky one, of its first run's (the hunt of check-wake).
 * @param {Graph} graph @param {CheckOutcome} o @param {number} at @returns {Graph}
 */
export function closeChecked(graph, o, at) {
  const next = structuredClone(graph);
  if (!next.closed) return next;
  const runs = closeRuns(next);
  if (!o.ran) {
    next.closed.checks = { at, ran: false, words: String(o.words || "") };
    return next;
  }
  const tasksOf = new Map(runs.map((r) => [r.command, r.tasks]));
  const kept = o.runs.map((r) => ({ command: r.command, exit: r.exit, ms: r.ms, first: r.first ? { exit: r.first.exit, ms: r.first.ms } : null, tasks: tasksOf.get(r.command) || [], output: r.exit !== 0 ? lastLines(r.output, CLOSE_RED_LINES) : r.first && r.first.exit !== 0 ? lastLines(r.first.output || "", CLOSE_RED_LINES) : "" }));
  next.closed.checks = { at, ran: true, runs: kept };
  for (const t of next.tasks) {
    if (t.state !== "done" || t.verdict || !checkOf(t).length) continue;
    const own = kept.filter((r) => checkOf(t).includes(r.command));
    if (own.length !== checkOf(t).length) continue;
    const red = own.find((r) => r.exit !== 0);
    const flake = own.find((r) => r.first && r.first.exit !== 0);
    t.verdict = { kind: red ? "failed" : flake ? "flaky" : "passed", runs: own.map(({ command, exit, ms, first }) => ({ command, exit, ms, first })), unrun: [], output: red ? red.output : flake ? flake.output : "", words: "", back: 0, at };
  }
  return next;
}

/**
 * What the planner hears of the close's run (V2-1): every check passed; or each command with its tasks and how it ran,
 * and the end of each red one's output; or why it did not run — and the end of a flaky one's first run's output.
 * @param {Graph} graph @param {Crew} crew
 */
export function closeChecksText(graph, crew) {
  const c = graph.closed?.checks;
  if (!c) return "";
  if (!c.ran) return `[Filament: Filament did not run the graph's checks after its close: ${c.words}.]`;
  const each = c.runs.map((r) => `${q(r.command)} (${r.tasks.join(", ")})${runWords(r).slice(q(r.command).length)}`).join("; ");
  const reds = c.runs.filter((r) => r.exit !== 0);
  const firsts = c.runs.filter((r) => r.exit === 0 && r.output).map((r) => `\nThe end of ${q(r.command)}'s first run's output:\n${r.output}`).join("");
  if (!reds.length) return `[Filament: after the graph's close, its checks passed on ${folderOf(crew)} as it stands: ${each}.${firsts}]`;
  const outputs = reds.filter((r) => r.output).map((r) => `\nThe end of ${q(r.command)}'s output:\n${r.output}`).join("");
  return `[Filament: after the graph's close, Filament ran its checks on ${folderOf(crew)} as it stands: ${each}. A check that passed when its task was done and fails now was broken by later work.${outputs}${firsts}]`;
}

/**
 * The lead's word over a change that fell short (G3-4): a failed task whose worker's change waits in its worktree
 * merges as it stands, and is done, the lead's reason riding its summary. `personAt`: when the person last wrote
 * (`afterText`).
 * @param {Graph} graph @param {Record<string, any>} i @param {number | null} [personAt] @returns {Applied | Refusal}
 */
function merge(graph, i, personAt = null) {
  const ids = readIds(i, "merge");
  if (typeof ids === "string") return shaped("merge", "merge needs id: the failed task whose change goes into the folder as it stands, with your reason", i);
  if (ids.length > 1) return shaped("merge", "merge takes one task at a time, each with its own reason — call it once a task", i);
  const id = ids[0];
  const reason = text(i.reason);
  if (!reason) return shaped("merge", "merge needs reason: why its change goes in as it stands", i);
  const longReason = over("reason", reason, LIMIT.reason);
  if (longReason) return refused(longReason);
  const next = structuredClone(graph);
  const t = indexOf(next).get(id);
  if (!t) return refused(`${id} is no task in the graph`);
  if (yours(t)) return refused(`${id}'s change is ready and waits for its apply — merge takes a failed task's change; apply this one: worker with agent_id "${t.agent}" and apply_changes: true`);
  if (t.state !== "failed") return refused(`${id} is ${stateWord(t)} — merge takes a failed task whose change waits in its worker's worktree`);
  if (!changes(t) || !t.report?.files.length) return refused(`${id} left no change waiting to merge — send it back, re-plan around it, or drop it`);
  // Its change met the folder and did not come in (the Hunter's of 10-28): a merge as it stands meets the same lines.
  if (unmerged(t)) return refused(`${id}'s change did not merge with the folder as it is — a merge as it stands meets the same overlap. ${UNMERGED_WAYS}`);
  Object.assign(t, { state: "merging", why: "", overruled: reason, overruledBy: "lead", endedAt: null });
  return { ok: true, graph: next, text: `Merging ${id}'s change as it stands, on your word. ${afterText(next, personAt)}`, changed: true };
}

/** Why nobody works on a task now, and what its planner can do instead of a note. @param {Task} t */
function nobodyWhy(t) {
  if (t.by === "you") return "it is your own task";
  if (t.by === COMMAND) return "it is a command task: Filament runs its commands, and no model reads a note";
  if (t.state === "waiting") return t.stopped ? "it was stopped — tasks start with its id and a note sends it on" : "it has not started — put what you want into the task itself with tasks change, and its sub-agent starts with it";
  if (t.state === "review") return t.step === "asked" ? "its review asked for changes, which go to its sub-agent next — send your note once it runs again" : "its change waits for its review — if the task falls short once that ends, send it back with a note";
  if (goesBack(t)) return "the folder's check undid its merge, and its change goes back to its sub-agent next — send your note once it runs again";
  if (yours(t)) return `its sub-agent has ended, and its change is ready and waits for its apply — apply it (agent with agent_id "${t.agent}" and apply_changes: true), or send it back with a note: tasks start with its id and note`;
  if (t.state === "merging") return "its sub-agent has ended, and its change is merging";
  if (t.state === "failed") return "it failed — send it back with a note: tasks start with its id and note";
  if (t.state === "done") return "it is done — plan what is missing as a new task";
  return `it is ${stateWord(t)}`;
}

/**
 * A line to whoever works on a task now (HarnessV3-TaskGraph-v2 TG2-D20): its sub-agent while it runs, its reviewer
 * while one reads its change. The graph does not change — the runner sends the line, which is read at that sub-agent's
 * next step — and its words go as written, whatever their length. Refused in words when nobody works on the task now,
 * with what can be done instead.
 * @param {Graph} graph @param {Record<string, any>} i
 * @returns {Applied | Refusal}
 */
function note(graph, i) {
  const ids = readIds(i, "note");
  if (typeof ids === "string" || ids.length > 1) return shaped("note", "note needs id: the one task whose sub-agent reads your note", i);
  const words = typeof i.note === "string" ? i.note.trim() : "";
  if (!words) return shaped("note", "note needs note: your line to the sub-agent working on the task — what to do instead, and why", i);
  const t = indexOf(graph).get(ids[0]);
  if (!t) return refused(`${ids[0]} is no task in the graph`);
  const agent = atWork(t);
  if (!agent) return refused(`nobody works on ${t.id} now: ${nobodyWhy(t)}`);
  return { ok: true, graph, text: "", changed: false, note: { id: t.id, agent, review: t.state === "review", text: words } };
}

/**
 * The sub-agent whose change a show of one task reads while its work goes on (TG2-D33): its worker's, while it runs or
 * its change is in review. Null for any other task, and for the planner's own.
 * @param {Graph | null} graph @param {unknown} id
 */
export function changeOf(graph, id) {
  const t = graph ? indexOf(graph).get(String(id ?? "").trim().toLowerCase()) : null;
  return t && t.by !== "you" && t.agent && (t.state === "running" || t.state === "review") ? t.agent : null;
}

/** An action said another way → the action (HarnessV4_TaskGraphEasy_Plan E40 case 2): each word one reading. */
export const ACTION_WORDS = Object.freeze({
  create: "add", new: "add", begin: "start", complete: "done", completed: "done", finish: "done", finished: "done",
  update: "change", edit: "change", modify: "change", remove: "drop", delete: "drop", cancel: "drop", end: "close",
  list: "show", view: "show", status: "show", hold: "pause", suspend: "pause", park: "pause", resume: "start", continue: "start",
  search: "find", grep: "find", lookup: "find", look_up: "find",
});
/** A task's field said another way → the field (case 6), read only where the task does not give the field itself. */
const FIELD_WORDS = Object.freeze({ title: "name", depends_on: "needs", dependencies: "needs", deps: "needs", after: "needs", blocked_by: "needs", parent: "under" });
/** A task's list fields; needs said as text splits on commas and spaces, the others are one item each (case 5). */
const LIST_FIELDS = Object.freeze(["needs", "writes", "check", "steps", "run", "items"]);

/** Ids said as text: "t1, t2" or "t1 t2". @param {string} s */
const idsOfText = (s) => s.split(/[,\s]+/).filter(Boolean);
/** The actions that name one task by its id, where ids of one are read as it. */
const ONE_TASK = Object.freeze(["done", "pause", "show", "keep", "read", "find"]);

/**
 * A tasks call as it was meant (E40, TG1): the common slips of a model that writes JSON less well, each read the one
 * way it can be read — an action in another case or said another way; tasks as JSON text, or one task alone; ids as
 * text, an id where ids are asked or ids of one where an id is; a task's list said as one string, its name as title, its
 * needs by another word; done's summary, drop's and close's reason given under another field. What it read loosely is
 * said (`said`), so the answer can teach the right form (TG-D2); anything that could mean two things is left as it
 * came, for the action to refuse in words (TG-D1).
 * @param {unknown} input @param {{ crew: Crew, solo?: boolean, reads?: boolean }} o
 * @returns {{ input: unknown, said: string[] }}
 */
export function asMeant(input, { crew, solo = false, reads = false }) {
  /** @type {string[]} */
  const said = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { input, said };
  const i = /** @type {Record<string, any>} */ ({ ...input });
  const actions = led(crew) ? LEAD_ACTIONS : reads && !solo ? READS_ACTIONS : TASK_ACTIONS;
  if (typeof i.action === "string") {
    const a = i.action.trim().toLowerCase().replace(/[\s-]+/g, "_");
    // "end" with a task named is that task's done; alone, the graph's close (the Hunter on E40): ending one task never
    // closes the whole graph.
    const named = ["id", "ids", "task_id", "taskId"].some((k) => i[k] != null && i[k] !== "" && !(Array.isArray(i[k]) && !i[k].length));
    const meant = actions.includes(a) ? a : a === "end" && named ? "done" : /** @type {Record<string, string>} */ (ACTION_WORDS)[a];
    if (meant && actions.includes(meant)) {
      if (meant !== a) said.push(`"${cut(text(i.action), 30)}" as ${meant}`);
      i.action = meant;
    }
  }
  // The task a call names: by another key, or ids where one is asked; ids by one id, or as text.
  for (const k of ["task_id", "taskId"])
    if (i[k] != null && i[k] !== "" && (i.id === undefined || i.id === null || i.id === "")) {
      said.push(`${k} as id`);
      i.id = i[k];
      delete i[k];
    }
  if (Array.isArray(i.id) && (i.ids === undefined || i.ids === null)) {
    said.push("id as ids");
    i.ids = i.id;
    delete i.id;
  }
  if (typeof i.ids === "string") {
    said.push("ids as a list");
    i.ids = idsOfText(i.ids);
  }
  // An action that takes one task: ids of one are its id (done, pause, and show, keep and read — the Hunter on E40).
  if (ONE_TASK.includes(i.action) && Array.isArray(i.ids) && i.ids.length === 1 && (i.id === undefined || i.id === null || i.id === "")) {
    said.push("ids of one as id");
    i.id = i.ids[0];
    delete i.ids;
  }
  if (i.action === "done" && !text(i.summary)) {
    const k = ["result", "text"].find((f) => text(i[f]));
    if (k) {
      said.push(`${k} as summary`);
      i.summary = i[k];
      delete i[k];
    }
  }
  // A pause's checkpoint given as the words of a note, a summary or text (E36).
  if (i.action === "pause" && !text(i.checkpoint)) {
    const k = ["text", "note", "summary", "reason"].find((f) => text(i[f]));
    if (k) {
      said.push(`${k} as checkpoint`);
      i.checkpoint = i[k];
      delete i[k];
    }
  }
  if ((i.action === "drop" || i.action === "close") && !text(i.reason) && text(i.summary)) {
    said.push("summary as reason");
    i.reason = i.summary;
    delete i.summary;
  }
  // A find's words under another name, or as a list (11-06).
  if (i.action === "find" && (i.words === undefined || i.words === null || i.words === "")) {
    const k = ["query", "q", "pattern", "search", "text"].find((f) => typeof i[f] === "string" && i[f].trim());
    if (k) {
      said.push(`${k} as words`);
      i.words = i[k];
      delete i[k];
    }
  }
  if (i.action === "find" && Array.isArray(i.words) && i.words.length && i.words.every((/** @type {unknown} */ w) => typeof w === "string")) {
    said.push("words as text");
    i.words = i.words.join(" ");
  }
  if (i.action === "keep")
    for (const f of ["files", "forget"])
      if (typeof i[f] === "string" && i[f].trim()) {
        said.push(`${f} as a list`);
        i[f] = [i[f]];
      }
  // The tasks: a list sent as JSON text, or one task alone.
  if (typeof i.tasks === "string") {
    try {
      const v = JSON.parse(i.tasks);
      if (Array.isArray(v) || (v && typeof v === "object")) {
        said.push("tasks was text, read as its list");
        i.tasks = Array.isArray(v) ? v : [v];
      }
    } catch {
      // Text that holds no list: the action says what it takes.
    }
  } else if (i.tasks && typeof i.tasks === "object" && !Array.isArray(i.tasks)) {
    said.push("one task as a list of one");
    i.tasks = [i.tasks];
  }
  if (Array.isArray(i.tasks))
    i.tasks = i.tasks.map((/** @type {any} */ t) => {
      if (!t || typeof t !== "object" || Array.isArray(t)) return t;
      const out = { ...t };
      const who = text(String(out.id ?? "")) || "a task";
      for (const [k, field] of Object.entries(FIELD_WORDS))
        if (out[k] !== undefined && out[field] === undefined) {
          said.push(`${who}'s ${k} as its ${field}`);
          out[field] = out[k];
          delete out[k];
        }
      for (const f of LIST_FIELDS)
        if (typeof out[f] === "string" && out[f].trim()) {
          said.push(`${who}'s ${f} as a list`);
          out[f] = f === "needs" ? idsOfText(out[f]) : [out[f]];
        }
      // A name too long is a title's slip, cut to its limit and said (11-09); a goal, steps and acceptance keep theirs.
      if ((i.action === "add" || i.action === "change") && typeof out.name === "string" && text(out.name).length > LIMIT.name) {
        said.push(`${who}'s name cut to ${LIMIT.name} characters`);
        out.name = cut(text(out.name), LIMIT.name);
      }
      return out;
    });
  return { input: i, said };
}

/** What a call read loosely, as its answer's last line says it (TG-D2). @param {readonly string[]} said */
export const meantWords = (said) => (said.length ? `Read as meant: ${said.join("; ")}.` : "");

/**
 * Each action's call whole, as a refusal of its shape ends with it (E40, TG2): a weaker model copies the form.
 * @type {Readonly<Record<string, string>>}
 */
export const TASK_CALLS = Object.freeze({
  add: '{"action":"add","goal":"Fix the login redirect","tasks":[{"id":"t1","name":"Find the cause"},{"id":"t2","name":"Fix it","needs":["t1"]}]}',
  start: '{"action":"start","ids":["t2"]}',
  pause: '{"action":"pause","id":"t2","checkpoint":"where it stands: what is done, what is next, what to re-read"}',
  done: '{"action":"done","id":"t2","summary":"what was done, in a line or two"}',
  change: '{"action":"change","tasks":[{"id":"t2","name":"Fix it in the router","needs":["t1"]}]}',
  drop: '{"action":"drop","ids":["t3"],"reason":"why it goes"}',
  close: '{"action":"close","reason":"the outcome, in a sentence"}',
  show: '{"action":"show"}',
  keep: '{"action":"keep","id":"t2","title":"Checkpoint","text":"where it stands, what is next"}',
  read: '{"action":"read","id":"t2","title":"Checkpoint"}',
  find: '{"action":"find","words":"retry backoff"}',
  offer: '{"action":"offer","depth":"standard","side_by_side":false}',
  parallel: '{"action":"parallel","ids":["t3","t4"]}',
  note: '{"action":"note","id":"t2","note":"what to do instead, and why"}',
  merge: '{"action":"merge","id":"t2","reason":"why it goes in as it stands"}',
});

/**
 * An action's call to copy, naming the task the refused call named (E40, TG2): a model that copies it whole never acts
 * on the example's task. A keep or a read that named none is the graph's own.
 * @param {string} action @param {Record<string, any> | null} [i]
 */
export function callFor(action, i = null) {
  const call = TASK_CALLS[action];
  if (!call || !i) return call;
  const ids = (Array.isArray(i.ids) ? i.ids : []).map((/** @type {unknown} */ x) => (typeof x === "number" ? String(x) : text(x))).filter(Boolean);
  const id = (typeof i.id === "number" ? String(i.id) : text(i.id)) || ids[0] || "";
  const shape = JSON.parse(call);
  if ("ids" in shape && (ids.length || id)) shape.ids = ids.length ? ids : [id];
  else if ("id" in shape && id) shape.id = id;
  else if ("id" in shape && (action === "keep" || action === "read")) delete shape.id;
  else return call;
  return JSON.stringify(shape);
}

/** The done call that carries evidence (E41 P2 case 9), naming the task: what a refused done of one with acceptance copies. @param {string} id */
const provenCall = (id) => JSON.stringify({ ...JSON.parse(callFor("done", { id })), evidence: "what shows its acceptance holds: a test's output, a command you ran, what you saw" });

/** A refusal of a call's shape (TG2): its words, then the action's call to copy. @param {string} action @param {string} error @param {Record<string, any> | null} [i] @returns {Refusal} */
const shaped = (action, error, i = null) => refused(TASK_CALLS[action] ? `${error}\nThe call: ${callFor(action, i)}` : error);

/**
 * One tasks call against the session's graph (null before its first add) → the graph after it and the words the
 * planner reads, or the refusal — the graph left as it was. `at` stamps what the call starts, ends or adds. `crew` says
 * who plans now: the agent, in its own words, or a team's lead, whose tasks name a worker's role and who has `merge`
 * (G3). `solo`: the agent is a coding agent, whose tasks are all its own (HarnessV3-ACP AC4-5). `resumable`: the
 * registry's word on whether a failed task's last worker can go on with it, sent back (HarnessV3-FailurePoints §6
 * item 4) — by default it can. `reads`: the agent reads along with its graph's sub-agents (HarnessV3-TaskGraph-v2
 * TG2-D20): it has `note`, and a show of one task says who works on it now — never a lead's, which reaches a task's
 * worker with its worker tool, nor a coding agent's, whose tasks are all its own.
 * `vet`: why a check's commands cannot be (V2-1) — the registry's word on the session's rules; by default none.
 * `threadOf`: memory's word on the thread a task names (E28) — by default, memory is not there. `foundOf`: the
 * registry's word on the Hunter a task's found_by names (11-02) — by default, none runs.
 * `kept`: what is kept behind each task (E33), which a show marks. A call that changed the graph says where its ready
 * tasks can now run side by side (E41 P3, `withSide`), for the agent to suggest on a card (`parallel`, the owner's of
 * 11-10); `parallel`: Parallelize tasks is on, the person's consent (the owner's of 11-09), and it says to run them
 * at once now. `planning`: a planning turn runs (the owner's plan mode of 11-06) — a /plan's or its answer's: it starts
 * nothing, and what it changes waits for the person's Approve (`planning` on the graph), which a start in a later turn
 * lets go of too. `shared`: the session's writing sub-agents share its folder (the chat's workspace is its folder), so none
 * works in a copy of its own, and two that write one file at once meet there (g1) — missing, the graph's own word
 * (`sharingOf`). `turn`: the chat's turn the call came in (11-09), kept on each task an add or a change touches; `kept`
 * on an add says whether anything is kept behind the graph, so a plan's add says once to keep its design.
 * @param {Graph | null} graph @param {unknown} input @param {{ at: number, crew: Crew, solo?: boolean, resumable?: Resumable, reads?: boolean, vet?: Vet, threadOf?: ThreadOf, foundOf?: FoundOf, kept?: Kept | null, parallel?: boolean, planning?: boolean, shared?: boolean, turn?: number | null, helping?: HelperAtWork, personAt?: number | null, model?: string | null }} o
 * `personAt`: when the person last wrote, which the answer that makes every task done weighs (`withEnd`). `model`: the
 * turn's model, else the chat's, by which a card the agent suggests answers itself (`suggestSide`).
 * @returns {Applied | Refusal}
 */
export function applyTasks(graph, input, o) {
  const r = tasksCall(graph, input, o);
  return r.ok ? withEnd(r, o.personAt) : r;
}

/** A tasks call's answer before the graph's all done is weighed (`applyTasks`). @param {Graph | null} graph @param {unknown} input @param {Parameters<typeof applyTasks>[2]} o @returns {Applied | Refusal} */
function tasksCall(graph, input, o) {
  const i = /** @type {Record<string, any>} */ (input && typeof input === "object" && !Array.isArray(input) ? input : {});
  // A planning turn (the owner's plan mode of 11-06) starts nothing: the plan waits for the person's Approve.
  if (o.planning && i.action === "start") return refused(PLANNING_START);
  if (o.planning && i.action === "offer") return refused("you are planning already: this turn is the plan the person chose — make it, and end your reply with its summary");
  // A suggestion to run tasks at once (the owner's of 11-10): never while the plan waits for its Approve, and never under
  // the person's consent — Parallelize tasks on —, where the agent starts them itself. A lead has no such action, and
  // hears that (`applyCall`): these words are the agent's, of sub-agents a lead does not start.
  const suggests = i.action === "parallel" && !led(o.crew);
  if (o.planning && suggests) return refused("the plan waits for the person's Approve: suggest nothing to start in this turn — once it goes, suggest the tasks that can run at once");
  if (o.parallel && suggests) return refused(`Parallelize tasks is on — the person's consent: no card asks them. Start the tasks that can run at once yourself, now: ${o.solo ? "Filament's agent tool, one each, the task in task" : "by: sub-agent, each with goal, steps and acceptance"}`);
  // A start in a later turn is the planner's go — the person said it in their words: the hold is let go first, and a
  // sub-agent's task it names starts as Filament starts it.
  const lift = !o.planning && i.action === "start" && !!graph?.planning && !graph.closed ? /** @type {Graph} */ (planGo(graph)) : null;
  if (lift) {
    const byId = indexOf(lift);
    // The tasks it names as the start reads them (the review of g3): ids, an id, or tasks entries.
    const entries = entriesOf(i, "start");
    const ids = typeof entries === "string" ? [] : entries.map((e) => e.id);
    // A task Filament starts — a sub-agent's, a command's — starts as Filament starts it, once its needs are done.
    const theirs = ids.filter((id) => {
      const t = byId.get(id);
      return !!t && t.by !== "you" && t.state === "waiting" && !t.stopped && !t.resume;
    });
    const freed = o.solo ? PLAN_FREED_SOLO : `${PLAN_FREED.slice(0, -1)}${theirs.length ? `, ${andWords(theirs)} among them` : ""}.`;
    if (theirs.length && theirs.length === ids.length) return { ok: true, graph: lift, text: `${freed} ${afterText(lift, o.personAt ?? null)}`, changed: true };
    const rest = typeof entries === "string" ? [] : entries.filter((e) => !theirs.includes(e.id));
    const r = applyCall(lift, theirs.length ? { ...i, id: undefined, ids: undefined, tasks: rest } : input, o);
    // The go stands though the start itself was refused (the review of the words rework): its words say why. What can
    // run side by side is said with it: `withSide` marks each task said once (the review of d81fdac5e).
    if (!r.ok) return { ok: true, graph: lift, text: `${freed} The start itself was refused: ${r.error}`, changed: true };
    const s = withSide(r, o.crew, o.solo ?? false, o.parallel ?? false, { shared: o.shared }, o.helping);
    return { ...s, text: `${freed} ${s.text}`, changed: true };
  }
  const r = applyCall(graph, input, o);
  if (!r.ok) return r;
  // A planning turn hears nothing of starting its tasks side by side (the review of c9eb95f24): the set is said once the
  // plan goes, where it is of use. A suggestion's answer says its card alone: the set it marks as said.
  const sided = o.planning ? r : withSide(r, o.crew, o.solo ?? false, o.parallel ?? false, { shared: o.shared }, o.helping);
  const out = i.action === "parallel" ? { ...sided, text: r.text } : sided;
  // What a planning turn changed waits for the person's Approve — and a card that stood goes: the agent judged it of the
  // plan before, and suggests again once the plan goes (the review of ef73c2a9d).
  if (!(o.planning && out.changed && out.graph && !out.graph.closed && !out.graph.planning)) return out;
  const held = { ...out.graph, planning: { at: o.at } };
  delete held.offer;
  return { ...out, graph: held };
}

/** What a plan let go says (11-06): the planner's start, or its checklist's, was the go. */
const PLAN_FREED = "The plan no longer waits for the person's Approve: Filament starts its sub-agents' tasks and its commands as their needs are done.";
/** The same to a coding agent (`solo`), whose tasks are all its own: Filament starts none of them. */
const PLAN_FREED_SOLO = "The plan no longer waits for the person's Approve.";

/** A start refused in a planning turn (11-06). */
const PLANNING_START = "the plan waits for the person's Approve: start none of it in this turn — they approve it, or say go in a message of their own. Plan, and end your reply";

/** The graph with its plan's hold let go — the person's Approve, or the planner's go (11-06) — or null where none held it. @param {Graph | null | undefined} graph */
export const planGo = (graph) => (graph?.planning ? { ...structuredClone(graph), planning: null } : null);

/** What a graph's words say of a plan that waits for the person's Approve (11-06). @param {Crew} crew */
const planWaitsWords = (crew) => `The plan waits for the developer's go: Filament starts none of its ${led(crew) ? "workers'" : "sub-agents'"} tasks until they approve it, in their own words, and you then start a task — one of theirs too, which Filament starts.`;

/**
 * One tasks call, its action's own answer (`applyTasks`).
 * @param {Graph | null} graph @param {unknown} input @param {{ at: number, crew: Crew, solo?: boolean, resumable?: Resumable, reads?: boolean, vet?: Vet, threadOf?: ThreadOf, foundOf?: FoundOf, kept?: Kept | null, parallel?: boolean, planning?: boolean, shared?: boolean, turn?: number | null, helping?: HelperAtWork, personAt?: number | null, model?: string | null }} o
 * @returns {Applied | Refusal}
 */
function applyCall(graph, input, { at, crew, solo = false, resumable = () => null, reads = false, vet = () => null, threadOf = noThreads, foundOf = noHunts, kept = null, parallel = false, planning = false, shared, turn = null, helping = helpersWork, personAt = null, model = null }) {
  const i = /** @type {Record<string, any>} */ (input && typeof input === "object" && !Array.isArray(input) ? input : {});
  const noting = reads && !led(crew) && !solo;
  const actions = led(crew) ? LEAD_ACTIONS : noting ? READS_ACTIONS : TASK_ACTIONS;
  if (!actions.includes(i.action)) return refused(`action must be one of ${actions.join(", ")}\n${TASK_CALLS.show} reads the graph; ${TASK_CALLS.add} starts one.`);
  const fields = led(crew) ? LEAD_FIELDS : solo ? SOLO_FIELDS : FIELDS;
  if (i.action === "add") return add(graph, i, at, fields, crew, vet, threadOf, foundOf, { shared, turn, kept, personAt });
  if (i.action === "show") {
    if (!graph) return { ok: true, graph, text: "No graph yet: tasks add starts one, with its goal.", changed: false };
    if (i.id === undefined || i.id === null || i.id === "") return { ok: true, graph, text: showText(graph, crew, kept, { shared }), changed: false };
    const one = taskText(graph, String(i.id), crew, noting, kept);
    return one === null ? refused(`${text(String(i.id))} is no task in the graph`) : { ok: true, graph, text: one, changed: false };
  }
  // What is kept behind a task (E33): checked here, kept or read by the runner; the graph is as it was. A find (11-06)
  // too: the runner looks through what is kept, `findText` says it.
  if (i.action === "keep" || i.action === "read" || i.action === "find") {
    const a = notesAsk(graph, i);
    return "kind" in a ? { ok: true, graph, text: "", changed: false, notes: a } : a;
  }
  // A plan offered on a card (11-06): read here, said under the reply by the session.
  if (i.action === "offer") {
    const depth = String(i.depth ?? "standard").trim().toLowerCase() || "standard";
    if (!PLAN_DEPTHS.includes(/** @type {any} */ (depth))) return shaped("offer", `depth is ${PLAN_DEPTHS.join(", ")} — the plan you suggest`);
    const side = i.side_by_side === true || i.side_by_side === "true";
    return { ok: true, graph, text: "", changed: false, offer: { depth: /** @type {PlanOffer["depth"]} */ (depth), side } };
  }
  if (!graph || graph.closed) return refused(noGraph(graph));
  // The ready tasks that can run at once, suggested to the person on a card (the owner's of 11-10).
  if (i.action === "parallel") {
    // Ids as a list, or as one string of them ("t3, t4", "t3 t4"), read as a start or a drop reads its ids (`readIds`):
    // in any case, each once — parallel alone answered that T1 is no task (the review of 67038d835).
    const given = (Array.isArray(i.ids) ? i.ids : typeof i.ids === "string" ? idsOfText(i.ids) : []).map((/** @type {unknown} */ x) => (typeof x === "number" ? String(x) : x)).filter((/** @type {unknown} */ x) => text(x));
    const ids = readIds({ ids: given }, "parallel");
    const s = suggestSide(graph, typeof ids === "string" ? [] : ids, { at, turn, shared, helping, model });
    if (!s.ok) return shaped("parallel", s.error, i);
    const byId = indexOf(s.graph);
    return { ok: true, graph: s.graph, text: suggestedWords(s.ids, s.ids.filter((id) => !byId.get(id)?.writes.length)), changed: true };
  }
  if (i.action === "start") return start(graph, i, at, crew, resumable, helping, personAt);
  if (i.action === "pause") return pause(graph, i, at, personAt);
  if (i.action === "done") return done(graph, i, at, crew, fields, helping, { personAt, side: planning ? null : { on: parallel, shared } });
  if (i.action === "change") return change(graph, i, fields, crew, vet, threadOf, foundOf, at, { shared, turn, personAt });
  if (i.action === "drop") return drop(graph, i, at, personAt);
  if (i.action === "merge") return merge(graph, i, personAt);
  if (i.action === "note") return note(graph, i);
  return close(graph, i, at, crew);
}

/** What a task's summary says when its checklist item ended it (V2-5): no line on what was done came with it. */
const TICKED = "ticked on the checklist";
/** An item's text as its task's name (TG2-D76): spacing squashed, cut to a name's length. @param {unknown} s */
const itemName = (s) => cut(text(s), LIMIT.name);
/** What an item is matched by: its name, case aside. @param {string} name */
const itemKey = (name) => name.toLowerCase();
/** The highest pN a graph's ids hold, 0 for none: a checklist's new task is numbered on from it. @param {Graph | null} graph */
const highestItem = (graph) => Math.max(0, ...(graph?.tasks || []).map((t) => Number(/^p(\d+)$/.exec(t.id)?.[1] ?? 0)));
/** Ids in a line: p1 to p5 where three or more run on, else one by one. @param {string[]} ids */
function idsWords(ids) {
  const n = ids.map((id) => Number(/^p(\d+)$/.exec(id)?.[1]));
  return ids.length >= 3 && n.every((x, k) => Number.isInteger(x) && (k === 0 || x === n[k - 1] + 1)) ? `${ids[0]} to ${ids.at(-1)}` : ids.join(", ");
}
/** Whether a checklist item's status says what its task's state is (V2-5). @param {string} status @param {Task} t */
const agrees = (status, t) =>
  status === "doing" ? t.state === "running" || t.state === "checking" || t.state === "review" || t.state === "merging" : status === "done" ? t.state === "done" : status === "blocked" ? t.state === "waiting" || t.state === "failed" : t.state === "waiting";
/** Someone else's task, in words: a worker's, or a command task. @param {Task} t */
const othersWords = (t) => (t.by === COMMAND ? "a command task" : whose(t.by));
/** Why the agent's own task waits though its item moves it, or null: needs not done yet. @param {Task} t @param {Map<string, Task>} byId */
function waitsWords(t, byId) {
  const open = needsOf(t, byId).map((n) => /** @type {Task} */ (byId.get(n))).filter((n) => !needMet(n, t));
  return open.length ? `${t.id} waits for its needs, ${open.map((n) => `${n.id} (${n.state})`).join(", ")}: it stays waiting.` : null;
}

/** The most steps a task keeps of a checklist (the owner's of 11-11), the first of a longer one. */
export const STEPS_MAX = 30;
/** A step's statuses, as the checklist's. */
const STEP_STATUSES = ["pending", "doing", "done", "blocked"];

/** A stopped task's state where its name alone reads ill after "though it is". @type {Partial<Record<TaskState, string>>} */
const STOPPED_WORDS = { checking: "being checked", review: "in review" };
/** A step's status as kept: the checklist's, else pending. @param {string} s */
const stepStatus = (s) => (STEP_STATUSES.includes(s) ? s : "pending");
/**
 * Whether its checklist made a task, where an item that named one added otherwise only took it (`took`): a task added
 * with the tasks tool stays the agent's own work, whose steps a checklist can be, once an item named it.
 * @param {Task} t
 */
const listMade = (t) => !!t.checklist && !t.took;
/** When a task last started: its start again from a pause, else its first start. @param {Task} t */
const lastStart = (t) => Math.max(t.startedAt ?? 0, t.againAt ?? 0);
/** The one started last of `ts`, or null. @param {readonly Task[]} ts @returns {Task | null} */
const newestStarted = (ts) => [...ts].sort((a, b) => lastStart(b) - lastStart(a))[0] ?? null;
/**
 * The task that holds the agent's checklist as its steps (`stepsOf`, the owner's of 11-11), or null: none once it is
 * dropped — a drop, a close or a graph carried away says nothing here, this reading does. A graph kept before it named
 * its holder: the one task of it that keeps steps; where several do, the graph does not tell whose were kept last, so
 * none — the task at work takes the next list, and holds them from then on.
 * @param {Graph} graph @returns {Task | null}
 */
function stepsHolder(graph) {
  if (graph.stepsOf !== undefined) return graph.tasks.find((t) => t.id === graph.stepsOf && t.state !== "dropped") ?? null;
  const keep = graph.tasks.filter((t) => t.state !== "dropped" && !!t.list?.length);
  return keep.length === 1 ? keep[0] : null;
}
/**
 * Whether a list is its holder's steps still (the owner's of 11-11): it shares a step with those the holder keeps, by
 * their text, and takes none of its done steps back to doing or pending — new work worded as old. While the holder is at
 * work that is all: a step more, less or reworded is its work going on. Once it is not — done, paused, a helper's, its
 * graph closed — every step it does not hold must be done: a late tick, a step less, one reworded or added that is done
 * stay its own, and a step still to do that it never held is new work. Two more hold a stopped holder back:
 * - on a closed graph nothing goes on with it, so a step it holds open that starts or changes is new work worded as its
 *   own, which gets a graph of its own; ticked done, or as it was, it is the same list sent again;
 * - beside another of the agent's own at work, a holder none of whose steps was ever ticked done gives no sign the list
 *   is its own, and the agents' words give a list to the task at work (the review of d73e88759, sa_efec5d53).
 * @param {Task} h @param {readonly { key: string, status: string }[]} sent  the items a task could keep: the first STEPS_MAX
 * @param {{ atWork: boolean, beside: boolean, shut: boolean }} o  `atWork`: the holder is at work; `beside`: another of
 *   the agent's own is; `shut`: the graph is closed
 */
function holdsStill(h, sent, { atWork, beside, shut }) {
  const kept = new Map((h.list || []).map((s) => [itemKey(s.text), stepStatus(s.status)]));
  const held = sent.filter((x) => kept.has(x.key));
  if (!held.length || held.some((x) => kept.get(x.key) === "done" && stepStatus(x.status) !== "done")) return false;
  if (atWork) return true;
  if (sent.some((x) => !kept.has(x.key) && stepStatus(x.status) !== "done")) return false;
  if (shut && held.some((x) => stepStatus(x.status) !== "done" && kept.get(x.key) !== stepStatus(x.status))) return false;
  return !beside || [...kept.values()].includes("done");
}
/**
 * The task a checklist's steps are of (the owner's of 11-11), for a list that names none of the graph's tasks: its holder
 * (`stepsHolder`) while the list is its steps still (`holdsStill`), whatever its state — at work, done, paused, its graph
 * closed; else the agent's own at work now (`ownRunning`: not a step whose sub-tasks do its work, nor one a helper works
 * on now), the one started last, and never one its checklist made — it holds the steps from then on. Null where neither
 * is: the list is a checklist of its own.
 * @param {Graph} graph @param {readonly { key: string, status: string }[]} list @param {HelperAtWork} helping
 * @returns {{ task: Task, atWork: boolean } | null}
 */
function stepsHost(graph, list, helping) {
  const working = graph.closed ? [] : ownRunning(graph, helping).filter((t) => !listMade(t));
  const h = stepsHolder(graph);
  const atWork = !!h && working.includes(h);
  if (h && holdsStill(h, list.slice(0, STEPS_MAX), { atWork, beside: working.some((t) => t !== h), shut: !!graph.closed })) return { task: h, atWork };
  const t = newestStarted(working);
  return t ? { task: t, atWork: true } : null;
}
/**
 * The task a checklist names as the one its items are the steps of (the checklist tool's `task`): one of the agent's own
 * at work, as `stepsHost` gives a list to — its id read as every id is, case aside —, or why it is none, in words that
 * say which are. The task that holds the steps now (`stepsHolder`), though not at work — marked done ahead of its last
 * ticks, paused, a helper's —, is no refusal and no task either (`task` null): its list is read as one that names none
 * (`stepsHost`), which keeps the last ticks its holder's own.
 * @param {Graph | null} graph @param {unknown} id @param {HelperAtWork} [helping]
 * @returns {{ ok: true, task: Task | null } | { ok: false, error: string }}
 */
export function stepsTask(graph, id, helping = helpersWork) {
  const working = graph && !graph.closed ? ownRunning(graph, helping).filter((t) => !listMade(t)) : [];
  const name = text(id).toLowerCase();
  const t = working.find((x) => x.id === name);
  if (t) return { ok: true, task: t };
  if (graph && !graph.closed && stepsHolder(graph)?.id === name) return { ok: true, task: null };
  const ids = working.map((x) => x.id);
  const are = ids.length ? `${name} is none: ${andWords(ids)} ${ids.length === 1 ? "is. Name it" : "are. Name one of them"}` : "none is now: start the task with tasks start first";
  return { ok: false, error: `task names one of your own tasks at work on your task graph, and ${are}, or leave task out.` };
}
/**
 * What a checklist that names its task is told where the list was not recorded: why, as `stepsTask` says it — or, left
 * out, that its checklist is on no graph (a team's lead's), so there is none to name. @param {string} [why]
 */
export const stepsRefused = (why = "task names one of your own tasks at work on your task graph, and this checklist is on none: leave task out.") => `Not recorded: ${why}`;

/** What a heap of ticks is told, once a turn: each item ticked as it starts and as it ends. @param {string[]} ids */
const HEAP_WORDS = (ids) => `You ticked ${idsWords(ids)} done at once, none of them doing first: tick each item doing as you start it and done as you finish it — the person follows your work by them.`;
/**
 * What a list sent says beyond what moved (a-ticks, the nudge map of 11-10), so a checklist kept loosely still says the
 * work: items ticked done at once, none doing first (`said.heaped`, two or more) — once a turn, marked on the graph
 * (`told`, "heap:<turn>"); an item still pending, its needs done, before one this list ticked done — said as a later
 * one is ticked, once a round of its task (`told`, "skip:<id>:<round>"); and an item worded anew — its task gone with
 * what tasks change gave it (a check,
 * acceptance, needs, writes, a step's place), a new task without it — where the same list adds one.
 * @param {Graph} next  the graph as the list leaves it, its `told` marked here
 * @param {readonly { status: string }[]} list  the items, in order, as `said.ids` names their tasks
 * @param {{ ids: string[], added: string[], done: string[], checking: string[], heaped: string[] }} said
 * @param {readonly Task[]} gone  the agent's own tasks the list dropped
 * @param {{ fresh: boolean, turn: number | null, byId: Map<string, Task> }} o
 * @returns {string[]}
 */
function tickWords(next, list, said, gone, { fresh, turn, byId }) {
  /** @type {string[]} */
  const words = [];
  const mark = `heap:${turn ?? ""}`;
  if (said.heaped.length >= 2 && !(next.told || []).includes(mark)) {
    words.push(HEAP_WORDS(said.heaped));
    next.told = [...(next.told || []).filter((m) => !m.startsWith("heap:")), mark];
  }
  const ticked = new Set([...said.done, ...said.checking]);
  const last = said.ids.findLastIndex((id) => ticked.has(id));
  const steps = kidsOf(next);
  // Each once, marked (`skip:<id>:<round>`): one the agent leaves pending on purpose is not named at every later tick
  // (FabeleHelper's envelope 31) — again only once it was done and reopened.
  const skipMark = (/** @type {string} */ id) => `skip:${id}:${byId.get(id)?.round ?? 1}`;
  const skipped = said.ids.slice(0, Math.max(0, last)).filter((id, i) => {
    const t = byId.get(id);
    return list[i]?.status === "pending" && !!t && t.by === "you" && t.state === "waiting" && !steps.has(id) && !waitsWords(t, byId) && !(next.told || []).includes(skipMark(id));
  });
  if (skipped.length) next.told = [...(next.told || []).filter((m) => !skipped.some((id) => m.startsWith(`skip:${id}:`))), ...skipped.map(skipMark)];
  if (skipped.length) words.push(`${skipped.join(", ")} still ${skipped.length === 1 ? "waits" : "wait"} while a later item is done: do ${skipped.length === 1 ? "it" : "them"} now, or take ${skipped.length === 1 ? "it" : "them"} off your checklist and say why.`);
  const had = (/** @type {Task} */ t) => [t.check.length ? "check" : "", t.acceptance ? "acceptance" : "", t.needs.length ? "needs" : "", t.writes.length ? "writes" : "", t.under ? "place under a step" : ""].filter(Boolean);
  const lost = fresh || !said.added.length ? [] : gone.filter((t) => had(t).length);
  if (lost.length === 1) {
    const [t] = lost;
    const what = had(t);
    const them = what.length === 1 && what[0] !== "needs" && what[0] !== "writes" ? "it" : "them";
    const added = said.added.length === 1 ? `${said.added[0]} is` : `${said.added.join(", ")} are`;
    words.push(`${t.id} left your checklist with its ${what.length > 1 ? `${what.slice(0, -1).join(", ")} and ${what.at(-1)}` : what[0]}, and ${added} new without ${them}: if ${said.added.length === 1 ? said.added[0] : "one of them"} is ${t.id} in new words, give it what ${t.id} had with tasks change by its id.`);
  } else if (lost.length)
    words.push(`${lost.map((t) => `${t.id} (its ${had(t).join(", ")})`).join(", ")} left your checklist, and ${said.added.join(", ")} ${said.added.length === 1 ? "is" : "are"} new without what they had: where one is an old item in new words, give it what that item had with tasks change by its id.`);
  return words;
}

/**
 * The agent's checklist on its graph (HarnessV3-TaskGraph-v2 V2-5, TG2-D8): each item the plan tool is given is a task
 * of the agent's own there (TG2-D76) — the task its text names, case and spacing aside: one its checklist made (whose
 * name a change may have changed since, TG2-D78), else one not dropped of that name, which the item takes — or a new
 * one, the next pN. Its status moves it forward only: doing starts a waiting task whose needs are done, done ends it as
 * tasks done does (one with a check is checked first, V2-1), blocked marks an open one and another status clears the
 * mark. Nothing moves a task back, and someone else's task follows its worker: either is said where its item says
 * otherwise. A task its checklist made, the agent's own, open and no longer listed, is dropped — unless an open task
 * that stays needs it; one added otherwise that an item took stays as it is when its item goes, the checklist's no
 * longer, said once. A list that names none of a graph its checklist made — no goal, no task added otherwise — whose
 * tasks are all done or dropped closes that graph (`closed`: its close's checks are the runner's to run) and starts a
 * new one, as a closed graph's next list does — numbered on, so no id names two tasks the agent heard of; on a graph
 * with a goal or a task added otherwise its items join as tasks, and the checklist closes nothing. Past MAX_TASKS the
 * graph takes none of it, said. Never refused: the plan is recorded whatever the graph takes.
 * A list is one of three things, read in this order (the owner's of 11-11):
 * 1. an item names a task of the graph: the checklist, as above;
 * 2. else the list is its holder's steps still (`stepsOf`, `holdsStill`): kept on that task (`list`), nothing closed,
 *    dropped or added — at work, done, paused, or on a closed graph, which stays closed unless it went on in a new chat;
 * 3. else one of the agent's own is at work (`stepsHost`): the steps of the one started last, which holds them from
 *    then on — a coding agent's as the loop's;
 * 4. else a new checklist: tasks p1, … as above.
 * `task`: the list names the task it is the steps of (`stepsTask`), and is that task's steps ahead of all four; one that
 * names no task of the agent's own at work is taken by nothing, said. An empty list names no steps: as with none named.
 * The graph keeps which task holds the steps, so no reader works it out again from the words: the Plan page reads it
 * (`graphView`).
 * In a planning turn (`planning`, 11-06) an item ticked as doing starts nothing, and a graph it changed waits for the
 * person's Approve, as a tasks call's does. `turn`: the chat's turn the call came in (11-09), kept on each task it adds, as
 * an add's is (the review of g3). `solo`: a coding agent's list, whose tasks tool gives no task to a sub-agent.
 * @param {Graph | null} graph @param {readonly { text: string, status: string }[]} items @param {{ at: number, crew: Crew, solo?: boolean, planning?: boolean, turn?: number | null, helping?: HelperAtWork, personAt?: number | null, task?: unknown }} o
 * `personAt`: when the person last wrote, which a tick that makes every task done weighs (`withEnd`).
 * Its items' statuses are remembered on their tasks (`item`), and a status moves its task only as it changes: a list
 * sent again whose item still says done ticks nothing a red check opened again (11-10). `remembered`: those alone
 * changed, kept with no task moved. `parts`: its words apart — the answer's own, at-once, next and how the work stands
 * now (`TickParts`) —, `text` the same in that order.
 * @returns {{ ok: true, graph: Graph | null, text: string, parts?: TickParts, changed: boolean, closed: Graph | null, remembered?: true }}
 */
export function applyPlan(graph, items, { at, crew, solo = false, planning = false, turn = null, helping = helpersWork, personAt = null, task = null }) {
  /** The items, each text once — the first of one given twice — and none with no text. */
  const list = [];
  /** Each item's words whole, by what it is matched by: two that differ only past a name's length are one item, said. @type {Map<string, string>} */
  const seen = new Map();
  let alike = 0;
  for (const it of items) {
    const name = itemName(it?.text);
    if (!name) continue;
    const whole = itemKey(squash(it?.text));
    const first = seen.get(itemKey(name));
    if (first !== undefined) {
      if (first !== whole) alike++;
      continue;
    }
    seen.set(itemKey(name), whole);
    list.push({ name, key: itemKey(name), status: String(it?.status || "pending") });
  }
  const sameWords = alike ? `${alike === 1 ? "One item reads as an earlier one in its" : `${alike} items read as earlier ones in their`} first ${LIMIT.name - 1} characters, all Filament keeps of an item: ${alike === 1 ? "it" : "each"} was taken as that one. Word them apart within ${LIMIT.name - 1} characters.` : "";
  const open = graph && !graph.closed ? graph : null;
  /** @type {{ ok: true, graph: Graph | null, text: string, changed: false, closed: null }} */
  const none = { ok: true, graph, text: "", changed: false, closed: null };
  if (!open && !list.length) return none;
  /** The task an item names. @param {Graph} g @param {string} key */
  const named = (g, key) => g.tasks.find((t) => t.state !== "dropped" && !!t.checklist && itemKey(t.checklist) === key) ?? g.tasks.find((t) => t.state !== "dropped" && !t.checklist && itemKey(t.name) === key) ?? null;
  // A list naming none of the graph's tasks is one task's steps where the graph says whose (`stepsHost`, the owner's of
  // 11-11): its holder's still, else the agent's own at work — kept on it and said on its box, no task made of them, so
  // the plan stays one. A closed graph's holder too, and its graph stays closed: its steps sent again change nothing the
  // person sees of it, where a new graph of them, all done, was one more to close. Not a graph carried on in a new chat,
  // whose tasks are that chat's alone (`carriedAway`).
  const shut = graph?.closed && !graph.closed.to ? graph : null;
  const on = open || shut;
  // A list that names its task (`task`) is that task's steps with nothing worked out, whatever its items name; one that
  // names no task of the agent's own at work is taken by nothing, said in the words that say which are. One that names
  // its holder, not at work, is read as one that names none.
  const told = typeof task === "string" && task.trim() && list.length ? stepsTask(open, task, helping) : null;
  if (told && !told.ok) return { ...none, text: `Your task graph took none of it: ${told.error}` };
  const host = told?.ok && told.task ? { task: told.task, atWork: true } : on && list.length && !list.some((x) => named(on, x.key)) ? stepsHost(on, list, helping) : null;
  if (on && host) {
    const next = structuredClone(on);
    const t = /** @type {Task} */ (next.tasks.find((x) => x.id === host.task.id));
    // The list becomes its steps, in the order and words it came in.
    const steps = list.slice(0, STEPS_MAX).map((x) => ({ text: x.name, status: stepStatus(x.status) }));
    const moved = JSON.stringify(t.list || []) !== JSON.stringify(steps);
    if (moved) Object.assign(t, { list: steps }, turn != null ? { changedTurn: turn } : {});
    // It holds the steps from now on, and the checklist as last sent is those steps: the page reads both. Another task
    // that held them until now keeps its own, said as they move: the agent's next list is read against this one's.
    const was = stepsHolder(next);
    const holds = next.stepsOf === t.id && next.stepsListed === true;
    if (!holds) Object.assign(next, { stepsOf: t.id, stepsListed: true });
    const changed = moved || !holds;
    const from = was && was.id !== t.id ? ` ${was.id} held your steps until now, and keeps those it had.` : "";
    const done = steps.filter((s) => s.status === "done").length;
    // Its box's line says them while it is at work as the agent's own, a helper's named on it never (views/task-graph.js
    // `stepsLine`); its card keeps them whatever its state (the review of d73e88759, sa_efec5d53).
    const where = host.atWork && !t.helper ? "said on its box" : t.state === "running" ? "kept on its card" : `kept on its card though it is ${STOPPED_WORDS[t.state] ?? t.state}`;
    // Past the steps a task keeps, the rest of the list goes nowhere: said, not lost unseen.
    const over = list.length - STEPS_MAX;
    const past = over > 0 ? ` Only your first ${STEPS_MAX} items are its steps: ${over === 1 ? "the one after them is" : `the ${over} after them are`} kept nowhere.` : "";
    // Every step done while it is at work: its task is still to mark done, which no step does. Said once, marked on the
    // graph (`told`, "steps:<id>"), and again only once a step of it was open in between.
    const mark = `steps:${t.id}`;
    const told = next.told || [];
    const all = done === steps.length;
    const say = all && host.atWork && !told.includes(mark);
    const unsay = !all && told.includes(mark);
    if (say) next.told = [...told, mark];
    if (unsay) next.told = told.filter((m) => m !== mark);
    const toMark = say ? ` Every step of ${t.id} is done: mark it done with tasks done when its work is finished.` : "";
    // A closed graph has nothing left to do or to close: said so, not how its work stands.
    const stands = open ? afterText(next, personAt) : "Its task graph stays closed.";
    const words = `Your checklist is ${t.id}'s steps: ${done} of ${steps.length} done, ${where}.${from}${past}${sameWords ? ` ${sameWords}` : ""}${toMark} ${stands}`;
    // What the answer marked as said alone is kept quietly, as an item's status is (`remembered`).
    const remembered = !changed && (say || unsay);
    return { ok: true, graph: changed || remembered ? next : graph, text: words, changed, closed: null, ...(remembered ? { remembered: /** @type {const} */ (true) } : {}) };
  }
  // A new checklist closes only a graph its checklist made — no goal, every task its own — once all of it is done: one
  // with a goal, or a task added otherwise, is its planner's to close with its outcome, and the items join it as tasks.
  const closing = !!open && list.length > 0 && open.tasks.length > 0 && !open.goal && open.tasks.every((t) => listMade(t) && (t.state === "done" || t.state === "dropped")) && !list.some((x) => named(open, x.key));
  /** @type {Graph | null} */
  const closed = closing && open ? { ...structuredClone(open), closed: { at, reason: "every task done" } } : null;
  const fresh = !open || closing;
  /** @type {Graph} */
  const next = fresh ? { version: GRAPH_VERSION, goal: "", tasks: [], startedAt: at, closed: null, held: null, rev: graph ? graph.rev : 0 } : structuredClone(open);
  const byId = indexOf(next);
  let n = highestItem(graph);
  const nextId = () => {
    do n++;
    while (byId.has(`p${n}`));
    return `p${n}`;
  };
  /** `heaped`: ticked done with no doing first, never started (`HEAP_WORDS`). @type {Record<"ids" | "added" | "started" | "done" | "checking" | "blocked" | "cleared" | "heaped", string[]>} */
  const said = { ids: [], added: [], started: [], done: [], checking: [], blocked: [], cleared: [], heaped: [] };
  /** @type {string[]} */
  const notes = [];
  for (const x of list) {
    const t = named(next, x.key);
    if (!t) {
      const id = nextId();
      // A planning turn's item ticked as doing waits with the plan (11-06).
      const state = x.status === "doing" && !planning ? "running" : x.status === "done" ? "done" : "waiting";
      if (x.status === "doing" && planning) notes.push(`${id} waits: ${PLANNING_START}.`);
      /** @type {Task} */
      const made = { id, name: x.name, needs: [], writes: [], acceptance: "", check: [], by: "you", goal: "", steps: [], review: false, checklist: x.name, item: x.status, blocked: x.status === "blocked", verdict: null, state, summary: state === "done" ? TICKED : "", why: "", addedAt: at, startedAt: state === "waiting" ? null : at, endedAt: state === "done" ? at : null, agent: null, tries: 0, resume: null, failures: null, unreviewed: "", note: "", report: null, earlier: null, merged: null, stopped: false, spentUsd: 0, ranAs: null, reviews: [], reviewer: null, step: null, overruled: "", gate: null, ...(turn != null ? { addedTurn: turn, changedTurn: turn } : {}) };
      next.tasks.push(made);
      byId.set(id, made);
      said.ids.push(id);
      said.added.push(id);
      continue;
    }
    said.ids.push(t.id);
    if (!t.checklist) Object.assign(t, { checklist: x.name, took: true });
    if (t.by !== "you") {
      if (!agrees(x.status, t)) notes.push(t.by === COMMAND ? `${t.id} is a command task: Filament's runs end it, not your checklist.` : `${t.id} is ${othersWords(t)}: its state follows its worker, not your checklist.`);
      continue;
    }
    const was = t.item;
    t.item = x.status;
    // Open again since its item said done — its check found it red, or tasks start reopened it, running or paused since
    // (the nudge map of 11-10; FabeleHelper's lt_3e272bf8 §1): the whole list, sent again for another item, still says
    // done — which ticked it done again on nothing fixed, its summary overwritten, its check run again. An item moves it
    // only as its status changes: back to doing while it is worked on, then done again. Said once a reopen — its round
    // and its verdict — marked on the graph (`told`, "held:<id>:<round>:<verdict's time>").
    if (x.status === "done" && was === "done" && t.state !== "done" && t.state !== "checking") {
      const key = `held:${t.id}:${t.round ?? 1}:${t.verdict?.at ?? 0}`;
      if (!(next.told || []).includes(key)) {
        notes.push(
          t.verdict?.kind === "failed"
            ? `${t.id} did not pass its check, so it is open again: its item still says done, which ticks nothing now — set it to doing while you fix the cause, then to done again.`
            : `${t.id} is open again since its item said done: its item still says done, which ticks nothing now — set it to doing while you work on it, then to done again.`,
        );
        next.told = [...(next.told || []).filter((m) => !m.startsWith(`held:${t.id}:`)), key];
      }
      continue;
    }
    if (t.state === "done" || t.state === "checking") {
      if (x.status !== "done") notes.push(t.state === "done" ? `${t.id} is done on your graph: its item does not reopen it.` : `${t.id} is being checked now: its item does not reopen it.`);
      continue;
    }
    if (x.status === "pending" && t.state === "running") notes.push(`${t.id} is started on your graph: its item does not move it back.`);
    // A paused task starts again with its checkpoint, which only tasks start hands back (E36).
    if (x.status === "doing" && t.state === "paused") notes.push(`${t.id} is paused on your graph: tasks start with id ${t.id} starts it again, its checkpoint with it.`);
    // A planning turn starts nothing (11-06): an item ticked as doing waits with the plan.
    if (x.status === "doing" && planning && t.state !== "running" && t.state !== "paused") {
      notes.push(`${t.id} waits: ${PLANNING_START}.`);
      continue;
    }
    // A step runs as its sub-tasks begin (11-06): its item does not start it, as tasks start does not.
    if (x.status === "doing" && t.state === "waiting" && kidsOf(next).has(t.id)) {
      notes.push(`${t.id} is a step: its work is its sub-tasks (${fewIds((kidsOf(next).get(t.id) || []).map((k) => k.id), 5)}), and it runs as they begin, not by its item.`);
      continue;
    }
    if ((x.status === "doing" && t.state !== "running" && t.state !== "paused") || x.status === "done") {
      // A step is done once its sub-tasks are (11-06): its item does not end it.
      const kidsOpen = x.status === "done" ? (kidsOf(next).get(t.id) || []).filter((k) => k.state !== "done").map((k) => k.id) : [];
      const why = kidsOpen.length ? `${t.id} has open sub-tasks (${fewIds(kidsOpen, 5)}): it is done once they are, not by its item.` : x.status === "done" && t.state === "running" ? null : waitsWords(t, byId);
      // A move refused leaves the item as the graph last took it (the hunt of a-red, sa_123498d1): a done remembered
      // here would hold the same list, sent again, as a task open again since its item said done, which it never was.
      if (why) {
        notes.push(why);
        t.item = was;
      }
      // What shows it done comes with its done (E41 P2 case 9): a tick carries none.
      else if (x.status === "done" && t.acceptance && !checkOf(t).length) {
        notes.push(`${t.id} has acceptance and no check: tasks done with id ${t.id}, its summary and evidence — what shows that holds — ends it; a tick does not.`);
        t.item = was;
      } else if (x.status === "doing") {
        // A task proposed from the person's message, its item ticked as doing, is taken on.
        delete t.proposed;
        Object.assign(t, { state: "running", why: "", startedAt: at });
        said.started.push(t.id);
      } else {
        delete t.proposed;
        if (t.state === "waiting" && t.startedAt == null) said.heaped.push(t.id);
        // As tasks done ends it (V2-1): a task with a check is done once Filament's run of it passes.
        const check = checkOf(t);
        Object.assign(t, { state: check.length ? "checking" : "done", summary: TICKED, why: "", startedAt: t.startedAt ?? at, endedAt: at, ...(check.length ? { verdict: null } : {}) });
        (check.length ? said.checking : said.done).push(t.id);
      }
    }
    const mark = isOpen(t) && x.status === "blocked";
    if (mark !== !!t.blocked) {
      if (isOpen(t)) (mark ? said.blocked : said.cleared).push(t.id);
      t.blocked = mark;
    }
  }
  // Left the checklist: a task its checklist made, the agent's own and open, goes, unless an open task that stays needs
  // it — or, a step, has a sub-task still open or being checked (the review of 11-06).
  const listed = new Set(said.ids);
  const left = next.tasks.filter((t) => !!t.checklist && !listed.has(t.id) && isOpen(t));
  const owned = left.filter(listMade);
  // One added otherwise that an item took was never the checklist's to drop: it stays as it is — its state, its
  // checkpoint, its steps — and is the checklist's no longer, so the next list says nothing of it and an item that names
  // it takes it again (a list of one task's steps, sent while none of them ran, dropped every task a checklist had named).
  const stays = left.filter((t) => !listMade(t)).map((t) => t.id);
  for (const id of stays) {
    const t = /** @type {Task} */ (byId.get(id));
    delete t.checklist;
    delete t.took;
    delete t.item;
    delete t.blocked;
  }
  const going = new Set(owned.filter((t) => t.by === "you").map((t) => t.id));
  /** @type {Map<string, { by: string, under: boolean }>} */
  const needed = new Map();
  for (let moved = true; moved; ) {
    moved = false;
    for (const id of going) {
      const by = next.tasks.find((u) => !going.has(u.id) && (isOpen(u) || u.state === "checking") && (u.needs.includes(id) || u.under === id));
      if (!by) continue;
      going.delete(id);
      needed.set(id, { by: by.id, under: by.under === id });
      moved = true;
    }
  }
  for (const id of going) Object.assign(/** @type {Task} */ (byId.get(id)), { state: "dropped", why: "it left your checklist", endedAt: at });
  // A ticked sub-task may end its step (11-06).
  const ended = settleSteps(next, at);
  if (next.tasks.length > MAX_TASKS) return { ...none, text: `Your task graph took none of it: a graph holds at most ${MAX_TASKS} tasks, and this checklist would make it ${next.tasks.length}.` };
  // The checklist as sent is the graph's tasks now: the task that holds steps keeps them, and holds them still for a list
  // of them sent again (`holdsStill`) — the page shows the checklist meanwhile.
  const holder = !fresh && list.length ? stepsHolder(next) : null;
  if (holder && (next.stepsOf !== holder.id || next.stepsListed !== false)) Object.assign(next, { stepsOf: holder.id, stepsListed: false });
  // What its items said, as the graph took it, is remembered (`item`) apart from what moved: a status alone that changed
  // moves no task, and is kept quietly (`remembered`) — and so is what the answer marks as said (`told`): a planning
  // turn's list that only said something holds no plan for the person's Approve.
  const bare = (/** @type {Graph | null} */ g) => JSON.stringify(g && { ...g, told: undefined, tasks: g.tasks.map(({ item, ...t }) => t) });
  const changed = fresh || bare(next) !== bare(open);
  const remembered = !changed && JSON.stringify(next) !== JSON.stringify(open);
  // What a planning turn's checklist changed waits for the person's Approve, as its tasks calls' does (11-06). In a later
  // turn, an item it starts lets the plan go, as a start does (the review of the words rework, 11-06: a plan kept on the
  // checklist was held for good once nothing read the Approve's words).
  if (planning && changed && !next.planning) next.planning = { at };
  const began = said.started.length > 0 || said.added.some((id) => byId.get(id)?.state === "running");
  if (!planning && began && next.planning && !next.closed) {
    next.planning = null;
    notes.push(solo ? PLAN_FREED_SOLO : PLAN_FREED);
  }
  const dropped = left.filter((t) => going.has(t.id)).map((t) => t.id);
  const ticks = tickWords(next, list, said, left.filter((t) => going.has(t.id)), { fresh, turn, byId });
  const moves = [
    ...(said.added.length && !fresh ? [`new: ${said.added.join(", ")}`] : []),
    ...(said.started.length ? [`${said.started.join(", ")} started`] : []),
    ...(said.done.length ? [`${said.done.join(", ")} done`] : []),
    ...(said.blocked.length ? [`${said.blocked.join(", ")} blocked`] : []),
    ...(said.cleared.length ? [`${said.cleared.join(", ")} no longer blocked`] : []),
    ...(dropped.length ? [`${dropped.join(", ")} left your checklist, dropped`] : []),
    ...(ended.length ? [`${ended.join(", ")} done with ${ended.length === 1 ? "its" : "their"} sub-tasks`] : []),
  ];
  if (!fresh && !said.ids.length && !moves.length && !changed) return none;
  const head = closing
    ? `Every task of your last task graph is done, and your checklist names none of them: Filament closed it (every task done).${closeRunsWords(/** @type {Graph} */ (closed), crew)} Your checklist starts a new one: ${idsWords(said.ids)}.`
    : fresh
      ? `Your checklist starts ${graph ? "a new task graph" : "your task graph"}: ${idsWords(said.ids)}.`
      : `On your task graph${said.ids.length ? ` as ${idsWords(said.ids)}` : ""}${moves.length ? ` — ${moves.join("; ")}` : ""}.`;
  const answer = [
    head,
    ...said.checking.map((id) => checkingWords(id, checkOf(/** @type {Task} */ (byId.get(id))), crew)),
    ...notes,
    ...[...needed].map(([id, n]) => `${id} left your checklist, but ${n.by} ${n.under ? "is a sub-task of it" : "needs it"}: it stays.`),
    ...owned.filter((t) => t.by !== "you").map((t) => `${t.id} left your checklist; it is ${othersWords(t)}, and stays.`),
    ...(stays.length ? [`${andWords(stays)} left your checklist: your checklist did not make ${stays.length === 1 ? "it, so it stays" : "them, so they stay"} on your task graph as ${stays.length === 1 ? "it is" : "they are"} — tasks drop takes ${stays.length === 1 ? "it" : "them"} off.`] : []),
    ...(sameWords ? [sameWords] : []),
    ...ticks,
    // What tasks change gives one: a coding agent's takes no `by` (`SOLO_FIELDS`), so its words offer no sub-agent.
    ...(said.added.length ? [solo ? "Give one a check or needs with tasks change, by its id." : "Give one a check, needs or a sub-agent with tasks change, by its id."] : []),
    ...(open && !fresh ? [freedWords(open, next).trim()].filter(Boolean) : []),
  ].join(" ");
  // The tick's lines apart (checkpoint.js "tick"), for the runner to put in their order with what follows them.
  const parts = {
    answer,
    atOnce: began ? atOnceWords(next, "checklist", helping) : "",
    // A tick that ended one (11-10): what comes next of its own, by name.
    next: !led(crew) && (said.done.length || said.checking.length || ended.length) ? nextWords(next, "checklist", helping) : "",
    now: afterText(next, personAt),
  };
  const text = [parts.answer, parts.atOnce, parts.next, parts.now].filter(Boolean).join(" ");
  return withEnd({ ok: /** @type {const} */ (true), graph: changed || remembered ? next : graph, text, parts, changed, closed, ...(remembered ? { remembered: /** @type {const} */ (true) } : {}) }, personAt);
}

/** The sub-agent at work on a task now, if any: its worker while it runs, its reviewer while it reads (G3-3). @param {Task} t */
const atWork = (t) => (t.by !== "you" && t.state === "running" ? t.agent : t.state === "review" && t.step === "reading" ? t.reviewer : null);

/**
 * The sub-agents a change let go: the tasks it dropped — a drop, or a close — while their sub-agents worked on them, a
 * reviewer reading one's change too. The runner stops each.
 * @param {Graph | null} before @param {Graph | null} after @returns {string[]}
 */
export function agentsToStop(before, after) {
  if (!before || !after) return [];
  const now = indexOf(after);
  return before.tasks.filter((t) => now.get(t.id)?.state === "dropped").flatMap((t) => atWork(t) || []);
}

/**
 * The sub-agents at work on the graph's tasks now, its reviewers reading included: the developer's Stop stops each (G2-8)
 * — all but their own side run's, with `side` false (10-28): a Stop of the planner's turn is not one of those.
 * @param {Graph} graph @param {{ side?: boolean }} [o]
 */
export const agentsAtWork = (graph, { side = true } = {}) => graph.tasks.flatMap((t) => (side || !t.side ? atWork(t) || [] : []));

/**
 * Whether the graph will still ask for a sub-agent, ended or not (the bug report's L9): an open task's worker — its
 * review's changes go back to it, its change merges, or a failed task's waits for the planner to apply by its id —
 * the reviewer that reads that change every round, and the try a send-back or the developer's stop set aside, whose
 * change the planner was told it may still apply. The registry keeps each.
 * @param {Graph | null} graph @param {string} agent
 */
export const holdsAgent = (graph, agent) => !!graph && graph.tasks.some((t) => isOpen(t) && (t.agent === agent || t.reviewer === agent || t.earlier?.agent === agent));

/**
 * What runs a task under whoever leads now (G3-2): under the agent, a sub-agent for a task that changes files and an
 * explorer for one that reads; under a team's lead, the member the task names — and for a task another planner's
 * words name, the team's builder where it changes files (else its first member that does) and its explorer where it
 * reads (roster.js `scoutOf`). Null: no member of the team can take it.
 * @param {{ by: TaskBy, writes: readonly string[] }} t @param {Crew} crew @returns {TaskBy | null}
 */
export function runsAs(t, crew) {
  if (t.by === "you") return "you";
  if (t.by === COMMAND) return COMMAND;
  if (!led(crew)) return TASK_BY.includes(t.by) ? t.by : changes(t) ? "sub-agent" : "explorer";
  if (memberOf(crew, t.by)) return t.by;
  return (changes(t) ? builderOf(crew) : scoutOf(crew))?.tag ?? null;
}

/**
 * @typedef {{ id: string, kind: "gate" | "fix" | "review" | "resume" | "start" | "command" }} Job  one thing Filament may
 *   start for a task: its worker on the folder's check its merge broke (V2-2), its worker on the changes its review
 *   asked for, its reviewer, its last worker going on with it once it was sent back, a new worker — or, for a command
 *   task, its runs (V2-3), which take lanes and no model slot
 */
/**
 * What Filament may start for the graph now (G2-3, G3-3), in the order it starts them: the changes the folder's check
 * sent back (V2-2), the changes reviews asked for, the reviews that wait, then the sub-agents' tasks whose needs are
 * done — work under way finishes first. Nothing while the graph is held, nor for a task the developer stopped; no new
 * task's start while its plan waits for the person's Approve (11-06).
 * @param {Graph | null} graph @returns {Job[]}
 */
export function jobs(graph) {
  // A closed graph starts nothing (the review of 58cfe9b31: a plan carried away kept what was open of it).
  if (!graph || graph.held || graph.closed) return [];
  const inReview = order(graph).filter((t) => t.state === "review" && !t.stopped);
  /** @param {Task[]} ts @param {Job["kind"]} kind @returns {Job[]} */
  const as = (ts, kind) => ts.map((t) => ({ id: t.id, kind }));
  // The developer's side run launches its own (10-28): never the runner's. A plan that waits for the person's Approve
  // (11-06) starts nothing new; the work under way — its reviews, their fixes, the folder's check's returns — goes on.
  const due = graph.planning ? [] : ready(graph).filter((t) => t.by !== "you" && !t.side?.pending);
  const back = order(graph).filter((t) => goesBack(t) && !t.stopped);
  return [...as(back, "gate"), ...as(inReview.filter((t) => t.step === "asked"), "fix"), ...as(inReview.filter((t) => t.step === "queued"), "review"), ...due.map((t) => ({ id: t.id, kind: /** @type {Job["kind"]} */ (t.by === COMMAND ? "command" : t.resume ? "resume" : "start") }))];
}

/**
 * Whether the graph's sub-agents hold work now: a task runs on one, a reviewer reads its change, or it merges — all but
 * the developer's own side run's, with `side` false (the Hunter's of 10-28: a turn waited on a side run started mid-turn).
 * A side run's change that merges is the planner's, which asked its apply: its turn waits on the verdict (apply-seen,
 * 11-11: its wait said nothing ran while the merge's check ran for minutes).
 * @param {Graph | null} graph @param {{ side?: boolean }} [o]
 */
export const busy = (graph, { side = true } = {}) => !!graph && graph.tasks.some((t) => (side || !t.side || t.state === "merging") && isLive(t));

/**
 * The task whose change merges next: merges go one at a time, in graph order (G2-5) — never one whose merge the folder's
 * check undid, which merges again once its worker reports (V2-2). @param {Graph | null} graph
 */
export const mergeNext = (graph) => (graph ? (order(graph).find((t) => t.state === "merging" && !goesBack(t) && !yours(t))?.id ?? null) : null);

/** A copy of the graph and its task, for a transition: null when there is no such task. @param {Graph} graph @param {string} id */
const withTask = (graph, id) => {
  const next = structuredClone(graph);
  const t = indexOf(next).get(id);
  return t ? { next, t } : null;
};

/**
 * A sub-agent took the task (G2-3), as `as` — the sub-agent or the team's role whoever leads starts it as (G3-2): it
 * runs, where its launch said it works (`workspace`, 11-09): in the folder, a worktree or a patch of its own — none kept
 * for a launch that said none, or a worker that writes nothing. Null when the task is not one Filament may start now.
 * @param {Graph} graph @param {string} id @param {string} agent @param {number} at @param {TaskBy} as
 * @param {string | null} [workspace]  the launch's workspace kind (`workspace-kind.js`)
 */
export function launched(graph, id, agent, at, as, workspace = null) {
  const w = withTask(graph, id);
  if (!w || w.t.by === "you" || w.t.state !== "waiting") return null;
  if (w.t.side) w.t.side.pending = false;
  Object.assign(w.t, { state: "running", agent, ranAs: as, tries: w.t.tries + 1, resume: null, startedAt: at, endedAt: null, report: null, why: "", merged: null, stopped: false, reviews: [], reviewer: null, step: null, gate: null });
  if (workspace === "folder" || workspace === "worktree" || workspace === "patch") w.t.workspace = workspace;
  else delete w.t.workspace;
  unruled(w.t);
  return w.next;
}

/**
 * The worker, or the reader, a task's step went to waits for a slot (the bug hunt of 10-30, SUB-3): its launch or its
 * going on found none free, so it starts by itself once one is, and the task says so meanwhile. Null where that one has
 * not the task's step now. @param {Graph} graph @param {string} id @param {string} agent @param {string} why @param {number} at
 */
export function slotWaited(graph, id, agent, why, at) {
  const w = withTask(graph, id);
  if (!w || atWork(w.t) !== agent) return null;
  w.t.slot = { agent, why, since: at };
  return w.next;
}

/**
 * The one that waited for a slot has its own and starts — or waits no more, stopped first: the task says so no more.
 * Null where it says no wait of that one's. @param {Graph} graph @param {string} id @param {string} agent
 */
export function slotEnded(graph, id, agent) {
  const w = withTask(graph, id);
  if (!w || w.t.slot?.agent !== agent) return null;
  w.t.slot = null;
  return w.next;
}

/**
 * Filament started a command task's runs (V2-3) on `lanes` lanes: it runs, its progress at none of them. Null when it is
 * no command task that waits to start.
 * @param {Graph} graph @param {string} id @param {number} at @param {number} lanes
 */
export function commandStarted(graph, id, at, lanes) {
  const w = withTask(graph, id);
  if (!w || w.t.by !== COMMAND || w.t.state !== "waiting" || w.t.stopped) return null;
  Object.assign(w.t, { state: "running", tries: w.t.tries + 1, startedAt: at, endedAt: null, why: "", progress: { ran: 0, passed: 0, of: commandRuns(w.t).length, lanes } });
  return w.next;
}

/** A running command task's runs so far (V2-3). Null when it runs no more. @param {Graph} graph @param {string} id @param {CommandProgress} progress */
export function commandProgress(graph, id, progress) {
  const w = withTask(graph, id);
  if (!w || w.t.by !== COMMAND || w.t.state !== "running") return null;
  w.t.progress = { ...progress };
  return w.next;
}

/**
 * The table a command task keeps of its runs (V2-3): those that ended — a run a stop cut never did — each command cut
 * to a record's length, and the end of the output of the first that did not pass alone.
 * @param {Extract<CommandOutcome, { ran: true }>} o @param {number} at @returns {CommandResult}
 */
function resultOf(o, at) {
  let kept = 0;
  const runs = o.runs
    .filter((r) => !r.stopped)
    .map((r) => {
      const keep = !r.passed && kept < KEEP_RED_RUNS;
      if (keep) kept += 1;
      return { item: r.item, command: cut(squash(r.command), KEEP.command), invert: !!r.invert, exit: r.exit, ms: r.ms, passed: !!r.passed, output: keep ? lastLines(r.output, RED_RUN_LINES).slice(-RED_RUN_CHARS) : "" };
    });
  return { runs, of: o.of, lanes: o.lanes, ms: o.ms, cut: !!o.cut, at };
}

/** Items in a sentence: "item m02", "items m02 and m03", the first ten and how many more. @param {readonly CommandRun[]} runs */
const itemsSaid = (runs) => {
  const items = runs.map((r) => String(r.item));
  const word = items.length === 1 ? "item" : "items";
  return items.length > 10 ? `${word} ${items.slice(0, 10).join(", ")} and ${items.length - 10} more` : `${word} ${listed(items)}`;
};
/** A run that did not pass, in a line: its command, its exit — "where it was to fail" for an inverted one — and its time. @param {CommandRun} r */
const runSaid = (r) => `${q(r.command)} ${r.exit === null ? "had no exit code" : `exit ${r.exit}`}${r.invert && r.exit !== null ? ", where it was to fail" : ""} (${durationWords(r.ms)})`;

/**
 * A command task's runs ended (V2-3): every one passed, it is done; one did not, it fails, naming those that did not; the
 * developer's stop cut it, it waits again, stopped, with what ran so far; not run, it fails in those words. Null when it
 * runs no more — dropped, or the graph closed.
 * @param {Graph} graph @param {string} id @param {CommandOutcome} o @param {number} at
 * @returns {{ graph: Graph, state: "done" | "failed" | "stopped" } | null}
 */
export function commandEnded(graph, id, o, at) {
  const w = withTask(graph, id);
  if (!w || w.t.by !== COMMAND || w.t.state !== "running") return null;
  const { next, t } = w;
  if (!o.ran) {
    Object.assign(t, { state: "failed", why: cut(`Filament could not run it: ${o.words}`, KEEP.why), endedAt: at, progress: null });
    failedAgain(t, causeOf("not run", o.words));
    return { graph: next, state: "failed" };
  }
  const result = resultOf(o, at);
  if (o.cut === "developer") {
    Object.assign(t, { state: "waiting", stopped: "developer", startedAt: null, endedAt: null, progress: null, result });
    return { graph: next, state: "stopped" };
  }
  const reds = result.runs.filter((r) => !r.passed);
  const short = result.runs.length < result.of;
  if (!reds.length && !short) {
    Object.assign(t, { state: "done", summary: result.of === 1 && !(t.items || []).length ? "it passed" : `${plural(result.of, "run")}, every one passed`, endedAt: at, progress: null, result });
    return { graph: next, state: "done" };
  }
  const why = !reds.length
    ? `Filament ran ${result.runs.length} of its ${plural(result.of, "run")}, and the rest did not end`
    : (t.items || []).length
      ? `${reds.length} of ${plural(result.of, "run")} did not pass: ${itemsSaid(reds)}`
      : `its run did not pass: ${runSaid(reds[0])}`;
  Object.assign(t, { state: "failed", why: cut(why, KEEP.why), endedAt: at, progress: null, result });
  failedAgain(t, reds.length ? "runs" : "short");
  return { graph: next, state: "failed" };
}

/**
 * The task's last worker went on with it, sent back (HarnessV3-FailurePoints §6 item 2): it runs again, in that
 * worker's conversation. Null when no resume of it is to start.
 * @param {Graph} graph @param {string} id @param {number} at
 */
export function resumed(graph, id, at) {
  const w = withTask(graph, id);
  if (!w || w.t.state !== "waiting" || !w.t.resume) return null;
  Object.assign(w.t, { state: "running", agent: w.t.resume, tries: w.t.tries + 1, resume: null, startedAt: at, endedAt: null, report: null, why: "", merged: null, stopped: false, reviews: [], reviewer: null, step: null, gate: null });
  unruled(w.t);
  return w.next;
}

/**
 * The task's last worker could not go on with it as it started (§6 item 4): the task fails in those words, and whoever
 * plans decides — a send-back with `fresh` gives it a new one.
 * @param {Graph} graph @param {string} id @param {string} why @param {number} at
 */
export function resumeRefused(graph, id, why, at) {
  const w = withTask(graph, id);
  if (!w || w.t.state !== "waiting" || !w.t.resume) return null;
  Object.assign(w.t, { state: "failed", why: cut(`its ${workerWord(w.t.ranAs)} ${w.t.resume} could not go on with it: ${why}`, KEEP.why), resume: null, endedAt: at });
  failedAgain(w.t, causeOf("resume", why));
  return w.next;
}

/**
 * Filament could not start the task's sub-agent, the one whoever leads starts it as (`as`): it fails, in the launch's
 * words (G2-6).
 * @param {Graph} graph @param {string} id @param {string} why @param {number} at @param {TaskBy} as
 */
export function launchRefused(graph, id, why, at, as) {
  const w = withTask(graph, id);
  if (!w || w.t.state !== "waiting") return null;
  if (w.t.side) w.t.side.pending = false;
  Object.assign(w.t, { state: "failed", why: cut(`Filament could not start its ${workerWord(as)}: ${why}`, KEEP.why), endedAt: at });
  failedAgain(w.t, causeOf("launch", why));
  return w.next;
}

/** How a run that did not end done ended, in the words a failure says. */
/** @typedef {"developer" | "lead" | "agent"} StoppedBy  whose stop set a task's work aside */
/**
 * Whose stop ended a sub-agent's run, where that sets its task aside instead of failing it: the developer's Stop
 * (G2-8), its team's lead's own (HarnessV4_Tasks B11), or the agent's with its agent tool (ag-stop, the owner's of
 * 11-11) — a planner that stops a worker means to say what is next, not that the work failed. Null for any other end: a
 * restart's cut, Filament's own stop. A dropped task's stop is the agent's too, and its end is no longer its task's.
 * @param {TaskEnd} end @returns {StoppedBy | null}
 */
const stopOf = (end) => (end.cut ? null : end.stoppedBy === "harness" ? "developer" : end.stoppedBy === "lead" ? "lead" : end.stoppedBy === "agent" ? "agent" : null);
/**
 * A done task's mark in its line, from its check's verdict: checked, checked (flaky), unchecked where none could run, or
 * its check failed (the close's run) — nothing where no check ran (V2-1). @param {Verdict | null} v
 */
const verdictMark = (v) => (!v ? "" : v.kind === "passed" ? ", checked" : v.kind === "flaky" ? ", checked (flaky)" : v.kind === "not" ? ", unchecked" : ", its check failed");
/** Whose stop it was, in the words a task's standing says. @param {StoppedBy | true} by */
const stoppedWords = (by) => `stopped by ${by === "lead" ? "its lead" : by === "agent" ? "the agent" : "the developer"}`;

const RUN_ENDED = Object.freeze({ failed: "failed", aborted: "was cut off before it finished", "budget-stopped": "stopped at a budget", stopped: "was stopped" });

/**
 * Why a sub-agent's end fails its task, with the cause two failures share when they failed the same way (§8 item 3 of
 * HarnessV3-FailurePoints), or null when its task is done (G2-6). A run that stopped on its provider says so (TG2-D3).
 * Where Filament ran the task's check (V2-1), its verdict decides, and the worker's `met` is a claim: a red one fails the
 * task, naming that claim where the report made it; a green one lets it go on, whatever `met` said. Where none ran,
 * `met` decides.
 * @param {TaskEnd} end @param {Task} t @param {Verdict | null} verdict @returns {{ why: string, cause: string } | null}
 */
function failureOf(end, t, verdict) {
  if (end.cut) return { why: "cut by a Filament restart", cause: "cut" };
  if (end.status !== "done") {
    if (end.provider) return { why: `it stopped on its provider, not on its task: ${end.provider.said}`, cause: "provider" };
    const ended = RUN_ENDED[/** @type {keyof typeof RUN_ENDED} */ (end.status)] || end.status;
    return { why: `its run ${ended}${end.error ? ` (${cut(squash(end.error), 200)})` : ""}`, cause: causeOf(`run ${ended}`, end.error || "") };
  }
  const r = end.report;
  if (!r) return { why: "it ended without its report", cause: "no report" };
  if (r.status !== "done") return { why: `it reported ${r.status}${r.left ? `: ${r.left}` : ""}`, cause: `reported ${r.status}` };
  if (verdict?.kind === "failed") {
    const back = verdict.back ? ` after going back to its ${workerWord(t.ranAs)} ${verdict.back === 1 ? "once" : "twice"}` : "";
    return { why: `Filament ran its check after it reported, and it failed${back}${r.met ? ", though its report said it passed" : ""}`, cause: "check" };
  }
  if (!passedOf(verdict) && !r.met) return { why: `its acceptance check did not pass: ${r.evidence}`, cause: "check" };
  if (end.workError) return { why: `its work could not be captured (${end.workError})`, cause: causeOf("work", end.workError) };
  return null;
}

/**
 * A task's sub-agent ended (G2-4 to G2-8): its try is kept with the task, and the task moves on from what Filament saw.
 * The developer's stop sends it back to waiting, held until the agent's next tasks call — and so does its lead's own,
 * or the agent's with its agent tool (`stopOf`). Done with its check passed, a writing sub-agent's change in its copy
 * is ready: it waits there for its apply (`yours`, the owner's of 11-02) — read by a reviewer before, when the task
 * asks for one (G3-3), as it is again after each fix; one that changed nothing, worked in the session's folder or only
 * read is done at once. Anything else fails it. Null for an end that is no longer the task's: it was dropped, or
 * another sub-agent holds it now.
 * @param {Graph} graph @param {string} id @param {TaskEnd} end @param {number} at
 * @returns {{ graph: Graph, state: "review" | "yours" | "done" | "failed" | "stopped" } | null}
 */
export function taskEnded(graph, id, end, at) {
  const w = withTask(graph, id);
  if (!w || w.t.state !== "running" || w.t.agent !== end.agent) return null;
  const { next, t } = w;
  const r = end.report;
  /** @type {Attempt} */
  const tried = {
    status: r ? r.status : null,
    did: r ? r.did : "",
    met: r ? r.met : null,
    evidence: r ? r.evidence : "",
    left: r ? r.left : "",
    words: r ? "" : cut(prose(end.words), KEEP.words),
    files: end.files.slice(0, KEEP_FILES).map(({ path, added, removed }) => ({ path, added, removed })),
    unnamed: end.files.filter((f) => !t.writes.some((w) => names(norm(w), norm(f.path)))).slice(0, KEEP_FILES).map((f) => f.path),
    ran: end.ran.slice(-KEEP_RAN).map(({ command, exit }) => ({ command: cut(squash(command), KEEP.command), exit })),
    calls: end.calls.slice(-KEEP_CALLS).map((c) => cut(squash(c), KEEP.call)),
    callsMade: end.calls.length,
    inFolder: end.shared,
    written: end.shared ? end.written : [],
    wrote: end.wrote,
    spentUsd: end.spentUsd,
    ms: end.ms,
    endedAt: at,
    provider: end.provider ?? null,
  };
  t.spentUsd = Math.round((t.spentUsd + end.spentUsd) * 1e6) / 1e6;
  const by = stopOf(end);
  if (by) {
    Object.assign(t, { state: "waiting", stopped: by, earlier: { agent: t.agent, ranAs: t.ranAs, report: tried, why: stoppedWords(by), reviews: t.reviews, stopped: by }, report: null, startedAt: null, reviews: [], reviewer: null });
    return { graph: next, state: "stopped" };
  }
  t.report = tried;
  // A writing task with no check takes the commands its worker's done report named (TG2-D63): the registry ran them as
  // its check, and they stay the task's — on its card, in the close's run, at the merge — until its planner changes it.
  if (!checkOf(t).length && changes(t) && end.taken?.length && r?.status === "done") Object.assign(t, { check: [...end.taken], checkBy: "worker" });
  // What Filament's check of its report found (V2-1): a task's own check, run once its worker reported done.
  const verdict = checkOf(t).length && end.check && r?.status === "done" && end.status === "done" && !end.cut ? verdictOf(end.check, at) : null;
  if (verdict) t.verdict = verdict;
  const failure = failureOf(end, t, verdict);
  if (failure) {
    Object.assign(t, { state: "failed", why: cut(failure.why, KEEP.why), endedAt: at });
    failedAgain(t, failure.cause);
    return { graph: next, state: "failed" };
  }
  // A change made in the folder itself — no git, or no worktree — is the files its write and edit calls named: a
  // reviewer reads them there (HarnessV3-FailurePoints §8 item 2), and there is nothing to merge.
  const inFolder = changes(t) && end.shared && tried.written.length > 0;
  if (changes(t) && (end.files.length || (inFolder && t.review))) {
    if (t.review) {
      Object.assign(t, { state: "review", step: "queued" });
      return { graph: next, state: "review" };
    }
    // Ready (the owner's of 11-02): its change waits in its copy for its apply, the main agent's or the developer's —
    // nothing of Filament's writes it into the folder while they work there.
    Object.assign(t, { state: "merging", step: "yours" });
    return { graph: next, state: "yours" };
  }
  const unnamed = t.review && changes(t) && end.shared && end.wrote && !inFolder;
  Object.assign(t, { state: "done", summary: tried.did, endedAt: at, unreviewed: unnamed ? "it worked in the folder itself, and none of its calls wrote or edited a file by name, so Filament can't tell a reviewer which files it changed" : "" });
  return { graph: next, state: "done" };
}

/**
 * Filament's check of a task of the planner's own ended (V2-1): passed or flaky, it is done; failed, it is open again —
 * running, its verdict kept for the planner to read; not run (`cut`: a stop's or a restart's words), done unchecked.
 * Null when the task is no longer being checked: the close took it, or it was changed since.
 * @param {Graph} graph @param {string} id @param {CheckOutcome} o @param {number} at @param {string} [cutWords]
 * @returns {{ graph: Graph, state: "done" | "open" } | null}
 */
export function checked(graph, id, o, at, cutWords) {
  const w = withTask(graph, id);
  if (!w || w.t.state !== "checking") return null;
  const verdict = verdictOf(o, at, cutWords);
  const open = verdict.kind === "failed";
  Object.assign(w.t, { verdict, state: open ? "running" : "done", endedAt: open ? null : at });
  return { graph: w.next, state: open ? "open" : "done" };
}

/** The tasks of the planner's own being checked now, whose check the runner runs (V2-1). @param {Graph | null} graph */
export const checkingIds = (graph) => (graph ? graph.tasks.filter((t) => t.state === "checking").map((t) => t.id) : []);

/** A reviewer took the task's change (G3-3): it reads. Null when no review of the task is to start. @param {Graph} graph @param {string} id @param {string} agent */
export function reviewLaunched(graph, id, agent) {
  const w = withTask(graph, id);
  if (!w || w.t.state !== "review" || w.t.step !== "queued") return null;
  Object.assign(w.t, { step: "reading", reviewer: agent });
  return w.next;
}

/** The task's sub-agent took the changes its review asked for (G3-3): it runs again, fixing them. @param {Graph} graph @param {string} id */
export function fixLaunched(graph, id) {
  const w = withTask(graph, id);
  if (!w || w.t.state !== "review" || w.t.step !== "asked") return null;
  Object.assign(w.t, { state: "running", step: null });
  return w.next;
}

/**
 * A step of a review Filament could not start — its reviewer, or the changes asked going to its sub-agent: the task
 * fails, in those words, and whoever plans decides (G3-3).
 * @param {Graph} graph @param {string} id @param {string} why @param {number} at
 */
export function reviewStepRefused(graph, id, why, at) {
  const w = withTask(graph, id);
  if (!w || w.t.state !== "review" || (w.t.step !== "queued" && w.t.step !== "asked")) return null;
  const what = w.t.step === "queued" ? "its review could not start" : `the changes its review asked for could not reach its ${workerWord(w.t.ranAs)}`;
  failedAgain(w.t, causeOf(w.t.step === "queued" ? "review start" : "review fix", why));
  Object.assign(w.t, { state: "failed", step: null, why: cut(`${what}: ${why}`, KEEP.why), endedAt: at });
  return w.next;
}

/** Why a reviewer's end makes no review, with its cause (§8 item 3 of HarnessV3-FailurePoints), or null (G3-3). @param {TaskEnd} end @returns {{ why: string, cause: string } | null} */
function reviewFailure(end) {
  if (end.cut) return { why: "its review was cut by a Filament restart", cause: "review cut" };
  if (end.status !== "done") {
    const ended = RUN_ENDED[/** @type {keyof typeof RUN_ENDED} */ (end.status)] || end.status;
    return { why: `its review could not be made: its reviewer's run ${ended}${end.error ? ` (${cut(squash(end.error), 200)})` : ""}`, cause: causeOf(`review run ${ended}`, end.error || "") };
  }
  if (!end.report) return { why: "its review could not be made: its reviewer ended without its report", cause: "review no report" };
  if (end.report.status !== "done") return { why: `its review could not be made: its reviewer reported ${end.report.status}${end.report.left ? `: ${end.report.left}` : ""}`, cause: `review reported ${end.report.status}` };
  return null;
}

/**
 * A task's reviewer ended (G3-3): its round is kept with the task. The change is ready — it waits in its copy for its
 * apply (the owner's of 11-02) — when the review finds it does what the task asks; changes asked go back to its
 * sub-agent while rounds are left, and at the last round the task
 * fails and whoever plans decides — as when the review could not be made. A change made in the folder itself is done
 * once met: there is nothing to merge (HarnessV3-FailurePoints §8 item 2). The developer's stop — or its lead's own, or
 * the agent's — puts the review back, held until the next tasks call, for the reviewer that read a round already. Null
 * for an end that is no longer the task's.
 * @param {Graph} graph @param {string} id @param {TaskEnd} end @param {number} at
 * @returns {{ graph: Graph, state: "review" | "yours" | "done" | "failed" } | null}
 */
export function reviewEnded(graph, id, end, at) {
  const w = withTask(graph, id);
  if (!w || w.t.state !== "review" || w.t.step !== "reading" || w.t.reviewer !== end.agent) return null;
  const { next, t } = w;
  t.spentUsd = Math.round((t.spentUsd + end.spentUsd) * 1e6) / 1e6;
  const by = stopOf(end);
  if (by) {
    Object.assign(t, { step: "queued", stopped: by });
    return { graph: next, state: "review" };
  }
  const r = end.report;
  const round = t.reviews.length + 1;
  t.reviews.push({ round, agent: end.agent, status: r ? r.status : null, met: r ? r.met : null, did: r ? r.did : "", evidence: r ? r.evidence : "", left: r ? r.left : "", words: r ? "" : cut(prose(end.words), KEEP.words), spentUsd: end.spentUsd, endedAt: at });
  const failure = reviewFailure(end) || (r?.met || round < REVIEW_ROUNDS ? null : { why: `its review still asked for changes at round ${round} of ${REVIEW_ROUNDS}: ${r?.left || r?.evidence}`, cause: "review asked" });
  if (failure) {
    Object.assign(t, { state: "failed", step: null, why: cut(failure.why, KEEP.why), endedAt: at });
    failedAgain(t, failure.cause);
    return { graph: next, state: "failed" };
  }
  if (r?.met && t.report?.inFolder) {
    Object.assign(t, { state: "done", step: null, summary: t.report.did, endedAt: at });
    return { graph: next, state: "done" };
  }
  if (r?.met) {
    Object.assign(t, { state: "merging", step: "yours" });
    return { graph: next, state: "yours" };
  }
  t.step = "asked";
  return { graph: next, state: "review" };
}

/**
 * What Filament says as it starts the sub-agents' tasks it may (G2-3): each task with the sub-agent that took it — or
 * that went on with it, the one of the try before (HarnessV3-FailurePoints §6 item 2) — and how the graph stands now.
 * @param {Graph} graph @param {readonly string[]} ids
 */
export function startedText(graph, ids) {
  const byId = indexOf(graph);
  const each = ids.map((id) => {
    const t = /** @type {Task} */ (byId.get(id));
    if (t.by === COMMAND) return `${id}'s runs ${atATime(t.progress?.lanes ?? 1)}`;
    if (t.earlier?.agent === t.agent) return `${id} again on its ${workerWord(t.ranAs)} ${t.agent}, in its own conversation${slotWords(t)}`;
    return `${id} on ${aOrAn(/** @type {TaskBy} */ (t.ranAs))} (${t.agent})${slotWords(t)}`;
  });
  return `Filament started ${each.join(", ")}. ${nowWords(graph)}`;
}

/**
 * A task's change is in the folder (G2-5): it is done — on the word of whoever asked it in as it stood, its summary says,
 * the lead's or the agent's (G3-4) — with what Filament's check of the folder found as it merged (V2-2): null where none
 * ran. `marked`, `kept`: the files its planner's overlap brought in with git's conflict markers, for it to resolve, and
 * those it kept as the folder had them (the owner's of 11-09) — its summary names them, and its box.
 * @param {Graph} graph @param {string} id @param {readonly { path: string, added: number, removed: number }[]} files @param {number} at
 * @param {Gate | null} [gate] @param {{ marked?: readonly string[], kept?: readonly string[] }} [o]
 */
export function taskMerged(graph, id, files, at, gate = null, { marked = [], kept = [] } = {}) {
  const w = withTask(graph, id);
  if (!w || w.t.state !== "merging" || goesBack(w.t)) return null;
  const merged = { files: files.length, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0), ...(marked.length ? { marked: marked.slice(0, 10) } : {}), ...(kept.length ? { kept: kept.slice(0, 10) } : {}) };
  const did = w.t.report?.did || "";
  const named = (/** @type {readonly string[]} */ ps) => listed([...ps.slice(0, 10), ...(ps.length > 10 ? [`${ps.length - 10} more`] : [])]);
  const overlap = [...(marked.length ? [`Git's conflict markers stand in ${named(marked)}, for its planner to resolve.`] : []), ...(kept.length ? [`The folder's version of ${named(kept)} was kept, its change to ${kept.length === 1 ? "it" : "them"} set aside.`] : [])];
  Object.assign(w.t, { state: "done", step: null, summary: [w.t.overruled || w.t.overruledBy ? `${did}\nMerged ${asItStood(w.t)}`.trim() : did, ...overlap].filter(Boolean).join("\n"), merged, endedAt: at, gate });
  forgetRebases(w.t);
  broughtIn(w.next, id, files);
  return w.next;
}

/** How many files a task keeps of what came into the folder while it ran. */
const BROUGHT_KEPT = 200;

/**
 * A change came into the folder — the graph's merge of `id`, or the developer's apply of it (11-09): each task of the
 * planner's own running in it with a span open keeps the files, in place, so what it did is read without them
 * (`changedText`, the Plan's `beyond`).
 * @param {Graph} next @param {string} id @param {readonly { path: string }[]} files
 */
function broughtIn(next, id, files) {
  if (!files.length) return;
  for (const t of next.tasks)
    if (t.id !== id && t.by === "you" && t.base && (t.state === "running" || t.state === "checking"))
      t.brought = [...new Set([...(t.brought || []), ...files.map((f) => f.path)])].sort().slice(0, BROUGHT_KEPT);
}

/**
 * The folder's check undid the task's merge (V2-2): the verdict is kept, and the change goes back to its worker — the
 * task merging still, step `back`, until a slot is free (`jobs`) — or, sent back twice already or unable to go, the task
 * fails, and whoever plans decides. Null when the task is not merging.
 * @param {Graph} graph @param {string} id @param {Gate} gate @param {number} at
 * @returns {{ graph: Graph, state: "back" | "failed" } | null}
 */
export function gateUndone(graph, id, gate, at) {
  const w = withTask(graph, id);
  if (!w || w.t.state !== "merging" || goesBack(w.t) || !gate.broke || !gate.back) return null;
  const { next, t } = w;
  const back = gate.back;
  // The lead's word was for the change as it stood: one sent back comes again as new work.
  t.gate = gate;
  unruled(t);
  if ("n" in back) {
    t.step = "back";
    return { graph: next, state: "back" };
  }
  const worker = workerWord(t.ranAs);
  const how = "twice" in back ? `it went back to its ${worker} twice already` : `it could not go back to its ${worker} (${back.why})`;
  Object.assign(t, { state: "failed", step: null, why: cut(`its change broke your folder's check: ${brokeSaid(gate.broke, "your folder")}; Filament undid the merge, and ${how}`, KEEP.why), endedAt: at });
  failedAgain(t, "gate");
  return { graph: next, state: "failed" };
}

/** The task's worker took its change back from the folder's check (V2-2): it runs again. Null for any other task. @param {Graph} graph @param {string} id */
export function gateLaunched(graph, id) {
  const w = withTask(graph, id);
  if (!w || !goesBack(w.t)) return null;
  Object.assign(w.t, { state: "running", step: null });
  return w.next;
}

/**
 * The change the folder's check undid could not go back to its worker (V2-2): the task fails, in those words, and
 * whoever plans decides. @param {Graph} graph @param {string} id @param {string} why @param {number} at
 */
export function gateStepRefused(graph, id, why, at) {
  const w = withTask(graph, id);
  if (!w || !goesBack(w.t)) return null;
  failedAgain(w.t, "gate");
  Object.assign(w.t, { state: "failed", step: null, why: cut(`its change broke your folder's check, and Filament undid the merge, but the change could not go back to its ${workerWord(w.t.ranAs)}: ${why}`, KEEP.why), endedAt: at });
  return w.next;
}

/**
 * A task's change did not merge — a conflict, or an apply that failed: it fails, in the apply's words. `overlapped`: it
 * overlapped the folder's edits, so its planner's apply takes overlap (the owner's of 11-09), its end says.
 * @param {Graph} graph @param {string} id @param {string} why @param {number} at @param {boolean} [overlapped]
 */
export function taskMergeFailed(graph, id, why, at, overlapped = false) {
  const w = withTask(graph, id);
  if (!w || w.t.state !== "merging" || goesBack(w.t)) return null;
  Object.assign(w.t, { state: "failed", why: cut(`its change did not merge: ${why}`, KEEP.why), endedAt: at });
  if (overlapped) w.t.overlapped = true;
  else delete w.t.overlapped;
  unruled(w.t);
  failedAgain(w.t, "merge");
  return w.next;
}

/**
 * Why the chat's plan cannot be carried into a new chat now (the owner's plan mode of 11-06, piece E), or null: it has
 * one open, and nothing of it is at work here — a sub-agent on a task, its review, its merge, the folder's check of it,
 * a command's run —, nor a change waiting for its Apply or a rebase: those belong to this chat, and would end with nobody
 * to tell (the review of 58cfe9b31). The session judges the chat's own turns and helpers (`busyOf`).
 * @param {Graph | null | undefined} graph
 */
export function carryRefusal(graph) {
  if (!graph || graph.closed || !graph.tasks.some(isOpen)) return "this chat has no open plan to carry";
  const at = graph.tasks.filter((t) => isLive(t) || t.state === "review" || t.state === "merging" || (t.by === COMMAND && t.state === "running")).map((t) => t.id);
  const one = at.length === 1;
  if (at.length) return `${fewIds(at, 5)} ${one ? "is" : "are"} still at work in this chat — on a sub-agent, in review or merging: carry the plan once ${one ? "it ends" : "they end"}, or stop ${one ? "it" : "them"} first`;
  const waits = graph.tasks.filter((t) => unmerged(t) || (t.state === "waiting" && !!t.resume && !!t.earlier?.rebased)).map((t) => t.id);
  const alone = waits.length === 1;
  return waits.length ? `${fewIds(waits, 5)}'s change${alone ? "" : "s"} still wait${alone ? "s" : ""} in this chat — for an Apply that did not merge, or a rebase: apply ${alone ? "it" : "them"} or let ${alone ? "it" : "them"} go first, then carry the plan` : null;
}

/**
 * A plan's tasks as a carry leaves them, in the chat that takes it and in the one it closes in alike (piece E): what ran
 * of the planner's own paused — it goes on in the new chat, by its start —, a check that ran done unchecked, a side
 * run's launch's task given back, and none of the helpers, workers to go on with or slots that were the old chat's.
 * @param {Graph} graph @param {number} at @returns {Graph}
 */
const leftAsCarried = (graph, at) => {
  const next = structuredClone(graph);
  const steps = kidsOf(next);
  for (const t of next.tasks) {
    if (t.side?.pending && t.state === "waiting") giveBack(t);
    if (t.state === "checking") Object.assign(t, { state: "done", verdict: verdictOf({ ran: false, words: "its plan was carried into a new chat before its check ended" }, at), endedAt: at });
    else if (t.state === "running" && t.by === "you" && !steps.has(t.id)) t.state = "paused";
    delete t.helper;
    if (t.slot) t.slot = null;
    if (t.resume) t.resume = null;
  }
  return /** @type {Graph} */ (rollUp(next, at) || next);
};

/**
 * The plan as a new chat takes it (piece E): its tasks with their ids, its goal and its start — the notes and files kept
 * behind it go with it, by that start. What ran of the planner's own here waits paused there, a check this chat ran
 * ends unchecked, a side run's launch gives its task back, and what belonged to this chat — a helper, a worker to go on
 * with, a slot, the card it offered, what its answers said once, where the folder stood as a task ran — stays behind;
 * a stop goes with it, so nothing starts there before its planner's tasks call. Its planner hears where it came from at
 * the new chat's first turn (`from`, until `heard`). Call it on a graph `carryRefusal` passes.
 * @param {Graph} graph @param {{ at: number, from: { chain: string, title: string } }} o @returns {Graph}
 */
export function carriedGraph(graph, { at, from }) {
  const next = leftAsCarried(graph, at);
  delete next.offer;
  delete next.told;
  // The folder may be another (a fork with its own worktree): a task's next span reads it afresh.
  for (const t of next.tasks) if (t.base) t.base = null;
  next.rev = 0;
  next.from = { chain: from.chain, title: from.title, at };
  return next;
}

/**
 * The planner heard where its plan came from (piece E): said at the new chat's first turn, whatever kept the graph
 * before it. Null where there is nothing to say. @param {Graph | null} graph @returns {Graph | null}
 */
export const fromHeard = (graph) => (graph?.from && !graph.from.heard ? { ...structuredClone(graph), from: { ...graph.from, heard: true } } : null);

/**
 * The plan the chat carried into a new one (piece E): closed here, saying where it went on, what was open dropped with
 * it as a close drops it — so nothing of it starts here again, a check that ran is no task done here, and its tasks
 * are the new chat's alone (the review of 58cfe9b31). @param {Graph} graph @param {{ at: number, to: string, title: string }} o @returns {Graph}
 */
export function carriedAway(graph, { at, to, title }) {
  const next = structuredClone(graph);
  const went = `carried on in a new chat${title ? `, "${cut(title, 80)}"` : ""}`;
  for (const t of next.tasks) {
    if (!isOpen(t) && t.state !== "checking") continue;
    Object.assign(t, { state: "dropped", why: went, endedAt: at, ...(goesBack(t) ? { step: null } : {}) });
    delete t.helper;
    if (t.slot) t.slot = null;
    if (t.resume) t.resume = null;
  }
  delete next.offer;
  next.held = null;
  next.planning = null;
  next.closed = { at, reason: `${went}: its tasks, and the notes and files kept behind them, went with it`, to };
  return next;
}

/**
 * The tasks a Filament restart cut (G2-9): a sub-agent's task that ran, was in review or whose change merged, fails —
 * nothing starts it again by itself, nor reaches its sub-agents, which no restart keeps (G3-3). A side run's launch that
 * waited for the planner's turn gives its task back (`back`, 10-28). Null when the restart cut none.
 * @param {Graph} graph @param {number} at @returns {{ graph: Graph, ids: string[], back: string[] } | null}
 */
export function restartCut(graph, at) {
  const next = structuredClone(graph);
  /** @type {string[]} */
  const ids = [];
  /** @type {string[]} */
  const back = [];
  for (const t of next.tasks) {
    // A side run's launch that waited for the planner's turn (10-28): the restart took it, so the task is its planner's
    // again, its brief as it left it — said.
    if (t.side?.pending && t.state === "waiting") {
      giveBack(t);
      back.push(t.id);
      continue;
    }
    // Sent back from its merge to redo on the folder, its worker not yet on it (the owner's of 11-09): it keeps waiting,
    // its count kept — no restart keeps a worker to go on with it, so a new one redoes it from the folder as it stands,
    // the earlier try in its brief. Said, as nothing of it was written into the folder.
    if (t.state === "waiting" && t.resume && t.earlier?.sentBy) {
      t.resume = null;
      ids.push(t.id);
      continue;
    }
    // Sent back to rebase, its worker not yet on it (the Hunter's of 10-28): no restart keeps a worker to go on with it,
    // and the graph waited for one all the same, its work no Apply's. Its change, redone on the folder, waits in its copy
    // again as one that did not merge — for the developer's Resolve in Changes, or a new worker.
    if (t.state === "waiting" && t.resume && t.earlier?.rebased) {
      Object.assign(t, { state: "failed", why: "its change did not merge, and a Filament restart came before its worker went on with its rebase: its change, redone on your folder, waits in its copy", agent: t.earlier.agent, report: t.earlier.report, ranAs: t.earlier.ranAs, resume: null, endedAt: at });
      failedAgain(t, "merge");
      ids.push(t.id);
      continue;
    }
    // A check of the planner's own task the restart cut (V2-1): done, unchecked, said.
    if (t.state === "checking") {
      Object.assign(t, { state: "done", verdict: verdictOf({ ran: false, words: "a Filament restart cut its check" }, at), endedAt: at });
      ids.push(t.id);
      continue;
    }
    if (!isLive(t) && t.state !== "review" && !goesBack(t)) continue;
    const why = goesBack(t)
      ? `cut by a Filament restart as its change went back to its ${workerWord(t.ranAs)} for the folder's check — the merge was undone, and its change waits in its worktree`
      : t.state === "merging"
        ? "cut by a Filament restart as its change merged — check its files in the folder before you go on"
        : t.state === "review"
          ? `cut by a Filament restart in its review — ${t.report?.inFolder ? "its change is in the folder" : `its change waits in its ${workerWord(t.ranAs)}'s worktree`}`
          : "cut by a Filament restart";
    // No worker that waits for a slot outlives a restart either.
    Object.assign(t, { state: "failed", why, step: null, endedAt: at, ...(t.by === COMMAND ? { progress: null } : {}), ...(t.slot ? { slot: null } : {}) });
    // Cut, a change asked in as it stood is on nobody's word: an apply after it says its own.
    unruled(t);
    failedAgain(t, "cut");
    ids.push(t.id);
  }
  return ids.length || back.length ? { graph: next, ids, back } : null;
}

/**
 * The graph is held since the developer's Stop (G2-8): no sub-agent's task starts until the agent's next tasks call.
 * @param {Graph} graph @param {number} at @returns {Graph}
 */
export const hold = (graph, at) => ({ ...structuredClone(graph), held: { at } });

/**
 * The agent's tasks call lets go of the developer's stop that holds the graph, and of each task the developer, its
 * lead or the agent itself stopped: its last worker goes on with it where it can, as a failed task's does, sent back
 * (HarnessV4_Tasks B4), and a new one takes it where it can't; a stopped review starts again. The graph itself when
 * nothing was held.
 * @param {Graph | null} graph @param {{ crew: Crew, resumable: Resumable }} o
 */
export function release(graph, { crew, resumable }) {
  if (!graph || (!graph.held && !graph.tasks.some((t) => t.stopped))) return graph;
  const next = structuredClone(graph);
  next.held = null;
  for (const t of next.tasks) {
    if (!t.stopped) continue;
    t.stopped = false;
    if (t.state === "waiting") t.resume = goesOn(t, t.earlier?.agent || null, { fresh: false, crew, resumable }).resume;
  }
  return next;
}

/**
 * How a task's sub-agent reports, as its brief ends (G2-4), in the words of whoever planned the work (`crew`). A writing
 * task with no check asks for the commands that prove it done, in checked: they become its check (TG2-D63).
 * @param {Task} t @param {Crew} crew
 */
const reportAsk = (t, crew) =>
  !changes(t)
    ? `When you have the answer — or cannot get it — call report once, then end: status done (the goal is met and the check passes), blocked (something outside your task stops you; say what in left) or failed; did: what you found, whole — ${led(crew) ? "your lead" : "the agent"} reads your report, not your work; met: whether the acceptance check passed, and evidence: the check you ran and what it showed; left: what is left, if anything.`
    : `When the task is done — or you cannot finish it — call report once, then end: status done (the goal is met and the check passes), blocked (something outside your task stops you; say what in left) or failed; did: what you did; met: whether the acceptance check passed, and evidence: the check you ran and what it showed; left: what is left, if anything. Filament records the files you changed and the commands you ran; when you report done with the check passed, ${t.review ? "a reviewer reads your change, and it goes into the project once it does what the task asks" : "your change goes into the project"}.${checkOf(t).length ? "" : ` Your task has no check: in checked, name the commands that prove it done — the tests you ran, each exactly as you ran it. Filament runs them again in your worktree before ${led(crew) ? "your lead" : "the agent"} hears your report, sends the task back to you if one fails, and keeps them as your task's check, guarding the project after your change goes in. Leave checked out only where no command can check your change.`}`;

/**
 * The try before a new worker's, as its brief says it (HarnessV3-FailurePoints §6 item 3): how it ended, what it
 * reported or its last words, what it changed and ran, its tool calls, what its reviewer asked — and where the new
 * worker starts from: without that try's change, unless it made it in the folder itself. A task done and reopened by
 * its planner (11-09) says its done round instead, and builds on it.
 * @param {NonNullable<Task["earlier"]>} earlier @param {boolean} reads
 */
function earlierText(earlier, reads) {
  const a = earlier.report;
  const asked = earlier.reviews.filter((r) => r.status === "done" && !r.met && r.left);
  const done = earlier.done;
  const from = done
    ? done.merged
      ? "Its change is merged into the project you start from: build on it, and do what this round asks."
      : "Build on what it found, and do what this round asks."
    : reads
      ? "Build on what it learned, and avoid what went wrong."
      : a?.inFolder && a.wrote
        ? "It worked in the folder itself, so what it changed is in the project you start from: check it, keep what is right, and avoid what went wrong."
        : "You start from the project as it stands now, without that try's change: build on what it learned, and avoid what went wrong.";
  return [
    done ? `This task was done ${done.round > 1 ? `in round ${done.round}` : "once"} — ${squash(done.summary)} — and its planner reopened it for another round.` : `An earlier try at this task ended: ${sentence(earlier.why)}.`,
    ...(a ? attemptLines(a) : []),
    ...(a?.calls.length ? [`Its tool calls${a.callsMade > a.calls.length ? `, the newest ${a.calls.length} of ${a.callsMade}` : ""}:`, ...a.calls.map((c) => `- ${c}`)] : []),
    ...(asked.length ? ["Its reviewer asked for changes:", ...asked.map((r) => `- round ${r.round}: ${r.left}`)] : []),
    from,
  ].join("\n");
}

/**
 * A task's work order: its goal, its files — or that it changes nothing, or, for a member that works in its own copy
 * of the project, that nothing it changes there is kept — its steps and its check.
 * @param {Task} t @param {Crew} crew @returns {string[]}
 */
const orderOf = (t, crew) => [
  `Goal: ${t.goal}`,
  changes(t)
    ? `Files — change these alone:\n${t.writes.map((w) => `- ${w}`).join("\n")}`
    : led(crew) && memberOf(crew, runsAs(t, crew))?.may === "copy"
      ? "You work in your own copy of the project: change and run there what the task needs. Nothing of it is kept, so your report is what stays."
      : "You change nothing: read, search, and run only what reads.",
  `Steps:\n${t.steps.map((s, n) => `${n + 1}. ${s}`).join("\n")}`,
  `Acceptance check: ${t.acceptance}`,
  ...(checkOf(t).length ? [`Its check — the commands that prove it done: ${inOrder(checkOf(t))}`] : []),
];

/**
 * The task a sub-agent does, as Filament writes it from the graph (G2-2): the work, the task, its files, its steps and
 * its check; what the tasks it needs reported; a send-back's earlier try, what its review asked, and the planner's
 * note; and how to report — in the words of whoever planned the work (`crew`, G3-6).
 * @param {Graph} graph @param {string} id @param {Crew} crew
 */
export function briefText(graph, id, crew) {
  const byId = indexOf(graph);
  const t = /** @type {Task} */ (byId.get(id));
  // A sub-task builds on its step's needs too (11-06).
  const needs = needsOf(t, byId).map((n) => /** @type {Task} */ (byId.get(n)));
  /** @param {Task} n */
  const needLine = (n) => {
    const files = n.merged && n.report ? n.report.files.slice(0, 8).map((f) => f.path) : [];
    return `- ${n.id} "${n.name}": ${n.summary.replace(/\n/g, "\n  ")}${files.length ? `\n  Its change, merged: ${files.join(", ")}${n.report && n.report.files.length > 8 ? `, and ${n.report.files.length - 8} more` : ""}` : ""}`;
  };
  const merged = needs.some((n) => n.merged);
  const team = led(crew);
  return [
    `You do one task of a larger piece of work, which ${team ? "your team's lead" : "the agent you work for"} planned as a task graph. Work on this task alone.`,
    // A graph its checklist started has no goal until one is given (V2-5).
    graph.goal ? `The work: ${graph.goal}` : "",
    `Your task: ${t.id} — ${t.name}`,
    ...orderOf(t, crew),
    needs.length ? `What the tasks yours builds on reported${merged ? " — their changes are in the project you start from" : ""}:\n${needs.map(needLine).join("\n")}` : "",
    t.earlier ? earlierText(t.earlier, !changes(t)) : "",
    t.note ? `${team ? "Your lead's" : "The agent's"} note for you: ${t.note}` : "",
    reportAsk(t, crew),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * What a task's last worker reads as it goes on with the task, sent back (HarnessV3-FailurePoints §6 item 2) or
 * started again after the developer's stop (HarnessV4_Tasks B4), in the conversation it has — its finished rounds,
 * what it read, its worktree: how its try ended, what its reviewer asked, the planner's note, the task as it stands
 * now (the planner may have changed it since), and how to report.
 * @param {Graph} graph @param {string} id @param {Crew} crew
 */
export function resumeText(graph, id, crew) {
  const t = /** @type {Task} */ (indexOf(graph).get(id));
  const team = led(crew);
  const earlier = /** @type {NonNullable<Task["earlier"]>} */ (t.earlier);
  const a = earlier.report;
  const asked = earlier.reviews.filter((r) => r.status === "done" && !r.met && r.left);
  // Sent back to rebase, its worktree holds the developer's folder now, its change brought on: the note says it (the Hunter's of 10-28).
  // Reopened once done (11-09), its change of that round is in the project, merged.
  const where = earlier.done
    ? changes(t) && earlier.done.merged
      ? " Your change from that round is merged into the project."
      : ""
    : !changes(t) || earlier.rebased
      ? ""
      : a?.files.length
        ? " Your worktree holds your change as you left it."
        : a?.inFolder && a.wrote
          ? " What you changed in the folder is there as you left it."
          : "";
  const ended = earlier.done
    ? `${team ? "your lead" : "the agent"} reopened task ${t.id}, which you had done (${cut(squash(earlier.done.summary), 300)}), for round ${t.round ?? 2}. The task is yours again`
    : earlier.stopped
      ? `${earlier.stopped === "lead" ? "your lead" : earlier.stopped === "agent" ? "the agent" : "the developer"} stopped you on task ${t.id}. The task is yours again`
      : earlier.rebased
        ? `${earlier.sentBy === "filament" ? "Filament" : earlier.sentBy ? (team ? "your lead" : "the agent") : "the developer"} sent your change on task ${t.id} back to ${earlier.sentBy ? "redo on the folder as it stands" : "rebase"}${earlier.why ? ` (${earlier.why})` : ""}. The task is yours again`
        : `your try at task ${t.id} ended: ${sentence(earlier.why)}. ${team ? "Your lead" : "The agent"} sent the task back to you`;
  return [
    `[Filament: ${ended}: go on from where you stopped — your work so far is above.${where}`,
    ...(asked.length ? [`Your reviewer asked for changes:\n${asked.map((r) => `- round ${r.round}: ${r.left}`).join("\n")}`] : []),
    // Sent back to rebase, the note is Filament's own: what its copy holds now.
    ...(t.note ? [`${earlier.rebased ? "Filament's" : team ? "Your lead's" : "The agent's"} note for you: ${t.note}`] : []),
    `Your task as it stands now: ${t.id} — ${t.name}`,
    ...orderOf(t, crew),
    `${reportAsk(t, crew)}]`,
  ].join("\n\n");
}

/**
 * How a reviewer reports its round (G3-3): met, or each change the task's sub-agent is to make — which it makes and
 * the reviewer reads again, or, at the last round, which go to whoever planned the work.
 * @param {Task} t @param {Crew} crew
 */
const reviewAsk = (t, crew) => {
  const after = t.reviews.length + 1 < REVIEW_ROUNDS ? `its ${workerWord(t.ranAs)} makes them, and you read the change again` : `this is the last round: what you ask goes to ${led(crew) ? "your lead" : "the agent"}, who decides`;
  return `When you have read it — or cannot — call report once, then end: status done when you could review it, blocked or failed when you could not (say why in left); did: what you checked; met: true when the change does what the task asks and its check holds, false when it needs changes; evidence: what you read and ran, and what it showed; left: when met is false, each change it needs, one per line — ${after}.`;
};

/**
 * The brief of a task's reviewer, round one (G3-3): its change rides ahead of it, the registry's review opening; the
 * brief says what the task asked, what its sub-agent reported, and how to report the review.
 * @param {Graph} graph @param {string} id @param {Crew} crew
 */
export function reviewBrief(graph, id, crew) {
  const t = /** @type {Task} */ (indexOf(graph).get(id));
  return [
    `You review one task's change, in a larger piece of work which ${led(crew) ? "your team's lead" : "the agent you work for"} planned as a task graph: its ${workerWord(t.ranAs)}, ${t.agent}, made the change above ${t.report?.inFolder ? "in the folder you work in" : "in its own worktree"} and reported the task done. Read the change against the task, and judge whether it does what the task asks. You change nothing: read, search, and run only what reads.`,
    ...(graph.goal ? [`The work: ${graph.goal}`] : []),
    `The task: ${t.id} — ${t.name}`,
    `Goal: ${t.goal}`,
    `Files it may change:\n${t.writes.map((w) => `- ${w}`).join("\n")}`,
    `Steps:\n${t.steps.map((s, n) => `${n + 1}. ${s}`).join("\n")}`,
    `Acceptance check: ${t.acceptance}`,
    `What ${t.agent} reported:\n${attemptLines(/** @type {Attempt} */ (t.report)).join("\n")}`,
    reviewAsk(t, crew),
  ].join("\n\n");
}

/**
 * What a task's reviewer reads in the rounds after the first (G3-3), in the conversation it has: its sub-agent made the
 * changes asked and reported again, its change whole as it stands now (`change`, the registry's block), and the report
 * to give.
 * @param {Graph} graph @param {string} id @param {string} change @param {Crew} crew
 */
export function reviewAgainText(graph, id, change, crew) {
  const t = /** @type {Task} */ (indexOf(graph).get(id));
  return [
    `[Filament: ${t.agent} made the changes you asked for task ${t.id} and reported it done again — round ${t.reviews.length + 1} of ${REVIEW_ROUNDS}. Its change, whole as it stands now:`,
    change,
    `What ${t.agent} reported:\n${attemptLines(/** @type {Attempt} */ (t.report)).join("\n")}`,
    `${reviewAsk(t, crew)}]`,
  ].join("\n\n");
}

/**
 * What a task's sub-agent reads when its review asks for changes (G3-3), in the conversation it has: the reviewer's
 * asks, and how to go on.
 * @param {Graph} graph @param {string} id
 */
export function fixText(graph, id) {
  const t = /** @type {Task} */ (indexOf(graph).get(id));
  const r = /** @type {Review} */ (t.reviews.at(-1));
  return [
    `[Filament: a reviewer read your change for task ${t.id} — round ${r.round} of ${REVIEW_ROUNDS} — and asks for changes:`,
    r.left || r.evidence,
    `What it checked: ${r.did}`,
    ...(r.left ? [`What it found: ${r.evidence}`] : []),
    `Make them in your task's files alone — ${t.report?.inFolder ? "the folder holds your change as you left it" : "your worktree holds your change as you left it"} — run the acceptance check again, then call report once more: your change is read again${t.report?.inFolder ? "" : " before it goes into the project"}.]`,
  ].join("\n\n");
}

/**
 * What a task's worker reads when the folder's check sends its change back (V2-2; TG2-D55's note, in a task's words), in
 * the conversation it has: the command and why it is its change's, that the merge was undone and its worktree holds the
 * folder with its change in it, what to do, who decides after the second time — the agent, or its lead (`crew`) — and
 * the output. "" for a task not sent back.
 * @param {Graph} graph @param {string} id @param {Crew} crew
 */
export function gateBackText(graph, id, crew) {
  const t = indexOf(graph).get(id);
  const g = t?.gate ?? null;
  const b = g?.broke ?? null;
  if (!t || !g || !b || !g.back || !("n" in g.back)) return "";
  const what = b.own
    ? `your task's check ${q(b.command)} passed in your worktree, and fails with the rest of the folder${redBefore(b) ? ", and without your change too" : ""}`
    : `${q(b.command)} passes without your change and fails with it`;
  return `[Filament: your change for task ${t.id} went into the developer's folder, and the folder's check failed with it: ${what}. The merge was undone. Your worktree now holds the developer's folder with your change in it, so the command fails here as it did there; Filament runs it with your task's check when you report. Make your change pass with the rest of the folder, never by weakening the check, run it yourself, and call report again. This is the ${nth(g.back.n)} time Filament sent your task back for the folder's check; after the second, ${led(crew) ? "your lead" : "the agent"} decides.\n\n$ ${b.command}\n${b.exit === null ? "it ended without an exit code" : `exit ${b.exit}`} after ${durationWords(b.ms)} — the end of its output:\n${g.output || "(no output)"}]`;
}

/** What a report that reads answers (G2-4): the sub-agent's run is to end now — its report goes where its brief said. */
export const REPORT_IN = "Your report is in: Filament passes it on as you end. End your turn now — a last word is enough.";
/** Filament's one ask for the report, as a task's sub-agent would end without one (G2-4). */
export const REPORT_ASK = "[Filament: your task ends with your report, and you have not given it. Call report now — status, did, met and evidence, and left when something is left — then end your turn.]";

/**
 * A `report` call's input, read (G2-4): its status, what it did, whether the acceptance check passed with the evidence,
 * and what is left — or the first problem, in the words the sub-agent reads.
 * @param {unknown} input @returns {{ ok: true, report: TaskReport } | Refusal}
 */
export function readReport(input) {
  const i = /** @type {Record<string, any>} */ (input && typeof input === "object" && !Array.isArray(input) ? input : {});
  if (!REPORT_STATUSES.includes(i.status)) return refused(`report needs status: ${REPORT_STATUSES.slice(0, -1).join(", ")} or ${REPORT_STATUSES.at(-1)}`);
  const did = prose(i.did);
  if (!did) return refused("report needs did: what you did, in a few lines");
  if (typeof i.met !== "boolean") return refused("report needs met: true when the acceptance check passed, false when it did not");
  const evidence = prose(i.evidence);
  if (!evidence) return refused("report needs evidence: the check you ran and what it showed");
  if (i.left !== undefined && i.left !== null && typeof i.left !== "string") return refused("left is text: what is left — or leave it out");
  const left = prose(i.left);
  const long = over("did", did, LIMIT.did) || over("evidence", evidence, LIMIT.evidence) || over("left", left, LIMIT.left);
  if (long) return refused(long);
  const checked = checkedOf(i.checked);
  if (typeof checked === "string") return refused(checked);
  return { ok: true, report: { status: i.status, did, met: i.met, evidence, left, ...(checked.length ? { checked } : {}) } };
}

/**
 * A report's checked, read (HarnessV3-TaskGraph-v2 TG2-D63): the commands its worker checked its work with, each one line
 * as it ran it, five at most — none where it left the field out or gave an empty list — or the problem, in its words.
 * @param {unknown} v @returns {string[] | string}
 */
function checkedOf(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((c) => typeof c !== "string" || !c.trim())) return "checked is a list of commands, one to five — each exactly as you ran it — or leave it out";
  if (v.length > CHECK_COMMANDS) return `checked holds at most ${CHECK_COMMANDS} commands — the ones that prove your task done`;
  const list = v.map((c) => c.trim());
  if (list.some((c) => /[\r\n]/.test(c))) return "a command of checked is one line: give each command its own entry";
  return list.map((c) => over("a command of checked", c, LIMIT.command)).find(Boolean) || list;
}

/**
 * How the planner takes a sub-agent's task on itself, as a failure's choices say it: changed to by: you — or, for a
 * coding agent, whose change takes no by (f5's follow-up, 11-10), dropped for a task of its own. @param {boolean} solo
 */
const takeOnWords = (solo) => (solo ? "take it on yourself — drop it and add a task of your own for the work; " : "take it on yourself — tasks change it to by: you, then start and done; ");
/** The agent's four choices for a task that failed (G2-6), in the words its message ends with. @param {boolean} solo */
const choices = (solo) =>
  `Your choices: send it back — tasks start with its id and a note: its sub-agent goes on where it stopped, in its own conversation, or with fresh: true a new one starts from your folder as it stands; ${takeOnWords(solo)}re-plan around it — change, add or drop tasks; or drop it.`;

/**
 * A lead's choices for a task that failed (G3-4), in the words its message ends with: send it back, merge its change as
 * it stands when one waits, re-plan around it, or drop it.
 * @param {boolean} waits
 */
const leadChoices = (waits) =>
  `Your choices: send it back — tasks start with its id and a note: its worker goes on where it stopped, in its own conversation, or with fresh: true a new one starts from the folder as it stands; ${waits ? "merge its change as it stands — tasks merge with its id and your reason; " : ""}re-plan around it — change, add or drop tasks; or drop it.`;

/**
 * The planner's choices for a task whose change did not merge (the Hunter's of 10-28): its worker can't go on from the
 * folder as it was, nor its change merge as it stands — the developer resolves it, or a new worker starts.
 * @param {boolean} team @param {boolean} solo
 */
const unmergedChoices = (team, solo) =>
  `Your choices: leave it to the developer — you hear when it is in ${team ? "the" : "your"} folder, or when its ${team ? "worker" : "sub-agent"} goes on with it; start it again — tasks start with its id and a note: a new ${team ? "worker" : "sub-agent"} starts from the folder as it stands, the earlier try in its brief; ${team ? "" : takeOnWords(solo)}re-plan around it — change, add or drop tasks; or drop it.`;

/**
 * What the end of a merge says that the session's record would not take after `tries` tries: the graph still shows the
 * task merging, no turn waits on it, and when the record takes it — or a restart fails it. @param {string} id @param {number} tries
 */
const unrecordedLine = (id, tries) =>
  `Filament could not write this into the session's record after ${tries} tries, so the graph still shows ${id} merging, and what needs it waits: no turn waits on it, and Filament writes it with the graph's next change — a tasks call of yours that changes the graph, or an apply. A Filament restart before then fails ${id} as cut.`;

/**
 * The message whoever plans hears as a task's work ends (G2-7, G3-6): done — merged, with nothing to merge, or merged
 * as it stood on the lead's word — failed with the planner's choices, or stopped by the developer or the planner
 * itself ("you"), a review included;
 * each with what its sub-agent reported, its reviews, and how the work stands. `crew`: who plans now — the agent, or a
 * team's lead. `now`: false, and how the work stands is left out — an end the planner reads later, beside one that says it.
 * `unrecorded`: the end of a merge the session's record would not take after so many tries — said in its place.
 * `solo`: a coding agent plans, whose change takes no by — its choices say so. `personAt`: when the person last wrote,
 * which the words of a graph come to all done weigh (`nowWords`).
 * @param {Graph} graph @param {string} id @param {{ crew: Crew, now?: boolean, unrecorded?: number, solo?: boolean, personAt?: number | null }} o
 */
export function endText(graph, id, { crew, now = true, unrecorded = 0, solo = false, personAt = null }) {
  const t = /** @type {Task} */ (indexOf(graph).get(id));
  // The planner's own task's end is its check's verdict (V2-1).
  if (t.by === "you") return checkText(graph, t, personAt);
  if (t.by === COMMAND) return commandText(graph, t, { crew, now, personAt });
  const standing = now ? [nowWords(graph, personAt)] : unrecorded ? [unrecordedLine(id, unrecorded)] : [];
  const team = led(crew);
  const head = `task ${t.id} "${t.name}"`;
  const stopped = t.state === "waiting" && t.stopped;
  const tried = stopped ? t.earlier?.report || null : t.report;
  const agent = stopped ? t.earlier?.agent : t.agent;
  const who = `${workerWord(stopped ? (t.earlier?.ranAs ?? null) : t.ranAs)} ${agent}`;
  const folder = team ? "the folder" : "your folder";
  const g = stopped ? null : (t.gate ?? null);
  // The folder's check undid its merge, and its change goes back to its worker (V2-2): what broke, where it went, and
  // that the fix is its worker's — a planner that fixed it too in the folder meanwhile made the merge after it collide
  // (the drive's finding).
  if (goesBack(t) && g?.broke && g.back && "n" in g.back) {
    const said = `[Filament: ${head}: its change went into ${folder} and broke it — ${brokeSaid(g.broke, folder)}. Filament undid the merge, so ${folder} is as it was before it, and sends the task back to its ${who} with the output (the ${nth(g.back.n)} time of two); its worktree holds ${folder} with its change in it. Leave the fix to it until it reports: an edit of yours to a file it fixes meanwhile collides with its fix, and then its change cannot merge. Its end reaches you as a message.`;
    return `${[said, ...(g.output ? [`The end of the output:\n${g.output}`] : []), ...standing].join("\n")}]`;
  }
  // Its merge overlapped the folder's edits, and its change went back to redo on the folder (the owner's of 11-09): who
  // sent it, which time, where it went — or that a restart came first, and a new worker takes it — and that nothing of
  // it is in the folder, and what needs it waits for its apply once more.
  if (redoing(t) && !stopped && t.earlier) {
    const e = t.earlier;
    const was = `${workerWord(e.ranAs)} ${e.agent}`;
    const after = graph.tasks.filter((x) => x.needs.includes(t.id) && isOpen(x)).map((x) => x.id);
    const needed = after.length ? ` ${listed(after)} ${after.length === 1 ? "needs it, and waits" : "need it, and wait"}.` : "";
    const goesOn = t.resume === e.agent || (t.state === "running" && t.agent === e.agent);
    const said = goesOn
      ? `[Filament: ${head} did not merge: ${e.why.replace(" in the folder ", ` in ${folder} `)}. ${e.sentBy === "planner" ? "It went back to redo on the folder, as you asked" : `Filament sent it back to redo on the folder, ${t.rebases ?? 1} of ${MERGE_RETURNS}`}: ${was} goes on with it in its own conversation, its copy holding ${folder} as it stands with its change brought onto it.`
      : `[Filament: ${head} was ${redoWords(t)}, and a Filament restart came before ${was} went on with it: a new ${workerWord(e.ranAs)} takes it from ${folder} as it stands, the earlier try in its brief.`;
    return `${[`${said} Nothing of it was written into ${folder}.${needed} Its change waits for ${team ? "the" : "your"} apply again once it reports.`, ...standing].join("\n")}]`;
  }
  const lines = tried ? attemptLines(tried) : [];
  const v = stopped ? null : (t.verdict ?? null);
  if (v?.kind === "failed" && t.state === "failed") lines.push(`Check: ${verdictRuns(v)}`, ...(v.output ? [`The end of its output:\n${v.output}`] : []));
  if (g?.output && t.state === "failed" && t.failures?.cause === "gate") lines.push(`The end of the output:\n${g.output}`);
  if (passedOf(v) && tried?.met === false && t.state === "done") lines.push("Its report said the check had not passed; Filament's run of it passed.");
  for (const r of stopped ? t.earlier?.reviews || [] : t.reviews) lines.push(...reviewLines(r));
  const waits = changes(t) && !!tried?.files.length && !unmerged(t);
  if (tried && t.state !== "done" && t.state !== "review" && !yours(t)) {
    // One that did not merge can't be applied or merged as it stands (the Hunter's of 10-28): the developer's to resolve.
    if (tried.files.length && unmerged(t)) lines.push(UNMERGED_WAYS, ...(t.overlapped ? [overlapWays(crew, String(agent))] : []));
    else if (tried.files.length && !team) lines.push(`Its change is not in your folder: it waits in sub-agent ${agent}'s own worktree — call agent with agent_id "${agent}" and apply_changes: true to apply it as it is.`);
    else if (tried.files.length) lines.push(stopped ? `Its change waits in ${who}'s own worktree, where it goes on with it: a new worker would start from the folder as it stands, without it.` : `Its change is not in the folder: it waits in ${who}'s own worktree — tasks merge takes it as it stands.`);
    else if (tried.inFolder && tried.wrote) lines.push(team ? "It worked in the folder itself, so what it changed is there already — have it checked before you go on." : "It worked in your folder, so what it changed is there already — check it before you go on.");
  }
  /** @type {string} */
  let opening;
  /** What Filament's check of the folder found as its change merged (V2-2), after the words that say it merged. */
  const gated = g && t.state === "done" ? ` ${gateSaid(g, folder, "it", !stoodBare(t))}${g.output ? `\nThe end of its output:\n${g.output}` : ""}` : "";
  if (t.state === "done" && (t.overruled || t.overruledBy)) {
    // What builds on it starts on it as it stands — red, where the check says so.
    const byId = indexOf(graph);
    const next = graph.tasks.filter((x) => (x.needs.includes(t.id) || (!!t.under && x.needs.includes(t.under))) && (x.state === "running" || (x.state === "waiting" && !x.stopped && x.needs.every((n) => needMet(/** @type {Task} */ (byId.get(n)), x))))).map((x) => x.id);
    const starts = next.length ? ` ${listed(next)} ${next.length === 1 ? "starts" : "start"} on it as it stands.` : "";
    opening = `[Filament: ${head} is done: ${who}'s change is merged into ${folder} as it stood, on your word.${starts}${gated}`;
  } else if (t.state === "done") {
    const how = t.merged ? `, and its change is merged into ${folder}` : !changes(t) ? "" : tried?.inFolder && tried.wrote ? `; it worked in ${folder}, so what it changed is there already` : "; it changed nothing";
    opening = `[Filament: ${head} is done: ${who} ${doneWords(t, v, `${t.reviews.length ? ", its reviewer found the change does what the task asks" : ""}${how}`)}.${gated}`;
    if (t.unreviewed) lines.push(`Its review did not run: ${t.unreviewed} — check its change in ${folder} before you go on.`);
  } else if (yours(t)) {
    // Ready (the owner's of 11-02): its change waits for whoever plans to apply it — or the developer — and what needs it
    // waits for that apply.
    const after = graph.tasks.filter((x) => x.needs.includes(t.id) && isOpen(x)).map((x) => x.id);
    // A sub-task's step is done once it is applied (11-06): what needs the step waits for that apply too.
    const viaStep = t.under ? graph.tasks.filter((x) => x.needs.includes(/** @type {string} */ (t.under)) && isOpen(x)).map((x) => x.id) : [];
    const needed = `${after.length ? ` ${listed(after)} ${after.length === 1 ? "needs it, and waits" : "need it, and wait"} for its apply.` : ""}${viaStep.length ? ` ${listed(viaStep)} ${viaStep.length === 1 ? "needs" : "need"} its step ${t.under}, which waits for its apply too.` : ""}`;
    opening = `[Filament: ${head} is ready: ${who} ${doneWords(t, v, t.reviews.length ? ", its reviewer found the change does what the task asks" : "")}. Its change waits in ${agent}'s own copy, not in ${folder} yet: apply it when you choose — ${applyWords(crew, String(agent))}. The call answers once the change is in ${folder}; Filament then checks ${folder} with it, undoes it if it breaks the check, and its verdict reaches you as a message.${needed} To have its ${workerWord(t.ranAs)} change it first, send it back with a note: tasks start with its id and note. The developer may apply it themselves instead.`;
  } else if (t.state === "review") {
    opening = `[Filament: ${t.stopped === "lead" || t.stopped === "agent" ? "you" : "the developer"} stopped the review of ${head}, round ${t.reviews.length + 1} of ${REVIEW_ROUNDS}. The review waits: Filament starts it again after your next tasks call.`;
  } else if (stopped) {
    opening = `[Filament: ${t.stopped === "lead" || t.stopped === "agent" ? "you" : "the developer"} stopped ${who} on ${head}. The task waits again: after your next tasks call ${agent} goes on with it where it stopped, in its own conversation — or a new ${team ? "worker" : "sub-agent"} takes it, with what this one did in its brief: tasks start with its id and fresh: true.`;
  } else {
    opening = `[Filament: ${head} failed: ${sentence(whyFor(t, crew))}.`;
    if (t.failures && t.failures.times > 1) lines.unshift(`${t.id} failed the same way ${t.failures.times} times in a row.`);
    const p = tried?.provider ?? null;
    lines.push(p ? providerChoices(p, workerWord(t.ranAs), !!tried?.files.length) : unmerged(t) ? unmergedChoices(team, solo) : team ? leadChoices(waits) : choices(solo));
  }
  const step = stepEndWords(graph, t);
  if (step) lines.push(step.trim());
  return `${[opening, ...lines, ...standing].join("\n")}]`;
}

/**
 * What whoever plans hears as a command task's runs end (V2-3): done, with how many ran on how many lanes; failed, with
 * each run that did not pass, the end of the first one's output and the planner's choices; or stopped by the developer,
 * with what ran so far. `now`: false, and how the work stands is left out (`endText`).
 * @param {Graph} graph @param {Task} t @param {{ crew: Crew, now: boolean, personAt?: number | null }} o
 */
function commandText(graph, t, { crew, now: standing, personAt = null }) {
  const head = `task ${t.id} "${t.name}"`;
  const now = standing ? `\n${nowWords(graph, personAt)}` : "";
  const r = t.result ?? null;
  const items = t.items || [];
  const reds = r ? r.runs.filter((x) => !x.passed) : [];
  if (t.state === "waiting" && t.stopped) {
    const so = reds.length ? ` (${reds.length} did not pass so far: ${itemsSaid(reds)})` : "";
    return `[Filament: the developer stopped ${head} after ${r ? r.runs.length : 0} of ${plural(r ? r.of : commandRuns(t).length, "run")}${so}. The task waits again: after your next tasks call Filament runs it whole again.${now}]`;
  }
  if (t.state === "done" && r) {
    const said = items.length || r.of > 1 ? ` — ${plural(r.of, "run")}, ${atATime(r.lanes)}, every one passed (${durationWords(r.ms)})` : `, and it passed: ${inOrder(t.run || [])} (${durationWords(r.ms)})`;
    return `[Filament: ${head} is done: Filament ran it${said}.${stepEndWords(graph, t)}${now}]`;
  }
  const lines = [`[Filament: ${head} failed: ${sentence(t.why)}.`];
  if (t.failures && t.failures.times > 1) lines.push(`${t.id} failed the same way ${t.failures.times} times in a row.`);
  if (r && items.length && reds.length) lines.push(`Did not pass:\n${reds.slice(0, 20).map((x) => `- ${x.item}: ${runSaid(x)}`).join("\n")}${reds.length > 20 ? `\n- and ${reds.length - 20} more: tasks show ${t.id} lists them` : ""}`);
  const first = reds.find((x) => x.output);
  if (first) lines.push(`The end of ${first.item === null ? "its" : `${first.item}'s`} output:\n${first.output}`);
  lines.push(`Your choices: ${reds.length && r && r.runs.length === r.of ? `take it as done — tasks done with its id and a summary — when ${items.length ? "the runs that did not pass are what you ran it to find (the mutants that survived, say)" : "its failing is what you ran it to find"}: the tasks that need it start; ` : ""}run it again — tasks start with its id, and Filament runs ${items.length ? "every item" : "it"} again on ${folderOf(crew)} as it stands; change its run${items.length ? " or items — tasks change (the items that did not pass, say)" : " — tasks change"}, then start it; re-plan around it — change, add or drop tasks; or drop it.`);
  return `${lines.join("\n")}${now}]`;
}

/**
 * How a worker reported its task done, after its name (V2-1): with Filament's check passed — flaky, said — or unchecked,
 * and why; then `rest`, its review and its merge. An unchecked one's reason stands between dashes.
 * @param {Task} t @param {Verdict | null} v @param {string} rest
 */
function doneWords(t, v, rest) {
  if (v && passedOf(v)) {
    const passed = v.kind === "flaky" ? `, flaky: ${verdictRuns(v)}` : ` (${v.runs.map((r) => `${q(r.command)}, ${durationWords(r.ms)}`).join("; ")})`;
    // A check its worker's report named (TG2-D63) is said as one.
    return `reported it done, and ${t.checkBy === "worker" ? "Filament ran the commands its report named as the task's check, which passed" : "Filament's check passed"}${passed}${rest}`;
  }
  const why = v?.kind === "not" ? v.words : changes(t) ? "the task has no check, and its report named none" : null;
  if (!why) return `reported it done with its acceptance check passed${rest}`;
  const after = rest.replace(/^[,;]\s*/, " ");
  return `reported it done with its acceptance check passed — unchecked: ${why}${after ? ` —${after}` : ""}`;
}

/**
 * The planner's choices for a worker that stopped on its provider (TG2-D3, in TG2-D54's words): where its provider
 * cannot serve the account, a new worker on the pool's next model first; else its worker once the provider serves, then a
 * new one; where the provider refuses the model, what to tell the developer.
 * @param {ProviderEnd} p @param {string} worker @param {boolean} tree  its change waits in its worktree
 */
function providerChoices(p, worker, tree) {
  const fresh = `send it back to a new ${worker} — tasks start with its id and fresh: true —`;
  if (p.tell) return `${p.tell} Then ${fresh} or re-plan around it, or drop it.`;
  const anew = `${fresh} ${p.fresh}`;
  const same = `send it back to its ${worker} ${p.later} — tasks start with its id — keeping its conversation${tree ? " and its worktree" : ""}`;
  return `Your choices: ${p.wall ? `${anew}; ${same}` : `${same}; ${anew}`}; re-plan around it; or drop it.`;
}

/**
 * What the planner hears of its own task's check (V2-1): it passed — flaky, said — and the task is done; it failed, and
 * the task is open again, with the end of its output; or it did not run, and why, the task done unchecked.
 * @param {Graph} graph @param {Task} t @param {number | null} [personAt]
 */
function checkText(graph, t, personAt = null) {
  const head = `task ${t.id} "${t.name}"`;
  const v = t.verdict ?? null;
  const now = nowWords(graph, personAt);
  const step = stepEndWords(graph, t);
  if (!v) return `[Filament: ${head} is ${stateWord(t)}.${step}\n${now}]`;
  if (v.kind === "not") return `[Filament: Filament did not check ${head}: ${v.words}. It is done, unchecked.${step}\n${now}]`;
  if (v.kind !== "failed") return `[Filament: ${head} passed its check${v.kind === "flaky" ? ", flaky" : ""}: ${verdictRuns(v)}. It is done.${step}${v.kind === "flaky" && v.output ? `\nThe end of its first run's output:\n${v.output}` : ""}\n${now}]`;
  // A checklist's task is ticked again by its item (11-10): to doing while the cause is fixed, then done.
  const again = t.checklist ? "set its item on your checklist to doing while you do, then to done again" : "then mark it done again (tasks done)";
  return `[Filament: ${head} did not pass its check, so it is open again: ${verdictRuns(v)}. Fix the cause — never the check — ${again}.${v.output ? `\nThe end of its output:\n${v.output}` : ""}\n${now}]`;
}

/**
 * The writers each writer shares files with (the owner's of 11-09: tasks may overlap on files, their conflicts resolved
 * at merge): every other not dropped, a step's own writes none — its sub-tasks write — with the files of its writes
 * they name, by id. Each pair is weighed once.
 * @param {Graph} graph @param {Map<string, Task[]>} kids @returns {Map<string, { t: Task, files: Set<string> }[]>}
 */
function peersOf(graph, kids) {
  const writers = graph.tasks.filter((t) => changes(t) && t.state !== "dropped" && !kids.has(t.id));
  /** @type {Map<string, { t: Task, files: Set<string> }[]>} */
  const peers = new Map();
  for (let i = 0; i < writers.length; i++)
    for (let j = i + 1; j < writers.length; j++) {
      const [a, b] = [writers[i], writers[j]];
      const ofA = new Set(a.writes.filter((p) => b.writes.some((q) => overlap(p, q))));
      if (!ofA.size) continue;
      peers.set(a.id, [...(peers.get(a.id) || []), { t: b, files: ofA }]);
      peers.set(b.id, [...(peers.get(b.id) || []), { t: a, files: new Set(b.writes.filter((q) => a.writes.some((p) => overlap(p, q)))) }]);
    }
  return peers;
}

/**
 * What a writer shares as the Plan says it (11-09): the open tasks it shares written files with, those files, and how
 * its merge stands — in line behind the one merging (`merging`), merged clean, with git's markers its planner resolves,
 * the folder's version kept, sent back to redo, or not merged. Null for one that shares none.
 * @param {Task} t @param {{ t: Task, files: Set<string> }[] | undefined} peers @param {string | null} merging
 */
function sharesOf(t, peers, merging) {
  if (!peers?.length) return null;
  const files = t.writes.filter((p) => peers.some((x) => x.files.has(p)));
  return { with: peers.filter((x) => isOpen(x.t)).map((x) => x.t.id), files, merge: mergeWords(t, merging) };
}
/** How a writer's merge stands, in words (11-09), as `sharesOf` says it; null for none. @param {Task} t @param {string | null} merging */
function mergeWords(t, merging) {
  const m = t.merged;
  return t.state === "merging" && !goesBack(t) && !yours(t)
    ? merging && merging !== t.id ? `merging behind ${merging}, three-way` : "merging, three-way"
    : redoing(t)
      ? `sent back to redo${t.earlier?.sentBy === "planner" ? "" : `, ${t.rebases ?? 1} of ${MERGE_RETURNS}`}`
      : t.state === "done" && m
        ? m.marked?.length ? `markers in ${plural(m.marked.length, "file")}, resolving` : m.kept?.length ? `merged, the folder's version of ${plural(m.kept.length, "file")} kept` : "merged clean"
        : unmerged(t) ? "did not merge" : null;
}
/**
 * How the merge of a writer that shares no file stands, as its box says it (the hunt on g2): what calls for a look — sent
 * back to redo, merged with git's markers or the folder's version kept, not merged. Merging and merged clean are said
 * beside the tasks it shares files with alone. Null otherwise. @param {Task} t
 */
const aloneMerge = (t) => (changes(t) && (redoing(t) || unmerged(t) || (t.state === "done" && !!(t.merged?.marked?.length || t.merged?.kept?.length))) ? mergeWords(t, null) : null);

/**
 * The graph as a page draws it — the `graph` event's and the session's answer: every task with its layer (its depth
 * by needs), whether it is ready, whether it is on the critical path still to go and the files its folder changed
 * beyond its writes (`beyond`, E41 P4), the open tasks it shares written files with and how its merge stands
 * (`shares`, the owner's of 11-09) — a writer sharing none, how its merge stands where it calls for a look (`merge`, the
 * hunt on g2) — the counts, what its sub-agents spent, the side-by-side card its agent suggested while it
 * stands (`offer`, the owner's of 11-10), and how many rounds a review has (G3-3) — and, where `kept` says so, what each task keeps (E33), the
 * graph's own on the graph. A task its checklist item ended says so (`ticked`): the conversation showed the tick. A
 * step says its sub-tasks not dropped (`subtasks`, 11-06), and the counts are of the work: a step is in its sub-tasks.
 * A task that could run beside another writing files it writes, one of the two in a copy of its own, says where they
 * meet (`mergesWith`, g1): read from the graph as it stands, never kept. `shared`: the session's sub-agents share its
 * folder, else the word kept on the graph (`sharingOf`).
 * @param {Graph | null | undefined} graph @param {Kept | null} [kept] @param {Sharing} [o]
 */
export function graphView(graph, kept = null, { shared } = {}) {
  if (!graph || !Array.isArray(graph.tasks)) return null;
  const depths = depthsOf(graph);
  const r = new Set(ready(graph).map((t) => t.id));
  const critical = criticalPath(graph);
  const on = new Set(critical);
  const sharing = sharingOf(graph, { shared });
  // The side-by-side card its agent suggested (the owner's of 11-10), while it stands: the transcript and the Plan draw
  // it — never a set Filament found by itself.
  const offer = sideOfferOf(graph);
  // A step with sub-tasks (11-06) says them, and is counted in them: the counts are of the work.
  const kids = kidsOf(graph);
  const work = graph.tasks.filter((t) => !kids.has(t.id));
  // Who shares each writer's files, and how its merge stands (the owner's of 11-09).
  const peers = peersOf(graph, kids);
  const merging = mergeNext(graph);
  /** @param {TaskState} s */
  const count = (s) => work.filter((t) => t.state === s).length;
  const meets = mergePoints(graph, sharing);
  const holder = stepsHolder(graph);
  return {
    version: graph.version,
    rev: graph.rev,
    goal: graph.goal,
    startedAt: graph.startedAt,
    closed: graph.closed,
    // Where it was carried over from (piece E); where it went on is its close's `to`.
    from: graph.from ?? null,
    held: graph.held,
    // A plan that waits for the person's Approve (11-06): the Plan says so.
    planning: graph.planning ?? null,
    // The task that holds the agent's checklist as its steps, and whether the checklist as last sent is those steps (the
    // owner's of 11-11): the Plan page shows the graph by them, and matches no text itself. A graph kept before it said
    // so is taken as listing its holder's steps.
    stepsOf: holder ? holder.id : null,
    stepsListed: !!holder && graph.stepsListed !== false,
    tasks: graph.tasks.map((t) => {
      // The files its folder changed beyond those it named (E41 P2 case 11), without what merges brought in (11-09): its
      // card says so, as done's answer did.
      const beyond = beyondWrites(t);
      const ks = kids.get(t.id);
      const shares = sharesOf(t, peers.get(t.id), merging);
      // A writer that shares no file says how its merge stands where it calls for a look (the hunt on g2): its box's chip.
      const merge = shares ? null : aloneMerge(t);
      return { ...t, layer: /** @type {number} */ (depths.get(t.id)), ready: r.has(t.id), critical: on.has(t.id), ...(ks ? { subtasks: ks.map((k) => k.id) } : {}), ...(beyond.length ? { beyond } : {}), ...(meets.has(t.id) ? { mergesWith: meets.get(t.id) } : {}), ...(shares ? { shares } : {}), ...(merge ? { merge } : {}), ...(kept?.[t.id] ? { kept: { ...kept[t.id] } } : {}), ...(t.summary === TICKED ? { ticked: true } : {}) };
    }),
    ...(kept?.[""] ? { kept: { ...kept[""] } } : {}),
    critical,
    ...(offer ? { offer } : {}),
    counts: { total: work.length, waiting: count("waiting") - r.size, ready: r.size, running: count("running"), paused: count("paused"), checking: count("checking"), review: count("review"), merging: count("merging"), done: count("done"), failed: count("failed"), dropped: count("dropped") },
    spentUsd: spentOf(graph),
    reviewRounds: REVIEW_ROUNDS,
  };
}

/** What a find gives at most (11-06): the lines found, each with where it is. */
export const FIND_HITS = 40;
/**
 * @typedef {object} KeptHit  a line of what is kept behind a task that holds a find's words (11-06): the task ("" for the
 *   graph's own), the note's title or the file's name, the line's number and where it starts — what a read's from takes
 * @property {string} task
 * @property {"note" | "file"} kind
 * @property {string} title
 * @property {number} line
 * @property {number} from
 * @property {string} text
 */
/** Whether a line holds every word of a find, case aside (11-06). @param {string} line @param {readonly string[]} words */
export const holdsAll = (line, words) => {
  const l = line.toLowerCase();
  return words.every((w) => l.includes(w));
};
/** A found line as an answer says it (11-06): squashed, and cut around its first word where it is long. @param {string} line @param {readonly string[]} words */
export const foundLine = (line, words) => {
  const l = squash(line);
  if (l.length <= 200) return l;
  const at = Math.max(0, l.toLowerCase().indexOf(words[0] || "") - 60);
  return `${at > 0 ? "…" : ""}${l.slice(at, at + 200)}${at + 200 < l.length ? "…" : ""}`;
};
/** A task's own words a find reads (11-06), each where its line says it was. @param {Task} t @returns {[string, string][]} */
const ownWords = (t) => [
  ["its name", t.name],
  ["its goal", t.goal],
  ...t.steps.map((s, k) => /** @type {[string, string]} */ ([`its step ${k + 1}`, s])),
  ["its acceptance", t.acceptance],
  ["its summary", t.summary],
  ["its evidence", t.evidence || ""],
  ["why it ended", t.why],
  ["its note", t.note],
  ["its report", t.report?.did || ""],
  ["what its report left", t.report?.left || ""],
];
/**
 * A find's answer (the owner's plan mode of 11-06): the lines of the tasks' own words that hold every word given — of
 * the one task it names, else of all — then those of what is kept behind them (`kept`, the store's; null where Filament
 * keeps no notes), FIND_HITS at most, each saying where it is, a kept one where a read goes on from.
 * @param {Graph} graph @param {NotesAsk} ask @param {{ hits: KeptHit[], more: boolean } | null} kept
 */
export function findText(graph, ask, kept) {
  const words = ask.words || [];
  const said = `"${words.join(" ")}"`;
  /** @type {string[]} */
  const own = [];
  for (const t of graph.tasks) {
    if (ask.task !== null && t.id !== ask.task) continue;
    for (const [where, v] of ownWords(t)) for (const l of String(v || "").split("\n")) if (l.trim() && holdsAll(l, words)) own.push(`- ${t.id} "${cut(t.name, 60)}", ${where}: ${foundLine(l, words)}`);
  }
  const theirs = (kept?.hits || []).map((h) => `- ${h.task || "the graph itself"}, ${h.kind === "note" ? `the note "${h.title}"` : `the file ${h.title}`}, line ${h.line} (from ${h.from}): ${h.text}`);
  const all = [...own, ...theirs];
  const where = ask.task ? ` in ${ask.task}` : "";
  if (!all.length) return `No line${where} holds ${said}: not in the tasks' own words${kept ? ", nor in what is kept behind them" : " — and this Filament keeps no notes behind them"}.`;
  const shown = all.slice(0, FIND_HITS);
  const more = all.length > FIND_HITS || !!kept?.more;
  return [
    `${more ? `The first ${shown.length} lines` : plural(shown.length, "line")}${where} that hold ${said}:`,
    ...shown,
    ...(shown.some((l) => theirs.includes(l)) ? ["Read on from one: tasks read with its task's id (none for the graph's own), its title and from."] : []),
    ...(more ? [`There are more: give more words${ask.task ? "" : ", or id to look in one task"}.`] : []),
  ].join("\n");
}

/**
 * The threads a keep of the graph closes (E28): each task that names one and is done now — done in `next`, and not in
 * `before` — whose close has not ended. The because is its summary, else its name.
 * @param {Graph | null} before @param {Graph | null} next
 * @returns {{ task: string, thread: string, because: string }[]}
 */
export function threadsToClose(before, next) {
  if (!next) return [];
  const was = new Map((before?.tasks || []).map((t) => [t.id, t.state]));
  return next.tasks
    .filter((t) => t.thread && !t.thread.end && t.state === "done" && was.get(t.id) !== "done")
    .map((t) => ({ task: t.id, thread: /** @type {TaskThread} */ (t.thread).id, because: t.summary || t.name }));
}

/**
 * What came of a done task's close of its thread (E28), kept on the task; null where the task names that thread no
 * more, or its close has ended already. @param {Graph | null} graph @param {string} id @param {string} thread @param {ThreadEnd} end
 * @returns {Graph | null}
 */
export function threadEnded(graph, id, thread, end) {
  const w = graph ? withTask(graph, id) : null;
  if (!w || w.t.thread?.id !== thread || w.t.thread.end) return null;
  w.t.thread = { ...w.t.thread, end };
  return w.next;
}

/** How many of a merged task's uncommitted files it keeps, for its words and its box. */
const UNCOMMITTED_KEPT = 10;

/**
 * The folder's uncommitted files read (11-09) — after a merge, an apply, at a turn's start: each task whose change went in
 * keeps those of its files still uncommitted, "applied, not committed" on the Plan and in show, until they are committed.
 * `ids`: the tasks read for — one just merged, those marked at a turn's start — so a file the developer edits after
 * committing a task's change never marks it again; none, every merged task. Null where nothing moved.
 * @param {Graph | null} graph @param {readonly string[]} files  the folder's, as git status names them
 * @param {readonly string[] | null} [ids]
 * @returns {Graph | null}
 */
export function uncommittedRead(graph, files, ids = null) {
  if (!graph) return null;
  const open = new Set(files);
  const next = structuredClone(graph);
  let moved = false;
  for (const t of next.tasks) {
    if (ids && !ids.includes(t.id)) continue;
    // A file its merge kept as the folder had it brought nothing of its change (the review of g3): the folder's own edit.
    const kept = new Set(t.merged?.kept || []);
    const left = t.state === "done" && t.merged && t.report ? t.report.files.map((f) => f.path).filter((p) => open.has(p) && !kept.has(p)).slice(0, UNCOMMITTED_KEPT) : [];
    if (JSON.stringify(left) === JSON.stringify(t.uncommitted || [])) continue;
    moved = true;
    if (left.length) t.uncommitted = left;
    else delete t.uncommitted;
  }
  return moved ? next : null;
}

/** How many of a task's changed files its words name, the rest counted (E41 P2 case 11). */
const CHANGED_LIST = 20;
/** Files in a line, the first few by path, the rest counted. @param {readonly string[]} files */
const pathsWords = (files) => `${files.slice(0, CHANGED_LIST).join(", ")}${files.length > CHANGED_LIST ? `, and ${files.length - CHANGED_LIST} more` : ""}`;
/**
 * How many of the files it changed a task keeps by name, as `brought` keeps BROUGHT_KEPT (the review of 67038d835): a
 * task that writes thousands — generated code, a vendored tree — kept them all, in the graph and on its page.
 */
const CHANGED_KEPT = 200;
/**
 * What a span changed joins what its task, or its done round, changed before, in place: the first CHANGED_KEPT by
 * path are kept, and that more changed — so what is said of the kept ones is never said of them all.
 * @param {{ changed?: string[], changedMore?: boolean }} on @param {readonly string[]} own
 */
function keepChanged(on, own) {
  const all = [...new Set([...(on.changed || []), ...own])].sort();
  on.changed = all.slice(0, CHANGED_KEPT);
  if (all.length > CHANGED_KEPT) on.changedMore = true;
}

/**
 * A task of the planner's own began to run with the folder as git holds it (HarnessV4_TaskGraphPlus_Plan E41 P2 case
 * 11): its base, what its next pause or done reads its change from, marked with the round it is of. Null where it runs
 * no more, or has a base of this round already. A base of the round before goes: a done that waited for its check kept
 * the folder as it stood then, for a red check to read on from, and a green one — or a restart that cut it — left it on
 * the task, so the round a start reopened would read everything the folder changed since that done as its own.
 * `brought`: what the graph's merges and the developer's applies brought into the folder while its snapshot was read
 * (the review of g3) — the snapshot may hold the folder from before they came, so they are kept as brought in.
 * @param {Graph | null} graph @param {string} id @param {SpanBase} base @param {readonly string[]} [brought]
 * @returns {Graph | null}
 */
export function spanOpened(graph, id, base, brought = []) {
  const w = graph ? withTask(graph, id) : null;
  if (!w || w.t.by !== "you" || w.t.state !== "running") return null;
  const round = w.t.round ?? 1;
  if (w.t.base && (w.t.base.round ?? 1) === round) return null;
  w.t.base = { ...base, round };
  if (brought.length) w.t.brought = [...new Set([...(w.t.brought || []), ...brought])].sort().slice(0, BROUGHT_KEPT);
  return w.next;
}

/**
 * A span of a task's running closed (E41 P2 case 11) — it paused, or was marked done: what the folder changed in it joins
 * what it changed before, and its base moves to the folder as it stands where it runs on — started again before this
 * was read, or being checked, which a red check opens again —, its round kept on it (`spanOpened`). `files`: null where
 * git could not tell. `round`: the round the span was of, as its close was asked (the review of g3): one a start
 * reopened since keeps its files on the round before (`earlier.done`), and its base goes — the new round opens a span
 * of its own. Missing: the round it is on.
 * `brought`: the files a merge or a rebase brought in as the span ran (FabeleHelper's of 11-10: HEAD moved over
 * others' work, which the span's files then held), each as another's commit left it — not the task's, so not kept as
 * it changed, under its writes or not: one the task changed too is not among them (the review of 67038d835).
 * @param {Graph | null} graph @param {string} id @param {{ files: string[] | null, end: SpanBase | null, round?: number | null, brought?: readonly string[] }} o
 * @returns {Graph | null}
 */
export function spanClosed(graph, id, { files, end, round = null, brought = [] }) {
  const w = graph ? withTask(graph, id) : null;
  if (!w || !w.t.base) return null;
  const t = w.t;
  const theirs = new Set(brought);
  const own = (files || []).filter((p) => !theirs.has(p));
  if (round !== null && (t.round ?? 1) !== round) {
    const was = t.earlier?.done;
    if (own.length && was?.round === round) keepChanged(was, own);
    delete t.base;
    return w.next;
  }
  if (own.length) keepChanged(t, own);
  if (end && (w.t.state === "running" || w.t.state === "checking")) w.t.base = { ...end, round: t.round ?? 1 };
  else delete w.t.base;
  return w.next;
}

/**
 * What a done's answer says of the files the folder changed while the task ran (E41 P2 case 11, GX-D4), from git: the
 * files, and those beyond the writes it named as a fact — someone else's work, maybe, which needs nothing — without
 * what the graph's merges and the developer's applies brought in meanwhile (`brought`, 11-09), five named at most. `error`:
 * why git could not tell. "" for a task that names no writes and changed nothing of its own. `round`: the round the done
 * was of — one a start reopened since says what its record kept (the review of g3). Where more changed than is kept by
 * name (`changedMore`), that is said after what the kept ones say, and nothing is said of its writes as a whole.
 * @param {Graph | null} graph @param {string} id @param {string | null} [error] @param {number | null} [round]
 */
export function changedText(graph, id, error = null, round = null) {
  const now = graph?.tasks.find((x) => x.id === id);
  const reopened = !!now && round !== null && (now.round ?? 1) !== round;
  const t = !reopened ? now : now.earlier?.done?.round === round ? { ...now, changed: now.earlier.done.changed, changedMore: now.earlier.done.changedMore, brought: [] } : null;
  if (!t) return "";
  if (error) return `What the folder changed while ${id} ran could not be read: ${error}.`;
  const files = t.changed || [];
  if (!files.length) return t.writes.length ? `While ${id} ran, no file in the folder changed.` : "";
  /** What the kept files say, and that more changed where more did. @param {string} said  "" where they say nothing */
  const whole = (said) => (!t.changedMore ? said : said ? `${said} More than ${CHANGED_KEPT} files changed in all: these are the first ${CHANGED_KEPT} by path, all that is kept by name.` : `While ${id} ran, more than ${CHANGED_KEPT} files changed in the folder.`);
  const theirs = new Set(t.brought || []);
  if (!t.writes.length) {
    const rest = files.filter((p) => !theirs.has(p));
    return whole(rest.length ? `While ${id} ran, the folder changed ${pathsWords(rest)}.` : "");
  }
  const beyond = beyondWrites(t);
  const own = files.filter((p) => t.writes.some((w) => writeNames(w, p)));
  if (!beyond.length) return own.length ? whole(`While ${id} ran, the folder changed ${pathsWords(own)}.`) : t.changedMore ? whole("") : `While ${id} ran, none of its writes changed in the folder.`;
  const named = beyond.length > BEYOND_NAMED ? `${beyond.slice(0, BEYOND_NAMED).join(", ")} and ${beyond.length - BEYOND_NAMED} more` : beyond.join(", ");
  return whole(`While ${id} ran, ${own.length ? `the folder changed ${pathsWords(own)}, and ` : ""}${named} changed too, beyond its writes — if that was other work, nothing to do.`);
}

/** How many files beyond its writes a done's answer names, the rest counted (11-09). */
const BEYOND_NAMED = 5;

/**
 * The files the folder changed while a task ran beyond the writes it named, without those a merge or an apply brought in
 * meanwhile (11-09): empty for a task that names no writes. A file within its writes stays its own, whoever else wrote it.
 * @param {Task} t
 */
const beyondWrites = (t) => (t.writes.length ? (t.changed || []).filter((p) => !t.writes.some((w) => writeNames(w, p)) && !(t.brought || []).includes(p)) : []);

/**
 * The planner's own running tasks that named writes, as a file the planner itself changed just now lies outside them
 * (d-writes, the owner's of 11-10: drift signals on state alone): none where an open task's writes name it — the work may
 * have moved there —, and none whose folder a merge or an apply brought it into while it ran (`brought`). `path`: as the
 * writes are written, against the folder. `helping`: whether a helper is at work now (`HelperAtWork`).
 * @param {Graph | null | undefined} graph @param {string} path @param {HelperAtWork} [helping] @returns {Task[]}
 */
export function outsideOwnWrites(graph, path, helping = helpersWork) {
  if (!graph || graph.closed || !path) return [];
  const own = ownRunning(graph, helping).filter((t) => t.writes.length && !(t.brought || []).includes(path));
  if (!own.length || graph.tasks.some((t) => (isOpen(t) || t.state === "checking") && t.writes.some((w) => writeNames(w, path)))) return [];
  return own;
}

/**
 * The planner was told a file it changed lies outside every open task's writes (`outsideOwnWrites`): each task the line
 * named keeps that it was told (`outsideTold`), once a task — on the task, as `idleTold` is, so a later graph's task of
 * the same id is told anew, and one told is not told again once Filament restarted (the review of 11-11: the mark was
 * the runner's, by the chat and the task's id). Null where none changed.
 * @param {Graph | null | undefined} graph @param {readonly string[]} ids @returns {Graph | null}
 */
export function outsideHeard(graph, ids) {
  if (!graph?.tasks.some((t) => ids.includes(t.id) && !t.outsideTold)) return null;
  const next = structuredClone(graph);
  for (const t of next.tasks) if (ids.includes(t.id)) t.outsideTold = true;
  return next;
}

/** How many turns a running task goes with no checkpoint before "Where you are" says so (E41 P2 case 13). */
const QUIET_TURNS = 3;

/**
 * A turn began (E41 P2 case 13): each running task of the planner's own has run one turn more since its last
 * checkpoint. Null where none runs. `helping`: whether a helper is at work now (`HelperAtWork`).
 * @param {Graph | null} graph @param {HelperAtWork} [helping] @returns {Graph | null}
 */
export function turnBegun(graph, helping = helpersWork) {
  // A step under way does no work of its own (11-06): its sub-tasks are counted; nor does one a helper works on now,
  // whose checkpoints are the helper's to keep (FabeleHelper's of 11-10).
  const steps = graph ? kidsOf(graph) : new Map();
  /** @param {Task} t */
  const counts = (t) => t.by === "you" && t.state === "running" && !(t.helper && helping(t.helper.agent)) && !steps.has(t.id);
  if (!graph || graph.closed || !graph.tasks.some(counts)) return null;
  const next = structuredClone(graph);
  for (const t of next.tasks) if (counts(t)) t.quiet = (t.quiet ?? 0) + 1;
  return next;
}

/**
 * A turn of the planner's ended on its own (d-idle, FabeleHelper's ranked list of 11-10): each task of its own still
 * running is marked left idle where nothing was at work that could wake the planner (`idle`), the mark cleared where
 * something was — and one a turn's start told so before keeps quiet (`idleTold`). Null where nothing changed.
 * `helping`: whether a helper is at work now (`HelperAtWork`).
 * @param {Graph | null | undefined} graph @param {boolean} idle @param {HelperAtWork} [helping] @returns {Graph | null}
 */
export function leftIdle(graph, idle, helping = helpersWork) {
  if (!graph || graph.closed) return null;
  const left = new Set(idle ? ownRunning(graph, helping).filter((t) => !t.idleTold).map((t) => t.id) : []);
  if (graph.tasks.every((t) => !!t.idle === left.has(t.id))) return null;
  const next = structuredClone(graph);
  for (const t of next.tasks)
    if (left.has(t.id)) t.idle = true;
    else delete t.idle;
  return next;
}

/**
 * A turn's start said where the planner stands (`turnOpening`'s begun): each task the last turn left idle (`leftIdle`)
 * was told so, once a task. Null where none was. @param {Graph | null | undefined} graph @returns {Graph | null}
 */
export function idleHeard(graph) {
  if (!graph?.tasks.some((t) => t.idle)) return null;
  const next = structuredClone(graph);
  for (const t of next.tasks)
    if (t.idle) {
      delete t.idle;
      t.idleTold = true;
    }
  return next;
}

/**
 * A note was kept behind a task (E41 P2 case 13): a checkpoint, its turns counted afresh. Null where it had counted none.
 * @param {Graph | null} graph @param {string} id @returns {Graph | null}
 */
export function checkpointKept(graph, id) {
  const w = graph ? withTask(graph, id) : null;
  if (!w || !w.t.quiet) return null;
  delete w.t.quiet;
  return w.next;
}

/**
 * The graph as it comes back after a summary (`sessions/reattach.js`), in the words of whoever plans it (`crew`): whole
 * while it has open tasks, else null — what is kept behind it marked (`kept`, E33: case 9) — and, where the runner
 * read them (`where`, E41 P1 case 3), where the planner stands, each running and paused task's newest checkpoint in it.
 * A graph left open with all done comes back as its `where` alone, the ask to weigh the work and close it, where the
 * caller hands the graph back to its own planner (`done`: a compaction, a switch) — never to one reading another's chat.
 * @param {Graph | null | undefined} graph @param {Crew} crew @param {Kept | null} [kept] @param {string | null} [where]
 * @param {{ done?: boolean }} [o]
 */
export const openGraphText = (graph, crew, kept = null, where = null, { done = false } = {}) =>
  !graph || graph.closed ? null : graph.tasks.some(isOpen) ? [showText(graph, crew, kept, { back: true }), where].filter(Boolean).join("\n\n") : done && allDone(graph) ? where || null : null;

/**
 * Whether the graph has a task still open: what a plan's absence is read by (loop.js `unplannedAt`). One being checked
 * counts: its work is not done until its check passes, and a red one opens it again.
 * @param {Graph | null | undefined} graph
 */
export const hasOpenTasks = (graph) => !!graph && !graph.closed && graph.tasks.some((t) => isOpen(t) || t.state === "checking");

/**
 * How much of each checkpoint "Where you are" gives (E41 P1, GX-D10): at a turn's start, a few lines' worth — it goes
 * with every turn; after a compaction, much more — the summary may have lost the rest. Past it the words are named, to
 * be read whole.
 */
export const WHERE_ROOM = Object.freeze({ turn: 1200, back: 4000 });
/** The most ready tasks and waiting ones "Where you are" names, the rest counted. */
const WHERE_LIST = 5;

/**
 * Where the planner stands (HarnessV4_TaskGraphPlus_Plan E41 P1, cases 1–4): the graph's goal and how far it is; each
 * task at work, and each paused one, with its newest checkpoint; each failed one, which waits on whoever plans; what is
 * ready next and what waits on what — a hunt's finding saying which hunt found it (11-02). The planner's working memory,
 * handed back at each turn's start and after a compaction without its asking. `checkpoints`: the words of each task's newest checkpoint, by id, as the runner read
 * them; `room`: how much of each it gives (`WHERE_ROOM`); `parallel`: Parallelize tasks is on; `shared`: the session's sub-agents share
 * its folder (`sideBySide`); `helping`: whether a helper is at work now (`HelperAtWork`). A task whose check runs is at
 * work. A graph left open with all done (the owner's of 11-10) is weighed against the ask once more, where the turn's
 * start has not yet said it (`END_HEARD`, kept by `endHeard`) — what the person asked since it began too, where they
 * wrote since (`personAt`) — and after a compaction again (`again`), whoever heard it, as the summary may have lost it
 * (FabeleHelper's of 11-10). Null while nothing is open, or that was said.
 * @param {Graph | null | undefined} graph
 * @param {{ crew: Crew, checkpoints?: Readonly<Record<string, string>> | null, room?: number, parallel?: boolean, shared?: boolean, helping?: HelperAtWork, personAt?: number | null, again?: boolean }} o
 * @returns {string | null}
 */
export function whereText(graph, { crew, checkpoints = null, room = WHERE_ROOM.turn, parallel = false, shared = false, helping = helpersWork, personAt = null, again = false }) {
  if (!graph || graph.closed) return null;
  if (allDone(graph)) {
    if (!again && (graph.told || []).includes(END_HEARD)) return null;
    const n = liveWork(graph).length;
    return `[Filament: where you are — your task graph${graph.goal ? ` "${cut(graph.goal, 200)}"` : ""}: ${n === 1 ? "its one task is" : `all ${n} tasks are`} done, and it is still open. Weigh what was done against ${graph.goal ? `its goal${askedSince(graph, personAt) ? " and what the person asked since it began" : ""}` : "what the person asked"}: ${leftWords(graph)}; if nothing is left, close it with its outcome (tasks close).]`;
  }
  if (!graph.tasks.some((t) => isOpen(t) || t.state === "checking")) return null;
  const byId = indexOf(graph);
  // A step is counted by its sub-tasks, and said beside the one at work (11-06).
  const steps = kidsOf(graph);
  const live = graph.tasks.filter((t) => t.state !== "dropped" && !steps.has(t.id));
  const done = live.filter((t) => t.state === "done").length;
  const lines = [`[Filament: where you are — your task graph${graph.goal ? ` "${cut(graph.goal, 200)}"` : ""}: ${done} of ${live.length} done.`];
  // Carried over from another chat (piece E): said until the new chat's first turn has heard it (`fromHeard`).
  if (graph.from && !graph.from.heard) lines.push(`- Carried over from the chat "${cut(graph.from.title || graph.from.chain, 80)}": the notes and files kept behind its tasks came with it, and what ran of yours there is paused here — start it to go on.`);
  /** A checkpoint's words under its task's line, as much as `room` gives, the rest named. @param {Task} t */
  const checkpoint = (t) => {
    const c = t.checkpoint;
    const words = c ? checkpoints?.[t.id] : undefined;
    if (!c || words === undefined) return [];
    const whole = words.length <= room;
    const shown = whole ? words : `${words.slice(0, room).replace(/\s+\S*$/, "")} …`;
    const rest = whole ? "" : `\n    (${words.length.toLocaleString("en-US")} characters in all: tasks read with id ${t.id} and title "${c.title}" reads it whole)`;
    return [`  Its ${checkpointWords(c)}:\n${shown.split("\n").map((l) => `    ${l}`).join("\n")}${rest}`];
  };
  const at = graph.tasks.filter((t) => !steps.has(t.id) && (t.state === "running" || t.state === "checking" || t.state === "review" || t.state === "merging"));
  // A task of the planner's own that has gone a few turns with no checkpoint (E41 P2 case 13): said here alone, as a
  // fact — nothing nudges mid-work (GX-D1).
  /** @param {Task} t */
  const quiet = (t) =>
    t.by === "you" && t.state === "running" && !(t.helper && helping(t.helper.agent)) && (t.quiet ?? 0) >= QUIET_TURNS ? [`  ${t.id} has run ${t.quiet} turns ${t.checkpoint ? "since its last checkpoint" : "with no checkpoint"} — keep one (tasks keep, or pause) before a compaction can lose where it stands`] : [];
  // One the last turn left running with nothing at work on it (d-idle, `leftIdle`): said once, as a fact.
  /** @param {Task} t */
  const idle = (t) => (t.idle && t.by === "you" && t.state === "running" ? [`  ${t.id} was left running as your last turn ended, with nothing at work on it — go on with it now, or pause it with a checkpoint (tasks pause) where it waits on something`] : []);
  /** The hunt that found a task, after its line (11-02); "" for one no hunt found. @param {Task} t */
  const found = (t) => (t.foundBy ? ` · ${foundSaid(t.foundBy)}` : "");
  /** The step a sub-task is part of, after its line (11-06); "" for one under none. @param {Task} t */
  const part = (t) => {
    const ks = t.under ? steps.get(t.under) : undefined;
    const s = t.under ? byId.get(t.under) : undefined;
    return s && ks ? ` · part of ${s.id} "${cut(s.name, 80)}" (${ks.filter((k) => k.state === "done").length} of ${ks.length} done)` : "";
  };
  for (const t of at) lines.push(`- On it: ${t.id} "${t.name}" — ${standing(t, byId)}${t.state === "running" && t.startedAt ? `, since ${clockOf(t.startedAt)}` : ""}${found(t)}${part(t)}`, ...checkpoint(t), ...quiet(t), ...idle(t));
  for (const t of graph.tasks.filter((x) => x.state === "paused")) {
    const waits = needsOf(t, byId).filter((n) => !needMet(/** @type {Task} */ (byId.get(n)), t));
    lines.push(`- Paused: ${t.id} "${t.name}"${t.checkpoint ? ` — ${checkpointWords(t.checkpoint)}` : ""}${waits.length ? `; it waits on ${waits.join(", ")}` : ""}${found(t)}${part(t)}`, ...checkpoint(t));
  }
  for (const t of graph.tasks.filter((x) => x.state === "failed")) lines.push(`- Failed: ${t.id} "${t.name}" — ${cut(t.why, 160)}: it waits on you${found(t)}`);
  /** Tasks in a line, the first few by name, the rest counted. @param {Task[]} ts */
  const few = (ts) => `${ts.slice(0, WHERE_LIST).map((t) => `${t.id} "${t.name}"${t.foundBy ? ` (${foundSaid(t.foundBy)})` : ""}`).join(", ")}${ts.length > WHERE_LIST ? `, and ${ts.length - WHERE_LIST} more` : ""}`;
  const r = ready(graph);
  if (r.length) lines.push(`- Ready next: ${few(r)}`);
  // Those of its own that can run at once (E41 P3 case 17): said whenever it holds, as the block says how things stand.
  const side = led(crew) ? [] : sideBySide(graph, ignoredOf(graph, parallel), { shared }, helping);
  if (side.length) lines.push(`- Side by side now: ${side.join(", ")}`);
  const b = blocked(graph);
  if (b.length) lines.push(`- Waiting: ${b.slice(0, WHERE_LIST).map((x) => `${x.id} on ${x.on.map((o) => o.id).join(", ")}`).join("; ")}${b.length > WHERE_LIST ? `; and ${b.length - WHERE_LIST} more` : ""}`);
  // Only the planner's own task is started by its planner: a worker's, a sub-agent's or a command task Filament starts
  // once its needs are done and a slot is free — and a lead's tasks are its workers'.
  if (graph.planning) lines.push(`- ${planWaitsWords(crew)}`);
  else if (!at.length && !graph.tasks.some((t) => t.state === "paused")) lines.push(led(crew) ? "- Nothing is at work now." : `- Nothing is running${r.some((t) => t.by === "you") ? ": start what is ready, or re-plan" : ""}.`);
  lines.push("tasks show reads the whole graph.]");
  return lines.join("\n");
}

/**
 * Whether a coding agent's helper is at work now, by its sub-agent's id (the registry's word, which the runner asks):
 * a task it helps is no work of the planner's own until it ends. Left out, every helper named is taken as at work.
 * @typedef {(agent: string) => boolean} HelperAtWork
 */
/** @type {HelperAtWork} */
const helpersWork = () => true;
/**
 * The planner's own tasks that run, but a step under way, which does no work of its own (11-06), and one a coding agent's
 * helper works on now (FabeleHelper's of 11-10): the helper does it. Once its helper ended, it is the planner's again —
 * to apply the helper's change and mark it done, or to do itself (the review of d81fdac5e).
 * @param {Graph} graph @param {HelperAtWork} [helping]
 */
const ownRunning = (graph, helping = helpersWork) => {
  const steps = kidsOf(graph);
  return graph.tasks.filter((t) => t.state === "running" && t.by === "you" && !(t.helper && helping(t.helper.agent)) && !steps.has(t.id));
};

/**
 * The line that follows what lands while the planner is on a task of its own (HarnessV4_TaskGraphPlus_Plan E41 P1 case 7,
 * E36 case 6): an envelope's line, the developer's message — which task it came during, and how to take it up first
 * without losing that task. Not its own background command's end, which it started for its work (FabeleHelper's of
 * 11-10: said after every end, the line was noise). Nothing pauses by itself (CP-D1): a small thing is done inside the
 * task. Null where no task of the planner's own runs. `helping`: whether a helper is at work now (`HelperAtWork`).
 * @param {Graph | null | undefined} graph @param {HelperAtWork} [helping] @returns {string | null}
 */
export function onTaskText(graph, helping = helpersWork) {
  const own = graph && !graph.closed ? ownRunning(graph, helping) : [];
  if (!own.length) return null;
  if (own.length === 1) {
    const [t] = own;
    return `[Filament: this came while you are on ${t.id} "${cut(t.name, 120)}". To take it up first, pause ${t.id} with a checkpoint (tasks pause) and add it as a task — or do it inside ${t.id} if it belongs there.]`;
  }
  return `[Filament: this came while you are on ${own.map((t) => `${t.id} "${cut(t.name, 80)}"`).join(", ")}. To take it up first, pause the task it cuts into with a checkpoint (tasks pause) and add it as a task — or do it inside one of them if it belongs there.]`;
}

/**
 * The tasks of the agent's own that run, said where a wait finds none of its sub-agents running (E41 P5's measure: an
 * agent that took two of its own tasks for sub-agents' work waited on them, heard "Nothing to wait for" and ended its
 * turn, with no one at work): no sub-agent does them, so it does them — or gives them to sub-agents, whom Filament
 * starts. One whose helper ended is said so: its report and change are the agent's to take up (the review of
 * d81fdac5e). Null with none, or a closed graph. `helping`: whether a helper is at work now (`HelperAtWork`). `solo`: a
 * coding agent's wait, whose tasks tool gives no task to a sub-agent: it launches one on the task itself, with Filament's
 * agent tool.
 * @param {Graph | null | undefined} graph @param {HelperAtWork} [helping] @param {boolean} [solo] @returns {string | null}
 */
export function ownWorkText(graph, helping = helpersWork, solo = false) {
  const own = graph && !graph.closed ? ownRunning(graph, helping) : [];
  if (!own.length) return null;
  const helped = own.filter((t) => t.helper);
  const mine = own.filter((t) => !t.helper);
  const one = mine.length === 1;
  const give = solo
    ? `launch ${one ? "a sub-agent on it" : "sub-agents on them"} with Filament's agent tool, ${one ? "the task" : "each one's task"} in task`
    : `give ${one ? "it to a sub-agent" : "them to sub-agents"} with tasks change (by), and Filament starts ${one ? "it" : "them"}`;
  return [
    mine.length ? `Your task graph's ${mine.map((t) => `${t.id} "${cut(t.name, 80)}"`).join(", ")} ${one ? "runs" : "run"} as your own work: no sub-agent does ${one ? "it" : "them"}. Do ${one ? "it" : "them"} now — or ${give}.` : "",
    ...helped.map((t) => `${t.id} "${cut(t.name, 80)}" runs on, and its helper ${t.helper?.agent} has ended: weigh its report, apply its change where one waits, and mark ${t.id} done — or do the rest yourself.`),
  ].filter(Boolean).join(" ");
}

