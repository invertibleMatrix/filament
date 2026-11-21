// @ts-check
// Teams behind Settings › Experimental (the owner's of 11-17: teams are "still untested and not fully done", and only
// confuse people): off by default. While off, no team starts — one already at work finishes —, nothing offers one, and
// a chat set to be led by a team is answered by its own agent, the setting kept. The page reads the same switch
// (src/ui/lib/teams-on.js), with the same words for the Library's page.

/**
 * Whether teams are on here: Settings › Experimental's switch (`experimental.teams`), off by default.
 * @param {any} cfg
 */
export const teamsOn = (cfg) => cfg?.experimental?.teams === true;
/** Where that switch is, as a sentence names it. */
export const TEAMS_SWITCH = "Settings › Experimental (Teams)";
/** What Filament says of a team asked for while its switch is off, as a sentence. */
export const TEAMS_OFF = `Teams are off: turn them on in ${TEAMS_SWITCH}`;
/** Why no team leads a chat while the switch is off, inside a sentence. */
export const TEAMS_OFF_WHY = `teams are off in ${TEAMS_SWITCH}`;
/**
 * The teams a chat's settings may name to lead it: every one while teams are on; while they are off, only for a team's
 * own chat beside a main one, which its team leads until its work is done (app/engine.js `engineProblem`). Null else:
 * a chat whose settings name a team plans and works as its own agent's, the setting kept.
 * @template T @param {any} cfg @param {boolean} teamChat @param {T} teams @returns {T | null}
 */
export const leadingTeams = (cfg, teamChat, teams) => (teamChat || teamsOn(cfg) ? teams : null);
/**
 * The Library's page of the person's agents, as words name it: "Agents and teams" while teams are on.
 * @param {any} cfg
 */
export const agentsPage = (cfg) => (teamsOn(cfg) ? "Library › Agents and teams" : "Library › Agents");
