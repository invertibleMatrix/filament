// @ts-check
// The words for the team keys and the lead tags Filament does not ship that a session, a flow, a team or a file may
// name: each says which team does that team's work — Builders, or BugHunters. Pure.

/** The teams Filament does not ship whose work Builders does, by key: each one's name. */
const FOLDED_TEAMS = Object.freeze({
  "10x-engineer": "10x Engineer",
  methodical: "Methodical",
  architect: "Architect",
  "one-shot": "One-Shot",
});
/**
 * The teams Filament does not ship whose work BugHunters does, by key: each one's name, how it stands in BugHunters,
 * what BugHunters is sent with in its place, and whether its result was a check of claims (`checks`), which nothing
 * checks again.
 */
const FOLDED_HUNTS = Object.freeze({
  "bug-hunter": Object.freeze({ name: "Bug Hunter", now: "is now BugHunters", with: "what to hunt", checks: false }),
  verifier: Object.freeze({ name: "Verifier", now: "is now part of BugHunters", with: "the claims to check", checks: true }),
});
/** The Leads of the teams `FOLDED_TEAMS` and `FOLDED_HUNTS` know, by tag: each the key of its team. */
const FOLDED_LEADS = Object.freeze({ tenx: "10x-engineer", methodical: "methodical", architect: "architect", oneshot: "one-shot", verifylead: "verifier" });
/** The key of the team Filament ships that builds, and its name. */
const BUILD_TEAM = Object.freeze({ key: "builders", name: "Builders" });
/** The key of the team Filament ships that finds bugs and checks claims, and its name. */
const HUNT_TEAM = Object.freeze({ key: "bughunters", name: "BugHunters" });

/**
 * A key, a tag or a team's name as a person may write it, read as a team's key is made (services/teams.js `teamKey`):
 * a leading `@` and capitals aside, each run of other characters one dash — "Bug Hunter" is `bug-hunter`.
 * @param {unknown} v
 */
const plainKey = (v) =>
  String(v ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
/** A key `FOLDED_HUNTS` knows, as it says it, or null. @param {string} k */
const huntOf = (k) => (Object.hasOwn(FOLDED_HUNTS, k) ? FOLDED_HUNTS[/** @type {keyof typeof FOLDED_HUNTS} */ (k)] : null);

/**
 * Whether a team's result comes checked, so that nothing checks it again (Verify…, Then verify): BugHunters', whose
 * Checkers checked it, and the Verifier's, a check of claims. @param {unknown} key
 */
export const resultChecked = (key) => {
  const k = plainKey(key);
  return k === HUNT_TEAM.key || huntOf(k)?.checks === true;
};

/**
 * A team key `FOLDED_TEAMS` or `FOLDED_HUNTS` knows, as a person reads it — its name and the key of the team that does
 * its work ("Methodical", "builders"; "Verifier", "bughunters") — or null for any other key.
 * @param {unknown} key @returns {{ name: string, into: string } | null}
 */
export const foldedTeam = (key) => {
  const k = plainKey(key);
  const hunt = huntOf(k);
  if (hunt) return { name: hunt.name, into: HUNT_TEAM.key };
  if (!Object.hasOwn(FOLDED_TEAMS, k)) return null;
  return { name: FOLDED_TEAMS[/** @type {keyof typeof FOLDED_TEAMS} */ (k)], into: BUILD_TEAM.key };
};
/**
 * Where a person meets a key `foldedTeam` knows: "Builders does 10x Engineer's work: pick Builders"; "Verifier is now
 * part of BugHunters: send BugHunters with the claims to check" — or null for any other key.
 * @param {unknown} key
 */
export const foldedTeamWords = (key) => {
  const hunt = huntOf(plainKey(key));
  if (hunt) return `${hunt.name} ${hunt.now}: send ${HUNT_TEAM.name} with ${hunt.with}`;
  const f = foldedTeam(key);
  return f ? `${BUILD_TEAM.name} does ${f.name}'s work: pick ${BUILD_TEAM.name}` : null;
};
/**
 * Where a team of a person's names one of those Leads as its lead: its team, which team does its work, and what to do —
 * or null for any other tag. @param {unknown} tag
 */
export const foldedLeadWords = (tag) => {
  const t = plainKey(tag);
  const key = Object.hasOwn(FOLDED_LEADS, t) ? FOLDED_LEADS[/** @type {keyof typeof FOLDED_LEADS} */ (t)] : null;
  const hunt = key ? huntOf(key) : null;
  if (hunt) return `${hunt.name} ${hunt.now}: make another card the lead, or send ${HUNT_TEAM.name} in this team's place`;
  const f = key ? foldedTeam(key) : null;
  return f ? `${BUILD_TEAM.name} does ${f.name}'s work: make another card the lead, or pick ${BUILD_TEAM.name} in this team's place` : null;
};
