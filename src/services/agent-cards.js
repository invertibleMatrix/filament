// @ts-check
// Saved agents (HarnessV4_Tasks E15 steps 2 and 4): a card is what a saved agent is kept as — the tag typed after `@`,
// its name, where it is listed, the one line that says what it is good for, the paragraph that says how it thinks, what it may
// do, the model it runs on, what it sees of the session it is called in — and the commands it runs without asking in
// its own copy (decision 21, AG-267),
// none for one that only reads; the launch checks each the way a brief's are (app/agent/grants.js, given to the store
// as `runsProblem`: the store sits below it). There is one kind of agent (HarnessV4_OneAgent_Plan OA1): what it may
// do is its own level, the only limit — a launch may lower it, never raise it — and any agent may lead a team or sit
// in its crew. Four agents ship with Filament, and two more that are the shipped teams' own Leads and stand in no list
// of agents (`partOf`); your own are saved in one JSON file in the data folder, version 1: `{ version: 1, agents: { <tag>: SavedCard } }`, kept
// as teams are (services/teams.js). Everything
// Filament launches beside a session's agent runs as a card: with nothing named, as Builder. The file is read the way a
// save checks it: one that is broken, or is not version 1, starts empty and is reported, never thrown over, and a card
// in it that a save would refuse is skipped and reported. A card a team uses — as its lead, or as a member — is not
// deleted (`usedBy`, the teams' word for it). A refusal carries the status the admin API answers
// with: 400 for what a save refuses, 403 for a shipped card, 404 for one nobody made.
// A card names its models as a list, first choice first (the owner's words of 10-19: "assign each specialized agent a
// model as a priority list"): a launch takes the first that can run and has room, and a run its provider fails goes on
// to the next (app/agent/subagents.js); `model` is the first of them, for whoever reads one. A shipped card is yours to
// change in place, every field but its tag (HarnessV4_ShippedAgents_Plan SA1, SA-D1; the owner's words of 10-23: "i
// mean everything"), kept in the same file beside yours — `shipped: { <tag>: { <field>: …, was: { <field>: <hash> } } }`,
// each field only where it is not as the card ships, with a short hash of what shipped when you set it (`was`) — so
// your words stay when Filament ships new ones, and the card says so (`moved`, SA-D3). `set` names your fields, `ships`
// what each is as the card ships; a field given null is put back, `reset` puts back every one (SA-D2). Delete stays
// refused: a shipped agent stays in the lists.
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { findingsFormat } from "../core/beside.js";
import { SUBAGENT_EFFORTS } from "../core/schema.js";
import { STORE_FILES, readStoreFile } from "./store-files.js";

export const AGENT_CARDS_FILE = "agents.json";

/**
 * What a card may do, least first (AG-7): read only; run in its own copy of the project, nothing kept; edit in its own
 * copy, applied by whoever called it. A call may lower a card's level, never raise it (AG-8).
 */
export const CARD_MAY = Object.freeze(/** @type {const} */ (["read", "copy", "edit"]));
/**
 * What a card may see of the session: one of a sub-agent's views — each from the session's last compaction on, the
 * context window as it stands among them — the live copy apart.
 */
export const CARD_VIEWS = Object.freeze(/** @type {const} */ (["none", "folded", "window"]));
/** A change a card may also be shown, as a patch. */
export const CARD_CHANGES = Object.freeze(/** @type {const} */ (["turn", "uncommitted"]));
/** Tags `@` already means something else by: Filament's own commands for clients without a slash. */
const RESERVED = Object.freeze(["mem", "mode"]);
const TAG_RE = /^[a-z][a-z0-9-]{1,23}$/;
/** A plugin's agent's tag (B3): `<plugin>:<name>`, which no card you save can take. */
const PLUGIN_TAG_RE = /^[a-z0-9][a-z0-9._-]{0,63}:[a-z0-9][a-z0-9._-]{0,63}$/;
const NAME_MAX = 40;
const GOOD_FOR_MAX = 160;
const THINKS_MAX = 4000;
const MODEL_MAX = 200;
/** How many models a card names, first choice first. */
const MODELS_MOST = 6;
/** The characters a save takes, which the Agents page counts against. */
export const CARD_LIMITS = Object.freeze({ tag: 24, name: NAME_MAX, goodFor: GOOD_FOR_MAX, thinks: THINKS_MAX, models: MODELS_MOST });
/**
 * The tools an agent may go without (HarnessV4_ShippedAgents_Plan SA2, `toolsOff`), every agent's — yours and the
 * shipped ones: each is on unless you switch it off — the shell (commands, and background ones), the browser, the web
 * (fetch and search), the chat's MCP servers, visuals and artifacts, the project's Space. The level gives and the chat
 * gives; these only take away (SA-D4, SA-D5). Writing files is the level's, never a switch.
 */
export const CARD_TOOLS = Object.freeze(/** @type {const} */ (["shell", "browser", "web", "mcp", "visuals", "space"]));
/** What of a shipped card is set in place (SA-D1): every field but its tag, which records name it by. */
export const SHIPPED_SETS = Object.freeze(/** @type {const} */ (["name", "goodFor", "thinks", "may", "models", "efforts", "sees", "mayRun", "toolsOff"]));

/**
 * @typedef {{ view: typeof CARD_VIEWS[number], running: boolean, changes: typeof CARD_CHANGES[number] | null }} CardSees
 *   what the agent sees when it is asked: the session's finished turns by a view, the turn running now, a change
 * @typedef {object} AgentCard
 * @property {string} tag  what is typed after `@`; it never changes once saved, as records name it
 * @property {string} name  as the page shows it
 * @property {string | null} partOf  the team whose own Lead it is (OA-D4): such a card stands in no list of agents, is
 *   neither asked nor named by itself, and is set on its team's page; null for every other
 * @property {string} goodFor  one line: what to ask it, which an agent reads too when it picks whom to call
 * @property {string} thinks  how it thinks: the paragraph its instructions carry; it may be empty — it then works as
 *   the session's agent would
 * @property {typeof CARD_MAY[number]} may  what it may do — read only, run in its own copy, or edit in its own copy —
 *   the only limit on it: a launch may lower it, never raise it
 * @property {string[]} models  the models it runs on, first choice first: the next where one cannot run now, has no
 *   room or its provider fails; none — the session's Seats
 * @property {string | null} model  the first of its models, or null: the session's
 * @property {Record<string, string>} [efforts]  how hard it thinks on each of its models that says (the owner's word of
 *   11-05: "model · account · effort"), by the model's name as listed; one that says none, the main agent's
 * @property {CardSees} sees
 * @property {string[]} mayRun  commands it runs without asking where it works in its own copy, each followed by more
 *   words or not (AG-267); none for one that only reads
 * @property {(typeof CARD_TOOLS[number])[]} toolsOff  the tools it goes without, in `CARD_TOOLS`' order; none — every
 *   tool its level and the chat give it (SA2)
 * @property {boolean} shipped
 * @property {string | null} [from]  the card it was copied from
 * @property {(typeof SHIPPED_SETS[number])[]} [set]  a shipped card's: what of it is set in place, not as it ships
 * @property {Partial<Record<typeof SHIPPED_SETS[number], any>>} [ships]  a shipped card's: each field of `set` as the card
 *   ships it — what Put back gives
 * @property {(typeof SHIPPED_SETS[number])[]} [moved]  a shipped card's: the fields of `set` whose words Filament changed
 *   since you set them (SA-D3)
 * @property {number} [createdAt]
 * @property {number} [updatedAt]
 * @property {string} [plugin]  the plugin it came with, by its id (HarnessV4_SpacesPlugins_Plan B3): read from the
 *   plugin's agents/ file, tagged `<plugin>:<name>`, never saved here — Make a copy to change it — and asked only in
 *   the chats where its plugin is on
 * @typedef {ReturnType<typeof createAgentCardStore>} AgentCardStore
 */

/**
 * The saved agents a list of tags names (a session's `subagents.ask`, HarnessV4_Tasks E15 step 3): those whose card
 * exists, in the list's order, each once — who an agent's tool lists, each with the line that says what it is good for.
 * @param {unknown} tags @param {(tag: string) => AgentCard | null | undefined} find
 * @returns {Askable[]}
 */
export function askablesOf(tags, find) {
  /** The card a copy comes from at the root, by its `from`s; a loop or a card gone ends the walk where it stands. @param {any} card @param {(tag: string) => any} look */
  const rootOf = (card, look) => {
    let at = card;
    const seen = new Set([card.tag]);
    while (at?.from && !seen.has(at.from)) {
      seen.add(at.from);
      const up = look(at.from);
      if (!up) return at.from;
      at = up;
    }
    return at?.tag ?? null;
  };
  /** @type {Askable[]} */
  const out = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = String(raw ?? "").trim().replace(/^@/, "").toLowerCase();
    const card = tag && !out.some((a) => a.tag === tag) ? find(tag) || null : null;
    // A team's own Lead is its team's: never asked by itself. A copy of a copy names the card it comes from at the root
    // (`root`), so a copy of a copy of Builder holds Builder's place as a copy of it does (the bug round of 10-23).
    const root = card?.from ? rootOf(card, find) : null;
    if (card && !card.partOf) out.push({ tag: card.tag, name: card.name, goodFor: card.goodFor, may: card.may, from: card.from ?? null, ...(root && root !== card.from ? { root } : {}) });
  }
  return out;
}

/**
 * Where your agents and the teams meet — a name both hold, an agent's tag a team's key or a member's name — said once
 * both stores stand: an agents file written by hand is read before the teams are (the bug round of 10-23). Nothing is
 * dropped: the words say which to rename. A team's own Lead is its team's; a shipped agent's name meets a team's only where you set it (SA1).
 * @param {readonly { tag: string, name: string, shipped?: boolean, partOf?: string | null, set?: readonly string[] }[]} cards
 * @param {readonly { key: string, name: string, members?: readonly { tag: string, card?: string }[] }[]} teams
 * @returns {string[]}
 */
export function teamClashes(cards, teams) {
  /** @type {string[]} */
  const out = [];
  for (const c of cards) {
    if (c.partOf || (c.shipped && !c.set?.includes("name"))) continue;
    const named = teams.find((t) => t.name.toLowerCase() === c.name.toLowerCase());
    const keyed = c.shipped ? null : teams.find((t) => t.key === c.tag);
    const seated = teams.find((t) => (t.members || []).some((m) => m.card && m.card !== c.tag && m.tag === c.tag));
    if (named) out.push(`${c.name} (@${c.tag}) has the name of the team ${named.name}: an agent and a team never share a name — rename one on Library › Agents and teams`);
    if (keyed) out.push(`@${c.tag} (${c.name}) is the key of the team ${keyed.name}: @ names either — give the agent another tag on Library › Agents and teams`);
    if (seated) out.push(`@${c.tag} (${c.name}) is what the team ${seated.name} calls one of its workers: its lead names either so — rename that worker on Library › Agents and teams`);
  }
  return out;
}

/** A text as a regular expression's own words. @param {string} s */
const literal = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * A past chat tagged in a message, `[its title](chat:<id>)` (the owner's word of 10-26): its title is the chat's name,
 * never an agent named. The page's copy is ui/harness/lib/labels.js's, pinned equal by test/chat-tag.test.js.
 */
export const CHAT_LINK = /\[((?:\\.|[^\]\\\n]){1,200})\]\(chat:([A-Za-z0-9_-]{1,64})\)/g;
/**
 * A text with its code — fenced blocks, an unclosed fence to the end, inline spans — blanked to spaces, every other
 * character where it stood: what a person's words name, never what they pasted.
 * @param {unknown} text
 */
export const codeBlanked = (text) => String(text ?? "").replace(/```[\s\S]*?(?:```|$)|`[^`\n]*`/g, (m) => " ".repeat(m.length));
/**
 * The saved agents a text names in plain words (the owner's words of 10-19: "the main agent spawns these when asked in
 * plain words"): by its name or its tag, as words of their own — "ask Product", "the End user's view", "send a
 * reviewer", "@product" — in any case, a plural or a possessive after, a dash or a space between a name's words; never
 * inside a path, an address, code or a tagged chat's title, nor inside a longer name the text names in that place
 * (`around`: the names that may hold one — a card of yours called Hunter in a team called "Bug Hunter", as flow
 * drafting reads them, HarnessV4_OneAgent_Plan L49). Their tags, each once, in the cards' order.
 * @param {unknown} text @param {readonly { tag: string, name: string }[]} cards @param {readonly string[]} [around]
 * @returns {string[]}
 */
export function cardsNamedIn(text, cards, around = []) {
  const t = codeBlanked(text).replace(CHAT_LINK, (m) => " ".repeat(m.length));
  if (!t.trim()) return [];
  /** Where a name stands as words of its own: each place's start and end. @param {string} w @returns {[number, number][]} */
  const spans = (w) => {
    const words = w.trim().split(/[\s-]+/).filter(Boolean).map(literal).join("[\\s-]+");
    if (!words) return [];
    const re = new RegExp(`(?<![\\p{L}\\p{N}_/.\\\\-])@?${words}(?:'s|’s|s)?(?![\\p{L}\\p{N}_/\\\\-]|\\.[\\p{L}\\p{N}])`, "giu");
    return [...t.matchAll(re)].map((m) => /** @type {[number, number]} */ ([m.index ?? 0, (m.index ?? 0) + m[0].length]));
  };
  const longer = [...new Set([...cards.map((c) => c.name), ...around].map((n) => String(n).trim().toLowerCase()).filter(Boolean))].map((n) => ({ n, at: spans(n) }));
  /** Whether a place stands inside a longer name's, there. @param {[number, number]} s @param {string} own */
  const within = ([a, b], own) => longer.some((g) => g.n !== own && g.at.some(([x, y]) => x <= a && b <= y && y - x > b - a));
  return cards.filter((c) => [...spans(c.tag), ...spans(c.name)].some((s) => !within(s, c.name.trim().toLowerCase()))).map((c) => c.tag);
}

/**
 * Whether a call may run a card at the level it names: the card's own, or a lower one. @param {string} may  the
 * card's @param {string} asked  the call's
 */
export const mayLower = (may, asked) => CARD_MAY.indexOf(/** @type {any} */ (asked)) >= 0 && CARD_MAY.indexOf(/** @type {any} */ (asked)) <= CARD_MAY.indexOf(/** @type {any} */ (may));

/**
 * What an agent sees unless its card says otherwise: nothing of the session (the owner's words of 10-19: "if we give the
 * specialized agent a context then it will not be any different than the main agent … the default should be an
 * empty"). A second opinion starts apart from the agent it is the second to: from the question, and the project its
 * tools read.
 */
const APART_SEES = Object.freeze({ view: "none", running: false, changes: null });
/**
 * The two agents the session's agent may always launch — the first when it names none — the others where the session
 * names them (AG-6).
 */
export const OWN_WORKERS = Object.freeze(/** @type {const} */ (["builder", "reviewer"]));

/**
 * The cards that ship, each with the line that says what it is good for, the paragraph that says how it thinks and
 * what it may do (OA1's levels: Product edits in its own copy, as in real life a product owner writes notes and mocks
 * the screens; End user runs in its own copy, to use what it judges — HarnessV4_ShippedAgents_Plan SA5): two written to
 * think with you, then the two that are the shipped teams' own Leads (HarnessV4_Tasks E15 step 6, AG-168: each team's
 * line and its Lead's words, as they were the team's own — the Builders' the job and the one way its lead leads;
 * BugHunters' a hunt and a check of claims alike, team_v2_plan
 * §5.6 and the plan's p6), part of their team (`partOf`, OA-D4) — then the two that do a session's work, who see
 * nothing of it unless their launch asks: Builder, which changes files — builds, fixes, and writes and runs tests — and
 * Reviewer, which changes nothing — explores, reviews, hunts bugs, checks claims and takes a second look. The two that
 * started by themselves, Explainer and Watcher, went with that way of starting (the owner's word of 11-05).
 */
export const SHIPPED_CARDS = Object.freeze({
  product: {
    name: "Product",
    may: "edit",
    goodFor: "Is it worth building, its smallest version, and where it lives on the page",
    thinks:
      "You think as the product's owner and its designer. Start from the person's job: what they are trying to get done, how they do it today, and what changes for them if this ships. Weigh what it must do against what it costs to build, run, keep and explain; name the smallest version worth having, what to leave out of it, and what would show it worked. Then where it lives: what they see first, which words they read, what they press — walk the everyday task through it, the first time and the hundredth, and count the clicks, choices and things to remember. Prefer one clear place over several, a default that is right over a setting that fixes it, and the person's words over the code's names. Look in the project — its pages and their words too — before you call anything missing. Where an idea solves a problem nobody has, repeats what is there or has a cheaper way, say so plainly; where a choice removes something that works or changes a default, lay it out as the person's call.",
  },
  enduser: {
    name: "End user",
    may: "copy",
    goodFor: "Would I find it, and what would annoy me",
    thinks:
      "You are the person who uses this every day, not the one who built it. You know your own work, not how this works inside, and you read no documentation first. Ask: would I find this, would I understand it the first time, what do I expect to happen when I press it, what would annoy me the tenth time, and what does it cost me in time, attention or money. Say what you would really do — ignore it or work around it included — in your own plain words, and what would make you stop using it. Where the builders' words differ from yours, say the word you would have used. Where you can, use it as a user would: start it in your copy, open it in the browser and go through the task — and say what happened, not what the code says.",
  },
  buildlead: {
    name: "Builders",
    partOf: "builders",
    goodFor: "Builds it with its workers: planned, run in parallel where it can, each claim checked",
    thinks:
      "You lead a team that builds: you cut the goal into tasks, brief a worker for each, and check what each brings before the work counts. Every brief names the files its task touches, what it must not change, and the acceptance check that proves it done; ask for the smallest change that meets that check. A worker's claim stands on facts — the file and line it read or changed, the check it ran and that check's real output — never on its word: read what it changed, or have the Tester run the check, before you call a task done. A task that fails its check is fixed before anything builds on it.\n\nHow you lead: the shortest path that works, planned and checked. Before any order goes out, write the plan: the few changes that make the goal true, in order, each with the check that proves it done, and where two parts meet, the interface between them and what neither may change. Anything the goal does not need waits: no refactors, options or polish along the way. Measure instead of guessing: a Scout's numbers before a design choice. Tasks that touch different files and need nothing of each other go out at once, each with its own files; a task that builds on another waits until that one passes its check. When every task is in, order one review of the whole: one name for one idea, every interface used as the plan says.",
  },
  huntlead: {
    name: "BugHunters",
    partOf: "bughunters",
    goodFor: "Finds bugs and checks claims, fixing nothing: each finding checked against the code",
    thinks:
      "You lead BugHunters: you find bugs and check claims, and you fix nothing. Your Hunters hunt and your Checkers check; a Checker on a stronger model than the Hunters — the person may give one its own model — has the last word on a finding.\n\n" +
      "Asked to find bugs: split the job into slices — by the files of the range your opening names, a large one alone; else a phase, an area, a group of files — and give each Hunter one, with a brief: its slice and its files, what was built there and why (from the record), what counts as a bug, and what to leave alone. A finding is the claim, its file and line, the code that shows it, why it is a bug, and how to see it go wrong where that can be shown. Filament merges your Hunters' findings by file and nearby line for you, \"found by N\" where N of them reported one. When their reports are in, send every finding to your Checkers, a few each, side by side, to check against the code as it is now — with no Checker in your team, read the code and check each yourself. Then merge the duplicates and rank by harm. Your result has Found (each one confirmed, with its evidence), Plausible (with what is missing to show it), Dismissed (each in a line, with why) and what was not covered.\n\n" +
      "Asked to check claims you are given: split them among your Checkers, a few each, so a long list is checked side by side; check a short one yourself, and every claim where your team has no Checker. Each claim is checked against the code as it is now — the file and the line read, what shows it run where it can be. Your result gives each claim one verdict: Confirmed (with why), Plausible (it cannot be shown either way, with what is missing) or Dismissed (with why).\n\n" +
      "Either way, start your result with one line, \"Subject: \" and your verdict in under 20 words: the main agent may read that line before the rest.\n\n" + findingsFormat(),
  },
  builder: {
    name: "Builder",
    may: "edit",
    goodFor: "Builds and fixes in its own copy, and writes and runs the tests that prove it",
    thinks:
      "You build: make the change your task asks for — a feature, a fix, or the tests for one — and only that. Read the code you will touch and its callers before you write, and write as the code around it is written: its names, its comments, its idioms. Make the smallest change that does the job: no refactor, rename or tidying along the way, no option nobody asked for, and no patch over a symptom where its cause can be fixed. Ask what it breaks: other callers, saved data, a restart in the middle, two at once, the failing path. A test must be able to fail: where it guards a fix, show it failing without the fix, then passing with it; test through the code's own entry points, and never weaken an assertion, skip a test or bend the code under test to make one pass — report the failure instead. Run the check your brief names; where it names none, the nearest test or type check that covers the change. Report the files you changed and why, each command you ran with its real result — the counts, and failing output as printed — and what you noticed and left alone. Never call tested what you did not run.",
  },
  reviewer: {
    name: "Reviewer",
    may: "read",
    goodFor: "Reads and judges, changing nothing: maps code, reviews a change, hunts bugs, checks claims",
    thinks:
      "You read and judge, and change nothing. Asked where a thing is or how it works: search wide — the names, the words, the files around the obvious one — read enough to be sure, and stop once it is answered. Asked to review a change: read the code around it, what calls it and what it no longer does; look first for a wrong result, a broken caller, a missed case, lost data, a race or a hole an attacker could use, then for a missing test or error path. Asked to hunt bugs: follow the data — what can be empty, huge, repeated or concurrent, the failing path, a restart — and give each bug the input or the order of events that sets it off. Asked to check claims: trust no line number or quote in them, find the code yourself, run something harmless where it shows it, and give each one verdict — Confirmed, Plausible or Dismissed, with why. Asked for a second look: say what was assumed and never checked, and the cheapest thing that would do; where it is sound, say so in a line. Stand on the code as it is now, never on a comment or a name: each finding with its file and line and what goes wrong, what you showed apart from what you only suspect (Plausible), and where you looked and found nothing.",
  },
});

/**
 * @typedef {{ tag: string, name: string, goodFor: string, may: typeof CARD_MAY[number], from: string | null, root?: string }} Askable
 *   a saved agent a session names for its agent: who an agent's tool lists, with what it may do and the card it was
 *   copied from
 */

/** A shipped card as the store gives one. @param {string} tag @returns {AgentCard | null} */
export function shippedCard(tag) {
  const c = Object.hasOwn(SHIPPED_CARDS, tag) ? /** @type {any} */ (SHIPPED_CARDS)[tag] : null;
  if (!c) return null;
  return { tag, name: c.name, partOf: c.partOf ?? null, goodFor: c.goodFor, thinks: c.thinks, may: c.may ?? "read", models: [], model: null, efforts: {}, sees: { ...(c.sees || APART_SEES) }, mayRun: [], toolsOff: [], shipped: true, set: [] };
}

/**
 * Builder and Reviewer where what they may do is set on them (SA1) and the session names neither them nor a copy in their
 * place: the agent tool's words for its own two say each one's level as it stands (tools.js `launchKinds`), apart from
 * the agents a session names — nobody asks them by their tag, and a prompt that counts those counts none of these.
 * @param {readonly Askable[]} asks  the agents the session names @param {(tag: string) => AgentCard | null | undefined} find
 * @returns {Askable[]}
 */
export function placesOf(asks, find) {
  /** @type {Askable[]} */
  const out = [];
  for (const base of OWN_WORKERS) {
    if (asks.some((a) => a.tag === base || a.from === base || a.root === base)) continue;
    const c = find(base);
    if (c?.set?.includes("may")) out.push({ tag: c.tag, name: c.name, goodFor: c.goodFor, may: c.may, from: null });
  }
  return out;
}

/**
 * What is set in place on a shipped card: each field only where it is not as the card ships, and with each the short
 * hash of what the card shipped when it was set (`was`).
 * @typedef {Partial<Record<typeof SHIPPED_SETS[number], any>> & { was?: Record<string, string> }} ShippedSet
 */
/** Whether two values of a field are the same: they are checked values, written the same way. @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** A short hash of what a field ships as, to tell later whether Filament's words for it moved (SA-D3). @param {unknown} v */
const hashOf = (v) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex").slice(0, 12);
/**
 * A shipped card as it stands: as it ships (`base`), with what is set in place on top; `set` names those fields, `ships`
 * each as it ships, `moved` those Filament's later words passed. @param {AgentCard} base @param {ShippedSet} o
 * @returns {AgentCard}
 */
function dressed(base, o) {
  const set = SHIPPED_SETS.filter((k) => o[k] !== undefined);
  if (!set.length) return base;
  const moved = set.filter((k) => !!o.was?.[k] && o.was[k] !== hashOf(/** @type {any} */ (base)[k]));
  return withModel({
    ...base,
    ...Object.fromEntries(set.map((k) => [k, structuredClone(o[k])])),
    set,
    ships: Object.fromEntries(set.map((k) => [k, structuredClone(/** @type {any} */ (base)[k])])),
    ...(moved.length ? { moved } : {}),
  });
}

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });
/** @param {number} n */
const count = (n) => n.toLocaleString("en-US");

/**
 * A text as a tag: lower-cased, a leading `@` dropped — or null when it is no tag (2 to 24 of a–z, 0–9 and dash,
 * starting with a letter: so a tag never reads as a file's path; or a plugin's agent's, `<plugin>:<name>`, B3).
 * @param {unknown} text
 */
export function cardTag(text) {
  const t = String(text ?? "").trim().replace(/^@/, "").toLowerCase();
  return TAG_RE.test(t) || PLUGIN_TAG_RE.test(t) ? t : null;
}

/** @param {unknown} tag @returns {string} */
function tagOf(tag) {
  const raw = typeof tag === "string" ? tag.trim().replace(/^@/, "") : "";
  if (!raw) throw refused(400, "An agent needs a tag: what you type after @ — 2 to 24 letters, digits and dashes, starting with a letter.");
  const t = raw.toLowerCase();
  if (!TAG_RE.test(t)) throw refused(400, `\`${raw}\` cannot be a tag: a tag is 2 to 24 letters (a–z), digits and dashes, and starts with a letter.`);
  if (RESERVED.includes(t)) throw refused(400, `\`@${t}\` is a command of Filament's own; give the agent another tag.`);
  // A team's task graph names a task Filament runs itself `by: command` beside its members' tags (HarnessV3-TaskGraph-v2 TG2-D70).
  if (t === "command") throw refused(400, "`@command` names Filament's command tasks in a team's task graph; give the agent another tag.");
  return t;
}

/** One line of text, checked. @param {unknown} v @param {string} what @param {number} max @returns {string} */
function lineOf(v, what, max) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw refused(400, `An agent needs ${what}: up to ${max} characters, on one line.`);
  if (/[\r\n]/.test(s)) throw refused(400, `An agent's ${what.replace(/^an? /, "")} is one line, up to ${max} characters.`);
  if (s.length > max) throw refused(400, `An agent's ${what.replace(/^an? /, "")} is up to ${max} characters (this one has ${s.length}).`);
  return s;
}

/**
 * What a saved card sees, or a shipped one set in place, as a read of the file takes it: a view named that Filament
 * does not offer reads as nothing, and the card is kept with the rest of what it says.
 * @param {unknown} v
 */
const storedSees = (v) => {
  const view = v && typeof v === "object" && !Array.isArray(v) ? /** @type {any} */ (v).view : undefined;
  return typeof view === "string" && !CARD_VIEWS.includes(/** @type {any} */ (view)) ? { .../** @type {object} */ (v), view: "none" } : v;
};

/** @param {unknown} v @returns {CardSees} */
function seesOf(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw refused(400, "sees must be an object: { view, running?, changes? }.");
  const s = /** @type {Record<string, unknown>} */ (v);
  for (const k of Object.keys(s)) if (!["view", "running", "changes"].includes(k)) throw refused(400, `unknown field \`sees.${k}\`: what an agent sees has a view, running and changes`);
  if (!CARD_VIEWS.includes(/** @type {any} */ (s.view))) throw refused(400, `sees.view must be one of ${CARD_VIEWS.join(", ")}.`);
  if (s.running !== undefined && typeof s.running !== "boolean") throw refused(400, "sees.running must be true or false: whether it also sees the turn running now.");
  if (s.changes !== undefined && s.changes !== null && !CARD_CHANGES.includes(/** @type {any} */ (s.changes))) throw refused(400, `sees.changes must be one of ${CARD_CHANGES.join(", ")}, or null.`);
  return { view: /** @type {CardSees["view"]} */ (s.view), running: s.running === true, changes: /** @type {CardSees["changes"]} */ (s.changes ?? null) };
}

/**
 * One model as a save names it, checked as a card's `model` is: a model's name on one line, `agent/` dropped — "" for
 * none (null, or empty) — or null where it is no such name. A team's member's own model is checked so too (teams.js).
 * @param {unknown} v @returns {string | null}
 */
export const modelNamed = (v) => {
  const m = v === null ? "" : typeof v === "string" ? v.trim() : null;
  return m === null || /[\r\n]/.test(m) || m.length > MODEL_MAX ? null : m.replace(/^agent\//, "");
};
/** Whether a word has a saved card's tag's shape: 2 to 24 letters, digits and dashes, a letter first. @param {string} t */
export const tagShaped = (t) => TAG_RE.test(t);

/**
 * A card's models, checked: names on one line each, first choice first, none twice — each a name, or a row that says how
 * hard the agent thinks on it (`{ model, effort? }`, the owner's word of 11-05: "model · account · effort"), its effort
 * kept beside the list by the name.
 * @param {unknown} v @returns {{ list: string[], efforts: Record<string, string> }}
 */
function modelsOf(v) {
  const row = (/** @type {any} */ s) => typeof s === "string" || (!!s && typeof s === "object" && !Array.isArray(s) && typeof s.model === "string" && Object.keys(s).every((k) => k === "model" || k === "effort"));
  if (!Array.isArray(v) || !v.every(row))
    throw refused(400, "models must be a list of model names, first choice first: [\"GLM 5.3\", …] — or rows that say how hard it thinks on each, { model, effort }; [] for none: the chat's list, else the main agent's model.");
  /** @type {string[]} */
  const list = [];
  /** @type {Record<string, string>} */
  const efforts = {};
  for (const raw of v) {
    const m = (typeof raw === "string" ? raw : raw.model).trim().replace(/^agent\//, "");
    if (!m) continue;
    if (/[\r\n]/.test(m) || m.length > MODEL_MAX) throw refused(400, "Each of an agent's models is a model's name, on one line.");
    const effort = typeof raw === "string" ? null : raw.effort ?? null;
    if (effort !== null && !SUBAGENT_EFFORTS.includes(effort)) throw refused(400, `Each model's effort is one of ${SUBAGENT_EFFORTS.join(", ")}: how hard the agent thinks on it — or left out, the main agent's.`);
    if (list.some((x) => x.toLowerCase() === m.toLowerCase())) continue;
    list.push(m);
    if (effort) efforts[m] = effort;
  }
  if (list.length > MODELS_MOST) throw refused(400, `An agent names up to ${MODELS_MOST} models, first choice first (this has ${list.length}).`);
  return { list, efforts };
}

/**
 * A card's efforts as the file keeps them, beside its models: a name and a level each, a word that is no level refused;
 * one of a model the card does not name (`models`, where given) is dropped. @param {unknown} v @param {string[]} [models]
 * @returns {Record<string, string>}
 */
function effortsOf(v, models) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw refused(400, "efforts must be a model's name and how hard the agent thinks on it, each: { \"GLM 5.3\": \"high\" }.");
  const all = Object.entries(/** @type {Record<string, any>} */ (v));
  // A word that is no effort is refused, as in a row (the review of 11-05).
  if (all.some(([, e]) => !SUBAGENT_EFFORTS.includes(e))) throw refused(400, `Each model's effort is one of ${SUBAGENT_EFFORTS.join(", ")}: how hard the agent thinks on it — or left out, the main agent's.`);
  return Object.fromEntries(all.filter(([m]) => !models || models.includes(m)).map(([m, e]) => [m, String(e)]));
}

/**
 * A card's efforts as its file keeps them: one whose level is no effort dropped, the rest read as a save reads them —
 * a save refuses it, but a file a hand or another build wrote keeps its card (the review of 11-05). @param {unknown} v
 */
const storedEfforts = (v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, e]) => SUBAGENT_EFFORTS.includes(e))) : v);

/** A card with its model: the first of its models. @template {{ models: string[] }} C @param {C} c @returns {C & { model: string | null }} */
const withModel = (c) => ({ ...c, model: c.models[0] ?? null });

/**
 * A card's commands, checked: a list of commands, each on one line — none twice. What each may be is the launch's
 * check (`runsProblem`). @param {unknown} v @param {(list: readonly string[]) => string | null} runsProblem
 * @returns {string[]}
 */
function runsOf(v, runsProblem) {
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string"))
    throw refused(400, "mayRun must be a list of commands, each as the agent types it: [\"npm test\", …]; [] for none.");
  const list = [...new Set(v.map((s) => s.trim()).filter(Boolean))];
  if (list.some((s) => /[\r\n]/.test(s))) throw refused(400, "Each command the agent runs without asking is one line.");
  const why = runsProblem(list);
  if (why) throw refused(400, `${why}.`);
  return list;
}

/** The tools a card goes without, checked: each one of `CARD_TOOLS`, in their order, once. @param {unknown} v */
function toolsOffOf(v) {
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string"))
    throw refused(400, `toolsOff must be a list of the tools an agent goes without — ${CARD_TOOLS.join(", ")}; [] for none.`);
  const unknown = v.filter((s) => !CARD_TOOLS.includes(/** @type {any} */ (s)));
  if (unknown.length) throw refused(400, `${unknown.map((s) => `\`${s.slice(0, 40)}\``).join(", ")} ${unknown.length === 1 ? "is" : "are"} not among the tools an agent goes without: ${CARD_TOOLS.join(", ")}.`);
  return CARD_TOOLS.filter((t) => v.includes(t));
}

/**
 * The fields of a card a save takes, read and checked, each only when given; `allowed` names any other field the caller
 * reads itself. An unknown field is refused by name.
 * @param {any} input @param {(list: readonly string[]) => string | null} runsProblem @param {string[]} [allowed]
 * `model` is read as a list of one: a card's models are `models`, first choice first.
 * `efforts`, each model's as the file keeps it, rides with its models: models given anew bring their own.
 * @returns {{ tag?: string, name?: string, goodFor?: string, thinks?: string, may?: typeof CARD_MAY[number], models?: string[], efforts?: Record<string, string>, sees?: CardSees, mayRun?: string[], toolsOff?: (typeof CARD_TOOLS[number])[] }}
 */
function fieldsOf(input, runsProblem, allowed = []) {
  for (const k of Object.keys(input || {}))
    if (!["tag", "name", "goodFor", "thinks", "may", "model", "models", "efforts", "sees", "mayRun", "toolsOff", ...allowed].includes(k))
      throw refused(400, `unknown field \`${k}\`: an agent has a tag, a name, goodFor, thinks, may, models, sees, mayRun and toolsOff`);
  /** @type {ReturnType<typeof fieldsOf>} */
  const out = {};
  if (input.tag !== undefined) out.tag = tagOf(input.tag);
  if (input.name !== undefined) out.name = lineOf(input.name, "a name", NAME_MAX);
  if (input.goodFor !== undefined) out.goodFor = lineOf(input.goodFor, 'a "good for" line', GOOD_FOR_MAX);
  if (input.thinks !== undefined) {
    if (typeof input.thinks !== "string") throw refused(400, `How an agent thinks is text: up to ${count(THINKS_MAX)} characters.`);
    const t = input.thinks.trim();
    if (t.length > THINKS_MAX) throw refused(400, `How an agent thinks is up to ${count(THINKS_MAX)} characters (this has ${count(t.length)}).`);
    out.thinks = t;
  }
  if (input.may !== undefined) {
    if (!CARD_MAY.includes(input.may)) throw refused(400, `may must be one of ${CARD_MAY.join(", ")}: read only, run in its own copy with nothing kept, or edit in its own copy.`);
    out.may = input.may;
  }
  if (input.model !== undefined && input.models !== undefined) throw refused(400, "Give an agent's models (first choice first) or one model, not both.");
  if (input.model !== undefined) {
    const m = modelNamed(input.model);
    if (m === null) throw refused(400, "model must be a model's name on one line, or null for the session's own.");
    ({ list: out.models, efforts: out.efforts } = modelsOf(m ? [m] : []));
  }
  if (input.models !== undefined) ({ list: out.models, efforts: out.efforts } = modelsOf(input.models));
  if (input.efforts !== undefined) out.efforts = { ...out.efforts, ...effortsOf(input.efforts, out.models) };
  if (input.sees !== undefined) out.sees = seesOf(input.sees);
  if (input.mayRun !== undefined) out.mayRun = runsOf(input.mayRun, runsProblem);
  if (input.toolsOff !== undefined) out.toolsOff = toolsOffOf(input.toolsOff);
  return out;
}

/** A copy nobody can change the store through. @param {AgentCard} c @returns {AgentCard} */
const copyOf = (c) => ({ ...c, models: [...c.models], efforts: { ...(c.efforts || {}) }, sees: { ...c.sees }, mayRun: [...c.mayRun], toolsOff: [...(c.toolsOff || [])], ...(c.set ? { set: [...c.set] } : {}), ...(c.ships ? { ships: structuredClone(c.ships) } : {}), ...(c.moved ? { moved: [...c.moved] } : {}) });

/**
 * What a card must be as a whole, past each field's own check: one that only reads runs no commands of its own — it
 * has no copy to run them in. Where it is listed asks nothing of it (U13-D1).
 * @param {{ name: string, may: string, mayRun: readonly string[] }} c
 */
function whole(c) {
  if (c.may === "read" && c.mayRun.length)
    throw refused(400, `${c.name} only reads, so it runs no commands of its own: they run in its own copy of the project. Let it run in its own copy, or leave its commands out.`);
}

/**
 * @param {{ dataDir: string | null, log?: (level: string, msg: string) => void, now?: () => number,
 *   usedBy?: (tag: string) => string | null, runsProblem?: (list: readonly string[]) => string | null,
 *   teamNamed?: (name: string) => string | null, teamKeyed?: (tag: string) => string | null, memberNamed?: (tag: string) => string | null,
 *   plugins?: () => AgentCard[] }} o
 *   `usedBy`: why a card cannot go, in words — a team it leads or is a member of — or null.
 *   `runsProblem`: why a card's commands cannot be saved, in words, or null (grants.js `cardRunsProblem`)
 *   `teamNamed`: the team a name is already, as it is called, or null — an agent and a team never share a name (OA1);
 *   `teamKeyed`: the team whose key a tag is, as it is called, or null — `@` names either, so they never meet;
 *   `memberNamed`: the team one of whose members a tag is the name of (teams.js `memberId`), as it is called, or null —
 *   its lead names a member and a card alike;
 *   `plugins`: the agents the plugins installed bring (HarnessV4_SpacesPlugins_Plan B3), each `<plugin>:<name>`, after
 *   yours — read, never saved here
 */
export function createAgentCardStore({ dataDir, log = () => {}, now = () => Date.now(), usedBy = () => null, runsProblem = () => null, teamNamed = () => null, teamKeyed = () => null, memberNamed = () => null, plugins = () => [] }) {
  const file = dataDir ? join(dataDir, AGENT_CARDS_FILE) : null;
  /** @type {AgentCard[]} */
  const shipped = Object.keys(SHIPPED_CARDS).map((tag) => /** @type {AgentCard} */ (shippedCard(tag)));
  /** Your cards by tag. @type {Map<string, AgentCard>} */
  let saved = new Map();
  /** What of each shipped card is set in place, by tag. @type {Map<string, ShippedSet>} */
  let over = new Map();
  /**
   * Your cards the file holds that cannot be used now — one under a tag a shipped card holds, say, or one a save would
   * refuse — by tag: each written back as it was saved at every save, until you delete it or save a card under its tag.
   * Nothing reads one as another card. @type {Map<string, { raw: unknown, name: string, why: string }>}
   */
  let kept = new Map();
  /**
   * Why a card the file holds cannot be used now, in words that say what to do. @param {string} tag @param {unknown} c
   * @param {unknown} e  what reading it threw
   */
  const keptWhy = (tag, c, e) => {
    if (Object.hasOwn(SHIPPED_CARDS, tag)) return `${SHIPPED_CARDS[/** @type {keyof typeof SHIPPED_CARDS} */ (tag)].name} ships under \`@${tag}\` now: make your card again under another tag`;
    if (cardTag(tag) !== tag) return `\`${tag}\` is no agent's tag: make your card again under one — 2 to 24 letters, digits and dashes, starting with a letter`;
    if (!c || typeof c !== "object" || Array.isArray(c)) return "it is no agent's card";
    return String(/** @type {any} */ (e)?.message || e).replace(/\.$/, "");
  };
  /**
   * A kept card's fields as an editor opens them for a card made again from it: each as saved where a save takes it,
   * else as a new card has it. @param {unknown} raw
   */
  const keptFields = (raw) => {
    const o = /** @type {Record<string, any>} */ (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {});
    /** @param {string} k @param {unknown} v @param {any} or */
    const read = (k, v, or) => {
      try {
        return /** @type {Record<string, any>} */ (fieldsOf({ [k]: v }, runsProblem))[k] ?? or;
      } catch {
        return or;
      }
    };
    return {
      name: read("name", o.name, ""),
      goodFor: read("goodFor", o.goodFor, ""),
      thinks: read("thinks", o.thinks ?? "", ""),
      may: read("may", o.may ?? "read", "read"),
      models: read("models", Array.isArray(o.models) ? o.models : o.model ? [o.model] : [], []),
      efforts: read("efforts", storedEfforts(o.efforts ?? {}), {}),
      sees: read("sees", storedSees(o.sees), { ...APART_SEES }),
      mayRun: read("mayRun", o.mayRun ?? [], []),
      toolsOff: read("toolsOff", o.toolsOff ?? [], []),
    };
  };
  /** The kept cards but `tag`. @param {string} tag */
  const keptBut = (tag) => new Map([...kept].filter(([t]) => t !== tag));

  /** A shipped card as it stands: as it ships, with what is set in place on top. @param {AgentCard} c @returns {AgentCard} */
  const asSet = (c) => {
    const o = over.get(c.tag);
    return o ? dressed(c, o) : c;
  };
  /** The plugins' agents, each with a plugin's tag; none where they cannot be read. @returns {AgentCard[]} */
  const brought = () => {
    try {
      return plugins().filter((c) => !!c.plugin && PLUGIN_TAG_RE.test(c.tag));
    } catch (/** @type {any} */ e) {
      log("warn", `agents: the plugins' agents could not be read (${e?.message || e})`);
      return [];
    }
  };
  /** Every card: the shipped ones in their order, then yours by name, then the plugins'. */
  const all = () => [...shipped.map(asSet), ...[...saved.values()].sort((a, b) => a.name.localeCompare(b.name)), ...brought()];
  /** @param {string} tag */
  const byTag = (tag) => all().find((c) => c.tag === tag) || null;
  /** @param {AgentCard} c */
  const taken = (c) => refused(400, `\`@${c.tag}\` is taken by ${c.name}${c.shipped ? " (shipped)" : ""} — pick another tag.`);
  /** A name a team has already: refused, since an agent and a team never share one (OA1). @param {string} name */
  const teamsName = (name) => {
    const team = teamNamed(name);
    if (team) throw refused(400, `A team is called ${team}: an agent and a team never share a name — pick another.`);
  };

  if (file)
    try {
      // One of another build's version is set aside first, never saved over (r-itself, 11-12; services/store-files.js).
      const raw = readStoreFile(file, STORE_FILES.agents, (level, msg) => log(level, `agents: ${msg}`), { now });
      if (raw?.version !== 1) throw new Error("it is not a version 1 agents file");
      const agents = raw.agents && typeof raw.agents === "object" && !Array.isArray(raw.agents) ? raw.agents : {};
      /** @type {string[]} */
      const skipped = [];
      for (const [tag, c] of Object.entries(agents))
        try {
          if (cardTag(tag) !== tag || !c || typeof c !== "object" || byTag(tag)) throw new Error(tag);
          const f = fieldsOf({ tag, name: c.name, goodFor: c.goodFor, thinks: c.thinks ?? "", may: c.may ?? "read", models: Array.isArray(c.models) ? c.models : c.model ? [c.model] : [], efforts: storedEfforts(c.efforts ?? {}), sees: storedSees(c.sees), mayRun: c.mayRun ?? [], toolsOff: c.toolsOff ?? [] }, runsProblem);
          whole({ name: String(f.name), may: String(f.may), mayRun: f.mayRun ?? [] });
          saved.set(tag, withModel({
            tag,
            name: /** @type {string} */ (f.name),
            partOf: null,
            goodFor: /** @type {string} */ (f.goodFor),
            thinks: /** @type {string} */ (f.thinks),
            may: /** @type {typeof CARD_MAY[number]} */ (f.may),
            models: f.models ?? [],
            efforts: f.efforts ?? {},
            sees: /** @type {CardSees} */ (f.sees),
            mayRun: f.mayRun ?? [],
            toolsOff: f.toolsOff ?? [],
            shipped: false,
            from: typeof c.from === "string" ? c.from : null,
            createdAt: Number(c.createdAt) || 0,
            updatedAt: Number(c.updatedAt) || 0,
          }));
        } catch (e) {
          kept.set(tag, { raw: c, name: typeof c?.name === "string" && c.name.trim() ? c.name.trim().slice(0, NAME_MAX) : tag, why: keptWhy(tag, c, e) });
        }
      // What is set in place on the shipped cards: each field read as a save checks it — one that fails is skipped and
      // named, the rest kept (SA1 case 18) — then the card as a whole: a level its commands do not fit is put back, with
      // them. A start set in place is read as none: agents no longer start by themselves (the owner's word of 11-05).
      const sets = raw.shipped && typeof raw.shipped === "object" && !Array.isArray(raw.shipped) ? raw.shipped : {};
      for (const [tag, o] of Object.entries(sets)) {
        // The two that started by themselves went with that way of starting: what was set on them goes unsaid.
        if (tag === "explainer" || tag === "watcher") continue;
        if (!Object.hasOwn(SHIPPED_CARDS, tag) || !o || typeof o !== "object" || Array.isArray(o)) {
          skipped.push(`${tag} (set in place)`);
          continue;
        }
        const base = /** @type {AgentCard} */ (shippedCard(tag));
        /** @type {ShippedSet} */
        const cur = {};
        /** @type {string[]} */
        const bad = [];
        for (const [k, v] of Object.entries(o)) {
          if (k === "was" || k === "starts") continue;
          try {
            if (!SHIPPED_SETS.includes(/** @type {any} */ (k))) throw new Error(k);
            const val = /** @type {any} */ (fieldsOf({ [k]: k === "sees" ? storedSees(v) : k === "efforts" ? storedEfforts(v) : v }, runsProblem))[k];
            if (!same(val, /** @type {any} */ (base)[k])) cur[/** @type {typeof SHIPPED_SETS[number]} */ (k)] = val;
          } catch {
            bad.push(k);
          }
        }
        try {
          whole(dressed(base, cur));
        } catch {
          for (const k of /** @type {const} */ (["may", "mayRun"]))
            if (cur[k] !== undefined) {
              delete cur[k];
              bad.push(k);
            }
        }
        const was = o.was && typeof o.was === "object" && !Array.isArray(o.was) ? o.was : {};
        cur.was = Object.fromEntries(Object.entries(was).filter(([k, h]) => cur[/** @type {typeof SHIPPED_SETS[number]} */ (k)] !== undefined && typeof h === "string"));
        if (bad.length) skipped.push(`${tag} (set in place: ${bad.join(", ")})`);
        if (SHIPPED_SETS.some((k) => cur[k] !== undefined)) over.set(tag, cur);
      }
      if (kept.size)
        log("warn", `agents: ${kept.size === 1 ? "an agent" : `${kept.size} agents`} of yours in ${AGENT_CARDS_FILE} cannot be used now, kept as saved until you delete ${kept.size === 1 ? "it" : "them"} or make ${kept.size === 1 ? "it" : "them"} again — Library › Agents says why: ${[...kept.keys()].join(", ")}`);
      if (skipped.length)
        log("warn", `agents: ${skipped.length} agent${skipped.length === 1 ? "" : "s"} in ${AGENT_CARDS_FILE} could not be read and ${skipped.length === 1 ? "was" : "were"} skipped: ${skipped.join(", ")}`);
    } catch (/** @type {any} */ e) {
      saved = new Map();
      over = new Map();
      kept = new Map();
      if (e?.code !== "ENOENT") log("warn", `agents: ${AGENT_CARDS_FILE} could not be read (${e.message}); starting with no saved agents`);
    }

  /**
   * Write `next` as the file, with what is set on the shipped cards (`sets`) and your cards kept as saved (`nextKept`),
   * then make them the store's: a save the disk refuses changes nothing.
   * @param {Map<string, AgentCard>} next @param {Map<string, ShippedSet>} [sets] @param {typeof kept} [nextKept]
   */
  const commit = (next, sets = over, nextKept = kept) => {
    if (file) {
      mkdirSync(join(file, ".."), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      // A card of yours is part of no team (OA-D4): the file holds nothing the store adds itself, and the tools it goes
      // without only where it goes without one. A card kept goes back as it was read.
      const agents = Object.fromEntries([
        ...[...nextKept].map(([tag, k]) => [tag, k.raw]),
        ...[...next.values()].map(({ tag, shipped: _s, set: _set, partOf: _p, toolsOff, efforts, ...c }) => [tag, { ...c, ...(efforts && Object.keys(efforts).length ? { efforts } : {}), ...(toolsOff?.length ? { toolsOff } : {}) }]),
      ]);
      try {
        writeFileSync(tmp, JSON.stringify({ version: 1, agents, ...(sets.size ? { shipped: Object.fromEntries(sets) } : {}) }, null, 2));
        renameSync(tmp, file);
      } catch (e) {
        rmSync(tmp, { force: true });
        throw e;
      }
    }
    saved = next;
    over = sets;
    kept = nextKept;
  };
  /** A saved card by tag, or the refusal: a shipped one cannot be `verb`, and an unknown one is not there. @param {string} tag @param {string} verb */
  const yours = (tag, verb) => {
    const t = String(tag ?? "");
    if (Object.hasOwn(SHIPPED_CARDS, t)) throw refused(403, `\`@${t}\` is a shipped agent: it cannot be ${verb}.`);
    const from = PLUGIN_TAG_RE.test(t) ? brought().find((x) => x.tag === t) : null;
    if (from) throw refused(403, `\`@${t}\` comes with the plugin ${from.plugin}: it cannot be ${verb} here — make a copy of it to change it, or uninstall its plugin.`);
    const c = saved.get(t);
    if (!c) throw refused(404, `There is no agent \`@${t}\`.`);
    return c;
  };
  /**
   * Set a shipped card's fields in place (SA1): every one but its tag, each only when given. A field given null is put
   * back as it ships (`model: null` its models), and `reset: true` puts back every one first; a field set to what the
   * card ships with is as it ships. A field set anew keeps the hash of what the card ships as now (`was`): Filament's
   * later words for it are then told apart. A card with nothing of its own left drops out of the file. Checked as a whole
   * as yours are, and its name never a team's. @param {string} tag @param {any} input
   */
  const setShipped = (tag, input) => {
    const base = /** @type {AgentCard} */ (shippedCard(tag));
    const { reset, ...given } = input;
    if (reset !== undefined && reset !== true) throw refused(400, "reset is true, or left out: true puts every field back as the agent ships.");
    // Its models put back as it ships take their efforts with them.
    const back = Object.keys(given).filter((k) => given[k] === null).flatMap((k) => (k === "model" || k === "models" ? ["models", "efforts"] : [k]));
    for (const k of back)
      if (!SHIPPED_SETS.includes(/** @type {any} */ (k))) throw refused(400, k === "tag" ? `An agent's tag does not change (\`@${tag}\`).` : `unknown field \`${k}\`: an agent has a tag, a name, goodFor, thinks, may, models, sees, mayRun and toolsOff`);
    const f = /** @type {Record<string, any>} */ (fieldsOf(Object.fromEntries(Object.entries(given).filter(([, v]) => v !== null)), runsProblem));
    if (f.tag !== undefined && f.tag !== tag) throw refused(400, `An agent's tag does not change (\`@${tag}\`): make a copy under the new tag.`);
    const was0 = reset ? {} : over.get(tag) || {};
    /** @type {ShippedSet} */
    const cur = Object.fromEntries(SHIPPED_SETS.filter((k) => was0[k] !== undefined && !back.includes(k)).map((k) => [k, was0[k]]));
    /** @type {Record<string, string>} */
    const was = Object.fromEntries(Object.entries(was0.was || {}).filter(([k]) => cur[/** @type {typeof SHIPPED_SETS[number]} */ (k)] !== undefined));
    for (const k of SHIPPED_SETS) {
      if (f[k] === undefined) continue;
      if (same(f[k], /** @type {any} */ (base)[k])) {
        delete cur[k];
        delete was[k];
      } else {
        if (!same(f[k], cur[k])) was[k] = hashOf(/** @type {any} */ (base)[k]);
        cur[k] = f[k];
      }
    }
    for (const k of SHIPPED_SETS) if (cur[k] !== undefined) was[k] ??= hashOf(/** @type {any} */ (base)[k]);
    const card = dressed(base, cur);
    if (cur.name !== undefined && f.name !== undefined && f.name.toLowerCase() !== String(byTag(tag)?.name).toLowerCase()) teamsName(f.name);
    whole(card);
    const next = new Map(over);
    if (SHIPPED_SETS.some((k) => cur[k] !== undefined)) next.set(tag, { ...cur, was });
    else next.delete(tag);
    commit(saved, next);
    return copyOf(/** @type {AgentCard} */ (byTag(tag)));
  };
  /** The card a text names by its tag, a leading `@` or capitals aside. @param {unknown} text @returns {AgentCard | null} */
  const find = (text) => {
    const t = cardTag(text);
    const c = t ? byTag(t) : null;
    return c ? copyOf(c) : null;
  };

  return {
    /** Every card: the shipped ones in their order, then yours by name. */
    list: () => all().map(copyOf),
    find,
    /**
     * A card's place: the shipped card it is, or was copied from, however many copies back — what makes a copy of
     * Reviewer a team's reviewer (HarnessV4_Tasks E15 step 6, AG-172). Null for a card written from nothing.
     * @param {unknown} tag @returns {string | null}
     */
    place(tag) {
      /** @type {Set<string>} */
      const seen = new Set();
      for (let c = byTag(String(cardTag(tag) ?? "")); c && !seen.has(c.tag); c = c.from ? byTag(c.from) : null) {
        if (c.shipped) return c.tag;
        seen.add(c.tag);
      }
      return null;
    },
    /**
     * Save a new card, or a copy of one (`from`, a card's tag): the source's fields under the new tag, with what the
     * input says on top. A copy needs its own tag: a tag is what you type, so Filament invents none.
     * @param {any} input
     */
    create(input) {
      const f = fieldsOf(input || {}, runsProblem, ["from"]);
      const src = input?.from !== undefined ? find(input.from) : null;
      if (input?.from !== undefined && !src) throw refused(404, `There is no agent \`${String(input.from)}\` to copy.`);
      if (!f.tag) throw refused(400, src ? `A copy of ${src.name} needs a tag of its own: what you will type after @.` : "An agent needs a tag: what you type after @ — 2 to 24 letters, digits and dashes, starting with a letter.");
      const other = byTag(f.tag);
      if (other) throw taken(other);
      // A tag a team's key is already: `@` would name both (the bug round of 10-23).
      const team = teamKeyed(f.tag);
      if (team) throw refused(400, `\`@${f.tag}\` is the ${team} team's: an agent's tag and a team's key never meet, since @ names either — pick another tag.`);
      // A tag a team's member answers to by its name already: its lead would name two agents by one word.
      const seat = memberNamed(f.tag);
      if (seat) throw refused(400, `\`${f.tag}\` is what the ${seat} team calls one of its workers: an agent's tag and a worker's name never meet, since its lead names either so — pick another tag.`);
      const name = f.name ?? src?.name;
      if (!name) throw refused(400, `An agent needs a name: up to ${NAME_MAX} characters, on one line.`);
      teamsName(name);
      const goodFor = f.goodFor ?? src?.goodFor;
      if (!goodFor) throw refused(400, `An agent needs a "good for" line: what to ask it, in up to ${GOOD_FOR_MAX} characters.`);
      const at = now();
      /** @type {AgentCard} */
      const card = {
        tag: f.tag,
        name,
        partOf: null,
        goodFor,
        // A plugin's agent may think in more words than a card you save keeps: its copy keeps what a card holds.
        thinks: f.thinks ?? (src?.plugin ? src.thinks.slice(0, THINKS_MAX) : src?.thinks) ?? "",
        may: f.may ?? src?.may ?? "read",
        models: f.models ?? (src ? [...src.models] : []),
        model: null,
        efforts: f.efforts ?? (src ? { ...(src.efforts || {}) } : {}),
        sees: f.sees ?? (src ? { ...src.sees } : { ...APART_SEES }),
        mayRun: f.mayRun ?? (src ? [...src.mayRun] : []),
        toolsOff: f.toolsOff ?? (src ? [...src.toolsOff] : []),
        shipped: false,
        from: src ? src.tag : null,
        createdAt: at,
        updatedAt: at,
      };
      card.model = card.models[0] ?? null;
      whole(card);
      // A card kept under its tag gives way to it.
      commit(new Map([...saved, [card.tag, card]]), over, keptBut(card.tag));
      return copyOf(card);
    },
    /**
     * Edit a card you saved: each field only when given. Its tag stays — records name it so.
     * @param {string} tag @param {any} input
     */
    update(tag, input) {
      if (Object.hasOwn(SHIPPED_CARDS, String(tag ?? ""))) return setShipped(String(tag), input || {});
      const cur = yours(tag, "edited");
      const f = fieldsOf(input || {}, runsProblem);
      if (f.tag !== undefined && f.tag !== cur.tag) throw refused(400, `An agent's tag does not change (\`@${cur.tag}\`): make a copy under the new tag, and delete this one.`);
      const { tag: _t, ...rest } = f;
      // Efforts given alone hold for the models the card names.
      if (rest.efforts && !rest.models) rest.efforts = Object.fromEntries(Object.entries(rest.efforts).filter(([m]) => cur.models.includes(m)));
      if (f.name !== undefined && f.name.toLowerCase() !== cur.name.toLowerCase()) teamsName(f.name);
      /** @type {AgentCard} */
      const card = withModel({ ...cur, ...rest, updatedAt: now() });
      whole(card);
      commit(new Map([...saved, [card.tag, card]]));
      return copyOf(card);
    },
    /**
     * Delete a card you saved, or one of yours kept as saved (`held`) — under a shipped card's tag too, where the file
     * kept one of yours; the shipped ones stay. @param {string} tag
     * @returns {AgentCard | { tag: string, name: string, kept: true }}
     */
    remove(tag) {
      const k = String(tag ?? "");
      const h = kept.get(k);
      if (h) {
        commit(saved, over, keptBut(k));
        return { tag: k, name: h.name, kept: true };
      }
      const cur = yours(tag, "deleted");
      const held = usedBy(cur.tag);
      if (held) throw refused(400, `${held}.`);
      commit(new Map([...saved].filter(([t]) => t !== cur.tag)));
      return copyOf(cur);
    },
    /**
     * Your cards the file holds that cannot be used now, each with why and its fields as an editor opens them to make it
     * again (`card`): kept until you delete one or save a card under its tag.
     */
    held: () => [...kept].map(([tag, h]) => ({ tag, name: h.name, why: h.why, card: keptFields(h.raw) })),
  };
}
