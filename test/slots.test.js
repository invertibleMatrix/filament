// @ts-check
// team_v2_plan P2 (TV2-D8, TV2-D9): how many agents run on a model at once across Filament — one number per model at each
// source, none set none (the owner's of 11-05) — shared by every chat's agents and every lead's workers. The rules
// (core/slots.js), a seat that reads them (core/pool.js), the registry's launches over them — a row whose model is busy
// is passed for the next, a lead's worker waits for room and starts once a slot frees, a team's own models. The field
// that sets one, on its provider's model row, is in model-rows.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { slotKey, slotOf, slotsOf, slotsProblem, slotWords, withSlot } from "../src/core/slots.js";
import { seatFree, seatsOf, takeSeat, waitSeat, poolRoom } from "../src/core/pool.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";

const root = tmpdir();
const NOW = Date.UTC(2026, 9, 19, 9, 0, 0);
const settle = () => new Promise((r) => setImmediate(r));

describe("the rules (core/slots.js)", () => {
  test("a list holds { upstream, model, n } rows, each model once at each source; n from 1 to 64", () => {
    assert.equal(slotsProblem([]), null);
    assert.equal(slotsProblem([{ upstream: "zai", model: "glm-5.3-flash", n: 20 }, { upstream: "anthropic", model: "claude-opus-5-5", n: 8 }]), null);
    assert.match(String(slotsProblem({})), /must be a list/);
    assert.match(String(slotsProblem([{ upstream: "zai", model: "x", n: 0 }])), /\[0\]\.n must be a whole number from 1 to 64/);
    assert.match(String(slotsProblem([{ upstream: "zai", model: "x", n: 2, seats: 1 }])), /holds "seats"/);
    assert.match(String(slotsProblem([{ upstream: "zai", model: "X", n: 2 }, { upstream: "zai", model: "x", n: 3 }])), /names "x" at "zai" twice/);
    assert.deepEqual(slotsOf("nonsense"), [], "a list that does not hold is none");
  });

  // (fails before: yes — the review of 11-05: a stored list that failed its check read as none, so every model's limit
  // went, and the next write kept only its own row)
  test("a stored list that fails its check keeps the rows that hold: each model once at each source, the first 64", () => {
    const stored = [
      { upstream: "a", model: "m-1", n: 2 },
      { upstream: "a", model: "M-1", n: 3 },
      { upstream: "a", model: " m-2 ", n: 2, seats: 4 },
      { upstream: "", model: "m-3", n: 1 },
      { upstream: "a", model: "m-4", n: 99 },
      "m-5",
      ...Array.from({ length: 70 }, (_, i) => ({ upstream: "b", model: `x-${i}`, n: 1 })),
    ];
    assert.match(String(slotsProblem(stored)), /twice|holds|must/);
    const kept = slotsOf(stored);
    assert.equal(kept.length, 64);
    assert.deepEqual(kept.slice(0, 3), [{ upstream: "a", model: "m-1", n: 2 }, { upstream: "a", model: "m-2", n: 2 }, { upstream: "b", model: "x-0", n: 1 }]);
    assert.equal(slotsProblem(kept), null, "what it keeps holds");
  });

  test("set, set again and given back; a model with no row has no cap; a provider's lower ceiling cuts it, said with how long", () => {
    let rows = withSlot([], "zai", "glm-5.3-flash", 20);
    rows = withSlot(rows, "zai", "glm-5.3-flash", 12);
    assert.deepEqual(rows, [{ upstream: "zai", model: "glm-5.3-flash", n: 12 }]);
    assert.deepEqual(withSlot(rows, "zai", "glm-5.3-flash", null), []);
    const plain = slotOf([], { upstream: "zai", model: "kimi" }, { seen: null, running: 1 });
    assert.deepEqual([plain.set, plain.cap, plain.key], [null, Infinity, slotKey("zai", "kimi")]);
    assert.equal(slotWords(plain, NOW), "1 running");
    const held = slotOf([], { upstream: "zai", model: "kimi" }, { seen: { cap: 3, from: "429", liftsAt: NOW + 2 * 60_000 }, running: 3 });
    assert.deepEqual([held.set, held.cap], [null, 3], "with no number set, what the provider showed is the cap");
    assert.equal(slotWords(held, NOW), "3 of 3 busy: no limit set, its provider said too many, for 2 more minutes");
    const cut = slotOf(rows, { upstream: "zai", model: "GLM-5.3-flash" }, { seen: { cap: 5, from: "429", liftsAt: NOW + 4 * 60_000 }, running: 5 });
    assert.deepEqual([cut.set, cut.cap], [12, 5]);
    assert.equal(slotWords(cut, NOW), "5 of 5 busy: lowered from 12, its provider said too many, for 4 more minutes");
    const higher = slotOf(rows, { upstream: "zai", model: "glm-5.3-flash" }, { seen: { cap: 40, from: "headers" }, running: 0 });
    assert.deepEqual([higher.cap, higher.lowered], [12, null], "a ceiling above the number cuts nothing");
  });
});

describe("a seat reads its model's slots (core/pool.js)", () => {
  /** @param {Record<string, { cap: number, running: number }>} shared */
  const seats = (shared) => seatsOf([{ model: "flash", seats: 4 }, { model: "kimi", seats: 4 }], {
    main: "main",
    facts: (m) => ({ problem: null, limit: null, shared: shared[m] ? { key: m, upstream: "u", model: m, set: null, cap: shared[m].cap, lowered: null, running: shared[m].running } : null }),
    running: () => 0,
  });
  test("a row with a free seat whose model's slots are all busy is full: a launch that names none goes on to the next", () => {
    const s = seats({ flash: { cap: 2, running: 2 }, kimi: { cap: 4, running: 1 } });
    assert.deepEqual(s.map(seatFree), [false, true]);
    const t = takeSeat(s);
    assert.deepEqual(t.ok ? t.model : t.error, "kimi");
    assert.equal(poolRoom(s), 3, "kimi's 3 free slots; flash's 4 seats lend none");
  });
  test("a launch naming a busy model is refused, saying its slots across Filament are busy and where they are set; one that may wait takes the first row that can run", () => {
    const s = seats({ flash: { cap: 2, running: 2 }, kimi: { cap: 1, running: 1 } });
    const t = takeSeat(s, { want: "flash" });
    assert.equal(t.ok, false);
    assert.match(/** @type {any} */ (t).error, /^flash: its slots across Filament are busy \(2 of 2 busy; held by its provider\)\. Wait for one to finish\.$/);
    const all = takeSeat(s);
    assert.match(/** @type {any} */ (all).error, /every model of this session's pool is busy: flash its slots across Filament are busy/);
    assert.equal(waitSeat(s), "flash");
    assert.equal(waitSeat(s, { want: "kimi" }), "kimi");
  });
});

/**
 * A registry over chats whose list and the slots the test holds: each name lands at source "zai". Each launch's request
 * waits until the test lets it go (`finish`).
 * @param {{ slots?: any[], pool?: any[] }} [o]
 */
function world({ slots = [], pool = [{ model: "flash" }] } = {}) {
  const w = {
    slots,
    /** @type {Map<string, () => void>} */ gates: new Map(),
    /** @type {string[]} */ posted: [],
    /** @type {ReturnType<typeof createSubagentRegistry>} */ registry: /** @type {any} */ (null),
    /** @type {ReturnType<typeof createAgentCardStore>} */ cards: /** @type {any} */ (null),
    /** @param {string} id */
    finish: async (id) => {
      for (let i = 0; i < 200 && !w.gates.has(id); i++) await settle();
      /** @type {() => void} */ (w.gates.get(id))();
      for (let i = 0; i < 20; i++) await settle();
    },
  };
  let n = 0;
  const cards = createAgentCardStore({ dataDir: null });
  w.cards = cards;
  w.registry = createSubagentRegistry({
    now: () => NOW,
    config: () => ({ agentLoop: { subagents: { slots: w.slots } } }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { pool }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: root, model: "main", projectId: "p1" }),
      view: async () => ({ text: "", turns: 0 }),
      brief: async () => null,
      modelProblem: () => null,
      modelFacts: (name) => ({ problem: null, limit: null, at: { upstream: "zai", model: name }, seen: null }),
      agentOf: () => null,
      mark: (_chainId, m) => ({ ...m, afterTurn: 1 }),
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      w.posted.push(id);
      const runId = `run-${++n}`;
      w.registry.attach(id, runId);
      await new Promise((res) => w.gates.set(id, () => res(undefined)));
      w.registry.finish(id, { status: "done", error: null, report: "Found two.", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Found two." }] }], rounds: 1, toolCalls: 0, tokensIn: 10, tokensOut: 5, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "Found two." }], usage: { input_tokens: 10, output_tokens: 5 } }, id: runId, upstream: "zai", retryAfter: null, shouldRetry: null };
    },
  });
  return w;
}
/**
 * A Bug Hunter's hunter, as its lead launches it: its Hunter, a Reviewer seated under that name, waiting for room where
 * there is none.
 * @param {string} chainId @param {Record<string, any>} [more] @returns {any}
 */
const HUNTER = (chainId, more = {}) => ({ origin: "agent", chainId, prompt: "Find the bugs in src/core/slots.js", description: "Hunt slots.js", background: true, team: { key: "bug-hunter", name: "Bug Hunter", role: "hunter", card: "reviewer", words: "" }, waits: true, ...more });

describe("the registry's launches over the slots", () => {
  // (fails before: yes — team_v2_plan §5.7: every seat a chat's own; a lead's launch past its list was refused, and a
  // model ran as many agents as every chat's lists added up)
  test("a lead's worker with no free slot waits, its card saying for what; a launch of another chat on that model is refused; one ending lets the waiting one start", async () => {
    const w = world({ slots: [{ upstream: "zai", model: "flash", n: 2 }] });
    const a = /** @type {any} */ (w.registry.launch(HUNTER("c1")));
    const b = /** @type {any} */ (w.registry.launch(HUNTER("c1")));
    const c = /** @type {any} */ (w.registry.launch(HUNTER("c1")));
    assert.deepEqual([a.ok, b.ok, c.ok], [true, true, true]);
    for (let i = 0; i < 20; i++) await settle();
    assert.deepEqual(w.posted, [a.id, b.id], "two run; the third waits, its request not sent");
    assert.equal(w.registry.get(c.id)?.waiting?.words, "flash, 2 of 2 busy");
    assert.equal(w.registry.get(a.id)?.waiting, null);
    assert.equal(w.registry.standing("c1", "workers"), "2 running, 1 waiting for a slot.", "the chat has no number of its own: what runs, and what waits for flash's 2 across Filament");
    // Another chat's helper on the same model: the slots are Filament's, not the chat's.
    const other = /** @type {any} */ (w.registry.launch({ origin: "owner", chainId: "c2", prompt: "Look", as: "reviewer", model: "flash" }));
    assert.match(String(other.error), /^flash: its slots across Filament are busy \(2 of 2 busy; set on its row under its provider in Settings\)\. Wait for one to finish\.$/);
    await w.finish(a.id);
    assert.deepEqual(w.posted, [a.id, b.id, c.id], "a slot freed: the waiting worker started");
    assert.equal(w.registry.get(c.id)?.waiting, null);
    await w.finish(b.id);
    await w.finish(c.id);
  });

  test("a waiting worker stopped ends before it started, its request never sent; a raised number lets one start at once", async () => {
    const w = world({ slots: [{ upstream: "zai", model: "flash", n: 1 }] });
    const a = /** @type {any} */ (w.registry.launch(HUNTER("c1")));
    const b = /** @type {any} */ (w.registry.launch(HUNTER("c1")));
    const c = /** @type {any} */ (w.registry.launch(HUNTER("c1")));
    for (let i = 0; i < 20; i++) await settle();
    w.registry.stop(b.id);
    const ended = await b.done;
    assert.equal(ended.ok, false);
    assert.deepEqual(w.posted, [a.id]);
    w.slots = [{ upstream: "zai", model: "flash", n: 2 }];
    w.registry.pumpSlots();
    for (let i = 0; i < 20; i++) await settle();
    assert.deepEqual(w.posted, [a.id, c.id], "the setting changed: the one still waiting starts");
    await w.finish(a.id);
    await w.finish(c.id);
  });

  // (fails before: yes — the bug hunt of 10-30, SUB-3: a graph task's launch, or a going on with its task, that found no
  // slot free was refused, and its graph failed the task for good)
  test("a graph task's worker with no free slot waits, its answer saying for what and when it has its slot; one going on with its task waits too; a stop while it waits ends it before it started", async () => {
    const w = world({ slots: [{ upstream: "zai", model: "flash", n: 1 }] });
    /** A graph task's explorer as the graph's runner launches it, on the planner's model. @param {string} id @returns {any} */
    const task = (id) => ({ origin: "agent", chainId: "c1", prompt: `Map ${id}`, description: `${id}: map it`, worker: "reviewer", background: true, parentModel: "flash", task: { id, review: false }, requestId: "turn-1", waits: true });
    const a = /** @type {any} */ (w.registry.launch(task("t1")));
    const b = /** @type {any} */ (w.registry.launch(task("t2")));
    assert.deepEqual([a.ok, b.ok, a.waiting, b.waiting], [true, true, undefined, "flash, 1 of 1 busy"], "the first starts at once; the second waits, and says for what");
    /** @type {boolean[]} */
    const had = [];
    b.room.then((/** @type {boolean} */ x) => had.push(x));
    for (let i = 0; i < 20; i++) await settle();
    assert.deepEqual([w.posted, had], [[a.id], []], "its request is not sent meanwhile");
    await w.finish(a.id);
    assert.deepEqual([w.posted, had], [[a.id, b.id], [true]], "a slot freed: it starts, and its answer says it has its slot");
    // t1's sub-agent goes on with its task while t2's holds the one slot: it waits as a launch does.
    const again = /** @type {any} */ (w.registry.resumeTask(a.id, { chainId: "c1", prompt: "Map it again", requestId: "turn-2", waits: true }));
    assert.deepEqual([again.ok, again.waiting], [true, "flash, 1 of 1 busy"]);
    const refused = /** @type {any} */ (w.registry.resumeTask(a.id, { chainId: "c1", prompt: "Map it again", requestId: "turn-2" }));
    assert.equal(refused.ok, false, "it is still working, waiting for its slot");
    // A stop while it waits: it ends before it started, and its answer says it never had its slot.
    const c = /** @type {any} */ (w.registry.launch(task("t3")));
    const cut = /** @type {boolean[]} */ ([]);
    c.room.then((/** @type {boolean} */ x) => cut.push(x));
    w.registry.stop(c.id);
    assert.equal((await c.done).ok, false);
    for (let i = 0; i < 5; i++) await settle();
    assert.deepEqual(cut, [false]);
    await w.finish(b.id);
    assert.deepEqual(w.posted, [a.id, b.id, a.id], "t2's end lets t1's go on");
    await w.finish(a.id);
    assert.equal(w.posted.includes(c.id), false, "the stopped one never ran");
  });

  // (fails before: yes — a team's crew stopped at its own most, and a chat's at four, whatever its models' limits)
  test("a team's own models in order: a busy first is passed for the next; with no limit on a model, nothing holds the rest back", async () => {
    const w = world({ slots: [{ upstream: "zai", model: "kimi", n: 1 }] });
    const rows = [{ model: "kimi", seats: Infinity }, { model: "flash", seats: Infinity }];
    const a = /** @type {any} */ (w.registry.launch(HUNTER("c1", { rows })));
    const b = /** @type {any} */ (w.registry.launch(HUNTER("c1", { rows })));
    assert.deepEqual([w.registry.get(a.id)?.model, w.registry.get(b.id)?.model], ["kimi", "flash"]);
    const c = /** @type {any} */ (w.registry.launch(HUNTER("c1", { rows })));
    assert.deepEqual([w.registry.get(c.id)?.model, w.registry.get(c.id)?.waiting ?? null], ["flash", null], "flash has no limit: a third starts on it at once");
    for (let i = 0; i < 20; i++) await settle();
    assert.deepEqual(w.posted, [a.id, b.id, c.id]);
    await w.finish(b.id);
    await w.finish(a.id);
    await w.finish(c.id);
    assert.deepEqual([...w.registry.slotUse().keys()], [], "nothing holds a slot once they ended");
  });
});

// (fails before: yes — U13-D8 of 10-20: a crew member ran on its own card's models before its team's)
describe("which model a crew member runs on (U13-D8)", () => {
  test("its team's own models before its own card's; its card's where the team names none; a lead's own pick over both", async () => {
    const w = world();
    w.cards.update("reviewer", { models: ["kimi"] });
    const rows = [{ model: "flash", seats: 32 }];
    const a = /** @type {any} */ (w.registry.launch(HUNTER("c1", { rows })));
    const b = /** @type {any} */ (w.registry.launch(HUNTER("c1")));
    const c = /** @type {any} */ (w.registry.launch(HUNTER("c1", { rows, model: "main" })));
    assert.deepEqual([a.ok, b.ok, c.ok], [true, true, true]);
    assert.deepEqual([w.registry.get(a.id)?.model, w.registry.get(b.id)?.model, w.registry.get(c.id)?.model], ["flash", "kimi", "main"]);
    // The lead's lines say so too: no member's own model where its team names models.
    assert.deepEqual(w.registry.modelsOf("c1", [{ tag: "hunter", card: "reviewer" }], "main", undefined, rows).members, [{ tag: "hunter", model: null }]);
    assert.deepEqual(w.registry.modelsOf("c1", [{ tag: "hunter", card: "reviewer" }], "main", undefined, null).members, [{ tag: "hunter", model: "kimi" }]);
    for (const x of [a, b, c]) await w.finish(x.id);
  });
});
