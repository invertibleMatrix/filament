// @ts-check
// proposal_ux §3.2, phase 2: the left bar. Now's model (lib/now.js): a turn's events folded in pieces, its line, the
// runs it follows and the chats whose threads it reads, its three groups — what needs you, what works, what finished —
// and its quiet line. The bar's parts as the source pins them: the Library at the foot, the filter menu's choices, the
// rail's buttons, a chat that needs you as an orange dot, the wide bar's second line, the menu's switch, Alt+N.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DONE_SHOWN, FOLD_TAIL, QUIET_MS, agentFailure, askLine, blankFold, chainsThatNeed, chainsWithThreads, readInTurns, foldEvents, foldLine, nowKey, nowRows, placeChats, quietWords, runsToFold, stayRow, teamLine } from "../src/ui/harness/lib/now.js";
import { barHold, notePlaces, playMoves } from "../src/ui/harness/bar-flight.js";
import { besideNamed, projectCountWords } from "../src/ui/harness/lib/labels.js";
import { h } from "../src/ui/lib/dom.js";
import { agentRow, NOW } from "./helpers/side-view.js";
import { stubDocument } from "./helpers/dom-stub.js";

const src = (/** @type {string} */ p) => readFileSync(new URL(`../src/ui/harness/${p}`, import.meta.url), "utf8");

/** A chat's turn as the runs list answers it. @param {string} id @param {string} chain @param {Record<string, any>} [over] */
const turn = (id, chain, over = {}) => ({ id, kind: "agent-turn", status: "running", startedAt: NOW - 120_000, endedAt: null, parentId: null, events: 40, meta: { chain, model: "claude-opus-5-5" }, ...over });

const CHATS = /** @type {Record<string, import("../src/ui/harness/lib/now.js").ChatFacts>} */ ({
  a: { title: "Fix the rail", project: "filament", when: NOW - 5_000, unread: false },
  b: { title: "Release notes", project: "site", when: NOW - 9_000, unread: true },
  c: { title: "Bench v2", project: "filament", when: NOW - 3_000, unread: true },
});

/** Now's groups over the given parts; nothing else on. @param {Partial<Parameters<typeof nowRows>[0]>} o */
const groups = (o) => nowRows({ runs: [], folds: new Map(), threads: new Map(), chats: (c) => CHATS[c] || null, unread: new Set(), holders: new Map(), now: NOW, ...o });

describe("Now: a turn's events, folded in pieces", () => {
  test("a round's start closes the calls before it; a call's end closes it; the newest event number is kept", () => {
    const f = foldEvents(blankFold(), [
      { n: 1, type: "round-start", round: 1 },
      { n: 2, type: "tool-start", round: 1, id: "t1", name: "read", card: { kind: "read", subject: "a.js" } },
      { n: 3, type: "tool-start", round: 1, id: "t2", name: "bash" },
    ]);
    assert.equal(f.calls.size, 2);
    foldEvents(f, [{ n: 4, type: "tool-end", id: "t2" }]);
    assert.deepEqual([...f.calls.keys()], ["t1"]);
    foldEvents(f, [{ n: 5, type: "round-start", round: 2 }]);
    assert.equal(f.calls.size, 0);
    assert.equal(f.round, 2);
    assert.equal(f.n, 5);
  });

  test("a question waits until its end; a worker's question to its lead is never yours", () => {
    const f = foldEvents(blankFold(), [{ n: 1, type: "ask", kind: "lead", id: "q0", question: "which file?" }]);
    const asked = () => f.ask?.question ?? null;
    assert.equal(asked(), null);
    foldEvents(f, [{ n: 2, type: "ask", kind: "permission", id: "q1", question: "run npm test", ts: NOW }]);
    assert.equal(asked(), "run npm test");
    foldEvents(f, [{ n: 3, type: "ask-end", id: "q9" }]);
    assert.equal(asked(), "run npm test", "another question's end leaves it");
    foldEvents(f, [{ n: 4, type: "ask-end", id: "q1" }]);
    assert.equal(asked(), null);
  });

  // (fails before: yes — the review of 11-03: each showing again of an ask set the Now row's time anew)
  test("an ask shown again waits since it was first asked", () => {
    const f = foldEvents(blankFold(), [{ type: "ask", kind: "question", id: "q1", question: "one", ts: 100 }]);
    foldEvents(f, [{ type: "ask", kind: "question", id: "q1", question: "two", ts: 900 }]);
    assert.deepEqual([f.ask?.question, f.ask?.at], ["two", 100]);
    foldEvents(f, [{ type: "ask", kind: "question", id: "q2", question: "another", ts: 1200 }]);
    assert.equal(f.ask?.at, 1200, "another ask: its own time");
  });

  test("the first read takes the newest events, enough for a round and its calls", () => {
    assert.ok(FOLD_TAIL >= 100);
  });

  test("its line: the call by its card, several counted, else the loop's state; nothing read yet is working", () => {
    assert.equal(foldLine(null), "working");
    const f = foldEvents(blankFold(), [{ type: "round-start", round: 75 }, { type: "tool-start", round: 75, id: "t", name: "read", card: { kind: "read", subject: "side.js" } }]);
    assert.equal(foldLine(f), "round 75 · reading side.js");
    foldEvents(f, [{ type: "tool-start", round: 75, id: "u", name: "bash" }]);
    assert.equal(foldLine(f), "round 75 · running 2 tool calls");
    foldEvents(f, [{ type: "round-start", round: 76 }, { type: "turn-state", to: "planning" }]);
    assert.equal(foldLine(f), "round 76 · thinking");
  });

  test("a question in a row's words", () => {
    assert.equal(askLine({ kind: "proposal", id: null, question: "", at: 0 }), "its plan waits for your yes");
    assert.equal(askLine({ kind: "permission", id: "1", question: "run\n npm   test", at: 0 }), "waits for your yes: run npm test");
    assert.equal(askLine({ kind: "question", id: "1", question: "Which branch?", at: 0 }), "asks: Which branch?");
    assert.equal(askLine({ kind: "question", id: "1", question: "", at: 0 }), "asks you");
  });
});

describe("Now: what it follows", () => {
  test("each chat's newest turn that runs or waits on you, never a sub-agent's run, six at most", () => {
    const runs = [
      turn("r1", "a"),
      turn("r0", "a", { status: "paused" }),
      turn("s1", "a", { kind: "subagent" }),
      turn("r2", "b", { status: "paused", endedAt: NOW - 1_000 }),
      turn("r3", "c", { status: "done", endedAt: NOW - 2_000 }),
      turn("r4", "", {}),
    ];
    assert.deepEqual(runsToFold(runs).map((r) => r.id), ["r1", "r2"]);
    const many = Array.from({ length: 9 }, (_, i) => turn(`x${i}`, `chain${i}`));
    assert.equal(runsToFold(many).length, 6);
    assert.equal(runsToFold(many, 2).length, 2);
  });

  // (fails before: yes — the owner's of 10-28: four at most, and a fifth chat's thread that asked you never showed)
  test("the chats whose threads it reads: those with a sub-agent's run, once each, every one", () => {
    const runs = [turn("s1", "a", { kind: "subagent" }), turn("s2", "a", { kind: "subagent" }), turn("r1", "b"), ...Array.from({ length: 5 }, (_, i) => turn(`s${i + 3}`, `k${i}`, { kind: "subagent" }))];
    assert.deepEqual(chainsWithThreads(runs), ["a", "k0", "k1", "k2", "k3", "k4"]);
  });

  // (fails before: yes — only an unseen failure kept a chat read once its runs left the list; a thread that asked you, or
  // whose changes waited for your Apply, fell out of Needs you)
  test("a chat whose thread needs you is read on with no run of it in the list, as one whose agent failed unseen is", () => {
    const asks = agentRow("y1", { status: "running", progress: { asking: { kind: "question", question: "Keep the old route?", at: NOW } } });
    const waits = agentRow("y2", { status: "done", work: { pending: 2 } });
    const helpersOwn = agentRow("h1", { origin: "agent", status: "done", work: { pending: 1 } });
    const failed = agentRow("f1", { status: "failed", error: "it broke" });
    const threads = new Map([["asks", [asks]], ["waits", [waits]], ["agents", [helpersOwn]], ["failed", [failed]], ["quiet", [agentRow("q1")]]]);
    assert.deepEqual(chainsThatNeed(threads, () => false), ["asks", "waits", "failed"], "the main agent's own helper's work is its agent's");
    assert.deepEqual(chainsThatNeed(threads, (r) => r.id === "f1"), ["asks", "waits"], "a failure you saw lets it go");
  });

  // (fails before: yes — every chat's threads were read at once, beside the runs list and the folds, over six connections)
  test("the threads are read two at a time, every one of them", async () => {
    let now = 0;
    let most = 0;
    /** @type {string[]} */
    const done = [];
    await readInTurns(["a", "b", "c", "d", "e"], async (c) => {
      most = Math.max(most, ++now);
      await new Promise((r) => setTimeout(r, 5));
      now--;
      done.push(c);
    }, 2);
    assert.equal(most, 2);
    assert.deepEqual(done.sort(), ["a", "b", "c", "d", "e"]);
    await readInTurns([], async () => assert.fail("none to read"), 2);
  });
});

describe("Now: its three groups", () => {
  test("a paused turn needs you, with a hand on an orange tile", () => {
    const g = groups({ runs: [turn("r1", "a", { status: "paused", endedAt: NOW - 1_000 })] });
    assert.equal(g.needs.length, 1);
    assert.deepEqual([g.needs[0].title, g.needs[0].project, g.needs[0].fact, g.needs[0].icon, g.needs[0].tile, g.needs[0].tone], ["Fix the rail", "filament", "waits for your yes", "hand", "needs", "asks"]);
  });

  test("a running turn whose fold holds a question needs you, in the question's words", () => {
    const folds = new Map([["r1", foldEvents(blankFold(), [{ type: "ask", kind: "question", id: "q", question: "Which branch?", ts: NOW }])]]);
    const g = groups({ runs: [turn("r1", "a")], folds });
    assert.equal(g.needs[0].fact, "asks: Which branch?");
    assert.equal(g.works.length, 0);
  });

  test("a running turn works: its round and call, its model's tile, the main agent's helpers counted", () => {
    const folds = new Map([["r1", foldEvents(blankFold(), [{ type: "round-start", round: 3 }, { type: "turn-state", to: "observing" }])]]);
    const threads = new Map([["a", [agentRow("h1", { origin: "agent", status: "running" }), agentRow("h2", { origin: "agent", status: "running" })]]]);
    const g = groups({ runs: [turn("r1", "a")], folds, threads });
    assert.equal(g.works.length, 1);
    assert.deepEqual([g.works[0].fact, g.works[0].tile, g.works[0].model], ["round 3 · reading results · 2 agents", "model", "claude-opus-5-5"]);
    // (fails before: yes — U5 phase 8's pictures: a coding agent's lane said "Opus Xhigh", its model read without its
    // agent, which the catalogue cannot name)
    const coder = turn("r2", "b", { kind: "coding-agent", meta: { chain: "b", engine: "acp", upstream: "claude-code-northwind", model: "opus-xhigh" } });
    assert.equal(groups({ runs: [coder] }).works[0].model, "claude-code-northwind/opus-xhigh", "a coding agent's model as the catalogue spells it");
  });

  // (fails before: yes — the Designer's of 10-27: the row took its team's name for a title, so the chat read one way in
  // Now and another under its project, where it goes back)
  test("a team: its lead's row keeps the chat's title, the team leading on its line, its workers folded under it", () => {
    // Each worker runs as its member's card, and is called by its card's name (the review of 11-03: never its id).
    const worker = (/** @type {string} */ id, /** @type {string} */ role) => agentRow(id, { origin: "agent", status: "running", team: { name: "Architect", role: role.toLowerCase() }, card: { tag: role.toLowerCase(), name: role }, task: "t2", exchanges: [{ description: "map the routes", startedAt: NOW - 10_000 }] });
    const threads = new Map([["a", [worker("w1", "Engineer"), worker("w2", "Reviewer")]]]);
    const g = groups({ runs: [turn("r1", "a")], threads });
    const lead = g.works[0];
    assert.deepEqual([lead.title, lead.tile, lead.icon, lead.team], ["Fix the rail", "lead", "users", "Architect"]);
    assert.equal(lead.fact, "Architect leads · working · 2 workers");
    assert.deepEqual(lead.under.map((u) => u.name), ["Engineer · t2 map the routes", "Reviewer · t2 map the routes"]);
    // (fails before: yes — the review of 11-03: a seat the team names was listed by its member's id)
    const named = agentRow("w3", { origin: "agent", status: "running", team: { name: "Architect", role: "fact-checker", seat: "Fact Checker" }, card: { tag: "reviewer", name: "Reviewer" }, task: "t2", exchanges: [{ description: "map the routes", startedAt: NOW - 10_000 }] });
    assert.deepEqual(groups({ runs: [turn("r1", "a")], threads: new Map([["a", [named]]]) }).works[0].under.map((u) => u.name), ["Fact Checker · t2 map the routes"]);
  });

  // (fails before: yes — the Hunter's find of 10-27: the lead's turn over, a chat whose workers worked on was in no
  // group, and they in no line)
  test("a team whose lead's turn is over while its workers work on: still the lead's row under Working, its workers under it", () => {
    const worker = (/** @type {string} */ id, /** @type {string} */ role, /** @type {number} */ ago) => agentRow(id, { origin: "agent", status: "running", startedAt: NOW - ago, team: { name: "Architect", role: role.toLowerCase() }, card: { tag: role.toLowerCase(), name: role }, task: "t2", exchanges: [{ description: "map the routes", startedAt: NOW - ago }] });
    const threads = new Map([["a", [worker("w1", "Engineer", 40_000), worker("w2", "Reviewer", 10_000)]]]);
    const runs = [turn("r1", "a", { status: "done", endedAt: NOW - 5_000 })];
    const g = groups({ runs, threads });
    assert.deepEqual(g.done, []);
    assert.equal(g.works.length, 1);
    const lead = g.works[0];
    assert.deepEqual([lead.title, lead.fact, lead.icon, lead.tile, lead.team, lead.at], ["Fix the rail", "Architect leads · 2 workers at work", "users", "lead", "Architect", NOW - 40_000]);
    assert.deepEqual(lead.under.map((u) => [u.name, u.thread]), [["Engineer · t2 map the routes", "w1"], ["Reviewer · t2 map the routes", "w2"]]);
    // Unread, its end comes first; one of the main agent's at work with them is counted beside them, a line after theirs.
    const helper = agentRow("h1", { origin: "agent", status: "running", startedAt: NOW - 60_000, exchanges: [{ description: "Check the tests", startedAt: NOW - 60_000 }] });
    const both = groups({ runs, threads: new Map([["a", [...(threads.get("a") || []), helper]]]), unread: new Set(["a"]) }).works[0];
    assert.equal(both.fact, "finished · Architect leads · 2 workers, 1 agent at work");
    assert.deepEqual(both.under.map((u) => u.thread), ["w1", "w2", "h1"]);
    // A team on the side the same: a line under the chat it works for while its workers work on, never a row of its own.
    const beside = (/** @type {string} */ c) => (c === "t1" ? { main: "a", name: "Bug Hunter" } : null);
    const side = groups({ runs: [turn("rt", "t1", { status: "done", endedAt: NOW - 5_000 })], threads: new Map([["t1", [worker("w3", "Hunter", 20_000)]]]), beside });
    assert.deepEqual(side.works.map((r) => [r.chain, r.fact, r.under.map((u) => u.name)]), [["a", "1 team at work", ["Bug Hunter team"]]]);
    // Its lead asking you, a row of its own as ever.
    const asks = groups({ runs: [turn("rt", "t1", { status: "paused", endedAt: NOW - 5_000 })], threads: new Map([["t1", [worker("w3", "Hunter", 20_000)]]]), beside });
    assert.deepEqual([asks.needs.map((r) => r.chain), asks.works.map((r) => r.chain)], [["t1"], []]);
  });

  // (fails before: yes — a worker's change in its copy, waiting for its lead's apply while the lead worked, stood under
  // Needs you: "Builder · for Fix the rail · 2 files to apply")
  test("a worker's change that waits while its team leads the chat and its lead is at work is the lead's to apply: a line under the lead's row, no row under Needs you; the lead gone, or the chat handed back, it is yours", () => {
    const team = { key: "builders", name: "Builders", role: "builder", charge: true };
    const waits = agentRow("w1", { origin: "agent", team, task: "t2", work: { pending: 2 }, exchanges: [{ description: "build the cart", startedAt: NOW - 50_000, endedAt: NOW - 20_000 }] });
    const tester = agentRow("w2", { origin: "agent", status: "running", team: { ...team, role: "tester", seat: "Tester" }, task: "t3", exchanges: [{ description: "run the suite", startedAt: NOW - 10_000 }] });
    const over = turn("r1", "a", { status: "done", endedAt: NOW - 5_000 });
    const yours = ["Builder · for Fix the rail", "2 files to apply", "w1", "needs"];
    /** @param {import("../src/ui/harness/lib/now.js").NowRow[]} rows */
    const said = (rows) => rows.map((r) => [r.title, r.fact, r.thread, r.tile]);
    // The lead at its turn: the change is a line under its row, after its workers at work.
    let g = groups({ runs: [turn("r1", "a")], threads: new Map([["a", [waits]]]) });
    assert.deepEqual(said(g.needs), []);
    assert.deepEqual(said(g.works), [["Fix the rail", "Builders leads · working", null, "lead"]]);
    assert.deepEqual(g.works[0].under.map((u) => [u.name, u.thread]), [["Builder · t2 build the cart · 2 files for its lead to apply", "w1"]]);
    g = groups({ runs: [turn("r1", "a")], threads: new Map([["a", [waits, tester]]]) });
    assert.deepEqual([said(g.needs), g.works[0].fact], [[], "Builders leads · working · 1 worker"]);
    assert.deepEqual(g.works[0].under.map((u) => u.thread), ["w2", "w1"]);
    // Its turn over while another of its workers works on: the lead comes back for both.
    g = groups({ runs: [over], threads: new Map([["a", [waits, tester]]]) });
    assert.deepEqual([said(g.needs), g.works[0].fact, g.works[0].under.map((u) => u.thread)], [[], "Builders leads · 1 worker at work", ["w2", "w1"]]);
    // The lead gone — its turn over, none of its workers at work: yours to apply.
    g = groups({ runs: [over], threads: new Map([["a", [waits]]]) });
    assert.deepEqual(said(g.needs), [yours]);
    // The chat handed back: its team leads it no more, and the turn at work is your agent's.
    const orphan = { ...waits, team: { key: "builders", name: "Builders", role: "builder" } };
    g = groups({ runs: [turn("r1", "a")], threads: new Map([["a", [orphan]]]) });
    assert.deepEqual([said(g.needs), said(g.works), g.works[0].under], [[yours], [["Fix the rail", "working", null, "model"]], []]);
    // One you started is yours whoever is at work.
    const own = agentRow("y1", { work: { pending: 1 } });
    g = groups({ runs: [turn("r1", "a")], threads: new Map([["a", [own, waits]]]) });
    assert.deepEqual(said(g.needs), [["Builder · for Fix the rail", "1 file to apply", "y1", "needs"]]);
  });

  // (fails before: yes — the owner's of 10-28: "flow was running but the thread was moved back into project. the
  // condition should be if anything under this thread is running like flows, sub agents then it should still stay
  // inside working even if the thread itself has ended it's turn")
  test("a chat whose flow is at work stays under Working once its turn is over, the flow's line on its row; a flow that asks you needs you", () => {
    const fl = (/** @type {string} */ id, /** @type {string} */ line, asks = false) => ({ chainId: "a", id, state: /** @type {const} */ ("running"), line, asks, at: NOW - 30_000 });
    const ended = [turn("r1", "a", { status: "done", endedAt: NOW - 5_000 })];
    const g = groups({ runs: ended, flows: new Map([["a", [fl("fl1", "Flow · step 1 of 3")]]]) });
    assert.deepEqual([g.done, g.needs], [[], []]);
    assert.deepEqual(g.works.map((r) => [r.chain, r.fact, r.icon, r.at]), [["a", "Flow · step 1 of 3", "waypoints", NOW - 30_000]]);
    // Unread, its end first, as for a command; never in Done as well.
    const unread = groups({ runs: ended, flows: new Map([["a", [fl("fl1", "Flow · step 1 of 3")]]]), unread: new Set(["a"]) });
    assert.deepEqual([unread.works.map((r) => r.fact), unread.done], [["finished · Flow · step 1 of 3"], []]);
    // Its turn still running: the flow's line on the row it has.
    const live = groups({ runs: [turn("r1", "a")], flows: new Map([["a", [fl("fl1", "Flow in place · step 2 of 3")]]]) });
    assert.deepEqual(live.works.map((r) => r.fact), ["working · Flow in place · step 2 of 3"]);
    // Asking you (your review, a gate, a box that failed): its own row under Needs, which opens the chat.
    const asks = groups({ runs: ended, flows: new Map([["a", [fl("fl2", "Flow · step 2 of 3 · your review", true)]]]) });
    assert.deepEqual(asks.needs.map((r) => [r.key, r.chain, r.thread, r.fact, r.tone, r.icon, r.at]), [["flow:fl2", "a", null, "Flow · step 2 of 3 · your review", "asks", "waypoints", NOW - 30_000]]);
    assert.deepEqual(asks.works, []);
    // Two at once, counted.
    const two = groups({ runs: ended, flows: new Map([["a", [fl("fl1", "Flow · step 1 of 3"), fl("fl3", "Flow · step 1 of 2")]]]) });
    assert.deepEqual(two.works.map((r) => r.fact), ["2 flows at work"]);
  });

  test("a thread you started that asks you needs you, named for its chat; a worker's question to its lead does not", () => {
    const yours = agentRow("y1", { status: "running", progress: { asking: { kind: "question", question: "Keep the old route?", at: NOW - 2_000 } } });
    const toLead = agentRow("w1", { origin: "agent", status: "running", team: { name: "Architect", role: "Engineer" }, progress: { asking: { to: "lead", question: "which file?" } } });
    const g = groups({ threads: new Map([["a", [yours, toLead]]]) });
    assert.equal(g.needs.length, 1);
    assert.equal(g.needs[0].title, "Builder · for Fix the rail");
    assert.equal(g.needs[0].thread, "y1");
    assert.equal(g.needs[0].key, "thread:y1");
  });

  // (fails before: yes — the Designer's of 10-27: a chat's failure said "Stopped: …" beside an agent's "failed: …", and
  // "stopped" is a Stop's word)
  test("a turn that ended unread: a failure needs you in red, the rest are done", () => {
    const runs = [
      turn("r1", "a", { status: "error", endedAt: NOW - 1_000, summary: { error: "the provider\nrefused" } }),
      turn("r2", "b", { status: "done", endedAt: NOW - 2_000 }),
      turn("r3", "c", { status: "stopped", endedAt: NOW - 3_000 }),
    ];
    const g = groups({ runs, unread: new Set(["a", "b", "c"]) });
    assert.deepEqual(g.needs.map((r) => [r.fact, r.tone, r.icon]), [["failed: the provider refused", "error", "circleAlert"]]);
    assert.deepEqual(g.done.map((r) => [r.title, r.fact, r.tile]), [["Release notes", "finished", "done"], ["Bench v2", "stopped", "done"]]);
  });

  test("a turn read already is in no group; another window's turn works; an unread chat with no run is done", () => {
    const g = groups({ runs: [turn("r1", "a", { status: "done", endedAt: NOW - 1_000 })], holders: new Map([["b", { label: "VS Code", since: NOW - 4_000 }]]), unread: new Set(["c"]) });
    assert.deepEqual(g.works.map((r) => [r.chain, r.fact]), [["b", "VS Code is working"]]);
    assert.deepEqual(g.done.map((r) => r.chain), ["c"]);
    assert.equal(g.needs.length, 0);
  });

  test("each group newest first", () => {
    const runs = [turn("r1", "a", { startedAt: NOW - 50_000 }), turn("r2", "b", { startedAt: NOW - 5_000 })];
    assert.deepEqual(groups({ runs }).works.map((r) => r.chain), ["b", "a"]);
  });

  test("its key moves with what a row shows, and only then", () => {
    const one = groups({ runs: [turn("r1", "a")] });
    const same = groups({ runs: [turn("r1", "a", { startedAt: NOW - 1 })] });
    const moved = groups({ runs: [turn("r1", "a", { status: "paused" })] });
    assert.equal(nowKey(one), nowKey(same));
    assert.notEqual(nowKey(one), nowKey(moved));
  });
});

describe("Now: quiet", () => {
  test("one line: nothing running, with what finished today, else since you looked", () => {
    const today = new Date(NOW);
    const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const row = (/** @type {number} */ at) => /** @type {any} */ ({ at });
    assert.equal(quietWords([], NOW), "Nothing running");
    assert.equal(quietWords([row(midnight + 1), row(midnight + 2), row(midnight - 86_400_000)], midnight + 3), "Nothing running · 2 finished today");
    assert.equal(quietWords([row(midnight - 86_400_000)], midnight + 3), "Nothing running · 1 finished");
    assert.equal(DONE_SHOWN, 3);
  });
});

describe("the left bar's parts", () => {
  const sidebar = src("sidebar.js");
  const now = src("now-list.js");

  test("the Library at the foot: Agents and teams, Skills, Memory, Plugins & Connectors, Artifacts, each opened through the page", () => {
    // Plugins and Connectors are one row since the owner's of 11-09 (test/library-plugins-connectors.test.js).
    const labels = ["Agents and teams", "Skills", "Memory", "Plugins & Connectors", "Artifacts"];
    for (const label of labels) assert.ok(sidebar.includes(`label: "${label}"`), label);
    const at = labels.map((label) => sidebar.indexOf(`label: "${label}"`));
    assert.deepEqual([...at].sort((a, b) => a - b), at, "in that order (the Designer's of 10-26)");
    assert.match(sidebar, /cb\.onLibrary\?\.\(it\.id\)/);
    const app = src("app.js");
    // (fails before: yes — phase 7: three of them opened Settings until the Library had pages of its own)
    assert.match(app, /onLibrary: \(page\) => \{ location\.hash = page === "artifacts" \? routeFor\("artifacts"\) : routeFor\("library", \{ page \}\); \}/);
    assert.match(sidebar, /function atLibrary\(page\)/, "the page open is marked on its row");
  });

  test("the filter menu: group, sort, the three switches, expand and collapse", () => {
    for (const w of ["Group by", "Project", "Time", "Sort by", "Updated", "Created", "Now on top", "Show archived", "Rounds and agents", "Expand all", "Collapse all"]) assert.ok(sidebar.includes(`"${w}"`), w);
    // An item for later is no item (the Designer's review of 10-24): "My groups — later" is gone.
    assert.ok(!sidebar.includes('"My groups"'));
    assert.equal((sidebar.match(/type: "switch"/g) || []).length, 3);
  });

  test("a chat that needs you is an orange dot with what it waits on; the old badge is gone", () => {
    assert.match(sidebar, /row-dot needs/);
    assert.doesNotMatch(sidebar, /Awaiting approval/);
    assert.match(sidebar, /now\.factOf\(/);
  });

  test("the collapsed rail: New chat, Search, Now with its badge, Projects, the Library, Settings", () => {
    for (const c of ["rail-new", "rail-now", "rail-badge"]) assert.ok(sidebar.includes(c), c);
    assert.match(sidebar, /popover\(railNow, /);
  });

  test("with no chat: Open a folder to start", () => {
    assert.match(sidebar, /Open a folder to start/);
    assert.match(sidebar, /cb\.onOpenFolder/);
  });

  test("the wide bar: from 300px, or in a 2200px window, its rows on two lines", () => {
    const shell = src("shell.js");
    assert.match(shell, /WIDE_SIDE = 300/);
    assert.match(shell, /WIDE_WINDOW = 2200/);
    assert.match(shell, /classList\.toggle\("wide", /);
    assert.match(src("../harness.css"), /\.side-frame\.wide \.row-two/);
  });

  test("Now reads only while the page is seen, from where it stopped, and draws only when a row moved", () => {
    assert.match(now, /document\.visibilityState !== "visible"/);
    assert.match(now, /FOLD_TAIL/);
    assert.match(now, /nowKey\(/);
  });

  test("Alt+N opens the next that needs you; no press here answers or starts", () => {
    assert.match(src("shortcuts.js"), /\{ id: "next-needs", label: "Open What Needs You Next", combo: "Alt\+N", scope: "global" \}/);
    assert.match(src("app.js"), /"next-needs": \(\) => openNextNeeds\(\)/);
    assert.doesNotMatch(now, /api\([^)]*method: "POST"/);
  });

  test("the menu's switch: a check drawn as a toggle, read as one", () => {
    const ui = src("lib/ui.js");
    assert.match(ui, /type === "switch"/);
    assert.match(ui, /menuitemcheckbox/);
    assert.match(ui, /zc-menu-switch/);
  });
});

// The owner's words of 10-26: "have it show up as a child … the way team worker shows up and make it disappear when the
// agent sends it's envelope after finishing up or show some indicator if it fails so that owner can go and retry" — as
// the Designer answered it.
describe("Now: the main agent's own agents", () => {
  /** One of the main agent's agents, started `ago` ms before now. @param {string} id @param {number} ago @param {Record<string, any>} [over] */
  const mine = (id, ago, over = {}) => agentRow(id, { origin: "agent", status: "running", startedAt: NOW - ago, exchanges: [{ description: `Job ${id}`, startedAt: NOW - ago, endedAt: null, delivery: "auto" }], ...over });
  /** One that ended as `status` says, its try's outcome `outcome`. @param {string} id @param {string} status @param {any} outcome @param {Record<string, any>} [over] */
  const ended = (id, status, outcome, over = {}) => mine(id, 90_000, { status, exchanges: [{ description: `Job ${id}`, startedAt: NOW - 90_000, endedAt: NOW - 30_000, delivery: "auto", outcome }], ...over });
  const RESET = { report: "", error: "round 2's model call failed", stoppedBy: null, failure: { what: "round 2's model call", where: "glm-5.3-flash at zai", said: "the connection was reset", at: NOW - 30_000 } };

  // (fails before: yes — they were a count on the row alone, "· 2 agents")
  test("at work, they are lines under their chat's row, in the order they started, as a lead's workers are; the row keeps its count", () => {
    const threads = new Map([["a", [mine("h2", 10_000), mine("h1", 50_000, { exchanges: [{ description: "Check the tests", startedAt: NOW - 50_000, endedAt: null }] }), agentRow("y1", { status: "done" })]]]);
    const g = groups({ runs: [turn("r1", "a")], threads });
    assert.equal(g.works.length, 1);
    assert.match(g.works[0].fact, / · 2 agents$/);
    assert.deepEqual(g.works[0].under.map((u) => [u.name, u.thread, u.at]), [["Builder · Check the tests", "h1", NOW - 50_000], ["Builder · Job h2", "h2", NOW - 10_000]]);
    // A paused turn's row needs you, its agents under it all the same.
    const paused = groups({ runs: [turn("r1", "a", { status: "paused", endedAt: NOW - 1_000 })], threads });
    assert.deepEqual(paused.needs[0].under.map((u) => u.thread), ["h1", "h2"]);
    assert.ok(nowKey(g) !== nowKey(groups({ runs: [turn("r1", "a")], threads: new Map([["a", [mine("h1", 50_000)]]]) })), "a line that goes draws again");
  });

  // (fails before: yes — the turn over, nothing in Now said they worked on)
  test("the turn over, its chat stays under Working while they work on: its end first where unread, its own tile, from the oldest's start", () => {
    const threads = new Map([["a", [mine("h1", 50_000), mine("h2", 10_000)]], ["b", [mine("h3", 20_000)]]]);
    const runs = [turn("r1", "a", { status: "done", endedAt: NOW - 5_000 }), turn("r2", "b", { status: "done", endedAt: NOW - 4_000 })];
    const g = groups({ runs, threads, unread: new Set(["b"]) });
    assert.deepEqual(g.done, [], "no chat is done while its agents work");
    const by = Object.fromEntries(g.works.map((r) => [r.chain, r]));
    assert.deepEqual([by.a.fact, by.a.icon, by.a.at, by.a.under.length], ["2 agents at work", "messageSquare", NOW - 50_000, 2]);
    assert.deepEqual([by.b.fact, by.b.under.map((u) => u.name)], ["finished · 1 agent at work", ["Builder · Job h3"]]);
    // A command of theirs running too: said after them; commands alone keep the terminal's tile.
    const cmd = { id: "bg_1", command: "npm test", cwd: "C:\work", startedAt: NOW - 70_000, agent: null, line: "", logPath: null };
    const both = groups({ runs, threads, commands: new Map([["a", [cmd]], ["c", [cmd]]]) });
    const of = Object.fromEntries(both.works.map((r) => [r.chain, r]));
    assert.deepEqual([of.a.fact, of.a.icon, of.a.at], ["2 agents at work · 1 command running: npm test", "messageSquare", NOW - 70_000]);
    assert.equal(of.c.icon, "terminal");
    // Done, its line goes, and the chat with it: its answer is the main agent's to read.
    assert.deepEqual(groups({ runs, threads: new Map([["a", [ended("h1", "done", { report: "ok", stoppedBy: null })]]]) }).works, []);
  });

  // (fails before: yes — a failure of theirs was said only on its card in the chat and its row in the Agents tab)
  test("one that failed or was cut off needs you, in its failure's own words, until its try was seen; a stop, a budget, a team's worker and a graph task's do not", () => {
    const threads = new Map([["a", [ended("f1", "failed", RESET), ended("f2", "aborted", { report: "", stoppedBy: null }), ended("f3", "aborted", { report: "", stoppedBy: null }, { cut: true }), ended("f4", "failed", { report: "", stoppedBy: null })]]]);
    const g = groups({ threads });
    assert.deepEqual(g.needs.map((r) => [r.title, r.fact, r.tone, r.tile, r.thread, r.at]), [
      ["Builder · for Fix the rail", "failed: the connection was reset", "error", "agent", "f1", NOW - 30_000],
      ["Builder · for Fix the rail", "cut off", "error", "agent", "f2", NOW - 30_000],
      ["Builder · for Fix the rail", "cut off: Filament restarted before it finished", "error", "agent", "f3", NOW - 30_000],
      ["Builder · for Fix the rail", "failed", "error", "agent", "f4", NOW - 30_000],
    ]);
    // Seen — its thread opened in the Agents tab since — it goes; the others stay.
    assert.deepEqual(groups({ threads, seen: (r) => r.id === "f1" }).needs.map((r) => r.thread), ["f2", "f3", "f4"]);
    // Ends that need nothing of you.
    for (const r of [
      ended("s1", "aborted", { report: "", stoppedBy: "owner" }),
      ended("s2", "failed", { report: "", stoppedBy: "agent" }),
      ended("s3", "budget-stopped", { report: "partial", stoppedBy: null }),
      ended("s4", "stopped", { report: "", stoppedBy: "owner" }),
      ended("w1", "failed", RESET, { team: { name: "Architect", role: "Engineer" } }),
      ended("t1", "failed", RESET, { task: { id: "t1", review: false } }),
    ])
      assert.equal(agentFailure(r), null, r.id);
    // Asked again, it works: a line under its chat, no longer a row of its own.
    const again = groups({ runs: [turn("r1", "a")], threads: new Map([["a", [mine("f1", 5_000)]]]) });
    assert.deepEqual([again.needs.length, again.works[0].under.map((u) => u.thread)], [0, ["f1"]]);
  });

  // (fails before: yes — a thread you asked yourself that failed left Now without a word)
  test("one you asked yourself — in Start… or by a command — that failed or was cut off needs you the same way; one that started by itself does not", () => {
    const threads = new Map([["a", [
      ended("o1", "failed", RESET, { origin: "owner" }),
      ended("c1", "aborted", { report: "", stoppedBy: null }, { origin: "command", cut: true }),
      ended("o2", "aborted", { report: "", stoppedBy: "owner" }, { origin: "owner" }),
      ended("e1", "failed", RESET, { origin: "self" }),
    ]]]);
    const g = groups({ threads });
    assert.deepEqual(g.needs.map((r) => [r.title, r.fact, r.tone, r.thread]), [
      ["Builder · for Fix the rail", "failed: the connection was reset", "error", "o1"],
      ["Builder · for Fix the rail", "cut off: Filament restarted before it finished", "error", "c1"],
    ], "your stop needs nothing of you, and one that started by itself is left to its next start");
    assert.deepEqual(groups({ threads, seen: (r) => r.id === "o1" }).needs.map((r) => r.thread), ["c1"], "seen, it goes");
    assert.deepEqual([g.works, g.done], [[], []]);
  });
});

// The owner's words of 10-27: "when i fire a side agent myself, that should also show as a child of the session on the
// left bar … if i fire a full team myself vs main agent fires a full team" — as the Designer answered them.
describe("Now: your own agents and the teams on the side, under the chat they work for", () => {
  /** An agent at work, started `ago` ms before now. @param {string} id @param {string} origin @param {number} ago @param {Record<string, any>} [over] */
  const at = (id, origin, ago, over = {}) => agentRow(id, { origin, status: "running", startedAt: NOW - ago, exchanges: [{ description: `Job ${id}`, startedAt: NOW - ago, endedAt: null }], ...over });
  /** A team on the side's chat "t1", working for "a". @param {string} chain */
  const beside = (chain) => (chain === "t1" ? { main: "a", name: "Bug Hunter" } : null);

  // (fails before: yes — yours was a row of its own, "Builder · for Fix the rail")
  test("yours at work is a line under its chat, marked, among the main agent's in the order they started; the row counts it", () => {
    const threads = new Map([["a", [at("m2", "agent", 10_000), at("y1", "owner", 30_000), at("m1", "agent", 50_000), at("c1", "command", 20_000)]]]);
    const g = groups({ runs: [turn("r1", "a")], threads });
    assert.equal(g.works.length, 1, "no row of its own");
    assert.match(g.works[0].fact, / · 4 agents$/);
    assert.deepEqual(g.works[0].under.map((u) => [u.thread, u.name, !!u.yours]), [["m1", "Builder · Job m1", false], ["y1", "Builder · Job y1", true], ["c1", "Builder · Job c1", true], ["m2", "Builder · Job m2", false]]);
    // Its chat's turn over, the row stays under Working while it works on: "at work", never "still".
    const idle = groups({ runs: [turn("r1", "a", { status: "done", endedAt: NOW - 5_000 })], threads: new Map([["a", [at("y1", "owner", 30_000)]]]), unread: new Set(["a"]) });
    assert.deepEqual([idle.works.map((r) => [r.fact, r.under.map((u) => u.thread)]), idle.done], [[["finished · 1 agent at work", ["y1"]]], []]);
  });

  // (fails before: no — a guard: asking you, it stood in Needs you already; now it also leaves the lines and the count)
  test("one of yours that asks you leaves the lines for its own row under Needs you, and comes back once answered", () => {
    const asking = at("y1", "owner", 30_000, { progress: { asking: { kind: "question", question: "Keep the old route?", at: NOW - 2_000 } } });
    const g = groups({ runs: [turn("r1", "a")], threads: new Map([["a", [asking, at("m1", "agent", 50_000)]]]) });
    assert.deepEqual(g.needs.map((r) => [r.title, r.thread]), [["Builder · for Fix the rail", "y1"]]);
    assert.deepEqual([g.works[0].fact.endsWith(" · 1 agent"), g.works[0].under.map((u) => u.thread)], [true, ["m1"]]);
  });

  // (fails before: yes — the lines were only drawn under a row with none: under a lead, yours vanished)
  test("under a team in charge, yours comes after its workers, and the lead's line counts it", () => {
    const worker = agentRow("w1", { origin: "agent", status: "running", team: { name: "Architect", role: "Engineer" }, task: "t2", exchanges: [{ description: "map the routes", startedAt: NOW - 10_000 }] });
    const g = groups({ runs: [turn("r1", "a")], threads: new Map([["a", [worker, at("y1", "owner", 30_000)]]]) });
    assert.equal(g.works[0].fact, "Architect leads · working · 1 worker, 1 agent");
    assert.deepEqual(g.works[0].under.map((u) => [u.thread, !!u.yours]), [["w1", false], ["y1", true]]);
  });

  // (fails before: yes — a team on the side was a row of its own, "Bug Hunter · lead" while its workers ran)
  test("a team on the side at work, whoever started it, is a line under its chat that opens the team's own chat; asking you, a row of its own", () => {
    const team = turn("rt", "t1", { startedAt: NOW - 40_000 });
    const worker = agentRow("w1", { origin: "agent", status: "running", team: { name: "Bug Hunter", role: "Hunter" }, exchanges: [{ description: "hunt", startedAt: NOW - 30_000 }] });
    const threads = new Map([["t1", [worker]], ["a", [at("y1", "owner", 20_000)]]]);
    const g = groups({ runs: [team, turn("r1", "a")], threads, beside });
    assert.deepEqual(g.works.map((r) => r.chain), ["a"], "the team's turn is no row of its own");
    assert.match(g.works[0].fact, / · 1 agent, 1 team$/);
    assert.deepEqual(g.works[0].under.map((u) => [u.key, u.thread, u.chain ?? null, u.name]), [["chat:t1", null, "t1", "Bug Hunter team"], ["thread:y1", "y1", null, "Builder · Job y1"]]);
    // The chat it works for idle: under Working for it.
    const idle = groups({ runs: [team, turn("r1", "a", { status: "done", endedAt: NOW - 5_000 })], threads: new Map([["t1", [worker]]]), beside });
    assert.deepEqual(idle.works.map((r) => [r.chain, r.fact, r.under.map((u) => u.name)]), [["a", "1 team at work", ["Bug Hunter team"]]]);
    // Its lead asks you: a row of its own, and no line.
    const asks = groups({ runs: [turn("rt", "t1", { status: "paused" }), turn("r1", "a")], threads: new Map(), beside });
    assert.deepEqual([asks.needs.map((r) => r.chain), asks.works[0].under], [["t1"], []]);
    // Where nothing says which chats are teams on the side (the tray's card), a row of its own.
    assert.deepEqual(groups({ runs: [team], threads: new Map([["t1", [worker]]]) }).works.map((r) => [r.chain, r.title]), [["t1", "Bug Hunter · lead"]]);
  });

  test("a team's name as a line says it, never twice; the line marks yours between the name and the age, and a team's opens its chat", () => {
    assert.deepEqual([teamLine("Bug Hunter"), teamLine("Bug Squad team"), teamLine("  ")], ["Bug Hunter team", "Bug Squad team", "A team"]);
    const list = src("now-list.js");
    assert.match(list, /mk\("span", \{ class: "now-under-name" \}, u\.name\),\n\s*\/\/[^\n]*\n\s*u\.yours \? mk\("span", \{ class: "now-under-tag" \}, "yours"\) : null,\n\s*mk\("span", \{ class: "now-age" \}/);
    assert.match(list, /o\.onOpen\(\{ \.\.\.r, key: u\.key, chain: u\.chain \|\| r\.chain, thread: u\.thread, title: u\.name, under: \[\] \}\)/);
    assert.match(list, /u\.yours \? " — you started it" : ""/);
    const bar = src("sidebar.js");
    assert.match(bar, /beside: \(chain\) => besideOf\(chain\),/);
    assert.match(bar, /title: `\$\{teamLine\(beside\.name\)\} · for \$\{main\?\.title \|\| "a chat"\}`/, "a team's own row names the chat it works for as a thread's does");
  });
});

// The owner's words of 10-27: "two same things showing at the same time is not a good design … even the selection is
// shown twice" — as the Designer answered them: a chat stands in Now or under its project, never both, and moves
// between the two as a flight, never under the pointer.
describe("Now: one chat, one place in the left bar", () => {
  /** @param {Map<string, number>} placed @param {string[]} wanted @param {Partial<Parameters<typeof placeChats>[2]>} [o] */
  const place = (placed, wanted, o = {}) => placeChats(placed, new Set(wanted), { now: NOW, current: null, open: true, held: false, ...o });
  const chains = (/** @type {Map<string, number>} */ m) => [...m.keys()];

  // (fails before: yes — every chat at work stood in Now and under its project, selected in both)
  test("a chat Now has a row for stands there; one whose row went stays its quiet minute, the chat open until it is left", () => {
    const one = place(new Map(), ["a", "b"]);
    assert.deepEqual([...one], [["a", 0], ["b", 0]]);
    const quiet = place(one, ["b"]);
    assert.deepEqual([...quiet], [["a", NOW], ["b", 0]], "a's turn over and seen: its minute starts");
    assert.deepEqual(chains(place(quiet, ["b"], { now: NOW + QUIET_MS - 1 })), ["a", "b"], "a reply within the minute never moves it");
    assert.deepEqual(chains(place(quiet, ["b"], { now: NOW + QUIET_MS })), ["b"], "its minute out, it goes home");
    assert.deepEqual(chains(place(quiet, ["b"], { now: NOW + 10 * QUIET_MS, current: "a" })), ["a", "b"], "the chat open stays until it is left");
    assert.deepEqual([...place(quiet, ["a", "b"], { now: NOW + 5_000 })], [["a", 0], ["b", 0]], "at work again, its minute is gone");
  });

  test("while the pointer holds the bar none comes or goes, though a minute starts; folded, Now holds none; Clear sends home at once", () => {
    const placed = new Map([["a", 0], ["b", NOW - 2 * QUIET_MS]]);
    assert.deepEqual([...place(placed, ["c"], { held: true })], [["a", NOW], ["b", NOW - 2 * QUIET_MS]], "c waits, a starts its minute, b's ran out and waits");
    assert.deepEqual(chains(place(placed, ["c"])), ["a", "c"], "the hold over: b goes home, c comes");
    assert.deepEqual([...place(placed, ["a", "c"], { open: false })], [], "folded: every chat home");
    assert.deepEqual(chains(place(new Map([["a", -Infinity], ["b", -Infinity]]), [], { current: "b" })), ["b"], "Clear: home at once, but the chat open");
  });

  test("a chat that stays with nothing at work is under Done, seen, in its last turn's word; its key moves with seen", () => {
    const facts = (/** @type {string} */ c) => CHATS[c] || null;
    const runs = [turn("r1", "a", { status: "stopped", endedAt: NOW - 4_000 }), turn("r0", "a", { status: "done", endedAt: NOW - 90_000 })];
    const row = stayRow("a", NOW - 1_000, { runs, chats: facts });
    assert.deepEqual([row.key, row.group, row.title, row.project, row.fact, row.tile, row.at, row.stay], ["chat:a", "done", "Fix the rail", "filament", "stopped", "done", NOW - 1_000, true]);
    assert.equal(stayRow("c", -Infinity, { runs: [turn("r2", "c", { status: "done", endedAt: NOW - 7_000 })], chats: facts }).at, NOW - 7_000, "sent home at once: aged by its end");
    const unread = groups({ runs: [turn("r3", "b", { status: "done", endedAt: NOW - 2_000 })], unread: new Set(["b"]) });
    assert.notEqual(nowKey(unread), nowKey({ ...unread, done: [{ ...unread.done[0], stay: true }] }), "drawn again when it is seen");
  });

  // (fails before: yes — every chat stood under its project, a pinned one twice; and the owner's of 11-01: Now in a slot
  // of its own over the list, at most 45% of the bar, a chat with a dozen agents at work filled it, and the projects
  // under it had a strip of their own to scroll in, a finger's height)
  test("the bar: one scroll region, Now over the projects in it, a chat drawn once, a pinned one under Pinned alone, each move a flight that waits for the pointer (pinned in the source)", () => {
    const bar = src("sidebar.js");
    assert.match(bar, /const scrollRegion = h\("div", \{ class: "sess-scroll" \}, nowTop, list, nowBottom\);/, "Now rides in the one scroll region, over the projects or under them");
    // The desktop app's update notice, then the usage-stats notice, stand between the scroll region and the Library
    // (test/update-notice.test.js, test/telemetry.test.js).
    assert.match(bar, /yourRow\),\n\s+scrollRegion,\n(?:\s+\/\/[^\n]*\n)?\s+updateNotice\(\)\.el,\n(?:\s+\/\/[^\n]*\n)?\s+telemetryNotice\(\{[^\n]*\}\)\.el,\n\s+library,\n\s+fly,\n\s+\);/, "no slot of Now's beside it");
    assert.match(src("../harness.css"), /\.now-slot \{ flex: none; \}/);
    assert.doesNotMatch(src("../harness.css"), /\.now-slot \{[^}]*(max-height|overflow)/, "no scroll of its own");
    assert.match(src("../harness.css"), /\.now-slot\.is-foot \{ padding: 4px 0 12px;/, "under the projects, the room the list leaves at the region's foot, under its fade");
    assert.match(src("bar-flight.js"), /const LISTS = "\.sess-scroll";/, "a flight meets the one list's edge");
    assert.match(bar, /place: true,\n\s+held: \(\) => hold\.held\(\),/);
    assert.match(bar, /const pinned = sessions\.filter\(\(s\) => s\.pinned && home\(s\)\);/);
    assert.match(bar, /const rest = sessions\.filter\(\(s\) => !s\.pinned && home\(s\)\)\.sort\(byTime\);/);
    assert.match(bar, /const before = moving\(\) && layout === laidOut \? notePlaces\(host\) : new Map\(\);/, "still while the page first places what already works");
    assert.match(bar, /playMoves\(host, fly, before, \{ homeOf \}\);/);
    assert.match(bar, /"data-flip": `chat:\$\{s\.id\}`,/, "a chat's row keyed the same in either place");
    // A Space's button running (10-29) is no chat's: keyed as a thread is.
    assert.match(src("now-list.js"), /const flip = r\.thread \|\| r\.space \? `now:\$\{r\.key\}` : `chat:\$\{r\.chain\}`;\n[\s\S]{0,400}"data-key": flip,\n\s+"data-flip": flip,/);
    assert.match(src("bar-flight.js"), /if \(!before\.size \|\| mo === "off" \|\| typeof root\.animate !== "function"\) return;/, "Motion Off draws still");
  });

  let bars = 0;
  /**
   * The bar as the sidebar lays it out — Now's slot over the list in its one scroll region, chat c1 in Now, c2 under its
   * project, a chat's row keyed the same in either place — drawn anew as c1 goes home (its Done cleared), with the page's
   * frames and the flight's landing in the test's hands.
   * @param {(t: { projectBody: any, hidden: () => boolean, frame: () => void, land: () => Promise<void> }) => Promise<void>} fn
   */
  async function goingHome(fn) {
    // A copy of the flights' own: what lands is kept out of sight by a rule on the one flight layer a page has, the first
    // it was given — each test's bar is a page of its own.
    const { notePlaces, playMoves } = await import(`../src/ui/harness/bar-flight.js?bar=${++bars}`);
    const doc = stubDocument();
    const g = /** @type {any} */ (globalThis);
    const had = { CSS: g.CSS, requestAnimationFrame: g.requestAnimationFrame };
    g.CSS = { escape: (/** @type {string} */ s) => s };
    // The page's frames, drawn when the test says so: a page that draws none (the agent's browser, parked) never runs them.
    /** @type {Function[]} */
    const frames = [];
    g.requestAnimationFrame = (/** @type {Function} */ fn) => frames.push(fn);
    // Every part laid out in one box, so a move flies; every flight in the air until the test sets it down.
    const proto = Object.getPrototypeOf(document.createElement("div"));
    const rect = proto.getBoundingClientRect;
    /** @type {(v?: unknown) => void} */
    let land = () => {};
    const landed = new Promise((r) => { land = r; });
    proto.getBoundingClientRect = () => ({ top: 0, left: 0, right: 240, bottom: 28, width: 240, height: 28 });
    proto.animate = () => ({ finished: landed });
    try {
      const row = (/** @type {string} */ cls, /** @type {string} */ chain) => h("div", { class: cls, "data-flip": `chat:${chain}`, "data-chain": chain }, chain);
      const nowBody = h("div", { class: "now-body" }, row("now-row", "c1"));
      const projectBody = h("div", { class: "sess-group-body" }, row("sess-row", "c2"));
      const fly = h("div", { class: "lb-fly" });
      const host = h("aside", { class: "side-frame" },
        h("div", { class: "sess-scroll" },
          h("div", { class: "now-slot" }, h("section", { class: "now" }, nowBody)),
          h("div", { class: "sess-list" }, h("details", { class: "sess-group", open: "" }, h("summary", { "data-flip": "project:p1" }), projectBody))),
        fly);
      /** Every element under one, in order. @param {any} el @returns {any[]} */
      const all = (el) => [el, ...[...(el.children || [])].flatMap(all)];
      // The bar's draw: its places noted, Now drawn without c1, its project with it.
      const before = notePlaces(host);
      nowBody.replaceChildren();
      projectBody.replaceChildren(row("sess-row", "c1"), row("sess-row", "c2"));
      playMoves(host, fly, before);
      await fn({
        projectBody: { chains: () => all(projectBody).filter((x) => x.getAttribute("data-chain")).map((x) => x.getAttribute("data-chain")) },
        // Whether a flight keeps the chat's row out of sight: the flight layer's rule naming it.
        hidden: () => all(host).some((x) => x.tagName === "STYLE" && String(x.textContent).includes('[data-flip="chat:c1"]') && String(x.textContent).includes("visibility: hidden")),
        frame: () => { for (const f of frames.splice(0)) f(0); },
        land: async () => {
          land();
          await new Promise((r) => setTimeout(r, 0));
        },
      });
    } finally {
      proto.getBoundingClientRect = rect;
      delete proto.animate;
      for (const [k, v] of Object.entries(had)) {
        if (v === undefined) delete g[k];
        else g[k] = v;
      }
      doc.restore();
    }
  }

  // (fails before: yes — the live look of 10-27: the row a flight carries was hidden as the flight was set going, and
  // only its landing showed it again; the agent's browser, parked where no one looks, draws no frames and so never set
  // a flight down: the chat that left Now stood nowhere in sight, gone from Now and hidden under its project)
  test("a chat drawn out of Now stands in sight under its project in the same draw; only a frame of its flight hides it, until it lands", () => goingHome(async (t) => {
    assert.deepEqual(t.projectBody.chains(), ["c1", "c2"], "it stands under its project");
    assert.equal(t.hidden(), false, "in sight in the same draw: no frame was drawn, so no flight hides it");
    t.frame();
    assert.equal(t.hidden(), true, "a frame drawn, its row waits out of sight while its copy flies in, as the Designer drew it");
    await t.land();
    assert.equal(t.hidden(), false, "set down, it shows");
  }));

  // (fails before: yes — the owner's of 10-30: a blank space at the top of a project, counted in its count. A chat went
  // home after its quiet minute while Filament's window was hidden; drawn again, a page finishes the flight first and
  // runs the frame it asked for after — a hidden window's own order, seen live — and that frame hid the row for a landing
  // already over, for good)
  test("a flight set down before its first frame — the window hidden as the chat went home — leaves its row in sight", () => goingHome(async (t) => {
    await t.land();
    t.frame();
    assert.equal(t.hidden(), false, "set down already: nothing hides it");
  }));

  // (fails before: yes — the owner's of 11-01, Now in the bar's one scroll region: a flight measured a Now row against
  // Now's own slot, which scrolls no more, so a chat going home from a row scrolled out of view above flew from where that
  // row stood, over the bar's head, and not in from the list's edge)
  test("one scroll region: a chat going home from a Now row scrolled out of view comes in from the list's top edge", async () => {
    const { notePlaces, playMoves } = await import(`../src/ui/harness/bar-flight.js?bar=${++bars}`);
    const doc = stubDocument();
    const g = /** @type {any} */ (globalThis);
    const had = { CSS: g.CSS, requestAnimationFrame: g.requestAnimationFrame };
    g.CSS = { escape: (/** @type {string} */ s) => s };
    g.requestAnimationFrame = () => 0;
    const proto = Object.getPrototypeOf(document.createElement("div"));
    const rect = proto.getBoundingClientRect;
    /** @type {{ el: any, frames: any[] }[]} */
    const flown = [];
    proto.animate = function (/** @type {any[]} */ frames) {
      flown.push({ el: this, frames });
      return { finished: new Promise(() => {}) };
    };
    const box = (/** @type {number} */ top, /** @type {number} */ height) => ({ top, left: 0, right: 240, bottom: top + height, width: 240, height });
    try {
      const away = h("div", { class: "now-row", "data-flip": "chat:c1" }, "c1");
      const nowBody = h("div", { class: "now-body" }, away);
      const slot = h("div", { class: "now-slot" }, h("section", { class: "now" }, nowBody));
      const projectBody = h("div", { class: "sess-group-body" });
      const scroll = h("div", { class: "sess-scroll" }, slot, h("div", { class: "sess-list" }, h("details", { class: "sess-group", open: "" }, h("summary"), projectBody)));
      const fly = h("div", { class: "lb-fly" });
      const host = h("aside", { class: "side-frame" }, scroll, fly);
      const home = h("div", { class: "sess-row", "data-flip": "chat:c1" }, "c1");
      // Scrolled down to the projects: the region shows 100 to 400 of the bar, Now's slot runs on above it, its row at 40.
      const boxes = new Map([[scroll, box(100, 300)], [slot, box(-260, 330)], [fly, box(0, 800)], [away, box(40, 28)], [home, box(300, 28)]]);
      proto.getBoundingClientRect = function () { return boxes.get(this) || box(0, 0); };
      const before = notePlaces(host);
      nowBody.replaceChildren();
      projectBody.replaceChildren(home);
      playMoves(host, fly, before);
      const flights = flown.filter((f) => String(f.el.className) === "lb-ghost" && "transform" in (f.frames[0] || {})).map((f) => f.frames.map((k) => k.transform));
      assert.deepEqual(flights, [["translate(0px, -210px)", "none"]], "one copy, in from the list's top edge (100, from 10 above it) to its row at 300 — none lifted from a row out of sight");
    } finally {
      proto.getBoundingClientRect = rect;
      delete proto.animate;
      for (const [k, v] of Object.entries(had)) {
        if (v === undefined) delete g[k];
        else g[k] = v;
      }
      doc.restore();
    }
  });
});

describe("the left bar under the person's hand, and what its rows say (the Hunter's finds of 10-27)", () => {
  // (fails before: yes — only a press on the list held a redraw, and a pointer that went into a chat's menu, which the
  // page draws outside the bar, had left it: the moves played, and the row flew from under the menu)
  test("a press on Now holds its rows as one on the list does; a menu the bar opened is the bar's until the pointer leaves it too", () => {
    const doc = stubDocument();
    /** @type {Record<string, Function[]>} */
    const pageHears = {};
    const page = /** @type {any} */ (doc.document);
    page.addEventListener = (/** @type {string} */ type, /** @type {Function} */ fn) => { (pageHears[type] ||= []).push(fn); };
    try {
      const list = h("div", { class: "sess-list" });
      const nowTop = h("div", { class: "now-slot" });
      const nowBottom = h("div", { class: "now-slot is-foot" });
      const host = /** @type {any} */ (h("aside", { class: "side-frame" }, nowTop, list, nowBottom));
      let left = 0;
      let released = 0;
      const hold = barHold(host, [list, nowTop, nowBottom], { rest: 10_000, press: 3_000, onLeave: () => { left++; }, onRelease: () => { released++; } });
      const up = () => { for (const fn of pageHears.pointerup || []) fn({ type: "pointerup" }); };

      /** @type {any} */ (nowTop).dispatch("pointerdown");
      assert.equal(hold.pressing(), true, "a press on Now's rows holds their redraw");
      up();
      assert.deepEqual([hold.pressing(), released], [false, 1], "the release lets it go, once");
      /** @type {any} */ (list).dispatch("pointerdown");
      assert.equal(hold.pressing(), true, "as one on the list does");
      up();

      host.dispatch("pointerenter");
      assert.ok(hold.held() > Date.now(), "the pointer on the bar holds its moves");
      // A chat's menu, drawn on the page outside the bar, and its submenu.
      const item = h("div", { class: "zc-menu-item" }, "Rename");
      const menu = /** @type {any} */ (h("div", { class: "zc-menu", role: "menu" }, item));
      const sub = /** @type {any} */ (h("div", { class: "zc-menu", role: "menu" }));
      page.body.append(host, menu, sub);
      host.dispatch("pointerleave", { relatedTarget: item });
      assert.ok(hold.held() > Date.now() && left === 0, "into its menu: still on the bar");
      menu.dispatch("pointerleave", { relatedTarget: sub });
      menu.dispatch("pointerleave", { relatedTarget: list });
      assert.ok(hold.held() > Date.now() && left === 0, "from it into a submenu, or back onto the bar: still on it");
      sub.dispatch("pointerleave", { relatedTarget: page.body });
      assert.deepEqual([hold.held(), left], [0, 1], "out of them all: the moves play");
      host.dispatch("pointerenter");
      host.dispatch("pointerleave", { relatedTarget: null });
      assert.deepEqual([hold.held(), left], [0, 2], "out of the window, as ever");
    } finally {
      delete page.addEventListener;
      doc.restore();
    }
    const bar = src("sidebar.js");
    assert.match(bar, /const hold = barHold\(host, \[list, nowTop, nowBottom\], \{/);
    assert.match(bar, /function paintNow\(fn\) \{\n\s+if \(!drawing && hold\.pressing\(\)\) \{\n\s+nowHeld = fn;/, "Now's own draw waits for the release");
    assert.match(bar, /now\.refresh\(\);\n\s+if \(nowHeld\) paintNow\(nowHeld\);/, "and the bar's draw draws one it held");
  });

  // (fails before: yes — Now named a team on the side only where this page had opened it: one started in another window,
  // or before the page opened, was a chat row of its own, named by its first words)
  test("a team on the side's chat this page never opened is named from the list of team chats", () => {
    const rows = [{ id: "t1", title: "Bug hunt", beside: { main: "a", name: "Bug Hunter" } }, { id: "t2", title: "Review", beside: { main: "b" } }, { id: "c", title: "A chat" }];
    assert.deepEqual(besideNamed(rows, "t1"), { name: "Bug Hunter", main: "a" });
    assert.deepEqual(besideNamed(rows, "t2"), { name: "Review", main: "b" }, "no team's name: its chat's title");
    assert.equal(besideNamed(rows, "c"), null, "a chat with no chat it works for is none");
    assert.match(src("sidebar.js"), /cb\.besideChat\?\.\(chain\) \|\| besideNamed\(sideChats, chain\)/);
  });

  // (fails before: yes — the Designer's of 10-27: a project counted every chat of its, so one that said 7 opened to 4)
  test("a project counts the chats it opens to, its tooltip where the rest stand; a pinned chat opens none and marks none", () => {
    assert.equal(projectCountWords(7, 0, 0), "7 chats");
    assert.equal(projectCountWords(1, 0, 0), "1 chat");
    assert.equal(projectCountWords(4, 2, 1), "4 chats here · 2 in Now · 1 pinned");
    assert.equal(projectCountWords(0, 2, 0), "No chats here · 2 in Now");
    assert.equal(projectCountWords(1, 0, 3), "1 chat here · 3 pinned");
    const bar = src("sidebar.js");
    assert.match(bar, /const home = g\.rows\.filter\(\(s\) => !s\.pinned && !now\.stands\(String\(s\.id\)\)\);/);
    assert.match(bar, /h\("span", \{ class: "proj-count", "data-key": "count", title: counted \}, String\(home\.length\)\),/);
    // Each thread among them under the chat that started it (thread-ui.test.js): drawn still, and counted.
    assert.match(bar, /body\.replaceChildren\(\.\.\.keptSpaceRows\(g, own, \"\", !!own\), \.\.\.\(own \? \[\] : nestThreads\(home\)\.flatMap\(\(s\) => rowsOf\(s\)\)\)\);/, "the count and the rows read the same chats");
    assert.match(bar, /const mark = foldedMark\(home\);/);
    assert.match(bar, /if \(live && summary\) morph\(summary, summaryOf\(live\.open\)\);/, "a turn that begins or ends marks the same chats, on the head that stands");
    assert.doesNotMatch(bar, /groupEl\(g, g\.rows\.some\(\(\/\*\* @type \{any\} \*\/ s\) => s\.pinned\)/);
  });

  // (fails before: yes — the chat open on screen whose turn failed stood under Done with a check, "failed" beside it)
  test("a failed chat that stays under Done keeps its alert and its error's first line, in red", () => {
    const facts = (/** @type {string} */ c) => CHATS[c] || null;
    const runs = [turn("r1", "a", { status: "error", endedAt: NOW - 4_000, summary: { error: "the connection was reset\nat round 3" } })];
    const row = stayRow("a", NOW - 1_000, { runs, chats: facts });
    assert.deepEqual([row.group, row.fact, row.tone, row.icon, row.tile], ["done", "failed: the connection was reset at round 3", "error", "circleAlert", "done"]);
    assert.deepEqual([stayRow("a", NOW, { runs: [turn("r2", "a", { status: "error", endedAt: NOW })], chats: facts }).fact], ["failed"], "no error's words: the word alone");
    const ok = stayRow("a", NOW, { runs: [turn("r3", "a", { status: "done", endedAt: NOW })], chats: facts });
    assert.deepEqual([ok.fact, ok.tone, ok.icon], ["finished", "", "check"]);
    assert.match(src("lib/icons.js"), /circleAlert: svg\(/);
    assert.match(src("sidebar.js"), /st\.failed \? "failed" :/, "the project row's line says it the same");
  });

  // (fails before: yes — the review of 11-01: a team on the side's chat whose newest turn went on stood under Done,
  // "finished", where the row it is a line under was kept from coming)
  test("a chat that stays while its newest turn goes is at work, under Working — never finished", () => {
    const facts = (/** @type {string} */ c) => CHATS[c] || null;
    const row = stayRow("a", NOW - 1_000, { runs: [turn("r1", "a")], chats: facts });
    assert.deepEqual([row.group, row.fact, row.tone, row.icon, row.tile, row.stay, row.at], ["works", "working", "", "messageSquare", "model", true, NOW - 1_000]);
    // A team's workers at work on after its lead's turn: the view says so (`working`), its turn over or not.
    const kept = stayRow("a", NOW - 1_000, { runs: [turn("r2", "a", { status: "done", endedAt: NOW - 2_000 })], chats: facts, working: true });
    assert.deepEqual([kept.group, kept.fact, kept.icon, kept.tile], ["works", "working", "messageSquare", "model"]);
  });
});
