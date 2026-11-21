// @ts-check
// HarnessV3-TaskGraph-v2 TG2-D49, a worker asks its lead (§13.13, cases 35 to 43). A team's worker whose lead reads along
// may ask it — a choice that changes its result and that neither its brief nor the code settles — and waits for the
// answer, three minutes at most: then it goes on with its pick. The question takes the worker's next number, as a call's
// question does (TG2-D42), rides its progress as the lead's to answer, and is a sign: its lead's look is due at once.
// The lead answers it by its number under Validate and Autonomous alike; the developer's answer counts too, whichever is
// first; a permission switch never answers it. A coding agent's call holds within its client's patience and is called
// again with the question's number, the three minutes running from the first call. One question at a time: a second,
// either way round, is refused in words.
//
// Since TG2-D58 (§13.17, 2026-10-14) every team's worker may ask, whether its lead reads along or not, stuck or at a
// choice, and a question has no clock: it waits until it is answered, its stop, or its lead's turn's end — the plain
// lead's side is test/lead-asked.test.js. A plan under review keeps its 3 minutes (TG2-D50).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { ASK_LEAD_SECONDS } from "../src/app/agent/subagents.js";
import { ASK_LEAD_OWN_TOOL, ASK_LEAD_TOOL, leadAnswerWords, leadQuestionOf, loopToolArgs } from "../src/app/agent/tools.js";
import { PROMPT, TOOL_TEXT, systemPromptFor } from "../src/app/agent/prompt.js";
import { watchParts } from "../src/app/agent/team-tools.js";
import { signsOf } from "../src/core/signs.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createAgentRun } from "../src/app/agent-run.js";
import { createTurnCollector } from "../src/app/acp-collect.js";
import { workerWords } from "../src/app/agent-worker.js";
import { SUBJECT_LINE, heldTime, leadOf, running, watched } from "./helpers/team.js";
import { until } from "./helpers/wait.js";

const QUESTION = "Which date format? The brief says dates, and the parser reads both.";
const OPTIONS = ["ISO dates", "the locale's"];

/** A worker running under a lead that reads along, on a clock the test holds. @param {{ reads?: boolean }} [o] */
const asking = async ({ reads = true } = {}) => {
  const t = heldTime();
  const w = watched({ runlog: true, now: t.now, later: t.later });
  const l = leadOf(w.registry, w.dir, reads ? { looks: 300 } : {});
  const { id, r } = await running(w, l);
  /** The timers of a length, in the order the registry set them. @param {number} ms */
  const timers = (ms) => t.timers.filter((x) => x.ms === ms);
  return { t, w, l, id, r, timers };
};

describe("who has ask_lead (case 35)", () => {
  // (fails before: yes — no worker could ask its lead: its prompt said "Do not stop to ask a question"; and, until
  // TG2-D58, a worker whose lead did not read along had none)
  test("every team's worker, in either seat, whether its lead reads along or not; not the developer's own sub-agent", async () => {
    const a = await asking();
    assert.equal(a.w.registry.hostOf(a.id)?.askLead, true);
    const plain = await asking({ reads: false });
    assert.equal(plain.w.registry.hostOf(plain.id)?.askLead, true, "a lead that does not read along hears the question at its door (TG2-D58)");
    const theirs = /** @type {any} */ (await a.w.registry.launch({ origin: "owner", chainId: "c1", prompt: "look around", worker: "reviewer" }));
    assert.equal(theirs.ok, true, theirs.error);
    const run = await a.w.run(2);
    run.attach();
    await until(() => a.w.registry.get(theirs.id)?.runId === run.runId, "its run to attach");
    assert.equal(a.w.registry.hostOf(theirs.id)?.askLead, false, "the developer's own sub-agent has no lead to ask");
    run.finish({ status: "done", report: "LOOKED" });
    // The loop's tool, and a coding agent's over Filament's MCP server.
    assert.ok(loopToolArgs({ askLead: true }).some((t) => t === ASK_LEAD_TOOL));
    assert.ok(!loopToolArgs({}).some((t) => t.name === "ask_lead"));
    const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: /** @type {any} */ ({ get: () => null }), subagents: () => null, membersOf: () => null });
    const listed = tools.list({ cwd: "/w", upstream: "claude", chain: "c1", turn: null, graph: false, asksLead: "sa_1" });
    assert.deepEqual(listed.map((d) => [d.name, d.description]), [["ask_lead", TOOL_TEXT.askLeadOwn]]);
    // `plan` since 2026-10-14: a plan is what is sent as one (TG2-D50).
    assert.deepEqual(Object.keys(listed[0].inputSchema.properties), ["question", "options", "plan", "ask"]);
    assert.deepEqual(tools.list({ cwd: "/w", upstream: "claude", chain: "c1", turn: null, graph: false }), []);
    assert.equal(tools.has("ask_lead"), true);
    r_finish(a, plain);
  });

  // (fails before: yes — the words were not there; and, as first built, whatever a held worker asked was its plan, so
  // its plan has a field of its own since 2026-10-14, which the tool's last sentence names; since TG2-D58 a stuck
  // worker asks too, every lead answers, and no 3 minutes run out)
  test("the tools' words", () => {
    assert.equal(TOOL_TEXT.askLead, "Ask your team's lead, and wait for its answer: when your brief does not settle a choice that changes the result — two ways that could both be right — or when you are stuck: the same thing failed twice and you do not see why. Say what you found or tried, and give your options, your pick first. Your lead answers in its own words; if its turn ends first, go on with your pick and say so in your report. Never ask it for permission — a call that needs it asks by itself — nor for what you can find out by reading. While your lead reviews your plan, send the plan itself in plan, not in question: your lead's go to it lets your changes and commands run.");
    // A coding agent's, shorter since the owner's tool plan of 11-08: its options and its plan said at their fields, and
    // how a call waits and goes on waiting at its end.
    assert.equal(TOOL_TEXT.askLeadOwn, "Ask your team's lead and wait for its answer: when your brief leaves open a choice that changes the result (two ways that could both be right), or when you are stuck (the same thing failed twice and you do not see why). Not for permission (a call that needs it asks by itself), nor for what reading can tell you. Your lead answers in its own words; if its turn ends first, go on with your pick and say so in your report. A call waits as long as your client lets one of Filament's calls run; if no answer has come by then it says so: call again with only ask, your question's number, to go on waiting.");
    assert.equal(/** @type {any} */ (ASK_LEAD_TOOL.input_schema).required, undefined, "a call takes question or plan");
    assert.equal(ASK_LEAD_TOOL.input_schema.properties.question.description, "The choice your brief leaves open, or the problem you are stuck on: what you found or tried, and why it changes the result.");
    assert.equal(ASK_LEAD_TOOL.input_schema.properties.options.description, "The ways you see, your pick first: the one you go on with if no answer comes.");
    assert.equal(ASK_LEAD_TOOL.input_schema.properties.plan.description, "Only while your lead reviews your plan: the plan itself (the files you will change, the steps in order, how you will prove it done), alone, without question or options. Your lead's go to it lets your changes and commands run.");
    assert.equal(ASK_LEAD_OWN_TOOL.input_schema.properties.ask.description, "Alone: the number of a question you already asked, to go on waiting for its answer. Not the question's words.");
    assert.equal(ASK_LEAD_SECONDS, 180);
  });
});

/** Let the workers' runs end. @param {...{ r: import("./helpers/team.js").HostRun }} all */
function r_finish(...all) {
  for (const a of all) a.r.finish({ status: "done", report: "DONE" });
}

describe("a question waits for its lead (cases 36 to 39)", () => {
  // (fails before: yes — there was no question to a lead)
  test("it takes the worker's next number, rides its progress as the lead's, is a sign, and its look's head line says it", async () => {
    const a = await asking();
    /** @type {any[]} */
    const said = [];
    const p = a.w.registry.askLead(a.id, { question: QUESTION, options: OPTIONS }, { emit: (e) => said.push(e) });
    const sa = /** @type {any} */ (a.w.registry.get(a.id));
    // No plan: its lead does not review one (TG2-D50, test/plan-review.test.js).
    assert.deepEqual(sa.progress.asking, { to: "lead", tool: "ask_lead", args: "", question: QUESTION, options: OPTIONS, n: 1, at: 1000, plan: false });
    assert.equal(sa.questions, 1);
    // Its number is the events' `ask`: the run log numbers every event `n`, over a payload's.
    assert.deepEqual(said, [{ type: "ask", kind: "lead", tool: "ask_lead", question: QUESTION, options: OPTIONS, waits: true, ask: 1 }], "on the worker's run");
    assert.deepEqual(signsOf(said).map((s) => [s.kind, s.words]), [["asks", "asks you a question, and waits for your answer"]]);
    const told = a.l.timeline.find((e) => e.type === "subagent-ask");
    assert.deepEqual([told?.tool, told?.to, told?.question, told?.ask, told?.options], ["ask_lead", "lead", QUESTION, 1, OPTIONS], "on its lead's timeline");
    a.t.to(41_000);
    assert.ok(watchParts(sa, a.w.registry.now(), { look: true }).includes(`waiting for your answer (ask 1), 40 s so far — "${QUESTION}" — its options: ISO dates (its pick), the locale's`), watchParts(sa, a.w.registry.now(), { look: true }).join(" · "));
    // Its lead answers it under Validate — a lead question is no call, so any words are an answer — by its number.
    const answered = a.l.tools.worker(a.l.call({ agent_id: a.id, answer: "yes, ISO dates", ask: 1 }));
    assert.equal((await answered).text, `Answered builder ${a.id}'s ask 1: it reads your answer now and goes on. Its report still arrives as a message when it finishes.`);
    const got = await p;
    assert.deepEqual(got, { ok: true, n: 1, how: "answered", text: "yes, ISO dates", by: "lead", options: OPTIONS, plan: false });
    assert.equal(leadAnswerWords(got), 'Your lead answered your question (ask 1): "yes, ISO dates"');
    assert.equal(/** @type {any} */ (a.w.registry.get(a.id)).progress.asking, null);
    const end = a.l.timeline.find((e) => e.type === "subagent-ask-end");
    assert.deepEqual([end?.answered, end?.to, end?.by, end?.words], [true, "lead", "lead", "yes, ISO dates"]);
    r_finish(a);
  });

  // (fails before: yes — there was no question to a lead; until TG2-D58 it was no answer in 3 minutes)
  test("its lead's turn ends with it unanswered: the worker goes on with its pick, and a later answer is refused as settled", async () => {
    const a = await asking();
    const p = a.w.registry.askLead(a.id, { question: QUESTION, options: OPTIONS });
    assert.equal(a.timers(ASK_LEAD_SECONDS * 1000).length, 0, "no clock");
    a.t.to(181_000);
    a.l.door.close();
    const got = await p;
    assert.deepEqual(got, { ok: true, n: 1, how: "none", options: OPTIONS, plan: false });
    assert.equal(leadAnswerWords(got), "Your lead's turn ended before it answered (ask 1): go on with your pick — ISO dates — and say in your report that your lead did not answer.");
    assert.equal(leadAnswerWords({ ok: true, n: 2, how: "none", options: [], plan: false }), "Your lead's turn ended before it answered (ask 2): go on with what you judge best, and say in your report that your lead did not answer.");
    const late = await a.l.tools.worker(a.l.call({ agent_id: a.id, answer: "ISO", ask: 1 }));
    assert.equal(late.text, `Nothing answered: builder ${a.id} is not waiting for an answer: ask 1 is settled.`);
    r_finish(a);
  });

  // (fails before: yes — there was no question to a lead)
  test("a stop while it waits: no answer, and the question ends with it", async () => {
    const a = await asking();
    const stop = new AbortController();
    const p = a.w.registry.askLead(a.id, { question: QUESTION }, { signal: stop.signal });
    stop.abort();
    assert.deepEqual(await p, { ok: true, n: 1, how: "stopped", options: [], plan: false });
    assert.equal(/** @type {any} */ (a.w.registry.get(a.id)).progress.asking, null);
    assert.equal(a.l.timeline.find((e) => e.type === "subagent-ask-end")?.answered, false);
    r_finish(a);
  });

  // (fails before: yes — there was no question to a lead)
  test("the run's end ends a question still open", async () => {
    const a = await asking();
    const p = a.w.registry.askLead(a.id, { question: QUESTION }, { withinMs: 45_000 });
    a.timers(45_000)[0].fn();
    const held = await p;
    assert.equal(held.ok && held.how, "later");
    r_finish(a);
    await a.w.registry.settled(a.id);
    assert.equal(a.l.timeline.filter((e) => e.type === "subagent-ask-end").length, 1, "said once, as it ended");
  });

  // (fails before: yes — there was no question to a lead)
  test("the developer's answer counts too, and a permission switch never answers it", async () => {
    const a = await asking();
    const p = a.w.registry.askLead(a.id, { question: QUESTION, options: OPTIONS });
    assert.deepEqual(a.w.registry.answer(a.id, "c1", "", { modeSwitch: true }), { ok: false, error: `builder ${a.id} asks its lead a question (ask 1), not for a permission: a switch answers none` });
    assert.notEqual(/** @type {any} */ (a.w.registry.get(a.id)).progress.asking, null, "it still waits");
    assert.deepEqual(a.w.registry.answer(a.id, "c1", "ISO, as the API does", { n: 1 }), { ok: true, tool: "ask_lead" });
    const got = await p;
    assert.equal(got.ok && got.how === "answered" && got.by, "developer");
    assert.equal(leadAnswerWords(got), 'The developer answered your question (ask 1): "ISO, as the API does"');
    r_finish(a);
  });
});

describe("a coding agent's ask_lead (case 40)", () => {
  // (fails before: yes — there was no question to a lead)
  test("a call holds within its patience and says to call again; the next call gets the answer, which waited between the two", async () => {
    const a = await asking();
    const first = a.w.registry.askLead(a.id, { question: QUESTION, options: OPTIONS }, { withinMs: 45_000 });
    a.t.to(46_000);
    a.timers(45_000)[0].fn();
    const held = await first;
    assert.deepEqual(held, { ok: true, n: 1, how: "later", waited: 45_000, options: OPTIONS, plan: false });
    assert.equal(leadAnswerWords(held), "No answer yet (ask 1, 45 s so far): call ask_lead again with ask 1 alone to go on waiting — your lead's answer comes the moment it lands.");
    assert.equal(/** @type {any} */ (a.w.registry.get(a.id)).progress.asking?.n, 1, "the question stays open");
    // The lead answers between the two calls: the answer waits for the next one.
    assert.equal((await a.l.tools.worker(a.l.call({ agent_id: a.id, answer: "ISO dates", ask: 1 }))).ok, true);
    assert.deepEqual(await a.w.registry.askLead(a.id, null, { n: 1, withinMs: 45_000 }), { ok: true, n: 1, how: "answered", text: "ISO dates", by: "lead", options: OPTIONS, plan: false });
    assert.deepEqual(await a.w.registry.askLead(a.id, null, { n: 1, withinMs: 45_000 }), { ok: false, error: "ask 1 is settled: you have no question waiting now" }, "said once");
    r_finish(a);
  });

  // (fails before: yes — there was no question to a lead; until TG2-D58 its 3 minutes ran across the calls)
  test("no clock across calls: the question waits on until its lead's turn ends", async () => {
    const a = await asking();
    const first = a.w.registry.askLead(a.id, { question: QUESTION }, { withinMs: 45_000 });
    a.t.to(46_000);
    a.timers(45_000)[0].fn();
    assert.equal((await first).ok, true);
    a.t.to(50_000);
    const second = a.w.registry.askLead(a.id, null, { n: 1, withinMs: 45_000 });
    assert.equal(a.timers(ASK_LEAD_SECONDS * 1000).length, 0, "no 3 minutes");
    a.t.to(20 * 60_000);
    a.l.door.close();
    assert.deepEqual(await second, { ok: true, n: 1, how: "none", options: [], plan: false });
    a.timers(45_000)[1].fn();
    assert.deepEqual(await a.w.registry.askLead(a.id, null, { n: 1 }), { ok: false, error: "ask 1 is settled: you have no question waiting now" }, "the hold that ran out after said nothing");
    r_finish(a);
  });

  // (fails before: yes — its turn's events carried the question to its run's translator, which took an ask with no form
  // for nothing: its run never said it, so no sign made its lead's look due, and its 3 minutes could run out before the
  // look's pace came round; and its turn's live line said it waited for the developer)
  test("its question reaches its own run through its turn's events: a sign there, so its lead's look is due at once", async () => {
    const a = await asking();
    // The turn's two readers of each event, as app/acp-turn.js hands them on: its run's translator, then its live line.
    const run = createAgentRun({ publish: (e) => void a.w.log(a.r.runId, e), sink: { breakBlock: () => 0 }, now: a.t.now });
    /** @type {string[]} */
    const stages = [];
    const live = createTurnCollector({ rec: {}, stream: false, wire: /** @type {any} */ (null), thoughtsMode: "hide", renderer: { handle: () => null }, log: () => {}, progress: (f) => void stages.push(f.stage), harness: true });
    const turn = (/** @type {any} */ e) => {
      run.take(e);
      live.onEvent(e);
    };
    turn({ type: "text", text: "The brief says dates; the parser reads both.", messageId: "m1" });
    assert.equal(a.l.door.inbox.due(), false);
    const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: /** @type {any} */ ({ get: () => null }), subagents: () => /** @type {any} */ (a.w.registry), membersOf: () => null });
    const call = tools.call("ask_lead", { question: QUESTION, options: OPTIONS }, { cwd: a.w.dir, upstream: "claude", chain: "c1", turn: null, graph: false, asksLead: a.id, patienceMs: 60_000, emit: turn });
    await until(() => a.w.events(a.r.runId).some((e) => e.type === "ask"), "the question on its run");
    const asked = a.w.events(a.r.runId).find((e) => e.type === "ask");
    assert.deepEqual([asked.round, asked.kind, asked.tool, asked.question, asked.options, asked.waits, asked.ask], [1, "lead", "ask_lead", QUESTION, OPTIONS, true, 1], "in the round it asked in, its number its own");
    assert.equal(a.l.door.inbox.due(), true, "its lead's look is due at once, its pace of 5 minutes not passed");
    assert.equal(stages.at(-1), "waiting for its lead's answer");
    assert.equal((await a.l.tools.worker(a.l.call({ agent_id: a.id, answer: "ISO dates", ask: 1 }))).ok, true);
    assert.deepEqual(await call, { text: 'Your lead answered your question (ask 1): "ISO dates"' });
    r_finish(a);
  });

  // (fails before: yes — there was no question to a lead)
  test("its call holds as long as its agent waits for it, less Filament's margin, then says to call again", async () => {
    const a = await asking();
    const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: /** @type {any} */ ({ get: () => null }), subagents: () => /** @type {any} */ (a.w.registry), membersOf: () => null });
    const ctx = { cwd: a.w.dir, upstream: "claude", chain: "c1", turn: null, graph: false, asksLead: a.id };
    const call = tools.call("ask_lead", { question: QUESTION, options: OPTIONS }, { ...ctx, patienceMs: 60_000 });
    await until(() => a.timers(55_000).length === 1, "its hold, 5 s inside its agent's 60");
    a.t.to(56_000);
    a.timers(55_000)[0].fn();
    assert.deepEqual(await call, { text: "No answer yet (ask 1, 55 s so far): call ask_lead again with ask 1 alone to go on waiting — your lead's answer comes the moment it lands." });
    // An agent whose bridge says nothing of its patience: Filament's 50 s, less the margin.
    const again = tools.call("ask_lead", { ask: 1 }, ctx);
    await until(() => a.timers(45_000).length === 1, "its hold, 5 s inside Filament's 50");
    assert.equal((await a.l.tools.worker(a.l.call({ agent_id: a.id, answer: "ISO dates", ask: 1 }))).ok, true);
    assert.deepEqual(await again, { text: 'Your lead answered your question (ask 1): "ISO dates"' });
    r_finish(a);
  });
});

describe("refusals (case 41)", () => {
  // (fails before: yes — the tool was not there; and the plan's field, its refusals and the words that name it since
  // 2026-10-14, when a held worker's question was found taken as its plan)
  test("a call's input: a question, options of two to four, a plan alone, and ask alone", () => {
    const need = { ok: false, error: "question is required: the choice or the problem, what you found or tried, and why it changes the result — or plan, your plan, while your lead reviews it" };
    const alone = { ok: false, error: "ask goes alone, to go on waiting for a question you asked — a new question takes question, a plan plan" };
    const listOf = { ok: false, error: "options must be a list of two to four non-empty strings, your pick first" };
    const planAlone = { ok: false, error: "plan goes alone: say an open question inside your plan, or ask it in a call of its own" };
    assert.deepEqual(leadQuestionOf({ plan: " Files: a.js. Steps: 1. … Proof: npm test. " }), { ok: true, q: { question: "Files: a.js. Steps: 1. … Proof: npm test.", options: [], plan: true }, n: null });
    assert.deepEqual(leadQuestionOf({ plan: "  " }), need, "an empty plan is none");
    assert.deepEqual(leadQuestionOf({ plan: "The plan.", question: "Which?" }), planAlone);
    assert.deepEqual(leadQuestionOf({ plan: "The plan.", options: ["a", "b"] }), planAlone);
    assert.deepEqual(leadQuestionOf({ plan: "The plan.", ask: 2 }, { coder: true }), alone);
    assert.deepEqual(leadQuestionOf({}), need);
    assert.deepEqual(leadQuestionOf({ question: "  " }), need);
    assert.deepEqual(leadQuestionOf({ ask: 2 }), need, "the loop's tool has no ask: its call waits in place");
    assert.deepEqual(leadQuestionOf({ ask: 2 }, { coder: true }), { ok: true, q: null, n: 2 });
    assert.deepEqual(leadQuestionOf({ question: "Which?", ask: 2 }, { coder: true }), alone);
    assert.deepEqual(leadQuestionOf({ options: ["a", "b"], ask: 2 }, { coder: true }), alone);
    for (const options of [["a"], ["a", "b", "c", "d", "e"], ["a", " "], "a, b", ["a", 2]]) assert.deepEqual(leadQuestionOf({ question: "Which?", options }), listOf, JSON.stringify(options));
    assert.deepEqual(leadQuestionOf({ question: " Which? ", options: [" a ", "b"] }), { ok: true, q: { question: "Which?", options: ["a", "b"] }, n: null });
    assert.deepEqual(leadQuestionOf({ question: "Which?" }), { ok: true, q: { question: "Which?", options: [] }, n: null });
  });

  // (fails before: yes — there was no question to a lead)
  test("a wrong number; a second question while one waits, or its answer waits to be read", async () => {
    const a = await asking();
    assert.deepEqual(await a.w.registry.askLead(a.id, null, { n: 1 }), { ok: false, error: "you asked no ask 1: you have no question waiting now" });
    const first = a.w.registry.askLead(a.id, { question: QUESTION }, { withinMs: 45_000 });
    assert.deepEqual(await a.w.registry.askLead(a.id, { question: "And the other?" }), { ok: false, error: "your question waiting is ask 1: call ask_lead with ask 1 alone to go on waiting for its answer" });
    assert.deepEqual(await a.w.registry.askLead(a.id, null, { n: 4 }), { ok: false, error: "you asked no ask 4: your question waiting is ask 1" });
    a.timers(45_000)[0].fn();
    await first;
    assert.equal((await a.l.tools.worker(a.l.call({ agent_id: a.id, answer: "ISO", ask: 1 }))).ok, true);
    assert.deepEqual(await a.w.registry.askLead(a.id, { question: "And the other?" }), { ok: false, error: "your lead answered ask 1: call ask_lead with ask 1 alone to read its answer" });
    assert.equal((await a.w.registry.askLead(a.id, null, { n: 1 })).ok, true);
    const second = a.w.registry.askLead(a.id, { question: "And the other?" }, { withinMs: 45_000 });
    assert.deepEqual(await a.w.registry.askLead(a.id, null, { n: 1 }), { ok: false, error: "ask 1 is settled: your question waiting is ask 2" });
    a.timers(45_000)[1].fn();
    assert.equal((await second).ok, true);
    r_finish(a);
  });

  // (fails before: yes — there was no question to a lead)
  test("two questions at once, either way round: the second is refused with what to do", async () => {
    const a = await asking();
    const lead = a.w.registry.askLead(a.id, { question: QUESTION }, { withinMs: 45_000 });
    const call = await a.w.registry.ask(a.id, { tool: "bash", args: "npm test", question: "May I run this command? `npm test`" });
    assert.deepEqual(call, { text: "Not now: your question to your lead (ask 1) waits for its answer — run this once it is answered.", by: "filament" });
    assert.equal(/** @type {any} */ (a.w.registry.get(a.id)).questions, 1, "the refused call took no number");
    a.timers(45_000)[0].fn();
    await lead;
    assert.equal((await a.l.tools.worker(a.l.call({ agent_id: a.id, answer: "ISO", ask: 1 }))).ok, true);
    assert.equal((await a.w.registry.askLead(a.id, null, { n: 1 })).ok, true);
    const permission = a.w.registry.ask(a.id, { tool: "bash", args: "npm test", question: "May I run this command? `npm test`" });
    assert.deepEqual(await a.w.registry.askLead(a.id, { question: QUESTION }), { ok: false, error: "a call of yours waits for an answer now (ask 2): ask your lead once it is settled" });
    a.w.registry.answer(a.id, "c1", "no", { n: 2 });
    await permission;
    r_finish(a);
  });

  // (fails before: yes — the lead's message said "on a ask_lead call", and "your no")
  test("a message to a worker whose question waits says the lead's answer comes first", async () => {
    const a = await asking();
    const p = a.w.registry.askLead(a.id, { question: QUESTION });
    const sent = await a.l.tools.worker(a.l.call({ agent_id: a.id, prompt: "Keep the old format working too." }));
    assert.equal(sent.text, `Sent to builder ${a.id}: it waits for your answer to its question (ask 1) now — give it with answer and ask — and reads your message at its next step after that. Its report still arrives as a message when it finishes.`);
    const all = await a.l.tools.worker(a.l.call({ agent_id: "all", prompt: "Run the linter before you report." }));
    assert.equal(all.text, `Sent to 1 worker running now — builder ${a.id}: it reads it at its next step (after your answer to its question: ask 1). Its report still arrives as a message when it finishes.`);
    a.w.registry.answer(a.id, "c1", "ISO", { n: 1 });
    await p;
    r_finish(a);
  });
});

describe("on Filament's loop (cases 36, 37 and 41)", () => {
  /**
   * A worker's loop that calls ask_lead once with `input`, then ends — its lead's answer what `answer` gives.
   * @param {any} input @param {(q: any, o: any) => Promise<any>} answer
   */
  const asked = async (input, answer) => {
    /** @type {any[]} */
    const bodies = [];
    /** @type {any[]} */
    const events = [];
    /** @type {any[]} */
    const calls = [];
    let n = 0;
    const out = await runAgentTurn(
      /** @type {any} */ ({
        model: "m",
        messages: [{ role: "user", content: "parse the dates" }],
        system: "s",
        tools: loopToolArgs({ askLead: true }),
        modeNow: () => "edit",
        root: tmpdir(),
        readerModel: "",
        maxTokens: 100,
        unattended: "worker",
        askLead: (/** @type {any} */ q, /** @type {any} */ o) => {
          calls.push({ q, signal: o.signal instanceof AbortSignal });
          o.emit({ type: "ask", kind: "lead", tool: "ask_lead", question: q.question, waits: true, ask: 1 });
          return answer(q, o);
        },
        call: async (/** @type {any} */ { body }) => {
          bodies.push(structuredClone(body));
          const content = n++ === 0 ? [{ type: "tool_use", id: "q1", name: "ask_lead", input }] : [{ type: "text", text: "Done." }];
          return { ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null };
        },
        costOf: () => 0,
        runHand: async () => "ran",
        delegateRead: null,
        mailbox: null,
        permissions: null,
        tree: null,
        onEvent: (/** @type {any} */ e) => events.push(e),
        previewChars: 0,
        sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
        // The round's cut reaches the question: the client's hang-up here.
        signal: new AbortController().signal,
        resume: null,
      }),
    );
    const result = bodies[1]?.messages.at(-1).content.find((/** @type {any} */ b) => b.type === "tool_result" && b.tool_use_id === "q1") || null;
    return { out, events, calls, result };
  };

  // (fails before: yes — ask_lead was no loop tool: "That tool is not available here")
  test("the call waits in place for its lead's answer, its run says what it waits on, and the answer is its result", async () => {
    const w = await asked({ question: QUESTION, options: OPTIONS }, async () => ({ ok: true, n: 1, how: "answered", text: "ISO dates", by: "lead", options: OPTIONS, plan: false }));
    assert.equal(w.out.status, "done", JSON.stringify(w.out.notes));
    assert.deepEqual(w.calls, [{ q: { question: QUESTION, options: OPTIONS }, signal: true }]);
    assert.deepEqual([w.result?.is_error, w.result?.content], [undefined, 'Your lead answered your question (ask 1): "ISO dates"']);
    assert.deepEqual(w.events.find((e) => e.type === "ask"), { type: "ask", round: 1, kind: "lead", tool: "ask_lead", question: QUESTION, waits: true, ask: 1 }, "on its run, at its round");
    const states = w.events.filter((e) => e.type === "turn-state").map((e) => `${e.to}: ${e.why}`);
    assert.ok(states.includes("waiting: its lead's answer to its question"), states.join("\n"));
    assert.ok(w.out.notes.includes("agent: ask_lead — its lead answered (ask 1)"), w.out.notes.join("\n"));
  });

  // (fails before: yes — ask_lead was no loop tool; until TG2-D58 no answer was its 3 minutes)
  test("no answer is the words with its pick; a refusal is the call's error", async () => {
    const none = await asked({ question: QUESTION, options: OPTIONS }, async () => ({ ok: true, n: 1, how: "none", options: OPTIONS, plan: false }));
    assert.equal(none.result?.content, "Your lead's turn ended before it answered (ask 1): go on with your pick — ISO dates — and say in your report that your lead did not answer.");
    assert.ok(none.out.notes.includes("agent: ask_lead — no answer: its lead's turn ended (ask 1)"), none.out.notes.join("\n"));
    const plan = await asked({ plan: "Files: a.js. Proof: npm test." }, async () => ({ ok: true, n: 1, how: "none", options: [], plan: true }));
    assert.ok(plan.out.notes.includes("agent: ask_lead — no answer from its lead in 3 minutes (ask 1)"), "a plan keeps its 3 minutes (TG2-D50)");
    const bad = await asked({ question: QUESTION, options: ["only one"] }, async () => assert.fail("never asked"));
    assert.deepEqual([bad.result?.is_error, bad.result?.content], [true, "Error: options must be a list of two to four non-empty strings, your pick first"]);
    const refused = await asked({ question: QUESTION }, async () => ({ ok: false, error: "your lead's turn has ended, so no question reaches it now" }));
    assert.deepEqual([refused.result?.is_error, refused.result?.content], [true, "Error: your lead's turn has ended, so no question reaches it now"]);
  });
});

describe("the words a worker and its lead read (cases 37 and 43)", () => {
  const WORKER = { team: "Architect", words: "" };
  // (fails before: yes — a worker whose lead reads along was told "Do not stop to ask a question"; since TG2-D58 it is
  // told to ask when stuck too, and so is a worker whose lead does not read along — test/lead-asked.test.js)
  test("a worker of a lead that reads along is told when to ask it; a graph task's sub-agent keeps the old line", () => {
    const reads = systemPromptFor({ root: "/w", delegateRead: false, subagent: true, worker: WORKER, supervise: true });
    assert.ok(reads.includes(`whether your work meets the acceptance check in your brief and how you know — what you ran and its real result, or why it could not be run. Say what is left. ${SUBJECT_LINE("your lead")} A follow-up may come later in this same conversation. ${PROMPT.workerAsksLead}`), reads);
    assert.equal(PROMPT.workerAsksLead, "Ask your lead with ask_lead when your brief does not settle a choice that changes the result, or when you are stuck — the same thing failed twice and you do not see why: say what you found or tried, and your options, your pick first. Then wait for its answer; do not guess.");
    assert.ok(!reads.includes(PROMPT.workerGoOn));
    const task = systemPromptFor({ root: "/w", delegateRead: false, subagent: true, task: "work", graph: false, supervise: true });
    assert.ok(task.includes(PROMPT.workerGoOn) && !task.includes("ask_lead"), task);
    const host = { id: "sa_1", card: { tag: "builder", name: "Builder", kind: "worker", thinks: "" }, readOnly: false, asks: true, team: { name: "Architect", role: "builder", words: "" }, task: null, supervise: true };
    assert.ok(workerWords(host).includes(PROMPT.workerAsksLead), "a coding agent's worker the same");
    assert.ok(workerWords({ ...host, team: null, task: { id: "t1", review: false } }).includes(PROMPT.workerGoOn));
  });

  // (fails before: yes — a lead was never asked; and, as first built, it read "its plan where you asked to review it",
  // and a GLM lead told to launch "with plan review" asked for the plan in its brief's steps: the line names the field;
  // since TG2-D58 a stuck worker asks too, the lead answers before anything else and finds what the answer takes, and
  // no 3 minutes run out on a question)
  test("a lead that reads along is told it may be asked, in both seats, and its worker tool says how to answer", () => {
    const line = "- A worker may ask you — a choice its brief does not settle, a problem it is stuck on, or its plan where you launched it with plan_review — and waits for your answer: answer it before anything else, by its number (worker with agent_id, ask and answer). Where the answer takes finding, find it — read the code, or have a worker find out — then say what to do and why.";
    for (const looks of [PROMPT.leadLooks, PROMPT.leadLooksOwn]) {
      const lines = String(looks).split("\n");
      assert.equal(lines[lines.findIndex((l) => l.startsWith("- Correct early.")) + 1], line);
    }
    assert.ok(TOOL_TEXT.workerReads.endsWith("A worker your look shows waiting takes your answer: answer, with ask (the number your look gives that question) and nothing else. Its question to you, you answer in your own words; it waits for your answer. Its call, yes runs it, and any other words refuse it and tell the worker what to do instead."), TOOL_TEXT.workerReads);
  });
});
