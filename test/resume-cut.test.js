// @ts-check
// HarnessV3-TaskGraph-v2 TG2-D83: a turn a restart cut off goes on by itself. The bench's two runs left 18 of 18 restarts
// waiting for a message. At the next start Filament sends the chat a turn of its own, through the route a message
// takes: which turns (resume-cut.js `resumePlan`), the send and what a refusal leaves (`resumeCutTurns`), the turn
// itself (sessions/service.js `resume`), what the page says (labels.js), then a real restart through the app.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keepCutTurns } from "../src/app/sessions/cut-turns.js";
import { CUT_AGAIN, FLOW_WAITS, RESUME_LINE, RUNNING_AT_STOP, TEAM_WAITS, isResumeMessage, noteRunningAtStop, resumePlan, resumeCutTurns, stoppedTurns, takeRunningAtStop } from "../src/app/sessions/resume-cut.js";
import { Archive } from "../src/services/memory/archive.js";
import { createEventBus } from "../src/services/events.js";
import { createRunLog } from "../src/services/runs.js";
import { textOfMessage } from "../src/core/messages.js";
import { openTurnWords, RESUMED_WORDS } from "../src/ui/harness/lib/labels.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

/** @param {string} text */
const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
/** A run event as the log stores one. @param {string} type @param {Record<string, any>} [o] @param {number} [ts] */
const ev = (type, o = {}, ts = 0) => ({ type, ts, ...o });
/** A loop's turn two calls in, cut while its second round ran. */
const LOGGED = [
  ev("run-start", { kind: "agent-turn" }, 100),
  ev("round-start", { round: 1 }, 110),
  ev("tool-start", { round: 1, id: "c1", name: "read", args: "src/sheet.js" }, 120),
  ev("tool-end", { round: 1, id: "c1", name: "read", ok: true, preview: "export function sheet() {}" }, 130),
  ev("round-text", { round: 1, text: "Reading the sheet.", block: 0 }, 131),
  ev("round-start", { round: 2 }, 140),
  ev("tool-start", { round: 2, id: "c2", name: "write", args: "src/sheet.js" }, 150),
];
/** A resumed turn cut before it ran a call: its round started, nothing more. */
const NOTHING = [ev("run-start", { kind: "agent-turn" }, 100), ev("round-start", { round: 1 }, 110)];

const dir = mkdtempSync(join(tmpdir(), "filament-resume-cut-"));
/** @type {any[]} */
const opened = [];
after(async () => {
  for (const a of opened) a.close();
  await removeDirs(dir);
});
const knobs = () => ({ observability: { runEvents: { persist: true, retentionDays: 7, maxPerRun: 5000, keepRuns: 50, toolPreviewChars: 2000 } } });
let seq = 0;
/** Publish a run's logged events. @param {ReturnType<typeof createEventBus>} bus @param {string} id @param {any[]} events */
const publish = (bus, id, events) => {
  for (const { ts, ...e } of events) if (e.type !== "run-start") bus.publish(`run:${id}`, e);
};
/**
 * What a process that died leaves (cut-turns.test.js's): an archive with a finished turn, and a run log the turns `during`
 * began were written to and never ended. → the archive, its chain, and a second process's run log over the same folder.
 * @param {(a: any, chain: string, log: ReturnType<typeof createRunLog>, bus: ReturnType<typeof createEventBus>) => void} during
 */
function crashed(during) {
  const home = join(dir, `p${++seq}`);
  mkdirSync(home);
  /** @type {any} */
  const a = new Archive({ file: join(home, "archive.db") });
  opened.push(a);
  const chain = a.chainForKey(`h:resume${seq}`, { cwd: home, client: "harness", model: "m-1" }).id;
  const done = a.beginTurn(chain, { requestId: "r-done", model: "m-1", upstream: "m", client: "harness", window: "harness", userMessage: user("turn 1") });
  a.finishTurn(done.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: "done 1" }] } });
  const bus = createEventBus();
  const first = createRunLog({ events: bus, dataDir: home, config: knobs });
  during(a, chain, first, bus);
  first.close();
  return { a, chain, runs: createRunLog({ events: createEventBus(), dataDir: home, config: knobs }) };
}
/**
 * A turn a request ran when the process died, and its run's log; `more`, what else its row was begun with (who began
 * it: `by`). @param {any} a @param {string} chain @param {any} log @param {any} bus @param {string} id @param {any} message
 * @param {any[]} events @param {Record<string, any>} [more]
 */
const cutTurn = (a, chain, log, bus, id, message, events, more = {}) => {
  const turnId = a.beginTurn(chain, { requestId: id, model: "m-1", upstream: "m", client: "harness", window: "harness", running: true, userMessage: message, ...more }).turnId;
  log.startRun({ id, kind: "agent-turn", meta: { model: "m-1", chain } });
  publish(bus, id, events);
  return turnId;
};
/** The turns keepCutTurns kept, as the server collects them. @param {any} runs @param {any} a */
const keptOf = async (runs, a) => {
  /** @type {any[]} */
  const kept = [];
  await keepCutTurns({ runs, archive: a, onKept: (k) => kept.push(k) });
  return kept;
};

describe("which cut turns go on (resume-cut.js resumePlan)", () => {
  test("the message Filament sends is its own, known again in the archive whatever rode ahead of it", () => {
    assert.match(RESUME_LINE, /^\[Filament: Filament restarted while your last turn was running/);
    assert.equal(isResumeMessage(user(RESUME_LINE)), true);
    assert.equal(isResumeMessage({ role: "user", content: RESUME_LINE }), true, "a string's content");
    assert.equal(isResumeMessage({ role: "user", content: [{ type: "text", text: "a sub-agent's report" }, { type: "text", text: RESUME_LINE }] }), true, "a delivery ahead of it");
    assert.equal(isResumeMessage(user("go on")), false);
    assert.equal(isResumeMessage(user(`${RESUME_LINE} and more`)), false, "the person's own words are never it");
    assert.equal(isResumeMessage(null), false);
  });

  // (fails before: yes — nothing went on with a turn a restart cut off: 18 of 18 restarts waited for a message)
  test("a cut turn goes on, marked going; with the switch off nothing does and nothing is marked", async () => {
    let turnId = 0;
    const { a, chain, runs } = crashed((arch, c, log, bus) => {
      turnId = cutTurn(arch, c, log, bus, "r-cut", user("turn 2: build the sheet"), LOGGED);
    });
    const kept = await keptOf(runs, a);
    assert.deepEqual(kept.map((k) => [k.chainId, k.turnId, k.tools]), [[chain, turnId, 2]], "keepCutTurns names each turn it kept, with the calls its log shows");
    assert.deepEqual(resumePlan({ archive: a, kept, on: false }), [], "off: none");
    assert.equal(a.getTurn(turnId).meta.cut.resume, undefined, "off: the mark is today's");
    assert.deepEqual(resumePlan({ archive: a, kept, on: true }), [{ chainId: chain, turnId }]);
    assert.equal(a.getTurn(turnId).meta.cut.resume, "going");
    assert.deepEqual([a.getTurn(turnId).meta.cut.rounds, a.getTurn(turnId).meta.cut.tools], [2, 2], "the rest of the mark stays");
    runs.close();
  });

  test("a resumed turn cut again before it ran a call stays cut, said; one cut after it ran calls goes on again", async () => {
    let idle = 0;
    const one = crashed((arch, c, log, bus) => {
      idle = cutTurn(arch, c, log, bus, "r-idle", user(RESUME_LINE), NOTHING, { by: "resume" });
    });
    assert.deepEqual(resumePlan({ archive: one.a, kept: await keptOf(one.runs, one.a), on: true }), [], "it would loop on whatever stopped Filament");
    assert.deepEqual(one.a.getTurn(idle).meta.cut.resume, { held: "it was cut again before it ran anything, and going on again could loop on what stopped Filament" });
    one.runs.close();
    let worked = 0;
    const two = crashed((arch, c, log, bus) => {
      worked = cutTurn(arch, c, log, bus, "r-worked", user(RESUME_LINE), LOGGED, { by: "resume" });
    });
    assert.deepEqual(resumePlan({ archive: two.a, kept: await keptOf(two.runs, two.a), on: true }).map((p) => p.turnId), [worked]);
    two.runs.close();
  });

  test("a resume is known by its row's mark; one begun before the archive kept marks, by its line", async () => {
    let old = 0;
    const before = crashed((arch, c, log, bus) => {
      old = cutTurn(arch, c, log, bus, "r-old", user(RESUME_LINE), NOTHING, { startedAt: 1 });
    });
    assert.ok(Number(before.a.bySince()) > 1, "the archive keeps marks from its first open on");
    assert.deepEqual(resumePlan({ archive: before.a, kept: await keptOf(before.runs, before.a), on: true }), [], "held, as before");
    assert.deepEqual(before.a.getTurn(old).meta.cut.resume, { held: CUT_AGAIN });
    before.runs.close();
    // The person's message that pastes the line, on a row with no mark, is theirs: a cut turn of theirs goes on.
    let pasted = 0;
    const theirs = crashed((arch, c, log, bus) => {
      pasted = cutTurn(arch, c, log, bus, "r-pasted", user(RESUME_LINE), NOTHING);
    });
    assert.deepEqual(resumePlan({ archive: theirs.a, kept: await keptOf(theirs.runs, theirs.a), on: true }).map((p) => p.turnId), [pasted]);
    theirs.runs.close();
  });

  test("the newest turn of its chat alone: a cut turn something came after stays as it is", async () => {
    let older = 0;
    const { a, chain, runs } = crashed((arch, c, log, bus) => {
      older = cutTurn(arch, c, log, bus, "r-old", user("turn 2"), LOGGED);
      arch.beginTurn(c, { requestId: "r-new", model: "m-1", upstream: "m", client: "harness", window: "harness", userMessage: user("turn 3") });
    });
    assert.deepEqual(resumePlan({ archive: a, kept: await keptOf(runs, a), on: true }), []);
    assert.equal(a.getTurn(older).meta.cut.resume, undefined);
    assert.ok(chain);
    runs.close();
  });

  // (fails before: yes — found by the Bug Hunter, 10-19: a team beside a chat went on by itself after a restart,
  // spending without the person's Send, where its card was to say it stopped, with Resume… — team_v2_plan §9 Q8)
  test("a team beside a chat never goes on by itself: a restart's cut and a clean stop's failure are both held, marked so its card offers Resume…", async () => {
    /** @type {Record<string, number>} */
    const ids = {};
    /** @type {string[]} */
    const teams = [];
    const { a, runs } = crashed((arch, c, log, bus) => {
      const team = arch.chainForKey("h:team-cut", { cwd: dir, client: "harness", model: "m-1", kind: "team" }).id;
      teams.push(team);
      ids.cut = cutTurn(arch, team, log, bus, "r-team", user("find bugs in the last 5 phases"), LOGGED);
    });
    assert.equal(a.getChain(teams[0]).kind, "team");
    assert.deepEqual(resumePlan({ archive: a, kept: await keptOf(runs, a), on: true }), [], "the restart's cut: held");
    assert.deepEqual(a.getTurn(ids.cut).meta.cut.resume, { held: TEAM_WAITS });
    assert.deepEqual([a.getTurn(ids.cut).meta.cut.rounds, a.getTurn(ids.cut).meta.cut.tools], [2, 2], "the rest of the mark stays");
    // A clean stop failed the team's turn and left no mark: the start makes one, so its card knows a stop cut it.
    const stopped = a.chainForKey("h:team-stopped", { cwd: dir, client: "harness", model: "m-1", kind: "team" }).id;
    ids.failed = a.beginTurn(stopped, { requestId: "r-team-2", model: "m-1", upstream: "m", client: "harness", window: "harness", userMessage: user("check these claims") }).turnId;
    a.mergeTurnMeta(ids.failed, { failed: { at: 5, cause: "Filament is restarting" } });
    const kept = stoppedTurns({ archive: a, runs, chains: [stopped] });
    assert.equal(kept.length, 1);
    assert.deepEqual(resumePlan({ archive: a, kept, on: false, now: 77 }), [], "held whatever the switch says");
    assert.deepEqual(a.getTurn(ids.failed).meta.cut, { run: "r-team-2", at: 77, rounds: 0, tools: 0, logged: 0, resume: { held: TEAM_WAITS } });
    runs.close();
  });

  // (fails before: yes — a flow's team box was told to Resume… on a card it does not have: its flow's Go on is its way)
  test("a flow's team box a restart cut is held too, its mark naming its flow's Go on", async () => {
    /** @type {Record<string, number>} */
    const ids = {};
    const { a, runs } = crashed((arch, c, log, bus) => {
      const team = arch.chainForKey("h:flow-box", { cwd: dir, client: "harness", model: "m-1", kind: "team" }).id;
      arch.mergeMeta(team, { beside: { team: "bug-hunter", name: "Bug Hunter", ask: "hunt", flow: { id: "fl-1", box: "b3" } } });
      ids.cut = cutTurn(arch, team, log, bus, "r-flow", user("Your part: hunt for bugs"), LOGGED);
    });
    assert.deepEqual(resumePlan({ archive: a, kept: await keptOf(runs, a), on: true }), [], "held: it goes on on the person's word");
    assert.deepEqual(a.getTurn(ids.cut).meta.cut.resume, { held: FLOW_WAITS });
    assert.match(FLOW_WAITS, /Go on, on its flow's card/);
    runs.close();
  });

  // (fails before: yes — the plan asked nothing of the chat: one the person archived went on by itself after a restart,
  // where a wake, a goal's round, the idle check-in and the start's sweep all leave it)
  test("a chat Filament starts no turn in by itself is not gone on with: its cut turn is held, in the rule's own words", async () => {
    let turnId = 0;
    let other = 0;
    /** @type {string[]} */
    const chats = [];
    const { a, chain, runs } = crashed((arch, c, log, bus) => {
      turnId = cutTurn(arch, c, log, bus, "r-cut", user("turn 2: build the sheet"), LOGGED);
      arch.mergeMeta(c, { archived: true });
      const free = arch.chainForKey("h:not-archived", { cwd: dir, client: "harness", model: "m-1" }).id;
      chats.push(free);
      other = cutTurn(arch, free, log, bus, "r-free", user("turn 1: build the other sheet"), LOGGED);
    });
    const kept = await keptOf(runs, a);
    /** The sessions service's rule, as the server hands it over. @param {string} id */
    const notByItself = (id) => (a.metaOf(id, ["archived"])?.archived ? "the person archived it" : null);
    assert.deepEqual(resumePlan({ archive: a, kept, on: false, notByItself }), [], "off: none");
    assert.equal(a.getTurn(turnId).meta.cut.resume, undefined, "off: nothing is marked");
    assert.deepEqual(resumePlan({ archive: a, kept, on: true, notByItself }), [{ chainId: chats[0], turnId: other }], "the chat beside it goes on");
    assert.deepEqual(a.getTurn(turnId).meta.cut.resume, { held: "the person archived it" });
    assert.deepEqual([a.getTurn(turnId).meta.cut.rounds, a.getTurn(turnId).meta.cut.tools], [2, 2], "the rest of the mark stays");
    assert.equal(a.getTurn(other).meta.cut.resume, "going");
    // The person reads it, so it is said to them (r-itself, 11-12; the line said "the person archived it" until then).
    assert.match(openTurnWords({ cutOff: true, cut: a.getTurn(turnId).meta.cut }), /Filament did not go on by itself: you archived this chat\. Send a message to go on$/);
    assert.ok(chain);
    runs.close();
  });
});

describe("a clean stop's turns (TG2-D85: resume-cut.js noteRunningAtStop, takeRunningAtStop, stoppedTurns)", () => {
  // (fails before: yes — a clean stop refuses the turn's next round, the turn fails, and the start found nothing cut)
  test("the stop notes the chats whose turn runs; the start reads the note once; no running turn writes none", () => {
    const home = join(dir, `note${++seq}`);
    mkdirSync(home);
    noteRunningAtStop(home, ["c-1", "c-2"], 1234);
    assert.deepEqual(JSON.parse(readFileSync(join(home, RUNNING_AT_STOP), "utf8")), { at: 1234, chains: ["c-1", "c-2"] });
    assert.deepEqual(takeRunningAtStop(home), { at: 1234, chains: ["c-1", "c-2"] });
    assert.equal(existsSync(join(home, RUNNING_AT_STOP)), false, "read once");
    assert.equal(takeRunningAtStop(home), null);
    noteRunningAtStop(home, ["c-1"], 1);
    noteRunningAtStop(home, [], 2);
    assert.equal(existsSync(join(home, RUNNING_AT_STOP)), false, "a stop with nothing running leaves no note behind");
    writeFileSync(join(home, RUNNING_AT_STOP), "{ not json");
    assert.equal(takeRunningAtStop(home), null, "a broken note is none");
    assert.equal(existsSync(join(home, RUNNING_AT_STOP)), false);
  });
  test("each chat noted whose newest turn has no reply and failed, or was cut, is one to go on with; one that finished, that waits, or is gone is not", () => {
    /** @type {Record<string, number>} */
    const ids = {};
    const { a, chain, runs } = crashed((arch, c) => {
      ids.failed = arch.beginTurn(c, { requestId: "r-failed", model: "m-1", upstream: "m", client: "harness", window: "harness", userMessage: user("turn 2: build the sheet") }).turnId;
      arch.mergeTurnMeta(ids.failed, { failed: { at: 5, cause: "round 4's model call to m-1 failed: Filament is restarting; try again in a few seconds (HTTP 503)" } });
    });
    const other = a.chainForKey("h:finished", { cwd: dir, client: "harness", model: "m-1" }).id;
    const done = a.beginTurn(other, { requestId: "r-fin", model: "m-1", upstream: "m", client: "harness", window: "harness", userMessage: user("finished in the drain") });
    a.finishTurn(done.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: "done" }] } });
    // An earlier try's failure stays on a turn retried in its own row and finished: its reply is what counts.
    a.mergeTurnMeta(done.turnId, { failed: { at: 4, cause: "an earlier try's" } });
    const waiting = a.chainForKey("h:waits", { cwd: dir, client: "harness", model: "m-1" }).id;
    a.beginTurn(waiting, { requestId: "r-wait", model: "m-1", upstream: "m", client: "harness", window: "harness", userMessage: user("asked a question") });
    const outside = a.chainForKey("o:client", { cwd: dir, client: "claude-code", model: "m-1" }).id;
    const o = a.beginTurn(outside, { requestId: "r-out", model: "m-1", upstream: "m", client: "claude-code", window: "claude-code", userMessage: user("an outside client's") });
    a.mergeTurnMeta(o.turnId, { failed: { at: 5, cause: "restarting" } });
    const got = stoppedTurns({ archive: a, runs, chains: [chain, other, waiting, outside, "gone"] });
    assert.deepEqual(got, [{ chainId: chain, turnId: ids.failed, run: "r-failed", tools: 0 }]);
    runs.close();
  });

  // (fails before: yes — a resume lands on the row of the resume turn it goes on with, which keeps the cut mark of that
  // turn's run: a resume the stop failed before it ran a call was counted the earlier run's calls and went on again,
  // past the guard against a loop; one that ran calls was counted the earlier run's none, and held)
  test("a resume that lands on the row of the cut resume turn it goes on with counts its own run's calls, not the earlier cut's", async () => {
    /**
     * A resume turn a restart cut after `cut` calls, a start keeping them; its resume, on the same row, failed by a
     * clean stop after `ran`. → the turn the next start reads of it, and the plan.
     * @param {number} cut @param {number} ran
     */
    const goneOn = async (cut, ran) => {
      /** @type {Record<string, any>} */
      const ids = {};
      const { a, chain, runs } = crashed((arch, c, log, bus) => {
        ids.turn = cutTurn(arch, c, log, bus, "r-1", user(RESUME_LINE), cut ? LOGGED : NOTHING, { by: "resume" });
      });
      const kept = await keptOf(runs, a);
      assert.deepEqual([kept[0]?.run, kept[0]?.tools], ["r-1", cut], "the start counts the cut run's calls");
      const resumed = a.beginTurn(chain, { requestId: "r-2", model: "m-1", upstream: "m", client: "harness", window: "harness", running: true, userMessage: user(RESUME_LINE), by: "resume" });
      ids.landed = [resumed.turnId, resumed.isNew];
      runs.startRun({ id: "r-2", kind: "agent-turn", meta: { chain } });
      runs.endRun("r-2", { status: "error", summary: { toolCalls: ran } });
      a.mergeTurnMeta(ids.turn, { failed: { at: 5, cause: "round 2's model call to m-1 failed: Filament is restarting (HTTP 503)" } });
      const noted = stoppedTurns({ archive: a, runs, chains: [chain] });
      const plan = resumePlan({ archive: a, kept: noted, on: true });
      const out = { landed: ids.landed, turn: ids.turn, noted: noted.map((k) => [k.run, k.tools]), plan: plan.length, resume: a.getTurn(ids.turn).meta.cut.resume };
      runs.close();
      return out;
    };
    const idle = await goneOn(2, 0);
    assert.deepEqual(idle.landed, [idle.turn, false], "the resume lands on the cut resume turn's row");
    assert.deepEqual([idle.noted, idle.plan, idle.resume], [[["r-2", 0]], 0, { held: CUT_AGAIN }], "failed before it ran a call: held, not gone on again");
    const busy = await goneOn(0, 3);
    assert.deepEqual([busy.noted, busy.plan, busy.resume], [[["r-2", 3]], 1, "going"], "failed after its calls: it goes on");
  });
});

describe("the send and what it leaves (resume-cut.js resumeCutTurns)", () => {
  /** A cut turn planned to go on, in a fresh archive. */
  const planned = async () => {
    let turnId = 0;
    const { a, chain, runs } = crashed((arch, c, log, bus) => {
      turnId = cutTurn(arch, c, log, bus, "r-cut", user("turn 2"), LOGGED);
    });
    const plan = resumePlan({ archive: a, kept: await keptOf(runs, a), on: true });
    runs.close();
    return { a, chain, turnId, plan };
  };
  test("each chat is sent its turn; a turn taken leaves the mark going", async () => {
    const { a, chain, turnId, plan } = await planned();
    /** @type {string[]} */
    const sent = [];
    const out = await resumeCutTurns({ plan, archive: a, post: async (id) => (sent.push(id), { status: 200, body: null }) });
    assert.deepEqual(sent, [chain]);
    assert.deepEqual(out, [{ chainId: chain, turnId, went: true }]);
    assert.equal(a.getTurn(turnId).meta.cut.resume, "going");
  });
  test("a question the send would ask first leaves the cut turn saying why; a turn already running there clears the mark", async () => {
    const asked = await planned();
    const why = "the conversation is past its compaction line — choose how to make room and send again (Compact and send), or set context.compaction.mode to auto";
    const out = await resumeCutTurns({ plan: asked.plan, archive: asked.a, post: async () => ({ status: 409, body: { error: why, needsCompaction: true } }) });
    assert.deepEqual(out, [{ chainId: asked.chain, turnId: asked.turnId, went: false, why }]);
    assert.deepEqual(asked.a.getTurn(asked.turnId).meta.cut.resume, { refused: why });
    const busy = await planned();
    await resumeCutTurns({ plan: busy.plan, archive: busy.a, post: async () => ({ status: 409, body: { error: "a turn is already running in this session", holder: { window: "harness" } } }) });
    assert.equal(busy.a.getTurn(busy.turnId).meta.cut.resume, undefined, "the person's own message went on with it");
    const down = await planned();
    await resumeCutTurns({ plan: down.plan, archive: down.a, post: async () => { throw new Error("connect ECONNREFUSED"); } });
    assert.deepEqual(down.a.getTurn(down.turnId).meta.cut.resume, { refused: "connect ECONNREFUSED" });
  });
  // (fails before: yes — a refusal in a model wire's shape, its words in `error.message`, was said "[object Object]")
  test("a refusal in a model wire's shape is said in its own words", async () => {
    const wired = await planned();
    const why = "no route for model m-1";
    const out = await resumeCutTurns({ plan: wired.plan, archive: wired.a, post: async () => ({ status: 400, body: { type: "error", error: { type: "invalid_request_error", message: why } } }) });
    assert.deepEqual(out, [{ chainId: wired.chain, turnId: wired.turnId, went: false, why }]);
    assert.deepEqual(wired.a.getTurn(wired.turnId).meta.cut.resume, { refused: why });
  });
});

describe("what the page says (labels.js)", () => {
  test("the cut turn's note says what became of it; the turn Filament sent is Filament's", () => {
    const cut = { cutOff: true, cut: { rounds: 2, tools: 2, logged: 4 } };
    const kept = "cut off before its reply — Filament stopped while it ran. What it had done is kept from its run's log (2 rounds, 2 tool calls)";
    assert.equal(openTurnWords(cut), `${kept}: the agent has it with your next message`, "as before");
    assert.equal(openTurnWords({ ...cut, cut: { ...cut.cut, resume: "going" } }), `${kept}, and Filament went on with it below`);
    assert.equal(openTurnWords({ ...cut, cut: { ...cut.cut, resume: { refused: "the session asks before compacting" } } }), `${kept}: the agent has it with your next message. Filament did not go on by itself: the session asks before compacting. Send a message to go on`);
    assert.equal(openTurnWords({ cutOff: true, cut: { rounds: 0, tools: 0, logged: 0, resume: "going" } }), "cut off before its reply — Filament stopped while it ran. Its run's log shows no work before that, and Filament went on with it below");
    assert.equal(RESUMED_WORDS, "Filament went on by itself — a restart cut off the turn above");
  });
  test("the page draws the turn Filament sent with the row a coding agent's own turn has, and passes the marks through", () => {
    const timeline = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
    assert.match(timeline, /turn\.own \? ownRow\(turn\) : turn\.resumed \? resumedRow\(\) : turn\.goalRound \? goalRoundRow\(turn\) : turn\.woke \? wokeRow\(turn\) : turn\.synced \? syncRow\(turn\) : turn\.teamResult \? teamResultRow\(turn\) : turn\.flowSaid \? flowSaidRow\(turn\) : turn\.brief \? briefRow\(turn, [^]*?\) : userRow\(/);
    const history = readFileSync(new URL("../src/ui/harness/conversation/history.js", import.meta.url), "utf8");
    assert.match(history, /\.\.\.\(t\.resumed \? \{ resumed: true \} : \{\}\)/);
    assert.match(history, /resume: t\.cut\.resume/);
  });
});

describe("through the app: a restart while a turn ran", () => {
  /** @param {any} folder @param {any} up @param {boolean} [on] */
  const configOf = (folder, up, on = true) => (/** @type {any} */ cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
    cfg.memory.autopilot = { enabled: false };
    if (!on) cfg.sessions = { ...(cfg.sessions || {}), resumeAfterRestart: false };
  };
  /**
   * A chat whose second turn a restart cut off: a real first turn, then what a crash leaves of the second — its
   * archive row still running and its run's log two calls in. → the app started again over the same data.
   * `before(shim, id)`: what the chat is left with as the first app stops.
   * @param {any} up @param {string} folder @param {boolean} on @param {(shim: any, id: string) => Promise<void>} [before]
   */
  async function restarted(up, folder, on, before) {
    let shim = await startApp({ memory: true, keep: true, configure: configOf(folder, up, on) });
    const dataDir = shim.dataDir;
    const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain" } })).json()).id);
    const one = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "turn 1: hello", stream: false } });
    assert.equal(one.status, 200, await one.clone().text());
    const runId = String(one.headers.get("x-filament-request-id"));
    const start = JSON.parse(readFileSync(join(dataDir, "runs", `${runId}.jsonl`), "utf8").split("\n")[0]);
    /** @type {any} */
    const archive = shim.app.memory.archive;
    archive.beginTurn(id, { requestId: "cut-run", model: "m-1", upstream: "m", client: "harness", window: "harness", running: true, userMessage: user("turn 2: build the sheet") });
    await before?.(shim, id);
    await shim.stop();
    const logged = [{ ...start, runId: "cut-run" }, ...LOGGED.slice(1).map((e, i) => ({ ...e, n: i + 2, seq: 0, ts: start.ts + i + 1, runId: "cut-run" }))];
    writeFileSync(join(dataDir, "runs", "cut-run.jsonl"), logged.map((e) => JSON.stringify(e)).join("\n") + "\n");
    up.reset();
    shim = await startApp({ memory: true, keep: true, dataDir, configure: configOf(folder, up, on) });
    return { shim, id, dataDir };
  }

  // (fails before: yes — the restart left the turn waiting for a message: nothing reached the model)
  test("Filament goes on with the cut turn by itself: its message is Filament's, its history the cut turn's work, the page says both", async () => {
    const up = await fakeUpstream(() => anthropicReply("FINISHED THE SHEET", { model: "m-1" }));
    const folder = mkdtempSync(join(tmpdir(), "filament-resume-cwd-"));
    const { shim, id, dataDir } = await restarted(up, folder, true);
    try {
      const out = await shim.app.resumedAtStart;
      assert.deepEqual(out.map((/** @type {any} */ o) => [o.chainId, o.went]), [[id, true]]);
      await until(async () => {
        const tr = await (await shim.api(`/api/sessions/${id}/transcript`)).json();
        return tr.turns.length === 3 && !tr.turns[2].open;
      }, "the turn Filament sent ended");
      const sent = up.received.filter((c) => c.kind === "anthropic");
      assert.equal(sent.length, 1, "one model call: the resumed turn's");
      const history = sent[0].body.messages.map(textOfMessage).join("\n");
      assert.match(history, /turn 2: build the sheet[\s\S]*Reading the sheet\.[\s\S]*src\/sheet\.js[\s\S]*cut off before its reply[\s\S]*Filament restarted while your last turn was running/);
      const tr = await (await shim.api(`/api/sessions/${id}/transcript`)).json();
      assert.deepEqual([tr.turns[1].cutOff, tr.turns[1].cut.resume], [true, "going"], "the cut turn says Filament went on with it");
      assert.deepEqual([tr.turns[2].resumed, textOfMessage(tr.turns[2].final)], [true, "FINISHED THE SHEET"], "the turn Filament sent, marked, with its reply");
      assert.equal(tr.turns[0].resumed, undefined, "the person's turns are theirs");
      // A second start finds nothing cut, and sends nothing.
      await shim.stop();
      const again = await startApp({ memory: true, keep: true, dataDir, configure: configOf(folder, up, true) });
      try {
        assert.deepEqual(await again.app.resumedAtStart, []);
      } finally {
        await again.stop();
      }
    } finally {
      await shim.stop().catch(() => {});
      await up.close();
      await removeDirs(dataDir, folder);
    }
  });

  test("with sessions.resumeAfterRestart off the cut turn waits for a message, as before", async () => {
    const up = await fakeUpstream(() => anthropicReply("DONE", { model: "m-1" }));
    const folder = mkdtempSync(join(tmpdir(), "filament-resume-cwd-"));
    const { shim, id, dataDir } = await restarted(up, folder, false);
    try {
      assert.deepEqual(await shim.app.resumedAtStart, []);
      assert.equal(up.received.filter((c) => c.kind === "anthropic").length, 0, "no model call");
      const tr = await (await shim.api(`/api/sessions/${id}/transcript`)).json();
      assert.deepEqual([tr.turns.length, tr.turns[1].cutOff, tr.turns[1].cut.resume], [2, true, undefined]);
    } finally {
      await shim.stop();
      await up.close();
      await removeDirs(dataDir, folder);
    }
  });

  // (fails before: yes — an archived chat's cut turn went on by itself after a restart: a model call in a chat the
  // person put away, where its wakes, its goal's rounds and its idle check-in all wait)
  test("a chat the person archived is not gone on with: no turn is sent, its cut turn says why, a resume asked of it is refused, and the report it was owed waits for its next turn", async () => {
    const up = await fakeUpstream(() => anthropicReply("DONE", { model: "m-1" }));
    const folder = mkdtempSync(join(tmpdir(), "filament-resume-cwd-"));
    const REPORT = '[Filament: sub-agent sa_cut1 ("Audit") reported:]\n\nSUB REPORT: the folder is clean.';
    const { shim, id, dataDir } = await restarted(up, folder, true, async (first, chat) => {
      // A report waits for its agent, owed a wake, as the stop cuts its turn; and the person archived the chat.
      first.app.sessions.saveSubagentQueue(chat, [{ text: REPORT, from: "sa_cut1", description: "Audit", kind: "report", wakes: true }]);
      const r = await first.api(`/api/sessions/${chat}/settings`, { method: "PATCH", body: { patch: { display: { archived: true } } } });
      assert.equal(r.status, 200, await r.clone().text());
    });
    const modelCalls = () => up.received.filter((c) => c.kind === "anthropic").length;
    try {
      assert.deepEqual(await shim.app.resumedAtStart, [], "no turn is sent");
      const swept = await shim.app.owedWokenAtStart;
      assert.deepEqual(swept.map((/** @type {any} */ x) => [x.chainId, x.woke, x.why]), [[id, false, "the person archived it"]], "nor is it woken for its report");
      assert.equal(modelCalls(), 0, "no model call");
      const tr = await (await shim.api(`/api/sessions/${id}/transcript`)).json();
      assert.deepEqual([tr.turns.length, tr.turns[1].cutOff, tr.turns[1].cut.resume], [2, true, { held: "the person archived it" }]);
      // The route a resume takes keeps the rule too, as a wake's and a goal round's do.
      const asked = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { by: "resume", stream: false } });
      assert.equal(asked.status, 409, await asked.clone().text());
      assert.match((await asked.json()).error, /the chat is archived, and Filament starts no turn in it by itself/);
      assert.equal(modelCalls(), 0, "still none");
      // What it was owed is kept: the report waits in its queue, for the chat's next turn.
      assert.equal((await (await shim.api(`/api/sessions/${id}/subagents`)).json()).queued, 1);
      // A second start sends it nothing either, and the report still waits.
      await shim.stop();
      const again = await startApp({ memory: true, keep: true, dataDir, configure: configOf(folder, up, true) });
      try {
        assert.deepEqual(await again.app.resumedAtStart, []);
        await again.app.owedWokenAtStart;
        assert.equal(modelCalls(), 0);
        // Their next message carries the report, and the cut turn's work.
        const sent = await again.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "turn 3: go on", stream: false } });
        assert.equal(sent.status, 200, await sent.clone().text());
        const history = up.received.filter((c) => c.kind === "anthropic").at(-1)?.body.messages.map(textOfMessage).join("\n") || "";
        assert.match(history, /turn 2: build the sheet[\s\S]*Reading the sheet\.[\s\S]*SUB REPORT: the folder is clean\.[\s\S]*turn 3: go on/);
      } finally {
        await again.stop();
      }
    } finally {
      await shim.stop().catch(() => {});
      await up.close();
      await removeDirs(dataDir, folder);
    }
  });

  test("a resume asked of a chat with nothing cut is refused in words, and sends nothing", async () => {
    const up = await fakeUpstream(() => anthropicReply("DONE", { model: "m-1" }));
    const folder = mkdtempSync(join(tmpdir(), "filament-resume-cwd-"));
    const shim = await startApp({ memory: true, configure: configOf(folder, up, true) });
    try {
      const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain" } })).json()).id);
      const r = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { resume: true, stream: false } });
      assert.equal(r.status, 409);
      assert.match((await r.json()).error, /nothing to go on with: the chat's newest turn was not cut off by a restart/);
      assert.equal(up.received.filter((c) => c.kind === "anthropic").length, 0);
    } finally {
      await shim.stop();
      await up.close();
      await removeDirs(folder);
    }
  });

  // (fails before: yes — TG2-D85: the drive's clean restart sent nothing; the turn had failed, "Filament is restarting")
  test("a clean stop between rounds: the turn fails on the stop's refusal, and the next start goes on with it, its work in the history", async () => {
    let n = 0;
    const up = await fakeUpstream((call) => {
      if (call.kind !== "anthropic") return undefined;
      n++;
      // Round 1 runs a command that takes three seconds; the stop comes while it runs.
      if (n === 1) return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "text", text: "Building the sheet." }, { type: "tool_use", id: "b1", name: "bash", input: { command: 'node -e "setTimeout(() => {}, 3000)"' } }] });
      return anthropicReply("FINISHED AFTER THE RESTART", { model: "m-1" });
    });
    const folder = mkdtempSync(join(tmpdir(), "filament-resume-cwd-"));
    const configure = (/** @type {any} */ cfg) => {
      configOf(folder, up, true)(cfg);
      cfg.agentLoop.permissions = "auto";
    };
    let shim = await startApp({ memory: true, keep: true, configure });
    const dataDir = shim.dataDir;
    try {
      const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain" } })).json()).id);
      const turn = shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "turn 1: build the sheet", stream: true } }).then((r) => r.text()).catch(() => "");
      await until(async () => {
        const runs = (await (await shim.api("/api/runs?limit=5")).json()).runs || [];
        const run = runs.find((/** @type {any} */ r) => r.kind === "agent-turn");
        if (!run) return false;
        const ev = (await (await shim.api(`/api/runs/${run.id}/events?since=0&limit=500`)).json()).events || [];
        return ev.some((/** @type {any} */ e) => e.type === "tool-start" && e.name === "bash");
      }, "the command runs");
      await shim.stop();
      await turn;
      const noted = JSON.parse(readFileSync(join(dataDir, RUNNING_AT_STOP), "utf8"));
      assert.deepEqual(noted.chains, [id], "the stop noted the chat whose turn ran");
      shim = await startApp({ memory: true, keep: true, dataDir, configure });
      const out = await shim.app.resumedAtStart;
      assert.deepEqual(out.map((/** @type {any} */ o) => [o.chainId, o.went]), [[id, true]]);
      assert.equal(existsSync(join(dataDir, RUNNING_AT_STOP)), false, "the note is read once");
      await until(async () => {
        const tr = await (await shim.api(`/api/sessions/${id}/transcript`)).json();
        return tr.turns.length === 2 && !tr.turns[1].open;
      }, "the turn Filament sent ended");
      const sent = up.received.filter((c) => c.kind === "anthropic");
      const history = sent.at(-1)?.body.messages.map(textOfMessage).join("\n") || "";
      assert.match(history, /turn 1: build the sheet[\s\S]*Building the sheet\.[\s\S]*this turn failed: [\s\S]*Filament is restarting[\s\S]*Filament restarted while your last turn was running/);
      const tr = await (await shim.api(`/api/sessions/${id}/transcript`)).json();
      assert.ok(tr.turns[0].failed, "the first turn failed on the stop's refusal");
      assert.deepEqual([tr.turns[1].resumed, textOfMessage(tr.turns[1].final)], [true, "FINISHED AFTER THE RESTART"]);
    } finally {
      await shim.stop().catch(() => {});
      await up.close();
      await removeDirs(dataDir, folder);
    }
  });

  test("a turn the stop failed before it did any work: Filament's turn carries its message again, then Filament's line", async () => {
    const up = await fakeUpstream(() => anthropicReply("DONE AGAIN", { model: "m-1" }));
    const folder = mkdtempSync(join(tmpdir(), "filament-resume-cwd-"));
    let shim = await startApp({ memory: true, keep: true, configure: configOf(folder, up, true) });
    const dataDir = shim.dataDir;
    try {
      const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain" } })).json()).id);
      const one = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "turn 1: hello", stream: false } });
      assert.equal(one.status, 200, await one.clone().text());
      /** @type {any} */
      const archive = shim.app.memory.archive;
      const t2 = archive.beginTurn(id, { requestId: "failed-run", model: "m-1", upstream: "m", client: "harness", window: "harness", userMessage: user("turn 2: build the sheet") }).turnId;
      archive.mergeTurnMeta(t2, { failed: { at: Date.now(), cause: "round 1's model call to m-1 failed: Filament is restarting; try again in a few seconds (HTTP 503)" } });
      await shim.stop();
      noteRunningAtStop(dataDir, [id]);
      up.reset();
      shim = await startApp({ memory: true, keep: true, dataDir, configure: configOf(folder, up, true) });
      assert.deepEqual((await shim.app.resumedAtStart).map((/** @type {any} */ o) => o.went), [true]);
      await until(async () => {
        const tr = await (await shim.api(`/api/sessions/${id}/transcript`)).json();
        return tr.turns.length === 3 && !tr.turns[2].open;
      }, "the turn Filament sent ended");
      const last = up.received.filter((c) => c.kind === "anthropic")[0].body.messages.at(-1);
      assert.match(textOfMessage(last), /turn 2: build the sheet[\s\S]*Filament restarted while your last turn was running/);
      const tr = await (await shim.api(`/api/sessions/${id}/transcript`)).json();
      assert.equal(tr.turns[2].resumed, true, "drawn as Filament's: the message it carries again is above, in the failed turn");
    } finally {
      await shim.stop().catch(() => {});
      await up.close();
      await removeDirs(dataDir, folder);
    }
  });

  test("the server keeps the cut turns as memory opens, once it listens, and sends their turns after", () => {
    const src = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
    const open = src.indexOf("const openMemory = async () => {");
    const after = src.indexOf("const afterListening = ");
    assert.ok(open > 0 && src.indexOf("onKept:") > open && src.indexOf("onKept:") < after, "the kept turns are collected as memory opens");
    assert.ok(src.indexOf("resumeCutTurns(", after) > src.indexOf("await (openingNow = openMemory());", after), "sent once memory has opened");
    const listen = src.indexOf("listening = { host:");
    assert.ok(listen > 0 && src.indexOf("afterListening(", listen) > listen, "which follows the listen");
    // A clean stop notes its running chats first, before it drains (TG2-D85), with what memory's open has not sent on
    // yet (`noteAtStop`, which writes the note: start-listens-first.test.js holds its behaviour).
    const stop = src.indexOf("stop({ drainMs");
    assert.ok(stop > 0 && src.indexOf("noteAtStop(", stop) > stop && src.indexOf("noteAtStop(", stop) < src.indexOf("draining = true", stop), "noted before the drain");
    assert.match(src, /const noteAtStop = [\s\S]*?noteRunningAtStop\(dataDir, /, "through the note a clean stop leaves");
    assert.ok(src.indexOf("takeRunningAtStop(", open) > open && src.indexOf("takeRunningAtStop(", open) < after, "read as memory opens");
  });
});
