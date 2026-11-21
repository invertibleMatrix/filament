// @ts-check
// The four members every shipped team has — a scout, a builder, a tester and a reviewer: Reviewer seated as the Scout,
// Builder, Builder seated as the Tester, Reviewer — as the team store hands them out: each by its id, its card where the
// team names the seat, its name, its card's line, what it may do and its place. The crew a lead's task graph reads in
// the tests.
import { SHIPPED_CREW, memberCard } from "../../src/core/roster.js";
import { shippedCard } from "../../src/services/agent-cards.js";
import { SHIPPED_TEAMS } from "../../src/services/teams.js";

/** The seats' names, as the team that builds names them, in the crew's order. */
const SEATS = SHIPPED_TEAMS.builders.members;

/**
 * Those four, with a team's own words for a member by its id (`lines`).
 * @param {Record<string, string>} [lines] @returns {import("../../src/core/roster.js").Member[]}
 */
export const membersOf = (lines = {}) =>
  SHIPPED_CREW.map((m, i) => {
    const card = memberCard(m);
    const c = /** @type {NonNullable<ReturnType<typeof shippedCard>>} */ (shippedCard(card));
    const seat = /** @type {{ name?: string }} */ (SEATS[i]).name;
    return { tag: m.tag, ...(m.card ? { card: m.card } : {}), name: seat || c.name, goodFor: c.goodFor, may: /** @type {"read" | "copy" | "edit"} */ (c.may), place: card, line: String(lines[m.tag] ?? ""), model: null };
  });
/** Those four with no words of a team's own. */
export const MEMBERS = Object.freeze(membersOf());
