// @ts-check
// A lead's answer to its worker decides by a field, never by its words (the owner's rule: no behaviour behind words —
// and a lead is a model, whose prose stood in for a yes). The worker tool's `allow: true` runs a worker's waiting call,
// `go: true` lets a worker's plan start; without them the lead's answer refuses the call, or is its corrections to the
// plan, whatever it says. The developer's answer to a worker's plan gives its go the same way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WORKER_READS_TOOL, WORKER_TOOL, loopToolArgs } from "../src/app/agent/tools.js";
import { inputRefusal } from "../src/app/agent/team-tools.js";
import { BRIEF, heldTime, leadOf, running, watched } from "./helpers/team.js";
import { until } from "./helpers/wait.js";

const QUESTION = "May I run this command? `npm test` — answer /allow to run it, or say what to do instead.";
const PLAN = "Files: src/parse.js. Steps: 1. return [] for an empty input. Proof: node --test test/parse.test.js passes.";

// (fails before: yes — the lead's "yes" ran the call, and "go ahead, but only the parser's tests" did not; its words decided)
test("a lead that reads along runs a worker's waiting call with allow: true alone; its words without it refuse the call", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir, { looks: 30 });
  const { id } = await running(w, l);
  const q = { tool: "bash", args: "npm test", question: QUESTION };
  /** @param {any} input */
  const as = (input) => l.tools.worker(l.call({ agent_id: id, ...input }));
  const first = w.registry.ask(id, q, { signal: new AbortController().signal });
  const no = await as({ answer: "yes", ask: 1 });
  assert.match(no.text, /: no — its bash call is not run, and it reads your words at its next step\./);
  assert.equal((await first)?.allow, undefined, "a yes in words runs nothing");
  const second = w.registry.ask(id, q, { signal: new AbortController().signal });
  const yes = await as({ answer: "Run it, but only the parser's tests next time.", allow: true, ask: 2 });
  assert.match(yes.text, /: yes — its bash call runs now, unless a rule or the session's mode refuses it\./);
  assert.equal((await second)?.allow, true, "allow: true runs it, whatever its words say");
  assert.equal(l.timeline.at(-1)?.allowed, true);
  l.door.close();
});

test("allow and go go with answer alone", () => {
  assert.match(String(inputRefusal("worker", { agent_id: "sa_1", allow: true }, { reads: true })?.text), /allow and go go with answer/);
  assert.match(String(inputRefusal("worker", { agent_id: "sa_1", go: true, prompt: "x" }, { reads: true })?.text), /allow and go go with answer/);
  assert.equal(inputRefusal("worker", { agent_id: "sa_1", answer: "fine", allow: true, ask: 1 }, { reads: true }), null);
  assert.equal(inputRefusal("worker", { agent_id: "sa_1", answer: "fine", go: true, ask: 1 }, { reads: true }), null);
});

test("the fields are in every lead's worker tool, and the answer's words promise no yes read from them", () => {
  const tools = [WORKER_READS_TOOL, ...[loopToolArgs({ lead: true, supervise: true })].map((ts) => ts.find((/** @type {any} */ x) => x.name === "worker"))];
  for (const t of tools) {
    const p = /** @type {any} */ (t).input_schema.properties;
    assert.equal(p.allow?.type, "boolean");
    assert.equal(p.go?.type, "boolean");
    assert.doesNotMatch(p.answer.description, /\byes to run\b|\bgo to let\b/);
  }
  assert.equal(/** @type {any} */ (WORKER_TOOL).input_schema.properties.allow, undefined, "a lead that does not read along answers questions alone: no call's permission");
});

// (fails before: yes — "go" in the lead's words lifted the hold, and "go, but…" kept it)
test("a worker's plan starts on go: true alone — the lead's or the developer's; words are corrections", async () => {
  const t = heldTime();
  const w = watched({ runlog: true, now: t.now, later: t.later });
  const l = leadOf(w.registry, w.dir, { looks: 300 });
  const launched = await l.tools.agent(l.call({ ...BRIEF, plan_review: true }));
  const id = String(launched.agentId);
  const r = await w.run(1);
  r.attach();
  await until(() => w.registry.get(id)?.runId === r.runId, "its run to attach");
  const first = w.registry.askLead(id, { question: PLAN, options: [], plan: true });
  const words = await l.tools.worker(l.call({ agent_id: id, answer: "go", ask: 1 }));
  assert.match(words.text, /as no go/);
  assert.equal(/** @type {any} */ (await first).go, false, "\"go\" in words lifts nothing");
  assert.equal(w.registry.planHeld(id), true);
  const second = w.registry.askLead(id, { question: PLAN, options: [], plan: true });
  const go = await l.tools.worker(l.call({ agent_id: id, answer: "Fine — but keep the tests narrow.", go: true, ask: 2 }));
  assert.match(go.text, /: go — it may change files and run commands now\./);
  assert.equal(/** @type {any} */ (await second).go, true);
  assert.equal(w.registry.planHeld(id), false);
  r.finish({ status: "done", report: "DONE" });

  // The developer's go, on another worker's plan.
  const again = await l.tools.agent(l.call({ ...BRIEF, plan_review: true }));
  const id2 = String(again.agentId);
  const r2 = await w.run(2);
  r2.attach();
  await until(() => w.registry.get(id2)?.runId === r2.runId, "its run to attach");
  const third = w.registry.askLead(id2, { question: PLAN, options: [], plan: true });
  assert.deepEqual(w.registry.answer(id2, "c1", "yes, go ahead", { n: 1 }), { ok: true, tool: "ask_lead" });
  assert.equal(/** @type {any} */ (await third).go, false, "their words are corrections");
  const fourth = w.registry.askLead(id2, { question: PLAN, options: [], plan: true });
  assert.deepEqual(w.registry.answer(id2, "c1", "Looks right.", { n: 2, go: true }), { ok: true, tool: "ask_lead" });
  assert.equal(/** @type {any} */ (await fourth).go, true);
  assert.equal(w.registry.planHeld(id2), false);
  r2.finish({ status: "done", report: "DONE" });
  l.door.close();
});
