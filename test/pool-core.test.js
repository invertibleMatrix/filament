// @ts-check
// HarnessV4_Tasks E15 step 8 (the pool, V4-D285): the rules of a session's pool of models, alone — what a stored pool
// may be, the rows as a launch reads them, what each lends now, which seat a launch takes, and the words a refusal
// and the pool's editor say. The registry over them is test/pool-launch.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CHAT_ROWS_MOST, DEFAULT_POOL, POOL_ROWS, byCardProblem, byTeamProblem, lendsWords, poolKept, poolLine, poolName, poolNote, poolOf, poolProblem, poolTotal, seatsOf, takeSeat } from "../src/core/pool.js";

const NOW = 1_000_000;
/** @typedef {import("../src/core/pool.js").ModelFacts} ModelFacts */
/**
 * The rows as a launch reads them, over a table of facts and of what runs.
 * @param {import("../src/core/pool.js").PoolRow[]} rows
 * @param {{ main?: string, facts?: Record<string, Partial<ModelFacts>>, running?: Record<string, number>, key?: (m: string) => string }} [o]
 */
const seats = (rows, { main = "m-main", facts = {}, running = {}, key } = {}) =>
  seatsOf(rows, { main, facts: (m) => ({ problem: null, limit: null, ...facts[m] }), running: (k) => running[k] || 0, ...(key ? { key } : {}) });
/** @param {import("../src/core/pool.js").Seat[]} s */
const lent = (s) => s.map((x) => [x.model, x.lent]);

// (fails before: yes — the module did not exist: a session named one model for its agents, and one number)
describe("a stored pool", () => {
  test("the default is the main agent's model with no count, and what a session that chose nothing reads", () => {
    assert.deepEqual(DEFAULT_POOL, [{ model: "" }]);
    assert.ok(Object.isFrozen(DEFAULT_POOL) && Object.isFrozen(DEFAULT_POOL[0]));
    for (const v of [undefined, null, "glm", 4, {}, []]) assert.deepEqual(poolOf(v), [{ model: "", seats: Infinity }], JSON.stringify(v));
    assert.notEqual(poolOf(null)[0], DEFAULT_POOL[0], "a copy: a caller may change it");
  });

  test("a row is a model's name: stored trimmed, less Filament's own prefix; the nameless row is the main agent's", () => {
    assert.equal(poolProblem([{ model: "zai/glm-5.3", seats: 4 }, { model: "", seats: 2 }]), null);
    assert.deepEqual(poolOf([{ model: " agent/glm-5.3 ", seats: 4 }, { model: "" }]), [{ model: "glm-5.3", seats: Infinity }, { model: "", seats: Infinity }]);
    assert.deepEqual([poolName(" agent/haiku "), poolName(null), poolName("agent/")], ["haiku", "", ""]);
  });

  test("what is wrong with one, in words: no list, no row, too many, a row that is no row, a model twice — an old row's seats, whatever they say, are none of it", () => {
    assert.match(String(poolProblem("glm")), /^must be a list of \{ model, effort\? \} rows: the models sub-agents run on, in order — model "" is the main agent's$/);
    assert.equal(poolProblem([]), "needs one row at least: a session with no seat could run no agent");
    assert.equal(poolProblem(Array.from({ length: POOL_ROWS + 1 }, (_, i) => ({ model: `m-${i}`, seats: 1 }))), `holds at most ${POOL_ROWS} rows`);
    assert.equal(poolProblem(Array.from({ length: POOL_ROWS }, (_, i) => ({ model: `m-${i}`, seats: 1 }))), null);
    assert.equal(poolProblem([{ model: "a", seats: 1 }, "b"]), "[1] must be { model, effort? }");
    assert.equal(poolProblem([{ model: "a", seats: 1, queue: true, note: "x" }]), '[0] holds "queue", "note": a row is { model, effort? }');
    assert.equal(poolProblem([{ model: 7, seats: 1 }]), '[0].model must be a model\'s name, or "" for the main agent\'s model');
    // (fails before: yes — a row's seats were checked from 1 to 32, though they capped nothing since U13-D15)
    for (const n of [0, -1, 1.5, "2", 33, null]) assert.equal(poolProblem([{ model: "a", seats: n }]), null, String(n));
    assert.equal(poolProblem([{ model: "a", seats: 1 }, { model: "agent/a ", seats: 2 }]), 'names "a" twice: each model has one row');
    assert.equal(poolProblem([{ model: "", seats: 1 }, { model: " ", seats: 2 }]), "names the main agent's model twice: each model has one row");
  });
});

// (fails before: yes — the owner's word of 11-05: "Fallback rows: model · account · effort"; a row named its model alone,
// and its agents thought as the chat's setting for agents said)
describe("a row's effort", () => {
  test("a row may say how hard its agents think: kept, read onto its seat; one that is no effort is refused in words", () => {
    assert.equal(poolProblem([{ model: "a", effort: "high" }, { model: "", effort: "model" }]), null);
    assert.equal(poolProblem([{ model: "a", effort: "huge" }]), "[0].effort must be one of model, low, medium, high, xhigh, max, or left out for the main agent's");
    assert.deepEqual(poolOf([{ model: "a", effort: "high" }, { model: "b" }]), [{ model: "a", effort: "high", seats: Infinity }, { model: "b", seats: Infinity }]);
    assert.deepEqual(poolKept([{ model: "agent/a", effort: "high", seats: 2 }, { model: "" }]), [{ model: "a", effort: "high" }, { model: "" }]);
    // (fails before: yes — the review of 11-05: a row that said none hid a later row's of the same model, so the main
    // agent's model named again with an effort under the list's first row, "", ran at none)
    assert.deepEqual(seats([{ model: "a", effort: "low" }, { model: "b" }, { model: "" }, { model: "m-main", effort: "max" }, { model: "a", effort: "high" }]).map((s) => [s.model, s.effort]), [["a", "low"], ["b", null], ["m-main", "max"]], "two rows of one model: the first that says one");
    assert.equal(poolProblem([5]), "[0] must be { model, effort? }");
  });
});

// (fails before: yes — every row needed its seats, and the lead's line said each row's count)
// (fails before: yes — the owner's plan of 11-05: a chat set its agents' models in one list alone, for every agent)
describe("a chat's own rows for an agent and for a team", () => {
  test("by card: each tag a list as the chat's list holds; by team: its lead's and its workers', each such a list; what is wrong said in words", () => {
    assert.equal(byCardProblem({ sec: [{ model: "m-a", effort: "low" }, { model: "" }], builder: [{ model: "m-b" }] }), null);
    assert.equal(byCardProblem({}), null, "none: every card as its card says");
    assert.equal(byCardProblem([]), "must be { tag: [{ model, effort? }] }: the models each agent runs on in this chat, in order");
    assert.equal(byCardProblem({ sec: [{ model: "m-a", effort: "huge" }] }), `["sec"] [0].effort must be one of model, low, medium, high, xhigh, max, or left out for the main agent's`);
    assert.equal(byCardProblem({ sec: [] }), `["sec"] needs one row at least: a session with no seat could run no agent`);
    assert.equal(byCardProblem({ " ": [{ model: "m" }] }), `" " is no agent's tag`);
    // (fails before: yes — the review of 11-05: a tag with capitals was kept and never matched, and a plugin's agent's
    // tag, up to 129 characters, was refused)
    assert.equal(byCardProblem({ Reviewer: [{ model: "m" }] }), `"Reviewer" is no agent's tag`);
    assert.equal(byCardProblem({ [`p${"x".repeat(63)}:${"y".repeat(64)}`]: [{ model: "m" }] }), null, "a plugin's agent's");
    assert.equal(byTeamProblem({ BugHunters: { workers: [{ model: "m" }] } }), `"BugHunters" is no team's key`);
    const many = Object.fromEntries(Array.from({ length: CHAT_ROWS_MOST + 1 }, (_, i) => [`a${i}`, [{ model: "m" }]]));
    assert.equal(byCardProblem(many), `holds at most ${CHAT_ROWS_MOST} agents`);
    assert.equal(byTeamProblem({ builders: { lead: [{ model: "m-a", effort: "high" }], workers: [{ model: "m-b" }, { model: "" }] }, bughunters: { workers: [{ model: "m-c" }] } }), null);
    assert.equal(byTeamProblem({ builders: {} }), null, "neither: as the team says");
    assert.equal(byTeamProblem("builders"), "must be { key: { lead?, workers? } }: the models each team's lead and workers run on in this chat, each in order");
    assert.equal(byTeamProblem({ builders: [{ model: "m" }] }), '["builders"] must be { lead?, workers? }, each a list of { model, effort? } rows');
    assert.equal(byTeamProblem({ builders: { crew: [] } }), `["builders"] holds "crew": a team's rows are { lead?, workers? }`);
    assert.equal(byTeamProblem({ builders: { workers: [{ model: "m", seats: 2, most: 1 }] } }), `["builders"].workers [0] holds "most": a row is { model, effort? }`);
  });
});

describe("a list that is an order (U13-D12)", () => {
  test("a row may leave its seats out: its model's limit is its cap, and the line says no count", () => {
    assert.equal(poolProblem([{ model: "a" }, { model: "b" }]), null);
    assert.equal(poolLine(poolOf([{ model: "a" }, { model: "b" }, { model: "" }])), "a · b · the main agent's model");
  });
});

// (fails before: yes — a row's stored seats capped it, the chat's number stood only where set, and the line said each count)
describe("always an order, one number a chat (U13-D15)", () => {
  test("a row's stored seats cap nothing: every row lends as many as its model takes, and the line never says a count", () => {
    assert.deepEqual(poolOf([{ model: "agent/a" }, { model: "b", seats: 3 }]), [{ model: "a", seats: Infinity }, { model: "b", seats: Infinity }]);
    assert.equal(poolLine(poolOf([{ model: "a" }, { model: "b", seats: 3 }, { model: "" }])), "a · b · the main agent's model");
    assert.equal(poolLine(poolOf(DEFAULT_POOL)), "the main agent's model");
  });

  // (fails before: yes — the owner's word of 11-05: "i would remove those 4 limits": a chat ran four unless set, its list's
  // rows 32 at most)
  test("no number of Filament's own: with no model's limit, the rows lend without end", () => {
    const s = seats([{ model: "glm" }, { model: "" }]);
    assert.deepEqual(lent(s), [["glm", Infinity], ["m-main", Infinity]]);
    assert.equal(poolTotal(s), Infinity);
  });
});

describe("the rows as a launch reads them", () => {
  test("the nameless row is the main agent's model; a row that names that model is the same row, at the first one's place", () => {
    const s = seats([{ model: "glm", seats: 4 }, { model: "", seats: 2 }, { model: "m-main", seats: 3 }]);
    assert.deepEqual(s.map((x) => [x.model, x.named, x.own]), [["glm", true, false], ["m-main", true, true]]);
    assert.deepEqual(seats([{ model: "", seats: 2 }]).map((x) => [x.model, x.named, x.own]), [["m-main", false, true]]);
  });

  test("two names of one model are one row where the caller says what they share", () => {
    const key = (/** @type {string} */ m) => m.replace(/-high$/, "");
    const s = seats([{ model: "glm-high", seats: 2 }, { model: "glm", seats: 1 }], { main: "glm", key, running: { glm: 2 } });
    assert.deepEqual(s.map((x) => [x.model, x.key, x.own, x.running]), [["glm-high", "glm", true, 2]]);
  });

  test("a session whose main agent's model is not known yet keeps the nameless row, with no model: it lends without end", () => {
    const s = seats([{ model: "", seats: 3 }], { main: "" });
    assert.deepEqual(s.map((x) => [x.model, x.own, x.lent, x.problem]), [["", false, Infinity, null]]);
    assert.deepEqual(takeSeat(s), { ok: true, model: "", pooled: true, skipped: [] }, "the launch that takes it has no model, and says so");
  });

  // (fails before: yes — AG-234, AG-235: the limit an agent heard was the number typed, whatever its provider took)
  test("a row lends as many as its model's limit; none where the model cannot run; on the main agent's model one call stays the main agent's; with no limit, without end", () => {
    const s = seats(
      [{ model: "glm", seats: 6 }, { model: "flash", seats: 3 }, { model: "gone", seats: 2 }, { model: "", seats: 4 }, { model: "free", seats: 5 }],
      { facts: { glm: { limit: { cap: 4, from: "card" } }, flash: { limit: { cap: 8, from: "headers" } }, gone: { problem: "signed out" }, "m-main": { limit: { cap: 3, from: "card" } } } },
    );
    assert.deepEqual(lent(s), [["glm", 4], ["flash", 8], ["gone", 0], ["m-main", 2], ["free", Infinity]], "a row's old seats cut nothing");
    assert.equal(poolTotal(s.slice(0, 4)), 14);
    assert.equal(poolTotal(s), Infinity);
    // One seat stays whatever the limit: an agent's call waits its turn at the provider.
    assert.deepEqual(lent(seats([{ model: "", seats: 4 }], { facts: { "m-main": { limit: { cap: 1, from: "card" } } } })), [["m-main", 1]]);
    // A limit of nothing is no limit.
    assert.deepEqual(lent(seats([{ model: "glm", seats: 4 }], { facts: { glm: { limit: { cap: 0, from: "card" } } } })), [["glm", Infinity]]);
  });
});

describe("the seat a launch takes", () => {
  const POOL = [{ model: "glm" }, { model: "flash" }, { model: "" }];
  /** Each model's limit, as its provider showed it: glm 2, flash 1, the main agent's 2 — one of them its own. */
  const LIM = { glm: { limit: { cap: 2, from: /** @type {const} */ ("card") } }, flash: { limit: { cap: 1, from: /** @type {const} */ ("card") } }, "m-main": { limit: { cap: 2, from: /** @type {const} */ ("card") } } };
  const FULL = { glm: "glm: 2 running, as many as it takes at once now (its provider takes 2)", flash: "flash: 1 running, as many as it takes at once now (its provider takes 1)", main: "m-main: 1 running, as many as it takes at once now (its provider takes 2, and the main agent runs on it too)" };

  // (fails before: yes — AG-233: every launch that named no model ran on the one model the session named)
  test("a launch that names no model takes the first row from the top with room", () => {
    assert.deepEqual(takeSeat(seats(POOL, { facts: LIM })), { ok: true, model: "glm", pooled: true, skipped: [] });
    assert.deepEqual(takeSeat(seats(POOL, { facts: LIM, running: { glm: 2 } })), { ok: true, model: "flash", pooled: true, skipped: [] });
    assert.deepEqual(takeSeat(seats(POOL, { facts: LIM, running: { glm: 2, flash: 1 } })), { ok: true, model: "m-main", pooled: true, skipped: [] });
    assert.deepEqual(takeSeat(seats(POOL, { facts: LIM, running: { glm: 2, flash: 1, "m-main": 1 } })), { ok: false, error: `every model of this session's pool is busy: ${FULL.glm}; ${FULL.flash}; ${FULL.main}. Wait for one to finish.` });
    // (fails before: yes — the owner's word of 11-05: a row held four, and a chat four, unless someone set more)
    assert.deepEqual(takeSeat(seats(POOL, { running: { glm: 50 } })), { ok: true, model: "glm", pooled: true, skipped: [] }, "no limit: the first row always has room");
  });

  // (fails before: yes — AG-236: a model that could not run failed the launch)
  test("a row that cannot run is skipped, and the launch says which it passed — only those above the one it took", () => {
    const facts = { ...LIM, glm: { problem: "signed out" }, "m-main": { problem: "no route matches it" } };
    assert.deepEqual(takeSeat(seats(POOL, { facts })), { ok: true, model: "flash", pooled: true, skipped: [{ model: "glm", why: "signed out" }] });
    assert.deepEqual(takeSeat(seats(POOL, { facts, running: { flash: 1 } })), { ok: false, error: `every model of this session's pool is busy: ${FULL.flash}. Wait for one to finish.` });
    assert.deepEqual(takeSeat(seats(POOL, { facts: { ...facts, flash: { problem: "it takes no tools" } } })), {
      ok: false,
      error: "no model of this session's pool can run an agent now: glm (signed out); flash (it takes no tools); m-main (no route matches it)",
    });
  });

  // (fails before: yes — AG-233, the plan's AG-14: a card's own model had no seats of its own)
  test("a card's or a launch's own model takes that model's seat where the pool lists it, and is refused, naming the model, where they are all taken", () => {
    assert.deepEqual(takeSeat(seats(POOL, { facts: LIM, running: { glm: 1 } }), { want: "agent/glm", who: "Translator" }), { ok: true, model: "glm", pooled: true, skipped: [] });
    assert.deepEqual(takeSeat(seats(POOL, { facts: LIM, running: { glm: 2 } }), { want: "glm", who: "Translator" }), { ok: false, error: "Translator runs on glm: 2 running, as many as it takes at once now (its provider takes 2). Wait for one to finish." });
    assert.deepEqual(takeSeat(seats(POOL, { facts: LIM, running: { flash: 1 } }), { want: "flash" }), { ok: false, error: `${FULL.flash}. Wait for one to finish.` });
    // The limit that cut it is said with the refusal.
    const cut = seats([{ model: "glm", seats: 4 }], { running: { glm: 2 }, facts: { glm: { limit: { cap: 2, from: "headers" } } } });
    assert.deepEqual(takeSeat(cut, { want: "glm", who: "Translator" }), { ok: false, error: "Translator runs on glm: 2 running, as many as it takes at once now (its provider's rate limit says 2). Wait for one to finish." });
  });

  test("a model the pool does not list takes no row's seat; one that cannot run is the launch's own check to say", () => {
    assert.deepEqual(takeSeat(seats(POOL, { facts: LIM, running: { glm: 2, flash: 1, "m-main": 1 } }), { want: "kimi" }), { ok: true, model: "kimi", pooled: false, skipped: [] });
    assert.deepEqual(takeSeat(seats(POOL, { facts: { glm: { problem: "signed out" } } }), { want: "glm" }), { ok: true, model: "glm", pooled: true, skipped: [] });
  });
});

describe("the words", () => {
  // (fails before: yes — AG-234: nothing said why a session could run fewer than its number)
  test("why a row lends fewer seats than it holds: the limit and who set it; a provider's 429, with how long it holds", () => {
    const [card, headers, hot, own, whole, gone] = seats(
      [{ model: "glm", seats: 6 }, { model: "flash", seats: 6 }, { model: "haiku", seats: 6 }, { model: "", seats: 4 }, { model: "free", seats: 2 }, { model: "gone", seats: 2 }],
      {
        facts: {
          glm: { limit: { cap: 4, from: "card" } },
          flash: { limit: { cap: 2, from: "headers" } },
          haiku: { limit: { cap: 1, from: "429", liftsAt: NOW + 7 * 60_000 - 1 } },
          "m-main": { limit: { cap: 3, from: "card" } },
          gone: { problem: "signed out", limit: { cap: 1, from: "card" } },
        },
      },
    );
    assert.equal(lendsWords(card, NOW), "4 at once: its provider takes 4");
    assert.equal(lendsWords(headers, NOW), "2 at once: its provider's rate limit says 2");
    assert.equal(lendsWords(hot, NOW), "1 at once: its provider said too many, for 7 more minutes");
    assert.equal(lendsWords(hot, NOW + 7 * 60_000 - 30_000), "1 at once: its provider said too many, for 1 more minute");
    assert.equal(lendsWords(own, NOW), "2 at once: its provider takes 3, and the main agent runs on it too");
    assert.deepEqual([lendsWords(whole, NOW), lendsWords(gone, NOW)], ["", ""], "a row with no limit, and one that cannot run, say nothing here");
  });

  test("what a refusal at the session's limit adds: each model that lends fewer for a while, and each that cannot run", () => {
    const s = seats([{ model: "glm", seats: 4 }, { model: "flash", seats: 4 }, { model: "gone", seats: 2 }, { model: "haiku", seats: 2 }], {
      facts: { glm: { limit: { cap: 1, from: "429", liftsAt: NOW + 3 * 60_000 } }, flash: { limit: { cap: 2, from: "card" } }, gone: { problem: "signed out" } },
    });
    assert.equal(poolNote(s, NOW), " glm runs 1 at once: its provider said too many, for 3 more minutes. gone cannot run an agent now (signed out).");
    assert.equal(poolNote(seats([{ model: "flash", seats: 4 }], { facts: { flash: { limit: { cap: 2, from: "card" } } } }), NOW), "", "a limit that stands says nothing: the number is the one the agent knew");
  });

  test("the pool in a line, in the developer's order, with no counts", () => {
    const rows = [{ model: "zai/glm-5.3", seats: 4 }, { model: "", seats: 2 }];
    assert.equal(poolLine(rows), "zai/glm-5.3 · the main agent's model");
    assert.equal(poolLine(rows, { pretty: (m) => m.split("/")[1].toUpperCase(), mainWords: "Main" }), "GLM-5.3 · Main");
  });
});
