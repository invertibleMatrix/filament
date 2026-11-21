// @ts-check
// A team's registry with no app behind it (HarnessV3-AtHome P2 step 4): a scripted host serves each worker's run as
// turn.js does — attach, then finish before the reply — at the test's word, and the lead's turn is its door, as
// turn.js opens it. What reached a run's mailbox, what memory heard was corrected, what the lead's timeline heard and
// what the registry logged are kept for the test to read.
import { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubagentRegistry } from "../../src/app/agent/subagents.js";
import { createAgentCardStore } from "../../src/services/agent-cards.js";
import { createTeamStore } from "../../src/services/teams.js";
import { createTeamTools, watchParts } from "../../src/app/agent/team-tools.js";
import { PROMPT, TOOL_TEXT } from "../../src/app/agent/prompt.js";
import { MEMBERS } from "./roster.js";
import { until } from "./wait.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});

// HarnessV4_Tasks decision 9 (version 37): a lead's own hands, in either seat — its rule, after the worktree's line.
export const OWN_HANDS_LINE =
  "- Brief a worker by default. Do a piece yourself only where that is the better call: it is smaller than its brief would be — a one-line fix, a rename, a command that confirms a report; it is the glue between your workers' changes once you applied them; or workers have failed it twice. Never change a file a worker of yours is changing now: its change would clash with yours.";
/** The hands decision 9 gave a lead, beside read, grep and glob. */
export const DECISION_9_HANDS = Object.freeze(["write", "edit", "bash", "bash_background", "bash_output", "bash_kill", "powershell"]);
/**
 * A lead's words as version 36 had them, whose own tools only read — in the loop's seat and a coding agent's — for the
 * tests that weigh a lead's older figures (lead-briefing.test.js, lead-reads.test.js). @param {string} s
 */
export const asV36 = (s) => {
  const back = s
    .replace(PROMPT.leadRole, "You lead a team of coding agents run by Filament inside the developer's own project folder. You do not do the work yourself: you plan it, brief workers to do it, check what they report, and guide them until the task is done — then report in plain language what the team did, what was verified, and what remains. Every tool result is real: never invent a file's content or a result nobody ran.")
    .replace("- Workers do the work. Each worker is", "- Workers do the work; your own tools only read. Each worker is")
    .replace(`\n${OWN_HANDS_LINE}\n`, "\n")
    .replace(`${PROMPT.headTools}\n${PROMPT.hands}\n`, `${PROMPT.headTools}\nYour own tools read the developer's machine, rooted at the working folder: read for files, grep to search, glob to list files by pattern. Paths are relative to that folder. Everything else — writing and editing files, commands, the developer's MCP servers — is your workers'.\n`)
    .replace(PROMPT.leadPermission, "Your workers' tools run behind the developer's permission mode. A worker's call that needs approval waits for the developer's answer where they can give one — your wait shows it waiting — and is refused where they cannot, the worker's report saying what it would have run and why: then ask the developer, or brief the work another way.")
    .replace(PROMPT.leadCraft, [
      "- Put independent calls in one reply: they run in the same round, and the launches among them side by side. A call that needs an earlier call's result waits for your next reply.",
      "- Search before you read, and read large files in slices (offset and limit). A long result reaches you cut, with a note saying how to get the rest — fetch the part you need, not everything.",
    ].join("\n"))
    .replace(`${PROMPT.leadCare}\n${PROMPT.careLook}\n`, `${PROMPT.leadCare}\n`)
    .replace("Your own tools work as the developer's permission mode allows: keep them for the pieces better done yourself, and brief a worker for the rest.", "While you lead, your own tools only read: anything you ask to change or run that does more than read is refused — brief a worker for it.");
  assert.notEqual(back, s, "a lead's words carry decision 9's");
  return back;
};

// HarnessV4_Tasks E23 (version 38): every seat's agent tool names its sub-agent — its model, provider and effort — and
// lists the models; the loop's first line says what a launch runs on.
export const E23_FIELDS = Object.freeze(["model", "provider", "effort", "list_models"]);
/** The loop's agent tool's first line as version 37 had it. */
const V37_AGENT_HEAD = "Launch a sub-agent for one task: another run of you with its own context and your tools except ask, plan and agent, working until the task is done.";
/**
 * A tool set as version 37 had it: every agent tool without E23's fields, and the loop's with its first line — for the
 * tests that weigh older figures (lead-briefing.test.js, lead-reads.test.js, task-graph-switch.test.js). Each agent tool
 * of the set must carry them. The session's agent's tool lost its saved_agent too, which came after (the owner's list of
 * 10-19: a saved agent the developer's message names; agents-may-ask.test.js). @param {readonly any[]} set
 */
export const asV37 = (set) => {
  // The first line as version 98 had it: version 99 moved it (what a sub-agent goes without), and asV98Tools runs first.
  const head = V98_AGENT_HEAD;
  assert.notEqual(head, V37_AGENT_HEAD, "the loop's agent tool says what a launch runs on");
  return set.map((t) => {
    if (t?.name !== "agent") return t;
    const props = t.input_schema.properties;
    assert.ok(E23_FIELDS.every((k) => k in props), "an agent tool carries E23's fields");
    return { ...t, description: String(t.description).replace(head, V37_AGENT_HEAD), input_schema: { ...t.input_schema, properties: Object.fromEntries(Object.entries(props).filter(([k]) => !E23_FIELDS.includes(k) && k !== "saved_agent")) } };
  });
};

// The owner's words of 10-19 (version 39): every agent tool's context takes window, the context window as it stands,
// and says a view starts at the session's last compaction; a job's card has words of its own past its first line.
/**
 * A tool set as version 38 had it: every agent tool's context without window, in version 38's words — for the tests
 * that weigh older figures (lead-briefing.test.js, lead-reads.test.js, task-graph-switch.test.js). Some agent tool of
 * the set must carry window. @param {readonly any[]} set
 */
export const asV38 = (set) => {
  let moved = false;
  const back = set.map((t) => {
    const ctx = t?.name === "agent" ? t.input_schema?.properties?.context : null;
    if (!ctx?.enum?.includes("window")) return t;
    moved = true;
    const description = String(ctx.description)
      .replace(", from its last compaction on:", ":")
      .replace(/ · window — [^·]*?(?= · fork|\. Left out)/, "")
      .replace("Except window and fork,", "Except fork,")
      .replace("Except window, the current", "The current");
    return { ...t, input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, context: { ...ctx, enum: ctx.enum.filter((/** @type {string} */ v) => v !== "window"), description } } } };
  });
  assert.ok(moved, "an agent tool's context takes window");
  return back;
};
/** The Builder's words as version 38 shipped them: its first line was all of them. */
const V38_BUILDER = "You are a builder: make the change you were asked for, and only that.";
/**
 * The Builder's card with its words as version 38 had them: the card that ships now — Helper, Engineer and Tester taken
 * in ("Teams, improved and kept" of 11-03) — says far more. @param {any} card
 */
export const asV38Builder = (card) => {
  assert.ok(String(card.thinks).startsWith("You build: make the change your task asks for") && String(card.thinks).length > V38_BUILDER.length, "the Builder's words go past version 38's");
  return { ...card, thinks: V38_BUILDER };
};
/**
 * Helper's card as it shipped until Builder took it in ("Teams, improved and kept" of 11-03): Builder's level and sight,
 * with no words of its own. A graph task's sub-agent ran as it when the figures of version 29 were taken.
 * @param {any} builder  the shipped Builder's card
 */
export const asHelper = (builder) => ({ ...builder, tag: "helper", name: "Helper", goodFor: "One task done start to end, in its own copy", thinks: "" });

// HarnessV4_Envelopes_Plan EN1 (version 43): a sub-agent's report, a saved agent's answer and a team's worker's report
// start with a subject line, which the line of its sealed envelope carries.
/** Version 43's sentence that asks a report for its subject line; `reader`: who may read it first. @param {string} reader */
export const SUBJECT_LINE = (reader) => `Start it with one line, "Subject: " and what you found or did in under 20 words: ${reader} may read that line before the rest.`;
/**
 * A prompt as version 42 had it, whose report asked for no subject line — for the tests that weigh older figures
 * (lead-briefing.test.js, task-graph-report.test.js, task-graph-switch.test.js). It must ask for one. @param {string} s
 */
export const asV42 = (s) => {
  const back = s
    .replace(` ${SUBJECT_LINE("whoever launched you")}`, "")
    .replace(` ${SUBJECT_LINE("your lead")}`, "")
    .replace('its first line "Subject: " and your verdict or your result in under 20 words, then the reasons', "your verdict or your result in its first line, then the reasons");
  assert.notEqual(back, s, "a report asks for its subject line");
  return back;
};
/**
 * A tool set as version 43 had it, without the envelope tool version 44 put after wait (HarnessV4_Envelopes_Plan EN2) —
 * for the tests that weigh older figures (lead-briefing.test.js, lead-reads.test.js, task-graph-switch.test.js). It
 * must carry it. @param {readonly any[]} set
 */
export const asV43 = (set) => {
  const back = set.filter((t) => t?.name !== "envelope");
  assert.equal(back.length, set.length - 1, "the set carries the envelope tool");
  return back;
};

// HarnessV4_TaskNotes_Plan E33 (version 46): every planner's tasks tool keeps notes and files behind each task.
/** The fields keep and read brought. */
const E33_FIELDS = Object.freeze(["title", "text", "files", "picture", "forget", "from"]);
/**
 * A tool set as version 45 had it, its tasks tool without keep and read — their actions, their fields, their words in
 * its description and in id's — for the tests that weigh older figures (lead-briefing.test.js). It must carry them.
 * @param {readonly any[]} set
 */
export const asV45 = (set) => {
  let moved = false;
  const back = set.map((t) => {
    if (t?.name !== "tasks") return t;
    const props = t.input_schema.properties;
    assert.ok(E33_FIELDS.every((k) => k in props) && props.action.enum.includes("keep"), "the tasks tool carries keep and read");
    moved = true;
    const description = String(t.description).replace(/; keep — behind a task by id[\s\S]*?a line each\. Refused in words/, ". Refused in words");
    assert.notEqual(description, t.description, "its words say keep and read");
    const id = { ...props.id, description: String(props.id.description).replace(" keep, read: the task it is kept behind (leave it out for the graph itself).", "") };
    const kept = Object.fromEntries(Object.entries(props).filter(([k]) => !E33_FIELDS.includes(k)).map(([k, v]) => [k, k === "id" ? id : k === "action" ? { ...v, enum: v.enum.filter((/** @type {string} */ a) => a !== "keep" && a !== "read") } : v]));
    return { ...t, description, input_schema: { ...t.input_schema, properties: kept } };
  });
  assert.ok(moved, "the set carries the tasks tool");
  return back;
};

// HarnessV4_TaskGraphPlus_Plan E41 P1 (version 47): the agent's and a coding agent's tasks tool pauses a running task
// with its checkpoint; a lead's pauses nothing.
/**
 * A tool set as version 46 had it, its tasks tool without pause — its action, its checkpoint field, its words in the
 * description and in id's — for the tests that weigh older figures (lead-briefing.test.js). It must carry them.
 * @param {readonly any[]} set
 */
export const asV46 = (set) => {
  let moved = false;
  const back = set.map((t) => {
    if (t?.name !== "tasks") return t;
    const props = t.input_schema.properties;
    assert.ok("checkpoint" in props && props.action.enum.includes("pause"), "the tasks tool carries pause");
    moved = true;
    const description = String(t.description).replace(/ pause — id and checkpoint: [\s\S]*?hands the checkpoint back whole;/, "");
    assert.notEqual(description, t.description, "its words say pause");
    const id = { ...props.id, description: String(props.id.description).replace("pause: your running task you leave on purpose. ", "") };
    const kept = Object.fromEntries(Object.entries(props).filter(([k]) => k !== "checkpoint").map(([k, v]) => [k, k === "id" ? id : k === "action" ? { ...v, enum: v.enum.filter((/** @type {string} */ a) => a !== "pause") } : v]));
    return { ...t, description, input_schema: { ...t.input_schema, properties: kept } };
  });
  assert.ok(moved, "the set carries the tasks tool");
  return back;
};

// HarnessV4_TaskGraphPlus_Plan E41 P2 case 9 (version 48): every planner's done takes evidence where the task has
// acceptance and no check.
const DONE_EVIDENCE = ", and evidence where the task has acceptance and no check: what shows that holds — a test's output, a command you ran, what you saw";
/**
 * A tool set as version 47 had it, its tasks tool without evidence — its field and its words in the description — for
 * the tests that weigh older figures (lead-briefing.test.js). It must carry them. @param {readonly any[]} set
 */
export const asV47 = (set) => {
  let moved = false;
  const back = set.map((t) => {
    if (t?.name !== "tasks") return t;
    const props = t.input_schema.properties;
    assert.ok("evidence" in props, "the tasks tool carries evidence");
    moved = true;
    const description = String(t.description).replace(DONE_EVIDENCE, "");
    assert.notEqual(description, t.description, "its words say evidence");
    const kept = Object.fromEntries(Object.entries(props).filter(([k]) => k !== "evidence"));
    return { ...t, description, input_schema: { ...t.input_schema, properties: kept } };
  });
  assert.ok(moved, "the set carries the tasks tool");
  return back;
};

/**
 * A tool set as version 48 had it, without the report tool version 49 gave the agent's own set while its graph is on —
 * a task started as its fork carries it (the owner's words of 10-26) — for the tests that weigh older figures
 * (lead-briefing.test.js, task-graph-switch.test.js). It must carry it. @param {readonly any[]} set
 */
export const asV48 = (set) => {
  const back = set.filter((t) => t?.name !== "report");
  assert.equal(back.length, set.length - 1, "the set carries the report tool");
  return back;
};

// The owner's word of 10-27 (version 53): the loop's agent call runs in the background unless it says
// run_in_background: false — the tool's words, its field's and the agent's line say so. Each pair: now, then version 52.
const V53_TOOL = Object.freeze([
  "In the background (the default) you keep working and the report arrives as a message when it finishes — this turn does not end before it does; to wait for it, call wait (never sleep or poll). With run_in_background: false its final report is this tool's result.",
  "In the foreground (the default) its final report is this tool's result; with run_in_background you keep working and the report arrives as a message when it finishes — this turn does not end before it does; to wait for it, call wait (never sleep or poll).",
]);
const V53_FIELD = Object.freeze([
  "true (the default): launch it and keep working; its report arrives as a message when it finishes, and this turn does not end before it does — to wait for it, call wait. false: wait for the report as this tool's result.",
  "true: launch it and keep working; its report arrives as a message when it finishes, and this turn does not end before it does. false (the default): wait for the report as this tool's result.",
]);
const V53_LINE = Object.freeze([
  "Several agent calls in one reply run at the same time, each in the background by default: you keep working while they run, and run_in_background: false waits for one's report as the call's result. agent_id continues one you launched before.",
  "Several agent calls in one reply run at the same time; run_in_background keeps you working while one runs, and agent_id continues one you launched before.",
]);
/**
 * A tool set as version 52 had it, its agent tool's launch in the foreground by default — its words and its
 * run_in_background field's — for the tests that weigh older figures (lead-briefing.test.js). It must carry them.
 * @param {readonly any[]} set
 */
export const asV52 = (set) => {
  let moved = false;
  const back = set.map((t) => {
    if (t?.name !== "agent" || !t.input_schema?.properties?.run_in_background) return t;
    const field = t.input_schema.properties.run_in_background;
    const description = String(t.description).replace(V53_TOOL[0], V53_TOOL[1]);
    assert.notEqual(description, t.description, "its words say the background is the default");
    assert.equal(field.description, V53_FIELD[0], "its field says the background is the default");
    moved = true;
    return { ...t, description, input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, run_in_background: { ...field, description: V53_FIELD[1] } } } };
  });
  assert.ok(moved, "the set carries the agent tool");
  return back;
};
/** A system prompt as version 52 had it, the agent's line on the agent tool without the background default. @param {string} text */
export const asV52Prompt = (text) => {
  const back = text.replace(V53_LINE[0], V53_LINE[1]);
  assert.notEqual(back, text, "the prompt carries the agent tool's line");
  return back;
};

/** The craft's line on calls made together, the solo loop's and a lead's: as version 55 says it, and as 54 did. */
const V55_LINES = Object.freeze([
  [
    "- Put independent calls in one reply: they run in the same round and save a round trip — the reads, searches and fetches among them side by side, the rest in order. A call that needs an earlier call's result waits for your next reply.",
    "- Put independent calls in one reply: they run in the same round, in order, and save a round trip. A call that needs an earlier call's result waits for your next reply.",
  ],
  [
    "- Put independent calls in one reply: they run in the same round, and the launches among them side by side, as do the reads, searches and fetches. A call that needs an earlier call's result waits for your next reply.",
    "- Put independent calls in one reply: they run in the same round, and the launches among them side by side. A call that needs an earlier call's result waits for your next reply.",
  ],
]);
/**
 * A system prompt as version 54 had it, before a reply's reads ran side by side (the owner's word of 10-27): the
 * craft's line on calls made together in its old words, for the tests that weigh older figures. It must carry one.
 * @param {string} text
 */
export const asV54Prompt = (text) => {
  let back = text;
  for (const [now, was] of V55_LINES) back = back.split(now).join(was);
  assert.notEqual(back, text, "the prompt carries the craft's line on calls made together");
  return back;
};

/**
 * A tool set as version 54 had it, before bash_background could watch a running command's lines (the owner's word of
 * 10-27): its `watch` field gone, for the tests that weigh older figures. It must carry it.
 * @param {readonly any[]} set
 */
export const asV54Tools = (set) => {
  let moved = false;
  const back = set.map((t) => {
    if (t?.name !== "bash_background" || !t.input_schema?.properties?.watch) return t;
    const { watch, ...rest } = t.input_schema.properties;
    moved = true;
    return { ...t, input_schema: { ...t.input_schema, properties: rest } };
  });
  assert.ok(moved, "the set carries bash_background's watch");
  return back;
};

/**
 * A tool set as version 67 had it, before the agent tool could mark a sub-agent's change as applied (10-29): its
 * `mark_applied` field gone, for the tests that weigh older figures. It must carry it.
 * @param {readonly any[]} set
 */
export const asV67Tools = (set) => {
  let moved = false;
  const back = set.map((t) => {
    if (t?.name !== "agent" || !t.input_schema?.properties?.mark_applied) return t;
    const { mark_applied, ...rest } = t.input_schema.properties;
    moved = true;
    return { ...t, input_schema: { ...t.input_schema, properties: rest } };
  });
  assert.ok(moved, "the set carries the agent tool's mark_applied");
  return back;
};

// The task graph always on (version 69, the owner's word of 10-29): the words that said it was switched on are gone.
// Each pair: now, then version 68.
const V69_TOOL = Object.freeze([
  ["— the task graph. A task", "— the task graph, which the developer switched on. A task"],
  ["— the task graph of Filament, the harness the person works with you through;", "— the task graph, which the person switched on in Filament, the harness they work with you through;"],
]);
const V69_PROMPT = Object.freeze([
  ["\n- Your checklist is on your task graph: each item", "\n- The developer switched the task graph on for this session. Your checklist is on it: each item"],
  ["update it as items finish: its items are tasks on your task graph (below).", "update it as items finish: with the task graph on, its items are tasks on your graph (below)."],
  ["\n- With the tasks tool you plan your team's work as a graph:", "\n- The developer switched the task graph on for this session. With the tasks tool you plan your team's work as a graph:"],
]);

/**
 * A tool set as version 68 had it, while the task graph had a switch: a tasks tool's words say it was switched on, for
 * the tests that weigh older figures. It must carry a tasks tool.
 * @param {readonly any[]} set
 */
export const asV68Tools = (set) => {
  let moved = false;
  const back = set.map((t) => {
    if (t?.name !== "tasks") return t;
    const description = V69_TOOL.reduce((d, [now, then]) => d.replace(now, then), String(t.description));
    assert.notEqual(description, t.description, "its words are version 69's");
    moved = true;
    return { ...t, description };
  });
  assert.ok(moved, "the set carries a tasks tool");
  return back;
};

/**
 * A system prompt as version 68 had it, while the task graph had a switch: its graph section and its plan line say it
 * was switched on. It must carry a graph section.
 * @param {string} s
 */
export const asV68Prompt = (s) => {
  const back = V69_PROMPT.reduce((p, [now, then]) => p.replace(now, then), s);
  assert.notEqual(back, s, "the prompt carries the task graph's section");
  return back;
};

// A sub-agent's task alone by default, four views to ask for (version 73, the owner's word of 10-31). Each pair: the
// agent tool's `context` words now, then version 72's (the main agent's, then a team's and a coder's).
const V73_CONTEXT = Object.freeze([
  [
    "What it sees of this session, from its last compaction on. Left out: none — the task alone, the default and almost always right: a sub-agent handed your conversation takes on your view of it, while one handed only its task answers apart from you and costs nothing to brief, so put the facts it needs in the prompt instead. Only where the task is about the conversation itself: folded — every turn folded to its words with one line per tool call · window — your context window as it stands, this turn to its newest round included · fork — a copy of you: this whole conversation as it stands, this turn included, on your model (read from the provider's cache, but carried on each of its rounds). Except window and fork, the current turn's work is never included.",
    "What it sees of this session, from its last compaction on: none — the task alone · aggressive — the newest turn whole, older ones folded or summarized · moderate — every turn folded to its words with one line per tool call · light — the last two turns whole, older ones folded · full — every completed turn as it was sent · window — your context window as it stands, this turn to its newest round included · fork — a copy of you: this whole conversation as it stands, this turn included, on your model (read from the provider's cache, but carried on each of its rounds — keep it for work that needs the conversation's nuance). Left out, the session's own choice (none unless it sets one). Except window and fork, the current turn's work is never included: put what it needs from it in the prompt.",
  ],
  [
    "What it sees of this session ahead of its brief, from its last compaction on. Left out: none — the brief alone, the default and almost always right: a worker handed the conversation takes on its view of it, while one handed only its brief works apart from it, so put the facts it needs in the brief instead. Only where the task is about the conversation itself: folded — every turn folded to its words with one line per tool call · window — this session's context window as it stands, the turn running now to its newest round included. Except window, the current turn's work is never included.",
    "What it sees of this session ahead of its brief, from its last compaction on: none — the brief alone · aggressive — the newest turn whole, older ones folded or summarized · moderate — every turn folded to its words with one line per tool call · light — the last two turns whole, older ones folded · full — every completed turn as it was sent · window — this session's context window as it stands, the turn running now to its newest round included. Left out, the session's own choice (none unless it sets one). Except window, the current turn's work is never included: put what it needs from it in the brief.",
  ],
]);
const V72_VIEWS = Object.freeze(["none", "aggressive", "moderate", "light", "full", "window", "fork"]);

/**
 * A tool set as version 72 had it, while a sub-agent saw as the session said and seven views were offered: the agent
 * tool's `context` with version 72's views and words, for the tests that weigh older figures. It must carry an agent
 * tool with version 73's.
 * @param {readonly any[]} set
 */
export const asV72Tools = (set) => {
  let moved = false;
  const back = set.map((t) => {
    const context = t?.name === "agent" ? t.input_schema?.properties?.context : null;
    const then = context && V73_CONTEXT.find(([now]) => now === context.description);
    if (!then) return t;
    moved = true;
    const views = V72_VIEWS.filter((v) => v !== "fork" || context.enum.includes("fork"));
    return { ...t, input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, context: { ...context, enum: views, description: then[1] } } } };
  });
  assert.ok(moved, "the set carries the agent tool's context as version 73 has it");
  return back;
};

// Digests gone (version 74, the owner's word of 10-31): filament_recall's words name no digest. Each pair: now, then
// version 73.
const V74_RECALL = Object.freeze([
  "Use it when a folded turn, a stub line or a pointer stands where you need the actual text.",
  "Use it when a digest, a stub line or a pointer stands where you need the actual text.",
]);
const V74_RECALL_TURN = Object.freeze(["The turn number to bring back whole.", "The turn number to bring back whole (t:<n> in digests)."]);

/**
 * A tool set as version 73 had it, while digests stood in for turns: filament_recall's words name them, for the tests
 * that weigh older figures. It must carry filament_recall as version 74 has it.
 * @param {readonly any[]} set
 */
export const asV73Tools = (set) => {
  let moved = false;
  const back = set.map((t) => {
    const turn = t?.name === "filament_recall" ? t.input_schema?.properties?.turn : null;
    if (!turn || !String(t.description).includes(V74_RECALL[0]) || turn.description !== V74_RECALL_TURN[0]) return t;
    moved = true;
    const description = String(t.description).replace(V74_RECALL[0], V74_RECALL[1]);
    return { ...t, description, input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, turn: { ...turn, description: V74_RECALL_TURN[1] } } } };
  });
  assert.ok(moved, "the set carries filament_recall as version 74 has it");
  return back;
};

/**
 * A tool set as version 74 had it, before a task could take up what a Hunter found (the owner's of 11-02): each tasks
 * tool's `found_by` gone, for the tests that weigh older figures. It must carry a tasks tool with it.
 * @param {readonly any[]} set
 */
export const asV74Tools = (set) => {
  let moved = false;
  const back = set.map((t) => {
    const items = t?.name === "tasks" ? t.input_schema?.properties?.tasks?.items : null;
    if (!items?.properties?.found_by) return t;
    const { found_by, ...rest } = items.properties;
    moved = true;
    return { ...t, input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, tasks: { ...t.input_schema.properties.tasks, items: { ...items, properties: rest } } } } };
  });
  assert.ok(moved, "the set carries a tasks tool with found_by");
  return back;
};

/** What version 91 added to the agent's tasks tool (the owner's plan mode of 11-06): a step's sub-tasks, and find. */
const V91_UNDER = " A task may be under a step of yours (under, the step's id): a sub-task, which starts after the step's needs; the step does no work of its own then and takes no check — it runs as its sub-tasks do, is done once they all are, and what needs it waits for them all. Lay out the high-level steps first, and add each one's sub-tasks as you reach it.";
const V91_FIND = "; find — words, and id to look in one task: the lines of the tasks' own words and of what is kept behind them that hold every word, each saying where it is.";
/** …and a plan offered on a card under the reply (the plan mode's piece C): offer, its depth and side_by_side. */
const V91_OFFER = " offer — depth (light, standard or deep) and side_by_side: complex work nobody asked you to plan, offered on a card under your reply — plan it first, or just do it, as the developer chooses; end your reply after it.";
/**
 * A tool set as version 90 had it, before a task could be under a step, the graph could be searched and a plan offered
 * (the owner's plan mode of 11-06): each tasks tool's `under`, `words`, find, offer, `depth` and `side_by_side` gone, its
 * words as they were — for the tests that weigh
 * older figures. A coding agent's, whose words were cut short whole, is not weighed by it. It must carry a tasks tool.
 * @param {readonly any[]} set
 */
export const asV90Tools = (set) => {
  let moved = false;
  const back = set.map((t) => {
    if (t?.name !== "tasks") return t;
    const props = t.input_schema.properties;
    assert.ok(props.words && props.action.enum.includes("find"), "the tasks tool carries find");
    moved = true;
    const description = String(t.description).replace(V91_UNDER, "").replace(V91_OFFER, "").replace(`a line each${V91_FIND}`, "a line each.");
    assert.ok(!description.includes("find —") && !description.includes("offer —"), "its words say find and offer");
    const items = props.tasks.items;
    const { under, ...was } = items.properties;
    const id = { ...props.id, description: String(props.id.description).replace(" find: the one task to look in (leave it out for all).", "") };
    const { words, depth, side_by_side, ...rest } = props;
    const kept = { ...rest, id, action: { ...props.action, enum: props.action.enum.filter((/** @type {string} */ a) => a !== "find" && a !== "offer") }, tasks: { ...props.tasks, items: { ...items, properties: was } } };
    return { ...t, description, input_schema: { ...t.input_schema, properties: Object.fromEntries(Object.keys(rest).map((k) => [k, /** @type {any} */ (kept)[k]])) } };
  });
  assert.ok(moved, "the set carries a tasks tool");
  return back;
};

// A graph task's work waits for its apply (version 76, the owner's of 11-02): the apply_changes of the agent tool and of
// a lead's worker tool say so after what they said. Each: the sentence version 76 added.
const V76_APPLY = Object.freeze({
  agent: " A task graph's sub-agent's work waits for this apply — Filament never writes it into your folder itself — and the tasks that need it wait too: the call answers once the change is in, and Filament's check of your folder with it reaches you as a message.",
  worker: " A task graph's worker's change waits for this apply, and the tasks that need it wait too: the call answers once the change is in, and Filament's check of the folder with it reaches you as a message.",
});
// …and the agent's graph section says a task is ready and waits for its apply, and that its ends wake it once. Each
// pair: now, then version 75.
const V76_PROMPT = Object.freeze([
  ["and briefs it from these fields and from what the tasks it needs reported: you do not start or finish it.", "briefs it from these fields and from what the tasks it needs reported, and merges its change into your folder when it reports done with its check passed: you do not start or finish it."],
  [
    "\n- A sub-agent's task that reports done with its check passed is ready: its change waits in its own worktree, never written into your folder by Filament, and the tasks that need it wait for its apply. Apply it when you choose — agent with its agent_id and apply_changes: true. The call answers once the change is in your folder; Filament then checks your folder with it, undoes it if it breaks the check, and its verdict reaches you as a message.",
    "",
  ],
  ["reaches you as a message from Filament — at once where another task waits on it, the rest once for all of them when the graph's sub-agents are done — and your turn does not end while one runs: to wait,", "reaches you as a message from Filament, and your turn does not end while one runs — to wait,"],
  // A lead's: its apply of a ready change is an order under Validate.
  [" Under Validate that apply is an order too, and waits for the developer's yes as your launches do.", ""],
]);

/**
 * A tool set as version 75 had it, before a graph task's work waited for its apply (the owner's of 11-02): the agent
 * tool's and the worker tool's apply_changes without the sentence that says so, for the tests that weigh older figures.
 * It must carry one of them.
 * @param {readonly any[]} set
 */
export const asV75Tools = (set) => {
  let moved = false;
  const back = set.map((t) => {
    const apply = t?.name === "agent" || t?.name === "worker" ? t.input_schema?.properties?.apply_changes : null;
    const added = apply ? V76_APPLY[/** @type {"agent" | "worker"} */ (t.name)] : "";
    if (!apply || !String(apply.description).endsWith(added)) return t;
    moved = true;
    return { ...t, input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, apply_changes: { ...apply, description: String(apply.description).slice(0, -added.length) } } } };
  });
  assert.ok(moved, "the set carries an apply_changes as version 76 has it");
  return back;
};

/**
 * A tool set as version 79 had it, before the lsp tool came after the hands (the owner's LSP of 11-04), for the tests
 * that weigh older figures. It must carry it.
 * @param {readonly any[]} set
 */
export const asV79Tools = (set) => {
  assert.ok(set.some((t) => t?.name === "lsp"), "the set carries the lsp tool as version 80 has it");
  return set.filter((t) => t?.name !== "lsp");
};

/** What version 87 took from the agent line and a coding agent's rules: a session's count (the owner's of 11-05). */
export const V87_COUNT = "A session runs only so many at once: every launch's result ends with how many run and how many more you can start. Past the limit a launch is refused: wait for one to report.";
/**
 * Version 125's words (the owner's of 11-14: while Parallelize tasks is off, the person's card holds a sub-agent that
 * changes files), and as version 124 had them: the agent line's lone piece, the three tries' hold, and the main agent's
 * line on the hold after the three ways its sub-agents pay.
 */
const V125_WORDS = Object.freeze([
  [`\n${PROMPT.parallelOff}`, ""],
  [" A lone piece you would only wait on, do yourself.", ""],
  [", and while Parallelize tasks is off they are held on the person's card.", "."],
]);
/** @param {string} s */
const v124Words = (s) => V125_WORDS.reduce((t, [now, then]) => t.split(now).join(then), s);
/**
 * A system prompt as version 86 had it, before Filament capped nothing of its own (the owner's of 11-05): the agent
 * line with a session's count, for the tests that weigh older figures — and, first of all, version 125's words as
 * version 124 had them, which end the agent line. It must carry the agent line.
 * @param {string} s
 */
export const asV86Prompt = (s) => {
  const end = "or a job whose sub-agent would need this whole conversation to do it.";
  const was = v124Words(s);
  assert.ok(was.includes(end), "the prompt carries the agent line as version 87 words it");
  return was.replace(end, `${end} ${V87_COUNT}`);
};

/** What an effort field left out ran at before version 87, and what it runs at since: the main agent's (the owner's of 11-05). */
const V87_EFFORT = Object.freeze({ was: "Left out: the developer's choice for this session, max unless they set another.", is: "Left out: the main agent's effort." });
/**
 * A tool set as version 86 had it, before a launch that names no effort ran at the main agent's (the owner's of 11-05):
 * every effort field in the developer's choice's words, for the tests that weigh older figures. It must carry one.
 * @param {readonly any[]} set
 */
export const asV86Tools = (set) => {
  let moved = false;
  const back = set.map((t) => {
    const effort = t?.input_schema?.properties?.effort;
    if (!effort || !String(effort.description).endsWith(V87_EFFORT.is)) return t;
    moved = true;
    return { ...t, input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, effort: { ...effort, description: String(effort.description).slice(0, -V87_EFFORT.is.length) + V87_EFFORT.was } } } };
  });
  assert.ok(moved, "the set carries an effort field as version 87 words it");
  return back;
};

/** What version 81 added to the envelope tool's words: letters inside a chat (the owner's of 11-04), and where. */
const V81_ENVELOPE = Object.freeze({
  text: [" Inside this chat as well: to, a sub-agent of yours that runs, by its id, which reads it whole at its next step; or, as a sub-agent, to: \"lead\", the agent that launched you, which finds it sealed.", " — to a sub-agent, it comes whole."],
  to: " Or inside this chat: a sub-agent of yours that runs, by its id (sa_…); as a sub-agent, \"lead\" — the agent that launched you.",
});
/**
 * A tool set as version 80 had it, before letters went between an agent and its sub-agents (the owner's of 11-04): the
 * envelope tool's words without them, for the tests that weigh older figures. It must carry the envelope as version 81
 * words it.
 * @param {readonly any[]} set
 */
export const asV80Envelope = (set) => {
  const env = set.find((t) => t?.name === "envelope");
  assert.ok(env && V81_ENVELOPE.text.every((s) => env.description.includes(s)) && env.input_schema.properties.to.description.includes(V81_ENVELOPE.to), "the set carries the envelope as version 81 words it");
  return set.map((t) =>
    t?.name !== "envelope"
      ? t
      : {
          ...t,
          description: V81_ENVELOPE.text.reduce((s, x, i) => s.replace(x, i === 1 ? "." : ""), t.description),
          input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, to: { ...t.input_schema.properties.to, description: t.input_schema.properties.to.description.replace(V81_ENVELOPE.to, "") } } },
        },
  );
};

/** What version 82 added to the envelope tool: a sub-agent's wait for a letter's reply (the owner's of 11-04). */
const V82_ENVELOPE = " — with reply: true and wait, its seconds, the call waits for the reply and gives it as its result, unless a message comes first";
/**
 * A tool set as version 81 had it, before a sub-agent's letter to "lead" could wait for its reply: the envelope tool's
 * words without the wait, and no `wait` field, for the tests that weigh older figures. It must carry the envelope as
 * version 82 has it.
 * @param {readonly any[]} set
 */
export const asV81Envelope = (set) => {
  const env = set.find((t) => t?.name === "envelope");
  assert.ok(env && env.description.includes(V82_ENVELOPE) && env.input_schema.properties.wait, "the set carries the envelope as version 82 has it");
  return set.map((t) => {
    if (t?.name !== "envelope") return t;
    const { wait, ...properties } = t.input_schema.properties;
    return { ...t, description: t.description.replace(V82_ENVELOPE, ""), input_schema: { ...t.input_schema, properties } };
  });
};

/** web_search as version 83 had it, before it took several searches at once (the owner's of 11-05). */
const V83_WEB_SEARCH = Object.freeze({
  name: "web_search",
  description:
    "Search the web: the query goes to the configured search endpoint and the first results come back as title, URL and snippet. Read a result with web_fetch before relying on it.",
  input_schema: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string" },
      limit: { type: "number", description: "Maximum results (default 8, at most 20)." },
    },
  },
});
/**
 * A tool set as version 83 had it, before web_search took several searches at once ("queries") and a search service
 * with the person's key: its web_search as it was, for the tests that weigh older figures. It must carry web_search as
 * version 84 has it.
 * @param {readonly any[]} set
 */
export const asV83WebSearch = (set) => {
  assert.ok(set.some((t) => t?.name === "web_search" && t.input_schema?.properties?.queries), "the set carries web_search as version 84 has it");
  return set.map((t) => (t?.name === "web_search" ? V83_WEB_SEARCH : t));
};

// A lead answers its workers with fields (version 92, the memory plan's a2: nothing reads words for a yes): the worker
// tool's answer reads no yes or go from its words, a lead that reads along gains allow and go beside it, and the agent
// tool's plan_review says go: true. Each pair: now, then version 91.
const V92_ANSWER = Object.freeze([
  "With ask — and allow or go where they fit, nothing else — to a running worker that waits: to its call, what to do; to its question to you, your answer; to its plan, your words on it.",
  "With ask, and nothing else, to a running worker that waits: to its call, yes to run it or what to do instead, which refuses it; to its question to you, your answer; to its plan, go to let it start, or your corrections.",
]);
const V92_PLAN_REVIEW = Object.freeze(["Answer it with go: true to let it start, or with your corrections and no go.", "Answer go to let it start, or your corrections."]);
/**
 * A lead's tool set as version 91 had it, before its yes and its go were fields of its answer: the agent tool's
 * plan_review and — for a lead that reads along — the worker tool's answer in their words then, and no allow or go. It
 * must carry plan_review as version 92 words it.
 * @param {readonly any[]} set
 */
export const asV91Tools = (set) => {
  assert.ok(set.some((t) => t?.name === "agent" && String(t.input_schema?.properties?.plan_review?.description).includes(V92_PLAN_REVIEW[0])), "the set carries plan_review as version 92 words it");
  return set.map((t) => {
    const p = t?.input_schema?.properties;
    if (!p || (t.name !== "worker" && t.name !== "agent")) return t;
    const was = Object.entries(p)
      .filter(([k]) => !(t.name === "worker" && (k === "allow" || k === "go")))
      .map(([k, v]) => [k, k === "answer" && v.description === V92_ANSWER[0] ? { ...v, description: V92_ANSWER[1] } : k === "plan_review" ? { ...v, description: String(v.description).replace(V92_PLAN_REVIEW[0], V92_PLAN_REVIEW[1]) } : v]);
    return { ...t, input_schema: { ...t.input_schema, properties: Object.fromEntries(was) } };
  });
};

// The owner's tool plan of 11-08 (version 94): no em dash nor "--" in any tool's words a coding agent may be offered,
// and the texts the loop shares with it moved with them; a few were written anew. Each pair: now, then version 93.
const V94_WORDS = Object.freeze([
  [", copied from your folder as it stands at launch, uncommitted changes included (what you change here after that does not reach it):", ":"],
  // Texts written anew: the report, the envelope and its to and wait, saved_agent, changes, a task's thread, found_by and
  // under, ask_lead's plan, and a team's agent tool's context.
  [
    "End the task of a task graph you were briefed on with this report, once, then end your turn: Filament passes the report on, never your final message, and adds the files you changed and the commands you ran from its own record. Your own planned tasks are done with tasks, never with this.",
    "For an agent doing one task of a task graph, given it in a brief — a planner's own tasks are done with tasks, never with this. End your task with your report — it, not your final message, is what Filament passes on. status: done (the goal is met and the acceptance check passes), blocked (something outside your task stops you — say what in left) or failed; did: what you did, or, for a task that changes nothing, what you found; met: whether the acceptance check passed, with evidence: the check you ran and what it showed; left: what is left, if anything; checked: where your task changes files and has no check, the commands that prove it done, each exactly as you ran it — Filament runs them again as its check. Filament adds the files you changed and the commands you ran, from its own record. Call it once, then end your turn.",
  ],
  [
    "Your mailbox: open the results other agents sent you, and write letters. A result that lands while you work shows as one line (who sent it, what it is about) and waits sealed until you open it here: count (default 1) opens the oldest first, whole; all opens every one. Finish the step you are on first. While you wait, results arrive opened, after the older sealed ones. A picture another agent drew waits sealed under the name its report gives; open only the ones you need. A letter goes out with to, subject and text; reply: true asks for an answer, which comes back to you as a letter. A letter to you stays sealed until you open it, even while you wait; one that asks for a reply gives its id in its last line, for answer.",
    "Open your sealed envelopes: another agent's result that landed while you worked reaches you as one line — who sent it and what it is about — and waits sealed until you open it here. Opens the oldest first, whole, in the order they arrived: count of them (default 1), or all. Finish the step you are on first; while you wait, what arrives comes opened, after the older sealed ones. A picture another agent drew is named in its report and waits sealed too: picture, its name, opens that one alone — read the one you need, not every one. Letters between chats come and go here too: to, subject and text write a letter to another chat — one the developer tagged in this chat, or one that wrote to you — which its agent finds sealed and opens when it chooses; reply: true asks for a reply, which comes back to you as a letter. Inside this chat as well: to, a sub-agent of yours that runs, by its id, which reads it whole at its next step; or, as a sub-agent, to: \"lead\", the agent that launched you, which finds it sealed — with reply: true and wait, its seconds, the call waits for the reply and gives it as its result, unless a message comes first. A letter to you stays sealed until you open it, while you wait too — to a sub-agent, it comes whole. A letter to you that asks for a reply says its id in its last line: answer, that id, and text send your reply.",
  ],
  [
    "Write a letter: to another chat by its id, as its tag [title](chat:<id>) carries it (one the person tagged in this chat, or one that wrote to you; its agent finds it sealed and opens it when it chooses); inside this chat, to a running sub-agent of yours by its id (sa_…), which reads it whole at its next step; or, as a sub-agent, to \"lead\", the agent that launched you, which finds it sealed. With subject and text.",
    "Write a letter to another chat: its id, as its tag [title](chat:<id>) carries it — a chat the developer tagged in this chat, or one that wrote to you. Or inside this chat: a sub-agent of yours that runs, by its id (sa_…); as a sub-agent, \"lead\" — the agent that launched you. With subject and text.",
  ],
  ["As a sub-agent writing \"lead\" with reply: true: seconds to wait for the reply, which then comes as this call's result unless a message comes first (at most 600).", "As a sub-agent writing \"lead\" with reply: seconds to wait for the reply, which then comes as this call's result (at most 600)."],
  [
    "A saved agent of the person's that their newest message names (\"ask Product\", \"the End user's view\"), by its name or tag, in place of subagent_type. It runs and may act as its card says, and sees this session only where its card says so (by default not at all): give it the whole task or question and what it needs, and leave your own leaning out where you want its view. Only one their message names; those you use on your own go in subagent_type.",
    "A saved agent of the developer's that their newest message names — \"ask Product\", \"the End user's view\" — by its name or tag, in subagent_type's place: it runs as its card says and may do what its level says — it sees this session only where its card says so, by default not at all, so give it the whole task or question and what it needs, and leave your own leaning out where you want its view. Only one their message names: those you use on your own are in subagent_type.",
  ],
  [
    "Hand it a change as a patch ahead of your prompt, so you need not paste it: running (what this turn has changed up to its last finished round, for a review of your own work), turn (what the turn before this one changed), uncommitted (everything uncommitted in the folder) or since:<ref> (everything since a commit, tag or branch, as since:v1.2). With agent_id it rides ahead of your follow-up. Left out: none, unless its card says otherwise.",
    "Hand it a change as a patch, ahead of your prompt, so that you need not paste it: running — what you have changed in the turn you are in now, up to its last finished round: the one for a review of your own work · turn — what the turn before this one changed, never this one's · uncommitted — everything uncommitted in the folder · since:<ref> — everything since a commit, tag or branch (since:v1.2). With agent_id it rides ahead of your follow-up (\"check again\"). Left out, it sees none unless its card says otherwise.",
  ],
  ["The open memory thread this task finishes, by its id (i98): once the task is done, Filament closes the thread with the task's summary.", "An open thread of memory this task finishes, by its id as its line shows it (i98): once the task is done, Filament closes the thread with its summary."],
  [
    "The bug hunt whose finding this task takes up, by the id its report gives (sa_4ff20533): the task then needs the task the hunt was fired from, and the Plan page marks it as that hunt's finding.",
    "A bug hunt the developer fired from a task on the Plan, by the id its report gives (sa_4ff20533), whose finding this task takes up: the task needs the one the hunt was fired from, and the Plan marks it as that hunt's finding.",
  ],
  [
    "The step this task is a sub-task of, by its id (one level): it starts after the step's needs; the step takes no check and is done once its sub-tasks are. Lay out steps first, then add each step's sub-tasks as you reach it. \"\" takes it out.",
    "The step of yours it is a sub-task of, by its id: it starts after the step's needs, and the step is done once its sub-tasks are. One level; \"\" takes it out.",
  ],
  [
    "Only while your lead reviews your plan: the plan itself (the files you will change, the steps in order, how you will prove it done), alone, without question or options. Your lead's go to it lets your changes and commands run.",
    "Only while your lead reviews your plan: the plan itself — the files you will change, the steps in order, and how you will prove it done. Alone, without question or options.",
  ],
  [
    "What it sees of this session ahead of its brief, from its last compaction on. Left out: none, the brief alone (the default, and almost always right: a worker handed the conversation takes on its view of it, while one handed only its brief works apart from it, so put the facts it needs in the brief instead). Only for a task about the conversation itself: folded (every turn folded to its words, one line per tool call) or window (this session's context window as it stands, the running turn included). Only window includes the current turn's work.",
    "What it sees of this session ahead of its brief, from its last compaction on. Left out: none — the brief alone, the default and almost always right: a worker handed the conversation takes on its view of it, while one handed only its brief works apart from it, so put the facts it needs in the brief instead. Only where the task is about the conversation itself: folded — every turn folded to its words with one line per tool call · window — this session's context window as it stands, the turn running now to its newest round included. Except window, the current turn's work is never included.",
  ],
  // The tasks tools' words: a lead's, then the pieces every planner's shares (keep, read, find, done, a command task).
  ["Plan your team's work as a graph of tasks: the task graph.", "Plan your team's work as a graph of tasks — the task graph."],
  ["in a copy of the folder, its worker's worktree, once it reports, before its change goes in, so done means they passed;", "in a copy of the folder — its worker's worktree, once it reports, before its change goes in — so done means they passed;"],
  ["waits in the worker's worktree (the tasks that need it waiting too) until you apply it", "waits in the worker's worktree — the tasks that need it waiting too — until you apply it"],
  [
    "Actions: add: tasks, with goal when it starts a graph. change: tasks, each an id and the fields that change, or goal; a task with its worker or in review changes once that ends. start: ids of failed tasks to send back, with note for the worker, which goes on where it stopped (fresh: true for a new one). merge: id and reason, a failed task's change into the folder as it stands. drop: ids and reason. close: reason, the outcome; whatever is still open is dropped. show: the whole graph, or one task by id. done: id and summary,",
    "Actions: add — tasks, with goal when it starts a graph; change — tasks, each an id and the fields that change, or goal — a task with its worker or in review changes once that ends; start — ids of failed tasks to send back, with note for the worker, which goes on where it stopped (fresh: true for a new one); merge — id and reason, a failed task's change into the folder as it stands; drop — ids and reason; close — reason, the outcome, and whatever is still open is dropped; show — the whole graph, or one task by id; done — id and summary,",
  ],
  ["what did not pass is what it was run to find. keep: behind", "what did not pass is what it was run to find; keep: behind"],
  ["keep: behind a task by id, or behind the graph itself with none, a note (", "keep — behind a task by id, or behind the graph itself with none: a note ("],
  ["or forget (titles or file names), kept on disk with the session", "or forget (titles or file names) — kept on disk with the session"],
  ["the graph's words mark what each task keeps. read: id, and title", "the graph's words mark what each task keeps; read — id, and title"],
  ["without a title, what is kept, a line each. find: words, and id", "without a title, what is kept, a line each; find — words, and id"],
  ["what shows that holds (a test's output, a command you ran, what you saw)", "what shows that holds — a test's output, a command you ran, what you saw"],
  ["and ends it: done when every run passed", "and ends it — done when every run passed"],
  // A team's words: its roles, its tasks' by and who, its fields (each member's line, and each saved agent's, below).
  ["with the session's hands and MCP servers: ", "with the session's hands and MCP servers — "],
  ["by (the role of the worker that does it),", "by — the role of the worker that does it —"],
  ["by (the tag of the member that does it),", "by — the tag of the member that does it —"],
  ["writes name; with review: true, ", "writes name — with review: true, "],
  ["The role of its worker, required:", "The role of its worker — required:"],
  ["The member that does it, by its tag, required:", "The member that does it, by its tag — required:"],
  ["reads its change before it merges; the changes it asks go back", "reads its change before it merges — the changes it asks go back"],
  // A lead's agent, worker and waits, and the session's agent's wait while it reads along.
  ["the acceptance check that proves it done (with check, the commands that prove it, which Filament runs itself once the worker reports), the other commands", "the acceptance check that proves it done — with check, the commands that prove it, which Filament runs itself once the worker reports — the other commands"],
  ["and stop: true stops it; its report so far", "and stop: true stops it — its report so far"],
  ["answer, with ask (the number of its question) and nothing else.", "answer, with ask — the number of its question — and nothing else."],
  ["show_trail: true gives a running worker's rounds whole (what it said and called) from from_round on", "show_trail: true gives a running worker's rounds whole — what it said and called — from from_round on"],
  ["show_changes: true gives what a worker has changed in its own git worktree, as a patch: so far", "show_changes: true gives what a worker has changed in its own git worktree, as a patch — so far"],
  ["each follow-up and its report too: the way back to what", "each follow-up and its report too — the way back to what"],
  ["answer, with ask (the number your look gives that question) and nothing else.", "answer, with ask — the number your look gives that question — and nothing else."],
  ["A look (each worker still running, with every round since your last look) follows", "A look — each worker still running, with every round since your last look — follows"],
  ["when one is due (what each said and did since your last look), or else a line for each", "when one is due — what each said and did since your last look — or else a line for each"],
  ["A look (each of them still running, with every round since your last look) follows", "A look — each of them still running, with every round since your last look — follows"],
  ["the seconds pass (default 300, at most 600), and lists the workers still running", "the seconds pass (default 300, at most 600) — and lists the workers still running"],
  ["or the answer it waits for (yours, or the developer's).", "or the answer it waits for — yours, or the developer's."],
  // The saved agents a session's agent or a lead may ask.
  ["it sees of this session only what its card says (by default nothing; context does not apply), may do", "it sees of this session only what its card says — by default nothing (context does not apply) — may do"],
  ["Give it what it needs (the plan or the change, the facts, where to look) and leave", "Give it what it needs — the plan or the change, the facts, where to look — and leave"],
  ["as a launch's report does (this tool's result in the foreground, a message in the background);", "as a launch's report does — this tool's result in the foreground, a message in the background;"],
  ["goal to your question, whole (steps and acceptance are not needed).", "goal to your question, whole — steps and acceptance are not needed."],
  ["only what its card says (by default nothing; context does not apply): the goal carries", "only what its card says — by default nothing (context does not apply): the goal carries"],
  // The fields.
  ["what the work is for, in a sentence; required when", "what the work is for, in a sentence — required when"],
  ["whose change is kept (yours or a sub-agent's);", "whose change is kept — yours or a sub-agent's;"],
  ["runs the task's run itself (no model, no member) once", "runs the task's run itself — no model, no member — once"],
  ["to do, in order: one step per item, at most 20.", "to do, in order — one step per item, at most 20."],
  ["(it reads and reports, with no tests and no builds, and names no writes), or command: Filament runs its run itself (no model) once", "(it reads and reports — no tests, no builds — and names no writes), or command: Filament runs its run itself — no model — once"],
  ["in a copy of the folder, once for each item, {item} filled in.", "in a copy of the folder — once for each item, {item} filled in."],
  ["one run each, up to 500, each one plain word", "one run each, up to 500 — each one plain word"],
  ["find: what to look for; each line found holds every word and says where it is.", "find: what to look for — each line found holds every word."],
  ["offer: the plan you suggest: light", "offer: the plan you suggest — light"],
  ["the ways weighed). The person chooses on the card.", "the ways weighed). The card's choice is theirs."],
  ["its tasks run in parallel, each on a sub-agent.", "its tasks run side by side, each on a sub-agent."],
  ["keep: the note's title, which you read it back by;", "keep: the note's title — what you read it back by;"],
  ["a note's title or a file's name (left out: the list of what is kept).", "a note's title or a file's name (leave it out to list what is kept)."],
  ["keep: the note's words, whole, up to 200,000 characters.", "keep: the note's words, whole — up to 200,000 characters."],
  ["files to copy in (a screenshot, a document, any file up to 10 MB) from your folder", "files to copy in — a screenshot, a document, any file up to 10 MB — from your folder"],
  ["its acceptance holds (a test's output, a command you ran, what you saw). Needed", "its acceptance holds — a test's output, a command you ran, what you saw. Needed"],
  ["where the task stands (what is done, what is next, what to re-read on the way back), kept behind it and handed back", "where the task stands — what is done, what is next, what to re-read on the way back — kept behind it, and handed back"],
  ["a note for its worker, what to do differently.", "a note for its worker — what to do differently."],
  ["a note for its sub-agent, what to do differently.", "a note for its sub-agent — what to do differently."],
  ["working on the task now: what to do instead, and why.", "working on the task now — what to do instead, and why."],
  ["done: the goal is met and the acceptance check passes. blocked: something outside your task stops you; say what in left.", "done: the goal is met and the check passes. blocked: something outside your task stops you — say what in left."],
  ["What you did, whole (for a task that changes nothing, what you found): your report", "What you did — for a task that changes nothing, what you found — whole: your report"],
  [
    "Only where your task changes files and has no check: one to five commands that prove it done, each exactly as you ran it. Filament runs them again in your worktree as the task's check.",
    "Only where your task changes files and has no check: the commands that prove it done — the tests you ran, one to five, each exactly as you ran it. Filament runs them again in your worktree as your task's check.",
  ],
  ["The choice your brief leaves open, or the problem", "The choice your brief does not settle, or the problem"],
  ["read-only; it searches and reads, never changes anything", "read-only — search and read, never change anything"],
  ["or as list_models names it. Left out:", "or as Filament lists it. Left out:"],
  ["the chat sets none; of that one list", "the chat sets none — of that one list"],
  ["none is set (as your instructions name them); of that one list", "none is set — as your instructions name them; of that one list"],
  [". A name two models match, or one that cannot run now, is refused with the reason.", ". A name two models match is refused with both named — never a guess — and one that cannot run now with why: a provider switched off, a coding agent not connected or signed out, its plan used up."],
  ["Who runs that model where several serve it: a provider (OpenRouter, Moonshot) or a coding agent (Codex, Claude Code). Left out:", "Who runs that model, by name — a provider (OpenRouter, Moonshot) or a coding agent (Codex, Claude Code) — where several serve it. Left out:"],
  ["low to max (it runs at the highest level its model takes at or below the one named; the launch's answer says which), or model for its model's own default.", "low to max — it runs at the highest level its model takes at or below the one named, and the launch's answer says which — or model, its model's own default."],
  ["true, instead of a launch: the models ", "true, instead of a launch: list the models "],
  ["can run on now, by provider and coding agent", "can run on now — by provider and coding agent"],
  ["each in a worktree of its own, for a task worth trying", "each in a worktree of its own — for a task worth trying"],
  ["(npm test, node test/money.test.js)", "(npm test, node --test test/money.test.js)"],
  ["(npm run lint, npm run typecheck): the same", "(npx tsc --noEmit, npm run lint): the same"],
  ["or what to answer; it keeps everything", "or what to answer — it keeps everything"],
  ["a question: your answer, what to do and why.", "a question: your answer — what to do, and why."],
  ["With ask (and allow or go where they fit, nothing else), to a running worker", "With ask — and allow or go where they fit, nothing else — to a running worker"],
  ["as its launch answered it, or all, with prompt alone:", "as its launch answered it — or all, with prompt alone:"],
]);
/** One text as version 93 had it: each pair's now as then, and each member's or saved agent's line "`tag` — Name". @param {string} s */
const asV93Words = (s) => V94_WORDS.reduce((x, [now, then]) => x.split(now).join(then), s).replace(/`([^`\s]+)` \(([^()`]+)\)(?=[:.])/g, "`$1` — $2");
/** @param {any} v @returns {any} */
const wordsV93 = (v) => (typeof v === "string" ? asV93Words(v) : Array.isArray(v) ? v.map(wordsV93) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, wordsV93(x)])) : v);
/**
 * A tool set — or any frozen words, as a team's roster words — as version 93 had it, before the owner's tool plan of
 * 11-08 took the em dashes out of the texts a coding agent's tools share with the loop's: every string in it with its
 * version 94 words as they were, for the tests that weigh older figures. It runs before the older helpers, which read
 * version 93's words — and, first of all, takes version 123's words back to version 122's (`asV122`: found_by's hunt,
 * sent from a task, is one of this helper's pairs). It must move something.
 * @template T @param {T} set @returns {T}
 */
export const asV93Tools = (set) => {
  // Version 123's words first, which alone move nothing of this helper's.
  const v122 = asV122(set);
  const back = wordsV93(v122);
  assert.notEqual(JSON.stringify(back), JSON.stringify(v122), "the set carries words version 94 moved");
  return back;
};
/**
 * A tool set as version 94 had it, before both agent tools took `sync` on a follow-up (the owner's list of 11-08): the
 * field taken out wherever it stands, for the tests that weigh older figures. It runs before asV93Tools. It must move
 * something.
 * @template T @param {T} set @returns {T}
 */
export const asV94Tools = (set) => {
  let moved = false;
  /** @param {any} v @returns {any} */
  const back = (v) => {
    if (Array.isArray(v)) return v.map(back);
    if (!v || typeof v !== "object") return v;
    const out = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, back(x)]));
    if (out.properties?.sync?.description === TOOL_TEXT.agentSync) {
      const { sync: _, ...rest } = out.properties;
      out.properties = rest;
      moved = true;
    }
    return out;
  };
  const was = back(set);
  assert.ok(moved, "the set carries version 95's sync");
  return was;
};
/** The sentence version 96 gave filament_recall's words on the list of the chat's turns (the owner's of 11-08). */
const V96_RECALL_LIST = " With neither, it lists this chat's turns: what opened each and its answer's head and end, to find what an earlier turn said was left.";
/**
 * A tool set as version 95 had it, before filament_recall with neither a turn nor a result listed the chat's turns (the
 * owner's of 11-08): its sentence on the list and its `before` taken out, for the tests that weigh older figures. It
 * runs before asV94Tools. It must carry filament_recall as version 96 has it.
 * @param {readonly any[]} set
 */
export const asV95Tools = (set) => {
  let moved = false;
  const back = set.map((t) => {
    if (t?.name !== "filament_recall" || !String(t.description).includes(V96_RECALL_LIST)) return t;
    moved = true;
    const { before: _, ...properties } = t.input_schema.properties;
    return { ...t, description: String(t.description).replace(V96_RECALL_LIST, ""), input_schema: { ...t.input_schema, properties } };
  });
  assert.ok(moved, "the set carries filament_recall as version 96 has it");
  return back;
};

/**
 * The loop's agent tool's run_in_background field and the agent's line on its reports, as version 97 words them (the
 * owner's prompt pass of 11-08: a report reaches the agent as a message, or waits sealed for the envelope tool where
 * Filament's line says so, as a chat's sealing setting has it), and as version 96 had them.
 */
const V97_FIELD = Object.freeze([
  "true (the default): launch it and keep working; its report reaches you as a message when it finishes, or waits sealed for the envelope tool where Filament's line says so, and this turn does not end before it does — to wait for it, call wait. false: wait for the report as this tool's result.",
  "true (the default): launch it and keep working; its report arrives as a message when it finishes, and this turn does not end before it does — to wait for it, call wait. false: wait for the report as this tool's result.",
]);
const V97_LINE = Object.freeze([
  "Their reports reach you as messages from Filament, those of sub-agents the developer launched beside you too; one its line says is sealed waits for the envelope tool.",
  "Messages from Filament about sub-agents carry their reports, including sub-agents the developer launched beside you.",
]);
/**
 * A tool set as version 96 had it, its agent tool's run_in_background field before the prompt pass of 11-08, for the
 * tests that weigh older figures. It runs first of all. It must carry the agent tool as version 97 words it.
 * @param {readonly any[]} set
 */
export const asV96Tools = (set) => {
  let moved = false;
  const back = set.map((t) => {
    const field = t?.name === "agent" ? t.input_schema?.properties?.run_in_background : null;
    if (field?.description !== V97_FIELD[0]) return t;
    moved = true;
    return { ...t, input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, run_in_background: { ...field, description: V97_FIELD[1] } } } };
  });
  assert.ok(moved, "the set carries the agent tool as version 97 words it");
  return back;
};
/** The planning words version 98 says as a rule (the owner's of 11-08), each with how version 97 had it. */
const V98_PLAN = Object.freeze([
  [
    "Before you start work that breaks into more than one step, publish a checklist with the plan tool, and update it as items finish; only a question you answer straight, or a single step, needs none. Never do work of more than one step without it: the developer follows the work by it, live. Do not narrate a todo list in prose.",
    "For anything beyond one step, publish a checklist with the plan tool first and update it as items finish; the developer watches it live. Do not narrate a todo list in prose.",
  ],
  [
    "Before you start work that breaks into more than one step, plan it, and keep the plan up to date as the work moves: steps you take yourself one after another on the plan tool's checklist; work that branches (a step with steps of its own), or whose pieces need one another or can run side by side, runs on over many turns, or keeps notes, files and whole documents behind its tasks, on the tasks tool's graph (below). Only a question you answer straight, or a single step, needs neither; never do work of more than one step with neither: the developer follows the work by them, live. Do not narrate a todo list in prose.",
    "For anything beyond one step, plan before you start — a short job, steps you take yourself one after another, on the plan tool's checklist; complex work on the tasks tool's graph (below): pieces that need one another or can run side by side, work that runs on over many turns, or work that keeps notes, files and whole documents behind its tasks — and keep it up to date as the work moves; the developer watches both live. A question you answer straight needs neither. Do not narrate a todo list in prose.",
  ],
  [
    "Before you start work that breaks into more than one step, publish a checklist with the plan tool, and update it as items finish: its items are tasks on your task graph (below), and work that branches (a step with steps of its own) goes on the graph with the tasks tool, its steps as sub-tasks under it. Only a question you answer straight, or a single step, needs neither; never do work of more than one step with neither: the developer follows the work by them, live. Do not narrate a todo list in prose.",
    "For anything beyond one step, publish a checklist with the plan tool first and update it as items finish: its items are tasks on your task graph (below). The developer watches it live. Do not narrate a todo list in prose.",
  ],
  ["Beyond your checklist, work that branches goes on it, its steps as sub-tasks under a step; nothing else has to.", "Nothing beyond your checklist has to go on it."],
  ["Complex work nobody asked you to plan — work that branches, pieces that need one another", "Complex work nobody asked you to plan — pieces that need one another"],
  [" Just do it skips planning first, never the checklist or the graph: the work goes on them as you do it. Small work you just do, on the checklist where it takes more than one step.", " Small work you just do."],
]);
/**
 * A system prompt as version 97 had it, its planning words before they were said as a rule (the owner's of 11-08), for
 * the tests that weigh older figures. It runs first of all. It must carry them as version 98 words them.
 * @param {string} text
 */
export const asV97Prompt = (text) => {
  const back = V98_PLAN.reduce((s, [now, was]) => s.split(now).join(was), text);
  assert.notEqual(back, text, "the prompt carries its planning words as version 98 says them");
  return back;
};
/** A system prompt as version 96 had it, the agent's line on its reports before the prompt pass. @param {string} text */
export const asV96Prompt = (text) => {
  const back = text.replace(V97_LINE[0], V97_LINE[1]);
  assert.notEqual(back, text, "the prompt carries the agent's line as version 97 words it");
  return back;
};

// The loop's tool texts that the code had moved past (version 99): the agent tool (the loop's and a coding agent's), its
// waits, the browser, web_fetch and bash's and bash_background's command say what the code does; the prompt's line on
// the agent tool names what a sub-agent goes without, as the tool does. Each as version 98 had it.
/** The agent tool's first line as version 98 had it, up to what a sub-agent is (asV37 reads it after asV98Tools). */
const V98_AGENT_HEAD = "Launch a sub-agent for one task: another agent — on the model you name, else as the developer chose for this session — with its own context and your tools except ask, plan and agent, working until the task is done.";
/** The texts version 99 moved, each now and as version 98 had it: whole, or the part that moved. */
const V99_WORDS = Object.freeze([
  [
    "Launch a sub-agent for one task: another agent, on the model you name or else as the developer chose for this session, with its own context and your tools except ask, plan, tasks, agent, wait and the chat's own team, flow, skill_craft and come_back, working until the task is done.",
    V98_AGENT_HEAD,
  ],
  [
    "In the background (the default) you keep working: its report reaches you as a message when it finishes, or waits sealed for the envelope tool where Filament's line says so, and this turn does not end before it does. To wait for it, call wait (never sleep or poll).",
    "In the background (the default) you keep working and the report arrives as a message when it finishes — this turn does not end before it does; to wait for it, call wait (never sleep or poll).",
  ],
  ["(what you change here after that reaches it only with a follow-up's sync)", "(what you change here after that does not reach it)"],
  [
    "returns the moment one of them reports, the developer sends you a message, or the seconds pass (default 300, at most 600). Then the results still sealed open, oldest first, and what came follows them whole, as a message.",
    "returns the moment one of them reports (its report arrives as a message), the developer sends you a message, or the seconds pass (default 300, at most 600).",
  ],
  [
    "returns the moment one of them reports, a look at your graph's sub-agents is due, the developer sends you a message, or the seconds pass (default 300, at most 600). Then the results still sealed open, oldest first, and what came follows them whole, as a message.",
    "returns the moment one of them reports (its report arrives as a message), a look at your graph's sub-agents is due, the developer sends you a message, or the seconds pass (default 300, at most 600).",
  ],
  ["Looking (navigate, back, forward, reload, snapshot,", "Looking (navigate, snapshot,"],
  [
    "At most 24,000 bytes per call, all told, and 20 seconds: a longer page is cut where the bytes run out, and the cut names the character offset to continue from.",
    "At most 24,000 bytes of text per call (the cut is marked with the offset to continue from) and 20 seconds.",
  ],
  ["Where to continue a long page, in characters of its text (0-based), as the cut names it.", "Character offset to continue a long page from (0-based)."],
]);
/** bash's and bash_background's command as version 99 words it; version 98 said nothing of it. */
const V99_COMMAND = Object.freeze({ bash: "The command to run, in that shell's syntax.", bash_background: "The command to run, in the syntax of the shell bash runs." });
/**
 * A tool set, or any value that holds tools, as version 98 had it, before the loop's tool texts said what the code does
 * (version 99): every text above as it was, and bash's and bash_background's command with no words — for the tests that
 * weigh older figures. It runs first of all. It must move something.
 * @template T @param {T} set @returns {T}
 */
export const asV98Tools = (set) => {
  let moved = false;
  /** @param {any} v @returns {any} */
  const back = (v) => {
    if (typeof v === "string") {
      const was = V99_WORDS.reduce((s, [now, then]) => s.split(now).join(then), v);
      if (was !== v) moved = true;
      return was;
    }
    if (Array.isArray(v)) return v.map(back);
    if (!v || typeof v !== "object") return v;
    const out = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, back(x)]));
    const props = out.input_schema?.properties;
    const said = /** @type {Record<string, string>} */ (V99_COMMAND)[out.name];
    if (said && props?.command?.description === said) {
      const { description: _, ...command } = props.command;
      out.input_schema = { ...out.input_schema, properties: { ...props, command } };
      moved = true;
    }
    return out;
  };
  const was = back(set);
  assert.ok(moved, "the set carries the loop's tools as version 99 words them");
  return was;
};
/** The agent's line on the agent tool as version 99 words what a sub-agent runs with, and as version 98 had it. */
const V99_AGENT_LINE = Object.freeze([
  "each runs with its own context and your tools except ask, plan, tasks, agent, wait and the chat's own team, flow, skill_craft and come_back, and you get back",
  "each runs with its own context and your tools, and you get back",
]);
/**
 * A system prompt as version 98 had it, before its line on the agent tool named the tools a sub-agent goes without, as
 * the tool does (version 99), for the tests that weigh older figures: only the agent's own prompt carries that line. It
 * runs first of all. It must move something.
 * @param {string} text
 */
export const asV98Prompt = (text) => {
  const back = text.split(V99_AGENT_LINE[0]).join(V99_AGENT_LINE[1]);
  assert.notEqual(back, text, "the prompt carries the agent tool's line as version 99 words it");
  return back;
};

// An apply that overlaps the folder's edits offers a way on (version 100, the owner's of 11-09): both agent tools take
// overlap beside apply_changes, a lead's worker send_back alone, and each apply_changes says what it does. Each as
// version 99 had it.
/** Each apply_changes as version 100 words it — the loop's agent tool's, a coding agent's, a lead's worker's — and as version 99 had it. */
const V100_APPLY = Object.freeze([
  [
    "With agent_id: apply the changes that sub-agent made in its own git worktree to your folder, instead of a follow-up (no prompt needed). A file changed here meanwhile is merged with its change; where changes overlap, overlap says what happens, and left out nothing is applied and the result names the files.",
    "With agent_id: apply the changes that sub-agent made in its own git worktree to your folder, instead of a follow-up (no prompt needed). A file changed here meanwhile is merged with its change; if any change overlaps, nothing is applied and the result names the files.",
  ],
  [
    "With agent_id and no prompt: apply the changes that sub-agent made in its own git worktree to your folder. A file changed here meanwhile is merged with its change; where changes overlap, overlap says what happens, and left out nothing is applied and the result names the files.",
    "With agent_id and no prompt: apply the changes that sub-agent made in its own git worktree to your folder. A file changed here meanwhile is merged with its change; if changes overlap, nothing is applied and the result names the files.",
  ],
  ["if any change overlaps, nothing is applied and the result names the files, unless overlap sends it back.", "if any change overlaps, nothing is applied and the result names the files."],
]);
/** The overlap fields version 100 added: both agent tools' and a lead's worker's, by their words. */
const V100_OVERLAP = Object.freeze([
  "With apply_changes: what to do with the files where its change overlaps edits in your folder, which otherwise stop the whole apply. markers: apply it all, each of those files written with git's conflict markers for you to resolve. mine: apply the rest and keep your version of those files; the result says how to read its change to them. send_back: apply nothing, and it redoes its change on your folder as it stands, its report coming again. A task graph's change takes none of them.",
  "With apply_changes, where the worker's change overlaps edits in your folder, which otherwise stop the whole apply: send_back sends it back to redo its change on the folder as it stands, its report coming again as a message. A task graph's change takes none.",
]);
/**
 * A tool set, or any value that holds tools, as version 99 had it, before an apply that overlaps the folder's edits
 * offered a way on (version 100): each apply_changes in its words then, and no overlap field — for the tests that weigh
 * older figures. It runs first of all, after asV100Tools. It must move something.
 * @template T @param {T} set @returns {T}
 */
export const asV99Tools = (set) => {
  let moved = false;
  /** @param {any} v @returns {any} */
  const back = (v) => {
    if (typeof v === "string") {
      const was = V100_APPLY.reduce((s, [now, then]) => s.split(now).join(then), v);
      if (was !== v) moved = true;
      return was;
    }
    if (Array.isArray(v)) return v.map(back);
    if (!v || typeof v !== "object") return v;
    const props = v.input_schema?.properties;
    if (props?.overlap && V100_OVERLAP.includes(props.overlap.description)) {
      const { overlap: _, ...rest } = props;
      v = { ...v, input_schema: { ...v.input_schema, properties: rest } };
      moved = true;
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, back(x)]));
  };
  const was = back(set);
  assert.ok(moved, "the set carries an apply_changes as version 100 words it");
  return was;
};

// What is still open takes dismiss (version 101, the owner's of 11-09): the envelope tool — the loop's, a coding agent's
// own chat's and a lead's — takes `dismiss`, and its text says so in a sentence at its end. Each as version 100 had it.
/** The envelope's sentence version 101 added, at its text's end. */
const V101_DISMISS_WORDS = " dismiss takes lines of what Filament says is still open that no longer hold, by their ids.";
/** The dismiss field version 101 added, by its words. */
const V101_DISMISS = "Lines of what is still open that no longer hold, by the ids in brackets that end them: Filament stops saying each until what it names changes. A call of its own.";
/**
 * A tool set, or any value that holds tools, as version 100 had it, before the envelope took `dismiss` (version 101):
 * the envelope's text without its sentence on it, and no dismiss field — for the tests that weigh older figures. It runs
 * first of all, after asV101Tools. It must move something.
 * @template T @param {T} set @returns {T}
 */
export const asV100Tools = (set) => {
  let moved = false;
  /** @param {any} v @returns {any} */
  const back = (v) => {
    if (typeof v === "string") {
      const was = v.split(V101_DISMISS_WORDS).join("");
      if (was !== v) moved = true;
      return was;
    }
    if (Array.isArray(v)) return v.map(back);
    if (!v || typeof v !== "object") return v;
    const props = v.input_schema?.properties;
    if (props?.dismiss?.description === V101_DISMISS) {
      const { dismiss: _, ...rest } = props;
      v = { ...v, input_schema: { ...v.input_schema, properties: rest } };
      moved = true;
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, back(x)]));
  };
  const was = back(set);
  assert.ok(moved, "the set carries the envelope as version 101 words it");
  return was;
};
// Writes as a forecast (version 102, the owner's of 11-09): the graph refuses no two tasks that could run at once
// writing one file, a running task's needs and by may change, and an add's new task takes needed_by. Each as version
// 100 had it.
/** Each tasks tool's clause as version 102 words it — the loop's, its reads', a lead's, a coding agent's — and as version 101 had it. */
const V102_TASKS = Object.freeze([
  [
    "Refused in words: a start before a task's needs are done, a need that is no task, and needs that go round in a loop; two tasks that could run at once may write the same file.",
    "Refused in words: a start before a task's needs are done, a need that is no task, needs that go round in a loop, and two tasks that could run at once writing the same file.",
  ],
  [
    "Refused in words: a need that is no task and needs that go round in a loop; two tasks that could run at once may write the same file.",
    "Refused in words: a need that is no task, needs that go round in a loop, and two tasks that could run at once writing the same file.",
  ],
  ["each an id and the fields that change (a running task's needs and by too), or goal;", "each an id and the fields that change (a running task keeps its needs), or goal;"],
  ["change: each an id and the fields that change; a running task's needs too.", "change: each an id and the fields that change; a running task keeps its needs."],
  ["relative to the working folder. Two tasks that could run at once may write the same file.", "relative to the working folder. Two tasks that could run at once may not write the same file."],
]);
/** The agent tool's and a lead's worker tool's overlap sentence on a task graph's change as version 102 words it, and as version 101 had it. */
const V102_OVERLAP = Object.freeze([
  [" A task graph's change takes them too; given none, it goes back by itself, twice at most.", " A task graph's change takes none of them."],
  [" A task graph's change takes it too, and goes back by itself, twice at most.", " A task graph's change takes none."],
]);
/** needed_by's words as version 102 adds it to each tasks tool's task. */
const V102_NEEDED_BY = "add: the ids of existing tasks that then need this new one.";
/**
 * A tool set, or any value that holds tools, as version 101 had it, before writes became a forecast (version 102):
 * each tasks tool's clauses in their words then, and no needed_by on a task — for the tests that weigh older figures.
 * It runs first of all, after asV102Tools. It must move something.
 * @template T @param {T} set @returns {T}
 */
export const asV101Tools = (set) => {
  let moved = false;
  /** @param {any} v @returns {any} */
  const back = (v) => {
    if (typeof v === "string") {
      const was = [...V102_TASKS, ...V102_OVERLAP].reduce((s, [now, then]) => s.split(now).join(then), v);
      if (was !== v) moved = true;
      return was;
    }
    if (Array.isArray(v)) return v.map(back);
    if (!v || typeof v !== "object") return v;
    if (v.properties?.needed_by?.description === V102_NEEDED_BY) {
      const { needed_by: _, ...rest } = v.properties;
      v = { ...v, properties: rest };
      moved = true;
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, back(x)]));
  };
  const was = back(set);
  assert.ok(moved, "the set carries a tasks tool, or an apply's overlap, as version 102 words it");
  return was;
};
/** The agent's, a lead's and a coding agent's graph line on what Filament refuses as version 102 words it, and as version 101 had it. */
const V102_LINES = Object.freeze([
  [
    "a need that is no task, and needs that go round in a loop (two tasks that could run at once may write the same file): fix the graph",
    "a need that is no task, needs that go round in a loop, and two tasks that could run at once writing the same file: fix the graph",
  ],
  [
    "a need that is no task and needs that go round in a loop (two tasks that could run at once may write the same file): fix the graph",
    "a need that is no task, needs that go round in a loop, and two tasks that could run at once writing the same file: fix the graph",
  ],
]);
/**
 * A system prompt as version 101 had it, before writes became a forecast (version 102): its graph line on what Filament
 * refuses in its words then, for the tests that weigh older figures. It runs first of all, after asV102Prompt. It must
 * move something.
 * @param {string} text
 */
export const asV101Prompt = (text) => {
  const back = V102_LINES.reduce((s, [now, then]) => s.split(now).join(then), text);
  assert.notEqual(back, text, "the prompt carries its graph line as version 102 words it");
  return back;
};

// Sub-agents flexible, and the graph's words given their freedom (version 103, the owner's of 11-09, g3b): a follow-up to
// one still at work goes as a message, a coding agent's follow-up may name a task, writes is said as a forecast apart
// from what is refused, and the graph's lines say to plan by needs. Each as version 102 had it.
/** Each tool's clause as version 103 words it — the tasks tools', both agent tools' agent_id, a coding agent's task — and as version 102 had it. */
const V103_TOOLS = Object.freeze([
  [
    "Refused in words: a start before a task's needs are done, a need that is no task, and needs that go round in a loop. writes is a forecast: tasks that could run at once may share a file, and the one that lands second merges three-way at its apply.",
    "Refused in words: a start before a task's needs are done, a need that is no task, and needs that go round in a loop; two tasks that could run at once may write the same file.",
  ],
  [
    "Refused in words: a need that is no task and needs that go round in a loop. writes is a forecast: tasks that could run at once may share a file, and the one that lands second merges three-way at its apply.",
    "Refused in words: a need that is no task and needs that go round in a loop; two tasks that could run at once may write the same file.",
  ],
  ["and it keeps everything it already read and did; one still at work reads it as a message at its next step.", "and it keeps everything it already read and did."],
  ["the id of your task this launch or follow-up works on.", "the id of your task this launch works on."],
]);
/**
 * A tool set, or any value that holds tools, as version 102 had it, before g3b (version 103): each clause in its words
 * then — for the tests that weigh older figures. It runs first of all, before asV101Tools. It must move something.
 * @template T @param {T} set @returns {T}
 */
export const asV102Tools = (set) => {
  let moved = false;
  /** @param {any} v @returns {any} */
  const back = (v) => {
    if (typeof v === "string") {
      const was = V103_TOOLS.reduce((s, [now, then]) => s.split(now).join(then), v);
      if (was !== v) moved = true;
      return was;
    }
    if (Array.isArray(v)) return v.map(back);
    if (!v || typeof v !== "object") return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, back(x)]));
  };
  const was = back(set);
  assert.ok(moved, "the set carries a tool as version 103 words it");
  return was;
};
// The graph flexible rather than strict (version 104, the owner's of 11-09, g3): a start reopens a done task, done, start
// and drop take several entries, and a drop cuts the need others had. Each as version 103 had it.
/** Each tasks tool's clause as version 104 words it — the agent's, a lead's, the tasks and ids fields — and as version 103 had it. */
const V104_TOOLS = Object.freeze([
  ["or a failed sub-agent's task to send it back, or a done task to reopen it for another round, with note for its sub-agent", "or a failed sub-agent's task to send it back, with note for its sub-agent"],
  ["what did not pass is what it was run to find), or tasks, each an id with its own summary and evidence, to mark several; change —", "what did not pass is what it was run to find); change —"],
  ["drop — ids and reason, a task that needed one losing that need;", "drop — ids and reason;"],
  ["start: ids of failed tasks to send back, or of done ones to reopen for another round, with note for the worker", "start: ids of failed tasks to send back, with note for the worker"],
  ["drop: ids and reason, a task that needed one losing that need.", "drop: ids and reason."],
  [" done, start and drop: several in one call, each an id with its own summary and evidence, note or reason.", ""],
  ["start: tasks whose needs are done, several at once when independent, or done ones to reopen. drop: the tasks; one another needs loses that need.", "start: tasks whose needs are done, several at once when independent. drop: the tasks."],
]);
/**
 * A tool set, or any value that holds tools, as version 103 had it, before g3 (version 104): each clause in its words
 * then — for the tests that weigh older figures. It runs first of all, before asV102Tools. It must move something.
 * @template T @param {T} set @returns {T}
 */
export const asV103Tools = (set) => {
  let moved = false;
  /** @param {any} v @returns {any} */
  const back = (v) => {
    if (typeof v === "string") {
      const was = V104_TOOLS.reduce((s, [now, then]) => s.split(now).join(then), v);
      if (was !== v) moved = true;
      return was;
    }
    if (Array.isArray(v)) return v.map(back);
    if (!v || typeof v !== "object") return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, back(x)]));
  };
  const was = back(set);
  assert.ok(moved, "the set carries a tool as version 104 words it");
  return was;
};
/** The graph's lines as version 103 words them — the agent's, a lead's and a coding agent's, Parallelize tasks' — and as version 102 had them. */
const V103_LINES = Object.freeze([
  [
    "needs that go round in a loop: fix the graph and go on. Plan by what each task needs, not by who owns a file: tasks that write the same file may still run at once.",
    "needs that go round in a loop (two tasks that could run at once may write the same file): fix the graph and go on.",
  ],
  ["each in its own worktree, even two that write one file (the second to land merges), and come back checked", "each in its own worktree, and come back checked"],
  [
    "The graph is kept with the session, and so is what you keep behind it or a task (tasks keep): a compaction loses none of it, so keep there what you will need again (a design, a report you were sent, a decision).",
    "The graph is kept with the session: a compaction loses none of it.",
  ],
  [" Where it overlaps your folder's edits, overlap says what to do; given none, it goes back to its sub-agent to redo on the folder as it stands, twice at most.", ""],
  [" — truly independent: none needs another's work — ", " — truly independent: none needs another's work, and none writes a file another writes — "],
  [" Each works in its own worktree, so they may share a file. Tasks that need each other stay in order.", " Tasks that depend on each other, or share a file, stay in order."],
  [
    "and split the work by what each task needs: workers in their own worktrees may change one file at once (the second apply merges), never two in a folder they share.",
    "and give each file one owner: two workers never change the same file at once.",
  ],
]);
/**
 * A system prompt, or a coding agent's words, as version 102 had them, before g3b (version 103): the graph's lines in
 * their words then, for the tests that weigh older figures. It runs first of all, before asV101Prompt. It must move
 * something.
 * @param {string} text
 */
export const asV102Prompt = (text) => {
  const back = V103_LINES.reduce((s, [now, then]) => s.split(now).join(then), text);
  assert.notEqual(back, text, "the prompt carries a graph line as version 103 words it");
  return back;
};
// The words of the bug hunt of 11-08 (version 105): a lead's graph line says version 98's rule, a lead's words that a
// worker's report may wait sealed, a coding agent's graph words with no line of its reply for its checklist, and the
// envelope sealing unless the chat takes results whole. Each as version 104 had it.
/** A lead's agent tool and the envelope tool as version 105 words them, and as version 104 had them. */
const V105_TOOLS = Object.freeze([
  ["Its report arrives as a message when it finishes, or waits sealed for the envelope tool where Filament's line says so, and this turn", "Its report arrives as a message when it finishes, and this turn"],
  ["write letters. Unless the chat takes results whole, one that lands while you work shows as one line", "write letters. A result that lands while you work shows as one line"],
]);
/**
 * A tool set, or any value that holds tools, as version 104 had it, before the bug hunt's words (version 105): each
 * clause in its words then — for the tests that weigh older figures. It runs first of all, before asV103Tools. It must
 * move something.
 * @template T @param {T} set @returns {T}
 */
export const asV104Tools = (set) => {
  let moved = false;
  /** @param {any} v @returns {any} */
  const back = (v) => {
    if (typeof v === "string") {
      const was = V105_TOOLS.reduce((s, [now, then]) => s.split(now).join(then), v);
      if (was !== v) moved = true;
      return was;
    }
    if (Array.isArray(v)) return v.map(back);
    if (!v || typeof v !== "object") return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, back(x)]));
  };
  const was = back(set);
  assert.ok(moved, "the set carries a tool as version 105 words it");
  return was;
};
// The waits of version 110 (109's follow-up, 11-10): the loop's wait and a lead's wait for the agent's background
// commands too, and background_command says "sleep" for "wait". Each as version 109 had it.
/** The wait tools and background_command as version 110 words them, and as version 109 had them. */
const V110_TOOLS = Object.freeze([
  ["Wait for your background sub-agents and your background commands: returns the moment one of them reports or ends, the developer", "Wait for your background sub-agents: returns the moment one of them reports, the developer"],
  ["Wait for your background sub-agents and your background commands: returns the moment one of them reports or ends, a look", "Wait for your background sub-agents: returns the moment one of them reports, a look"],
  ["which only delay the report. With neither running it returns at once.", "which only delay the report. With no background sub-agent running it returns at once."],
  ["Wait for your workers and your background commands: returns the moment one of them reports (its report arrives as a message) or ends,", "Wait for your workers: returns the moment one of them reports (its report arrives as a message),"],
  ["Wait for your workers and your background commands: returns the moment one of them reports or ends,", "Wait for your workers: returns the moment one of them reports,"],
  ["lists the workers still running instead. With neither running it returns at once.", "lists the workers still running instead. With no worker running it returns at once."],
  ["or else a line for each. With neither running it returns at once.", "or else a line for each. With no worker running it returns at once."],
  ["(yours, or the developer's). With neither running it returns at once.", "(yours, or the developer's). With no worker running it returns at once."],
  ["Do not sleep or poll for it:", "Do not wait or poll for it:"],
]);
/**
 * A tool set, or any value that holds tools, as version 109 had it, before the waits of version 110: each clause in its
 * words then — for the tests that weigh older figures. It runs first of all, before asV104Tools. It must move something.
 * @template T @param {T} set @returns {T}
 */
export const asV109Tools = (set) => {
  let moved = false;
  /** @param {any} v @returns {any} */
  const back = (v) => {
    if (typeof v === "string") {
      const was = V110_TOOLS.reduce((s, [now, then]) => s.split(now).join(then), v);
      if (was !== v) moved = true;
      return was;
    }
    if (Array.isArray(v)) return v.map(back);
    if (!v || typeof v !== "object") return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, back(x)]));
  };
  const was = back(set);
  assert.ok(moved, "the set carries a tool as version 110 words it");
  return was;
};
// The side-by-side card of version 111 (the owner's of 11-10): the agent's and a coding agent's tasks tool has `parallel`,
// its action, its words in the description and in ids'. Each as version 110 had it; a lead's tool has none.
/** The tasks tool's words as version 111 words them, and as version 110 had them. */
const V111_TOOLS = Object.freeze([
  [" parallel — ids of two or more of your ready tasks you judge truly independent, suggested to the developer on a card in the chat whose Accept starts each on a sub-agent; a call's answer names the ones the graph lets run at once.", ""],
  [" parallel: two or more ready tasks you judge truly independent, suggested to the person on a card whose Accept starts each on a sub-agent.", ""],
  [" parallel: the ready tasks you suggest to run at once.", ""],
  ["start, drop, parallel: the tasks.", "start, drop: the tasks."],
]);
/**
 * A tool set, or any value that holds tools, as version 110 had it, before the agent's `parallel` of version 111: the
 * tasks tool's action list without it, and each clause in its words then — for the tests that weigh older figures. It
 * runs first of all, before asV109Tools. It must move something.
 * @template T @param {T} set @returns {T}
 */
export const asV110Tools = (set) => {
  let moved = false;
  /** @param {any} v @param {string} [key] @returns {any} */
  const back = (v, key) => {
    if (typeof v === "string") {
      const was = V111_TOOLS.reduce((s, [now, then]) => s.split(now).join(then), v);
      if (was !== v) moved = true;
      return was;
    }
    if (Array.isArray(v)) {
      if (key === "enum" && v.includes("parallel") && v.includes("add")) {
        moved = true;
        return v.filter((a) => a !== "parallel");
      }
      return v.map((x) => back(x));
    }
    if (!v || typeof v !== "object") return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, back(x, k)]));
  };
  const was = back(set);
  assert.ok(moved, "the set carries a tasks tool as version 111 words it");
  return was;
};
// Version 119 (the nudge map of 11-10): a coding agent's checklist says its items are tasks on its graph (c-mirror), its
// ids say its start action's rule, and come_back says a restart keeps it. Each as version 118 had it — 112 to 118 moved
// none of them —; asV111Tools turns them back first of all.
/** The tools' words as version 119 words them, and as version 118 had them. */
const V119_TOOLS = Object.freeze([
  [" Unless you lead a team, its items are tasks of yours on your task graph (p1, p2, … in the order you first gave them): doing starts one, done ends it.", ""],
  ["start: tasks whose needs are done, as work on each begins (several at once only where sub-agents or commands work them meanwhile), or done ones to reopen.", "start: tasks whose needs are done, several at once where sub-agents or commands work them at once, or done ones to reopen."],
  ["The person's Stop drops it; a restart of Filament keeps it, and one whose time came meanwhile comes once Filament is back.", "The person's Stop drops it, and so does a restart of Filament."],
]);
// Version 120 (the words the fixes of 11-10 and 11-11 left): the plan tool and a coding agent's checklist take `task`, a
// coding agent's agent tool's task names one whose needs are done, and come_back says a goal halted for its time drops
// it. Each as version 119 had it; asV111Tools turns them back first of all, before version 119's.
/** The plan tool's `task`, by its words: the field version 120 gave it, and a coding agent's checklist with it. */
const V120_STEPS_TASK = "The id of a running task you added with the tasks tool: these items are its steps, not tasks of their own.";
/** The tools' words as version 120 words them, and as version 119 had them. */
const V120_TOOLS = Object.freeze([
  ["the id of your task this launch or follow-up works on, one whose needs are done.", "the id of your task this launch or follow-up works on."],
  ["The person's Stop drops it, as does a goal halted for its time; a restart of Filament keeps it,", "The person's Stop drops it; a restart of Filament keeps it,"],
]);
/** Whether a field is the checklist's `task` of version 120. @param {string} key @param {any} field */
const isStepsTask = (key, field) => key === "task" && field?.description === V120_STEPS_TASK;
/**
 * A tool set, or any value that holds tools, as version 119 had it, before version 120's words: each clause in its
 * words then, and no `task` on the plan tool — for the tests that pin a tool whole — and, first of all, before the
 * team tool's send of version 123 (`asV122`) and the agent tools' stop of version 122 (no `stop`, their words as
 * version 121 had them). It must move something.
 * @template T @param {T} set @returns {T}
 */
export const asV119Tools = (set) => {
  let moved = false;
  /** @param {any} v @returns {any} */
  const back = (v) => {
    if (typeof v === "string") {
      // Version 122's words first, which alone move nothing of this helper's.
      const v121 = v121Words(v);
      const was = V120_TOOLS.reduce((s, [now, then]) => s.split(now).join(then), v121);
      if (was !== v121) moved = true;
      return was;
    }
    if (Array.isArray(v)) return v.map(back);
    if (!v || typeof v !== "object") return v;
    const v121 = Object.entries(v).filter(([k, x]) => !isAgentStop(k, x));
    const kept = v121.filter(([k, x]) => !isStepsTask(k, x));
    if (kept.length !== v121.length) moved = true;
    return Object.fromEntries(kept.map(([k, x]) => [k, back(x)]));
  };
  // Version 123's words first of all, which alone move nothing of this helper's.
  const was = back(asV122(set));
  assert.ok(moved, "the set carries a tool as version 120 words it");
  return was;
};
// Version 121 (the words the work of 11-11 left for one change): a team's agents are its workers in what a lead and the
// main agent read — a team of the person's own, a lead's tasks, agent and model fields, the team tool —, the team tool's
// own act is fire, the envelope's `to` names the chat a watcher may guide, the space tool names where a watcher may
// watch, and the steering line names a watcher's guidance. Each as version 120 had it; asV111Tools turns the tools' back
// first of all, before version 120's, and asV116Prompt and asV104Prompt the prompts'.
/** The tools' and the prompts' words as version 121 words them, and as version 120 had them. */
const V121_WORDS = Object.freeze([
  // The steering line.
  [" Guidance from a watcher the developer switched on to review this chat may arrive the same way, or as a message of Filament's that starts a turn: it is no message of the developer's, and Filament's words with it say how to weigh it.", ""],
  // The envelope's `to`, the space tool, the team tool.
  ["(one the person tagged in this chat, one that wrote to you, or the chat your watcher may guide while it is switched on; its agent finds it sealed", "(one the person tagged in this chat, or one that wrote to you; its agent finds it sealed"],
  ["when something happens (in a chat, in the project's files or its repository, in a connection, or where a program posts or prints).", "when something happens (a chat's turn ends, a commit lands, a connection has news)."],
  ["lets this chat's agent fire (", "lets this chat's agent start ("],
  ["but a worker its team names one for", "but a member its team names one for"],
  ["for each worker's kind", "for each member's kind"],
  // A lead's lines and tools, whatever its team.
  ["to a stronger worker, or split it.", "to a stronger member, or split it."],
  ["only for a worker that changes files", "only for a member that changes files"],
  ["Only for a worker that changes files", "Only for a member that changes files"],
  ["which no worker does", "which no member does"],
  ["no model, no worker", "no model, no member"],
  ["Left out: its own where its team names one, else its team's models", "Left out: its member's own where its team names one, else its team's models"],
  ["nor for a worker that changes nothing", "nor for a member that changes nothing"],
  // A team of the person's own (app/agent/roster-words.js).
  ["as one of your team's workers,", "as one member of your team,"],
  ["No worker of your team", "No member of your team"],
  ["have another worker read", "have another member read"],
  ["the worker of your team that does it", "the member of your team that does it"],
  ["Give every task its worker,", "Give every task its member,"],
  ["your team's words for that worker", "your team's words for that member"],
  ["One of your team's workers,", "One of your team's members,"],
  ["The worker that does it, by its tag", "The member that does it, by its tag"],
  ["the tag of the worker that does it", "the tag of the member that does it"],
]);
/** Words as version 120 had them. @param {string} s */
const v120Words = (s) => V121_WORDS.reduce((x, [now, then]) => x.split(now).join(then), s);
/**
 * A tool set, or any value that holds tools or a lead's words, as version 120 had it, before version 121's words — for
 * the tests that weigh older figures with none of the helpers that turn them back first — and, first of all, before
 * version 123's (`asV122`: the team tool's "lets this chat's agent fire (" reads send now). It must move something.
 * @template T @param {T} set @returns {T}
 */
export const asV120Tools = (set) => {
  let moved = false;
  /** @param {any} v @returns {any} */
  const back = (v) => {
    if (typeof v === "string") {
      const was = v120Words(v);
      if (was !== v) moved = true;
      return was;
    }
    if (Array.isArray(v)) return v.map(back);
    if (!v || typeof v !== "object") return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, back(x)]));
  };
  // Version 123's words first of all, which alone move nothing of this helper's.
  const was = back(asV122(set));
  assert.ok(moved, "the set carries a tool as version 121 words it");
  return was;
};
/**
 * A system prompt, or a coding agent's lead's part, as version 120 had it, before version 121's words — and, first of
 * all, before version 123's (`asV122`). It must move something.
 * @param {string} text
 */
export const asV120Prompt = (text) => {
  // Version 123's words first of all, which alone move nothing of this helper's.
  const v122 = asV122(text);
  const back = v120Words(v122);
  assert.notEqual(back, v122, "the prompt carries a line as version 121 words it");
  return back;
};
// Version 122 (ag-stop, the owner's of 11-11): both agent tools — the loop's and a coding agent's — take `stop` with
// agent_id, agent_id's own line names it, and each tool's text says to stop a sub-agent rather than ask it to. Each as
// version 121 had it: no field, neither sentence. asV116Tools turns the loop's back first of all, and asV119Tools a
// coding agent's.
/** The agent tools' `stop`, by its words: the field version 122 gave them. */
const V122_STOP =
  "With agent_id: stop that sub-agent now, alone (no prompt). It stops at once, as the developer's Stop does, whatever it is doing, and no message is sent to it. What it did stays: its report so far comes as its report would, its changes stay where it made them, and a follow-up takes it up again in the context it has. Asked to stop one, stop it: a message asking it to stop is read only at its next step.";
/** The agent tools' words as version 122 words them, and as version 121 had them. */
const V122_WORDS = Object.freeze([
  [" agent_id with stop: true stops one still at work, at once: never ask one to stop by a message, which it reads only at its next step.", ""],
  [" To stop it instead, stop: true.", ""],
]);
/** Words as version 121 had them. @param {string} s */
const v121Words = (s) => V122_WORDS.reduce((x, [now, then]) => x.split(now).join(then), s);
/** Whether a field is an agent tool's `stop` of version 122. @param {string} key @param {any} field */
const isAgentStop = (key, field) => key === "stop" && field?.description === V122_STOP;
// Version 123 (d-send): the team tool's act is send — its action, its description and its fields —, the MCP server's line
// on it says so, and a bug hunt is sent from a task in found_by; its follow-ups, the envelope's `to` names a thread linked
// to the chat, and the shell tools say their command's environment is filtered. Each as version 122 had it, when the act
// was fire. The
// helpers that turn older words back — version 121's, 120's, 119's, 112's and 94's — take these back first of all
// (`asV122`), so their own pairs still find their "now": V121's "lets this chat's agent fire (" and V94's found_by are
// sentences version 123 moved.
/** The tools' words as version 123 words them, and as version 122 had them. */
const V123_WORDS = Object.freeze([
  // The team tool's description, and the MCP server's line on it.
  ["Send a team to work beside this chat, in a chat of its own,", "Fire a team beside this chat, in a chat of its own,"],
  [" Its `team` sends a team to work beside this chat, in a chat of its own,", " Its `team` fires a team beside this chat, in a chat of its own,"],
  ["send starts one (team, ask):", "fire starts one (team, ask):"],
  ["You send only the teams the person lets this chat's agent send (", "You fire only the teams the person lets this chat's agent fire ("],
  ["and which there are to send. ", "and which there are to fire. "],
  // Its fields.
  ["send, status or note.", "fire, status or note."],
  ["send, note: the team, by its key or its name;", "fire, note: the team, by its key or its name;"],
  ["send: what the team is to do, in your words;", "fire: what the team is to do, in your words;"],
  ["send, a bug hunt: what it hunts in:", "fire, a bug hunt: what it hunts in:"],
  ["send: the model its lead runs on,", "fire: the model its lead runs on,"],
  ["send: who serves its lead's model", "fire: who serves its lead's model"],
  ["send: how hard its lead thinks", "fire: how hard its lead thinks"],
  ["send: the model its workers run on,", "fire: the model its workers run on,"],
  ["send: who serves its workers' model,", "fire: who serves its workers' model,"],
  ["send: how hard its workers think,", "fire: how hard its workers think,"],
  // The tasks tools' found_by.
  ["the task then needs the task the hunt was sent from,", "the task then needs the task the hunt was fired from,"],
  // The envelope tool's `to`, both of its forms: a thread linked to this chat, where a letter may go too (V121's pair
  // weighs the same words, so these go back first).
  ["(one the person tagged in this chat, one that wrote to you, a thread linked to this chat, or the chat your watcher may guide while it is switched on;", "(one the person tagged in this chat, one that wrote to you, or the chat your watcher may guide while it is switched on;"],
  // The shell tools' sentence on the filtered environment (adapters/tools/hands.js `ENV_WORDS`): bash, powershell,
  // bash_background, Filament's Bash over MCP and background_command had none.
  [" The command runs with a filtered copy of the environment (what a build needs, no secrets): if it fails for a variable that is missing (a proxy with a password, a licence path, an SDK's home), name the variable and tell the person to add it under Settings › Agent loop › Variables passed to commands.", ""],
]);
/** The team tool's actions as version 123 names them, and as version 122 did. */
const V123_ACTIONS = Object.freeze([Object.freeze(["send", "status", "note"]), Object.freeze(["fire", "status", "note"])]);
/** Words as version 122 had them. @param {string} s */
const v122Words = (s) => V123_WORDS.reduce((x, [now, then]) => x.split(now).join(then), s);
/** Whether a list is the team tool's actions as version 123 names them. @param {readonly unknown[]} v */
const isSendActions = (v) => v.length === V123_ACTIONS[0].length && v.every((x, i) => x === V123_ACTIONS[0][i]);
// Version 129 (the owner's of 11-19): the main agent's agent tools, the loop's and a coding agent's, say to leave the
// model out unless the person asks for one, that a model named only picks a row of the list the person set, and that the
// rows' effort is theirs. Each as version 128 had it. asV122 takes them back first of all, so every helper that runs it
// weighs the agent tools as they were.
/** The agent tools' words as version 129 words them, and as version 128 had them. */
const V129_WORDS = Object.freeze([
  ["The model it runs on: leave it out unless the person asks for a model. Left out: ", "The model it runs on, as you'd say it (Kimi K3, GPT Sol) or as list_models names it. Left out: "],
  [". Where the person set that list, a model named for a launch here only picks one of its rows, on that row's account at its effort, and one off it is refused. Name it as you'd say it (Kimi K3, GPT Sol) or as list_models names it; a name two models match, or one that cannot run now, is refused with the reason.", ". A name two models match, or one that cannot run now, is refused with the reason."],
  [" For a launch here on a list the person set, its order decides instead.", ""],
  [" Where the person set an effort on the list's rows, a launch here runs at it: leave effort out, as another is refused.", ""],
]);
/** A tool set, or any value that holds words, as version 128 had it. Alone it may move nothing. @param {any} v @returns {any} */
const asV128 = (v) =>
  typeof v === "string" ? V129_WORDS.reduce((x, [now, then]) => x.split(now).join(then), v)
  : Array.isArray(v) ? v.map(asV128)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, asV128(x)]))
  : v;
/**
 * A tool set, a prompt, or any value that holds words, as version 122 had it, before the team tool's act was send: each
 * sentence in its words then, and the team tool's actions as they were named — and, first of all, before version 127's
 * attach and version 129's words. The helpers that turn older words back run it first of all; alone it may move nothing.
 * @param {any} v @returns {any}
 */
const asV122 = (v) => v122Of(asV126(asV128(v)));
/** @param {any} v @returns {any} */
const v122Of = (v) =>
  typeof v === "string" ? v122Words(v)
  : Array.isArray(v) ? (isSendActions(v) ? [...V123_ACTIONS[1]] : v.map(v122Of))
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, v122Of(x)]))
  : v;
// Version 127 (the owner's of 11-17): both agent tools take `attach`, files and pictures handed to a sub-agent with a
// launch or a follow-up, after `changes`. Each as version 126 had it: no field. asV122 takes it away first of all, so
// every helper that runs it weighs the agent tools as they were.
/** Whether a field is an agent tool's `attach` of version 127. @param {string} key @param {any} field */
const isAgentAttach = (key, field) => key === "attach" && field?.description === TOOL_TEXT.agentAttach;
/**
 * A tool set, or any value that holds tools, as version 126 had it, before the agent tools' attach. Alone it may move
 * nothing.
 * @param {any} v @returns {any}
 */
const asV126 = (v) =>
  Array.isArray(v) ? v.map(asV126)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k, x]) => !isAgentAttach(k, x)).map(([k, x]) => [k, asV126(x)]))
  : v;
/**
 * A tool set, or any value that holds tools, as version 122 had it (`asV122`) — for a test that weighs the team tool or
 * a tasks tool's found_by as they were. It must move something.
 * @template T @param {T} set @returns {T}
 */
export const asV122Tools = (set) => {
  const was = asV122(set);
  assert.notEqual(JSON.stringify(was), JSON.stringify(set), "the set carries a tool as version 123 words it");
  return was;
};
// A spinner says work goes on (version 112, the owner's of 11-10): the plan tool's and a coding agent's checklist's
// one-doing line; a coding agent's start action and its ids. Each as version 111 had it.
/** The tools' words as version 112 words them, and as version 111 had them. */
const V112_TOOLS = Object.freeze([
  [" One item doing at a time: the one you are on; another only while a sub-agent or a background command works it.", ""],
  ["start: tasks whose needs are done, as work on each begins; several at once only where sub-agents or commands work them meanwhile.", "start: tasks whose needs are done; independent ones start together."],
  ["start: tasks whose needs are done, several at once where sub-agents or commands work them at once, or done ones to reopen.", "start: tasks whose needs are done, several at once when independent, or done ones to reopen."],
  ["start — ids of your own tasks whose needs are done, as work on each begins (several at once only where sub-agents or commands work them meanwhile), or", "start — ids of your own tasks whose needs are done, several at once when they are independent, or"],
]);
/**
 * A tool set, or any value that holds tools, as version 111 had it, before a spinner's words of version 112: each clause
 * in its words then — for the tests that weigh older figures — and, first of all, before version 123's words (`asV122`).
 * It runs first of all, before asV110Tools. It must move something.
 * @template T @param {T} set @returns {T}
 */
export const asV111Tools = (set) => {
  let moved = false;
  /** @param {any} v @returns {any} */
  const back = (v) => {
    if (typeof v === "string") {
      const was = [...V121_WORDS, ...V120_TOOLS, ...V119_TOOLS, ...V112_TOOLS].reduce((s, [now, then]) => s.split(now).join(then), v);
      if (was !== v) moved = true;
      return was;
    }
    if (Array.isArray(v)) return v.map(back);
    if (!v || typeof v !== "object") return v;
    // The plan tool's task, and a coding agent's checklist's, is version 120's: a set from before has none.
    return Object.fromEntries(Object.entries(v).filter(([k, x]) => !isStepsTask(k, x)).map(([k, x]) => [k, back(x)]));
  };
  // Version 123's words first of all, which alone move nothing of this helper's.
  const was = back(asV122(set));
  assert.ok(moved, "the set carries a tool as version 112 words it");
  return was;
};
/** The start lines as version 112 words them — the graph section's and a coding agent's graph block — and as version 111 had them. */
const V112_LINES = Object.freeze([
  ["you start when work on it begins — several at once only where sub-agents or commands work them meanwhile: a started task reads as at work — and mark done", "you start when work on it begins — tasks that do not depend on each other can start together — and mark done"],
  ["Start a task when work on it begins (several at once only where sub-agents or background commands work them meanwhile: a started task reads as at work), and mark it done", "Start a task when work on it begins (tasks that do not depend on each other can start together), and mark it done"],
]);
/**
 * A system prompt, or a coding agent's words, as version 111 had them, before a spinner's words of version 112: the start
 * line in its words then, for the tests that weigh older figures. It runs first of all. It must move something.
 * @param {string} text
 */
export const asV111Prompt = (text) => {
  const back = V112_LINES.reduce((s, [now, then]) => s.split(now).join(then), text);
  assert.notEqual(back, text, "the prompt carries a start line as version 112 words it");
  return back;
};
// The thread tool (version 117, task th3): a harness chat's own agent is offered it, after the flow tool in the loop's
// set, and the agent tool's line and the prompt's name it among the chat's own tools a sub-agent goes without. Each as
// version 116 had it.
/** The clause as version 117 words it, and as version 116 had it. */
const V117_CLAUSE = Object.freeze(["the chat's own team, thread, flow, skill_craft and come_back", "the chat's own team, flow, skill_craft and come_back"]);
/**
 * A tool set, or any value that holds tools, as version 116 had it, before the thread tool: the agent tool's clause in
 * its words then, and no tool named thread in a list — for the tests that weigh older figures — and, first of all,
 * before the team tool's send of version 123 (`asV122`) and the agent tools' stop of version 122 (no `stop`, their
 * words as version 121 had them). It runs first of all. It must move something.
 * @template T @param {T} set @returns {T}
 */
export const asV116Tools = (set) => {
  let moved = false;
  /** @param {any} v @returns {any} */
  const back = (v) => {
    if (typeof v === "string") {
      // Version 122's words first, which alone move nothing of this helper's.
      const v121 = v121Words(v);
      const was = v121.split(V117_CLAUSE[0]).join(V117_CLAUSE[1]);
      if (was !== v121) moved = true;
      return was;
    }
    if (Array.isArray(v)) {
      const kept = v.filter((x) => !(x && typeof x === "object" && x.name === "thread" && x.input_schema));
      if (kept.length !== v.length) moved = true;
      return kept.map(back);
    }
    if (!v || typeof v !== "object") return v;
    // The agent tool's stop is version 122's: a set from before has none.
    return Object.fromEntries(Object.entries(v).filter(([k, x]) => !isAgentStop(k, x)).map(([k, x]) => [k, back(x)]));
  };
  // Version 123's words first of all, which alone move nothing of this helper's.
  const was = back(asV122(set));
  assert.ok(moved, "the set carries the thread tool or the agent tool as version 117 words it");
  return was;
};
/**
 * A system prompt as version 116 had it, before its line on the agent tool named thread among what a sub-agent goes
 * without — and, first of all, before version 121's words (the steering line's guidance). It runs first of all. It
 * must move something.
 * @param {string} text
 */
export const asV116Prompt = (text) => {
  const back = v120Words(text).split(V117_CLAUSE[0]).join(V117_CLAUSE[1]);
  assert.notEqual(back, text, "the prompt carries the agent's line as version 117 words it");
  return back;
};
/** The sentence version 118 gave the agent's graph section: a running task's checklist is its steps (the owner's of 11-11). */
const V118_STEPS = " While a task you added with the tasks tool runs, a checklist that names none of the graph's tasks is that task's steps instead: Filament says them on its box, and makes no task of them.";
/** That sentence's opening as version 120 words it (the task named in `task`, started first), and as version 118 had it. */
const V120_STEPS = Object.freeze([
  " While a task you added with the tasks tool runs (start it first), a checklist that names it in task, or names none of the graph's tasks, is that task's steps instead:",
  " While a task you added with the tasks tool runs, a checklist that names none of the graph's tasks is that task's steps instead:",
]);
/**
 * A system prompt as version 117 had it, before its graph section said a running task's checklist is that task's
 * steps: the sentence read back as version 118 had it, then taken out. It runs first of all, before asV116Prompt. It
 * must move something.
 * @param {string} text
 */
export const asV117Prompt = (text) => {
  const back = text.split(V120_STEPS[0]).join(V120_STEPS[1]).split(V118_STEPS).join("");
  assert.notEqual(back, text, "the prompt carries the graph section as version 118 words it");
  return back;
};
/** The lines as version 105 words them — a lead's graph line and agent line, a coding agent's graph words and its lead's part — and as version 104 had them. */
const V105_LINES = Object.freeze([
  [
    "- Choose for each piece of work before it starts: the graph when it branches (a step with steps of its own) or its pieces depend on each other or could run side by side; the checklist when its steps go one after another; a single step needs neither — launch its worker yourself with the agent tool. Never do work of more than one step with neither.",
    "- Choose for each piece of work: the graph when its pieces depend on each other or could run side by side; a short, straight piece needs none — launch its worker yourself with the agent tool. Nothing has to go on the graph.",
  ],
  ["its report reaches you as a message from Filament when it finishes, or waits sealed for the envelope tool where Filament's line says so; messages from Filament", "its report reaches you as a message from Filament when it finishes; messages from Filament"],
  ["Steps you take yourself one after another go on Filament's checklist tool: never on this graph.", "Steps you take yourself one after another go on Filament's checklist tool, or in a line of your reply where you have none: never on this graph."],
  ["A worker's report that lands while you work reaches you as a message from Filament, or waits sealed for its envelope tool where Filament's line says so.", "A worker's report that lands while you work reaches you as a message from Filament."],
  ["A worker's report or a look that lands while you work reaches you as a message from Filament, a report waiting sealed for its envelope tool where Filament's line says so.", "A worker's report or a look that lands while you work reaches you as a message from Filament."],
]);
/**
 * A system prompt, or a coding agent's words, as version 104 had them, before the bug hunt's words (version 105): each
 * line in its words then, for the tests that weigh older figures — and, first of all, version 121's words as version
 * 120 had them (a lead's steering line, its models line and its team's own lines). It runs first of all, before
 * asV102Prompt. It must move something.
 * @param {string} text
 */
export const asV104Prompt = (text) => {
  const back = V105_LINES.reduce((s, [now, then]) => s.split(now).join(then), v120Words(text));
  assert.notEqual(back, text, "the prompt carries a line as version 105 words it");
  return back;
};

/** bash's and powershell's timeout as version 85 words it (the owner's of 11-05), and as version 85 had it. */
const V86_TIMEOUT = "Seconds to wait for it (default 120, max 600); past them it goes on in the background, and you are told when it exits.";
const V85_TIMEOUT = Object.freeze({ bash: "Seconds before the command is killed (default 120).", powershell: "Seconds before the script is killed (default 120)." });
/**
 * A tool set as version 85 had it, before a command past its timeout went on in the background: bash's and
 * powershell's timeout said it was killed, for the tests that weigh older figures. It must carry bash as version 86
 * words it.
 * @param {readonly any[]} set
 */
export const asV85Shell = (set) => {
  assert.ok(set.some((t) => t?.name === "bash" && t.input_schema.properties.timeout.description === V86_TIMEOUT), "the set carries bash as version 86 words it");
  return set.map((t) => {
    const was = t?.name === "bash" || t?.name === "powershell" ? V85_TIMEOUT[/** @type {"bash" | "powershell"} */ (t.name)] : null;
    if (!was) return t;
    return { ...t, input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, timeout: { ...t.input_schema.properties.timeout, description: was } } } };
  });
};

/**
 * A system prompt as version 75 had it, before a graph task's work waited for its apply: its sub-agents' graph section
 * says Filament merged a change itself. It must carry that section.
 * @param {string} s
 */
export const asV75Prompt = (s) => {
  const back = V76_PROMPT.reduce((p, [now, then]) => p.replace(now, then), s);
  assert.notEqual(back, s, "the prompt carries the graph's section for its sub-agents");
  return back;
};

// A plan asked for alone (version 85, the owner's of 11-05): the agent's graph section gains one bullet — a plan asked
// for alone is made whole, its summary kept behind the graph, none of it started until the developer says go. The prompt
// as version 84 had it: that bullet taken out.
const V85_PLAN_LINE = '\n- Asked for a plan alone — /plan, or words like "plan it out" — make it whole: the checklist for a short job; for complex work, the graph\'s tasks with their needs, writes and checks, and the plan\'s summary kept behind the graph (keep, titled "Plan"). End your reply with that summary, and start none of it until the developer says go.';
// A plan offered first (version 91, the owner's plan mode of 11-06): the agent's graph section gains one bullet after the
// plan asked for alone — complex work nobody asked it to plan is offered on a card, and a plan's turn is read-only.
const V91_OFFER_LINE = "\n- Complex work nobody asked you to plan — pieces that need one another or can run side by side, or work over many turns — you offer to plan first, before you change anything: tasks offer, with the depth you suggest (light, standard or deep) and side_by_side, a line in your reply on why, then end it; Filament shows the developer a card, and the choice is theirs — a plan, or just do it. Small work you just do. While you plan, the turn is read-only: you change nothing but the graph and its notes, and the plan waits for their Approve or Amend.";
/** The agent's prompt as version 90 had it: that bullet taken out. @param {string} s */
export const asV90Prompt = (s) => {
  assert.ok(s.includes(V91_OFFER_LINE), "the prompt carries the graph's offer line");
  return s.replace(V91_OFFER_LINE, "");
};
/** The agent's prompt as version 84 had it. @param {string} s */
export const asV84Prompt = (s) => {
  assert.ok(s.includes(V85_PLAN_LINE), "the prompt carries the graph's plan line");
  return s.replace(V85_PLAN_LINE, "");
};

// A team's lead's orders run at once (version 77, the owner's of 11-03): the lead's lines lose the one on the mode that
// held them for the developer, and its graph's section the two sentences on that mode. Each pair: now, then version 76.
const V77_PROMPT = Object.freeze([
  [
    "\n- You may be taking over a session already under way:",
    "\n- The developer may have your orders — launches, messages and follow-ups to workers, applies — wait for their approval (Validate), or run at once (Autonomous), and may switch at any time. Under Validate the orders of a reply wait as your proposal, its words your reasoning: approved, they run; otherwise each is answered Not run with the developer's words — revise and propose again, or answer them first. A stop never waits.\n- You may be taking over a session already under way:",
  ],
  ["Apply it when you choose — worker with its agent_id and apply_changes: true. The call answers", "Apply it when you choose — worker with its agent_id and apply_changes: true. Under Validate that apply is an order too, and waits for the developer's yes as your launches do. The call answers"],
  ["\n- Filament refuses in words a need that is no task,", "\n- Under Validate your tasks calls that add, change, start or merge wait for the developer as your proposal, like your launches; show, drop and close never wait. Filament refuses in words a need that is no task,"],
]);

/**
 * A system prompt, or a coding agent's part, as version 76 had it for a lead that does not read along: its lines with
 * the one on the mode that held its orders, and its graph's section, where it has one, with that mode's two sentences.
 * It must be a lead's.
 * @param {string} s
 */
export const asV76Prompt = (s) => {
  const back = V77_PROMPT.reduce((p, [now, then]) => p.replace(now, then), s);
  assert.notEqual(back, s, "the prompt carries a lead's lines");
  return back;
};

// The cards that ship as "Teams, improved and kept" of 11-03 left them: Builder and Reviewer hold the agent tool's own
// two places, Helper's and Scout's, and the main agent's three ways its sub-agents pay launch them. No version moved:
// the figures taken before were taken with the cards that shipped then. Each pair: now, then.
const ROSTER_RECIPES = Object.freeze([
  ["launch reviewers in one reply, each with one part", "launch scouts in one reply, each with one part"],
  ["launch a reviewer, which only reads, with changes:", "launch one that only reads — a reviewer where the agent tool lists one, else a scout — with changes:"],
  ["launch three builders in one reply", "launch three helpers in one reply"],
]);
/** The agent tool's own two kinds: now, then. */
const ROSTER_KINDS = Object.freeze([
  ["builder", "helper"],
  ["reviewer", "scout"],
]);

/**
 * A system prompt with the main agent's three ways its sub-agents pay as they named the cards that shipped before the
 * roster shrink: scouts, a scout where no reviewer is listed, helpers. It must carry them.
 * @param {string} s
 */
export const asOldRoster = (s) => {
  const back = ROSTER_RECIPES.reduce((p, [now, then]) => p.replace(now, then), s);
  assert.notEqual(back, s, "the prompt carries the three ways the sub-agents pay");
  return back;
};

/**
 * A tool set whose agent tool names its own two kinds as the cards that shipped before the roster shrink: Helper and
 * Scout, in its kind field's list and words. It must carry an agent tool with Builder and Reviewer there.
 * @param {readonly any[]} set
 */
export const asOldRosterTools = (set) => {
  let moved = false;
  const back = set.map((t) => {
    const kind = t?.name === "agent" ? t.input_schema?.properties?.subagent_type : null;
    if (!kind || JSON.stringify(kind.enum) !== JSON.stringify(ROSTER_KINDS.map(([now]) => now))) return t;
    moved = true;
    const description = ROSTER_KINDS.reduce((d, [now, then], i) => d.replace(i ? ` ${now}: ` : `${now} (the default): `, i ? ` ${then}: ` : `${then} (the default): `), String(kind.description));
    return { ...t, input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, subagent_type: { ...kind, enum: ROSTER_KINDS.map(([, then]) => then), description } } } };
  });
  assert.ok(moved, "the set carries the agent tool with Builder and Reviewer as its own two kinds");
  return back;
};

/** A promise and the hand that settles it. */
export const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

/** A clock the test moves, from 1000 (`to`), and the timers a registry set (`later`), which the test fires. */
export const heldTime = () => {
  let at = 1000;
  /** @type {{ fn: () => void, ms: number }[]} */
  const timers = [];
  return { now: () => at, later: (/** @type {() => void} */ fn, /** @type {number} */ ms) => void timers.push({ fn, ms }), timers, to: (/** @type {number} */ t) => void (at = t) };
};

export const TEAM = { key: "architect", name: "Architect", members: MEMBERS };
/**
 * A team store over a card store of its own, as the server wires the two: the teams that ship, and yours in `dataDir`.
 * @param {{ dataDir?: string | null, log?: (level: string, msg: string) => void, now?: () => number }} [o]
 */
export const teamStore = ({ dataDir = null, log, now } = {}) => {
  /** @type {ReturnType<typeof createTeamStore> | null} */
  let teams = null;
  // An agent and a team never share a name (OA1), as server.js wires the two stores.
  const teamNamed = (/** @type {string} */ name) => teams?.names().find((t) => t.name.toLowerCase() === name.trim().toLowerCase())?.name ?? null;
  const teamKeyed = (/** @type {string} */ tag) => teams?.names().find((t) => t.key === tag)?.name ?? null;
  const cards = createAgentCardStore({ dataDir, ...(log ? { log } : {}), ...(now ? { now } : {}), usedBy: (tag) => teams?.holds(tag) ?? null, teamNamed, teamKeyed, memberNamed: (tag) => teams?.memberNamed(tag) ?? null });
  teams = createTeamStore({ dataDir, cards, ...(log ? { log } : {}), ...(now ? { now } : {}) });
  return Object.assign(teams, { cards });
};
/** A team that ships, as a session is handed it. @param {string} key */
export const shippedTeam = (key) => /** @type {import("../../src/services/teams.js").Team} */ (teamStore().find(key));
export const BRIEF = { role: "builder", description: "Fix the parser", goal: "parse() accepts an empty file", steps: ["Return [] for an empty input"], acceptance: "the parser's tests pass" };

/**
 * One run of a worker, as the scripted host serves it: it attaches when the test says, and ends as the test says — or
 * the host refuses it before its loop runs, in words, the way a host that cannot start answers. A stop before it
 * attaches cuts its request, as fetch does. `body`: what the registry sent its host — its first message among it.
 * A run that failed may say why, in one shape (`failure`, core/failure.js) — on its provider, with its cause.
 * @typedef {{ id: string, runId: string, body: any, attach: () => void, finish: (end: { status: string, report: string, stoppedBy?: string, error?: string, failure?: import("../../src/core/failure.js").Failure }) => void, refuse: (text: string) => void }} HostRun
 */
/**
 * A registry over a folder whose front door is the scripted host. `client`: the session's client — a harness session's
 * workers ask the developer, another client's cannot. `logless`: Filament keeps no run log, so no run has a mailbox.
 * `now` is the registry's clock, and `later` its timer, when a test holds time; what it puts on the events feed is
 * kept in `published`. `runlog`: the run log keeps each run's events, as Filament's does — `log(runId, event)` writes
 * one, numbered, and a message steered into a run is its `steer` event — so a lead can read along with its workers
 * (HarnessV3-TaskGraph-v2 §12). `sub`: the session's own `subagents` settings, over the helper's; `card`: the card
 * store's card for a tag, where it is not a shipped card (TG2-D47: a card may name its model); `facts`: a model's limit
 * and why it cannot run, as the pool reads them (HarnessV4_Tasks E15 step 8); `problem`: why a model cannot run an
 * agent now, as a follow-up and the pool read it where `facts` says nothing (a provider that cannot serve, TG2-D54).
 * `extra`: more of the registry's context — a model named as a person says it, its efforts and the list of models
 * (HarnessV4_Tasks E23: `chooseModel`, `effortOf`, `modelList`); `slots`: each model's number across Filament (core/slots.js);
 * `engine`: the session's own `engine` settings (a Brief's picks for its team's workers); `model`: its own `model`
 * settings (the main agent's effort, which a launch that names none runs at); `rules`: Filament's rules (the effort
 * suffixes a name may spell); `dataDir`: Filament's data folder, which a call's `attach` never reads from;
 * `keptChars`: the ended conversations' budget.
 * @param {{ client?: string, logless?: boolean, runlog?: boolean, now?: () => number, later?: ((fn: () => void, ms: number) => void) | null, sub?: Record<string, unknown>, card?: ((tag: string) => any) | null, facts?: ((model: string) => import("../../src/core/pool.js").ModelFacts) | null, problem?: ((model: string) => string | null) | null, extra?: Record<string, any>, slots?: any[], engine?: Record<string, unknown> | null, model?: Record<string, unknown> | null, rules?: Record<string, unknown> | null, dataDir?: string | null, keptChars?: number }} [o]
 */
export const watched = ({ client = "harness", logless = false, runlog = false, now = () => 1000, later = null, sub = {}, card = null, facts = null, problem = null, extra = {}, slots = [], engine = null, model = null, rules = null, dataDir = null, keptChars = undefined } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-watch-"));
  made.push(dir);
  /** @type {{ runId: string, kind: string, text: string, from: string }[]} */
  const steers = [];
  /** @type {{ chainId: string, request: string }[]} */
  const corrected = [];
  /** @type {string[]} */
  const logs = [];
  /** Why a run's mailbox refuses what is steered into it, while it does. @type {string | null} */
  let refusing = null;
  /** Why memory fails to take a lead's correction, while it does. @type {string | null} */
  let failing = null;
  /** @type {HostRun[]} */
  const served = [];
  /** @type {{ topic: string, e: any }[]} */
  const published = [];
  /** Each run's events, and who reads them as they come. @type {Map<string, { events: any[], readers: Set<(e: any) => void> }>} */
  const kept = new Map();
  /** @param {string} runId */
  const logOf = (runId) => kept.get(runId) || /** @type {any} */ (kept.set(runId, { events: [], readers: new Set() }).get(runId));
  /** One event of a run, as the run log keeps it: its number and time are the log's, over any the payload carried. @param {string} runId @param {any} e */
  const log = (runId, e) => {
    const l = logOf(runId);
    const evt = { ...e, n: l.events.length + 1, ts: now() };
    l.events.push(evt);
    for (const fn of [...l.readers]) fn(evt);
    return evt;
  };
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: { subagents: { slots } }, ...(rules ? { rules } : {}) }),
    log: (level, msg) => logs.push(`${level} ${msg}`),
    events: { publish: (topic, e) => published.push({ topic, e }) },
    runs: logless
      ? null
      : /** @type {any} */ ({
          steer: (/** @type {string} */ runId, /** @type {any} */ m) => {
            if (refusing) return { ok: false, error: refusing };
            steers.push({ runId, kind: m.kind, text: m.text, from: m.from });
            if (runlog) log(runId, { type: "steer", id: `s${steers.length}`, kind: m.kind, text: m.text, from: m.from, at: now(), state: "queued" });
            return { ok: true };
          },
          ...(runlog
            ? {
                events: (/** @type {string} */ runId, /** @type {{ since?: number, limit?: number }} */ { since = 0, limit = 5000 } = {}) => (kept.has(runId) ? { events: logOf(runId).events.filter((e) => e.n > since).slice(0, limit) } : null),
                subscribe: (/** @type {string} */ runId, /** @type {(e: any) => void} */ fn) => {
                  logOf(runId).readers.add(fn);
                  return () => void logOf(runId).readers.delete(fn);
                },
              }
            : {}),
        }),
    now,
    ...(later ? { later } : {}),
    ...(dataDir ? { dataDir } : {}),
    ...(keptChars != null ? { keptChars } : {}),
    context: {
      settings: () => ({ subagents: { pool: [{ model: "", seats: 8 }], worktree: false, ...sub }, loop: { permissions: "edit" }, ...(engine ? { engine } : {}), ...(model ? { model } : {}) }),
      session: () => ({ cwd: dir, model: "m-session", projectId: null, client }),
      ...(card ? { card } : {}),
      ...(facts ? { modelFacts: facts } : {}),
      view: async () => null,
      brief: async () => null,
      modelProblem: problem || (() => null),
      mark: () => null,
      folderProblem: () => null,
      corrected: (o) => {
        if (failing) throw new Error(failing);
        corrected.push(o);
        return 1;
      },
      ...extra,
    },
    call: async ({ body, headers = {}, signal = null }) => {
      const id = String(headers["x-filament-subagent"]);
      const runId = `run-${served.length + 1}`;
      const start = deferred();
      const end = deferred();
      served.push({ id, runId, body, attach: () => start.resolve(), finish: (e) => end.resolve(e), refuse: (text) => start.resolve(text) });
      const cut = new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")), { once: true }));
      const refused = await Promise.race([start.promise, cut]);
      if (typeof refused === "string") return { ok: true, status: 200, json: { content: [{ type: "text", text: refused }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
      registry.attach(id, runId);
      const e = await end.promise;
      registry.finish(id, { status: e.status, error: e.error ?? null, report: e.report, stoppedBy: e.stoppedBy ?? null, ...(e.failure ? { failure: e.failure } : {}), convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: e.report }] }], rounds: 2, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: e.report }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  /** The run the host was asked for nth, once it is. @param {number} n */
  const run = async (n) => {
    await until(() => served.length >= n, `run ${n} to be asked for`);
    return served[n - 1];
  };
  /** From now on, a run's mailbox refuses what is steered into it, with these words. @param {string} why */
  const refuseSteers = (why) => {
    refusing = why;
  };
  /** From now on, memory fails to take a lead's correction, with these words. @param {string} why */
  const failCorrections = (why) => {
    failing = why;
  };
  return { registry, steers, corrected, logs, published, run, dir, refuseSteers, failCorrections, log, readers: (/** @type {string} */ runId) => logOf(runId).readers.size, events: (/** @type {string} */ runId) => [...logOf(runId).events] };
};

/**
 * The lead's turn on a registry — its door, as turn.js opens it for a lead — and the call its wrapper hands the team's
 * tools: plain JSON. `timeline` is what reached the lead's turn. `looks`: the lead reads along with its workers, at
 * this pace in seconds (HarnessV3-TaskGraph-v2 §12) — turn.js hands the registry the same.
 * @param {ReturnType<typeof createSubagentRegistry>} registry @param {string} dir @param {{ looks?: number | null, runId?: string }} [o]
 */
export const leadOf = (registry, dir, { looks = null, runId = "lead-1" } = {}) => {
  /** @type {any[]} */
  const timeline = [];
  const door = registry.openTurn({ chainId: "c1", runId, cwd: dir, mode: null, model: "m-lead", thinking: null, fork: null, emit: (e) => timeline.push(e), lead: true, round: () => 2, looks: looks == null ? null : { seconds: () => looks, head: (sa, at) => watchParts(sa, at, { look: true }) } });
  /** @param {any} input */
  const call = (input) => ({ chainId: "c1", lead: { runId, callId: "toolu_1" }, cwd: dir, mode: null, model: "m-lead", thinking: null, team: TEAM, input, reads: looks != null });
  return { door, call, tools: createTeamTools({ registry }), timeline };
};

/** A worker launched from BRIEF, its run attached. @param {ReturnType<typeof watched>} w @param {ReturnType<typeof leadOf>} l @param {number} [n] */
export const running = async (w, l, n = 1) => {
  const launched = await l.tools.agent(l.call(BRIEF));
  assert.equal(launched.ok, true, launched.text);
  const id = String(launched.agentId);
  const r = await w.run(n);
  r.attach();
  await until(() => w.registry.get(id)?.runId === r.runId, "its run to attach");
  return { id, r };
};
