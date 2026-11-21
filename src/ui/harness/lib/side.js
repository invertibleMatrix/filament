// @ts-check
// The Agents tab's model and words (HarnessV4_Tasks E15 step 5; U12, the owner's words of 10-18; U13-D5, the Sub Agents
// and Teams tabs made one): every agent that works for the session is a thread there — yours, the main agent's, a team's
// workers and the graph's, those that start by themselves, a coding agent's own — and every team, in charge of it or on
// its side, a row with its crew under it (`teamItems`, `withTeams`). Here, without a document: the list by what each needs of you (U12-D3), a row's
// tag of who started it and its one fact — what it does now, while it works — the seats a list holds (U12-D5), the
// tab's badge (AG-107), what the main agent does now for the strip under the tab, and a new thread — the starts as
// tiles, rows of the server's starts table; the saved agents as the box's @ menu groups them (U12-D6); what a card and a
// start choose with what the person changed for this thread alone, its model and effort among them (U12-D7); the chips
// under the box, why it does not go yet, and the launch it makes: an agent asked by its tag (AG-102), so its card stands
// in the chat too. And Watch all's (proposal_ux §4.7): the agents at work, and what each one's tile says.
import { fmt } from "../../lib/format.js";
import { SUBAGENT_VIEW_WORDS } from "../../lib/context-words.js";
import { levelWords, prettyModel } from "./families.js";
import { formatWorkedFor, toolLabel } from "./labels.js";
import { contextGauge, effortAt, machineWords } from "./subagents.js";
import { cardIcon, handedWords, MAY_WORDS } from "./agent-cards.js";
import { askWords, cardState, teamWords, whoOf, yourAsk } from "./team.js";
import { framesOf } from "./boards.js";
import { CHECKING_WORDS, findingChips, notifiedWords, workersWords } from "./beside.js";
import { changesFiles, usualWay } from "./brief.js";

/** What an agent may do, lowest first (services/agent-cards.js CARD_MAY). */
const MAY_ORDER = Object.freeze(["read", "copy", "edit"]);
/** What a thread may do, as its chip says it. @type {Readonly<Record<string, string>>} */
const MAY_LINE = Object.freeze({ read: "Read only", copy: "Own copy, nothing kept", edit: "Edits in its own copy" });
const FOLDER_LINE = "Edits in the session's folder";
/** How hard an agent thinks, as a launch names it (core/schema.js SUBAGENT_EFFORTS): the model's own, then each level. */
export const SIDE_EFFORTS = Object.freeze(["model", "low", "medium", "high", "xhigh", "max"]);
/** An effort in words: "Max", "Extra high", "The model's own". @param {string} id */
export const effortName = (id) => (id === "model" ? "The model's own" : levelWords(id));
/** How many done threads the list shows before the rest fold under Earlier (U12-D3). */
export const DONE_SHOWN = 6;
/** Why a live copy of the main agent cannot be made now. */
export const NO_COPY_YET = "Nothing to copy yet: a live copy is your agent's newest request, kept while a turn runs and for its cache's lifetime after";

/**
 * A row of the server's starts table (services/subagent-starts.js), as the list of saved agents answers it.
 * @typedef {import("./subagents.js").StartRow} StartRow
 * @typedef {import("./agent-cards.js").AgentCard} AgentCard
 * @typedef {import("./subagents.js").SubagentRow} SubagentRow
 * @typedef {import("./subagents.js").GuestRow} GuestRow
 */

/**
 * What the person chose for the thread they are about to start. A null field follows the shortcut, else the card;
 * `changes` undefined follows them too, and null is "no change". `folder`: it edits in the session's folder, with no
 * copy — theirs alone to choose. `effort`: how hard it thinks, "" for the session's default (U12-D7). `team`: a team
 * picked in the agent's place — its Brief starts it, never this box.
 * @typedef {{ start: string | null, tag: string, view: string | null, running: boolean | null, changes: string | null | undefined,
 *   may: "read" | "copy" | "edit" | null, folder: boolean, deliver: boolean | null, model: string, effort: string,
 *   pause: boolean, inform: boolean, team: string | null }} SideDraft
 */
/**
 * What the open session says of a thread about to start. `defaultModel`: what a card that names no model runs on
 * here; `defaultEffort`: how hard an agent launched with no effort thinks here — the main agent's (`model.effort`), else `model`, its model's own default
 * (the owner's word of 11-05); `mainModel`: the main agent's;
 * `turnRuns`: a turn runs now; `forkable`: there is a request of the main agent's to copy; `warm`: its cache is warm
 * now, so a start that starts as a live copy while it is (Catch me up) would; `tokens`: each view's size,
 * null until read; `runningTokens`, `runningRounds`: the running turn's so far; `patches`: the two changes' sizes, null
 * until read; `limit`: how many agents the chat's models run at once, null for no limit, and how many run — null
 * where no seat can run;
 * `seats`: Agents on the side's seats for its meter (U12-D5), said too where none of its models can run now.
 * @typedef {{ defaultModel: string, defaultEffort: string, mainModel: string, turnRuns: boolean,
 *   forkable: boolean, warm?: boolean, tokens: Record<string, number> | null, runningTokens: number, runningRounds: number,
 *   patches: { turn: import("./subagents.js").PatchSize, uncommitted: import("./subagents.js").PatchSize } | null,
 *   limit: { max: number | null, running: number } | null, seats?: { max: number | null, running: number } | null }} SideFacts
 */
/**
 * A thread about to start, every choice resolved. `level`: what the launch names as `may`; `folder`: it works in the
 * session's folder; `fork`: it starts as a live copy of the main agent, on its model and effort; `picked`: the model is
 * the person's own pick for this thread; `effortPicked`: so is the effort; `start`: the start the launch names — one
 * that asks its card (Catch me up), whose own facts no chip holds; `since`: it sees the session since your last message
 * alone (Catch me up's); `auto`: what it sees is the server's to pick at Send — a live copy where the cache is warm
 * then, else its start's view (Catch me up's, where nothing is picked).
 * @typedef {{ tag: string, name: string, view: string, running: boolean, changes: string | null,
 *   level: "read" | "copy" | "edit", top: "read" | "copy" | "edit", folder: boolean, deliver: boolean, model: string,
 *   picked: boolean, effort: string, effortPicked: boolean, fork: boolean, pause: boolean, inform: boolean,
 *   start: string | null, since: boolean, auto?: boolean }} Chosen
 */

/** A cache's lifetime left, as a clock: 4:05, or 1h 02m. @param {number} ms */
const clockOf = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * What Enhance will do with the words in the box, for its button: the main agent rewrites them as a whole brief from
 * what it knows — a copy of its newest request, read from the provider's cache while that is warm; nothing of it joins
 * the conversation — or, with the cache cold, the session's model writes it from the session folded.
 * @param {import("./subagents.js").CacheState} c
 */
export function enhanceWords(c) {
  if (c.running) return "The main agent rewrites your words as a whole brief from what it knows: a copy of its running turn, read from its cache";
  if (c.state === "warm") return `The main agent rewrites your words as a whole brief from what it knows: its cache stays warm for ${clockOf(c.leftMs)}${c.tokens ? `, ~${fmt.k(c.tokens)} tokens read at the cache's price` : ""}`;
  return "Your words rewritten as a whole brief from this session, folded: the main agent's cache is cold, so its model reads the session anew";
}

/**
 * `/btw <question>` typed in the chat's own box (HarnessV4_Tasks E15 step 5, BW-16): the question — "" where nothing
 * follows the word — or null where the text is no `/btw`.
 * @param {string} text
 */
export function btwOf(text) {
  const m = /^\/btw(?:\s+([\s\S]*))?$/i.exec(String(text || "").trim());
  return m ? String(m[1] || "").trim() : null;
}
/** `/btw` with nothing after it: what to type. */
export const BTW_USAGE = "/btw needs your question after it: /btw <question>. It is asked on the side, and the main agent hears nothing of it.";
/** A chat with no session yet: why nothing is asked on the side — `/btw` there, and Alt+A (AG-144). */
export const NO_SESSION_YET = "A side question reads the session: send a first message, then ask on the side";
/** The start `/btw` begins a thread on, by its name in the server's table: the Ask shortcut's. */
export const BTW_START = "ask";

/** A draft on a shortcut: every choice follows it. @param {string | null} start @param {string} tag @returns {SideDraft} */
export const draftOn = (start, tag) => ({ start, tag, view: null, running: null, changes: undefined, may: null, folder: false, deliver: null, model: "", effort: "", pause: false, inform: false, team: null });

/** Start…'s quick starts, in their order (U13 W3); the Ask start is what Start… begins on, with no tile of its own. */
const QUICK = Object.freeze(["catchup", "review", "job"]);
/**
 * The starts Start… offers as quick starts: Catch me up · Review my last change · Try it in a copy, then any other the
 * server adds; the Ask start is left out — it is where Start… begins.
 * @template {{ id: string }} T @param {readonly T[]} shorts @returns {T[]}
 */
export const quickStarts = (shorts) => {
  const rank = (/** @type {string} */ id) => (QUICK.includes(id) ? QUICK.indexOf(id) : QUICK.length);
  return shorts.filter((s) => s.id !== BTW_START).sort((a, b) => rank(a.id) - rank(b.id));
};

/**
 * The starts as the new thread's tiles (U12-D6): each a row of the starts table with the card it runs as, said under
 * it — "Reviewer, read only", "Builder", "Reviewer, with the last change", "Reviewer, read only, since your last message".
 * A tile is chosen, never sent: one that brings its own question (Catch me up) puts it in the box as words to send or
 * change (`task`), and Send asks it — a press starts nothing (the owner's word of 10-18). A start whose card is gone is
 * left out.
 * @param {readonly StartRow[]} starts @param {readonly AgentCard[]} cards
 * @returns {{ id: string, name: string, tag: string, sub: string, task: string }[]}
 */
export function shortcutsOf(starts, cards) {
  /** @type {{ id: string, name: string, tag: string, sub: string, task: string }[]} */
  const out = [];
  for (const s of starts) {
    const card = cards.find((c) => c.tag === s.worker);
    if (!card) continue;
    const lower = MAY_ORDER.indexOf(s.may) < MAY_ORDER.indexOf(card.may) ? MAY_LINE[s.may].toLowerCase() : "";
    const change = s.changes === "turn" ? "with the last change" : s.changes === "uncommitted" ? "with the uncommitted change" : "";
    const since = s.since === "message" ? "since your last message" : "";
    out.push({ id: s.id, name: s.name, tag: card.tag, sub: [card.name, lower, change, since].filter(Boolean).join(", "), task: String(s.task || "") });
  }
  return out;
}

/**
 * The saved agents as Start…'s Who groups them (U12-D6; one kind of agent, HarnessV4_OneAgent_Plan OA1): Agents —
 * each does what its card's level lets it, one list (the owner's word of 10-24). With nobody in it, none.
 * @param {readonly AgentCard[]} cards
 * @returns {{ id: "agents", title: string, cards: AgentCard[] }[]}
 */
export function cardGroups(cards) {
  return cards.length ? [{ id: "agents", title: "Agents", cards: [...cards] }] : [];
}

/**
 * A thread about to start, resolved: the draft's own choices first, then its shortcut's, then its card's. Nothing
 * rises above what the card may do (one kind of agent, HarnessV4_OneAgent_Plan OA1: its level is the only limit).
 * @param {SideDraft} draft @param {AgentCard} card @param {StartRow | null} start @param {SideFacts} facts @returns {Chosen}
 */
export function chosen(draft, card, start, facts) {
  // A start that starts as a live copy while the cache is warm (Catch me up, the owner's of 11-05): the chips say what
  // Send would pick now, and the server picks it then — unless the person picked what it sees, its model or its effort.
  const auto = start?.fork === "warm" && draft.view == null && !draft.model && !draft.effort;
  const view = String(draft.view ?? (auto && facts.warm ? "fork" : (start?.view ?? card.sees.view)));
  const top = /** @type {Chosen["top"]} */ (MAY_ORDER.includes(card.may) ? card.may : "read");
  const asked = String(draft.may ?? start?.may ?? top);
  const level = /** @type {Chosen["level"]} */ (MAY_ORDER.includes(asked) && MAY_ORDER.indexOf(asked) <= MAY_ORDER.indexOf(top) ? asked : top);
  const folder = draft.folder && top !== "read";
  const deliver = draft.deliver ?? start?.deliver ?? false;
  const fork = view === "fork";
  const changes = draft.changes !== undefined ? draft.changes : start ? start.changes : card.sees.changes;
  return {
    tag: card.tag,
    name: card.name,
    view,
    // Asked for only while a turn runs: with none, the thread's head would say it saw one.
    running: facts.turnRuns && (draft.running ?? start?.running ?? card.sees.running) === true,
    changes: changes || null,
    // In the session's folder it edits, whatever lower level the menu held before: the launch names the card's own.
    level: folder ? top : level,
    top,
    folder,
    deliver,
    model: fork ? facts.mainModel : draft.model || String(card.model || "") || facts.defaultModel,
    picked: !fork && !!draft.model,
    // A live copy thinks as the main agent's request it copies: its cache is that request's.
    effort: fork ? "" : draft.effort || facts.defaultEffort || "model",
    effortPicked: !fork && !!draft.effort,
    fork,
    pause: deliver && draft.pause && facts.turnRuns,
    inform: deliver && draft.inform,
    // A start that asks its card goes by name: the server keeps what it says that no chip does — what it sees since
    // your last message, its name on the thread.
    start: start?.asks ? start.id : null,
    since: start?.since === "message" && view !== "none" && !fork,
    ...(auto ? { auto: true } : {}),
  };
}

/**
 * The chips under the new thread's box, as their words (U12-D7) — each the face of a menu: who gets the words, what
 * they see and how large that is, what they may do, where the answer goes, the model, how hard it thinks, and how many
 * of More's switches are on.
 * @param {Chosen} c @param {SideFacts} facts
 * @returns {{ who: string, sees: string, may: string, answer: string, model: string, effort: string, more: string }}
 */
export function lineParts(c, facts) {
  const windowed = c.view === "window";
  const turn = c.running && facts.turnRuns && !c.fork && !windowed;
  const size = c.fork ? Number(facts.tokens?.fork) || 0 : c.view === "none" ? 0 : Number(facts.tokens?.[c.view]) || 0;
  // A size is the whole view's: one cut at your last message is smaller, by how much nothing here knows.
  const all = c.since ? 0 : size + (turn ? Number(facts.runningTokens) || 0 : 0);
  const base = c.fork ? "A live copy of your agent" : windowed ? "Your agent's context window" : c.view === "none" ? (turn ? "Your words and the running turn" : "Your words alone") : `Sees this session${c.since ? " since your last message" : ""}${turn ? " and the running turn" : ""}`;
  const handed = handedWords(c.changes);
  const extras = [c.pause, c.inform].filter(Boolean).length;
  return {
    who: c.name,
    // Its size with its unit (the Designer's review of 10-24: "Sees this session · 369").
    sees: `${base}${all ? ` · ${fmt.k(all)} tokens` : ""}${handed ? `, ${handed}` : ""}`,
    may: c.folder ? FOLDER_LINE : MAY_LINE[c.level],
    answer: c.deliver ? "Answer goes to your agent" : "Answer stays with you",
    model: c.model ? prettyModel(c.model) : "No model",
    effort: c.fork ? "Your agent's effort" : effortName(c.effort),
    more: extras ? `More · ${extras}` : "More",
  };
}

/**
 * What a team picked in Start… runs on, over the box (the owner's 10-21: its models and effort are its Brief's, and
 * nothing in the box said so): its lead's model and effort, its crew's and how many at once, whether it changes files —
 * as its Brief opens on it, its last run's picks in this browser first. In charge, its lead runs on this chat's model.
 * @param {{ team: any, on: import("./beside.js").BesideOn, picks: import("./brief.js").Picks | null, seats: string[] }} o
 *   `seats`: this chat's list's models, in order — none where it holds no list of its own
 * @returns {string}
 */
export function teamLine({ team, on, picks, seats }) {
  const effort = (/** @type {string} */ e) => effortName(e).toLowerCase();
  const charge = usualWay(team) === "charge";
  const lead = charge
    ? "In charge, its lead runs on this chat's model"
    : `Its lead on ${on.lead ? prettyModel(on.lead) : "this chat's model"}${picks?.effort ? `, ${effort(picks.effort)}` : ""}`;
  const members = Array.isArray(team?.members) ? team.members : [];
  const who = members.length === 1 ? `${members[0].name}s` : "its workers";
  // Its crew as the server runs it (teams-beside.js `runsOn`; the review of 0376f5a4f): on what the answer names for it —
  // the team's, this chat's rows for it, a pick —, else each member's card's, else this chat's list; with none of its
  // own, in charge this chat's model, beside it its lead's.
  const listed = on.from === "chat" || on.from === "project";
  const named = on.workers?.length && !listed ? on.workers : [];
  const models = named.length ? named : listed ? on.workers || [] : seats;
  const more = models.length > 1 ? ` (then ${models.length - 1} more)` : "";
  const first = named.length ? prettyModel(named[0]) : `each card's, else ${models[0] ? prettyModel(models[0]) : charge ? "this chat's model" : on.lead ? prettyModel(on.lead) : "its lead's model"}`;
  // Its crew thinks as its lead does where nothing is picked for them — no level named, as its lead's model may take
  // another than picked —, its lead as the main agent (the review of 11-05).
  const crew = `${who} on ${first}${more}, ${picks?.workersEffort ? effort(picks.workersEffort) : "as hard as its lead"}`;
  return `${lead} · ${crew} · ${changesFiles(team) ? "changes files" : "reads only"}${picks ? " — as last time" : ""}.`;
}

/**
 * The Effort menu's choices (U12-D7): the session's default first, then the model's own and each level. A model
 * thinks at the highest level it takes at or below the one asked; its thread's head says the one it ran at.
 * @param {Chosen} c @param {SideFacts} facts
 * @returns {{ id: string, name: string, line: string, on: boolean }[]}
 */
export function effortChoices(c, facts) {
  const fallback = facts.defaultEffort || "model";
  return [
    { id: "", name: `The default: ${effortName(fallback)}`, line: "The main agent's effort, as this chat sets it", on: !c.effortPicked },
    ...SIDE_EFFORTS.map((id) => ({ id, name: effortName(id), line: id === "model" ? "The level its model takes by itself" : "", on: c.effortPicked && c.effort === id })),
  ];
}

/**
 * Why no thread starts now whatever is chosen, or null: every model of the chat's list is at its limit. A limit of
 * null is none.
 * @param {SideFacts} facts
 */
export function limitStop(facts) {
  const l = facts.limit;
  return l && l.max != null && l.running >= l.max ? `${l.running} of ${l.max} agent${l.max === 1 ? " is" : "s are"} running on this chat's models, each at its limit: wait for one to finish` : null;
}

/**
 * Why a thread does not start yet, or null: the session already runs as many agents as it allows, or there is no
 * request of the main agent's to copy.
 * @param {Chosen} c @param {SideFacts} facts
 */
export function lineStop(c, facts) {
  const full = limitStop(facts);
  if (full) return full;
  if (c.fork && !facts.forkable) return NO_COPY_YET;
  if (!c.model) return "No model to run it on: pick one";
  return null;
}

/**
 * A change is chosen and there is none to hand: why, and the other source where that one holds a change. Null where a
 * change goes with it, where none is chosen, and until the sizes are read.
 * @param {Chosen} c @param {SideFacts} facts
 * @returns {{ words: string, other: { id: "turn" | "uncommitted", name: string } | null } | null}
 */
export function noPatchWhy(c, facts) {
  const source = c.changes === "turn" || c.changes === "uncommitted" ? c.changes : null;
  const p = source ? facts.patches?.[source] : null;
  if (!source || !p || p.files) return null;
  const otherId = source === "turn" ? "uncommitted" : "turn";
  const n = Number(facts.patches?.[otherId]?.files) || 0;
  const files = `${n} file${n === 1 ? "" : "s"}`;
  return {
    words: `No change goes with it: ${p.note || "nothing changed"}.`,
    other: n ? { id: otherId, name: otherId === "turn" ? `Hand it the last turn's change, ${files}` : `Hand it everything uncommitted, ${files}` } : null,
  };
}

/**
 * The Sees menu's choices: how much of the session, each with its size; the turn running now, where one runs; and a
 * change as a patch, from each source, with its size or why there is none.
 * @param {Chosen} c @param {SideFacts} facts
 * @returns {{ views: { id: string, name: string, line: string, on: boolean, off: string | null }[],
 *   running: { on: boolean, line: string } | null,
 *   changes: { id: string, name: string, line: string, on: boolean, off: string | null }[], since: string }}
 */
export function seesChoices(c, facts) {
  /** @param {number} n */
  const sized = (n) => (n ? `~${fmt.k(n)} tokens` : "");
  const views = SUBAGENT_VIEW_WORDS.map((v) => {
    const size = v.id === "none" ? "" : facts.tokens ? sized(Number(facts.tokens[v.id]) || 0) || (v.id === "fork" ? "" : "nothing yet") : "";
    return { id: v.id, name: v.name, line: [v.line, size].filter(Boolean).join(" · "), on: c.view === v.id, off: v.id === "fork" && !facts.forkable ? NO_COPY_YET : null };
  });
  const rounds = Number(facts.runningRounds) || 0;
  // A live copy and the context window hold the turn running now already.
  const running = facts.turnRuns && !c.fork && c.view !== "window"
    ?{ on: c.running, line: [rounds ? `${rounds} round${rounds === 1 ? "" : "s"} so far` : "", facts.runningTokens ? `+${fmt.k(facts.runningTokens)}` : ""].filter(Boolean).join(" · ") }
    : null;
  /** @param {import("./subagents.js").PatchSize | undefined} p */
  const patch = (p) => (!p ? "" : p.files ? `${p.files} file${p.files === 1 ? "" : "s"}${p.tokens ? ` · ${sized(p.tokens)}` : ""}` : p.note || "nothing changed");
  const source = String(c.changes || "");
  const changes = [
    { id: "", name: "No change", line: "", on: !source, off: null },
    ...(facts.turnRuns ? [{ id: "running", name: "What this turn changed so far", line: "up to its last finished round", on: source === "running", off: null }] : []),
    { id: "turn", name: "The last turn's change", line: patch(facts.patches?.turn), on: source === "turn", off: null },
    { id: "uncommitted", name: "Everything uncommitted", line: patch(facts.patches?.uncommitted), on: source === "uncommitted", off: null },
  ];
  return { views, running, changes, since: source.startsWith("since:") ? source.slice(6) : "" };
}

/**
 * The May menu's choices: the levels up to what the card may do, and — for a card that changes anything — the
 * session's own folder, which only the person can give it. `note`: why no higher level is offered.
 * @param {Chosen} c
 * @returns {{ choices: { id: "read" | "copy" | "edit" | "folder", name: string, line: string, on: boolean }[], note: string | null }}
 */
export function mayChoices(c) {
  const levels = MAY_ORDER.slice(0, MAY_ORDER.indexOf(c.top) + 1);
  /** @type {{ id: "read" | "copy" | "edit" | "folder", name: string, line: string, on: boolean }[]} */
  const choices = levels.map((id) => ({ id: /** @type {"read" | "copy" | "edit"} */ (id), name: MAY_WORDS[id], line: "", on: !c.folder && c.level === id }));
  if (c.top !== "read") choices.push({ id: "folder", name: "Edits in the session's folder", line: "Beside your agent, with no copy: only you can choose it", on: c.folder });
  return { choices, note: c.top === "edit" ? null : `${c.name} ${c.top === "read" ? "only reads" : "keeps nothing"}, as its card says` };
}

/**
 * What the launch route takes for a thread about to start (POST /sessions/:id/subagents): one agent asked by its tag,
 * each choice named, so the thread runs as the chips said — whatever the session's own defaults are. A model and an
 * effort are named only where the person picked them: the card's model, else a seat of the session's pool, and the
 * session's effort are the server's to read. What it sees is the server's too where its start picks it at Send (`auto`).
 * @param {Chosen} c @param {string} prompt
 * @param {{ title?: string | null, images?: { name: string, mediaType: string, data: string }[] }} [o]
 */
export function launchBody(c, prompt, o = {}) {
  return {
    prompt,
    as: c.tag,
    ...(c.start ? { start: c.start } : {}),
    ...(o.title ? { description: o.title } : {}),
    ...(o.images?.length ? { images: o.images } : {}),
    may: c.level,
    ...(c.auto ? {} : { view: c.view }),
    running: c.running,
    changes: c.changes || "",
    ...(c.picked ? { model: c.model } : {}),
    ...(c.effortPicked ? { effort: c.effort } : {}),
    ...(c.level === "read" ? {} : { worktree: !c.folder }),
    deliver: c.deliver,
    pause: c.pause,
    inform: c.inform,
  };
}

/** An agent's answer as the page keeps what was opened: the agent and which exchange. @param {string} id @param {number} exchange */
export const exchangeKey = (id, exchange) => `${id}:${exchange}`;

/** An agent's newest answer, as the page keeps what was opened. @param {SubagentRow} r */
export const answerKey = (r) => exchangeKey(r.id, Math.max(0, r.exchanges.length - 1));

/**
 * When an agent began its newest work: its newest exchange, else its start.
 * @param {{ startedAt?: number, exchanges?: readonly { startedAt: number }[] }} r
 */
export const rowAt = (r) => Number(r.exchanges?.at(-1)?.startedAt ?? r.startedAt) || 0;

/**
 * Running first, then by when the newest exchange began, newest first.
 * @template {{ status: string, startedAt: number, exchanges?: readonly { startedAt: number }[] }} T
 * @param {readonly T[]} rows @returns {T[]}
 */
const ordered = (rows) => [...rows].sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || rowAt(b) - rowAt(a));

/** Whether a row is one of a coding agent's own agents (AG-157). @param {SubagentRow | GuestRow} r @returns {r is GuestRow} */
export const isGuest = (r) => /** @type {any} */ (r).guest === true;

/**
 * Whether a thread waits for you (U12-D3): its agent asks you — a worker's question to its lead is its lead's
 * (HarnessV3-TaskGraph-v2 TG2-D49) — or its changes wait for Apply. A coding agent's own never does: it is its agent's.
 * @param {SubagentRow | GuestRow} r
 */
export const needsYou = (r) => !isGuest(r) && (r.status === "running" ? !!yourAsk(r.progress) : (Number(r.work?.pending) || 0) > 0);

/** What such a change waits for, as every place that lists it says: "2 files for its lead to apply". */
export const LEADS_APPLY = "for its lead to apply";

/**
 * The workers whose change that waits is their lead's to apply, not yours, by id: its team leads the chat
 * (`team.charge`, as the chat's settings say), you did not start it, and its lead is at work — at its turn (`live`), or
 * due back for a worker still at work. The lead gone, or the chat handed back to your agent, it is yours. Now's rows,
 * the Changes tab and its mark read it here, so no place calls yours what its lead is about to apply.
 * @param {readonly any[]} rows  a chat's agents @param {boolean} live  the chat's turn is at work
 * @returns {Set<string>}
 */
export function leadApplies(rows, live) {
  if (!live && !rows.some((r) => !!r.team?.name && r.status === "running")) return new Set();
  const theirs = (/** @type {any} */ r) => !isGuest(r) && r.status !== "running" && !!r.team?.charge && r.origin !== "owner" && r.origin !== "command" && r.origin !== "self";
  return new Set(rows.filter((r) => theirs(r) && (Number(r.work?.pending) || 0) > 0).map((r) => String(r.id)));
}

/**
 * The session's agents by what they need of you (HarnessV4_Tasks U12-D3): Needs you, Working, Done — newest first in
 * each. Every agent of the session stands in one: yours, the main agent's, a team's workers and the graph's (U12-D2),
 * those that start by themselves, and the coding agents' own, which Filament did not launch (AG-158). Who started each
 * is its row's tag (`whoTag`). A group with nobody in it is left out.
 * @param {readonly SubagentRow[]} rows @param {readonly GuestRow[]} [own]  the coding agents' own agents
 * @returns {{ id: "needs" | "works" | "done", title: string, rows: (SubagentRow | GuestRow)[] }[]}
 */
export function sideGroups(rows, own = []) {
  /** @type {(SubagentRow | GuestRow)[]} */
  const all = ordered([...rows, ...own]);
  const needs = new Set(all.filter(needsYou));
  return [
    { id: /** @type {const} */ ("needs"), title: "Needs you", rows: all.filter((r) => needs.has(r)) },
    { id: /** @type {const} */ ("works"), title: "Working", rows: all.filter((r) => r.status === "running" && !needs.has(r)) },
    { id: /** @type {const} */ ("done"), title: "Done", rows: all.filter((r) => r.status !== "running" && !needs.has(r)) },
  ].filter((g) => g.rows.length);
}

/**
 * Who started a thread, as the small tag on its row says it (U12-D2): yours, the main agent, a team's worker by its
 * team, a task of the graph, one that started by itself, a coding agent's own by whose it is.
 * @param {SubagentRow | GuestRow} r
 */
export function whoTag(r) {
  if (isGuest(r)) return `${r.of || "the coding agent"}'s own`;
  const team = String(r.team?.name || "").trim();
  if (team) return teamWords(team);
  if (r.task) return `task ${r.task}`;
  // (§10: "your agent", never "the main agent"; U13 revised: one your agent sent on a card you named says so)
  return r.origin === "self" ? "by itself" : r.origin === "agent" ? (/** @type {any} */ (r).heard ? "your agent — you named it" : "your agent") : "yours";
}

/**
 * A row's glyph (U12-D4): a team's worker its member's, any other agent of Filament's its card's, a coding agent's own
 * the bot.
 * @param {SubagentRow | GuestRow} r
 */
export const rowIcon = (r) => (isGuest(r) ? "bot" : r.team?.role ? whoOf(r).icon : cardIcon(r.card));

/**
 * A call in its one line, as a row and the strip say what an agent does now: "Read src/core/pool.js", cut at 60.
 * @param {{ name: string, args: string } | null | undefined} tool
 */
export function callWords(tool) {
  const call = tool ? `${tool.name} ${String(tool.args || "").split("\n")[0]}`.trim() : "";
  return call.length > 60 ? `${call.slice(0, 59)}…` : call;
}

/**
 * A list's seats in a line, beside the meter under its chip (U12-D5; proposal_ux N2; the owner's 10-25: "1 in use · 7
 * free" said nothing of what it counted): this chat's agents at work on the list, and how many more can start now —
 * "1 at work · room for 7 more", "4 at work · no room for more" — or that no model of it can run now. With no limit
 * on its models (`max` null) only how many are at work, and no meter. `share`: the meter's fill, 0 to 1, null with no
 * meter; the whole null where nothing was read yet.
 * @param {{ max: number | null, running: number } | null | undefined} limit
 * @returns {{ words: string, share: number | null, full: boolean } | null}
 */
export function seatsLine(limit) {
  if (!limit) return null;
  const running = Math.max(0, Number(limit.running) || 0);
  if (limit.max == null || !Number.isFinite(Number(limit.max))) return { words: running ? `${running} at work` : "None at work", share: null, full: false };
  const max = Math.max(0, Number(limit.max) || 0);
  if (!max) return { words: running ? `${running} at work · no room for more` : "None of its models can run now", share: running ? 1 : 0, full: true };
  const free = Math.max(0, max - running);
  return { words: free ? `${running} at work · room for ${free} more` : `${running} at work · no room for more`, share: Math.min(1, running / max), full: !free };
}

/**
 * Whose list the Agents tab's corner shows, as its chip's tag, and as a line: `lead`, then `tail` — the chat's own, else
 * none: a list is a chat's own alone (the owner's plan of 11-05; no other layer holds one), and with none its agents
 * run on its main agent's model — a coding agent's too, on its own account (the owner's of 11-06). `own`: the chat's
 * own list, the one Use the default drops.
 * @param {string} source  the settings layer the list comes from: session, else none of the chat's
 * @returns {{ tag: string, lead: string, tail: string, own: boolean }}
 */
export function seatsFrom(source) {
  if (source === "session") return { tag: "This chat", lead: "This chat's own list", tail: "", own: true };
  return { tag: "Default", lead: "None set", tail: ": its agents run on this chat's model, as its main agent does", own: false };
}

/**
 * What the Agents tab's gear sets, by its settings' paths (the owner's of 11-05): whom the agent may ask — the cards, and
 * the teams a list of the chat's own names (a `/set`, a settings card) —, the list, the rows for agents and teams, and
 * the chat's own Parallelize tasks (the card's Always accept in this chat).
 */
export const GEAR_PATHS = Object.freeze(["subagents.ask", "subagents.teams", "subagents.pool", "subagents.byCard", "subagents.byTeam", "subagents.parallelize"]);
/** The gear's paths a chat's settings' sources say it holds of its own: its dot, and what Reset all drops. @param {any} sources @returns {string[]} */
export const ownGearPaths = (sources) => GEAR_PATHS.filter((p) => sources?.[p] === "session");

/**
 * The agents Watch all shows (proposal_ux §4.7): every one at work for the chat — its own, a team's, the graph's, one
 * that started by itself, a coding agent's own — those that ask you first, then the newest begun.
 * @param {readonly SubagentRow[]} rows @param {readonly GuestRow[]} [own]
 * @returns {(SubagentRow | GuestRow)[]}
 */
export function watchAll(rows, own = []) {
  /** @param {SubagentRow | GuestRow} r */
  const asks = (r) => (!isGuest(r) && yourAsk(/** @type {SubagentRow} */ (r).progress) ? 1 : 0);
  /** @type {(SubagentRow | GuestRow)[]} */
  const live = [...rows.filter((r) => r.status === "running"), ...own.filter((g) => g.status === "running")];
  return live.sort((a, b) => asks(b) - asks(a) || Number(b.startedAt) - Number(a.startedAt));
}

/** The first line of some words, cut at `n`. @param {unknown} s @param {number} n */
const lineOf = (s, n) => {
  const one = String(s || "").trim().split("\n")[0].trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/**
 * What a Watch all tile says (proposal_ux §4.7): its name, its model at its effort, how long it has run, its newest
 * work — the files it changed, the call it is in — and its newest words, what it asks you, and its foot's figures:
 * its rounds and what its context holds, with the share of its window where one is known (`tip`: the whole of that,
 * with where it compacts, lib/subagents.js `contextGauge`). A coding agent's own says what its agent told it, its
 * calls and tokens.
 * @param {SubagentRow | GuestRow} r @param {number} now
 * @returns {{ name: string, model: string, took: string, ask: (ReturnType<typeof askWords> & { question: boolean }) | null,
 *   work: { label: string, text: string, mono: boolean }[], words: string, figures: string, tip: string, own: boolean }}
 */
export function tileWords(r, now) {
  if (isGuest(r)) {
    const g = /** @type {GuestRow} */ (r);
    const tokens = Number(g.tokens) || 0;
    return {
      name: g.agent || "Agent",
      model: g.model ? prettyModel(g.model) : "",
      took: formatWorkedFor(Math.max(0, now - Number(g.startedAt))),
      ask: null,
      work: [],
      words: g.prompt ? `Started by ${g.of || "its coding agent"}: “${lineOf(g.prompt, 160)}”` : lineOf(g.description, 160),
      figures: [g.toolCalls ? `${g.toolCalls} call${g.toolCalls === 1 ? "" : "s"}` : "", tokens ? `${fmt.k(tokens)} tokens` : ""].filter(Boolean).join(" · "),
      tip: "",
      own: true,
    };
  }
  const s = /** @type {SubagentRow} */ (r);
  const p = s.progress || null;
  const asking = yourAsk(p);
  const last = s.exchanges.at(-1) || null;
  const files = s.work?.files || [];
  const changed = files.slice(0, 3).map((f) => String(f.path).split("/").pop() || f.path);
  /** @type {{ label: string, text: string, mono: boolean }[]} */
  const work = [];
  if (files.length) work.push({ label: "Changes", text: [...changed, files.length > 3 ? `${files.length - 3} more` : ""].filter(Boolean).join(" · "), mono: false });
  if (p?.tool) work.push({ label: toolLabel(p.tool.name, null, "running"), text: lineOf(p.tool.args, 80), mono: true });
  // Its newest words, the last paragraph of them: what it says it does now.
  const said = String(p?.words || "").trim().split(/\n\s*\n/).at(-1) || "";
  // What its context holds, with the share of its window where one is known; where it compacts is its thread's head's,
  // and the figures' tooltip here.
  const gauge = contextGauge(p);
  return {
    name: s.card?.name || s.description,
    model: s.model ? `${prettyModel(s.model)}${effortAt(s.effort)}` : "",
    took: formatWorkedFor(Math.max(0, now - Number(last?.startedAt ?? s.startedAt))),
    // A question a sub-agent's chat on another machine asks is its own words (`question`).
    ask: asking ? { ...askWords(asking), question: asking.kind === "question" } : null,
    work,
    words: said.length > 280 ? `${said.slice(0, 279)}…` : said,
    figures: [p?.round ? `${p.round} round${p.round === 1 ? "" : "s"}` : "", gauge?.held || ""].filter(Boolean).join(" · "),
    tip: gauge?.title || "",
    own: false,
  };
}

/**
 * What an agent that asks you wants, in its row's few words: "wants to run npm test", cut at 60.
 * @param {NonNullable<ReturnType<typeof yourAsk>>} asking
 */
const askLine = (asking) => {
  const w = askWords(asking);
  const line = `${w.verb}${w.what ? ` ${String(w.what).split("\n")[0]}` : ""}`;
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

/**
 * A row of the list: the card's name, the first words of what it was asked, the one fact that matters most now — while
 * it works, the call it is in (U12-D3) — and on the right what it cost and how long it has run or took; `where`, the
 * machine one launched on another works on ("on Workstation"), for such a one alone.
 * @param {SubagentRow} r @param {number} now
 * @returns {{ name: string, task: string, fact: string, tone: "works" | "asks" | "ok" | "apply" | "warn" | "error", where?: string, right: string }}
 */
export function sideRow(r, now) {
  const last = r.exchanges.at(-1) || null;
  const running = r.status === "running";
  const pending = Number(r.work?.pending) || 0;
  const asking = running ? yourAsk(r.progress) : null;
  /** @type {[string, "works" | "asks" | "ok" | "apply" | "warn" | "error"]} */
  // A worker's question to its lead is its lead's (HarnessV3-TaskGraph-v2 TG2-D49): it works on, and says so. So is its
  // plan (TG2-D50).
  const [fact, tone] = running
    ? asking ? [askLine(asking), "asks"] : r.progress?.asking ? [r.progress.asking.plan ? "sent its lead its plan" : "asks its lead", "works"] : [callWords(r.progress?.tool) || "working", "works"]
    : r.status === "failed" ? ["failed", "error"]
    : r.status === "aborted" ? ["cut off", "error"]
    : pending ? [`${pending} file${pending === 1 ? "" : "s"} to apply`, "apply"]
    : r.status === "stopped" || r.status === "budget-stopped" ? ["stopped", "warn"]
    : last?.delivery === "sent" || last?.delivery === "auto" ? ["sent", "ok"]
    : ["answered", "ok"];
  const end = last ? (last.endedAt ?? (running ? now : null)) : null;
  const ms = last && end != null ? Math.max(0, end - Number(last.startedAt)) : null;
  const spent = running ? r.progress?.spent : last?.spentUsd;
  const usd = typeof spent === "number" && spent > 0 ? `$${spent.toFixed(spent < 0.1 ? 3 : 2)}` : "";
  // One on another machine says where, beside its state's dot (the remote-agents plan's s-ui).
  const where = machineWords(r);
  return { name: r.card?.name || r.description, task: String(last?.description || r.description || ""), fact, tone, ...(where ? { where } : {}), right: [usd, ms != null ? formatWorkedFor(ms) : ""].filter(Boolean).join(" · ") };
}

/**
 * A row of the list for one of a coding agent's own agents (AG-157): the kind its agent gives it, what it was told,
 * how it stands, and on the right its calls and its time — Filament prices none of it — with what it holds, in tokens,
 * where its agent says it (Claude's).
 * @param {GuestRow} g @param {number} now
 * @returns {ReturnType<typeof sideRow>}
 */
export function guestRow(g, now) {
  const running = g.status === "running";
  /** @type {[string, "works" | "ok" | "warn" | "error"]} */
  const [fact, tone] = running ? ["working", "works"] : g.status === "failed" ? ["failed", "error"] : g.status === "aborted" ? ["cut off", "error"] : g.status === "stopped" ? ["stopped", "warn"] : ["done", "ok"];
  const ms = running ? Math.max(0, now - g.startedAt) : g.ms;
  const tokens = Number(g.tokens) || 0;
  return {
    name: g.agent || "Agent",
    task: g.description,
    fact,
    tone,
    right: [tokens ? `${fmt.k(tokens)} tokens` : "", g.toolCalls ? `${g.toolCalls} call${g.toolCalls === 1 ? "" : "s"}` : "", ms != null ? formatWorkedFor(ms) : ""].filter(Boolean).join(" · "),
  };
}

/**
 * The agents you called whose work this page saw running: an answer of theirs counts as not opened only then — a
 * reload never floods the tab with every old answer. Marks the running ones. One that started by itself is not one
 * you called: its answer stands in the chat, under the report.
 * @param {readonly SubagentRow[]} rows @param {{ live: Set<string>, opened: Set<string> }} watch
 */
export function watchRows(rows, watch) {
  for (const r of rows) if (r.origin !== "agent" && r.origin !== "self" && r.status === "running") watch.live.add(answerKey(r));
}

/**
 * Whether an agent you called has finished and you have not opened its answer since: its row's dot in the list, and what
 * the tab's number counts (the owner's words of 10-25: the number stayed until each was opened, and nothing showed
 * which). The main agent's agents and one that started by itself never: their answers go to the agent, in its envelopes.
 * One the page never saw at work (a reload) is not unread.
 * @param {SubagentRow} r @param {{ live: Set<string>, opened: Set<string> }} watch
 */
export const unopened = (r, watch) =>
  r.origin !== "agent" && r.origin !== "self" && r.status !== "running" && watch.live.has(answerKey(r)) && !watch.opened.has(answerKey(r));

/**
 * The Sub Agents tab's badge (AG-107): an orange dot while an agent you called asks you, a blue one while one works, else
 * how many of their answers you have not opened (`unopened`, the rows' dots); nothing otherwise. One that started by
 * itself counts only while it asks you: it is you it waits for.
 * @param {readonly SubagentRow[]} rows @param {{ live: Set<string>, opened: Set<string> }} watch
 * @returns {import("../views/tabs.js").Badge | null}
 */
export function sideBadge(rows, watch) {
  if (rows.some((r) => r.origin !== "agent" && r.status === "running" && yourAsk(r.progress))) return { dot: "asks", words: "an agent asks you" };
  const mine = rows.filter((r) => r.origin !== "agent" && r.origin !== "self");
  const working = mine.filter((r) => r.status === "running").length;
  if (working) return { dot: "works", words: `${working} working` };
  const unread = mine.filter((r) => unopened(r, watch)).length;
  return unread ? { text: String(unread), words: `${unread} answer${unread === 1 ? "" : "s"} you have not opened` } : null;
}

/** The Agents tab's pane for the teams themselves, with none chosen: what a team is, the two ways, each team (U13-D5). */
export const TEAM_HOME = "team:home";
/** The Agents tab's row of the team in charge of this chat. */
export const TEAM_CHARGE = "team:charge";
/** Whether a list's id is a team's, not an agent's thread. @param {string} id */
export const isTeamItem = (id) => String(id).startsWith("team:");
/** A team on the side's row, by its chat. @param {string} id */
export const sideTeamItem = (id) => `team:side:${id}`;
/** A team's own chat, its own row. @param {string} id */
export const selfTeamItem = (id) => `team:self:${id}`;

/**
 * A team as a row of the Agents tab (HarnessV4_Tasks U13-D5): the team in charge of this chat, each team on its side,
 * and in a team's own chat that team; its crew under it, a line each. A crew member of this chat opens its thread; one
 * of a team on the side, its team's board.
 * @typedef {{ id: string, way: "charge" | "side" | "self" | "flow", group: "lead" | "needs" | "works" | "done", key: string, name: string,
 *   tag: string, task: string, fact: string, tone: "works" | "asks" | "ok" | "warn" | "error", at: number,
 *   crew: { id: string, name: string, fact: string, tone: "works" | "asks" | "ok" | "warn" | "error", icon: string, thread: boolean }[],
 *   crewIds: string[], look?: { icon: string, tone: string }, drop?: { id: string, state: string, keeps?: boolean } }} TeamItem
 *   `at`: when it began, for its place among the agents of its part — a team on the side when it was sent, a flow
 *   when it started (else drawn); the team in charge, in a part of its own, 0;
 *   `crewIds`: this chat's agents its crew lines stand for, which the list then leaves out; `look`: its face where it is
 *   no team's — a flow's (lib/flow.js `flowRow`); `drop`: a row the person may delete (`dropOf`) — a team on the side, by
 *   its chat's id, or a flow, by its own — its state, and whether a worktree of its own stays (`keeps`)
 */

/**
 * What deleting a row of the Agents tab is (the owner's ask of 10-23: "right click threads in Agents tab and be able to
 * delete those for cleanup"): its menu's label; why it cannot go now (`busy`); the confirm's title and words; the toast
 * once it went; and the list's id it stands for (`at`).
 * @typedef {{ kind: "agent" | "team" | "flow", id: string, at: string, label: string, busy: string | null, title: string,
 *   description: string, done: string }} ThreadDrop
 */
/** Why a thing at work cannot go: its Stop comes first. */
export const DROP_BUSY = "It is at work: stop it first";
/** Why a flow that has not ended cannot go. */
export const DROP_FLOW_BUSY = "It has not ended: stop it first";

/**
 * What deleting a row is, or null for one that is no thread of the chat's to delete: a coding agent's own agent (its
 * agent's, read from its runs), the team in charge, this team, a crew line, the Teams and Flows rows.
 * @param {{ kind: "agent", row: SubagentRow | GuestRow } | { kind: "item", item: TeamItem }} x @returns {ThreadDrop | null}
 */
export function dropOf(x) {
  if (x.kind === "agent") {
    const r = /** @type {SubagentRow} */ (x.row);
    if (isGuest(r)) return null;
    const files = r.work?.pending || 0;
    const name = String(r.card?.name || "This agent");
    return {
      kind: "agent", id: r.id, at: r.id, label: "Delete thread…", busy: r.status === "running" ? DROP_BUSY : null,
      title: "Delete this thread?",
      description: [
        `${name}'s thread leaves this chat: what it was asked and what it answered.`,
        files ? `Its changes to ${files === 1 ? "1 file" : `${files} files`}, not applied, go with it.` : "",
        "What it already sent to your agent stays in the chat. This cannot be undone.",
      ].filter(Boolean).join(" "),
      done: "Thread deleted",
    };
  }
  const t = x.item;
  if (!t.drop) return null;
  if (t.way === "flow") {
    const ran = t.drop.state !== "draft";
    return {
      kind: "flow", id: t.drop.id, at: t.id, label: "Delete flow…",
      busy: t.drop.state === "running" || t.drop.state === "holds" || t.drop.state === "cut" ? DROP_FLOW_BUSY : null,
      title: "Delete this flow?",
      description: [
        ran ? `“${t.task}” leaves this chat, with its boxes' threads and its teams' chats.` : `“${t.task}” leaves this chat; nothing of it ran.`,
        t.drop.keeps ? "Its worktree and its branch stay: nothing of them is deleted." : "",
        "This cannot be undone.",
      ].filter(Boolean).join(" "),
      done: "Flow deleted",
    };
  }
  return {
    kind: "team", id: t.drop.id, at: t.id, label: "Delete team chat…", busy: t.drop.state === "working" ? DROP_BUSY : null,
    title: "Delete this team's chat?",
    description: [
      `The ${t.name} team's chat leaves this chat's side, with its lead's and its workers' threads.`,
      t.drop.state === "asking" ? "Its lead's question goes unanswered: the team stops first." : "",
      "A result already sent to your agent stays in the chat. This cannot be undone.",
    ].filter(Boolean).join(" "),
    done: "Team chat deleted",
  };
}

/** A worker's frame's tone as a row's. @param {string} tone @returns {TeamItem["tone"]} */
const frameTone = (tone) => (tone === "asks" ? "asks" : tone === "done" ? "ok" : tone === "failed" ? "error" : tone === "stopped" ? "warn" : "works");

/**
 * A crew as lines, each its member's name and number and its state in a word.
 * @param {readonly any[]} rows @param {number} now @param {boolean} thread  this chat's own: each opens its thread
 */
const crewLines = (rows, now, thread) =>
  framesOf(rows, now).map((f) => ({ id: f.id, name: `${f.name} ${f.n}`, fact: f.state.toLowerCase(), tone: frameTone(f.tone), icon: f.look.icon, thread }));

/** What a team on the side's row says of it now. @param {import("./beside.js").BesideRow} r */
function besideFact(r) {
  if (r.state === "asking") return "its lead asks you";
  if (r.state === "working") return workersWords(r) || "its lead works on it";
  if (r.state === "stopped") return r.cut ? "stopped when Filament did: Resume… goes on" : "stopped before it finished";
  const found = findingChips(r.findings || null).map((c) => c.words).join(" · ");
  // Where its result went, as its card's row says it (views/beside.js): to your agent, to BugHunters' check, else it waits.
  return [found || (r.result ? "its result is in" : "done"), notifiedWords(r) ? "sent to your agent" : r.verifiedBy ? CHECKING_WORDS : r.result ? "waits for you" : ""].filter(Boolean).join(" · ");
}
/** @param {import("./beside.js").BesideRow} r @returns {TeamItem["tone"]} */
const besideTone = (r) => (r.state === "asking" ? "asks" : r.state === "working" ? "works" : r.state === "stopped" ? "warn" : "ok");

/**
 * The teams as rows of the Agents tab: the team in charge first, in a part of its own; each team on the side by what
 * it needs of you, as an agent's row is; in a team's own chat, that team alone.
 * @param {{ leading: import("./team.js").Leading | null, live: boolean, paused: boolean, rows: readonly any[],
 *   beside: readonly import("./beside.js").BesideRow[], self: import("./beside.js").BesideRow | null,
 *   boards: (tid: string) => any[], now: number }} s  `paused`: the lead in charge waits for your answer; `rows`: this
 *   chat's agents; `boards`: the agents of a team on the side, as its board holds them
 * @returns {TeamItem[]}
 */
export function teamItems(s) {
  if (s.self) {
    const r = s.self;
    const crew = s.rows.filter((x) => !!x.team);
    return [{
      id: selfTeamItem(r.id), way: "self", group: r.state === "asking" ? "needs" : r.state === "working" ? "works" : "done", key: r.team.key, name: r.team.name,
      tag: "this team", task: r.ask, fact: besideFact(r), tone: besideTone(r), at: Number(r.at) || 0, crew: crewLines(crew, s.now, true), crewIds: crew.map((x) => String(x.id)),
    }];
  }
  /** @type {TeamItem[]} */
  const out = [];
  if (s.leading) {
    const t = s.leading;
    const crew = s.rows.filter((x) => x.team && (!x.team.key || x.team.key === t.key));
    const asks = s.paused || crew.some((x) => cardState(x) === "asking");
    const works = s.live || crew.some((x) => x.status === "running");
    out.push({
      id: TEAM_CHARGE, way: "charge", group: "lead", key: t.key, name: t.name, tag: "in charge",
      task: t.problem ? `It cannot lead now: ${t.problem}` : `${t.lead.name} answers your messages${t.members.length ? `; ${t.members.map((m) => m.name).join(", ")} under it` : ""}`,
      fact: asks ? "waits for your answer" : works ? "working" : "ready for your next message",
      tone: t.problem ? "warn" : asks ? "asks" : works ? "works" : "ok", at: 0,
      crew: crewLines(crew, s.now, true), crewIds: crew.map((x) => String(x.id)),
    });
  }
  for (const r of s.beside) {
    const live = r.state === "working" || r.state === "asking";
    out.push({
      id: sideTeamItem(r.id), way: "side", group: r.state === "asking" ? "needs" : r.state === "working" ? "works" : "done", key: r.team.key, name: r.team.name,
      tag: "on the side", task: r.ask, fact: besideFact(r), tone: besideTone(r), at: Number(r.at) || 0, crew: live ? crewLines(s.boards(r.id), s.now, false) : [], crewIds: [],
      drop: { id: r.id, state: r.state },
    });
  }
  return out;
}

/** Each part of the list, in its order, with its title where it holds teams alone. */
const PARTS = Object.freeze([["lead", "In charge of this chat"], ["needs", "Needs you"], ["works", "Working"], ["done", "Done"]]);

/**
 * A part's teams and agents in one order, newest first (the owner's 10-24: the agent they ran last sat under nine older
 * teams, which stood at the head of Done whatever their age): each team or flow takes its place among the agents by
 * when it began, the agents keep `sideGroups`' order, and at the same moment the team goes first.
 * @template R
 * @param {readonly TeamItem[]} items @param {readonly R[]} rows @param {(r: R) => number} atOf
 * @returns {({ item: TeamItem } | { row: R })[]}
 */
function byTime(items, rows, atOf) {
  const teams = [...items].sort((a, b) => b.at - a.at);
  /** @type {({ item: TeamItem } | { row: R })[]} */
  const out = [];
  let i = 0;
  for (const row of rows) {
    while (i < teams.length && teams[i].at >= atOf(row)) out.push({ item: teams[i++] });
    out.push({ row });
  }
  for (; i < teams.length; i++) out.push({ item: teams[i] });
  return out;
}

/**
 * The list with the teams in it: the team in charge in a part of its own on top; each other team or flow among the
 * agents of its part by when it began (`entries`, the order the list draws); the agents a team's row stands for leave
 * the list, under their team.
 * @template R
 * @param {{ id: string, title: string, rows: R[] }[]} groups  `sideGroups`' @param {readonly TeamItem[]} items @param {(r: R) => string} idOf
 * @param {(r: R) => number} [atOf]  when a row began its newest work (`rowAt`)
 * @returns {{ id: string, title: string, items: TeamItem[], rows: R[], entries: ({ item: TeamItem } | { row: R })[] }[]}
 */
export function withTeams(groups, items, idOf, atOf = (r) => rowAt(/** @type {any} */ (r))) {
  const taken = new Set(items.flatMap((t) => t.crewIds));
  return PARTS
    .map(([id, title]) => {
      const g = groups.find((x) => x.id === id);
      const own = items.filter((t) => t.group === id);
      const rows = (g?.rows || []).filter((r) => !taken.has(idOf(r)));
      return { id, title: g?.title || title, items: own, rows, entries: byTime(own, rows, atOf) };
    })
    .filter((g) => g.entries.length);
}

/**
 * The Agents tab's badge (U13-D5): how many work for this chat or need you — your agents, a team's crew, a lead in
 * charge at work, the teams on the side — with the orange dot while one asks you, the blue while they work; else the
 * answers you have not opened (`sideBadge`).
 * @param {import("../views/tabs.js").Badge | null} side  `sideBadge`'s
 * @param {{ text?: string, dot: "works" | "asks", words: string } | null} team  `teamBadge`'s
 * @param {readonly import("./beside.js").BesideRow[]} beside @param {{ works: number, asks: number }} mine  `mineAtWork`'s
 * @param {{ works: number, asks: number }} [flows]  the chat's flows that run, and those that wait for you (lib/flow.js);
 *   a draft is not counted: it waits for nobody until you choose to start it
 * @returns {import("../views/tabs.js").Badge | null}
 */
export function agentsBadge(side, team, beside, mine, flows = { works: 0, asks: 0 }) {
  const working = beside.filter((r) => r.state === "working").length;
  const asking = beside.filter((r) => r.state === "asking").length;
  const asks = mine.asks > 0 || team?.dot === "asks" || asking > 0 || flows.asks > 0;
  if (!asks && !mine.works && !team && !working && !flows.works) return side?.text ? side : null;
  const n = mine.works + (Number(team?.text) || (team ? 1 : 0)) + working + asking + flows.works + flows.asks;
  const words = [
    mine.asks ? (mine.asks === 1 ? "an agent asks you" : `${mine.asks} agents ask you`) : "",
    mine.works > mine.asks ? `${mine.works - mine.asks} working` : "",
    team?.words || "",
    working ? `${working} ${working === 1 ? "team" : "teams"} on the side at work` : "",
    asking ? `${asking} on the side ${asking === 1 ? "asks" : "ask"} you` : "",
    flows.asks ? `${flows.asks === 1 ? "a flow waits" : `${flows.asks} flows wait`} for you` : "",
    flows.works ? `${flows.works === 1 ? "a flow runs" : `${flows.works} flows run`}` : "",
  ].filter(Boolean).join(" · ");
  return { ...(n ? { text: String(n) } : {}), dot: asks ? "asks" : "works", words };
}

/**
 * Your agents at work for this chat, and those asking you, as the Agents tab counts them: none of a team's crew (the
 * team's badge counts them), your agent's own at work, nor one that started by itself or a flow's box at work (its flow
 * counts, HarnessV4_Flow_Plan F5) — each counts while it asks you, as `sideBadge` has it.
 * @param {readonly any[]} rows @returns {{ works: number, asks: number }}
 */
export const mineAtWork = (rows) => {
  const running = rows.filter((r) => !r.team && r.status === "running");
  const asking = running.filter((r) => r.origin !== "agent" && !!yourAsk(r.progress));
  return {
    works: running.filter((r) => r.origin !== "agent" && ((r.origin !== "self" && r.origin !== "flow") || asking.includes(r))).length,
    asks: asking.length,
  };
};
