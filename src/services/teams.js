// @ts-check
// Teams (HarnessV3-AtHome AH-O2, P2; HarnessV4_Tasks E15 step 6): a team is a saved group of cards — the card in
// charge, its lead, and the cards it hands work to, its crew, each with the team's own line for that member. Any card
// may lead a team or sit in its crew (one kind of agent, HarnessV4_OneAgent_Plan OA1), whatever it may do. Two ship
// with Filament, each led by its own Lead, a card that is part of it (`partOf`);
// your own are saved in one JSON file in the data folder, version 2:
// `{ version: 2, teams: { <key>: { name, lead, members: [{ tag, line }] } }, shipped: { <key>: { models, … } } }`. A
// team that ships is yours to change in place, every field but its key (HarnessV4_ShippedAgents_Plan SA3, SA-D8): its
// name, its lead, its members and the team's words for each, and how it runs — the fields below — kept under `shipped`
// only where you set it apart from what ships, with a short hash of what shipped as you set its name, lead or members
// (`was`), so Filament's later words are told apart (`moved`). A field given null is put back, `reset` puts back all;
// it is never deleted. A team is handed out whole (`Team`):
// its lead's name and words and each member's name, line, level and place are read from the cards as they stand, so a
// card's change reaches every team that uses it; its own one line, for the lists and cards, is its lead's "good for".
// A team may name the models its workers run on, in order (team_v2_plan TV2-D8): a lead's launch takes a free slot on
// the first, else the next (app/agent/subagents.js) — a Brief's pick before them, a member's own card's models and the
// chat's list after them (U13-D8). A team caps nothing of its own: an old file's `most` and `total` are dropped as it
// is read (the owner's word of 11-05). It may name the model its lead runs on
// beside a chat (§9 Q10), keep its chat read-only (BugHunters finds and checks, and fixes nothing: TV2-D3), and say
// what a main agent's fire does by itself — notify it when done, verify first (TV2-D10). It may name
// its check: one command line given to every member that edits as a brief's check is — run
// without asking in its worktree, and by Filament when it reports — and told to its lead (the plan's p6). Each of these
// is kept in the file only where a team names it. The teams that ship name no model: a model one person has, another
// may not, so their leads run on the chat's model and their workers on the Seats for team workers until you name one;
// nor a check, which is the project's to say.
// A session names its team by key (engine.team), so a team's key never changes; its name may. The file is read the way
// a save checks it: one that is broken, or is not version 2, starts empty and is reported, never thrown over, and a
// team in it that a save would refuse — one naming a card that is gone — is skipped and reported. The store lives
// here because it owns its file (docs/ARCHITECTURE.md §1); the engine, the commands, the sessions service and the
// admin routes are handed the one the server builds. A refusal carries the status the admin API answers
// with: 400 for what a save refuses, 403 for what a shipped team keeps, 404 for a team nobody made.
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SUBAGENT_EFFORTS } from "../core/schema.js";
import { COMMAND, TASK_BY } from "../core/task-graph.js";
import { SHIPPED_CREW, foldedWords, memberCard } from "../core/roster.js";
import { foldedLeadWords, foldedTeamWords } from "../core/folded-teams.js";
import { modelNamed, tagShaped } from "./agent-cards.js";
import { STORE_FILES, readStoreFile } from "./store-files.js";

export const TEAMS_FILE = "teams.json";

/** Words `/team` reads as its own, so no team is keyed by one. */
const RESERVED = Object.freeze(["off", "help", "list"]);
const NAME_MAX = 40;
const LINE_MAX = 2000;
const MEMBERS_MAX = 12;
const MODELS_MAX = 6;
const MODEL_NAME_MAX = 120;
const CHECK_MAX = 400;
/** What an old file may still hold that says nothing now (the owner's word of 11-05): dropped as it is read. */
const RETIRED = Object.freeze(["most", "total"]);
/**
 * What a save takes: the characters of a name and of a member's line, how many members, how many models its workers
 * run on and the characters of its check — what the page counts against.
 */
export const TEAM_LIMITS = Object.freeze({ name: NAME_MAX, line: LINE_MAX, members: MEMBERS_MAX, models: MODELS_MAX, check: CHECK_MAX });

/**
 * @typedef {import("../core/roster.js").Member} Member
 * @typedef {{ tag: string, name?: string, line: string, model?: string, effort?: string }} SavedMember  a member as it is
 *   kept: its card by tag; its own name where the team seats that card more than once, whose slug is the member's id
 *   (`memberId`); the team's line for it; and the model and effort the team runs it on, where it names either
 * @typedef {{ key: string, name: string, lead: string, members: SavedMember[], models?: string[],
 *   efforts?: Record<string, string>, leadModels?: string[], leadEfforts?: Record<string, string>, readOnly?: boolean,
 *   fired?: Fired, check?: string | null,
 *   shipped: boolean, from?: string | null, createdAt?: number, updatedAt?: number }} SavedTeam  a team as it is kept:
 *   its cards by tag, and the models its workers run on as a person names them
 * @typedef {object} Team  a team as it is handed out, its cards read
 * @property {string} key
 * @property {string} name
 * @property {string} line  how it works, in one line: its lead's "good for"
 * @property {{ tag: string, name: string }} lead  the card in charge
 * @property {string} persona  its lead's words: how the card thinks, and its team's check where it names one
 * @property {string | null} check  its check: the one command line every member that edits is given, or null
 * @property {Member[]} members
 * @property {string[]} models  the models its workers run on, in order, as a person names them ("GLM 5.3 Flash"); none:
 *   the chat's Seats for team workers
 * @property {string[]} leadModels  the models its lead runs on beside a chat, first choice first, as a person names them
 *   (the owner's 10-19 list): a fire takes the first that can run now; none — the chat's
 * @property {string | null} leadModel  the first of them, or null: the chat's
 * @property {Record<string, string>} efforts  how hard its workers think on each of their models, by name, where a row
 *   says it; none — as their lead does
 * @property {Record<string, string>} leadEfforts  how hard its lead thinks on each of its models, by name, where a row
 *   says it; none — as the main agent does
 * @property {boolean} readOnly  its chat changes no file
 * @property {Fired} fired  what a main agent's fire of it does by itself
 * @property {boolean} shipped
 * @property {boolean} [tuned]  a team that ships: anything of it is set apart from what ships
 * @property {string[]} [set]  a team that ships: the fields of it set apart from what ships (SA3)
 * @property {{ name?: string, lead?: { tag: string, name: string }, members?: SavedMember[] }} [ships]  a team that
 *   ships: its name, lead and members as it ships, where you set them — what Put back gives
 * @property {string[]} [moved]  a team that ships: its name, lead or members whose words Filament changed since you set them
 * @property {string | null} [from]
 * @property {number} [createdAt]
 * @property {number} [updatedAt]
 * @typedef {Pick<import("./agent-cards.js").AgentCardStore, "find" | "place" | "list">} Cards
 */

/**
 * The crew every team that builds seats (core/roster.js `SHIPPED_CREW`), each member on its card and under its seat's
 * name where it has one, with that team's words for it — given in the crew's order.
 * @param {[string, string, string, string]} lines
 */
const crewWith = (lines) => SHIPPED_CREW.map((m, i) => ({ tag: memberCard(m), ...(m.name ? { name: m.name } : {}), line: lines[i] }));

/**
 * The teams that ship (AH-O2; BugHunters, team_v2_plan §5.6 and the plan's p6): the lead card in charge, and the words
 * each adds for every member. Their crews sit on Builder and Reviewer, a card seated for other work under a name of its
 * own (`memberId`): the Scout, the Tester, the Hunter, the Checker.
 */
export const SHIPPED_TEAMS = Object.freeze({
  // The one that builds (the plan's p6): one crew, whose lines are what its lead asks of them.
  builders: {
    name: "Builders",
    lead: "buildlead",
    members: crewWith([
      "Report what you read as facts with their file and line, and say plainly what you could not confirm.",
      "Make the smallest change that meets your acceptance check: no refactors, renames or cleanups along the way. Before you report, run that check yourself where you can, and say what it printed.",
      "Run the acceptance check exactly as written and report its real output: a pass or a failure as printed, never a summary of one.",
      "Check the change against its acceptance check: what it claims, what the diff shows with file and line, and what is missing.",
    ]),
  },
  // The one that finds and checks (team_v2_plan §5.6, TV2-D3; the plan's p6): its Hunters find, its Checkers check what
  // they found, or the claims it is given. Its chat runs read-only: it fixes nothing. Which models its lead and each
  // seat run on is the person's to set — a member's own model puts the Checker on a strong one, say.
  bughunters: {
    name: "BugHunters",
    lead: "huntlead",
    readOnly: true,
    members: [
      {
        tag: "reviewer",
        name: "Hunter",
        line: 'Hunt only your slice. Each finding: the claim, its file and line, the code that shows it, why it is a bug, and how to see it go wrong where that can be shown. One you cannot back with file, line and code is Plausible, said so. End your report with a line that says only "Findings:" and one line per finding under it — "- Found | <the bug, in a few words> | <file>:<line> | <the code that shows it, and why>", Plausible in Found\'s place where you cannot back it — so Filament can merge them with the other Hunters\' for your lead.',
      },
      { tag: "reviewer", name: "Checker", line: "Check each claim you were given against the code as it is now: read the file and the line, run what shows it where you can. Confirmed with why, Plausible where it cannot be shown either way, Dismissed with why. Fix nothing." },
    ],
  },
});

/**
 * A team's key: its name lower-cased, each run of other characters one dash — or null when nothing is left, when it
 * runs past 40 characters, or when it is a word `/team` reads as its own.
 * @param {unknown} name
 */
export function teamKey(name) {
  const k = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(k) && !RESERVED.includes(k) ? k : null;
}

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });
/**
 * A write's weigher, asked before the write is kept: why the team it would keep is not saved, in words, or null where
 * it is — the press key's (http/admin/teams.js `refuses`), which reads the team kept under the key until now (`was`:
 * null where there is none) and the one the write would keep.
 * @typedef {(was: SavedTeam | null, now: SavedTeam) => string | null} Weigher
 */
/**
 * A write refused by its caller's weigher, in its words, the press marked for the answer: nothing is kept.
 * @param {Weigher | null | undefined} refuse @param {SavedTeam | null} was @param {SavedTeam} now
 */
const weighed = (refuse, was, now) => {
  const no = refuse?.(was, now);
  if (no) throw Object.assign(refused(403, no), { press: true });
};

/**
 * One of a team's models as a save names it: a name, or a row that says how hard its agent thinks on it —
 * `{ model, effort }` — read as its name and its effort, null for none; null for one that is neither. A word that is no
 * effort is refused in words. @param {unknown} m @returns {[string, string | null] | null}
 */
function rowOf(m) {
  if (typeof m === "string") return [m.trim(), null];
  const o = m && typeof m === "object" && !Array.isArray(m) ? /** @type {Record<string, unknown>} */ (m) : null;
  if (!o || typeof o.model !== "string" || Object.keys(o).some((k) => k !== "model" && k !== "effort")) return null;
  const effort = o.effort ?? null;
  if (effort !== null && !SUBAGENT_EFFORTS.includes(/** @type {any} */ (effort))) throw refused(400, `Each model's effort is one of ${SUBAGENT_EFFORTS.join(", ")}: how hard the agent thinks on it — or left out, the main agent's.`);
  return [o.model.trim(), /** @type {string | null} */ (effort)];
}
/**
 * The efforts a list of a team's models says, by name: each row's that names one. @param {unknown[]} v
 * @returns {Record<string, string>}
 */
const effortsIn = (v) => Object.fromEntries(v.map(rowOf).flatMap((r) => (r && r[0] && r[1] ? [[r[0], r[1]]] : [])));
/**
 * A team's efforts as the file keeps them, beside its models: a name and a level each, read where it holds. @param {unknown} v
 * @returns {Record<string, string>}
 */
function effortsOf(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw refused(400, "efforts must be a model's name and how hard its agent thinks on it, each: { \"GLM 5.3\": \"high\" }.");
  const all = Object.entries(/** @type {Record<string, unknown>} */ (v));
  if (all.some(([, e]) => !SUBAGENT_EFFORTS.includes(/** @type {any} */ (e)))) throw refused(400, `Each model's effort is one of ${SUBAGENT_EFFORTS.join(", ")}: how hard the agent thinks on it — or left out, the main agent's.`);
  return Object.fromEntries(all.filter(([m]) => m.trim()).map(([m, e]) => [m.trim(), String(e)]));
}
/**
 * A team's efforts as its file keeps them: one whose level is no effort dropped, the rest read as a save reads them —
 * a save refuses it, but a file a hand or another build wrote keeps its team (the review of 11-05). @param {unknown} v
 */
const storedEfforts = (v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, e]) => SUBAGENT_EFFORTS.includes(/** @type {any} */ (e)))) : v);
/**
 * The models a save names for a team's workers, checked: up to six names as a person says them, each once — a row that
 * says how hard its worker thinks on it read as its name (`effortsIn`) — or the refusal in words. @param {unknown} v
 * @returns {string[]}
 */
function modelsOf(v) {
  if (!Array.isArray(v)) throw refused(400, `models must be a list of up to ${MODELS_MAX} model names, in the order its workers take them — or rows that say how hard each thinks on it, { model, effort }.`);
  if (v.length > MODELS_MAX) throw refused(400, `A team names up to ${MODELS_MAX} models for its workers (this one names ${v.length}).`);
  /** @type {string[]} */
  const out = [];
  for (const m of v) {
    const name = rowOf(m)?.[0] || "";
    if (!name) throw refused(400, "Each of a team's models is a model's name, as you'd say it or as Filament lists it.");
    if (name.length > MODEL_NAME_MAX) throw refused(400, `A model's name is up to ${MODEL_NAME_MAX} characters.`);
    if (out.some((x) => x.toLowerCase() === name.toLowerCase())) throw refused(400, `\`${name}\` is named twice: each model once, in the order its workers take them.`);
    out.push(name);
  }
  return out;
}
/**
 * The models a team's lead runs on beside a chat, checked: up to six names as a person says them, first choice first,
 * each once — or the refusal in words. @param {unknown} v @returns {string[]}
 */
function leadModelsOf(v) {
  if (!Array.isArray(v)) throw refused(400, `leadModels is the models its lead runs on beside a chat, first choice first: a list of up to ${MODELS_MAX} model names; [] for the chat's own.`);
  if (v.length > MODELS_MAX) throw refused(400, `A team names up to ${MODELS_MAX} models for its lead (this one names ${v.length}).`);
  /** @type {string[]} */
  const out = [];
  for (const m of v) {
    const row = m && typeof m === "object" ? rowOf(m) : null;
    const name = row ? leadModelOf(row[0]) : m && typeof m === "object" ? null : leadModelOf(m);
    if (!name) throw refused(400, "Each of its lead's models is a model's name, as you'd say it or as Filament lists it.");
    if (out.some((x) => x.toLowerCase() === name.toLowerCase())) throw refused(400, `\`${name}\` is named twice: each of its lead's models once, first choice first.`);
    out.push(name);
  }
  return out;
}
/** One model a team's lead runs on beside a chat, checked: a name as a person says it, or null for the chat's. @param {unknown} v @returns {string | null} */
function leadModelOf(v) {
  if (v === null || v === "") return null;
  const name = typeof v === "string" ? v.trim() : null;
  if (name === null || /[\r\n]/.test(name) || name.length > MODEL_NAME_MAX) throw refused(400, `leadModel is the model its lead runs on beside a chat: a model's name on one line, up to ${MODEL_NAME_MAX} characters, or null for the chat's own.`);
  return name || null;
}
/** Whether a team's chat runs read-only, checked. @param {unknown} v @returns {boolean} */
function readOnlyOf(v) {
  if (typeof v !== "boolean") throw refused(400, "readOnly is true for a team whose chat changes no file, or false.");
  return v;
}
/**
 * What a main agent's fire of the team does by itself (team_v2_plan TV2-D10), checked: notify it when the team is done,
 * verify first — each on or off; null for both off. @param {unknown} v @returns {Fired}
 */
function firedOf(v) {
  if (v === null) return { notify: false, verify: false };
  const o = v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null;
  if (!o || Object.keys(o).some((k) => k !== "notify" && k !== "verify") || Object.values(o).some((x) => typeof x !== "boolean"))
    throw refused(400, "fired says what a main agent's fire of the team does by itself: { notify, verify }, each true or false.");
  return { notify: o.notify === true, verify: o.verify === true };
}
/** @typedef {{ notify: boolean, verify: boolean }} Fired */
/**
 * A team's check as a save names it, its shape checked — one command line, up to CHECK_MAX characters — or null for
 * none; what the command does is the store's `checkProblem`'s to judge. @param {unknown} v @returns {string | null}
 */
function checkLineOf(v) {
  if (v === null) return null;
  const c = typeof v === "string" ? v.trim() : null;
  if (c === null || /[\r\n]/.test(c) || c.length > CHECK_MAX) throw refused(400, `check is one command line, up to ${CHECK_MAX} characters, that proves a worker's change sound — or null for none.`);
  return c || null;
}

/**
 * The fields a team keeps only where it names one (team_v2_plan): each one's check, its value where none is named, and
 * whether a value names one. A save reads them, the file keeps them, a team hands them out — the same for each.
 */
const OWN = Object.freeze({
  models: { check: modelsOf, none: () => /** @type {string[]} */ ([]), named: (/** @type {any} */ v) => v.length > 0 },
  // How hard its agent thinks on each of them, by name, where a row says it (the owner's word of 11-05: "Fallback rows:
  // model · account · effort"); none, the main agent's.
  efforts: { check: effortsOf, none: () => /** @type {Record<string, string>} */ ({}), named: (/** @type {any} */ v) => Object.keys(v).length > 0 },
  leadModels: { check: leadModelsOf, none: () => /** @type {string[]} */ ([]), named: (/** @type {any} */ v) => v.length > 0 },
  leadEfforts: { check: effortsOf, none: () => /** @type {Record<string, string>} */ ({}), named: (/** @type {any} */ v) => Object.keys(v).length > 0 },
  readOnly: { check: readOnlyOf, none: () => false, named: (/** @type {any} */ v) => v === true },
  fired: { check: firedOf, none: () => ({ notify: false, verify: false }), named: (/** @type {any} */ v) => v.notify || v.verify },
  check: { check: checkLineOf, none: () => /** @type {string | null} */ (null), named: (/** @type {any} */ v) => v != null },
});
/** @typedef {keyof typeof OWN} OwnField */
const OWN_FIELDS = /** @type {OwnField[]} */ (Object.keys(OWN));
/** What makes a shipped team the one it is, set in place where you change it (SA3); its words may move with Filament's. */
const SHIPPED_WORDS = Object.freeze(/** @type {const} */ (["name", "lead", "members"]));
/** Every field a shipped team sets in place, its own words first. */
export const SHIPPED_TEAM_SETS = Object.freeze([...SHIPPED_WORDS, ...OWN_FIELDS]);
/** Whether two values of a field are the same: checked values, written the same way. @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** A short hash of what a field ships as, to tell later whether Filament's words for it moved (SA-D3). @param {unknown} v */
const hashOf = (v) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex").slice(0, 12);
/** A team's own fields, each its value or none, copied. @param {any} t */
const ownOf = (t) => Object.fromEntries(OWN_FIELDS.map((k) => [k, structuredClone(t?.[k] !== undefined ? t[k] : OWN[k].none())]));
/** @typedef {{ models: string[], efforts: Record<string, string>, leadModels: string[], leadEfforts: Record<string, string>, readOnly: boolean, fired: Fired, check: string | null }} OwnValues */
/** A list's efforts for the models it names alone. @param {Record<string, string>} efforts @param {readonly string[]} models */
const kin = (efforts, models) => Object.fromEntries(Object.entries(efforts).filter(([m]) => models.includes(m)));
/** @param {number} n */
const count = (n) => n.toLocaleString("en-US");
/** A card's tag as a save names it: lower-cased, a leading `@` dropped. @param {unknown} v */
const tagOf = (v) => (typeof v === "string" ? v.trim().replace(/^@/, "").toLowerCase() : "");
/** A member's name as its id: lower-cased, each run of other characters one dash. @param {string} name */
const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/**
 * A member's id — what its lead, its tools and the task graph name it by: its name's slug where it has a name, else its
 * card's tag. @param {{ tag: string, name?: string }} m
 */
export const memberId = (m) => (m.name ? slugOf(m.name) : m.tag);

/**
 * What a team's name may be, or the refusal in words.
 * @param {unknown} name
 * @returns {{ name: string, key: string }}
 */
function nameOf(name) {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) throw refused(400, `A team needs a name: up to ${NAME_MAX} characters, on one line.`);
  if (/[\r\n]/.test(n)) throw refused(400, `A team's name is one line, up to ${NAME_MAX} characters.`);
  if (n.length > NAME_MAX) throw refused(400, `A team's name is up to ${NAME_MAX} characters (this one has ${n.length}).`);
  const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw refused(400, "A team's name needs a letter or a digit.");
  if (RESERVED.includes(slug)) throw refused(400, `\`${slug}\` is a word /team reads as its own; name the team something else.`);
  return { name: n, key: /** @type {string} */ (teamKey(n)) };
}

/**
 * A team's body that names its check: one command line every worker of it that edits runs without asking, and Filament
 * runs itself as that worker reports, in every chat the team works in — a press (http/admin/press.js; r-doors, 11-12).
 * A check taken away, a Duplicate — its source's check is one kept already — and any other field are none. @param {any} b
 */
export const checksUnasked = (b) => typeof b?.check === "string" && !!b.check.trim();

/**
 * Whether a team, as a write would keep it, does more than the one kept (s-rows, 11-12): it changes files where that
 * one's chat changed none (`readOnly`) or where there was none, or — changing files — it seats a card, its lead's or a
 * worker's, that one did not. A press where a chat's main agent may start the team by itself: BugHunters, which reads
 * only as it ships, made to build was the agent's to send from then on. A team whose chat changes no file does no more
 * whoever sits in it — each turn it leads is held to reading, its workers' too —, so one made read-only, or put back
 * so, is none; nor are its words, its models or fewer of the cards it had.
 * @param {{ lead: string, members: readonly { tag: string }[], readOnly?: boolean } | null} was  the team kept under
 *   its key, or null where there is none @param {{ lead: string, members: readonly { tag: string }[], readOnly?: boolean }} now
 */
export function writesMore(was, now) {
  if (now.readOnly === true) return false;
  if (!was || was.readOnly === true) return true;
  const sat = new Set([was.lead, ...was.members.map((m) => m.tag)]);
  return [now.lead, ...now.members.map((m) => m.tag)].some((tag) => !sat.has(tag));
}

/**
 * The words a team's lead reads of its team's check (the plan's p6), after its own: the command, that it asks for it
 * in each brief to a member that edits, and what Filament does with it. @param {string} check
 */
export const checkWords = (check) =>
  `Your team's check is \`${check}\`. Ask for it in the check of each brief you give a worker that changes files: Filament gives it to every such worker, which may run it in its own worktree without asking, and runs it itself when that worker reports, before you hear of it.`;

/**
 * @param {{ dataDir: string | null, cards: Cards, log?: (level: string, msg: string) => void, now?: () => number,
 *   checkProblem?: (command: string) => string | null }} o
 *   `cards`: the saved agents a team is made of; `checkProblem`: why a command cannot be a team's check, in words, or
 *   null — read as a task graph's check is (app/agent/grants.js `checkCommandsProblem`: the store sits below it)
 */
export function createTeamStore({ dataDir, cards, log = () => {}, now = () => Date.now(), checkProblem = () => null }) {
  const file = dataDir ? join(dataDir, TEAMS_FILE) : null;
  /** @type {SavedTeam[]} */
  const shipped = Object.entries(SHIPPED_TEAMS).map(([key, t]) => /** @type {SavedTeam} */ ({ key, name: t.name, lead: t.lead, members: t.members.map((m) => ({ ...m })), ...ownOf(t), shipped: true }));
  /** Your teams by key. @type {Map<string, SavedTeam>} */
  let saved = new Map();
  /** What you set on a team that ships, by its key: only the fields set apart from what ships. @type {Map<string, Record<string, any>>} */
  let tuned = new Map();
  /**
   * Your teams the file holds that cannot be used now — one naming a card that is gone, say — by key: each written back
   * as it was at every save, and read again at every read and save of the teams (`revive`), so a card that comes back
   * brings its team back, until you delete it.
   * @type {Map<string, { raw: Record<string, any>, name: string, why: string }>}
   */
  let held = new Map();
  /** Why a save cannot take the name `key` keys: a team of yours held under it, or by that name. @param {string} key */
  const heldUnder = (key) => {
    const h = held.get(key) || [...held.values()].find((x) => teamKey(x.name) === key);
    return h ? refused(400, `A team called \`${h.name}\` is kept in ${TEAMS_FILE} but cannot be used now (${h.why}) — delete it first, or pick another name.`) : null;
  };

  /** The teams that ship, each as it ships with what you set on top. */
  const shippedNow = () =>
    shipped.map((t) => {
      if (!tuned.has(t.key)) return t;
      const { was: _was, ...set } = structuredClone(/** @type {Record<string, any>} */ (tuned.get(t.key)));
      return { ...t, ...set };
    });
  /** Every team, the shipped ones first in their order, then yours by name. */
  const all = () => [...shippedNow(), ...[...saved.values()].sort((a, b) => a.name.localeCompare(b.name))];
  /**
   * Every team with the cards it names: the teams in use, then yours held (`held`), their cards read as the file keeps
   * them — a card a team held names is one it waits on to be used again.
   * @returns {{ key: string, name: string, lead: string, members: SavedMember[], held: boolean }[]}
   */
  const naming = () => [
    ...all().map((x) => ({ key: x.key, name: x.name, lead: x.lead, members: x.members, held: false })),
    ...[...held].map(([key, h]) => ({
      key,
      name: h.name,
      lead: tagOf(h.raw.lead),
      members: (Array.isArray(h.raw.members) ? h.raw.members : []).map((m) => ({ tag: tagOf(m?.tag), line: typeof m?.line === "string" ? m.line.trim() : "" })).filter((m) => m.tag),
      held: true,
    })),
  ];
  /**
   * The team `key` or `name` would collide with — the same key, or a name that keys the same — other than `self`.
   * @param {string} key @param {string | null} self
   */
  const clash = (key, self) => all().find((t) => t.key !== self && (t.key === key || teamKey(t.name) === key)) || null;
  /** @param {SavedTeam} t */
  const taken = (t) => refused(400, `A team called \`${t.name}\` already exists${t.shipped ? " (shipped) — pick another name, or Duplicate it" : " — pick another name"}.`);
  /**
   * The agent a name is already, or null: an agent and a team never share a name (OA1) — a team's own Lead, which is
   * its team's, aside. @param {string} name
   */
  const agentNamed = (name) => {
    const n = name.trim().toLowerCase();
    return cards.list().find((c) => !c.partOf && c.name.toLowerCase() === n) || null;
  };
  /** @param {{ name: string, tag: string }} c */
  const agentsName = (c) => refused(400, `An agent is called ${c.name} (\`@${c.tag}\`): a team and an agent never share a name — pick another.`);
  /**
   * The agent whose tag a team's key would be, or null: `@` names either, so they never meet (the bug round of 10-23) —
   * a team's own Lead aside, and the team's lead itself: a team keyed as its lead's tag is how the shipped ones stand,
   * and `@` names the team, which its lead leads. @param {string} key @param {string | null} [lead]  the team's lead's tag
   */
  const agentTagged = (key, lead = null) => cards.list().find((c) => !c.partOf && c.tag === key && c.tag !== lead) || null;
  /** @param {{ name: string, tag: string }} c */
  const agentsTag = (c) => refused(400, `\`@${c.tag}\` is ${c.name}'s tag: a team's key and an agent's tag never meet, since @ names either — pick another name.`);

  /**
   * The card in charge a save names, checked: any card that exists (U13-D1). @param {unknown} v @returns {string}
   */
  const leadOf = (v) => {
    const tag = tagOf(v);
    if (!tag) throw refused(400, "A team needs a lead: the tag of the card in charge.");
    const card = cards.find(tag);
    if (!card) throw refused(400, foldedWords(tag, (into) => `make ${into} the lead in its place`) ?? foldedLeadWords(tag) ?? `There is no agent \`@${tag}\` to lead the team — Library › Agents and teams lists them.`);
    return card.tag;
  };
  /**
   * A member's name as a save names it, checked — "" for none: one line, up to 40 characters, whose slug — the member's
   * id — has a card's tag's shape, is no word the task graph keeps, and is no other card's tag.
   * @param {unknown} v @param {{ tag: string, name: string }} card  its own
   */
  const memberNameOf = (v, card) => {
    if (v === undefined || v === null) return "";
    if (typeof v !== "string" || /[\r\n]/.test(v)) throw refused(400, `A worker's name is one line, up to ${NAME_MAX} characters: what its lead calls this ${card.name}.`);
    const name = v.trim();
    if (!name) return "";
    if (name.length > NAME_MAX) throw refused(400, `A worker's name is up to ${NAME_MAX} characters (${JSON.stringify(name.slice(0, 20))}… has ${name.length}).`);
    const id = slugOf(name);
    if (!tagShaped(id)) throw refused(400, `\`${name}\` cannot name a worker: its lead names it \`${id || "…"}\`, which must be 2 to 24 letters (a–z), digits and dashes, starting with a letter.`);
    if (TASK_BY.includes(id) || id === COMMAND) throw refused(400, `\`${id}\` is a word the task graph keeps (${[...TASK_BY, COMMAND].join(", ")}): name the worker something else.`);
    const other = cards.find(id);
    if (other && other.tag !== card.tag) throw refused(400, `\`${id}\` is ${other.name}'s tag: a worker's name never takes another agent's — name it something else.`);
    return name;
  };
  /**
   * A team's members as a save names them, checked: one to twelve cards that exist, each with the team's own line for
   * it, which may be empty, and the model and effort the team runs it on, where it names either. A card sits in a team
   * more than once only under a name of its own for each seat: every member's id (`memberId`) is its own.
   * @param {unknown} v @returns {SavedMember[]}
   */
  const membersOf = (v) => {
    if (!Array.isArray(v)) throw refused(400, "members must be a list: each an agent's tag and the team's own line for it.");
    if (!v.length) throw refused(400, "A team needs at least one worker.");
    if (v.length > MEMBERS_MAX) throw refused(400, `A team has up to ${MEMBERS_MAX} workers (this one names ${v.length}): its lead launches as many of one worker as the work needs.`);
    /** @type {SavedMember[]} */
    const out = [];
    for (const m of v) {
      const o = m && typeof m === "object" && !Array.isArray(m) ? /** @type {Record<string, unknown>} */ (m) : null;
      if (!o) throw refused(400, "members must be a list: each an agent's tag and the team's own line for it.");
      for (const k of Object.keys(o)) if (!["tag", "name", "line", "model", "effort"].includes(k)) throw refused(400, `unknown field \`members.${k}\`: a worker has a tag, a name, a line, a model and an effort`);
      const tag = tagOf(o.tag);
      if (!tag) throw refused(400, "Each worker needs a tag: the agent it is.");
      const card = cards.find(tag);
      // A tag `foldedWords` knows says which card does its work, for a save and for a team of yours held alike.
      if (!card) throw refused(400, foldedWords(tag, (into) => `seat ${into} in its place`) ?? `There is no agent \`@${tag}\` to be a worker — Library › Agents and teams lists them.`);
      if (TASK_BY.includes(card.tag)) throw refused(400, `\`@${card.tag}\` is a word the task graph keeps for an agent's own tasks (${TASK_BY.join(", ")}): copy ${card.name} under another tag to make it a worker.`);
      // A team's own Lead runs only when its team does (OA-D4): it is no member of another's crew (the bug round of 10-23).
      if (card.partOf) throw refused(400, `${card.name} is the \`${card.partOf}\` team's own Lead: it runs only when that team does — copy it under another tag to make it a worker.`);
      const name = memberNameOf(o.name, card);
      const id = memberId({ tag: card.tag, name });
      const same = out.find((x) => memberId(x) === id);
      if (same)
        throw refused(400, name || same.name ? `Two workers are named \`${id}\`: each worker's name is its own.` : `${card.name} is already one of its workers: name each to seat it twice, or its lead launches as many of one worker as the work needs.`);
      if (o.line !== undefined && o.line !== null && typeof o.line !== "string") throw refused(400, `The team's line for ${name || card.name} must be text.`);
      const line = String(o.line ?? "").trim();
      if (line.length > LINE_MAX) throw refused(400, `The team's line for ${name || card.name} is longer than ${count(LINE_MAX)} characters (${count(line.length)}).`);
      // Its model and its effort, checked as a card's model and a launch's effort are.
      const model = o.model === undefined ? "" : modelNamed(o.model);
      if (model === null) throw refused(400, `The model the team runs ${name || card.name} on is a model's name on one line, or null for none of its own.`);
      const effort = o.effort == null ? "" : String(o.effort).trim().toLowerCase();
      if (effort && !SUBAGENT_EFFORTS.includes(effort)) throw refused(400, `The effort ${name || card.name} runs at is one of ${SUBAGENT_EFFORTS.join(", ")}, or null for none of its own.`);
      out.push({ tag: card.tag, ...(name ? { name } : {}), line, ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
    }
    return out;
  };
  /**
   * The fields of a team a save takes, read and checked: `name`, `lead`, `members` and its own fields (`OWN`) — each
   * only when given — with `allowed` naming any other field the caller reads itself. An unknown field is refused by
   * name.
   * @param {any} input @param {string[]} [allowed]
   * `leadModel`, one model, is read as a list of one: its lead's models are `leadModels`, first choice first — and so
   * a file from before the list.
   * A row of its models, `{ model, effort }`, is read as its name and its effort, kept in `efforts` (`leadEfforts`).
   * @returns {{ name?: { name: string, key: string }, lead?: string, members?: SavedMember[], models?: string[], efforts?: Record<string, string>, leadModels?: string[], leadEfforts?: Record<string, string>, readOnly?: boolean, fired?: Fired, check?: string | null }}
   */
  const fieldsOf = (input, allowed = []) => {
    for (const k of Object.keys(input || {}))
      if (!["name", "lead", "members", "leadModel", ...OWN_FIELDS, ...allowed].includes(k))
        throw refused(400, `unknown field \`${k}\`: a team has a name, a lead, members, the models its workers run on, its lead's models, readOnly, what a main agent's fire does (fired) and its check`);
    /** @type {any} */
    const out = {};
    if (input.name !== undefined) out.name = nameOf(input.name);
    if (input.lead !== undefined) out.lead = leadOf(input.lead);
    if (input.members !== undefined) out.members = membersOf(input.members);
    if (input.leadModel !== undefined && input.leadModels !== undefined) throw refused(400, "Give its lead's models (first choice first) or one model, not both.");
    if (input.leadModel !== undefined) {
      const one = leadModelOf(input.leadModel);
      out.leadModels = one ? [one] : [];
    }
    for (const k of OWN_FIELDS) if (input[k] !== undefined) out[k] = OWN[k].check(input[k]);
    // A list given says its own efforts, in its rows — names alone, none: each thinks as the main agent does —, and
    // efforts given beside it are kept for its models alone.
    if (out.models) out.efforts = kin(input.efforts !== undefined ? out.efforts : effortsIn(input.models), out.models);
    if (out.leadModels) out.leadEfforts = kin(input.leadEfforts !== undefined ? out.leadEfforts : input.leadModels !== undefined ? effortsIn(input.leadModels) : {}, out.leadModels);
    // Its check's command, judged as a task graph's check is: never an install, a step that cannot be undone, or parts
    // that hide a failure.
    const why = out.check ? checkProblem(out.check) : null;
    if (why) throw refused(400, `The team's check cannot be kept: ${why}.`);
    return out;
  };
  /** A team's own fields as its file keeps them, a lead's one model from before the list among them. @param {any} t */
  const keptOwn = (t) => ({ ...Object.fromEntries(OWN_FIELDS.filter((k) => t[k] !== undefined).map((k) => [k, k === "efforts" || k === "leadEfforts" ? storedEfforts(t[k]) : t[k]])), ...(t.leadModel != null && t.leadModels === undefined ? { leadModel: t.leadModel } : {}) });
  /**
   * A team handed out: its cards read as they stand.
   * @param {SavedTeam} t @returns {Team}
   */
  const whole = (t) => {
    const lead = cards.find(t.lead);
    const check = t.check ?? null;
    const own = /** @type {OwnValues} */ (ownOf(t));
    return {
      key: t.key,
      name: t.name,
      line: String(lead?.goodFor || ""),
      lead: { tag: t.lead, name: String(lead?.name || t.lead) },
      persona: [String(lead?.thinks || "").trim(), check ? checkWords(check) : ""].filter(Boolean).join("\n\n"),
      // Each member by its id, its card read as it stands — named where the team gives that seat a name of its own —;
      // that name, else its card's.
      members: t.members.map((m) => {
        const card = cards.find(m.tag);
        const id = memberId(m);
        const own = m.model || m.effort ? { own: { ...(m.model ? { model: m.model } : {}), ...(m.effort ? { effort: m.effort } : {}) } } : {};
        return { tag: id, ...(m.name ? { card: m.tag } : {}), name: String(m.name || card?.name || m.tag), goodFor: String(card?.goodFor || ""), may: card?.may || "read", place: cards.place(m.tag), line: m.line, model: card?.model ?? null, ...own };
      }),
      ...own,
      // Each list's efforts for its models alone: an effort given apart from its list names no model it lost.
      efforts: kin(own.efforts, own.models),
      leadEfforts: kin(own.leadEfforts, own.leadModels),
      check,
      leadModel: own.leadModels[0] ?? null,
      shipped: t.shipped,
      // A team that ships: whether you set anything of it apart from what ships, which fields, its words as it ships
      // where you set them, and those Filament's words passed since (SA3).
      ...(t.shipped ? shippedParts(t.key) : { from: t.from ?? null, createdAt: t.createdAt, updatedAt: t.updatedAt }),
    };
  };
  /** What a shipped team's handout says of your changes to it. @param {string} key */
  const shippedParts = (key) => {
    const o = tuned.get(key);
    if (!o) return { tuned: false, set: [] };
    const ships = /** @type {Record<string, any>} */ (shipped.find((t) => t.key === key));
    const set = SHIPPED_TEAM_SETS.filter((k) => o[k] !== undefined);
    const words = SHIPPED_WORDS.filter((k) => o[k] !== undefined);
    const moved = words.filter((k) => !!o.was?.[k] && o.was[k] !== hashOf(ships[k]));
    const lead = cards.find(ships.lead);
    return {
      tuned: true,
      set,
      ...(words.length
        ? { ships: Object.fromEntries(words.map((k) => [k, k === "lead" ? { tag: ships.lead, name: String(lead?.name || ships.lead) } : structuredClone(ships[k])])) }
        : {}),
      ...(moved.length ? { moved } : {}),
    };
  };


  /**
   * A team of yours as the file holds it, read as a save checks it — else why it cannot be used now, thrown.
   * @param {string} key @param {any} t @returns {SavedTeam}
   */
  const readTeam = (key, t) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) throw new Error("it is no team");
    if (teamKey(key) !== key) throw new Error(`\`${key}\` is no team's key`);
    const f = fieldsOf({ name: t.name, lead: t.lead, members: t.members, ...keptOwn(t) });
    if (!f.name || !f.lead || !f.members) throw new Error("it names no name, lead or members");
    if (clash(key, null) || clash(f.name.key, null)) throw new Error("another team holds its name");
    return { key, name: f.name.name, lead: f.lead, members: f.members, ...ownOf(f), shipped: false, from: typeof t.from === "string" ? t.from : null, createdAt: Number(t.createdAt) || 0, updatedAt: Number(t.updatedAt) || 0 };
  };
  /**
   * Your teams held that can be used now join the rest — the card one names made again, a plugin's agent read after the
   * teams were, the team that held its name gone: no card or team tells the teams it came or went. The next save writes
   * each as yours. One still held keeps why as it stands now.
   */
  const revive = () => {
    for (const [key, h] of held)
      try {
        saved.set(key, readTeam(key, h.raw));
        held.delete(key);
        log("info", `teams: the ${h.name} team can be used again`);
      } catch (/** @type {any} */ e) {
        h.why = String(e?.message || e);
      }
  };

  if (file)
    try {
      // One of another build's version is set aside first, never saved over (r-itself, 11-12; services/store-files.js).
      const raw = readStoreFile(file, STORE_FILES.teams, (level, msg) => log(level, `teams: ${msg}`), { now });
      if (raw?.version !== 2) throw new Error("it is not a version 2 teams file");
      const teams = raw.teams && typeof raw.teams === "object" && !Array.isArray(raw.teams) ? raw.teams : {};
      /** @type {string[]} */
      const skipped = [];
      for (const [key, t] of Object.entries(teams))
        try {
          saved.set(key, readTeam(key, t));
        } catch (/** @type {any} */ e) {
          if (t && typeof t === "object" && !Array.isArray(t)) held.set(key, { raw: t, name: String(t.name || key), why: String(e?.message || e) });
          else skipped.push(key);
        }
      // What you set on the teams that ship: each field read as a save checks it — one it would refuse is skipped and
      // named, the rest kept (SA3) — a lead's one model from before the list among them.
      const own = raw.shipped && typeof raw.shipped === "object" && !Array.isArray(raw.shipped) ? raw.shipped : {};
      for (const [key, t] of Object.entries(own)) {
        if (!Object.hasOwn(SHIPPED_TEAMS, key) || !t || typeof t !== "object" || Array.isArray(t)) {
          // A team Filament does not ship says which team does its work — Builders, or BugHunters: nothing of it is
          // carried over.
          const folded = Object.hasOwn(SHIPPED_TEAMS, key) ? null : foldedTeamWords(key);
          skipped.push(`shipped ${key}${folded ? ` (${folded})` : ""}`);
          continue;
        }
        const ships = /** @type {Record<string, any>} */ (shipped.find((x) => x.key === key));
        /** @type {Record<string, any>} */
        const cur = {};
        /** @type {string[]} */
        const bad = [];
        const fields = { ...Object.fromEntries(SHIPPED_WORDS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]])), ...keptOwn(t) };
        for (const k of Object.keys(t)) if (k !== "was" && k !== "leadModel" && !RETIRED.includes(k) && !SHIPPED_TEAM_SETS.includes(/** @type {any} */ (k))) bad.push(k);
        for (const [k, v] of Object.entries(fields))
          try {
            const f = /** @type {Record<string, any>} */ (fieldsOf({ [k]: v }));
            const field = k === "leadModel" ? "leadModels" : k;
            const val = field === "name" ? f.name.name : f[field];
            if (!same(val, ships[field])) cur[field] = val;
          } catch {
            bad.push(k);
          }
        const was = t.was && typeof t.was === "object" && !Array.isArray(t.was) ? Object.fromEntries(Object.entries(t.was).filter(([k, h]) => cur[k] !== undefined && typeof h === "string")) : {};
        if (bad.length) skipped.push(`shipped ${key} (${bad.join(", ")})`);
        if (Object.keys(cur).length) tuned.set(key, { ...cur, ...(Object.keys(was).length ? { was } : {}) });
      }
      if (held.size)
        log("warn", `teams: ${held.size === 1 ? "a team" : `${held.size} teams`} of yours in ${TEAMS_FILE} cannot be used now, kept as saved until ${held.size === 1 ? "it can" : "they can"} or you delete ${held.size === 1 ? "it" : "them"} — the Teams page says why: ${[...held.keys()].join(", ")}`);
      if (skipped.length)
        log("warn", `teams: ${skipped.length} team${skipped.length === 1 ? "" : "s"} in ${TEAMS_FILE} could not be read and ${skipped.length === 1 ? "was" : "were"} skipped: ${skipped.join(", ")}`);
    } catch (/** @type {any} */ e) {
      saved = new Map();
      tuned = new Map();
      held = new Map();
      if (e?.code !== "ENOENT") log("warn", `teams: ${TEAMS_FILE} could not be read (${e.message}); starting with no saved teams`);
    }

  /**
   * Write `next`, `nextTuned` and `nextHeld` as the file, then make them the store's: a save the disk refuses changes
   * nothing.
   * @param {Map<string, SavedTeam>} next @param {Map<string, Record<string, any>>} [nextTuned] @param {typeof held} [nextHeld]
   */
  const commit = (next, nextTuned = tuned, nextHeld = held) => {
    if (file) {
      mkdirSync(join(file, ".."), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      // A team's own fields are kept only where it names them: the file stays as it was for one that does not. A team
      // held goes back as it was read.
      const teams = Object.fromEntries([
        ...[...nextHeld].map(([key, h]) => [key, h.raw]),
        ...[...next.values()].map(({ key, shipped: _s, ...t }) => {
          const kept = /** @type {Record<string, any>} */ ({ ...t });
          for (const k of OWN_FIELDS) if (kept[k] === undefined || !OWN[k].named(kept[k])) delete kept[k];
          return [key, kept];
        }),
      ]);
      try {
        writeFileSync(tmp, JSON.stringify({ version: 2, teams, ...(nextTuned.size ? { shipped: Object.fromEntries(nextTuned) } : {}) }, null, 2));
        renameSync(tmp, file);
      } catch (e) {
        rmSync(tmp, { force: true });
        throw e;
      }
    }
    saved = next;
    tuned = nextTuned;
    held = nextHeld;
  };
  /** A saved team by key, or the refusal: a shipped one cannot be `verb`, and an unknown one is not there. @param {string} key @param {string} verb */
  const yours = (key, verb) => {
    const k = String(key ?? "");
    if (Object.hasOwn(SHIPPED_TEAMS, k)) throw refused(403, `\`${k}\` is a shipped team: it cannot be ${verb}${verb === "edited" ? " — Duplicate it and edit the copy" : ""}.`);
    const t = saved.get(k);
    if (!t) throw refused(404, `There is no team \`${k}\`.`);
    return t;
  };
  /**
   * A team of yours held, saved from its editor: what the file keeps of it under the fields the input gives — each given
   * one wins — checked as any save is. Saved, it is a team of yours under its key, held no more.
   * @param {string} k @param {{ raw: Record<string, any>, name: string, why: string }} h @param {any} input
   * @param {Weigher | null} [refuse]  its caller's weigher: a team held was none in use until now
   */
  const resave = (k, h, input, refuse = null) => {
    if (teamKey(k) !== k) throw refused(400, `\`${k}\` is no team's key: delete this team, and make it again under a name of its own.`);
    /** @type {Record<string, any>} */
    const base = { name: h.raw.name, lead: h.raw.lead, members: h.raw.members, ...keptOwn(h.raw) };
    if (input.leadModel !== undefined || input.leadModels !== undefined) {
      delete base.leadModel;
      delete base.leadModels;
      delete base.leadEfforts;
    }
    if (input.models !== undefined) delete base.efforts;
    const f = fieldsOf({ ...base, ...input });
    if (!f.name) throw refused(400, `A team needs a name: up to ${NAME_MAX} characters, on one line.`);
    if (!f.lead) throw refused(400, "A team needs a lead: the tag of the card in charge.");
    if (!f.members) throw refused(400, "A team needs at least one worker.");
    const other = clash(k, null) || clash(f.name.key, null);
    if (other) throw taken(other);
    const kept = [...held].find(([x, o]) => x !== k && (x === f.name?.key || teamKey(o.name) === f.name?.key));
    if (kept) throw refused(400, `A team called \`${kept[1].name}\` is kept in ${TEAMS_FILE} but cannot be used now (${kept[1].why}) — delete it first, or pick another name.`);
    const agent = agentNamed(f.name.name);
    if (agent) throw agentsName(agent);
    const tagged = agentTagged(k, f.lead);
    if (tagged) throw agentsTag(tagged);
    const at = now();
    /** @type {SavedTeam} */
    const team = { key: k, name: f.name.name, lead: f.lead, members: f.members, ...ownOf(f), shipped: false, from: typeof h.raw.from === "string" ? h.raw.from : null, createdAt: Number(h.raw.createdAt) || at, updatedAt: at };
    weighed(refuse, null, team);
    commit(new Map([...saved, [k, team]]), tuned, new Map([...held].filter(([x]) => x !== k)));
    return whole(team);
  };
  /**
   * A team of yours held as its editor opens it: its name, lead and members as the file keeps them — a lead or a member
   * whose card is gone with the words that say which card to pick (`leadGone`, `gone`) — and how it runs, each own field
   * as kept where a save takes it. Null for a key no team of yours held has. @param {string} k
   */
  const heldView = (k) => {
    const h = held.get(k);
    if (!h) return null;
    const raw = h.raw;
    const lead = tagOf(raw.lead);
    const leadCard = lead ? cards.find(lead) : null;
    /** @type {Record<string, any>} */
    const own = {};
    const stored = /** @type {Record<string, any>} */ (keptOwn(raw));
    for (const x of OWN_FIELDS)
      if (stored[x] !== undefined)
        try {
          own[x] = OWN[x].check(stored[x]);
        } catch {}
    if (raw.leadModels === undefined && raw.leadModel != null)
      try {
        const one = leadModelOf(raw.leadModel);
        own.leadModels = one ? [one] : [];
      } catch {}
    const members = (Array.isArray(raw.members) ? raw.members : []).filter((/** @type {any} */ m) => m && typeof m === "object" && tagOf(m.tag)).map((/** @type {any} */ m) => {
      const tag = tagOf(m.tag);
      const card = cards.find(tag);
      return {
        tag: card ? card.tag : tag,
        ...(typeof m.name === "string" && m.name.trim() ? { name: m.name.trim() } : {}),
        line: typeof m.line === "string" ? m.line.trim() : "",
        ...(typeof m.model === "string" && m.model.trim() ? { model: m.model.trim() } : {}),
        ...(typeof m.effort === "string" && m.effort.trim() ? { effort: m.effort.trim().toLowerCase() } : {}),
        ...(card ? {} : { gone: foldedWords(tag, (into) => `seat ${into} in its place`) ?? `There is no agent \`@${tag}\`: seat another card in its place` }),
      };
    });
    return {
      key: k,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : h.name,
      lead: leadCard ? leadCard.tag : lead,
      leadGone: leadCard || !lead ? null : foldedWords(lead, (into) => `make ${into} the lead in its place`) ?? foldedLeadWords(lead) ?? `There is no agent \`@${lead}\` to lead it: pick a lead`,
      members,
      .../** @type {OwnValues} */ (ownOf(own)),
    };
  };
  /** The team a text names: its key, or its name, either read the way a key is. @param {unknown} text @returns {SavedTeam | null} */
  const named = (text) => {
    const k = teamKey(text);
    return k ? all().find((x) => x.key === k || teamKey(x.name) === k) || null : null;
  };
  /** The team a text names, handed out. @param {unknown} text @returns {Team | null} */
  const find = (text) => {
    revive();
    const t = named(text);
    return t ? whole(t) : null;
  };
  /**
   * Set a shipped team's fields in place (SA3). A field given null is put back as it ships (`leadModel: null` its
   * lead's models), `reset: true` puts back every one first, a field set to what it ships with is as it ships. Its name,
   * lead or members set anew keep the hash of what it ships as now (`was`). Its name is checked as yours is, and its key
   * stays. A team with nothing of its own left drops out of the file. @param {string} k @param {any} input
   * @param {Weigher | null} [refuse]  its caller's weigher
   */
  const setShipped = (k, input, refuse = null) => {
    const ships = /** @type {Record<string, any>} */ (shipped.find((t) => t.key === k));
    const { reset, ...given } = input;
    if (reset !== undefined && reset !== true) throw refused(400, "reset is true, or left out: true puts every field back as the team ships.");
    const back = Object.keys(given).filter((x) => given[x] === null);
    // A field given null is known by name, as one given a value is.
    fieldsOf(Object.fromEntries(back.map((x) => [x, undefined])));
    const f = /** @type {Record<string, any>} */ (fieldsOf(Object.fromEntries(Object.entries(given).filter(([, v]) => v !== null))));
    // A list put back takes its efforts with it.
    const putBack = back.flatMap((x) => (x === "leadModel" || x === "leadModels" ? ["leadModels", "leadEfforts"] : x === "models" ? ["models", "efforts"] : [x]));
    const prev = reset ? {} : /** @type {Record<string, any>} */ (tuned.get(k) || {});
    /** @type {Record<string, any>} */
    const cur = Object.fromEntries(SHIPPED_TEAM_SETS.filter((x) => prev[x] !== undefined && !putBack.includes(x)).map((x) => [x, prev[x]]));
    /** @type {Record<string, string>} */
    const was = Object.fromEntries(Object.entries(prev.was || {}).filter(([x]) => cur[x] !== undefined));
    const now0 = /** @type {SavedTeam} */ (all().find((t) => t.key === k));
    for (const x of SHIPPED_TEAM_SETS) {
      if (f[x] === undefined) continue;
      const v = x === "name" ? f.name.name : f[x];
      if (same(v, ships[x])) {
        delete cur[x];
        delete was[x];
      } else {
        if (SHIPPED_WORDS.includes(/** @type {any} */ (x)) && !same(v, cur[x])) was[x] = hashOf(ships[x]);
        cur[x] = v;
      }
    }
    for (const x of SHIPPED_WORDS) if (cur[x] !== undefined) was[x] ??= hashOf(ships[x]);
    if (f.name && cur.name !== undefined) {
      const other = clash(f.name.key, k);
      if (other) throw taken(other);
      const kept = heldUnder(f.name.key);
      if (kept) throw kept;
      const agent = f.name.name.toLowerCase() !== now0.name.toLowerCase() ? agentNamed(f.name.name) : null;
      if (agent) throw agentsName(agent);
      const tagged = f.name.key !== k ? agentTagged(f.name.key, cur.lead ?? ships.lead) : null;
      if (tagged) throw agentsTag(tagged);
    }
    const next = new Map(tuned);
    if (Object.keys(cur).length) next.set(k, { ...cur, ...(Object.keys(was).length ? { was } : {}) });
    else next.delete(k);
    weighed(refuse, now0, /** @type {SavedTeam} */ ({ ...ships, ...cur }));
    commit(saved, next);
    return whole(/** @type {SavedTeam} */ (all().find((t) => t.key === k)));
  };

  return {
    /** Every team: the shipped ones in their order, then yours by name. */
    list: () => {
      revive();
      return all().map(whole);
    },
    find,
    /**
     * The teams a card is used by: the ones it leads, and the ones it is a member of, with the team's line for it —
     * yours held among them.
     * @param {unknown} tag @returns {{ key: string, name: string, as: "lead" | "member", line: string }[]}
     */
    usedBy(tag) {
      revive();
      const t = tagOf(tag);
      return naming().flatMap((x) => {
        const m = x.members.find((y) => y.tag === t);
        return [...(x.lead === t ? [{ key: x.key, name: x.name, as: /** @type {const} */ ("lead"), line: "" }] : []), ...(m ? [{ key: x.key, name: x.name, as: /** @type {const} */ ("member"), line: m.line }] : [])];
      });
    },
    /**
     * Why a card cannot go: the first team that uses it — one of yours held among them — and what to do there first —
     * or null. @param {unknown} tag @returns {string | null}
     */
    holds(tag) {
      revive();
      const t = tagOf(tag);
      const name = cards.find(t)?.name || t;
      for (const x of naming()) {
        // A team held lets the card go once its edit seats another, or its Delete.
        const kept = x.held ? ", kept but not usable now: edit or delete that team first" : "";
        if (x.lead === t) return `${name} leads the ${x.name} team${kept || ": pick another lead for it first"}`;
        if (x.members.some((m) => m.tag === t)) return `${name} works in the ${x.name} team${kept || ": take it out of the team first"}`;
      }
      return null;
    },
    /**
     * Save a new team, or Duplicate one (`from`, a team's key or name): the source's lead and members under a new
     * name, with what the input says on top; with no name, the source's name and "copy". `refuse`: its caller's
     * weigher (`Weigher`), asked of the team it would keep before anything is kept.
     * @param {any} input @param {{ refuse?: Weigher | null }} [o]
     */
    create(input, { refuse = null } = {}) {
      revive();
      const f = fieldsOf(input || {}, ["from"]);
      const src = input?.from !== undefined ? named(input.from) : null;
      if (input?.from !== undefined && !src) throw refused(404, `There is no team called \`${String(input.from)}\` to duplicate — /team lists them.`);
      let name = f.name;
      if (!name && src)
        for (let n = 1; !name; n++) {
          // The source's name is cut to make room, never the suffix: cut, every name tried would be the source's.
          const suffix = ` copy${n > 1 ? ` ${n}` : ""}`;
          const candidate = nameOf(`${src.name.slice(0, NAME_MAX - suffix.length).trimEnd()}${suffix}`);
          if (!clash(candidate.key, null) && !heldUnder(candidate.key) && !agentNamed(candidate.name) && !agentTagged(candidate.key, f.lead ?? src.lead)) name = candidate;
        }
      if (!name) throw refused(400, `A team needs a name: up to ${NAME_MAX} characters, on one line.`);
      const other = clash(name.key, null);
      if (other) throw taken(other);
      const kept = heldUnder(name.key);
      if (kept) throw kept;
      const agent = agentNamed(name.name);
      if (agent) throw agentsName(agent);
      const tagged = agentTagged(name.key, f.lead ?? src?.lead ?? null);
      if (tagged) throw agentsTag(tagged);
      const lead = f.lead ?? src?.lead;
      if (!lead) throw refused(400, "A team needs a lead: the tag of the card in charge.");
      const members = f.members ?? src?.members.map((m) => ({ ...m }));
      if (!members) throw refused(400, "A team needs at least one worker.");
      const at = now();
      /** @type {SavedTeam} */
      const team = { key: name.key, name: name.name, lead, members, ...ownOf({ ...(src ? ownOf(src) : {}), ...Object.fromEntries(OWN_FIELDS.filter((k) => f[k] !== undefined).map((k) => [k, f[k]])) }), shipped: false, from: src ? src.key : null, createdAt: at, updatedAt: at };
      weighed(refuse, null, team);
      commit(new Map([...saved, [team.key, team]]));
      return whole(team);
    },
    /**
     * Edit a team: each field only when given. Its key stays — sessions name it so. A team that ships is set in place
     * (SA3): every field yours — its name, lead and members, and how it runs (its models, its lead's models, read-only, what a main agent's fire does, its check) — a field set back to what ships dropped, one given null put
     * back, `reset: true` putting back every one first. One of yours held is saved from its editor (`resave`): what the
     * file keeps under what the input gives, checked as any save is. `refuse`: its caller's weigher (`Weigher`), asked
     * of the team kept until now and the one it would keep, before anything is kept.
     * @param {string} key @param {any} input @param {{ refuse?: Weigher | null }} [o]
     */
    update(key, input, { refuse = null } = {}) {
      revive();
      const k = String(key ?? "");
      if (Object.hasOwn(SHIPPED_TEAMS, k)) return setShipped(k, input || {}, refuse);
      const h = held.get(k);
      if (h) return resave(k, h, input || {}, refuse);
      const cur = yours(key, "edited");
      const f = fieldsOf(input || {});
      if (f.name) {
        const other = clash(f.name.key, cur.key);
        if (other) throw taken(other);
        const kept = heldUnder(f.name.key);
        if (kept) throw kept;
        const agent = f.name.name.toLowerCase() !== cur.name.toLowerCase() ? agentNamed(f.name.name) : null;
        if (agent) throw agentsName(agent);
        const tagged = f.name.key !== cur.key ? agentTagged(f.name.key, f.lead ?? cur.lead) : null;
        if (tagged) throw agentsTag(tagged);
      }
      /** @type {SavedTeam} */
      const team = { ...cur, ...(f.name ? { name: f.name.name } : {}), ...(f.lead ? { lead: f.lead } : {}), ...(f.members ? { members: f.members } : {}), ...Object.fromEntries(OWN_FIELDS.filter((k) => f[k] !== undefined).map((k) => [k, f[k]])), updatedAt: now() };
      weighed(refuse, cur, team);
      commit(new Map([...saved, [team.key, team]]));
      return whole(team);
    },
    /**
     * Delete a team you saved, or one of yours held (`held`) — under a shipped team's key too, where the file kept one of
     * yours; the shipped ones stay.
     * @param {string} key @returns {{ key: string, name: string }}
     */
    remove(key) {
      revive();
      const k = String(key ?? "");
      const h = held.get(k);
      if (h) {
        commit(saved, tuned, new Map([...held].filter(([x]) => x !== k)));
        return { key: k, name: h.name };
      }
      const cur = yours(key, "deleted");
      commit(new Map([...saved].filter(([x]) => x !== cur.key)));
      return whole(cur);
    },
    /** Your teams the file holds that cannot be used now, with why: kept until a card comes back or you delete one. */
    held: () => {
      revive();
      return [...held].map(([key, h]) => ({ key, name: h.name, why: h.why }));
    },
    /** One of yours held as its editor opens it (`heldView`), or null. @param {unknown} key */
    heldTeam(key) {
      revive();
      return heldView(String(key ?? ""));
    },
    /**
     * The name of the team one of whose members answers to `tag` by the name the team gives it (`memberId`), or null:
     * a card saved under that tag would answer to it too — yours held among them, by the names the file keeps, since one
     * comes back as it was saved. @param {string} tag @returns {string | null}
     */
    memberNamed(tag) {
      revive();
      const used = all().find((t) => t.members.some((m) => m.name && memberId(m) === tag));
      if (used) return used.name;
      const kept = [...held.values()].find((h) => (Array.isArray(h.raw.members) ? h.raw.members : []).some((/** @type {any} */ m) => typeof m?.name === "string" && !!m.name.trim() && slugOf(m.name.trim()) === tag));
      return kept?.name ?? null;
    },
    /**
     * The key and name of every team, yours held among them: an agent takes neither (OA1), so a team that comes back
     * shares its name with none. @returns {{ key: string, name: string }[]}
     */
    names: () => {
      revive();
      return [...all().map((t) => ({ key: t.key, name: t.name })), ...[...held].map(([key, h]) => ({ key, name: h.name }))];
    },
  };
}

/** @typedef {ReturnType<typeof createTeamStore>} TeamStore */
