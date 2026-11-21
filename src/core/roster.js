// @ts-check
// A team's members as its lead, its tools and the task graph read them (HarnessV4_Tasks E15 step 6): each a worker
// card by its id — its tag, or the name the team gives one of its seats where it seats that card twice — with what the
// card is good for, what it may do and its place — the shipped card it is, or was copied from. What a member may do is its card's: one that edits changes files, each in its own git worktree; one
// that runs in its own copy keeps nothing; one that reads changes nothing. A team's reviewer is the member in
// Reviewer's place (AG-172) — under the card's own name, where the team also seats Reviewer under a name of its own for
// other work. The four members every shipped team has are the ones the lead's words were written for (AG-171): a
// Reviewer seated as its Scout, a Builder, a Builder seated as its Tester, and a Reviewer. Pure.

/**
 * @typedef {object} Member
 * @property {string} tag  its id, what the lead, its tools and the task graph name it by: its card's tag, or the slug of
 *   the name the team gives it where the team seats that card more than once (services/teams.js `memberId`)
 * @property {string} [card]  its card's tag, where the team gives the seat a name of its own — `name` is then that
 *   seat's name (`memberCard`)
 * @property {string} name  the name the team gives it, else its card's
 * @property {string} goodFor  its card's line
 * @property {"read" | "copy" | "edit"} may  what its card may do
 * @property {string | null} place  the shipped card it is or was copied from
 * @property {string} line  the team's own words for this member
 * @property {string | null} [model]  the model its card names
 * @property {{ model?: string, effort?: string }} [own]  the model and the effort the team runs this member on, where it
 *   names either: a launch that names none takes them, before the team's models and its card's
 */

/**
 * The members of every team that ships, in the order they are listed: each by its id, with its card's tag and the
 * seat's name where the team seats that card under a name of its own (`card`, `name`) — Reviewer as the Scout, Builder
 * as the Tester. The page draws a seat of it by these where no member list is at hand (the settings answer's
 * `shippedCrew`).
 */
export const SHIPPED_CREW = Object.freeze(
  /** @type {{ tag: string, card?: string, name?: string }[]} */ ([{ tag: "scout", card: "reviewer", name: "Scout" }, { tag: "builder" }, { tag: "tester", card: "builder", name: "Tester" }, { tag: "reviewer" }]).map((m) => Object.freeze(m)),
);
/** The ids of every shipped team's members, in their order: what its lead and its tools name them by. */
export const SHIPPED_MEMBERS = Object.freeze(SHIPPED_CREW.map((m) => m.tag));

/**
 * Whether a team's members are the four that ship, in their order, each on its card: the lead then reads the words
 * written for them. @param {readonly { tag: string, card?: string }[]} members
 */
export const isShippedRoster = (members) => members.length === SHIPPED_CREW.length && members.every((m, i) => m.tag === SHIPPED_CREW[i].tag && memberCard(m) === memberCard(SHIPPED_CREW[i]));
/** Whether a member's work changes files that are kept: its card edits. @param {{ may: string } | null | undefined} m */
export const writes = (m) => m?.may === "edit";
/**
 * The members that read another's change before it goes in: those in Reviewer's place — and where one of them sits under
 * the card's own name, those alone: a seat the team names for other work, as the shipped teams' Scout, reviews no change.
 * @template {{ place?: string | null, card?: string }} T @param {readonly T[]} members @returns {T[]}
 */
export const reviewersOf = (members) => {
  const all = members.filter((m) => m?.place === "reviewer");
  const plain = all.filter((m) => !m.card);
  return plain.length ? plain : all;
};
/**
 * Whether a member of a team reads another's change before it goes in (`reviewersOf`).
 * @param {{ place?: string | null, card?: string } | null | undefined} m @param {readonly { place?: string | null, card?: string }[]} members
 */
export const reviews = (m, members) => !!m && reviewersOf(members).includes(m);
/** @template {{ tag: string }} T @param {readonly T[]} members @param {unknown} tag @returns {T | null} */
export const memberOf = (members, tag) => members.find((m) => m.tag === tag) || null;
/**
 * A member's card's tag: its `card`, where the team names that seat of the card, else its id, which is its card's tag.
 * @param {{ tag: string, card?: string }} m
 */
export const memberCard = (m) => m.card ?? m.tag;
/** The team's reviewer, or null: a team without one has no review step. @template {{ tag: string, place?: string | null, card?: string }} T @param {readonly T[]} members @returns {T | null} */
export const reviewerOf = (members) => reviewersOf(members)[0] ?? null;
/**
 * The member that takes a task planned for "a sub-agent that changes files" before the team led: its Builder — under
 * the card's own name before a seat the team names — else its first member that edits.
 * @template {{ tag: string, may: string, place?: string | null, card?: string }} T @param {readonly T[]} members @returns {T | null}
 */
export const builderOf = (members) => {
  const builders = members.filter((m) => m.place === "builder" && writes(m));
  return builders.find((m) => !m.card) || builders[0] || members.find(writes) || null;
};
/**
 * The member that takes a task planned for "an explorer": its first seat in Reviewer's place that changes nothing and
 * is not its reviewer — the shipped teams' Scout —, else its reviewer where it changes nothing, else its first member
 * that changes nothing.
 * @template {{ tag: string, may: string, place?: string | null, card?: string }} T @param {readonly T[]} members @returns {T | null}
 */
export const scoutOf = (members) => {
  const reviewer = reviewerOf(members);
  return members.find((m) => m.place === "reviewer" && m !== reviewer && !writes(m))
    || (reviewer && !writes(reviewer) ? reviewer : null)
    || members.find((m) => !writes(m))
    || null;
};

/**
 * Tags no card Filament ships has that a saved team, flow or agent may still name: for each, the name a person knows
 * it by and the name of the shipped card that does its work — words that tell a person which card to pick in its
 * place, never a tag read as another's.
 */
const FOLDED = Object.freeze({
  pm: ["PM", "Product"],
  designer: ["Designer", "Product"],
  helper: ["Helper", "Builder"],
  engineer: ["Engineer", "Builder"],
  tester: ["Tester", "Builder"],
  scout: ["Scout", "Reviewer"],
  hunter: ["Hunter", "Reviewer"],
  checker: ["Checker", "Reviewer"],
  skeptic: ["Skeptic", "Reviewer"],
});
/** Cards Filament shipped and let go of with the way they started: none does their work now (the owner's word of 11-05). */
const RETIRED = Object.freeze({ explainer: "Explainer", watcher: "Watcher" });
/** A tag of a card Filament let go of whole, in words — "Explainer ships no more" — or null. @param {unknown} tag */
export const retiredWords = (tag) => {
  const t = String(tag ?? "").trim().replace(/^@/, "").toLowerCase();
  return Object.hasOwn(RETIRED, t) ? `${RETIRED[/** @type {keyof typeof RETIRED} */ (t)]} ships no more` : null;
};
/**
 * A tag of a card Filament does not ship, as a person reads it — its name and the name of the card that does its work
 * ("Scout", "Reviewer") — or null for any other tag. @param {unknown} tag @returns {{ name: string, into: string } | null}
 */
export const foldedCard = (tag) => {
  const t = String(tag ?? "").trim().replace(/^@/, "").toLowerCase();
  return Object.hasOwn(FOLDED, t) ? { name: FOLDED[/** @type {keyof typeof FOLDED} */ (t)][0], into: FOLDED[/** @type {keyof typeof FOLDED} */ (t)][1] } : null;
};
/**
 * Where a person meets a tag `foldedCard` knows: "Scout is now part of Reviewer: pick Reviewer for this box" — `then`
 * says what to do with the card that does its work — or null for any other tag.
 * @param {unknown} tag @param {(into: string) => string} then
 */
export const foldedWords = (tag, then) => {
  const f = foldedCard(tag);
  return f ? `${f.name} is now part of ${f.into}: ${then(f.into)}` : null;
};
/**
 * A team's member as its worker's launch names it: the team, the member's id, its card and place, the seat's name where
 * the team gives it one (`seat`), the team's own line for it, the model and effort the team runs it on where it names
 * either, and the team's check where it names one and the member changes files (`check`, the plan's p6).
 * @param {{ key: string, name: string, members: readonly Member[], check?: string | null }} team @param {string} tag  the member's id
 */
export const workerOf = (team, tag) => {
  const m = memberOf(team.members, tag);
  return { key: team.key, name: team.name, role: tag, ...(m?.card ? { card: m.card, seat: m.name } : {}), place: m?.place ?? null, words: m?.line ?? "", ...(m?.own?.model ? { model: m.own.model } : {}), ...(m?.own?.effort ? { effort: m.own.effort } : {}), ...(team.check && writes(m) ? { check: team.check } : {}) };
};
/**
 * A team as the page lists it: who leads it and its members, each by its id and name, its card where a name is the id
 * (its glyph is its card's), what it may do, its place, and the model and effort the team runs it on where it names
 * either (`own`, which a Brief's pick for the crew does not override); its check, null for none (the plan's p6).
 * @param {{ key: string, name: string, line: string, shipped: boolean, lead: { tag: string, name: string }, members: readonly Member[],
 *   leadModel?: string | null, leadModels?: readonly string[], readOnly?: boolean, models?: readonly string[],
 *   check?: string | null }} t
 */
export const teamRow = (t) => ({
  key: t.key,
  name: t.name,
  line: t.line,
  shipped: t.shipped,
  check: t.check ?? null,
  lead: t.lead,
  members: t.members.map((m) => ({ tag: m.tag, ...(m.card ? { card: m.card } : {}), name: m.name, may: m.may, place: m.place, ...(m.own ? { own: { ...m.own } } : {}) })),
  // What a team beside's fire card says of it (team_v2_plan §5.3): its lead's models (first choice first), read-only,
  // its workers' models.
  leadModel: t.leadModel ?? null,
  leadModels: [...(t.leadModels || (t.leadModel ? [t.leadModel] : []))],
  readOnly: t.readOnly === true,
  models: [...(t.models || [])],
});
/** What a member's work does to the project's files, in the words a lead reads. @param {{ may: string }} m */
export const doesWords = (m) => (m.may === "edit" ? "changes files" : m.may === "copy" ? "works in its own copy, and nothing it changes is kept" : "changes nothing");

