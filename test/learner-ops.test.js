// W9: learning runs as durable operations.
//
// `learner.recent` is in-RAM, capped at 100 runs and gone on restart, so "what did the learner do last Tuesday, and
// why did it write nothing" had no answer anywhere. The `learner` op kind existed from the start with no producer, so
// its chip sat dimmed. These tests drive a REAL MemoryLearner over a REAL Archive with a recorder attached — nothing
// about the thing under test is stubbed — and the content-free assertions are the point of the file, because
// ops.jsonl is durable and rendered in the dashboard while `recent` never was.
//
// This lives in its own file rather than being appended to memory-learn.test.js: that file's tests were silently
// reverted twice by a stale editor buffer flushing over the append, and a green run of a file that no longer contains
// the tests is worse than no run at all. A new file has no stale buffer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/archive.js";
import { MemoryLearner } from "../src/memory-learn.js";
import { MemoryBrain } from "../src/services/memory/brain.js";

const fakeStore = () => { const mem = []; return { mem, async remember(o) { mem.push(o); return { id: `m${mem.length}` }; }, async recall() { return []; } }; };

// Two turns: one ordinary, one where the user corrects the assistant. Enough for a title, an end state, two turn
// summaries and several items — every field the operations claim to count.
const seed = (a, key = "k1") => {
  const ch = a.chainForKey(key, { cwd: "C:\\filament", client: "claude-code", model: "m" });
  const t1 = a.beginTurn(ch.id, { requestId: "r1", userMessage: { role: "user", content: "fix the login page crash" } });
  a.finishTurn(t1.turnId, { finalMessage: { role: "assistant", content: "Guarded the null user object in the handler." }, requestId: "r1", outputChars: 40 });
  const t2 = a.beginTurn(ch.id, { requestId: "r2", userMessage: { role: "user", content: "no, don't hand-edit the migration files, use the generator" } });
  a.finishTurn(t2.turnId, { finalMessage: { role: "assistant", content: "Understood, using the generator from now on." }, requestId: "r2", outputChars: 30 });
  return ch;
};

// Four proposed items, of which ingest writes two: one bogus kind and one secret-shaped fact are refused. The gap
// between "proposed" and "written" is the single most useful number a learning run produces. The end state's open item
// is written too, as an open thread (HarnessV3-Memory M5-5); its next item, "commit", is too short to be a claim.
const MODEL_JSON = JSON.stringify({
  title: "Login page crash fix",
  state: { summary: "Guarded the null user; regression tests still to run.", done: ["null guard added"], open: ["run the auth tests"], next: ["commit"] },
  turns: [{ n: 1, summary: "Fixed the crash" }, { n: 2, summary: "User corrected the workflow" }],
  items: [
    { kind: "rule", text: "Never hand-edit the generated migration files; regenerate them instead.", importance: 0.9, turn: 2 },
    { kind: "decision", text: "The login handler guards the null user object before rendering.", importance: 0.75, turn: 1 },
    { kind: "fact", text: "api_key = sk-abcdefghijklmnop should never be learned", importance: 0.9, turn: 1 },
    { kind: "bogus", text: "ignored kind" },
  ],
});

// Every string that must NOT reach a durable operation: the model's proposed title, the end-state summary, a turn
// summary, an item's text, the user's own message, and a secret-shaped value ingest already refuses.
const SECRETISH = [
  "Login page crash fix",
  "Guarded the null user",
  "User corrected the workflow",
  "Never hand-edit the generated migration",
  "fix the login page crash",
  "sk-abcdefghijklmnop",
];

const collect = (learner) => { const seen = []; learner.onOp = (title, opts) => seen.push({ title, ...(opts || {}) }); return seen; };
const scratch = () => { const dir = mkdtempSync(join(tmpdir(), "filament-learnerops-")); return { dir, a: new Archive({ file: join(dir, "a.db") }) }; };
const cfg = () => ({ capture: { learn: true, idleMinutes: 30, dailyCap: 200 } });

test("learnChain reports start, milestone and end, with counts and no conversation text", async () => {
  const { dir, a } = scratch(); const store = fakeStore();
  const learner = new MemoryLearner({ archive: a, brain: new MemoryBrain({ archive: a, store }), callModel: async () => "```json\n" + MODEL_JSON + "\n```", getConfig: cfg });
  const seen = collect(learner);
  const ch = seed(a);

  const out = await learner.learnChain(ch.id, { reason: "idle" });
  assert.equal(out.items, 3, "the run itself behaves exactly as before the observability was added: two items and the open thread");

  const subs = seen.map((o) => o.sub);
  assert.deepEqual(subs, ["start", "milestone", "done"], `one run emits start → milestone → done, got: ${subs.join(" → ")}`);
  assert.ok(seen.every((o) => o.ref?.chainId === ch.id), "every operation is linked to the session it learned from");

  const [start, mile, end] = seen;
  assert.ok(start.detail.chars > 0, "the start says how much text was handed to the model");
  assert.equal(start.detail.estTokens, Math.round(start.detail.chars / 4), "and its token figure is derived from that, not invented");
  assert.equal(start.detail.fromTurn, 1);
  assert.equal(start.detail.toTurn, 2, "the span of turns it read");
  assert.equal(start.detail.reason, "idle", "and why it ran at all — idle timer, compaction, or a manual ask");
  assert.equal(start.detail.dailyCap, 200, "against the cap that could stop it");

  assert.equal(mile.detail.proposed, 4, "the milestone reports what the model PROPOSED, including the two ingest then refused");
  assert.equal(mile.detail.turnSummaries, 2);
  assert.equal(mile.detail.retried, false, "no JSON retry was needed");
  assert.equal(mile.detail.modelCalls, 1);

  assert.equal(end.detail.items, 3, "the end reports what was actually WRITTEN — proposed 4, written 2 and the open thread is the useful difference");
  assert.equal(end.detail.deduped, 0);
  assert.equal(end.detail.titled, true);
  assert.equal(end.detail.state, true);
  assert.equal(end.detail.advanced, true, "the cursor moved, so the next run will not re-read these turns");
  assert.equal(end.detail.capped, false);
  assert.equal(typeof end.ms, "number", "and it carries a duration, which is how a slow summarizer shows up");
  assert.match(end.title, /learned from session .* \(idle\): 3 notes/);

  // The part that matters. This is a durable log rendered in the dashboard, so it carries counts and ids only.
  const flat = JSON.stringify(seen);
  for (const bad of SECRETISH) assert.ok(!flat.includes(bad), `operations must not carry "${bad}" — ops.jsonl is durable`);
  assert.ok(flat.includes(ch.id), "the session id IS carried: it is an id, not content, and it is what makes the row linkable");

  a.close(); rmSync(dir, { recursive: true, force: true });
});

test("a skipped run records why without a start; a failed run records the provider's reason at level error", async () => {
  const { dir, a } = scratch(); const store = fakeStore();
  let fail = false;
  const learner = new MemoryLearner({ archive: a, brain: new MemoryBrain({ archive: a, store }), callModel: async () => { if (fail) throw new Error("cheap model answered HTTP 524"); return MODEL_JSON; }, getConfig: cfg });
  const seen = collect(learner);
  const ch = seed(a);

  await learner.learnChain(ch.id, { reason: "idle" });
  const afterFirst = seen.length;

  // Nothing new since the cursor advanced. This is the commonest outcome of the idle tick and it used to be
  // invisible: the only trace was an in-RAM row that rolled off after 100 runs.
  const skip = await learner.learnChain(ch.id, { reason: "idle" });
  assert.equal(skip.skipped, "nothing new");
  const skipOps = seen.slice(afterFirst);
  assert.deepEqual(skipOps.map((o) => o.sub), ["skip"], "a skip records ONE operation, not a start/end pair");
  assert.match(skipOps[0].title, /skipped — nothing new/, "and names the reason in words");
  assert.equal(skipOps[0].detail.advanced, false, "a skip never claims to have moved the cursor");
  assert.equal(skipOps[0].level, "info", "a skip is normal, not a warning");
  assert.equal(skipOps[0].detail.modelCalls, 0, "and it cost nothing, which is why it is not worth a model call row");

  // The model failing. This is the W8 shape — a 524 from the provider's edge — which until now left behind nothing
  // but a stats counter and a line on stdout that nobody tails.
  fail = true;
  const c2 = seed(a, "k2");
  const before = seen.length;
  const bad = await learner.learnChain(c2.id, { reason: "manual" });
  assert.ok(bad.error, "the run reports its error");
  const errOps = seen.slice(before);
  assert.deepEqual(errOps.map((o) => o.sub), ["start", "error"], "a failed run still shows the start it made");
  assert.equal(errOps[1].level, "error", "and the failure is level error, so the Traffic badge counts it");
  assert.match(errOps[1].title, /failed: cheap model answered HTTP 524/, "the title carries the provider's own reason");
  assert.equal(errOps[1].detail.advanced, false, "a failed run leaves the cursor alone, so those turns are retried later");
  assert.equal(errOps[1].detail.modelCalls, 1);

  a.close(); rmSync(dir, { recursive: true, force: true });
});

test("a run read in passes reports one start, a milestone for each pass and one end, with counts and no conversation text (HarnessV3-Memory M7-D28)", async () => {
  const { dir, a } = scratch(); const store = fakeStore();
  const learner = new MemoryLearner({ archive: a, brain: new MemoryBrain({ archive: a, store }), callModel: async () => MODEL_JSON, getConfig: cfg });
  const seen = collect(learner);
  const ch = seed(a);
  // Two long turns after the two short ones: a turn keeps both ends of 24,000 characters, so the third fills its pass.
  for (const n of [3, 4]) {
    const t = a.beginTurn(ch.id, { requestId: `r${n}`, userMessage: { role: "user", content: `turn ${n}` } });
    a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: "LONGWORK ".repeat(4000) }, requestId: `r${n}` });
  }

  await learner.learnChain(ch.id, { reason: "compaction", door: "manual" });

  const subs = seen.map((o) => o.sub);
  assert.deepEqual(subs, ["start", "milestone", "milestone", "done"], `one run, two passes, got: ${subs.join(" → ")}`);
  const [start, one, two, end] = seen;
  assert.deepEqual([start.detail.fromTurn, start.detail.toTurn, start.detail.passes, start.detail.door], [1, 4, 2, "manual"], "the start says the whole span, its passes and its door");
  assert.match(start.title, /^learning from session .* \(compaction\): turns 1–4$/);
  assert.deepEqual([one.detail.fromTurn, one.detail.toTurn, two.detail.fromTurn, two.detail.toTurn], [1, 3, 4, 4], "each pass's milestone names its turns");
  assert.deepEqual([end.detail.passes, end.detail.advanced, end.detail.door], [2, true, "manual"]);
  assert.equal(a.getChain(ch.id).meta.learnedThrough, 4, "the cursor past every turn read");
  assert.deepEqual([a.getChain(ch.id).meta.lastLearn.passes, a.getChain(ch.id).meta.lastLearn.through], [2, 4]);
  const flat = JSON.stringify(seen);
  for (const bad of [...SECRETISH, "LONGWORK"]) assert.ok(!flat.includes(bad), `operations must not carry "${bad}"`);

  a.close(); rmSync(dir, { recursive: true, force: true });
});

test("a learning run tells the curator its project; a hook that throws is logged and the run stands", async () => {
  const { dir, a } = scratch(); const store = fakeStore();
  /** @type {any[]} */ const logged = [];
  const learner = new MemoryLearner({
    archive: a, brain: new MemoryBrain({ archive: a, store }), getConfig: cfg, log: (lvl, msg) => logged.push([lvl, msg]),
    callModel: async () => JSON.stringify({ items: [{ kind: "convention", text: "Run npm test before every commit in this repo.", importance: 0.7, turn: 1 }] }),
  });
  /** @type {any[]} */ const told = [];
  learner.onLearned = (p) => told.push(p);
  const ch = seed(a);
  await learner.learnChain(ch.id, { reason: "idle" });
  assert.deepEqual(told, [ch.project_id]);
  learner.onLearned = () => { throw new Error("queue full"); };
  const out = await learner.learnChain(ch.id, { reason: "manual", force: true });
  assert.ok(out && !out.error, JSON.stringify(out));
  assert.ok(logged.some(([lvl, msg]) => lvl === "warn" && /the curator could not be told of a learning run \(queue full\)/.test(msg)), JSON.stringify(logged));

  a.close(); rmSync(dir, { recursive: true, force: true });
});

test("a throwing recorder cannot break a learning run, and no recorder at all is fine", async () => {
  const { dir, a } = scratch(); const store = fakeStore();
  const learner = new MemoryLearner({ archive: a, brain: new MemoryBrain({ archive: a, store }), callModel: async () => MODEL_JSON, getConfig: cfg });
  let calls = 0;
  learner.onOp = () => { calls++; throw new Error("disk on fire"); };
  const ch = seed(a);
  const out = await learner.learnChain(ch.id, { reason: "idle" });
  assert.equal(out.items, 3, "the run completed and wrote its items even though every op threw");
  assert.ok(calls >= 3, "and the recorder was still called for each phase");

  const quiet = new MemoryLearner({ archive: a, brain: new MemoryBrain({ archive: a, store }), callModel: async () => MODEL_JSON, getConfig: cfg });
  const c2 = seed(a, "k2");
  const r = await quiet.learnChain(c2.id, { reason: "idle" });
  // k2 holds the same two turns as k1, so its items dedupe against the ones the first learner already wrote. What
  // matters here is that a learner with no recorder completes the same work rather than throwing on a missing hook.
  assert.equal(r.error, undefined, "a learner with observability off still completes");
  assert.equal(r.items + (r.dedupedItems || 0), 3, "and accounts for the same three, written or deduped");
  assert.equal(a.getChain(c2.id).meta.learnedThrough, 2, "and advances its cursor exactly the same way");

  a.close(); rmSync(dir, { recursive: true, force: true });
});
