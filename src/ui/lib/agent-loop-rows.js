// @ts-check
// The agent loop's settings another place sets (the owner's of 11-09: "get rid of all the craps in Agent Loop that is
// pre configured"), which the console's Agent loop tab leaves out of the schema it draws; the harness's Settings › Agent
// loop draws every other one by hand (test/harness-filament-pages.test.js holds the two to that). Each stays in the
// configuration: the place named beside it writes it.

/** Paths under `agentLoop`, each with the place that sets it. */
export const AGENT_LOOP_ELSEWHERE = Object.freeze([
  // The console's Prompts tab, with its live preview.
  "systemPrompt",
  // Settings › Permissions › New chats start in, which your defaults hold over it.
  "permissions",
  // Settings › Permissions › Offered in Memory after.
  "learnedPermissions.afterApprovals",
  // Each model's Agents at once on Settings › Providers, and on its coding agent's page.
  "subagents.slots",
  // Library › Agents and teams: a card's or a team's "Your agent may use it".
  "subagents.ask",
  "subagents.teams",
  // The older switch: Where they edit (`subagents.workspace`) says it now, a stored off carried to the Session folder.
  "subagents.worktree",
]);
