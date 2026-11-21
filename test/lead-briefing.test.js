// @ts-check
// HarnessV3-TaskGraph-v2 TG2-D46 and TG2-D47 (§13): a brief a cheaper model can follow, one message to all, and a lead
// that sees the models its members run on. A lead's lines say how to brief — what to read first, the commands that
// prove a task done and the others it may run, a task sized for one sitting — and that a report is a claim while a
// check Filament ran is not; its agent tool says the same of the brief's fields. A lead that reads along reaches every
// worker of its running now with one message. One line names its workers' models, each as its launch resolves it — its
// card's, else the session's pool (§13.12) — in either seat. Prompt version 26: the lead's prompt and tools move, the
// session's agent's and a worker's do not. Cases 24 to 27 of §13.7; case 23, the brief's order, is
// brief-grants.test.js's, and the message to all in the lead's own loop is lead-reads.test.js's.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PROMPT, PROMPT_VERSION, TOOL_TEXT, leadLines, systemPromptFor } from "../src/app/agent/prompt.js";
import { rosterWords } from "../src/app/agent/roster-words.js";
import { inputRefusal } from "../src/app/agent/team-tools.js";
import { ATTEMPTS_FIELD, WORKER_READS_OWN_TOOL, WORKER_READS_TOOL, WORKER_TOOL, argSummary, leadToolsOf, loopToolArgs } from "../src/app/agent/tools.js";
import { leadWords } from "../src/app/agent-lead.js";
import { workerWords } from "../src/app/agent-worker.js";
import { shippedCard } from "../src/services/agent-cards.js";
import { asV116Prompt, asV116Tools, asV104Prompt, asV104Tools, asV109Tools, asV110Tools, asV54Prompt, asV54Tools, asV90Tools, asV91Tools, asV67Tools, asV68Tools, asV72Tools, asV74Tools, asV75Prompt, asV75Tools, asV76Prompt, asV79Tools, asV85Shell, asV86Prompt, asV93Tools, asV94Tools, asV96Prompt, asV97Prompt, asV98Prompt, asV96Tools, asV98Tools, asV99Tools, asV101Tools, asV102Tools, asV103Tools, asV102Prompt, BRIEF, DECISION_9_HANDS, OWN_HANDS_LINE, asHelper, asOldRoster, asOldRosterTools, asV36, asV37, asV38, asV38Builder, asV42, asV43, asV45, asV46, asV47, asV48, asV52, asV52Prompt, leadOf, running, watched, asV111Tools } from "./helpers/team.js";
import { MEMBERS } from "./helpers/roster.js";
import { until } from "./helpers/wait.js";

const sha = (/** @type {string} */ s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const ENV = "# Environment\n- the machine";
const LEAD = { name: "Architect", persona: "You lead." };

// The words of §13.5, as the lead reads them — after §13.17's (TG2-D57): it plans the whole work before its first brief.
const PLAN_LINE =
  "- Plan the whole work before your first launch, reading what you need for it: the parts, who does each and in what order, how the parts meet — the names, shapes and files they share — each part's check, and what a worker would trip on. Each brief is one part of that plan, with what it shares with the others and its pitfalls.";
const BRIEF_LINE =
  "- Brief each worker completely: the goal and why, what to read first — the code to imitate, the interfaces to keep — the files it changes, the steps in order, the acceptance check that proves it done, and what not to touch. A worker sees its brief and the context view you give it, nothing else of this conversation; on a cheaper model than yours it does what the brief says and guesses the rest.";
const CHECK_LINE =
  "- Put the commands that prove a task done in check, and the others it needs in may_run: in the worker's own worktree they run without anyone's answer, and Filament runs the check itself once the worker reports — a failing one goes back to the worker, twice at most, before you hear. Where you can, have a failing test written first, and make it the check of the work that makes it pass.";
const SITTING_LINE = "- Size each task for one sitting, and split the work by what each task needs: workers in their own worktrees may change one file at once (the second apply merges), never two in a folder they share. Launch independent tasks together, in one reply.";
const CLAIM_FOUR = "- A report is a claim; a check Filament ran is not. Read every change before you apply it, and check what the report says beyond its check: have a reviewer read the diff, or a tester run more.";
const CLAIM_SEVERAL = "- A report is a claim; a check Filament ran is not. Read every change before you apply it, and check what the report says beyond its check: read what changed, or have another worker read the diff or run the check.";
const CLAIM_ONE = "- A report is a claim; a check Filament ran is not. Read every change before you apply it.";
const ROUTING = "Give the subtle work — a design, a hard bug, a change across many files — to the strongest of them, and move a task that failed twice to a stronger worker, or split it.";
// §13.12's pool of two models, and its words in the line.
const POOL = [{ model: "glm-5.3", seats: 4 }, { model: "glm-5.3-flash", seats: 3 }];
// The workers' list (HarnessV4_Tasks E23-D6): no longer the side agents' pool.
const ON_POOL = "the models the developer lists for your workers, each launch that names none the first free seat in this order — glm-5.3 · glm-5.3-flash";

/** A member of a team of yours, as the team store hands it out. @param {string} tag @param {"read" | "copy" | "edit"} may */
const card = (tag, may) => ({ tag, name: tag[0].toUpperCase() + tag.slice(1), goodFor: `Good at ${tag}`, may, place: null, line: "", model: null });
const CREW = [card("mapper", "read"), card("coder", "edit"), card("checker", "edit")];
/** The four that ship, each on its card's model where `on` names one, else on the pool. @param {Record<string, string>} on */
const cardsOn = (on) => MEMBERS.map((m) => ({ tag: m.tag, model: on[m.tag] ?? null }));
/** The four that ship as the registry's `modelsOf` gives them. @param {Record<string, string>} on @param {{ model: string, seats: number }[]} [pool] */
const fourOn = (on, pool = []) => ({ members: cardsOn(on), pool });
/**
 * A tool set with the lead's agent tool as version 30 had it: without attempts, which version 31 gave it (TG2-D53).
 * @param {readonly any[]} set
 */
const asV30 = (set) => set.map((t) => (t.name === "agent" && t.input_schema?.properties?.attempts ? { ...t, input_schema: { ...t.input_schema, properties: Object.fromEntries(Object.entries(t.input_schema.properties).filter(([k]) => k !== "attempts")) } } : t));
/**
 * A tool set with the agent's tasks tool as version 32 had it: without a task's check and the words that name it, which
 * version 33 gave it (HarnessV3-TaskGraph-v2 V2-1), and without command tasks — by's command, run and items, and the
 * tool's words of them — which version 35 gave it (V2-3, TG2-D72).
 * @param {readonly any[]} set
 */
const asV32 = (set) =>
  set.map((t) => {
    if (t.name !== "tasks") return t;
    const items = t.input_schema.properties.tasks.items;
    const words = t.description
      .replace(/, acceptance \(what shows it done\) and check \([^()]*\)\. by says/, " and acceptance (what shows it done). by says")
      .replace(/; an explorer, (.*?); or command, [^.]*\./, "; or an explorer, $1.")
      .replace(/ A command task gives run .*? with the end of its output\./, "")
      .replace(" (a failed command task too, taken as done when what did not pass is what it was run to find)", "");
    assert.notEqual(words, t.description, "the tasks tool names check");
    assert.ok(!/command/.test(words), words);
    const by = { ...items.properties.by, enum: items.properties.by.enum.filter((/** @type {string} */ b) => b !== "command"), description: "Who does it: you (the default), a sub-agent (it changes the files in writes) or an explorer (it reads and reports — no tests, no builds — and names no writes)." };
    assert.notDeepEqual(by.enum, items.properties.by.enum, "the tasks tool's by names command");
    const props = Object.fromEntries(Object.entries(items.properties).filter(([k]) => k !== "check" && k !== "run" && k !== "items" && k !== "thread").map(([k, v]) => [k, k === "by" ? by : v]));
    return { ...t, description: words, input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, tasks: { ...t.input_schema.properties.tasks, items: { ...items, properties: props } } } } };
  });

/**
 * The agent's graph section as version 35 had it: V2-5 (checklist-graph.test.js) rewrote its first three lines, the
 * checklist on the graph, and gave the agent's plan line its own words (`planOnGraph`).
 */
const V35_GRAPH = [
  "- The developer switched the task graph on for this session. With the tasks tool you keep work as a graph: tasks, each with an id of yours, a name, the tasks it needs — it starts once they are done — and the files it writes. Filament keeps the order, and the developer sees the graph drawn live.",
  "- Choose for each piece of work: the graph when its pieces depend on each other or could run side by side; a short, straight list needs no graph. Nothing has to go on it.",
  "- Add the tasks with the graph's goal. Start a task when work on it begins — tasks that do not depend on each other can start together — and mark it done with a line on what was done. When the plan moves, change the tasks not yet finished, or drop the ones no longer needed with the reason; close the graph with its outcome when the work is done.",
  "- Filament refuses in words a start before a task's needs are done, a need that is no task, needs that go round in a loop, and two tasks that could run at once writing the same file: fix the graph and go on. A turn may end with tasks open — the graph waits for the next turn, and tasks show reads it back.",
].join("\n");
/**
 * The plan line of an agent with the graph on, as version 35 had it — a lead's to version 78: version 79 says which to
 * plan on (agent-context.test.js).
 */
const V78_PLAN_OR_GRAPH = "For anything beyond one step, plan before you start — with the plan tool's checklist, or with the tasks tool's graph (below) — and keep it up to date as the work moves; the developer watches both live. Do not narrate a todo list in prose.";
/** A prompt with V2-5's words as version 35 had them. @param {string} s */
const asV35 = (s) => s.replace(asV97Prompt(PROMPT.planOnGraph), V78_PLAN_OR_GRAPH).replace(asV97Prompt(asV102Prompt(PROMPT.graph)), V35_GRAPH);


describe("the lead's lines (case 25)", () => {
  // (fails before: yes — the brief named no reading and no cheaper model, nothing said check or may_run, a task had no
  // size, and a report was a claim with no word of Filament's check; the plan before them is version 29's)
  test("the four that ship: the plan, the brief, the check, one sitting and the claim, in that order after the worktree's line and the lead's own hands (decision 9) — in every seat", () => {
    const lines = String(PROMPT.lead).split("\n");
    assert.ok(lines[1].startsWith("- A builder and a tester work in their own git worktree"), lines[1]);
    assert.equal(lines[2], OWN_HANDS_LINE, "after the line that says what applying is");
    assert.deepEqual(lines.slice(3, 8), [PLAN_LINE, BRIEF_LINE, CHECK_LINE, SITTING_LINE, CLAIM_FOUR]);
    for (const seat of [leadLines({ supervise: true }), leadLines({ supervise: true, own: true }), leadWords(LEAD), leadWords(LEAD, { supervise: true })])
      assert.ok(seat.includes([PLAN_LINE, BRIEF_LINE, CHECK_LINE, SITTING_LINE, CLAIM_FOUR].join("\n")), seat);
    assert.ok(!lines.some((l) => l.startsWith("- Give each file one owner") || l.startsWith("- A report is a claim. Check it")), "version 25's two lines are gone");
  });

  // (fails before: yes — a team of cards read the same brief line as the four, and its claim knew nothing of a check)
  test("a team of cards: its claim names another member; a team of one reads every change; a team that changes no file has no check to give, and its claim is as it was", () => {
    const at = (/** @type {string} */ text) => text.split("\n");
    const crew = at(leadLines({ members: CREW }));
    const brief = crew.indexOf(BRIEF_LINE);
    assert.ok(brief > 2 && crew[brief - 3].startsWith("- `coder` and `checker` work in their own git worktree") && crew[brief - 2] === OWN_HANDS_LINE, crew.join("\n"));
    assert.deepEqual(crew.slice(brief - 1, brief + 4), [PLAN_LINE, BRIEF_LINE, CHECK_LINE, SITTING_LINE, CLAIM_SEVERAL]);
    const one = at(leadLines({ members: [card("coder", "edit")] }));
    assert.deepEqual(one.slice(one.indexOf(BRIEF_LINE) - 1, one.indexOf(BRIEF_LINE) + 4), [PLAN_LINE, BRIEF_LINE, CHECK_LINE, SITTING_LINE, CLAIM_ONE]);
    // Nobody changes the project's files: no worktree to run a check in, nothing to apply (a grant is refused at launch).
    // Such a team plans too: a plan is the parts and how they meet, whoever changes what.
    const readers = at(leadLines({ members: [card("mapper", "read"), card("critic", "read")] }));
    assert.ok(!readers.includes(CHECK_LINE));
    assert.deepEqual(readers.slice(readers.indexOf(BRIEF_LINE) - 1, readers.indexOf(BRIEF_LINE) + 3), [PLAN_LINE, BRIEF_LINE, SITTING_LINE, "- A report is a claim. Check it before anything builds on it: read what changed, or have another worker read the diff or run the check."]);
    assert.equal(rosterWords([card("mapper", "read")]).claim, "- A report is a claim. Check it before anything builds on it: read what changed.");
    assert.deepEqual([rosterWords(CREW).check, rosterWords([card("mapper", "read")]).check], [CHECK_LINE, null]);
  });

  // (fails before: yes — the agent tool asked for the files, steps and acceptance check alone, and said nothing of check)
  test("the agent tool's text names what to read first, the check Filament runs and the other commands — for the four and for a team of cards", () => {
    const said = "so brief it completely: the goal and why, what to read first, the files, the steps in order, the acceptance check that proves it done (with check, the commands that prove it, which Filament runs itself once the worker reports), the other commands it may run, and what not to touch. Filament writes its task from these fields.";
    assert.ok(TOOL_TEXT.teamAgent.includes(said), TOOL_TEXT.teamAgent);
    assert.ok(leadToolsOf(CREW).agent.description.includes(said), leadToolsOf(CREW).agent.description);
    assert.ok(!TOOL_TEXT.teamAgent.includes("and what not to touch — Filament writes"));
  });
});

describe("one message to all (case 24)", () => {
  const ALL_ID = "The worker's id, as its launch answered it, or all, with prompt alone: a message to every worker of yours running now.";
  const ALL_TEXT = "agent_id all, with prompt alone, sends that message to every worker of yours running now.";

  // (fails before: yes — agent_id named one worker: a rule for everyone took one call per worker)
  test("the reads tool offers it — in either seat, for the four and a team of cards; a lead that does not read along has no such word", () => {
    for (const tool of [WORKER_READS_TOOL, WORKER_READS_OWN_TOOL, leadToolsOf(CREW).workerReads, leadToolsOf(CREW).workerReadsOwn]) {
      assert.equal(tool.input_schema.properties.agent_id.description, ALL_ID);
      assert.equal(Object.keys(tool.input_schema.properties)[0], "agent_id", "where it stood");
      assert.ok(tool.description.includes(`its report so far arrives as a message. ${ALL_TEXT} Once it reported,`), tool.description);
    }
    assert.equal(WORKER_TOOL.input_schema.properties.agent_id.description, "The worker's id, as its launch answered it.");
    assert.ok(!TOOL_TEXT.worker.includes("agent_id all"));
    assert.equal(argSummary("worker", { agent_id: "all", prompt: "Run the linter before you report." }), "every worker running now: Run the linter before you report.");
  });

  // (fails before: yes — "all" was no worker's id)
  test("it reaches every worker of the team's running now, at its next step — the one that waits for an answer after it — and never the developer's sub-agent", async () => {
    const w = watched();
    const l = leadOf(w.registry, w.dir, { looks: 30 });
    const builder = await running(w, l);
    const launched = await l.tools.agent(l.call({ ...BRIEF, role: "tester", description: "Test the parser" }));
    const tester = String(launched.agentId);
    const r2 = await w.run(2);
    r2.attach();
    await until(() => w.registry.get(tester)?.runId === r2.runId, "the tester's run to attach");
    const theirs = w.registry.launch({ origin: "owner", chainId: "c1", prompt: "look", worker: "reviewer" });
    assert.equal(theirs.ok, true);
    const r3 = await w.run(3);
    r3.attach();
    const asked = w.registry.ask(builder.id, { tool: "bash", args: "npm test", question: "May I run this command?" });
    const sent = await l.tools.worker(l.call({ agent_id: "all", prompt: "Run the linter before you report." }));
    assert.equal(sent.ok, true, sent.text);
    assert.equal(
      sent.text,
      `Sent to 2 workers running now — builder ${builder.id} and tester ${tester}: each reads it at its next step (builder ${builder.id} after the answer it waits for, on its bash call: ask 1). Their reports still arrive as messages when they finish.`,
    );
    assert.deepEqual(w.steers.map((s) => [s.runId, s.kind, s.text, s.from]), [["run-1", "note", "Run the linter before you report.", "lead"], ["run-2", "note", "Run the linter before you report.", "lead"]], "one note each, and none to the developer's");
    assert.equal(sent.note, `agent: one message to the 2 workers running now (builder ${builder.id}, tester ${tester}), read at each one's next step`);
    assert.equal(sent.agentId, undefined, "no one worker's");
    // " All " is all too; with one worker running the words are one worker's.
    w.registry.answer(builder.id, "c1", "yes");
    await asked;
    builder.r.finish({ status: "done", report: "Fixed." });
    await until(() => w.registry.get(builder.id)?.status === "done", "the builder to report");
    const one = await l.tools.worker(l.call({ agent_id: " All ", prompt: "And keep the export." }));
    assert.equal(one.text, `Sent to 1 worker running now — tester ${tester}: it reads it at its next step. Its report still arrives as a message when it finishes.`);
    r2.finish({ status: "done", report: "Tested." });
    r3.finish({ status: "done", report: "Looked." });
    await until(() => w.registry.get(tester)?.status === "done" && w.registry.get(String(theirs.ok && theirs.id))?.status === "done", "both to end");
    // With none running, nothing is sent.
    const none = await l.tools.worker(l.call({ agent_id: "all", prompt: "Anyone?" }));
    assert.deepEqual([none.ok, none.text, none.note], [false, "Nothing sent: no worker of yours is running now.", "agent: a message to all workers sent nothing — none was running"]);
    assert.equal(w.steers.length, 3);
  });

  // (fails before: yes — there was no message to all to refuse)
  test("one that cannot take it now is named with why, the others still get it; none that can, nothing is sent", async () => {
    const w = watched();
    const l = leadOf(w.registry, w.dir, { looks: 30 });
    const builder = await running(w, l);
    // The tester's run has not begun: its message waits for it, as a message to one does.
    const launched = await l.tools.agent(l.call({ ...BRIEF, role: "tester", description: "Test the parser" }));
    const tester = String(launched.agentId);
    const r2 = await w.run(2);
    w.refuseSteers("this agent takes no words while its turn runs; send them when it ends");
    const sent = await l.tools.worker(l.call({ agent_id: "all", prompt: "Run the linter." }));
    assert.equal(sent.ok, true);
    assert.equal(sent.text, `Sent to 1 worker running now — tester ${tester}: it reads it at its next step. Not to builder ${builder.id}: this agent takes no words while its turn runs; send them when it ends. Their reports still arrive as messages when they finish.`);
    assert.equal(sent.note, `agent: one message to 1 of the 2 workers running now (tester ${tester}), read at its next step — not to builder ${builder.id}: this agent takes no words while its turn runs; send them when it ends`);
    w.refuseSteers("");
    r2.attach();
    await until(() => w.steers.some((s) => s.runId === "run-2" && s.text === "Run the linter."), "the held message to reach the tester's run");
    r2.finish({ status: "done", report: "Tested." });
    await until(() => w.registry.get(tester)?.status === "done", "the tester to report");
    w.refuseSteers("this agent takes no words while its turn runs; send them when it ends");
    const nothing = await l.tools.worker(l.call({ agent_id: "all", prompt: "Run the linter." }));
    assert.deepEqual([nothing.ok, nothing.text], [false, `Nothing sent. To builder ${builder.id}: this agent takes no words while its turn runs; send them when it ends.`]);
    builder.r.finish({ status: "done", report: "Fixed." });
    await until(() => w.registry.get(builder.id)?.status === "done", "the builder to report");
  });

  // (fails before: yes — "all" was an id like any other: a stop or an apply named no worker, and said so only later)
  test("it takes prompt alone: without one, or with anything else, it is refused on its input", async () => {
    const reads = { reads: true };
    assert.equal(inputRefusal("worker", { agent_id: "all" }, reads)?.text, "Nothing sent: agent_id all needs prompt — the message every worker of yours running now reads.");
    for (const [field, value] of /** @type {[string, unknown][]} */ ([["stop", true], ["apply_changes", true], ["correction", true], ["show_trail", true], ["show_changes", true], ["answer", "yes"], ["ask", 1], ["reason", "it is fine"]]))
      assert.equal(
        inputRefusal("worker", { agent_id: "all", prompt: "x", [field]: value }, reads)?.text,
        `Nothing sent: agent_id all sends a message, so it takes prompt alone — never ${field}: stop, follow up on or answer each worker by its own agent_id.`,
        field,
      );
    assert.equal(inputRefusal("worker", { agent_id: "all", prompt: "Use integers." }, reads), null);
    assert.equal(inputRefusal("worker", { agent_id: "all", prompt: "x", stop: false }, reads), null, "a false is no field given");
    // A lead that does not read along has no such word: all is an id, as any other.
    assert.match(String(inputRefusal("worker", { agent_id: "all" }, {})?.text), /^Nothing sent: worker needs prompt/);
  });
});

describe("the models line (case 26)", () => {
  // (fails before: yes — a lead knew nothing of the models its workers run on)
  test("one model; several, with the routing words; after the line that names the workers, before the worktree's", () => {
    const one = leadLines({ models: fourOn({ scout: "glm-5.3", builder: "glm-5.3", tester: "glm-5.3", reviewer: "glm-5.3" }) }).split("\n");
    assert.deepEqual(one.slice(1, 3), ["- Your workers run on glm-5.3.", String(PROMPT.lead).split("\n")[1]]);
    const several = leadLines({ models: fourOn({ scout: "glm-5.3", builder: "claude-haiku-4-5", tester: "claude-haiku-4-5", reviewer: "glm-5.3" }) }).split("\n");
    assert.equal(several[1], `- Your workers' models: scout and reviewer on glm-5.3; builder and tester on claude-haiku-4-5. ${ROUTING}`);
    assert.equal(leadLines({ models: fourOn({ scout: "a", builder: "b", tester: "c", reviewer: "a" }) }).split("\n")[1], `- Your workers' models: scout and reviewer on a; builder on b; tester on c. ${ROUTING}`);
    // A team of cards: its members by their tags, after their lines.
    const crew = leadLines({ members: CREW, models: { members: [{ tag: "mapper", model: "glm-5.3" }, { tag: "coder", model: "claude-haiku-4-5" }, { tag: "checker", model: "claude-haiku-4-5" }], pool: [] } }).split("\n");
    const line = crew.findIndex((l) => l.startsWith("- Your workers' models"));
    assert.equal(crew[line], `- Your workers' models: \`mapper\` on glm-5.3; \`coder\` and \`checker\` on claude-haiku-4-5. ${ROUTING}`);
    assert.ok(crew[line - 1].startsWith("  - `checker` (Checker)") && crew[line + 1].startsWith("- `coder` and `checker` work in their own git worktree"), crew.join("\n"));
    // None known: no line, and the lines are the four's as they ship.
    assert.equal(leadLines({ models: fourOn({}) }), PROMPT.lead);
    assert.equal(leadLines({ models: null }), PROMPT.lead);
    // A lead that reads along keeps it, in either seat.
    const models = fourOn({ scout: "glm-5.3", builder: "glm-5.3", tester: "glm-5.3", reviewer: "glm-5.3" });
    for (const seat of [leadLines({ supervise: true, models }), leadLines({ supervise: true, own: true, models })]) assert.equal(seat.split("\n")[1], "- Your workers run on glm-5.3.");
  });

  // (fails before: yes — the line named each member's own model alone, and the pool, main's E15 step 8, had no words
  // in it: a member that takes the pool's seat was named nowhere)
  test("on the pool (§13.12): a pool of one model is that model; of several, its order — alone with no routing words, beside a card's model with them and last; a row whose model is not known is left out", () => {
    const at = (/** @type {any} */ models) => leadLines({ models }).split("\n")[1];
    assert.equal(at(fourOn({}, [{ model: "glm-5.3", seats: 4 }])), "- Your workers run on glm-5.3.");
    assert.equal(at(fourOn({ tester: "glm-5.3" }, [{ model: "glm-5.3", seats: 4 }])), "- Your workers run on glm-5.3.");
    assert.equal(at(fourOn({ tester: "claude-haiku-4-5" }, [{ model: "glm-5.3", seats: 4 }])), `- Your workers' models: scout, builder and reviewer on glm-5.3; tester on claude-haiku-4-5. ${ROUTING}`);
    assert.equal(at(fourOn({}, POOL)), "- Your workers run on the models the developer lists for them: each launch that names no model takes the first free seat, in this order — glm-5.3 · glm-5.3-flash.", "an order: no row says a count (U13-D15)");
    assert.equal(at(fourOn({ reviewer: "claude-opus-5-5" }, POOL)), `- Your workers' models: reviewer on claude-opus-5-5; scout, builder and tester on ${ON_POOL}. ${ROUTING}`);
    // Every card names a model: the pool is no one's.
    assert.equal(at(fourOn({ scout: "a", builder: "b", tester: "b", reviewer: "a" }, POOL)), `- Your workers' models: scout and reviewer on a; builder and tester on b. ${ROUTING}`);
    // A team of cards, by its tags.
    const crew = leadLines({ members: CREW, models: { members: [{ tag: "mapper", model: "glm-5.3" }, { tag: "coder", model: null }, { tag: "checker", model: null }], pool: POOL } }).split("\n");
    assert.ok(crew.includes(`- Your workers' models: \`mapper\` on glm-5.3; \`coder\` and \`checker\` on ${ON_POOL}. ${ROUTING}`), crew.join("\n"));
    // A new task's pool before its model is chosen: the row that names no model stands for no model yet.
    assert.equal(leadLines({ models: fourOn({}, [{ model: "", seats: 4 }]) }), PROMPT.lead);
  });

  // (fails before: yes — a member with no model of its card's was named on subagents.model, which the pool replaced,
  // else on the lead's model, whatever the pool held)
  test("each member's model as its launch resolves it: its card's, else the pool's first free seat — and each launch lands where the line says", async () => {
    // Reviewer's card names a model: the two seats on it — the Scout and the Reviewer — run on it.
    const haiku = (/** @type {string} */ tag) => (tag === "reviewer" ? { ...shippedCard("reviewer"), model: "claude-haiku-4-5" } : null);
    const onHaiku = { scout: "claude-haiku-4-5", reviewer: "claude-haiku-4-5" };
    const pool = [{ model: "glm-5.3", seats: 1 }, { model: "glm-5.3-flash", seats: 2 }];
    const w = watched({ sub: { pool }, card: haiku, slots: [{ upstream: "u", model: "glm-5.3", n: 1 }], facts: (m) => ({ problem: null, limit: null, at: { upstream: "u", model: m } }) });
    const models = w.registry.modelsOf("c1", MEMBERS, "m-lead");
    /** A list as a launch reads it: an order, each row holding a row's most (U13-D15). @param {{ model: string }[]} rows */
    const ordered = (rows) => rows.map((r) => ({ model: r.model, seats: Infinity }));
    assert.deepEqual(models, fourOn(onHaiku, ordered(pool)));
    assert.equal(leadLines({ models }).split("\n")[1], `- Your workers' models: scout and reviewer on claude-haiku-4-5; builder and tester on the models the developer lists for your workers, each launch that names none the first free seat in this order — glm-5.3 · glm-5.3-flash. ${ROUTING}`);
    // Two builders at once, and the reviewer: the first builder takes glm-5.3's one slot across Filament, the second the
    // next row's, and the reviewer runs on its card's model.
    const l = leadOf(w.registry, w.dir);
    /** @type {string[]} */
    const ids = [];
    for (const role of ["builder", "builder", "reviewer"]) {
      const r = await l.tools.agent(l.call({ ...BRIEF, role }));
      assert.equal(r.ok, true, r.text);
      ids.push(String(r.agentId));
    }
    assert.deepEqual(ids.map((id) => w.registry.get(id)?.model), ["glm-5.3", "glm-5.3-flash", "claude-haiku-4-5"], "each launched where the line says");
    for (const run of await Promise.all([1, 2, 3].map((n) => w.run(n)))) {
      run.attach();
      run.finish({ status: "done", report: "Done." });
    }
    await until(() => ids.every((id) => w.registry.get(id)?.status === "done"), "the three to end");
    // A new task's: the pool it would start with, read before any session holds it.
    assert.deepEqual(w.registry.modelsOf(null, MEMBERS, "m-lead", { pool: [{ model: "glm-5.3-flash", seats: 2 }] }), fourOn(onHaiku, ordered([{ model: "glm-5.3-flash" }])));
    // No pool set: the main agent's model — for a team, the lead's; the card's still wins.
    assert.deepEqual(watched({ sub: { pool: undefined }, card: haiku }).registry.modelsOf("c1", MEMBERS, "m-lead"), fourOn(onHaiku, ordered([{ model: "m-lead" }])));
    // A limit cuts what a row lends now, never the list the line names.
    const limited = watched({ sub: { pool }, facts: (m) => ({ problem: null, limit: m === "glm-5.3-flash" ? { cap: 1, from: "headers" } : null }) });
    assert.deepEqual(limited.registry.modelsOf("c1", MEMBERS, "m-lead").pool, ordered(pool));
    assert.equal(limited.registry.pool("c1").find((s) => s.model === "glm-5.3-flash")?.lent, 1, "the row lends one now");
  });

  // (fails before: yes — neither seat's words named a model)
  test("in either seat: the loop lead's prompt and a coding agent's part carry it; with none given, neither has it", () => {
    const models = fourOn({ scout: "glm-5.3", builder: "claude-haiku-4-5", tester: "claude-haiku-4-5", reviewer: "glm-5.3" });
    const line = `- Your workers' models: scout and reviewer on glm-5.3; builder and tester on claude-haiku-4-5. ${ROUTING}`;
    const loop = systemPromptFor({ root: "/w", delegateRead: false, lead: { ...LEAD, members: MEMBERS, models }, environment: ENV, supervise: true });
    assert.ok(loop.includes(`${String(PROMPT.lead).split("\n")[0]}\n${line}\n`), loop);
    assert.ok(leadWords(LEAD, { supervise: true, models }).includes(`${String(PROMPT.lead).split("\n")[0]}\n${line}\n`));
    assert.ok(!systemPromptFor({ root: "/w", delegateRead: false, lead: LEAD, environment: ENV }).includes("- Your workers"));
    assert.ok(!leadWords(LEAD).includes("- Your workers"));
  });
});

// Version 27's golden (case 49) gave way to version 28's, that one to version 29's, and that one to version 30's: its
// V26 figures are 2aecadb7's, in git, and its V27 ones 124ee8c0's. Version 28 (TG2-D56) moved two figures, a coding
// agent's lines and worker tool when it leads and reads along; version 29 (§13.17) moved every team member's and nothing
// else; version 30 (TG2-D60) moves read-along's alone. Version 37 (HarnessV4_Tasks decision 9) moves a lead's words and
// tools in either seat by its own hands alone: weighed as version 36 had them (asV36, and its new hands off), they are
// version 29's still.
describe("version 30 (§13.17, TG2-D60)", () => {
  // Version 29's own figures, hashed at 124ee8c0 with the same arguments.
  const V29 = {
    agent: "4c7aa7dd6f69ca9e",
    agentGraph: "46d27893793b9da8",
    agentGraphReads: "e8279ac6b1c36f58",
    agentTools: "3453158864fd4dcb",
    agentToolsGraph: "0b7bd1604213b077",
    agentToolsGraphReads: "9244931072c76b0c",
    helper: "1d5fcbb0d37e94a1",
    helperTask: "5e3978a03a097c35",
    helperTaskReads: "f98d2e602cc6b0e6",
    coderTask: "c94fb8e2b3dcbc58",
    coderTaskReads: "89052b7b583496b5",
    builder: "ede92a49fd8e9420",
    builderTask: "2288c861bc32a78d",
    builderReads: "61ad410981a4318d",
    builderTaskReads: "098a1327e41c330f",
    coderWorker: "885cff59ffed8ad5",
    coderWorkerReads: "0116436b6074f696",
    lead: "d5bd4b356fefb64f",
    leadReads: "00a3992933375506",
    leadTools: "6bf26608f7e36594",
    leadToolsReads: "1eaa13b9ba9fa4dc",
    coderLead: "aaf90c2f5620152a",
    coderLeadReads: "a918d77f8f09f870",
    coderLeadWorker: "b0f66373f72211fa",
    coderLeadWorkerReads: "856a8d8587e35829",
    leadWorkerReads: "23ebe0b681c30984",
  };
  /** A builder's prompt. @param {any} [o] */
  const builder = (o = {}) => systemPromptFor({ root: "/w", delegateRead: false, toolsOff: ["ask", "plan", "agent"], subagent: true, card: asV38Builder(shippedCard("builder")), worker: { team: "Architect", words: "be brief" }, environment: ENV, ...o });
  /** A graph task's sub-agent's prompt, on Filament's loop. @param {any} [o] */
  const helper = (o = {}) => systemPromptFor({ root: "/w", delegateRead: false, toolsOff: ["ask", "plan", "agent"], subagent: true, card: asHelper(shippedCard("builder")), environment: ENV, ...o });
  const host = { id: "", card: /** @type {any} */ (asV38Builder(shippedCard("builder"))), readOnly: false, asks: false, team: { name: "Architect", role: "builder", words: "" }, task: null };
  const taskHost = { id: "", card: /** @type {any} */ (asHelper(shippedCard("builder"))), readOnly: false, asks: false, team: null, task: /** @type {any} */ ({ review: false }) };

  // (fails before: yes — the version was 29, and every reader's words said a worker's thinking)
  test("read-along's figures move alone — a lead that reads along in either seat, its workers, the session's agent over its graph and that graph's sub-agents; everything else is version 29's, byte for byte", () => {
    // 31 since TG2-D53: the lead's agent tool gained attempts, and no prompt moved (task-graph-switch.test.js pins the tools);
    // 32 since E4 (model-no-tools.test.js), which moves only the prompt of a model that takes no tools; 33 since V2-1,
    // which moves the tasks tool's words alone (checked-done.test.js); 35 since V2-3, which moves the tasks tool and the
    // agent's graph section by its line on command tasks (command-tasks.test.js); 36 since V2-5, which moves the agent's
    // graph section and its plan line, the checklist on the graph (checklist-graph.test.js); 37 since decision 9, a lead's
    // own hands, which moves a lead's lines whether it reads along or not (team-lead.test.js); 38 since E23, which gives
    // every seat's agent tool its model fields, weighed here without them (asV37; agents-coder-launch.test.js); 39 since
    // the owner's words of 10-19, which give every agent tool's context window and the Builder words of its own,
    // weighed here as version 38 had them (asV38, asV38Builder; side-view.test.js, agent-cards.test.js); 43 since EN1,
    // which asks a sub-agent's and a worker's report for its subject line, weighed here without it (asV42;
    // envelopes.test.js); 44 since EN2, which puts the envelope tool after wait in the agent's and the lead's sets,
    // weighed here without it (asV43; envelopes-loop.test.js); 46 since E33, which gives the tasks tool keep and read,
    // weighed here without them (asV45; task-notes.test.js); 47 since E41 P1, which gives the agent's tasks tool pause and
    // its checkpoint, weighed here without them (asV46; task-graph-memory.test.js); 48 since E41 P2, which gives every
    // planner's done its evidence, weighed here without it (asV47; task-graph-track.test.js); 49 since the owner's words
    // of 10-26, which give the agent's own set report while its graph is on, weighed here without it (asV48;
    // subagent-task.test.js); 53 since the owner's word of 10-27, which runs the agent's launches in the background by
    // default — its agent tool's words, the field's and its line — weighed here without it (asV52, asV52Prompt;
    // subagents.test.js); 55 since the owner's word of 10-27, which runs a reply's reads side by side — the craft's line
    // on calls made together — weighed here without it (asV54Prompt; agent-read-batch.test.js); 68 since 10-29, which
    // gives the agent tool mark_applied, weighed here without it (asV67Tools; mark-applied.test.js); 69 since the owner's
    // word of 10-29, the task graph always on, which takes the switch's words out of the tasks tool, weighed here with
    // them (asV68Tools; task-graph-switch.test.js); 73 since the owner's word of 10-31, which leaves a sub-agent its task
    // alone and offers four views, weighed here as version 72 had them (asV72Tools; agent-workers.test.js); 75 since the
    // owner's of 11-02, which gives every tasks tool's task found_by, weighed here without it (asV74Tools;
    // hunt-found.test.js); 76 since the owner's of 11-02, a graph task's work waiting for its apply, which moves the
    // apply_changes of the agent tool and the worker tool and the agent's graph section, weighed here as version 75 had
    // them (asV75Tools, asV75Prompt; graph-runner-apply.test.js); 77 since the owner's of 11-03, a team's lead's orders
    // run at once, which moves a lead's lines and its graph's section, and the reads tools' answer, weighed here as
    // version 76 had them where they move no figure of read-along's (asV76Prompt; team-live.test.js); 79 since the
    // owner's of 11-04, which says on a lead's plan line which to plan on, weighed here as version 78 had it
    // (V78_PLAN_OR_GRAPH; agent-context.test.js); 80 since the owner's LSP of 11-04, which puts the lsp tool after the
    // hands in every set, weighed here without it (asV79Tools; lsp-tool.test.js); 86 since the owner's of 11-05, a command
    // past its timeout in the background, which moves bash's and powershell's timeout, weighed here as version 85 had them
    // (asV85Shell; hands.test.js); 87 since the owner's of 11-05, which drops a session's count from the agent line,
    // weighed here with it (asV86Prompt); 92 with the memory plan's a2, a lead's yes and go fields of its answer, which
    // moves plan_review's words, weighed here as version 91 had them (asV91Tools; worker-answer-field.test.js); 94 with
    // the owner's tool plan of 11-08, which takes the em dashes out of the texts the loop's tools share with a coding
    // agent's, weighed here as version 93 had them (asV93Tools); 97 with the owner's prompt pass of 11-08, the agent tool's background field
    // and the agent's line on its reports saying a report may wait sealed for the envelope tool, weighed as version 96 had them
    // (asV96Tools and asV96Prompt); 98 with the owner's planning words of 11-08 said as a rule, weighed as version 97 had
    // them (asV97Prompt); 99 with the loop's tool texts said where they are used, and the agent's line on the agent tool
    // naming what a sub-agent goes without, weighed as version 98 had them (asV98Tools and asV98Prompt); 100 with an apply that
    // overlaps the folder's edits offering a way on, overlap beside each apply_changes, weighed as version 99 had them
    // (asV99Tools); 101 with what is still open taking dismiss, which none of these sets carries; 102 with writes as a forecast, each tasks tool's refusal, change and needed_by, weighed as version 101
    // had them (asV101Tools); 103 with a follow-up to a sub-agent at work sent as a message and the graph's words given their
    // freedom and a lead's sizing line giving no file one owner, weighed as version 102 had them (asV102Tools and asV102Prompt);
    // 104 with a done task reopened by start and several done, started or dropped in one call, which moves the graph's sets
    // alone, weighed as version 103 had them (asV103Tools, first of all); 105 with the bug hunt's words of 11-08, a lead's graph
    // line saying version 98's rule and a lead's words that a report may wait sealed, weighed as version 104 had them
    // (asV104Prompt and asV104Tools, first of all); 106 with main's 105 merged with builds' (the s-tools hunt's machine
    // words, Chrome on this machine for the browser's pane); 107 with Parallelize tasks' line naming a chat whose sub-agents
    // work in its folder, which no lead's prompt carries; 108 and 109 with the commit trailer and a coding agent's wait,
    // which move none of these; 110 with the loop's and a lead's wait waiting for background commands too, weighed as
    // version 109 had them (asV109Tools, first of all); 111 with the agent's parallel on its tasks tool, the side-by-side card
    // its to put (the owner's of 11-10), weighed as version 110 had it (asV110Tools, before asV109Tools); 117 with the
    // thread tool and the agent's line naming it, weighed as version 116 had them (asV116Prompt, asV116Tools, first of all).
    assert.equal(PROMPT_VERSION, 129);
    const command = String(String(PROMPT.graphSubagents).split("\n").at(-1));
    assert.match(command, /^- Mechanical work/);
    const same = {
      agent: sha(asV52Prompt(asV54Prompt(asOldRoster(asV86Prompt(asV96Prompt(asV97Prompt(asV98Prompt(asV116Prompt(systemPromptFor({ root: "/w", delegateRead: false, environment: ENV })))))))))),
      agentGraph: sha(asV35(asV52Prompt(asV54Prompt(asV75Prompt(asOldRoster(asV86Prompt(asV96Prompt(asV97Prompt(asV98Prompt(asV102Prompt(asV116Prompt(systemPromptFor({ root: "/w", delegateRead: false, environment: ENV, graph: true })))))))))))).replace(`\n${command}`, "")),
      // The tools weighed with the visuals, artifacts, the Space, the team tool, the flow tool and the thread tool off: E16,
      // E18, proposal_ux §4.14, team_v2_plan §5.5, HarnessV4_OneAgent_Plan OA3 and th3 added them after the rest
      // (visuals.test.js, artifacts.test.js, space-server.test.js, teams-beside.test.js, flow-tool.test.js,
      // thread-offer.test.js).
      agentTools: sha(JSON.stringify(asV43(asV38(asV37(asV52(asV54Tools(asV67Tools(asV72Tools(asV75Tools(asOldRosterTools(asV79Tools(asV85Shell(asV93Tools(asV94Tools(asV96Tools(asV98Tools(asV99Tools(asV101Tools(asV102Tools(asV109Tools(asV111Tools(asV116Tools(loopToolArgs({ disabled: ["show_visual", "artifact", "space", "team", "flow", "thread"] })))))))))))))))))))))))),
      // The tasks tool weighed as version 32 had it: V2-1 gave it check, and moved nothing else (checked-done.test.js).
      agentToolsGraph: sha(JSON.stringify(asV45(asV46(asV43(asV32(asV47(asV38(asV37(asV48(asV52(asV54Tools(asV67Tools(asV68Tools(asV72Tools(asV74Tools(asV75Tools(asOldRosterTools(asV79Tools(asV85Shell(asV90Tools(asV93Tools(asV94Tools(asV96Tools(asV98Tools(asV99Tools(asV101Tools(asV102Tools(asV103Tools(asV109Tools(asV110Tools(asV111Tools(asV116Tools(loopToolArgs({ graph: true, disabled: ["show_visual", "artifact", "space", "team", "flow", "thread"] })))))))))))))))))))))))))))))))))),
      agentToolsGraphReads: sha(JSON.stringify(asV45(asV46(asV43(asV32(asV47(asV38(asV37(asV48(asV52(asV54Tools(asV67Tools(asV68Tools(asV72Tools(asV74Tools(asV75Tools(asOldRosterTools(asV79Tools(asV85Shell(asV90Tools(asV93Tools(asV94Tools(asV96Tools(asV98Tools(asV99Tools(asV101Tools(asV102Tools(asV103Tools(asV109Tools(asV110Tools(asV111Tools(asV116Tools(loopToolArgs({ graph: true, supervise: true, disabled: ["show_visual", "artifact", "space", "team", "flow", "thread"] })))))))))))))))))))))))))))))))))),
      helper: sha(asV42(asV54Prompt(helper()))),
      helperTask: sha(asV54Prompt(helper({ task: "work" }))),
      coderTask: sha(workerWords(taskHost)),
      builder: sha(asV42(asV54Prompt(builder()))),
      builderTask: sha(asV54Prompt(builder({ task: "work" }))),
      coderWorker: sha(asV42(workerWords(host))),
      lead: sha(asV36(asV76Prompt(asV97Prompt(asV102Prompt(asV104Prompt(systemPromptFor({ root: "/w", delegateRead: false, lead: LEAD, environment: ENV }))))))),
      leadTools: sha(JSON.stringify(asV43(asV30(asV38(asV37(asV72Tools(asV75Tools(asV79Tools(asV91Tools(asV93Tools(asV99Tools(asV101Tools(asV104Tools(asV109Tools(asV111Tools(loopToolArgs({ lead: true, disabled: ["show_visual", "artifact", "space", ...DECISION_9_HANDS] }))))))))))))))))),
      coderLead: sha(asV36(asV76Prompt(asV102Prompt(asV104Prompt(leadWords(LEAD)))))),
      coderLeadWorker: sha(JSON.stringify(asV75Tools(asV93Tools(asV99Tools(asV101Tools([WORKER_TOOL]))))[0])),
    };
    assert.deepEqual(same, Object.fromEntries(Object.keys(same).map((k) => [k, /** @type {any} */ (V29)[k]])));
    // Wherever someone reads along, a worker's thinking is its own, and the words say so (TG2-D60).
    const moved = {
      agentGraphReads: sha(systemPromptFor({ root: "/w", delegateRead: false, environment: ENV, graph: true, supervise: true })),
      helperTaskReads: sha(helper({ task: "work", supervise: true })),
      coderTaskReads: sha(workerWords({ ...taskHost, supervise: true })),
      builderReads: sha(builder({ supervise: true })),
      builderTaskReads: sha(builder({ supervise: true, task: "work" })),
      coderWorkerReads: sha(workerWords({ ...host, supervise: true })),
      leadReads: sha(systemPromptFor({ root: "/w", delegateRead: false, lead: LEAD, environment: ENV, supervise: true })),
      leadToolsReads: sha(JSON.stringify(asV30(asV38(asV37(loopToolArgs({ lead: true, supervise: true, disabled: ["show_visual", "artifact", "space"] })))))),
      coderLeadReads: sha(leadWords(LEAD, { supervise: true })),
      coderLeadWorkerReads: sha(JSON.stringify(WORKER_READS_OWN_TOOL)),
      leadWorkerReads: sha(JSON.stringify(WORKER_READS_TOOL)),
    };
    assert.deepEqual(Object.keys({ ...same, ...moved }).sort(), Object.keys(V29).sort(), "every figure is weighed");
    for (const [k, v] of Object.entries(moved)) assert.notEqual(v, /** @type {any} */ (V29)[k], k);
  });
});

// Version 31 (§13.17, TG2-D53) gives the lead's agent tool attempts, in both seats, and moves no prompt.
describe("version 31 (§13.17, TG2-D53)", () => {
  // (fails before: yes — the version was 30, and the lead's agent tool had no attempts)
  test("the lead's tool sets move by attempts alone, read along or not; the session's agent's and a worker's stay", () => {
    assert.equal(PROMPT_VERSION, 129);
    for (const supervise of [false, true]) {
      const set = asV37(loopToolArgs({ lead: true, supervise, disabled: ["show_visual", "artifact", "space"] }));
      const agent = set.find((t) => t.name === "agent");
      assert.deepEqual(agent?.input_schema.properties.attempts, ATTEMPTS_FIELD);
      assert.notDeepEqual(set, asV30(set));
    }
    for (const args of [{}, { graph: true }, { graph: true, supervise: true }]) {
      const set = asV37(loopToolArgs({ ...args, disabled: ["show_visual", "artifact", "space"] }));
      assert.deepEqual(set, asV30(set), JSON.stringify(args));
    }
    assert.equal("attempts" in WORKER_TOOL.input_schema.properties, false);
  });
});
