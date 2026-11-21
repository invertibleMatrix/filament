// @ts-check
// While Parallelize tasks is off, a sub-agent the chat's agent launches that may change files waits for the person's
// yes on a card (app/agent/held-launch.js, the owner's of 11-14): the call answers at once that it is held; launches
// that come while the card waits join it, its countdown starting over; Accept starts them, and the agent hears which;
// One at a time keeps the work with the agent, and a further writing launch of that turn is refused in words; with no
// answer in 60 s the card answers itself — Accept wherever each would work (the owner's choice of 11-14), only one with
// no model known staying the agent's; a turn that ends first starts nothing. Never held: a reviewer, a follow-up, a lead's worker, a saved agent
// the person named, and any launch while the switch is on.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeDirs, until } from "./helpers/wait.js";
import { ALWAYS_WORDS, HOLD_MS, ONE_AT_A_TIME_WORDS, answerWords, createHolds, heldWords } from "../src/app/agent/held-launch.js";
import { createLaunchTurn } from "../src/app/agent-launch.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";

/** A clock and timers in the test's hands. */
function fakeTime() {
  const t = { now: 1_000, timers: /** @type {{ at: number, fn: () => void, off: boolean }[]} */ ([]) };
  return {
    t,
    now: () => t.now,
    later: (/** @type {() => void} */ fn, /** @type {number} */ ms) => {
      const h = { at: t.now + ms, fn, off: false };
      t.timers.push(h);
      return h;
    },
    cancel: (/** @type {any} */ h) => {
      if (h) h.off = true;
    },
    /** @param {number} ms */
    async pass(ms) {
      t.now += ms;
      for (const h of t.timers.filter((x) => !x.off && x.at <= t.now)) {
        h.off = true;
        h.fn();
      }
      await new Promise((r) => setImmediate(r));
    },
  };
}

/** A card store over a fake clock, what it published and what it told. */
function cards() {
  const time = fakeTime();
  /** @type {any[]} */ const published = [];
  /** @type {[string, string][]} */ const told = [];
  let n = 0;
  const holds = createHolds({ now: time.now, later: time.later, cancel: time.cancel, publish: (h) => published.push(h), tell: (c, text) => told.push([c, text]), newId: () => `hl_${++n}` });
  return { holds, time, published, told };
}
/** @param {string} description @param {string} [declines] */
const view = (description, declines = "") => ({ description, kind: "builder", model: "m-sub", where: /** @type {const} */ ("copy"), declines });

describe("the card", () => {
  test("a held launch makes a card that waits 60 s; one more joins it and its countdown starts over", async () => {
    const { holds, time, published } = cards();
    const a = holds.hold("c1", { runId: "r1", turn: 3, view: view("Fix the parser"), start: () => ["sa_1"] });
    assert.equal(HOLD_MS, 60_000);
    assert.deepEqual([a.id, a.state, a.at, a.until, a.turn, a.onTimeout, a.launches.length], ["hl_1", "waiting", 1_000, 61_000, 3, "accept", 1]);
    await time.pass(30_000);
    const b = holds.hold("c1", { runId: "r1", view: view("Fix the lexer"), start: () => ["sa_2"] });
    assert.equal(b.id, "hl_1", "one card for the chat while it waits");
    assert.deepEqual(b.launches.map((l) => [l.n, l.description]), [[1, "Fix the parser"], [2, "Fix the lexer"]]);
    assert.equal(b.until, 31_000 + HOLD_MS, "its countdown starts over");
    assert.equal(published.length, 2);
    assert.equal(holds.hold("c2", { runId: "r9", view: view("Elsewhere"), start: () => [] }).id, "hl_2", "another chat's is its own");
  });

  // (fails before: yes — the review of 11-14: one launch that could not start kept every launch on its card with the
  // agent at the timeout, those its call had told would start by themselves too)
  test("unanswered, a card starts by itself each launch with a model known, and keeps with the agent only the one with none", async () => {
    const { holds, told, time } = cards();
    /** @type {string[]} */ const kept = [];
    holds.hold("c1", { runId: "r1", view: view("Fix the parser"), start: () => ["sa_1"] });
    const h = holds.hold("c1", { runId: "r1", view: view("Fix the lexer", "no model is named for it"), start: () => ["sa_2"], declined: (by) => void kept.push(by) });
    assert.deepEqual([h.onTimeout, h.why], ["some", "no model is named for it"]);
    await time.pass(HOLD_MS);
    const [v] = holds.list("c1");
    assert.deepEqual([v.state, v.by, v.started, v.launches.map((l) => !!l.kept), kept], ["accepted", "timeout", ["sa_1"], [false, true], ["timeout"]]);
    assert.equal(told.at(-1)?.[1], "No answer on the card in 60 seconds, so Filament started those with a model known: “Fix the parser” as sa_1 runs; its report comes as a message. “Fix the lexer” (no model is named for it) did not start: do it yourself, in order.");
  });

  test("Parallelize tasks turned on while it waited: its clock starts every launch, the person's yes given", async () => {
    const time = fakeTime();
    let on = false;
    const holds = createHolds({ now: time.now, later: time.later, cancel: time.cancel, consented: () => on, newId: () => "hl_1" });
    holds.hold("c1", { runId: "r1", view: view("Fix the docs", "no model is named for it"), start: () => ["sa_1"] });
    on = true;
    await time.pass(HOLD_MS);
    assert.deepEqual([holds.list("c1")[0].state, holds.list("c1")[0].started], ["accepted", ["sa_1"]]);
  });

  test("an Accept still starting keeps the turn owed; the turn's end then starts no more; a question let go ends any turn's card", async () => {
    const { holds } = cards();
    /** @type {(ids: string[]) => void} */
    let first = () => {};
    let second = 0;
    holds.hold("c1", { runId: "r1", view: view("Fix the parser"), start: () => new Promise((r) => (first = r)) });
    /** @type {string[]} */ const let_go = [];
    holds.hold("c1", { runId: "r1", view: view("Fix the lexer"), start: () => (second++, ["sa_2"]), declined: (by) => void let_go.push(by) });
    const answered = holds.answer("c1", "hl_1", "accept", "person");
    assert.ok(holds.owed("c1"), "owed while it starts what it held");
    holds.stop("c1", "r1");
    first(["sa_1"]);
    const r = await answered;
    assert.ok(r.ok);
    assert.deepEqual([second, r.hold.started, r.hold.failed], [0, ["sa_1"], ["“Fix the lexer” (the turn ended first)"]]);
    // (fails before: yes — the hunt of this change: what the unstarted one took, a coding agent's task, stayed taken)
    assert.deepEqual(let_go, ["stop"], "the one never started is let go");
    assert.equal(holds.owed("c1"), null);
    const b = cards();
    b.holds.hold("c1", { runId: "r1", view: view("Fix the parser"), start: () => ["sa_1"] });
    b.holds.stop("c1", null);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual([b.holds.list("c1")[0].state, b.holds.list("c1")[0].by], ["declined", "stop"]);
  });

  // (fails before: yes — the review of 11-14: the clock ran on while the turn waited on a question, and started a
  // sub-agent no turn owned)
  test("its turn paused on the person: its clock stands, and starts over as the turn goes on", async () => {
    const { holds, time, published } = cards();
    let started = 0;
    holds.hold("c1", { runId: "r1", view: view("Fix the parser"), start: () => (started++, ["sa_1"]) });
    holds.pause("c1", "r1", true);
    assert.deepEqual([published.at(-1).paused, published.at(-1).left], [true, 0]);
    await time.pass(HOLD_MS * 3);
    assert.deepEqual([started, holds.waiting("c1")?.state], [0, "waiting"]);
    holds.pause("c1", "r1", false);
    assert.deepEqual([published.at(-1).paused, published.at(-1).left], [false, HOLD_MS]);
    await time.pass(HOLD_MS);
    assert.equal(started, 1);
  });

  test("a throw from what hears an answer never stops it", async () => {
    const time = fakeTime();
    /** @type {unknown[]} */ const warned = [];
    const holds = createHolds({ now: time.now, later: time.later, cancel: time.cancel, newId: () => "hl_1", tell: () => { throw new Error("gone"); }, warn: (e) => void warned.push(e) });
    holds.hold("c1", { runId: "r1", view: view("Fix the parser", "no model is named for it"), start: () => [], declined: () => { throw new Error("no graph"); } });
    await time.pass(HOLD_MS);
    assert.deepEqual([holds.list("c1")[0].state, warned.length], ["declined", 2]);
  });

  test("Accept starts each in order and the agent hears which; a second answer is refused", async () => {
    const { holds, told } = cards();
    /** @type {string[]} */ const order = [];
    holds.hold("c1", { runId: "r1", view: view("Fix the parser"), start: () => (order.push("parser"), ["sa_1"]) });
    holds.hold("c1", {
      runId: "r1",
      view: view("Fix the lexer"),
      start: () => {
        throw new Error("the model refused it.");
      },
    });
    holds.hold("c1", { runId: "r1", view: view("Fix the docs"), start: async () => (order.push("docs"), ["sa_3"]) });
    const r = await holds.answer("c1", "hl_1", "accept", "person");
    assert.ok(r.ok);
    assert.deepEqual(order, ["parser", "docs"]);
    assert.deepEqual([r.hold.state, r.hold.by, r.hold.started], ["accepted", "person", ["sa_1", "sa_3"]]);
    assert.equal(told.at(-1)?.[1], "The person accepted the card: “Fix the parser” as sa_1 and “Fix the docs” as sa_3 run; their reports come as a message. Not started: “Fix the lexer” (the model refused it).");
    assert.equal(holds.owed("c1"), null, "nothing waits");
    assert.deepEqual(await holds.answer("c1", "hl_1", "decline", "person"), { ok: false, error: "the card was answered already (accepted)" });
  });

  test("One at a time keeps them with the agent, and refuses a writing launch for the rest of that turn", async () => {
    const { holds, told } = cards();
    let declined = 0;
    holds.hold("c1", { runId: "r1", view: view("Fix the parser"), start: () => ["sa_1"], declined: () => declined++ });
    const owed = holds.owed("c1");
    assert.ok(owed instanceof Promise, "the turn waits for the answer");
    await holds.answer("c1", "hl_1", "decline", "person");
    await owed;
    assert.equal(declined, 1);
    assert.equal(told.at(-1)?.[1], "The person chose One at a time: “Fix the parser” did not start. Do it yourself, in order; a sub-agent that changes files is refused for the rest of this turn.");
    assert.ok(holds.refusing("c1", "r1"));
    assert.ok(!holds.refusing("c1", "r2"), "another turn's own");
    holds.stop("c1", "r1");
    assert.ok(!holds.refusing("c1", "r1"), "let go with its turn");
  });

  test("unanswered, it accepts by itself, and keeps them with the agent where no model is known", async () => {
    const a = cards();
    a.holds.hold("c1", { runId: "r1", view: view("Fix the parser"), start: () => ["sa_1"] });
    await a.time.pass(HOLD_MS - 1);
    assert.equal(a.holds.waiting("c1")?.state, "waiting");
    await a.time.pass(1);
    assert.deepEqual([a.holds.list("c1")[0].state, a.holds.list("c1")[0].by], ["accepted", "timeout"]);
    assert.equal(a.told.at(-1)?.[1], "No answer on the card in 60 seconds, so Filament started what it held: “Fix the parser” as sa_1 runs; its report comes as a message.");
    assert.ok(!a.holds.refusing("c1", "r1"), "no one said no");

    const b = cards();
    b.holds.hold("c1", { runId: "r1", view: view("Fix the parser", "no model is named for it"), start: () => ["sa_1"] });
    await b.time.pass(HOLD_MS);
    assert.deepEqual([b.holds.list("c1")[0].state, b.holds.list("c1")[0].by], ["declined", "timeout"]);
    assert.equal(b.told.at(-1)?.[1], "No answer on the card in 60 seconds, and no model is named for it: “Fix the parser” did not start. Do it yourself, in order.");
    assert.ok(!b.holds.refusing("c1", "r1"));
  });

  test("its turn ending first starts nothing, said; an answer after it is refused", async () => {
    const { holds, told, time } = cards();
    let started = 0;
    holds.hold("c1", { runId: "r1", view: view("Fix the parser"), start: () => (started++, ["sa_1"]) });
    holds.stop("c1", "r2");
    assert.equal(holds.waiting("c1")?.state, "waiting", "another turn's end is not its own");
    holds.stop("c1", "r1");
    await time.pass(HOLD_MS);
    assert.equal(started, 0);
    assert.deepEqual([holds.list("c1")[0].state, holds.list("c1")[0].by], ["declined", "stop"]);
    assert.equal(told.at(-1)?.[1], "The turn ended before the person answered the card: “Fix the parser” did not start.");
    assert.equal((await holds.answer("c1", "hl_1", "accept", "person")).ok, false);
  });

  // (fails before: yes — the review of fc944b32: a card left waiting by a turn whose end it never heard took the next
  // turn's launches, its clock starting them with no turn of theirs to own them)
  test("a card is its turn's: a later turn's launch gets a card of its own, the one left waiting starting nothing", async () => {
    const { holds, told, time } = cards();
    let started = 0;
    holds.hold("c1", { runId: "r1", view: view("Fix the parser"), start: () => (started++, ["sa_1"]) });
    const h = holds.hold("c1", { runId: "r2", view: view("Fix the lexer"), start: () => ["sa_2"] });
    assert.deepEqual([h.id, h.launches.length], ["hl_2", 1]);
    assert.deepEqual(holds.list("c1").map((x) => [x.id, x.state, x.by]), [["hl_1", "declined", "stop"], ["hl_2", "waiting", null]]);
    assert.equal(told.at(-1)?.[1], "The turn ended before the person answered the card: “Fix the parser” did not start.");
    await time.pass(HOLD_MS);
    assert.deepEqual([started, holds.list("c1")[1].started], [0, ["sa_2"]]);
  });

  // (fails before: yes — the review of fc944b32: a chat let go kept its cards, and its waiting one's clock ran on)
  test("a chat dropped: its waiting card starts nothing, and its cards are forgotten", async () => {
    const { holds, told, time } = cards();
    let started = 0;
    holds.hold("c1", { runId: "r1", view: view("Fix the parser"), start: () => (started++, ["sa_1"]) });
    holds.hold("c2", { runId: "r9", view: view("Fix the docs"), start: () => ["sa_9"] });
    holds.drop("c1");
    await time.pass(HOLD_MS);
    assert.deepEqual([started, holds.list("c1"), holds.waiting("c1")], [0, [], null]);
    assert.equal(told.find(([c]) => c === "c1")?.[1], "The turn ended before the person answered the card: “Fix the parser” did not start.");
    assert.equal(holds.list("c2")[0].state, "accepted", "another chat's card is its own");
  });

  // (fails before: yes — the review of fc944b32: a graph task with no free slot started nothing yet, and the agent heard
  // that Filament "started what it held")
  test("accepted, a launch that waits to start is said to start once a slot is free and the turn runs", async () => {
    const { holds, told, time } = cards();
    holds.hold("c1", { runId: "r1", view: view("t1: Fix"), start: () => [] });
    holds.hold("c1", { runId: "r1", view: view("t2: Lex"), start: () => ["sa_2"] });
    await time.pass(HOLD_MS);
    const [v] = holds.list("c1");
    assert.deepEqual(v.launches.map((l) => [!!l.queued, l.agent ?? null]), [[true, null], [false, "sa_2"]]);
    assert.equal(told.at(-1)?.[1], "No answer on the card in 60 seconds, so Filament started what it held: “t2: Lex” as sa_2 runs; its report comes as a message. “t1: Fix” waits to start: Filament starts it once a slot is free and this chat's turn runs, its report then coming as a message.");
    // None started yet: accepted, not started.
    const b = cards();
    b.holds.hold("c1", { runId: "r1", view: view("t1: Fix"), start: () => [] });
    await b.time.pass(HOLD_MS);
    // Every one refused at its start: accepted, none started.
    const c = cards();
    c.holds.hold("c1", { runId: "r1", view: view("t1: Fix"), start: () => { throw new Error("it is failed now"); } });
    await c.time.pass(HOLD_MS);
    assert.equal(c.told.at(-1)?.[1], "No answer on the card in 60 seconds, so Filament accepted what it held. Not started: “t1: Fix” (it is failed now).");
    assert.equal(b.told.at(-1)?.[1], "No answer on the card in 60 seconds, so Filament accepted what it held. “t1: Fix” waits to start: Filament starts it once a slot is free and this chat's turn runs, its report then coming as a message.");
  });

  // (fails before: yes — the review of this change: a chat let go while an Accept started what its card held was told of
  // it after, making the gone chat's state anew)
  test("a chat dropped while an Accept starts: it starts no more, and nothing is said of it", async () => {
    const { holds, told } = cards();
    /** @type {(ids: string[]) => void} */
    let first = () => {};
    let second = 0;
    holds.hold("c1", { runId: "r1", view: view("Fix the parser"), start: () => new Promise((r) => (first = r)) });
    holds.hold("c1", { runId: "r1", view: view("Fix the lexer"), start: () => (second++, ["sa_2"]) });
    const answered = holds.answer("c1", "hl_1", "accept", "person");
    holds.drop("c1");
    first(["sa_1"]);
    assert.ok((await answered).ok);
    assert.deepEqual([second, told, holds.list("c1")], [0, [], []]);
  });

  test("the words the held call answers with", () => {
    assert.equal(heldWords(""), "Held, not started: Parallelize tasks is off, so Filament asks the person on a card. It starts on their Accept, or by itself in 60 seconds, and its report then comes as usual. Until Filament tells you which, do none of its work: go on with a piece of your own, or call wait — again if it returns before Filament tells you.");
    assert.match(heldWords("no model is named for it"), /It starts on their Accept; with no answer in 60 seconds it stays yours \(no model is named for it\)\./);
    assert.match(answerWords(/** @type {any} */ ({ state: "declined", by: "person", launches: [{ description: "a" }, { description: "b" }], started: [], failed: [] })), /“a” and “b” did not start\. Do them yourself/);
  });
});

/**
 * A registry over the real card store, its writers held where `holds` says, and a coding agent's turn on it; with
 * `taskHelper`, a graph whose every task may take a helper.
 * @param {{ holds?: boolean, taskHelper?: boolean }} [o]
 */
function scripted({ holds = true, taskHelper = false } = {}) {
  const store = createAgentCardStore({ dataDir: null });
  const time = fakeTime();
  /** @type {any[]} */ const published = [];
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: { subagents: { slots: [] } } }),
    log: () => {},
    events: { publish: (/** @type {string} */ _topic, /** @type {any} */ e) => published.push(e) },
    runs: null,
    now: time.now,
    later: (fn, ms) => void time.later(fn, ms),
    context: {
      card: (tag) => store.find(tag),
      settings: () => ({ subagents: { pool: [{ model: "m-sub" }], ask: [] }, loop: { permissions: "edit" } }),
      modelFacts: (name) => ({ problem: null, limit: null, at: { upstream: "u", model: name } }),
      session: () => ({ cwd: tmpdir(), model: "coder-1", projectId: "p1" }),
      view: async () => ({ text: "User: fix the parser", turns: 1 }),
      brief: async () => null,
      modelProblem: () => null,
      agentOf: () => null,
      mark: (_chain, m) => ({ ...m, afterTurn: 1 }),
      holdsWriters: () => holds,
      newestTurn: () => 4,
      ...(taskHelper ? { taskHelper: { refusal: () => null, took: () => {} } } : {}),
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      registry.finish(id, { status: "done", error: null, report: "Done.", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Done." }] }], rounds: 1, toolCalls: 0, tokensIn: 100, tokensOut: 10, spentUsd: 0.01, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "Done." }], usage: { input_tokens: 10, output_tokens: 5 } }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: tmpdir(), mode: null, model: "coder-1", thinking: null, fork: null, emit: () => {}, round: () => 1 });
  const turn = createLaunchTurn({ registry, door, chainId: "c1", emit: () => {}, note: () => {}, mailbox: () => null, signal: new AbortController().signal, stopSignal: new AbortController().signal, callOf: async () => null });
  const running = () => registry.list("c1").filter((/** @type {any} */ s) => s.status === "running" || s.status === "done").length;
  return { registry, turn, door, time, published, running };
}

describe("the agent tool while Parallelize tasks is off", () => {
  test("a builder is held, its call answered at once, its card on the feed and in the chat's list; a reviewer starts", async () => {
    const s = scripted();
    const r = await s.turn.call("agent", { description: "Fix the parser", prompt: "Fix it", run_in_background: true });
    assert.equal(r.text, heldWords(""), "a folder that is no repository: no copy, and its clock starts it all the same");
    assert.equal(s.running(), 0, "nothing started");
    const [h] = s.registry.held("c1");
    assert.deepEqual([h.state, h.turn, h.launches[0].description, h.launches[0].kind, h.launches[0].where, h.onTimeout], ["waiting", 4, "Fix the parser", "builder", "folder", "accept"]);
    assert.ok(s.published.some((e) => e.type === "held" && e.chainId === "c1" && e.hold.id === h.id));
    const read = await s.turn.call("agent", { description: "Map it", prompt: "List the files", subagent_type: "reviewer" });
    assert.match(read.text, /^Done\./, "a reviewer only reads: never held");
    assert.equal(s.registry.held("c1")[0].launches.length, 1);
  });

  test("Accept starts it, and the agent's wait returns with which", async () => {
    const s = scripted();
    await s.turn.call("agent", { description: "Fix the parser", prompt: "Fix it", run_in_background: true });
    const [h] = s.registry.held("c1");
    const waited = s.turn.call("wait", { seconds: 30 });
    const out = await s.registry.answerHeld("c1", h.id, "accept");
    assert.ok(out.ok);
    const id = String(out.hold.started[0] || "");
    assert.match(id, /^sa_[0-9a-f]{8}$/);
    assert.match((await waited).text, new RegExp(`The person accepted the card: “Fix the parser” as ${id} runs`));
  });

  // (fails before: yes — the owner's of 11-16: the card had Accept and One at a time alone)
  // The words alone: the route writes the chat's switch, and chat-parallel.test.js proves a launch then starts with none.
  test("Always accept in this chat starts it as Accept does, and the agent is told no card asks in this chat again", async () => {
    const s = scripted();
    await s.turn.call("agent", { description: "Fix the parser", prompt: "Fix it", run_in_background: true });
    const [h] = s.registry.held("c1");
    const waited = s.turn.call("wait", { seconds: 30 });
    const out = await s.registry.answerHeld("c1", h.id, "always");
    assert.ok(out.ok);
    assert.deepEqual([out.hold.state, out.hold.by, out.hold.always, out.hold.started.length], ["accepted", "person", true, 1]);
    const said = (await waited).text;
    assert.match(said, /The person accepted the card: “Fix the parser” as sa_[0-9a-f]{8} runs/);
    assert.ok(said.includes(ALWAYS_WORDS.trim()), "and that Parallelize tasks is on for this chat");
    assert.equal(answerWords({ ...out.hold, always: false }).includes(ALWAYS_WORDS), false, "a plain Accept says nothing of it");
  });

  test("One at a time: the agent hears it, and its next writing launch this turn is refused in words", async () => {
    const s = scripted();
    await s.turn.call("agent", { description: "Fix the parser", prompt: "Fix it", run_in_background: true });
    await s.registry.answerHeld("c1", s.registry.held("c1")[0].id, "decline");
    const refused = await s.turn.call("agent", { description: "Fix the parser after all", prompt: "Fix it", run_in_background: true });
    assert.deepEqual([refused.isError, refused.text], [true, `Error: ${ONE_AT_A_TIME_WORDS}`]);
    assert.equal(s.registry.held("c1").length, 1, "no new card");
    assert.equal(s.running(), 0);
    const read = await s.turn.call("agent", { description: "Map it", prompt: "List the files", subagent_type: "reviewer" });
    assert.match(read.text, /^Done\./, "a reviewer still goes");
  });

  test("the switch on: nothing is held", async () => {
    const s = scripted({ holds: false });
    const r = await s.turn.call("agent", { description: "Fix the parser", prompt: "Fix it" });
    assert.match(r.text, /^Done\./);
    assert.deepEqual(s.registry.held("c1"), []);
  });

  test("a follow-up to a sub-agent is never held", async () => {
    const s = scripted();
    const first = await s.turn.call("agent", { description: "Map it", prompt: "List the files", subagent_type: "reviewer" });
    const id = String(/sa_[0-9a-f]{8}/.exec(first.text)?.[0]);
    const again = await s.turn.call("agent", { agent_id: id, prompt: "And the tests" });
    assert.match(again.text, /^Done\./);
    assert.deepEqual(s.registry.held("c1"), []);
  });

  // (fails before: yes — the review of 11-14: a launch the registry refuses at once was held first, the agent hearing
  // of its slip a minute later, and a card of a turn paused on a question outlived it)
  test("a launch that would be refused is refused at once, never held; a card of a turn paused on a question let go starts nothing", async () => {
    const s = scripted();
    const r = await s.turn.call("agent", { description: "Nothing", prompt: "   ", run_in_background: true });
    assert.ok(r.isError, JSON.stringify(r));
    assert.match(String(r.text), /a sub-agent needs a task/);
    assert.deepEqual(s.registry.held("c1"), [], "no card for it");
    await s.turn.call("agent", { description: "Fix the parser", prompt: "Fix it", run_in_background: true });
    s.door.close({ paused: true });
    assert.equal(s.registry.held("c1")[0].state, "waiting", "a pause keeps it for the resume");
    s.registry.pauseLetGo("c1");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual([s.registry.held("c1")[0].state, s.registry.held("c1")[0].by, s.running()], ["declined", "stop", 0]);
  });

  test("a turn paused and resumed is one turn to its card: the clock stands while paused, and the resumed turn's end lets it go", async () => {
    const s = scripted();
    await s.turn.call("agent", { description: "Fix the parser", prompt: "Fix it", run_in_background: true });
    const before = s.door.close({ paused: true });
    assert.equal(s.registry.held("c1")[0].paused, true);
    await s.time.pass(HOLD_MS * 2);
    assert.equal(s.registry.held("c1")[0].state, "waiting", "no clock while paused");
    const again = s.registry.openTurn({ chainId: "c1", runId: "turn-2", cwd: tmpdir(), mode: null, model: "coder-1", thinking: null, fork: null, emit: () => {}, round: () => 1, before });
    assert.deepEqual([s.registry.held("c1")[0].paused, s.registry.held("c1")[0].left], [false, HOLD_MS]);
    again.close();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual([s.registry.held("c1")[0].state, s.registry.held("c1")[0].by, s.running()], ["declined", "stop", 0]);
  });

  // (fails before: yes — the review of fc944b32: a turn that ended while its launch's folder was read left a card no
  // turn owned, which its clock then started)
  test("a turn that ends while its launch is weighed leaves no card", async () => {
    const s = scripted();
    const call = s.turn.call("agent", { description: "Fix the parser", prompt: "Fix it", run_in_background: true });
    s.door.close();
    await call;
    assert.equal(s.registry.held("c1").filter((h) => h.state === "waiting").length, 0);
    await s.time.pass(HOLD_MS);
    assert.equal(s.running(), 0);
  });

  // (fails before: yes — the review of fc944b32: a coding agent's task was taken only as its sub-agent started, so a
  // second launch for it was held beside the first, and the card's Accept started two on one task)
  test("a coding agent's task held on the card is taken: a second launch for it is refused; kept with the agent, it is free again", async () => {
    const s = scripted({ taskHelper: true });
    await s.turn.call("agent", { description: "Fix t1", prompt: "Fix it", task: "t1", run_in_background: true });
    const again = await s.turn.call("agent", { description: "Fix t1 again", prompt: "Fix it", task: "t1", run_in_background: true });
    assert.ok(again.isError, JSON.stringify(again));
    assert.match(String(again.text), /another launch is taking t1 now/);
    assert.equal(s.registry.held("c1")[0].launches.length, 1);
    const [h] = s.registry.held("c1");
    await s.registry.answerHeld("c1", h.id, "decline");
    const s2 = await s.turn.call("agent", { description: "Map t1", prompt: "List", task: "t1", subagent_type: "reviewer" });
    assert.ok(!s2.isError, JSON.stringify(s2));
  });

  // (fails before: yes — the review of this change: two calls at once for one task both passed its check while the
  // folder was read, and the card's Accept started two sub-agents on it)
  test("two launches at once for one task: one is held, the other refused", async () => {
    const s = scripted({ taskHelper: true });
    const both = await Promise.all([1, 2].map((n) => s.turn.call("agent", { description: `Fix t1 (${n})`, prompt: "Fix it", task: "t1", run_in_background: true })));
    assert.deepEqual(both.map((r) => !!r.isError).sort(), [false, true], JSON.stringify(both));
    assert.match(String(both.find((r) => r.isError)?.text), /another launch is taking t1 now/);
    assert.equal(s.registry.held("c1")[0].launches.length, 1);
  });

  // (fails before: yes — the review of this change: a card answered after its turn paused and went on started its
  // sub-agent under the closed turn, so the turn going on did not stay open for its report)
  test("a card answered after its turn paused and went on: its sub-agent is the running turn's", async () => {
    const s = scripted();
    await s.turn.call("agent", { description: "Fix the parser", prompt: "Fix it", run_in_background: true });
    const before = s.door.close({ paused: true });
    const again = s.registry.openTurn({ chainId: "c1", runId: "turn-2", cwd: tmpdir(), mode: null, model: "coder-1", thinking: null, fork: null, emit: () => {}, round: () => 1, before });
    const [h] = s.registry.held("c1");
    const r = await s.registry.answerHeld("c1", h.id, "accept");
    assert.ok(r.ok, JSON.stringify(r));
    const sa = String(r.hold.started[0]);
    assert.match(sa, /^sa_/);
    const owns = again.inbox.own?.() ?? [];
    assert.ok(owns.includes(sa), `the running turn owns ${sa}: ${JSON.stringify(owns)}`);
  });

  test("its turn ending with the card unanswered starts nothing", async () => {
    const s = scripted();
    await s.turn.call("agent", { description: "Fix the parser", prompt: "Fix it", run_in_background: true });
    s.door.close();
    const [h] = s.registry.held("c1");
    assert.deepEqual([h.state, h.by], ["declined", "stop"]);
    assert.equal(s.running(), 0);
  });
});

/** A git repository with a commit, whose sub-agents get copies of their own; and a folder that is none. */
const REPO = mkdtempSync(join(tmpdir(), "filament-held-repo-"));
const BARE = mkdtempSync(join(tmpdir(), "filament-held-bare-"));
execFileSync("git", ["init", "-q", REPO]);
writeFileSync(join(REPO, "a.txt"), "a\n");
execFileSync("git", ["-C", REPO, "-c", "user.name=t", "-c", "user.email=t@t", "add", "."]);
execFileSync("git", ["-C", REPO, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a"]);
process.on("exit", () => void removeDirs(REPO, BARE));

/**
 * The task graph's runner over a session kept in memory, its writers held where `holds` says: the registry's launches
 * and the card's entries recorded, what its agent was told kept.
 * @param {{ holds?: boolean, cwd?: string, refusing?: boolean }} [o]  `refusing`: the person chose One at a time on this turn's card
 */
function graphRig({ holds = true, cwd = REPO, refusing = false } = {}) {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: {} }]]);
  /** @type {any[]} */ const launched = [];
  /** @type {any[]} */ const carded = [];
  /** @type {string[]} */ const told = [];
  let n = 0;
  const registry = {
    launch: (/** @type {any} */ spec) => (launched.push(spec), { ok: true, id: `sa-${++n}`, done: new Promise(() => {}) }),
    slots: () => 4,
    resumable: () => null,
    tell: (/** @type {string} */ _c, /** @type {any} */ d) => void told.push(d.text),
    message: () => ({ ok: true }),
    stop: () => ({ ok: true }),
    guard: () => {},
    mergeTask: () => new Promise(() => {}),
    room: () => ({ running: 0, cwd, worktree: true }),
    holdTask: (/** @type {string} */ _c, /** @type {any} */ e) => (carded.push(e), { id: "hl_1" }),
    heldRefusing: () => refusing,
  };
  const archive = {
    metaOf: (/** @type {string} */ id, /** @type {readonly string[]} */ keys) => {
      const c = chains.get(id);
      return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
    },
    mergeMeta: (/** @type {string} */ id, /** @type {Record<string, any>} */ patch) => {
      const c = chains.get(id);
      c.meta = structuredClone({ ...c.meta, ...patch });
      return c.meta;
    },
    openGraphs: () => [],
    newestTurnN: () => 1,
  };
  let t = 1000;
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => "agent", log: () => {}, now: () => t++, holdsWriters: () => holds });
  /** @param {string} id @returns {any} */
  const task = (id) => chains.get("c1").meta.graph?.tasks.find((/** @type {any} */ x) => x.id === id);
  const turn = { runId: "turn-1", cwd, mode: null, model: "m", thinking: null, team: null };
  /** The card's entries, once its folder was read. @param {number} k */
  const onCard = (k) => until(() => carded.length >= k, `${k} on the card`);
  return { runner, launched, carded, told, task, turn, onCard };
}
const BRIEF = { goal: "parse() takes trailing commas", steps: ["Fix parse()"], acceptance: "npm test passes" };
const FIX = { id: "t1", name: "Fix", by: "sub-agent", writes: ["src/parse.js"], ...BRIEF };

describe("the task graph's sub-agent tasks while Parallelize tasks is off", () => {
  test("a writing one waits on the card, once; an explorer starts; Accept starts it and names its sub-agent", async () => {
    const g = graphRig();
    g.runner.apply("c1", { action: "add", goal: "g", tasks: [FIX, { id: "t2", name: "Map", by: "explorer", ...BRIEF }] }, { crew: "agent" });
    g.runner.attach("c1", g.turn);
    assert.deepEqual(g.launched.map((s) => s.description), ["t2: Map"], "the explorer only reads");
    await g.onCard(1);
    assert.deepEqual([g.carded.length, g.carded[0].view.description, g.carded[0].view.where, g.carded[0].view.declines, g.carded[0].runId], [1, "t1: Fix", "copy", "", "turn-1"]);
    assert.equal(g.task("t1").state, "waiting");
    g.runner.attach("c1", g.turn);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(g.carded.length, 1, "on the card once");
    assert.deepEqual(g.carded[0].start(), ["sa-2"]);
    assert.deepEqual([g.task("t1").state, g.task("t1").agent], ["running", "sa-2"]);
  });

  // (fails before: yes — the review of this change: a task the agent took as its own while its card waited was said, at
  // the Accept, to start once a slot was free, and never did)
  test("taken by the agent while its card waited: the Accept starts nothing for it, and says why", async () => {
    const g = graphRig();
    g.runner.apply("c1", { action: "add", goal: "g", tasks: [FIX] }, { crew: "agent" });
    g.runner.attach("c1", g.turn);
    await g.onCard(1);
    g.runner.apply("c1", { action: "change", tasks: [{ id: "t1", by: "you" }] }, { crew: "agent" });
    assert.throws(() => g.carded[0].start(), { message: "your agent took it as its own meanwhile" });
    assert.deepEqual([g.task("t1").state, g.task("t1").by, g.launched.length], ["waiting", "you", 0]);
  });

  // (fails before: yes — the review of 11-14: a folder with no repository, or one with no commit, was said to give a copy,
  // and the card started its task by itself in the person's folder)
  test("in a folder that gives no copy, the card says so, and its clock starts the task all the same", async () => {
    const g = graphRig({ cwd: BARE });
    g.runner.apply("c1", { action: "add", goal: "g", tasks: [FIX] }, { crew: "agent" });
    g.runner.attach("c1", g.turn);
    await g.onCard(1);
    assert.deepEqual([g.carded[0].view.where, g.carded[0].view.declines], ["folder", ""]);
  });

  test("kept with the agent: it is told to take it as its own, and the turn holds it no more; the turn's end says nothing and the next turn holds it again", async () => {
    const g = graphRig();
    g.runner.apply("c1", { action: "add", goal: "g", tasks: [FIX] }, { crew: "agent" });
    g.runner.attach("c1", g.turn);
    await g.onCard(1);
    g.carded[0].declined("person");
    assert.equal(g.told.at(-1), "[Filament: t1 stays unstarted: the card for sub-agents that change files kept it with you. Change it to by: you and do it yourself.]");
    g.runner.attach("c1", g.turn);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual([g.carded.length, g.launched.length], [1, 0]);
    const s = graphRig();
    s.runner.apply("c1", { action: "add", goal: "g", tasks: [FIX] }, { crew: "agent" });
    s.runner.attach("c1", s.turn);
    await s.onCard(1);
    s.carded[0].declined("stop");
    assert.deepEqual(s.told, [], "the turn ended: nothing said of it");
    s.runner.attach("c1", { ...s.turn, runId: "turn-2" });
    await s.onCard(2);
  });

  // (fails before: yes — the review of 11-14: a yes was kept by the task's id alone, so a new graph's t1 started unheld)
  test("a yes is for that task of that graph, once: a new graph's t1 waits on a card again", async () => {
    const g = graphRig();
    g.runner.apply("c1", { action: "add", goal: "g", tasks: [FIX] }, { crew: "agent" });
    g.runner.attach("c1", g.turn);
    await g.onCard(1);
    g.carded[0].start();
    assert.equal(g.launched.length, 1);
    const dropped = g.runner.apply("c1", { action: "drop", ids: ["t1"], reason: "done another way" }, { crew: "agent" });
    assert.ok(dropped.ok !== false, JSON.stringify(dropped));
    const closed = g.runner.apply("c1", { action: "close", reason: "over" }, { crew: "agent" });
    assert.ok(closed.ok !== false, JSON.stringify(closed));
    g.runner.apply("c1", { action: "add", goal: "g2", tasks: [FIX] }, { crew: "agent" });
    g.runner.attach("c1", g.turn);
    await g.onCard(2);
    assert.equal(g.launched.length, 1, "not started unheld");
  });

  // (fails before: yes — the review of 11-14: after One at a time a graph task ready later in the turn asked again)
  test("One at a time on the turn's card: a graph task ready later in the turn is the agent's, said once, no card", async () => {
    const g = graphRig({ refusing: true });
    g.runner.apply("c1", { action: "add", goal: "g", tasks: [FIX] }, { crew: "agent" });
    g.runner.attach("c1", g.turn);
    g.runner.attach("c1", g.turn);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual([g.carded.length, g.launched.length], [0, 0]);
    assert.deepEqual(g.told, ["[Filament: t1 stays unstarted: the person chose One at a time on this turn's card for sub-agents that change files. Change it to by: you and do it yourself.]"]);
  });

  test("the switch on: it starts as ever", () => {
    const g = graphRig({ holds: false });
    g.runner.apply("c1", { action: "add", goal: "g", tasks: [FIX] }, { crew: "agent" });
    g.runner.attach("c1", g.turn);
    assert.deepEqual([g.launched.length, g.carded.length], [1, 0]);
  });
});
