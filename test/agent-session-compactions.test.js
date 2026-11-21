// @ts-check
// HarnessV3-ACP AC5-1: an agent's session stands on the chat's compactions. A harness turn names the chat's newest in
// a house header a client cannot send; a session on another gives way — to a fresh one, whose first prompt is the
// harness's composition of the chat, or, where an undo brought the chat back, to the session from before — and a
// session the person resumes stands on the newest. The rule, then each bridge against its fake, then through the app:
// Compact now, the next message, and an undo before one. AC5-3: when an agent's session makes room — its line, read
// against what the agent holds, the resume question and the session's way — then the line through the app.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FIXTURES, FAKE_ACP_AGENT, startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { afterHead } from "./helpers/agent-head.js";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { CodexBridge } from "../src/adapters/agents/codex/bridge.js";
import { CursorSdkBridge } from "../src/adapters/agents/cursor-sdk.js";
import { COMPACTED_WORDS, COMPACTION_HEADER, STANDS_ON_HEADER, compactionOf, moveFor, standsOn, standsOnHeader, standsOnOf } from "../src/adapters/agents/compactions.js";
import { admitHeaders, houseAuth } from "../src/services/house.js";
import { SUMMARY_ACK, compactionBases, summaryHead, summaryLead } from "../src/app/sessions/compaction.js";
import { agentHeld, agentLine, agentWay, hadSession, seedRoom } from "../src/app/sessions/agent-line.js";
import { AGENT_CACHE_MS, cacheClock, idleWords, resumeWords } from "../src/app/sessions/cache-clock.js";
import { postTurn, setInboundKey } from "../src/ui/harness/lib/api.js";
import { KNOBS } from "../src/services/session-settings.js";

const quiet = () => {};
/** JSON lines of a file, oldest first. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/** A request's headers, naming the chat's newest compaction; none for an outside client's. @param {number | null} base */
const naming = (base) => (base == null ? {} : { [COMPACTION_HEADER]: String(base) });
const LEAD = summaryLead(1, 1, "The person said one.");
/** The chat as the harness composes it after its compaction 4: turn 1 summarised, turn 2 kept. */
const COMPOSED = [...summaryHead(LEAD), { role: "user", content: "two" }, { role: "assistant", content: "Echo: two" }];
/** The composition's history as a seed's transcript reads it. */
const SEEN = `### User\n${LEAD}\n\n### Assistant\n${SUMMARY_ACK}\n\n### User\ntwo\n\n### Assistant\nEcho: two`;
/** The chat a turn later. @param {string} said */
const after3 = (said) => [...COMPOSED, { role: "user", content: said }, { role: "assistant", content: `Echo: ${said}` }];
/** A request's body: the history, then the person's words. @param {string} text @param {any[]} [history] */
const bodyOf = (text, history = []) => ({ model: "m", max_tokens: 100, messages: [...history, { role: "user", content: text }] });
/** A session's record as the rule reads it. @typedef {{ sessionId: string, basedOn?: number, before?: Rec | null }} Rec */

let dir = "";
before(() => {
  dir = mkdtempSync(join(tmpdir(), "filament-agent-session-compactions-"));
});
after(async () => {
  await removeDirs(dir);
});

describe("the rule (AC5-1)", () => {
  test("a request names its compaction in the house header alone", () => {
    /** @type {any[]} */
    const asked = [naming(7), naming(0), {}, null, { [COMPACTION_HEADER]: "7a" }, { [COMPACTION_HEADER]: "-1" }];
    assert.deepEqual(asked.map((h) => compactionOf(h)), [7, 0, null, null, null, null]);
    const claimed = { [COMPACTION_HEADER]: "9", [STANDS_ON_HEADER]: "=12", "user-agent": "opencode/1.0" };
    const admitted = admitHeaders(claimed);
    assert.equal(admitted.headers[COMPACTION_HEADER], undefined, "a client cannot move an agent's session");
    assert.equal(admitted.headers[STANDS_ON_HEADER], undefined, "nor say what another agent's session stands on");
    assert.deepEqual(admitted.setAside.dropped, [COMPACTION_HEADER, STANDS_ON_HEADER]);
    assert.deepEqual([COMPACTION_HEADER, STANDS_ON_HEADER].map((k) => admitHeaders({ ...claimed, ...houseAuth() }).headers[k]), ["9", "=12"]);
  });

  // HarnessV4_Tasks A8: what each agent's session stands on, named for the bridge of whichever agent serves the turn.
  // (fails before: yes — a request named the chat's newest compaction of Filament's alone)
  test("a request names the compaction each agent's session stands on where a row of Filament's copy alone moved it", () => {
    const rows = new Map([["", 15], ["cc", 9], ["cc work", 12]]);
    assert.equal(standsOnHeader(rows), "=15,cc=9,cc%20work=12");
    const headers = { [COMPACTION_HEADER]: "9", [STANDS_ON_HEADER]: standsOnHeader(rows) };
    assert.deepEqual(standsOnOf(headers), rows);
    assert.deepEqual(["cc", "cc work", "cx", null].map((up) => compactionOf(headers, up)), [9, 12, 15, 9], "its own, else any other agent's; with no agent named, the chat's newest");
    assert.deepEqual([standsOn(9, new Map(), "cc"), standsOn(9, new Map([["cx", 12]]), "cc")], [9, 9]);
    assert.deepEqual(standsOnOf({ [COMPACTION_HEADER]: "9", [STANDS_ON_HEADER]: "cc=x,%E0%A4%A=5, cx=7 ,=" }), new Map([["cx", 7]]), "what Filament did not write is no row");
    assert.equal(compactionOf({ [STANDS_ON_HEADER]: "=12" }, "cx"), null, "an outside client's request stands on none");
  });

  // HarnessV4_Tasks A8, seen live 10-17: the chat went from the work account's session to the personal one's, whose
  // Claude Code compacted its own context nine times; back on the work account, its session from before went on,
  // handed the personal one's summary of turns 1–160 and six whole turns on top of the 89,000 tokens it held of what
  // that summary stands for.
  // (fails before: yes — such a row moved no session: every agent's stood on the chat's newest compaction of Filament's)
  test("which sessions a row of Filament's copy alone moves: those of the agents that had not seen all it stands for as it was written", () => {
    const turn = (/** @type {number} */ n, /** @type {string} */ upstream, /** @type {number} */ startedAt) => ({ n, startedAt, meta: { facts: { upstream } } });
    // The work account answers turns 1–2, the personal one 3–5, its Claude Code compacting in the middle of turn 4.
    const turns = [turn(1, "work", 10), turn(2, "work", 20), turn(3, "home", 30), turn(4, "home", 40), turn(5, "home", 50)];
    const own = { id: 7, method: "own", to_turn: 3, created_at: 45, detail: { during: 4 } };
    assert.deepEqual(compactionBases([own], turns), { base: 0, rows: new Map([["", 7], ["home", 0]]) }, "the work account's session is let go, and an agent new to the chat starts from the summary; the one that compacted goes on");
    assert.deepEqual(compactionBases([own, { id: 8, to_turn: 4, created_at: 60, detail: {} }], turns), { base: 8, rows: new Map() }, "every session follows Filament's own compaction");
    // The account that answered the turn right before the other compacted had not seen that turn's start, which the
    // summary stands for.
    const close = [turn(1, "work", 10), turn(2, "home", 20)];
    assert.deepEqual(compactionBases([{ id: 3, method: "own", to_turn: 1, created_at: 25, detail: { during: 2 } }], close), { base: 0, rows: new Map([["", 3], ["home", 0]]) });
    // Filament's summary for the copy is written after a turn ends, while the chat's next turn may already run on another
    // agent: an agent that had begun a turn by then had seen all it stands for.
    const raced = [turn(1, "cx", 10), turn(2, "cx", 20), turn(3, "cc", 30)];
    assert.deepEqual(compactionBases([{ id: 4, method: "summary", to_turn: 1, created_at: 35, detail: { copy: "line" } }], raced), { base: 0, rows: new Map([["", 4], ["cx", 0], ["cc", 0]]) });
    // A turn a restart cut off names its agent by its last count; a row being weighed has no id, and moves none.
    const cut = [turn(1, "work", 10), { n: 2, startedAt: 20, meta: { cutOff: true, cut: { held: { upstream: "home" } } } }];
    assert.deepEqual(compactionBases([{ id: 5, method: "own", to_turn: 1, created_at: 25, detail: { during: 2 } }, { to_turn: 2, detail: { during: 3 } }], cut), { base: 0, rows: new Map([["", 5], ["home", 0]]) });
  });

  test("a session stays on its compaction; another gives way to a session from before that stands on it, else to a fresh one", () => {
    /** @type {Rec} */
    const first = { sessionId: "s0", basedOn: 0 };
    /** @type {Rec} */
    const second = { sessionId: "s1", basedOn: 3, before: first };
    /** @type {Rec} */
    const now = { sessionId: "s2", basedOn: 5, before: second };
    assert.deepEqual(moveFor(now, null), { move: "stay", gone: [] }, "an outside client's request names none");
    assert.deepEqual(moveFor({ sessionId: "s", basedOn: 5 }, 5), { move: "stay", gone: [] });
    assert.deepEqual(moveFor(now, 5), { move: "stay", gone: [second, first] }, "a turn on the compacted session: those from before can no longer come back");
    assert.deepEqual(moveFor(now, 3), { move: "back", to: second, gone: [now] }, "one undo");
    assert.deepEqual(moveFor(now, 0), { move: "back", to: first, gone: [now, second] }, "two, with no message between");
    assert.deepEqual(moveFor(now, 9), { move: "fresh", gone: [now, second, first] });
    /** @type {Rec} */
    const old = { sessionId: "old" };
    assert.deepEqual(moveFor(old, 4), { move: "fresh", gone: [old] }, "a session from before AC5 stands on none");
    assert.deepEqual(moveFor(old, 0), { move: "stay", gone: [] });
  });
});

describe("when an agent's session makes room (AC5-3)", () => {
  /** A finished turn the agent counted. @param {any} [facts] @param {{ startedAt?: number, endedAt?: number }} [at] */
  const turn = (facts = {}, { startedAt = 1000, endedAt = 2000 } = {}) => ({ startedAt, endedAt, meta: { facts: { upstream: "ag", context: { held: 150_000, window: 200_000, source: "agent" }, ...facts } } });

  test("what the agent holds: its newest turn's count, on this agent, with no compaction since; the window it named, else Filament's", () => {
    const o = { compactions: [], upstream: "ag", window: 128_000 };
    assert.deepEqual(agentHeld({ ...o, turns: [turn()] }), { held: 150_000, window: 200_000, estimated: false, endedAt: 2000 });
    assert.equal(agentHeld({ ...o, turns: [turn({ upstream: "other" })] }), null, "another engine answered last: the next turn starts a fresh session");
    assert.equal(agentHeld({ ...o, turns: [turn({ context: null })] }), null, "the agent counted nothing");
    assert.equal(agentHeld({ ...o, turns: [] }), null);
    assert.equal(agentHeld({ ...o, turns: [turn()], compactions: [{ created_at: 1500 }] }), null, "a compaction since: a fresh session from it");
    assert.equal(agentHeld({ ...o, turns: [turn()], compactions: [{ created_at: 900 }] })?.held, 150_000, "one before the turn: the session stands on it");
    const ours = turn({ context: { held: 90_000, window: 1_000_000, source: "filament", estimated: true } });
    assert.deepEqual(agentHeld({ ...o, turns: [ours] }), { held: 90_000, window: 128_000, estimated: true, endedAt: 2000 }, "a window the agent did not name: Filament's");
    assert.equal(agentHeld({ ...o, window: null, turns: [ours] })?.window, 1_000_000, "else the record's");
  });

  // (fails before: yes — HarnessV4_Tasks C26: a chat whose last turn was the agent's and whose bridge kept no session
  // was asked about a lost one, though the turn had been stopped before any session was up)
  test("the agent had a session of the chat: a turn ran in one since another engine last answered", () => {
    const t = (/** @type {string} */ upstream, /** @type {boolean | null} */ agentSession) => ({ meta: { facts: { upstream, agentSession } } });
    assert.equal(hadSession([t("claude", true)], "claude"), true);
    assert.equal(hadSession([t("claude", true), t("claude", false)], "claude"), true, "a later turn stopped as it opened takes nothing away");
    assert.equal(hadSession([t("claude", false)], "claude"), false, "stopped before its session was up: none to lose");
    assert.equal(hadSession([t("claude", true), t("api", null), t("claude", false)], "claude"), false, "another engine answered since: that session is not this stretch's");
    assert.equal(hadSession([t("codex", true)], "claude"), false);
    assert.equal(hadSession([], "claude"), false);
    assert.equal(hadSession([{ meta: {} }], "claude"), false);
  });

  test("the line is the session's share of the agent's window", () => {
    const at = { held: 170_000, window: 200_000, estimated: false, endedAt: 1_000_000 };
    assert.deepEqual(agentLine(at, {}), { usable: 170_000, over: true });
    assert.deepEqual(agentLine({ ...at, held: 169_999 }, {}), { usable: 170_000, over: false });
    assert.deepEqual(agentLine(at, { thresholdPercent: 90 }), { usable: 180_000, over: false });
    assert.equal(agentLine({ ...at, window: null }, {}), null, "nobody knows the window");
  });

  // (fails before: yes — HarnessV4_Tasks C26: the question waited 70 idle minutes and 100,000 tokens held, in a coding
  // agent's session alone; a model Filament calls never asked, and nothing said what would read the session)
  test("a session's cache is cold once its life has run out since the last turn; the question says what will read the session, how much, and why it costs", () => {
    const ended = 1_000_000;
    const hour = cacheClock({ endedAt: ended, ttlMs: AGENT_CACHE_MS, now: ended + AGENT_CACHE_MS });
    assert.equal(AGENT_CACHE_MS, 3_600_000, "the longest life a provider gives a cache");
    assert.deepEqual(hour, { state: "cold", idleMs: 3_600_000, ttlMs: 3_600_000, leftMs: 0, seen: false });
    assert.deepEqual(cacheClock({ endedAt: ended, ttlMs: AGENT_CACHE_MS, now: ended + AGENT_CACHE_MS - 1 }), { state: "warm", idleMs: 3_599_999, ttlMs: 3_600_000, leftMs: 1, seen: false });
    assert.equal(cacheClock({ endedAt: 0, ttlMs: AGENT_CACHE_MS, now: 5 }), null, "no turn has ended");
    const five = cacheClock({ endedAt: ended, ttlMs: 300_000, now: ended + 420_000, cached: true });
    assert.deepEqual(five, { state: "cold", idleMs: 420_000, ttlMs: 300_000, leftMs: 0, seen: true }, "a model Filament calls: its route's cache life");
    assert.deepEqual(cacheClock({ endedAt: ended, ttlMs: 300_000, now: ended + 420_000, cached: false }), { state: "none", idleMs: 420_000, ttlMs: 300_000, leftMs: 0, seen: true }, "replies that read and wrote no cache: none to lose");
    assert.deepEqual(cacheClock({ endedAt: ended, ttlMs: 300_000, now: ended + 420_000, cached: true, leftMs: 120_000 }), { state: "warm", idleMs: 420_000, ttlMs: 300_000, leftMs: 120_000, seen: true }, "a later read of the kept request renewed its life");
    assert.deepEqual([0, 59, 60, 75, 130, 180, 24 * 60, 27 * 60 + 5].map((m) => idleWords(m * 60_000)), ["0 m", "59 m", "1 h", "1 h 15 m", "2 h 10 m", "3 h", "1 d", "1 d 3 h"]);
    /** @type {import("../src/app/sessions/cache-clock.js").Reader} */
    const agent = { kind: "agent", name: "Claude Code", from: "session" };
    const q = { why: /** @type {const} */ ("cold"), idleMs: 130 * 60_000, held: 180_000, estimated: true, window: 200_000, usable: 170_000, reads: agent, cache: hour };
    assert.equal(resumeWords(q), "This session has been idle 2 h 10 m, and Claude Code holds ≈180,000 tokens of its 200,000-token window: a coding agent's cache lasts 1 h at the most, so going on pays for all of it again at the full price. Send it as it is, or make room first?");
    assert.equal(resumeWords({ ...q, held: null, estimated: false, window: null }), "This session has been idle 2 h 10 m, and Claude Code has not said how much it holds: a coding agent's cache lasts 1 h at the most, so going on pays for all of it again at the full price. Send it as it is, or make room first?");
    assert.equal(
      resumeWords({ why: "cold", idleMs: 420_000, held: 84_000, estimated: true, window: 1_000_000, usable: 850_000, reads: { kind: "model", name: "zai/glm-5.3", from: "copy" }, cache: five }),
      "This session has been idle 7 m, and zai/glm-5.3 keeps its cache 5 m after a turn: the cache has gone cold, so going on sends all ≈84,000 tokens of its 1,000,000-token window at the full price again. Send it as it is, or make room first?",
    );
    assert.equal(
      resumeWords({ why: "lost", idleMs: 60_000, held: 12_000, estimated: true, window: 200_000, usable: 170_000, reads: { ...agent, from: "copy" }, cache: null }),
      "Claude Code keeps no session of this chat any more, so this message starts a new one from Filament's copy of the chat, which weighs ≈12,000 tokens of its 200,000-token window: nothing of it is cached, so all of it is paid for at the full price. Send it as it is, or make room first?",
    );
    // (fails before: yes — HarnessV4_Git_Plan §12's drive: after a move the card blamed a lost session)
    assert.equal(
      resumeWords({ why: "lost", moved: "proj-fix", idleMs: 60_000, held: 227, estimated: true, window: 200_000, usable: 170_000, reads: { ...agent, from: "copy" }, cache: null }),
      "This chat moved to proj-fix, so Claude Code starts a new session there from Filament's copy of the chat, which weighs ≈227 tokens of its 200,000-token window: nothing of it is cached, so all of it is paid for at the full price. Send it as it is, or make room first?",
    );
    // (fails before: yes — the owner's of 11-06: the question named no form, and a Words copy had left every tool's
    // output out) The form the new session carries, said.
    assert.equal(
      resumeWords({ why: "lost", moved: "proj-fix", carry: "plain", idleMs: 60_000, held: 161_000, estimated: true, window: 200_000, usable: 170_000, reads: { ...agent, from: "copy" }, cache: null }),
      "This chat moved to proj-fix, so Claude Code starts a new session there from Filament's copy of the chat as Whole (every finished turn as it was sent, tool output as text), which weighs ≈161,000 tokens of its 200,000-token window: nothing of it is cached, so all of it is paid for at the full price. Send it as it is, or make room first?",
    );
    assert.match(resumeWords({ why: "lost", carry: "words", idleMs: 60_000, held: 4_500, estimated: true, window: 200_000, usable: 170_000, reads: { ...agent, from: "copy" }, cache: null }), /from Filament's copy of the chat as Words \(your words and the agent's, each turn's tool calls counted in one line\), which weighs ≈4,500 tokens/);
  });

  // (fails before: yes — HarnessV4_Tasks B5: a refused seed was compacted under the weight refused whatever the agent
  // said its context takes, so a compacted seed could be refused again and the chat go on without its history)
  test("a refused seed's room: the agent's limit less what it counts beyond Filament's; its limit alone; never more than what it refused", () => {
    // It counted 212,000 where Filament counted 150,000: 62,000 are its own prompt and tools, which the limit holds too.
    assert.equal(seedRoom({ sent: 150_000, max: 200_000, counted: 212_000 }), 138_000);
    assert.equal(seedRoom({ sent: 150_000, max: 128_000, counted: null }), 128_000, "its limit alone");
    assert.equal(seedRoom({ sent: 150_000, max: 128_000, counted: 140_000 }), 128_000, "it counted less than Filament: nothing beyond");
    assert.equal(seedRoom({ sent: 150_000, max: 1_000_000, counted: null }), 150_000, "a limit above what it refused says nothing new");
    assert.equal(seedRoom({ sent: 150_000, max: null, counted: null }), 150_000, "it said nothing: under what it refused");
    assert.equal(seedRoom({ sent: 150_000, max: 200_000, counted: 400_000 }), 150_000, "its own share leaves no room: what it refused");
    // The compaction aims under it, and the turn's note says what the agent said.
    const service = readFileSync(new URL("../src/app/sessions/service.js", import.meta.url), "utf8");
    assert.match(service, /const room = seedRoom\(\{ sent: refused, max: told\.max, counted: told\.counted \}\);/);
    assert.match(service, /sessionModel: inner, window: room, measure: composeWith\.measure, trigger: "line"/);
  });

  // (fails before: yes — HarnessV4_Tasks U3-6, decision 15: the suggestion never took the agent's own compaction; it
  // was Self while the cache was warm, else Ours)
  test("the way: the session's choice where the agent has it, else the suggestion — its own compaction where it has one, then Self while the cache is warm, then Ours", () => {
    const can = { warm: true, self: true, own: true };
    assert.deepEqual(["own", "self", "ours", "suggested"].map((w) => agentWay(/** @type {any} */ (w), can).way), ["own", "self", "ours", "own"]);
    assert.deepEqual(agentWay("suggested", can), { way: "own", why: "suggested: the agent's own compaction" });
    assert.deepEqual(agentWay("suggested", { ...can, warm: false }), { way: "own", why: "suggested: the agent's own compaction" }, "warm or cold: it is the agent's own to do");
    assert.deepEqual(agentWay("suggested", { ...can, own: false }), { way: "self", why: "suggested: the agent's cache is warm, so it writes the summary from it" });
    assert.deepEqual(agentWay("suggested", { warm: false, self: true, own: false }), { way: "ours", why: "suggested: the agent's cache has gone cold, so Filament makes room on its copy" });
    assert.deepEqual(agentWay("suggested", { warm: true, self: false, own: false }), { way: "ours", why: "suggested: the agent cannot write the summary, so Filament makes room on its copy" });
    assert.deepEqual(agentWay("own", { ...can, own: false }), { way: "self", why: "this agent has no compaction of its own on demand; suggested: the agent's cache is warm, so it writes the summary from it" });
    assert.deepEqual(agentWay("self", { warm: true, self: false, own: true }), { way: "own", why: "this agent cannot write Filament's summary; suggested: the agent's own compaction" });
  });

  // (fails before: yes — the setting said the agent's cache was warm "within 5 minutes" of its last turn, where the
  // suggestion asks the agent's own clock, an hour)
  test("the way's setting says the clock the suggestion asks by: warm within the hour", () => {
    const doc = String(KNOBS["context.compaction.agent"].doc);
    assert.equal(AGENT_CACHE_MS, 60 * 60_000);
    assert.match(doc, /its last turn ended within the hour/);
    assert.doesNotMatch(doc, /within 5 minutes/);
  });
});

describe("an ACP agent's session (AC5-1)", () => {
  /** @type {AcpBridge} */ let bridge;
  const state = () => join(dir, "acp-sessions.json");
  const calls = () => lines(join(dir, "acp-calls.jsonl"));
  const prompts = () => lines(join(dir, "acp-prompts.jsonl")).map((p) => p.prompt);
  const up = () => ({
    id: "ag",
    name: "ag",
    type: "acp",
    acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(dir, "acp-calls.jsonl"), FAKE_ACP_LOG: join(dir, "acp-prompts.jsonl"), FAKE_ACP_SESSION_CAPS: "resume,close", FAKE_ACP_ALLOW_LOAD: "1" }, cwdDefault: dir, permissions: "allow-all" },
  });
  before(() => {
    bridge = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile: state() }));
  });
  after(() => bridge.shutdown());
  /** @param {string} text @param {number | null} base @param {any[]} [history] @param {string} [chat] @param {AcpBridge} [b] */
  const turn = (text, base, history = [], chat = "chat", b = bridge) =>
    b.run({ upstream: up(), modelId: "fake-a", format: "anthropic", body: bodyOf(text, history), conversationId: chat, headers: naming(base), onEvent: () => {} });
  /** The record of the chat's session, as the state file keeps it. */
  const saved = () => (existsSync(state()) ? Object.values(JSON.parse(readFileSync(state(), "utf8")).conversations).find((/** @type {any} */ c) => c.sessionId === [...bridge.convs.values()][0]?.sessionId) : null);

  test("a compaction since the session started: a fresh one from the harness's composition, the old one let go; then it is reused, and an outside client's request leaves it be", async () => {
    const one = await turn("one", 0);
    const fresh = await turn("three", 4, COMPOSED);
    assert.notEqual(fresh.sessionId, one.sessionId);
    assert.ok(calls().some((c) => c.method === "session/close" && c.sessionId === one.sessionId), "the old session let go");
    assert.equal(prompts().at(-1), `${COMPACTED_WORDS}:\n\n${SEEN}\n\n---\nLatest user message:\n\nthree`);
    assert.ok(fresh.notes.includes("acp: seeded from the chat as its compaction 4 left it: the harness's composition, 4 messages, ~68 tokens"), fresh.notes.join("\n"));
    assert.ok(fresh.notes.some((/** @type {string} */ n) => n.startsWith(`acp: the chat was compacted since session ${one.sessionId.slice(0, 8)} started`)), fresh.notes.join("\n"));
    const again = await turn("four", 4, after3("three"));
    assert.deepEqual([again.sessionId, prompts().at(-1)], [fresh.sessionId, "four"], "it stands on the newest");
    const outside = await turn("five", null, [...after3("three"), { role: "user", content: "four" }, { role: "assistant", content: "Echo: four" }]);
    assert.equal(outside.sessionId, fresh.sessionId, "a request that names no compaction leaves the session as it is");
    await until(() => saved()?.basedOn === 4, "the session map saved what the session stands on");
  });

  test("an undo brings back the session from before, which the map keeps across a restart; a turn past the compaction lets it go", async () => {
    const now = [...bridge.convs.values()][0];
    const old = calls().find((c) => c.method === "session/new").sessionId;
    // The record the agent's own compaction leaves (AC5-5): the session from before, on the compaction before.
    now.before = { ...now, sessionId: old, basedOn: 0, before: null };
    const closed = () => calls().filter((c) => c.method === "session/close" && c.sessionId === old).length;
    const was = closed();
    await turn("six", 4);
    assert.equal([...bridge.convs.values()][0].before, null, "a turn on the compacted session: the one from before can no longer come back");
    assert.equal(closed(), was + 1, "and is let go");

    now.before = { ...now, sessionId: old, basedOn: 0, before: null };
    bridge.convs.save();
    await until(() => saved()?.before?.sessionId === old, "the session from before saved");
    const restarted = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile: state() }));
    try {
      const back = await turn("seven", 0, [], "chat", restarted);
      assert.equal(back.sessionId, old);
      assert.ok(calls().some((c) => c.method === "session/resume" && c.sessionId === old), "reopened, its own history kept");
      assert.equal(prompts().at(-1), "seven", "nothing seeded: the session has the chat");
      assert.ok(back.notes.some((/** @type {string} */ n) => n.startsWith(`acp: back to session ${old.slice(0, 8)}, from before the compaction undone`)), back.notes.join("\n"));
    } finally {
      restarted.shutdown();
    }
  });

  test("a session the person resumes stands on the chat's newest compaction", async () => {
    const at = await bridge.attach({ upstream: up(), modelId: "fake-a", format: "anthropic", body: bodyOf("/resume sess_old1"), cwdHint: null, conversationId: "chat2", sessionId: "sess_old1", headers: naming(6) });
    assert.equal(at.ok, true, JSON.stringify(at));
    const r = await turn("go on", 6, [], "chat2");
    assert.equal(r.sessionId, "sess_old1", "kept, not let go for a fresh one");
  });

  // (fails before: no — a guard, from the review of the change that has a chat attaching the session it holds attach
  // nothing: its first form left the session on the compaction before, so the next turn let it go for a fresh one)
  test("a session the chat holds, resumed after a compaction, stands on the newest: kept, its place counted on the copy from there", async () => {
    /** @param {number} base */
    const at = (base) => bridge.attach({ upstream: up(), modelId: "fake-a", format: "anthropic", body: bodyOf("/resume sess_old1", COMPOSED), cwdHint: null, conversationId: "chat3", sessionId: "sess_old1", headers: naming(base) });
    assert.equal((await at(0)).ok, true);
    assert.equal((await turn("one", 0, [], "chat3")).sessionId, "sess_old1");
    const r = await at(6);
    assert.equal(r.ok, true, JSON.stringify(r));
    const two = await turn("go on", 6, COMPOSED, "chat3");
    assert.equal(two.sessionId, "sess_old1", "kept, not let go for a fresh one");
    assert.equal(prompts().at(-1), "go on", "the turns it counted were the copy's from before: none handed back on that count");
  });
});

describe("Codex's thread (AC5-1)", () => {
  /** @type {CodexBridge} */ let bridge;
  const heard = (/** @type {string} */ method) => lines(join(dir, "codex.jsonl")).filter((m) => m.method === method);
  const up = { id: "cx", name: "cx", type: "codex", acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], env: { FAKE_CODEX_CALLS: join(dir, "codex.jsonl") }, cwdDefault: dir, permissions: "allow-all" } };
  before(() => {
    bridge = new CodexBridge({ log: quiet, stateFile: join(dir, "codex-sessions.json") });
  });
  after(() => bridge.shutdown());
  /** @param {string} text @param {number | null} base @param {any[]} [history] @param {string} [chat] */
  const turn = (text, base, history = [], chat = "chat") =>
    bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body: bodyOf(text, history), conversationId: chat, headers: naming(base), onEvent: () => {} });

  test("a compaction since the thread started: a fresh one, the harness's composition its history; the old one let go; an undo brings it back", async () => {
    const one = await turn("one", 0);
    const fresh = await turn("three", 4, COMPOSED);
    assert.notEqual(fresh.sessionId, one.sessionId);
    assert.deepEqual(heard("thread/unsubscribe").map((m) => m.params.threadId), [one.sessionId]);
    const [inject] = heard("thread/inject_items");
    assert.equal(inject.params.threadId, fresh.sessionId);
    assert.deepEqual(inject.params.items.map((/** @type {any} */ i) => [i.role, i.content[0].text]), [["user", LEAD], ["assistant", SUMMARY_ACK], ["user", "two"], ["assistant", "Echo: two"]]);
    assert.equal(heard("turn/start").at(-1).params.input[0].text, "three");
    assert.ok(fresh.notes.includes("codex: seeded from the chat as its compaction 4 left it: the harness's composition, 4 message(s), ~53 tokens, as the thread's history"), fresh.notes.join("\n"));
    assert.equal((await turn("four", 4, after3("three"))).sessionId, fresh.sessionId);

    const now = /** @type {any} */ ([...bridge.convs.values()][0]);
    now.before = { ...now, sessionId: one.sessionId, basedOn: 0, before: null };
    const back = await turn("five", 0);
    assert.equal(back.sessionId, one.sessionId);
    assert.equal(heard("thread/resume").at(-1)?.params.threadId, one.sessionId);
    assert.deepEqual(heard("thread/unsubscribe").map((m) => m.params.threadId), [one.sessionId, fresh.sessionId], "the compacted thread let go");
  });

  test("a thread the person resumes stands on the chat's newest compaction", async () => {
    const started = heard("thread/start").length;
    const [thread] = (await bridge.listSessions(up)).sessions;
    const at = await bridge.attach({ upstream: up, format: "anthropic", body: bodyOf("/resume"), conversationId: "chat2", sessionId: thread.sessionId, headers: naming(6) });
    assert.equal(at.ok, true, JSON.stringify(at));
    const r = await turn("go on", 6, [], "chat2");
    assert.equal(r.sessionId, at.session.sessionId);
    assert.equal(heard("thread/start").length, started, "no fresh thread");
  });
});

describe("Cursor's SDK agent (AC5-1)", () => {
  /** @type {CursorSdkBridge} */ let bridge;
  const log = () => lines(join(dir, "sdk.jsonl"));
  before(() => {
    process.env.FAKE_SDK_LOG = join(dir, "sdk.jsonl");
    bridge = new CursorSdkBridge(/** @type {any} */ ({ log: quiet, stateFile: join(dir, "sdk-sessions.json"), loader: () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href) }));
  });
  after(() => {
    bridge.shutdown();
    delete process.env.FAKE_SDK_LOG;
  });
  const up = { id: "csdk", name: "csdk", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir } };
  /** @param {string} text @param {number | null} base @param {any[]} [history] */
  const turn = (text, base, history = []) =>
    bridge.run({ upstream: up, modelId: "grok-4.6", format: "anthropic", body: bodyOf(text, history), conversationId: "sdk-chat", headers: naming(base), onEvent: () => {} });

  test("a compaction since the agent started: a fresh one from the harness's composition, the old one closed; an undo brings it back; the map keeps what each stands on", async () => {
    const one = await turn("one", 0);
    const fresh = await turn("three", 4, COMPOSED);
    assert.notEqual(fresh.sessionId, one.sessionId);
    assert.ok(log().some((e) => e.event === "close" && e.agentId === one.sessionId), "the old agent closed");
    assert.equal(log().filter((e) => e.event === "send").at(-1).prompt, `${COMPACTED_WORDS}:\n\n${SEEN}\n\n---\nLatest user message:\n\nthree`);
    assert.equal((await turn("four", 4, after3("three"))).sessionId, fresh.sessionId);
    await until(() => {
      const file = join(dir, "sdk-sessions.json");
      return existsSync(file) && Object.values(JSON.parse(readFileSync(file, "utf8")).conversations).some((/** @type {any} */ c) => c.agentId === fresh.sessionId && c.basedOn === 4);
    }, "the map saved what the agent stands on");

    const now = /** @type {any} */ ([...bridge.convs.values()][0]);
    now.before = { ...now, agentId: one.sessionId, basedOn: 0, before: null };
    const back = await turn("five", 0);
    assert.equal(back.sessionId, one.sessionId);
    assert.ok(log().some((e) => e.event === "resume" && e.agentId === one.sessionId));
    assert.ok(log().some((e) => e.event === "close" && e.agentId === fresh.sessionId), "the compacted agent closed");
  });
});

describe("through the app: Compact now, then the next message (AC5-1)", () => {
  const SUMMARY = "SUMMARY: the turns so far, condensed.";
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  const calls = () => lines(join(root, "calls.jsonl"));
  /** What each prompt carries after Filament's own head, where it has one. */
  const prompts = () => lines(join(root, "prompts.jsonl")).map((p) => afterHead(p.prompt));
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-agent-session-compactions-app-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    // The compaction's writer: a model Filament calls. A trim never forks the session's cache, so it is never the agent.
    up = await fakeUpstream(() => anthropicReply(SUMMARY, { model: "m-1", usage: { input_tokens: 10, output_tokens: 5 } }));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "ag", name: "ag", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, "calls.jsonl"), FAKE_ACP_LOG: join(root, "prompts.jsonl"), FAKE_ACP_SESSION_CAPS: "resume,close" }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } },
        ];
        cfg.routes = [
          { match: "ag/*", upstream: "ag", upstreamModel: "{1}", enabled: true },
          { match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  /** @param {string} path @param {any} [init] */
  const json = async (path, init) => (await shim.api(path, init)).json();
  /** The person's words, long enough that a trim frees room. @param {string} w */
  const long = (w) => `${w} ${"words ".repeat(800)}`;

  test("the next message after Compact now goes to a fresh session from the compacted chat; one after an undo goes on in the session it was in", async () => {
    const id = String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model: "ag/fake-a", preset: "plain", settings: { context: { compaction: { model: "m-1" } } } } })).id);
    /** @param {string} content */
    const say = (content) => json(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    const compact = () => json(`/api/sessions/${encodeURIComponent(id)}/compact`, { method: "POST", body: { method: "summary" } });
    const opened = () => calls().filter((c) => c.method === "session/new").map((c) => c.sessionId);
    for (const t of ["one", "two", "three"]) await say(long(t));
    assert.equal(opened().length, 1);
    const trim = await compact();
    assert.equal(trim.ok, true, JSON.stringify(trim));
    assert.equal(opened().length, 1, "nothing happens to the agent until the next message");
    await say("four");
    const [first, second] = opened();
    assert.ok(second, "a fresh session");
    assert.ok(calls().some((c) => c.method === "session/close" && c.sessionId === first), "the old one let go");
    const seed = String(prompts().at(-1));
    assert.ok(seed.startsWith(`${COMPACTED_WORDS}:\n\n### User\n[Filament compacted `), seed.slice(0, 300));
    assert.ok(seed.includes(SUMMARY) && seed.endsWith("\n---\nLatest user message:\n\nfour"), seed.slice(-300));

    for (const t of ["five", "six"]) await say(long(t));
    const again = await compact();
    assert.equal(again.ok, true, JSON.stringify(again));
    const undone = await json(`/api/sessions/${encodeURIComponent(id)}/compactions/${again.compaction.id}/undo`, { method: "POST", body: {} });
    assert.equal(undone.undone?.method, "summary", JSON.stringify(undone));
    await say("seven");
    assert.deepEqual(opened(), [first, second], "no fresh session: the compaction was undone before the message");
    assert.equal(prompts().at(-1), "seven");
  });

  test("past the agent's line, as its usage_update counted it, the turn makes room by Ours, the session's way, and goes to a fresh session from it (AC5-3)", async () => {
    const id = String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model: "ag/fake-a", preset: "plain", settings: { context: { compaction: { model: "m-1", agent: "ours", mode: "auto" } } } } })).id);
    /** The turn's reply and its record. @param {string} content */
    const say = async (content) => {
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(res.status, 200, await res.clone().text());
      return { reply: await res.json(), rec: await shim.record(String(res.headers.get("x-filament-request-id"))) };
    };
    const known = new Set(calls().filter((c) => c.method === "session/new").map((c) => c.sessionId));
    const opened = () => calls().filter((c) => c.method === "session/new" && !known.has(c.sessionId)).map((c) => c.sessionId);
    await say("one ~holds 1000");
    await say("two ~holds 180000");
    assert.equal(opened().length, 1, "under the line: one session");
    const { rec } = await say("three");
    const [first, fresh] = opened();
    assert.ok(fresh, "a fresh session");
    assert.ok(calls().some((c) => c.method === "session/close" && c.sessionId === first), "the old one let go");
    assert.ok(String(prompts().at(-1)).startsWith(`${COMPACTED_WORDS}:\n\n### User\n[Filament compacted `), String(prompts().at(-1)).slice(0, 300));
    const said = (rec.changes || []).filter((/** @type {string} */ x) => /^compose: (agent|compaction):/.test(x));
    assert.deepEqual(said, [
      "compose: compaction: turns 1–2 summarized at the compaction line by m-1; nothing learned from them now: memory is off: nothing learns",
      "compose: agent: the agent's context holds 180,000 of its 200,000-token window, past the 170,000-token compaction line — Filament's methods on its copy (context.compaction.agent: ours); this turn starts a fresh agent session from the compaction",
    ], (rec.changes || []).join("\n"));
  });

  // (fails before: yes — the line was read off the newest finished turn, 1,000 here, so the turn went on in a session
  // holding 180,000: HarnessV4_Tasks A2, HarnessV3-RunawayTurns A6)
  test("a turn a restart cut off has the line's word: past it by the last count its run log kept, the next turn makes room (A2)", async () => {
    const id = String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model: "ag/fake-a", preset: "plain", settings: { context: { compaction: { model: "m-1", agent: "ours", mode: "auto" } } } } })).id);
    /** @param {string} content */
    const say = async (content) => {
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(res.status, 200, await res.clone().text());
      return shim.record(String(res.headers.get("x-filament-request-id")));
    };
    const known = new Set(calls().filter((c) => c.method === "session/new").map((c) => c.sessionId));
    const opened = () => calls().filter((c) => c.method === "session/new" && !known.has(c.sessionId)).map((c) => c.sessionId);
    await say("one ~holds 1000");
    // A turn a restart cut off, as the start after it leaves one (app/sessions/cut-turns.js): its message, the mark of
    // the request that ran it, and the agent's last count from its run log.
    /** @type {any} */
    const archive = shim.app.memory.archive;
    const { turnId } = archive.beginTurn(id, { requestId: "cut-run", model: "ag/fake-a", upstream: "ag", client: "harness", window: "harness", startedAt: 1_000, running: true, userMessage: { role: "user", content: [{ type: "text", text: "two" }] } });
    archive.mergeTurnMeta(turnId, { cut: { run: "cut-run", at: Date.now(), rounds: 3, tools: 5, logged: 0, held: { upstream: "ag", tokens: 180_000, window: 200_000, exact: true } } });
    const rec = await say("three");
    assert.equal(opened().length, 2, "a fresh session, from the compaction");
    const said = (rec.changes || []).filter((/** @type {string} */ x) => /^compose: agent:/.test(x));
    assert.deepEqual(said, ["compose: agent: the agent's context holds 180,000 of its 200,000-token window, past the 170,000-token compaction line — Filament's methods on its copy (context.compaction.agent: ours); this turn starts a fresh agent session from the compaction"], (rec.changes || []).join("\n"));
  });

  // (fails before: yes — HarnessV4_Tasks C26: the question waited 70 idle minutes and 100,000 tokens held, so this
  // session, an hour idle and holding 5,000, went on without a word)
  test("the page's send: a session whose cache has gone cold answers with the question, whatever it holds, and the page's Send as it is goes past it (AC5-3, C26)", async () => {
    const id = String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model: "ag/fake-a", preset: "plain" } })).id);
    await json(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "one ~holds 5000", stream: false } });
    // Its turn ended 59 minutes ago: within the longest life a cache has, so the message goes.
    const age = (/** @type {number} */ minutes) => /** @type {any} */ (shim.app.memory.archive).db.prepare("UPDATE turns SET started_at = started_at - ?, ended_at = ended_at - ? WHERE chain_id = ?").run(minutes * 60_000, minutes * 60_000, id);
    age(59);
    assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "one and a half ~holds 5000", stream: false } })).status, 200, "under the hour: no question");
    // …and 61 minutes ago: cold for sure.
    age(61);
    const realFetch = globalThis.fetch;
    globalThis.fetch = /** @type {any} */ ((/** @type {any} */ u, /** @type {any} */ init) => realFetch(typeof u === "string" && u.startsWith("/") ? shim.url + u : u, init));
    setInboundKey(shim.key);
    try {
      /** @param {boolean} sendAsIs */
      const send = (sendAsIs) => postTurn({ chainId: id, content: "two", sendAsIs, signal: new AbortController().signal, onHeaders: () => {}, onEvent: () => {} });
      const asked = await send(false);
      assert.equal(asked.status, 409);
      assert.match(String(asked.reply.error), /^This session has been idle 1 h 1 m, and .+ holds 5,000 tokens of its 200,000-token window: a coding agent's cache lasts 1 h at the most, so going on pays for all of it again at the full price\. Send it as it is, or make room first\?$/);
      const q = asked.reply.errorBody.resumeQuestion;
      assert.deepEqual([q.why, q.held, q.window, q.usable, q.reads.kind, q.reads.from, q.cache.state, q.cache.ttlMs, q.cache.seen], ["cold", 5_000, 200_000, 170_000, "agent", "session", "cold", 3_600_000, false]);
      const went = await send(true);
      assert.equal(went.status, 200, went.reply.error || "");
    } finally {
      globalThis.fetch = realFetch;
      setInboundKey("");
    }
    assert.equal(prompts().at(-1), "two");
  });

  // (fails before: yes — the idle sweep dropped the chat's session and closed it: the next message opened a new one,
  // whose first prompt was Filament's whole copy of the chat: HarnessV4_Tasks C25)
  test("a session left idle past its agent's idle limit goes on in the agent session it had, its message sent as typed (C25)", async () => {
    const id = String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model: "ag/fake-a", preset: "plain" } })).id);
    /** @param {string} content */
    const say = async (content) => {
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(res.status, 200, await res.clone().text());
      return shim.record(String(res.headers.get("x-filament-request-id")));
    };
    const known = new Set(calls().filter((c) => c.method === "session/new").map((c) => c.sessionId));
    const opened = () => calls().filter((c) => c.method === "session/new" && !known.has(c.sessionId)).map((c) => c.sessionId);
    for (const t of ["one", "two"]) await say(long(t));
    const [first] = opened();
    assert.equal(opened().length, 1);
    // Five hours on, past the four the agent's idle limit is.
    assert.equal(/** @type {any} */ (shim.app).acp.sweep(Date.now() + 5 * 3600_000), 0, "no chat of the harness is dropped");
    await until(() => calls().some((c) => c.method === "session/close" && c.sessionId === first), "the agent to close the idle session");
    const rec = await say("three");
    assert.deepEqual(opened(), [first], "no new session");
    assert.ok(calls().some((c) => c.method === "session/resume" && c.sessionId === first), "the session it had, opened again");
    assert.equal(prompts().at(-1), "three", "the message as typed, no earlier conversation with it");
    assert.deepEqual((rec.changes || []).filter((/** @type {string} */ x) => /seeded|new session/.test(x)), [], (rec.changes || []).join("\n"));
  });
});
