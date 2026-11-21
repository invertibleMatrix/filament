// @ts-check
// HarnessV4_Tasks A2: a turn a restart cut off keeps what it did. Its work reaches the archive only at a turn's end, so
// a turn whose process died left its first message alone: the model's history, a compaction's summary, memory and a
// fresh agent session's seed never saw its work, and what its coding agent's context held was read off the turn before
// it. Its run log has it. The rebuild (core/run-work.js), the start-up step over a real archive and run log
// (app/sessions/cut-turns.js), how the rebuilt turn rides (shapes.js), the agent's figure (agent-line.js), then a real
// start after a turn left open.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALL_CUT, exchangeOfRun, workOfRun } from "../src/core/run-work.js";
import { LEFT_OPEN, keepCutTurns } from "../src/app/sessions/cut-turns.js";
import { CUT_OFF_LINE, modelTurnsOf, renderTurn, trajectoryProblem } from "../src/app/sessions/shapes.js";
import { agentHeld } from "../src/app/sessions/agent-line.js";
import { Archive } from "../src/services/memory/archive.js";
import { createEventBus } from "../src/services/events.js";
import { createRunLog } from "../src/services/runs.js";
import { textOfMessage } from "../src/core/messages.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

/** @param {string} text */
const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
/** A run event as the log stores one. @param {string} type @param {Record<string, any>} [o] @param {number} [ts] */
const ev = (type, o = {}, ts = 0) => ({ type, ts, ...o });

/** A coding agent's turn two rounds in, cut while its third call ran: what its run log holds. */
const LOGGED = [
  ev("run-start", { kind: "coding-agent" }, 100),
  ev("round-start", { round: 1 }, 110),
  ev("tool-start", { round: 1, id: "c1", name: "Read", args: "src/parser.js" }, 120),
  ev("tool-end", { round: 1, id: "c1", name: "Read", ok: true, preview: "export function parse() {}" }, 130),
  ev("held", { round: 1, tokens: 120_000, window: 200_000, exact: true }, 131),
  ev("tool-start", { round: 1, id: "c2", name: "Bash", args: "npm test" }, 140),
  ev("tool-end", { round: 1, id: "c2", name: "Bash", ok: false, preview: "1 failing" }, 150),
  // A coding agent's round says its words when it closes: after its calls.
  ev("round-text", { round: 1, text: "Reading the parser.", block: 0 }, 151),
  ev("steer", { id: "s1", kind: "note", text: "also fix the lexer", from: "owner" }, 152),
  ev("steer", { id: "s2", kind: "note", text: "a note it never read", from: "owner" }, 153),
  ev("steer", { id: "s3", kind: "veto", text: "a veto is not a note", from: "owner" }, 153),
  ev("steer-read", { ids: ["s1", "s3"], kinds: ["note", "veto"] }, 154),
  ev("round-start", { round: 2 }, 160),
  ev("round-thinking", { round: 2, thinking: "private" }, 161),
  ev("subagent-tool-start", { round: 2, parent: "c3", id: "x1", name: "Grep", args: "lexer" }, 162),
  ev("tool-start", { round: 2, id: "c3", name: "Write", args: "secrets.env" }, 170),
  ev("tool-start", { round: 2, id: "c3", name: "Write", args: "said twice" }, 170),
  ev("tool-start", { round: 2, name: "Nameless", args: "no id" }, 170),
  ev("tool-end", { round: 2, id: "c3", name: "Write", ok: false, refused: true }, 171),
  ev("tool-start", { round: 2, id: "c4", name: "Grep", args: "tokenize" }, 172),
  ev("tool-end", { round: 2, id: "c4", name: "Grep", ok: true }, 173),
  ev("held", { round: 2, tokens: 729_000, window: 1_000_000, exact: true }, 174),
  ev("round-text", { round: 2, text: "Now the lexer.", block: 1 }, 175),
  ev("round-start", { round: 3 }, 180),
  ev("tool-start", { round: 3, id: "c5", name: "Bash", args: "npm run build" }, 190),
];

describe("a turn's work as its run log holds it (core/run-work.js)", () => {
  // (fails before: yes — nothing read a run's events back into a turn's work: HarnessV4_Tasks A2)
  test("each round's words and calls, each call answered by the log's preview of its result; a call with no end says a stop cut it", () => {
    const w = workOfRun(LOGGED);
    assert.deepEqual(w.work, [
      { role: "assistant", content: [{ type: "text", text: "Reading the parser." }, { type: "tool_use", id: "c1", name: "Read", input: { input: "src/parser.js" } }, { type: "tool_use", id: "c2", name: "Bash", input: { input: "npm test" } }] },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "c1", content: "export function parse() {}" },
          { type: "tool_result", tool_use_id: "c2", content: "1 failing", is_error: true },
          { type: "text", text: "also fix the lexer" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Now the lexer." }, { type: "tool_use", id: "c3", name: "Write", input: { input: "secrets.env" } }, { type: "tool_use", id: "c4", name: "Grep", input: { input: "tokenize" } }] },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "c3", content: "(refused: it never ran.)", is_error: true },
          { type: "tool_result", tool_use_id: "c4", content: "(done: the run log kept none of its output.)" },
        ],
      },
      { role: "assistant", content: [{ type: "tool_use", id: "c5", name: "Bash", input: { input: "npm run build" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c5", content: CALL_CUT, is_error: true }] },
    ]);
    assert.deepEqual([w.rounds, w.tools], [3, 5]);
    assert.deepEqual(w.held, { tokens: 729_000, window: 1_000_000, exact: true }, "the newest count of what the agent's context holds");
    const said = JSON.stringify(w.work);
    for (const not of ["never read", "not a note", "private", "x1", "said twice", "Nameless"]) assert.ok(!said.includes(not), `${not}: not a note it never read, a veto, its thinking, a sub-agent's own call, or a call said twice or with no id`);
  });

  test("the work alternates and every call is answered, whatever the log holds: rounds of words alone join, an empty log gives none", () => {
    const words = workOfRun([ev("round-start", { round: 1 }, 5), ev("round-text", { round: 1, text: "Thinking it over." }, 6), ev("round-start", { round: 2 }, 7), ev("round-text", { round: 2, text: "Still thinking." }, 8)]);
    assert.deepEqual(words.work, [{ role: "assistant", content: [{ type: "text", text: "Thinking it over." }, { type: "text", text: "Still thinking." }] }]);
    assert.deepEqual(workOfRun([]), { work: [], rounds: 0, tools: 0, held: null });
    // A note read before the first round is the person's words in front of it: round 0 is no round of the model's.
    const early = workOfRun([ev("steer", { id: "s1", kind: "note", text: "start with the tests" }), ev("steer-read", { ids: ["s1"] }), ev("round-start", { round: 1 }), ev("round-text", { round: 1, text: "On it." })]);
    assert.deepEqual([early.work.map((m) => m.role), early.rounds], [["user", "assistant"], 1]);
    assert.deepEqual(workOfRun([ev("tool-start", { round: 1, id: "n1", name: "TodoRead" })]).work[0].content, [{ type: "tool_use", id: "n1", name: "TodoRead", input: {} }], "a call the log names no target of");
    // Filament's estimate of a context is said as one (the Cursor SDK's); a count of nothing is no count.
    assert.deepEqual(workOfRun([ev("held", { tokens: 5000, window: null, exact: false }, 1), ev("held", { tokens: 0 }, 2)]).held, { tokens: 5000, window: null, exact: false });
    const t = { turnId: 1, n: 1, user: user("go"), work: workOfRun(LOGGED).work, final: { role: "assistant", content: CUT_OFF_LINE }, meta: {} };
    assert.equal(trajectoryProblem(t), null, "valid as a trajectory: roles alternate, no call without its result");
  });
});

const dir = mkdtempSync(join(tmpdir(), "filament-cut-turns-"));
// The archive is read untyped, as its own tests read it: the class's JSDoc has not landed.
/** @type {any[]} */
const opened = [];
after(async () => {
  for (const a of opened) a.close();
  await removeDirs(dir);
});
const knobs = () => ({ observability: { runEvents: { persist: true, retentionDays: 7, maxPerRun: 5000, keepRuns: 50, toolPreviewChars: 2000 } } });
let seq = 0;

/**
 * What a process that died leaves: an archive with one finished turn and others begun, and a run log the turns' runs
 * were written to and never ended. → the archive, and a second process's run log over the same folder.
 * @param {(a: any, chain: string, log: ReturnType<typeof createRunLog>, bus: ReturnType<typeof createEventBus>) => void} during
 */
function crashed(during) {
  const home = join(dir, `p${++seq}`);
  mkdirSync(home);
  /** @type {any} */
  const a = new Archive({ file: join(home, "archive.db") });
  opened.push(a);
  const chain = a.chainForKey("h:cut", { cwd: home, client: "harness", model: "ag/fake" }).id;
  const done = a.beginTurn(chain, { requestId: "r-done", model: "ag/fake", upstream: "ag", client: "harness", window: "harness", userMessage: user("turn 1") });
  a.finishTurn(done.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: "done 1" }] } });
  const bus = createEventBus();
  const first = createRunLog({ events: bus, dataDir: home, config: knobs });
  during(a, chain, first, bus);
  first.close();
  /** @type {any[]} */
  const ops = [];
  return { a, chain, ops, home, runs: createRunLog({ events: createEventBus(), dataDir: home, config: knobs, ops: { record: (/** @type {string} */ kind, /** @type {string} */ title) => ops.push({ kind, title }) } }) };
}
/** A turn a request still ran. @param {any} a @param {string} chain @param {string} requestId @param {string} text @param {Record<string, any>} [o] */
const running = (a, chain, requestId, text, o = {}) => a.beginTurn(chain, { requestId, model: "ag/fake", upstream: "ag", client: "harness", window: "harness", running: true, userMessage: user(text), ...o }).turnId;
/** Publish a run's logged events. @param {ReturnType<typeof createEventBus>} bus @param {string} id @param {any[]} events */
const publish = (bus, id, events) => {
  for (const { ts, ...e } of events) if (e.type !== "run-start") bus.publish(`run:${id}`, e);
};

describe("at start: the turns the last process left running (app/sessions/cut-turns.js)", () => {
  // (fails before: yes — a cut turn kept its first message alone, its run stayed open on disk for ever: A2)
  test("a coding agent's cut turn gets the work its run logged and a cut mark with the agent's last count; its run is ended; a second start changes nothing", async () => {
    let turnId = 0;
    const { a, chain, runs, ops, home } = crashed((arch, c, log, bus) => {
      turnId = running(arch, c, "r-cut", "turn 2: refactor the parser");
      log.startRun({ id: "r-cut", kind: "coding-agent", meta: { engine: "acp", upstream: "ag", model: "fake", chain: c } });
      publish(bus, "r-cut", LOGGED);
    });
    assert.deepEqual(await keepCutTurns({ runs, archive: a }), { kept: 1, closed: 1 });
    const t = a.turnBodies(chain).at(-1);
    assert.deepEqual(t?.work.map((/** @type {any} */ m) => m.role), ["assistant", "user", "assistant", "user", "assistant", "user"]);
    assert.deepEqual(t?.work, workOfRun(LOGGED).work, "the work the log holds, in the archive");
    const cut = t?.meta.cut;
    assert.deepEqual([cut.run, cut.rounds, cut.tools, cut.logged, cut.held], ["r-cut", 3, 5, 6, { upstream: "ag", tokens: 729_000, window: 1_000_000, exact: true }]);
    assert.ok(cut.at > 0, "when it was last alive");
    assert.deepEqual([t?.final, t?.endedAt, Number(t?.meta.running) > 0], [null, null, true], "still open and still marked: a turn a restart cut off, as before");
    const run = runs.getRun("r-cut");
    assert.deepEqual([run?.status, run?.summary], ["aborted", { error: LEFT_OPEN }]);
    assert.ok(ops.some((o) => /r-cut ended: aborted — left open by the last stop/.test(o.title)));
    assert.deepEqual(await keepCutTurns({ runs, archive: a }), { kept: 0, closed: 0 }, "once");
    assert.equal(a.getTurn(turnId).work.length, 6);
    // Retried, and the process died again: the second run's work follows the first's. Its log counted nothing, so
    // the agent's last count is still the first cut's; and the turn still never rides raw.
    const bus = createEventBus();
    const second = createRunLog({ events: bus, dataDir: home, config: knobs });
    assert.equal(running(a, chain, "r-again", "turn 2: refactor the parser"), turnId, "the same turn, gone on with");
    second.startRun({ id: "r-again", kind: "coding-agent", meta: { engine: "acp", upstream: "ag", model: "fake", chain } });
    publish(bus, "r-again", [ev("round-start", { round: 1 }), ev("tool-start", { round: 1, id: "d1", name: "Read", args: "src/lexer.js" })]);
    second.close();
    runs.close();
    const third = createRunLog({ events: createEventBus(), dataDir: home, config: knobs });
    assert.deepEqual(await keepCutTurns({ runs: third, archive: a }), { kept: 1, closed: 1 });
    const again = a.turnBodies(chain).at(-1);
    assert.deepEqual(again?.work.map((/** @type {any} */ m) => m.role), ["assistant", "user", "assistant", "user", "assistant", "user", "assistant", "user"]);
    assert.deepEqual([again?.meta.cut.run, again?.meta.cut.rounds, again?.meta.cut.tools, again?.meta.cut.logged, again?.meta.cut.held.tokens], ["r-again", 1, 1, 8, 729_000]);
    third.close();
  });

  test("Filament's own loop's turn too; work an earlier leg archived stays in front; nothing logged leaves the turn its message, marked", async () => {
    const { a, chain, runs } = crashed((arch, c, log, bus) => {
      const id = running(arch, c, "r-leg1", "turn 2: a turn of two legs");
      arch.addWork(id, [{ role: "assistant", content: [{ type: "tool_use", id: "a1", name: "ask", input: { question: "which?" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "a1", content: "the second" }] }]);
      // Its second request went on with it: the same turn, another run.
      running(arch, c, "r-leg2", "turn 2: a turn of two legs");
      log.startRun({ id: "r-leg2", kind: "agent-turn", meta: { model: "m-1", chain: c } });
      publish(bus, "r-leg2", [ev("round-start", { round: 1 }), ev("round-text", { round: 1, text: "Editing." }), ev("tool-start", { round: 1, id: "e1", name: "edit", args: "a.js" })]);
    });
    assert.deepEqual(await keepCutTurns({ runs, archive: a }), { kept: 1, closed: 1 });
    const t = a.turnBodies(chain).at(-1);
    assert.deepEqual(t?.work.map((/** @type {any} */ m) => [m.role, m.content[0].type]), [["assistant", "tool_use"], ["user", "tool_result"], ["assistant", "text"], ["user", "tool_result"]]);
    assert.deepEqual([t?.meta.cut.logged, t?.meta.cut.held], [2, undefined], "the loop counts no agent's context");
    runs.close();

    const bare = crashed((arch, c, log) => {
      running(arch, c, "r-bare", "turn 2: cut before its first round");
      log.startRun({ id: "r-bare", kind: "agent-turn", meta: { chain: c } });
    });
    assert.deepEqual(await keepCutTurns({ runs: bare.runs, archive: bare.a }), { kept: 1, closed: 1 });
    const b = bare.a.turnBodies(bare.chain).at(-1);
    assert.deepEqual([b?.work, b?.meta.cut.logged, b?.meta.cut.rounds], [[], 0, 0]);
    bare.runs.close();
  });

  test("only a turn a restart cut off: not an outside client's, not one whose request had closed or that failed, not one with its reply, not another session's — their runs are ended all the same, with or without an archive", async () => {
    const { a, chain, runs } = crashed((arch, c, log, bus) => {
      const start = (/** @type {string} */ id, /** @type {any} */ meta = { chain: c }) => {
        log.startRun({ id, kind: "agent-turn", meta });
        publish(bus, id, [ev("round-start", { round: 1 }), ev("tool-start", { round: 1, id: `${id}-c`, name: "read", args: "a.js" })]);
      };
      // An outside client's conversation is the client's own.
      running(arch, c, "r-outside", "turn 2: from OpenCode", { client: "opencode", window: "w:opencode" });
      start("r-outside");
      // Its request closed before the process died: no mark, so no restart cut it off.
      arch.beginTurn(c, { requestId: "r-closed", client: "harness", window: "harness", userMessage: user("turn 3: failed before") });
      start("r-closed");
      const fin = running(arch, c, "r-answered", "turn 4: answered");
      arch.finishTurn(fin, { finalMessage: { role: "assistant", content: [{ type: "text", text: "done 4" }] } });
      start("r-answered");
      // Failed as the process died: its work was archived with why, and its request's mark had not been cleared yet.
      arch.mergeTurnMeta(running(arch, c, "r-failed", "turn 5: failed at the end"), { failed: { at: 1, cause: "the provider refused it" } });
      start("r-failed");
      start("r-elsewhere", { chain: "no-such-session" });
      start("r-nameless", {});
      // A sub-agent's run is its registry's to settle (server.js).
      log.startRun({ id: "r-sub", kind: "subagent", meta: { chain: c, subagent: "sa_1" } });
    });
    assert.deepEqual(await keepCutTurns({ runs, archive: a }), { kept: 0, closed: 6 });
    assert.deepEqual(a.turnBodies(chain).map((/** @type {any} */ t) => [t.n, t.work.length, t.meta.cut]), [[1, 0, undefined], [2, 0, undefined], [3, 0, undefined], [4, 0, undefined], [5, 0, undefined]]);
    assert.equal(runs.getRun("r-sub")?.status, "unknown", "left for its own start-up step");
    runs.close();

    const none = crashed((arch, c, log) => {
      running(arch, c, "r-cut", "turn 2");
      log.startRun({ id: "r-cut", kind: "coding-agent", meta: { chain: c } });
    });
    assert.deepEqual(await keepCutTurns({ runs: none.runs, archive: null }), { kept: 0, closed: 1 }, "no archive: nothing to keep, the run still ends");
    none.runs.close();
  });

  test("a turn whose work could not be written keeps its run open, said in the log: the next start tries again", async () => {
    const { a, chain, runs } = crashed((arch, c, log, bus) => {
      running(arch, c, "r-cut", "turn 2");
      log.startRun({ id: "r-cut", kind: "agent-turn", meta: { chain: c } });
      publish(bus, "r-cut", [ev("round-start", { round: 1 }), ev("tool-start", { round: 1, id: "c1", name: "read", args: "a.js" })]);
    });
    /** @type {string[]} */
    const said = [];
    /** @type {any} */ (a).addWork = () => {
      throw new Error("disk full");
    };
    assert.deepEqual(await keepCutTurns({ runs, archive: a, log: (level, msg) => said.push(`${level}: ${msg}`) }), { kept: 0, closed: 0 });
    assert.deepEqual(said, ["warn: sessions: the work of the turn a restart cut off (run r-cut) could not be kept: disk full"]);
    assert.equal(runs.getRun("r-cut")?.status, "unknown", "still open on disk");
    delete (/** @type {any} */ (a).addWork);
    assert.deepEqual(await keepCutTurns({ runs, archive: a }), { kept: 1, closed: 1 });
    assert.equal(a.turnBodies(chain).at(-1)?.work.length, 2);
    runs.close();
  });
});

describe("how a rebuilt turn rides (shapes.js, agent-line.js)", () => {
  const BOOT = 10_000;
  const work = workOfRun(LOGGED).work;
  const cutTurn = (/** @type {Record<string, any>} */ cut) => ({ turnId: 2, n: 2, startedAt: 2000, user: user("turn 2: refactor the parser"), work, final: null, meta: { running: 2000, cut } });

  // (fails before: yes — a rebuilt turn is a valid trajectory, so it rode raw: each call's input the log's clipped
  // target, as if the model had written it)
  test("never raw: a call's input is the log's target, not what the model wrote, so the turn folds — a line for each call, Filament's line as its reply", () => {
    const [t] = modelTurnsOf([cutTurn({ run: "r", logged: work.length })], BOOT);
    assert.match(String(trajectoryProblem(t)), /rebuilt from its run log/);
    const r = renderTurn(t, "raw");
    assert.deepEqual([r.kind, r.fallback], ["fold", "its work was rebuilt from its run log after a restart cut it off"]);
    const said = r.messages.map(textOfMessage).join("\n");
    assert.match(said, /Reading the parser\.[\s\S]*src\/parser\.js[\s\S]*npm test[\s\S]*npm run build[\s\S]*cut off before its reply/);
    assert.ok(!JSON.stringify(r.messages).includes("tool_use"), "no call rides as one");
    // One the log held nothing of is its message and Filament's line, raw as before.
    const [bare] = modelTurnsOf([{ ...cutTurn({ run: "r", logged: 0 }), work: [] }], BOOT);
    assert.equal(renderTurn(bare, "raw").kind, "raw");
  });

  // (fails before: yes — a cut turn said nothing, so the meter, the line and the resume question read the turn before
  // it: HarnessV3-RunawayTurns A6, 347,332 where the agent held about 729,000)
  test("what the agent holds: a cut turn's last count, where its run log kept one; a cut turn that kept none still says nothing", () => {
    const facts = { upstream: "ag", context: { held: 347_332, window: 1_000_000, source: "agent" } };
    const before = { turnId: 1, n: 1, startedAt: 1000, endedAt: 1500, user: user("turn 1"), work: [], final: { role: "assistant", content: "done" }, meta: { facts } };
    const held = { upstream: "ag", tokens: 729_000, window: 1_000_000, exact: true };
    const o = { compactions: [], upstream: "ag", window: 200_000 };
    assert.deepEqual(agentHeld({ ...o, turns: modelTurnsOf([before, cutTurn({ run: "r", at: 9000, logged: 6, held })], BOOT) }), { held: 729_000, window: 1_000_000, estimated: false, endedAt: 9000 });
    assert.deepEqual(agentHeld({ ...o, turns: modelTurnsOf([before, cutTurn({ run: "r", at: 9000, logged: 6 })], BOOT) }), { held: 347_332, window: 1_000_000, estimated: false, endedAt: 1500 }, "no count in its log: the newest finished turn's word");
    const estimate = agentHeld({ ...o, turns: modelTurnsOf([before, cutTurn({ run: "r", at: 9000, logged: 6, held: { ...held, window: null, exact: false } })], BOOT) });
    assert.deepEqual(estimate, { held: 729_000, window: 200_000, estimated: true, endedAt: 9000 }, "a window the agent did not name: Filament's; an estimate says so");
    assert.equal(agentHeld({ ...o, upstream: "other", turns: modelTurnsOf([before, cutTurn({ run: "r", at: 9000, logged: 6, held })], BOOT) }), null, "another agent ran it: the next turn starts a fresh session");
    assert.equal(agentHeld({ ...o, compactions: [{ created_at: 5000, method: "summary" }], turns: modelTurnsOf([before, cutTurn({ run: "r", at: 9000, logged: 6, held })], BOOT) }), null, "Filament compacted since it began: a fresh session from that");
  });
});

describe("through the app: a start after a turn was left running", () => {
  // (fails before: yes — the next message's history held the cut turn's first message and Filament's line alone)
  test("the session's next message carries what the cut turn did, the page's transcript has its work, and its run reads ended", async () => {
    const up = await fakeUpstream(() => anthropicReply("DONE", { model: "m-1" }));
    const folder = mkdtempSync(join(tmpdir(), "filament-cut-turns-cwd-"));
    const configure = (/** @type {any} */ cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
      // What a start keeps of a cut turn, with the person's own next message: Filament going on by itself is
      // resume-cut.test.js's (HarnessV3-TaskGraph-v2 TG2-D83).
      cfg.sessions = { ...cfg.sessions, resumeAfterRestart: false };
    };
    let shim = await startApp({ memory: true, keep: true, configure });
    const dataDir = shim.dataDir;
    try {
      const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain" } })).json()).id);
      const say = (/** @type {string} */ content) => shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content, stream: false } });
      const one = await say("turn 1: hello");
      assert.equal(one.status, 200, await one.clone().text());
      // A real turn's run: its start line is what a crash leaves, and the archive finds its turn by the run's id.
      const runId = String(one.headers.get("x-filament-request-id"));
      const start = JSON.parse(readFileSync(join(dataDir, "runs", `${runId}.jsonl`), "utf8").split("\n")[0]);
      /** @type {any} */
      const archive = shim.app.memory.archive;
      assert.deepEqual([start.type, start.kind, start.meta.chain], ["run-start", "agent-turn", id]);
      assert.equal(archive.getTurn(archive.turnOfRequest(id, runId)).n, 1, "a run's id is its turn's request");
      // What a crash leaves in the archive: the next turn begun, a request still running it.
      archive.beginTurn(id, { requestId: "cut-run", model: "m-1", upstream: "m", client: "harness", window: "harness", running: true, userMessage: user("turn 2: refactor the parser") });
      await shim.stop();
      // …and in the run log: that turn's run, two rounds in, no end.
      const logged = [{ ...start, runId: "cut-run" }, ...LOGGED.slice(1).map((e, i) => ({ ...e, n: i + 2, seq: 0, ts: start.ts + i + 1, runId: "cut-run" }))];
      writeFileSync(join(dataDir, "runs", "cut-run.jsonl"), logged.map((e) => JSON.stringify(e)).join("\n") + "\n");

      shim = await startApp({ memory: true, keep: true, dataDir, configure });
      const tr = await (await shim.api(`/api/sessions/${id}/transcript`)).json();
      const cut = tr.turns.find((/** @type {any} */ t) => t.n === 2);
      assert.deepEqual([cut.open, cut.cutOff, cut.work.length], [true, true, 6], "still a turn a restart cut off, now with its work");
      // (fails before: yes — HarnessV4_Tasks U1: the transcript said the cut and nothing of what was kept, and a
      // rebuilt call's card named no target: "Read", "Run")
      assert.deepEqual(cut.cut, { rounds: 3, tools: 5, logged: 6 }, "what the next start kept of it, for the page's line");
      assert.deepEqual(cut.tools.map((/** @type {any} */ t) => `${t.card.title} ${t.card.subject}`), ["Read src/parser.js", "Run npm test", "Write secrets.env", "Search tokenize", "Run npm run build"], "each card names the target its run's log kept");
      assert.equal(tr.turns.find((/** @type {any} */ t) => t.n === 1).cut, undefined, "a finished turn says none");
      const { run } = await (await shim.api("/api/runs/cut-run")).json();
      assert.deepEqual([run.status, run.summary], ["aborted", { error: LEFT_OPEN }]);
      const mark = up.received.length;
      const three = await say("turn 3: go on");
      assert.equal(three.status, 200, await three.clone().text());
      const history = up.received.slice(mark)[0].body.messages.map(textOfMessage).join("\n");
      assert.match(history, /turn 2: refactor the parser[\s\S]*Reading the parser\.[\s\S]*src\/parser\.js[\s\S]*npm run build[\s\S]*cut off before its reply[\s\S]*turn 3: go on/);
      await shim.stop();

      shim = await startApp({ memory: true, keep: true, dataDir, configure });
      const again = await (await shim.api(`/api/sessions/${id}/transcript`)).json();
      assert.equal(again.turns.find((/** @type {any} */ t) => t.n === 2).work.length, 6, "a later start adds nothing");
    } finally {
      await shim.stop();
      await up.close();
      await removeDirs(dataDir, folder);
    }
  });

  test("the server keeps the cut turns as memory opens, before a request that reads a session goes on, and ends a sub-agent's open run in the same words", () => {
    const src = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
    const open = src.indexOf("const openMemory = async () => {");
    const at = src.indexOf("keepCutTurns({");
    assert.ok(open > 0 && at > open && at < src.indexOf("const afterListening = "), "in memory's open");
    assert.match(src, /wentOver = await \(openingNow = openMemory\(\)\);\s*\} finally \{\s*opened = true;\s*openedNow\(wentOver\);/, "the requests waiting at the front door go on once it has ended");
    assert.match(src, /runs\.closeOnDisk\(o\.id, \{ status: "aborted", summary: \{ error: LEFT_OPEN \} \}\)/);
  });
});

// (fails before: yes — V4-D82: nothing read a sub-agent's run log as the end of its exchange)
test("a sub-agent's run log read as its exchange's end: its status as an exchange says it, the counts its end gave or the log's own, its last words as the report; none while the log shows no end", () => {
  const START = { n: 1, ts: 1000, type: "run-start", kind: "subagent", meta: { subagent: "sa_1", chain: "c1" } };
  const BODY = [
    { n: 2, ts: 1100, type: "round-start", round: 1 },
    { n: 3, ts: 1200, type: "round-text", round: 1, text: "Reading the parser." },
    { n: 4, ts: 1300, type: "tool-start", round: 1, id: "u1", name: "read", args: "src/parser.js" },
    { n: 5, ts: 1400, type: "tool-end", round: 1, id: "u1", ok: true },
    { n: 6, ts: 1500, type: "round-start", round: 2 },
    { n: 7, ts: 1600, type: "round-text", round: 2, text: "  " },
  ];
  assert.equal(exchangeOfRun([START, ...BODY]), null, "it still runs");
  assert.equal(exchangeOfRun(BODY), null, "not a run's log");
  assert.equal(exchangeOfRun([]), null);
  const done = exchangeOfRun([START, ...BODY, { n: 8, ts: 1700, type: "round-text", round: 2, text: "Found 3 callers." }, { n: 9, ts: 9000, type: "run-end", status: "done", summary: { rounds: 2, toolCalls: 1, inputTokens: 900, outputTokens: 100 } }]);
  assert.deepEqual(done, { status: "done", startedAt: 1000, endedAt: 9000, ms: 8000, rounds: 2, toolCalls: 1, tokensIn: 900, tokensOut: 100, report: "Found 3 callers.", error: null, failure: null });
  // One the next start had to close: no summary of its own, so the log's rounds and calls are counted, and its
  // newest words that said anything stand as its report.
  const cut = exchangeOfRun([START, ...BODY, { n: 8, ts: 5000, type: "run-end", status: "aborted", summary: { error: LEFT_OPEN } }]);
  assert.deepEqual(cut, { status: "aborted", startedAt: 1000, endedAt: 5000, ms: 4000, rounds: 2, toolCalls: 1, tokensIn: 0, tokensOut: 0, report: "Reading the parser.", error: LEFT_OPEN, failure: null });
  const failure = { head: "round 2's model call failed", more: "HTTP 500." };
  const failed = exchangeOfRun([START, { n: 2, ts: 2000, type: "run-end", status: "error", summary: { rounds: 0, toolCalls: 0, error: "round 2's model call failed HTTP 500.", failure } }]);
  assert.deepEqual([failed?.status, failed?.error, failed?.failure, failed?.report], ["failed", "round 2's model call failed HTTP 500.", failure, ""], "a run's error is an exchange's failed");
  assert.equal(exchangeOfRun([START, ...BODY, { n: 8, ts: 5000, type: "run-end", status: "stopped" }])?.status, "stopped");
  const long = exchangeOfRun([START, { n: 2, ts: 1100, type: "round-text", round: 1, text: "x".repeat(50) }, { n: 3, ts: 2000, type: "run-end", status: "done" }], { chars: 10 });
  assert.equal(long?.report, `${"x".repeat(10)}…`, "clipped as a card's report is");
});
