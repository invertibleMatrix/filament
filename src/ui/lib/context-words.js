// @ts-check
// How earlier turns reach the model, in one set of words (HarnessV4_Tasks U3, UX-4): the page's copy of
// src/core/context-words.js, which the server's replies and settings descriptions speak — the layers keep the page
// and the server apart, so each has its own, and test/context-words.test.js holds the two equal. Stored values and
// setting keys stay as they are; only what is said changes.

/** @typedef {{ readonly id: string, readonly name: string, readonly line: string }} Named */

/** A count as a knob gives it: a whole number from 0, else the fallback. @param {unknown} v @param {number} d */
const count = (v, d) => (v == null || v === "" || !Number.isFinite(Number(v)) ? d : Math.max(0, Math.round(Number(v))));

/**
 * Compaction's methods (`context.compaction.method`): one summary, by the same model or a side model
 * (`context.compaction.writer`), or an instant fold. `verb` heads a sentence ("Folds at 85%"); `name` is the method's
 * own, its number left out (`methodName` puts it in).
 */
export const METHODS = Object.freeze([
  Object.freeze({ id: "summary", name: "One summary", verb: "Summarizes", line: "Every finished turn since the last summary becomes one summary." }),
  Object.freeze({ id: "fold", name: "Instant fold", verb: "Folds", line: "Finished turns fold to your words, one line per tool call, and the reply. No model call." }),
]);
/** A method's words by id; any other value reads as the default's, one summary. @param {string | null | undefined} id */
export const methodOf = (id) => METHODS.find((x) => x.id === id) || METHODS[0];

/** What a method's number falls back on: the shipped `keepWhole`. */
export const NAME_DEFAULTS = Object.freeze({ keepWhole: 1 });

/**
 * A method's name with its number, from the session's knobs: "Instant fold, newest 1 whole"
 * (`context.compaction.keepWhole`), "One summary". A knob not given takes its default.
 * @param {string | null | undefined} id
 * @param {{ keepWhole?: number | null }} [knobs]
 */
export function methodName(id, knobs = {}) {
  const keep = count(knobs.keepWhole, NAME_DEFAULTS.keepWhole);
  if (id === "fold") return keep ? `Instant fold, newest ${keep} whole` : "Instant fold";
  return "One summary";
}

/**
 * The ways a coding agent's session makes room (`context.compaction.agent`). `{agent}` in a name is the agent's own:
 * "Claude Code's own compaction".
 * @type {readonly Named[]}
 */
export const WAYS = Object.freeze([
  Object.freeze({ id: "suggested", name: "Suggested", line: "Its own compaction where it has one; else it writes a summary while its cache is warm; else Filament's copy." }),
  Object.freeze({ id: "own", name: "{agent}'s own compaction", line: "It compacts its live session itself, as its /compact does." }),
  Object.freeze({ id: "self", name: "{agent} writes a summary", line: "Filament's summary, from its warm session, read-only; it starts fresh from it." }),
  Object.freeze({ id: "ours", name: "Filament's copy", line: "Filament's methods on its own copy; the agent starts fresh from what they leave." }),
]);

/** A way's name, with the agent's. @param {string | null | undefined} id @param {string} [agent] */
export function wayName(id, agent = "The agent") {
  const w = WAYS.find((x) => x.id === id) || WAYS[0];
  return w.name.replace("{agent}", agent);
}

/**
 * The ways to make room as the card names them: the three kinds of compaction (the owner's rules of 10-31) — the same
 * model or a side model writes one summary, or an instant fold calls none — and a coding agent's own. `{agent}` is the
 * coding agent's name. `main`: one of the card's first ways; the rest wait under More ways.
 */
export const ROOM_WORDS = Object.freeze({
  "way:own": Object.freeze({ name: "{agent} makes room its own way", line: "It compacts its own session, as its /compact does.", main: true }),
  "way:self": Object.freeze({ name: "{agent} writes the summary", line: "It summarizes from its warm session, read-only, then starts fresh from the summary.", main: false }),
  same: Object.freeze({ name: "Same model", line: "The chat's own model writes one summary of everything, from its warm cache while it lasts.", main: true }),
  side: Object.freeze({ name: "Side model", line: "A side model writes one summary of everything; turns too big for it whole go with their tool calls folded.", main: true }),
  fold: Object.freeze({ name: "Instant fold", line: "Your words and the answers stay; each tool call becomes one line. No summary, no model call.", main: true }),
});

/**
 * A way's name and line as the card says them, the agent's name in them; null for an id with no words.
 * @param {string} id @param {{ agent?: string }} [o]
 * @returns {{ name: string, line: string, main: boolean } | null}
 */
export function roomWords(id, o = {}) {
  const w = Object.prototype.hasOwnProperty.call(ROOM_WORDS, id) ? ROOM_WORDS[/** @type {keyof typeof ROOM_WORDS} */ (id)] : null;
  if (!w) return null;
  const fill = (/** @type {string} */ s) => s.replace(/\{agent\}/g, o.agent || "The agent");
  return { name: fill(w.name), line: fill(w.line), main: w.main };
}

/**
 * What a sub-agent sees of the session, as its launch asks — nothing unless it asks — in the order they grow. Each
 * starts at the session's last compaction, its summary first — what the main agent's window holds — and says so (the
 * owner's words of 10-19); the context window holds the turn running now too, from its own last compaction to its
 * newest round.
 * @type {readonly Named[]}
 */
export const SUBAGENT_VIEW_WORDS = Object.freeze([
  Object.freeze({ id: "none", name: "Nothing", line: "the task alone" }),
  Object.freeze({ id: "folded", name: "Folded", line: "since the last compaction: each turn folded to your words, one line per tool call, and the reply" }),
  Object.freeze({ id: "window", name: "Context window", line: "what the main agent holds now: since its last compaction, this turn to its newest round" }),
  Object.freeze({ id: "fork", name: "A live copy", line: "a copy of the main agent, this turn included" }),
]);

/** What a fork carries of the transcript (`fork.transcript`). @type {readonly Named[]} */
export const FORK_TRANSCRIPT_WORDS = Object.freeze([
  Object.freeze({ id: "ditto", name: "As it was", line: "every inherited turn keeps the form it has here" }),
  Object.freeze({ id: "folds", name: "Folded", line: "every inherited turn folded to one line per tool call" }),
  Object.freeze({ id: "brief", name: "One summary", line: "one summary of everything so far; the turns stay in the archive" }),
]);

/** The one label of the control in the flows that carry a chat (UX-12): a fork and a fresh coding-agent session's start. */
export const CARRY_LABEL = "Carry earlier turns as";

/** What a fresh coding-agent session carries of the earlier turns (`context.carry`). @type {readonly Named[]} */
export const CARRY_WORDS = Object.freeze([
  Object.freeze({ id: "words", name: "Words", line: "your words and the agent's, each turn's tool calls counted in one line" }),
  Object.freeze({ id: "fold", name: "Folded", line: "every turn folded to your words, one line per tool call, and the reply" }),
  Object.freeze({ id: "fold+2", name: "Folded, newest 2 whole", line: "folded, the last two turns whole" }),
  Object.freeze({ id: "plain", name: "Whole", line: "every finished turn as it was sent, tool output as text" }),
]);

/** The forms a finished turn takes (app/sessions/shapes.js). @type {readonly Named[]} */
export const FORMS = Object.freeze([
  Object.freeze({ id: "raw", name: "Whole", line: "the whole turn goes to the model exactly as it happened" }),
  Object.freeze({ id: "fold", name: "Folded", line: "your message and the answer stay; the work between becomes one line per tool call" }),
]);

/** A name from one of the tables, or the id as it is. @param {readonly Named[]} table @param {string | null | undefined} id */
export const nameIn = (table, id) => table.find((x) => x.id === id)?.name ?? String(id ?? "");
