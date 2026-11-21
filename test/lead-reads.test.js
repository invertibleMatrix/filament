// @ts-check
// HarnessV3-TaskGraph-v2 §12 (V2-0a): a team's lead reads along with its workers. The words under `engine.supervise`
// (prompt version 20; off is version 18, byte for byte), the lead's two reads of a running worker (team-tools.js), a
// look through the turn's inbox — due at once when a worker goes on from its plan, behind a report, handed back, never
// queued (subagents.js) — and the lead's loop (loop.js): its wait ends on a look, its conversation holds one, quiet
// waiting leaves nothing, a message to a running worker and a read run at once, and what the session keeps of the turn
// holds no look. Against scripted registries and loops; the app's own run is
// test/lead-reads-live.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { LOOK_GONE, LOOK_STUB, isLook } from "../src/app/agent/looks.js";
import { PROMPT, TOOL_TEXT, systemPromptFor } from "../src/app/agent/prompt.js";
import { inputRefusal } from "../src/app/agent/team-tools.js";
import { TEAM_WAIT_TOOL, WORKER_TOOL, leadToolSetFor, loopToolArgs } from "../src/app/agent/tools.js";
import { workerWords } from "../src/app/agent-worker.js";
import { shippedCard } from "../src/services/agent-cards.js";
import { trailOf } from "../src/core/run-work.js";
import { asV102Prompt, asV104Prompt, asV104Tools, asV109Tools, asV54Prompt, asV72Tools, asV75Tools, asV76Prompt, asV97Prompt, asV79Tools, asV91Tools, asV93Tools, asV99Tools, asV101Tools, BRIEF, DECISION_9_HANDS, asV36, asV37, asV38, asV38Builder, asV42, asV43, leadOf, running, watched, asV111Tools } from "./helpers/team.js";
import { until } from "./helpers/wait.js";

const sha = (/** @type {string} */ s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const LEAD = { name: "Architect", persona: "You lead." };
const ENV = "# Environment\n- the machine";
/** A builder's prompt. @param {any} [o] */
const builder = (o = {}) => systemPromptFor({ root: "/w", delegateRead: false, toolsOff: ["ask", "plan", "agent"], subagent: true, card: shippedCard("builder"), worker: { team: "Architect", words: "be brief" }, environment: ENV, ...o });
const tick = () => new Promise((res) => setImmediate(res));
const card = (/** @type {string} */ kind, /** @type {string} */ subject) => ({ card: { kind, title: kind, subject } });

describe("the words (§12.7, prompt version 20)", () => {
  // The figures, hashed: a worker's prompt, a lead's and its tools as version 29 has them (HarnessV3-TaskGraph-v2
  // §13.17), which moved all three whether the lead reads along or not — a lead plans the whole work first and answers
  // its workers' questions, and every worker of a team may ask it (TG2-D57, D58). Version 28's were a worker's
  // 3350d6f3d19c83c6 (version 23's, as its card writes it since version 21, 0a7a406), a lead's ac04e5d38f777257
  // (version 26's, §13; version 23's was 47516c3b0111ca2b) and its tools 945c7c2abcf33254 (version 27's: plan_review
  // is in every lead's agent tool, TG2-D50, §13.13; version 26's were d84397f5973df92d, version 23's 81886b114cab06a7).
  // The tools are weighed with the visuals, artifacts and the Space off, which E16, E18 and proposal_ux §4.14 added
  // after the rest (visuals.test.js), and with the agent tool's attempts left out, which version 31 added after them
  // (TG2-D53, lead-briefing.test.js); and
  // a lead's own hands as version 36 had them — its words by asV36, its new hands off — which version 37 gave it
  // (HarnessV4_Tasks decision 9); and without the model fields version 38 gave every agent tool (asV37, E23); and
  // without the window view version 39 gave every agent tool's context, the Builder's words as version 38 had them
  // (asV38, asV38Builder: the owner's words of 10-19); and without the subject line version 43 asked a worker's report
  // for (asV42, HarnessV4_Envelopes_Plan EN1); and without the envelope tool version 44 put after wait (asV43, EN2); and
  // with the worker tool's apply_changes as version 75 had it, before a graph task's work waited for its apply (asV75Tools);
  // and with the lead's line on the mode that held its orders for the developer, which version 77 took out (asV76Prompt);
  // and without the lsp tool version 80 put after the hands (asV79Tools); and with the worker tool's answer and the
  // agent tool's plan_review as version 91 worded them, before a lead's yes and go were fields (asV91Tools, a2); and with
  // the texts the owner's tool plan of 11-08 took the em dashes out of as version 93 had them (asV93Tools); and with the
  // worker tool as version 99 had it, before an apply that overlaps the folder's edits sent the change back with overlap
  // (asV99Tools, first of all); and with a lead's sizing line as version 102 had it, before it gave no file one owner
  // (asV102Prompt, first of all).
  // (fails before: no — it fails the day a byte moves while the switch is off)
  test("with the switch off, a worker's prompt, a lead's and its tools are version 29's, byte for byte", () => {
    /** @param {readonly any[]} set */
    const asV30 = (set) => set.map((t) => (t.name === "agent" && t.input_schema?.properties?.attempts ? { ...t, input_schema: { ...t.input_schema, properties: Object.fromEntries(Object.entries(t.input_schema.properties).filter(([k]) => k !== "attempts")) } } : t));
    assert.equal(sha(asV36(asV76Prompt(asV97Prompt(asV102Prompt(asV104Prompt(systemPromptFor({ root: "/w", delegateRead: false, lead: LEAD, environment: ENV }))))))), "d5bd4b356fefb64f");
    assert.equal(sha(asV36(asV76Prompt(asV97Prompt(asV102Prompt(asV104Prompt(systemPromptFor({ root: "/w", delegateRead: false, lead: LEAD, environment: ENV, supervise: false }))))))), "d5bd4b356fefb64f");
    assert.equal(sha(asV42(asV54Prompt(builder({ card: asV38Builder(shippedCard("builder")) })))), "ede92a49fd8e9420");
    assert.equal(sha(JSON.stringify(asV43(asV30(asV38(asV37(asV72Tools(asV75Tools(asV79Tools(asV91Tools(asV93Tools(asV99Tools(asV101Tools(asV104Tools(asV109Tools(asV111Tools(loopToolArgs({ lead: true, disabled: ["show_visual", "artifact", "space", ...DECISION_9_HANDS] }))))))))))))))))), "6bf26608f7e36594");
    assert.equal(sha(JSON.stringify(asV43(asV30(asV38(asV37(asV72Tools(asV75Tools(asV79Tools(asV91Tools(asV93Tools(asV99Tools(asV101Tools(asV104Tools(asV109Tools(asV111Tools(loopToolArgs({ lead: true, supervise: false, disabled: ["show_visual", "artifact", "space", ...DECISION_9_HANDS] }))))))))))))))))), "6bf26608f7e36594");
    // The switch reaches whoever waits for work it started: without a team and without the task graph, the developer's
    // own agent and a plain sub-agent never move with it (the graph's half: lead-graph.test.js).
    assert.equal(systemPromptFor({ root: "/w", delegateRead: false, supervise: true }), systemPromptFor({ root: "/w", delegateRead: false }));
    assert.equal(systemPromptFor({ root: "/w", delegateRead: false, subagent: true, readOnly: true, supervise: true }), systemPromptFor({ root: "/w", delegateRead: false, subagent: true, readOnly: true }));
    assert.deepEqual(loopToolArgs({ supervise: true }), loopToolArgs({}));
  });

  // (fails before: yes — a lead had one prompt, whose wait listed its workers and whose every message to one was an order)
  test("a lead that reads along: its looks in place of the watch and of the line on a worker's question", () => {
    const off = systemPromptFor({ root: "/w", delegateRead: false, lead: LEAD });
    const on = systemPromptFor({ root: "/w", delegateRead: false, lead: LEAD, supervise: true });
    const lines = String(PROMPT.lead).split("\n");
    const watch = lines.findIndex((l) => l.startsWith("- wait answers with your workers still running"));
    // Version 29 (TG2-D58): a lead that does not read along hears its workers' questions too, at its door, which the
    // line after its watch says; a lead that reads along sees them in its looks, whose own line on a question says it.
    const asked = lines.findIndex((l) => l.startsWith("- A worker may ask you"));
    assert.ok(watch > 0 && asked === watch + 1, "version 18's line is where it was, and version 29's after it");
    const reads = lines.flatMap((l, i) => (i === watch ? [PROMPT.leadLooks] : i === asked ? [] : [l])).join("\n");
    assert.equal(on, off.replace(String(PROMPT.lead), () => reads), "those two lines, and nothing else");
    // (fails before: yes — version 27, TG2-D49: a worker may ask its lead, which its fifth line says)
    assert.equal(String(PROMPT.leadLooks).split("\n").length, 5);
    for (const said of ["While your workers run, Filament shows you a look at them", "Only the newest look stays in your conversation", "worker with show_trail: true", "with show_changes: true", "Correct early.", "Leave a worker that is on track alone"])
      assert.ok(on.includes(said), said);
    assert.ok(!on.includes("wait answers with your workers still running"));
  });

  // (fails before: yes — a worker was told nobody could answer it mid-task, and nothing of who reads it; and, version
  // 27's TG2-D49, it was told not to stop to ask, where it may ask its lead what changes the result. Since version 29,
  // TG2-D58, every worker of a team may ask its lead, so the asking is no longer the reading worker's alone: its
  // steering line is the one place it differs.)
  test("its worker is told its lead reads along and to say its plan first — the one place it differs from any worker of a team, which may ask its lead", () => {
    const on = builder({ supervise: true });
    assert.equal(on, builder().replace(String(PROMPT.workerSteering), () => String(PROMPT.workerReadAlong)), "one place, and nothing else");
    assert.ok(on.includes("In your first reply, say in a few lines how you will go about the task") && on.includes("Then go on without waiting"));
    for (const task of /** @type {const} */ (["work", "review"])) {
      const p = builder({ supervise: true, task });
      assert.ok(p.endsWith(`${PROMPT.workerAsksLead}\n\n${ENV}`), `a graph task's ${task}: its report line ends on what to do instead`);
      assert.equal(p, builder({ task }).replace(String(PROMPT.workerSteering), () => String(PROMPT.workerReadAlong)), `a graph task's ${task}: the one place too`);
    }
    for (const p of [on, builder()]) assert.ok(!/obody can answer/.test(p) && p.includes(String(PROMPT.workerAmbiguity)) && p.includes(String(PROMPT.workerAsksLead)));
    // A coding agent as a worker reads the same, through its standing context; a plain sub-agent has nobody to ask.
    const host = { id: "", card: /** @type {any} */ (shippedCard("builder")), readOnly: false, asks: false, team: { name: "Architect", role: "builder", words: "" }, task: null };
    const words = workerWords({ ...host, supervise: true });
    assert.equal(words, workerWords(host).replace(String(PROMPT.workerSteering), () => String(PROMPT.workerReadAlong)));
    assert.equal(workerWords({ ...host, team: null, supervise: true }), workerWords({ ...host, team: null }), "a plain sub-agent has no lead");
    assert.ok(workerWords({ ...host, team: null }).includes("nobody can answer a question from you mid-task") && !workerWords({ ...host, team: null }).includes("ask_lead"));
  });

  // (fails before: yes — worker had no read of a running worker, and wait said it lists them)
  test("its tools: worker's two reads and a wait that says a look follows; nothing else moves", () => {
    const off = leadToolSetFor({ delegateRead: false });
    const on = leadToolSetFor({ delegateRead: false, supervise: true });
    assert.deepEqual(on.map((t) => t.name), off.map((t) => t.name));
    for (const [i, t] of off.entries()) if (t.name !== "worker" && t.name !== "wait") assert.equal(on[i], t);
    const worker = /** @type {any} */ (on.find((t) => t.name === "worker"));
    const wait = /** @type {any} */ (on.find((t) => t.name === "wait"));
    // Since version 29 a lead that does not read along answers too (TG2-D58): its worker tool ends on answer and ask.
    // Since version 92 one that reads along answers a call with allow and a plan with go, after them (the memory plan's a2).
    assert.deepEqual(Object.keys(WORKER_TOOL.input_schema.properties).slice(-2), ["answer", "ask"]);
    assert.deepEqual(Object.keys(worker.input_schema.properties), [...Object.keys(WORKER_TOOL.input_schema.properties).slice(0, -2), "show_trail", "from_round", "show_changes", "answer", "ask", "allow", "go"]);
    assert.deepEqual([worker.description, wait.description], [TOOL_TEXT.workerReads, TOOL_TEXT.teamWaitReads]);
    assert.deepEqual(wait.input_schema, TEAM_WAIT_TOOL.input_schema);
    assert.ok(String(TOOL_TEXT.teamWaitReads).includes("a look at them is due"));
    assert.equal(leadToolSetFor({ delegateRead: false, supervise: true }), on, "one frozen set for each choice");
  });
});

describe("the lead's two reads (TG2-D14, D16, D17)", () => {
  test("worker's two reads go alone, and a lead that does not read along has none", () => {
    assert.equal(inputRefusal("worker", { agent_id: "sa_1", show_trail: true, from_round: 3 }, { reads: true }), null);
    assert.equal(inputRefusal("worker", { agent_id: "sa_1", show_changes: true }, { reads: true }), null);
    assert.equal(inputRefusal("worker", { agent_id: "sa_1", show_trail: true, prompt: "x" }, { reads: true })?.text, "Nothing shown: show_trail reads a running worker and goes alone, never with prompt — send that as its own worker call.");
    assert.equal(inputRefusal("worker", { agent_id: "sa_1", show_changes: true, stop: true }, { reads: true })?.text, "Nothing shown: show_changes reads a running worker and goes alone, never with stop — send that as its own worker call.");
    assert.equal(inputRefusal("worker", { agent_id: "sa_1", show_trail: true, show_changes: true }, { reads: true })?.text, "Nothing shown: show_trail and show_changes are two calls.");
    // With the switch off the fields are not the tool's: the call is answered as version 18 answers one with no prompt.
    assert.equal(inputRefusal("worker", { agent_id: "sa_1", show_trail: true })?.text, "Nothing sent: worker needs prompt — your message or follow-up — or stop: true, or apply_changes: true.");
  });

  // (fails before: yes — a lead saw the head of a worker's newest words, and its change only once it had reported)
  test("show_trail gives a running worker's rounds whole from the round named; show_changes what it has written", async () => {
    const w = watched({ runlog: true });
    const l = leadOf(w.registry, w.dir, { looks: 30 });
    const { id, r } = await running(w, l);
    for (const e of [
      { type: "round-start", round: 1 },
      { type: "round-thinking", round: 1, thinking: "FIRST-THOUGHT: read the parser." },
      { type: "round-text", round: 1, text: "Plan: return [] early." },
      { type: "tool-start", round: 1, id: "c1", name: "read", args: "src/parse.js", ...card("read", "src/parse.js") },
      { type: "tool-end", round: 1, id: "c1", name: "read", ok: true, chars: 900, preview: "FILE-BODY" },
      { type: "round-start", round: 2 },
      { type: "round-thinking", round: 2, thinking: "SECOND-THOUGHT: edit it." },
      { type: "tool-start", round: 2, id: "c2", name: "edit", args: "src/parse.js", ...card("edit", "src/parse.js") },
    ])
      w.log(r.runId, e);
    const whole = await l.tools.worker(l.call({ agent_id: id, show_trail: true }));
    assert.equal(whole.ok, true, whole.text);
    assert.ok(whole.text.startsWith(`[Filament: the trail of ${id}, whole from round 1. It stays until you ask for it again.]\n\n## builder ${id} — "Fix the parser"\n`), whole.text);
    // Its words and its calls, never its thinking (HarnessV3-TaskGraph-v2 TG2-D60).
    assert.ok(whole.text.includes("Round 1\nSaid: Plan: return [] early.\nCalled read `src/parse.js` → ok, 900 characters") && whole.text.includes("Round 2\nCalled edit `src/parse.js` → still running") && !whole.text.includes("THOUGHT"), whole.text);
    assert.ok(!whole.text.includes("FILE-BODY"), "a call that went well is a line: its result never enters the lead's conversation");
    assert.equal(whole.note, `agent: the trail of builder ${id}, shown to its lead (from its start)`);
    const later = await l.tools.worker(l.call({ agent_id: id, show_trail: true, from_round: 2 }));
    assert.ok(later.text.startsWith(`[Filament: the trail of ${id}, whole from round 2.`) && later.text.includes("Round 2\nCalled edit `src/parse.js` → still running") && !later.text.includes("Plan: return [] early."), later.text);
    // It moved no mark: the lead's next look still shows both rounds whole.
    const look = l.door.inbox.take().at(-1);
    assert.ok(look?.kind === "look" && look.text.includes("Round 1\nSaid: Plan: return [] early.") && look.text.includes("Round 2\nCalled edit `src/parse.js` → still running") && !look.text.includes("THOUGHT"));
    // This worker shares the session's folder (no worktree here): the files its calls wrote, as its log names them.
    const changed = await l.tools.worker(l.call({ agent_id: id, show_changes: true }));
    assert.equal(changed.text, `[Filament: the change so far of ${id}: it works in your folder, so no git measures its change. It stays until you ask for it again.]\n\nThe files its calls wrote, which your own tools can read:\n- src/parse.js`);
    r.finish({ status: "done", report: "FIXED" });
    await w.registry.settled(id);
    // Once it reported, its trail is its report's to tell; what it changed can still be read, before it is applied.
    const gone = await l.tools.worker(l.call({ agent_id: id, show_trail: true }));
    assert.deepEqual([gone.ok, gone.text], [false, `Nothing shown: builder ${id} is not running: its report stands for its work — follow up on it to ask it more, or read what it changed with show_changes.`]);
    const after = await l.tools.worker(l.call({ agent_id: id, show_changes: true }));
    assert.deepEqual([after.ok, after.text], [true, changed.text], "a worker that shared the folder: the files its calls wrote");
    // A scout changes nothing.
    const scout = await l.tools.agent(l.call({ ...BRIEF, role: "scout", description: "Map the parser" }));
    const sr = await w.run(2);
    sr.attach();
    await until(() => w.registry.get(String(scout.agentId))?.runId === sr.runId, "the scout's run to attach");
    assert.equal((await l.tools.worker(l.call({ agent_id: scout.agentId, show_changes: true }))).text, `scout ${scout.agentId} changes nothing: it only reads.`);
    sr.finish({ status: "done", report: "MAPPED" });
    await w.registry.settled(String(scout.agentId));
    l.door.close();
  });
});

describe("a look through the turn's inbox (TG2-D15, D22)", () => {
  // (fails before: yes — a lead's wait heard a report, the developer or its own timer: nothing of a worker at work)
  test("a worker that goes on from its plan rings its lead at once; the look rides behind another's report, and its marks give its words again", async () => {
    const w = watched({ runlog: true });
    const l = leadOf(w.registry, w.dir, { looks: 30 });
    const a = await running(w, l);
    const b = await running(w, l, 2);
    assert.deepEqual([l.door.inbox.reads, w.registry.hostOf(a.id)?.supervise, w.readers(a.r.runId)], [true, true, 1]);
    /** @type {string | null} */
    let woke = null;
    const arrival = l.door.inbox.arrival().then((what) => (woke = what ?? "report"));
    w.registry.relay(a.id, { type: "round-start", round: 1, blocksBefore: 0, context: 9000 });
    w.log(a.r.runId, { type: "round-start", round: 1 });
    w.log(a.r.runId, { type: "round-thinking", round: 1, thinking: "An empty file has no lines. Return [] early." });
    w.log(a.r.runId, { type: "round-text", round: 1, text: "Plan: read src/parse.js, return [] for an empty input, run the tests." });
    w.registry.relay(a.id, { type: "round-text", round: 1, text: "Plan: read src/parse.js, return [] for an empty input, run the tests.", block: 1 });
    await tick();
    assert.equal(woke, null, "a reply its run may end on rings nobody: were it the last, it is the report");
    w.log(a.r.runId, { type: "tool-start", round: 1, id: "c1", name: "read", args: "src/parse.js", ...card("read", "src/parse.js") });
    await arrival;
    assert.deepEqual([woke, l.door.inbox.due()], ["look", true]);
    assert.deepEqual(w.registry.get(a.id)?.progress?.signs, [{ kind: "plan", round: 1, words: "said how it will go about its task" }], "on the worker's card, until its lead has looked");
    // The other reports as the look is due: the report first, and the worker that reported in no look.
    b.r.finish({ status: "done", report: "FIXED" });
    await w.registry.settled(b.id);
    const taken = l.door.inbox.take();
    assert.deepEqual(taken.map((t) => t.kind), ["report", "look"]);
    const look = taken[1];
    assert.equal(look.text, [
      "[Filament: a look at your workers. 1 is running.]",
      "",
      `## builder ${a.id} — "Fix the parser"`,
      "round 1 · context ≈9,000 tokens · sign: said how it will go about its task",
      "Its plan (round 1): Plan: read src/parse.js, return [] for an empty input, run the tests.",
      "",
      "Round 1",
      "Said: Plan: read src/parse.js, return [] for an empty input, run the tests.",
      "Called read `src/parse.js` → still running",
    ].join("\n"));
    assert.ok(!look.text.includes(b.id));
    // What it showed, as the lead's run says it (TG2-D22): the worker's own log between the marks gives the rounds again.
    assert.deepEqual(look.look?.workers, [{ id: a.id, run: a.r.runId, fromEvent: 0, toEvent: 4, fromRound: 1, toRound: 1, signs: ["plan"] }]);
    const m = /** @type {any} */ (look.look?.workers[0]);
    const again = trailOf(w.events(m.run).filter((e) => e.n <= m.toEvent), { since: m.fromEvent });
    assert.deepEqual(again.rounds.map((r) => [r.n, r.said, r.calls.map((c) => `${c.name} ${c.args}`)]), [[1, ["Plan: read src/parse.js, return [] for an empty input, run the tests."], ["read src/parse.js"]]]);
    assert.deepEqual([w.registry.get(a.id)?.progress?.signs, l.door.inbox.due()], [[], false]);
    // Nothing new and the pace not passed: no look. A lead whose wait ended is shown one all the same, which stands alone.
    assert.deepEqual(l.door.inbox.take(), []);
    l.door.inbox.look();
    const [asked] = l.door.inbox.take();
    assert.ok(asked.text.startsWith("[Filament: a look at your workers, in place of the one before. Since it: 0 moved, 1 did not.]"), asked.text);
    assert.ok(asked.text.includes("Its plan (round 1): Plan: read src/parse.js") && asked.text.includes("So far (round 1): read 1 file") && asked.text.endsWith("Nothing new since your last look."), asked.text);
    a.r.finish({ status: "done", report: "FIXED" });
    await w.registry.settled(a.id);
    assert.equal(w.readers(a.r.runId), 0, "its run's events are let go of at its end");
    l.door.inbox.look();
    assert.deepEqual(l.door.inbox.take().map((t) => t.kind), ["report"], "with no worker running there is no look");
    l.door.close();
  });

  // (fails before: yes — nothing a turn took and never gave its model could be given again)
  test("a look taken and handed back shows the same rounds again, and none waits for the session's next turn", async () => {
    const w = watched({ runlog: true });
    const l = leadOf(w.registry, w.dir, { looks: 0 });
    const { id, r } = await running(w, l);
    w.log(r.runId, { type: "round-text", round: 1, text: "Plan: edit the parser." });
    w.log(r.runId, { type: "tool-start", round: 1, id: "c1", name: "edit", args: "src/parse.js", ...card("edit", "src/parse.js") });
    const first = l.door.inbox.take();
    assert.deepEqual([first.map((t) => t.kind), l.door.inbox.due()], [["look"], false]);
    assert.deepEqual(first[0].look?.workers[0].signs, ["plan", "change"]);
    l.door.inbox.back(first);
    assert.equal(l.door.inbox.due(), true);
    assert.deepEqual(w.registry.get(id)?.progress?.signs?.map((s) => s.kind), ["plan", "change"], "its signs are its card's again");
    const again = l.door.inbox.take();
    assert.deepEqual([again[0].text, again[0].look?.workers], [first[0].text, first[0].look?.workers]);
    l.door.inbox.back(again);
    l.door.close();
    assert.deepEqual(w.registry.peekQueued("c1"), [], "a look is never queued");
    // A later turn of the lead's — its resume after a pause — goes on from the worker's marks.
    const next = leadOf(w.registry, w.dir, { looks: 0, runId: "lead-2" });
    assert.equal(next.door.inbox.take()[0]?.text, first[0].text);
    r.finish({ status: "done", report: "FIXED" });
    await w.registry.settled(id);
    next.door.close();
  });

  test("a worker's progress says its lead's messages read and not yet, and a look says which", async () => {
    const w = watched({ runlog: true });
    const l = leadOf(w.registry, w.dir, { looks: 30 });
    const { id, r } = await running(w, l);
    assert.deepEqual([w.registry.get(id)?.progress?.signs, w.registry.get(id)?.progress?.lead], [[], { read: 0, unread: 0 }]);
    w.log(r.runId, { type: "round-start", round: 1 });
    w.log(r.runId, { type: "round-text", round: 1, text: "Plan: floats." });
    w.log(r.runId, { type: "tool-start", round: 1, id: "c1", name: "read", args: "src/parse.js", ...card("read", "src/parse.js") });
    const sent = await l.tools.worker(l.call({ agent_id: id, prompt: "Keep amounts as integers." }));
    assert.equal(sent.ok, true, sent.text);
    assert.deepEqual(w.registry.get(id)?.progress?.lead, { read: 0, unread: 1 });
    const first = l.door.inbox.take().at(-1);
    assert.match(String(first?.text), /\nstarting · your message of 1 s ago is not read yet · sign: said how it will go about its task\n/);
    w.log(r.runId, { type: "tool-end", round: 1, id: "c1", name: "read", ok: true, chars: 40 });
    w.log(r.runId, { type: "steer-read", ids: ["s1"], kinds: ["note"] });
    assert.deepEqual(w.registry.get(id)?.progress?.lead, { read: 1, unread: 0 });
    w.log(r.runId, { type: "round-start", round: 2 });
    w.log(r.runId, { type: "round-text", round: 2, text: "Understood: integers." });
    l.door.inbox.look();
    const next = l.door.inbox.take().at(-1);
    assert.ok(String(next?.text).includes('Round 1, continued\nCalled read `src/parse.js` → ok, 40 characters\nRead your message at the end of this round: "Keep amounts as integers."\n\nRound 2\nSaid: Understood: integers.'), next?.text);
    assert.ok(!String(next?.text).includes("not read yet"));
    r.finish({ status: "done", report: "FIXED" });
    await w.registry.settled(id);
    l.door.close();
  });

  // (fails before: yes — a worker that ended with its lead's message unread reported as any other: the lead took its
  // work for one that had heard it)
  test("a worker that ended without reading its lead's message: its report says so in the message's words, and names none it read", async () => {
    const w = watched({ runlog: true });
    const l = leadOf(w.registry, w.dir, { looks: 30 });
    const { id, r } = await running(w, l);
    w.log(r.runId, { type: "round-start", round: 1 });
    for (const prompt of ["Keep amounts as integers.", "And keep the export."]) assert.equal((await l.tools.worker(l.call({ agent_id: id, prompt }))).ok, true);
    w.log(r.runId, { type: "steer-read", ids: ["s1"], kinds: ["note"] });
    r.finish({ status: "done", report: "FIXED" });
    await w.registry.settled(id);
    const [report] = l.door.inbox.take();
    assert.equal(report.kind, "report");
    assert.ok(report.text.includes("Its report:\nFIXED") && report.text.includes("\n\nIt ended without reading your message, so neither its work nor this report takes it into account:\n- And keep the export.\n\n"), report.text);
    assert.ok(!report.text.includes("- Keep amounts as integers."), "the one it read is not named");
    l.door.close();
    // A lead that does not read along has no mark of what its worker read: its report is as before.
    const off = watched({ runlog: true });
    const lo = leadOf(off.registry, off.dir);
    const b = await running(off, lo);
    assert.equal((await lo.tools.worker(lo.call({ agent_id: b.id, prompt: "Keep the export." }))).ok, true);
    b.r.finish({ status: "done", report: "FIXED" });
    await off.registry.settled(b.id);
    assert.ok(!lo.door.inbox.take()[0].text.includes("without reading"));
    lo.door.close();
  });

  test("a lead that does not read along gets no look, and its workers no mark; nor does one where Filament keeps no run log", async () => {
    const w = watched({ runlog: true });
    const l = leadOf(w.registry, w.dir);
    const { id, r } = await running(w, l);
    w.log(r.runId, { type: "round-text", round: 1, text: "Plan." });
    w.log(r.runId, { type: "tool-start", round: 1, id: "c1", name: "edit", args: "a.js", ...card("edit", "a.js") });
    assert.deepEqual([l.door.inbox.reads, l.door.inbox.due(), w.readers(r.runId), w.registry.hostOf(id)?.supervise], [false, false, 0, false]);
    l.door.inbox.look();
    assert.deepEqual(l.door.inbox.take(), []);
    assert.deepEqual(Object.keys(w.registry.get(id)?.progress || {}), ["round", "tool", "context", "compactions", "words", "call", "wait", "spent", "asking", "check", "bounce"], "its progress has none of a reading lead's signs and reads");
    assert.equal((await l.tools.worker(l.call({ agent_id: id, show_trail: true }))).text, "Nothing sent: worker needs prompt — your message or follow-up — or stop: true, or apply_changes: true.");
    r.finish({ status: "done", report: "FIXED" });
    await w.registry.settled(id);
    l.door.close();
    const bare = watched();
    assert.equal(bare.registry.readsRuns(), false);
    const b = leadOf(bare.registry, bare.dir, { looks: 0 });
    assert.equal(b.door.inbox.reads, false, "no run log, nothing to read along with");
    b.door.close();
    assert.equal(w.registry.readsRuns(), true);
  });
});

// ---- the lead's loop ---------------------------------------------------------------------------------------------------

const use = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const said = (/** @type {string} */ text) => ({ type: "text", text });
/** The turn's own work in a request: its messages after the developer's. @param {any} body */
const workOf = (body) => body.messages.slice(1);
/** Every block of a kind in a request's work. @param {any} body @param {(b: any) => boolean} is */
const blocksOf = (body, is) => workOf(body).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content.filter(is) : []));
const waitsIn = (/** @type {any} */ body) => blocksOf(body, (b) => b?.type === "tool_use" && b.name === "wait").length;
const looksIn = (/** @type {any} */ body) => blocksOf(body, isLook).map((b) => String(b.text));
const stubsIn = (/** @type {any} */ body) => blocksOf(body, (b) => b?.type === "text" && b.text === LOOK_STUB).length;
/** What a call answered in a request. @param {any} body @param {string} id */
const resultOf = (body, id) => String(blocksOf(body, (b) => b?.type === "tool_result" && b.tool_use_id === id)[0]?.content ?? "");

/**
 * A lead's loop on a scripted model, over a registry whose run log the test writes — its door as turn.js opens it for
 * a lead that reads along. `reply(n)` answers the model's nth call; `step(n)` runs as that call arrives, before its
 * answer: the workers move there. `fail`: the call the provider refuses. `hand(k)`: what the lead's own kth tool call
 * answers; `compact`: the loop's compaction line and its writer.
 * @param {{ reply: (n: number) => any[] | null, step?: (n: number) => void | Promise<void>, pace?: number, fail?: number, hand?: (k: number) => string, compact?: any }} o
 */
const reading = ({ reply, step = () => {}, pace = 0, fail = -1, hand = () => "ran", compact = null }) => {
  const w = watched({ runlog: true });
  const l = leadOf(w.registry, w.dir, { looks: pace });
  /** @type {any[]} */
  const bodies = [];
  /** @type {any[]} */
  const events = [];
  let n = 0;
  let blocks = 0;
  let hands = 0;
  const run = () =>
    runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
      model: "m-lead",
      messages: [{ role: "user", content: "fix the parser" }],
      system: "s",
      tools: leadToolSetFor({ delegateRead: false, supervise: true }),
      modeNow: () => "edit",
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      call: async (/** @type {any} */ { body }) => {
        bodies.push(structuredClone(body)); // the loop keeps writing to its conversation after the call
        const at = n++;
        await step(at);
        if (at === fail) return { ok: false, status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "the provider refused it" } }, id: null };
        const content = reply(at) || [said("LEAD DONE")];
        return { ok: true, status: 200, json: { content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }, id: null };
      },
      costOf: () => 0,
      runHand: async () => hand(++hands),
      ...(compact ? { compact } : {}),
      delegateRead: null,
      subagents: {
        run: (/** @type {any} */ o) => l.tools.agent(l.call(o.input)),
        worker: (/** @type {any} */ o) => l.tools.worker(l.call(o.input)),
        watch: () => l.tools.watch({ chainId: "c1" }).text,
      },
      inbox: l.door.inbox,
      mailbox: { read: () => [] },
      permissions: null,
      tree: null,
      onEvent: (/** @type {any} */ e) => events.push(e),
      previewChars: 0,
      sink: { text() {}, thinking() {}, signThinking() {}, endBlock: () => void (blocks += 1), count: () => blocks },
      signal: null,
      resume: null,
    }));
  /** The nth worker the turn launched, its run attached. @param {number} [nth] */
  const attached = async (nth = 1) => {
    const r = await w.run(nth);
    r.attach();
    await until(() => w.registry.get(r.id)?.runId === r.runId, "its run to attach");
    return r;
  };
  return { w, l, bodies, events, run, attached };
};

describe("the lead's loop (TG2-D15, D16, D24)", () => {
  // (fails before: yes — the wait answered with the watch, and each wait and each list of the workers stayed in the
  // lead's conversation for the rest of the turn: three quiet waits were three of each)
  test("its wait ends on a look; of its looks the newest stays whole; a wait it answered a look with leaves, and still counts", async () => {
    /** @type {import("./helpers/team.js").HostRun} */
    let r = /** @type {any} */ (null);
    const log = (/** @type {any} */ e) => t.w.log(r.runId, e);
    const t = reading({
      reply: (n) =>
        [
          [use("launch", "agent", BRIEF)],
          [use("w1", "wait", { seconds: 30 })],
          [use("w2", "wait", { seconds: 30 })],
          [use("w3", "wait", { seconds: 30 })],
          [said("It parses floats. Integers only."), use("steer", "worker", { agent_id: r?.id, prompt: "Keep amounts as integers." })],
          [use("w5", "wait", { seconds: 30 })],
          [use("w6", "wait", { seconds: 30 })],
        ][n] || null,
      step: async (n) => {
        if (n === 1) {
          r = await t.attached();
          log({ type: "round-start", round: 1 });
          log({ type: "round-thinking", round: 1, thinking: "PLAN-THOUGHT: parse amounts as floats." });
          log({ type: "round-text", round: 1, text: "Plan: read src/parse.js, parse amounts as floats." });
          log({ type: "tool-start", round: 1, id: "c1", name: "read", args: "src/parse.js", ...card("read", "src/parse.js") });
        }
        if (n === 2) log({ type: "tool-end", round: 1, id: "c1", name: "read", ok: true, chars: 900 });
        if (n === 3) {
          log({ type: "round-start", round: 2 });
          log({ type: "round-thinking", round: 2, thinking: "SECOND-THOUGHT: floats it is." });
          log({ type: "tool-start", round: 2, id: "c2", name: "edit", args: "src/parse.js", ...card("edit", "src/parse.js") });
        }
        if (n === 5) {
          log({ type: "tool-end", round: 2, id: "c2", name: "edit", ok: true, chars: 12 });
          log({ type: "steer-read", ids: ["s1"], kinds: ["note"] });
          log({ type: "round-start", round: 3 });
          log({ type: "round-text", round: 3, text: "Understood: integers." });
          log({ type: "tool-start", round: 3, id: "c3", name: "edit", args: "src/parse.js", ...card("edit", "src/parse.js") });
        }
        if (n === 6) {
          r.finish({ status: "done", report: "WORKER REPORT: integers, and the tests pass." });
          await t.w.registry.settled(r.id);
        }
      },
    });
    const out = await t.run();
    assert.equal(out.status, "done", out.error || "");
    const b = t.bodies;
    assert.equal(b.length, 8);
    // The first look: the wait ended on it at once, and it opens with the worker's plan, whole — and none of its
    // thinking (TG2-D60).
    assert.equal(resultOf(b[2], "w1"), "Waited 0 s: your workers moved. A look follows as a message.");
    assert.deepEqual([waitsIn(b[2]), looksIn(b[2]).length, stubsIn(b[2])], [1, 1, 0]);
    assert.equal(looksIn(b[2])[0], [
      "[Filament: a look at your workers. 1 is running.]",
      "",
      `## builder ${r.id} — "Fix the parser"`,
      "starting · sign: said how it will go about its task",
      "Its plan (round 1): Plan: read src/parse.js, parse amounts as floats.",
      "",
      "Round 1",
      "Said: Plan: read src/parse.js, parse amounts as floats.",
      "Called read `src/parse.js` → still running",
    ].join("\n"));
    assert.equal(b[2].messages.at(-1).content.at(-1).text, looksIn(b[2])[0], "it rides the wait's answer, as a report does");
    // The lead only waited again: that wait and its answer are gone, and the newest look stands where the first stood.
    assert.deepEqual([waitsIn(b[3]), looksIn(b[3]).length, stubsIn(b[3])], [1, 1, 0], "one wait, one look");
    assert.equal(b[3].messages.length, b[2].messages.length, "quiet watching left nothing");
    assert.equal(looksIn(b[3])[0], [
      "[Filament: a look at your workers, in place of the one before. Since it: 1 moved, 0 did not.]",
      "",
      `## builder ${r.id} — "Fix the parser"`,
      "starting",
      "Its plan (round 1): Plan: read src/parse.js, parse amounts as floats.",
      "So far (round 1): read 1 file",
      "",
      "Round 1, continued",
      "Called read `src/parse.js` → ok, 900 characters",
    ].join("\n"));
    assert.ok(![2, 3, 4].some((k) => looksIn(b[k])[0].includes("-THOUGHT")), "no look holds a worker's thinking");
    assert.deepEqual([waitsIn(b[4]), looksIn(b[4]).length, b[4].messages.length], [1, 1, b[2].messages.length], "and again after a third");
    assert.ok(looksIn(b[4])[0].includes("sign: made its first change (src/parse.js)") && looksIn(b[4])[0].includes("Round 2\nCalled edit `src/parse.js` → still running"), looksIn(b[4])[0]);
    // The lead steered on that look: its words and its call stay, and the look is a line once a newer one stands.
    assert.equal(resultOf(b[5], "steer"), `Sent to builder ${r.id}: it reads your message at its next step, while it works. Its report still arrives as a message when it finishes.`);
    assert.deepEqual(t.w.steers, [{ runId: r.runId, kind: "note", text: "Keep amounts as integers.", from: "lead" }]);
    assert.deepEqual([waitsIn(b[6]), looksIn(b[6]).length, stubsIn(b[6])], [2, 1, 1]);
    assert.equal(blocksOf(b[6], (x) => x?.type === "text" && x.text === "It parses floats. Integers only.").length, 1);
    assert.equal(blocksOf(b[6], (x) => x?.type === "tool_use" && x.name === "worker").length, 1);
    assert.ok(looksIn(b[6])[0].includes('Round 2, continued\nCalled edit `src/parse.js` → ok\nRead your message at the end of this round: "Keep amounts as integers."\n\nRound 3\nSaid: Understood: integers.'), looksIn(b[6])[0]);
    // The report arrives as it always did; the turn ends, and what the session keeps of it holds no look.
    assert.ok(b[7].messages.at(-1).content.some((/** @type {any} */ x) => x?.type === "text" && x.text.includes("WORKER REPORT: integers, and the tests pass.")));
    const kept = out.work.flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : []));
    assert.equal(kept.filter(isLook).length, 0);
    assert.deepEqual([kept.filter((x) => x?.text === LOOK_GONE).length, kept.filter((x) => x?.text === LOOK_STUB).length], [1, 1], "a line where each was");
    assert.ok(!JSON.stringify(out.work).includes("SECOND-THOUGHT"));
    // Every round counts, and the run's log holds each wait and each look with its marks.
    assert.equal(out.totals.rounds, 8);
    assert.deepEqual(t.events.filter((e) => e.type === "tool-start" && e.name === "wait").map((e) => e.id), ["w1", "w2", "w3", "w5", "w6"]);
    const looks = t.events.filter((e) => e.type === "look");
    assert.deepEqual(looks.map((e) => [e.round, e.workers.map((/** @type {any} */ x) => [x.id, x.run, x.fromRound, x.toRound, x.signs]), e.tokens > 0]), [
      [2, [[r.id, r.runId, 1, 1, ["plan"]]], true],
      [3, [[r.id, r.runId, 1, 1, []]], true],
      [4, [[r.id, r.runId, 2, 2, ["change"]]], true],
      [6, [[r.id, r.runId, 2, 3, []]], true],
    ]);
    assert.equal(out.notes.filter((s) => s.includes("in which the lead only waited left its conversation before round")).length, 2);
    assert.ok(out.notes.some((s) => s.startsWith("agent: the lead was shown 4 looks at its workers")), out.notes.join("\n"));
    t.l.door.close();
  });

  // (fails before: yes — a wait that only ran out of time asked for a look, whatever was new: the lead read the same
  // picture at every time-out, and each such round stayed in its conversation)
  test("a wait that only ran out of time, with no look due, shows none: the lead reads why and its workers' lines, and the round leaves once the next look stands", async () => {
    /** @type {import("./helpers/team.js").HostRun} */
    let r = /** @type {any} */ (null);
    const t = reading({
      pace: 3600,
      reply: (n) => [[use("launch", "agent", BRIEF)], [use("w1", "wait", { seconds: 30 })], [use("w2", "wait", { seconds: 0.05 })], [use("w3", "wait", { seconds: 30 })]][n] || null,
      step: async (n) => {
        if (n === 1) {
          r = await t.attached();
          t.w.log(r.runId, { type: "round-start", round: 1 });
          t.w.log(r.runId, { type: "round-text", round: 1, text: "Plan: read the parser, then fix it." });
          t.w.log(r.runId, { type: "tool-start", round: 1, id: "c1", name: "read", args: "src/parse.js", ...card("read", "src/parse.js") });
        }
        if (n === 3) t.w.log(r.runId, { type: "tool-start", round: 1, id: "c2", name: "edit", args: "src/parse.js", ...card("edit", "src/parse.js") });
        if (n === 4) {
          r.finish({ status: "done", report: "FIXED" });
          await t.w.registry.settled(r.id);
        }
      },
    });
    const out = await t.run();
    assert.equal(out.status, "done", out.error || "");
    const b = t.bodies;
    assert.equal(resultOf(b[2], "w1"), "Waited 0 s: your workers moved. A look follows as a message.", "a sign ends a wait with a look, as before");
    // The time-out: no look, its words and the workers' lines, and the look before it still whole.
    const timed = resultOf(b[3], "w2");
    assert.ok(timed.startsWith(`Waited 0 s: no report yet, and no look is due — Filament shows you one at once on a sign, else every 60 min while something is new.\n\nWorkers still running (1):\n- builder ${r.id} ("Fix the parser"): starting`), timed);
    assert.deepEqual([waitsIn(b[3]), looksIn(b[3]).length, stubsIn(b[3])], [2, 1, 0]);
    assert.equal(b[3].messages.at(-1).content.length, 1, "nothing rides the time-out's answer");
    // A sign ends the next wait: the time-out's round and that wait leave, and the newest look stands where the first stood.
    assert.equal(resultOf(b[4], "w3"), "", "the wait the look answered left");
    assert.deepEqual([waitsIn(b[4]), looksIn(b[4]).length, b[4].messages.length], [1, 1, b[2].messages.length]);
    assert.ok(looksIn(b[4])[0].includes("sign: made its first change (src/parse.js)"), looksIn(b[4])[0]);
    assert.equal(out.notes.filter((s) => s.startsWith("agent: 2 rounds in which the lead only waited left its conversation before round 5")).length, 1, out.notes.join("\n"));
    t.l.door.close();
  });

  // (fails before: yes — a look was marked shown the moment the turn took it, heard or not)
  test("a look the model never answered goes back: the lead's next look shows that part again", async () => {
    /** @type {import("./helpers/team.js").HostRun} */
    let r = /** @type {any} */ (null);
    const t = reading({
      fail: 2,
      reply: (n) => [[use("launch", "agent", BRIEF)], [use("w1", "wait", { seconds: 30 })]][n] || null,
      step: async (n) => {
        if (n !== 1) return;
        r = await t.attached();
        t.w.log(r.runId, { type: "round-text", round: 1, text: "Plan: edit the parser." });
        t.w.log(r.runId, { type: "tool-start", round: 1, id: "c1", name: "edit", args: "src/parse.js", ...card("edit", "src/parse.js") });
      },
    });
    const out = await t.run();
    assert.equal(out.status, "failed");
    const shown = looksIn(t.bodies[2])[0];
    assert.ok(shown.includes("Said: Plan: edit the parser."));
    assert.equal(t.l.door.inbox.due(), true);
    assert.equal(t.l.door.inbox.take().at(-1)?.text, shown);
    r.finish({ status: "done", report: "FIXED" });
    await t.w.registry.settled(r.id);
    t.l.door.close();
  });

  // (fails before: yes — a fold of the turn's rounds took the lead's only look with it, and no other came until a
  // worker moved: the lead knew its quiet workers by a summary's words; and the fold named its rounds by counting the
  // replies the conversation held, one short of the round a wait had left)
  test("a fold of the turn's rounds that takes the look the lead held brings a new one with the next read, though no worker moved; the fold's rounds are numbered over the one that left", async () => {
    /** @type {import("./helpers/team.js").HostRun} */
    let r = /** @type {any} */ (null);
    const SUMMARY = "SUMMARY-OF-THE-LEAD'S-STEPS";
    const t = reading({
      // Rounds 1 to 3 launch and wait twice: the second wait answers a look, so round 3 leaves. Rounds 4 to 7 read, and
      // the fourth read is past the line by itself: the fold keeps three rounds and takes 1, 2 and 4.
      hand: (k) => (k === 4 ? "x".repeat(60_000) : "ran"),
      compact: { usable: 5_000, window: 200_000, target: 2_500, source: "operator", fixed: 0, factor: null, summarize: async () => ({ text: SUMMARY, by: "m" }) },
      reply: (n) => [[use("launch", "agent", BRIEF)], [use("w1", "wait", { seconds: 30 })], [use("w2", "wait", { seconds: 30 })], ...[1, 2, 3, 4, 5, 6].map((k) => [use(`r${k}`, "read", { path: `f${k}.txt` })])][n] || null,
      step: async (n) => {
        if (n === 1) {
          r = await t.attached();
          t.w.log(r.runId, { type: "round-start", round: 1 });
          t.w.log(r.runId, { type: "round-text", round: 1, text: "Plan: edit the parser." });
          t.w.log(r.runId, { type: "tool-start", round: 1, id: "c1", name: "edit", args: "src/parse.js", ...card("edit", "src/parse.js") });
        }
        if (n === 2) t.w.log(r.runId, { type: "tool-end", round: 1, id: "c1", name: "edit", ok: true, chars: 12 });
        if (n === 9) {
          r.finish({ status: "done", report: "FIXED" });
          await t.w.registry.settled(r.id);
        }
      },
    });
    const out = await t.run();
    assert.equal(out.status, "done", JSON.stringify(out.error || out.notes));
    const folded = t.bodies.findIndex((b) => JSON.stringify(b.messages).includes(SUMMARY));
    assert.equal(folded, 7, "the fold came before the call after the fourth read");
    assert.deepEqual([waitsIn(t.bodies[6]), looksIn(t.bodies[6]).length], [1, 1], "the second wait had left, and the lead held one look");
    assert.ok(out.notes.some((s) => s.startsWith("agent: compacted rounds 1–4 of this turn at the compaction line")), out.notes.join(" | "));
    assert.deepEqual(looksIn(t.bodies[folded]), [], "the fold took the look: it was in the rounds summarized");
    const again = looksIn(t.bodies[folded + 1]);
    assert.equal(again.length, 1, "the next read brought one");
    assert.ok(again[0].startsWith("[Filament: a look at your workers, in place of the one before. Since it: 0 moved, 1 did not.]") && again[0].includes("Its plan (round 1): Plan: edit the parser."), again[0]);
    assert.ok(out.notes.includes("agent: a fold of this turn's rounds took the look the lead's conversation held; a new one was asked for before round 9"), out.notes.join(" | "));
    t.l.door.close();
  });

  // (fails before: yes — TG2-D46: "all" was no worker's id)
  test("a message to a running worker — or to every one of them — and a read run at once, and the turn goes on", async () => {
    /** @type {{ id: string, r: import("./helpers/team.js").HostRun }} */
    let a = /** @type {any} */ (null);
    /** @type {{ id: string, r: import("./helpers/team.js").HostRun }} */
    let b = /** @type {any} */ (null);
    const t = reading({
      pace: 3600,
      reply: (n) =>
        [
          [use("steer", "worker", { agent_id: a.id, prompt: "Keep amounts as integers." })],
          [use("all", "worker", { agent_id: "all", prompt: "Run the linter before you report." })],
          [use("trail", "worker", { agent_id: a.id, show_trail: true })],
        ][n] || null,
      step: async (n) => {
        if (n !== 3) return;
        a.r.finish({ status: "done", report: "A REPORTED" });
        await t.w.registry.settled(a.id);
      },
    });
    a = await running(t.w, t.l);
    b = await running(t.w, t.l, 2);
    b.r.finish({ status: "done", report: "B REPORTED" });
    await t.w.registry.settled(b.id);
    t.w.log(a.r.runId, { type: "round-start", round: 1 });
    t.w.log(a.r.runId, { type: "round-text", round: 1, text: "Plan: floats." });
    const out = await t.run();
    assert.deepEqual([out.status, out.pause], ["done", null], out.error || "");
    assert.equal(resultOf(t.bodies[1], "steer"), `Sent to builder ${a.id}: it reads your message at its next step, while it works. Its report still arrives as a message when it finishes.`);
    assert.equal(resultOf(t.bodies[2], "all"), `Sent to 1 worker running now — builder ${a.id}: it reads it at its next step. Its report still arrives as a message when it finishes.`, "the worker that reported is not running");
    assert.ok(resultOf(t.bodies[3], "trail").startsWith(`[Filament: the trail of ${a.id}, whole from round 1.`));
    assert.deepEqual(t.w.steers.map((s) => s.text), ["Keep amounts as integers.", "Run the linter before you report."]);
    t.l.door.close();
  });
});
