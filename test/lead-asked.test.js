// @ts-check
// HarnessV3-TaskGraph-v2 §13.17, TG2-D57 to D59: a team that works as engineers with a senior lead. Every worker of a
// team may ask its lead — whether its lead reads along or not — and waits for the answer with no clock: until its lead
// or the developer answers, its run is stopped, or its lead's turn ends. A lead that does not read along hears the
// question at its door at once, once; one that reads along, in its look, as before. Every lead answers by the
// question's number. A worker whose same command fails a third time is told to ask its lead. The lead plans the whole
// work first, and a worker's question comes before anything else.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { FILAMENT_HEAD, runAgentTurn } from "../src/app/agent/loop.js";
import { ASK_LEAD_SECONDS } from "../src/app/agent/subagents.js";
import { WORKER_TOOL, leadAnswerWords, leadToolSetFor, toolSetFor } from "../src/app/agent/tools.js";
import { PROMPT, PROMPT_VERSION, TOOL_TEXT, leadLines, systemPromptFor } from "../src/app/agent/prompt.js";
import { watchParts } from "../src/app/agent/team-tools.js";
import { createLeadTurn } from "../src/app/agent-lead.js";
import { SHIM, SHIM_HEAD, workerNote, workerWords } from "../src/app/agent-worker.js";
import { workerOf } from "../src/core/roster.js";
import { SUBJECT_LINE, TEAM, heldTime, leadOf, running, watched } from "./helpers/team.js";
import { until } from "./helpers/wait.js";

const QUESTION = "Which date format? The brief says dates, and the parser reads both.";
const OPTIONS = ["ISO dates", "the locale's"];

/** A worker running under its lead, on a clock the test holds; `reads`: its lead reads along. @param {{ reads?: boolean }} [o] */
const asking = async ({ reads = false } = {}) => {
  const t = heldTime();
  const w = watched({ runlog: true, now: t.now, later: t.later });
  const l = leadOf(w.registry, w.dir, reads ? { looks: 300 } : {});
  const { id, r } = await running(w, l);
  /** The timers of a length, in the order the registry set them. @param {number} ms */
  const timers = (ms) => t.timers.filter((x) => x.ms === ms);
  return { t, w, l, id, r, timers };
};
/** Let the workers' runs end. @param {...{ r: import("./helpers/team.js").HostRun }} all */
const finish = (...all) => {
  for (const a of all) a.r.finish({ status: "done", report: "DONE" });
};
/** The door's words for a worker's question, as its lead reads them. @param {string} id @param {number} n @param {string[]} options */
const doorWords = (id, n, options) =>
  `[Filament: your builder ${id} ("Fix the parser") asks you (ask ${n}), and waits for your answer:\n${QUESTION}${options.length ? `\nIts options, its pick first: ${options.join(" · ")}` : ""}\n\nAnswer it with worker: agent_id "${id}", ask ${n} and answer.]`;
/** What a lead's answer to ask 1 says, as its worker tool answers it. @param {string} id */
const answeredWords = (id) => `Answered builder ${id}'s ask 1: it reads your answer now and goes on. Its report still arrives as a message when it finishes.`;
/**
 * A failed run of a command, as the worker's host relays its loop's events — both seats do, turn.js and acp-turn.js.
 * @param {ReturnType<typeof watched>} w @param {string} agentId @param {string} id @param {string} command
 */
const failed = (w, agentId, id, command) => {
  w.registry.relay(agentId, { type: "tool-start", id, name: "bash", args: command, round: 2 });
  w.registry.relay(agentId, { type: "tool-end", id, name: "bash", ok: false, exitCode: 1, round: 2 });
};
const STUCK = "`npm test` has failed 3 times. If you do not see why, ask your lead with ask_lead: say what you tried and what it showed.";
/** Filament's own notes to the workers' runs. @param {ReturnType<typeof watched>} w */
const shims = (w) => w.steers.filter((s) => s.from === SHIM);

describe("every worker of a team asks its lead (TG2-D58)", () => {
  // (fails before: yes — only a worker whose lead read along had ask_lead; this one was refused: "your lead does not
  // read along with you now")
  test("a worker whose lead does not read along has ask_lead, and its question reaches its lead's door at once, once", async () => {
    const a = await asking();
    assert.equal(a.w.registry.hostOf(a.id)?.askLead, true);
    /** @type {any[]} */
    const said = [];
    const p = a.w.registry.askLead(a.id, { question: QUESTION, options: OPTIONS }, { emit: (e) => said.push(e) });
    assert.deepEqual(said, [{ type: "ask", kind: "lead", tool: "ask_lead", question: QUESTION, options: OPTIONS, waits: true, ask: 1 }], "on the worker's run, as before");
    const took = a.l.door.inbox.take();
    assert.deepEqual(took.map((d) => [d.kind, d.from, d.text]), [["ask", a.id, doorWords(a.id, 1, OPTIONS)]]);
    assert.deepEqual(a.l.door.inbox.take(), [], "said once");
    // Its lead answers it by its number, as a lead that reads along does.
    const answered = await a.l.tools.worker(a.l.call({ agent_id: a.id, answer: "ISO dates, as the API does", ask: 1 }));
    assert.equal(answered.text, `Answered builder ${a.id}'s ask 1: it reads your answer now and goes on. Its report still arrives as a message when it finishes.`);
    assert.deepEqual(await p, { ok: true, n: 1, how: "answered", text: "ISO dates, as the API does", by: "lead", options: OPTIONS, plan: false });
    finish(a);
  });

  // (fails before: yes — the question was refused, so nothing waited at the door)
  test("a question with no options says none; the lead's wait wakes for it", async () => {
    const a = await asking();
    const woke = a.l.door.inbox.arrival();
    const p = a.w.registry.askLead(a.id, { question: QUESTION });
    await woke;
    assert.deepEqual(a.l.door.inbox.take().map((d) => d.text), [doorWords(a.id, 1, [])]);
    a.w.registry.answer(a.id, "c1", "ISO", { n: 1 });
    await p;
    finish(a);
  });

  // (fails before: no — a lead that reads along saw it in its look; kept so: nothing at its door, said once)
  test("a lead that reads along sees the question in its look, and nothing of it waits at its door", async () => {
    const a = await asking({ reads: true });
    // Its question is an event on its run, as its loop puts it there: the sign that makes its lead's look due.
    const p = a.w.registry.askLead(a.id, { question: QUESTION, options: OPTIONS }, { emit: (e) => a.w.log(a.r.runId, e) });
    const took = a.l.door.inbox.take();
    assert.deepEqual(took.map((d) => d.kind), ["look"]);
    assert.ok(took[0].text.includes(`waiting for your answer (ask 1), 1 s so far — "${QUESTION}"`), took[0].text);
    a.w.registry.answer(a.id, "c1", "ISO", { n: 1 });
    await p;
    finish(a);
  });

  // (fails before: yes — a question waited 3 minutes at most, then the worker went on with its pick)
  test("a question has no clock: it waits until it is answered", async () => {
    const a = await asking();
    const p = a.w.registry.askLead(a.id, { question: QUESTION, options: OPTIONS });
    assert.equal(a.timers(ASK_LEAD_SECONDS * 1000).length, 0, "no 3 minutes");
    a.t.to(1000 + 20 * 60_000);
    const sa = /** @type {any} */ (a.w.registry.get(a.id));
    assert.ok(watchParts(sa, a.w.registry.now()).includes(`waiting for your answer (ask 1), 20 min so far — "${QUESTION}" — its options: ISO dates (its pick), the locale's`), watchParts(sa, a.w.registry.now()).join(" · "));
    a.w.registry.answer(a.id, "c1", "the locale's", { n: 1 });
    const got = await p;
    assert.equal(got.ok && got.how, "answered");
    finish(a);
  });

  // (fails before: yes — the 3 minutes ran across a coding agent's calls, and its words said so)
  test("a coding agent's call says how long it has waited, with no 3 minutes", async () => {
    const a = await asking();
    const first = a.w.registry.askLead(a.id, { question: QUESTION, options: OPTIONS }, { withinMs: 45_000 });
    a.t.to(46_000);
    a.timers(45_000)[0].fn();
    const held = await first;
    assert.deepEqual(held, { ok: true, n: 1, how: "later", waited: 45_000, options: OPTIONS, plan: false });
    assert.equal(leadAnswerWords(held), "No answer yet (ask 1, 45 s so far): call ask_lead again with ask 1 alone to go on waiting — your lead's answer comes the moment it lands.");
    assert.equal(leadAnswerWords({ ok: true, n: 2, how: "later", waited: 45_000, options: [], plan: true }), "No answer yet (ask 2, 45 s of 3 min): call ask_lead again with ask 2 alone to go on waiting — your lead's answer comes the moment it lands.", "a plan under review keeps its 3 minutes (TG2-D50)");
    a.w.registry.answer(a.id, "c1", "ISO", { n: 1 });
    assert.equal((await a.w.registry.askLead(a.id, null, { n: 1 })).ok, true);
    finish(a);
  });

  // (fails before: yes — there was no question to a lead that did not read along)
  test("its lead's turn ends first: the worker goes on with its pick and says so, and the question goes to no later turn", async () => {
    const a = await asking();
    const p = a.w.registry.askLead(a.id, { question: QUESTION, options: OPTIONS });
    a.l.door.close();
    const got = await p;
    assert.deepEqual(got, { ok: true, n: 1, how: "none", options: OPTIONS, plan: false });
    assert.equal(leadAnswerWords(got), "Your lead's turn ended before it answered (ask 1): go on with your pick — ISO dates — and say in your report that your lead did not answer.");
    assert.equal(leadAnswerWords({ ok: true, n: 2, how: "none", options: [], plan: false }), "Your lead's turn ended before it answered (ask 2): go on with what you judge best, and say in your report that your lead did not answer.");
    assert.deepEqual(a.w.registry.peekQueued("c1").filter((d) => d.kind === "ask"), [], "a question its turn never read is not the next turn's");
    assert.deepEqual(await a.w.registry.askLead(a.id, { question: "And the other?" }), { ok: false, error: "your lead's turn has ended, so no question reaches it now: go on with what you judge best, and say in your report what you would have asked" });
    finish(a);
  });

  // (fails before: yes — there was no question at a door)
  test("a question answered before its lead took it leaves the door", async () => {
    const a = await asking();
    const p = a.w.registry.askLead(a.id, { question: QUESTION });
    a.w.registry.answer(a.id, "c1", "ISO", { n: 1 });
    await p;
    assert.deepEqual(a.l.door.inbox.take(), [], "the developer answered it: its lead is not asked a settled question");
    finish(a);
  });

  // (fails before: yes — there was no question at a door, nor a worker told to ask)
  test("a pause is no end of its lead's turn: the question waits on for the resumed turn, and a stuck worker is still sent to ask", async () => {
    const a = await asking();
    const p = a.w.registry.askLead(a.id, { question: QUESTION, options: OPTIONS });
    // The turn pauses on the developer's answer, its worker's question not read yet: the question carries over, as a
    // report does.
    a.l.door.close({ paused: true });
    assert.equal(a.w.registry.get(a.id)?.progress?.asking?.n, 1, "it still waits");
    assert.deepEqual(a.w.registry.peekQueued("c1").map((d) => [d.kind, d.text]), [["ask", doorWords(a.id, 1, OPTIONS)]]);
    for (const id of ["c1", "c2", "c3"]) failed(a.w, a.id, id, "npm test");
    assert.deepEqual(shims(a.w).map((s) => s.text), [STUCK], "while the turn waits for the developer, it is still sent to ask");
    // The developer answers: the resumed turn reads the question, and its lead answers it.
    const resumed = leadOf(a.w.registry, a.w.dir, { runId: "lead-2" });
    assert.deepEqual(resumed.door.inbox.take().map((d) => [d.kind, d.text]), [["ask", doorWords(a.id, 1, OPTIONS)]]);
    assert.equal((await resumed.tools.worker(resumed.call({ agent_id: a.id, answer: "ISO dates", ask: 1 }))).text, answeredWords(a.id));
    assert.deepEqual(await p, { ok: true, n: 1, how: "answered", text: "ISO dates", by: "lead", options: OPTIONS, plan: false });
    resumed.door.close();
    finish(a);
  });

  // (fails before: yes — a lead that did not read along had no answer: "Nothing sent: worker needs prompt")
  test("a lead that does not read along answers its workers' questions, never a call's permission", async () => {
    const a = await asking();
    const call = a.w.registry.ask(a.id, { tool: "bash", args: "npm test", question: "May I run this command? `npm test`" });
    const refused = await a.l.tools.worker(a.l.call({ agent_id: a.id, answer: "yes", ask: 1 }));
    assert.equal(refused.text, `Nothing answered: builder ${a.id} waits for the developer's answer on its bash call (ask 1) — that one is theirs to answer; you answer the questions your workers ask you.`);
    a.w.registry.answer(a.id, "c1", "no", { n: 1 });
    await call;
    assert.equal((await a.l.tools.worker(a.l.call({ agent_id: a.id, answer: "ISO" }))).text, "Nothing answered: answer needs ask, the number the question came with (ask 2) — a worker may ask again before your answer lands, and the number keeps your answer on the question you read.");
    finish(a);
  });
});

describe("a stuck worker is sent to its lead (TG2-D59)", () => {
  for (const reads of [false, true])
    // (fails before: yes — nobody told the worker; a lead that read along saw the sign)
    test(`the same command failing a third time tells the worker once${reads ? ", its lead reading along" : ""}`, async () => {
      const a = await asking({ reads });
      failed(a.w, a.id, "c1", "npm test");
      failed(a.w, a.id, "c2", "npm test");
      assert.deepEqual(shims(a.w), [], "twice is no third time");
      failed(a.w, a.id, "c3", "npm test");
      assert.deepEqual(shims(a.w), [{ runId: a.r.runId, kind: "note", text: STUCK, from: SHIM }]);
      failed(a.w, a.id, "c4", "npm test");
      failed(a.w, a.id, "c5", "npm run lint");
      assert.equal(shims(a.w).length, 1, "once per command");
      finish(a);
    });

  // (fails before: yes — a worker on a task of its lead's graph had no watch, and its lead read no question of it)
  test("a worker on a task of its lead's graph may ask its lead, and is sent to when it is stuck", async () => {
    const a = await asking();
    const task = /** @type {any} */ (await a.w.registry.launch({ origin: "agent", chainId: "c1", prompt: "THE BRIEF OF t1", description: "t1: Fix the printer", team: workerOf(TEAM, "builder"), background: true, task: { id: "t1", review: false }, requestId: "lead-1" }));
    assert.equal(task.ok, true, task.error);
    const r = await a.w.run(2);
    r.attach();
    await until(() => a.w.registry.get(task.id)?.runId === r.runId, "the task's run to attach");
    assert.equal(a.w.registry.hostOf(task.id)?.askLead, true);
    for (const id of ["c1", "c2", "c3"]) failed(a.w, task.id, id, "npm test");
    assert.deepEqual(shims(a.w), [{ runId: r.runId, kind: "note", text: STUCK, from: SHIM }]);
    r.finish({ status: "done", report: "DONE" });
    finish(a);
  });

  // (fails before: yes — nobody told the worker)
  test("with its lead's turn over, nobody would read its question: it is not told to ask", async () => {
    const a = await asking();
    a.l.door.close();
    for (const id of ["c1", "c2", "c3"]) failed(a.w, a.id, id, "npm test");
    assert.deepEqual(shims(a.w), []);
    finish(a);
  });

  // (fails before: yes — a note from Filament read as the developer's)
  test("the worker hears it as Filament's word, in either seat", async () => {
    assert.equal(FILAMENT_HEAD, "Word from Filament, which runs this session and answers your permission requests");
    assert.equal(SHIM_HEAD, FILAMENT_HEAD);
    assert.equal(workerNote({ text: STUCK, from: SHIM }), `${FILAMENT_HEAD} (1 message). Acknowledge what you heard in your next reply before acting on it:\n- ${STUCK}`);
    let reads = 0;
    let n = 0;
    /** @type {any[]} */
    const bodies = [];
    const out = await runAgentTurn(
      /** @type {any} */ ({
        model: "m",
        messages: [{ role: "user", content: "fix it" }],
        system: "s",
        tools: toolSetFor({ delegateRead: false }),
        modeNow: () => "edit",
        root: tmpdir(),
        readerModel: "",
        maxTokens: 100,
        call: async (/** @type {any} */ { body }) => {
          bodies.push(structuredClone(body));
          const content = n++ === 0 ? [{ type: "tool_use", id: "r1", name: "read", input: { path: "a.txt" } }] : [{ type: "text", text: "Done." }];
          return { ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null };
        },
        costOf: () => 0,
        runHand: async () => "ran",
        delegateRead: null,
        mailbox: { read: () => (++reads === 1 ? [{ kind: "note", text: STUCK, from: SHIM }] : []) },
        permissions: null,
        tree: null,
        onEvent: () => {},
        previewChars: 0,
        sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
        signal: null,
        resume: null,
      }),
    );
    assert.equal(out.status, "done");
    const texts = bodies[1].messages.at(-1).content.filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text);
    assert.deepEqual(texts, [`${FILAMENT_HEAD} (1 message). Acknowledge what you heard in your next reply before acting on it:\n- ${STUCK}`]);
  });
});

describe("an answer never waits, and a question is no report (TG2-D58)", () => {
  const use = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  /** What a call answered in a request. @param {any} body @param {string} id */
  const resultOf = (body, id) => {
    for (const m of body.messages) for (const b of Array.isArray(m.content) ? m.content : []) if (b?.type === "tool_result" && b.tool_use_id === id) return String(b.content);
    return "";
  };
  /**
   * The loop of a lead that does not read along, on a scripted model: its door as turn.js opens it, and what turn.js
   * hands such a lead — no steers. `reply(n)` answers the model's nth call.
   * @param {(n: number) => any[] | null} reply
   */
  const leading = async (reply) => {
    const a = await asking();
    /** @type {any[]} */
    const bodies = [];
    /** @type {any[]} */
    const events = [];
    let n = 0;
    const run = () =>
      runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
        model: "m-lead",
        messages: [{ role: "user", content: "fix the parser" }],
        system: "s",
        tools: leadToolSetFor({ delegateRead: false }),
        modeNow: () => "edit",
        root: tmpdir(),
        readerModel: "",
        maxTokens: 100,
        call: async (/** @type {any} */ { body }) => {
          bodies.push(structuredClone(body));
          const content = reply(n++) || [{ type: "text", text: "LEAD DONE" }];
          return { ok: true, status: 200, json: { content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }, id: null };
        },
        costOf: () => 0,
        runHand: async () => "ran",
        delegateRead: null,
        subagents: {
          run: (/** @type {any} */ o) => a.l.tools.agent(a.l.call(o.input)),
          worker: (/** @type {any} */ o) => a.l.tools.worker(a.l.call(o.input)),
          watch: () => a.l.tools.watch({ chainId: "c1" }).text,
        },
        inbox: a.l.door.inbox,
        mailbox: { read: () => [] },
        permissions: null,
        tree: null,
        onEvent: (/** @type {any} */ e) => events.push(e),
        previewChars: 0,
        sink: { text() {}, thinking() {}, signThinking() {}, endBlock() {}, count: () => 0 },
        signal: null,
        resume: null,
      }));
    return { a, bodies, events, run };
  };

  // (fails before: yes — a lead that did not read along had no answer; one that did answered at once only by its steer)
  test("a lead's answer runs at once: the turn does not pause, and its worker's question reached it as a message, never a report", async () => {
    // Its worker reports as the lead ends its turn, which waits for that report.
    const t = await leading((n) => (n === 2 && finish(t.a), [[use("r1", "read", { path: "src/parse.js" })], [use("a1", "worker", { agent_id: t.a.id, answer: "ISO dates", ask: 1 })]][n] || null));
    const asked = t.a.w.registry.askLead(t.a.id, { question: QUESTION, options: OPTIONS });
    const out = await t.run();
    assert.deepEqual([out.status, out.pause], ["done", null]);
    assert.equal(resultOf(t.bodies[2], "a1"), answeredWords(t.a.id));
    assert.deepEqual(await asked, { ok: true, n: 1, how: "answered", text: "ISO dates", by: "lead", options: OPTIONS, plan: false });
    assert.ok(t.bodies[1].messages.at(-1).content.some((/** @type {any} */ b) => b.type === "text" && b.text === doorWords(t.a.id, 1, OPTIONS)), "its question, at the round's end");
    assert.deepEqual(t.events.filter((e) => e.type === "subagent-report").map((e) => e.kind), ["report"], "its report, and no other: a question is no report");
    t.a.l.door.close();
  });

  // (fails before: yes — a coding agent's answer was an order, and waited for the developer)
  test("a coding agent that leads answers at once, and its worker's question reaches it as a message, never a report", async () => {
    const a = await asking();
    const asked = a.w.registry.askLead(a.id, { question: QUESTION, options: OPTIONS });
    /** @type {any[]} */
    const emitted = [];
    const lead = createLeadTurn({ registry: a.w.registry, door: /** @type {any} */ (a.l.door), chainId: "c1", runId: "lead-1", cwd: a.w.dir, model: "m-lead", team: TEAM, emit: (e) => emitted.push(e), note: () => {}, mailbox: () => null, signal: new AbortController().signal });
    assert.deepEqual(lead.take(), [doorWords(a.id, 1, OPTIONS)]);
    assert.deepEqual(await lead.call("worker", { agent_id: a.id, answer: "ISO dates", ask: 1 }, { patienceMs: 50 }), { text: answeredWords(a.id) });
    assert.deepEqual(emitted.filter((e) => e.type === "subagent-report" || e.type === "ask"), [], "no report, and nothing asked of the developer");
    const got = await asked;
    assert.equal(got.ok && got.how, "answered");
    lead.close();
    a.l.door.close();
    finish(a);
  });
});

describe("the words (TG2-D57, D58)", () => {
  const WORKER = { team: "Architect", words: "" };
  const PLAN_FIRST = "- Plan the whole work before your first launch, reading what you need for it: the parts, who does each and in what order, how the parts meet — the names, shapes and files they share — each part's check, and what a worker would trip on. Each brief is one part of that plan, with what it shares with the others and its pitfalls.";
  const ASKED = "- A worker may ask you — a choice its brief does not settle, or a problem it is stuck on — and waits for your answer: answer it before anything else, by its number (worker with agent_id, ask and answer). Where the answer takes finding, find it — read the code, or have a worker find out — then say what to do and why.";
  const ASKED_READS = "- A worker may ask you — a choice its brief does not settle, a problem it is stuck on, or its plan where you launched it with plan_review — and waits for your answer: answer it before anything else, by its number (worker with agent_id, ask and answer). Where the answer takes finding, find it — read the code, or have a worker find out — then say what to do and why.";

  // (fails before: yes — version 28; 30 since TG2-D60, a lead that reads what its workers say and do: lead-no-thinking.test.js;
  // 31 since TG2-D53, a lead's brief launched as attempts: attempts.test.js; 32 since E4, a model that takes no
  // tools: model-no-tools.test.js; 33 since V2-1, a task's check Filament runs itself: checked-done.test.js)
  test("prompt version 29, 30 since, 31, 32 and 33", () => {
    assert.equal(PROMPT_VERSION, 129);
  });

  // (fails before: yes — no lead was told to plan the whole work first, and only a lead that read along was told it
  // may be asked)
  test("every lead plans the whole work first and answers a question before anything else, in both seats", () => {
    for (const own of [false, true]) {
      const plain = leadLines({ own }).split("\n");
      assert.equal(plain[plain.findIndex((l) => l.startsWith("- Brief each worker completely")) - 1], PLAN_FIRST);
      assert.equal(plain[plain.findIndex((l) => l.startsWith("- wait answers with your workers still running")) + 1], ASKED);
      const reads = leadLines({ own, supervise: true }).split("\n");
      assert.equal(reads[reads.findIndex((l) => l.startsWith("- Brief each worker completely")) - 1], PLAN_FIRST);
      assert.equal(reads.filter((l) => l === ASKED).length, 0, "a lead that reads along reads the line with plan_review");
      assert.equal(reads[reads.findIndex((l) => l.startsWith("- Correct early.")) + 1], ASKED_READS);
    }
  });

  // (fails before: yes — a lead that did not read along had no answer field)
  test("the worker tool of a lead that does not read along takes answer and ask", () => {
    assert.deepEqual(Object.keys(WORKER_TOOL.input_schema.properties), ["agent_id", "prompt", "stop", "correction", "apply_changes", "overlap", "reason", "answer", "ask"]);
    assert.equal(WORKER_TOOL.input_schema.properties.answer.description, "With ask, and nothing else, to a running worker that asked you a question: your answer, what to do and why.");
    assert.ok(TOOL_TEXT.worker.endsWith(" A worker that asked you a question waits for your answer: answer, with ask (the number of its question) and nothing else."), TOOL_TEXT.worker);
    // (version 110: it waits for the lead's background commands too)
    assert.ok(TOOL_TEXT.teamWait.startsWith("Wait for your workers and your background commands: returns the moment one of them reports (its report arrives as a message) or ends, one asks you a question (it arrives as a message too), the developer sends you a message, or the seconds pass"), TOOL_TEXT.teamWait);
    assert.ok(!TOOL_TEXT.workerReads.includes("3 minutes") && TOOL_TEXT.workerReads.includes("Its question to you, you answer in your own words; it waits for your answer."), TOOL_TEXT.workerReads);
  });

  // (fails before: yes — a worker whose lead did not read along was told nobody could answer it, and one whose lead
  // did was told to go on with its pick after 3 minutes)
  test("every worker of a team is told to ask instead of guessing, in both seats", () => {
    const ASKS = "Ask your lead with ask_lead when your brief does not settle a choice that changes the result, or when you are stuck — the same thing failed twice and you do not see why: say what you found or tried, and your options, your pick first. Then wait for its answer; do not guess.";
    assert.equal(PROMPT.workerAsksLead, ASKS);
    assert.equal(PROMPT.workerAmbiguity, "- When the task is ambiguous in a way that changes the result, ask your lead; otherwise take the most reasonable reading, say so in your reply, and go on.");
    for (const supervise of [false, true]) {
      const loop = systemPromptFor({ root: "/w", delegateRead: false, subagent: true, worker: WORKER, supervise });
      assert.ok(loop.includes(`Say what is left. ${SUBJECT_LINE("your lead")} A follow-up may come later in this same conversation. ${ASKS}`), loop);
      assert.ok(loop.includes(PROMPT.workerAmbiguity) && !loop.includes("nobody can answer a question from you mid-task"), loop);
      const task = systemPromptFor({ root: "/w", delegateRead: false, subagent: true, worker: WORKER, task: "work", supervise });
      assert.ok(task.includes(`call report once, then end your turn: your report is what your lead reads, never your final message. ${ASKS}`), task);
      const host = { id: "sa_1", card: { tag: "builder", name: "Builder", kind: "worker", thinks: "" }, readOnly: false, asks: true, team: { name: "Architect", role: "builder", words: "" }, task: null, supervise };
      const own = workerWords(host);
      assert.ok(own.includes(ASKS) && own.includes(PROMPT.workerAmbiguity) && !own.includes("nobody can answer a question from you mid-task"), own);
    }
    // A sub-agent that is no team's worker keeps its lines: it has no lead.
    const sub = systemPromptFor({ root: "/w", delegateRead: false, subagent: true });
    assert.ok(sub.includes("nobody can answer a question from you mid-task") && !sub.includes("ask_lead"), sub);
    assert.equal(TOOL_TEXT.askLead, "Ask your team's lead, and wait for its answer: when your brief does not settle a choice that changes the result — two ways that could both be right — or when you are stuck: the same thing failed twice and you do not see why. Say what you found or tried, and give your options, your pick first. Your lead answers in its own words; if its turn ends first, go on with your pick and say so in your report. Never ask it for permission — a call that needs it asks by itself — nor for what you can find out by reading. While your lead reviews your plan, send the plan itself in plan, not in question: your lead's go to it lets your changes and commands run.");
  });
});
