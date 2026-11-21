// @ts-check
// The task graph, drawn (HarnessV3-TaskGraph TG-D5, G2-10, G3-7; the owner's redesign of 10-23, HarnessV4_PlanGraph;
// the Plan page made one page, HarnessV4_TaskGraphPlus_Design E41 P4; the Product agent's redesign of 11-05, the
// owner's yes): the session's graph as the Plan page shows it, from top to bottom as a flow is drawn. The head: the
// goal, how much is done, what runs, asks you or failed, the time and what its agents or workers spent, a straight
// line's fact, the page's tools and Run log; a closed graph's outcome under it, in a sentence; the ready tasks that can
// run side by side, offered. On the Plan tab the graph is one canvas (lib/graph-boxes.js lays it out): a row a step,
// never wrapped — a wide graph opens as small as its words read and pans, Fit drawing it whole — each task one line
// in its row, placed from the needs and the order the tasks were added, never their state, so nothing moves sideways
// while the work does; a line means "needs" and nothing else, a soft curve from the foot of the task needed to the top
// of the one that needs it, faint out of finished work, the chosen task's blue, the one the pointer rests on lit; the
// finished steps at the top folded into a row. Beside the chat and in the peek the same steps run down a rail (`railOf`), one line a task.
// A task's line: its mark, its id, its name and one fact — what it took, what it does now, or in colour what calls for
// you: asks you, failed, ready to apply; the rest of what it is — who does it, the thread of memory it finishes, what
// is kept behind it, the hunts fired from it, what found it, that you ran it — in its tooltip and its card. Colour and
// a word only where you are needed or work goes on: blue while it runs, orange where it asks you, red where it failed;
// a finished task recedes, a waiting one faint; the agent's own running task between its turns keeps its arc still.
// The chosen task's one card, its parts on hairlines in the order the person asks of a task in its state. A command
// task (HarnessV3-TaskGraph-v2 V2-3) is Filament's own: its line says how its runs go, and its card draws its run, its
// items and the table of its runs. A done task's card ends with Hunt for bugs, its foot, never folded
// (HarnessV4_DesignPass_Plan UX9; the owner's of 11-10): a Reviewer on the model picked, briefed on what the task did (`huntBrief`); a
// right-click on its line opens the same. A hunted task's box holds its hunts (the owner's yes of 11-05): a strip for
// each Reviewer sent from it — hunting, its report sent, or the fixes its finding became, each a line inside the box —
// the box folded to one strip once nothing in it is open, and a card that says which hunt found a fix, with the way to
// the hunt's thread. It draws `graphView`'s answer (core/task-graph.js), which the `graph` run event, the page's feed
// and the session's answer carry, in the words of whoever plans it (`crew`). Every builder takes the host's `h`, so the
// tests draw it on the fake DOM; every place is the layout's, so the lines are drawn with the boxes, in one pass; a
// mark and a line are SVG strings of shapes and class names only, and a task's words reach the page as text.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { curvePath, lineLook, straightLine } from "../lib/graph-lanes.js";
import { BOX, boxesOf, groupsOf, stepsOf } from "../lib/graph-boxes.js";
import { askWords, listWords, repeatWords, sendBackTitles, stoppedWords, whoOfTask, yourAsk } from "../lib/team.js";
import { failureCard, failureWords } from "../lib/failure.js";
import { ago, kids, link, usd } from "../widgets/kit.js";
import { MARKS } from "../lib/marks.js";
import { prettyModel } from "../lib/families.js";
import { clockOf } from "../panes/changes-data.js";

/** @typedef {typeof h} Mk */
/** @typedef {"agent" | "team"} Crew  who plans the graph: the agent, or a team's lead */
/**
 * @typedef {{ agent: string, round: number, tool: { name: string, args: string } | null,
 *   asking?: { tool: string, args: string, to?: "lead" } | null }} TaskProgress  a running sub-agent's or worker's newest
 *   step, from its run: its round, its newest tool, and the call that waits for your answer — or its question to its
 *   lead (`to`, HarnessV3-TaskGraph-v2 TG2-D49)
 */

/** The states that call for you, and their word on the box: the only boxes that carry one. */
// A change ready in its copy calls for an apply too — the planner's, or yours (the owner's of 11-02).
const CALLS = Object.freeze({ asking: "Asks you", failed: "Failed", yours: "Ready to apply" });
/** The states in which work on a task goes on: its mark turns, its step's dot is blue and its bar slides. */
const AT_WORK = new Set(["running", "checking", "review", "merging", "asking", "starting"]);

/**
 * Each state's word as a card draws it: the core's states, a ready task, a worker that asks you, the developer's side
 * run starting (10-28), its launch on its way or waiting for the agent's turn to end — and a worker's
 * change ready in its copy, waiting for its apply (the owner's of 11-02). A change going into your folder is applying:
 * one word for one act (the Designer's).
 */
const WORDS = Object.freeze({ done: "done", running: "running", paused: "paused", asking: "asks you", checking: "checking", review: "in review", merging: "applying", ready: "ready", waiting: "waiting", failed: "failed", dropped: "dropped", starting: "starting", yours: "ready to apply" });

/** @typedef {readonly import("../lib/team.js").TeamMember[] | null} Members  the members of the team that leads */

/** Who does one of the agent's own tasks, in words (G2-1, G3-1) — and a command task, under any planner (V2-3). */
const WHO = Object.freeze({ you: "the agent", "sub-agent": "an agent", explorer: "an explorer", command: "Filament runs its commands — no model" });

/** The states of a task still open: one its checklist marks blocked says so on its line (V2-5). */
const OPEN = new Set(["waiting", "running", "paused", "review", "merging", "failed"]);

/**
 * What the graph keeps behind its tasks, as the Plan view reads it for the card it draws (HarnessV4_TaskNotes_Plan E33):
 * a task's list — null while it is asked for — a note or a text file opened in the reader with what its row says of it
 * (views/note-reader.js), and where a file is served.
 * @typedef {{ of: (task: string | null) => { list: { notes: any[], files: any[] } | null, error: string | null },
 *   onOpen: (task: string | null, name: string, kind: "note" | "file", meta: string) => void, fileUrl: (task: string | null, name: string) => string,
 *   graphShown: boolean, onGraph: () => void, note: (task: string, title: string) => { text: string | null, error: string | null } | null }} KeptPane
 *   `note`: a note read whole without opening its row — a paused task's newest checkpoint, its card's first part (D9)
 */
/**
 * A done task's bug hunt, as the Plan view holds it (HarnessV4_DesignPass_Plan UX9): the model chip — the page's
 * picker, one per view, moved into the card each draw so an open picker stays where it is — whether a hunt of the task
 * is starting, the Reviewers sent to hunt from it (the chat's list's, which a reload and a restart keep, and those the
 * page started that the list has not said yet), the start, and the popup a right-click on its box opens (`onMenu`).
 * @typedef {{ agent: string, name: string, model: string, at: number, running?: boolean, ended?: string }} Hunter  one
 *   Reviewer sent to hunt from a task: `running` while it works, `ended` how it ended, in words — neither where the list
 *   has not said it yet
 * @typedef {{ picker: any, busy: (task: string) => boolean, started: (task: string) => Hunter[],
 *   onHunt: (t: any) => void, onMenu?: ((t: any, el: any) => void) | null }} HuntPane
 */
/**
 * The hunting Reviewer's brief on a done task (UX9 case 11): what the task was and did, as the graph keeps it — its goal, what was
 * done, its acceptance, the files it named and changed, its check — and what to report, its subject line first for the
 * envelope's line; and its range (the plan's p6): the files it changed, else those it named, which Filament reads from
 * git into the head of the brief. Pure.
 * @param {any} t  a task of graphView's answer
 * @returns {{ prompt: string, description: string, range: string[] }}
 */
export function huntBrief(t) {
  const did = String(t.summary || t.report?.did || "").trim();
  const changed = (t.report?.files || []).map((/** @type {any} */ f) => String(f.path));
  const lines = [
    `Hunt for bugs in what task ${t.id} of this chat's task graph did — "${t.name}". Change nothing.`,
    "",
    ...(t.goal ? [`Its goal: ${t.goal}`] : []),
    ...(did ? [`What was done: ${did}`] : []),
    ...(t.acceptance ? [`Its acceptance: ${t.acceptance}`] : []),
    ...(t.writes?.length ? [`The files it named: ${t.writes.join(", ")}`] : []),
    ...(changed.length ? [`The files it changed: ${changed.join(", ")}`] : []),
    ...(t.check?.length ? [`Its check: ${t.check.join(", then ")}`] : []),
    "",
    "Read the code as it is now — those files, and what calls them — never the summary above alone. Report the bugs you can show: each with its file and line, the code that shows it, why it is a bug and the input or the order of events that sets it off. One you cannot tie to code goes under Plausible, apart. Say what you did not reach.",
    'Start your report with one line, "Subject: " and what you found in under 20 words: the agent that reads it may read that line before the rest.',
  ];
  const name = String(t.name ?? "");
  const range = [...new Set(changed.length ? changed : (t.writes || []).map(String))];
  return { prompt: lines.join("\n"), description: `Bug hunt: ${t.id} · ${name.length > 60 ? `${name.slice(0, 59)}…` : name}`, range };
}
/**
 * Whether a task is hunted for bugs (UX9): a done one — never a command task, which wrote nothing, nor a step whose
 * sub-tasks did its work (11-06).
 * @param {any} t @param {string} st  its state as drawn
 */
const huntable = (t, st) => st === "done" && t.by !== "command" && !t.subtasks?.length;
/**
 * What a Hunter found a task on, in words (11-02): "Found by Hunter on Lexer (t1)" — the name of the task it was fired
 * from where the graph holds it, else its id.
 * @param {any} t  a task with `foundBy` @param {Map<string, any>} byId
 */
export const foundWords = (t, byId) => {
  const on = byId.get(t.foundBy.task);
  return `Found by ${t.foundBy.name} on ${on ? `${on.name} (${t.foundBy.task})` : t.foundBy.task}`;
};
/**
 * The Reviewers sent to hunt bugs from a task, in words: "2 Reviewers sent to hunt bugs in t3, 1 still running".
 * @param {string} id @param {Hunter[]} fired
 */
const huntersWords = (id, fired) => {
  const still = fired.filter((s) => s.running).length;
  return `${fired.length} ${fired.length === 1 ? "Reviewer" : "Reviewers"} sent to hunt bugs in ${id}${still ? `, ${still} still running` : ""}`;
};
/**
 * One Reviewer sent to hunt from a task, on a line: who, on what, when and how it stands, and Open — the card's and the
 * right-click popup's (UX9).
 * @param {Mk} mk @param {Hunter} s @param {number} now @param {((id: string) => void) | null} onOpen
 */
export function hunterLine(mk, s, now, onOpen) {
  const how = s.running ? " — still running" : s.ended ? ` — ${s.ended}` : "";
  return mk("p", { class: "tg-hunt-line" }, `${s.name} on ${prettyModel(s.model)} started ${ago(s.at, now)}${how}`, ...(onOpen ? [" · ", link(mk, "Open", () => onOpen(s.agent))] : []));
}
/** A file the card shows as a picture: the kinds Filament serves as images. */
const PICTURE_FILE = /\.(png|jpe?g|gif|webp)$/i;
/** A file the card opens as text, beneath its row: what reads as words. */
const TEXT_FILE = /\.(md|markdown|txt|text|log|json|jsonl|csv|tsv|ya?ml|toml|xml|html?|svg|css|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|c|h|cpp|sh|ps1|diff|patch)$/i;
/** What one task keeps, in words: "2 notes · 1 file". @param {{ notes: number, files: number }} c */
const keptWords = (c) => [c.notes ? `${c.notes} ${c.notes === 1 ? "note" : "notes"}` : "", c.files ? `${c.files} ${c.files === 1 ? "file" : "files"}` : ""].filter(Boolean).join(" · ");
/** A size in words. @param {number} n */
const sizeWords = (n) => (n < 1024 ? `${n} bytes` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/**
 * What is kept behind the graph itself, as a card (E33, case 15): its rows (`keptRows`), or that they are on their way.
 * @param {Mk} mk @param {string | null} task @param {{ notes: number, files: number }} count @param {KeptPane} k @param {number} now
 */
function keptCard(mk, task, count, k, now) {
  const s = k.of(task);
  const body = s.error
    ? mk("p", { class: "tg-card-text" }, `Not read: ${s.error}`)
    : !s.list
      ? mk("p", { class: "tg-kept-wait" }, "Reading…")
      : keptRows(mk, task, s.list, k, now);
  return mk("section", { class: "tg-card tg-kept-card" },
    mk("h4", { class: "tg-card-title" }, mk("span", { class: "tg-card-name" }, task ? "Kept behind it" : "Kept behind the graph"), mk("span", { class: "tg-kept-count" }, keptWords(count))),
    mk("div", { class: "tg-sec" }, body));
}

/**
 * What is kept behind a task or the graph (`task` null), a row each (E33): each note a row that opens it whole beneath
 * it; each file a row — a picture shown, a text file opening as a note does, any other kind downloaded.
 * @param {Mk} mk @param {string | null} task @param {{ notes: any[], files: any[] }} list @param {KeptPane} k @param {number} now
 */
function keptRows(mk, task, list, k, now) {
  // A note or a text file opens in the reader (views/note-reader.js, 11-06): read whole in a sheet over the page, which
  // the view's draws leave be — beneath its row, a new rev of the graph closed it.
  /** @param {string} name @param {"note" | "file"} kind @param {string} meta @param {string} [first] */
  const opener = (name, kind, meta, first = "") =>
    mk("div", { class: "tg-kept-row" },
      mk("button", { class: "tg-kept-open", type: "button", title: `Read ${name}`, onclick: () => k.onOpen(task, name, kind, meta) },
        mk("span", { class: "tg-kept-name" }, name),
        mk("span", { class: "tg-kept-meta" }, meta),
        first ? mk("span", { class: "tg-kept-first" }, first) : null));
  return mk("div", { class: "tg-kept" },
    ...list.notes.map((n) => opener(n.title, "note", `note · ${Number(n.chars).toLocaleString("en-US")} characters · ${n.by} · ${ago(n.at, now)}`, n.first)),
    ...list.files.map((f) => {
      const meta = `file · ${sizeWords(Number(f.bytes) || 0)} · ${f.by} · ${ago(f.at, now)}`;
      if (PICTURE_FILE.test(f.name))
        return mk("div", { class: "tg-kept-row" },
          mk("a", { class: "tg-kept-open", href: k.fileUrl(task, f.name), target: "_blank", rel: "noopener", title: `Open ${f.name}` }, mk("span", { class: "tg-kept-name" }, f.name), mk("span", { class: "tg-kept-meta" }, meta)),
          mk("img", { class: "tg-kept-img", src: k.fileUrl(task, f.name), alt: f.name, loading: "lazy" }));
      if (TEXT_FILE.test(f.name)) return opener(f.name, "file", meta);
      return mk("div", { class: "tg-kept-row" },
        mk("a", { class: "tg-kept-open", href: k.fileUrl(task, f.name), download: f.name, title: `Download ${f.name}` }, mk("span", { class: "tg-kept-name" }, f.name), mk("span", { class: "tg-kept-meta" }, `${meta} · download`)));
    }));
}

/** A run's time as Filament's words say it: "4 s", "3 min". @param {number} ms */
const runTime = (ms) => (ms < 120_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);
/**
 * How many of a command task's runs go side by side, in the page's words: never "lanes", the field's name, which the
 * Space's page keeps for a folder or worktree a chat works in (the owner's of 11-12). @param {number} n
 */
const atATime = (n) => (n === 1 ? "one at a time" : `${n} at a time`);
/** A command task's runs so far, in a line (V2-3). @param {{ ran: number, passed: number, of: number, lanes: number }} p */
const goingWords = (p) => `${p.ran} of ${p.of} so far, ${p.passed} passed, ${atATime(p.lanes)}`;

/**
 * Whoever plans the graph, in the page's words: the agent and its sub-agents, or a team's lead and its workers — with
 * the team's members, whose cards name who does a task (HarnessV4_Tasks E15 step 6, AG-172), and the crew every
 * shipped team seats, which names a seat where no member does (`shippedCrew`, lib/team.js `whoOfTask`).
 * @param {Crew} crew @param {Members} [members] @param {readonly import("../lib/team.js").CrewSeat[] | null} [shippedCrew]
 */
export const crewWords = (crew, members = null, shippedCrew = null) => ({
  ...(crew === "team"
    ? { planner: "the lead", Planner: "The lead", worker: "worker", workers: "workers" }
    : { planner: "the agent", Planner: "The agent", worker: "agent", workers: "agents" }),
  members,
  shippedCrew,
});
/** @typedef {ReturnType<typeof crewWords>} CrewWords */

/** Who does a task, in words: the agent's own by what they are, a team's member by its card's name. @param {string} as @param {CrewWords} w */
const whoWords = (as, w) => (Object.hasOwn(WHO, as) ? WHO[/** @type {keyof typeof WHO} */ (as)] : whoOfTask(as, w.members, w.shippedCrew).word);

/**
 * The member that reads a change before it merges, by its name: the one in Reviewer's place under the card's own name
 * before a seat the team names for other work, as the shipped teams' Scout (core/roster.js `reviewersOf`).
 * @param {CrewWords} w
 */
const reviewerName = (w) => {
  const all = (w.members || []).filter((m) => m.place === "reviewer");
  return (all.find((m) => !(/** @type {{ card?: string }} */ (m).card)) || all[0])?.name || "Reviewer";
};

/**
 * Who works on a task now, by the id its feed comes from: its worker while it runs, its reviewer while it reads.
 * @param {any} t
 */
const askerOf = (t) => (t.state === "review" ? t.reviewer : t.agent);
/**
 * The call a running task's worker, or its reading reviewer, asks you about, from the page's feed: null when it asks
 * nothing, the step is another's — a send-back's — or its question is its lead's (HarnessV3-TaskGraph-v2 TG2-D49).
 * @param {any} t @param {Map<string, TaskProgress> | null | undefined} progress
 */
const askingOf = (t, progress) => {
  const p = progress?.get(t.id);
  return p && p.agent === askerOf(t) ? yourAsk(p) : null;
};

/**
 * A task's state as the view draws it: a waiting task whose needs are all done is ready, and a running one whose
 * worker's call waits for your answer asks you, as does one whose reviewer's call does; the developer's side run's
 * (10-28) is starting until its launch; and a worker's change ready in its copy waits for its apply (the owner's of 11-02).
 * @param {any} t @param {Map<string, TaskProgress> | null} [progress] @returns {keyof typeof WORDS}
 */
const drawnState = (t, progress = null) =>
  t.side?.pending && t.state === "waiting" ? "starting" : t.state === "merging" && t.step === "yours" ? "yours" : t.state === "waiting" ? (t.ready ? "ready" : "waiting") : (t.state === "running" || (t.state === "review" && t.step === "reading")) && askingOf(t, progress) ? "asking" : t.state;

/** Who does a task: a started one's worker as it ran (G3-2), else as it was planned. @param {any} t */
const doerOf = (t) => (t.state === "waiting" ? t.by : t.ranAs || t.by);

/**
 * Work going on in a task, as its box's bar shows it and the head counts it running: it runs or Filament checks it, its
 * reviewer reads it, its change merges — not a review queued or asked, nor a merge sent back, nor a worker or a
 * reviewer that waits for a slot (`lanesOf`).
 * @param {any} t @param {string} st  its drawn state
 */
const goingOn = (t, st) => (st === "running" && !(t.slot && t.slot.agent === t.agent)) || st === "checking" || (st === "merging" && t.step !== "back") || (st === "review" && t.step === "reading" && t.slot?.agent !== t.reviewer);

/**
 * What runs at once among some tasks (the owner's of 11-09: "Step 1 · 2 in parallel" over two tasks of the agent's
 * own, which does one thing at a time): each sub-agent's, explorer's or worker's task that runs — not one whose worker
 * waits for a slot, nor one whose call waits for your answer — each reviewer reading, each command task's runs, each
 * check of Filament's, a merge under way — one: Filament applies one change at a time — and the planner's own running
 * tasks as one lane whatever their number, none between its turns. A step with sub-tasks runs as they do: not counted.
 * @typedef {{ own: number, sub: number, explorer: number, worker: number, reviewer: number, command: number, check: number, merge: number }} Lanes
 * @param {readonly any[]} ts  graphView's tasks, as drawn @param {Map<string, TaskProgress> | null | undefined} progress
 * @returns {Lanes}
 */
const lanesOf = (ts, progress) => {
  const n = { own: 0, sub: 0, explorer: 0, worker: 0, reviewer: 0, command: 0, check: 0, merge: 0 };
  for (const t of ts) {
    if (t.subtasks?.length) continue;
    const st = drawnState(t, progress);
    if (st === "checking") n.check++;
    else if (st === "merging" && t.step !== "back") n.merge = 1;
    else if (st === "review" && t.step === "reading" && t.slot?.agent !== t.reviewer) n.reviewer++;
    else if (st !== "running" || t.between || (t.slot && t.slot.agent === t.agent)) continue;
    else if (t.by === "you") n.own = 1;
    else if (t.by === "command") n.command++;
    else {
      const as = doerOf(t);
      if (as === "sub-agent") n.sub++;
      else if (as === "explorer") n.explorer++;
      else n.worker++;
    }
  }
  return n;
};
/** How many lanes run at once: the head's figure. @param {Lanes} n */
const laneCount = (n) => n.own + n.sub + n.explorer + n.worker + n.reviewer + n.command + n.check + n.merge;
/** A count and its noun: "1 sub-agent", "2 checks". @param {number} n @param {string} one */
const counted = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
/**
 * What runs at once, in a step's words — who, never how many boxes: "the agent", "2 sub-agents", "1 sub-agent + the
 * agent", "1 reviewer + a merge"; "" where nothing does. @param {Lanes} n @param {CrewWords} w
 */
const lanesWords = (n, w) => [
  n.sub ? counted(n.sub, "sub-agent") : "",
  n.explorer ? counted(n.explorer, "explorer") : "",
  n.worker ? counted(n.worker, "worker") : "",
  n.reviewer ? counted(n.reviewer, "reviewer") : "",
  n.command ? counted(n.command, "command") : "",
  n.check ? counted(n.check, "check") : "",
  n.merge ? "a merge" : "",
  n.own ? w.planner : "",
].filter(Boolean).join(" + ");

/**
 * The steps, top to bottom: each task in the step of its depth by needs (the view's `layer`), the tasks of one step
 * side by side — they can run at once; the first step's in the order the agent added them, each later step's by where
 * their needs sit in theirs (the mean of their places), so what follows from a task stands under it. A step is done
 * once every task in it is done or dropped (a step of dropped tasks alone is not), at work while one of its tasks is
 * (`AT_WORK`, a task that asks you included), paused while one waits for the agent's next turn, else still to come.
 * @param {any} view  graphView's answer
 * @returns {{ tasks: any[], state: "done" | "now" | "paused" | "later" }[]}
 */
export function graphSteps(view) {
  /** @type {any[]} */
  const tasks = view.tasks;
  /** @type {{ t: any, i: number }[][]} */
  const layers = [];
  tasks.forEach((t, i) => (layers[Number(t.layer) || 0] ||= []).push({ t, i }));
  /** Each task's place in its step, for ordering the next. @type {Map<string, number>} */
  const place = new Map();
  return Array.from(layers, (l) => l || []).filter((l) => l.length).map((layer, li) => {
    if (li > 0) {
      /** @param {{ t: any }} x */
      const mid = (x) => (x.t.needs.length ? x.t.needs.reduce((/** @type {number} */ sum, /** @type {string} */ n) => sum + (place.get(n) ?? 0), 0) / x.t.needs.length : 0);
      layer.sort((a, b) => mid(a) - mid(b) || a.i - b.i);
    }
    layer.forEach((x, j) => place.set(x.t.id, j));
    const ts = layer.map((x) => x.t);
    const ended = ts.every((t) => t.state === "done" || t.state === "dropped") && ts.some((t) => t.state === "done");
    return { tasks: ts, state: ended ? "done" : ts.some((t) => AT_WORK.has(t.state)) ? "now" : ts.some((t) => t.state === "paused") ? "paused" : "later" };
  });
}

/**
 * The task the card shows (D17): the one chosen while it is still there; else the one that needs you — the first whose
 * worker asks you, then the first failed one, which waits on whoever plans — else the first running or paused,
 * checking, in review, merging, ready or waiting one, else the newest.
 * @param {any} view @param {string | null | undefined} chosen @param {Map<string, TaskProgress> | null} [progress]
 */
export function chosenTask(view, chosen, progress = null) {
  /** @type {any[]} */
  const tasks = view.tasks;
  return (
    tasks.find((t) => t.id === chosen) ||
    tasks.find((t) => drawnState(t, progress) === "asking") ||
    tasks.find((t) => t.state === "failed") ||
    tasks.find((t) => t.state === "running" || t.state === "paused") ||
    tasks.find((t) => t.state === "checking") ||
    tasks.find((t) => t.state === "review") ||
    tasks.find((t) => t.state === "merging") ||
    tasks.find((t) => t.ready) ||
    tasks.find((t) => t.state === "waiting") ||
    tasks.at(-1)
  );
}

/**
 * The tasks whose drawn state changed since the last paint — each pops once — and the states to remember for the
 * next. The first paint pops nothing.
 * @param {Map<string, string> | null | undefined} before @param {any} view
 * @returns {{ changed: Set<string>, states: Map<string, string> }}
 */
export function stateChanges(before, view) {
  const states = new Map((view?.tasks || []).map((/** @type {any} */ t) => [t.id, drawnState(t)]));
  return { changed: new Set(before ? [...states].filter(([id, s]) => before.get(id) !== s).map(([id]) => id) : []), states };
}

/** The agent's own task the graph holds running: never a step with sub-tasks (11-06), which runs as they do. @param {any} t */
const ownRunning = (t) => t.state === "running" && t.by === "you" && !t.subtasks?.length;
/**
 * The graph as it stands while the agent is not at work — its turn ended, no other runs for it: the graph keeps its
 * own running task running until its next turn, but nothing works on it, so it is drawn between turns — running, its
 * arc still (D1-1: *paused* is a pause's alone, a task left on purpose with its checkpoint; the owner's word of 10-23,
 * "it should also have been paused", drawn so that the two can be told apart). A sub-agent's, a worker's, a command's
 * and Filament's check go on without the agent's turn, and stay as they are.
 * @param {any} view  graphView's answer
 */
export const betweenTurns = (view) => (view?.tasks?.some(ownRunning) ? { ...view, tasks: view.tasks.map((/** @type {any} */ t) => (ownRunning(t) ? { ...t, between: true } : t)) } : view);

/**
 * What runs of a graph now, as its head counts it ("2 running", `lanesOf`): none of the agent's own between its turns
 * (`betweenTurns`, as `drawGraph` draws it) — the header's Plan button says work is under way by it (the owner's of
 * 11-10, panes/pane-buttons.js).
 * @param {any} view  graphView's answer
 * @param {{ atWork?: boolean, crew?: Crew, progress?: Map<string, TaskProgress> | null }} [o]  as `drawGraph`'s
 */
export function runningNow(view, o = {}) {
  if (!view?.tasks?.length) return 0;
  const v = o.atWork === false && (o.crew || "agent") === "agent" ? betweenTurns(view) : view;
  return laneCount(lanesOf(v.tasks.filter((/** @type {any} */ t) => !t.subtasks?.length), o.progress));
}

/** A span of time in whole minutes, in words: "under a minute", "8 min", "1 h 05 min". @param {number} ms */
export function minutesWords(ms) {
  const min = Math.floor(Math.max(0, Number(ms) || 0) / 60000);
  if (min < 1) return "under a minute";
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

/**
 * How long the graph has run: from its start to its close, to its last task's end once nothing is open, or to now — a
 * failed task is open: it waits on whoever plans.
 * @param {any} view @param {number} now
 */
function graphSpan(view, now) {
  /** @type {any[]} */
  const tasks = view.tasks;
  const open = tasks.some((t) => t.state === "waiting" || t.state === "running" || t.state === "paused" || t.state === "checking" || t.state === "review" || t.state === "merging" || t.state === "failed");
  const end = view.closed?.at || (open ? now : Math.max(...tasks.map((t) => t.endedAt)));
  return Math.max(0, end - view.startedAt);
}

/** The needs of a task not done yet. @param {any} t @param {Map<string, any>} byId @returns {string[]} */
const openNeeds = (t, byId) => t.needs.filter((/** @type {string} */ n) => byId.has(n) && byId.get(n).state !== "done");

/** What a merge brought into the folder: "2 files (+14 −3)". @param {{ files: number, added: number, removed: number }} m */
const mergedWords = (m) => `${m.files} file${m.files === 1 ? "" : "s"} (+${m.added} −${m.removed})`;

/** A task's worker, or its reviewer, that waits for a slot, in a line's words (SUB-3). */
const SLOT_WAITS = "waits for a slot";

/** A checklist step's mark, by its status (the owner's of 11-11): the one it is on turns, as a task at work does. */
const STEP_MARK = Object.freeze({ done: "done", doing: "running", pending: "waiting", blocked: "waiting" });

/**
 * The agent's own task's line while its checklist is its steps (the owner's of 11-11): the step it is on, else the one
 * blocked, else how many are done. @param {{ text: string, status: string }[]} list
 */
function stepsLine(list) {
  const at = list.findIndex((s) => s.status === "doing");
  const stuck = at < 0 ? list.findIndex((s) => s.status === "blocked") : -1;
  const i = at >= 0 ? at : stuck;
  if (i >= 0) return `step ${i + 1} of ${list.length}${stuck >= 0 ? " blocked" : ""} · ${list[i].text}`;
  return `${list.filter((s) => s.status === "done").length} of ${list.length} steps done`;
}

/**
 * A task in review, on its card's line (G3-3): its reviewer reading — with its newest tool, from the feed — or to
 * start: stopped by the developer, by its lead or by the agent itself, held until the next tasks call of whoever plans,
 * or next; or the changes it asked on their way to the worker.
 * @param {any} t @param {any} view @param {Map<string, TaskProgress> | null | undefined} progress @param {CrewWords} w
 */
function reviewLine(t, view, progress, w) {
  if (t.step === "asked") return `changes asked · round ${t.reviews.length} of ${view.reviewRounds}`;
  const round = `${reviewerName(w)} · round ${t.reviews.length + 1} of ${view.reviewRounds}`;
  if (t.step !== "reading") return `${round} · ${t.stopped ? stoppedWords(t.stopped) : view.planning ? "waits for your Approve" : view.held ? `held until ${w.planner}'s next tasks call` : "starts next"}`;
  // Its reviewer waits for a slot (the bug hunt of 10-30, SUB-3): it starts by itself once one is free.
  if (t.slot && t.slot.agent === t.reviewer) return `${round} · ${SLOT_WAITS} · ${t.slot.why}`;
  const p = progress?.get(t.id);
  return p && p.agent === t.reviewer && p.tool ? `${round} · ${`${p.tool.name} ${p.tool.args}`.trim()}` : round;
}

/**
 * A task's newest line: what was done or merged, why it was dropped or failed, a merge
 * under way, a review's round, the call a worker asks you about, a running worker's round and newest tool — fixing its
 * review's changes — when the agent's own task started — under a lead, that it waits for a worker — who starts a ready
 * one, that the developer stopped it — it waits, its needs done, for the next tasks call — or the needs it waits on.
 * @param {any} t @param {Map<string, any>} byId @param {number} now @param {any} view
 * @param {Map<string, TaskProgress> | null | undefined} progress @param {CrewWords} w
 */
function nowLine(t, byId, now, view, progress, w) {
  const st = drawnState(t, progress);
  // Applied with git's conflict markers in some files: said, never read as clean (the Hunter's of 10-28). Its files
  // still uncommitted in the folder, said until they are committed (11-09).
  if (st === "done") return t.merged ? `${t.uncommitted?.length ? "applied, not committed" : "applied"} · ${mergedWords(t.merged)}${t.merged.marked?.length ? ` · markers in ${listWords(t.merged.marked.map((/** @type {string} */ p) => p.split("/").pop() || p))}` : ""}` : t.summary;
  if (st === "checking") return `Filament runs its check · ${(t.check || []).join(", then ")}`;
  // Its change did not merge (10-28): it waits in its copy for the developer to resolve it in Changes.
  if (st === "failed" && t.failures?.cause === "merge" && t.agent) return `didn't apply: ${/overlaps? yours/.test(t.why) ? "overlaps your edits" : "it can't come in as it stands"} · Resolve in Changes`;
  if (st === "dropped" || st === "failed") return t.why;
  if (st === "merging" && t.step === "back") return `sent back by Filament: the folder's check · ${t.agent} next`;
  if (st === "merging") return t.overruled || t.overruledBy ? `3-way apply · on ${t.overruledBy === "planner" ? `${w.planner}'s` : "the lead's"} word` : "3-way apply";
  // The developer's side run (10-28): its launch on its way, or waiting for the agent's turn.
  if (st === "starting") return t.side.starts === "turn" ? `when ${w.planner}'s turn ends · ${t.side.model}` : `${t.side.folder === "copy" ? "making its copy" : "in your folder"} · ${t.side.model}`;
  // Ready (the owner's of 11-02): its change waits in its copy for its apply — the planner's, or yours from Changes.
  if (st === "yours") return `${filesWords(t.report?.files?.length || 0)} wait in its copy for its apply · Review in Changes`;
  if (st === "review") return reviewLine(t, view, progress, w);
  if (t.by === "you" && w.planner === "the lead") return "the agent's own: it waits for a worker";
  // A command task's runs, as they go (V2-3).
  if (t.by === "command" && st === "running") return t.progress ? `${t.progress.ran} of ${t.progress.of} runs · ${t.progress.passed} passed` : `Filament runs it · started ${ago(t.startedAt, now)}`;
  const doer = whoOfTask(doerOf(t), w.members, w.shippedCrew);
  const who = doer.worker ? doer.word : t.agent;
  if (st === "asking") {
    const a = askWords(/** @type {{ tool: string, args: string }} */ (askingOf(t, progress)));
    return `${t.state === "review" ? reviewerName(w) : who} · ${a.verb}${a.what ? ` ${a.what}` : ""}`;
  }
  // Left on purpose with its checkpoint (E36): which one, and when.
  if (st === "paused") return t.checkpoint ? `paused · ${String(t.checkpoint.title).replace(/^Checkpoint/, "checkpoint").replace(" · ", ", ")}` : "paused";
  if (st === "running") {
    if (t.between) return `between turns — goes on at ${w.planner}'s next turn`;
    // A coding agent's own task its launch named (10-28): who works on it, on which model, where.
    // In your folder beside another that writes its files (g1, `mergesWith`'s folder): the box says so.
    if (t.by === "you" && t.helper) return `${t.helper.model} · ${t.helper.copy ? "its copy" : "your folder"} · ${t.helper.agent}${(t.mergesWith || []).some((/** @type {any} */ m) => m.folder) ? ` · writes beside ${listWords(t.mergesWith.filter((/** @type {any} */ m) => m.folder).map((/** @type {any} */ m) => m.task))} there` : ""}`;
    if (t.by === "you") return t.list?.length ? stepsLine(t.list) : `started ${ago(t.startedAt, now)}`;
    const p = progress?.get(t.id);
    const mine = p && p.agent === t.agent ? p : null;
    const tool = mine?.tool ? `${mine.tool.name} ${mine.tool.args}`.trim() : "";
    // The developer's side run: its model and where it works say who it is (10-28); a worker, where its launch put it (11-09).
    const by = t.side ? `${t.side.model} · ${t.side.folder === "copy" ? "its copy" : "your folder"}` : t.workspace ? `${who} · ${WORKSPACE_WORDS[t.workspace] || t.workspace}` : who;
    // Its worker waits for a slot (the bug hunt of 10-30, SUB-3): it starts by itself once one is free.
    if (t.slot && t.slot.agent === t.agent) return `${by} · ${SLOT_WAITS} · ${t.slot.why}`;
    // Its merge undone, it fixes its change against the folder's check (V2-2).
    if (t.gate?.kind === "undone" && t.gate.back?.n) return `fixing the folder's check · ${t.gate.back.n} of ${GATE_RETURNS}${tool ? ` · ${tool}` : ""}`;
    if (t.reviews.length) return `fixing its review · round ${t.reviews.length} of ${view.reviewRounds}${tool ? ` · ${tool}` : ""}`;
    // Its question to its lead (TG2-D49) is what it does now.
    const doing = mine?.asking?.to === "lead" ? "asks its lead" : tool;
    return mine ? `${by} · round ${mine.round}${doing ? ` · ${doing}` : ""}` : `${by} · started ${ago(t.startedAt, now)}`;
  }
  if (st === "ready") return t.by === "you" ? "ready to start" : view.planning ? "waits for your Approve" : view.held ? `held until ${w.planner}'s next tasks call` : t.resume ? `${t.resume} goes on with it` : "Filament starts it";
  if (t.stopped) return stoppedWords(t.stopped);
  // Planned from your message by the fork that weighed it (the owner's forked steer of 11-04): nothing starts it.
  if (t.proposed) return `proposed from your message · waits for ${w.planner} to take it on`;
  // A need whose change is ready and not applied yet holds it (the owner's of 11-02): its apply frees it.
  const open = openNeeds(t, byId);
  const unapplied = open.filter((n) => byId.get(n).state === "merging" && byId.get(n).step === "yours");
  return unapplied.length === open.length ? `waits for the apply of ${open.join(", ")}` : `waits for ${open.join(", ")}`;
}

/** How many files, in words. @param {number} n */
const filesWords = (n) => `${n} ${n === 1 ? "file" : "files"}`;
/** Where a worker works, as its launch chose (11-09), in its box's line. @type {Record<string, string>} */
const WORKSPACE_WORDS = { folder: "your folder", worktree: "its worktree", patch: "its patch" };
/** The same, as its tooltip says who does it. @type {Record<string, string>} */
const WORKSPACE_PLACE = { folder: "in your folder", worktree: "in its own worktree", patch: "in a patch of its own" };

/**
 * When a task moved, in words: added, started — paused, and when; between its planner's turns — or ended, and how
 * long it took, once it had started.
 * @param {any} t @param {number} now @param {CrewWords} w
 */
function whenWords(t, now, w) {
  const st = drawnState(t);
  if (st === "checking") return `marked done ${ago(t.endedAt, now)} · Filament checks it now`;
  if (st === "done" || st === "dropped" || st === "failed") return `${st} ${ago(t.endedAt, now)}${t.startedAt ? ` · took ${minutesWords(t.endedAt - t.startedAt)}` : ""}`;
  if (st === "paused") return `started ${ago(t.startedAt, now)}${t.checkpoint ? ` · paused ${ago(t.checkpoint.at, now)}` : ""}`;
  if (t.between) return `started ${ago(t.startedAt, now)} · between ${w.planner}'s turns`;
  if (st === "starting") return `you ran it ${ago(t.side.at, now)}`;
  return st === "running" || st === "review" || st === "merging" || st === "yours" ? `started ${ago(t.startedAt, now)}` : `added ${ago(t.addedAt, now)}`;
}

/**
 * The chosen task's card (views.css `.tg-body.is-beside`) — the canvas's inspector, its lines a reading width (the
 * owner's of 11-10) — and beside the canvas with the gap before it, px.
 */
const CARD_W = 380;
const CARD_BESIDE = CARD_W + 22;
/** The least room the canvas keeps beside the card, px: in less, the card stands under it. */
const CANVAS_LEAST = 360;
/** The canvas's frame across, px: its border on each side (views.css `.tg-canvas-box`). */
const CANVAS_FRAME = 2;

/**
 * Where the chosen task's card stands in the width the page has (D15): beside the canvas where the room holds the card
 * and a canvas worth the name — the canvas zooms and pans to what it is given — else under it. A width not measured
 * yet: under.
 * @param {number | null | undefined} width @returns {"beside" | "under"}
 */
export function layoutOf(width) {
  return Number(width) >= CANVAS_LEAST + CARD_BESIDE ? "beside" : "under";
}

/** The usual size of the page's type, px (harness.css `--ui-font-size`): the boxes' own size is laid out for it. */
const FONT = 14;
/** A hunt box's strip, px at the usual type (views.css `.tg-hunt-strip`). */
const STRIP_H = 30;
/**
 * The sizes for the page's type, the layout's at the usual size in step with a larger or smaller one: a one-line box
 * and a hunt box's strip. @param {number | null | undefined} font
 */
const sizesFor = (font) => {
  const f = Number(font) > 0 ? /** @type {number} */ (font) / FONT : 1;
  return { w: Math.round(BOX.w * f), h: Math.round(BOX.h * f), strip: Math.round(STRIP_H * f) };
};

/**
 * The zoom's bounds and its step (the redesign's − and +): Fit never draws past 100%, and the canvas opens no smaller
 * than `read`, where a task's words still read.
 */
export const ZOOM = Object.freeze({ min: 0.25, max: 1.5, step: 0.1, read: 0.8 });
/** @typedef {number | "fit" | null} Zoom  the person's zoom, Fit, or none chosen: the canvas as it opens */
/** @typedef {{ w: number, h?: number | null }} Extent  a width and a height, px; a height unknown or none: no bound */
/**
 * The zoom the canvas draws at: the person's, within its bounds; Fit — the whole drawing in the room, both ways (the
 * owner's of 11-10: the canvas a workspace the window's height), never past 100%; none chosen, Fit no smaller than its
 * words read, the rest panned to. A width alone is a width with no height; a room not measured yet: 100%.
 * @param {Zoom | undefined} z @param {number | Extent} drawn  the drawing's size, px @param {number | Extent} room
 */
export function zoomOf(z, drawn, room) {
  if (typeof z === "number") return Math.min(ZOOM.max, Math.max(ZOOM.min, z));
  const d = typeof drawn === "number" ? { w: drawn } : drawn;
  const r = typeof room === "number" ? { w: room } : room;
  /** How far one way must shrink to fit, 1 where it fits or its room is unknown. @param {number | null | undefined} a @param {number | null | undefined} b */
  const way = (a, b) => (Number(b) > 0 && Number(a) > Number(b) ? Number(b) / Number(a) : 1);
  const most = Math.min(way(d.w, r.w), way(d.h, r.h));
  const fit = most < 1 ? Math.max(ZOOM.min, Math.floor(most * 100) / 100) : 1;
  return z === "fit" ? fit : Math.max(fit, ZOOM.read);
}
/** @typedef {{ x: number, y?: number, z: number }} Pan  where the canvas was panned to, across and down, and at which zoom */
/**
 * One press of the zoom bar's − (`dir` -1) or + (1): the next step down or up from the zoom it stands at — Fit's 55%
 * goes to 50% or 60%.
 * @param {number} z @param {-1 | 1} dir
 */
export const zoomStep = (z, dir) => {
  const per = Math.round(1 / ZOOM.step);
  const at = dir > 0 ? Math.floor(z * per + 1e-6) : Math.ceil(z * per - 1e-6);
  return Math.min(ZOOM.max, Math.max(ZOOM.min, (at + dir) / per));
};

/**
 * What a Rearrange found, in the canvas bar's few words: how many fewer crossings, that none cross now, that the lines
 * are shorter — or that the drawing was the clearest it found, where nothing moved.
 * @param {{ order: string[][], crossings: number }} was  the layout as drawn @param {{ order: string[][], crossings: number }} now  as rearranged
 */
export function rearrangeWords(was, now) {
  if (JSON.stringify(was.order) === JSON.stringify(now.order)) return "No clearer layout found";
  const fewer = was.crossings - now.crossings;
  if (fewer <= 0) return "Rearranged · shorter lines";
  return now.crossings === 0 ? "Rearranged · no lines cross" : `Rearranged · ${fewer} fewer ${fewer === 1 ? "crossing" : "crossings"}`;
}

/** What a task took, in a line's few words: "<1 min", "8 min", "1 h 05 min". @param {number} ms */
const tookWords = (ms) => (ms < 60_000 ? "<1 min" : minutesWords(ms));

/**
 * The finished steps folded at the graph's top (D16), in words: how many, how many tasks done, how long they took.
 * @param {any} view @param {number} layers @param {any[]} folded  their tasks
 */
function foldWords(view, layers, folded) {
  const done = folded.filter((t) => t.state === "done");
  const took = done.length && view.startedAt ? Math.max(...done.map((t) => Number(t.endedAt) || 0)) - view.startedAt : 0;
  return `${layers} finished steps · ${done.length} ${done.length === 1 ? "task" : "tasks"} done${took > 0 ? ` · took ${minutesWords(took)}` : ""}`;
}

/**
 * The graph in words, as Copy plan copies it (D1-6): its goal, how much is done, then each step's tasks as the page
 * lays them out, unfolded — a hunt's fixes after the task it hunted, a plan step's sub-tasks under it, indented, done
 * ticked — each with its state and the needs it waits on. `fired`: the tasks a Reviewer was sent from, as the page has
 * them; `keep`: the order the person's Rearrange found, as the page keeps it.
 * @param {any} view @param {Map<string, TaskProgress> | null} [progress] @param {((id: string) => boolean) | null} [fired]
 * @param {string[][] | null} [keep]
 */
export function planText(view, progress = null, fired = null, keep = null) {
  const byId = new Map(view.tasks.map((/** @type {any} */ t) => [t.id, t]));
  const real = view.counts.total - view.counts.dropped;
  const lay = boxesOf(view.tasks, { open: { steps: true }, fired, keep });
  return [
    `Task graph${view.goal ? ` — ${view.goal}` : ""}`,
    `${view.counts.done} of ${real} done${view.closed ? ` · closed: ${view.closed.reason}` : ""}`,
    ...lay.rows.flatMap((ids, i) => [
      "",
      `Step ${i + 1}`,
      ...ids.flatMap((id) => [id, ...(lay.groups.get(id) || [])]).flatMap((id) => [[id, ""], ...(lay.steps.get(id) || []).map((k) => [k, "  "])]).map(([id, pad]) => {
        const t = byId.get(id);
        const st = drawnState(t, progress);
        const needs = t.needs.filter((/** @type {string} */ n) => byId.has(n));
        return `${pad}- [${st === "done" ? "x" : " "}] ${t.id} ${t.name} — ${WORDS[st]}${needs.length ? ` · needs ${needs.join(", ")}` : ""}`;
      }),
    ]),
  ].join("\n");
}

/**
 * The lines as SVG (D4, D5), in the order given — the quiet ones first, the chosen task's last: each path carries its
 * look and the tasks it stands for at either end (`data-ids`), so the task the pointer rests on lights its own
 * (`lightLines`). Shapes, class names and task ids only, so the markup is the page's own.
 * @param {readonly { cls: string, d: string, ids: readonly string[] }[]} paths @param {number} W @param {number} H
 */
export function linesSvg(paths, W, H) {
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${paths.map((p) => `<path class="${p.cls}" d="${p.d}" data-ids="${p.ids.join(" ")}"/>`).join("")}</svg>`;
}

/**
 * The lines of the task the pointer rests on, lit (the redesign's hover): those it needs and those that need it; none
 * where it rests on none. @param {any} edges  the lines' element @param {string | null} id
 */
export function lightLines(edges, id) {
  for (const p of Array.from(edges?.querySelectorAll?.("path") || [])) {
    const ids = String(/** @type {any} */ (p).getAttribute("data-ids") || "").split(" ");
    /** @type {any} */ (p).classList.toggle("hov", !!id && ids.includes(id));
  }
}

/**
 * Whether a Reviewer sent to hunt still works: the chat's list says it runs, or the page started it and the list has
 * not said it yet. @param {Hunter} s
 */
const hunting = (s) => !!s.running || (!s.ended && s.at > 0);
/** How a hunt that ended with its report ended, in the chat's list's word (lib/subagents.js `statusWord`, as plan.js hands it on). */
const REPORTED = "finished";

/**
 * A hunted task's box (the owner's yes of 11-05: a hunt's fixes "inside the same node card"): the Reviewers sent to hunt
 * from it — the page's, then any its fixes name that the page has not — each with the fixes its finding became, in the
 * view's order; whether nothing in it is open — no Reviewer hunting, every fix done or dropped — so it folds to one
 * strip, unless the person opened it (`opened`); and how much taller than one line it draws, px.
 * @typedef {{ hunters: { s: Hunter, fixes: any[] }[], fixes: any[], foldable: boolean, folded: boolean, tall: number }} HuntBox
 * @param {any[]} fixes @param {Hunter[]} fired @param {boolean} opened @param {{ h: number, strip: number }} unit
 * @returns {HuntBox}
 */
export function huntBoxOf(fixes, fired, opened, unit) {
  /** @type {Hunter[]} */
  const all = [...fired];
  for (const f of fixes) if (!all.some((s) => s.agent === f.foundBy.agent)) all.push({ agent: f.foundBy.agent, name: f.foundBy.name, model: "", at: 0 });
  const hunters = all.map((s) => ({ s, fixes: fixes.filter((f) => f.foundBy.agent === s.agent) }));
  const foldable = !fired.some(hunting) && fixes.every((f) => f.state === "done" || f.state === "dropped");
  const folded = foldable && !opened;
  return { hunters, fixes, foldable, folded, tall: folded ? unit.strip : hunters.length * unit.strip + fixes.length * unit.h };
}

/**
 * A plan step's box (the owner's plan mode of 11-06): its sub-tasks in the order they run, how many of those not
 * dropped are done, and whether it folds to its strip — as the person left it (`opened`), else folded unless one of
 * them is at work or calls for you; a sub-task chosen holds it open — and how much taller than one line it draws, px.
 * @typedef {{ kids: any[], done: number, live: number, dropped: number, folded: boolean, tall: number }} StepBox
 * @param {any[]} kids @param {boolean | null} opened @param {string | null | undefined} chosen
 * @param {Map<string, TaskProgress> | null | undefined} progress @param {{ h: number, strip: number }} unit
 * @param {(id: string) => number} [more]  how much taller than its line a sub-task draws: its hunt's strips
 * @returns {StepBox}
 */
export function stepBoxOf(kids, opened, chosen, progress, unit, more = () => 0) {
  const live = kids.filter((k) => k.state !== "dropped");
  const busy = kids.some((k) => {
    const st = drawnState(k, progress);
    return AT_WORK.has(st) || Object.hasOwn(CALLS, st);
  });
  const folded = !kids.some((k) => k.id === chosen) && (opened === null ? !busy : !opened);
  return {
    kids,
    done: live.filter((k) => k.state === "done").length,
    live: live.length,
    dropped: kids.length - live.length,
    folded,
    tall: unit.strip + (folded ? 0 : kids.reduce((n, k) => n + unit.h + more(k.id), 0)),
  };
}

/** A plan step's sub-tasks, in a strip's words: how many done, how many dropped. @param {StepBox} sb */
const subsWords = (sb) => (sb.live ? `${sb.done} of ${sb.live} done${sb.dropped ? ` · ${sb.dropped} dropped` : ""}` : sb.dropped === 1 ? "its one dropped" : `all ${sb.dropped} dropped`);

/**
 * The graph drawn whole (HarnessV4_TaskGraphPlus_Design, E41 P4; the Product agent's redesign of 11-05, the owner's
 * yes): the head — its figures, the goal, a straight line's fact (D18), the page's tools and Run log — the held
 * callout, a closed graph's outcome, the offer of tasks that can run in parallel (D10), then the graph. On the Plan
 * tab, one canvas (lib/graph-boxes.js lays it out) under its bar — Rearrange, top to bottom or left to right, −, + and
 * Fit — the finished steps at its top
 * folded into a row (D16), moved by hand on the page (views/canvas-pan.js); and the chosen task's one card (D9), beside the canvas where
 * the room holds both, else under it. Beside the chat (`pane`) the same steps run down a rail, the chosen task's card
 * under its line, and no card opens on its own; `autoPick: false` likewise. A plan's step and its sub-tasks are one
 * box (11-06): its line, a strip of how many are done that folds them, their lines.
 * `popped` names the tasks whose state just changed (stateChanges); `progress` holds each running worker's newest step,
 * and `onOpenAgent` opens a sub-agent's or a worker's conversation; `onSendBack` sends a failed task back in the
 * developer's own name; `crew` says who plans it, for the words, `members` who a team's tasks go to, and
 * `shippedCrew` who a seat of the crew every shipped team has is where no member names it. `atWork:
 * false` says the chat's agent is not at work now: its own running task is drawn between turns, its arc still (D1-1).
 * `width` is the room the page gives it (`layoutOf`), `height` the canvas's own as the page measured it (none yet: Fit
 * goes by the width alone), `font` the size of the page's type, which the boxes' size follows.
 * `fold` holds the person's Show or Hide of the finished steps, `hunts` the hunt boxes done that the person opened,
 * `steps` the plan steps the person opened or folded — null where they left one as it comes —
 * `zoom` the person's zoom — null for Fit — and its setter, `pan` where the canvas was panned to, at which zoom, and
 * its keeper (the page's: `restore` puts it back once the drawing is on the page at the same zoom, else at the canvas's
 * start), `more` each card's folded parts, `tools` the head's buttons, `onSideBySide` the button of the card the agent
 * suggested. `arrange` the canvas's layout as the person left it (the owner's of 11-14) — the way it is drawn, top to
 * bottom unless they turned it, the order their Rearrange found, what it said — and its two buttons' hands. `fit` says,
 * for a width and the canvas's height, what of the drawing they would change: the same words for two rooms, the same
 * drawing.
 * @param {any} view  graphView's answer
 * @param {{ h?: Mk, chosen?: string | null, onChoose?: (id: string) => void, popped?: Set<string>, now?: number,
 *   onRunLog?: (() => void) | null, progress?: Map<string, TaskProgress> | null,
 *   onOpenAgent?: ((id: string) => void) | null, onReview?: ((agent: string) => void) | null, onSendBack?: ((id: string, fresh: boolean) => void) | null, crew?: Crew,
 *   members?: Members, shippedCrew?: readonly import("../lib/team.js").CrewSeat[] | null, atWork?: boolean, kept?: KeptPane | null, hunt?: HuntPane | null, width?: number | null, height?: number | null, font?: number | null,
 *   pane?: boolean, autoPick?: boolean, fold?: { open: boolean, onToggle: () => void } | null,
 *   hunts?: { open: (id: string) => boolean, toggle: (id: string) => void } | null,
 *   steps?: { open: (id: string) => boolean | null, toggle: (id: string, folded: boolean) => void } | null,
 *   zoom?: { z: Zoom, set: (z: Zoom) => void } | null,
 *   arrange?: { dir: import("../lib/graph-lanes.js").Dir, order: string[][] | null, said?: string | null,
 *     onDir: (dir: import("../lib/graph-lanes.js").Dir) => void, onRearrange: (order: string[][], words: string) => void } | null,
 *   pan?: { at: Pan | null, set: (at: Pan) => void } | null,
 *   more?: { open: (id: string) => boolean, toggle: (id: string) => void } | null, tools?: any[],
 *   onSideBySide?: ((ids: string[]) => void) | null, sideAsked?: { ids: string[], at: number } | null,
 *   justDone?: Map<string, number> | null, onApprove?: (() => void) | null, approveLater?: boolean,
 *   onOpenChain?: ((chainId: string) => void) | null }} [o]  `onOpenChain`: opens the chat a closed plan was carried on in
 *   (piece E). `kept`: what
 *   is kept behind the tasks (E33); none draws none. `hunt`: a done task's Hunt for bugs (UX9); none draws none.
 *   `onSideBySide` opens the side-run sheet (10-28); `sideAsked`: the agent was asked to run these instead, and when;
 *   `justDone`: the tasks just done (plan.js `celebrate`), each with how long ago, ms — marked where they stand, their
 *   line or the row or strip they folded into, in phase however often the view draws again; `onApprove`: the person's
 *   Approve of a plan that waits for it (the owner's plan mode of 11-06), the button its callout offers — none while
 *   the agent's turn runs or its question waits, where `approveLater` says when it comes
 * @returns {{ el: any, flow: any, shown: { id: string, el: any } | null, current: { id: string, el: any } | null,
 *   at: (id: string) => any, mode: "beside" | "under", inspector: any, restore: () => void, fit: (width: number | null | undefined, height?: number | null) => string,
 *   viewport: any, zoom: number, patch: (progress: Map<string, TaskProgress> | null | undefined) => boolean }}
 *   `shown`: the card's task; `current`: the task the page would pick with none chosen (`chosenTask`), which the view
 *   beside the chat follows; `at`: where a task stands — its line, else the row or strip that folds it; `inspector`:
 *   the card beside the canvas, which scrolls itself (views.css), none under it; `viewport`: the
 *   canvas's scroller, both ways, none on the rail; `zoom` the one it draws at; `patch`: the running tasks' newest
 *   steps said in the drawing as it stands, false where they would change more than its lines' words
 */
export function drawGraph(view, o = {}) {
  // The agent's own task between its turns: running, its arc still (a team's lead plans apart from the chat's turn,
  // and its graph stays as it is).
  if (o.atWork === false && (o.crew || "agent") === "agent") view = betweenTurns(view);
  const mk = o.h || h;
  const now = o.now ?? Date.now();
  const w = crewWords(o.crew || "agent", o.members || null, o.shippedCrew || null);
  /** @type {any[]} */
  const tasks = view.tasks;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const c = view.counts;
  const unit = sizesFor(o.font);
  // The hunt boxes (the owner's yes of 11-05): each task hunted, with the Reviewers sent from it and the fixes their
  // findings became — a fix hunted in its turn stands apart, a box of its own — folded once nothing in it is open,
  // unless the person opened it or chose a fix in it.
  const firedFrom = (/** @type {string} */ id) => (o.hunt ? o.hunt.started(id) : []).length > 0;
  const groups = groupsOf(tasks, firedFrom);
  const inBox = new Set([...groups.values()].flat());
  // A plan's steps (the owner's plan mode of 11-06): each with its sub-tasks in one box, folded to a strip unless one
  // of them is at work or calls for you, or the person opened it; a sub-task's hunt stands in the box with it.
  const subs = stepsOf(tasks);
  /** @type {Map<string, HuntBox>} */
  const hunted = new Map();
  for (const t of tasks) {
    if (inBox.has(t.id) || subs.has(t.id)) continue;
    const fixes = (groups.get(t.id) || []).map((id) => byId.get(id));
    const fired = o.hunt ? o.hunt.started(t.id) : [];
    if (!fixes.length && !fired.length) continue;
    hunted.set(t.id, huntBoxOf(fixes, fired, !!o.hunts?.open(t.id) || fixes.some((f) => f.id === o.chosen), unit));
  }
  /** @type {Map<string, StepBox>} */
  const stepped = new Map([...subs].map(([id, ks]) => [id, stepBoxOf(ks.map((k) => byId.get(k)), o.steps?.open(id) ?? null, o.chosen, o.progress, unit, (k) => hunted.get(k)?.tall || 0)]));
  /** Whether a box has a hunt still working: its own, or a sub-task's. @param {string} id */
  const huntsOn = (id) => [id, ...(stepped.get(id)?.kids.map((k) => k.id) || [])].some((x) => !!hunted.get(x)?.hunters.some(({ s }) => hunting(s)));
  // Laid out as the person left it (the owner's of 11-14): top to bottom unless they turned it, in the order their
  // Rearrange found.
  const layOpts = { open: { steps: !!o.fold?.open }, box: unit, tall: (/** @type {string} */ id) => hunted.get(id)?.tall || stepped.get(id)?.tall || 0, busy: huntsOn, fired: firedFrom, dir: o.arrange?.dir || "down", keep: o.arrange?.order || null };
  const lay = boxesOf(tasks, layOpts);
  /** The tasks with a line of their own: none folded into the finished steps' row, a hunt box's strip or a step's. */
  const folded = new Set([...lay.hidden, ...[...hunted.values()].filter((b) => b.folded).flatMap((b) => b.fixes.map((f) => f.id)), ...[...stepped.values()].filter((b) => b.folded).flatMap((b) => b.kids.map((k) => k.id))]);
  const shownTasks = tasks.filter((t) => !folded.has(t.id));
  /** A task that does work of its own: no step with sub-tasks (11-06), whose state is theirs. @param {any} t */
  const own = (t) => !t.subtasks?.length;
  // The card's pick with none chosen looks at the work before the steps it rolls up into.
  const pickFrom = [...shownTasks.filter(own), ...shownTasks.filter((t) => !own(t))];
  // The task the card shows: on the page, the one that needs you unless the person chose (D17); beside the chat, only
  // the one the person chose (D14). The page's pick is among the tasks with a line, and a choice of the person's that
  // folded since gives way to it.
  const auto = o.autoPick !== false && !o.pane;
  const chosen = auto
    ? chosenTask({ ...view, tasks: pickFrom }, o.chosen, o.progress) || null
    : shownTasks.find((t) => t.id === o.chosen) || null;
  // The page's own pick with none chosen: the work's task, which the view beside the chat follows.
  const workOn = chosenTask({ ...view, tasks: pickFrom }, null, o.progress) || null;
  /** How long ago each task just done was done, ms: none for the rest. */
  const doneAgo = o.justDone || new Map();
  /** The mark of tasks just done, for a line or a row that folds some: its class and its delay, in phase. @param {readonly string[]} ids */
  const justDoneOf = (ids) => {
    const ago = Math.min(...ids.map((id) => doneAgo.get(id) ?? Infinity));
    return Number.isFinite(ago) ? { cls: " is-just-done", style: `--jd:-${Math.round(ago)}ms` } : null;
  };
  /**
   * The room the canvas has at a width: beside a card, what the card leaves it, less the canvas's frame; 0 not measured
   * yet — and down, the canvas's own height as the page measured it, none not measured.
   * @param {number | null | undefined} width @param {number | null | undefined} height @returns {Extent}
   */
  const roomFor = (width, height) => ({ w: Math.max(0, (layoutOf(width) === "beside" && chosen ? Number(width) - CARD_BESIDE : Number(width) || 0) - CANVAS_FRAME), h: Number(height) > 0 ? Number(height) : null });
  /** The zoom the canvas draws at in a room: the person's, else Fit's for it. @param {number | null | undefined} width @param {number | null | undefined} height */
  const zoomAt = (width, height) => zoomOf(o.zoom?.z ?? null, { w: lay.w, h: lay.h }, roomFor(width, height));
  const mode = o.pane ? "under" : layoutOf(o.width);
  const z = zoomAt(o.width, o.height);
  // The rail is the same in any room.
  const fit = (/** @type {number | null | undefined} */ width, /** @type {number | null | undefined} */ height = o.height) => (o.pane ? "rail" : `${layoutOf(width)}/${zoomAt(width, height)}`);
  const real = c.total - c.dropped;
  // The figures count the work: a step with sub-tasks is counted in them (graphView's counts likewise).
  const work = tasks.filter(own);
  const drawn = work.map((t) => drawnState(t, o.progress));
  /** @param {string} st */
  const many = (st) => drawn.filter((x) => x === st).length;

  // The head's figures: how much is done, then what runs at once (`lanesOf`: Filament's check, a reviewer reading and a
  // merge under way are work going on too; the agent's own tasks one lane, none between its turns — the owner's of
  // 11-09) and what waits paused, and in colour what asks you (orange) or failed (red, as its box, D11); then the time
  // and the spend. A graph still to start has no time yet.
  const going = laneCount(lanesOf(work, o.progress));
  /** @type {{ text: string, call?: "asking" | "failed" }[]} */
  const figs = [
    { text: `${c.done} of ${real} done` },
    ...(going ? [{ text: `${going} running` }] : []),
    ...(many("paused") ? [{ text: `${many("paused")} paused` }] : []),
    ...(many("asking") ? [{ text: `${many("asking")} ${many("asking") === 1 ? "asks" : "ask"} you`, call: /** @type {const} */ ("asking") }] : []),
    ...(many("failed") ? [{ text: `${many("failed")} failed`, call: /** @type {const} */ ("failed") }] : []),
    ...(view.startedAt ? [{ text: minutesWords(graphSpan(view, now)) }] : []),
    ...(Number(view.spentUsd) > 0 ? [{ text: `${usd(view.spentUsd)} by ${w.workers}` }] : []),
  ];
  /** The figures with their dots, the plain words run together and the calls apart, in their colour. @type {any[]} */
  const figKids = [];
  figs.forEach((f, i) => {
    const sep = i ? " · " : "";
    if (f.call) {
      if (typeof figKids.at(-1) === "string") figKids[figKids.length - 1] += sep;
      else if (sep) figKids.push(sep);
      figKids.push(mk("span", { class: `tg-fig-call is-${f.call}` }, f.text));
    } else if (typeof figKids.at(-1) === "string") figKids[figKids.length - 1] += `${sep}${f.text}`;
    else figKids.push(`${sep}${f.text}`);
  });
  // What is kept behind the graph itself (E33): said under the goal, its card opened from there.
  const ownKept = view.kept && o.kept ? /** @type {KeptPane} */ (o.kept) : null;
  // A plan that is one straight line is drawn as one, and the head says why it looks like a list (D18).
  const straight = straightLine(tasks);
  const headEl = mk("div", { class: "tg-head" },
    o.pane ? null : mk("span", { class: "tg-tile", "aria-hidden": "true", html: ICONS.network }),
    mk("div", { class: "tg-ht" },
      mk("div", { class: "tg-title" }, mk("span", { class: "tg-title-name" }, "Task graph"), mk("span", { class: "tg-figs" }, ...figKids)),
      mk("div", { class: "tg-goal" }, view.goal || "The agent's checklist"),
      straight ? mk("div", { class: "tg-fact" }, mk("span", { class: "tg-fact-ic", "aria-hidden": "true", html: ICONS.info }), "One straight line: each task waits for the one before it, so none can run in parallel.") : null,
      ownKept ? mk("button", { class: `tg-kept-graph${ownKept.graphShown ? " is-open" : ""}`, type: "button", "aria-expanded": ownKept.graphShown ? "true" : "false", onclick: () => ownKept.onGraph() }, `Kept behind the graph: ${keptWords(view.kept)}`) : null),
    ...(o.tools?.length || o.onRunLog ? [mk("div", { class: "tg-head-acts" }, ...(o.tools || []), o.onRunLog ? link(mk, "Run log", o.onRunLog) : null)] : []));
  const graphKept = ownKept?.graphShown ? keptCard(mk, null, view.kept, ownKept, now) : null;

  // A closed graph says how it ended, in a sentence under the head: there is nothing in it to carry on with. A plan
  // that waits for the person's Approve (11-06) says so, with the Approve its card under the reply has — a woken turn
  // may stand between. Held since the developer's stop, nothing of the workers' starts until the next tasks call of
  // whoever plans.
  const callout = view.closed
    ? mk("p", { class: "tg-closed" }, mk("span", { class: "tg-mark is-done", "aria-hidden": "true", html: MARKS.done }), mk("span", {}, mk("strong", {}, "Closed"), ` — ${view.closed.reason}`, view.closed.to && o.onOpenChain ? [" ", link(mk, "Open that chat", () => o.onOpenChain?.(view.closed.to))] : null))
    : view.planning
      ? mk("div", { class: "tg-callout tg-plan-wait" },
          mk("span", {}, mk("strong", {}, "Waits for your approval"), ` — Filament starts no ${w.worker}'s task until you approve the plan. To change it, send /plan with what to change.`),
          o.onApprove
            ? mk("button", { class: "tg-act", type: "button", title: "Sends your go: the plan's tasks start as their needs are done.", onclick: () => o.onApprove?.() }, "Approve")
            : o.approveLater
              ? mk("span", { class: "tg-plan-later" }, "Approve once your agent's turn ends")
              : null)
    : view.held
      ? mk("div", { class: "tg-callout" }, mk("strong", {}, "Held"), ` — since your stop: Filament starts no ${w.worker}'s task until ${w.planner}'s next tasks call.`)
      : null;

  // The ready tasks the agent suggested to run in parallel, while its card stands (the owner's of 11-10: the agent puts
  // it, never Filament by itself): the button opens the side-run sheet — nothing starts by itself (GX-D6).
  const side = !view.closed && o.onSideBySide && Array.isArray(view.offer?.ids) && view.offer.ids.length >= 2 ? /** @type {string[]} */ (view.offer.ids) : null;
  // Asked the agent instead (the sheet's Ask your agent…): said until the tasks it was asked of start, or change — those
  // it named alone where the sheet had some unticked (the Hunter's of 10-28), the offer's button kept for the rest.
  const asked = side && o.sideAsked && o.sideAsked.ids.length && o.sideAsked.ids.every((id) => side.includes(id)) ? o.sideAsked : null;
  const askedSome = !!asked && asked.ids.length < /** @type {string[]} */ (side).length;
  const sideEl = side
    ? mk("div", { class: `tg-sbs${o.pane ? " is-narrow" : ""}` },
        mk("span", { class: "tg-sbs-ic", "aria-hidden": "true", html: ICONS.columns2 }),
        mk("span", { class: "tg-sbs-t" }, "Your agent suggests ", ...side.flatMap((id, i) => [i ? (i === side.length - 1 ? " and " : ", ") : null, chipOf(mk, id, byId, o.progress || null)]), " ", mk("b", {}, "run in parallel"), " — none needs another's work."),
        asked
          ? mk("span", { class: "tg-sbs-asked" }, askedSome ? `Asked your agent ${clockOf(asked.at)} to run ${listWords(asked.ids)} — waiting for it to start ${asked.ids.length === 1 ? "it" : "them"}` : `Asked your agent ${clockOf(asked.at)} — waiting for it to start them`)
          : null,
        !asked || askedSome
          ? mk("button", { class: "tg-act", type: "button", title: "Opens a sheet: each task's model and where it works. Nothing starts until you press Run.", onclick: () => o.onSideBySide?.(side) }, "Run them in parallel…")
          : null)
    : null;

  const cardOf = (/** @type {any} */ t) =>
    card(mk, t, view, byId, now, { onOpenAgent: o.onOpenAgent || null, onReview: o.onReview || null, w, onSendBack: !view.closed ? o.onSendBack || null : null, crew: o.crew || "agent", kept: t.kept && o.kept ? o.kept : null, hunt: o.hunt || null, progress: o.progress || null, more: o.more || null, pane: !!o.pane });

  /** @type {{ id: string, el: any } | null} */
  let shown = null;
  /** @type {{ id: string, el: any } | null} */
  let current = null;
  /** Where each task stands: its line, else the row or strip that folds it. @type {Map<string, any>} */
  const places = new Map();
  /** Each task's line as drawn, with the face it was made from (`patch`). @type {{ t: any, el: any, factEl: any, f: ReturnType<typeof faceOf>, rest: string }[]} */
  const lines = [];
  /** The lines' picture once drawn: the task the pointer rests on lights its own. @type {any} */
  let edges = null;
  /**
   * What a task's line says: its state and its one fact — in colour what calls for you, else what it took, what it does
   * now, on the rail what it waits for — and in its tooltip the rest of what it is (the owner's "into the card"): what
   * it does now, who does it, what it needs, the thread of memory it finishes, what is kept behind it, the hunts fired
   * from it, what found it, that you ran it. A description the line is made from, and that `patch` makes again for the
   * running tasks' newest steps: its fact a call's pill (`{ call }`) or words.
   * @param {any} t @param {Map<string, TaskProgress> | null | undefined} [progress]  as drawn, else the steps `patch` takes
   * @param {Set<string> | null | undefined} [popped]
   */
  const faceOf = (t, progress = o.progress, popped = o.popped) => {
    const st = drawnState(t, progress);
    const as = doerOf(t);
    const who = whoWords(as, w);
    const call = CALLS[/** @type {keyof typeof CALLS} */ (st)] || null;
    const blocked = !!t.blocked && OPEN.has(t.state);
    const said = nowLine(t, byId, now, view, progress, w);
    const line = `${blocked ? "blocked · " : ""}${said}`;
    const needs = t.needs.filter((/** @type {string} */ n) => byId.has(n));
    // The Reviewers sent to hunt from it (UX9), from the chat's list — a reload and a restart keep them — so a second
    // hunt of the same work is a choice, never an accident.
    const fired = o.hunt ? o.hunt.started(t.id) : [];
    // A plan's step stands as its sub-tasks do, and a sub-task says whose it is (11-06).
    const sb = stepped.get(t.id);
    const step = t.under && stepped.has(t.under) ? byId.get(t.under) : null;
    const subsSaid = sb ? `${sb.live || sb.dropped} sub-tasks, ${subsWords(sb)}` : "";
    const partOf = step ? `part of ${step.id} ${step.name}` : "";
    // The files it shares with other writers, and how its merge stands (the owner's of 11-09): a chip, whole in its title —
    // a writer that shares none, its merge where it calls for a look (the hunt on g2).
    const share = t.shares ? `shares ${listWords(t.shares.files)}${t.shares.with.length ? ` with ${listWords(t.shares.with)}` : ""}${t.shares.merge ? ` · ${t.shares.merge}` : ""}` : t.merge || "";
    // The lines are pictures: a screen reader hears what the task needs in its name (the Designer's note 9).
    // A done task reopened (11-09): one box, its round said.
    const round = t.round > 1 ? `round ${t.round}` : "";
    const label = `${t.id} ${t.name}: ${t.between ? "running, between turns" : WORDS[st]}${round ? `, ${round}` : ""}${as === "you" || !who ? "" : ` (${who})`}${subsSaid ? `; ${subsSaid}` : ""}${partOf ? `; ${partOf}` : ""}${needs.length ? `; needs ${listWords(needs)}` : ""}${t.foundBy ? `; found by ${t.foundBy.name} on ${t.foundBy.task}` : ""}${fired.length ? `; ${huntersWords(t.id, fired)}` : ""}`;
    const cls = `is-${st}${t.between ? " is-still" : ""}${chosen?.id === t.id ? " is-on" : ""}${popped?.has(t.id) ? " is-new" : ""}`;
    const open = openNeeds(t, byId);
    /** @type {string | { call: string }} */
    const fact = call
      ? { call }
      : st === "done"
        ? t.startedAt && t.endedAt ? tookWords(t.endedAt - t.startedAt) : ""
        : st === "dropped"
          ? WORDS[st]
          : sb && sb.live
            ? `${sb.done} of ${sb.live} done`
            : st === "ready" || st === "waiting"
              ? t.blocked ? "blocked" : st === "ready" ? WORDS[st] : t.proposed ? "proposed" : t.stopped ? "stopped" : (o.pane || step) && open.length ? `after ${open.join(", ")}` : ""
              : t.between ? "between turns" : line;
    // A command task is Filament's own: no seat does it.
    const role = as === "command" ? null : whoOfTask(as, w.members, w.shippedCrew);
    const by = as === "command"
      ? WHO.command
      : role?.worker
        ? `${role.word}: ${t.writes?.length ? `it changes files ${WORKSPACE_PLACE[t.workspace] || "in its own worktree"}` : "it reads and reports"}`
        : as === "sub-agent" ? `An agent does it, ${WORKSPACE_PLACE[t.workspace] || "in its own worktree"}` : as === "explorer" ? "An explorer does it: it reads and reports" : "";
    const tip = [
      `${t.id} ${t.name}`,
      // Its state, blocked, then its line — each word once: a line that starts with its state's word says it.
      [WORDS[st], round, blocked ? "blocked" : "", said === WORDS[st] ? "" : said.startsWith(`${WORDS[st]} · `) ? said.slice(WORDS[st].length + 3) : said].filter(Boolean).join(" · "),
      // What its round before it did, kept as the box's earlier round (11-09).
      t.earlier?.done ? `Done in round ${t.earlier.done.round}: ${t.earlier.done.summary}` : "",
      by,
      subsSaid ? `${subsSaid.charAt(0).toUpperCase()}${subsSaid.slice(1)}` : "",
      partOf ? `${partOf.charAt(0).toUpperCase()}${partOf.slice(1)}` : "",
      needs.length ? `Needs ${listWords(needs)}` : "",
      t.thread ? `Memory's thread ${threadLine(t, w)}` : "",
      t.kept ? `Keeps ${keptWords(t.kept)} — choose it to read them` : "",
      fired.length ? huntersWords(t.id, fired) : "",
      t.foundBy ? foundWords(t, byId) : "",
      // Started by you (10-28): the developer's side run, apart from what the agent started.
      t.side ? `You ran it on a sub-agent — ${t.side.model}, ${t.side.folder === "copy" ? "in its own copy" : "in your folder"}` : "",
      share ? `${share.charAt(0).toUpperCase()}${share.slice(1)}` : "",
    ].filter(Boolean).join("\n");
    // A right-click on a done task's line opens its Hunt for bugs where the line is (UX9): the card may be folded away
    // under the graph, or not open at all. On a focused line the keyboard's menu key and Shift+F10 open it too.
    const menu = o.hunt?.onMenu && huntable(t, st) ? /** @type {(t: any, el: any) => void} */ (o.hunt.onMenu) : null;
    /** @param {() => any} el */
    const onMenu = (el) =>
      menu
        ? {
            oncontextmenu: (/** @type {Event} */ e) => { e.preventDefault(); menu(t, el()); },
            onkeydown: (/** @type {KeyboardEvent} */ e) => {
              if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
              e.preventDefault();
              menu(t, el());
            },
          }
        : {};
    return { st, label, cls, fact, tip, onMenu, share };
  };
  /** A task's mark. @param {any} t @param {string} st */
  const markEl = (t, st) => mk("span", { class: `tg-mark is-${st}${st === "done" ? markOf(t) : ""}${t.between ? " is-still" : ""}`, title: st === "done" ? markTitle(t) : t.between ? "running — between turns" : WORDS[st], "aria-hidden": "true", html: MARKS[/** @type {keyof typeof MARKS} */ (st)] });

  /** Where the layout put a box or a row, as its style. @param {import("../lib/graph-boxes.js").Box} b */
  const placeOf = (b) => `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`;
  /**
   * A task's line: its mark, its id, its name on one line, whole in its tooltip, and its one fact — where the layout put
   * it (`b`), else in the flow of a hunt box or the rail. The pointer resting on it, or the keyboard's focus, lights the
   * lines of what it needs and what needs it.
   * @param {any} t @param {import("../lib/graph-boxes.js").Box | null} b @param {string} [more]  a class more
   */
  const node = (t, b, more = "") => {
    const f = faceOf(t);
    const jd = justDoneOf([t.id]);
    const rest = `${more}${jd ? jd.cls : ""}`;
    const light = (/** @type {string | null} */ id) => () => lightLines(edges, id);
    const factEl = f.fact ? mk("span", { class: "tg-node-fact" }, typeof f.fact === "string" ? f.fact : mk("span", { class: `tg-pill is-${f.st}` }, f.fact.call)) : null;
    const el = mk("button", {
      class: `tg-node ${f.cls}${rest}`,
      type: "button",
      "data-id": t.id,
      style: [b ? placeOf(b) : "", jd ? jd.style : ""].filter(Boolean).join(";") || null,
      "aria-pressed": chosen?.id === t.id ? "true" : "false",
      "aria-label": f.label,
      title: f.tip,
      onclick: () => o.onChoose?.(t.id),
      onpointerenter: light(t.id),
      onpointerleave: light(null),
      onfocus: light(t.id),
      onblur: light(null),
      ...f.onMenu(() => el),
    },
      markEl(t, f.st),
      mk("span", { class: "tg-node-id" }, t.id),
      mk("span", { class: "tg-node-name" }, t.name),
      factEl,
      f.share ? mk("span", { class: `tg-pill tg-node-share is-${f.st}` }, f.share) : null,
      // The bar slides as if it had never been redrawn: the view draws again every moment of a run. Between turns,
      // nothing works on it: no bar.
      !t.between && goingOn(t, f.st) ? mk("span", { class: "tg-node-bar" }, mk("span", { class: "tg-node-bar-fill", style: `animation-delay:-${now % 1600}ms` })) : null);
    if (chosen?.id === t.id) shown = { id: t.id, el };
    if (workOn?.id === t.id) current = { id: t.id, el };
    places.set(t.id, el);
    lines.push({ t, el, factEl, f, rest });
    return el;
  };

  /**
   * A Reviewer's strip in its hunt box, in words: hunting, on which model, since when; else the fixes its finding
   * became and how many are done; else that its report went to whoever plans, or how its hunt ended.
   * @param {Hunter} s @param {any[]} fixes
   */
  const stripWords = (s, fixes) => {
    if (hunting(s)) return `${s.name} hunting · ${prettyModel(s.model)} · ${ago(s.at, now)}`;
    const done = fixes.filter((f) => f.state === "done").length;
    if (fixes.length) return `${s.name}'s hunt · ${fixes.length} ${fixes.length === 1 ? "fix" : "fixes"}${done ? ` · ${done} done` : ""}`;
    return !s.ended || s.ended === REPORTED ? `${s.name}'s hunt · report sent to ${w.planner}` : `${s.name}'s hunt ${s.ended}`;
  };
  /**
   * A hunted task's box (the owner's yes of 11-05): its own line, then a strip for each Reviewer sent from it, the fixes
   * its finding became under it, each a line of its own — or, once nothing in it is open, one strip that says how its
   * hunts ended, which opens it again. `b`: where the layout put it, none on the rail.
   * @param {any} t @param {HuntBox} hb @param {import("../lib/graph-boxes.js").Box | null} b
   * @param {(t: any) => any[]} lineOf  a task's line in it, and what goes under the line
   */
  const huntEl = (t, hb, b, lineOf) => {
    const hunts = o.hunts;
    const toggle = hb.foldable && hunts ? () => hunts.toggle(t.id) : null;
    const bug = () => mk("span", { class: "tg-hunt-bug", "aria-hidden": "true", html: ICONS.bug });
    const chev = (/** @type {boolean} */ up) => mk("span", { class: `tg-hunt-chev${up ? " is-up" : ""}`, "aria-hidden": "true", html: ICONS.chevronDown });
    const fired = hb.hunters.map((x) => x.s);
    /** @type {any[]} */
    let body;
    if (hb.folded) {
      const done = hb.fixes.filter((f) => f.state === "done").length;
      const last = fired.at(-1);
      const words = hb.fixes.length
        ? `Hunted · ${done} fixed${hb.fixes.length > done ? ` · ${hb.fixes.length - done} dropped` : ""}`
        : last?.ended && last.ended !== REPORTED ? `Hunted · ${last.ended}` : "Hunted · report sent";
      const jd = justDoneOf(hb.fixes.map((f) => f.id));
      const strip = mk(toggle ? "button" : "div", {
        class: `tg-hunt-strip is-folded${jd ? jd.cls : ""}`,
        title: huntersWords(t.id, fired),
        style: jd ? jd.style : null,
        ...(toggle ? { type: "button", "aria-expanded": "false", onclick: toggle } : {}),
      },
        bug(),
        mk("span", { class: "tg-hunt-strip-t" }, words),
        hb.fixes.length ? mk("span", { class: "tg-hunt-mini", "aria-hidden": "true" }, ...hb.fixes.slice(0, 6).map((f) => markEl(f, drawnState(f, o.progress)))) : null,
        toggle ? chev(false) : null);
      for (const f of hb.fixes) places.set(f.id, strip);
      body = [strip];
    } else {
      body = hb.hunters.flatMap(({ s, fixes }, i) => [
        mk("div", { class: `tg-hunt-strip${hunting(s) ? " is-running" : ""}` },
          bug(),
          mk("span", { class: "tg-hunt-strip-t" }, stripWords(s, fixes)),
          o.onOpenAgent ? link(mk, "Open", () => o.onOpenAgent?.(s.agent)) : null,
          i === 0 && toggle ? mk("button", { class: "tg-hunt-fold", type: "button", "aria-expanded": "true", title: "Fold the hunt into one line", onclick: toggle }, chev(true)) : null),
        fixes.length ? mk("div", { class: "tg-hunt-fixes" }, ...fixes.flatMap(lineOf)) : null,
      ]);
    }
    return mk("div", { class: `tg-hunt-box${hb.folded ? " is-folded" : ""}`, style: b ? placeOf(b) : null }, ...lineOf(t), ...body);
  };
  /**
   * A plan step's box (the owner's plan mode of 11-06): its own line, then a strip that says how many of its sub-tasks
   * are done — a press folds them or shows them — then, shown, each sub-task's line in the order they run, a hunted
   * one's box with its hunts. `b`: where the layout put it, none on the rail.
   * @param {any} t @param {StepBox} sb @param {import("../lib/graph-boxes.js").Box | null} b
   * @param {(t: any) => any[]} lineOf  a task's line in it, and what goes under the line
   */
  const stepEl = (t, sb, b, lineOf) => {
    const steps = o.steps;
    const toggle = steps ? () => steps.toggle(t.id, sb.folded) : null;
    const jd = sb.folded ? justDoneOf(sb.kids.map((k) => k.id)) : null;
    const strip = mk(toggle ? "button" : "div", {
      class: `tg-step-strip${sb.folded ? " is-folded" : ""}${jd ? jd.cls : ""}`,
      style: jd ? jd.style : null,
      ...(toggle ? { type: "button", "aria-expanded": sb.folded ? "false" : "true", title: `${sb.folded ? "Show" : "Fold"} the sub-tasks of ${t.id}`, onclick: toggle } : {}),
    },
      toggle ? mk("span", { class: `tg-hunt-chev${sb.folded ? "" : " is-up"}`, "aria-hidden": "true", html: ICONS.chevronDown }) : null,
      mk("span", { class: "tg-step-strip-t" }, `Sub-tasks · ${subsWords(sb)}`),
      sb.folded ? mk("span", { class: "tg-hunt-mini", "aria-hidden": "true" }, ...sb.kids.filter((k) => k.state !== "dropped").slice(0, 8).map((k) => markEl(k, drawnState(k, o.progress)))) : null);
    if (sb.folded) for (const k of sb.kids) places.set(k.id, strip);
    /** A sub-task's line, a hunted one's box. @param {any} k */
    const kidEl = (k) => {
      const hb = hunted.get(k.id);
      return hb ? [huntEl(k, hb, null, lineOf)] : lineOf(k);
    };
    return mk("div", { class: `tg-step-box${sb.folded ? " is-folded" : ""}`, style: b ? placeOf(b) : null }, ...lineOf(t), strip, sb.folded ? null : mk("div", { class: "tg-step-kids" }, ...sb.kids.flatMap(kidEl)));
  };

  const words = lay.foldLayers ? foldWords(view, lay.foldLayers, lay.folds.map((id) => byId.get(id))) : "";
  /** The finished steps folded at the top (D16), as one row that shows them. @param {import("../lib/graph-boxes.js").Box | null} b  where the layout put it, none on the rail */
  const foldRowOf = (b) => {
    if (!lay.fold) return null;
    const jd = justDoneOf(lay.hidden);
    const el = mk(o.fold ? "button" : "div", {
      class: `tg-fold${jd ? jd.cls : ""}`,
      style: [b ? placeOf(b) : "", jd ? jd.style : ""].filter(Boolean).join(";") || null,
      ...(o.fold ? { type: "button", "aria-expanded": "false", onclick: o.fold.onToggle } : {}),
    },
      mk("span", { class: "tg-fold-stack", "aria-hidden": "true" }, ...[0, 1, 2].map(() => mk("span", { class: "tg-mark is-done", html: MARKS.done }))),
      mk("span", { class: "tg-fold-t" }, words),
      o.fold ? mk("span", { class: "tg-fold-go" }, "Show them") : null);
    for (const id of lay.hidden) places.set(id, el);
    return el;
  };
  // The finished steps shown on the person's word: said over the graph — in the canvas's band, over the rail — with the
  // way to fold them again.
  const foldOpen = lay.foldLayers && o.fold?.open ? mk("div", { class: "tg-fold-open" }, `${words} — shown`, " · ", link(mk, "Fold them", o.fold.onToggle)) : null;
  const cardEl = chosen ? cardOf(chosen) : null;

  /**
   * The canvas (the redesign's): the lines under the boxes as one picture, the quiet ones first and the chosen task's
   * last; the folded steps' row; the boxes in reading order, so the keyboard goes as the eye does — all drawn at the
   * zoom, the zoom bar over it. The page moves it by hand (views/canvas-pan.js): it is drawn anew as the work moves.
   */
  const canvasOf = () => {
    const paths = lay.lines
      .map((l) => ({ l, look: lineLook(l, byId, chosen?.id || null) }))
      .sort((p, q) => p.look.p - q.look.p)
      .map(({ l, look }) => ({ cls: look.cls, d: curvePath(l.a, l.b, l.via, lay.dir), ids: [...new Set([...l.froms, ...l.tos])] }));
    edges = paths.length ? mk("div", { class: "tg-edges", "aria-hidden": "true", html: linesSvg(paths, lay.w, lay.h) }) : null;
    const across = lay.dir === "right";
    // In reading order: row by row, or drawn left to right column by column.
    const items = [...lay.boxes].sort(([, a], [, b]) => (across ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x)).map(([id, b]) => {
      const hb = hunted.get(id);
      const sb = stepped.get(id);
      return sb ? stepEl(byId.get(id), sb, b, (x) => [node(x, null)]) : hb ? huntEl(byId.get(id), hb, b, (x) => [node(x, null)]) : node(byId.get(id), b);
    });
    /** @type {any} */
    const scroller = mk("div", {
      class: "tg-canvas-view",
      onscroll: () => o.pan?.set({ x: Number(scroller.scrollLeft) || 0, y: Number(scroller.scrollTop) || 0, z }),
    },
      mk("div", { class: "tg-canvas-size", style: `width:${Math.ceil(lay.w * z)}px;height:${Math.ceil(lay.h * z)}px` },
        mk("div", { class: `tg-canvas${across ? " is-across" : ""}`, style: `width:${lay.w}px;height:${lay.h}px;--tg-h:${unit.h}px;--tg-strip:${unit.strip}px${z === 1 ? "" : `;transform:scale(${z})`}` },
          edges, foldRowOf(lay.fold), ...items)));
    const zoom = o.zoom;
    // Fit is on where the canvas draws the whole graph by itself: as it opens, where the whole of it reads.
    const fits = zoom?.z === "fit" || (zoom?.z == null && z === zoomOf("fit", { w: lay.w, h: lay.h }, roomFor(o.width, o.height)));
    const bar = zoom
      ? mk("div", { class: "tg-zoom", role: "group", "aria-label": "Zoom" },
          mk("button", { class: "tg-zoom-b", type: "button", title: "Zoom out", "aria-label": "Zoom out", disabled: z <= ZOOM.min ? "" : null, onclick: () => zoom.set(zoomStep(z, -1)), html: ICONS.minus }),
          mk("span", { class: "tg-zoom-v" }, `${Math.round(z * 100)}%`),
          mk("button", { class: "tg-zoom-b", type: "button", title: "Zoom in", "aria-label": "Zoom in", disabled: z >= ZOOM.max ? "" : null, onclick: () => zoom.set(zoomStep(z, 1)), html: ICONS.plus }),
          mk("button", { class: "tg-zoom-fit", type: "button", "aria-pressed": fits ? "true" : "false", title: "The whole graph in view, never past 100%", onclick: () => zoom.set("fit") }, "Fit"))
      : null;
    // The layout's buttons (the owner's of 11-14): Rearrange, which looks harder for an order where fewer lines cross
    // and keeps it, and the way it is drawn — top to bottom, as it always opens, or left to right.
    const arr = o.arrange;
    const dirBtn = (/** @type {import("../lib/graph-lanes.js").Dir} */ dir, /** @type {string} */ words, /** @type {string} */ icon) =>
      mk("button", { class: "tg-arrange-dir", type: "button", "data-dir": dir, title: words, "aria-label": words, "aria-pressed": lay.dir === dir ? "true" : "false", onclick: () => { if (lay.dir !== dir) arr?.onDir(dir); }, html: icon });
    const arrangeBar = arr
      ? mk("div", { class: "tg-arrange", role: "group", "aria-label": "Layout" },
          mk("button", { class: "tg-arrange-go", type: "button", title: "Lay the tasks out again with as few lines crossing as can be found, and keep that order as tasks come", onclick: () => {
            const next = boxesOf(tasks, { ...layOpts, keep: lay.order, thorough: true });
            arr.onRearrange(next.order, rearrangeWords(lay, next));
          } }, "Rearrange"),
          mk("span", { class: "tg-arrange-sep", "aria-hidden": "true" }),
          dirBtn("down", "Top to bottom", ICONS.arrowDown),
          dirBtn("right", "Left to right", ICONS.arrowRight))
      : null;
    // What a Rearrange found, said a moment: its place in the bar always there, empty while nothing is said, so the
    // focus the page puts back after a draw goes to the same button (lib/keep-focus.js finds it by its place).
    const said = arr ? mk("span", { class: "tg-arrange-said", role: "status" }, arr.said || null) : null;
    // The zoom bar in a band of its own over the ground, the finished steps shown said at its start (the owner's of
    // 11-10): it covers no task, and the canvas under it is all canvas, scrolling alone.
    return { el: mk("div", { class: "tg-canvas-box" }, bar || foldOpen || arrangeBar ? mk("div", { class: "tg-canvas-bar" }, ...kids([foldOpen, said, arrangeBar, bar])) : null, scroller), scroller };
  };

  /**
   * The rail beside the chat and in the peek (the redesign's): the same steps run down, each a box of its lines, the
   * step at work in blue; a waiting task says what it waits for, and the chosen task's card opens under its line, the
   * ids of what it needs and what needs it lit.
   */
  const railOf = () => {
    const rel = new Set(chosen ? [...chosen.needs, ...tasks.filter((t) => t.needs.includes(chosen.id)).map((t) => t.id)] : []);
    const lineOf = (/** @type {any} */ t) => [node(t, null, rel.has(t.id) ? " is-rel" : ""), chosen?.id === t.id && cardEl ? mk("div", { class: "tg-icard" }, cardEl) : null];
    const dot = (/** @type {string} */ state) => mk("span", { class: `tg-st-dot is-${state}`, "aria-hidden": "true", ...(state === "done" ? { html: TICK } : {}) });
    const first = lay.fold ? lay.foldLayers : 0;
    const steps = lay.rows.map((ids, k) => {
      const all = ids.flatMap((id) => [id, ...(lay.groups.get(id) || lay.steps.get(id) || [])]).map((id) => byId.get(id));
      const sts = all.map((t) => drawnState(t, o.progress));
      // A step is at work while something in it runs, and says who — every task of it, a step box's sub-tasks and a
      // hunt box's fixes too, the agent's own one lane — never how many boxes its row holds (the owner's of 11-09).
      // Else it says what is true, in its boxes' words: what calls for you, the agent's own task between turns, a
      // pause; one whose work waits — a slot, a review to start, a launch on its way — waits; else it is still to come.
      // A pause and what calls for you are said whatever else is, as the head says them.
      const who = lanesWords(lanesOf(all, o.progress), w);
      const calls = /** @type {(keyof typeof CALLS)[]} */ (Object.keys(CALLS)).filter((c) => sts.includes(c));
      const paused = sts.includes("paused");
      const state = all.every((t) => t.state === "done" || t.state === "dropped") && all.some((t) => t.state === "done")
        ? "done"
        : who ? "now" : calls.length ? "calls" : all.some((t) => t.between) ? "between" : paused ? "paused" : sts.some((s) => AT_WORK.has(s)) ? "waiting" : "later";
      // Before it starts, and while it waits, how many of its boxes can run at once: those still open, which need
      // nothing of each other.
      const open = ids.filter((id) => [id, ...(lay.groups.get(id) || lay.steps.get(id) || [])].some((x) => OPEN.has(byId.get(x).state))).length;
      const side = open > 1 ? ` · ${open} can run at once` : "";
      const said = state === "done"
        ? [" · done"]
        : [
            ...(state === "now" ? [" · ", mk("span", { class: "tg-st-now" }, "at work"), ` · ${who}`] : state === "between" ? [" · between turns"] : state === "waiting" ? [` · ${WORDS.waiting}`] : []),
            paused ? " · paused" : "",
            ...calls.flatMap((c) => [" · ", mk("span", { class: `tg-fig-call is-${c}` }, WORDS[c])]),
            state === "paused" || state === "waiting" || state === "later" ? side : "",
          ];
      return mk("li", { class: `tg-st is-${state}` },
        // A step that calls for you because a task of it failed: its dot in red, by a class of its own (no :has()
        // reading its words further up the rule: css-has.test.js).
        dot(state === "calls" && calls.some((c) => c === "failed") ? "calls is-failed" : state),
        mk("div", { class: "tg-st-b" },
          mk("div", { class: "tg-st-h" }, mk("b", {}, `Step ${first + k + 1}`), ...kids(said)),
          mk("div", { class: "tg-blk" }, ...ids.flatMap((id) => {
            const hb = hunted.get(id);
            const sb = stepped.get(id);
            return sb ? [stepEl(byId.get(id), sb, null, lineOf)] : hb ? [huntEl(byId.get(id), hb, null, lineOf)] : lineOf(byId.get(id));
          }))));
    });
    const fold = foldRowOf(null);
    return mk("ol", { class: "tg-rail" }, ...kids([fold ? mk("li", { class: "tg-st is-done" }, dot("done"), mk("div", { class: "tg-st-b" }, fold)) : null, ...steps]));
  };

  /** @type {any} */
  let scroller = null;
  /** @type {any} */
  let graphEl;
  if (o.pane) graphEl = railOf();
  else ({ el: graphEl, scroller } = canvasOf());
  const beside = mode === "beside" && !!cardEl;
  // On the canvas the finished steps shown are said in its band; on the rail, over it.
  const bodyEl = mk("div", { class: `tg-body is-${beside ? "beside" : "under"}` }, ...kids([mk("div", { class: "tg-graph" }, ...kids([o.pane ? foldOpen : null, graphEl])), o.pane ? null : cardEl]));
  /**
   * What of the drawing the running tasks' newest steps decide beyond a line's words: each task's drawn state — its
   * mark, its step's and the head's words, its card, the task chosen and the one followed are made of it — and what one
   * that asks you asks, which its line and its card say. @param {Map<string, TaskProgress> | null | undefined} progress
   */
  const shapeOf = (progress) =>
    tasks.map((t) => {
      const st = drawnState(t, progress);
      return st === "asking" ? `${t.id} ${st} ${JSON.stringify(askingOf(t, progress))}` : `${t.id} ${st}`;
    }).join("\n");
  const shape = shapeOf(o.progress);
  /** Two facts of the same kind: both a call's pill (its call the same), or both words, or both none. @param {any} a @param {any} b */
  const sameKind = (a, b) => typeof a === typeof b && (typeof a === "string" ? !a === !b : a.call === b.call);
  return {
    /**
     * The running tasks' newest steps said in the drawing as it stands (plan.js `paintNow`; the owner's of 11-17: the
     * page drew its whole graph again at each step of each agent): each line's words and tooltip where they moved, and
     * a task's pop let go, as a drawing made now would have them — nothing made, nothing moved. False where anything else
     * of it would change — a task's drawn state, what one asks you, a line's kind —: the page draws it anew.
     * @param {Map<string, TaskProgress> | null | undefined} progress @returns {boolean}
     */
    patch: (progress) => {
      if (shapeOf(progress) !== shape) return false;
      const next = lines.map((l) => faceOf(l.t, progress, null));
      if (lines.some((l, i) => next[i].st !== l.f.st || next[i].label !== l.f.label || next[i].share !== l.f.share || next[i].cls !== l.f.cls.replace(" is-new", "") || !sameKind(next[i].fact, l.f.fact))) return false;
      lines.forEach((l, i) => {
        const f = next[i];
        if (typeof f.fact === "string" && f.fact !== l.f.fact) l.factEl.replaceChildren(f.fact);
        if (f.tip !== l.f.tip) l.el.setAttribute("title", f.tip);
        if (f.cls !== l.f.cls) l.el.setAttribute("class", `tg-node ${f.cls}${l.rest}`);
        l.f = f;
      });
      return true;
    },
    el: mk("div", { class: `tg-view${o.pane ? " is-pane" : ""}` }, ...kids([headEl, callout, graphKept, sideEl, bodyEl])),
    flow: graphEl,
    shown,
    current,
    at: (id) => places.get(id) || null,
    mode,
    inspector: beside ? cardEl : null,
    // Panned at this zoom, the canvas stays so, across and down; at another it opens at its start.
    restore: () => {
      if (!scroller) return;
      const at = o.pan?.at;
      const same = !!at && at.z === z;
      scroller.scrollLeft = same ? at.x : 0;
      scroller.scrollTop = same ? at.y || 0 : 0;
    },
    fit,
    viewport: scroller,
    zoom: z,
  };
}

/** The tick in a finished step's dot on the rail: shapes and class names only. */
const TICK = '<svg viewBox="0 0 16 16"><path d="M4.8 8.3l2.1 2.1 4.3-4.6"/></svg>';

/**
 * A done task's mark, by what Filament's check of it found (HarnessV3-TaskGraph-v2 V2-1): green for one that passed and
 * for a task with no check; flaky where it passed on a second run; faint where a check it has was not run.
 * @param {any} t
 */
const markOf = (t) => (t.verdict?.kind === "flaky" ? " is-flaky" : t.verdict?.kind === "not" ? " is-unchecked" : "");
/** The done mark's words. @param {any} t */
const markTitle = (t) => {
  const v = t.verdict;
  if (!v) return "done";
  if (v.kind === "passed") return "done, checked: Filament's run of its check passed";
  if (v.kind === "flaky") return "done, checked (flaky): its check failed, then passed on a second run";
  return `done, unchecked: ${v.words}`;
};
/**
 * What Filament's check of a task found, in the detail's words (V2-1): each command as it ran — a second run of a red
 * one said — then those not run; failed, with the end of its output; or not run, and why.
 * @param {Mk} mk @param {any} v  the task's verdict
 */
function verdictEl(mk, v) {
  if (v.kind === "not") return `unchecked — ${v.words}`;
  const exit = (/** @type {number | null} */ x) => (x === null ? "no exit code" : `exit ${x}`);
  const runs = [
    ...(v.runs || []).map((/** @type {any} */ r) => `${r.command}: ${r.first ? `${exit(r.first.exit)}, then ${exit(r.exit)} on a second run` : exit(r.exit)}`),
    ...(v.unrun || []).map((/** @type {string} */ c) => `${c}: not run`),
  ].join("; ");
  const back = v.back === 1 ? " after going back to its worker once" : v.back > 1 ? " after going back to its worker twice" : "";
  const word = v.kind === "passed" ? "passed" : v.kind === "flaky" ? "passed, flaky" : `failed${back}`;
  // A flaky one's is its first run's: what failed there (the hunt of check-wake).
  return (v.kind === "failed" || v.kind === "flaky") && v.output ? mk("div", {}, `${word} — ${runs}`, mk("pre", { class: "tg-out" }, v.output)) : `${word} — ${runs}`;
}

/** How many times the folder's check sends a change back before whoever plans decides (V2-2): the core's. */
const GATE_RETURNS = 2;
/** A command's time in words: "6 s", "3 min". @param {number} ms */
const timeWords = (ms) => (ms < 120_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);
/**
 * What Filament's check of the folder found as a task's change merged, in the detail's words (V2-2): passed, each
 * command; red already, so it stands; undone — sent back, which time, or not and why; not undone; on the word of
 * whoever asked it in as it stood (`asker`); or not checked, and why — with the end of a red command's output.
 * @param {Mk} mk @param {any} g  the task's gate @param {string} asker  "the lead's", or its planner's
 */
function gateEl(mk, g, asker) {
  if (g.kind === "not") return `not checked — ${g.words}`;
  const exit = (/** @type {number | null} */ x) => (x === null ? "no exit code" : `exit ${x}`);
  /** @param {any} r */
  const ran = (r) => `\`${r.command}\` (${exit(r.exit)}, ${timeWords(r.ms)})`;
  const reds = (g.runs || []).filter((/** @type {any} */ r) => r.exit !== 0).map(ran).join(", ");
  const b = g.broke;
  const broke = b ? (b.own ? `its own check \`${b.command}\` failed in the folder${b.before !== null && b.before !== 0 ? ", and without its change too" : ""}` : `\`${b.command}\` failed with its change and passed without`) : "";
  const back = g.back;
  const word =
    g.kind === "passed"
      ? `passed: ${(g.runs || []).map(ran).join(", ")}`
      : g.kind === "red"
        ? `red already: ${reds} failed before its change too — it stands`
        : g.kind === "reason"
          ? `red, on ${asker} word: ${reds}`
          : g.kind === "stuck"
            ? `not undone: ${broke}, and the undo did not come through cleanly — it stands, red`
            : back && "n" in back
              ? `undone, sent back (${back.n} of ${GATE_RETURNS}): ${broke}`
              : back && "twice" in back
                ? `undone, not sent back — it went back twice already: ${broke}`
                : `undone, not sent back${back?.why ? ` (${back.why})` : ""}: ${broke}`;
  return g.output && g.kind !== "passed" ? mk("div", {}, word, mk("pre", { class: "tg-out" }, g.output)) : word;
}

/**
 * A definition list's rows: each a term and its value — words, or an element (a list).
 * @param {Mk} mk @param {[string, any, string?][]} rows
 */
const kv = (mk, rows) => mk("dl", { class: "tg-kv" }, ...rows.flatMap(([k, v, cls]) => [mk("dt", {}, k), mk("dd", cls ? { class: cls } : {}, v)]));

/**
 * Tasks by their ids, each a chip with its state's mark — what the chosen task needs, or what needs it. Null where
 * there are none: the row is left out.
 * @param {Mk} mk @param {string[]} ids @param {Map<string, any>} byId @param {Map<string, TaskProgress> | null} [progress]
 */
const chips = (mk, ids, byId, progress = null) => {
  if (!ids.length) return null;
  return mk("span", { class: "tg-chips" }, ...ids.map((id) => chipOf(mk, id, byId, progress)));
};
/** How many tasks a card's head names of what it needs, and of what needs it, before the rest fold behind a press. */
const HEAD_CHIPS = 6;
/**
 * A task by its id, a chip with its state's mark, as its box draws it: one that asks you asks, the agent's own between
 * its turns stands still.
 * @param {Mk} mk @param {string} id @param {Map<string, any>} byId @param {Map<string, TaskProgress> | null} [progress]
 */
const chipOf = (mk, id, byId, progress = null) => {
  const t = byId.get(id);
  const st = t ? drawnState(t, progress) : "waiting";
  const still = t?.between ? " is-still" : "";
  return mk("span", { class: `tg-chip is-${st}`, title: `${id}: ${still ? "running, between turns" : WORDS[st]}` }, mk("span", { class: `tg-mark is-${st}${still}`, "aria-hidden": "true", html: MARKS[st] }), id);
};
/** A row of the detail, left out where it has nothing to say. @param {string} k @param {any} v @param {string} [cls] @returns {[string, any, string?][]} */
const row = (k, v, cls) => (v === null || v === undefined || v === "" ? [] : [cls ? [k, v, cls] : [k, v]]);

/**
 * The open thread of memory a task finishes (HarnessV4_GraphThreads E28), in its card's words: its id and words, then
 * how it stands — closed with the task's summary once it is done, the user's own asked about, closed when it was done,
 * closed already, or not closed and why. Null for a task that names none.
 * @param {any} t @param {CrewWords} w @returns {string | null}
 */
export function threadLine(t, w) {
  const th = t.thread;
  if (!th) return null;
  const yours = w.planner === "the lead" ? "the developer's own" : "yours";
  const end = th.end;
  const how = !end
    ? th.own ? `${yours}: once it is done, memory asks you to close it` : "Filament closes it with the task's summary once it is done"
    : end.how === "closed" ? "closed when it was done"
      : end.how === "asked" ? `${yours}: memory asks you to close it, on the Memory page`
        : end.how === "already" ? "it was closed already when the task was done"
          : `not closed: ${end.words}`;
  return `${th.id} · “${th.text}” — ${how}`;
}

/**
 * A part of the chosen task's card, on its hairline (D9): its heading — a count or a link at its end — and what it
 * says. @param {Mk} mk @param {string | null} title @param {any} end @param {...any} body
 */
const part = (mk, title, end, ...body) =>
  mk("div", { class: "tg-sec" }, ...kids([title ? mk("div", { class: "tg-sec-h" }, mk("span", { class: "tg-sec-name" }, title), end ? (typeof end === "string" ? mk("span", { class: "tg-sec-n" }, end) : end) : null) : null, ...body]));

/** A note the graph keeps that is a checkpoint (E36, D1-3): the task's newest by its title, the older ones by theirs. @param {any} n @param {any} t */
const isCheckpoint = (n, t) => n.title === t.checkpoint?.title || /^Checkpoint \d+ · /.test(String(n.title));

/**
 * The chosen task's one card (D9): its mark, id, name and word, who does it and when it moved; then its parts on
 * hairlines, each only where it has something to say, in the order the person asks of a task in its state — a done
 * one: what was done, its steps, its done-when with the evidence and what Filament's check found, what it changed, its
 * checkpoints, what it needs and what needs it, the rest, what is kept behind it and Hunt for bugs; a paused one: its
 * newest checkpoint whole, its steps, its needs, the rest folded; a running one: its steps, its done-when with its
 * check, what it changed; one that asks you: what it asks, and Answer in its thread. A worker's report, a command's
 * runs stand where today's cards stood (D1-8). A task that takes up what a Hunter found says
 * which hunt and on which task, with the way to the hunt's thread (11-02). Beside the chat, the parts after its first
 * fold into one More line (D14).
 * @param {Mk} mk @param {any} t @param {any} view @param {Map<string, any>} byId @param {number} now
 * @param {{ onOpenAgent: ((id: string) => void) | null, w: CrewWords, onSendBack: ((id: string, fresh: boolean) => void) | null,
 *   crew: Crew, kept: KeptPane | null, hunt: HuntPane | null, progress: Map<string, TaskProgress> | null,
 *   more: { open: (id: string) => boolean, toggle: (id: string) => void } | null, pane: boolean,
 *   onReview?: ((agent: string) => void) | null }} o
 *   `onSendBack` null where nothing is sent back: a closed graph. `onReview`: the agent's row in
 *   Changes, open on its Apply — for a worker's change ready in its copy (10-28, 11-02)
 */
function card(mk, t, view, byId, now, o) {
  const { w, onOpenAgent } = o;
  const st = drawnState(t, o.progress);
  /** @type {string[]} */
  const after = view.tasks.filter((/** @type {any} */ x) => x.needs.includes(t.id) && x.state !== "dropped").map((/** @type {any} */ x) => x.id);
  // A plan's step and its sub-tasks (11-06): the step's card lists them, a sub-task's says whose it is.
  const step = t.under && byId.get(t.under) && !byId.get(t.under).under ? byId.get(t.under) : null;
  /** @type {any[]} */
  const kidTasks = view.tasks.filter((/** @type {any} */ x) => x.under === t.id && !t.under);
  const as = doerOf(t);
  const who =
    t.by === "you"
      ? w.planner === "the lead" && st !== "done" && st !== "dropped" ? "the agent's own — it waits for the lead to give it to a worker" : t.checklist ? `${WHO.you} — an item of its checklist` : WHO.you
      : `${whoWords(as, w) || "—"}${t.agent ? ` — ${t.agent}` : ""}${t.tries > 1 ? ` · try ${t.tries}` : ""}`;
  // Who does it, by its glyph: a team's seat wears its card's, an agent, an explorer and a command theirs.
  const role = as === "command" ? null : whoOfTask(as, w.members, w.shippedCrew);
  const glyph = t.by === "you" ? "" : as === "command" ? ICONS.terminal : role?.worker ? ICONS[/** @type {keyof typeof ICONS} */ (role.icon)] : as === "sub-agent" ? ICONS.bot : as === "explorer" ? ICONS.search : "";
  // What it needs and what needs it, on one line in its head (D9; the owner's of 11-10: where it stands in the graph is
  // the head's to say, with who does it and when) — HEAD_CHIPS of each, the rest a press away, kept with the card's
  // folded parts (the review of 67038d835: a task many need ran its head past the inspector).
  const chipsKey = `${t.id} chips`;
  const allChips = !o.more || o.more.open(chipsKey);
  const firstChips = (/** @type {string[]} */ ids) => (allChips || ids.length <= HEAD_CHIPS + 1 ? ids : ids.slice(0, HEAD_CHIPS));
  const chipsMore = (/** @type {string} */ words) => mk("button", { class: "tg-chip-more", type: "button", "aria-expanded": allChips ? "true" : "false", onclick: () => o.more?.toggle(chipsKey) }, words);
  const rowOf = (/** @type {string} */ name, /** @type {string[]} */ ids) => {
    const shown = firstChips(ids);
    const el = chips(mk, shown, byId, o.progress);
    return el ? [mk("span", { class: "tg-nb-k" }, name), el, shown.length < ids.length ? chipsMore(`and ${ids.length - shown.length} more`) : null] : [];
  };
  const rel = [...rowOf("Needs", t.needs), ...rowOf("Needed by", after)];
  const capped = [t.needs, after].some((ids) => ids.length > HEAD_CHIPS + 1);
  const head = mk("div", { class: "tg-card-head" },
    mk("h4", { class: "tg-card-title" },
      mk("span", { class: `tg-mark is-${st}${st === "done" ? markOf(t) : ""}${t.between ? " is-still" : ""}`, "aria-hidden": "true", html: MARKS[/** @type {keyof typeof MARKS} */ (st)] }),
      mk("span", { class: "tg-card-name", title: t.name }, mk("span", { class: "tg-card-id" }, t.id), t.name),
      mk("span", { class: `tg-badge is-${st}` }, t.between ? "between turns" : WORDS[st])),
    mk("div", { class: "tg-card-sub" }, glyph ? mk("span", { class: role?.worker ? "tg-card-by role-tile is-xs" : "tg-card-by", "aria-hidden": "true", html: glyph }) : null, `${who} · ${whenWords(t, now, w)}${step ? ` · part of ${step.id}` : ""}`),
    rel.length ? mk("div", { class: "tg-nb tg-card-rel" }, ...kids([...rel, o.more && allChips && capped ? chipsMore("Fewer") : null])) : null);

  /** Each part the card may hold, by its key: its name for the More line, and the part. @type {Map<string, { name: string, el: any }>} */
  const parts = new Map();
  /** @param {string} key @param {string} name @param {any} el */
  const put = (key, name, el) => { if (el) parts.set(key, { name, el }); };

  // What it asks you (D9): the call its worker waits on, and the one blue button that answers it.
  const asking = st === "asking" ? askingOf(t, o.progress) : null;
  if (asking) {
    const a = askWords(asking);
    const asker = askerOf(t);
    put("asks", "what it asks", mk("div", { class: "tg-sec is-ask" },
      mk("div", { class: "tg-sec-h" }, mk("span", { class: "tg-sec-name" }, "It asks you")),
      mk("p", { class: "tg-card-text" }, `${a.verb}${a.what ? ` ${a.what}` : ""}`),
      asker && onOpenAgent ? mk("div", { class: "tg-acts" }, mk("button", { class: "tg-act is-primary", type: "button", title: `Open ${asker}'s conversation, where it waits for your answer`, onclick: () => onOpenAgent(asker) }, "Answer in its thread")) : null));
  }
  // A change ready in its copy (the owner's of 11-02): the files there, who applies them, and your own way to them — its
  // row in Changes.
  if (st === "yours" && t.agent && o.onReview) {
    const n = t.report?.files?.length || 0;
    put("yours", "its change", mk("div", { class: "tg-sec is-ask" },
      mk("div", { class: "tg-sec-h" }, mk("span", { class: "tg-sec-name" }, "Ready to apply")),
      mk("p", { class: "tg-card-text" }, `${filesWords(n)} in its copy. Nothing goes into your folder until ${w.planner} applies them, or you do; the tasks that need it wait for that apply.`),
      mk("div", { class: "tg-acts" }, mk("button", { class: "tg-act is-primary", type: "button", title: `Open ${t.agent}'s row in Changes, on its Apply`, onclick: () => o.onReview?.(t.agent) }, "Review in Changes ›"))));
  }
  // Its change did not merge (the Designer's of 10-27, built 10-28): it waits in its copy, resolved from its row in
  // Changes — your choice for each file that overlaps yours, or sent back to rebase on your folder as it is now.
  if (st === "failed" && t.failures?.cause === "merge" && t.agent && o.onReview) {
    put("resolve", "its change", mk("div", { class: "tg-sec is-ask" },
      mk("div", { class: "tg-sec-h" }, mk("span", { class: "tg-sec-name" }, "Its change didn't apply")),
      mk("p", { class: "tg-card-text" }, "It waits in its copy. Choose for each file that overlaps your edits, or send it back to rebase on your folder as it is now."),
      mk("div", { class: "tg-acts" }, mk("button", { class: "tg-act is-primary", type: "button", title: `Open ${t.agent}'s row in Changes, on what stops its Apply`, onclick: () => o.onReview?.(t.agent) }, "Resolve in Changes ›"))));
  }
  // A step's sub-tasks (11-06): how many are done, each a chip with its state, in the order they run.
  if (kidTasks.length) {
    const live = kidTasks.filter((x) => x.state !== "dropped");
    const done = live.filter((x) => x.state === "done").length;
    put("subs", "sub-tasks", part(mk, "Sub-tasks", live.length ? `${done} of ${live.length} done` : "dropped", chips(mk, stepsOf(view.tasks).get(t.id) || [], byId, o.progress),
      mk("p", { class: "tg-card-quiet" }, "It does no work of its own: under way once one of them begins, done once they all are.")));
  }
  // What a Hunter found (11-02): the hunt and the task it was fired from, and the way to the hunt's thread.
  if (t.foundBy)
    put("found", "found by", mk("div", { class: "tg-sec tg-found" },
      mk("p", { class: "tg-found-t" },
        mk("span", { class: "tg-found-ic", "aria-hidden": "true", html: ICONS.bug }),
        mk("span", {}, foundWords(t, byId)),
        ...(onOpenAgent ? [" · ", link(mk, "Open the hunt", () => onOpenAgent(t.foundBy.agent))] : []))));
  // A paused task's newest checkpoint, whole (E36 case 9): where it stood, read from the note it is kept as.
  const list = o.kept ? o.kept.of(t.id) : null;
  if (t.state === "paused" && t.checkpoint) {
    const read = o.kept?.note(t.id, t.checkpoint.title) || null;
    const body = !o.kept
      ? mk("p", { class: "tg-card-quiet" }, "Its words are kept behind it, as a note of this title.")
      : !read || (read.text === null && !read.error)
        ? mk("p", { class: "tg-kept-wait" }, "Reading…")
        : read.error ? mk("p", { class: "tg-card-text" }, `Not read: ${read.error}`) : mk("p", { class: "tg-card-text" }, read.text);
    put("checkpoint", "its checkpoint", mk("div", { class: "tg-sec" }, mk("div", { class: "tg-cp-open" },
      mk("div", { class: "tg-cp-h" }, mk("span", {}, t.checkpoint.title), t.checkpoint.n > 1 ? mk("span", { class: "tg-sec-n" }, `newest of ${t.checkpoint.n}`) : null),
      body)));
  }
  // What the agent's own task did, or why it went.
  if (t.by === "you" && (st === "done" || st === "checking") && t.summary) put("did", "what was done", part(mk, "What was done", null, mk("p", { class: "tg-card-text" }, t.summary)));
  if (t.by === "you" && st === "dropped" && t.why) put("did", "why it was dropped", part(mk, "Why it was dropped", null, mk("p", { class: "tg-card-text" }, t.why)));
  if (t.goal) put("goal", "goal", part(mk, "Goal", null, mk("p", { class: "tg-card-text" }, t.goal)));
  // Its steps: a numbered list — nothing ticks a step yet, and a tick is never guessed (D8, D1-2).
  // The agent's checklist while it ran (the owner's of 11-11): each step with its mark, the one it is on turning — still
  // between the agent's turns, as the task's own mark.
  if (t.list?.length)
    put("steps", "steps", part(mk, "Steps", `${t.list.filter((/** @type {any} */ s) => s.status === "done").length} of ${t.list.length} done`,
      mk("ol", { class: "tg-steps is-ticked" }, ...t.list.map((/** @type {{ text: string, status: string }} */ s) => {
        const m = STEP_MARK[/** @type {keyof typeof STEP_MARK} */ (s.status)] || "waiting";
        return mk("li", { class: `is-${s.status}` }, mk("span", { class: `tg-mark is-${m}${t.between && m === "running" ? " is-still" : ""}`, "aria-hidden": "true", html: MARKS[m] }), mk("span", {}, s.text), s.status === "blocked" ? mk("span", { class: "tg-sec-n" }, "blocked") : null);
      }))));
  else if (t.steps.length) put("steps", "steps", part(mk, "Steps", `${t.steps.length} ${t.steps.length === 1 ? "step" : "steps"}`, mk("ol", { class: "tg-steps" }, ...t.steps.map((/** @type {string} */ s) => mk("li", {}, s)))));
  // Its done-when (D9): the acceptance, the evidence given at its done, its check and what Filament's run of it found.
  const checkEl = t.check?.length
    ? mk("div", { class: "tg-well" }, mk("span", { class: "tg-well-who" }, t.checkBy === "worker" ? `Its check — named by its ${w.worker}'s report` : "Its check"),
        mk("span", { class: "tg-cmd" }, t.check.join(", then ")), t.verdict ? null : ` — Filament runs it when ${t.id} is marked done.`)
    : null;
  const doneWhen = [
    t.acceptance ? mk("p", { class: "tg-card-text is-q" }, t.acceptance) : null,
    t.evidence ? mk("div", { class: "tg-well" }, mk("span", { class: "tg-well-who" }, "Evidence, given at its done"), t.evidence) : null,
    checkEl,
    t.verdict ? mk("div", { class: "tg-checked" }, mk("span", { class: "tg-checked-k" }, "Checked: "), verdictEl(mk, t.verdict)) : null,
  ].filter(Boolean);
  if (doneWhen.length) put("doneWhen", "done when", part(mk, "Done when", null, ...doneWhen));
  // What the folder changed while the agent's own task ran, from git (E41 P2 case 11): a fact, and the files beyond
  // its writes said as one, in grey. A running one's are so far — at a pause of its, or a done its check turned back.
  // The graph keeps the first of them by path where a task changed more (`changedMore`): the counts say "over".
  if (t.by === "you" && t.changed?.length) {
    const beyond = /** @type {string[]} */ (t.beyond || []);
    const over = t.changedMore ? "over " : "";
    put("changed", "changed", part(mk, st === "running" ? "Changed so far" : "Changed", `${over}${t.changed.length} ${t.changed.length === 1 ? "file" : "files"}`,
      mk("ul", { class: "tg-files" }, ...t.changed.slice(0, 12).map((/** @type {string} */ p) => mk("li", {}, p)), t.changed.length > 12 ? mk("li", { class: "tg-files-more" }, `and ${over}${t.changed.length - 12} more`) : null),
      beyond.length ? mk("p", { class: "tg-fact" }, mk("span", { class: "tg-fact-ic", "aria-hidden": "true", html: ICONS.info }), `${listWords(beyond.slice(0, 6))}${beyond.length > 6 ? ` and ${beyond.length - 6} more` : ""} changed too, beyond its writes.`) : null));
  }
  // How a worker's or a command's task stands: as today's cards said it (D1-8).
  const open = t.agent && onOpenAgent ? link(mk, `Open ${t.agent}`, () => onOpenAgent(t.agent)) : null;
  const report = t.by === "command"
    ? commandEnd(mk, t, st, view, w, o.onSendBack)
    : t.by === "you" ? ownEnd(mk, t, st, w) : agentEnd(mk, t, st, view, open, onOpenAgent, w, o.onSendBack, o.crew);
  if (report) put("report", report.name, report.el);
  // Its checkpoints but the one shown whole, and what else is kept behind it (E33).
  if (list?.list) {
    const cps = list.list.notes.filter((/** @type {any} */ n) => isCheckpoint(n, t) && !(t.state === "paused" && n.title === t.checkpoint?.title));
    if (cps.length) put("checkpoints", "checkpoints", part(mk, "Checkpoints", String(cps.length), keptRows(mk, t.id, { notes: cps, files: [] }, /** @type {KeptPane} */ (o.kept), now)));
    const rest = { notes: list.list.notes.filter((/** @type {any} */ n) => !isCheckpoint(n, t)), files: list.list.files };
    if (rest.notes.length || rest.files.length) put("kept", `kept behind it (${rest.notes.length + rest.files.length})`, part(mk, "Kept behind it", keptWords({ notes: rest.notes.length, files: rest.files.length }), keptRows(mk, t.id, rest, /** @type {KeptPane} */ (o.kept), now)));
  } else if (list) put("kept", "kept behind it", part(mk, "Kept behind it", t.kept ? keptWords(t.kept) : null, list.error ? mk("p", { class: "tg-card-text" }, `Not read: ${list.error}`) : mk("p", { class: "tg-kept-wait" }, "Reading…")));
  // The rest, in a list: what it writes, the thread of memory it finishes, the folder's check, its review, its merge.
  // A change merged as it stood is on its planner's word, or a lead's.
  const asker = t.overruledBy === "planner" ? `${w.planner}'s` : "the lead's";
  /** @type {[string, any, string?][]} */
  const rows = t.by === "command"
    ? [["Run", (t.run || []).join(", then "), "is-mono"], ["Items", (t.items || []).length ? `${t.items.length} — ${t.items.slice(0, 12).join(", ")}${t.items.length > 12 ? `, and ${t.items.length - 12} more` : ""}` : "none: it runs once", (t.items || []).length ? "is-mono" : undefined]]
    : [
        ...row("Writes", t.writes.join(", "), "is-mono"),
        ...(t.gate ? [/** @type {[string, any]} */ (["Folder", gateEl(mk, t.gate, asker)])] : []),
        ...(t.review ? [/** @type {[string, any]} */ (["Review", "a reviewer reads its change before it merges"])] : []),
        ...(t.overruled || t.overruledBy ? [/** @type {[string, any]} */ (["Merge", `as it stands, on ${asker} word${t.overruled ? `: ${t.overruled}` : ""}`])] : []),
        ...(t.note ? [/** @type {[string, any]} */ (["Note", t.note])] : []),
      ];
  if (t.thread) rows.push(["Memory", threadLine(t, w)]);
  if (rows.length) put("details", "details", mk("div", { class: "tg-sec" }, kv(mk, rows)));
  // A done task's Hunt for bugs: the card's foot, after all it says and its More — an action under the reading, never
  // folded: it is what a done task is chosen for (the owner's of 10-29: last, it was folded away beside the chat; of
  // 11-10: wedged between What was done and Done when, it broke the card's reading). Beside the canvas it stays in sight
  // at the inspector's foot.
  const hunt = huntCard(mk, t, st, o.hunt, now, onOpenAgent, w);

  // The order the person asks in, by state (D9), and how many parts stay open before the rest fold. What a Hunter found
  // comes after what calls for you, or what the task did (11-02).
  const ORDER = {
    done: ["subs", "did", "found", "goal", "steps", "doneWhen", "changed", "report", "checkpoints", "details", "kept"],
    paused: ["checkpoint", "subs", "found", "steps", "goal", "doneWhen", "changed", "report", "checkpoints", "details", "kept"],
    running: ["asks", "subs", "found", "goal", "steps", "doneWhen", "changed", "report", "checkpoints", "details", "kept"],
    failed: ["resolve", "report", "subs", "found", "goal", "steps", "doneWhen", "checkpoints", "details", "kept"],
    // A side run's change waiting for your Apply leads with the way to it (10-28).
    rest: ["yours", "subs", "found", "did", "report", "goal", "steps", "doneWhen", "changed", "checkpoints", "details", "kept"],
  };
  const order = st === "done" || st === "checking" ? ORDER.done : st === "paused" ? ORDER.paused : st === "running" || st === "asking" ? ORDER.running : st === "failed" ? ORDER.failed : ORDER.rest;
  const drawn = order.filter((k) => parts.has(k)).map((k) => ({ key: k, .../** @type {{ name: string, el: any }} */ (parts.get(k)) }));
  // Beside the chat the first parts stay open and the rest fold into one line (D14); a paused task's rest folds too
  // (D9). With no fold kept for it, nothing folds.
  const keep = st === "paused" ? Math.min(3, drawn.length) : o.pane ? Math.min(st === "asking" ? 2 : 3, drawn.length) : drawn.length;
  const folded = o.more && keep < drawn.length ? drawn.slice(keep) : [];
  const shownParts = folded.length && !o.more?.open(t.id) ? drawn.filter((p) => !folded.includes(p)) : drawn;
  const moreEl = folded.length
    ? mk("button", { class: `tg-sec tg-more${o.more?.open(t.id) ? " is-open" : ""}`, type: "button", "aria-expanded": o.more?.open(t.id) ? "true" : "false", onclick: () => o.more?.toggle(t.id) },
        mk("span", { class: "tg-more-ic", "aria-hidden": "true", html: ICONS.chevronRight }),
        o.more?.open(t.id) ? "Less" : mk("span", {}, "More: ", ...folded.flatMap((p, i) => [i ? " · " : null, mk("b", {}, p.name)])))
    : null;
  // Named for its task: beside the canvas it is a scroller of its own.
  return mk("section", { class: "tg-card", "aria-label": `${t.id} ${t.name}` }, head, ...shownParts.map((p) => p.el), moreEl, hunt ? mk("div", { class: "tg-card-foot" }, hunt) : null);
}

/**
 * The hunt's button, in words (UX9): starting; Hunt again while a Reviewer sent to hunt from the task still runs, so a
 * second is a choice; else Hunt bugs. @param {boolean} busy @param {Hunter[]} fired
 */
export const huntGoWords = (busy, fired) => (busy ? "Starting…" : fired.some((s) => s.running) ? "Hunt again" : "Hunt bugs");
/**
 * What the line over the hunt's button says while Reviewers sent to hunt from the task still run, or "" (UX9).
 * @param {string} id @param {Hunter[]} fired
 */
export const huntBusyWords = (id, fired) => {
  const still = fired.filter((s) => s.running).length;
  return still ? `${still === 1 ? "A Reviewer is" : `${still} Reviewers are`} still hunting bugs in what ${id} did — Hunt again starts another beside ${still === 1 ? "it" : "them"}.` : "";
};

/**
 * What the hunt runs, what it does and where its findings go, in words (UX9): the card's and the right-click popup's.
 * @param {string} id @param {string} planner  who reads its findings (`crewWords`)
 */
export const huntWhat = (id, planner) =>
  `A Reviewer reads what ${id} did and reports the bugs it can show, each with its file and line; it changes nothing. Its findings go to ${planner}: sealed while it works, with its next turn while it is stopped.`;
/** The hunt button's title: what it starts. @param {string} id */
export const huntGoTitle = (id) => `Start a Reviewer hunting bugs in what ${id} did`;

/**
 * Hunt for bugs (UX9): on a done task — never a command task, which wrote nothing — that a Reviewer sent to hunt from
 * it still runs, the model chip and Hunt bugs (Hunt again then), what the hunt runs and where its findings go, then
 * each Reviewer sent from it, with Open. A closed graph keeps it: a hunt reads, and changes no graph (cases 1, 6 to 9).
 * @param {Mk} mk @param {any} t @param {string} st @param {HuntPane | null} hunt @param {number} now
 * @param {((id: string) => void) | null} onOpenAgent @param {CrewWords} w
 */
function huntCard(mk, t, st, hunt, now, onOpenAgent, w) {
  if (!hunt || !huntable(t, st)) return null;
  const busy = hunt.busy(t.id);
  const fired = hunt.started(t.id);
  const still = huntBusyWords(t.id, fired);
  // Its name heads it as every part's does, the chip and Hunt bugs a row under it (the redesign of 11-10: in the row,
  // at the inspector's 380 px, its name broke over two lines).
  return mk("div", { class: "tg-sec tg-hunt" },
    mk("div", { class: "tg-sec-h" }, mk("span", { class: "tg-sec-name tg-hunt-t" }, "Hunt for bugs")),
    still ? mk("p", { class: "tg-hunt-busy" }, still) : null,
    mk("div", { class: "tg-hunt-acts" },
      hunt.picker,
      mk("button", { class: "tg-act is-primary", type: "button", title: huntGoTitle(t.id), ...(busy ? { disabled: "" } : {}), onclick: () => hunt.onHunt(t) }, huntGoWords(busy, fired))),
    mk("p", { class: "tg-card-quiet" }, huntWhat(t.id, w.planner)),
    ...fired.map((s) => hunterLine(mk, s, now, onOpenAgent)));
}

/**
 * How a command task's runs go (V2-3): why it failed — the failure card, with Run again — that the developer stopped it,
 * or why it was dropped; then its runs as they go or as they ended, and each that did not pass, with the end of its
 * output where it was kept; or, before it ran, when it runs.
 * @param {Mk} mk @param {any} t @param {string} st @param {any} view @param {CrewWords} w
 * @param {((id: string, fresh: boolean) => void) | null} onSendBack
 */
function commandEnd(mk, t, st, view, w, onSendBack) {
  const stopped = t.state === "waiting" && (!!t.stopped || !!t.result?.cut);
  // Done with runs that did not pass: its planner took it as done, those runs being what it was run to find (TG2-D73).
  const taken = st === "done" && !!t.result?.runs.some((/** @type {any} */ x) => !x.passed);
  const again = onSendBack ? [mk("button", { class: "tg-act is-primary", type: "button", title: `Run ${t.id} again on the folder as it stands, every item`, onclick: () => onSendBack(t.id, false) }, "Run again")] : [];
  const title = st === "failed" ? "Why it failed" : st === "dropped" ? "Why it was dropped" : stopped ? "Stopped by you" : taken ? "Taken as done" : "Its runs";
  const why =
    st === "failed"
      ? failureCard(mk, failureWords({ error: t.why, repeat: repeatWords(t) }), { inset: true, acts: again })
      : st === "dropped"
        ? mk("p", { class: "tg-card-text" }, t.why)
        : stopped
          ? mk("div", { class: "tg-card-stopped" }, mk("p", { class: "tg-card-text" }, `You stopped its runs. Filament runs it whole again at ${w.planner}'s next tasks call${onSendBack ? " — or run it again yourself" : ""}.`), ...(again.length ? [mk("div", { class: "tg-acts" }, ...again)] : []))
          : taken
            ? mk("p", { class: "tg-card-text" }, `${w.Planner} took it as done, its runs as they ended: ${t.summary}`)
            : null;
  const p = t.progress;
  const r = t.result;
  /** @type {[string, any, string?][]} */
  const rows = [];
  if (st === "running" && p) rows.push(["Runs", goingWords(p)]);
  else if (r) {
    const reds = r.runs.filter((/** @type {any} */ x) => !x.passed);
    const passed = r.runs.length - reds.length;
    rows.push(["Runs", r.cut ? `${r.runs.length} of ${r.of} before your stop, ${passed} passed, ${reds.length} not` : `${r.of} ${r.of === 1 ? "run" : "runs"}, ${atATime(r.lanes)}, ${passed} passed, ${reds.length} not (${runTime(r.ms)})`]);
    if (reds.length)
      rows.push([
        "Did not pass",
        mk("ul", { class: "tg-list" }, ...reds.map((/** @type {any} */ x) => mk("li", {}, `${x.item === null ? "" : `${x.item}: `}${x.command} → ${x.exit === null ? "no exit" : `exit ${x.exit}`}${x.invert && x.exit !== null ? ", where it was to fail" : ""} (${runTime(x.ms)})`, ...(x.output ? [mk("pre", { class: "tg-out" }, x.output)] : [])))),
        "is-mono",
      ]);
  }
  const pending = st === "running" ? "Filament runs it now; its table shows here." : view.planning ? "Filament runs it once you approve the plan; its table shows here." : view.held ? `Filament runs it after ${w.planner}'s next tasks call; its table shows here.` : "Filament runs it once its needs are done and there is room; its table shows here.";
  return { name: title.toLowerCase(), el: part(mk, title, null, ...kids([why, rows.length ? kv(mk, rows) : null, !rows.length && !why ? mk("p", { class: "tg-card-quiet" }, pending) : null])) };
}

/**
 * Who ends the agent's own task while it is open under a lead: the worker of the member the lead gives it to (G3-2).
 * The agent's own says what was done in its card's first part, and nothing while it is open.
 * @param {Mk} mk @param {any} t @param {string} st @param {CrewWords} w
 */
function ownEnd(mk, t, st, w) {
  if (w.planner !== "the lead" || st === "done" || st === "checking" || st === "dropped") return null;
  return { name: "when it is done", el: part(mk, "When it is done", null, mk("p", { class: "tg-card-quiet" }, "The lead gives it to a worker and Filament starts it, or the lead marks it done or drops it; it shows here.")) };
}

/** What a review's round found (G3-3): it does what the task asks, the changes asked, or no review. @param {any} r */
const roundWords = (r) =>
  r.status === null
    ? `no report${r.words ? ` — its last words: ${r.words}` : ""}`
    : r.status !== "done"
      ? `reported ${r.status}${r.left ? `: ${r.left}` : ""}`
      : r.met
        ? `it does what the task asks — ${r.evidence}`
        : `changes asked — ${r.left || r.evidence}`;

/**
 * How a worker's task stands: why it failed, on the one failure card (lib/failure.js) — a failure that repeats called
 * out, the developer's own Send back and Start fresh its ways on — or that the developer stopped it, with Start again
 * and Start fresh (HarnessV4_Tasks B4) and the stopped try's report — or why it was dropped, and its newest worker's report — its status and the
 * acceptance, what it did and found, what is left, the evidence, what merged or what it changed, the commands it ran
 * with their exits, and what it spent — then its review's rounds, each what it found and then its reviewer, Open for
 * its conversation, and the one reading now; or, before one ended, who starts it.
 * @param {Mk} mk @param {any} t @param {string} st @param {any} view @param {any} open
 * @param {((id: string) => void) | null} onOpenAgent @param {CrewWords} w
 * @param {((id: string, fresh: boolean) => void) | null} onSendBack @param {Crew} crew
 */
function agentEnd(mk, t, st, view, open, onOpenAgent, w, onSendBack, crew) {
  // Stopped by the developer — or by its lead (HarnessV4_Tasks B11), or by the agent with its agent tool (ag-stop) — its
  // try is set aside: it waits for whoever plans, or for the developer's own start of it.
  const stopped = t.state === "waiting" && !!t.stopped;
  const stopper = t.stopped === "lead" ? "The lead" : t.stopped === "agent" ? "Your agent" : "You";
  /** @type {any} */
  const a = stopped ? t.earlier?.report || null : t.report;
  const title = st === "failed" ? "Why it failed" : st === "dropped" ? "Why it was dropped" : stopped ? (t.stopped === "lead" ? "Stopped by its lead" : t.stopped === "agent" ? "Stopped by your agent" : "Stopped by you") : "Its report";
  const titles = sendBackTitles(t.id, crew, stopped);
  const why = stopped
    ? mk("div", { class: "tg-card-stopped" },
        mk("p", { class: "tg-card-text" }, !onSendBack
          ? `${stopper} stopped ${t.earlier?.agent || `its ${w.worker}`}.`
          : `${stopper} stopped ${t.earlier?.agent || `its ${w.worker}`}. It goes on with ${t.id} where it stopped at ${w.planner}'s next tasks call — or start it yourself.`),
        ...(onSendBack
          ? [mk("div", { class: "tg-acts" },
              mk("button", { class: "tg-act", type: "button", title: titles.fresh, onclick: () => onSendBack(t.id, true) }, "Start fresh"),
              mk("button", { class: "tg-act is-primary", type: "button", title: titles.back, onclick: () => onSendBack(t.id, false) }, "Start again"))]
          : []))
    : st === "failed"
      ? failureCard(mk, failureWords({ error: t.why, repeat: repeatWords(t) }), {
          inset: true,
          // One whose change did not merge goes back to rebase from its row in Changes (the Hunter's of 10-28): its
          // worker going on from the folder as it was meets the same overlap.
          acts: onSendBack
            ? [
                mk("button", { class: "tg-act", type: "button", title: titles.fresh, onclick: () => onSendBack(t.id, true) }, "Start fresh"),
                ...(t.failures?.cause === "merge" ? [] : [mk("button", { class: "tg-act is-primary", type: "button", title: titles.back, onclick: () => onSendBack(t.id, false) }, "Send back")]),
              ]
            : [],
        })
      : st === "dropped"
        ? mk("p", { class: "tg-card-text" }, t.why)
        : null;
  // A worker that asks you runs still: its report is to come, as a running one's.
  const pending =
    st === "running" || st === "asking"
      ? `Its report shows here once its ${w.worker} ends.`
      : view.planning
        ? `Filament starts it once you approve the plan; its ${w.worker}'s report shows here.`
      : view.held
        ? `Filament starts it after ${w.planner}'s next tasks call; its ${w.worker}'s report shows here.`
        : `Filament starts it once its needs are done and a slot is free; its ${w.worker}'s report shows here.`;
  /** @param {string} id */
  const reviewer = (id) => (onOpenAgent ? link(mk, id, () => onOpenAgent(id)) : id);
  /** @type {[string, any, string?][]} */
  const rounds = [
    ...t.reviews.map((/** @type {any} */ r) => /** @type {[string, any]} */ ([`Review ${r.round}`, mk("span", {}, `${roundWords(r)} · `, reviewer(r.agent))])),
    ...(t.state === "review" && t.step === "reading" && t.reviewer ? [/** @type {[string, any]} */ ([`Review ${t.reviews.length + 1}`, mk("span", {}, "reading the change now · ", reviewer(t.reviewer))])] : []),
  ];
  /** @type {[string, any, string?][]} */
  const rows = a
    ? [
        ["Status", a.status ? `${a.status}${a.met === true ? " · acceptance met" : a.met === false ? " · acceptance not met" : ""}` : "no report — its last words below"],
        [a.status ? "What it did" : "Last words", a.status ? a.did : a.words || "—"],
        ...(a.left ? [/** @type {[string, any]} */ (["Left", a.left])] : []),
        ...(a.evidence ? [/** @type {[string, any]} */ (["Evidence", a.evidence])] : []),
        ...(t.merged ? [/** @type {[string, any]} */ (["Applied", mergedWords(t.merged)])] : a.files.length ? [/** @type {[string, any, string]} */ (["Changed", mk("ul", { class: "tg-list" }, ...a.files.map((/** @type {any} */ f) => mk("li", {}, `${f.path} (+${f.added} −${f.removed})`))), "is-mono"])] : []),
        ...(a.unnamed.length ? [/** @type {[string, any, string]} */ (["Outside its writes", mk("ul", { class: "tg-list" }, ...a.unnamed.map((/** @type {string} */ p) => mk("li", {}, p))), "is-mono"])] : []),
        ...(a.ran.length ? [/** @type {[string, any, string]} */ (["Ran", mk("ul", { class: "tg-list" }, ...a.ran.map((/** @type {any} */ r) => mk("li", {}, `${r.command} → ${r.exit === null ? "no exit" : `exit ${r.exit}`}`))), "is-mono"])] : []),
        ["Spent", `${usd(a.spentUsd)} · ${minutesWords(a.ms)}${t.tries > 1 ? ` · ${usd(t.spentUsd)} over ${t.tries} tries` : t.reviews.length ? ` · ${usd(t.spentUsd)} with its review` : ""}`],
        ...rounds,
      ]
    : rounds;
  return { name: title.toLowerCase(), el: part(mk, title, open, ...kids([why, rows.length ? kv(mk, rows) : null, !a && !why ? mk("p", { class: "tg-card-quiet" }, pending) : null])) };
}
