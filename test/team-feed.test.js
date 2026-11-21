// @ts-check
// HarnessV3-Views V3: what the Team view reads from the server. Every running sub-agent's progress rides the events
// feed as it changes — at once, then at most one each PROGRESS_MS as it stands then, its newest always sent — so the
// view's cards are live without a stream per worker. A worker's launch event names its team and role; its question
// carries the always-allow waiting for the call's shape; the developer's permission switch answers its waiting call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROGRESS_MS } from "../src/app/agent/subagents.js";
import { heldTime, leadOf, running, watched } from "./helpers/team.js";
import { until } from "./helpers/wait.js";

/** @param {ReturnType<typeof watched>} w */
const feedOf = (w) => w.published.filter((p) => p.e.type === "subagent-progress").map((p) => ({ topic: p.topic, ...p.e }));

// (fails before: yes — only a graph task's round and newest tool reached the feed, one message per tool and round; a
// worker's progress never did)
test("a running worker's progress rides the feed: at once, then at most one each 500 ms as it stands then — the newest always sent, none once it ended, each worker on its own clock", async () => {
  assert.equal(PROGRESS_MS, 500);
  const time = heldTime();
  const w = watched({ now: time.now, later: time.later });
  const l = leadOf(w.registry, w.dir);
  const { id, r } = await running(w, l);
  assert.deepEqual(feedOf(w), [], "a launch is the list's news, not the feed's");
  w.registry.relay(id, { type: "round-start", round: 1, blocksBefore: 0, context: 9000 });
  const call = { round: 1, began: 1000, thinking: 0, text: 0, lastAt: null };
  const first = { round: 1, tool: null, context: { tokens: 9000, window: null, usable: null }, compactions: [], words: "", call, wait: null, spent: null, asking: null, check: null, bounce: null };
  assert.deepEqual(feedOf(w), [{ topic: "subagents", type: "subagent-progress", chainId: "c1", id, progress: first }], "the first change goes at once");

  time.to(1100);
  w.registry.relay(id, { type: "tool-start", round: 1, name: "read", args: "src/parse.js", id: "t1" });
  time.to(1200);
  w.registry.relay(id, { type: "round-text", round: 1, text: "Reading the parser.", block: 1 });
  assert.equal(feedOf(w).length, 1, "within 500 ms of the last, nothing goes");
  assert.deepEqual(time.timers.map((t) => t.ms), [400], "one send is set, for when 500 ms have passed");
  // Events that move nothing the cards show set nothing.
  w.registry.relay(id, { type: "tool-end", round: 1, name: "read", ok: true, id: "t1" });
  w.registry.relay(id, { type: "window", window: 128000, usable: 108800 });
  w.registry.relay(id, { type: "compaction", round: 1, stoodDown: true });
  assert.equal(time.timers.length, 1);

  time.to(1500);
  time.timers[0].fn();
  assert.deepEqual(feedOf(w).at(-1)?.progress, { ...first, tool: { name: "read", args: "src/parse.js" }, words: "Reading the parser.", call: null }, "the progress as it stands when the send goes");

  // A second worker's first change goes at once, whatever the first's clock says.
  const second = await running(w, l, 2);
  time.to(1600);
  w.registry.relay(second.id, { type: "round-start", round: 1, blocksBefore: 0 });
  assert.deepEqual(feedOf(w).at(-1)?.id, second.id);
  assert.equal(feedOf(w).length, 3);

  // The first's next change waits for its own 500 ms; it ends before then, and the send goes nowhere.
  w.registry.relay(id, { type: "tool-start", round: 2, name: "bash", args: "npm test", id: "t2" });
  assert.deepEqual(time.timers.map((t) => t.ms), [400, 400]);
  r.finish({ status: "done", report: "Fixed." });
  await until(() => w.registry.get(id)?.status === "done", "the worker to end");
  time.to(2000);
  time.timers[1].fn();
  assert.equal(feedOf(w).length, 3, "an ended exchange sends none: the list carries its end");
  second.r.finish({ status: "done", report: "Done." });
  await until(() => w.registry.get(second.id)?.status === "done", "the second to end");
});

// (fails before: no — a guard the mutation pass asked for: no worker's words here were long, so a whole paragraph
// could have ridden every send of the feed)
test("a running worker's newest words ride its progress on one line, cut to 200 characters", async () => {
  const time = heldTime();
  const w = watched({ now: time.now, later: time.later });
  const l = leadOf(w.registry, w.dir);
  const { id, r } = await running(w, l);
  const text = `Reading the parser.\n\n${"The tokenizer splits on whitespace and keeps the operators. ".repeat(6)}`;
  w.registry.relay(id, { type: "round-text", round: 1, text, block: 1 });
  const said = String(w.registry.get(id)?.progress?.words);
  assert.equal(said.length, 200);
  assert.ok(said.startsWith("Reading the parser. The tokenizer splits on whitespace") && said.endsWith("…"), said);
  assert.equal(feedOf(w).at(-1)?.progress.words, said, "the feed carries the words as the card shows them");
  r.finish({ status: "done", report: "Fixed." });
  await until(() => w.registry.get(id)?.status === "done", "the worker to end");
});

// (fails before: yes — what a running call streamed reached the lead's watch only: the Team view's cards read the
// feed, so a call streaming for minutes and one stuck read alike there; HarnessV3-FailurePoints §5.1 item 1)
test("a running call's streamed counts ride the feed, on the worker's clock", async () => {
  const time = heldTime();
  const w = watched({ now: time.now, later: time.later });
  const l = leadOf(w.registry, w.dir);
  const { id, r } = await running(w, l);
  w.registry.relay(id, { type: "round-start", round: 1, blocksBefore: 0 });
  time.to(1600);
  w.registry.streamed(id, "thinking", 400);
  assert.deepEqual(feedOf(w).at(-1)?.progress.call, { round: 1, began: 1000, thinking: 400, text: 0, lastAt: 1600 });
  r.finish({ status: "done", report: "Fixed." });
  await until(() => w.registry.get(id)?.status === "done", "the worker to end");
});

// The owner's of 11-12: "when the sub agent is running it would be good to know it's token count as well and also at
// what percentage the compaction will start out of it's context window".
// (fails before: yes — a coding agent's own count of its context, `held`, moved nothing: one on Claude Code or Codex
// said no context at all while it ran, where Filament's own loop said its every round's)
test("a coding agent's count of its context rides its progress: against the window it names, else its run's, with the line its run said it makes room at", async () => {
  const time = heldTime();
  const w = watched({ now: time.now, later: time.later });
  const l = leadOf(w.registry, w.dir);
  const { id, r } = await running(w, l);
  // Its run says the window Filament knows for its model and where its agent makes room by itself.
  w.registry.relay(id, { type: "window", window: 1_000_000, source: "agent", usable: 400_000 });
  assert.deepEqual(feedOf(w), [], "a window alone moves nothing the cards show");
  w.registry.relay(id, { type: "held", round: 1, tokens: 136_412, window: 1_000_000, exact: true });
  const held = { tokens: 136_412, window: 1_000_000, usable: 400_000 };
  assert.deepEqual(w.registry.get(id)?.progress?.context, held);
  assert.deepEqual(feedOf(w).at(-1)?.progress.context, held, "the feed carries it at once");
  // An agent that names no window is weighed against its run's; a count that is Filament's estimate says so.
  w.registry.relay(id, { type: "held", round: 2, tokens: 150_000, window: null, exact: false });
  assert.deepEqual(w.registry.get(id)?.progress?.context, { tokens: 150_000, window: 1_000_000, usable: 400_000, estimated: true });
  // The window the agent names is its own, whatever its run said.
  w.registry.relay(id, { type: "held", round: 2, tokens: 151_000, window: 200_000, exact: true });
  assert.deepEqual(w.registry.get(id)?.progress?.context, { tokens: 151_000, window: 200_000, usable: 400_000 });
  // A count of nothing is no count.
  w.registry.relay(id, { type: "held", round: 2, tokens: 0, window: 200_000, exact: true });
  assert.equal(w.registry.get(id)?.progress?.context?.tokens, 151_000);
  r.finish({ status: "done", report: "Fixed." });
  await until(() => w.registry.get(id)?.status === "done", "the worker to end");

  // One whose run said no window and no line: its count alone, and the window its agent names.
  const bare = await running(w, l, 2);
  w.registry.relay(bare.id, { type: "held", round: 1, tokens: 9_000, window: null, exact: true });
  assert.deepEqual(w.registry.get(bare.id)?.progress?.context, { tokens: 9_000, window: null, usable: null });
  w.registry.relay(bare.id, { type: "held", round: 1, tokens: 9_500, window: 200_000, exact: true });
  assert.deepEqual(w.registry.get(bare.id)?.progress?.context, { tokens: 9_500, window: 200_000, usable: null });
  bare.r.finish({ status: "done", report: "Done." });
  await until(() => w.registry.get(bare.id)?.status === "done", "the second to end");
});

// (fails before: yes — a running exchange's spend was known only once it ended)
test("what a running worker has spent rides its progress as each of its calls comes back; the same figure again moves nothing", async () => {
  const time = heldTime();
  const w = watched({ now: time.now, later: time.later });
  const l = leadOf(w.registry, w.dir);
  const { id, r } = await running(w, l);
  w.registry.spent(id, 0.0123);
  assert.equal(w.registry.get(id)?.progress?.spent, 0.0123);
  assert.equal(feedOf(w).at(-1)?.progress.spent, 0.0123, "the first change goes at once");
  w.registry.spent(id, 0.0123);
  assert.equal(time.timers.length, 0, "the same figure again sets no send");
  w.registry.spent(id, 0.02);
  time.to(1500);
  time.timers[0].fn();
  assert.equal(feedOf(w).at(-1)?.progress.spent, 0.02);
  r.finish({ status: "done", report: "Fixed." });
  await until(() => w.registry.get(id)?.status === "done", "the worker to end");
  w.registry.spent(id, 0.03);
  assert.equal(feedOf(w).length, 2, "an ended exchange's figure is its outcome's");
});

// (fails before: yes — a worker's launch event named neither its team nor its role)
test("a worker's launch event names its team and its role, so the lead's order rows read them from the run's events", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir);
  const { id, r } = await running(w, l);
  const start = l.timeline.find((e) => e.type === "subagent-start");
  assert.deepEqual([start?.agentId, start?.team, start?.role, start?.description], [id, "architect", "builder", "Fix the parser"]);
  r.finish({ status: "done", report: "Fixed." });
  await until(() => w.registry.get(id)?.status === "done", "the worker to end");
});

// (fails before: yes — a worker's question carried no always-allow, and an answer was words alone: a permission switch
// could not answer it)
test("a worker's question rides its progress with the always-allow waiting for its call's shape; the developer's answer is their words, or their permission switch", async () => {
  const time = heldTime();
  const w = watched({ now: time.now, later: time.later });
  const l = leadOf(w.registry, w.dir);
  const { id, r } = await running(w, l);
  const offer = { itemId: 7, tool: "bash", shape: "npm test" };
  const asked = w.registry.ask(id, { tool: "bash", args: "npm test", question: "May I run this command?", offer });
  const asking = { tool: "bash", args: "npm test", question: "May I run this command?", offer, n: 1 };
  assert.deepEqual(w.registry.get(id)?.progress?.asking, asking);
  assert.deepEqual(feedOf(w).at(-1)?.progress.asking, asking, "the feed carries the question at once");
  assert.deepEqual(w.registry.answer(id, "c1", "Switched to Full access", { modeSwitch: true }), { ok: true, tool: "bash" });
  assert.deepEqual(await asked, { text: "Switched to Full access", modeSwitch: true });
  assert.equal(w.registry.get(id)?.progress?.asking, null);
  time.to(1500);
  time.timers.at(-1)?.fn();
  assert.equal(feedOf(w).at(-1)?.progress.asking, null, "and that it no longer waits");
  const again = w.registry.ask(id, { tool: "bash", args: "npm test", question: "May I run this command?" });
  assert.deepEqual(w.registry.get(id)?.progress?.asking, { tool: "bash", args: "npm test", question: "May I run this command?", n: 2 }, "no offer stands: none rides it");
  assert.deepEqual(w.registry.answer(id, "c1", " yes "), { ok: true, tool: "bash" });
  assert.deepEqual(await again, { text: "yes", modeSwitch: false });
  r.finish({ status: "done", report: "Fixed." });
  await until(() => w.registry.get(id)?.status === "done", "the worker to end");
});
