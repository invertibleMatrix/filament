// @ts-check
// HarnessV3-TaskGraph-v2 §13.17 TG2-D60: a lead reads what its workers say and do, never what they think. Nothing a
// lead reads holds a worker's thinking — a look in either seat, show_trail, the session's agent's look at its graph's
// sub-agents; a round that only thought is in none of them and makes no look due, and a worker's plan is its first
// words. What stays is a count: a running call's thinking so far, on the head line. The words in every seat that reads
// along say so (prompt version 30); the figures that move with them are lead-briefing.test.js's.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createLooks, newMark, noted } from "../src/app/agent/looks.js";
import { PROMPT, PROMPT_VERSION, TOOL_TEXT, leadLines, systemPromptFor } from "../src/app/agent/prompt.js";
import { watchParts } from "../src/app/agent/team-tools.js";
import { WORKER_READS_OWN_TOOL, WORKER_READS_TOOL } from "../src/app/agent/tools.js";
import { leadWords } from "../src/app/agent-lead.js";
import { workerWords } from "../src/app/agent-worker.js";
import { trailOf } from "../src/core/run-work.js";
import { signsOf } from "../src/core/signs.js";
import { shippedCard } from "../src/services/agent-cards.js";

/**
 * A lead's turn over workers whose run logs the test writes (lead-looks.test.js's bench): `log(id, event)` records an
 * event as the run log would and notes it on the worker's mark, as the registry does.
 * @param {{ seconds?: number, lean?: boolean, who?: import("../src/app/agent/looks.js").Crewed }} [o]
 */
function bench({ seconds = 30, lean = false, who = "workers" } = {}) {
  let clock = 1_000_000;
  /** @type {Map<string, any[]>} */
  const logs = new Map();
  /** @type {import("../src/app/agent/looks.js").Watched[]} */
  const watched = [];
  let rings = 0;
  const looks = createLooks({ now: () => clock, later: () => {}, seconds: () => seconds, lean, workers: () => watched, eventsOf: (run) => logs.get(run) || [], wake: () => void rings++, who });
  return {
    looks,
    rings: () => rings,
    /** @param {string} id @param {string} role @param {string} description @param {string | null} [task] */
    worker(id, role, description, task = null) {
      logs.set(`run-${id}`, []);
      watched.push({ id, role, description, task, run: `run-${id}`, head: ["round 1"], mark: newMark() });
      return /** @type {import("../src/app/agent/looks.js").Watched} */ (watched.at(-1));
    },
    /** @param {string} id @param {any} e */
    log(id, e) {
      const list = /** @type {any[]} */ (logs.get(`run-${id}`));
      const evt = { n: list.length + 1, ts: clock, ...e };
      list.push(evt);
      const w = /** @type {import("../src/app/agent/looks.js").Watched} */ (watched.find((x) => x.id === id));
      if (noted(w.mark, evt, null)) looks.ring();
    },
  };
}
/** A look's words, as the turn reads it now. @param {ReturnType<typeof bench>} b */
const lookText = (b) => /** @type {{ text: string }} */ (b.looks.take()).text;
const read = (/** @type {string} */ id, /** @type {string} */ path, round = 1) => ({ type: "tool-start", round, id, name: "read", args: path, card: { kind: "read", subject: path } });
const edit = (/** @type {string} */ id, /** @type {string} */ path, round = 2) => ({ type: "tool-start", round, id, name: "edit", args: path, card: { kind: "edit", subject: path } });
const ended = (/** @type {string} */ id, /** @type {string} */ name, round = 1) => ({ type: "tool-end", round, id, name, ok: true, chars: 40 });
/** A run's events, numbered as the run log numbers them. @param {any[]} list */
const numbered = (list) => list.map((e, i) => ({ n: i + 1, ...e }));

describe("a look holds no worker's thinking (TG2-D60)", () => {
  // (fails before: yes — every round's thinking was in the look whole, as "Thought: …")
  test("a look on Filament's loop gives a round's words and calls, and none of its thinking", () => {
    const b = bench();
    b.worker("sa_1", "builder", "parse the ledger file");
    b.log("sa_1", { type: "round-start", round: 1 });
    b.log("sa_1", { type: "round-thinking", round: 1, thinking: "THOUGHT-1: floats lose cents." });
    b.log("sa_1", { type: "round-text", round: 1, text: "Plan: read src/ledger.js, then change parse()." });
    b.log("sa_1", read("c1", "src/ledger.js"));
    assert.equal(lookText(b), [
      "[Filament: a look at your workers. 1 is running.]",
      "",
      '## builder sa_1 — "parse the ledger file"',
      "round 1 · sign: said how it will go about its task",
      "Its plan (round 1): Plan: read src/ledger.js, then change parse().",
      "",
      "Round 1",
      "Said: Plan: read src/ledger.js, then change parse().",
      "Called read `src/ledger.js` → still running",
    ].join("\n"));
  });

  // (fails before: yes — a coding agent's lead read a round's thinking where a sign fired in it)
  test("a coding agent's lead: a round where a sign fired shows none of its thinking either", () => {
    const b = bench({ lean: true });
    b.worker("sa_1", "builder", "parse the ledger file");
    b.log("sa_1", { type: "round-thinking", round: 1, thinking: "THOUGHT-1: read first." });
    b.log("sa_1", { type: "round-text", round: 1, text: "Plan: integers." });
    b.log("sa_1", read("c0", "src/ledger.js"));
    const first = lookText(b);
    assert.ok(first.includes("sign: said how it will go about its task") && first.includes("Round 1\nSaid: Plan: integers.\nCalled read `src/ledger.js` → still running"), first);
    b.log("sa_1", { type: "round-start", round: 2 });
    b.log("sa_1", { type: "round-thinking", round: 2, thinking: "THOUGHT-2: switch to cents." });
    b.log("sa_1", edit("c1", "src/ledger.js"));
    const next = lookText(b);
    assert.equal(next, ["[Filament: a look at your workers. Since the last: 1 moved, 0 did not.]", "", '## builder sa_1 — "parse the ledger file"', "round 1 · sign: made its first change (src/ledger.js)", "", "Round 2", "Called edit `src/ledger.js` → still running"].join("\n"));
    assert.ok(![first, next].some((t) => t.includes("THOUGHT")));
  });

  // (fails before: yes — a first round that only thought gave the plan from its thinking, and the plan sign said it
  // had said how it would go about its task)
  test("a worker's plan is its first words: one whose first round only thought has said none, and no sign says so", () => {
    const thoughtOnly = [
      { type: "round-start", round: 1 },
      { type: "round-thinking", round: 1, thinking: "THOUGHT-1: I will grep for parse." },
      { type: "tool-start", round: 1, id: "c1", name: "grep", args: "parse", card: { kind: "search", subject: "parse" } },
      ended("c1", "grep"),
      { type: "round-start", round: 2 },
    ];
    assert.equal(trailOf(numbered(thoughtOnly)).plan, null);
    assert.deepEqual(signsOf(numbered(thoughtOnly)), []);
    const b = bench({ seconds: 0 });
    b.worker("sa_1", "builder", "parse the ledger file");
    for (const e of thoughtOnly) b.log("sa_1", e);
    const first = lookText(b);
    assert.ok(first.includes("\nround 1\nIt has said no plan yet.\n") && !first.includes("sign:") && !first.includes("THOUGHT"), first);
    // Its first words are its plan, once its run goes on from them, and the sign comes with them.
    const words = [{ type: "round-text", round: 2, text: "Now: parse() into cents." }, edit("c2", "src/ledger.js")];
    for (const e of words) b.log("sa_1", e);
    const next = lookText(b);
    assert.ok(next.includes("sign: said how it will go about its task · sign: made its first change (src/ledger.js)\nIts plan (round 2): Now: parse() into cents.\n"), next);
    assert.deepEqual(trailOf(numbered([...thoughtOnly, ...words])).plan, { round: 2, text: "Now: parse() into cents." });
    assert.deepEqual(signsOf(numbered([...thoughtOnly, ...words])).map((s) => [s.kind, s.round]), [["plan", 2], ["change", 2]]);
  });

  // (fails before: yes — the thinking stirred the worker's trail, so its next round rang the lead for a look that had
  // only its thinking to show)
  test("a round that only thought makes no look due, and is in no look and no trail", () => {
    const b = bench({ seconds: 0 });
    const w = b.worker("sa_1", "builder", "parse the ledger file");
    b.log("sa_1", { type: "round-text", round: 1, text: "Plan: integers." });
    b.log("sa_1", read("c0", "a.js"));
    b.log("sa_1", ended("c0", "read"));
    lookText(b);
    const rung = b.rings();
    b.log("sa_1", { type: "round-start", round: 2 });
    b.log("sa_1", { type: "round-thinking", round: 2, thinking: "THOUGHT-2: hm." });
    b.log("sa_1", { type: "round-start", round: 3 });
    assert.deepEqual([b.looks.due(), b.rings()], [false, rung]);
    b.looks.ask();
    const look = lookText(b);
    assert.ok(look.endsWith("\nNothing new since your last look.") && !look.includes("THOUGHT"), look);
    const trail = b.looks.trail(w);
    assert.ok(!trail.includes("Round 2") && !trail.includes("THOUGHT"), trail);
    assert.deepEqual(trailOf(numbered([{ type: "round-start", round: 1 }, { type: "round-thinking", round: 1, thinking: "THOUGHT-1" }])).rounds, []);
  });

  // (fails before: yes — the thinking a look did not show made the round "continued" in the next one)
  test("a round that thought before a look and called after it is new to the next look, not continued", () => {
    const b = bench({ seconds: 0 });
    b.worker("sa_1", "builder", "parse the ledger file");
    b.log("sa_1", { type: "round-text", round: 1, text: "Plan: integers." });
    b.log("sa_1", read("c0", "a.js"));
    b.log("sa_1", ended("c0", "read"));
    b.log("sa_1", { type: "round-start", round: 2 });
    b.log("sa_1", { type: "round-thinking", round: 2, thinking: "THOUGHT-2: now the edit." });
    b.looks.ask();
    const first = lookText(b);
    assert.ok(!first.includes("Round 2") && !first.includes("THOUGHT"), first);
    b.log("sa_1", edit("c1", "src/ledger.js"));
    const next = lookText(b);
    assert.ok(next.includes("So far (round 1): read 1 file\n\nRound 2\nCalled edit `src/ledger.js` → still running") && !next.includes("continued"), next);
  });

  // (fails before: yes — show_trail gave a worker's rounds with their thinking, in both seats)
  test("show_trail, in either seat, holds no thinking", () => {
    for (const lean of [false, true]) {
      const b = bench({ lean });
      const w = b.worker("sa_1", "builder", "parse the ledger file");
      b.log("sa_1", { type: "round-thinking", round: 1, thinking: "THOUGHT-1: read first." });
      b.log("sa_1", { type: "round-text", round: 1, text: "Plan: integers." });
      b.log("sa_1", read("c0", "a.js"));
      const trail = b.looks.trail(w);
      assert.ok(trail.includes("\n\nRound 1\nSaid: Plan: integers.\nCalled read `a.js` → still running") && !trail.includes("THOUGHT") && !trail.includes("Thought"), trail);
    }
  });

  // (fails before: yes — the session's agent read its graph's sub-agents' thinking as a team's lead did)
  test("the session's agent's look at its graph's sub-agent holds none either", () => {
    for (const lean of [false, true]) {
      const b = bench({ lean, who: "sub-agents" });
      b.worker("sa_1", "sub-agent", "t1: parse the ledger file", "t1");
      b.log("sa_1", { type: "round-thinking", round: 1, thinking: "THOUGHT-1: read first." });
      b.log("sa_1", { type: "round-text", round: 1, text: "Plan: integers." });
      b.log("sa_1", read("c0", "a.js"));
      const look = lookText(b);
      assert.ok(look.startsWith("[Filament: a look at your sub-agents. 1 is running.]") && look.includes("Said: Plan: integers.") && !look.includes("THOUGHT"), look);
    }
  });

  // (fails before: no — kept: how much a running call has thought is a signal, never what it thought)
  test("a running call's thinking so far is still counted on the head line", () => {
    const progress = { round: 3, bounce: null, check: null, asking: null, held: false, wait: null, call: { began: 0, thinking: 39_200, text: 0, lastAt: 359_000 }, tool: null, context: null, compactions: [], words: "" };
    assert.deepEqual(watchParts(/** @type {any} */ ({ progress }), 360_000, { look: true }), ["round 3", "model call 6 min · about 9,800 tokens of thinking so far · last byte 1 s ago"]);
  });
});

describe("the words: a worker's thinking is its own (TG2-D60, prompt version 30)", () => {
  const ENV = "# Environment\n- the machine";
  const LEAD = { name: "Architect", persona: "You lead." };
  const ASK_REASONS = "A worker's thinking is not in it: where you need its reasons, ask it in a message.";
  const WORKER_READS = "Your team's lead reads what you say and do as you work — never your thinking — and may message you between ticks, relayed by Filament; so may the developer. Acknowledge a message in your next reply before acting on it.";
  const TASK_READS = "The agent that planned your task reads what you say and do as you work — never your thinking — and may message you between ticks, relayed by Filament; so may the developer. Acknowledge a message in your next reply before acting on it.";
  const COURSE = "When you change course, say so and why in a line.";
  /** Whether words still say a worker's thinking is read. @param {string} s */
  const saysThinking = (s) => /what it thought|what it has thought|its thinking included|what you think|what it thought where/.test(s);

  // (fails before: yes — version 29)
  test("prompt version 30, 31 since a lead's brief may go to attempts (TG2-D53), 32 since E4 (a model that takes no tools: model-no-tools.test.js), and 33 since V2-1 (a task's check: checked-done.test.js)", () => {
    assert.equal(PROMPT_VERSION, 129);
  });

  // (fails before: yes — a lead was told a look gives what each worker thought)
  test("a lead that reads along is told its looks give what a worker said and called, and to ask for its reasons — in both seats", () => {
    const loop = String(PROMPT.leadLooks).split("\n");
    assert.ok(loop[0].endsWith(`For each worker it gives its plan as it said it, what it has done so far in a line, and every round since your last look whole: what it said and called. A call is shown by its target, and a failed one by the first lines of its result. Read it for where each worker is heading, against its brief and what you know of the task. ${ASK_REASONS}`), loop[0]);
    const own = String(PROMPT.leadLooksOwn).split("\n");
    assert.ok(own[0].endsWith(`For each worker it gives every round since your last look: what it said and called. A call is shown by its target, and a failed one by the first lines of its result. Read it for where each worker is heading, against its brief and what you know of the task. ${ASK_REASONS}`), own[0]);
    assert.equal(own[1], "- These looks stay in your conversation, so Filament keeps them short: none repeats what an earlier one showed. worker with show_trail: true shows one worker's rounds whole, with show_changes: true what it has changed so far, and with show_report: true its brief and its reports whole.");
    for (const text of [TOOL_TEXT.workerReads, TOOL_TEXT.workerReadsOwn]) assert.ok(String(text).includes("show_trail: true gives a running worker's rounds whole (what it said and called) from from_round on, or from its start"), String(text));
    assert.equal(WORKER_READS_TOOL.input_schema.properties.show_trail.description, "With no prompt, a running worker's rounds whole: what it said and called. It replaces the trail of that worker you asked for before.");
    assert.equal(WORKER_READS_OWN_TOOL.input_schema.properties.show_trail.description, "With no prompt, a running worker's rounds whole: what it said and called.");
    const loopLead = systemPromptFor({ root: "/w", delegateRead: false, lead: LEAD, environment: ENV, supervise: true });
    const ownLead = leadWords(LEAD, { supervise: true });
    assert.ok(loopLead.includes(ASK_REASONS) && ownLead.includes(ASK_REASONS));
    for (const s of [loopLead, ownLead, leadLines({ supervise: true }), leadLines({ own: true, supervise: true }), JSON.stringify(WORKER_READS_TOOL), JSON.stringify(WORKER_READS_OWN_TOOL)]) assert.ok(!saysThinking(s), s);
  });

  // (fails before: yes — the session's agent was told its look gives what a sub-agent has thought)
  test("the session's agent is told its look gives what a sub-agent has said and done, never its thinking", () => {
    assert.ok(String(PROMPT.graphLooks).startsWith("- While such a task runs, Filament shows you a look at its sub-agent — what it has said and done since you last looked, never its thinking: at once on a sign,"), String(PROMPT.graphLooks));
    const agent = systemPromptFor({ root: "/w", delegateRead: false, environment: ENV, graph: true, supervise: true });
    assert.ok(agent.includes(String(PROMPT.graphLooks)) && !saysThinking(agent));
  });

  // (fails before: yes — a worker was told its lead reads what it thinks)
  test("a worker whose lead reads along is told its thinking is its own, and to say a change of course — in both seats, and a graph task's sub-agent of the agent that planned it", () => {
    assert.deepEqual(String(PROMPT.workerReadAlong).split("\n"), [WORKER_READS, `In your first reply, say in a few lines how you will go about the task: what you will read or change, and how you will prove it done. Then go on without waiting: your lead corrects you if it sees it differently. ${COURSE}`]);
    assert.deepEqual(String(PROMPT.taskReadAlong).split("\n"), [TASK_READS, `In your first reply, say in a few lines how you will go about the task: what you will read or change, and how you will prove it done. Then go on without waiting: the agent corrects you if it sees it differently. ${COURSE}`]);
    const builder = systemPromptFor({ root: "/w", delegateRead: false, toolsOff: ["ask", "plan", "agent"], subagent: true, card: shippedCard("builder"), worker: { team: "Architect", words: "" }, environment: ENV, supervise: true });
    const coder = workerWords({ id: "", card: /** @type {any} */ (shippedCard("builder")), readOnly: false, asks: false, team: { name: "Architect", role: "builder", words: "" }, task: null, supervise: true });
    const task = systemPromptFor({ root: "/w", delegateRead: false, toolsOff: ["ask", "plan", "agent"], subagent: true, card: shippedCard("builder"), task: "work", environment: ENV, supervise: true });
    const coderTask = workerWords({ id: "", card: /** @type {any} */ (shippedCard("builder")), readOnly: false, asks: false, team: null, task: /** @type {any} */ ({ review: false }), supervise: true });
    for (const [s, line] of [[builder, WORKER_READS], [coder, WORKER_READS], [task, TASK_READS], [coderTask, TASK_READS]]) assert.ok(s.includes(line) && s.includes(COURSE) && !saysThinking(s), s);
    // A worker whose lead does not read along is told nothing of it: its words are version 29's.
    const unread = systemPromptFor({ root: "/w", delegateRead: false, toolsOff: ["ask", "plan", "agent"], subagent: true, card: shippedCard("builder"), worker: { team: "Architect", words: "" }, environment: ENV });
    assert.ok(unread.includes(String(PROMPT.workerSteering)) && !unread.includes(COURSE));
  });
});
