// @ts-check
// What is still open in a chat as a summary takes the place of its turns (the owner's plan of 11-02, Phase 4): the
// background commands its agents started that run on, the coding agent's own background tasks, and its sub-agents still
// working for its main agent — one that asks the person, one whose work waits for it, one that failed. A summary keeps
// what the conversation said of them, or leaves it out; these lines say how they stood as it was written, so the agent
// after it neither starts a second dev server nor loses work that waits for it. They ride the block that comes back after
// a summary (sessions/reattach.js `reattachBlock`); what follows the summary tells each end in its turn. The letters
// that wait for its reply are among them (letters.js `asks`): a summary of the turn a letter came in may keep no word of
// it (the compaction audit of 11-07). A come-back is
// no part of it: the person's Stop and Filament's restart drop one without a word, and a line saying it waits would
// outlive it. Nor are the envelopes still sealed: their own list is said after every compaction and at every turn's
// start (HarnessV4_Envelopes_Plan EN-D6).
//
// A coding agent that compacts its own context is told the list again at its next step in that turn, or with its next
// turn's first prompt; and once it was told, the list as it heard it is kept with the chat (`openHeard` in its meta): a
// turn starts with the list again where a change it was told waits for it was applied or dropped by someone else while
// no turn of its ran (`createStillOpen`). Every other end it hears by itself: a command's end is told to it, a sub-agent's
// report comes to it, and its agent tells it of its own tasks.
//
// Made fuller (the owner's of 11-09, d1): what else waits for the main agent or the person — a graph task's change and a
// team worker's that wait to be applied, a dropped task's change still in its copy, each with how long it waited and
// how far the folder moved on since; a sub-agent's work that could not be saved; a deleted chat's work on the
// repository's refs; Filament's copies on disk; worktrees, branches and forks left over. Each line ends with its id: the
// agent dismisses a line that no longer holds (a false alarm) with its envelope tool, and the chat keeps a mark of what
// it named as it was dismissed (`openDismissed`), so it stays out of the list until that changes. A sub-agent's change
// that waits, unsaid for WAITS_AGAIN turns, is said again at the next turn's start (`openUnsaid`); one that waits
// WAITS_LONG_MS inside one turn with nothing said of it, at the agent's next call in it (`waited`). The folder's reads
// are git's, and slow: read before a block is written and as a turn's start says the list (`refresh`), kept a while.
import { createHash } from "node:crypto";
import { runningShellsOf } from "../../adapters/tools/hands.js";
import { redactSecrets } from "../../core/redact.js";
import { TAIL_MOST } from "../../core/task-graph.js";
import { tookWords } from "./commands.js";

/**
 * The most of each kind the lines say whole: past it, how many more — the commands by their ids, which no tool of
 * Filament's loop lists again.
 */
export const OPEN_MOST = 12;
/** How many turns a sub-agent's change that waits goes unsaid before a turn's start says the list again. */
export const WAITS_AGAIN = 3;
/**
 * How long a change waits for its apply within one turn, with nothing said of it, before the agent's next call says the
 * list (`waited`): far past an ordinary turn — a question, an edit, a test run —, which never lasts so long and so never
 * hears it, and well short of the hour a sub-agent's change waited unnamed inside one long turn (the gap of 11-11).
 */
export const WAITS_LONG_MS = 20 * 60_000;
/** How long the folder's reads serve the lists after them (`refresh`). */
export const MORE_KEPT_MS = 60_000;
/** How long a turn's start waits for the folder's reads before it says the list with those it has. */
export const MORE_WAIT_MS = 1_500;

/**
 * A sub-agent still open, as the registry says it (`openWork`): working now — `asks`, its question to the person waits
 * for their answer —, with `files` of its work waiting to be applied, or `failed`, its error, since the chat's newest
 * summary. Where its work waits: since when (`since`, its exchange's end), how many commits the folder has that it did
 * not start from (`drift`), and its work's mark (`mark`: its base and head), which a dismissal keeps.
 * @typedef {{ id: string, description: string, running: boolean, files: number, asks?: boolean, failed?: string | null, since?: number | null, drift?: number | null, mark?: string }} OpenAgent
 */
/**
 * A change that waits outside the registry's open work (the owner's of 11-09): a graph task's that is ready (`graph`), a
 * dropped task's still in its copy (`dropped`), a failed or done one's (`ended`, `state` which) — `task` and `title` its
 * graph's —, an earlier try at a task of the graph, which another sub-agent took since (`try`), an earlier graph's
 * task's, which no task of the graph holds now (`earlier`, its `task` the id it had), or a team worker's (`worker`);
 * `id`, the sub-agent whose change it is. `mark`: its work's base and head.
 * @typedef {{ kind: "graph" | "dropped" | "ended" | "try" | "earlier" | "worker", id: string, task?: string, title?: string, description?: string, state?: "failed" | "done", files: number, mark: string, since?: number | null, drift?: number | null }} OpenChange
 */
/**
 * What git and the disk say of a chat's folder, read by `more` (server.js): how many commits the folder has that each
 * waiting change did not start from, by its sub-agent's id (`drift`); a sub-agent's work that could not be saved
 * (`uncaptured`, the registry's `failedCaptures` and the copies marked unsaved); a deleted chat's helpers' work that
 * waits on the repository's refs (`deleted`); Filament's copies of the repository (`copies`, their size where a read of
 * the footprint measured it, `partial` where that measure was cut short); and what is left over — a worktree whose
 * branch is merged with nothing uncommitted, a branch merged and checked out nowhere, a deleted chat's fork that stayed.
 * `unread`: the parts of it this read could not read — git refused, or failed —, which it lists none of: nothing is
 * known of them, so a line of such a part the agent dismissed keeps its dismissal (`prune`). `project`: false where the
 * chat is in no project, which has no Folders and worktrees… to see to what is left at.
 * @typedef {"uncaptured" | "deleted" | "copies" | "worktrees" | "branches" | "forks"} FolderPart
 * @typedef {{ drift?: Record<string, number>, uncaptured?: Uncaptured[], deleted?: DeletedWork[], copies?: CopiesOnDisk[], worktrees?: LeftWorktree[], branches?: LeftBranch[], forks?: LeftFork[], unread?: FolderPart[], project?: boolean }} OpenMore
 * @typedef {{ id: string, error: string, dest: string, at: number }} Uncaptured
 * @typedef {{ id: string, chainId: string, deletedAt: number, head: string, at: number | null }} DeletedWork
 * @typedef {{ repo: string, count: number, bytes: number | null, partial?: boolean }} CopiesOnDisk
 * @typedef {{ path: string, branch: string | null, into: string | null, head: string, age: number | null }} LeftWorktree
 * @typedef {{ name: string, into: string, head: string, age: number | null }} LeftBranch
 * @typedef {{ chain: string, path: string, head: string | null, why: string | null }} LeftFork
 */
/**
 * One of the coding agent's own background tasks (Claude's, acp/bridge.js `AgentTask`), as Filament keeps the chat's
 * list: the agent's to read and to stop — Filament can stop none of its shells. Only the session that runs it reaches it
 * by its id, so it is said to that session alone.
 * @typedef {{ id: string, kind: string, description: string, since: number, background?: boolean }} OwnTask
 */
/**
 * The coding agent's own background tasks in a session other than the one told (the owner's of 11-08, G4): the agent the
 * chat moved off, or one of its sessions before a fresh one started from Filament's copy — `who` names it. Said so that
 * the one told starts no second dev server, and knows it can neither read nor stop them.
 * @typedef {{ who: string, tasks: readonly OwnTask[] }} TheirTasks
 */
/**
 * A letter that waits for the agent's reply (letters.js `asks`): its id, its subject, who wrote it, in words, and when.
 * `from` is the agent's words, with the id it answers by; `who`, the person's on the card (the reviewer's of 11-10).
 * @typedef {{ id: string, subject: string, from: string, at: number, who?: string }} OwedLetter
 */
/**
 * A thing open in the person's words, as the Plan's card draws it (the owner's of 11-10: the agent's lines read "a mess
 * and un explainable"): its group — `waiting`, on the person or the agent (a change to apply, a question, a failure, a
 * letter), `running`, or `left` behind, which the person tidies in the project's Folders and worktrees —, how it stands
 * (`tone`), its `title` and the line under it (`detail`), and what the card's button does: `thread` opens its sub-agent's
 * thread, `review` its change in Changes (`agent`: whose). One left behind says what it is (`what`); copies, how many
 * and how big (`count`, `size`).
 * @typedef {{ group: "waiting" | "running" | "left", tone: "run" | "ask" | "wait" | "fail" | "left", title: string, detail: string,
 *   act?: "thread" | "review", agent?: string, what?: "copies" | "worktree" | "branch" | "fork" | "deleted", count?: number, size?: string }} OpenView
 */
/**
 * One thing open, as its line says it (`text`, after its "- "), with its key and its mark: what it named as it stood,
 * which a dismissal keeps (`openDismissed`) — the same while it stands so. `dismissed`: the agent dismissed it, and it
 * stands as it did then. `view`: the same in the person's words. `since`: a change that waits for its apply, when it
 * began to wait — null where that is unknown. `short`: its line up to its instructions, as a done's "Also still open"
 * says it (`alsoOpenWords`) — kept as the line is written, never cut out of it after: the words an agent wrote into it
 * (a letter's subject, a description, a command) may hold any dash.
 * @typedef {{ key: string, text: string, short: string, mark: string, view: OpenView, dismissed?: true, since?: number | null }} OpenRow
 */
/**
 * What is open, a line each, and a key each — what it is and how it stands, the same while it stands so — which tell
 * whether what an agent was told changed since. Each line ends with its key, in brackets: the id the envelope tool's
 * dismiss takes. `plain`: the same lines without it, as the Plan's card shows them; `rows`: each thing whole, a
 * dismissed one too; `all`: every key, a dismissed one too.
 * @typedef {{ lines: string[], keys: string[], plain: string[], rows: OpenRow[], all: string[] }} OpenList
 */

/** Words on one line, at most `most` characters. @param {string} s @param {number} most */
const oneLine = (s, most) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > most ? `${t.slice(0, most - 1)}…` : t;
};
/** @param {number} n @param {string} what */
const more = (n, what) => `- and ${n} more ${what}`;
/** A task's kind as its line names it (the SDK's `task_type`). @param {string} kind */
const taskWord = (kind) => (kind === "local_bash" ? "shell" : kind === "local_agent" ? "agent" : kind === "remote_agent" ? "remote agent" : kind === "local_workflow" ? "workflow" : "task");
/** A short fingerprint of words. @param {string} s */
const hashOf = (s) => createHash("sha1").update(String(s)).digest("hex").slice(0, 12);
/** `n` of a thing, its plural where it is not one. @param {number} n @param {string} one */
const many = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
/** How long ago, in days past two of them. @param {number} ms */
const agoWords = (ms) => (ms >= 2 * 86_400_000 ? `${Math.floor(ms / 86_400_000)} days` : tookWords(ms));
/** A copy's disk in words, gigabytes past one. @param {number} bytes */
const diskWords = (bytes) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);
/**
 * How long a change has waited, and how many commits the folder has that it did not start from — those words left out
 * at none: "(for 2 h; your folder has 3 commits it did not start from)", or "" where neither is known.
 * @param {{ since?: number | null, drift?: number | null }} c @param {number} now
 */
const waitedWords = (c, now) => {
  const bits = [...(Number(c.since) > 0 ? [`for ${tookWords(now - Number(c.since))}`] : []), ...(Number(c.drift) > 0 ? [`your folder has ${many(Number(c.drift), "commit")} it did not start from`] : [])];
  return bits.length ? ` (${bits.join("; ")})` : "";
};
/**
 * Where the person sees to what a project's folder left behind: its Folders and worktrees…, a row of the project's menu
 * in the left bar and of ⋯ on its page — one road whether or not the project has a Space (d-send's third follow-up).
 */
const PLACES_ROAD = "the project's Folders and worktrees… (its menu in the left bar, or ⋯ on its page)";
/** Where the person lets a copy, or a deleted chat's work, go: Filament's footprint, at that sheet's foot. */
const FOOTPRINT_WHERE = `${PLACES_ROAD}, Filament's footprint at its foot`;
/** Where they do in a chat of no project, which has no Space: its Plan page's Still open card. */
const FOOTPRINT_HERE = "this chat's Plan page, Still open › Left behind";
/** A folder's last part: "app-fixes" of "H:/app-fixes". @param {string} p */
const baseName = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || String(p || "");
/**
 * How long a change waited, and how far the folder moved since it started, in the card's words: ["waiting 2 h", "3
 * commits in your folder since it started"]. @param {{ since?: number | null, drift?: number | null }} c @param {number} now
 */
const waitedView = (c, now) => [
  ...(Number(c.since) > 0 ? [`waiting ${tookWords(now - Number(c.since))}`] : []),
  ...(Number(c.drift) > 0 ? [`${many(Number(c.drift), "commit")} in your folder since it started`] : []),
];
/** A sub-agent's title on the card: its description, else its id. @param {{ id: string, description?: string }} a */
const agentTitle = (a) => (a.description ? oneLine(a.description, 90) : `Sub-agent ${a.id}`);
/**
 * The ways out of a change no task waits for any more — a dropped task's, an earlier graph's —: its apply, its mark
 * where it came into the folder another way (the owner's of 11-10: one brought in by hand waited on in Changes), or the
 * person's word. After "agent with agent_id … and ".
 */
const GONE_WAYS = "apply_changes: true to apply it, mark_applied: true where it came into your folder another way, or leave it";
/** A graph task's title on the card: "Task t3: Fix the login". @param {OpenChange} c */
const taskTitle = (c) => `Task ${c.task}${c.title ? `: ${oneLine(c.title, 80)}` : ""}`;
/** The size of Filament's copies in their mark, where no read of the footprint measured it. */
const SIZE_UNKNOWN = "?";
/**
 * Whether a thing dismissed with the mark `then` stands as it did, its mark `now`: the same mark — and, of Filament's
 * copies, as many of them where their size was not measured then or is not now. What Filament does not know of their
 * size is no change of them: a size measured since, or forgotten over a restart, brings no dismissed line back.
 * @param {string} key @param {string} then @param {string} now
 */
const standsAs = (key, then, now) => {
  if (then === now || !key.startsWith("copies:")) return then === now;
  const [had, was] = then.split(":");
  const [has, is] = now.split(":");
  return had === has && (was === SIZE_UNKNOWN || is === SIZE_UNKNOWN);
};

/**
 * What is open for one agent, a line and a key for each thing: the commands oldest first, then the agent's own
 * background tasks, then the sub-agents working — one that asks the person says so —, those whose work waits, a graph
 * task's change that is ready and a team worker's, a dropped task's change still in its copy, a failed or done one's, an
 * earlier try's at a task and an earlier graph's, those that failed, and a sub-agent's work that could not be saved.
 * None where nothing is. `agent`: whose they are — null for the session's main agent, who reaches every command of the
 * session's, a sub-agent's (`subagent:<id>`) its own. A command's secrets are
 * redacted before it is cut to its line, and so are a failure's words. Past `OPEN_MOST` of a kind, its keys are kept all
 * the same. Then the letters that wait for its reply, oldest first; then what the folder holds for the person to see to:
 * a deleted chat's work, Filament's copies, and worktrees, branches and forks left over. After its own tasks, those of
 * another session (`theirs`), whose they are. `dismissed`: each key the agent dismissed, with its mark then — a thing
 * that stands as it did is left out of the lines and the keys. `project`: false for a chat in no project, whose lines
 * name no Space: its Plan page where it has what is left, else the person's word.
 * @param {{ shells: readonly import("../../adapters/tools/hands.js").RunningShell[], agent: string | null, agents?: readonly OpenAgent[], tasks?: readonly OwnTask[], theirs?: TheirTasks | null, letters?: readonly OwedLetter[],
 *   changes?: readonly OpenChange[], uncaptured?: readonly Uncaptured[], deleted?: readonly DeletedWork[], copies?: readonly CopiesOnDisk[], worktrees?: readonly LeftWorktree[], branches?: readonly LeftBranch[], forks?: readonly LeftFork[],
 *   dismissed?: Readonly<Record<string, string>>, project?: boolean, now: number }} o
 * @returns {OpenList}
 */
export function openList({ shells, agent, agents = [], tasks = [], theirs = null, letters = [], changes = [], uncaptured = [], deleted = [], copies = [], worktrees = [], branches = [], forks = [], dismissed = {}, project = true, now }) {
  const where = project ? FOOTPRINT_WHERE : FOOTPRINT_HERE;
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const plain = [];
  /** @type {string[]} */
  const keys = [];
  /** @type {string[]} */
  const all = [];
  /** @type {OpenRow[]} */
  const rows = [];
  /**
   * One kind, oldest first as given: a line each up to `OPEN_MOST`, its key at its end, then how many more (`rest`,
   * their ids where the kind names them); a row each, past it too, which a dismissal finds; a dismissed one that stands
   * as it was, its row alone. Each row with its `view`, the card's words, and a change's with when it began to wait
   * (`since`). `line`: a thing's line — where it ends with what to do about it, the line up to that and those
   * instructions apart, so its row keeps the first whole (`short`).
   * @template T
   * @param {readonly T[]} items @param {(x: T) => string} key @param {(x: T) => string} mark @param {(x: T) => string | [string, string]} line
   * @param {(left: T[]) => string} rest @param {(x: T) => OpenView} view @param {((x: T) => number | null) | null} [since]
   */
  const kind = (items, key, mark, line, rest, view, since = null) => {
    /** @param {T} x */
    const waited = (x) => (since ? { since: Number(since(x)) || null } : {});
    /** @param {T} x */
    const said = (x) => {
      const l = line(x);
      return typeof l === "string" ? { text: l, short: l } : { text: `${l[0]}${l[1]}`, short: l[0] };
    };
    /** @type {{ x: T, k: string, m: string }[]} */
    const live = [];
    for (const x of items) {
      const k = key(x);
      const m = mark(x);
      all.push(k);
      if (Object.hasOwn(dismissed, k) && standsAs(k, dismissed[k], m)) rows.push({ key: k, ...said(x), mark: m, view: view(x), dismissed: true, ...waited(x) });
      else live.push({ x, k, m });
    }
    live.forEach(({ x, k, m }, i) => {
      const { text, short } = said(x);
      rows.push({ key: k, text, short, mark: m, view: view(x), ...waited(x) });
      if (i >= OPEN_MOST) return;
      plain.push(`- ${text}`);
      lines.push(`- ${text} [${k}]`);
    });
    if (live.length > OPEN_MOST) {
      const left = rest(live.slice(OPEN_MOST).map((l) => l.x));
      plain.push(left);
      lines.push(left);
    }
    keys.push(...live.map((l) => l.k));
  };
  const mine = shells.filter((s) => agent === null || s.agent === agent).sort((a, b) => a.startedAt - b.startedAt);
  kind(
    mine,
    (s) => `command:${s.id}`,
    (s) => hashOf(`${s.command}\n${s.cwd}`),
    (s) => {
      const by = s.agent !== null && s.agent !== agent ? `, started by sub-agent ${s.agent.replace(/^subagent:/, "")}` : "";
      return `background command ${s.id}: \`${oneLine(redactSecrets(s.command), 120)}\` in ${s.cwd}${by}, running for ${tookWords(now - s.startedAt)}`;
    },
    (left) => `${more(left.length, "background commands")}: ${left.map((s) => s.id).join(", ")}`,
    (s) => ({
      group: "running", tone: "run", title: oneLine(redactSecrets(s.command), 90),
      detail: [`Background command, running ${tookWords(now - s.startedAt)}`, `in ${baseName(s.cwd)}`, ...(s.agent !== null && s.agent !== agent ? ["started by a sub-agent"] : [])].join(" · "),
    }),
  );
  const own = [...tasks].sort((a, b) => a.since - b.since);
  kind(
    own,
    (t) => `task:${t.id}`,
    (t) => hashOf(t.description || ""),
    (t) => [`your own background ${taskWord(t.kind)} ${t.id}${t.description ? ` ("${oneLine(redactSecrets(t.description), 80)}")` : ""}: running for ${tookWords(now - t.since)}`, " — yours to read and to stop, with your own tools"],
    (left) => `${more(left.length, "background tasks of your own")}: ${left.map((t) => t.id).join(", ")}`,
    (t) => ({
      group: "running", tone: "run", title: t.description ? oneLine(redactSecrets(t.description), 90) : `Background ${taskWord(t.kind)} ${t.id}`,
      detail: `The agent's own background ${taskWord(t.kind)}, running ${tookWords(now - t.since)}`,
    }),
  );
  const other = [...(theirs?.tasks || [])].sort((a, b) => a.since - b.since);
  kind(
    other,
    (t) => `theirs:${t.id}`,
    (t) => hashOf(t.description || ""),
    (t) => [`background ${taskWord(t.kind)} ${t.id}${t.description ? ` ("${oneLine(redactSecrets(t.description), 80)}")` : ""} in ${theirs?.who}'s session of this chat, not yours: running for ${tookWords(now - t.since)}`, " — you can neither read nor stop it: it runs on in that session, so do not start it again"],
    (left) => `${more(left.length, `background tasks in ${theirs?.who}'s session`)}: ${left.map((t) => t.id).join(", ")}`,
    (t) => ({
      group: "running", tone: "run", title: t.description ? oneLine(redactSecrets(t.description), 90) : `Background ${taskWord(t.kind)} ${t.id}`,
      detail: `In ${theirs?.who}'s session of this chat, running ${tookWords(now - t.since)}`,
    }),
  );
  const named = (/** @type {{ id: string, description?: string }} */ a) => `sub-agent ${a.id}${a.description ? ` ("${oneLine(a.description, 80)}")` : ""}`;
  kind(
    agents.filter((a) => a.running),
    (a) => `agent:${a.id}:${a.asks ? "asks" : "working"}`,
    () => "",
    (a) => `${named(a)}: still working${a.asks ? "; it waits for the person's answer to its question" : ""}; its report comes to you`,
    (left) => more(left.length, "sub-agents working"),
    (a) => (a.asks
      ? { group: "waiting", tone: "ask", title: agentTitle(a), detail: "A sub-agent at work asks you a question", act: "thread", agent: a.id }
      : { group: "running", tone: "run", title: agentTitle(a), detail: "Sub-agent at work: its report comes to the agent", act: "thread", agent: a.id }),
  );
  kind(
    agents.filter((a) => !a.running && a.files > 0),
    (a) => `agent:${a.id}:waits`,
    (a) => a.mark || String(a.files),
    (a) => `${named(a)}: ${many(a.files, "file")} of its work wait${a.files === 1 ? "s" : ""} to be applied${waitedWords(a, now)}`,
    (left) => more(left.length, "sub-agents whose work waits"),
    (a) => ({ group: "waiting", tone: "wait", title: agentTitle(a), detail: [`${many(a.files, "file")} to apply`, ...waitedView(a, now)].join(" · "), act: "review", agent: a.id }),
    (a) => a.since ?? null,
  );
  const ready = changes.filter((c) => c.kind === "graph");
  const task = (/** @type {OpenChange} */ c) => `task ${c.task} of your task graph${c.title ? ` ("${oneLine(c.title, 80)}")` : ""}`;
  kind(
    ready,
    (c) => `graph:${c.task}:waits`,
    (c) => c.mark,
    (c) => [`${task(c)}: ${many(c.files, "file")} of sub-agent ${c.id}'s change wait${c.files === 1 ? "s" : ""} to be applied${waitedWords(c, now)}`, ` — agent with agent_id "${c.id}" and apply_changes: true, or leave it`],
    (left) => more(left.length, "tasks whose change waits"),
    (c) => ({ group: "waiting", tone: "wait", title: taskTitle(c), detail: [`${many(c.files, "file")} to apply, from its sub-agent`, ...waitedView(c, now)].join(" · "), act: "review", agent: c.id }),
    (c) => c.since ?? null,
  );
  kind(
    changes.filter((c) => c.kind === "worker"),
    (c) => `worker:${c.id}:waits`,
    (c) => c.mark,
    (c) => [`worker ${c.id}${c.description ? ` ("${oneLine(c.description, 80)}")` : ""} of your team: ${many(c.files, "file")} of its change wait${c.files === 1 ? "s" : ""} to be applied${waitedWords(c, now)}`, " — worker with its agent_id and apply_changes: true, or leave it"],
    (left) => more(left.length, "workers whose change waits"),
    (c) => ({ group: "waiting", tone: "wait", title: c.description ? oneLine(c.description, 90) : `Team worker ${c.id}`, detail: [`Team worker · ${many(c.files, "file")} to apply`, ...waitedView(c, now)].join(" · "), act: "review", agent: c.id }),
    (c) => c.since ?? null,
  );
  kind(
    changes.filter((c) => c.kind === "dropped"),
    (c) => `graph:${c.task}:dropped`,
    (c) => c.mark,
    (c) => [`${task(c)}, dropped: ${many(c.files, "file")} of sub-agent ${c.id}'s change still wait${c.files === 1 ? "s" : ""} in its copy${waitedWords(c, now)}`, ` — agent with agent_id "${c.id}" and ${GONE_WAYS}`],
    (left) => more(left.length, "dropped tasks whose change waits"),
    (c) => ({ group: "waiting", tone: "wait", title: taskTitle(c), detail: [`Dropped task · ${many(c.files, "file")} of its change still to apply`, ...waitedView(c, now)].join(" · "), act: "review", agent: c.id }),
    (c) => c.since ?? null,
  );
  kind(
    changes.filter((c) => c.kind === "ended"),
    (c) => `graph:${c.task}:${c.state}`,
    (c) => c.mark,
    (c) => [`${task(c)}, ${c.state}: ${many(c.files, "file")} of sub-agent ${c.id}'s change still wait${c.files === 1 ? "s" : ""} in its copy${waitedWords(c, now)}`, ` — agent with agent_id "${c.id}" and ${GONE_WAYS}`],
    (left) => more(left.length, "failed or done tasks whose change waits"),
    (c) => ({ group: "waiting", tone: "wait", title: taskTitle(c), detail: [`${c.state === "failed" ? "Failed" : "Done"} task · ${many(c.files, "file")} of its change still to apply`, ...waitedView(c, now)].join(" · "), act: "review", agent: c.id }),
    (c) => c.since ?? null,
  );
  kind(
    changes.filter((c) => c.kind === "try"),
    (c) => `agent:${c.id}:waits`,
    (c) => c.mark,
    (c) => [`sub-agent ${c.id}${c.description ? ` ("${oneLine(c.description, 80)}")` : ""}, an earlier try at task ${c.task} of your task graph: ${many(c.files, "file")} of its change still wait${c.files === 1 ? "s" : ""} in its copy${waitedWords(c, now)}`, ` — agent with agent_id "${c.id}" and ${GONE_WAYS}`],
    (left) => more(left.length, "earlier tries at tasks whose change waits"),
    (c) => ({ group: "waiting", tone: "wait", title: c.description ? oneLine(c.description, 90) : `Sub-agent ${c.id}`, detail: [`An earlier try at task ${c.task} · ${many(c.files, "file")} of its change still to apply`, ...waitedView(c, now)].join(" · "), act: "review", agent: c.id }),
    (c) => c.since ?? null,
  );
  kind(
    changes.filter((c) => c.kind === "earlier"),
    (c) => `agent:${c.id}:waits`,
    (c) => c.mark,
    (c) => [`sub-agent ${c.id}${c.description ? ` ("${oneLine(c.description, 80)}")` : ""}, of task ${c.task} of an earlier task graph: ${many(c.files, "file")} of its change still wait${c.files === 1 ? "s" : ""} in its copy${waitedWords(c, now)}`, ` — agent with agent_id "${c.id}" and ${GONE_WAYS}`],
    (left) => more(left.length, "earlier graphs' tasks whose change waits"),
    (c) => ({ group: "waiting", tone: "wait", title: c.description ? oneLine(c.description, 90) : `Sub-agent ${c.id}`, detail: [`An earlier task graph's ${c.task} · ${many(c.files, "file")} of its change still to apply`, ...waitedView(c, now)].join(" · "), act: "review", agent: c.id }),
    (c) => c.since ?? null,
  );
  kind(
    agents.filter((a) => !a.running && !(a.files > 0) && a.failed != null),
    (a) => `agent:${a.id}:failed`,
    (a) => a.mark || hashOf(a.failed || ""),
    (a) => [`${named(a)}: failed`, `${a.failed ? ` — ${oneLine(redactSecrets(a.failed), 160)}` : ""}; follow it up to try again, or leave it`],
    (left) => more(left.length, "sub-agents that failed"),
    (a) => ({ group: "waiting", tone: "fail", title: agentTitle(a), detail: a.failed ? `Failed: ${oneLine(redactSecrets(a.failed), 140)}` : "Failed", act: "thread", agent: a.id }),
  );
  kind(
    uncaptured,
    (u) => `agent:${u.id}:uncaptured`,
    (u) => hashOf(u.error),
    (u) => [`sub-agent ${u.id}: its work could not be saved (${oneLine(redactSecrets(u.error), 160)}), so it is only in its copy at ${u.dest}, kept as it is since ${tookWords(now - u.at)} ago`, " — apply it, or tell the person before anything lets that copy go"],
    (left) => more(left.length, "sub-agents whose work could not be saved"),
    (u) => ({ group: "waiting", tone: "fail", title: `Sub-agent ${u.id}`, detail: `Its work could not be saved: it is only in its copy at ${u.dest}`, act: "thread", agent: u.id }),
  );
  const owed = [...letters].sort((a, b) => a.at - b.at);
  kind(
    owed,
    (l) => `letter:${l.id}`,
    () => "",
    (l) => [`letter ${l.id}, "${oneLine(l.subject, 80)}", from ${l.from}, ${tookWords(now - l.at)} ago: it waits for your reply`, ` — send it with Filament's envelope tool (answer: "${l.id}"), or leave it`],
    (left) => `${more(left.length, "letters waiting for your reply")}: ${left.map((l) => l.id).join(", ")}`,
    (l) => ({ group: "waiting", tone: "wait", title: oneLine(l.subject, 90) || "A letter", detail: `Letter from ${l.who || l.from}, ${tookWords(now - l.at)} ago · waits for the agent's reply` }),
  );
  kind(
    deleted,
    (d) => `deleted:${d.id}`,
    (d) => d.head,
    (d) => [`sub-agent ${d.id} of a chat deleted ${agoWords(now - d.deletedAt)} ago (${d.chainId}): its work waits on the repository's refs, which only the person can apply or let go`, ` — at ${where}`],
    (left) => more(left.length, "deleted chats' sub-agents whose work waits"),
    (d) => ({ group: "left", tone: "left", what: "deleted", title: `Sub-agent ${d.id} of a deleted chat`, detail: `Its work waits in git since the chat was deleted ${agoWords(now - d.deletedAt)} ago` }),
  );
  kind(
    copies,
    (c) => `copies:${c.repo}`,
    // Its size in steps of a doubling: a copy more or one grown twice as big brings it back — never a size that was not
    // measured then, or is not now (`standsAs`).
    (c) => `${c.count}:${c.bytes == null ? SIZE_UNKNOWN : Math.floor(Math.log2(Number(c.bytes) + 1))}`,
    (c) => [`Filament's copies of ${c.repo}: ${c.count} on disk${c.bytes == null ? "" : `, ${c.partial ? "at least " : ""}${diskWords(Number(c.bytes))}`}`, ` — the person sees them, and lets go of those nothing needs, at ${where} (Clean up…)`],
    (left) => more(left.length, "repositories with Filament's copies"),
    (c) => {
      const size = c.bytes == null ? "" : `${c.partial ? "at least " : ""}${diskWords(Number(c.bytes))}`;
      return { group: "left", tone: "left", what: "copies", count: c.count, size, title: `Filament's copies of ${baseName(c.repo)}`, detail: [`${c.count} on disk`, ...(size ? [size] : [])].join(" · ") };
    },
  );
  kind(
    worktrees,
    (w) => `worktree:${w.path}`,
    (w) => w.head,
    (w) => [`worktree ${w.path}${w.branch ? ` (branch ${w.branch})` : ""}: merged into ${w.into}, nothing uncommitted${w.age != null ? `, its last commit ${agoWords(now - w.age)} ago` : ""}`, project ? ` — the person removes it at ${PLACES_ROAD} with its … › Remove worktree and branch…, or leaves it` : " — the person's to remove, or leave: a chat in no project has no Folders and worktrees… to remove it from"],
    (left) => more(left.length, "worktrees left over"),
    (w) => ({ group: "left", tone: "left", what: "worktree", title: baseName(w.path), detail: `Worktree merged into ${w.into}, nothing uncommitted` }),
  );
  kind(
    branches,
    (b) => `branch:${b.name}`,
    (b) => b.head,
    (b) => [`branch ${b.name}: merged into ${b.into} and checked out nowhere${b.age != null ? `, its last commit ${agoWords(now - b.age)} ago` : ""}`, " — nothing of it is lost if it goes; the person's to delete, or leave"],
    (left) => more(left.length, "branches left over"),
    (b) => ({ group: "left", tone: "left", what: "branch", title: b.name, detail: `Branch merged into ${b.into}, checked out nowhere` }),
  );
  kind(
    forks,
    (f) => `fork:${f.chain}`,
    (f) => String(f.head || ""),
    (f) => `fork ${f.path} of a deleted chat (${f.chain}): it stays${f.why ? ` — ${f.why} —` : ""} and what it holds is the person's to keep or remove${project ? `, at ${PLACES_ROAD}` : ""}`,
    (left) => more(left.length, "forks left over"),
    (f) => ({ group: "left", tone: "left", what: "fork", title: baseName(f.path), detail: "A deleted chat's fork" }),
  );
  return { lines, keys, plain, rows, all };
}

/**
 * The lines alone (`openList`).
 * @param {Parameters<typeof openList>[0]} o @returns {string[]}
 */
export const stillOpenLines = (o) => openList(o).lines;

/**
 * One sub-agent as the registry gives it (subagents.js `get`): its chat and status, and where its work waits, when its
 * newest exchange ended and its work's mark (`work.sig`: its base and head).
 * @typedef {{ chainId: string, status: string, endedAt?: number | null, team?: unknown, work?: { pending?: number, sig?: string } | null }} OpenSeen
 */
/**
 * The sub-agents' registry, as the list reads it (subagents.js `openWork`), and one sub-agent by its id (`get`).
 * @typedef {{ openWork?: (chainId: string, o?: { since?: number, workers?: boolean }) => OpenAgent[], get?: (id: string) => OpenSeen | null | undefined }} OpenRegistry
 */
/**
 * How a chat stands now for one of its agents (`openList`): for its main agent (`agent` null), every command of the
 * session's, its coding agent's own background tasks (`tasks`) and its sub-agents, as `registry` says them — those that
 * failed since `since`, and a team's workers unless `workers` is false —; for a sub-agent, its own commands. And the
 * letters that wait for its reply (`letters`). `theirs`: the coding agent's own tasks in another session, for its main
 * agent. `changes`, and what the folder holds (`more`), for its main agent: a worker's change that waits is said as one
 * (`worker`), never as a sub-agent's too, and not where `workers` is false. A sub-agent's change that waits says when its exchange ended, and the
 * folder's drift since it started (`more.drift`), by the registry's word on it.
 * @param {{ session: string, agent: string | null, registry?: OpenRegistry | null, tasks?: readonly OwnTask[], theirs?: TheirTasks | null, letters?: readonly OwedLetter[], since?: number, workers?: boolean,
 *   changes?: readonly OpenChange[], more?: OpenMore | null, dismissed?: Readonly<Record<string, string>>, now?: number }} o
 * @returns {OpenList}
 */
export const openOf = ({ session, agent, registry = null, tasks = [], theirs = null, letters = [], since = 0, workers = true, changes = [], more = null, dismissed = {}, now = Date.now() }) => {
  if (!session) return { lines: [], keys: [], plain: [], rows: [], all: [] };
  const main = agent === null;
  const drift = more?.drift || {};
  changes = changes.filter((c) => workers || c.kind !== "worker");
  const said = new Set(changes.map((c) => c.id));
  const agents = (main ? registry?.openWork?.(session, { since, workers }) || [] : [])
    .filter((a) => !(said.has(a.id) && !a.running && a.files > 0))
    .map((a) => {
      if (a.running) return a;
      const seen = registry?.get?.(a.id);
      if (a.files > 0) return { ...a, since: Number(seen?.endedAt) || null, drift: drift[a.id] ?? null, mark: String(seen?.work?.sig || a.files) };
      return seen?.endedAt ? { ...a, mark: String(seen.endedAt) } : a;
    });
  return openList({
    shells: runningShellsOf(session),
    agent,
    agents,
    tasks: main ? tasks : [],
    theirs: main ? theirs : null,
    letters,
    ...(main
      ? {
          changes: changes.map((c) => ({ ...c, drift: c.drift ?? drift[c.id] ?? null })),
          uncaptured: more?.uncaptured || [],
          deleted: more?.deleted || [],
          copies: more?.copies || [],
          worktrees: more?.worktrees || [],
          branches: more?.branches || [],
          forks: more?.forks || [],
          project: more?.project !== false,
        }
      : {}),
    dismissed: main ? dismissed : {},
    now,
  });
};

/**
 * The lines alone (`openOf`).
 * @param {Parameters<typeof openOf>[0]} o @returns {string[]}
 */
export const stillOpenOf = (o) => openOf(o).lines;

/**
 * One sub-agent of a chat as the registry lists it (subagents.js `list`), as much as the list reads of it.
 * @typedef {{ id: string, chainId?: string, status: string, origin?: string, aside?: boolean, description?: string, task?: string | null,
 *   team?: unknown, endedAt?: number | null, attempt?: { dropped?: string | null } | null, work?: { pending?: number, sig?: string } | null, rebaseDue?: boolean, remote?: unknown }} OpenSub
 */

/**
 * Whether a sub-agent's change waits for an apply, as the person's Changes says it (panes/changes-places.js, its copy's
 * block): it works no more, its work holds files, and no rebase it was sent to is due. The one test of a change that
 * waits (Fable52's of 11-10: Changes showed what Still open left out): each is Still open's — the registry's
 * (`openWork`) or a graph's and a team's (`changesOf`) — but the developer's own kept aside, one that started by itself,
 * an attempt another won, and one its graph task is at work on still (`atWorkOn`), which the graph beside the card shows.
 * @param {OpenSub} s
 */
export const waitsInChanges = (s) => s.status !== "running" && Number(s.work?.pending) > 0 && !s.rebaseDue;
/**
 * Whether a graph task is at work on its sub-agent's change still — it waits to start again, runs, is paused, checked,
 * reviewed, or merged now —: not one ready for its apply, dropped, failed or done, whose change no task works on.
 * @param {{ state: string, step?: string | null }} t
 */
const atWorkOn = (t) => ["waiting", "running", "paused", "checking", "review"].includes(t.state) || (t.state === "merging" && t.step !== "yours");

/**
 * A chat's graph tasks' and team workers' changes that wait (`OpenChange`), from its sub-agents (`subs`) and its task
 * graph (`meta.graph`): every one Changes shows waiting (`waitsInChanges`) whose task is at work on it no more — a task's
 * sub-agent's change ready for its apply (core/task-graph.js `yours`), or one whose task was dropped, failed or was done
 * since, an earlier try's at a task another sub-agent took since, an earlier graph's —, and a team's worker's that no
 * graph task holds. Not one that works now, nor an attempt another won, nor the developer's own kept aside.
 * @param {readonly OpenSub[]} subs
 * @param {{ startedAt?: number, tasks?: readonly { id: string, name?: string, state: string, step?: string | null, agent?: string | null, resume?: string | null }[] } | null} graph
 * @returns {OpenChange[]}
 */
export function changesOf(subs, graph) {
  const tasks = new Map((graph?.tasks || []).map((t) => [String(t.id), t]));
  /** @type {OpenChange[]} */
  const out = [];
  for (const s of subs) {
    if (!waitsInChanges(s) || s.attempt?.dropped || s.aside || s.origin === "self") continue;
    const files = Number(s.work?.pending);
    const base = { id: s.id, files, mark: String(s.work?.sig || files), since: Number(s.endedAt) || null };
    if (s.task) {
      const t = tasks.get(String(s.task));
      // A task of a graph since replaced (the owner's of 11-10: a dropped task's change, its graph closed by the next
      // checklist, waited in Changes while the card said nothing waits): no task of this graph holds it — its id gone, or
      // taken by one of this graph begun after the sub-agent ended — so the registry's list, which leaves a task's change
      // to its graph, and the graph both left it out.
      if (!t || (Number(graph?.startedAt) > 0 && Number(s.endedAt) > 0 && Number(s.endedAt) < Number(graph?.startedAt))) {
        out.push({ kind: "earlier", task: String(s.task), description: s.description || "", ...base });
        continue;
      }
      // A task another sub-agent took since — tried again —, or one whose id it reuses where the graph or the sub-agent
      // keeps no time to tell (Fable52's of 11-10): no task holds this change, which waits in Changes all the same.
      if (t.agent !== s.id && t.resume !== s.id) out.push({ kind: "try", task: t.id, description: s.description || "", ...base });
      else if (t.state === "dropped") out.push({ kind: "dropped", task: t.id, title: t.name || "", ...base });
      else if (t.state === "merging" && t.step === "yours") out.push({ kind: "graph", task: t.id, title: t.name || "", ...base });
      // A failed task's, or a done one's its merge left (Fable52's of 11-10): the graph says how its task ended, and no
      // word of the change that waits.
      else if (!atWorkOn(t)) out.push({ kind: "ended", task: t.id, title: t.name || "", state: t.state === "failed" ? "failed" : "done", ...base });
    } else if (s.team) out.push({ kind: "worker", description: s.description || "", ...base });
  }
  return out;
}

/**
 * What a repository holds of Filament's and left over, read once for every chat in it (server.js): the copies marked
 * unsaved (worktree.js `unsavedCopies`), a deleted chat's helpers' work on its refs (git-footprint.js
 * `deletedChatsWork`), its copies, the worktrees whose branch is merged with nothing uncommitted (places.js `heldBack`
 * with `branch`), a routine run's branch merged and checked out nowhere, and a deleted chat's forks that stay.
 * `unread`: the parts of it git would not read this time (`OpenMore`'s) — every part, where it read none of them.
 * @typedef {{ unsaved?: { agent: string, dest: string, error: string, at: number }[], deleted?: DeletedWork[], copies?: CopiesOnDisk[],
 *   worktrees?: LeftWorktree[], branches?: LeftBranch[], forks?: LeftFork[], unread?: FolderPart[] }} FolderHolds
 */
/** Every part of what a folder holds: what a read that failed whole could not read (`FolderHolds.unread`). */
export const FOLDER_PARTS = Object.freeze(/** @type {FolderPart[]} */ (["uncaptured", "deleted", "copies", "worktrees", "branches", "forks"]));

/** How many changes that wait have their folder's drift read, at most. */
const DRIFT_MOST = 24;

/**
 * What a chat's folder holds for its main agent's list (`OpenMore`): how many commits the folder has that each change
 * that waits did not start from (`drift`, by `count` of its base, the head of its mark), the captures of this chat's
 * sub-agents that failed — the registry's (`failed`) and the copies marked unsaved, by their agent — and the rest as the
 * repository holds it (`holds`), the chat's own folder left out of the worktrees left over, and those another chat
 * works in now (`working`, read as the list is: the holds are read seldom), as Folders and worktrees… offers them no removal.
 * What the repository's read could not read (`holds.unread`) is said with it, and a chat in no project so (`project`).
 * @param {{ chain: string, folder: string, subs: readonly OpenSub[], failed?: readonly (Uncaptured & { chainId?: string })[],
 *   holds?: FolderHolds | null, count?: ((base: string) => Promise<number | null>) | null, working?: ((paths: readonly string[]) => ReadonlySet<string>) | null, project?: boolean }} o
 * @returns {Promise<OpenMore>}
 */
export async function moreOf({ chain, folder, subs, failed = [], holds = null, count = null, working = null, project = true }) {
  const mine = new Set(subs.map((s) => s.id));
  /** @type {Record<string, number>} */
  const drift = {};
  if (count) {
    // One whose copy is on another machine waits from the commit sent there, which is on no branch of this folder's.
    const waiting = subs.filter((s) => waitsInChanges(s) && !s.remote && /^[0-9a-f]{7,}:/.test(String(s.work?.sig || ""))).slice(0, DRIFT_MOST);
    const counts = await Promise.all(waiting.map((s) => count(String(s.work?.sig).split(":")[0]).catch(() => null)));
    waiting.forEach((s, i) => {
      const n = counts[i];
      if (n != null && Number.isFinite(n)) drift[s.id] = n;
    });
  }
  /** @type {Map<string, Uncaptured>} */
  const uncaptured = new Map();
  for (const u of failed) if (u.chainId === chain || (!u.chainId && mine.has(u.id))) uncaptured.set(u.id, { id: u.id, error: u.error, dest: u.dest, at: u.at });
  for (const u of holds?.unsaved || []) if (mine.has(u.agent) && !uncaptured.has(u.agent)) uncaptured.set(u.agent, { id: u.agent, error: u.error, dest: u.dest, at: u.at });
  /** @param {string} p */
  const norm = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const here = norm(folder);
  const left = (holds?.worktrees || []).filter((w) => here !== norm(w.path) && !here.startsWith(`${norm(w.path)}/`));
  const busy = left.length && working ? working(left.map((w) => w.path)) : new Set();
  return {
    drift,
    uncaptured: [...uncaptured.values()],
    deleted: holds?.deleted || [],
    copies: (holds?.copies || []).filter((c) => c.count > 0),
    worktrees: left.filter((w) => !busy.has(w.path)),
    branches: holds?.branches || [],
    forks: holds?.forks || [],
    ...(holds?.unread?.length ? { unread: [...holds.unread] } : {}),
    ...(project === false ? { project: false } : {}),
  };
}

/** The block of a coding agent's prompt that says what is still open (agent-context.js's blocks): a turn's first. */
export const OPEN_BLOCK = "open";

/**
 * Why the list is said again: the agent compacted its context just now (`compacted`), or earlier with nothing said
 * after it (`lost`); Filament folded the chat's turns earlier (`folded`, a fold-method compaction, which
 * brings nothing back after it); a sub-agent's change it was told waits for it was applied or dropped since
 * (`changed`); or one still waits, and WAITS_AGAIN turns went by without a word of it (`waits`); or an answer of the
 * agent's last turn named a part of what else is open and counted the rest, which it says the turn's start names (`more`);
 * or a change waited WAITS_LONG_MS in the running turn with nothing said of it, said at the agent's next call (`long`).
 * @typedef {"compacted" | "lost" | "folded" | "changed" | "waits" | "more" | "long"} OpenWhy
 */
/**
 * How every block Filament writes with the list opens — the list said again (`openWords`), what comes back after a
 * summary or the agent's own compaction, and what a switch hands over (sessions/reattach.js `reattachBlock`).
 */
const FILAMENT_LEAD = "[Filament";
/** The words that ask for a dismiss with Filament's envelope tool (`goThrough`). */
export const DISMISS_WORDS = ", and dismiss a line that no longer holds with Filament's envelope tool (dismiss: the ids in brackets), which Filament then stops saying";
/**
 * What the agent is asked to do with the list, after every compaction (the owner's of 11-09): go through it. `what`:
 * how it is named; `dismiss`: whether it has Filament's envelope tool, whose dismiss takes the ids in brackets.
 * @param {string} what @param {boolean} [dismiss]
 */
export const goThrough = (what, dismiss = true) => `Go through ${what} now: apply a change that waits or leave it, follow up a sub-agent or leave it${dismiss ? DISMISS_WORDS : ""}.`;
/**
 * `text` as a reader is told it: the dismiss words only where it has Filament's envelope tool (`dismiss`). A block kept
 * with its compaction, or handed over at a switch, was written before its reader was known: one without the tool —
 * a coding agent that neither leads a team nor launches Filament's sub-agents — reads it without them (c-dupes, 11-10).
 * It knows today's words alone: a block kept before them, in other words, keeps its ask for such a reader, which cannot
 * act on it — harmless, and no promise that no reader without the tool ever reads one.
 * Only a block Filament wrote loses them, and only from its lead: a text that opens as each of them does
 * (`FILAMENT_LEAD`), up to its first line's end, where the ask stands. The same words anywhere else are someone's own —
 * the person's message, the agent's reply, a file or a reply a block brought back — and stay as they are.
 * @param {string} text @param {boolean} dismiss
 */
export const withDismiss = (text, dismiss) => {
  if (dismiss || !text.startsWith(FILAMENT_LEAD)) return text;
  const end = text.indexOf("\n");
  const lead = end < 0 ? text : text.slice(0, end);
  return lead.includes(DISMISS_WORDS) ? `${lead.split(DISMISS_WORDS).join("")}${end < 0 ? "" : text.slice(end)}` : text;
};
/**
 * A request's messages as a reader is told them (`withDismiss`): the same body where nothing changes. Each message's
 * words whole, and each of its text blocks: a block of Filament's is one of them, never a part of another's words.
 * @template {{ messages?: any }} B @param {B} body @param {boolean} dismiss @returns {B}
 */
export function bodyWithDismiss(body, dismiss) {
  if (dismiss || !Array.isArray(body?.messages)) return body;
  /** A message as the reader is told it: the same object where none of its words change. @param {any} m */
  const told = (m) => {
    if (typeof m?.content === "string") {
      const text = withDismiss(m.content, false);
      return text === m.content ? m : { ...m, content: text };
    }
    if (!Array.isArray(m?.content)) return m;
    const content = m.content.map((/** @type {any} */ b) => {
      if (b?.type !== "text" || typeof b.text !== "string") return b;
      const text = withDismiss(b.text, false);
      return text === b.text ? b : { ...b, text };
    });
    return content.every((b, i) => b === m.content[i]) ? m : { ...m, content };
  };
  const messages = body.messages.map(told);
  return messages.every((m, i) => m === body.messages[i]) ? body : { ...body, messages };
}
/**
 * What a summary may have left out of the agent's own turns, said after its compaction (the owner's of 11-08: past one,
 * the agent could not find what an earlier turn said was left): recall's list of the chat's turns.
 */
export const RECALL_AFTER = "[Filament: filament_recall with no arguments lists this chat's turns, newest first, with how each answer ended.]";
/**
 * The list said again, in the words of why: the lines in `<open>`, as the block after a summary has them, and after a
 * compaction recall's list of the turns (`RECALL_AFTER`). Where none is open now: after a change, that nothing is; after
 * a compaction, the compaction and recall's list alone, in words true of an agent the chat moved to since, which starts
 * from that summary too (the review of 11-08). Recall's list only where the session has Filament's tools (`recall`): an
 * agent that takes no MCP server of Filament's has no filament_recall to call, and with nothing open nothing is said to
 * it ("") — the owner's of 11-08.
 * @param {readonly string[]} lines @param {OpenWhy} why @param {boolean} [recall] @param {boolean} [dismiss]  whether
 *   its session has Filament's envelope tool, whose dismiss the reminder names (`goThrough`): as `recall` unless told
 */
export function openWords(lines, why, recall = true, dismiss = recall) {
  const changed = "A sub-agent's change you were told waits for you to apply it was applied or dropped since.";
  if (!lines.length)
    return why === "changed" ? `[Filament: ${changed} Nothing else is still open now.]` : why === "waits" || why === "more" || why === "long" ? "" : recall ? `[Filament: This chat's context was compacted ${why === "compacted" ? "just now" : "earlier"}.]\n${RECALL_AFTER}` : "";
  const lead =
    why === "compacted"
      ? "You compacted your context just now, and its summary may have left out what is still open."
      : why === "lost"
        ? "You compacted your context earlier, and its summary may have left out what is still open."
        : why === "folded"
          ? "This chat's context was compacted earlier, and what is still open may have gone with it."
          : why === "waits"
            ? `A sub-agent's change still waits for you to apply it, and nothing said so for ${WAITS_AGAIN} turns.`
            : why === "long"
              ? `A sub-agent's change still waits for you to apply it, and nothing said so for ${tookWords(WAITS_LONG_MS)}.`
              : why === "more"
                ? "Your answers in your last turn named a part of what else is still open, and counted the rest: here it is whole."
                : changed;
  // Every compaction asks the agent to go through the list; so does a change said again for waiting, and the rest of it.
  const through = why === "changed" ? "" : ` ${goThrough("it", dismiss)}`;
  const after = why === "changed" || why === "waits" || why === "long" || why === "more" || !recall ? "" : `\n${RECALL_AFTER}`;
  return `[Filament: ${lead}${through} As it stands now — read a command's output or stop it by its id rather than starting it again:]\n<open>\n${lines.join("\n")}\n</open>${after}`;
}

/**
 * What the chat keeps of what its main agent heard of the list (`openHeard` in its meta): the keys as they stood when it
 * was told, and since, at each end of a turn it took in — or `lost`, its own compaction nothing was said after, or a
 * fold of Filament's (`fold`), which brings nothing back after it. None where it was never told, or nothing it was told
 * is open any more. Its keys leave out a team's workers, whom a lead hears in its team's words, and its agent's own
 * tasks, which its agent tells it of. `whose`: the sub-agent of each key a task of the graph names (`leftByGraph`),
 * which the key does not say — asked, once the key went, whether its change did.
 * @typedef {{ keys: string[], whose?: Record<string, string> } | { lost: true, fold?: true }} OpenHeard
 */

/**
 * A change a task of the graph left behind, by its key: its task dropped, failed or done, its sub-agent's change still
 * in its copy. The graph says how the task ended and no word of the change, so the list is all that says it — unlike
 * one ready for its apply (`graph:<task>:waits`), which the graph's own words name at every call. @param {string} key
 */
const leftByGraph = (key) => /^graph:.+:(dropped|failed|done)$/.test(key);
/**
 * A key whose going the agent hears of by nothing else: a sub-agent's change that waited for it, applied or dropped by
 * someone else — one a task of the graph left behind too (`leftByGraph`). A command's end is told to it, a sub-agent's
 * report comes to it, and one that runs and one that asks are the same sub-agent at work. A graph task's change ready
 * for its apply and a worker's are the graph's and the team's to say, and what the folder holds is said when a block
 * is: none of them forces a turn's start to say the list. @param {string} key
 */
const unheardOnItsOwn = (key) => (key.startsWith("agent:") && key.endsWith(":waits")) || leftByGraph(key);
/**
 * A sub-agent's change that waited (`unheardOnItsOwn`) and went — not one whose sub-agent works on it again, followed
 * up, whose report says how it ends. @param {Set<string>} all  every key now @param {string} key
 */
const wentFrom = (all, key) => !all.has(key) && !all.has(key.replace(/:waits$/, ":working")) && !all.has(key.replace(/:waits$/, ":asks"));
/**
 * The other name of one of the coding agent's own background tasks: `task:<id>` as the session that runs it is told
 * it, `theirs:<id>` as every other reader is — the loop, another session of the agent's, the Plan's card. "" for a key
 * of anything else. @param {string} key
 */
const twinOf = (key) => (key.startsWith("task:") ? `theirs:${key.slice(5)}` : key.startsWith("theirs:") ? `task:${key.slice(7)}` : "");
/**
 * The part of the folder's reads a key comes of (`ofTheFolder`): null for a key of anything else.
 * @param {string} key @returns {FolderPart | null}
 */
const partOf = (key) => {
  const kind = /^(deleted|copies|worktree|branch|fork):/.exec(key)?.[1];
  return kind ? /** @type {FolderPart} */ (kind === "worktree" ? "worktrees" : kind === "branch" ? "branches" : kind === "fork" ? "forks" : kind) : /^agent:.+:uncaptured$/.test(key) ? "uncaptured" : null;
};
/** A key that comes of the folder's reads (`OpenMore`): known only once they are in. @param {string} key */
const ofTheFolder = (key) => /^(deleted|copies|worktree|branch|fork):/.test(key) || /^agent:.+:uncaptured$/.test(key);
/** The most chats whose folder reads are kept at once. */
const MORE_CHATS = 200;
/** How many things a done's "Also still open" names (11-10), the rest counted: a list in an answer's tail (`TAIL_MOST`). */
export const ALSO_MOST = TAIL_MOST;

/**
 * What a done's "Also still open" weighs (`alsoOpenWords`): each thing waiting or running the agent has not dismissed —
 * not a task's change of its graph that is ready for its apply, nor a sub-agent at work on one of its tasks (`skip`),
 * which the graph's own words say, nor what the folder holds for the person —, what waits on the agent first (a change
 * to apply, a letter, a question, a failure), what goes on by itself last (FabeleHelper's of 11-10). A change a task
 * left behind (`leftByGraph`) is weighed though its sub-agent is the graph's own: the graph says how that task ended,
 * and nothing of the change that still waits (the re-read of 11-11: it was said after a compaction alone).
 * @param {readonly OpenRow[]} rows @param {ReadonlySet<string>} [skip]
 */
export function alsoRows(rows, skip = new Set()) {
  const live = rows.filter((r) => !r.dismissed && r.view.group !== "left" && (leftByGraph(r.key) || (!r.key.startsWith("graph:") && !(r.view.agent && skip.has(r.view.agent)))));
  return [...live.filter((r) => r.view.group === "waiting"), ...live.filter((r) => r.view.group !== "waiting")];
}

/**
 * What else is open beside the graph, as a done or a tick says it (the owner's of 11-10: an agent that drifted in a long
 * context hears only its tools' answers until a compaction comes, and none may come): `alsoRows`, each line up to its
 * instructions, which Still open gives whole — the first `ALSO_MOST`, the rest counted. What an answer of this turn said
 * already (`said`, by key) is counted, not said again, and where nothing came since, nothing is said (FabeleHelper's of
 * 11-10). "" where nothing is.
 * @param {readonly OpenRow[]} rows @param {{ skip?: ReadonlySet<string>, said?: ReadonlySet<string> }} [o]
 */
export function alsoOpenWords(rows, o = {}) {
  return alsoOpenSaid(rows, o).text;
}

/**
 * `alsoOpenWords`, with the keys it named (`named`) and those it counted alone (`rest`): what it promises the next turn's
 * start names whole (`createStillOpen`'s `also`; FabeleHelper's of 11-10 on 98d0c37a5).
 * @param {readonly OpenRow[]} rows @param {{ skip?: ReadonlySet<string>, said?: ReadonlySet<string> }} [o]
 * @returns {{ text: string, named: string[], rest: string[] }}
 */
function alsoOpenSaid(rows, { skip = new Set(), said = new Set() } = {}) {
  const live = alsoRows(rows, skip);
  const fresh = live.filter((r) => !said.has(r.key));
  if (!fresh.length) return { text: "", named: [], rest: [] };
  const before = live.length - fresh.length;
  const shown = fresh.slice(0, ALSO_MOST);
  const named = shown.map((r) => `${oneLine(r.short, 160)}${before ? " (new)" : ""}`);
  const rest = fresh.slice(ALSO_MOST);
  return {
    text: `Also still open, beside your graph: ${named.join("; ")}${rest.length ? `; and ${rest.length} more, which Still open names at your next turn's start` : ""}${before ? `; ${before} as said before` : ""}.`,
    named: shown.map((r) => r.key),
    rest: rest.map((r) => r.key),
  };
}

/**
 * A chat's main agent's list, as it stands and as it heard it. `registry`: the sub-agents' registry (`openWork`);
 * `archive`: where the chat's meta and its compactions are, read at each call — null where memory keeps none, and then
 * nothing is kept of what was heard; `tasks`: the chat's coding agent's own tasks running now in `agentSession`, its
 * session's — none where they run in another; `theirs`: those that run in a session other than `agentSession` (none
 * given: the loop, or the copy's reader), and whose. `changes`: a chat's graph tasks' and team workers' changes that wait
 * (server.js, from the registry and the graph); `more`: what its folder holds (`OpenMore`), read by `refresh` and kept
 * `MORE_KEPT_MS`.
 * @param {{ registry?: OpenRegistry | null,
 *   archive?: () => { metaOf: (chainId: string, keys: readonly string[]) => Record<string, any> | null, mergeMeta: (chainId: string, patch: Record<string, any>) => any, getCompactions: (chainId: string) => any[], getChain?: (chainId: string) => any } | null,
 *   tasks?: (chainId: string, agentSession: string) => readonly OwnTask[], theirs?: (chainId: string, agentSession: string | null) => TheirTasks | null,
 *   changes?: (chainId: string) => readonly OpenChange[], more?: ((chainId: string) => Promise<OpenMore | null>) | null, now?: () => number }} o
 */
export function createStillOpen({ registry = null, archive = () => null, tasks = () => [], theirs = () => null, changes = () => [], more = null, now = Date.now }) {
  /**
   * The chat's newest summary an agent's session reads, when it was written: a sub-agent that failed before it is in
   * it. Not one written for Filament's copy alone (compactor.js `copy`), which no agent reads until a fresh session
   * starts from it. @param {string} chain
   */
  const since = (chain) => Number(archive()?.getCompactions(chain).filter((c) => !c.detail?.copy).at(-1)?.created_at) || 0;
  /** @param {string} chain @returns {OpenHeard | null} */
  const heardOf = (chain) => {
    const h = archive()?.metaOf(chain, ["openHeard"])?.openHeard;
    if (h?.lost === true) return h.fold === true ? { lost: true, fold: true } : { lost: true };
    if (!Array.isArray(h?.keys)) return null;
    const whose = h.whose && typeof h.whose === "object" ? Object.fromEntries(Object.entries(h.whose).map(([k, v]) => [k, String(v)])) : null;
    return { keys: h.keys.map(String), ...(whose ? { whose } : {}) };
  };
  /**
   * The chat keeps what its main agent heard: the keys, each a task of the graph left behind with the sub-agent whose
   * change it names as the list stands (`whose`) — the same as kept before where the list names it no more.
   * @param {string} chain @param {OpenHeard | null} h
   */
  const keep = (chain, h) => {
    if (h && "keys" in h && h.keys.some(leftByGraph)) {
      const had = heardOf(chain);
      const before = had && "keys" in had ? had.whose || {} : {};
      const now = new Map(followed(chain).rows.map((r) => [r.key, r.view.agent]));
      const whose = Object.fromEntries(h.keys.filter(leftByGraph).flatMap((k) => (now.get(k) || before[k] ? [[k, String(now.get(k) || before[k])]] : [])));
      h = Object.keys(whose).length ? { keys: h.keys, whose } : { keys: h.keys };
    }
    archive()?.mergeMeta(chain, { openHeard: h ?? undefined });
  };
  /** What the agent dismissed, each key with its mark then (`openDismissed`). @param {string} chain @returns {Record<string, string>} */
  const dismissedOf = (chain) => {
    const d = chain ? archive()?.metaOf(chain, ["openDismissed"])?.openDismissed : null;
    return d && typeof d === "object" ? Object.fromEntries(Object.entries(d).map(([k, v]) => [k, String(v)])) : {};
  };
  /** @param {string} chain @param {Record<string, string>} d */
  const keepDismissed = (chain, d) => void archive()?.mergeMeta(chain, { openDismissed: Object.keys(d).length ? d : undefined });
  /**
   * What an answer of the turn counted of what else is open and never named (`openMore`): the next turn's start says the
   * list whole (`due`, "more"), as those words promise. @param {string} chain @returns {string[]}
   */
  const moreOf = (chain) => {
    const m = chain ? archive()?.metaOf(chain, ["openMore"])?.openMore : null;
    return Array.isArray(m) ? m.map(String) : [];
  };
  /** @param {string} chain @param {readonly string[]} keys */
  const keepMore = (chain, keys) => {
    const had = moreOf(chain);
    if (had.length !== keys.length || had.some((k, i) => k !== keys[i])) archive()?.mergeMeta(chain, { openMore: keys.length ? [...keys] : undefined });
  };
  /**
   * What the running turn's answers counted (`also`): a turn's end that said the list at its start lets go of what was
   * owed from before it, never what its own answers promised the next start. @type {Map<string, Set<string>>}
   */
  const countedNow = new Map();
  /**
   * The running turn of each chat's main agent, as a long wait weighs it (`waited`): when the list was last said whole in
   * it — its start (`begin`), or since (`heard`) —, when the turn last named each thing (a done's "Also still open";
   * `from`), and the changes a long wait's list named (`said`), none of them said again for waiting in the turn. And
   * what the list said at its start named (`start`, `startSaid`), which its answers say no more (`also`). Only running
   * turns are here: a turn's end takes its own away (`over`), and none goes for the many that began since.
   * @type {Map<string, { at: number, from: Map<string, number>, said: Set<string>, start: Set<string> }>}
   */
  const turns = new Map();
  /** How many turns each sub-agent's change that waits went unsaid (`openUnsaid`). @param {string} chain @returns {Record<string, number>} */
  const unsaidOf = (chain) => {
    const u = chain ? archive()?.metaOf(chain, ["openUnsaid"])?.openUnsaid : null;
    return u && typeof u === "object" ? Object.fromEntries(Object.entries(u).map(([k, v]) => [k, Number(v) || 0])) : {};
  };
  /**
   * The folder's reads of each chat, as `refresh` last had them, and those under way — each with how many times what the
   * folders hold had moved (`moved`) when it began: one begun before the newest is stale.
   * @type {Map<string, { at: number, more: OpenMore, moves: number }>}
   */
  const kept = new Map();
  /** @type {Map<string, { p: Promise<void>, moves: number }>} */
  const reading = new Map();
  let moves = 0;
  /**
   * The letters on the chat's record that wait for one agent's reply (letters.js `asks`): the main agent's (`agent`
   * null), those no sub-agent was written (`for`); a sub-agent's, those written to it. Who wrote each, in words. Only
   * those a reply reaches, as letters.js `answer` sends one: a sub-agent that wrote while it runs, a chat that is there.
   * @param {string} chain @param {string | null} agent @returns {OwedLetter[]}
   */
  const owedOf = (chain, agent) => {
    const a = archive();
    const asks = a?.metaOf(chain, ["letters"])?.letters?.asks;
    if (!asks || typeof asks !== "object") return [];
    const mine = agent === null ? null : agent.replace(/^subagent:/, "");
    /** @param {any} x */
    const reached = (x) => {
      if (x.by) {
        const sa = registry?.get?.(String(x.by));
        return !registry?.get || (!!sa && sa.chainId === chain && sa.status === "running");
      }
      return x.from === chain || !a?.getChain || !!a.getChain(String(x.from));
    };
    return Object.entries(asks)
      .filter(([, x]) => x && (mine === null ? !x.for : x.for === mine) && reached(x))
      .map(([id, x]) => {
        const title = String(a?.getChain?.(String(x.from))?.title || "untitled");
        const task = x.by ? oneLine(String(/** @type {any} */ (registry?.get?.(String(x.by)))?.description || ""), 60) : "";
        return {
          id,
          subject: String(x.subject || ""),
          from: x.by ? `your sub-agent ${x.by}` : x.from === chain ? "the main agent" : `the chat "${title}" (${x.from})`,
          at: Number(x.at) || 0,
          who: x.by ? (task ? `the sub-agent “${task}”` : "one of this chat's sub-agents") : x.from === chain ? "this chat's agent" : `the chat “${title}”`,
        };
      });
  };
  /**
   * How the chat stands now for one of its agents: its main agent's (`agent` null) whole list — without its team's
   * workers where `workers` is false: a lead hears them in its team's words; with its coding agent's own background
   * tasks where `agentSession`, the session being told, runs them, and with `others` those another session runs (the
   * agent the chat moved off, or one of its sessions before) —, a sub-agent's (`subagent:<id>`) own commands. What the
   * agent dismissed and still stands so is left out.
   * @param {string} chain @param {string | null} [agent] @param {{ workers?: boolean, agentSession?: string | null, others?: boolean }} [o]
   */
  const of = (chain, agent = null, { workers = true, agentSession = null, others = false } = {}) =>
    openOf({
      session: chain,
      agent,
      registry,
      tasks: agent === null && chain && agentSession ? (tasks(chain, agentSession) || []).filter((t) => t.background !== false) : [],
      theirs: agent === null && chain && others ? theirs(chain, agentSession) : null,
      letters: chain ? owedOf(chain, agent) : [],
      since: agent === null && chain ? since(chain) : 0,
      workers,
      changes: agent === null && chain ? changes(chain) || [] : [],
      more: agent === null && chain ? kept.get(chain)?.more || null : null,
      dismissed: agent === null && chain ? dismissedOf(chain) : {},
      now: now(),
    });
  /** The main agent's list as the chat keeps what it heard: without its team's workers or its agent's own tasks. @param {string} chain */
  const followed = (chain) => of(chain, null, { workers: false });
  /**
   * What was dismissed and no longer stands as it was — gone, or changed since and so listed again — is let go. One the
   * folder's reads say, only once they are in, and only where its part of them was read: a read git refused or failed
   * lists nothing of that part, which is no word that the thing went (the re-read of 11-11: a dismissed line came back
   * after every read that failed). The coding agent's own tasks are read as another reader hears them (`twinOf`): one
   * dismissed stands under both its names while it runs. A mark that stands keeps what it knows now — the size of
   * Filament's copies, once measured (`standsAs`).
   * @param {string} chain
   */
  const prune = (chain) => {
    const d = dismissedOf(chain);
    if (!Object.keys(d).length) return;
    const stands = new Map(of(chain, null, { others: true }).rows.filter((r) => r.dismissed).map((r) => [r.key, r.mark]));
    const read = kept.get(chain)?.more;
    /** Whether the folder's reads say nothing of a key's part. @param {string} k */
    const unread = (k) => {
      const part = partOf(k);
      return !!part && (!read || !!read.unread?.includes(part));
    };
    /** A mark as it is kept on: of Filament's copies that stand, with their size once it is measured. @param {string} k @param {string} m */
    const markNow = (k, m) => {
      const now = k.startsWith("copies:") ? stands.get(k) : null;
      return now && !now.endsWith(`:${SIZE_UNKNOWN}`) ? now : m;
    };
    const left = Object.fromEntries(
      Object.entries(d)
        .filter(([k]) => stands.has(k) || stands.has(twinOf(k)) || unread(k))
        .map(([k, m]) => [k, markNow(k, m)]),
    );
    if (Object.keys(left).length !== Object.keys(d).length || Object.entries(left).some(([k, m]) => d[k] !== m)) keepDismissed(chain, left);
  };
  /**
   * A turn ended, or the list was said (`told`): each sub-agent's change that waits counts one more turn unsaid, or none
   * where the list was said; one seen first counts none, as its report said it.
   * @param {string} chain @param {readonly string[]} keys @param {boolean} told
   */
  const counted = (chain, keys, told) => {
    const had = unsaidOf(chain);
    /** @type {Record<string, number>} */
    const next = {};
    for (const k of keys) if (unheardOnItsOwn(k)) next[k] = told || !Object.hasOwn(had, k) ? 0 : had[k] + 1;
    const same = Object.keys(next).length === Object.keys(had).length && Object.entries(next).every(([k, v]) => had[k] === v);
    if (!same) archive()?.mergeMeta(chain, { openUnsaid: Object.keys(next).length ? next : undefined });
  };
  /**
   * The folder's reads for a chat, kept `MORE_KEPT_MS` — or until what the folders hold moves (`moved`): read again once
   * older, one read at a time; one under way when it moved is followed by another. `within`: how long the caller waits
   * for them — past it, the list goes with what it has, and the read lands for the next. A read that failed leaves the
   * reads kept before it; where none were, it is kept as a read of nothing, every part unread — the chat's first read
   * is over (`reading`), and no dismissal goes for it (`prune`).
   * @param {string} chain @param {{ within?: number }} [o] @returns {Promise<void>}
   */
  const refresh = (chain, { within = 0 } = {}) => {
    const had = kept.get(chain);
    if (!more || !chain || (had && had.moves === moves && now() - had.at < MORE_KEPT_MS)) return Promise.resolve();
    let r = reading.get(chain);
    if (!r || r.moves !== moves) {
      const read = more;
      const began = moves;
      /** @type {{ p: Promise<void>, moves: number }} */
      const entry = { p: Promise.resolve(), moves: began };
      /** @param {OpenMore} m */
      const landed = (m) => {
        kept.delete(chain);
        kept.set(chain, { at: now(), more: m, moves: began });
        if (kept.size > MORE_CHATS) kept.delete(/** @type {string} */ (kept.keys().next().value));
      };
      entry.p = (r ? r.p : Promise.resolve())
        .then(() => read(chain))
        .then(
          (m) => landed(m || {}),
          () => void (kept.has(chain) || landed({ unread: [...FOLDER_PARTS] })),
        )
        .finally(() => {
          if (reading.get(chain) === entry) reading.delete(chain);
        });
      reading.set(chain, entry);
      r = entry;
    }
    const p = r.p;
    if (!(within > 0)) return p;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let t;
    return Promise.race([p, new Promise((r) => (t = setTimeout(r, within)))]).finally(() => clearTimeout(t)).then(() => {});
  };
  /**
   * Whether the change a task of the graph left behind went, once the list names its key no more: its sub-agent — the
   * one the chat kept with the key (`OpenHeard.whose`) — neither works nor has work that waits. The key alone goes for
   * less: its task sent back to it or tried again by another, a graph begun anew — and its change waits on, under
   * another line or the graph's own. Not where the chat kept no sub-agent for the key, or no registry can say: nothing
   * is known of it, and nothing is said.
   * @param {string | undefined} who
   */
  const changeWent = (who) => {
    if (!who || !registry?.get) return false;
    const s = registry.get(who);
    return !s || (s.status !== "running" && !(Number(s.work?.pending) > 0));
  };
  /**
   * At a turn's start: the list to say with its first message — where its agent compacted with nothing said after (with
   * nothing open, the compaction and recall's list of the turns), where Filament folded its turns since with something
   * open, where a change it was told waits for it went since (`unheardOnItsOwn`), or where one still waits, unsaid for
   * WAITS_AGAIN turns, or where an answer of its last turn counted what it never named (`openMore`, "more") — with its
   * keys. Null where nothing is to say. The list leaves out a team's workers and the agent's
   * own tasks. `recall`: whether the session has Filament's tools, recall's among them (`openWords`); where it has none
   * and nothing is open, nothing is to say, and the compaction stays unheard. `dismiss`: whether it has Filament's
   * envelope tool (`openWords`), as `recall` unless told.
   * @param {string} chain @param {{ recall?: boolean, dismiss?: boolean }} [o]
   * @returns {{ text: string, keys: string[], why: "lost" | "folded" | "changed" | "waits" | "more" } | null}
   */
  const due = (chain, { recall = true, dismiss = recall } = {}) => {
    if (!chain) return null;
    const h = heardOf(chain);
    const n = followed(chain);
    if (h && "lost" in h) {
      const why = h.fold ? "folded" : "lost";
      const text = h.fold && !n.lines.length ? "" : openWords(n.lines, why, recall, dismiss);
      return text ? { text, keys: n.keys, why } : null;
    }
    const all = new Set(n.all);
    /** Whether a change the agent heard waits went since. @param {string} k */
    const went = (k) => (leftByGraph(k) ? !all.has(k) && changeWent(h?.whose?.[k]) : wentFrom(all, k));
    if (h && h.keys.some((k) => unheardOnItsOwn(k) && went(k))) return { text: openWords(n.lines, "changed", recall, dismiss), keys: n.keys, why: "changed" };
    const unsaid = unsaidOf(chain);
    const stale = n.keys.some((k) => unheardOnItsOwn(k) && (unsaid[k] ?? 0) >= WAITS_AGAIN);
    if (stale) return { text: openWords(n.lines, "waits", recall, dismiss), keys: n.keys, why: "waits" };
    const listed = new Set(n.keys);
    return moreOf(chain).some((k) => listed.has(k)) ? { text: openWords(n.lines, "more", recall, dismiss), keys: n.keys, why: "more" } : null;
  };
  /**
   * The main agent heard the list whole as these keys stand: kept — none where nothing was open —, unless `kept` is
   * false (`waitedHeard`); each change that waits said, nothing an answer counted owed any more, and its running turn
   * weighs a long wait from now. @param {string} chain @param {readonly string[]} keys @param {boolean} [kept]
   */
  const heardWhole = (chain, keys, kept = true) => {
    if (kept) keep(chain, keys.length ? { keys: [...keys] } : null);
    counted(chain, keys, true);
    // The list whole: nothing an answer counted is owed any more.
    keepMore(chain, []);
    countedNow.delete(chain);
    const t = turns.get(chain);
    if (t) t.at = now();
  };
  return {
    of,
    refresh,
    /**
     * The lines alone, for the block after a summary and a switch's handover. With `others`, the coding agent's own tasks
     * too, named whose they are: for a handover alone, read as it is made by a session that runs none of them — never a
     * block kept with a summary's row, read again at every later request, where a task its session let go would still
     * "run on there" (the review of cb2d2d1f0). @param {string} chain @param {{ others?: boolean }} [o]
     */
    lines: (chain, { others = false } = {}) => of(chain, null, { others }).lines,
    /**
     * The list as the Plan's card shows it (the owner's of 11-05): its lines — the agent's list, a dismissed one left out,
     * without the ids the agent dismisses by —, and whether the main agent was told it since it compacted its own context
     * — false where it compacted and nothing said the list after, which its next message says. `items`: every thing open,
     * a dismissed one too, marked, with its key — its line in the card's words, "who: what", no id —, for the card to
     * draw a dismissed one dimmed with an Undo (the owner's of 11-09), each with its `view`, which the card draws (the
     * owner's of 11-10). Asks for the folder's reads where they are old, for the card's next look. `folded`: where
     * the list is untold, it was Filament's fold that left it so, not a compaction of the agent's own. The coding
     * agent's own background tasks are among them, as a reader that runs none of them hears them — whose session they
     * run in (the re-read of 11-11: the card showed none).
     * @param {string} chain @returns {{ lines: string[], told: boolean, folded?: true, items: { key: string, line: string, dismissed: boolean, view: OpenView }[] }}
     */
    shown: (chain) => {
      const h = chain ? heardOf(chain) : null;
      void refresh(chain);
      const o = of(chain, null, { others: true });
      const lost = !!h && "lost" in h;
      const folded = !!h && "lost" in h && h.fold === true;
      return { lines: o.plain, told: !lost, ...(folded ? { folded: /** @type {const} */ (true) } : {}), items: o.rows.map((r) => ({ key: r.key, line: r.text, dismissed: !!r.dismissed, view: r.view })) };
    },
    /** The keys the chat keeps of what its main agent heard (`OpenHeard`). @param {string} chain */
    keys: (chain) => followed(chain).keys,
    /**
     * What else is open beside the graph, for a done's answer (`alsoOpenWords`): the main agent's list as it follows it.
     * `said`: what the answers of the turn said already, by key — what this one names is added to it. What it counts and
     * never names the chat keeps (`openMore`), so the next turn's start says the list whole, as its words promise —
     * until a later answer names it (FabeleHelper's of 11-10 on 98d0c37a5). What it names, its running turn weighs a
     * long wait of from now (`waited`). What the list said at the turn's start named (`startSaid`) is said already, as
     * an answer's is (the re-read of 11-11: the turn whose start said the list whole counted its rest again at its
     * first done, and so owed the next start the whole list, turn after turn).
     * @param {string} chain @param {ReadonlySet<string>} [skip]  the graph's own sub-agents @param {Set<string>} [said]
     */
    also: (chain, skip, said = new Set()) => {
      const rows = followed(chain).rows;
      const t = turns.get(chain);
      if (t) for (const k of t.start) said.add(k);
      const r = alsoOpenSaid(rows, { skip, said });
      for (const k of r.named) said.add(k);
      if (t) for (const k of r.named) t.from.set(k, now());
      const named = new Set(r.named);
      if (r.named.length || r.rest.length) keepMore(chain, [...new Set([...moreOf(chain).filter((k) => !named.has(k)), ...r.rest])]);
      if (r.rest.length) {
        const now = countedNow.get(chain) || new Set();
        for (const k of r.rest) now.add(k);
        countedNow.set(chain, now);
      }
      return r.text;
    },
    /**
     * What the folders hold moved on the person's click — a worktree removed or put back, Filament's copies cleaned up
     * (the reviewer's of 11-10) —: every chat's reads are stale, read again at the next look.
     */
    moved: () => void moves++,
    /** Whether the chat's reads are from before what the folders hold last moved. @param {string} chain */
    stale: (chain) => {
      const had = kept.get(chain);
      return !!had && had.moves !== moves;
    },
    /**
     * Whether the chat's folder was never read: its first read is on its way, asked for by the look that found none
     * (`shown`), and the list has none of its rows yet (the re-read of 11-11: the first look after a start said nothing
     * of them, nor that they were being read, and the card said nothing was left behind for half a minute). False
     * where no reads are wired, and once a read landed or failed. @param {string} chain
     */
    reading: (chain) => !!more && !!chain && !kept.has(chain),
    /**
     * The main agent heard the list as these keys stand — in its fold, at its next step after its own compaction —:
     * kept, none where nothing was open. @param {string} chain @param {readonly string[]} keys
     */
    heard: (chain, keys) => heardWhole(chain, keys),
    /** The main agent compacted its own context, and nothing has said the list since. @param {string} chain */
    lost: (chain) => keep(chain, { lost: true }),
    /**
     * A summary of the chat landed with the list as it stands now in the block after it: the main agent hears that, as
     * every later request carries it. @param {string} chain
     */
    told: (chain) => {
      const k = followed(chain).keys;
      keep(chain, k.length ? { keys: k } : null);
      counted(chain, k, true);
      prune(chain);
      keepMore(chain, []);
      countedNow.delete(chain);
    },
    /**
     * The main agent compacted its own session outside a turn, which nothing told the list after (the agent's own way,
     * HarnessV3-ACP AC5-5): its next turn's first prompt says it — with nothing open, recall's list of the turns alone
     * (the owner's of 11-08). @param {string} chain
     */
    untold: (chain) => keep(chain, { lost: true }),
    /**
     * Filament folded the chat's turns (a fold-method compaction), which brings no block back after it: the next turn's
     * first message says the list where something is open — every compaction reminds (the owner's of 11-09). One that
     * comes while the agent's own compaction waits to be said leaves that one. @param {string} chain
     */
    folded: (chain) => {
      const h = heardOf(chain);
      if (h && "lost" in h) return;
      keep(chain, { lost: true, fold: true });
    },
    /**
     * The agent's own compaction was undone before its next message (sessions/service.js `undoCompaction`): its session
     * from before stands, so no word of a compaction waits for that message — the chat keeps the list as it stands, as
     * after a summary that said it. @param {string} chain
     */
    undone: (chain) => {
      const h = heardOf(chain);
      if (!h || !("lost" in h)) return;
      const k = followed(chain).keys;
      keep(chain, k.length ? { keys: k } : null);
    },
    due,
    /**
     * A turn of the chat's main agent began: a long wait is weighed from now (`waited`), and nothing a turn before it
     * said for one counts. @param {string} chain
     */
    begin(chain) {
      if (!chain) return;
      turns.set(chain, { at: now(), from: new Map(), said: new Set(), start: new Set() });
    },
    /**
     * The list said at the turn's start reached the main agent — its first prompt, or the loop's first request, carried
     * it —: what it named is said for the turn, so an answer's "Also still open" names none of it again (`also`). The
     * turn's alone: a prompt that failed after it loses nothing, as the next turn's start says the list again.
     * @param {string} chain @param {readonly string[]} keys
     */
    startSaid(chain, keys) {
      const t = turns.get(chain);
      if (t) for (const k of keys) t.start.add(k);
    },
    /**
     * The turn of the chat's main agent ended, however it did: nothing of it is weighed any more (`waited`), and the
     * chat is no running turn's (the re-read of 11-11: an entry stayed for every chat that ever ran a turn, and past
     * 200 of them the oldest went — a turn still running among them, whose long wait nothing weighed again).
     * @param {string} chain
     */
    over(chain) {
      turns.delete(chain);
    },
    /** The chats a turn of the main agent runs in now, from its `begin` to its `over`. @returns {string[]} */
    turnsNow: () => [...turns.keys()],
    /**
     * At the main agent's call, in a turn begun (`begin`): the list, where a change that waits for its apply — the
     * person's Changes shows it — waited WAITS_LONG_MS in the turn with nothing said of it, counted from the latest of
     * the turn's start, the list said whole in it, the turn's last word of it, and its wait's own start (the gap of
     * 11-11: with no compaction and no task ending, a sub-agent's change waited unapplied an hour inside one long turn,
     * and nothing named it). Its state alone, never how many calls went by. Not one dismissed, nor one a long wait's list
     * named in the turn. With the list's keys, and the changes it names (`waits`), which `waitedHeard` marks once it
     * reached the agent. Null where none waited so. `dismiss`: whether the agent has Filament's envelope tool (`openWords`).
     * @param {string} chain @param {{ dismiss?: boolean }} [o]
     * @returns {{ text: string, keys: string[], waits: string[] } | null}
     */
    waited(chain, { dismiss = true } = {}) {
      const t = chain ? turns.get(chain) : null;
      if (!t) return null;
      const at = now();
      // Every wait is counted from the turn's start or the list said since, at the earliest: before WAITS_LONG_MS of it
      // none can be long, and nothing is read — an ordinary turn's calls cost nothing. A change whose wait's start is
      // unknown is counted from there too: the registry keeps no end only for a sub-agent kept over a restart whose
      // exchange never ended (subagents.js, its status aborted), so its change waited before the turn began (the
      // re-read of 11-11: counted from the first call that saw it, it was said at 40 minutes).
      if (at - t.at < WAITS_LONG_MS) return null;
      const n = followed(chain);
      const waits = n.rows.filter((r) => !r.dismissed && r.view.act === "review" && !t.said.has(r.key));
      const long = waits.some((r) => at - Math.max(t.at, Number(r.since) || 0, t.from.get(r.key) || 0) >= WAITS_LONG_MS);
      return long ? { text: openWords(n.lines, "long", true, dismiss), keys: n.keys, waits: waits.map((r) => r.key) } : null;
    },
    /**
     * A long wait's list reached the agent (`waited`): each change it named is said for the turn, and the chat keeps the
     * list as heard, as after a compaction's block — but a compaction of the agent's own nothing said after, which its
     * next turn's start says still, with recall's list of the turns. @param {string} chain
     * @param {{ keys: readonly string[], waits: readonly string[] }} w
     */
    waitedHeard(chain, { keys, waits }) {
      const t = turns.get(chain);
      if (t) for (const k of waits) t.said.add(k);
      const h = heardOf(chain);
      heardWhole(chain, keys, !(h && "lost" in h));
    },
    /**
     * `due`, with the folder's reads in where it says the list: they are read — waited for `MORE_WAIT_MS` at most — only
     * once the list is to be said. @param {string} chain @param {{ recall?: boolean, dismiss?: boolean }} [o]
     */
    dueNow: async (/** @type {string} */ chain, /** @type {{ recall?: boolean, dismiss?: boolean }} */ o = {}) => {
      if (!due(chain, o)) return null;
      await refresh(chain, { within: MORE_WAIT_MS });
      return due(chain, o);
    },
    /**
     * A turn the main agent took in ended — its prompt reached it, with the list where one was due (`told`): what it was
     * told it followed through its turn, so the chat keeps the list as it stands. A compaction nothing was said after
     * stays for its next turn's start, open or not: that says recall's list of the turns at least — but Filament's fold
     * with nothing open, which says nothing. A turn that never reached the agent, or reached it without a list that was
     * due, moves nothing: the caller does not call. Each sub-agent's change that waits counts the turn, unsaid or said.
     * What its answers counted and never named waits for the next start (`openMore`); what was owed from before it, the
     * list said at its start let go — and what is no longer open goes either way.
     * @param {string} chain @param {boolean} [told]
     */
    ended(chain, told = false) {
      if (!chain) return;
      const n = followed(chain);
      counted(chain, n.keys, told);
      prune(chain);
      const listed = new Set(n.keys);
      const now = countedNow.get(chain) || new Set();
      countedNow.delete(chain);
      keepMore(chain, moreOf(chain).filter((k) => listed.has(k) && (!told || now.has(k))));
      const h = heardOf(chain);
      const k = n.keys;
      if (!h) {
        if (told && k.length) keep(chain, { keys: k });
        return;
      }
      if ("lost" in h && !told) {
        if (h.fold && !n.lines.length) keep(chain, null);
        return;
      }
      // The same key may name another sub-agent's change since: a task tried again, which failed again.
      const whose = new Map(n.rows.map((r) => [r.key, r.view.agent]));
      const moved = "lost" in h || k.length !== h.keys.length || k.some((x, i) => x !== h.keys[i]) || k.some((x) => leftByGraph(x) && h.whose?.[x] !== whose.get(x));
      if (moved) keep(chain, k.length ? { keys: k } : null);
    },
    /**
     * The agent dismissed lines that no longer hold, by the ids they end with (the envelope tool's `dismiss`): each kept
     * with the chat with its mark as it stands, out of the list until that changes. Not the ids of nothing open now.
     * `waits`: the sub-agents whose change it dismissed, which still wait in the person's Changes (the owner's of 11-10:
     * the card said nothing waits while 35 files did) — its answer says how one stops waiting there too.
     * Every id a line of the list ends with is taken, whoever it was said to: the coding agent's own background task
     * by either of its names (`twinOf`), read here as a reader that runs none hears them, and kept under both — the
     * session that runs it and every other reader leave it out alike (the re-read of 11-11: the list offered
     * [task:<id>] and [theirs:<id>], and this refused both).
     * @param {string} chain @param {readonly unknown[]} ids @returns {{ dismissed: string[], unknown: string[], waits: string[] }}
     */
    dismiss(chain, ids) {
      const rows = new Map(of(chain, null, { others: true }).rows.map((r) => [r.key, r]));
      const d = dismissedOf(chain);
      /** @type {string[]} */
      const dismissed = [];
      /** @type {string[]} */
      const unknown = [];
      /** @type {string[]} */
      const waits = [];
      for (const raw of ids) {
        const id = String(raw ?? "").trim().replace(/^\[|\]$/g, "").trim();
        if (!id) continue;
        const twin = twinOf(id);
        const r = rows.get(id) || (twin ? rows.get(twin) : undefined);
        if (!r) {
          if (!unknown.includes(id)) unknown.push(id);
          continue;
        }
        d[id] = r.mark;
        if (twin) d[twin] = r.mark;
        if (!dismissed.includes(id)) dismissed.push(id);
        // A team's worker's is its lead's, in its own tool's words.
        const agent = r.view?.act === "review" && !id.startsWith("worker:") ? r.view.agent : null;
        if (agent && !waits.includes(agent)) waits.push(agent);
      }
      if (dismissed.length) keepDismissed(chain, d);
      return { dismissed, unknown, waits };
    },
    /**
     * The person's Undo on the Plan's card: a dismissed line listed again — under its other name too, where it is the
     * coding agent's own task (`twinOf`). False where none was. @param {string} chain @param {string} key
     */
    undismiss(chain, key) {
      const d = dismissedOf(chain);
      if (!Object.hasOwn(d, key)) return false;
      delete d[key];
      delete d[twinOf(key)];
      keepDismissed(chain, d);
      return true;
    },
  };
}
/** @typedef {ReturnType<typeof createStillOpen>} StillOpen */

