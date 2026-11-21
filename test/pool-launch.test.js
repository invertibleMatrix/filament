// @ts-check
// HarnessV4_Tasks E15 step 8 (the pool, V4-D285): a session's launches over its pool of models. A launch that names
// no model takes the first model from the top with room; a card's or a launch's own model takes that model's room; the
// limit the agent hears is what the models take now and the chat's one number; a row that cannot run is skipped and the
// agent that ran instead says so; a fork takes room on the main agent's model; a coding agent's own helpers leave the
// nameless row alone; one that started by itself takes no room; and a follow-up goes on on its own model. Since U13-D15
// (10-20) the list is an order: what a model takes at once is its number across Filament (core/slots.js), not a count of
// the row's — and since the owner's word of 11-05 a model with none set has no limit, and a chat no number of its own.
// The rules alone: test/pool-core.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { SCHEMAS, defaultsOf } from "../src/core/schema.js";

const root = tmpdir();
const NOW = Date.UTC(2026, 9, 13, 9, 0, 0);
const THREE = [{ model: "glm" }, { model: "flash" }, { model: "haiku" }];
/** Each model's limit across Filament, at the one source every name here lands on. @param {Record<string, number>} n */
const slotsAt = (n) => Object.entries(n).map(([model, k]) => ({ upstream: "u", model, n: k }));

/**
 * A registry over a session whose pool, its models' numbers and its models' facts the test holds. Each launch's request
 * waits until the test lets it go (`finish`), so a launch stays running the way one at work does. `engine`: the chat's
 * (a team's chat: `{ mode: "team", team }`).
 * @param {{ pool?: any, slots?: Record<string, number>, facts?: Record<string, { problem?: string | null, limit?: any }>, ask?: string[], cards?: ReturnType<typeof createAgentCardStore>, engine?: any }} [o]
 */
function world({ pool = THREE, slots = { glm: 4, flash: 3, haiku: 3 }, facts = {}, ask = [], cards = createAgentCardStore({ dataDir: null }), engine = undefined } = {}) {
  const w = {
    pool,
    slots,
    facts,
    cards,
    /** @type {Map<string, () => void>} */ gates: new Map(),
    /** @type {any[]} */ posts: [],
    /** @type {ReturnType<typeof createSubagentRegistry>} */ registry: /** @type {any} */ (null),
    /** Let a running sub-agent's request answer, and wait for its end. @param {{ id: string, done: Promise<any> }} r */
    finish: async (r) => {
      for (let i = 0; i < 200 && !w.gates.has(r.id); i++) await new Promise((res) => setImmediate(res));
      /** @type {() => void} */ (w.gates.get(r.id))();
      await r.done;
    },
  };
  let n = 0;
  w.registry = createSubagentRegistry({
    now: () => NOW,
    config: () => ({ agentLoop: { subagents: { slots: slotsAt(w.slots) } } }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { pool: w.pool, ask }, loop: { permissions: "edit" }, ...(engine ? { engine } : {}) }),
      session: () => ({ cwd: root, model: "m-main", projectId: "p1" }),
      view: async () => ({ text: "User: fix the parser", turns: 1 }),
      brief: async () => null,
      modelProblem: (name) => w.facts[name]?.problem || null,
      modelFacts: (name) => ({ problem: w.facts[name]?.problem || null, limit: w.facts[name]?.limit || null, at: { upstream: "u", model: name } }),
      agentOf: () => null,
      mark: (_chainId, m) => ({ ...m, afterTurn: 1 }),
    },
    call: async ({ body, headers = {} }) => {
      w.posts.push({ body, headers });
      const id = headers["x-filament-subagent"];
      const runId = `run-${++n}`;
      w.registry.attach(id, runId);
      await new Promise((res) => w.gates.set(id, () => res(undefined)));
      w.registry.finish(id, { status: "done", error: null, report: "Done.", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Done." }] }], rounds: 1, toolCalls: 0, tokensIn: 10, tokensOut: 5, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "Done." }], usage: { input_tokens: 10, output_tokens: 5 } }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return w;
}
/** A developer's launch of Reviewer, whose card names no model. @param {string} prompt @param {Record<string, any>} [more] @returns {any} */
const SIDE = (prompt, more = {}) => ({ origin: "owner", chainId: "c1", prompt, as: "reviewer", ...more });
/** @param {ReturnType<typeof world>} w @param {any} spec @returns {{ ok: true, id: string, done: Promise<any> }} */
const ok = (w, spec) => {
  const r = w.registry.launch(spec);
  assert.equal(r.ok, true, String(/** @type {any} */ (r).error || ""));
  return /** @type {any} */ (r);
};
/** @param {ReturnType<typeof world>} w @param {any} spec */
const refused = (w, spec) => String(/** @type {any} */ (w.registry.launch(spec)).error || "launched");
/** @param {ReturnType<typeof world>} w @param {{ id: string }} r */
const modelOf = (w, r) => w.registry.get(r.id)?.model;
/** A turn's door on the session, as its loop opens one. @param {ReturnType<typeof world>} w @param {Record<string, any>} [over] */
const door = (w, over = {}) => w.registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: root, mode: "edit", model: "m-main", thinking: null, fork: null, ...over });
/** One `agent` call of the turn. @param {ReturnType<typeof door>} d @param {string} id @param {Record<string, any>} input @param {Record<string, any>} [more] */
const call = (d, id, input, more = {}) => d.subagents.run({ id, input: { description: "Look", prompt: "look at it", run_in_background: true, ...input }, emit: () => {}, signal: null, ...more });
/** A model's slot as a seat holds it: its number and how many run on it. @param {any} s */
const slot = (s) => [s.model, s.shared?.cap, s.running];
const BUSY = (/** @type {string} */ m, /** @type {number} */ n) => `${m}, and its slots across Filament are busy (${n} of ${n} busy; set on its row under its provider in Settings)`;

// (fails before: yes — a session named one model for its agents and one number: ten at once meant ten on one model)
describe("ten at once across three models, their limits 4, 3 and 3 (the plan's case 1)", () => {
  test("launches that name no model fill the models from the top; the eleventh is refused with the limit; room that frees is the next one taken", async () => {
    const w = world();
    const ten = Array.from({ length: 10 }, (_, i) => ok(w, SIDE(`job ${i + 1}`)));
    assert.deepEqual(ten.map((r) => modelOf(w, r)), ["glm", "glm", "glm", "glm", "flash", "flash", "flash", "haiku", "haiku", "haiku"]);
    assert.deepEqual([w.registry.limit("c1"), w.registry.slots("c1")], [{ max: 10, running: 10 }, 0]);
    assert.equal(w.registry.nextSeat("c1"), null, "no room is free: a page names no model the launch would not get");
    assert.deepEqual(w.registry.pool("c1").map(slot), [["glm", 4, 4], ["flash", 3, 3], ["haiku", 3, 3]]);
    assert.equal(refused(w, SIDE("job 11")), "The limit is 10 at once, and 10 are running. Wait for one to finish.");
    await w.finish(ten[5]);
    assert.deepEqual([w.registry.limit("c1"), w.registry.slots("c1")], [{ max: 10, running: 9 }, 1]);
    assert.deepEqual(w.registry.nextSeat("c1"), { model: "flash", own: false }, "the room that freed, not the first row");
    assert.equal(modelOf(w, ok(w, SIDE("job 11"))), "flash", "the first model from the top with room");
    // Each agent's row carries that its model came from the pool.
    assert.deepEqual(w.registry.get(ten[0].id)?.seat, { pooled: true, named: true, skipped: [] });
    // The row that names no model is the main agent's: the pool's, and no model the list named.
    const plain = world({ pool: [{ model: "" }] });
    const own = ok(plain, SIDE("look"));
    assert.deepEqual([modelOf(plain, own), plain.registry.get(own.id)?.seat], ["m-main", { pooled: true, named: false, skipped: [] }]);
  });

  // (fails before: yes — the owner's word of 11-05: the count said "of" a chat's number, four unless set)
  test("the session's agent hears how many run, never a number of Filament's own nor a model", async () => {
    const w = world();
    const d = door(w);
    const first = await call(d, "tu-1", {});
    assert.match(first.text, /^Launched sub-agent sa_[0-9a-f]{8} \("Look"\) in the background\./);
    assert.match(first.text, /1 running\.$/);
    assert.ok(!/ of |you can start/.test(first.text.split("\n").at(-1) || ""), first.text);
    assert.ok(!/glm|flash|haiku/.test(first.text), first.text);
    for (let i = 2; i <= 10; i++) await call(d, `tu-${i}`, {});
    await assert.rejects(call(d, "tu-11", {}), { message: "The limit is 10 at once, and 10 are running. Wait for one to report." });
  });
});

// (fails before: yes — a row's stored seats capped it: a list written with counts ran 2 on glm though glm takes 4; and
// the owner's word of 11-05: a chat whose number nobody set ran four)
describe("a list is an order (U13-D15)", () => {
  test("a row's old seats cap nothing, and no chat's number does: its model takes its number across Filament, the next model the rest", async () => {
    const w = world({ pool: [{ model: "glm", seats: 2 }, { model: "flash", seats: 2 }] });
    const four = Array.from({ length: 4 }, (_, i) => ok(w, SIDE(`job ${i + 1}`)));
    assert.deepEqual(four.map((r) => modelOf(w, r)), ["glm", "glm", "glm", "glm"], "glm takes 4, its number, though its row said 2");
    assert.deepEqual([modelOf(w, ok(w, SIDE("job 5"))), modelOf(w, ok(w, SIDE("job 6")))], ["flash", "flash"], "the next model on the list once glm is full, past four");
  });

  test("a model with no limit set runs as many as are launched", () => {
    const w = world({ pool: [{ model: "glm" }], slots: {} });
    const twelve = Array.from({ length: 12 }, (_, i) => ok(w, SIDE(`job ${i + 1}`)));
    assert.deepEqual([...new Set(twelve.map((r) => modelOf(w, r)))], ["glm"]);
    assert.deepEqual(w.registry.limit("c1"), { max: Infinity, running: 12 });
  });
});

// (fails before: yes — AG-233, the plan's AG-14: a card's own model had no seats of its own)
describe("a model of its own", () => {
  test("a card that names a model in the pool takes that model's room, and is refused naming the model where it is full; so is a launch that names one", async () => {
    const cards = createAgentCardStore({ dataDir: null });
    cards.create({ tag: "translator", name: "Translator", goodFor: "Puts strings into German", thinks: "You translate, and keep every placeholder.", may: "read", model: "flash" });
    const w = world({ pool: [{ model: "glm" }, { model: "flash" }], slots: { glm: 2, flash: 1 }, cards });
    const first = ok(w, { origin: "owner", chainId: "c1", prompt: "the About page", as: "translator" });
    assert.deepEqual([modelOf(w, first), w.registry.get(first.id)?.seat], ["flash", null], "its own model: no seat of the pool's choosing to say");
    assert.equal(refused(w, { origin: "owner", chainId: "c1", prompt: "the Help page", as: "translator" }), `Translator runs on ${BUSY("flash", 1)}. Wait for one to finish.`);
    assert.equal(refused(w, SIDE("look", { model: "agent/flash" })), "flash: its slots across Filament are busy (1 of 1 busy; set on its row under its provider in Settings). Wait for one to finish.");
    assert.equal(modelOf(w, ok(w, SIDE("look"))), "glm", "a launch that names none still has the pool's other rows");
  });

  test("a model the pool does not list runs, beside the list's", async () => {
    const w = world({ pool: [{ model: "glm" }] });
    const out = ok(w, SIDE("look", { model: "kimi" }));
    assert.equal(modelOf(w, out), "kimi");
    assert.deepEqual(["two", "three"].map((x) => modelOf(w, ok(w, SIDE(x)))), ["glm", "glm"]);
  });

  // (fails before: yes — the owner's words of 10-29: Hunters on GLM-5.3 stopped at four though the chat's number was 8
  // and GLM-5.3's slots 16: the chat's list, the main agent's model alone, lent its four to every agent of the chat)
  test("agents on a model the list does not hold run up to that model's slots, not the list's room", () => {
    const w = world({ pool: [{ model: "" }], slots: { glm: 16, "m-main": 4 } });
    const sixteen = Array.from({ length: 16 }, (_, i) => ok(w, SIDE(`hunt ${i + 1}`, { model: "glm" })));
    assert.deepEqual(sixteen.map((r) => modelOf(w, r)), Array(16).fill("glm"));
    assert.equal(refused(w, SIDE("hunt 17", { model: "glm" })), "glm: its slots across Filament are busy (16 of 16 busy; set on its row under its provider in Settings). Wait for one to finish.");
    // The other way round: the list's model full first, the next launch on a model it does not hold.
    const full = world({ pool: [{ model: "" }], slots: { glm: 16, "m-main": 4 } });
    for (let i = 1; i <= 4; i++) ok(full, SIDE(`look ${i}`));
    assert.equal(modelOf(full, ok(full, SIDE("hunt", { model: "glm" }))), "glm");
  });

  // (fails before: yes — the review of 10-29: the room a model outside the list lends counted for launches that name no
  // model, so the graph's runner started tasks the list's model had no slot for, and they failed)
  test("what a session can start that names no model is the list's own room: a model outside it lends to its own launches alone", () => {
    const w = world({ pool: [{ model: "" }], slots: { glm: 16, "m-main": 4 } });
    ok(w, SIDE("hunt", { model: "glm" }));
    assert.equal(w.registry.slots("c1"), 4, "the main agent's model's four, not glm's fifteen left");
    for (let i = 1; i <= 4; i++) ok(w, SIDE(`look ${i}`));
    assert.equal(w.registry.slots("c1"), 0);
    assert.equal(modelOf(w, ok(w, SIDE("hunt 2", { model: "glm" }))), "glm", "a launch on the outside model still has its room");
  });
});

// (fails before: yes — AG-236: a model that could not run failed every launch)
describe("a row that cannot run", () => {
  test("it is skipped, and the agent that ran instead carries which and why; with no row left the launch names each one's reason", async () => {
    const w = world({ facts: { glm: { problem: "signed out" } } });
    const r = ok(w, SIDE("look"));
    assert.deepEqual([modelOf(w, r), w.registry.get(r.id)?.seat], ["flash", { pooled: true, named: true, skipped: [{ model: "glm", why: "signed out" }] }]);
    assert.deepEqual(w.registry.limit("c1"), { max: 6, running: 1 }, "its room is not lent while it cannot run");
    // (fails before: yes — AG-260: nothing said which seat a launch would take, so a page named the first row)
    assert.deepEqual(w.registry.nextSeat("c1"), { model: "flash", own: false }, "the next launch passes the row that cannot run too");
    w.facts = { glm: { problem: "signed out" }, flash: { problem: "no route matches it" }, haiku: { problem: "it takes no tools" } };
    assert.equal(refused(w, SIDE("again")), "no model of this session's pool can run an agent now: glm (signed out); flash (no route matches it); haiku (it takes no tools)");
  });
});

// (fails before: yes — AG-234, AG-235: the number typed was the limit, whatever the model's provider took at once)
describe("what the models take", () => {
  test("a model's limit cuts its room; a provider's 429 cuts it for a while, and the refusal says which model and how long", async () => {
    const w = world({ pool: [{ model: "glm" }], facts: { glm: { limit: { cap: 2, from: "headers" } } } });
    ok(w, SIDE("one"));
    ok(w, SIDE("two"));
    assert.equal(refused(w, SIDE("three")), "The limit is 2 at once, and 2 are running. Wait for one to finish.");
    w.facts = { glm: { limit: { cap: 1, from: "429", liftsAt: NOW + 5 * 60_000 } } };
    assert.equal(refused(w, SIDE("three")), "The limit is 1 at once, and 2 are running. Wait for one to finish. glm runs 1 at once: its provider said too many, for 5 more minutes.");
    // Nothing stored changed: when the limit lifts, the room is back with no setting touched (AG-242).
    w.facts = {};
    assert.equal(modelOf(w, ok(w, SIDE("three"))), "glm");
    assert.deepEqual(w.registry.limit("c1"), { max: 4, running: 3 });
  });

  test("on the main agent's own model, where it has a limit, one call stays the main agent's", async () => {
    const w = world({ pool: [{ model: "" }], facts: { "m-main": { limit: { cap: 3, from: "headers" } } } });
    assert.deepEqual([modelOf(w, ok(w, SIDE("one"))), modelOf(w, ok(w, SIDE("two")))], ["m-main", "m-main"]);
    assert.equal(refused(w, SIDE("three")), "The limit is 2 at once, and 2 are running. Wait for one to finish.");
    assert.deepEqual(w.registry.pool("c1").map((s) => [s.model, s.own, s.named, s.lent]), [["m-main", true, false, 2]]);
  });

  test("a pool not saved yet is read the same way, for its editor: its rows over the session's running agents", async () => {
    const w = world();
    ok(w, SIDE("one"));
    const draft = [{ model: "glm" }, { model: "" }];
    assert.deepEqual(w.registry.pool("c1", null, draft).map(slot), [["glm", 4, 1], ["m-main", Infinity, 0]], "no limit set on the main agent's model: none");
    assert.deepEqual(w.registry.pool("", "other-main", draft).map((s) => [s.model, s.running]), [["glm", 0], ["other-main", 0]], "no session: a new task's");
    assert.deepEqual(w.registry.pool("c1").map((s) => s.model), ["glm", "flash", "haiku"], "the stored one is as it was");
  });
});

// (fails before: yes — AG-237: a fork counted as any launch did, on whatever the session's number allowed)
describe("a fork", () => {
  const FORK = { fork: () => ({ body: { model: "m-main", max_tokens: 100, system: "SYS", tools: [], messages: [{ role: "user", content: "fix the parser" }] }, headers: {} }) };

  test("it runs on the main agent's model and takes that model's room: refused where the pool gives it none, and where it is full", async () => {
    const w = world({ pool: [{ model: "glm" }], slots: { glm: 2, "m-main": 1 } });
    await assert.rejects(call(door(w, FORK), "tu-1", { context: "fork" }), { message: "a fork runs on the main agent's model (m-main), and this session's pool gives it no seat — add it to the pool, or choose another view" });
    w.pool = [{ model: "glm" }, { model: "" }];
    const d = door(w, FORK);
    const first = await call(d, "tu-2", { context: "fork" });
    assert.match(first.text, /^Launched sub-agent/);
    assert.deepEqual(w.registry.pool("c1").map((s) => [s.model, s.running]), [["glm", 0], ["m-main", 1]]);
    await assert.rejects(call(d, "tu-3", { context: "fork" }), { message: "a fork runs on the main agent's model (m-main), and its slots across Filament are busy (1 of 1 busy; set on its row under its provider in Settings) — wait for one to finish, or choose another view" });
    // Another view still has the pool's other rows.
    assert.match((await call(d, "tu-4", { context: "none" })).text, /2 running\.$/);
  });
});

// (fails before: yes — AG-238: a coding agent's tool had one model or none)
describe("a coding agent's own tool", () => {
  // (fails before: yes — the owner's of 11-06: the offer named the pool's models, so a change to the list changed the
  // agent's tool and opened its session again; a launch reads the list as it stands)
  test("its offer names no model: the pool, whatever it holds, leaves it as it is", () => {
    const w = world({ pool: [{ model: "m-1" }, { model: "" }] });
    const before = w.registry.offer("c1");
    assert.equal("model" in before, false);
    w.pool = THREE;
    assert.deepEqual(w.registry.offer("c1"), before);
    w.pool = [{ model: "" }];
    assert.deepEqual(w.registry.offer("c1"), before);
  });

  // (fails before: yes — the owner's of 11-06: a coding agent's Builder and Reviewer took a named row only, AG-238, so
  // the second waited on m-1's room though the card said "Same as the main agent")
  test("its Builder and Reviewer take the chat's rows as the loop's agent does — the nameless one is the agent's own model", async () => {
    const w = world({ pool: [{ model: "m-1" }, { model: "" }], slots: { "m-1": 1 }, ask: ["product"] });
    const d = door(w);
    const helper = await call(d, "tu-1", {}, { coder: true });
    assert.match(helper.text, /1 running\.$/);
    const reviewer = await call(d, "tu-2", { subagent_type: "reviewer" }, { coder: true });
    assert.match(reviewer.text, /2 running\.$/);
    const asked = await call(d, "tu-3", { subagent_type: "product" }, { coder: true });
    assert.match(asked.text, /3 running\.$/);
    assert.deepEqual(w.registry.pool("c1").map((s) => [s.model, s.running]), [["m-1", 1], ["m-main", 2]]);
    // The loop's own agent, on the same pool, the same.
    const loop = world({ pool: [{ model: "m-1" }, { model: "" }], slots: { "m-1": 1 } });
    const ld = door(loop);
    await call(ld, "tu-1", {});
    await call(ld, "tu-2", {});
    assert.deepEqual(loop.registry.pool("c1").map((s) => [s.model, s.running]), [["m-1", 1], ["m-main", 1]]);
  });

  test("a copy that holds Builder's place takes the chat's rows as Builder does, however it is asked", async () => {
    const cards = createAgentCardStore({ dataDir: null });
    cards.create({ from: "builder", tag: "mybuilder", name: "Builder, mine" });
    const w = world({ pool: [{ model: "m-1" }, { model: "" }], slots: { "m-1": 2 }, ask: ["mybuilder"], cards });
    const d = door(w);
    await call(d, "tu-1", { subagent_type: "mybuilder" }, { coder: true });
    await call(d, "tu-2", { subagent_type: "builder" }, { coder: true });
    await call(d, "tu-3", { subagent_type: "mybuilder" }, { coder: true });
    assert.deepEqual(w.registry.pool("c1").map((s) => [s.model, s.running]), [["m-1", 2], ["m-main", 1]]);
  });
});

// (fails before: yes — AG-239: one that started by itself ran on the session's one model for its agents)
describe("one Filament starts itself (a second look, a steer's fork)", () => {
  test("it runs on its card's model, else on the pool's first row that can run, and takes no seat", async () => {
    const w = world({ pool: [{ model: "glm" }, { model: "flash" }], slots: { glm: 1, flash: 1 }, facts: { glm: { problem: "signed out" } } });
    const self = ok(w, { origin: "self", chainId: "c1", as: "reviewer", prompt: "what the turn did", description: "Looks again", why: "the turn ended" });
    assert.deepEqual([modelOf(w, self), w.registry.get(self.id)?.seat, w.registry.limit("c1")], ["flash", null, { max: 1, running: 0 }]);
    assert.equal(modelOf(w, ok(w, SIDE("look"))), "flash", "the room it runs beside is free");
  });
});

// (fails before: yes — the plan's case 8: a follow-up went on whatever ran on its model)
describe("going on with one", () => {
  test("it goes on on its own model: refused while that model is full, though the session has room", async () => {
    const w = world({ pool: [{ model: "glm" }, { model: "flash" }], slots: { glm: 1, flash: 2 } });
    const first = ok(w, SIDE("one"));
    await w.finish(first);
    const second = ok(w, SIDE("two"));
    assert.deepEqual([modelOf(w, first), modelOf(w, second), w.registry.limit("c1")], ["glm", "glm", { max: 3, running: 1 }]);
    assert.deepEqual(w.registry.followUp(first.id, { prompt: "and the tests?", chainId: "c1" }), { ok: false, error: `Reviewer runs on ${BUSY("glm", 1)}. Wait for one to finish.` });
    await w.finish(second);
    assert.equal(w.registry.followUp(first.id, { prompt: "and the tests?", chainId: "c1" }).ok, true);
    assert.deepEqual(w.registry.pool("c1").map((s) => [s.model, s.running]), [["glm", 1], ["flash", 0]]);
  });
});

// (fails before: yes — HarnessV4_Worktrees_Plan S1, the owner's words of 10-22: "across both theams only 4 agents are
// working and some waiting for slots, but i remember setting slot to be 20 for glm5.3 flash"; and of 11-05: "i would
// remove those 4 limits")
describe("a chat's agents, a team's or not, run up to their models' limits — none of Filament's own", () => {
  const TEAM = { mode: "team", team: "ops" };
  test("a team's chat runs up to its model's 20 slots, not four", () => {
    const w = world({ pool: [{ model: "flash" }], slots: { flash: 20 }, engine: TEAM });
    for (let i = 1; i <= 20; i++) ok(w, SIDE(`job ${i}`));
    assert.deepEqual(w.registry.limit("c1"), { max: 20, running: 20 });
    assert.equal(refused(w, SIDE("job 21")), "The limit is 20 at once, and 20 are running. Wait for one to finish.");
  });
  test("on Filament's shipped settings, with no limit set anywhere, nothing holds a chat's agents back", () => {
    const shipped = defaultsOf(SCHEMAS.CONFIG).agentLoop.subagents;
    assert.equal(shipped.most, undefined, "no chat's number ships");
    for (const engine of [TEAM, undefined]) {
      const w = world({ pool: shipped.pool, slots: {}, engine });
      for (let i = 1; i <= 12; i++) ok(w, SIDE(`job ${i}`));
      assert.deepEqual(w.registry.limit("c1"), { max: Infinity, running: 12 });
    }
  });
});
