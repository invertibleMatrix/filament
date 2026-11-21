// @ts-check
// The words an agent reads of who runs on what where its call names none (the owner's of 11-05: no tool's words left
// wrong to keep the cache): the agent tool's model and effort left out, and a team fire's lead and workers, in the
// order the server takes them (subagents.js `launch`, teams-beside.js `runsOn`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_TOOL, TEAM_AGENT_TOOL } from "../src/app/agent/tools.js";
import { BESIDE_TOOL } from "../src/app/agent/beside-tool.js";

// (fails before: yes — the agent tool named its card and the session's list alone, never this chat's own models for its
// kind nor the main agent's model last; a team's fire named the team's own first, never this chat's rows)
test("the agent tool's model and effort left out, and a team fire's lead and workers, name this chat's own first and the main agent's or the lead's last", () => {
  const p = /** @type {any} */ (AGENT_TOOL).input_schema.properties;
  assert.match(p.model.description, /Left out: this chat's models for its kind where it sets any, else its card's where its kind names them, else this chat's list for agents, which is the main agent's model where the chat sets none; of that one list, the first that can run and has room\./);
  assert.match(p.effort.description, /Left out: the one its team names, else the one set for that model in the list it runs from, else the main agent's effort\. /);
  // (fails before: yes — the owner's of 11-19: nothing told the agent the list was the person's, and TinyQuest's
  // agent named a model, and an effort, that took its launches off it)
  assert.match(p.model.description, /^The model it runs on: leave it out unless the person asks for a model\. Left out: .* Where the person set that list, a model named for a launch here only picks one of its rows, on that row's account at its effort, and one off it is refused\. /);
  assert.match(p.provider.description, / For a launch here on a list the person set, its order decides instead\.$/);
  assert.match(p.effort.description, / Where the person set an effort on the list's rows, a launch here runs at it: leave effort out, as another is refused\.$/);
  const b = /** @type {any} */ (BESIDE_TOOL).input_schema.properties;
  assert.equal(b.model.description, "send: the model its lead runs on, as you'd say it. Left out: this chat's for its lead, else the team's, else its card's, else this chat's model.");
  assert.equal(b.workers_model.description, "send: the model its workers run on, but a worker its team names one for. Left out: this chat's for its workers, else the team's, else this chat's for each worker's kind, else its card's, else this chat's list, else its lead's.");
  assert.equal(b.workers_effort.description, "send: how hard its workers think, where its lead's launch and its team name none.");
});

// (fails before: yes — the review of 7f95cc28e: a lead's worker left out read its member's card first and the main
// agent's effort last, where a launch takes its member's own and its team's models first, and its lead's own effort)
test("a lead's worker left out: its member's own and its team's models first, its card's after this chat's, its lead's own effort last", () => {
  const p = /** @type {any} */ (TEAM_AGENT_TOOL).input_schema.properties;
  assert.match(p.model.description, /Left out: its own where its team names one, else its team's models for its workers, else this chat's for its kind, else its card's, else your workers' list, which is your own model where none is set \(as your instructions name them\); of that one list, the first that can run and has room\./);
  assert.match(p.effort.description, /Left out: the one its team names, else the one set for that model in the list it runs from, else your own effort\.$/);
  assert.doesNotMatch(p.model.description, /person set/, "a lead's launch is not held to the chat's list");
  assert.doesNotMatch(p.provider.description, /person set/, "nor its provider");
});
