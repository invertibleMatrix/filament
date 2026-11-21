// @ts-check
// A team's Brief, in words (team_v2_plan §10 O1, the mock of 10-19): the two ways a team works with a chat — On the side,
// its own chat next to this one, its result to you; In charge, its lead in your agent's seat — the teams as squads (a
// lead with a crown, its workers as portraits, each in its role's tone), grouped They look and check / They build, what
// a lead reads before Send and how it fits its window, where each model comes from — no count of its own: each
// model's limit, set on its row under its provider, holds (the owner's word of 11-05) —, and the Brief as one box (the
// rework of 11-11): its one line of what Send does with nothing changed, what its Options hold, and why they open by
// themselves. Pure: views/brief.js and views/teams-home.js draw what these say; tested in test/brief.test.js.
import { prettyModel } from "./families.js";
import { memberIcon, readsOnly, readsOnlyAhead, teamIcon, teamTone } from "./team.js";

/** In charge, in a line's first words: who answers the chat. */
const TAKES = "Its lead takes your agent's place in this chat";
/** The two ways, as the Brief and the Teams tab say them. */
export const WAYS = Object.freeze({
  side: {
    label: "On the side",
    line: "Your agent keeps working, untouched. The team works in a chat of its own; its result comes to you.",
    short: "Your agent keeps working. The team works next to it, in a chat of its own.",
  },
  charge: {
    label: "In charge",
    line: `${TAKES} and answers your messages from now on.`,
    short: "The team's lead takes your agent's place in this chat. You talk to the lead from now on.",
  },
});
/** @typedef {keyof typeof WAYS} Way */

/** In charge, when its lead hears you: the end of what Options says goes out at once. */
const HEARS = "your messages reach its lead at its next step";
/**
 * In charge, in a team's words (d-side, 11-12): its way card's line (`line`), the same for a tip (`short`), and under
 * Options what goes out at once (`orders`) and the note under it (`note`). A team that changes no file (lib/team.js
 * `readsOnly`) says before Send what the server will hold it to — the sentence is lib/team.js's — and that it applies
 * nothing and brings no change; any other team says what In charge always said, one of yours whose workers all only
 * read too: nothing holds its lead.
 * @param {{ name?: string, readOnly?: boolean } | null | undefined} t  the team's row
 * @returns {{ line: string, short: string, orders: string, note: string }}
 */
export function chargeWords(t) {
  if (!readsOnly(t)) return { line: WAYS.charge.line, short: WAYS.charge.short, orders: `its launches, its messages to its workers and its applies — ${HEARS}`, note: "It brings changes into your folder; it commits nothing." };
  const line = readsOnlyAhead(String(t?.name || "The team"), TAKES);
  return { line, short: line, orders: `its launches and its messages to its workers — ${HEARS}`, note: "It changes no file: its lead and its workers only read here." };
}

/** The card that leads a hunt: BugHunters' own Lead, which a copy of the team keeps (core/hunt-range.js). */
const HUNT_LEAD = "huntlead";
/** Whether a team hunts, and so takes a range on the side (the plan's p6). @param {any} t */
export const huntsIn = (t) => t?.lead?.tag === HUNT_LEAD;
/** A hunt's range as the Brief asks for it, in plain words (the plan's p6): its field's hint, and the line under it. */
export const RANGE_WORDS = Object.freeze({
  hint: "Empty: what's uncommitted and what this chat changed",
  line: "Or a diff since a ref (since main), commits (main..HEAD), or files and folders by commas. Its lead gets their list, each file with the lines changed, and splits the hunt by them.",
});

/** What a few presses add to the words, to narrow a team's look (each one sentence, added once). */
export const NARROW = Object.freeze([
  { id: "since", label: "since my last message", words: "Look only at what happened since my last message." },
  { id: "newest", label: "the newest turn's changes", words: "Look only at the files the newest turn changed." },
  { id: "changes", label: "files with changes", words: "Look only at the files with uncommitted changes (git status)." },
]);

/**
 * The words with a narrowing added, or taken out where it is there already.
 * @param {string} ask @param {string} id
 */
export function narrowed(ask, id) {
  const n = NARROW.find((x) => x.id === id);
  if (!n) return ask;
  const text = String(ask || "");
  if (text.includes(n.words)) return text.replace(n.words, "").replace(/[ \t]+\n/g, "\n").replace(/\s+$/, "").replace(/^\s+/, "");
  return text.trim() ? `${text.trimEnd()} ${n.words}` : n.words;
}

/** Each role's look: its glyph and tone. A shipped worker's place wears its own, and a seat its card's. */
const ROLE_TONES = Object.freeze({ search: "cyan", hammer: "orange", eye: "blue" });

/**
 * A member's portrait: its glyph and tone, by its card's place — a seat the team names wears its card's.
 * @param {{ tag?: string, card?: string, may?: string, place?: string | null }} m @returns {{ icon: string, tone: string }}
 */
export function memberLook(m) {
  const icon = memberIcon(m);
  return { icon, tone: Object.hasOwn(ROLE_TONES, icon) ? ROLE_TONES[/** @type {keyof typeof ROLE_TONES} */ (icon)] : "gray" };
}

/** A team's lead portrait: the team's glyph and tone. @param {string} key */
export const leadLook = (key) => ({ icon: teamIcon(key), tone: teamTone(key) });

/**
 * Whether a team changes files: read-only, or every member only reads, is a team that looks and checks.
 * @param {{ readOnly?: boolean, members?: { may?: string }[] }} t
 */
export const changesFiles = (t) => !t?.readOnly && (t?.members || []).some((m) => m?.may && m.may !== "read");

/**
 * The teams in two groups: They look and check (change no file — usually on the side), They build (change files, each
 * worker in its own copy — usually in charge). Each keeps its order.
 * @template {{ readOnly?: boolean, members?: { may?: string }[] }} T @param {readonly T[]} teams
 */
export function groupsOf(teams) {
  return { look: teams.filter((t) => !changesFiles(t)), build: teams.filter((t) => changesFiles(t)) };
}

/** The way a team is usually used: the one the Brief opens on for it. @param {{ readOnly?: boolean, members?: any[] }} t @returns {Way} */
export const usualWay = (t) => (changesFiles(t) ? "charge" : "side");

/** A token count in a line's words: "≈84k", "≈1.2M", "≈900". @param {number} n */
export function tokWords(n) {
  const v = Math.max(0, Number(n) || 0);
  // Just under a million rounds to a thousand thousands: it says ≈1M, as a million does (found by the Bug Hunter, 10-19).
  if (v >= 999_500) return `≈${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (v >= 1e3) return `≈${Math.round(v / 1e3)}k`;
  return `≈${Math.round(v)}`;
}

/**
 * What Back to your agent costs, in words (team_v2_plan §10 O4): the conversation your agent reads again, cached once —
 * "≈91k tokens cached again, once (≈$0.51)"; its price where the price card says it. Null while the size is unknown.
 * @param {{ tokens: number, usd?: number | null } | null | undefined} cost
 */
export function backCostWords(cost) {
  if (!cost || !(cost.tokens > 0)) return null;
  const usd = Number(cost.usd);
  const price = cost.usd == null || !Number.isFinite(usd) ? "" : usd < 0.01 ? " (under $0.01)" : ` (≈$${usd.toFixed(2)})`;
  return `${tokWords(cost.tokens)} tokens cached again, once${price}`;
}

/**
 * What a team's lead reads of the chat (the server's `GET …/beside/reads`).
 * @typedef {{ tokens: number, turns: number, form: string, cut: boolean, running: { rounds: number } | null,
 *   waiting: boolean, compactions: number, window: number, lead: string | null }} ReadsFacts
 */

/**
 * The lines of What its lead reads, On the side: the chat — its turns and size — the turn running now, its compactions
 * and a question waiting, then the person's words.
 * @param {ReadsFacts} f
 */
export function readsLines(f) {
  const turns = `${f.turns} ${f.turns === 1 ? "turn" : "turns"}`;
  const how = f.form === "plain" ? "" : "condensed the way this chat's compaction condenses it, to fit";
  return {
    head: "This whole chat",
    fig: `${turns} · ${tokWords(f.tokens)} tokens`,
    running: f.running ? `with the turn running now — round ${f.running.rounds}, up to this moment` : "",
    rest: [
      f.compactions ? `${f.compactions} ${f.compactions === 1 ? "compaction" : "compactions"}, as they stand` : "no compaction",
      f.waiting ? "the question waiting for you" : "no question waiting for you",
      how,
      f.cut ? "its oldest part left out to fit" : "",
    ].filter(Boolean).join(" · "),
  };
}

/**
 * How the record fits its lead's window: the bar's share, and its words — it may fill half at most, the rest is room for
 * its workers' reports.
 * @param {ReadsFacts} f @returns {{ share: number, words: string, tone: "ok" | "tight" }}
 */
export function fitOf(f) {
  const win = Number(f.window) || 0;
  const share = win ? Math.min(1, f.tokens / win) : 0;
  const tight = f.cut || share > 0.4;
  const where = win ? `${tokWords(f.tokens)} of its lead's ${tokWords(win).replace("≈", "")} window` : `${tokWords(f.tokens)} tokens`;
  return {
    share,
    tone: tight ? "tight" : "ok",
    words: `${tight ? "Fits" : "Fits easily"}: ${where}. The chat may take half at most; the rest is room for its workers' reports.`,
  };
}

/**
 * Where the lead's model comes from, in the squad's words.
 * @param {{ pick: string, team: { leadModel?: string | null } | null, on: import("./beside.js").BesideOn | null }} o
 */
export function leadFrom({ pick, team, on }) {
  if (pick) return "for this run";
  if (on?.leadFrom === "here") return "this chat's for the team";
  // Its lead runs on the team's list while one of it could run: a model passed for the next is still the team's.
  const lost = (on?.fell || []).some((f) => f.as === "lead" && !f.next);
  return team?.leadModel && !lost ? "the team's" : "this chat's model";
}

/**
 * What a list's first model stands for where each worker's card comes before it (the review of 0376f5a4f): the rule
 * whole, a picker's tip — the picker shows the model, and the words beside it whose list it is.
 * @param {string} words
 */
export const cardsFirst = (words) => `each worker's card's, else ${words}`;

/**
 * Where the workers' models come from: picked for this run — that one alone, none after it —, this chat's rows for
 * the team, the team's, this chat's list (a project's, in a run kept from before a list was a chat's own alone), else
 * this chat's list as it stands; a list of more than one says its picker shows the first and what comes after it
 * (U13-D14; the owner's 10-27: the chip read as the one model). `words`: whose the model the picker shows is, beside
 * it; `tip`: the rule whole, the picker's tip — the same words where no card comes before the list; `cards`: each
 * worker's card comes before the list.
 * @param {import("./beside.js").BesideOn | null} on @param {string[]} seats  this chat's list's models, in order
 * @returns {{ first: string, words: string, tip: string, cards: boolean }}
 */
export function workersFrom(on, seats = []) {
  const said = (/** @type {string} */ whose, /** @type {string[]} */ list) => (list.length > 1 ? `first of ${whose} · then ${list.slice(1).map(prettyModel).join(", ")}` : whose);
  /** A list alone. @param {string} first @param {string} words */
  const plain = (first, words) => ({ first, words, tip: words, cards: false });
  /** A list a worker takes where its card names no model. @param {string} first @param {string} words */
  const after = (first, words) => ({ first, words, tip: cardsFirst(words), cards: true });
  if (!on) return after(seats[0] || "", "this chat's list");
  if (on.from === "picked") return plain(on.workers?.[0] || "", "for this run: this model alone, none after it");
  if (on.from === "here") return plain(on.workers?.[0] || "", said("this chat's models for the team", on.workers || []));
  if (on.from === "chat") return after(on.workers?.[0] || "", said("this chat's list", on.workers || []));
  if (on.from === "project") return after(on.workers?.[0] || "", said("this project's list", on.workers || []));
  if (on.from === "team") return plain(on.workers?.[0] || "", said("the team's models", on.workers || []));
  return after(seats[0] || "", said("this chat's list", seats));
}

/**
 * The workers the page holds a model of their own for, which no list comes before (the rework of 11-11: a model said
 * as a model): a seat the team names a model for — over any pick —, and, where each worker's card comes before the
 * list (`cards`), one whose card names a model, by its first.
 * @param {any[]} members  a team's members, as the server hands them out @param {boolean} cards
 * @returns {{ name: string, model: string, whose: "team" | "card" }[]}
 */
export function ownModels(members, cards) {
  /** @type {{ name: string, model: string, whose: "team" | "card" }[]} */
  const out = [];
  for (const m of members || []) {
    if (m?.own?.model) out.push({ name: String(m.name), model: String(m.own.model), whose: "team" });
    else if (cards && m?.model) out.push({ name: String(m.name), model: String(m.model), whose: "card" });
  }
  return out;
}

/**
 * A Brief's choices as outcomes, in one line under its box (the rework of 11-11): on the side, what its lead reads, where
 * its result goes — checked by BugHunters first, then on to your agent, where those are switched on — and what runs;
 * in charge, that its lead answers this chat, and what runs. A model not known yet is left out.
 * @param {{ way: Way, reads: "chat" | "words", verify: boolean, notify: boolean, lead: string, workers: string, own?: "" | "some" | "all", cut?: boolean }} o
 *   `lead`, `workers`: the model each runs on, "" while unknown; `own`: some of its workers, or all, run on a model of
 *   their own (`ownModels`); `cut`: the chat does not fit its lead's window whole
 */
export function defaultsLine(o) {
  const workers = o.own === "all" ? "workers on their own models" : o.workers ? `workers on ${prettyModel(o.workers)}${o.own === "some" ? ", or their own" : ""}` : "";
  const runs = [o.lead ? `lead on ${prettyModel(o.lead)}` : "", workers].filter(Boolean);
  if (o.way === "charge") return ["Its lead answers this chat", ...runs].join(" · ");
  const reads = o.reads === "words" ? "Its lead reads only what you write here" : o.cut ? "Its lead reads this chat, its oldest part left out" : "Its lead reads this whole chat";
  const result = `its result comes to you${o.verify ? ", checked by BugHunters first" : ""}${o.notify ? ", then to your agent" : ""}`;
  return [reads, result, ...runs].join(" · ");
}

/**
 * What a Brief's Options hold, said at their head while they are folded: a hunt's range on the side, what its lead
 * reads, what follows, the models, and in charge what changes in this chat.
 * @param {Way} way @param {boolean} hunting  the Brief starts a hunt that takes a range
 */
export function optionsHolds(way, hunting) {
  if (way === "charge") return "what its lead reads, its orders, the models, what changes in this chat";
  return [hunting ? "what to hunt in" : "", "what its lead reads", "what happens when it's done", "the models"].filter(Boolean).join(", ");
}

/**
 * Why a Brief's Options stand open by themselves (the rework of 11-11): each choice the Brief made for the person that
 * cannot stand, in a sentence that names the part to look at — a model the team names, or one picked, that cannot run
 * now (its part says which and why, lib/beside.js `fellWords`), and, on the side, a chat that does not fit its lead's
 * window whole, its oldest part left out. A reading that is tight and whole fits: no reason. None: [].
 * @param {{ way: Way, reads: "chat" | "words", on: import("./beside.js").BesideOn | null, facts: ReadsFacts | null }} o
 * @returns {string[]}
 */
export function optionsWhy(o) {
  const fell = o.on?.fell || [];
  const cut = o.way === "side" && o.reads === "chat" && !!o.facts?.cut;
  return [
    fell.length === 1 ? `${fell[0].name} cannot run now: see The team` : fell.length ? `${fell.length} models cannot run now: see The team` : "",
    cut ? "This chat does not fit its lead's window whole: see What its lead reads" : "",
  ].filter(Boolean);
}

/** The preference that keeps the Teams tab's How teams work as the person left it, for every chat: "1" open, else folded. */
export const HOW_PREF = "teams.howOpen";
/** The preference that keeps a Brief's Options as the person left them, for every team: "1" open, else folded. */
export const OPTIONS_PREF = "brief.optionsOpen";

/**
 * What a team's Brief keeps of its last run in this browser (the owner's yes of 10-21): its lead's and its workers'
 * models and efforts — "" where it picked nothing, the team's own then.
 * @typedef {{ model: string, workers: string, effort: string, workersEffort: string }} Picks
 */
/** The preference that holds each team's last picks, by its key. */
export const PICKS_PREF = "brief.lastPicks";
/** @param {unknown} v */
const pickWord = (v) => (typeof v === "string" ? v.trim() : "");
/**
 * A team's last picks from the preference's text, or null where it holds none for it.
 * @param {string | null} text @param {string} team @returns {Picks | null}
 */
export function picksOf(text, team) {
  /** @type {any} */
  let all = null;
  try {
    all = JSON.parse(String(text || ""));
  } catch {
    return null;
  }
  const p = all && typeof all === "object" && !Array.isArray(all) ? all[team] : null;
  if (!p || typeof p !== "object") return null;
  /** @type {Picks} */
  const out = { model: pickWord(p.model), workers: pickWord(p.workers), effort: pickWord(p.effort), workersEffort: pickWord(p.workersEffort) };
  return out.model || out.workers || out.effort || out.workersEffort ? out : null;
}
/**
 * The preference's text with a team's picks kept; a run that picked nothing forgets them, so its next Brief opens on
 * the team's own.
 * @param {string | null} text @param {string} team @param {Picks} picks @returns {string}
 */
export function keepPicks(text, team, picks) {
  /** @type {Record<string, any>} */
  let all = {};
  try {
    const v = JSON.parse(String(text || "{}"));
    if (v && typeof v === "object" && !Array.isArray(v)) all = v;
  } catch {}
  const p = picksOf(JSON.stringify({ [team]: picks }), team);
  if (p) all[team] = p;
  else delete all[team];
  return JSON.stringify(all);
}
