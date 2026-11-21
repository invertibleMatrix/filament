// @ts-check
// Version 105 (the bug hunt of 11-08 on the graph's and the sealed reports' words, verified on 11-09): what a lead, a
// coding agent and a fork read of planning and of how a report reaches them says what the code does. A lead's graph line
// said "Nothing has to go on the graph" beside version 98's rule, which a coding agent in the lead's seat never read at
// all; a coding agent's graph words let a line of its reply stand for the checklist it always has; a lead's agent texts
// said every report arrives as a message while one that lands as it works waits sealed; the envelope tool said every
// result waits sealed, false under the chat's Whole; and a fork kept the main agent's planning rule beside "the checklist
// is the main agent's".
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentContext, CODER_GRAPH_TEXT } from "../src/app/agent-context.js";
import { leadWords } from "../src/app/agent-lead.js";
import { PROMPT, TOOL_TEXT, systemPromptFor } from "../src/app/agent/prompt.js";
import { SUBAGENT_NOTES } from "../src/app/agent/subagents.js";
import { shippedTeam } from "./helpers/team.js";

/** Version 98's rule, as every planning line says it. */
const NEVER_NEITHER = "never do work of more than one step with neither";

// (fails before: yes — a lead's graph line ended "Nothing has to go on the graph", and a coding agent's lead read no line
// with the rule)
test("a lead plans work of more than one step on the checklist or the graph, in the loop's seat and a coding agent's", () => {
  const loop = systemPromptFor({ root: "/w", delegateRead: false, graph: true, lead: { name: "Builders", persona: "" } });
  const section = loop.slice(loop.indexOf(PROMPT.headGraph));
  assert.ok(!section.includes("Nothing has to go on the graph"), "no line frees a lead's work from the plan");
  assert.ok(section.toLowerCase().includes(NEVER_NEITHER), "the lead's graph section says the rule");
  const team = shippedTeam("builders");
  const coder = agentContext({ format: "anthropic", body: { messages: [] }, graph: true, lead: true, role: leadWords(team) });
  const words = coder.standing.map((b) => b.text).join("\n");
  assert.ok(words.toLowerCase().includes(NEVER_NEITHER), "a coding agent in the lead's seat reads the rule too");
  assert.ok(words.includes("the checklist when its steps go one after another"), "straight steps go on its checklist");
});

// (fails before: yes — "or in a line of your reply where you have none", while the graph's words stand only beside
// Filament's checklist)
test("a coding agent's graph words send straight steps to Filament's checklist, with no line of its reply in its place", () => {
  assert.ok(!CODER_GRAPH_TEXT.includes("a line of your reply"));
  // Its items are tasks on the graph since version 119 (c-mirror): never tasks the agent adds itself.
  assert.ok(CODER_GRAPH_TEXT.includes("Steps you take yourself one after another go on Filament's checklist tool, never as tasks you add: "));
  assert.ok(CODER_GRAPH_TEXT.includes("Never do work of more than one step with neither"));
});

// (fails before: yes — each said the report arrives as a message, nothing of the envelope)
test("a lead's words on a worker's report say it waits sealed where Filament's line says so: its prompt, its agent tool, a coding agent's part", () => {
  const sealed = "waits sealed for the envelope tool where Filament's line says so";
  assert.ok(PROMPT.teamAgent.includes(`when it finishes, or ${sealed};`), "the loop lead's prompt");
  assert.ok(TOOL_TEXT.teamAgent.includes(`when it finishes, or ${sealed}, and this turn`), "a lead's agent tool, either seat");
  const team = shippedTeam("builders");
  assert.ok(leadWords(team).includes("reaches you as a message from Filament, or waits sealed for its envelope tool where Filament's line says so."));
  assert.ok(leadWords(team, { supervise: true }).includes("reaches you as a message from Filament, a report waiting sealed for its envelope tool where Filament's line says so."));
});

// (fails before: yes — "A result that lands while you work shows as one line … and waits sealed", whatever the switch)
test("the envelope tool says a result waits sealed unless the chat takes results whole", () => {
  assert.ok(TOOL_TEXT.envelope.includes("Unless the chat takes results whole, one that lands while you work shows as one line (who sent it, what it is about) and waits sealed until you open it here"));
});

// (fails before: yes — the fork read "the checklist is the main agent's" under a prompt that says never to work without it)
test("a fork is told the rule to plan is the main agent's, as the checklist is", () => {
  assert.ok(SUBAGENT_NOTES.fork.includes("the checklist and the rule to plan are the main agent's"));
});
