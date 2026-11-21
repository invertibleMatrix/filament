// @ts-check
// HarnessV3-TaskGraph-v2 TG2-D50, plan review where the lead asks for it (§13.13, cases 44 to 47). A lead that reads
// along may launch a worker with plan_review: the worker reads and plans first, and sends its plan with ask_lead's
// `plan`; its changes and commands — its brief's grants among them — are refused until its lead answers go to it, or
// until 3 minutes after its plan with no answer. A go is the answer's `go: true`, never its words (the owner's rule:
// nothing reads words for a yes); an answer without it is the lead's correction, the hold stays, and the worker sends its plan again. A question it asks while
// held is a question (since 2026-10-14, the Haiku drive's finding): its answer is no go nor no go, and the hold stays.
// On Filament's loop the gate holds it; on a coding agent the session's switch, which says why once a turn, since its
// agent hears only a no. The note ahead of its brief and the launch's answer say so. The live drive of a coding agent's
// hold is in team-agent-workers.test.js.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { ASK_LEAD_SECONDS, SUBAGENT_NOTES } from "../src/app/agent/subagents.js";
import { PLAN_HELD, TEAM_AGENT_TOOL, leadAnswerWords, loopToolArgs, teamAgentToolFor } from "../src/app/agent/tools.js";
import { briefText, inputRefusal, watchParts } from "../src/app/agent/team-tools.js";
import { createAgentPermits } from "../src/app/agent-permits.js";
import { signsOf } from "../src/core/signs.js";
import { leadAskLine } from "../src/ui/harness/lib/team.js";
import { liveLine } from "../src/ui/harness/conversation/agent-card.js";
import { sideRow } from "../src/ui/harness/lib/side.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { BRIEF, heldTime, leadOf, watched } from "./helpers/team.js";
import { MEMBERS } from "./helpers/roster.js";
import { until } from "./helpers/wait.js";

const PLAN = "Files: src/parse.js. Steps: 1. return [] for an empty input; 2. run the parser's tests. Proof: node --test test/parse.test.js passes.";
const FIELD = "true: the worker reads and plans first, then sends you its plan with ask_lead, and its changes and commands wait for your go. Answer it with go: true to let it start, or with your corrections and no go. With no answer in 3 minutes it goes on with its plan. Only where you read along with your workers.";
const NOTE = "[Filament: your lead reviews your plan before you change anything. Read what you need, then send your plan with ask_lead's plan: the files you will change, the steps in order, and how you will prove it done. A question you have goes in question, as always: your plan still waits after its answer. Until your lead answers go to your plan, your changes and commands are refused, and your reads run. Your lead's other words to your plan are its corrections: follow them, and send the plan again. With no answer 3 minutes after you sent it, go on with your plan.]";
const HELD = "Not run: your lead reviews your plan before you change anything — send it with ask_lead's plan; this runs once your lead answers go, or 3 minutes after your plan with no answer. Your reads run meanwhile.";
/** A plan as ask_lead's `plan` reads it into the registry. @param {string} text */
const asPlan = (text) => ({ question: text, options: [], plan: true });
const NOT_SENT = "its changes wait for your review of its plan, not sent yet";

/**
 * A builder launched under a lead that reads along, with plan_review unless `review` is false, its run attached, on a
 * clock the test holds. @param {{ review?: boolean }} [o]
 */
const reviewing = async ({ review = true } = {}) => {
  const t = heldTime();
  const w = watched({ runlog: true, now: t.now, later: t.later });
  const l = leadOf(w.registry, w.dir, { looks: 300 });
  const launched = await l.tools.agent(l.call({ ...BRIEF, ...(review ? { plan_review: true } : {}) }));
  assert.equal(launched.ok, true, launched.text);
  const id = String(launched.agentId);
  const r = await w.run(1);
  r.attach();
  await until(() => w.registry.get(id)?.runId === r.runId, "its run to attach");
  /** How its look's head line reads now. */
  const head = () => watchParts(/** @type {any} */ (w.registry.get(id)), w.registry.now(), { look: true });
  /** The timers of a length, in the order the registry set them. @param {number} ms */
  const timers = (ms) => t.timers.filter((x) => x.ms === ms);
  return { t, w, l, id, r, launched, head, timers };
};

describe("plan_review at launch (case 44)", () => {
  // (fails before: yes — the agent tool had no plan_review: the field was unknown, and nothing held a worker's changes)
  test("refused for a lead that does not read along, and for a member that only reads; the field is in every lead's tools", async () => {
    const off = watched();
    const plain = leadOf(off.registry, off.dir);
    const r = await plain.tools.agent(plain.call({ ...BRIEF, plan_review: true }));
    assert.deepEqual([r.ok, r.text], [false, "Not launched: plan_review needs a lead that reads along with its workers (engine.supervise is off): its plan would reach no one."]);
    assert.equal(off.registry.list("c1").length, 0, "nothing launched");
    assert.equal(inputRefusal("agent", { ...BRIEF, role: "scout", plan_review: true }, { reads: true, members: MEMBERS })?.text, "Not launched: plan_review holds a worker's changes until you say go, and scout changes nothing: leave plan_review out.");
    // A saved agent asked for its view answers a question and changes nothing: no plan would come (as built, §13.13).
    assert.equal(inputRefusal("agent", { role: "security-reviewer", goal: "Is the parser's input safe?", plan_review: true }, { reads: true, members: MEMBERS })?.text, "Not launched: plan_review holds a worker's changes until you say go, and security-reviewer changes nothing: leave plan_review out.");
    assert.equal(inputRefusal("agent", { ...BRIEF, plan_review: true }, { reads: true, members: MEMBERS }), null);
    assert.equal(inputRefusal("agent", { ...BRIEF, plan_review: false }, { members: MEMBERS }), null, "false holds nothing, so it asks nothing of the lead");
    // In every lead's tools, in both seats and with the switch either way: the loop's, and the one over MCP.
    for (const tool of [TEAM_AGENT_TOOL, teamAgentToolFor([], MEMBERS), ...[loopToolArgs({ lead: true }), loopToolArgs({ lead: true, supervise: true })].map((ts) => ts.find((/** @type {any} */ x) => x.name === "agent"))])
      assert.deepEqual(/** @type {any} */ (tool).input_schema.properties.plan_review, { type: "boolean", description: FIELD });
  });
});

describe("plan review on the registry (case 45)", () => {
  // (fails before: yes — nothing held a worker's changes for its plan)
  test("held from its start: its head line says so; its plan is a question to its lead and a sign; a go lets the work start", async () => {
    const a = await reviewing();
    assert.equal(a.w.registry.planHeld(a.id), true);
    assert.ok(a.head().includes(NOT_SENT), a.head().join(" · "));
    /** @type {any[]} */
    const said = [];
    const p = a.w.registry.askLead(a.id, asPlan(PLAN), { emit: (e) => said.push(e) });
    assert.deepEqual(said, [{ type: "ask", kind: "lead", tool: "ask_lead", question: PLAN, waits: true, ask: 1, plan: true }], "on its run");
    assert.deepEqual(signsOf(said).map((s) => [s.kind, s.words]), [["asks", "sent you its plan, and waits for your go"]]);
    assert.equal(a.l.timeline.find((e) => e.type === "subagent-ask")?.plan, true, "on its lead's timeline");
    a.t.to(41_000);
    assert.ok(a.head().includes(`its plan waits for your go (ask 1), 40 s of 3 min — "${PLAN}"`), a.head().join(" · "));
    assert.ok(!a.head().includes(NOT_SENT));
    const answered = await a.l.tools.worker(a.l.call({ agent_id: a.id, answer: "Looks right.", ask: 1, go: true }));
    assert.equal(answered.text, `Answered builder ${a.id}'s ask 1: go — it may change files and run commands now. Its report still arrives as a message when it finishes.`);
    assert.equal(answered.note, `agent: the lead answered builder ${a.id}'s ask 1 (its plan: go)`);
    const got = await p;
    assert.deepEqual(got, { ok: true, n: 1, how: "answered", text: "Looks right.", by: "lead", options: [], plan: true, go: true });
    assert.equal(leadAnswerWords(got), 'Your lead answered your plan (ask 1): "Looks right.". You may change files and run commands now.');
    assert.deepEqual([a.l.timeline.find((e) => e.type === "subagent-ask-end")?.plan, a.l.timeline.find((e) => e.type === "subagent-ask-end")?.words], [true, "Looks right."]);
    assert.equal(a.w.registry.planHeld(a.id), false);
    assert.ok(!a.head().some((x) => /plan/.test(x)), a.head().join(" · "));
    // A question after the go is a question, no plan.
    const later = a.w.registry.askLead(a.id, { question: "Which date format?", options: ["ISO", "the locale's"] });
    assert.equal(/** @type {any} */ (a.w.registry.get(a.id)).progress.asking.plan, false);
    a.w.registry.answer(a.id, "c1", "ISO", { n: 2 });
    assert.equal((await later).ok && /** @type {any} */ (await later).plan, false);
    a.r.finish({ status: "done", report: "DONE" });
  });

  // (fails before: yes — nothing held a worker's changes for its plan)
  test("any other answer is the lead's correction: the hold stays, the worker reads its words, and sends its plan again", async () => {
    const a = await reviewing();
    const first = a.w.registry.askLead(a.id, asPlan(PLAN));
    const words = "go, but first read test/parse.test.js";
    const answered = await a.l.tools.worker(a.l.call({ agent_id: a.id, answer: words, ask: 1 }));
    assert.equal(answered.text, `Answered builder ${a.id}'s ask 1, as no go — only go: true lets it start — so its changes and commands still wait: it reads your words now and sends its plan again. Its report still arrives as a message when it finishes.`);
    assert.equal(answered.note, `agent: the lead answered builder ${a.id}'s ask 1 (its plan: no go)`);
    const got = await first;
    assert.deepEqual([got.ok && got.how, /** @type {any} */ (got).go], ["answered", false]);
    assert.equal(leadAnswerWords(got), `Your lead answered your plan (ask 1): "${words}". That is no go: your changes and commands still wait. Follow its words, then send your plan again with ask_lead.`);
    assert.equal(a.w.registry.planHeld(a.id), true);
    assert.ok(a.head().includes(NOT_SENT), "back to waiting for its plan");
    // Its plan again, a new question: the developer's go counts too.
    const again = a.w.registry.askLead(a.id, asPlan(`${PLAN} I read test/parse.test.js first.`));
    assert.deepEqual(a.w.registry.answer(a.id, "c1", "yes, go ahead", { n: 2, go: true }), { ok: true, tool: "ask_lead" });
    const yes = await again;
    assert.equal(leadAnswerWords(yes), 'The developer answered your plan (ask 2): "yes, go ahead". You may change files and run commands now.');
    assert.equal(a.w.registry.planHeld(a.id), false);
    a.r.finish({ status: "done", report: "DONE" });
  });

  // (fails before: yes — nothing held a worker's changes for its plan)
  test("no answer 3 minutes after its plan lets the work start; with no plan sent the hold stays", async () => {
    const a = await reviewing();
    assert.equal(a.timers(ASK_LEAD_SECONDS * 1000).length, 0, "no clock runs before its plan is sent");
    const p = a.w.registry.askLead(a.id, asPlan(PLAN));
    a.t.to(181_000);
    a.timers(ASK_LEAD_SECONDS * 1000)[0].fn();
    const got = await p;
    assert.deepEqual(got, { ok: true, n: 1, how: "none", options: [], plan: true });
    assert.equal(leadAnswerWords(got), "No answer from your lead in 3 minutes (ask 1): go on with your plan — your changes and commands run now — and say in your report that your lead did not review it.");
    assert.equal(a.w.registry.planHeld(a.id), false);
    a.r.finish({ status: "done", report: "DONE" });
  });

  // (fails before: yes — nothing held a worker's changes for its plan)
  test("only its launch's run is held: a worker launched without it, and a follow-up, are not", async () => {
    const plain = await reviewing({ review: false });
    assert.equal(plain.w.registry.planHeld(plain.id), false);
    assert.ok(!plain.head().includes(NOT_SENT));
    plain.r.finish({ status: "done", report: "DONE" });
    const a = await reviewing();
    a.r.finish({ status: "done", report: "DONE" });
    await a.w.registry.settled(a.id);
    assert.equal(a.w.registry.planHeld(a.id), false, "its run ended");
    const more = await a.l.tools.worker(a.l.call({ agent_id: a.id, prompt: "Also handle a file of blanks." }));
    assert.equal(more.ok, true, more.text);
    const r2 = await a.w.run(2);
    r2.attach();
    await until(() => a.w.registry.get(a.id)?.runId === r2.runId, "its follow-up to attach");
    assert.equal(a.w.registry.planHeld(a.id), false, "its follow-up was not asked to send a plan");
    assert.equal(a.w.registry.hostOf(a.id)?.planHeld, false);
    r2.finish({ status: "done", report: "DONE" });
  });

  // (fails before: yes — the agent tool had no plan_review, and the registry no planHeld)
  test("a run whose lead's turn does not read along as it starts is not held, and its launch says no plan", async () => {
    // The agent tool refuses plan_review where its lead does not read along (case 44); the registry holds a run only
    // where its plan would reach its lead's looks, whatever reached it — here a call that said it read along, from a
    // turn that does not: a held run with no one to send its plan to would wait for good.
    const w = watched({ runlog: true });
    const l = leadOf(w.registry, w.dir);
    const launched = await l.tools.agent({ ...l.call({ ...BRIEF, plan_review: true }), reads: true });
    assert.equal(launched.ok, true, launched.text);
    assert.ok(!launched.text.includes("sends you its plan"), launched.text);
    const id = String(launched.agentId);
    const r = await w.run(1);
    r.attach();
    await until(() => w.registry.get(id)?.runId === r.runId, "its run to attach");
    assert.equal(w.registry.planHeld(id), false);
    assert.equal(w.registry.hostOf(id)?.planHeld, false);
    r.finish({ status: "done", report: "DONE" });
  });

  // (fails before: yes — as first built, whatever a held worker asked was its plan: the Haiku drive's builder asked how a
  // negative amount is written, its lead's decision was read as no go, and its lead's "Go." to "Proceed with
  // implementation as planned?" let it start on a plan it never wrote)
  test("a question while held is a question: no go is read in its answer, the hold stays, and both are told its plan is to come", async () => {
    const a = await reviewing();
    /** @type {any[]} */
    const said = [];
    const asked = a.w.registry.askLead(a.id, { question: "Which date format?", options: ["ISO", "the locale's"] }, { emit: (e) => said.push(e) });
    assert.equal(said[0]?.plan, undefined, "a question on its run, no plan");
    assert.equal(a.l.timeline.find((e) => e.type === "subagent-ask")?.plan, undefined);
    a.t.to(11_000);
    // A question has no clock (TG2-D58); a plan keeps its 3 minutes.
    assert.ok(a.head().includes(`waiting for your answer (ask 1), 10 s so far — "Which date format?" — its options: ISO (its pick), the locale's`), a.head().join(" · "));
    assert.ok(a.head().includes(NOT_SENT), "beside it, its plan not sent yet");
    // An answer to a question that opens like a go is no go: only its plan's go lets its changes run.
    const answered = await a.l.tools.worker(a.l.call({ agent_id: a.id, answer: "go with ISO", ask: 1 }));
    assert.equal(answered.text, `Answered builder ${a.id}'s ask 1: it reads your answer now and goes on — its changes still wait for its plan, which it has not sent yet. Its report still arrives as a message when it finishes.`);
    const got = await asked;
    assert.deepEqual(got, { ok: true, n: 1, how: "answered", text: "go with ISO", by: "lead", options: ["ISO", "the locale's"], plan: false, held: true });
    assert.equal(leadAnswerWords(got), `Your lead answered your question (ask 1): "go with ISO". Your changes and commands still wait for your plan: send it with ask_lead's plan.`);
    assert.equal(a.w.registry.planHeld(a.id), true, "the hold stays");
    assert.ok(a.head().includes(NOT_SENT));
    // With no answer — its lead's turn ended (TG2-D58) — the same: its pick, and its plan still to come.
    assert.equal(leadAnswerWords({ ok: true, n: 2, how: "none", options: ["ISO"], plan: false, held: true }), "Your lead's turn ended before it answered (ask 2): go on with your pick — ISO — and say in your report that your lead did not answer. Your changes and commands still wait for your plan: send it with ask_lead's plan.");
    // Its plan, sent as one, and a go.
    const plan = a.w.registry.askLead(a.id, asPlan(PLAN));
    assert.equal((await a.l.tools.worker(a.l.call({ agent_id: a.id, answer: "go", ask: 2, go: true }))).ok, true);
    assert.equal(/** @type {any} */ (await plan).go, true);
    assert.equal(a.w.registry.planHeld(a.id), false);
    a.r.finish({ status: "done", report: "DONE" });
  });

  // (fails before: yes — there was no plan to send as one: whatever a held worker asked was its plan)
  test("a plan sent where its lead reviews none is refused: launched without plan review, or after the go", async () => {
    const refused = { ok: false, error: "your lead does not review your plan now — it never asked to, or its go came already: ask a question in question, or say your plan in your report" };
    const plain = await reviewing({ review: false });
    assert.deepEqual(await plain.w.registry.askLead(plain.id, asPlan(PLAN)), refused);
    plain.r.finish({ status: "done", report: "DONE" });
    const a = await reviewing();
    const p = a.w.registry.askLead(a.id, asPlan(PLAN));
    a.w.registry.answer(a.id, "c1", "go", { n: 1, go: true });
    assert.equal(/** @type {any} */ (await p).go, true);
    assert.deepEqual(await a.w.registry.askLead(a.id, asPlan(PLAN)), refused, "after the go");
    a.r.finish({ status: "done", report: "DONE" });
  });
});

describe("plan review on Filament's loop (case 45)", () => {
  /**
   * A worker's loop whose one reply reads a file, writes one and runs its brief's granted check, then ends — its plan
   * held while `held` says so. @param {() => boolean} held
   */
  const turn = async (held) => {
    /** @type {any[]} */
    const bodies = [];
    let n = 0;
    const uses = [
      { type: "tool_use", id: "r1", name: "read", input: { path: "src/parse.js" } },
      { type: "tool_use", id: "w1", name: "write", input: { path: "src/parse.js", content: "x" } },
      { type: "tool_use", id: "b1", name: "bash", input: { command: "npm test" } },
    ];
    const out = await runAgentTurn(
      /** @type {any} */ ({
        model: "m",
        messages: [{ role: "user", content: "fix the parser" }],
        system: "s",
        tools: loopToolArgs({ askLead: true }),
        modeNow: () => "edit",
        root: tmpdir(),
        readerModel: "",
        maxTokens: 100,
        unattended: "worker",
        grants: { list: { check: ["npm test"], mayRun: [] }, folder: "/elsewhere" },
        planHeld: held,
        call: async (/** @type {any} */ { body }) => {
          bodies.push(structuredClone(body));
          const content = n++ === 0 ? uses : [{ type: "text", text: "Done." }];
          return { ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null };
        },
        costOf: () => 0,
        runHand: async () => "ran",
        delegateRead: null,
        mailbox: null,
        permissions: null,
        tree: null,
        onEvent: () => {},
        previewChars: 0,
        sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
        signal: new AbortController().signal,
        resume: null,
      }),
    );
    const results = bodies[1]?.messages.at(-1).content.filter((/** @type {any} */ b) => b.type === "tool_result") || [];
    return { out, results: Object.fromEntries(results.map((/** @type {any} */ b) => [b.tool_use_id, [b.is_error === true, b.content]])) };
  };

  // (fails before: yes — the loop's gate held nothing for a plan's review)
  test("while held its reads run, and its edits, its commands and its brief's grants are refused in the hold's words, on its record", async () => {
    assert.equal(PLAN_HELD, HELD);
    const held = await turn(() => true);
    assert.deepEqual(held.results, { r1: [false, "ran"], w1: [true, HELD], b1: [true, HELD] });
    for (const name of ["write", "bash"]) assert.ok(held.out.notes.includes(`agent: ${name} refused — its plan waits for its lead's review (plan_review)`), held.out.notes.join("\n"));
    // Once its lead's go has come, the same calls run: the write in Edit mode, the command on its brief's grant.
    const free = await turn(() => false);
    assert.deepEqual(free.results, { r1: [false, "ran"], w1: [false, "ran"], b1: [false, "ran"] });
  });
});

describe("plan review on a coding agent (case 46)", () => {
  // (fails before: yes — the session's switch held nothing for a plan's review)
  test("the switch refuses its changes and commands while held, and says so each time for its turn to tell; its reads run; a go lets the work start", async () => {
    const a = await reviewing();
    let told = 0;
    const permits = createAgentPermits({ rules: [], modeNow: () => "edit", learned: null, held: () => a.w.registry.planHeld(a.id), onHeld: () => void told++ });
    const root = a.w.dir;
    for (const call of [{ name: "edit", input: { path: "src/parse.js" } }, { name: "write", input: { path: "notes.md" } }, { name: "bash", input: { command: "ls" } }, { name: "mcp__github__create_issue", input: {} }]) {
      const j = permits.judge([call], root);
      assert.deepEqual([j.verdict, j.how], ["refuse", "refused: its plan waits for its lead's review (plan_review)"], call.name);
    }
    assert.equal(told, 4);
    assert.equal(permits.judge([{ name: "read", input: { path: "src/parse.js" } }], root).verdict, "run", "its reads run");
    assert.equal(permits.judge([{ name: "grep", input: { pattern: "parse" } }], root).verdict, "run");
    assert.equal(told, 4);
    const p = a.w.registry.askLead(a.id, asPlan(PLAN), { withinMs: 45_000 });
    await a.l.tools.worker(a.l.call({ agent_id: a.id, answer: "go", ask: 1, go: true }));
    assert.equal((await p).ok, true);
    assert.equal(permits.judge([{ name: "edit", input: { path: "src/parse.js" } }], root).verdict, "run", "its lead's go let it start");
    a.r.finish({ status: "done", report: "DONE" });
  });
});

describe("plan review on the page (case 45)", () => {
  const PLANNED = { to: "lead", tool: "ask_lead", args: "", question: PLAN, options: [], n: 1, at: 1000, plan: true };
  const ROW = { id: "w1", card: { tag: "builder", name: "Builder", kind: "worker" }, asked: false, may: "edit", status: "running", origin: "owner", startedAt: 1000, team: { team: "architect", role: "builder", place: "builder" }, description: "Fix the parser", model: "glm-5.3", exchanges: [{ description: "Fix the parser", startedAt: 1000, endedAt: null }] };
  // (fails before: yes — its plan read as a question to its lead, and nothing said its changes waited)
  test("its card, its live line, the Side tab's row and its lead's timeline say its plan waits for its lead's go", () => {
    assert.equal(leadAskLine({ round: 1, asking: null, held: true }), "Its changes wait for its lead's review of its plan, not sent yet");
    assert.equal(leadAskLine({ round: 2, asking: PLANNED, held: true }), `Its plan waits for its lead's go (ask 1): "${PLAN}"`);
    assert.equal(leadAskLine({ round: 3, asking: null, held: false }), null, "its lead's go: nothing waits");
    assert.equal(liveLine(/** @type {any} */ ({ round: 2, asking: PLANNED })), `Sent its lead its plan: ${PLAN}`);
    assert.equal(sideRow(/** @type {any} */ ({ ...ROW, progress: { round: 2, asking: PLANNED } }), 41_000).fact, "sent its lead its plan");
    const events = [
      { type: "round-start", round: 2 },
      { type: "tool-start", round: 2, id: "toolu_1", name: "agent", args: "" },
      { type: "subagent-start", round: 2, parent: "toolu_1", agentId: "sa_1", description: "Fix the parser", role: "builder" },
      { type: "subagent-ask", round: 2, parent: "toolu_1", agentId: "sa_1", tool: "ask_lead", to: "lead", question: PLAN, ask: 1, plan: true },
    ];
    assert.deepEqual(alignEvents(events).byRound.get(2).tools.get("toolu_1").sub.asking, { tool: "ask_lead", args: undefined, to: "lead", plan: true });
    const ended = alignEvents([...events, { type: "subagent-ask-end", round: 2, parent: "toolu_1", agentId: "sa_1", to: "lead", answered: true, by: "lead", words: "go", plan: true }]);
    assert.deepEqual(ended.byRound.get(2).tools.get("toolu_1").sub.answers, [{ by: "lead", question: true, plan: true, words: "go" }]);
  });
});

describe("the words ahead of its brief and the launch's answer (case 47)", () => {
  // (fails before: yes — the launch said nothing of a plan's review, and the worker read nothing of it)
  test("Filament's note goes right ahead of its brief, and the launch's answer says what waits; neither without plan_review", async () => {
    const a = await reviewing();
    assert.equal(SUBAGENT_NOTES.planReview, NOTE);
    const blocks = a.r.body.messages[0].content.map((/** @type {any} */ b) => String(b.text));
    assert.deepEqual(blocks.slice(-2), [NOTE, briefText({ ...BRIEF, plan_review: true })]);
    assert.ok(
      a.launched.text.startsWith(`Launched builder ${a.id} ("Fix the parser") in the background. It sends you its plan with ask_lead before it changes anything: its changes and commands wait for your go, or 3 minutes after its plan with no answer. Keep working:`),
      a.launched.text,
    );
    a.r.finish({ status: "done", report: "DONE" });
    const plain = await reviewing({ review: false });
    assert.ok(!plain.r.body.messages[0].content.some((/** @type {any} */ b) => String(b.text).includes("reviews your plan")));
    assert.ok(!plain.launched.text.includes("its plan"));
    plain.r.finish({ status: "done", report: "DONE" });
  });
});
