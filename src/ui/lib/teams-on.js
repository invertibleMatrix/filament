// @ts-check
// Teams behind Settings › Experimental, as the pages read the switch from the configuration (core/teams-on.js says it
// for the server, in the same words): off by default. While off nothing offers a team — the Library's page is Agents,
// a chat's Agents tab lists no team, nothing sends one or hands a chat to one — while a team at work still shows as it
// works, and the team work in a chat's transcript stays as it was.

/**
 * Whether teams are on: Settings › Experimental's switch (`experimental.teams`), off by default.
 * @param {any} cfg  the configuration as /api/state gives it
 */
export const teamsOn = (cfg) => cfg?.experimental?.teams === true;
/** What the page says of a team asked for while the switch is off, as the server says it. */
export const TEAMS_OFF = "Teams are off: turn them on in Settings › Experimental (Teams)";
/**
 * The Library's page of the person's agents, as the left bar and the Library name it: "Agents and teams" while teams
 * are on.
 * @param {any} cfg
 */
export const agentsLabel = (cfg) => (teamsOn(cfg) ? "Agents and teams" : "Agents");
/**
 * That page in a sentence, as a tooltip or a line sends the person there.
 * @param {any} cfg
 */
export const agentsPage = (cfg) => `Library › ${agentsLabel(cfg)}`;
