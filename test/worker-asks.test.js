// @ts-check
// HarnessV3-AtHome P2 step 4: a team's worker asks the developer (AH-O5). In Edit mode a command that changes something
// asks — a Tester's `npm test` among them — and a team's lead has no shell to fall back on. So a worker in a harness
// session waits in place for the developer's answer: Allow runs the call, Always allow in this project is the learned
// permission's offer, and Deny answers it in the developer's words; a stop ends the wait. A sub-agent the session's
// agent launched still refuses, since its launcher can run the command itself, and so does a worker in another client's
// session, where nobody can answer: both in words. A sub-agent the developer launched themselves asks them as a worker
// does (HarnessV4_Tasks E15 step 5, AG-165): they are its launcher, and its thread shows the question. The registry holds the question, the lead's watch shows it, and the session's
// route answers it. HarnessV3-Views V3: the developer's permission switch answers it too, and its question carries the
// always-allow waiting for the call's shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor, unattendedAsk } from "../src/app/agent/tools.js";
import { deferred, leadOf, running, watched } from "./helpers/team.js";
import { shippedCard } from "../src/services/agent-cards.js";
import { until } from "./helpers/wait.js";

// `npm test` asks because the reader cannot tell it only reads, so the question gives the reader's reason (AH-F2).
const QUESTION = "May I run this command? `npm test` — Filament cannot tell that it only reads inside the working folder: of npm, only `npm -v` and `npm --version` are known to only read. Answer /allow to run it, or say what to do instead.";
// What a card shows beside the question (HarnessV3-Views V6-9): the command whole, and the reason apart from it.
const SHOWN = { command: "npm test", reason: "Filament cannot tell that it only reads inside the working folder: of npm, only `npm -v` and `npm --version` are known to only read." };

/**
 * A worker's run that calls bash once — `npm test`, which Edit mode asks about — and then ends, as turn.js hosts a
 * team's worker: `unattended` says whose run it is, and `asker` is the registry's hold on a question, when someone can
 * answer it. `mode` is the mode in force at each call.
 * @param {{ unattended?: false | "subagent" | "worker" | "self", asker?: any, permissions?: any, mailbox?: any, mode?: () => string }} [o]
 */
const workerTurn = async ({ unattended = "worker", asker = null, permissions = null, mailbox = null, mode = () => "edit" } = {}) => {
  /** @type {any[]} */
  const bodies = [];
  /** @type {any[]} */
  const events = [];
  /** @type {string[]} */
  const ran = [];
  let n = 0;
  const out = await runAgentTurn(
    /** @type {any} */ ({
      model: "m",
      messages: [{ role: "user", content: "run the tests" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false }),
      modeNow: mode,
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      unattended,
      asker,
      call: async (/** @type {any} */ { body }) => {
        bodies.push(structuredClone(body));
        const content = n++ === 0 ? [{ type: "tool_use", id: "b1", name: "bash", input: { command: "npm test" } }] : [{ type: "text", text: "Done." }];
        return { ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null };
      },
      costOf: () => 0,
      runHand: async (/** @type {string} */ _name, /** @type {any} */ input) => {
        ran.push(String(input.command));
        return "12 passing";
      },
      delegateRead: null,
      mailbox,
      permissions,
      tree: null,
      onEvent: (/** @type {any} */ e) => events.push(e),
      previewChars: 0,
      sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
      signal: null,
      resume: null,
    }),
  );
  const result = bodies[1]?.messages.at(-1).content.find((/** @type {any} */ b) => b.type === "tool_result" && b.tool_use_id === "b1") || null;
  return { out, events, ran, result };
};

// (fails before: yes — a worker's question was refused: nobody could answer inside a sub-agent)
test("Allow: a worker's call that needs approval waits in place for the developer's answer, its run says what it waits on, and a yes runs it", async () => {
  /** @type {any[]} */
  const asked = [];
  const w = await workerTurn({
    asker: async (/** @type {any} */ q, /** @type {AbortSignal} */ signal) => {
      asked.push({ ...q, signal: signal instanceof AbortSignal });
      return { text: "yes", allow: true };
    },
  });
  assert.equal(w.out.status, "done", JSON.stringify(w.out.notes));
  assert.deepEqual(asked, [{ tool: "bash", args: "npm test", question: QUESTION, ...SHOWN, signal: true }], "the question, and the stop that ends its wait");
  assert.deepEqual(w.ran, ["npm test"]);
  assert.equal(w.result?.is_error, undefined);
  assert.match(String(w.result?.content), /12 passing/);
  assert.deepEqual(w.events.find((e) => e.type === "ask"), { type: "ask", round: 1, kind: "permission", tool: "bash", question: QUESTION, ...SHOWN, waits: true }, "the ask waits: no pause, no answer in a next request");
  const states = w.events.filter((e) => e.type === "turn-state").map((e) => `${e.to}: ${e.why}`);
  const waited = states.indexOf("waiting: the developer's answer — may it run bash `npm test`?");
  assert.ok(waited > 0, states.join("\n"));
  assert.equal(states[waited + 1], "acting: the developer answered", "back to its tools once answered");
  assert.equal(w.out.pause, null);
  assert.ok(w.out.notes.includes("agent: bash waited for the developer's answer"), w.out.notes.join("\n"));
  assert.ok(w.out.notes.includes("agent: the developer allowed bash"));
});

// (fails before: yes — a worker's question was refused before anyone could answer it)
test("Deny: the developer's words answer the call, which does not run", async () => {
  const w = await workerTurn({ asker: async () => ({ text: "no — the suite takes an hour; run only test/parse.test.js" }) });
  assert.equal(w.out.status, "done");
  assert.deepEqual(w.ran, []);
  assert.deepEqual([w.result?.is_error, w.result?.content], [true, 'Not run: the developer declined — "no — the suite takes an hour; run only test/parse.test.js". Weigh that before proposing it again.']);
  const end = w.events.find((e) => e.type === "tool-end" && e.id === "b1");
  assert.equal(end?.declined, true, "the card draws it declined");
  assert.ok(w.out.notes.includes("agent: the developer declined bash"));
});

// (fails before: yes — a worker never asked, so no approval counted towards a learned permission)
test("Always allow in this project: a worker's yes counts towards the learned permission, whose offer reaches the page — and once confirmed, the call runs without asking", async () => {
  /** @type {Set<string>} */
  const confirmed = new Set();
  /** @type {string[]} */
  const counted = [];
  const permissions = {
    allowed: (/** @type {string} */ name, /** @type {any} */ input) => confirmed.has(`${name}: ${input.command}`),
    recordAllow: (/** @type {string} */ name, /** @type {any} */ input) => {
      counted.push(`${name}: ${input.command}`);
      return { shape: { shape: "npm test", text: "bash: npm test", tool: "bash" }, count: 5, offered: { id: "mem_offer" } };
    },
    offered: () => null,
  };
  const first = await workerTurn({ permissions, asker: async () => ({ text: "yes", allow: true }) });
  assert.deepEqual(counted, ["bash: npm test"]);
  assert.deepEqual(first.events.find((e) => e.type === "permission-offer"), { type: "permission-offer", round: 1, tool: "bash", shape: "npm test", count: 5, itemId: "mem_offer" });
  assert.ok(!JSON.stringify(first.out.final).includes("always-allow"), "no closing line: the worker's report is its lead's to read, and the offer is the page's");
  // The developer confirmed the offer (the card's Always allow): the next such call runs on it, and nobody is asked.
  confirmed.add("bash: npm test");
  /** @type {any[]} */
  const asked = [];
  const second = await workerTurn({ permissions, asker: async (/** @type {any} */ q) => (asked.push(q), { text: "yes", allow: true }) });
  assert.deepEqual([asked, second.ran], [[], ["npm test"]]);
  assert.ok(second.out.notes.includes("agent: bash ran on a learned permission"));
});

// (fails before: yes — nothing waited, so nothing could end a wait)
test("a stop ends the wait: the call is not run, and the run ends stopped in its lead's words", async () => {
  const stop = new AbortController();
  /** @type {any[]} */
  const queue = [];
  const mailbox = {
    read: (/** @type {((m: any) => boolean) | undefined} */ pick) => {
      const out = pick ? queue.filter(pick) : [...queue];
      for (const m of out) queue.splice(queue.indexOf(m), 1);
      return out;
    },
    stopSignal: stop.signal,
  };
  const asking = deferred();
  const turn = workerTurn({
    mailbox,
    asker: (/** @type {any} */ _q, /** @type {AbortSignal} */ signal) => {
      asking.resolve();
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve(null), { once: true }));
    },
  });
  await asking.promise;
  queue.push({ id: "s1", kind: "stop", text: "", from: "lead" });
  stop.abort();
  const w = await turn;
  assert.deepEqual([w.out.status, w.out.stoppedBy], ["stopped", "lead"]);
  assert.deepEqual(w.ran, []);
  const last = w.out.work.at(-1);
  assert.deepEqual(last.content.map((/** @type {any} */ b) => [b.tool_use_id, b.content]), [["b1", "Not run: the developer stopped the turn before it ran."]], "the waiting call is answered, so no tool_use stays open");
  assert.match(JSON.stringify(w.out.final), /\(Filament: your team's lead stopped this task after 0 tool calls/);
  assert.ok(w.events.some((e) => e.type === "turn-state" && e.to === "acting" && e.why === "no answer: the wait was cut"));
});

// (fails before: yes — a permission switch reached a waiting worker as words: its call was answered "Not run" in them)
test("a permission switch answers a worker's waiting call: judged again under the mode now in force — Full access runs it, Read-only refuses it, and Edit asks again", async () => {
  let mode = "edit";
  const full = await workerTurn({ mode: () => mode, asker: async () => ((mode = "auto"), { text: "Switched to Full access", modeSwitch: true }) });
  assert.equal(full.out.status, "done", JSON.stringify(full.out.notes));
  assert.deepEqual(full.ran, ["npm test"]);
  assert.match(String(full.result?.content), /12 passing/);
  assert.ok(full.out.notes.includes("agent: the developer switched the mode to auto while bash waited — judged again under it"), full.out.notes.join("\n"));
  assert.ok(!full.out.notes.includes("agent: the developer allowed bash"), "no yes was said: the mode let it run");
  assert.ok(full.events.some((e) => e.type === "turn-state" && e.to === "acting" && e.why === "the developer switched the mode"));

  mode = "edit";
  const readOnly = await workerTurn({ mode: () => mode, asker: async () => ((mode = "read-only"), { text: "Switched to Read only", modeSwitch: true }) });
  assert.deepEqual(readOnly.ran, []);
  assert.equal(readOnly.result?.is_error, true);
  assert.match(String(readOnly.result?.content), /read-only/i);
  assert.equal(readOnly.events.find((e) => e.type === "tool-end" && e.id === "b1")?.refused, true, "the card draws it refused");

  mode = "ask";
  /** @type {any[]} */
  const asked = [];
  const again = await workerTurn({
    mode: () => mode,
    asker: async (/** @type {any} */ q) => {
      asked.push(q.question);
      if (asked.length > 1) return { text: "yes", allow: true };
      mode = "edit";
      return { text: "Switched to Edit", modeSwitch: true };
    },
  });
  assert.deepEqual([asked, again.ran], [[QUESTION, QUESTION], ["npm test"]], "Edit asks about it too: the same question again, and the yes runs it");
  assert.equal(again.events.filter((e) => e.type === "ask").length, 2);
});

// (fails before: yes — a question carried no always-allow: the page offered the turn's newest offer, whatever call it
// was for, and none from an earlier turn)
test("a question carries the always-allow waiting for its call's shape: a worker's in its ask, the session's own in its ask and its pause; none when none waits", async () => {
  const offer = { itemId: 7, tool: "bash", shape: "npm test" };
  /** @param {any} o */
  const permissions = (o) => ({ allowed: () => false, recordAllow: () => null, offered: (/** @type {string} */ name, /** @type {any} */ input) => (name === "bash" && input.command === "npm test" ? o : null) });
  /** @type {any[]} */
  const asked = [];
  const worker = await workerTurn({ permissions: permissions(offer), asker: async (/** @type {any} */ q) => (asked.push(q), { text: "yes", allow: true }) });
  assert.deepEqual(worker.events.find((e) => e.type === "ask"), { type: "ask", round: 1, kind: "permission", tool: "bash", question: QUESTION, ...SHOWN, waits: true, offer });
  assert.deepEqual(asked, [{ tool: "bash", args: "npm test", question: QUESTION, ...SHOWN, offer }]);
  const own = await workerTurn({ unattended: false, permissions: permissions(offer) });
  assert.deepEqual(own.events.find((e) => e.type === "ask"), { type: "ask", round: 1, kind: "permission", tool: "bash", question: QUESTION, ...SHOWN, offer });
  assert.deepEqual([own.out.pause?.kind, own.out.pause?.offer], ["permission", offer], "the pause keeps it, for a page that loads while it waits");
  const none = await workerTurn({ unattended: false, permissions: permissions(null) });
  assert.deepEqual([Object.hasOwn(none.events.find((e) => e.type === "ask"), "offer"), none.out.pause ? Object.hasOwn(none.out.pause, "offer") : null], [false, false]);
});

// (fails before: yes — a worker's refusal named the agent that launched it, which for a lead has no shell to run it)
test("where nobody can answer: a plain sub-agent refuses as before, and a worker in another client's session refuses in its lead's words", async () => {
  // `npm test` asks because the reader cannot tell it only reads, so both refusals give the reader's reason (AH-F2).
  const plain = await workerTurn({ unattended: "subagent" });
  assert.deepEqual(plain.ran, []);
  assert.match(String(plain.result?.content), /^Not run: Filament cannot tell that this command only reads inside the working folder: of npm, only `npm -v` and `npm --version` are known to only read\. It needs the developer's approval in this session, and a sub-agent cannot ask for it\. Say in your report exactly what you would have run and why — the agent that launched you can do it\.$/);
  assert.ok(!plain.events.some((e) => e.type === "ask"));
  const elsewhere = await workerTurn({ unattended: "worker" });
  assert.deepEqual(elsewhere.ran, []);
  // (fails before, for its words: yes — they said nobody could answer a worker's question, where since TG2-D58 its
  // lead answers them: only the approval is out of reach)
  assert.match(String(elsewhere.result?.content), /^Not run: Filament cannot tell that this command only reads inside the working folder: of npm, only `npm -v` and `npm --version` are known to only read\. It needs the developer's approval, and in this session Filament cannot ask them for it\. Say in your report exactly what you would have run and why — your lead will take it to the developer\.$/);
  assert.equal(unattendedAsk("bash", null, "worker"), "Not run: bash needs the developer's approval, and in this session Filament cannot ask them for it. Say in your report exactly what you would have run and why — your lead will take it to the developer.");
  assert.ok(elsewhere.out.notes.includes("agent: bash refused — it needs approval, and nobody can approve a worker's call in this session"), elsewhere.out.notes.join("\n"));
  assert.ok(!/question/.test(String(elsewhere.result?.content)), "nothing that says its questions are out of reach");
});

// (fails before: yes — AG-262: an agent that started by itself was told "the agent that launched you can do it",
// and nobody launched it)
test("an agent that started by itself is refused in words that fit it: nobody is asked, and the developer reads what it would have run in its answer", async () => {
  const self = await workerTurn({ unattended: "self" });
  assert.deepEqual(self.ran, []);
  assert.equal(
    String(self.result?.content),
    "Not run: Filament cannot tell that this command only reads inside the working folder: of npm, only `npm -v` and `npm --version` are known to only read. It needs the developer's approval in this session, and you started by yourself: nobody is asked for you. Say in your answer exactly what you would have run and why — the developer reads it there.",
  );
  assert.ok(!self.events.some((e) => e.type === "ask"), "no question stands anywhere");
  assert.ok(self.out.notes.includes("agent: bash refused — it needs approval, and nobody is asked for an agent that started by itself"), self.out.notes.join("\n"));
  assert.equal(unattendedAsk("bash", null, "self"), "Not run: bash needs the developer's approval in this session, and you started by yourself: nobody is asked for you. Say in your answer exactly what you would have run and why — the developer reads it there.");
});

// (fails before: yes — the registry had no question to hold)
test("the registry holds a worker's question: its progress and its lead's timeline say so, the session's answer settles it, and a stop lets it go", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir);
  const { id } = await running(w, l);
  assert.equal(w.registry.hostOf(id)?.asks, true, "a team's worker in a harness session asks the developer");
  const q = { tool: "bash", args: "npm test", question: QUESTION };
  const answer = w.registry.ask(id, q, { signal: new AbortController().signal });
  assert.deepEqual(w.registry.get(id)?.progress?.asking, { ...q, n: 1 });
  assert.deepEqual(l.timeline.at(-1), { type: "subagent-ask", agentId: id, tool: "bash", args: "npm test", question: QUESTION, ask: 1, round: 2, parent: "toolu_1" });
  assert.match(l.tools.watch({ chainId: "c1" }).text, /: starting · waiting for the developer's answer \(ask 1\) — may it run bash `npm test`\?$/);
  assert.deepEqual(w.registry.answer(id, "c2", "yes"), { ok: false, error: `no sub-agent ${id} in this session` });
  assert.deepEqual(w.registry.answer(id, "c1", "  "), { ok: false, error: "an answer needs words: what to do instead, or the press of Allow with any words" });
  assert.deepEqual(w.registry.answer(id, "c1", " yes ", { allow: true }), { ok: true, tool: "bash" });
  assert.deepEqual(await answer, { text: "yes", modeSwitch: false, allow: true });
  assert.equal(w.registry.get(id)?.progress?.asking, null);
  assert.deepEqual(l.timeline.at(-1), { type: "subagent-ask-end", agentId: id, answered: true, round: 2, parent: "toolu_1" }, "the lead's card stops waiting");
  assert.deepEqual(w.registry.answer(id, "c1", "yes"), { ok: false, error: `builder ${id} is not waiting for an answer` });
  // A stop lets the question go: the wait ends with no answer.
  const cut = new AbortController();
  const unanswered = w.registry.ask(id, q, { signal: cut.signal });
  cut.abort();
  assert.equal(await unanswered, null);
  assert.equal(w.registry.get(id)?.progress?.asking, null);
  assert.deepEqual(l.timeline.at(-1), { type: "subagent-ask-end", agentId: id, answered: false, round: 2, parent: "toolu_1" });
  // A stop that came first: nothing is asked.
  const seen = l.timeline.length;
  const late = w.registry.ask(id, q, { signal: cut.signal });
  assert.deepEqual([l.timeline.length, w.registry.get(id)?.progress?.asking], [seen, null]);
  assert.equal(await late, null);
  l.door.close();
});

// (fails before: yes — a lead had no answer to its worker's question: with nobody at the page the worker stood still;
// HarnessV3-TaskGraph-v2 TG2-D41)
test("a lead that reads along answers its worker's waiting call: its no and its yes, in its own name on its timeline; alone in its call, and only to a worker that waits", async () => {
  const w = watched();
  const l = leadOf(w.registry, w.dir, { looks: 30 });
  const { id } = await running(w, l);
  const q = { tool: "bash", args: "npm test", question: QUESTION };
  /** @param {any} input */
  const as = (input) => l.tools.worker(l.call({ agent_id: id, ...input }));
  const early = await as({ answer: "yes", ask: 1 });
  assert.deepEqual([early.ok, early.text], [false, `Nothing answered: builder ${id} is not waiting for an answer.`]);
  const first = w.registry.ask(id, q, { signal: new AbortController().signal });
  // Alone in its call.
  assert.equal((await as({ answer: "no", ask: 1, prompt: "x" })).text, "Nothing answered: answer and ask go alone, never with prompt — send that as its own worker call.");
  assert.equal((await as({ answer: "no", ask: 1, show_trail: true })).text, "Nothing answered: answer and ask go alone, never with show_trail — send that as its own worker call.");
  assert.equal(w.registry.get(id)?.progress?.asking?.tool, "bash");
  // A message to it while it waits says who may answer: the developer, or the lead (seen in the drive with Opus in the
  // lead's seat, which was told only of the developer's answer).
  assert.match((await as({ prompt: "Use the script." })).text, /: it waits for an answer — the developer's, or yours with answer — on a bash call \(ask 1\) now, and reads your message at its next step after that answer\./);
  // Its no: the call is answered in its words, in its name.
  const no = await as({ answer: "no — run only test/parse.test.js", ask: 1 });
  assert.deepEqual([no.ok, no.text, no.note], [true, `Answered builder ${id}'s ask 1: no — its bash call is not run, and it reads your words at its next step. Its report still arrives as a message when it finishes.`, `agent: the lead answered builder ${id}'s ask 1 (its bash call): no`]);
  assert.deepEqual(await first, { text: "no — run only test/parse.test.js", modeSwitch: false, by: "lead" });
  assert.deepEqual(l.timeline.at(-1), { type: "subagent-ask-end", agentId: id, answered: true, by: "lead", allowed: false, words: "no — run only test/parse.test.js", round: 2, parent: "toolu_1" });
  // Its yes; the developer's answer after it finds nothing waiting.
  const second = w.registry.ask(id, q, { signal: new AbortController().signal });
  const yes = await as({ answer: "yes", ask: 2, allow: true });
  assert.equal(yes.text, `Answered builder ${id}'s ask 2: yes — its bash call runs now, unless a rule or the session's mode refuses it. Its report still arrives as a message when it finishes.`);
  assert.deepEqual(await second, { text: "yes", modeSwitch: false, allow: true, by: "lead" });
  assert.equal(l.timeline.at(-1)?.allowed, true);
  assert.deepEqual(w.registry.answer(id, "c1", "no"), { ok: false, error: `builder ${id} is not waiting for an answer` });
  // A lead that does not read along answers its workers' questions since TG2-D58, never a call's permission: that one
  // stays the developer's, as TG2-D41 gives its yes and no to a lead that reads along alone.
  const third = w.registry.ask(id, q, { signal: new AbortController().signal });
  const plain = await l.tools.worker({ ...l.call({ agent_id: id, answer: "yes", ask: 3 }), reads: false });
  assert.deepEqual([plain.ok, plain.text], [false, `Nothing answered: builder ${id} waits for the developer's answer on its bash call (ask 3) — that one is theirs to answer; you answer the questions your workers ask you.`]);
  assert.equal(w.registry.get(id)?.progress?.asking?.n, 3, "the call still waits for the developer");
  w.registry.answer(id, "c1", "yes", { allow: true });
  await third;
  l.door.close();
});

// (fails before: yes — every answer was the developer's: a lead's yes would have counted towards their learned
// permission, and its no said the developer declined; TG2-D41)
test("its lead's answer reaches a worker's call in its lead's name: a no in its words, a yes that runs it and counts towards no learned permission", async () => {
  const no = await workerTurn({ asker: async () => ({ text: "no — run only test/parse.test.js", by: "lead" }) });
  assert.deepEqual(no.ran, []);
  assert.deepEqual([no.result?.is_error, no.result?.content], [true, 'Not run: your lead declined — "no — run only test/parse.test.js". Weigh that before proposing it again.']);
  assert.ok(no.out.notes.includes("agent: its lead declined bash"), no.out.notes.join("\n"));
  /** @type {string[]} */
  const counted = [];
  const permissions = { allowed: () => false, recordAllow: (/** @type {string} */ name) => (counted.push(name), null), offered: () => null };
  const yes = await workerTurn({ permissions, asker: async () => ({ text: "yes", allow: true, by: "lead" }) });
  assert.deepEqual([yes.ran, counted], [["npm test"], []], "it ran, and counted towards nothing");
  assert.ok(yes.out.notes.includes("agent: its lead allowed bash"), yes.out.notes.join("\n"));
  const states = yes.events.filter((e) => e.type === "turn-state").map((e) => `${e.to}: ${e.why}`);
  assert.ok(states.includes("acting: its lead answered"), states.join("\n"));
  // The developer's yes still counts.
  await workerTurn({ permissions, asker: async () => ({ text: "yes", allow: true }) });
  assert.deepEqual(counted, ["bash"]);
});

// (fails before: yes — a sub-agent the developer launched was refused with nobody asked, while they sat in its thread)
test("who asks: a team's worker and a sub-agent the developer launched, in a harness session; never one the agent launched, nor anyone in another client's session", async () => {
  const w = watched();
  const mine = await w.registry.launch({ origin: "owner", chainId: "c1", prompt: "Look around", description: "Look around" });
  assert.equal(mine.ok, true);
  const r = await w.run(1);
  r.attach();
  assert.equal(w.registry.hostOf(mine.ok ? mine.id : "")?.asks, true, "the developer launched it, and their page can answer");
  r.finish({ status: "done", report: "LOOKED" });
  const typed = await w.registry.launch({ origin: "command", chainId: "c1", prompt: "Look again", description: "Look again" });
  assert.equal(typed.ok, true);
  const rt = await w.run(2);
  rt.attach();
  assert.equal(w.registry.hostOf(typed.ok ? typed.id : "")?.asks, true, "a command is the developer's launch too");
  rt.finish({ status: "done", report: "LOOKED" });
  const agents = await w.registry.launch({ origin: "agent", chainId: "c1", prompt: "Look for it", description: "Look for it" });
  assert.equal(agents.ok, true);
  const ra = await w.run(3);
  ra.attach();
  assert.equal(w.registry.hostOf(agents.ok ? agents.id : "")?.asks, false, "the session's agent launched it, and can run the command itself");
  ra.finish({ status: "done", report: "LOOKED" });
  const z = watched({ client: "opencode" });
  const theirs = await z.registry.launch({ origin: "owner", chainId: "c1", prompt: "Look around", description: "Look around" });
  assert.equal(theirs.ok, true);
  const rz = await z.run(1);
  rz.attach();
  assert.equal(z.registry.hostOf(theirs.ok ? theirs.id : "")?.asks, false, "no page answers in another client's session, whoever launched it");
  rz.finish({ status: "done", report: "LOOKED" });
  const lz = leadOf(z.registry, z.dir);
  const { id } = await running(z, lz, 2);
  assert.equal(z.registry.hostOf(id)?.asks, false, "nobody can answer in another client's session");
  lz.door.close();
});

// (fails before: yes — AG-262: a card that started by itself waited for "the developer's answer" on a command, for
// as long as nobody looked at a thread nobody had opened, and its finished work was held back meanwhile)
test("one Filament started itself asks nobody; what the developer then writes into its thread is theirs to answer", async () => {
  const s = watched({ card: (/** @type {string} */ tag) => shippedCard(tag) });
  const started = await s.registry.launch({ origin: "self", chainId: "c1", as: "reviewer", prompt: "Look at the report again", description: "Turn 1's report", why: "the report of turn 1" });
  assert.equal(started.ok, true, JSON.stringify(started));
  const id = started.ok ? started.id : "";
  const r1 = await s.run(1);
  r1.attach();
  assert.deepEqual([s.registry.hostOf(id)?.asks, s.registry.hostOf(id)?.self], [false, true], "in a harness session too: nobody called it");
  r1.finish({ status: "done", report: "EXPLAINED" });
  await until(() => s.registry.get(id)?.status === "done", "its answer");
  const more = s.registry.followUp(id, { chainId: "c1", prompt: "And why was that wrong?" });
  assert.equal(more.ok, true, JSON.stringify(more));
  const r2 = await s.run(2);
  r2.attach();
  assert.deepEqual([s.registry.hostOf(id)?.asks, s.registry.hostOf(id)?.self], [true, false], "the developer wrote this message, and their page can answer");
  r2.finish({ status: "done", report: "BECAUSE" });
});
