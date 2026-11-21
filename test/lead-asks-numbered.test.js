// @ts-check
// HarnessV3-TaskGraph-v2 TG2-D42: the answer names the question it answers. A worker's questions are numbered over its
// whole life — ask 1, ask 2, and a follow-up's next — and its lead's look and watch say the number. A lead that reads
// along answers with it: an answer to a question that is settled, or never was, does nothing and says the one the
// worker waits on now, which still waits — so a yes meant for one call never runs the next. The registry checks the
// number too, and so does the session's answer route.
import { test } from "node:test";
import assert from "node:assert/strict";
import { leadOf, running, watched } from "./helpers/team.js";
import { until } from "./helpers/wait.js";

const Q1 = { tool: "bash", args: "npm test", question: "May I run this command? `npm test`" };
const Q2 = { tool: "bash", args: "node --test test/money.test.js", question: "May I run this command? `node --test test/money.test.js`" };

/** A worker of a lead that reads along, running, and the lead's worker call. */
const setUp = async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir, { looks: 30 });
  const { id, r } = await running(w, l);
  /** @param {any} input */
  const as = (input) => l.tools.worker(l.call({ agent_id: id, ...input }));
  const ask = (/** @type {any} */ q) => w.registry.ask(id, q, { signal: new AbortController().signal });
  return { w, l, id, r, as, ask };
};

// (fails before: yes — a question had no number, and its look said none)
test("a worker's questions are numbered over its whole life, a follow-up's included, and its lead's look and watch say the number", async () => {
  const { w, l, id, r, ask } = await setUp();
  const first = ask(Q1);
  assert.equal(w.registry.get(id)?.progress?.asking?.n, 1);
  assert.match(l.tools.watch({ chainId: "c1" }).text, /: starting · waiting for the developer's answer \(ask 1\) — may it run bash `npm test`\?$/);
  // Its number rides the event as `ask` (TG2-D49's build): the run log numbers every event `n`, over a payload's.
  assert.deepEqual(l.timeline.at(-1), { type: "subagent-ask", agentId: id, tool: "bash", args: "npm test", question: Q1.question, ask: 1, round: 2, parent: "toolu_1" });
  assert.deepEqual(w.registry.answer(id, "c1", "yes"), { ok: true, tool: "bash" });
  await first;
  const second = ask(Q2);
  assert.equal(w.registry.get(id)?.progress?.asking?.n, 2, "its next question is ask 2");
  w.registry.answer(id, "c1", "yes");
  await second;
  // Its follow-up goes on counting: a number names one question for the whole of a worker's life.
  r.finish({ status: "done", report: "DONE" });
  await until(() => w.registry.get(id)?.status === "done", "its report");
  const again = await l.tools.worker(l.call({ agent_id: id, prompt: "Run the slow tests too." }));
  assert.equal(again.ok, true, again.text);
  const r2 = await w.run(2);
  r2.attach();
  await until(() => w.registry.get(id)?.runId === r2.runId, "its follow-up's run");
  const third = ask(Q1);
  assert.equal(w.registry.get(id)?.progress?.asking?.n, 3);
  w.registry.answer(id, "c1", "yes");
  await third;
  l.door.close();
});

// (fails before: yes — answer went alone, and settled whatever waited when it landed)
test("answer goes with ask, the number of the question it answers; ask goes with answer; and the two go alone", async () => {
  const { w, l, id, as, ask } = await setUp();
  const first = ask(Q1);
  // Since TG2-D58 every lead answers its workers' questions, whether a look shows them or its door says them.
  const without = "Nothing answered: answer needs ask, the number the question came with (ask 2) — a worker may ask again before your answer lands, and the number keeps your answer on the question you read.";
  for (const n of [undefined, 0, -1, 1.5, "one", "ask", true]) assert.equal((await as({ answer: "yes", ...(n === undefined ? {} : { ask: n }) })).text, without, `ask ${JSON.stringify(n)}`);
  const noAsk = await as({ answer: "yes" });
  assert.deepEqual([noAsk.ok, noAsk.note], [false, `agent: an answer to ${id} without its ask answered nothing`]);
  assert.equal((await as({ ask: 1, prompt: "Run it." })).text, "Nothing done: ask names the question an answer is for, and goes with answer.");
  assert.equal((await as({ answer: "no", ask: 1, prompt: "Run it." })).text, "Nothing answered: answer and ask go alone, never with prompt — send that as its own worker call.");
  assert.equal((await as({ answer: "no", ask: 1, show_changes: true })).text, "Nothing answered: answer and ask go alone, never with show_changes — send that as its own worker call.");
  assert.equal(w.registry.get(id)?.progress?.asking?.n, 1, "nothing settled it");
  w.registry.answer(id, "c1", "yes");
  await first;
  l.door.close();
});

// (fails before: yes — the answer meant for ask 1 ran the call of ask 2)
test("an answer to a question that is settled, or never was, does nothing and says the one the worker waits on now, which still waits", async () => {
  const { w, l, id, as, ask } = await setUp();
  const none = await as({ answer: "yes", ask: 1 });
  assert.deepEqual([none.ok, none.text], [false, `Nothing answered: builder ${id} is not waiting for an answer.`]);
  const first = ask(Q1);
  w.registry.answer(id, "c1", "no — run only the money tests");
  await first;
  const second = ask(Q2);
  const late = await as({ answer: "yes", ask: 1 });
  assert.deepEqual([late.ok, late.text], [false, `Nothing answered: builder ${id}'s ask 1 is settled: it waits on ask 2 now — may it run bash \`node --test test/money.test.js\`? Answer that one with ask 2, if you mean to.`]);
  assert.equal(late.note, `agent: an answer to ${id} answered nothing — builder ${id}'s ask 1 is settled: it waits on ask 2 now — may it run bash \`node --test test/money.test.js\`? Answer that one with ask 2, if you mean to`);
  const ahead = await as({ answer: "yes", ask: 3 });
  assert.equal(ahead.text, `Nothing answered: builder ${id} has asked no ask 3: it waits on ask 2 — may it run bash \`node --test test/money.test.js\`? Answer that one with ask 2, if you mean to.`);
  assert.equal(w.registry.get(id)?.progress?.asking?.n, 2, "ask 2 still waits");
  // The right number settles it, and the answer names it.
  const yes = await as({ answer: "yes", ask: 2, allow: true });
  assert.deepEqual([yes.ok, yes.text, yes.note], [true, `Answered builder ${id}'s ask 2: yes — its bash call runs now, unless a rule or the session's mode refuses it. Its report still arrives as a message when it finishes.`, `agent: the lead answered builder ${id}'s ask 2 (its bash call): yes`]);
  assert.deepEqual(await second, { text: "yes", modeSwitch: false, allow: true, by: "lead" });
  const settled = await as({ answer: "yes", ask: 2 });
  assert.equal(settled.text, `Nothing answered: builder ${id} is not waiting for an answer: ask 2 is settled.`);
  // Its no names it too — here as the look writes it, which is taken as its number.
  const third = ask(Q1);
  const no = await as({ answer: "no — run only test/money.test.js", ask: "ask 3" });
  assert.equal(no.text, `Answered builder ${id}'s ask 3: no — its bash call is not run, and it reads your words at its next step. Its report still arrives as a message when it finishes.`);
  assert.deepEqual(await third, { text: "no — run only test/money.test.js", modeSwitch: false, by: "lead" });
  l.door.close();
});

// (fails before: yes — the registry settled whatever waited)
test("the registry checks a number it is given: a wrong one settles nothing, and says what waits now; with none it answers what waits, as the developer's page does", async () => {
  const { w, l, id, ask } = await setUp();
  const first = ask(Q1);
  w.registry.answer(id, "c1", "yes");
  await first;
  const second = ask(Q2);
  assert.deepEqual(w.registry.answer(id, "c1", "yes", { n: 1 }), { ok: false, error: `builder ${id}'s ask 1 is settled: it waits on ask 2 now` });
  assert.deepEqual(w.registry.answer(id, "c1", "yes", { n: 5 }), { ok: false, error: `builder ${id} has asked no ask 5: it waits on ask 2` });
  assert.equal(w.registry.get(id)?.progress?.asking?.n, 2);
  assert.deepEqual(w.registry.answer(id, "c1", "yes", { n: 2 }), { ok: true, tool: "bash" });
  assert.deepEqual(await second, { text: "yes", modeSwitch: false });
  assert.deepEqual(w.registry.answer(id, "c1", "yes", { n: 2 }), { ok: false, error: `builder ${id} is not waiting for an answer: ask 2 is settled` });
  assert.deepEqual(w.registry.answer(id, "c1", "yes", { n: 3 }), { ok: false, error: `builder ${id} is not waiting for an answer` });
  l.door.close();
});

// (fails before: yes — the message named the call, not its question's number)
test("a message to a worker that waits names its question's number", async () => {
  const { l, id, as, ask, w } = await setUp();
  const first = ask(Q1);
  assert.match((await as({ prompt: "Use the script." })).text, /: it waits for an answer — the developer's, or yours with answer — on a bash call \(ask 1\) now, and reads your message at its next step after that answer\./);
  w.registry.answer(id, "c1", "yes");
  await first;
  l.door.close();
});
