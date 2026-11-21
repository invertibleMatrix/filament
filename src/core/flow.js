// @ts-check
// Flow (HarnessV4_Flow_Plan E24; HarnessV4_OneAgent_Plan OA3, OA4): the person's agents and teams in steps, designed by
// their main agent after `/flow` or drawn by hand. A step's boxes run side by side; a step starts once every box of the
// step before it is done or skipped; each box names the boxes it needs — boxes of earlier steps only — and is handed the
// person's words and those boxes' results (OA-D5). A box is one of the person's saved agents, at its card's level or
// lower; one of their teams fired beside the chat; or the person's own review, which holds the flow until they go on
// (OA-D10). A gate is an agent box whose answer begins with its verdict: "not yet" holds the flow and asks the person.
// Pure: the shape and its checks, the hand-off, the words each box is sent, the verdict read off an answer, a flow in
// words for the main agent, the notice its start sends it, and the message the main agent gets at the end. Started In
// place (OA4), a turn of the main agent drives it: the words that open that turn, the news it is told as the flow moves
// (`newsOf`, what moved since its `NewsMark`), and what it is told after a restart.
// app/flow-runner.js runs a flow; the page draws it.
import { foldedWords } from "./roster.js";
import { SUBAGENT_EFFORTS } from "./schema.js";
import { foldedTeamWords } from "./folded-teams.js";
import { TEAMS_OFF_WHY } from "./teams-on.js";

/**
 * What a flow holds: the person's words, a box's own, its title, a step's why; how many steps, boxes and needs; each
 * result as it is handed on and all of them together (FL-D4); the flows a chat keeps; a line of the person's at a gate
 * or a review.
 */
export const FLOW_LIMITS = Object.freeze({ goal: 8000, words: 2000, title: 120, why: 300, steps: 10, boxes: 6, total: 24, needs: 12, result: 60_000, together: 120_000, kept: 20, line: 600 });

/** A box's kind (OA-D10): one of the person's agents, one of their teams, or their own review. */
export const BOX_KINDS = Object.freeze(/** @type {const} */ (["agent", "team", "review"]));
/** @typedef {typeof BOX_KINDS[number]} BoxKind */
/** A review box's name. */
export const REVIEW_NAME = "Your review";

/**
 * A box's state: its step has not started (`waits`); it waits for a seat (`seat`, FL-D20); at work; it needs the person
 * (`asking`: its lead asks, its reply ends on a question, FL-D18, or it is the person's review); done; failed; stopped by
 * the person; skipped; cut by a restart (`cut`, FL-D19).
 */
export const BOX_STATES = Object.freeze(/** @type {const} */ (["waits", "seat", "working", "asking", "done", "failed", "stopped", "skipped", "cut"]));
/** @typedef {typeof BOX_STATES[number]} BoxState */

/** A flow's state: drawn and not started; running; holding for the person (a gate, a box that failed); done; stopped; cut by a restart. */
export const FLOW_STATES = Object.freeze(/** @type {const} */ (["draft", "running", "holds", "done", "stopped", "cut"]));
/** @typedef {typeof FLOW_STATES[number]} FlowState */

/** What a box sees of the main chat where it says (FL-D7): an agent box, nothing or the chat folded; a team box, the chat's record or the words alone. */
export const BOX_SEES = Object.freeze(/** @type {const} */ (["none", "folded", "record", "words"]));

/**
 * What a box sees as it is kept: one of BOX_SEES, or null where it names none (its card's or team's own). An agent box
 * that names a view it is not offered — the context window, a live copy, one no longer offered — sees nothing, as a
 * saved card that names one does (services/agent-cards.js `storedSees`).
 * @param {string} kind @param {unknown} v @returns {string | null}
 */
export const boxSeesOf = (kind, v) => (BOX_SEES.includes(/** @type {any} */ (v)) ? String(v) : kind === "agent" && typeof v === "string" && v.trim() ? "none" : null);

/** What the message a flow's end reaches the main agent in begins with: the chat draws that turn as Filament's. */
export const FLOW_END_HEAD = "[Filament: a flow beside this chat finished";
/** How the notice of a flow's start to the main agent begins (OA-D8). */
export const FLOW_START_HEAD = "[Filament: the person started a flow beside this chat";
/** How the turn of the main agent a flow started In place opens (OA4): the chat draws its message as Filament's. */
export const FLOW_DRIVE_HEAD = "[Filament: the person started a flow in place";
/** How each word to the main agent of a flow it drives begins (OA4): a box's end, a hold, the person's act, its end. */
export const FLOW_NEWS_HEAD = "[Filament: the flow you drive";
/** How the word after a restart to the main agent of a flow it drives begins (OA4 case 7). */
export const FLOW_RESTART_HEAD = "[Filament: Filament restarted while you drove the flow";
/** How a box's hand-off begins (`boxAsk`): a team box's chat folds it under What the flow handed it. */
export const FLOW_NOTE_HEAD = "[Filament: you are one box of a flow";
/** Whether a message block is a flow's hand-off. @param {any} b */
export const isHandoffBlock = (b) => b?.type === "text" && String(b.text || "").startsWith(FLOW_NOTE_HEAD);
/** What a team box gone on with — Go on after a restart, Retry after a stop or a failure — is told, as the person's press. */
export const FLOW_GO_ON = "[Filament: the person asks you to go on with your part of the flow from where you stopped. End on your result: your final reply is handed on.]";
/** How a box sent back from a gate or the person's review is told so begins (`backAsk`). */
export const FLOW_BACK_HEAD = "[Filament: the flow sent your part back to you";
/**
 * Whether a message block is the flow's own word to a team box's chat — go on, or sent back: the chat draws it as the
 * flow's, not as the person's typing. @param {any} b
 */
export const isFlowSaid = (b) => b?.type === "text" && (b.text === FLOW_GO_ON || String(b.text || "").startsWith(FLOW_BACK_HEAD));

/**
 * @typedef {object} FlowBox
 * @property {string} id  how the boxes after it name it in their needs
 * @property {BoxKind} kind
 * @property {string} agent  a saved agent's tag, a team's key, or "" for the person's review
 * @property {string} name  as the person reads it
 * @property {string} words  what this box is asked; for a review, what the person looks at
 * @property {string[]} needs  the boxes whose results it is handed, each of an earlier step (OA-D5)
 * @property {boolean} gate  an agent box whose answer begins with its verdict (FL-D17)
 * @property {boolean} readOnly  drawn Reads only: an agent below its card's level, a team that changes no file (FL-D6)
 * @property {string | null} model  the model it runs on where the draft names one (FL-D13); else its card's or team's
 * @property {string} [effort]  how hard it thinks where the draft names a level (one of SUBAGENT_EFFORTS) — an agent box's
 *   agent, a team box's lead —; left out, as its card or team says, else the main agent's (the owner's word of 11-05)
 * @property {string | null} sees  what it sees of the main chat where the draft says (BOX_SEES); else its card's
 * @property {BoxState} state
 * @property {{ sub?: string, team?: string } | null} run  its sub-agent's id, or its team chat's
 * @property {{ text: string, n?: number, at: number, cut?: boolean, made?: { title: string, address: string }[], drew?: { title: string, bytes: number }[], wrote?: boolean } | null} result
 *   `wrote`: an agent box that changed files in its own copy, which wait on its thread for the person; `drew`: the
 *   pictures it drew (a team box's, its chat's lead and crew), by their names and sizes (HarnessV4_DesignPass_Plan,
 *   case 13)
 * @property {{ go: boolean, why: string } | null} verdict  a gate's, read off its answer; null where it gave none
 * @property {boolean} goneOn  a gate the person went on past (Go on anyway)
 * @property {number} sentBack  how many times the person sent it back
 * @property {number} [sends]  how many times it sent a box back — a gate's not yet, or the person's review — which its card
 *   says (a flow kept before it has none)
 * @property {string | null} error  why it failed, or why it needs the person
 * @property {number} usd  what it spent
 * @property {number | null} startedAt
 * @property {number | null} endedAt
 * @property {{ verdict: { go: boolean, why: string } | null, at: number, text: string }[]} past  a gate's earlier answers
 * @property {string[]} [ran]  the sub-agents its earlier runs were — a gate asked again, a box retried — so the page keeps
 *   their threads under its flow
 * @property {BoxPlace} [place]  where a team box that writes made its changes, once it started (HarnessV4_OneAgent_Plan OA5)
 * @property {"bring"} [failedOn]  what it failed at, where its card offers a way past it: "bring" — its flow's Bring my
 *   uncommitted edits could not copy them into the worktree it made, which was taken back, and the flow has no place
 *   yet (OA5); Retry without them switches the choice off and starts it again
 */
/**
 * Where a flow's boxes work (HarnessV4_OneAgent_Plan OA5): a git worktree of the flow's own — its name, its branch, its
 * folder, and `cwd`, the folder its chats work in inside it — made from the main chat's folder's last commit when its
 * first team box that writes starts, and every box after it works there; or, where the folder is in no git repository,
 * the folder itself and why (OA-D13). Nothing in it is merged by Filament. `brought`: what of the folder's uncommitted
 * files was copied into it as it was made, where the flow asked (`Flow.bring`).
 * @typedef {{ kind: "worktree", name: string, branch: string, folder: string, cwd: string, brought?: Brought } | { kind: "folder", folder: string, why: string }} BoxPlace
 * @typedef {{ files: number, stays: string[] }} Brought  how many uncommitted files were copied in, uncommitted; `stays`:
 *   those that were not, not plain files — a link, a submodule
 */

/**
 * The worktree and branch a flow works on (OA5): its title as a branch name takes it; a taken one gives way to the
 * first free one where it is made.
 * @param {Pick<Flow, "id" | "title">} flow
 */
export function ownName(flow) {
  /** @param {string} s */
  const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  // Cut at a word's end where it can be: "plan-a-desktop-app-for", not "…-for-t".
  /** @param {string} s */
  const atWord = (s) => (s.length <= 24 ? s : (s.slice(0, 25).replace(/-[^-]*$/, "") || s).slice(0, 24).replace(/-+$/, ""));
  return `flow-${atWord(slug(flow.title)) || atWord(slug(flow.id)) || "work"}`;
}

/** Where a team box's changes are, as its flow's end and its news say it (OA5); "" for none. @param {BoxPlace | null | undefined} p */
export const placeLine = (p) => (p?.kind === "worktree" ? `its changes are on branch ${p.branch}, in the worktree ${p.folder}` : p?.kind === "folder" ? "its changes are in the folder" : "");
/**
 * What a flow's worktree was given of the folder's uncommitted files as it was made, in a clause — "the folder's 3
 * uncommitted files copied in, uncommitted"; "" where the flow did not ask. @param {Brought | null | undefined} b
 */
export const broughtLine = (b) => {
  if (!b) return "";
  const stays = b.stays.length ? `; ${b.stays.slice(0, 3).join(", ")}${b.stays.length > 3 ? ` and ${b.stays.length - 3} more` : ""} stayed, not ${b.stays.length === 1 ? "a plain file" : "plain files"}` : "";
  return `${b.files ? `the folder's ${b.files === 1 ? "uncommitted file" : `${b.files} uncommitted files`} copied in, uncommitted` : "nothing uncommitted in the folder to copy in"}${stays}`;
};
/** Where a flow works, in a line its main agent reads (OA5); "" before it has a place. @param {BoxPlace | null | undefined} p */
export const worksIn = (p) =>
  p?.kind === "worktree"
    ? `Works in: the worktree ${p.folder}, on branch ${p.branch} — made from the folder's last commit when its first team box that writes started${p.brought ? `, ${broughtLine(p.brought)}` : ""}; every box after it works there, never in your folder, and nothing of it is merged.`
    : p?.kind === "folder"
      ? `Works in: the folder — ${p.why}, so its boxes that write change your folder's files.`
      : "";
/**
 * What was done to a flow while it ran, by the person or the main agent that drives it (OA4): kept on it, its card shows
 * the agent's, and the agent is told the person's. `n` counts them from 1, never reused.
 * @typedef {{ n: number, at: number, by: "person" | "agent", what: string, why?: string }} FlowAct
 */
/**
 * @typedef {object} Flow
 * @property {string} id
 * @property {string} chainId  the main chat
 * @property {string} title
 * @property {string} goal  the person's words: the message it was designed from, or what they typed for it
 * @property {FlowState} state
 * @property {{ why: string, boxes: FlowBox[] }[]} steps  `why`: the step's one line on why it is where it is (L17)
 * @property {boolean} tell  Tell my agent when done (FL-D11, OA-D9)
 * @property {{ kind: "gate" | "box" | "driver", box: string } | null} hold  what it holds for: a gate, a box that failed or
 *   stopped, or — In place — the turn that drove it ended before it did (`driver`, its box "")
 * @property {{ text: string, sent: { at: number, how: string } | null, missed: string | null } | null} end  its message to the main agent, kept until it went
 * @property {"agent" | "hand" | "saved"} drawn  how it was drawn: by the main agent's flow tool, by hand, from a saved flow
 * @property {number} at
 * @property {number | null} startedAt
 * @property {number | null} endedAt
 * @property {number} sentBack
 * @property {boolean} [inPlace]  started In place (OA4): a turn of the main agent drove it
 * @property {boolean} [drives]  the main agent drives it now: every turn of its chat is owed it until it ends, until the
 *   turn that drives it ends otherwise, or until the person goes on beside the chat
 * @property {string | null} [lost]  why the turn that drove it ended before it did, where one did
 * @property {FlowAct[]} [acts]  what was done to it while it ran, the oldest first (the newest `ACTS_KEPT`)
 * @property {BoxPlace | null} [place]  where its boxes work from its first team box that writes on (OA5)
 * @property {boolean} [bring]  Bring my uncommitted edits: its worktree, once made, is given a copy of the folder's
 *   uncommitted files, uncommitted (`BoxPlace.brought`); off unless the person switched it on
 */
/**
 * The person's agents and teams as a flow is checked against them: every agent of theirs that may be a box — not a
 * team's own Lead, nor one that starts by itself — with its level (`may`).
 * @typedef {{ cards: readonly { tag: string, name: string, goodFor?: string, may?: string }[], teams: readonly { key: string, name: string, line?: string, readOnly?: boolean }[] }} Roster
 */

/** @param {unknown} s */
const clean = (s) => String(s ?? "").replace(/\r\n?/g, "\n").trim();
/** Text on one line, cut to `n` characters. @param {unknown} s @param {number} n */
export const lineOf = (s, n) => {
  const t = clean(s).replace(/\s+/g, " ");
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
/** An attribute's value as a block's head carries it. @param {unknown} s */
const attr = (s) => lineOf(s, 120).replace(/"/g, "'");
/** Names in a list: "Product", "Product and End user", "Product, End user and Reviewer". @param {readonly string[]} names */
const listed = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
/** What a box's id may be: a word of letters, digits and dashes. */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
/** @param {unknown} s */
const idOf = (s) => String(s ?? "").trim().toLowerCase();

/** Every box of a flow, in order, with its step. @param {Pick<Flow, "steps">} flow */
export const boxesOf = (flow) => flow.steps.flatMap((s, i) => s.boxes.map((box) => ({ box, step: i })));
/** A box by its id, with its step, or null. @param {Pick<Flow, "steps">} flow @param {string} id */
export const boxOf = (flow, id) => boxesOf(flow).find((x) => x.box.id === id) || null;

/** Whether a team box writes in the folder: unless its team or the box reads only (FL-D6). An agent box writes in its own copy at most. @param {FlowBox} box @param {Roster} roster */
export const writes = (box, roster) => box.kind === "team" && !box.readOnly && roster.teams.find((t) => t.key === box.agent)?.readOnly !== true;

/** A saved agent by its tag or its name, as a draft may name it. @param {Roster} roster @param {string} word */
const cardBy = (roster, word) => roster.cards.find((c) => c.tag === word) || roster.cards.find((c) => c.name.toLowerCase() === word) || null;
/** A team by its key or its name. @param {Roster} roster @param {string} word */
const teamBy = (roster, word) => roster.teams.find((t) => t.key === word) || roster.teams.find((t) => t.name.toLowerCase() === word) || null;

/**
 * A flow's shape from what a draft, an edit or a saved flow says: its steps, each with its why and its boxes, each box
 * with its fields and a fresh state. A box says its kind (`kind`), or is the person's review (`review: true`), one of
 * their teams (`team`), or one of their agents (`agent`) — by its tag or its name, read from the roster where it holds
 * it. A box that names no needs needs every box of the step before it. Nothing is checked here (`checkFlow`).
 * @param {any} input @param {Roster} roster @param {{ id: string, chainId: string, at: number, taken?: ReadonlySet<string>, drawn?: Flow["drawn"], before?: readonly string[] }} o
 *   `taken`: ids a new box may not take — a running flow's boxes, beside the steps an edit gives; `before`: the boxes
 *   of the step before the first one given — a running flow's last kept step, which the edit's first step needs
 * @returns {Flow}
 */
export function flowOf(input, roster, { id, chainId, at, taken = new Set(), drawn = "hand", before: first = [] }) {
  const raw = (Array.isArray(input?.steps) ? input.steps : []).map((/** @type {any} */ s) => ({ why: s?.why, boxes: Array.isArray(s?.boxes) ? s.boxes : Array.isArray(s) ? s : [] }));
  const given = new Set([...taken]);
  for (const s of raw) for (const b of s.boxes) if (ID_RE.test(idOf(b?.id))) given.add(idOf(b.id));
  let n = 0;
  const nextId = () => {
    let k;
    do k = `b${++n}`;
    while (given.has(k));
    given.add(k);
    return k;
  };
  /** @type {string[]} */
  let before = [...first];
  const steps = raw.map((s) => {
    const boxes = s.boxes.map((/** @type {any} */ b) => boxFrom(b, roster, nextId, before));
    before = boxes.map((b) => b.id);
    return { why: lineOf(s.why, FLOW_LIMITS.why), boxes };
  });
  const goal = clean(input?.goal);
  return {
    id,
    chainId,
    title: lineOf(input?.title || goal.split("\n")[0] || "A flow", FLOW_LIMITS.title),
    goal,
    state: "draft",
    steps,
    tell: input?.tell !== false,
    ...(input?.bring === true ? { bring: true } : {}),
    hold: null,
    end: null,
    drawn,
    at,
    startedAt: null,
    endedAt: null,
    sentBack: 0,
  };
}

/** @param {any} b @param {Roster} roster @param {() => string} nextId @param {string[]} before  the step before's ids @returns {FlowBox} */
function boxFrom(b, roster, nextId, before) {
  /** @type {BoxKind} */
  const kind = BOX_KINDS.includes(b?.kind) ? b.kind : b?.review === true ? "review" : b?.team != null && b?.agent == null ? "team" : "agent";
  const word = kind === "review" ? "" : String((kind === "team" ? (b?.team ?? b?.agent) : b?.agent) ?? "").trim().replace(/^@/, "").toLowerCase();
  const found = kind === "team" ? teamBy(roster, word) : kind === "agent" ? cardBy(roster, word) : null;
  const agent = found ? ("key" in found ? found.key : found.tag) : word;
  const sees = boxSeesOf(kind, b?.sees);
  const needs = Array.isArray(b?.needs) ? [...new Set(b.needs.map(idOf).filter(Boolean))] : [...before];
  return {
    id: ID_RE.test(idOf(b?.id)) ? idOf(b.id) : nextId(),
    kind,
    agent,
    name: kind === "review" ? REVIEW_NAME : found?.name || agent,
    words: clean(b?.words),
    needs,
    gate: kind === "agent" && b?.gate === true,
    readOnly: kind !== "review" && b?.readOnly === true,
    model: kind !== "review" && typeof b?.model === "string" && b.model.trim() ? b.model.trim() : null,
    ...(kind !== "review" && SUBAGENT_EFFORTS.includes(b?.effort) ? { effort: /** @type {string} */ (b.effort) } : {}),
    sees: kind === "review" ? null : sees,
    state: "waits",
    run: null,
    result: null,
    verdict: null,
    goneOn: false,
    sentBack: 0,
    sends: 0,
    error: null,
    usd: 0,
    startedAt: null,
    endedAt: null,
    past: [],
    ran: [],
  };
}

/**
 * What a stranger's refusal says: who there is, so the main agent picks one or asks the person (L4).
 * @param {"agent" | "team"} kind @param {string} word @param {Roster} roster
 */
export function strangerWords(kind, word, roster) {
  const cards = roster.cards.map((c) => `${c.tag} (${c.name})`);
  const teams = roster.teams.map((t) => `${t.key} (${t.name})`);
  // A card or a team Filament does not ship, which a saved flow may name: the box needs the card that does its work, or
  // the team that does — Builders, or BugHunters.
  const folded = kind === "agent" ? foldedWords(word, (into) => `pick ${into} for this box`) : null;
  if (folded) return `the box for "${word}" needs a card — ${folded}`;
  const team = kind === "team" ? foldedTeamWords(word) : null;
  if (team) return `the box for "${word}" needs a team — ${team}`;
  return kind === "team"
    ? `no team of the person's is called "${word}": theirs are ${teams.join(", ") || "none"} — pick one, or ask the person`
    : `no agent of the person's is called "${word}": theirs are ${cards.join(", ") || "none"}${teams.length ? `, and their teams ${teams.join(", ")}` : ""} — pick one of them, or ask the person`;
}

/**
 * The needs of each box that do not hold: a box no step has, or one in the box's own step or a later one — each by its
 * name, as the page shows it on the box (OA3 case 5).
 * @param {Pick<Flow, "steps">} flow @returns {Map<string, string[]>}
 */
export function brokenNeeds(flow) {
  const at = new Map(boxesOf(flow).map((x) => [x.box.id, x]));
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const { box, step } of boxesOf(flow)) {
    const bad = box.needs.filter((n) => {
      const x = at.get(n);
      return !x || x.step >= step;
    }).map((n) => at.get(n)?.box.name || n);
    if (bad.length) out.set(box.id, bad);
  }
  return out;
}

/**
 * Why a flow cannot be started as it is drawn, in words its main agent or the person reads, or null. `teamChat`: it is
 * drawn in a team's own chat, which draws no flow. `teams` false: Settings › Experimental's Teams switch is off
 * (core/teams-on.js), and a team box that has not started is refused.
 * @param {Pick<Flow, "steps" | "goal">} flow @param {Roster} roster @param {{ teamChat?: boolean, teams?: boolean }} [o]
 * @returns {string | null}
 */
export function checkFlow(flow, roster, { teamChat = false, teams = true } = {}) {
  if (teamChat) return "a team's own chat draws no flow: draw it in its main chat";
  if (!clean(flow.goal)) return "say what the flow is for: its words head every box's ask";
  if (clean(flow.goal).length > FLOW_LIMITS.goal) return `what the flow is for is ${FLOW_LIMITS.goal} characters at most; this is ${clean(flow.goal).length}`;
  const steps = flow.steps || [];
  if (!steps.length) return "a flow needs steps: add a step with a box";
  if (steps.length > FLOW_LIMITS.steps) return `a flow has ${FLOW_LIMITS.steps} steps at most; this has ${steps.length}`;
  const all = boxesOf(flow);
  if (all.length > FLOW_LIMITS.total) return `a flow has ${FLOW_LIMITS.total} boxes at most; this has ${all.length}`;
  for (const [i, s] of steps.entries()) {
    if (!s.boxes.length) return `step ${i + 1} has no box: add one, or take the step out`;
    if (s.boxes.length > FLOW_LIMITS.boxes) return `a step holds ${FLOW_LIMITS.boxes} boxes at most; step ${i + 1} holds ${s.boxes.length}`;
  }
  if (all.length < 2) {
    const b = all[0].box;
    return b.kind === "team" ? `a flow of one box is the ${b.name} team's Brief: send the team instead` : b.kind === "review" ? "a flow of your review alone has nothing to review: add the boxes it reads" : `a flow of one box is an ask: ask ${b.name} instead`;
  }
  const stepOf = new Map(all.map((x) => [x.box.id, x]));
  const ids = new Set();
  for (const { box, step } of all) {
    const where = `${box.name || "a box"} (step ${step + 1})`;
    if (ids.has(box.id)) return `two boxes share the id ${box.id}: give each its own`;
    ids.add(box.id);
    if (!BOX_KINDS.includes(box.kind)) return `${where}: a box is one of the person's agents, one of their teams, or their review`;
    if (box.kind === "team") {
      // While Settings › Experimental's Teams switch is off no team box starts: one that ran, or runs, stays as it is.
      if (!teams && (!box.state || box.state === "waits")) return `${where} is a team, and ${TEAMS_OFF_WHY}: put one of the person's agents in its place, or turn teams on`;
      if (!box.agent) return `step ${step + 1} has a team box with no team: pick one`;
      if (!roster.teams.some((t) => t.key === box.agent)) return strangerWords("team", box.agent, roster);
    } else if (box.kind === "agent") {
      if (!box.agent) return `step ${step + 1} has a box with no agent: pick one`;
      if (!roster.cards.some((c) => c.tag === box.agent)) return strangerWords("agent", box.agent, roster);
    }
    if (box.kind !== "review" && !clean(box.words)) return `${where}: say what it is asked`;
    if (clean(box.words).length > FLOW_LIMITS.words) return `${where}: what a box is asked is ${FLOW_LIMITS.words} characters at most; this is ${clean(box.words).length}`;
    if (box.needs.length > FLOW_LIMITS.needs) return `${where}: a box needs ${FLOW_LIMITS.needs} boxes at most; this one needs ${box.needs.length}`;
    for (const n of box.needs) {
      const x = stepOf.get(n);
      if (!x) return `${where} needs "${n}", which is no box of this flow: name a box by its id`;
      if (x.box.id === box.id) return `${where} needs itself: a box needs only boxes before it`;
      if (x.step >= step) return `${where} needs ${x.box.name} (step ${x.step + 1}): a box reads only the results of the steps before its own — move ${x.box.name} up, or ${box.name} down`;
    }
    if (box.gate) {
      if (box.kind !== "agent") return `${where}: a gate is an agent box, so its answer begins with its verdict`;
      if (step === 0) return `${where}: a gate checks what came before it, so it cannot be the first step`;
      if (!box.needs.length) return `${where}: a gate checks what it needs — name the boxes it checks`;
    }
    if (box.kind === "review") {
      if (step === 0) return `${where}: your review looks at what came before it, so it cannot be the first step`;
      if (!box.needs.length) return `${where}: your review looks at what it needs — name the boxes you review`;
    }
  }
  for (const [i, s] of steps.entries()) {
    const writers = s.boxes.filter((b) => writes(b, roster));
    if (writers.length > 1)
      return `step ${i + 1} has ${writers.length} boxes that write (${writers.map((b) => b.name).join(", ")}): two writers side by side change the same files — put them in steps of their own, or draw one Reads only`;
  }
  return null;
}

/** Whether a box lets its flow go past it: done (a gate's verdict go, or gone on past; a review the person went on from), or skipped. @param {FlowBox} box */
export const passed = (box) => box.state === "skipped" || (box.state === "done" && (!box.gate || box.verdict?.go === true || box.goneOn));

/** The step a flow is at: the first whose boxes have not all let it pass; -1 once every step has. @param {Pick<Flow, "steps">} flow */
export function stepAt(flow) {
  const i = flow.steps.findIndex((s) => !s.boxes.every(passed));
  return i;
}

/** Whether a box is at work or about to be: it holds its step. @param {FlowBox} box */
export const live = (box) => box.state === "seat" || box.state === "working" || box.state === "asking";

/** What the person's review hands on when they go on: that they did, and their line. @param {unknown} line */
export const reviewResult = (line) => {
  const said = clean(line);
  return said ? `The person reviewed the work before this point and went on, with a line of theirs: ${said}` : "The person reviewed the work before this point and went on.";
};

/**
 * What a box is handed (FL-D4, OA-D5): the result of each box it needs, in a block of its own, earliest first — each
 * whole up to FLOW_LIMITS.result, all of them up to FLOW_LIMITS.together, the earliest cut first and said as cut — with
 * the artifacts a box published by their titles and addresses, an agent's changes in its own copy said, and a skipped
 * box said as skipped. Null for a box that needs none.
 * @param {Pick<Flow, "steps">} flow @param {FlowBox} at  the box handed it
 * @returns {{ text: string, cut: string[], count: number } | null}
 */
export function handOff(flow, at) {
  const mine = boxOf(flow, at.id)?.step ?? Infinity;
  const needs = new Set(at.needs || []);
  /** @type {{ step: number, box: FlowBox, body: string, note: string }[]} */
  const parts = [];
  for (const { box, step } of boxesOf(flow)) {
    if (step >= mine || !needs.has(box.id)) continue;
    if (box.state === "skipped") {
      parts.push({ step, box, body: "", note: "The person skipped this box: it hands on nothing." });
      continue;
    }
    const text = clean(box.result?.text);
    const made = (box.result?.made || []).map((m) => `- ${lineOf(m.title, 160)} — ${m.address}`);
    const tail = [
      made.length ? `It published ${made.length === 1 ? "an artifact" : `${made.length} artifacts`}, which you can open by its address:\n${made.join("\n")}` : "",
      box.result?.wrote ? "It changed files in its own copy of the project; they wait on its thread for the person to keep, so they are not in the folder unless the person applied them." : "",
    ].filter(Boolean).map((t) => `\n\n${t}`).join("");
    const whole = text.length > FLOW_LIMITS.result ? `${text.slice(0, FLOW_LIMITS.result)}\n…[Filament: its result is cut here, at ${FLOW_LIMITS.result.toLocaleString("en-US")} characters; the whole is on its box's card]` : text;
    parts.push({ step, box, body: `${whole || "(it gave no words)"}${tail}`, note: "" });
  }
  if (!parts.length) return null;
  // Past what all of them may hold together, the earliest are cut first: each keeps its head, and says it was cut.
  let over = parts.reduce((n, p) => n + p.body.length, 0) - FLOW_LIMITS.together;
  /** @type {string[]} */
  const cut = [];
  for (const p of parts) {
    if (over <= 0) break;
    if (!p.body) continue;
    const take = Math.min(p.body.length, over);
    p.body = p.body.slice(0, p.body.length - take);
    p.note = `…[Filament: ${p.body ? "the rest of this result is" : "this result is"} left out to fit every result into what one box is handed; the whole is on its box's card]`;
    over -= take;
    cut.push(p.box.name);
  }
  const blocks = parts.map((p) => {
    const head = `<flow-result step="${p.step + 1}" box="${attr(p.box.name)}" kind="${p.box.gate ? "gate" : p.box.kind}"${p.box.state === "skipped" ? ' skipped="yes"' : ""}${p.box.gate && p.box.verdict ? ` verdict="${p.box.verdict.go ? "go" : "not yet"}"` : ""}>`;
    return [head, ...(p.body ? [p.body] : []), ...(p.note ? [p.note] : []), "</flow-result>"].join("\n");
  });
  return {
    text: [`<flow-results count="${parts.length}">`, "The results of the boxes your part needs, earliest first, each as its box ended on it. No agent can read another's exchange: what is here is what you have of theirs.", "", blocks.join("\n\n"), "</flow-results>"].join("\n"),
    cut,
    count: parts.length,
  };
}

/** What a gate's ask ends with (FL-D17): Filament reads the last `Verdict:` line of its answer. */
export const VERDICT_RULE =
  "You are this flow's gate. Begin your answer with one line: `Verdict: go` where the work before you may go on to the next step, or `Verdict: not yet — <why, in one line>` where it may not. Then give your reasons. The person reads your verdict: on not yet, they may send the work back with your answer.";

/** What a team box's ask ends with (§4.6): a question in plain words holds the box, so the lead asks with its tool and ends on its result. */
export const TEAM_RULE =
  "Where you need the person's answer, ask with your question tool and wait for it. End on your result, never on a question: your final reply is what Filament hands to the steps after you.";

/**
 * The words a box is sent (§4.4): Filament's note on where it stands, the person's words, the results it needs, then
 * its own part and, for a gate, the verdict it begins with. A team box's `ask` is its part alone (a Brief's words stop
 * at 4,000 characters) and the rest rides as a part of its own (`handoff`); an agent box's `prompt` is all of it.
 * @param {Pick<Flow, "steps" | "goal" | "title">} flow @param {FlowBox} box @param {number} at  its step
 * @returns {{ prompt: string, handoff: string, ask: string, cut: string[] }}
 */
export function boxAsk(flow, box, at) {
  const handed = handOff(flow, box);
  const last = at === flow.steps.length - 1;
  const why = flow.steps[at]?.why;
  const needed = box.needs.map((n) => boxOf(flow, n)?.box.name).filter((x) => typeof x === "string");
  const note = `${FLOW_NOTE_HEAD} the person started beside their chat — steps of their agents and teams, each handed the person's words and the results of the boxes it needs. You are ${box.name}, in step ${at + 1} of ${flow.steps.length}${box.gate ? ", the flow's gate" : ""}${why ? `, placed there because: ${lineOf(why, FLOW_LIMITS.why).replace(/[.!。]+$/u, "")}` : ""}. ${needed.length ? `Your part needs ${listed(needed)}: their results are below.` : "Your part needs no box's result: the person's words are your start."} Your result is your final reply: ${last ? "the flow ends with your step, and" : "Filament hands it to the boxes that need it, and"} the person reads it on your box, so write it whole.${handed?.cut.length ? ` Some results before you were cut to fit (${handed.cut.join(", ")}); their boxes hold them whole.` : ""}]`;
  const goal = `<flow-goal title="${attr(flow.title)}">\nWhat the person wants of the whole flow, in their words:\n${clean(flow.goal)}\n</flow-goal>`;
  const part = `Your part: ${clean(box.words)}`;
  const rule = box.gate ? VERDICT_RULE : box.kind === "team" ? TEAM_RULE : "";
  const ask = [part, ...(rule ? [rule] : [])].join("\n\n");
  const handoff = [note, goal, ...(handed ? [handed.text] : [])].join("\n\n");
  return { prompt: `${handoff}\n\n${ask}`, handoff, ask, cut: handed?.cut || [] };
}

/**
 * The words a box sent back from a gate or the person's review is sent (§4.5): the gate's answer whole, the line of
 * whoever sent it back — the person, or the main agent that drives the flow In place (OA4) — and what to do.
 * @param {FlowBox} box @param {{ gate: string, review?: boolean, answer: string, line: string, by?: "person" | "agent" }} o
 *   `gate`: the box that held it, by name; `review`: it was the person's review
 */
export function backAsk(box, { gate, review = false, answer, line, by = "person" }) {
  const said = clean(line);
  const who = by === "agent" ? "the main agent that drives the flow" : "the person";
  return [
    `${FLOW_BACK_HEAD}: ${review ? "the person reviewed it and sent it back" : `its gate, ${gate}, did not let your step go on, and ${who} sent your part back`}${said ? ` with a line of ${by === "agent" ? "its" : "their"} own` : ""}. Do your part again with it in mind: your new final reply replaces your last result, and ${review ? "the person reviews it again" : "the gate reads it again"}.${box.kind === "team" ? " What you already changed stays: go on from it." : ""}]`,
    ...(review ? [] : [`<flow-gate box="${attr(gate)}">\n${clean(answer) || "(it gave no words)"}\n</flow-gate>`]),
    ...(said ? [`${by === "agent" ? "Its" : "The person's"} line: ${said}`] : []),
    `Your part, the same: ${clean(box.words)}`,
    ...(box.kind === "team" ? [TEAM_RULE] : []),
  ].join("\n\n");
}

/**
 * A gate's verdict read off its answer (FL-D17): the last line that begins `Verdict:` — `go`, or `not yet` with its why.
 * Null where no such line is there, or it says neither: the flow holds and says the gate gave no verdict.
 * @param {unknown} text @returns {{ go: boolean, why: string } | null}
 */
export function verdictOf(text) {
  const lines = clean(text).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^[\s>*_#`-]*verdict[*_`]*\s*[:：][*_`\s]*(.*)$/i.exec(lines[i]);
    if (!m) continue;
    const v = m[1].replace(/[*_`]+/g, "").trim();
    if (/^not\s+yet\b/i.test(v) || /^no\b/i.test(v)) return { go: false, why: v.replace(/^(?:not\s+yet|no)\b/i, "").replace(/^[\s—–:;,.-]+/, "").trim() };
    if (/^go\b/i.test(v)) return { go: true, why: v.replace(/^go\b/i, "").replace(/^[\s—–:;,.-]+/, "").trim() };
    return null;
  }
  return null;
}

/**
 * Whether a reply ends on a question (FL-D18): its last paragraph ends in a question mark, its closing marks aside. A
 * team box whose lead ends so holds as Asks you.
 * @param {unknown} text
 */
export function endsAsking(text) {
  const paras = clean(text).split(/\n\s*\n/).filter((p) => p.trim());
  const last = (paras.at(-1) || "").replace(/[\s*_`)"'’”\]]+$/u, "");
  return last.endsWith("?") || last.endsWith("？");
}

/** A box's state in the card's words. */
export const BOX_WORDS = Object.freeze({ waits: "Waits", seat: "Waits for a seat", working: "At work", asking: "Asks you", done: "Done", failed: "Failed", stopped: "Stopped", skipped: "Skipped", cut: "Stopped by a restart" });

/**
 * A flow's line in its chat's status (§4.8): where it is, and what it waits for.
 * @param {Pick<Flow, "steps" | "state" | "hold" | "drives">} flow
 */
export function flowLine(flow) {
  const n = flow.steps.length;
  const i = stepAt(flow);
  const at = i < 0 ? n : i + 1;
  // Driven In place (OA4), it says so while it runs.
  const name = flow.drives ? "Flow in place" : "Flow";
  if (flow.state === "draft") return "Flow · drawn, not started";
  if (flow.state === "done") return `Flow · done, ${n} step${n === 1 ? "" : "s"}`;
  if (flow.state === "stopped") return `Flow · stopped at step ${at} of ${n}`;
  if (flow.state === "cut") return `Flow · step ${at} of ${n} · stopped by a restart`;
  const asking = boxesOf(flow).find((x) => x.box.state === "asking")?.box;
  if (flow.state === "holds" && flow.hold?.kind === "driver") return `Flow · step ${at} of ${n} · your agent's turn ended`;
  if (flow.state === "holds" && flow.hold) {
    const b = boxOf(flow, flow.hold.box)?.box;
    return `${name} · step ${at} of ${n} · ${b?.name || "a box"} ${flow.hold.kind === "gate" ? (flow.drives ? "asks your agent or you" : "asks you") : `${b?.state === "failed" ? "failed" : "stopped"}`}`;
  }
  if (asking) return `${name} · step ${at} of ${n} · ${asking.kind === "review" ? "your review" : `${asking.name} asks you`}`;
  const seat = flow.steps[i]?.boxes.every((b) => b.state === "seat");
  return `${name} · step ${at} of ${n}${seat ? " · waits for a seat" : ""}`;
}

/** A box's kind in a word or two, as the main agent reads a flow. @param {Pick<FlowBox, "kind" | "gate" | "readOnly" | "place">} b @param {Roster | null} [roster] @param {FlowBox} [box] */
function kindWords(b, roster = null, box) {
  if (b.gate) return "gate";
  if (b.kind === "review") return "the person's review";
  // A team that writes, once it started, says where (OA5): the flow's worktree, or the folder.
  if (b.kind === "team") return b.readOnly ? "team, reads only" : roster && box && !writes(box, roster) ? "team, reads only" : b.place?.kind === "worktree" ? `team, writes in the flow's worktree on branch ${b.place.branch}` : b.place ? "team, writes in the folder" : "team, writes";
  return b.readOnly ? "agent, reads only" : "agent";
}

/**
 * A flow in words, as its main agent reads it — the flow tool's answer and its start's notice: each step with its why,
 * each box with its id, who it is, its needs and its part; past its draft, each box's state.
 * @param {Pick<Flow, "id" | "title" | "goal" | "state" | "steps" | "place">} flow @param {Roster | null} [roster]
 */
export function flowText(flow, roster = null) {
  const names = new Map(boxesOf(flow).map((x) => [x.box.id, x.box.name]));
  const lines = flow.steps.flatMap((s, i) => [
    `Step ${i + 1}${s.why ? ` — why here: ${s.why}` : ""}`,
    ...s.boxes.map((b) => {
      const needs = b.needs.length ? `needs ${b.needs.map((n) => `${n} (${names.get(n) || "no such box"})`).join(", ")}` : "needs nothing";
      const state = flow.state === "draft" ? "" : ` · ${b.gate && b.state === "done" ? (b.verdict?.go ? "verdict go" : b.goneOn ? "the person went on past not yet" : b.verdict ? "verdict not yet" : "no verdict") : BOX_WORDS[b.state].toLowerCase()}`;
      return `- ${b.id}: ${b.name} (${kindWords(b, roster, b)}) · ${needs}${state}${b.words ? ` · "${lineOf(b.words, 300)}"` : ""}`;
    }),
  ]);
  const where = worksIn(flow.place);
  return [`<flow id="${flow.id}" title="${attr(flow.title)}" state="${flow.state}">`, `What it is for: ${lineOf(flow.goal, 600)}`, ...(where ? [where] : []), ...lines, "</flow>"].join("\n");
}

/**
 * The notice a flow's start sends its main agent (OA-D8): with its next message, or into its running turn — the final
 * version, the person's edits in it. It does not wake it.
 * @param {Pick<Flow, "id" | "title" | "goal" | "state" | "steps" | "tell" | "drawn">} flow @param {Roster | null} [roster]
 */
export function startNotice(flow, roster = null) {
  return [
    `${FLOW_START_HEAD}: "${lineOf(flow.title, 200)}", as it stands below — ${flow.drawn === "agent" ? "the draft you drew, with any change of theirs in it" : "drawn by them"}. Filament runs it step by step beside your chat while you go on with yours; you read nothing of it as it runs, and ${flow.tell ? "its end comes to you as one message" : "its end waits for the person, who left Tell my agent when done off"}. Do not start its boxes yourself. Where the person asks how it stands, your flow tool's read says.]`,
    "",
    flowText(flow, roster),
  ].join("\n");
}

/**
 * The message a flow's end reaches the main agent in (FL-D11): what the flow was, a line per box, and the last step's
 * results whole (each up to FLOW_LIMITS.result). One text block, appended: the chat's earlier turns stay as its cache
 * holds them.
 * @param {Pick<Flow, "steps" | "title" | "goal" | "place">} flow @param {Roster | null} [roster]  a team that reads only as it
 *   ships says so
 * @param {((drew: { title: string, bytes: number }[]) => string) | null} [pictures]  the line naming the pictures its boxes
 *   drew, as the registry words a helper's (HarnessV4_DesignPass_Plan, case 13); without it, their names
 */
export function endMessage(flow, roster = null, pictures = null) {
  const lines = flow.steps.map((s, i) => `${i + 1}. ${s.boxes.map((b) => `${b.name} (${kindWords(b, roster, b)}) — ${b.gate && b.state === "done" ? (b.verdict?.go ? "go" : "went on past not yet") : b.kind === "review" && b.state === "done" ? "the person went on" : BOX_WORDS[b.state].toLowerCase()}${b.result?.made?.length ? `, ${b.result.made.length} artifact${b.result.made.length === 1 ? "" : "s"}` : ""}${b.result?.drew?.length ? `, ${b.result.drew.length} picture${b.result.drew.length === 1 ? "" : "s"}` : ""}${b.result?.wrote ? ", changes in its own copy" : ""}${b.place ? `; ${placeLine(b.place)}` : ""}`).join("; ")}`);
  const drew = boxesOf(flow).flatMap(({ box }) => (box.state === "done" ? box.result?.drew || [] : []));
  const drewSaid = drew.length ? (pictures ? pictures(drew) : `Its boxes drew ${drew.map((d) => d.title).join(", ")}, shown to the developer.`) : "";
  const lastAt = flow.steps.length - 1;
  const results = (flow.steps[lastAt]?.boxes || [])
    .filter((b) => b.state === "done")
    .map((b) => {
      const t = clean(b.result?.text);
      const body = t.length > FLOW_LIMITS.result ? `${t.slice(0, FLOW_LIMITS.result)}\n…[Filament: the rest is left out; its box holds it whole]` : t;
      return `<flow-result step="${lastAt + 1}" box="${attr(b.name)}">\n${body || "(it gave no words)"}\n</flow-result>`;
    });
  return [
    `${FLOW_END_HEAD}: "${lineOf(flow.title, 200)}", which the person started, asked for: "${lineOf(flow.goal, 600)}". The person set it to reach you when done. What its team boxes changed is where each one's line says — on the flow's own branch, in its worktree, or in the folder — and what its agents changed in their own copies waits on their threads for the person. Nothing of it is merged: what to do with it is yours and the person's.]`,
    "",
    `<flow-end title="${attr(flow.title)}">`,
    ...(worksIn(flow.place) ? [worksIn(flow.place)] : []),
    ...lines,
    "",
    "The last step's results:",
    results.length ? results.join("\n\n") : "(none: its boxes were skipped)",
    ...(drewSaid ? ["", drewSaid] : []),
    "</flow-end>",
  ].join("\n");
}

/**
 * A flow's end as its envelope's line says it to the main agent (HarnessV4_Envelopes_Plan EN4): from the person's flow,
 * by its title; Filament's subject — how its boxes ended (EN-D3).
 * @param {Pick<Flow, "steps" | "title">} flow @returns {{ description: string, sender: string, subject: string, via: "flow" }}
 */
export function endEnvelope(flow) {
  const boxes = flow.steps.flatMap((s) => s.boxes || []);
  const of = (/** @type {string} */ state) => boxes.filter((b) => b.state === state).length;
  const steps = flow.steps.length;
  const ended = [`${of("done")} of ${boxes.length} box${boxes.length === 1 ? "" : "es"} done`, ...(of("failed") ? [`${of("failed")} failed`] : []), ...(of("skipped") ? [`${of("skipped")} skipped`] : []), ...(of("stopped") ? [`${of("stopped")} stopped`] : [])];
  const title = lineOf(flow.title, 80);
  return { description: `the flow "${title}"`, sender: `the developer's flow "${title}"`, subject: `it is done, ${steps} step${steps === 1 ? "" : "s"}: ${ended.join(", ")}`, via: "flow" };
}

/** Whether a delivery's text is a flow's start's notice (`startNotice`): the person's row says it rode with them. @param {unknown} text */
export const isFlowStart = (text) => typeof text === "string" && text.startsWith(FLOW_START_HEAD);
/** Whether a delivery's text is Filament's word of a flow the main agent drives (OA4): its news, or a restart's. @param {unknown} text */
export const isFlowNews = (text) => typeof text === "string" && (text.startsWith(FLOW_NEWS_HEAD) || text.startsWith(FLOW_RESTART_HEAD));

/** Whether a message's last text block begins so. @param {any} message @param {string} head */
const endsWithHead = (message, head) => {
  const c = message?.content;
  if (typeof c === "string") return c.startsWith(head);
  if (!Array.isArray(c)) return false;
  const last = c.filter((b) => b?.type === "text").at(-1);
  return !!last && String(last.text).startsWith(head);
};
/** Whether a message is a flow's end (its last text block). @param {any} message */
export const isFlowEnd = (message) => endsWithHead(message, FLOW_END_HEAD);
/** Whether a message opens the turn that drives a flow In place (OA4): the chat draws it as Filament's. @param {any} message */
export const isFlowDrive = (message) => endsWithHead(message, FLOW_DRIVE_HEAD);

/** The acts a flow keeps: past them the oldest go. */
export const ACTS_KEPT = 30;
/**
 * An act kept on a flow (OA4): numbered after the newest, the oldest let go past `ACTS_KEPT`.
 * @param {Flow} flow @param {Omit<FlowAct, "n">} act @returns {FlowAct}
 */
export function noteAct(flow, act) {
  const acts = (flow.acts ||= []);
  const kept = { n: (acts.at(-1)?.n || 0) + 1, at: act.at, by: act.by, what: act.what, ...(act.why ? { why: lineOf(act.why, FLOW_LIMITS.line) } : {}) };
  acts.push(kept);
  if (acts.length > ACTS_KEPT) acts.splice(0, acts.length - ACTS_KEPT);
  return kept;
}

/**
 * The words that open the turn of the main agent a flow started In place (OA4 case 1): it drives the flow in this turn,
 * which stays open until the flow ends; what it is told as the flow moves, and what its flow tool may do to it; the
 * flow as it stands below.
 * @param {Pick<Flow, "id" | "title" | "goal" | "state" | "steps">} flow @param {Roster | null} [roster]
 */
export function driveNotice(flow, roster = null) {
  return [
    `${FLOW_DRIVE_HEAD}, "${lineOf(flow.title, 200)}", and you drive it in this turn, which stays open until the flow ends. Filament starts each step's boxes once the step before lets it pass, and tells you here as each box ends — its result whole — and wherever the flow waits: end your reply when only waiting is left, and Filament wakes you with the next word. With your flow tool, on this flow: action "box" with a box's id and "do" — "stop", "skip" or "retry" it; at a gate that says not yet, "go" on past it, or send a box it needs "back" ("to": its id) — each with "why", which the person reads on the flow; or leave the gate to the person, and say so. Action "edit" changes the steps not yet started (send the steps whole: those up to the one at work stay as they are); action "stop" stops the flow. The person's review is theirs alone: it waits for them, and you hear what they decide. They may write to you meanwhile, and act on the flow themselves: you hear what they do. You may work yourself meanwhile, as in any turn; each box does its own part.]`,
    "",
    flowText(flow, roster),
  ].join("\n");
}

/**
 * What the main agent was last told of a flow it drives (OA4): each box's state and when it started and ended, what
 * the flow was and held for, the newest act it heard of, and where the flow works (OA5). `newsOf` says what moved since.
 * @typedef {{ boxes: Record<string, string>, state: FlowState, hold: string, act: number, place?: string }} NewsMark
 */
/** @param {FlowBox} b */
const boxKey = (b) => `${b.state}|${b.startedAt ?? ""}|${b.endedAt ?? ""}`;
/** A flow as its main agent was told it now. @param {Flow} flow @returns {NewsMark} */
export const newsMark = (flow) => ({
  boxes: Object.fromEntries(boxesOf(flow).map(({ box }) => [box.id, boxKey(box)])),
  state: flow.state,
  hold: flow.hold ? `${flow.hold.kind}:${flow.hold.box}` : "",
  act: flow.acts?.at(-1)?.n || 0,
  place: flow.place?.folder || "",
});

/** A box's result as the main agent driving its flow reads it, whole up to FLOW_LIMITS.result. @param {FlowBox} b @param {number} step */
const resultBlock = (b, step) => {
  const t = clean(b.result?.text);
  const body = t.length > FLOW_LIMITS.result ? `${t.slice(0, FLOW_LIMITS.result)}\n…[Filament: the rest is left out; its box holds it whole]` : t;
  return `<flow-result step="${step + 1}" box="${attr(b.name)}" id="${b.id}">\n${body || "(it gave no words)"}\n</flow-result>`;
};

/**
 * What moved in a flow the main agent drives since it was last told (`mark`), as one message to it (OA4): the person's
 * acts; each box that ended — its result whole, a gate's verdict — or now asks the person, and those that started; what
 * the flow waits for now and what the agent may do there; its end. A review the person decided is said by their act.
 * `short`: the same in a line, which the person's chat shows where the agent read it. Null where nothing moved.
 * @param {NewsMark} mark @param {Flow} flow @returns {{ text: string, short: string } | null}
 */
export function newsOf(mark, flow) {
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const short = [];
  /** @type {string[]} */
  const blocks = [];
  for (const a of (flow.acts || []).filter((x) => x.n > mark.act && x.by === "person")) {
    lines.push(`The person ${a.what}${a.why ? `: "${a.why}"` : ""}.`);
    short.push(`you ${a.what}`);
  }
  /** @type {string[]} */
  const started = [];
  for (const { box: b, step } of boxesOf(flow)) {
    const was = mark.boxes[b.id];
    if (was === boxKey(b)) continue;
    const [wasState = "waits", wasStart = ""] = String(was || "").split("|");
    if (b.state === "working" || b.state === "seat") {
      if ((wasState !== "working" && wasState !== "seat") || wasStart !== String(b.startedAt ?? "")) started.push(`${b.name} (${b.id})${wasState !== "waits" ? ", again" : ""}`);
      continue;
    }
    if (b.state === "done") {
      if (b.kind === "review") continue;
      const drew = b.result?.drew?.length ? `${b.result.drew.length} picture${b.result.drew.length === 1 ? "" : "s"} (${b.result.drew.map((d) => d.title).join(", ")}: open one by its name with Filament's envelope tool)` : "";
      const art = b.result?.made?.length ? `${b.result.made.length} artifact${b.result.made.length === 1 ? "" : "s"}` : "";
      const made = art || drew ? `, with ${[art, drew].filter(Boolean).join(" and ")}` : "";
      const copy = b.result?.wrote ? "; what it changed waits in its own copy, on its thread, for the person" : b.place ? `; ${placeLine(b.place)}, nothing merged` : "";
      if (b.gate) {
        lines.push(b.verdict?.go ? `${b.name}, the gate, said go.` : b.verdict ? `${b.name}, the gate, says not yet${b.verdict.why ? `: ${b.verdict.why}` : ""}.` : `${b.name}, the gate, gave no verdict line.`);
        short.push(`${b.name}: ${b.verdict?.go ? "go" : b.verdict ? "not yet" : "no verdict"}`);
      } else {
        lines.push(`${b.name} is done${made}${copy}.`);
        short.push(`${b.name} done`);
      }
      blocks.push(resultBlock(b, step));
      continue;
    }
    if (b.state === "asking") {
      lines.push(b.kind === "review" ? `The person's review (${b.id}, step ${step + 1}) waits for them: it is theirs alone, and you hear what they decide.` : `${b.name} asks the person: ${b.error || "its lead asks a question"}.`);
      short.push(b.kind === "review" ? "your review waits for you" : `${b.name} asks you`);
      continue;
    }
    if (b.state === "failed" || b.state === "stopped" || b.state === "cut") {
      const how = b.state === "failed" ? "failed" : b.state === "cut" ? "was cut by a restart" : "stopped";
      lines.push(`${b.name} (${b.id}) ${how}${b.error && b.state !== "cut" ? `: ${b.error}` : ""}.`);
      short.push(`${b.name} ${b.state === "cut" ? "cut" : how}`);
      continue;
    }
    if (b.state === "skipped" && wasState !== "skipped") {
      lines.push(`${b.name} was skipped: it hands on nothing.`);
      short.push(`${b.name} skipped`);
    }
  }
  // The flow's worktree, made as its first box that writes started (OA5): where its boxes work from now on.
  if (flow.place && flow.place.folder !== (mark.place || "")) {
    lines.push(worksIn(flow.place));
    short.push(flow.place.kind === "worktree" ? `works on branch ${flow.place.branch}` : "works in the folder");
  }
  if (started.length) {
    lines.push(`Started: ${listed(started)}.`);
    short.push(`${started.length === 1 ? started[0].replace(/ \(.*$/, "") : `${started.length} boxes`} started`);
  }
  const hold = flow.hold ? `${flow.hold.kind}:${flow.hold.box}` : "";
  if (flow.state === "holds" && flow.hold && (hold !== mark.hold || mark.state !== "holds")) {
    const b = boxOf(flow, flow.hold.box)?.box;
    if (flow.hold.kind === "gate" && b) {
      const needs = b.needs.map((n) => boxOf(flow, n)?.box).filter((x) => !!x && x.kind !== "review").map((x) => `${/** @type {FlowBox} */ (x).id} (${/** @type {FlowBox} */ (x).name})`);
      lines.push(`The flow waits at ${b.name} (${b.id}): decide — "do": "go" goes on past it; "do": "back" with "to" sends a box it needs back with your why (${listed(needs) || "none"}), and the gate reads again — or leave it to the person, and say so in your reply.`);
      short.push(`waits at ${b.name}`);
    } else if (b) {
      lines.push(`The flow holds at ${b.name} (${b.id}): "do": "retry" or "skip" it, or stop the flow — or leave it to the person.`);
      short.push(`holds at ${b.name}`);
    }
  }
  if (flow.state !== mark.state) {
    if (flow.state === "running" && mark.state === "holds") {
      lines.push("The flow goes on.");
    } else if (flow.state === "done") {
      lines.push(`The flow is done: ${flow.steps.map((s, i) => `${i + 1}. ${s.boxes.map((b) => `${b.name} — ${b.gate && b.state === "done" ? (b.verdict?.go ? "go" : "went on past not yet") : b.kind === "review" && b.state === "done" ? "the person went on" : BOX_WORDS[b.state].toLowerCase()}`).join("; ")}`).join(" ")}. End your turn: say what came of it.`);
      short.push("done");
    } else if (flow.state === "stopped") {
      lines.push("The flow stopped: every box at work stops, and what is done stays. End your turn: say where it stood.");
      short.push("stopped");
    }
  }
  if (!lines.length) return null;
  const n = flow.steps.length;
  const i = stepAt(flow);
  const at = flow.state === "done" ? `all ${n} steps` : `step ${i < 0 ? n : i + 1} of ${n}`;
  return {
    text: [`${FLOW_NEWS_HEAD}, "${lineOf(flow.title, 200)}" (${at}):`, ...lines.map((l) => `- ${l}`), "]", ...(blocks.length ? ["", blocks.join("\n\n")] : [])].join("\n"),
    short: lineOf(`the flow "${lineOf(flow.title, 60)}": ${short.join(" · ") || "it moved"}`, 200),
  };
}

/**
 * What the main agent that drove a flow is told after a restart (OA4 case 7): the boxes the restart cut, each its to
 * retry or skip, and the flow as it stands. Its turn goes on by itself, as every cut turn does.
 * @param {Pick<Flow, "id" | "title" | "goal" | "state" | "steps">} flow @param {Roster | null} roster @param {string[]} cut  the boxes cut, by name
 */
export function restartNotice(flow, roster, cut) {
  return [
    `${FLOW_RESTART_HEAD} "${lineOf(flow.title, 200)}"${cut.length ? `, and cut ${listed(cut)} at work: each is yours to retry or skip with your flow tool ("action": "box", "do": "retry" or "skip"), or stop the flow — nothing of it goes on before` : ": nothing of it was at work, and it waits as it did"}. It stands as below; Filament tells you here as it moves.]`,
    "",
    flowText(flow, roster),
  ].join("\n");
}

/** A flow in a line, as the main agent's act on it is answered (OA4): where it stands, and its boxes at work. @param {Flow} flow */
export function nowOf(flow) {
  const working = boxesOf(flow).filter((x) => live(x.box)).map((x) => `${x.box.name} ${BOX_WORDS[x.box.state].toLowerCase()}`);
  return `${flowLine(flow)}${working.length ? ` — ${working.join(", ")}` : ""}`;
}

/** How the line ahead of a `/flow` message begins (OA-D6): the page marks the message by it. */
export const FLOW_ASK_HEAD = "[Filament: the developer typed /flow";

/**
 * The person's agents and teams as the main agent reads them for a draft: each by its tag or key, its name, what it may
 * do and what it is good for. `teams` false: Settings › Experimental's Teams switch is off (core/teams-on.js), and the
 * words name no team.
 * @param {Roster} roster @param {{ teams?: boolean }} [o]
 */
export function rosterWords(roster, { teams: teamsHere = true } = {}) {
  const may = /** @type {Record<string, string>} */ ({ read: "reads only", copy: "runs in its own copy, keeps nothing", edit: "edits in its own copy" });
  /** @param {string | undefined} s */
  const what = (s) => (clean(s) ? ` — ${lineOf(s, 160)}` : "");
  const cards = roster.cards.map((c) => `- ${c.tag}: ${c.name}, ${may[c.may || "read"] || c.may}${what(c.goodFor)}`);
  const teams = roster.teams.map((t) => `- ${t.key}: ${t.name}, ${t.readOnly ? "reads only" : "writes"}${what(t.line)}`);
  return [`Their agents (a box's "agent"):`, ...(cards.length ? cards : ["(none)"]), ...(teamsHere ? [`Their teams (a box's "team"):`, ...(teams.length ? teams : ["(none)"])] : [])].join("\n");
}

/**
 * The line ahead of a `/flow` message (OA-D6, L17, L22): the developer asks the main agent to design a flow from their
 * words with Filament's flow tool — the rules of a flow and the person's agents and teams — or, with the tool out of
 * reach, says why and what helps (`off`: "switch" or true, the chat's tools have it off; "agent", a coding agent
 * Filament's tools do not reach; "plain", a plain chat, whose model runs no tools; "words", a model that takes no tools
 * on Filament's agent loop; "none", no flows kept here). The words themselves follow it whole. `teams` false:
 * Settings › Experimental's Teams switch is off (core/teams-on.js), and the line names no team.
 * @param {Roster} roster @param {{ off?: boolean | "switch" | "agent" | "plain" | "words" | "none", teams?: boolean }} [o]
 */
export function flowAskLine(roster, { off = false, teams = true } = {}) {
  const who = teams ? "their agents and teams" : "their agents";
  if (off) {
    // What stands in the way, and what helps: a switch of the chat's, a coding agent Filament's tools do not reach, or no
    // flows kept here at all (the bug round of 10-23: one line named the switch for all three).
    /** @type {Record<string, string>} */
    const words = {
      agent: "this chat's coding agent takes no MCP server over HTTP, and Filament's tools reach a coding agent that way alone, so you cannot draw it. Say so: the person draws it by hand in the Agents tab, under Flows",
      plain: "this chat is a plain chat, whose model runs no tools, so you cannot draw it. Say so: the person draws it by hand in the Agents tab, under Flows, or runs this chat on Filament's agent loop",
      words: "this chat's model takes no tools, so you cannot draw it. Say so: the person draws it by hand in the Agents tab, under Flows, or runs this chat on a model that takes tools",
      none: "Filament keeps no flows here, so you cannot draw it. Say so",
    };
    const why = words[String(off)] || "Filament's flow tool is off in this chat, so you cannot draw it. Say so, and that the chat's settings turn it on (its Tools, Flows)";
    return `${FLOW_ASK_HEAD}: they ask you to design a flow from their message below — ${who} in steps beside this chat — but ${why}; you may describe the steps you would draw.]`;
  }
  return [
    `${FLOW_ASK_HEAD}: they ask you to design a flow from their message below — ${who} in steps beside this chat — with Filament's flow tool, action "draft". A step's boxes run side by side; a step starts once the step before it is done. Each box has an id and names the boxes it needs ("needs": their ids, only boxes of earlier steps): it is handed their results and the person's words, nothing else. A box is one of their agents ("agent": its tag), ${teams ? `one of their teams ("team": its key), ` : ""}or the person's own review ("review": true), which holds the flow until they go on. A gate is an agent box with "gate": true: its answer begins with its verdict, and "not yet" holds the flow for the person. Two boxes that write never share a step.${teams ? " In a git project the flow works in a worktree of its own from its first team box that writes on, never in this chat's folder, and nothing of it is merged." : ""} Give each step one line on why it is where it is ("why"). Use only ${teams ? "the agents and teams" : "the agents"} below; where the message names someone who is not there, pick the nearest or ask the person. Nothing runs from your draft: it stands over their message box for them to change and Start. In your reply, say why each step is where it is.`,
    rosterWords(roster, { teams }),
    "]",
  ].join("\n");
}

/**
 * The seats a flow's widest step takes (§4.3): its agent boxes, which take the chat's seats as the person's own asks
 * do; a team box runs in its own chat, and a review is the person's.
 * @param {Pick<Flow, "steps">} flow
 */
export const seatsOf = (flow) => Math.max(0, ...flow.steps.map((s) => s.boxes.filter((b) => b.kind === "agent").length));
