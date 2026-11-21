// @ts-check
// HarnessV3-AtHome P2 step 4: the lead's watch. Whenever a team's lead's wait returns, it lists the workers still
// running — each one's round, newest tool, context window, compactions and newest words, or the question it waits on —
// from the events of their runs. The lead messages a running worker (read at its next step, as its lead's), stops one,
// follows up one that reported, and says when a report fell short (memory's lead correction, M7-D50). A worker's report
// reaches its lead through the turn's one wake hook (AH-O10). Pure, against scripted registries and loops.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { noSuchSubagent } from "../src/app/agent/subagents.js";
import { leadToolSetFor, toolSetFor } from "../src/app/agent/tools.js";
import { deferred, heldTime, leadOf, running, watched, BRIEF } from "./helpers/team.js";
import { until } from "./helpers/wait.js";

// (fails before: yes — the registry counted a worker's calls and kept nothing else of its run; wait said only what
// woke it) — (HarnessV3-Views V3, fails before: yes, against HEAD) and what it has spent, none priced yet here.
test("a running worker's progress, from its run's events — round, newest tool, window, compactions, newest words — and the lead's list of it", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir);
  const { id, r } = await running(w, l);
  assert.deepEqual(w.registry.get(id)?.progress, { round: 0, tool: null, context: null, compactions: [], words: "", call: null, wait: null, spent: null, asking: null, check: null, bounce: null }, "it starts");
  assert.equal(l.tools.watch({ chainId: "c1" }).text, `Workers still running (1):\n- builder ${id} ("Fix the parser"): starting`);
  for (const e of [
    { type: "window", window: 128000, usable: 108800, source: "builtin", fixed: 0 },
    { type: "round-start", round: 1, blocksBefore: 0, context: 9000 },
    { type: "turn-state", from: "planning", to: "acting", why: "1 tool call" },
    { type: "tool-start", round: 1, name: "read", args: "src/parse.js", id: "t1" },
    { type: "round-text", round: 2, text: "Reading the parser.\n\nThen   its tests.", block: 1 },
    { type: "compacting", round: 3 },
    { type: "compaction", round: 3, fromRound: 1, toRound: 2, tokensBefore: 90000, tokensAfter: 20000, by: "m-cheap" },
    { type: "compaction", round: 3, stoodDown: true },
    { type: "round-start", round: 4, blocksBefore: 2, context: 41216 },
    { type: "turn-state", from: "planning", to: "acting", why: "1 tool call" },
    { type: "tool-start", round: 4, name: "bash", args: "npm test", id: "t2" },
  ])
    w.registry.relay(id, e);
  assert.deepEqual(w.registry.get(id)?.progress, {
    round: 4,
    tool: { name: "bash", args: "npm test" },
    context: { tokens: 41216, window: 128000, usable: 108800 },
    compactions: [{ round: 3, at: 1000, how: "summarized by m-cheap" }],
    words: "Reading the parser. Then its tests.",
    call: null,
    wait: null,
    spent: null,
    asking: null,
    check: null,
    bounce: null,
  });
  // The provider refused a round for size: the loop's own recovery is a compaction too, said as what it was.
  w.registry.relay(id, { type: "compaction", round: 6, why: "overflow-refusal", cleared: 3, folded: true });
  const watch = l.tools.watch({ chainId: "c1" });
  assert.equal(
    watch.text,
    `Workers still running (1):\n- builder ${id} ("Fix the parser"): round 4 · last tool bash \`npm test\` · context ≈41,216 of 128,000 tokens (32%) · compacted 2 times, the newest at round 6 (after its provider refused a round for size) · newest words: "Reading the parser. Then its tests."`,
  );
  assert.deepEqual(watch.workers.map((/** @type {any} */ x) => [x.id, x.role, x.progress.round]), [[id, "builder", 4]], "plain JSON beside the words (AH-O10)");
  r.finish({ status: "done", report: "FIXED" });
  await w.registry.settled(id);
  assert.equal(w.registry.get(id)?.progress, null, "a worker that reported has no progress");
  assert.equal(l.tools.watch({ chainId: "c1" }).text, "No worker is running now.");
  l.door.close();
});

// (fails before: yes — the watch said a worker's round and nothing of the call it was in: a call streaming for six
// minutes and one stuck for six read alike; HarnessV3-FailurePoints §5.1 item 1)
test("a worker's running model call: how long it has run, what has streamed, its last byte, and the wait it is in", async () => {
  const clock = heldTime();
  const w = watched({ now: clock.now });
  const l = leadOf(w.registry, w.dir);
  const { id, r } = await running(w, l);
  const line = () => l.tools.watch({ chainId: "c1" }).text.split("\n")[1];
  // The call begins ten minutes into the clock: its time is its own.
  clock.to(600_000);
  w.registry.relay(id, { type: "round-start", round: 2, blocksBefore: 0 });
  assert.equal(line(), `- builder ${id} ("Fix the parser"): round 2 · model call 1 s · nothing streamed yet`);
  clock.to(600_000 + 371_000);
  w.registry.streamed(id, "thinking", 39_200);
  clock.to(600_000 + 372_000);
  assert.equal(line(), `- builder ${id} ("Fix the parser"): round 2 · model call 6 min · about 9,800 tokens of thinking so far · last byte 1 s ago`);
  // A wait is said in its loop's words while it lasts; then the call again.
  w.registry.relay(id, { type: "turn-state", from: "planning", to: "waiting", why: "zai is busy: trying again in 20 s (try 2 of 10)", retry: { upstream: "zai", status: 529, waitMs: 20_000, next: 2, of: 10 } });
  assert.equal(line(), `- builder ${id} ("Fix the parser"): round 2 · zai is busy: trying again in 20 s (try 2 of 10)`);
  w.registry.relay(id, { type: "turn-state", from: "waiting", to: "planning", why: "round 2: trying again" });
  assert.match(line(), / · model call 6 min · about 9,800 tokens of thinking so far · last byte 1 s ago$/);
  // Its reply is in, its tools run: no call runs, and words Filament adds after it are not the call's.
  w.registry.relay(id, { type: "turn-state", from: "planning", to: "acting", why: "1 tool call" });
  w.registry.streamed(id, "text", 50);
  assert.equal(w.registry.get(id)?.progress?.call, null);
  // A reply of thinking and tools: its thinking, said once the call is over, ends the call before its tools run.
  w.registry.relay(id, { type: "round-start", round: 3, blocksBefore: 2 });
  assert.equal(w.registry.get(id)?.progress?.call?.round, 3);
  w.registry.relay(id, { type: "round-thinking", round: 3, thinking: "Run the tests next." });
  assert.equal(w.registry.get(id)?.progress?.call, null);
  r.finish({ status: "done", report: "FIXED" });
  await w.registry.settled(id);
  l.door.close();
});

/** What the lead's wait answered, woken by an arrival that says `what` it is. @param {string | undefined} what */
const waitAnswer = async (what) => {
  /** @type {any[]} */
  const bodies = [];
  let n = 0;
  const arrived = deferred();
  const out = await runAgentTurn(
    /** @type {any} */ ({
      model: "m-lead",
      messages: [{ role: "user", content: "lead it" }],
      system: "s",
      tools: leadToolSetFor({ delegateRead: false }),
      modeNow: () => "edit",
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      call: async (/** @type {any} */ { body }) => {
        bodies.push(structuredClone(body));
        const content = n++ === 0 ? [{ type: "tool_use", id: "w1", name: "wait", input: { seconds: 30 } }] : [{ type: "text", text: "Done." }];
        if (n === 1) setTimeout(() => arrived.resolve(what), 10);
        return { ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null };
      },
      costOf: () => 0,
      runHand: async () => "ran",
      delegateRead: null,
      subagents: { run: async () => ({}), worker: async () => ({}), watch: () => "Workers still running (1):\n- tester sa_00000002 (\"Run the suite\"): round 2" },
      inbox: { take: () => [], hold: () => null, owed: () => new Promise(() => {}), arrival: () => arrived.promise },
      mailbox: { read: () => [] },
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
  return String(bodies[1].messages.at(-1).content.find((/** @type {any} */ b) => b.type === "tool_result" && b.tool_use_id === "w1").content);
};

// (fails before: yes — wait answered only what woke it)
test("the lead's wait answers what woke it, then the workers still running", async () => {
  assert.match(await waitAnswer(undefined), /^Waited \d+ s: a sub-agent reported\. Its report follows as a message\.\n\nWorkers still running \(1\):\n- tester sa_00000002 \("Run the suite"\): round 2$/);
  // (fails before: yes — HarnessV4_Tasks decision 10: the developer's words to a worker woke the wait as a report)
  assert.match(await waitAnswer("told"), /^Waited \d+ s: the developer wrote to one of your workers directly\. What they wrote follows as a message\.\n\nWorkers still running \(1\):/);
});

// (fails before: no — the registry's one path to a running turn was already the hook the loop's wait resolves on; this
// pins it as the seam AH-O10 names, with no loop behind the lead)
test("a worker's report wakes its lead through the turn's one hook, with no loop behind it", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir);
  const { id, r } = await running(w, l);
  let woke = false;
  const arrival = l.door.inbox.arrival().then(() => (woke = true));
  await new Promise((res) => setImmediate(res));
  assert.equal(woke, false, "nothing has landed yet");
  r.finish({ status: "done", report: "FIXED" });
  await arrival;
  const [d] = l.door.inbox.take();
  assert.ok(d.text.startsWith(`[Filament: your builder ${id} ("Fix the parser") finished. You asked it:`), d.text);
  l.door.close();
});

// (fails before: yes — worker refused a running worker: "its report comes first")
test("a message to a running worker goes to its run's mailbox as its lead's, read at its next step; one sent before its run starts waits for it", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir);
  const launched = await l.tools.agent(l.call(BRIEF));
  const id = String(launched.agentId);
  const r = await w.run(1);
  const early = await l.tools.worker(l.call({ agent_id: id, prompt: "Keep the old export too." }));
  assert.deepEqual([early.ok, early.text], [true, `Sent to builder ${id}: it reads your message at its next step, while it works. Its report still arrives as a message when it finishes.`]);
  assert.deepEqual(w.steers, [], "its run has not started: the message waits for it");
  r.attach();
  await until(() => w.steers.length === 1, "the message to reach its run");
  assert.deepEqual(w.steers, [{ runId: r.runId, kind: "note", text: "Keep the old export too.", from: "lead" }]);
  const late = await l.tools.worker(l.call({ agent_id: id, prompt: " And log the count. " }));
  assert.deepEqual([late.ok, late.note], [true, `agent: a message to builder ${id} (m-lead), read at its next step`]);
  assert.deepEqual(w.steers.at(-1), { runId: r.runId, kind: "note", text: "And log the count.", from: "lead" });
  r.finish({ status: "done", report: "FIXED" });
  await w.registry.settled(id);
  l.door.close();
});

// (fails before: yes — the answer promised "at its next step, while it works" of a worker that takes no step until the
// developer answers its call: HarnessV3-TaskGraph-v2 TG2-D36, seen in V2-0b's drive)
test("a message to a worker that waits for the developer's answer says so: its next step comes after that answer", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir);
  const { id, r } = await running(w, l);
  const gone = new AbortController();
  const asked = w.registry.ask(id, { tool: "bash", args: "node -p 1", question: "May I run this command? `node -p 1`" }, { signal: gone.signal });
  const told = await l.tools.worker(l.call({ agent_id: id, prompt: "Skip that check." }));
  assert.deepEqual(
    [told.ok, told.text, told.note],
    [
      true,
      `Sent to builder ${id}: it waits for the developer's answer on a bash call (ask 1) now, and reads your message at its next step after that answer. Its report still arrives as a message when it finishes.`,
      `agent: a message to builder ${id} (m-lead), read at its next step — after the developer's answer on the bash call it waits for (ask 1)`,
    ],
  );
  assert.deepEqual(w.steers.at(-1), { runId: r.runId, kind: "note", text: "Skip that check.", from: "lead" }, "it is sent all the same");
  // The answer came, or the question went: the plain words again.
  gone.abort();
  assert.equal(await asked, null);
  const after = await l.tools.worker(l.call({ agent_id: id, prompt: "Carry on." }));
  assert.equal(after.text, `Sent to builder ${id}: it reads your message at its next step, while it works. Its report still arrives as a message when it finishes.`);
  r.finish({ status: "done", report: "FIXED" });
  await w.registry.settled(id);
  l.door.close();
});

// (fails before: yes — HarnessV4_Tasks decision 10: the developer reached a working worker only through its lead, and
// the registry had no way for their words to go past it)
test("the developer's own words to a working worker go into its run as theirs, and its lead is told whom they told what — at its wait, said as no report; refused in words, its lead hears nothing", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir);
  const { id, r } = await running(w, l);
  const woke = l.door.inbox.arrival();
  const out = w.registry.developerMessage(id, { chainId: "c1", text: "  Use the v2 API.\nAnd keep the old export.  " });
  assert.deepEqual(out, { ok: true, asking: null, ask: null, lead: false, told: "turn" });
  assert.deepEqual(w.steers.at(-1), { runId: r.runId, kind: "note", text: "Use the v2 API.\nAnd keep the old export.", from: "harness" }, "its run reads them as the developer's");
  assert.equal(await woke, "told", "a lead's wait wakes, and hears it is no report");
  const [d] = l.door.inbox.take();
  assert.deepEqual([d.kind, d.from, d.description], ["told", id, "Fix the parser"]);
  assert.equal(d.text, `[Filament: the developer wrote to your builder ${id} ("Fix the parser") directly, past you:\nUse the v2 API.\nAnd keep the old export.\n\nIt reads that at its next step as their own message, so you need not pass it on: weigh it in what you tell ${id} from now on.]`);
  // Refused: the words go nowhere, and its lead hears nothing.
  assert.deepEqual(w.registry.developerMessage(id, { chainId: "c1", text: " " }), { ok: false, error: "a message needs words" });
  assert.deepEqual(w.registry.developerMessage(id, { chainId: "c2", text: "x" }), { ok: false, error: noSuchSubagent(id) });
  assert.deepEqual(l.door.inbox.take(), []);
  // The lead's turn over, its worker at work still: its lead's next turn opens with the line.
  l.door.close();
  assert.deepEqual(w.registry.developerMessage(id, { chainId: "c1", text: "Log the count." }), { ok: true, asking: null, ask: null, lead: false, told: "queue" });
  const next = leadOf(w.registry, w.dir, { runId: "lead-2" });
  assert.deepEqual(next.door.inbox.take().map((/** @type {any} */ x) => [x.kind, x.text.includes("directly, past you:\nLog the count.\n")]), [["told", true]]);
  r.finish({ status: "done", report: "FIXED" });
  await w.registry.settled(id);
  assert.deepEqual(w.registry.developerMessage(id, { chainId: "c1", text: "x" }), { ok: false, error: `sub-agent ${id} is not running` });
  next.door.close();
});

// (fails before: yes — every message a loop heard was the developer's)
test("a worker's loop reads its lead's message in the lead's words, the developer's in theirs", async () => {
  /** @type {any[]} */
  const bodies = [];
  /** @type {any[]} */
  const queue = [];
  let n = 0;
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
      unattended: "worker",
      call: async (/** @type {any} */ { body }) => {
        bodies.push(structuredClone(body));
        const content = n++ === 0 ? [{ type: "tool_use", id: "r1", name: "read", input: { path: "a.txt" } }] : [{ type: "text", text: "Done." }];
        return { ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null };
      },
      costOf: () => 0,
      runHand: async () => {
        // Both arrive while the read runs: the loop hears them at its next step.
        queue.push({ id: "s1", kind: "note", text: "Keep the old export too.", from: "lead" }, { id: "s2", kind: "note", text: "Stop at the parser.", from: "harness" });
        return "one";
      },
      delegateRead: null,
      mailbox: {
        read: (/** @type {((m: any) => boolean) | undefined} */ pick) => {
          const out = pick ? queue.filter(pick) : [...queue];
          for (const m of out) queue.splice(queue.indexOf(m), 1);
          return out;
        },
      },
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
  assert.deepEqual(texts, [
    "Message from the developer, relayed by Filament (1 message). Acknowledge what you heard in your next reply before acting on it:\n- Stop at the parser.",
    "Message from your team's lead, relayed by Filament (1 message). Acknowledge what you heard in your next reply before acting on it:\n- Keep the old export too.",
  ]);
  assert.ok(out.notes.includes("agent: 2 steering message(s) delivered at the round boundary (1 from the team's lead)"), out.notes.join("\n"));
});

// (fails before: yes — worker could not stop a worker, and a stopped one's report said the developer stopped it)
test("stop: the lead's stop reaches its worker's run, and the report says it stopped as the lead asked", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir);
  const { id, r } = await running(w, l);
  const stop = await l.tools.worker(l.call({ agent_id: id, stop: true }));
  assert.deepEqual([stop.ok, stop.text, stop.note], [true, `Stopping builder ${id} now; its report so far arrives as a message.`, `agent: stopped builder ${id}`]);
  assert.deepEqual(w.steers, [{ runId: r.runId, kind: "stop", text: "", from: "lead" }]);
  r.finish({ status: "stopped", report: "(Filament: your team's lead stopped this task after 1 tool call.)", stoppedBy: "lead" });
  await w.registry.settled(id);
  const [d] = l.door.inbox.take();
  assert.ok(d.text.startsWith(`[Filament: your builder ${id} ("Fix the parser") was stopped as you asked. You asked it:`), d.text);
  const again = await l.tools.worker(l.call({ agent_id: id, stop: true }));
  assert.deepEqual([again.ok, again.text], [false, `Nothing stopped: builder ${id} is not running.`]);
  l.door.close();
});

// (fails before: yes — the lead heard its worker "was cut off before it finished (stopped before it finished)")
test("a stop before the worker's run exists cuts its request, and the lead hears it was stopped as it asked", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir);
  const launched = await l.tools.agent(l.call(BRIEF));
  const id = String(launched.agentId);
  await w.run(1);
  const stop = await l.tools.worker(l.call({ agent_id: id, stop: true }));
  assert.deepEqual([stop.ok, stop.text], [true, `Stopping builder ${id} now; its report so far arrives as a message.`]);
  const o = await w.registry.settled(id);
  assert.deepEqual([o?.status, o?.error, w.steers], ["aborted", "stopped before it finished", []], "no run to steer: its request was cut");
  const [d] = l.door.inbox.take();
  assert.ok(d.text.startsWith(`[Filament: your builder ${id} ("Fix the parser") was stopped as you asked. You asked it:`), d.text);
  l.door.close();
});

// (fails before: no — a guard the mutation pass asked for: only the lead's own stop reaches it as one it asked for)
test("the developer's stop of a worker reaches its lead as the developer's — its run's stop, or its request cut before the run", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir);
  const { id, r } = await running(w, l);
  assert.deepEqual(w.registry.stop(id), { ok: true });
  assert.deepEqual(w.steers, [{ runId: r.runId, kind: "stop", text: "", from: "harness" }]);
  r.finish({ status: "stopped", report: "(Filament: the developer stopped this turn after 1 tool call.)", stoppedBy: "harness" });
  await w.registry.settled(id);
  const [d] = l.door.inbox.take();
  assert.ok(d.text.startsWith(`[Filament: your builder ${id} ("Fix the parser") was stopped by the developer. You asked it:`), d.text);
  const second = await l.tools.agent(l.call({ ...BRIEF, description: "Fix the lexer" }));
  const early = String(second.agentId);
  await w.run(2);
  assert.deepEqual(w.registry.stop(early), { ok: true });
  await w.registry.settled(early);
  const [cut] = l.door.inbox.take();
  assert.ok(cut.text.startsWith(`[Filament: your builder ${early} ("Fix the lexer") was cut off before it finished (stopped before it finished). You asked it:`), cut.text);
  l.door.close();
});

// (fails before: yes — the lead's correction (M7-D50) had no way in: worker had no correction)
test("correction: a follow-up to a worker whose work fell short counts its task as corrected by the lead; refused while it works, or without what to fix", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir);
  const { id, r: first } = await running(w, l);
  first.finish({ status: "done", report: "FIXED" });
  await w.registry.settled(id);
  l.door.inbox.take();
  // A plain follow-up marks nothing; the correction after it marks the task it follows: the newest.
  assert.equal((await l.tools.worker(l.call({ agent_id: id, prompt: "Also the lexer." }))).ok, true);
  const r = await w.run(2);
  r.attach();
  r.finish({ status: "done", report: "FIXED, the lexer too" });
  await w.registry.settled(id);
  l.door.inbox.take();
  assert.deepEqual(w.corrected, [], "a follow-up is no correction");
  const bare = await l.tools.worker(l.call({ agent_id: id, correction: true }));
  assert.deepEqual([bare.ok, bare.text], [false, "Nothing sent: a correction needs prompt — what fell short, and what to do instead."]);
  const fix = await l.tools.worker(l.call({ agent_id: id, prompt: "The empty case still throws: fix it.", correction: true }));
  assert.deepEqual(
    [fix.ok, fix.text, fix.note],
    [
      true,
      `Builder ${id} took your correction in the background. Keep working: its report arrives as a message when it finishes, and this turn does not end before it does. To wait for it, call wait.`,
      `agent: a correction to builder ${id} (m-lead) in the background — memory counts its last task as corrected`,
    ],
  );
  assert.deepEqual(w.corrected, [{ chainId: "c1", request: r.runId }], "memory hears which task fell short: its run's request");
  const again = await w.run(3);
  again.attach();
  await until(() => w.registry.get(id)?.runId === again.runId, "the follow-up's run to attach");
  const busy = await l.tools.worker(l.call({ agent_id: id, prompt: "Also the null case.", correction: true }));
  assert.deepEqual([busy.ok, busy.text], [false, `Nothing sent: a correction marks work a worker reported, and builder ${id} is still working — send your message without correction, or wait for its report.`]);
  assert.equal(w.corrected.length, 1);
  again.finish({ status: "done", report: "FIXED, the empty case too" });
  await w.registry.settled(id);
  // Memory that fails to take it: the registry says so, and the follow-up goes on.
  w.failCorrections("disk full");
  const lost = await l.tools.worker(l.call({ agent_id: id, prompt: "And the null case.", correction: true }));
  assert.deepEqual([lost.ok, lost.note], [true, `agent: a correction to builder ${id} (m-lead) in the background — memory marked no outcome of its last task`]);
  assert.deepEqual(w.logs, [`warn sub-agent ${id}: the lead's correction did not reach memory (disk full)`]);
  const last = await w.run(4);
  last.attach();
  last.finish({ status: "done", report: "FIXED, the null case too" });
  await w.registry.settled(id);
  l.door.close();
});

// (fails before: yes — worker took no stop and no correction, so neither was refused in words)
test("what worker refuses: a message or a stop to the developer's own sub-agent, a stop with words, and a correction with an apply", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir);
  const mine = await w.registry.launch({ origin: "owner", chainId: "c1", prompt: "Look around", description: "Look around" });
  assert.equal(mine.ok, true);
  const theirs = mine.ok ? mine.id : "";
  const r = await w.run(1);
  r.attach();
  await until(() => w.registry.get(theirs)?.runId === r.runId, "its run to attach");
  const told = await l.tools.worker(l.call({ agent_id: theirs, prompt: "Look harder." }));
  const why = `${theirs} is the developer's sub-agent, not one of your workers — theirs to message or stop; you can follow up on it once it reports`;
  assert.deepEqual([told.ok, told.text], [false, `Nothing sent: ${why}.`]);
  const stopped = await l.tools.worker(l.call({ agent_id: theirs, stop: true }));
  assert.deepEqual([stopped.ok, stopped.text], [false, `Nothing stopped: ${why}.`]);
  assert.deepEqual(w.steers, []);
  r.finish({ status: "done", report: "LOOKED" });
  await w.registry.settled(theirs);
  const { id, r: built } = await running(w, l, 2);
  const worded = await l.tools.worker(l.call({ agent_id: id, stop: true, prompt: "You took too long." }));
  assert.deepEqual([worded.ok, worded.text], [false, "Nothing done: stop takes no prompt — stop the worker, then brief the task again once it reports."]);
  built.finish({ status: "done", report: "FIXED" });
  await w.registry.settled(id);
  const both = await l.tools.worker(l.call({ agent_id: id, apply_changes: true, correction: true }));
  assert.deepEqual([both.ok, both.text], [false, "Nothing done: correction goes with a follow-up's prompt, never with apply_changes."]);
  l.door.close();
});

// (fails before: yes — the registry kept nothing of a run's progress, so the watch had none of these words)
test("the watch's other words: a context whose window is not known, one compaction — the developer's, or at its line — and none for a Compact that folded nothing; a tool with no arguments; the session's workers alone, oldest first", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir);
  const { id: first, r: r1 } = await running(w, l, 1);
  const { id: second, r: r2 } = await running(w, l, 2);
  // The developer's own sub-agent runs too: the watch is the lead's, of its workers.
  const mine = await w.registry.launch({ origin: "owner", chainId: "c1", prompt: "Look around", description: "Look around" });
  assert.equal(mine.ok, true);
  const r3 = await w.run(3);
  r3.attach();
  for (const e of [
    { type: "round-start", round: 2, blocksBefore: 0, context: 5000 },
    { type: "turn-state", from: "planning", to: "acting", why: "1 tool call" },
    { type: "tool-start", round: 2, name: "glob", args: "", id: "t1" },
    { type: "compaction", round: 2, fromRound: 1, toRound: 1, tokensBefore: 9000, tokensAfter: 2000, by: "m-cheap", manual: true },
  ])
    w.registry.relay(first, e);
  for (const e of [
    { type: "round-start", round: 3, blocksBefore: 0, context: 0 },
    { type: "compacting", round: 3 },
    { type: "compaction", round: 3, fromRound: 1, toRound: 2, tokensBefore: 9000, tokensAfter: 2000 },
    { type: "compaction", round: 3, manual: true, result: "little" },
  ])
    w.registry.relay(second, e);
  assert.equal(
    l.tools.watch({ chainId: "c1" }).text,
    [
      "Workers still running (2):",
      `- builder ${first} ("Fix the parser"): round 2 · last tool glob · context ≈5,000 tokens · compacted once, at round 2 (on the developer's request, summarized by m-cheap)`,
      `- builder ${second} ("Fix the parser"): round 3 · compacted once, at round 3 (at its compaction line)`,
    ].join("\n"),
  );
  assert.deepEqual(l.tools.watch({ chainId: "c2" }), { text: "No worker is running now.", workers: [] }, "another session's workers are not this lead's");
  for (const [id, r] of /** @type {[string, any][]} */ ([[first, r1], [second, r2], [mine.ok ? mine.id : "", r3]])) {
    r.finish({ status: "done", report: "DONE" });
    await w.registry.settled(id);
  }
  l.door.close();
});

// (fails before: yes — worker took no stop and no correction and reached no running worker, so none of these was
// refused in words)
test("what worker refuses, too: stop with apply_changes, correction with stop, a stop of no sub-agent, the session's agent's own sub-agent, a correction to a sub-agent that is no worker, and a message longer than a mailbox holds", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir);
  const nobody = await l.tools.worker(l.call({ agent_id: "sa_00000000", stop: true }));
  assert.deepEqual([nobody.ok, nobody.text, nobody.note], [false, `Nothing stopped: ${noSuchSubagent("sa_00000000")}.`, `agent: a stop of sa_00000000 stopped nothing — ${noSuchSubagent("sa_00000000")}`]);
  // Another session's sub-agent is no sub-agent of this one: a lead never stops it.
  const far = await w.registry.launch({ origin: "owner", chainId: "c2", prompt: "Look elsewhere", description: "Look elsewhere" });
  const farId = far.ok ? far.id : "";
  const farRun = await w.run(1);
  farRun.attach();
  await until(() => w.registry.get(farId)?.runId === farRun.runId, "its run to attach");
  const notHere = await l.tools.worker(l.call({ agent_id: farId, stop: true }));
  assert.deepEqual([notHere.ok, notHere.text], [false, `Nothing stopped: ${noSuchSubagent(farId)}.`]);
  farRun.finish({ status: "done", report: "LOOKED ELSEWHERE" });
  await w.registry.settled(farId);
  const agents = await w.registry.launch({ origin: "agent", chainId: "c1", prompt: "Look around", description: "Look around", background: true });
  assert.equal(agents.ok, true);
  const its = agents.ok ? agents.id : "";
  const r = await w.run(2);
  r.attach();
  await until(() => w.registry.get(its)?.runId === r.runId, "its run to attach");
  const why = `${its} is a sub-agent the session's agent launched before you led it, not one of your workers — the developer's to message or stop; you can follow up on it once it reports`;
  const told = await l.tools.worker(l.call({ agent_id: its, prompt: "Look harder." }));
  assert.deepEqual([told.ok, told.text], [false, `Nothing sent: ${why}.`]);
  const stopped = await l.tools.worker(l.call({ agent_id: its, stop: true }));
  assert.deepEqual([stopped.ok, stopped.text], [false, `Nothing stopped: ${why}.`]);
  r.finish({ status: "done", report: "LOOKED" });
  await w.registry.settled(its);
  const corrected = await l.tools.worker(l.call({ agent_id: its, prompt: "Look at the lexer too.", correction: true }));
  assert.deepEqual([corrected.ok, corrected.text], [false, `Nothing sent: a correction marks your workers' work, and ${its} is a sub-agent the session's agent launched before you led it — follow up without correction.`]);
  assert.deepEqual([w.steers, w.corrected], [[], []]);
  const { id, r: built } = await running(w, l, 3);
  const both = await l.tools.worker(l.call({ agent_id: id, stop: true, apply_changes: true }));
  assert.deepEqual([both.ok, both.text], [false, "Nothing done: stop and apply_changes are two calls — stop the worker now, and apply its changes once it reports."]);
  const halted = await l.tools.worker(l.call({ agent_id: id, stop: true, correction: true }));
  assert.deepEqual([halted.ok, halted.text], [false, "Nothing done: correction goes with a follow-up's prompt, never with stop."]);
  assert.deepEqual(w.steers, [], "nothing reached its run");
  // (fails before: yes — B3: a message over 4,000 characters was refused, "say it in fewer words")
  const long = await l.tools.worker(l.call({ agent_id: id, prompt: "x".repeat(12_000) }));
  assert.deepEqual([long.ok, w.steers.length, /** @type {any} */ (w.steers[0])?.text.length], [true, 1, 12_000], "a long message goes whole");
  built.finish({ status: "done", report: "FIXED" });
  await w.registry.settled(id);
  l.door.close();
});

// (fails before: yes — worker refused a running worker, its report first, so no message was carried or held)
test("a message nobody can carry: with no run log a running worker cannot be reached, and a held message its run's mailbox refuses is logged", async () => {
  const bare = watched({ logless: true });
  const lb = leadOf(bare.registry, bare.dir);
  const { id: lone, r: lr } = await running(bare, lb);
  const unheard = await lb.tools.worker(lb.call({ agent_id: lone, prompt: "Keep the old export too." }));
  assert.deepEqual([unheard.ok, unheard.text], [false, "Nothing sent: Filament keeps no run log here, so a running sub-agent cannot be reached."]);
  lr.finish({ status: "done", report: "FIXED" });
  await bare.registry.settled(lone);
  lb.door.close();
  const w = watched();
  const l = leadOf(w.registry, w.dir);
  const launched = await l.tools.agent(l.call(BRIEF));
  const id = String(launched.agentId);
  const r = await w.run(1);
  assert.equal((await l.tools.worker(l.call({ agent_id: id, prompt: "Keep the old export too." }))).ok, true, "held for its run");
  w.refuseSteers("the run's mailbox is full");
  r.attach();
  await until(() => w.registry.get(id)?.runId === r.runId, "its run to attach");
  assert.deepEqual(w.logs, [`warn sub-agent ${id}: a message held for its run did not reach it (the run's mailbox is full)`]);
  const full = await l.tools.worker(l.call({ agent_id: id, prompt: "And log the count." }));
  assert.deepEqual([full.ok, full.text], [false, "Nothing sent: the run's mailbox is full."]);
  // The registry's own refusals, for any caller: another session's, words missing, a run over.
  assert.deepEqual(w.registry.message(id, { chainId: "c2", text: "x", from: "lead" }), { ok: false, error: noSuchSubagent(id) });
  assert.deepEqual(w.registry.message(id, { chainId: "c1", text: "  ", from: "lead" }), { ok: false, error: "a message needs words" });
  r.finish({ status: "done", report: "FIXED" });
  await w.registry.settled(id);
  assert.deepEqual(w.registry.message(id, { chainId: "c1", text: "x", from: "lead" }), { ok: false, error: `sub-agent ${id} is not running` });
  l.door.close();
});

// (fails before: yes — worker had no correction)
test("a correction to a task that never ran marks nothing, and the record says so: memory hears only of work a worker did", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir);
  const launched = await l.tools.agent(l.call(BRIEF));
  const id = String(launched.agentId);
  (await w.run(1)).refuse("REFUSED BEFORE IT STARTED");
  await w.registry.settled(id);
  assert.equal(w.registry.get(id)?.status, "failed");
  l.door.inbox.take();
  const fix = await l.tools.worker(l.call({ agent_id: id, prompt: "Try again, on the parser alone.", correction: true }));
  assert.deepEqual([fix.ok, fix.note], [true, `agent: a correction to builder ${id} (m-lead) in the background — memory marked no outcome of its last task`]);
  assert.deepEqual(w.corrected, [], "its task made no request to count");
  const again = await w.run(2);
  again.attach();
  again.finish({ status: "done", report: "FIXED" });
  await w.registry.settled(id);
  l.door.close();
});
