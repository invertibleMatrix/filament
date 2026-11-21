// @ts-check
// Who works on a session, in the words the Team view, the dock, the Team widget and the conversation share
// (HarnessV3-Views V3): the team that leads or your agent alone, each sub-agent's and worker's card in its order, the
// tab's badge, why a switch must wait and what it costs, where the conversation's engine changes, the lead's orders
// under its reply, and the graph's tasks not started yet, as the Team view's waiting cards (G3-7). Pure: the surfaces
// draw what these say; tested in test/team-view.test.js.
import { possessive, splitNote } from "./labels.js";
import { unsent } from "../conversation/history.js";

/** The glyph of each worker that ships, on the team's purple tile (VW-D9): a member wears its place's. */
const PLACE_ICONS = Object.freeze({ builder: "hammer", reviewer: "eye" });

/**
 * @typedef {{ tag: string, name: string, may?: string, place?: string | null }} TeamMember
 *   a team's member as the settings answer names it (HarnessV4_Tasks E15 step 6): its card's tag and name, what the
 *   card may do, and its place — the shipped worker it is, or was copied from
 */

/**
 * A member's glyph: its place's — a copy of Reviewer wears the eye — else by what it may do: the glass for one that
 * only reads, the hammer for one that changes files.
 * @param {{ may?: string, place?: string | null } | null | undefined} m
 */
export const memberIcon = (m) =>
  m?.place && Object.hasOwn(PLACE_ICONS, m.place) ? PLACE_ICONS[/** @type {keyof typeof PLACE_ICONS} */ (m.place)] : m?.may === "read" ? "search" : "hammer";

/** A team by its name in a line: "BugHunters team" — a name that says "team" already stays as it is. @param {string} name */
export const teamWords = (name) => (/\bteam\b/i.test(name) ? name : `${name} team`);

/** A team's member by its tag, or null. @param {readonly TeamMember[] | null | undefined} members @param {unknown} tag */
export const memberOf = (members, tag) => (members || []).find((m) => m.tag === tag) || null;

/** The words a task graph keeps for an agent's own tasks: no member's tag. */
const OWN_BY = Object.freeze(["you", "sub-agent", "explorer"]);

/**
 * @typedef {{ tag: string, card?: string, name?: string }} CrewSeat
 *   a seat of the crew every shipped team has, as the settings answer's `shippedCrew` names it (core/roster.js
 *   `SHIPPED_CREW`): its id, and its card's tag and the seat's name where the seat is named
 */

/**
 * Who does a graph task by its `by` (HarnessV3-TaskGraph G3-1): a team's member by its tag, under its card's name — a
 * shipped worker's tag, or a seat the shipped crew names (`crew`), says who it is with no list at hand, under its
 * card's glyph and the seat's name, and a tag the team no longer has stands as written — else the agent's explorer,
 * which reads and searches, or its sub-agent, which does the work it was given.
 * @param {unknown} by @param {readonly TeamMember[] | null} [members]  the members of the team that leads
 * @param {readonly CrewSeat[] | null} [crew]  the settings answer's `shippedCrew`
 * @returns {{ word: string, icon: string, worker: boolean }}
 */
export function whoOfTask(by, members = null, crew = null) {
  const m = memberOf(members, by);
  if (m) return { word: m.name, icon: memberIcon(m), worker: true };
  const seat = (crew || []).find((s) => s.tag === by);
  const card = seat?.card ?? by;
  if (typeof card === "string" && Object.hasOwn(PLACE_ICONS, card)) return { word: seat?.name || `${card[0].toUpperCase()}${card.slice(1)}`, icon: memberIcon({ place: card }), worker: true };
  if (typeof by === "string" && by && !OWN_BY.includes(by)) return { word: by, icon: "bot", worker: true };
  return by === "explorer" ? { word: "Explorer", icon: "search", worker: false } : { word: "Agent", icon: "bot", worker: false };
}

/**
 * What a sub-agent is called wherever it shows: a team's worker by the name its team gives its seat, where it gives
 * one, else by its card's name — a member's id is a word for its lead, no name. "" where neither is known.
 * @param {any} row @returns {string}
 */
export const workerCalled = (row) => String(row?.team?.seat || row?.card?.name || "");

/**
 * Who a sub-agent's card says it is: a team's worker under its seat's name (`workerCalled`) and its card's glyph, else
 * the card it runs as (HarnessV4_Tasks E15 step 4) — one that only reads under the glass, any other under the bot.
 * @param {any} row @returns {{ word: string, icon: string, worker: boolean }}
 */
export const whoOf = (row) => {
  if (row?.team?.role) {
    // Its glyph by its card: a member the team names runs as a card of another tag.
    const card = String(row.card?.tag || row.team.role);
    const who = whoOfTask(row.team.role, [{ tag: String(row.team.role), name: workerCalled(row), may: row.may, place: row.team.place ?? (Object.hasOwn(PLACE_ICONS, card) ? card : null) }]);
    return who.word ? who : { ...who, word: whoOfTask(row.team.role).word };
  }
  const kind = whoOfTask(row?.may === "read" ? "explorer" : "sub-agent");
  return row?.card?.name ? { ...kind, word: String(row.card.name) } : kind;
};

/**
 * What the page says once your words reached a working worker past its lead (HarnessV4_Tasks decision 10): when it
 * reads them — at its next step, or after the question it waits on is answered — and when its lead hears of them:
 * its running turn at its next step, else its next turn; nobody else, for an agent you launched or asked yourself
 * (`told` null, the transcript audit of 2026-10-23).
 * @param {any} row @param {{ told: "turn" | "queue" | null, asking?: string | null }} out
 */
export function toldWords(row, out) {
  const lead = row?.team ? "its lead" : "the main agent";
  const heard = out.told == null ? "" : `, and ${lead} ${out.told === "turn" ? "at its next step too" : "when its next turn starts"}`;
  return `Sent to ${whoOf(row).word} ${row?.id || ""}: it reads it ${out.asking ? "once its question is answered" : "at its next step"}${heard}`;
}

/** The shipped teams' glyphs (VW-D10); a team of the developer's own wears people. */
const TEAM_ICONS = Object.freeze({ builders: "wrench", bughunters: "bug" });

/** @param {string} key */
export const teamIcon = (key) => (Object.hasOwn(TEAM_ICONS, key) ? TEAM_ICONS[/** @type {keyof typeof TEAM_ICONS} */ (key)] : "users");
/** The shipped teams' tile tones in the Library (proposal_ux mock-library); a team of the developer's own is purple. */
const TEAM_TONES = Object.freeze({ builders: "orange", bughunters: "pink" });
/** @param {string} key */
export const teamTone = (key) => (Object.hasOwn(TEAM_TONES, key) ? TEAM_TONES[/** @type {keyof typeof TEAM_TONES} */ (key)] : "purple");

/**
 * @typedef {{ key: string, name: string, line: string, icon: string, problem: string | null,
 *   lead: { tag: string, name: string }, members: TeamMember[] }} Leading
 *   a team as the page draws it: its lead's card and its members' (HarnessV4_Tasks E15 step 6)
 */

/**
 * A team of the settings answer's list as the page draws it: its name, its line — what its lead's card is good for —
 * its glyph, its lead and its members. A team the list does not hold is its key alone.
 * @param {any} t  the team's row, or null @param {string} key @param {string | null} [problem]
 * @returns {Leading}
 */
export function teamOf(t, key, problem = null) {
  const name = String(t?.name || key);
  return {
    key,
    name,
    line: String(t?.line || ""),
    icon: teamIcon(key),
    problem,
    lead: { tag: String(t?.lead?.tag || ""), name: String(t?.lead?.name || name) },
    members: (Array.isArray(t?.members) ? t.members : []).map((/** @type {any} */ m) => ({ tag: String(m.tag), name: String(m.name || m.tag), may: m.may, place: m.place ?? null })),
  };
}

/**
 * The team that answers the session's turns, from its settings answer's `engine` (HarnessV3-AtHome P2), or null while
 * your agent works alone. A team the session names that cannot lead still names itself: `problem` says why its turns go
 * to the model instead.
 * @param {any} engine  the settings answer's `engine`
 * @returns {Leading | null}
 */
export function leadingTeam(engine) {
  if (engine?.mode !== "team" || !engine.team) return null;
  const t = (Array.isArray(engine.teams) ? engine.teams : []).find((/** @type {any} */ x) => x.key === engine.team);
  return teamOf(t, String(engine.team), engine.problem ? String(engine.problem) : null);
}

/**
 * Whether a team changes no file wherever it works, by its row's `readOnly` (the shipped BugHunters, or a team of
 * yours set so): the server holds each turn its lead answers to reading. A team whose workers all only read is not
 * one: in charge its lead has its own hands, under the chat's mode.
 * @param {any} t  a team's row, as a settings answer, a start or the Library lists it
 */
export const readsOnly = (t) => t?.readOnly === true;

/**
 * The team in charge of the session that changes no file (`readsOnly`), or null: while it leads, each turn only reads
 * whatever the session's permission mode says — the server holds its lead's turn, its orders and its graph so —, and
 * the mode chip and Overview say the mode in force. A team that cannot lead holds nothing: its turns go to the model,
 * under the session's own mode.
 * @param {any} engine  the settings answer's `engine`
 * @returns {Leading | null}
 */
export function readingTeam(engine) {
  const team = leadingTeam(engine);
  if (!team || team.problem) return null;
  return (Array.isArray(engine.teams) ? engine.teams : []).some((/** @type {any} */ x) => x.key === team.key && readsOnly(x)) ? team : null;
}

/**
 * Why a chat only reads while a team that changes no file is in charge of it (`readingTeam`), as the mode chip's tip
 * and the line at its menu's head say it: the team, and the chat's own mode, which its agent has again after Back to
 * your agent. A team's own chat (`own`) has no agent to hand it back to.
 * @param {string} name  the team's @param {string} mode  the chat's own mode, as its chip names it @param {boolean} [own]
 */
export const readsOnlyWords = (name, mode, own = false) =>
  own
    ? `${name} changes no file: its own chat only reads, whatever its mode (${mode}).`
    : `${name} changes no file: while it is in charge this chat only reads, whatever its mode (${mode}). Back to your agent gives the chat its mode back.`;

/** The same fact in a few words, beside a place that says the chat's own mode. @param {string} name  the team's */
export const readsOnlyLine = (name) => `only reads while ${name} is in charge`;

/**
 * The same fact before the hand-over (d-side, 11-12: such a team may still be put in charge, never by default, and
 * what that means is said before the send): one sentence, read by every place a person picks In charge for a team
 * that changes no file (`readsOnly`) — its Brief's In charge card and the Agents tab's In charge… (lib/brief.js
 * `chargeWords`), Overview's Put in charge… (widgets/hand.js), the Start's team (conversation/start-board.js). Alone,
 * or the end of the sentence `after` begins.
 * @param {string} name  the team's @param {string} [after]  what it follows in its sentence, with no full stop
 */
export const readsOnlyAhead = (name, after = "") => `${after ? `${after}, and the` : "The"} chat only reads while it is in charge, whatever its mode: ${name} changes no file.`;

/** A team's members by name, in their order: "Scout, Builder, Tester, Reviewer". @param {{ members: readonly TeamMember[] }} team */
const memberNames = (team) => team.members.map((m) => m.name).join(", ");

/**
 * Who runs a session a team leads (AG-173, AG-174): "Run by Builders, with Scout, Builder, Tester, Reviewer".
 * @param {Pick<Leading, "lead" | "members">} team
 */
export const runByWords = (team) => `Run by ${team.lead.name}${team.members.length ? `, with ${memberNames(team)}` : ""}`;

/** A line as a sentence: a full stop where it ends without one. @param {string} s */
const sentence = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

/**
 * The Team tab's line under a team's name: who runs the session, then the team's line.
 * @param {Pick<Leading, "lead" | "members" | "line">} team
 */
export const runByLine = (team) => `${runByWords(team)}.${team.line ? ` ${sentence(team.line)}` : ""}`;

/** A team on its card (AG-175): "Builders leads Scout, Builder, Tester, Reviewer". @param {Pick<Leading, "lead" | "members">} team */
export const leadsWords = (team) => `${team.lead.name} leads ${memberNames(team)}`;

/**
 * The lead's card's head: "Builders lead" where the team bears its lead's name, else both — "PM · Docs lead".
 * @param {Pick<Leading, "name" | "lead">} team
 */
export const leadWord = (team) => (team.lead.name === team.name ? `${team.name} lead` : `${team.lead.name} · ${team.name} lead`);

/**
 * Who plans the session's task graph (HarnessV3-TaskGraph G3-1), from its settings answer's `engine`: a team's lead
 * while a team leads, else the agent — a team that cannot lead leaves the turns, and the graph, to the model.
 * @param {any} engine @returns {"agent" | "team"}
 */
export function crewOf(engine) {
  const team = leadingTeam(engine);
  return team && !team.problem ? "team" : "agent";
}

/** @typedef {"asking" | "running" | "review" | "done" | "stopped" | "failed"} CardState */

/**
 * What a running sub-agent waits on that is the developer's to answer — a call of its that needs their answer — or
 * null. A worker's question to its lead (HarnessV3-TaskGraph-v2 TG2-D49) is its lead's: nothing counts it as asking
 * you, and its card says it with no Allow or Deny (`leadAskLine`).
 * @param {any} progress  its progress, as the page's list carries it
 */
export const yourAsk = (progress) => (progress?.asking && progress.asking.to !== "lead" ? progress.asking : null);

/**
 * A running worker's question to its lead (TG2-D49), as its card says it: its number, its words, its options — its pick
 * first. While its lead reviews its plan (TG2-D50), its plan waiting for its lead's go, or its changes waiting for a plan
 * not sent yet. Null while it asks its lead nothing.
 * @param {any} progress
 */
export function leadAskLine(progress) {
  const a = progress?.asking?.to === "lead" ? progress.asking : null;
  if (!a) return progress?.held && !progress.asking ? "Its changes wait for its lead's review of its plan, not sent yet" : null;
  if (a.plan) return `Its plan waits for its lead's go (ask ${a.n}): "${a.question}"`;
  const options = Array.isArray(a.options) ? a.options.map((/** @type {string} */ o, /** @type {number} */ i) => (i ? o : `${o} (its pick)`)) : [];
  return `Asks its lead (ask ${a.n}): "${a.question}"${options.length ? ` — its options: ${options.join(", ")}` : ""}`;
}

/**
 * Where a sub-agent's card stands: asking (its call waits for you), running — its question to its lead included — or
 * how its newest exchange ended — a budget's stop reads as a stop, a cut-off as a failure. A graph task's worker, once
 * it ended, wears its task's state while a reviewer reads its change and once the task failed (HarnessV3-TaskGraph
 * G3-7): its card bears the task's name, so it says what the Plan view says of it.
 * @param {any} row @param {any} [task]  the graph task it works, as the Plan view draws it @returns {CardState}
 */
export function cardState(row, task = null) {
  if (row.status === "running") return yourAsk(row.progress) ? "asking" : "running";
  if (task?.agent === row.id && (task.state === "review" || task.state === "failed")) return task.state;
  if (row.status === "done") return "done";
  return row.status === "failed" || row.status === "aborted" ? "failed" : "stopped";
}

/** What a card's badge says of its state. */
export const STATE_WORDS = Object.freeze({ asking: "asks you", running: "running", review: "in review", done: "done", stopped: "stopped", failed: "failed" });

/** How many ended cards show before the older ones fold under Earlier (VW-D5). */
export const DONE_SHOWN = 4;

/** When a row's newest exchange ended (0 while none did). @param {any} r */
const endOf = (r) => Number(r.endedAt ?? r.exchanges?.at(-1)?.endedAt) || 0;

/**
 * The cards in their order (VW-D10): those asking first, then those running — each in the order it started — then the
 * newest ended ones; older ended ones fold under Earlier.
 * @param {any[]} rows @param {number} [shown]
 * @returns {{ live: any[], done: any[], earlier: any[] }}
 */
export function cardOrder(rows, shown = DONE_SHOWN) {
  const started = (/** @type {any} */ a, /** @type {any} */ b) => (Number(a.startedAt) || 0) - (Number(b.startedAt) || 0);
  const asking = rows.filter((r) => cardState(r) === "asking").sort(started);
  const running = rows.filter((r) => cardState(r) === "running").sort(started);
  const ended = rows.filter((r) => r.status !== "running").sort((a, b) => endOf(b) - endOf(a));
  return { live: [...asking, ...running], done: ended.slice(0, shown), earlier: ended.slice(shown) };
}

/**
 * A time a graph task was worked before the try its card shows: who worked it, how that ended — the dot it wears and
 * the word — and why, on one line.
 * @typedef {{ agent: string, state: "done" | "failed" | "stopped", how: string, cause: string, ms: number | null }} Try
 */

/** How an earlier try ended, by its exchange's status. @param {string} status @returns {Pick<Try, "state" | "how">} */
const tryEnd = (status) =>
  status === "done" ? { state: "done", how: "ended" } : status === "failed" ? { state: "failed", how: "failed" } : status === "aborted" ? { state: "failed", how: "cut off" } : { state: "stopped", how: "stopped" };

/**
 * One card a graph task (HarnessV4_Tasks U1; HarnessV3-FailurePoints §14.2): the sub-agents that worked the same task
 * — a new one takes it when it is sent back fresh, or when its last one can't go on — are that task's tries, not
 * workers of their own. The newest keeps the card; `tries` lists under its id the times the task was worked before
 * the try the card shows — the earlier workers' exchanges, then its own earlier ones — oldest first, each with how it
 * ended and why: its own failure's words, else why the task failed then (the graph keeps that of the try the next one
 * built on), else what it reported. A reviewer's row and a row with no task keep their own cards.
 * @param {any[]} rows @param {any} graph  the session's task graph as the Plan view draws it, or null
 * @returns {{ rows: any[], tries: Map<string, Try[]> }}
 */
export function taskTries(rows, graph) {
  /** @type {Map<string, any[]>} */
  const byTask = new Map();
  for (const r of rows) if (r.task && !r.review) byTask.set(String(r.task), [...(byTask.get(String(r.task)) || []), r]);
  /** @type {Set<any>} */
  const under = new Set();
  /** @type {Map<string, Try[]>} */
  const tries = new Map();
  /** @param {unknown} s */
  const line = (s) => String(s || "").replace(/\s+/g, " ").trim();
  for (const [id, group] of byTask) {
    const workers = [...group].sort((a, b) => (Number(a.startedAt) || 0) - (Number(b.startedAt) || 0));
    const newest = workers[workers.length - 1];
    const task = (graph?.tasks || []).find((/** @type {any} */ t) => String(t.id) === id) || null;
    // Sent back and not started yet, the try the next one builds on is the one the card still shows.
    const shows = task?.state === "waiting" && task.earlier?.agent === newest.id;
    /** @type {Try[]} */
    const list = [];
    for (const w of workers) {
      const xs = (w.exchanges || []).slice(0, w === newest ? -1 : undefined);
      xs.forEach((/** @type {any} */ x, /** @type {number} */ i) => {
        const why = i === xs.length - 1 && task?.earlier?.agent === w.id && !(w === newest && shows) ? task.earlier.why : "";
        list.push({ agent: String(w.id), ...tryEnd(String(x.status)), cause: line(x.error || why || x.report), ms: x.endedAt != null && Number.isFinite(Number(x.startedAt)) ? Math.max(0, x.endedAt - x.startedAt) : null });
      });
      if (w !== newest) under.add(w);
    }
    if (list.length) tries.set(String(newest.id), list);
  }
  return { rows: rows.filter((r) => !under.has(r)), tries };
}

/**
 * One card for a brief its lead tried several times at once (HarnessV3-TaskGraph-v2 TG2-D53), once one attempt won: the
 * winner's, the other attempts its tries — each with how it ended, and that the winner passed first. Before that, each
 * attempt keeps its own card: each runs, and each one's progress is worth seeing.
 * @param {any[]} rows @returns {{ rows: any[], tries: Map<string, Try[]> }}
 */
export function attemptTries(rows) {
  /** @type {Map<string, any[]>} */
  const byGroup = new Map();
  for (const r of rows) if (r.attempt) byGroup.set(String(r.attempt.group), [...(byGroup.get(String(r.attempt.group)) || []), r]);
  /** @type {Set<any>} */
  const under = new Set();
  /** @type {Map<string, Try[]>} */
  const tries = new Map();
  for (const group of byGroup.values()) {
    const winner = group.find((r) => r.attempt.won);
    if (!winner) continue;
    const others = group.filter((r) => r !== winner).sort((a, b) => Number(a.attempt.n) - Number(b.attempt.n));
    for (const r of others) under.add(r);
    tries.set(
      String(winner.id),
      others.map((r) => {
        const x = r.exchanges?.at(-1) || {};
        return { agent: String(r.id), ...tryEnd(String(r.status)), cause: `attempt ${winner.attempt.n} passed first`, ms: x.endedAt != null && Number.isFinite(Number(x.startedAt)) ? Math.max(0, x.endedAt - x.startedAt) : null };
      }),
    );
  }
  return { rows: rows.filter((r) => !under.has(r)), tries };
}
/** A card's word on the attempt it is (TG2-D53): "attempt 2 of 3", "won, of 3 attempts" — "" for one that is none. @param {any} row */
export const attemptBadge = (row) => (!row?.attempt ? "" : row.attempt.won ? `won, of ${row.attempt.of} attempts` : `attempt ${row.attempt.n} of ${row.attempt.of}`);

/**
 * A failure that repeats, called out (HarnessV3-FailurePoints §8 item 3) — "t6 failed the same way 3 times in a row"
 * — so nobody sends it back a fourth time unread; "" for a first failure.
 * @param {any} task  a graph task
 */
export const repeatWords = (task) => (task?.state === "failed" && Number(task.failures?.times) > 1 ? `${task.id} failed the same way ${task.failures.times} times in a row` : "");

/**
 * The two ways to send a failed task back, as its buttons say them (HarnessV3-FailurePoints §6): Send back — its last
 * worker goes on in the conversation it has — and Start fresh, a new one from the folder as it stands. `stopped`: the
 * same two for a task the developer — or its lead — stopped (HarnessV4_Tasks B4, B11), whose first reads Start again.
 * @param {string} id @param {"agent" | "team"} crew @param {boolean} [stopped] @returns {{ back: string, fresh: string }}
 */
export function sendBackTitles(id, crew, stopped = false) {
  const w = crew === "team" ? "worker" : "agent";
  const told = `${crew === "team" ? "The lead" : "The agent"} is told; with no turn running, a message to it starts one.`;
  return {
    back: stopped
      ? `Its ${w} goes on with ${id} where it was stopped, in its own conversation — what it did is there. ${told}`
      : `Its ${w} goes on with ${id} where it stopped, in its own conversation — what it did is there, and it reads what failed. ${told}`,
    fresh: `A new ${w} takes ${id} from the folder as it stands, with the ${stopped ? "stopped" : "earlier"} try in its brief. ${told}`,
  };
}

/**
 * What the developer's send-back did, in a line (the door's answer: `waits`, `resumes`): who has the task now, and
 * when it starts where it has not.
 * @param {string} id @param {{ fresh: boolean, waits: string | null, resumes: string | null, crew: "agent" | "team" }} o
 */
export function sentBackWords(id, { fresh, waits, resumes, crew }) {
  const w = crew === "team" ? "worker" : "agent";
  const who = resumes ? `${resumes} goes on with ${id}` : fresh ? `a new ${w} takes ${id}` : `its last ${w} can't go on with ${id}, so a new one takes it`;
  const when =
    waits === "held" ? ` — once ${crew === "team" ? "the lead" : "the agent"}'s next tasks call lets the graph go: it is held`
    : waits === "turn" ? " — with the session's next turn"
    : waits === "slot" ? " — once its needs are done and a slot is free"
    : "";
  return `${who[0].toUpperCase()}${who.slice(1)}${when}`;
}

/**
 * The developer's message that starts the planner's turn after a send-back made while none ran: the graph's work
 * starts under a turn alone, and the planner reads there what the developer did. `again`: it was a task they had
 * stopped, started again (HarnessV4_Tasks B4).
 * @param {string} id @param {{ resumes: string | null, crew: "agent" | "team", again?: boolean }} o
 */
export const carryOnWords = (id, { resumes, crew, again = false }) => {
  const who = resumes || `a new ${crew === "team" ? "worker" : "agent"}`;
  return again ? `I started ${id} again with ${who} — carry on.` : `I sent ${id} back to ${who} — carry on.`;
};

/**
 * The work a team or the task graph gives out, which the Team tab is about (the owner's words of 10-18: "when i run a
 * side agent it also shows up as a team … Not sure if the side agents should show up in team"): a team's workers and the agents
 * doing the graph's tasks. The agents beside the main one — yours, those it called of itself, those that start by
 * themselves, a coding agent's own — are the Sub Agents tab's.
 * @template {{ team?: any, task?: any }} T @param {readonly T[]} rows @returns {T[]}
 */
export const teamWork = (rows) => rows.filter((r) => !!r.team || !!r.task);

/**
 * The Team tab's badge (V3 build notes): its number is the team's workers and the graph's agents at work (`teamWork`),
 * as the view's Workers row counts them (HarnessV3-Views V6-13); its dot is blue while they or a team's lead work, and
 * orange while one waits for you: a worker's question, or the lead's pause. An agent on the side, a coding agent's own
 * and your agent's turn with no team light nothing here: the Sub Agents tab and the Chat tab say them (the owner's words of
 * 10-18: "that should not blink unless team is doing any work"). Nobody at work and nothing waiting: no badge.
 * @param {{ live: boolean, paused: boolean, rows: any[], leads: boolean }} s  `leads`: a team leads the session
 * @returns {{ text?: string, dot: "works" | "asks", words: string } | null}
 */
export function teamBadge({ live, paused, rows, leads }) {
  const work = teamWork(rows);
  const working = work.filter((r) => r.status === "running").length;
  const asks = (leads && paused ? 1 : 0) + work.filter((r) => cardState(r) === "asking").length;
  const leading = leads && live;
  if (!working && !asks && !leading) return null;
  const words = [working ? `${working} at work` : leading ? "the lead works" : "", asks ? `${asks} ${asks === 1 ? "asks" : "ask"} you` : ""].filter(Boolean).join(" · ");
  return { ...(working ? { text: String(working) } : {}), dot: asks ? "asks" : "works", words };
}

/**
 * Why who leads cannot change now (V3 build notes): a switch waits for the session to be idle — a turn's engine is
 * stamped when it opens, so a turn resumed after a switch would run under one engine and be stamped as the other — and
 * for its workers to finish, whose reports would reach whoever leads next. Null when it can change.
 * @param {any} chat @param {any[]} rows  the session's sub-agents
 * @returns {string | null}
 */
export function switchWait(chat, rows) {
  if (chat?.live) return "A turn is running: switch once it ends";
  if (ownLast(chat?.turns)?.paused) return "A question waits for your answer: answer it first";
  if (rows.some((r) => r.team && r.status === "running")) return "Workers are still at work: switch once they finish, or stop them";
  return null;
}

/**
 * What a switch's one cache rebuild costs (VW-D5): the conversation the session holds, written to the provider's cache
 * again where it was read from it — its tokens at the cache-write price less the cache-read price (the price card
 * states both, the input price where its row names none). Null while the size or the price is unknown.
 * @param {number} tokens  what the session holds now @param {any} price  the settings answer's price card, $ per million
 * @returns {{ tokens: number, usd: number } | null}
 */
export function rebuildCost(tokens, price) {
  if (!(tokens > 0) || !price) return null;
  const write = Number(price.cacheWrite);
  const read = Number(price.cacheRead);
  if (!Number.isFinite(write) || !Number.isFinite(read)) return null;
  return { tokens, usd: (tokens * Math.max(0, write - read)) / 1e6 };
}

/**
 * @typedef {{ to: "team" | "agent", key?: string, name?: string, words: string, after?: number }} Divider
 *   `after`: the turns the chat held when a team's lead took it over
 */

/**
 * Where the conversation's engine changes (VW-D8), from each turn's stamp (HarnessV3-AtHome AH-O7): before a team's
 * first turn after your agent's, "<Name>'s lead took over this chat", with the turns it took over (team_v2_plan §10
 * O4); before your agent's first after a team's, "Your agent has this chat again"; from one team to another, the new
 * one's. A session whose first turn was a team's opens with "<Name>'s lead leads this chat". A turn no loop ran (a model
 * answered it) is your agent's; Filament's answer to a command changes nothing. A chat handed away and back between two
 * turns of one team — its switches, marked on the chat (`engine` boundaries) — is taken over again (Bug Hunter #13).
 * @param {any[]} turns  oldest first
 * @returns {Map<any, Divider>}  by the turn it stands before
 */
export function engineDividers(turns) {
  /** @type {Map<any, Divider>} */
  const out = new Map();
  /** @type {string | null | undefined} the team that led the turn before (null: your agent; undefined: no turn yet) */
  let was;
  let seen = 0;
  /** The switches since the turn before. @type {any[]} */
  let gap = [];
  for (const t of turns) {
    gap.push(...(t.boundaries || []).filter(isEngineMark));
    // Filament's answer to a command is no one's turn, nor is a message on no record (history.js `unsent`).
    if (t.command || unsent(t)) {
      gap.push(...(t.boundariesAfter || []).filter(isEngineMark));
      continue;
    }
    const team = t.engine?.kind === "team" ? String(t.engine.team || "") : null;
    const name = String(t.engine?.name || team || "");
    const away = gap.some((m) => (m.to ?? null) !== (was ?? null));
    if (was === undefined) {
      if (team) out.set(t, { to: "team", key: team, name, words: `${possessive(name)} lead leads this chat` });
    } else if (team && (team !== was || away)) out.set(t, { to: "team", key: team, name, words: `${possessive(name)} lead took over this chat`, after: seen });
    else if (!team && was) out.set(t, { to: "agent", words: "Your agent has this chat again" });
    was = team;
    seen += 1;
    gap = (t.boundariesAfter || []).filter(isEngineMark);
  }
  return out;
}

/** A switch of who answers, as the transcript marks it. @param {any} b */
const isEngineMark = (b) => b?.type === "engine";

/**
 * When the team that leads now took over (the Team view's "Leading"): the start of the first turn of its stretch — null
 * while it has answered none since it was chosen, or the turn kept no start.
 * @param {any[]} turns  oldest first @param {string} key  the team that leads now
 * @returns {number | null}
 */
export function leadingSince(turns, key) {
  /** @type {any} */
  let opened = null;
  for (const [t, d] of engineDividers(turns)) opened = d.to === "team" ? t : null;
  const led = ownLast(turns);
  if (!opened || led?.engine?.team !== key) return null;
  // Handed away since its newest answer, and back (Bug Hunter #13): it leads from the next message.
  const since = turns.slice(turns.indexOf(led));
  if (since.some((t, i) => [...(i ? t.boundaries || [] : []), ...(t.boundariesAfter || [])].some(isEngineMark))) return null;
  return Number(opened.startedAt) || null;
}

/**
 * How often the session's conversation was compacted: each compaction between its turns once, however many copies of
 * its row the page holds, and each fold of older rounds inside the runs the page has read.
 * @param {any[]} turns
 */
export function compactionCount(turns) {
  const rows = new Set();
  let folds = 0;
  for (const t of turns || []) {
    for (const b of [...(t.boundaries || []), ...(t.boundariesAfter || [])]) if (b?.type === "compaction") rows.add(`${b.fromTurn}:${b.toTurn}`);
    for (const c of t.aligned?.byRound?.values() || []) folds += (c.compactions || []).filter((/** @type {any} */ e) => e.fromRound != null || (e.own && !e.result)).length;
  }
  return rows.size + folds;
}

/**
 * The engine a turn sent now runs under, as its stamp will say (AH-O7) — the page stamps its own turn at once, and the
 * transcript's stamp stands in for it on a reload. Null while your agent leads.
 * @param {any} engine  the settings answer's `engine`
 * @returns {{ kind: "team", team: string, name: string } | null}
 */
export function engineStamp(engine) {
  const t = leadingTeam(engine);
  return t && !t.problem ? { kind: "team", team: t.key, name: t.name } : null;
}

/**
 * @typedef {{ id: string, agentId: string, role: string, word: string, icon: string, task: string, state: CardState }} OrderRow
 */

/**
 * The lead's launches in a turn's run (VW-D8), as the order rows under its reply: each `agent` call that started a
 * team's worker — its member's tag, name and glyph, the worker and its task — in the order the calls were made, with
 * the worker's state now when the session's list has it, else as the run's events left it. A worker the list has
 * stamped with its team is who its row says; one it has not is who the launch itself named — the seat's name where its
 * team gives one, else its card's, under its card's glyph.
 * @param {any} aligned  the turn's alignEvents answer @param {any[]} rows  the session's sub-agents
 * @returns {OrderRow[]}
 */
export function orderRows(aligned, rows) {
  /** @type {OrderRow[]} */
  const out = [];
  for (const r of [...(aligned?.byRound?.keys() || [])].sort((a, b) => a - b)) {
    const c = aligned.byRound.get(r);
    for (const id of c.order) {
      const sub = c.tools.get(id)?.sub;
      if (!sub?.role || !sub.agentId) continue;
      const row = rows.find((x) => x.id === sub.agentId);
      const state = row ? cardState(row) : sub.state === "running" ? "running" : sub.state === "done" ? "done" : sub.state === "failed" ? "failed" : "stopped";
      const stamped = !!row?.team?.role;
      const who = stamped ? whoOf(row) : whoOfTask(sub.role);
      const word = stamped ? who.word : String(sub.seat || sub.card?.name || who.word);
      const icon = !stamped && sub.card?.tag && Object.hasOwn(PLACE_ICONS, sub.card.tag) ? memberIcon({ place: sub.card.tag }) : who.icon;
      out.push({ id: String(id), agentId: String(sub.agentId), role: String(sub.role), word, icon, task: String(sub.description || ""), state });
    }
  }
  return out;
}

/**
 * The conversation's newest turn: Filament's answer to a command typed after it is none of its own, so a question it
 * stopped on still waits (found by the Bug Hunter, 10-19: a command typed under the lead's question let a switch through)
 * — nor is a message on no record (history.js `unsent`), which comes after them all.
 * @param {any[] | undefined} turns  oldest first
 */
export const ownLast = (turns) => (turns || []).findLast((/** @type {any} */ t) => t && !t.command && !unsent(t)) || null;

/** Whether a turn waits for the developer: its pause, or a question waiting on its run. @param {any} turn */
export const asksYou = (turn) => !!turn?.paused || (Array.isArray(turn?.waiting) && turn.waiting.length > 0);

/**
 * The coding agents' accounts a team draws on (HarnessV3-ACP AC6-7, AC6-D6), its lead's and its workers', each once —
 * five Claude workers draw on one plan — and each only once its agent has said who it runs as: before, there is no
 * plan to read.
 * @param {any[]} accounts  each the page's row for an agent, or null for a model that is none
 * @returns {any[]}
 */
export const plansOf = (accounts) =>
  accounts.filter((a, i) => a?.account?.identity && accounts.findIndex((b) => b?.upstream === a.upstream) === i);

/**
 * Whether the running turn waits on its sub-agents now (VW-D5's "waiting on its workers"): the loop said it waits for
 * them, or its newest call still open is a launch or a worker's — the lead's foreground wait.
 * @param {any} aligned
 */
export function leaderWaits(aligned) {
  const st = aligned?.turnState;
  if (st?.to === "waiting" && !st.retry && !st.queue) return true;
  const newest = aligned?.byRound?.get(aligned.maxRound);
  const open = newest ? newest.order.map((/** @type {any} */ id) => newest.tools.get(id)).filter((/** @type {any} */ t) => t?.state === "running") : [];
  return open.some((/** @type {any} */ t) => t.name === "agent" || t.name === "worker");
}

/**
 * What the leader does now, for its card's title and badge (V3 build notes): waiting for your answer, working on your
 * message, waiting on its workers (or sub-agents) — its turn waits for them, or it is done and they are not — or ready.
 * @param {{ live: boolean, paused: boolean, waits: boolean, atWork: number, team: boolean }} s
 * @returns {{ state: "asking" | "running" | "waiting" | "ready", title: string, badge: string }}
 */
export function leaderState(s) {
  const them = s.team ? "its workers" : "its agents";
  if (s.paused) return { state: "asking", title: "Waiting for your answer", badge: "asks you" };
  if (s.live && !s.waits) return { state: "running", title: "Working on your message", badge: "running" };
  if (s.live) return { state: "waiting", title: `Waiting on ${them}`, badge: "waiting" };
  if (s.atWork) return { state: "waiting", title: `${s.team ? "Its workers are" : "Its agents are"} at work`, badge: "waiting" };
  return { state: "ready", title: "Ready for your next message", badge: "ready" };
}

/**
 * The leader's newest words for its card: the last paragraph of its newest text, on one line, clipped — never the
 * closing note Filament wrote for clients that draw no card (LD-D7), which the dock and the conversation say themselves.
 * @param {any[]} blocks @param {{ text?: string } | null} [note]  the turn's closing note
 */
export function newestWords(blocks, note = null) {
  const said = String(note?.text || "");
  const text = [...splitNote(blocks, note)].reverse().find((b) => b?.type === "text" && String(b.text || "").trim() && (!said || b.text !== said))?.text || "";
  const para = String(text).split(/\n\s*\n/).filter((p) => p.trim()).at(-1) || "";
  const one = para.replace(/\s+/g, " ").trim();
  return one.length > 360 ? `${one.slice(0, 359)}…` : one;
}

/**
 * A worker's waiting call in words (VW-D10): what it wants to do — run a command, write or edit a file, or use another
 * tool — and with what, on one line: a command as it runs (HarnessV3-Views V6-9), a file by its path in the worker's
 * folder (HarnessV3-ACP, AC3's drive D5). `whole` is all of it. A question a sub-agent's chat on another machine asks
 * there (`kind` question, the s-asks hunt's) is its own words, which name the machine: it asks for no tool. An ask of
 * Filament's own, for no tool's call, says what it wants (`verb`: a project's copy sent to another machine, "wants to send").
 * @param {{ tool: string, args: string, command?: string, runs?: string, changes?: { file: string }[], kind?: string, question?: string, verb?: string }} asking
 * @returns {{ verb: string, what: string, whole: string }}
 */
export function askWords(asking) {
  if (asking.kind === "question") return { verb: String(asking.question || "asks you a question"), what: "", whole: "" };
  const tool = String(asking.tool || "");
  const verb = asking.verb ? String(asking.verb) : tool === "bash" || tool === "powershell" || tool === "bash_background" ? "wants to run" : tool === "write" ? "wants to write" : tool === "edit" ? "wants to edit" : `wants to use ${tool}`;
  // A change names its file inside the worker's folder (HarnessV3-ACP, AC3's drive D5), not the path its call gave.
  const file = Array.isArray(asking.changes) ? String(asking.changes[0]?.file || "") : "";
  return { verb, what: String(asking.runs || asking.command || file || asking.args || ""), whole: String(asking.command || file || asking.args || "") };
}

/**
 * What makes a worker's waiting call the same one from pulse to pulse: its tool, its arguments, its question and the
 * offer standing for it. The card and the dock keep their answers while it holds — a Deny's half-typed why survives.
 * @param {{ tool: string, args: string, question?: string, offer?: { itemId: number } | null }} asking
 */
export const askKey = (asking) => [asking.tool, asking.args, asking.question || "", asking.offer?.itemId ?? ""].join("\u0000");

/**
 * The line a turn keeps where its decision waits in the dock, below the conversation (VW-D6, V3): a permission, or a
 * question.
 * @param {any} paused  the turn's pause
 */
export const waitWords = (paused) => (paused?.kind === "permission" ? "Waiting for your permission, below" : "Waiting for your answer, below");

/** What a turn of the loop paused on, by its park's kind, in words. @type {Record<string, string>} */
const PAUSE_NOUNS = { ask: "question", question: "question", permission: "permission" };

/**
 * The loop's pause while a coding agent is the chat's model: it waits for Filament's agent, which alone answers it — the
 * head of the dock's note, and the turn's pointer to it.
 * @param {any} paused  the turn's pause
 */
export const loopWaitWords = (paused) => `Its ${PAUSE_NOUNS[String(paused?.kind)] || "question"} waits for Filament's agent`;

/** How often a run compacted, in words: once, twice, 3 times. @param {number} n */
export const timesWords = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

/** A stretch of time in the watch's words: seconds under two minutes, then minutes. @param {number} ms */
const stretch = (ms) => (ms < 120_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);
/** Streamed characters as a token estimate, four to a token. @param {number} chars */
const aboutTokens = (chars) => `about ${Math.max(1, Math.round(chars / 4)).toLocaleString("en-US")} tokens`;

/**
 * How a running worker's model call goes, in the words the lead's watch reads (HarnessV3-FailurePoints §5.1 item 1;
 * HarnessV4_Tasks U1): the wait the call is in, as the server says it ("zai is busy: trying again in 20 s (try 2 of
 * 10)"), else how long the call has run, what has streamed, and how long since its newest byte — "model call 6 min ·
 * about 9,800 tokens of thinking so far · last byte 1 s ago". A stuck call reads as one: its last byte long ago. Null
 * between calls (a tool runs, or the worker waits on the developer).
 * @param {any} p  the worker's progress @param {number} now @returns {string | null}
 */
export function callLine(p, now) {
  if (p?.wait) return String(p.wait);
  const c = p?.call;
  if (!c || !Number.isFinite(Number(c.began))) return null;
  const streamed = [c.thinking > 0 ? `${aboutTokens(c.thinking)} of thinking` : "", c.text > 0 ? `${aboutTokens(c.text)} of text` : ""].filter(Boolean).join(" and ");
  return `model call ${stretch(Math.max(0, now - c.began))}${streamed ? ` · ${streamed} so far` : ""} · ${c.lastAt != null ? `last byte ${stretch(Math.max(0, now - c.lastAt))} ago` : "nothing streamed yet"}`;
}

/**
 * Filament's check of a worker's report while it runs, else that Filament sent the worker back, its check having failed
 * (HarnessV3-TaskGraph-v2 TG2-D45) or the folder's once its lead applied its change (TG2-D55), in the words the lead's
 * watch reads — "Filament runs its check `npm test` · 40 s so far" — or null.
 * @param {any} p  the worker's progress @param {number} now @returns {string | null}
 */
export function checkLine(p, now) {
  if (p?.check && Number.isFinite(Number(p.check.began))) return `Filament runs its check \`${p.check.command}\` · ${stretch(Math.max(0, now - p.check.began))} so far`;
  const nth = p?.bounce?.n === 1 ? "first" : "second";
  if (p?.bounce?.folder) return `sent back by Filament: the folder's check \`${p.bounce.command}\` failed with its change (${nth} time)`;
  if (p?.bounce) return `sent back by Filament: its check \`${p.bounce.command}\` failed (${nth} time)`;
  return null;
}

/** The lead's messages a worker read, and those waiting for its next step, in words. @param {number} read @param {number} unread */
const messagesWords = (read, unread) => {
  const total = read + unread;
  if (!total) return "";
  if (!unread) return total === 1 ? "Read the lead's message" : `Read the lead's ${total} messages`;
  const waits = `${unread === 1 ? "waits" : "wait"} for its next step`;
  return read ? `Read ${read} of the lead's ${total} messages; ${unread} ${waits}` : unread === 1 ? `The lead's message ${waits}` : `The lead's ${unread} messages ${waits}`;
};
/**
 * A running worker whose lead reads along with it (HarnessV3-TaskGraph-v2 TG2-D22), in a line: its signs since the
 * lead's last look — what makes the next look due at once — and the lead's messages it has read, and not yet. Null
 * where there is nothing to say, and for a worker whose lead does not read along.
 * @param {any} p  the worker's progress @returns {string | null}
 */
export function readAlongLine(p) {
  const signs = Array.isArray(p?.signs) ? p.signs.map((/** @type {any} */ s) => String(s?.words || s?.kind || "")).filter(Boolean) : [];
  const read = Number(p?.lead?.read) || 0;
  const unread = Number(p?.lead?.unread) || 0;
  const parts = [
    signs.length ? `For the lead's next look: ${signs.join("; ")}` : "",
    messagesWords(read, unread),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * A card's figures, as numbers for the view to format: the share of its window its newest round sent (null with no
 * window known), its rounds, what it spent (null while nothing is priced) and how long it has run or took.
 * @param {any} row @param {number} now
 * @returns {{ fill: number | null, rounds: number | null, spent: number | null, ms: number | null }}
 */
export function cardFigures(row, now) {
  const last = row.exchanges?.at(-1) || null;
  const p = row.status === "running" ? row.progress : null;
  const window = Number(p?.context?.window) || 0;
  const fill = p?.context && window > 0 ? Math.max(0, Math.min(1, Number(p.context.tokens) / window)) : null;
  const rounds = p ? (Number(p.round) || null) : Number.isFinite(Number(last?.rounds)) ? Number(last.rounds) : null;
  const spent = p ? (typeof p.spent === "number" ? p.spent : null) : typeof last?.spentUsd === "number" ? last.spentUsd : null;
  const end = last ? (last.endedAt ?? (row.status === "running" ? now : null)) : null;
  const ms = end != null && Number.isFinite(Number(last.startedAt)) ? Math.max(0, end - Number(last.startedAt)) : null;
  return { fill, rounds, spent, ms };
}

/** Names in a list, in words: "a", "a and b", "a, b and c". @param {string[]} names */
export const listWords = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join(""));

/**
 * A graph task's row in the conversation (HarnessV3-TaskGraph G2-11, G3-7), in the words of whoever plans — a team's
 * lead (`lead`), else the agent: the tasks Filament started, which they heard there; or a task's end — done; failed,
 * which they heard there with its choices; or stopped by the developer, its work or its review, waiting for their next
 * tasks call. `who` names the task; `tone` is the row's.
 * @param {{ task?: string, state?: string }} r @param {string} who @param {boolean} lead
 * @returns {{ tone: "ok" | "error" | "", ic: string, text: string }}
 */
export function taskNote(r, who, lead) {
  const planner = lead ? "the lead" : "the agent";
  if (!r.task) return { tone: "", ic: "→", text: `Filament started the graph's ready tasks — ${planner} heard which here` };
  if (r.state === "done") return { tone: "ok", ic: "✓", text: `Task ${who} is done` };
  if (r.state === "failed") return { tone: "error", ic: "✕", text: `Task ${who} failed — ${planner} heard it here, with its choices` };
  return { tone: "", ic: "↺", text: `${r.state === "review" ? `The review of task ${who}` : `Task ${who}`} was stopped — it waits for ${planner}'s next tasks call` };
}

/**
 * @typedef {{ id: string, name: string, by: string, state: "waiting" | "ready", line: string }} WaitingTask
 */

/**
 * Whose stop set a task aside, in a line's words, on the Plan page and the Team view alike: the developer's, its lead's
 * own, or the agent's with its agent tool (core/task-graph.js `StoppedBy`: "the agent" there is "your agent" to the
 * person). @param {unknown} by
 */
export const stoppedWords = (by) => `stopped by ${by === "lead" ? "its lead" : by === "agent" ? "your agent" : "the developer"}`;

/**
 * The graph's tasks not started yet, as the Team view's waiting cards show them (HarnessV3-TaskGraph G3-7): each task a
 * sub-agent or a worker is to do — waiting, or ready — in the graph's order, with what it waits on, in the words of
 * whoever plans (`crew`). The agent's own tasks have none: nobody is launched for them.
 * @param {any} graph  the graph as the Plan view draws it — or null
 * @param {"agent" | "team"} crew
 * @returns {WaitingTask[]}
 */
export function waitingTasks(graph, crew) {
  if (!graph || graph.closed) return [];
  /** @type {Map<string, any>} */
  const byId = new Map(graph.tasks.map((/** @type {any} */ t) => [t.id, t]));
  const planner = crew === "team" ? "the lead" : "the agent";
  return graph.tasks
    .filter((/** @type {any} */ t) => t.by !== "you" && t.state === "waiting")
    .map((/** @type {any} */ t) => {
      const state = t.ready ? "ready" : "waiting";
      const open = t.needs.filter((/** @type {string} */ n) => byId.get(n)?.state !== "done");
      const line = state === "ready" ? (graph.held ? `held until ${planner}'s next tasks call` : "Filament starts it") : t.stopped ? stoppedWords(t.stopped) : `needs ${open.join(", ")}`;
      return { id: String(t.id), name: String(t.name), by: String(t.by), state, line };
    });
}
