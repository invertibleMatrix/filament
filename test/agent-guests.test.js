// @ts-check
// HarnessV4_Tasks E15 step 5 (E12 step 3, V4-D280): a coding agent's own agents — Claude's Agent tool, Codex's child
// thread, Cursor's task — as rows of the session's list (app/agent-guests.js). Filament launched none of them: each is
// read from the run of the turn that started it. One run's events folded into rows; then a session's list across its
// turns' runs: the newest thirty, an ended run read once, a running one read on from where it was. Through the server
// and a fake agent, in acp-run.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createGuests, guestsOfRun, GUESTS_KEPT, GUEST_TURNS } from "../src/app/agent-guests.js";

/** A coding agent's turn that ended. */
const DONE = { id: "r1", kind: "coding-agent", status: "done", endedAt: 9000, meta: { agent: "Claude Code" } };

/** A run's events, numbered as its log numbers them. @param {[string, number, Record<string, any>][]} list @returns {Record<string, any>[]} */
const events = (list) => list.map(([type, ts, more], i) => ({ n: i + 1, ts, type, ...more }));

/** One of the coding agent's own agents, from its start to its end. @param {string} stub @param {number} at @param {Record<string, any>} [end] */
const whole = (stub, at, end = { status: "done", ok: true, ms: 100, report: `${stub} done` }) => /** @type {[string, number, Record<string, any>][]} */ ([
  ["subagent-start", at, { parent: stub, description: `Job ${stub}`, prompt: `Do ${stub}` }],
  ["subagent-end", at + 100, { parent: stub, ...end }],
]);

describe("one turn's run, read for the coding agent's own agents", () => {
  // (fails before: yes — nothing read them: a coding agent's own agent was a card in the chat and nowhere else)
  test("each one it started is a row: whose it is, what it was told, its calls, its end; Filament's own agent is none, and its own agent is a call on it", () => {
    const rows = guestsOfRun(DONE, events([
      ["round-start", 900, { round: 1 }],
      ["subagent-start", 1000, { round: 1, parent: "toolu_1", description: "Map the parser", agent: "Explore", prompt: "Find where tokens are read" }],
      ["subagent-tool-start", 1100, { parent: "toolu_1", id: "c1", name: "Grep" }],
      ["subagent-tool-end", 1200, { parent: "toolu_1", id: "c1", ok: true }],
      ["subagent-held", 1250, { parent: "toolu_1", tokens: 13_400 }],
      ["subagent-held", 1260, { parent: "nobody", tokens: 99 }],
      // Its own agent: a call on its card, never a row.
      ["subagent-tool-start", 1300, { parent: "toolu_1", id: "sa:inner", name: "agent" }],
      ["subagent-words", 1400, { parent: "toolu_1", msg: "m1", text: "Looking." }],
      // An agent Filament launched for the coding agent: Filament's own list holds it.
      ["subagent-start", 1500, { parent: "call_9", agentId: "sa_1", description: "Review it" }],
      ["subagent-end", 1600, { parent: "call_9", agentId: "sa_1", status: "done", ok: true }],
      ["subagent-start", 2000, { round: 2, parent: "sa:t2", description: "Write the tests", model: "gpt-5.5-codex", prompt: "" }],
      ["subagent-end", 5200, { parent: "toolu_1", status: "done", ok: true, ms: 4200, toolCalls: 2, report: "The parser reads tokens in lex.js." }],
    ]));
    assert.deepEqual(rows, [
      { id: "r1~toolu_1", guest: true, of: "Claude Code", run: "r1", stub: "toolu_1", description: "Map the parser", agent: "Explore", model: "", prompt: "Find where tokens are read",
        status: "done", startedAt: 1000, endedAt: 5200, ms: 4200, toolCalls: 2, tokens: 13_400, report: "The parser reads tokens in lex.js.", error: "" },
      // Its turn ended with no word of its end: cut off, when the turn was.
      { id: "r1~sa:t2", guest: true, of: "Claude Code", run: "r1", stub: "sa:t2", description: "Write the tests", agent: "", model: "gpt-5.5-codex", prompt: "",
        status: "aborted", startedAt: 2000, endedAt: 9000, ms: 7000, toolCalls: 0, tokens: null, report: "", error: "" },
    ]);
  });

  // (fails before: yes)
  test("a turn that still runs, or paused, leaves an open one running; each end reads as its own; the model named at the end is kept", () => {
    const open = events([["subagent-start", 1000, { parent: "a", description: "A" }], ["subagent-tool-start", 1100, { parent: "a", id: "c1" }]]);
    assert.deepEqual(guestsOfRun({ ...DONE, status: "running", endedAt: null }, open).map((r) => [r.status, r.endedAt, r.ms, r.toolCalls]), [["running", null, null, 1]]);
    assert.deepEqual(guestsOfRun({ ...DONE, status: "paused" }, open).map((r) => r.status), ["running"], "a paused turn's stay running, as their cards do");
    const ends = guestsOfRun(DONE, events([
      ...whole("a", 1000, { status: "failed", ok: false, error: "it crashed" }),
      ...whole("b", 2000, { status: "stopped", ok: false }),
      ...whole("c", 3000, { status: "budget-stopped", ok: false }),
      ...whole("d", 4000, { status: "aborted", ok: false }),
      ...whole("e", 5000, { ok: true, model: "composer-2" }),
      ...whole("f", 6000, { ok: false }),
    ]));
    assert.deepEqual(ends.map((r) => [r.stub, r.status]), [["a", "failed"], ["b", "stopped"], ["c", "stopped"], ["d", "aborted"], ["e", "done"], ["f", "failed"]]);
    assert.deepEqual([ends[0].error, ends[0].ms, ends[4].model], ["it crashed", 100, "composer-2"], "with no time said, its end's less its start's");
  });

  // (fails before: yes)
  test("Filament's own loop, and a sub-agent's run, have none: every agent there is Filament's", () => {
    const told = events(whole("a", 1000));
    assert.deepEqual(guestsOfRun({ ...DONE, kind: "agent-turn" }, told), []);
    assert.deepEqual(guestsOfRun({ ...DONE, kind: "subagent" }, told), []);
    assert.deepEqual(guestsOfRun(null, told), []);
    assert.deepEqual(guestsOfRun({ ...DONE, meta: null }, told).map((r) => r.of), [""], "a run that names no agent: the page says whose in its own words");
  });
});

describe("a session's list of them, across its turns", () => {
  /**
   * A run log holding the given runs, which records each read of a run's events.
   * @param {Record<string, { meta: any, events: any[] }>} held
   */
  const runLog = (held) => {
    /** @type {[string, number][]} */
    const reads = [];
    return {
      reads,
      held,
      runs: {
        /** @param {string} id */
        hasRun: (id) => id in held,
        /** @param {string} id */
        getRun: (id) => held[id]?.meta ?? null,
        /** @param {string} id @param {{ since?: number, limit?: number }} [o] */
        events: (id, { since = 0, limit = 5000 } = {}) => {
          reads.push([id, since]);
          const run = held[id];
          return run ? { run: run.meta, events: run.events.filter((e) => e.n > since).slice(0, limit) } : null;
        },
      },
    };
  };
  /** @param {string} id @param {Record<string, any>} [over] */
  const meta = (id, over = {}) => ({ ...DONE, id, ...over });

  // (fails before: yes — there was no list)
  test("the newest first: the newest turn's, its newest agent first; from the session's newest fifty turns; thirty at most", () => {
    const log = runLog({
      r3: { meta: meta("r3"), events: events([...whole("a", 3000), ...whole("b", 3500)]) },
      r2: { meta: meta("r2", { kind: "agent-turn" }), events: events(whole("x", 2000)) },
      r1: { meta: meta("r1", { meta: { agent: "Codex" } }), events: events(whole("c", 1000)) },
    });
    /** @type {[string, number][]} */
    const asked = [];
    const guests = createGuests({ runs: log.runs, turnRuns: (chain, limit) => { asked.push([chain, limit]); return chain === "c1" ? ["r3", "r2", "gone", "r1"] : []; } });
    assert.deepEqual(guests.list("c1").map((r) => [r.id, r.of]), [["r3~b", "Claude Code"], ["r3~a", "Claude Code"], ["r1~c", "Codex"]]);
    assert.deepEqual(asked, [["c1", GUEST_TURNS]]);
    assert.deepEqual([GUEST_TURNS, GUESTS_KEPT], [50, 30]);
    assert.deepEqual(guests.list("other"), [], "another session's are its own");

    /** @param {string} id @param {number} n */
    const many = (id, n) => ({ meta: meta(id), events: events(Array.from({ length: n }, (_, i) => whole(`${id}_${i}`, 1000 + i * 200)).flat()) });
    const big = runLog({ t3: many("t3", 20), t2: many("t2", 20), t1: many("t1", 20) });
    const listed = createGuests({ runs: big.runs, turnRuns: () => ["t3", "t2", "t1"] }).list("c1");
    assert.equal(listed.length, 30);
    assert.deepEqual([listed[0].id, listed[19].id, listed[20].id, listed[29].id], ["t3~t3_19", "t3~t3_0", "t2~t2_19", "t2~t2_10"]);
    assert.deepEqual(big.reads.map(([id]) => id), ["t3", "t2"], "a turn older than the thirty is not read");
  });

  // (fails before: yes)
  test("an ended turn's run is read once; a running one is read on from the event it was last read to, and once more when it ends", () => {
    const live = { meta: meta("r2", { status: "running", endedAt: null }), events: events([["subagent-start", 1000, { parent: "a", description: "A" }]]) };
    const log = runLog({ r2: live, r1: { meta: meta("r1"), events: events(whole("old", 500)) } });
    const guests = createGuests({ runs: log.runs, turnRuns: () => ["r2", "r1"] });
    assert.deepEqual(guests.list("c1").map((r) => [r.id, r.status, r.toolCalls]), [["r2~a", "running", 0], ["r1~old", "done", 0]]);
    assert.deepEqual(log.reads, [["r2", 0], ["r1", 0]]);

    live.events.push({ n: 2, ts: 1100, type: "subagent-tool-start", parent: "a", id: "c1" }, { n: 3, ts: 1200, type: "subagent-start", parent: "b", description: "B" });
    log.reads.length = 0;
    assert.deepEqual(guests.list("c1").map((r) => [r.id, r.status, r.toolCalls]), [["r2~b", "running", 0], ["r2~a", "running", 1], ["r1~old", "done", 0]]);
    assert.deepEqual(log.reads, [["r2", 1]], "only what the running turn said since; the ended one is remembered");

    live.events.push({ n: 4, ts: 1300, type: "subagent-end", parent: "a", status: "done", ok: true, ms: 300, toolCalls: 1, report: "A done" });
    live.meta = meta("r2", { status: "stopped", endedAt: 2000 });
    log.reads.length = 0;
    const ended = guests.list("c1");
    assert.deepEqual(ended.map((r) => [r.id, r.status, r.ms]), [["r2~b", "aborted", 800], ["r2~a", "done", 300], ["r1~old", "done", 100]], "the turn's end cut the one it left open");
    assert.deepEqual(log.reads, [["r2", 3]]);
    log.reads.length = 0;
    assert.deepEqual(guests.list("c1"), ended);
    assert.deepEqual(log.reads, [], "an ended turn says the same for good");
  });

  // (fails before: no — a guard: a long turn's log comes a page at a time, and its end is on the last one)
  test("a long turn is read whole, a page at a time", () => {
    const filler = Array.from({ length: 5200 }, (_, i) => /** @type {[string, number, Record<string, any>]} */ (["tool-output", 1001 + i, { id: "x", text: "." }]));
    const log = runLog({ r1: { meta: meta("r1"), events: events([["subagent-start", 1000, { parent: "a", description: "A" }], ...filler, ["subagent-end", 8000, { parent: "a", status: "done", ok: true, ms: 7000 }]]) } });
    const guests = createGuests({ runs: log.runs, turnRuns: () => ["r1"] });
    assert.deepEqual(guests.list("c1").map((r) => [r.status, r.ms]), [["done", 7000]]);
    assert.deepEqual(log.reads, [["r1", 0], ["r1", 5000]]);
  });

  // (fails before: no — a guard the fold's memory asks for: a row handed out is the caller's)
  test("a row handed out never moves under whoever holds it", () => {
    const live = { meta: meta("r1", { status: "running", endedAt: null }), events: events([["subagent-start", 1000, { parent: "a", description: "A" }]]) };
    const log = runLog({ r1: live });
    const guests = createGuests({ runs: log.runs, turnRuns: () => ["r1"] });
    const [before] = guests.list("c1");
    live.events.push({ n: 2, ts: 1100, type: "subagent-tool-start", parent: "a", id: "c1" });
    const [after] = guests.list("c1");
    assert.deepEqual([before.toolCalls, after.toolCalls], [0, 1]);
  });
});
