// @ts-check
// Outcome memory (HarnessV3-Memory M7-4, M7-D48..D54): how each model's finished work went — a harness turn or a
// sub-agent's exchange — kept as counts with its session. First the pure part: what a run did, read from
// its calls, and the table of how models did; then the archive's table, memory's writes and reads; then end to end.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DID, OUTCOME_DAYS, addSpent, callSpend, callsIn, callsOf, countCalls, didOf, endedOf, median, outcomeTable, pricedSum, runsTests } from "../src/services/memory/outcomes.js";
import { endedParts, spanWords, usdWords } from "../src/ui/lib/outcomes.js";
import { Archive, SCHEMA_VERSION } from "../src/services/memory/archive.js";
import { adminCall, world } from "./fixtures/memory-world.mjs";

const dir = mkdtempSync(join(tmpdir(), "filament-outcomes-"));
/** @type {Archive[]} */
const opened = [];
after(() => {
  for (const a of opened) a.close();
  rmSync(dir, { recursive: true, force: true });
});
const DAY = 86_400_000;
const counts = (/** @type {any} */ o = {}) => ({ tests: 0, edited: 0, ran: 0, delegated: 0, read: 0, other: 0, ...o });

const bash = (/** @type {string} */ command) => ({ name: "bash", input: { command } });

test("M7-D49: a command runs tests — by its program, a tool's test subcommand, what a runner runs, a build's test goal, node --test — and nothing else does", () => {
  const yes = [
    "npm test", "npm t", "pnpm test", "yarn test:unit", "bun test", "deno test", "go test ./...", "cargo test --all", "dotnet test",
    "pytest -q", "py.test", "jest --ci", "vitest run", "npx jest", "bunx vitest", "uvx pytest", "npx playwright test",
    "npm run test:e2e", "pnpm run e2e", "uv run pytest", "poetry run pytest -x", "python -m pytest", "python3 -m unittest", "py -m pytest",
    "make test", "make -j4 check", "./gradlew check", "mvn -q verify", "node --test", "node --test=reporter test/", "env CI=1 npm test",
    "C:\\tools\\npm.cmd test",
  ];
  const no = [
    "npm install", "npm run build", "cargo check", "cargo build", "git commit -m test", "git log --grep test", "node script.js",
    "cat pytest.ini", "pip install pytest", "make", "ls test", "echo test", "$env:CI = 1", "",
  ];
  for (const c of yes) assert.equal(runsTests(c), true, c);
  for (const c of no) assert.equal(runsTests(c), false, c);
});

test("M7-D49, M7-D56: what a run did is the most it reached — tests, then edits, then commands, then work handed on, then reads, else it answered — with how many calls of each", () => {
  const read = { name: "read", input: { path: "a.js" } };
  const edit = { name: "edit", input: { path: "a.js", edits: [] } };
  assert.deepEqual(countCalls([]), counts());
  assert.equal(didOf(countCalls([])), "answered");
  assert.equal(didOf(countCalls([{ name: "ask", input: {} }, { name: "plan", input: {} }, { name: "mcp__fs__stat", input: {} }])), "answered", "a question, a plan, an MCP tool: none of the four");
  assert.equal(didOf(countCalls([read, { name: "grep", input: {} }, { name: "glob", input: {} }, { name: "web_fetch", input: {} }, { name: "delegate_read", input: {} }])), "read", "the reader sub-agent reads");
  assert.deepEqual(
    countCalls([{ name: "agent", input: { run_in_background: false, } }, { name: "Task", input: {} }, { name: "ask", input: {} }, { name: "delegate_read", input: {} }]),
    counts({ delegated: 2, read: 1, other: 1 }),
    "a sub-agent, Claude Code's; the reader sub-agent reads; a question is none of them",
  );
  assert.equal(didOf(countCalls([read, { name: "agent", input: { run_in_background: false, } }])), "delegated", "work handed on outranks a read");
  assert.equal(didOf(countCalls([{ name: "agent", input: { run_in_background: false, } }, bash("ls")])), "ran", "a command outranks work handed on");
  assert.equal(didOf(countCalls([read, bash("ls")])), "ran");
  assert.equal(didOf(countCalls([read, bash("ls"), edit])), "edited");
  assert.equal(didOf(countCalls([edit, bash("cd app && npm test")])), "tests", "a compound command that tests");
  assert.deepEqual(
    countCalls([read, edit, { name: "write", input: {} }, { name: "Write", input: {} }, { name: "MultiEdit", input: {} }, { name: "apply_patch", input: {} }, bash("npm test"), bash("git status"), { name: "powershell", input: { command: "dotnet test" } }, { name: "bash_background", input: { command: "npm run dev" } }, { name: "bash_output", input: { id: "b1" } }, { name: "exec_command", input: { cmd: ["bash", "-lc", "pytest"] } }, { name: "agent", input: { run_in_background: false, } }]),
    counts({ tests: 3, edited: 5, ran: 2, delegated: 1, read: 1, other: 1 }),
    "every shell by its names, a shell's output read is no command, an argv's script is its command",
  );
  assert.equal(callsIn(counts({ tests: 3, edited: 5, ran: 2, delegated: 1, read: 1, other: 1 })), 13);
  assert.equal(callsIn(/** @type {any} */ ({ tests: 1, edited: 0, ran: 0, read: 2, other: 0 })), 3, "counts kept before work handed on was counted");
  assert.deepEqual(DID, ["tests", "edited", "ran", "delegated", "read", "answered"]);
});

test("M7-D48: the calls of a conversation's assistant turns; how a loop's end is an outcome's; a paused turn's halves as one", () => {
  const convo = [
    { role: "user", content: "go" },
    { role: "assistant", content: [{ type: "text", text: "looking" }, { type: "tool_use", id: "1", name: "read", input: { path: "x" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "x" }, { type: "tool_use", id: "fake", name: "bash", input: {} }] },
    { role: "assistant", content: "plain words" },
    { role: "assistant", content: [{ type: "tool_use", id: "2", name: "bash", input: { command: "npm test" } }] },
  ];
  assert.deepEqual(callsOf(convo), [{ name: "read", input: { path: "x" } }, { name: "bash", input: { command: "npm test" } }], "only an assistant's calls");
  assert.deepEqual(callsOf(/** @type {any} */ (null)), []);
  assert.deepEqual(["done", "failed", "stopped", "budget-stopped", "aborted", "paused"].map(endedOf), ["done", "failed", "stopped", "stopped", "stopped", null], "a pause is no end");
  assert.deepEqual([pricedSum([]), pricedSum([null, undefined]), pricedSum([0.5, null, 0.25])], [null, null, 0.75], "no price known: none");
  assert.deepEqual(callSpend({ tokens: { input: 10, output: 4, cacheRead: 100, cacheWrite: 20 }, cost: 0.5 }), { tokensIn: 130, tokensOut: 4, usd: 0.5 }, "a call's prompt as the provider counted it, its cached parts too");
  assert.deepEqual(callSpend({ tokens: { input: 10, output: 4 }, cost: 0 }), { tokensIn: 10, tokensOut: 4, usd: 0 }, "free is a price");
  assert.deepEqual(callSpend({ tokens: { input: 10 } }), { tokensIn: 10, tokensOut: 0, usd: null }, "no price known");
  assert.deepEqual(callSpend(null), { tokensIn: 0, tokensOut: 0, usd: null }, "no record");
  const a = { counts: counts({ tests: 1, ran: 2, delegated: 2, read: 3 }), tokensIn: 100, tokensOut: 10, usd: null, ms: 1000 };
  const b = { counts: counts({ edited: 4, delegated: 1, read: 1, other: 1 }), tokensIn: 50, tokensOut: 5, usd: 0.25, ms: 500 };
  assert.deepEqual(addSpent(a, b), { counts: counts({ tests: 1, edited: 4, ran: 2, delegated: 3, read: 4, other: 1 }), tokensIn: 150, tokensOut: 15, usd: 0.25, ms: 1500 });
  assert.deepEqual(addSpent(null, b), b, "a turn that never paused: its own");
  assert.equal(addSpent(a, { ...b, usd: null }).usd, null, "no price on either half: none");
  assert.deepEqual([addSpent({ ...a, usd: 0.5 }, b).usd, addSpent({ ...a, usd: 0.5 }, { ...b, usd: null }).usd], [0.75, 0.5], "both halves' prices; the priced half's alone");
});

test("M7-D52: how models did — by model and kind, the most runs first; held is done and never corrected; medians, tokens, cost over the priced runs; the same by what each run did", () => {
  const row = (/** @type {any} */ o) => ({ kind: "turn", model: "m1", did: "edited", ended: "done", corrected: null, rounds: 2, calls: 3, tokens_in: 100, tokens_out: 10, usd: 0.1, ms: 1000, ...o });
  const rows = [
    row({}),
    row({ did: "tests", rounds: 6, ms: 4000 }),
    row({ corrected: "user", rounds: 4, ms: 3000, usd: null }),
    row({ ended: "failed", did: "read", rounds: 1, ms: 200 }),
    row({ kind: "subagent", ended: "stopped", did: "answered" }),
    row({ model: "m2", did: "tests" }),
    row({ model: "m2", did: "tests", kind: "subagent" }),
    row({ model: "m2", did: "tests", kind: "subagent" }),
  ];
  const t = outcomeTable(rows);
  assert.deepEqual(t.map((g) => [g.model, g.kind, g.runs]), [["m1", "turn", 4], ["m2", "subagent", 2], ["m1", "subagent", 1], ["m2", "turn", 1]]);
  const m1 = t[0];
  assert.deepEqual([m1.done, m1.failed, m1.stopped, m1.corrected, m1.held], [3, 1, 0, 1, 2], "a corrected run stays done, and is not held");
  assert.deepEqual([m1.rounds, m1.ms], [3, 2000], "medians of an even count: the middle two's mean");
  assert.deepEqual([m1.tokensIn, m1.tokensOut, m1.priced, m1.usd, m1.usdPerRun], [400, 40, 3, 0.3, 0.1]);
  assert.deepEqual(m1.did.map((/** @type {any} */ d) => [d.did, d.runs, d.held, d.corrected, d.failed]), [["tests", 1, 1, 0, 0], ["edited", 2, 1, 1, 0], ["read", 1, 0, 0, 1]], "in DID's order, only what they did");
  assert.deepEqual([t[2].stopped, t[2].held], [1, 0]);
  const unpriced = outcomeTable([row({ usd: null }), row({ usd: null })])[0];
  assert.deepEqual([unpriced.priced, unpriced.usd, unpriced.usdPerRun], [0, null, null], "no price known: none, never $0");
  assert.deepEqual(outcomeTable([]), []);
  assert.deepEqual([median([]), median([5]), median([3, 1, 2]), median([4, 1, 3, 2])], [null, 5, 2, 2.5]);
});

test("M7-D53: the words both apps say — a bar's shares add up to its runs, a failed run the user corrected once, as failed; a time and a cost as a reader says them", () => {
  const g = { runs: 5, done: 2, held: 1, corrected: 2, failed: 2, stopped: 1 };
  assert.deepEqual(endedParts(g).map((p) => [p.key, p.n]), [["held", 1], ["corrected", 1], ["failed", 2], ["stopped", 1]]);
  assert.deepEqual(endedParts({ runs: 2, done: 2, held: 2, corrected: 0, failed: 0, stopped: 0 }).map((p) => p.key), ["held"], "no empty share");
  assert.deepEqual([null, 420.4, 2400, 90_000, 5_400_000].map(spanWords), ["–", "420 ms", "2.4 s", "1.5 min", "1.5 h"]);
  assert.deepEqual([null, 0, 0.0123, 0.004].map(usdWords), ["–", "$0", "$0.01", "$0.0040"]);
});

test("M7-D51: the outcomes table — a row is its session's: listed with its project as it stands, by kind and since; the user's correction marks the harness turn just before, once; it goes with its session and its project; pruned by age", () => {
  let clock = 1_757_900_000_000;
  const a = new Archive({ file: join(dir, "a.db"), now: () => (clock += 1000) });
  opened.push(a);
  assert.equal(a.schemaMetaGet("version"), SCHEMA_VERSION);
  const one = a.ensureProject("C:\\one").id;
  const two = a.ensureProject("C:\\two").id;
  const s = a.chainForKey("s1", { project: one });
  const other = a.chainForKey("s2", { project: one });
  const turns = [1, 2, 3, 4].map((i) => /** @type {any} */ (a).beginTurn(s.id, { requestId: `r${i}`, userMessage: { role: "user", content: `message number ${i}` } }).turnId);
  const base = { request: "r", agent: null, model: "m1", did: "edited", counts: counts({ edited: 1 }), ended: "done", rounds: 2, calls: 1, tokensIn: 10, tokensOut: 5, usd: null, ms: 100 };
  const o = /** @type {any} */ (a).outcomes;
  const first = o.add({ ...base, chain: s.id, turn: turns[0], kind: "turn" });
  const sub = o.add({ ...base, chain: s.id, turn: turns[1], kind: "subagent", agent: "Explore" });
  const second = o.add({ ...base, chain: s.id, turn: turns[1], kind: "turn" });
  const elsewhere = o.add({ ...base, chain: other.id, turn: null, kind: "turn" });
  assert.equal(o.correctTurn(s.id, turns[0]), 0, "the first turn has none before it");
  assert.equal(o.correctTurn(s.id, turns[3]), 0, "turn 4 answers turn 3, which has no outcome: an older one is never marked");
  assert.equal(o.correctTurn(s.id, turns[2]), 1, "turn 3 corrects turn 2's harness turn");
  assert.equal(o.correctTurn(s.id, turns[2]), 0, "once");
  const rows = o.list({ since: 0 });
  assert.deepEqual(rows.map((/** @type {any} */ r) => [r.id, r.kind, r.agent, r.corrected, r.project_id]), [[first, "turn", null, null, one], [sub, "subagent", "Explore", null, one], [second, "turn", null, "user", one], [elsewhere, "turn", null, null, one]], "a sub-agent's exchange is never marked");
  assert.equal(typeof rows[2].corrected_at, "number");
  assert.deepEqual([rows[0].counts, rows[0].did, rows[0].calls, rows[0].usd], [counts({ edited: 1 }), "edited", 1, null]);
  assert.deepEqual(o.list({ since: 0, kind: "subagent" }).map((/** @type {any} */ r) => r.id), [sub], "by kind");
  a.moveChain(s.id, two);
  assert.deepEqual(o.list({ since: 0, project: two }).map((/** @type {any} */ r) => r.id), [first, sub, second], "a moved session takes its rows");
  assert.deepEqual(o.list({ since: 0, project: one }).map((/** @type {any} */ r) => r.id), [elsewhere]);
  const cut = rows[2].at;
  assert.deepEqual(o.list({ since: cut }).map((/** @type {any} */ r) => r.id), [second, elsewhere], "since: at or after");
  // The list joins the sessions: a row a deleted session left behind would be unlisted, not gone. The table says.
  const kept = () => /** @type {any} */ (a).db.prepare("SELECT COUNT(*) AS n FROM outcomes").get().n;
  a.deleteChain(other.id);
  assert.deepEqual(o.list({ since: 0 }).map((/** @type {any} */ r) => r.id), [first, sub, second], "they go with their session");
  assert.equal(kept(), 3);
  assert.equal(o.prune(cut), 2, "those written before the cut");
  assert.deepEqual(o.list({ since: 0 }).map((/** @type {any} */ r) => r.id), [second]);
  a.deleteProject(two);
  assert.deepEqual(o.list({ since: 0 }), [], "and with their project");
  assert.equal(kept(), 0);
});

// (fails before: yes — the turn just before by number was taken: after a turn Filament answered itself, or one rewound,
// the user's correction marked nothing)
test("M7-D50: the user's correction marks the turn whose reply it answers — a turn Filament answered itself, or one rewound, is none", () => {
  let clock = 1_757_900_000_000;
  const a = new Archive({ file: join(dir, "l18.db"), now: () => (clock += 1000) });
  opened.push(a);
  const s = a.chainForKey("l18", { project: a.ensureProject("C:\\l18").id });
  const turns = [1, 2, 3, 4].map((i) => /** @type {any} */ (a).beginTurn(s.id, { requestId: `r${i}`, userMessage: { role: "user", content: `message number ${i}` } }).turnId);
  a.mergeTurnMeta(turns[1], { command: true });
  a.mergeTurnMeta(turns[2], { rewound: { line: 1 } });
  const o = /** @type {any} */ (a).outcomes;
  o.add({ request: "r", agent: null, model: "m1", did: "edited", counts: counts({ edited: 1 }), ended: "done", rounds: 2, calls: 1, tokensIn: 10, tokensOut: 5, usd: null, ms: 100, chain: s.id, turn: turns[0], kind: "turn" });
  assert.equal(a.turnBefore(s.id, turns[3])?.id, turns[0]);
  assert.equal(o.correctTurn(s.id, turns[3]), 1, "turn 4 answers turn 1's reply: Filament answered turn 2 itself, and turn 3 was rewound");
  assert.equal(a.turnBefore(s.id, turns[0]), null, "the first turn has none before it");
});

test("M7-D51: memory keeps an outcome — what it did read from its counts; nothing while memory is off or for a session it does not hold; a failure to keep one is logged, never thrown — and how models did is read by window, project and kind", () =>
  world({}, async (w) => {
    const s = await w.session("s-out").send("set the build up");
    const chain = s.prep.chain;
    const input = { chain, turn: s.prep.turn, request: "r1", kind: "turn", agent: null, model: "glm-5.3", counts: counts({ tests: 1, edited: 2, read: 3 }), ended: "done", rounds: 4, tokensIn: 1000, tokensOut: 200, usd: 0.0125, ms: 1234.6 };
    const id = w.svc.recordOutcome(input);
    assert.equal(typeof id, "number");
    const row = /** @type {any} */ (w.svc.archive).outcomes.list({ since: 0 })[0];
    assert.deepEqual([row.did, row.calls, row.ms, row.turn_id, row.request_id, row.corrected], ["tests", 6, 1235, s.prep.turn, "r1", null]);
    assert.equal(w.svc.recordOutcome({ ...input, chain: "no-such-chain" }), null, "a session it does not hold");
    w.cfg.memory.enabled = false;
    assert.equal(w.svc.recordOutcome(input), null, "memory off: nothing kept");
    w.cfg.memory.enabled = true;
    /** @type {string[]} */
    const logs = [];
    w.svc.log = (/** @type {string} */ level, /** @type {string} */ msg) => logs.push(`${level} ${msg}`);
    const add = /** @type {any} */ (w.svc.archive).outcomes.add;
    /** @type {any} */ (w.svc.archive).outcomes.add = () => {
      throw new Error("disk full");
    };
    assert.equal(w.svc.recordOutcome(input), null);
    assert.deepEqual(logs, ["warn memory: an outcome was not kept: disk full"]);
    /** @type {any} */ (w.svc.archive).outcomes.add = add;
    w.svc.recordOutcome({ ...input, kind: "subagent", agent: "Explore", ended: "failed", counts: counts({ read: 2 }), usd: null });
    const elsewhere = (await w.session("s-far", { cwd: "C:\\far" }).send("hello there, set it up")).prep;
    w.svc.recordOutcome({ ...input, chain: elsewhere.chain, turn: elsewhere.turn, model: "other-model" });
    const all = w.svc.outcomes();
    assert.deepEqual([all.runs, all.days, all.project, all.kind], [3, 30, null, null]);
    assert.deepEqual(all.groups.map((/** @type {any} */ g) => [g.model, g.kind, g.runs, g.held, g.failed]), [["glm-5.3", "turn", 1, 1, 0], ["glm-5.3", "subagent", 1, 0, 1], ["other-model", "turn", 1, 1, 0]]);
    assert.deepEqual(w.svc.outcomes({ project: s.prep.project }).groups.map((/** @type {any} */ g) => g.model), ["glm-5.3", "glm-5.3"], "one workspace");
    assert.deepEqual(w.svc.outcomes({ kind: "subagent" }).groups.map((/** @type {any} */ g) => g.kind), ["subagent"]);
    const now = w.svc.archive.now();
    w.svc.archive.now = () => now + 8 * DAY;
    assert.equal(w.svc.outcomes({ days: 7 }).runs, 0, "the window: the last `days`");
    assert.equal(w.svc.outcomes({ days: 9 }).runs, 3);
    // Kept OUTCOME_DAYS: older rows go when memory opens, by the clock that stamps them.
    w.svc.archive.db.prepare("UPDATE outcomes SET at = ? WHERE id = ?").run(now - (OUTCOME_DAYS + 1) * DAY, id);
    w.svc.stop();
    w.svc.start();
    assert.deepEqual(/** @type {any} */ (w.svc.archive).outcomes.list({ since: 0 }).map((/** @type {any} */ r) => r.id).includes(id), false, "pruned as memory opened");
    assert.equal(/** @type {any} */ (w.svc.archive).outcomes.list({ since: 0 }).length, 2, "the rest stay");
  }));

// (fails before: yes — nothing marked a worker's outcome: the lead had no way to say its work fell short)
test("M7-D50, AH-O5: a team's lead's correction marks its worker's exchange by its request, once — never a sub-agent's or a turn's, another session's, nor while memory is off; a failure to keep it is logged, never thrown", () =>
  world({}, async (w) => {
    const s = await w.session("s-lead").send("lead the build");
    const chain = s.prep.chain;
    const base = { chain, turn: s.prep.turn, agent: "builder", model: "m-cheap", counts: counts({ edited: 1 }), ended: "done", rounds: 2, tokensIn: 10, tokensOut: 5, usd: null, ms: 100 };
    w.svc.recordOutcome({ ...base, request: "run-w", kind: "worker" });
    w.svc.recordOutcome({ ...base, request: "run-s", kind: "subagent", agent: "general-purpose" });
    w.svc.recordOutcome({ ...base, request: "run-t", kind: "turn", agent: null });
    const marked = () => /** @type {any} */ (w.svc.archive).outcomes.list({ since: 0 }).map((/** @type {any} */ r) => [r.request_id, r.corrected]);
    w.cfg.memory.enabled = false;
    assert.equal(w.svc.correctWorker({ chainId: chain, request: "run-w" }), 0, "memory off: nothing marked");
    w.cfg.memory.enabled = true;
    assert.equal(w.svc.correctWorker({ chainId: "no-such-chain", request: "run-w" }), 0, "another session's");
    assert.equal(w.svc.correctWorker({ chainId: chain, request: "run-s" }), 0, "a sub-agent's exchange is no worker's");
    assert.equal(w.svc.correctWorker({ chainId: chain, request: "run-t" }), 0, "nor is a turn");
    assert.equal(w.svc.correctWorker({ chainId: chain, request: "run-w" }), 1);
    assert.equal(w.svc.correctWorker({ chainId: chain, request: "run-w" }), 0, "once");
    assert.deepEqual(marked(), [["run-w", "lead"], ["run-s", null], ["run-t", null]]);
    assert.deepEqual(w.svc.outcomes({ kind: "worker" }).groups.map((/** @type {any} */ g) => [g.kind, g.runs, g.corrected, g.held]), [["worker", 1, 1, 0]], "how models did counts it corrected, and not held");
    /** @type {string[]} */
    const logs = [];
    w.svc.log = (/** @type {string} */ level, /** @type {string} */ msg) => logs.push(`${level} ${msg}`);
    const correct = /** @type {any} */ (w.svc.archive).outcomes.correctWorker;
    /** @type {any} */ (w.svc.archive).outcomes.correctWorker = () => {
      throw new Error("disk full");
    };
    assert.equal(w.svc.correctWorker({ chainId: chain, request: "run-w" }), 0);
    assert.deepEqual(logs, ["warn memory: a lead's correction was not kept: disk full"]);
    /** @type {any} */ (w.svc.archive).outcomes.correctWorker = correct;
  }));

// (fails before: yes — a message opening "no, …" or "wrong, …" marked the turn before as it arrived)
test("M7-D50, the memory plan's d4: no message marks the reply before by its words — an opener in any language marks nothing as it arrives; the learner or the agent's quoted correct judges it", () =>
  world({}, async (w) => {
    const s = w.session("s-fix");
    /** Sends `text`; the turn it opens gets a harness turn's outcome. @param {string} text */
    const turn = async (text) => {
      const { prep } = await s.send(text);
      w.svc.recordOutcome({ chain: prep.chain, turn: prep.turn, request: null, kind: "turn", agent: null, model: "glm-5.3", counts: counts({ edited: 1 }), ended: "done", rounds: 1, tokensIn: 10, tokensOut: 5, usd: null, ms: 10 });
      return prep;
    };
    const marked = () => /** @type {any} */ (w.svc.archive).outcomes.list({ since: 0 }).map((/** @type {any} */ r) => r.corrected);
    await turn("set the build up for the app");
    await turn("no, use vite for the build instead of webpack");
    await turn("wrong, the cache must be keyed by the lockfile");
    await turn("nein, der Cache muss am Lockfile hängen");
    assert.deepEqual(marked(), [null, null, null, null]);
  }));

// (fails before: yes — the agent's quoted correct marked no outcome)
test("M7-D50, the memory plan's d4: the agent's correct quoting the person's words of this very turn, of a memory the session was shown before it, marks the reply they answered, once; a quote of an older turn's words, none, or a memory the session never saw marks nothing", () =>
  world({}, async (w) => {
    const s = w.session("s-quoted");
    /** Sends `text`; the turn it opens gets a harness turn's outcome. @param {string} text */
    const turn = async (text) => {
      const { prep } = await s.send(text);
      w.svc.recordOutcome({ chain: prep.chain, turn: prep.turn, request: null, kind: "turn", agent: null, model: "glm-5.3", counts: counts({ edited: 1 }), ended: "done", rounds: 1, tokensIn: 10, tokensOut: 5, usd: null, ms: 10 });
      return prep;
    };
    const marked = () => /** @type {any} */ (w.svc.archive).outcomes.list({ since: 0 }).map((/** @type {any} */ r) => r.corrected);
    const { prep: before } = await w.session("s-earlier").send("hello");
    const port = (await w.svc.brain.fileLearned({ projectId: before.project, chainId: before.chain, kind: "fact", text: "The api listens on port 3000.", importance: 0.7 })).id;
    // The session is shown it, and its reply may rest on it.
    const first = await turn("start the api for the integration tests on its port");
    assert.ok(w.svc.archive.injections.shownIn(first.chain, 0).includes(`i${port}`), "shown on the first turn");
    // Words no opener list would read as a correction.
    const said = await turn("the api moved to port 8080 last week, use that");
    const corrected = await w.svc.brain.correct(`i${port}`, { text: "The api listens on port 8080.", by: "model", quote: "the api moved to port 8080 last week", chainId: said.chain, turnId: said.turn });
    assert.equal(corrected.heard, true, JSON.stringify(corrected));
    assert.deepEqual(marked(), ["user", null], "the reply the person answered");
    const later = await turn("and the docs site?");
    const docs = (await w.svc.brain.fileLearned({ projectId: first.project, chainId: first.chain, turnId: first.turn, kind: "fact", text: "The api's port moved to 9090 last month.", importance: 0.7 })).id;
    const older = await w.svc.brain.correct(`i${docs}`, { text: "The api moved to port 8080 last week.", by: "model", quote: "the api moved to port 8080 last week", chainId: later.chain, turnId: later.turn });
    assert.equal(older.heard, true);
    const bare = await turn("ok, run them");
    const docs2 = (await w.svc.brain.fileLearned({ projectId: first.project, chainId: first.chain, turnId: first.turn, kind: "fact", text: "The integration tests run with npm run itest.", importance: 0.7 })).id;
    await w.svc.brain.correct(`i${docs2}`, { text: "The integration tests run with npm run test:int.", by: "model", chainId: bare.chain, turnId: bare.turn });
    assert.deepEqual(marked(), ["user", null, null, null], "words of an older turn, or no quote, mark nothing");
    // A memory the session was never shown: the person's words are news to it, and mark nothing.
    // (Filed after the turn before it: shown, if at all, only on the turn that corrects it.)
    const staging = (await w.svc.brain.fileLearned({ projectId: first.project, chainId: before.chain, kind: "fact", text: "The staging database listens on port 5432.", importance: 0.7 })).id;
    const news = await turn("the staging database moved to port 5544 today");
    const fresh = await w.svc.brain.correct(`i${staging}`, { text: "The staging database listens on port 5544.", by: "model", quote: "the staging database moved to port 5544 today", chainId: news.chain, turnId: news.turn });
    assert.equal(fresh.heard, true, JSON.stringify(fresh));
    assert.deepEqual(marked(), ["user", null, null, null, null]);
  }));

test("M7-D52: GET /api/memory/outcomes — the last whole days up to the year kept, one kind or all, one workspace or everywhere; what it refuses", async () => {
  await world({}, async (w) => {
    const s = (await w.session("s-route").send("set the build up")).prep;
    w.svc.recordOutcome({ chain: s.chain, turn: s.turn, request: "r1", kind: "turn", agent: null, model: "glm-5.3", counts: counts({ edited: 1 }), ended: "done", rounds: 2, tokensIn: 10, tokensOut: 5, usd: 0.5, ms: 100 });
    const all = await adminCall(w.svc, "GET", "/memory/outcomes");
    assert.equal(all.status, 200);
    assert.deepEqual([all.body.days, all.body.project, all.body.kind, all.body.runs, all.body.groups[0].model, all.body.groups[0].usd], [30, null, null, 1, "glm-5.3", 0.5]);
    const one = await adminCall(w.svc, "GET", `/memory/outcomes?project=${encodeURIComponent(s.project)}&days=365&kind=turn`);
    assert.deepEqual([one.status, one.body.days, one.body.project, one.body.kind, one.body.runs], [200, 365, s.project, "turn", 1]);
    assert.deepEqual([(await adminCall(w.svc, "GET", "/memory/outcomes?days=1")).body.runs, (await adminCall(w.svc, "GET", "/memory/outcomes?kind=subagent")).body.runs], [1, 0]);
    for (const bad of ["days=0", "days=366", "days=1.5", "days=x", "kind=agent"]) {
      const r = await adminCall(w.svc, "GET", `/memory/outcomes?${bad}`);
      assert.equal(r.status, 400, bad);
      assert.match(r.body.error, bad.startsWith("days") ? /^days is a whole number from 1 to 365$/ : /^kind is one of turn, subagent, worker$/);
    }
    assert.deepEqual(await adminCall(w.svc, "GET", "/memory/outcomes?project=nope"), { status: 404, body: { error: "no such project" } });
  });
  assert.deepEqual(await adminCall({ isOpen: () => false, archiveWhy: () => "Memory has not started." }, "GET", "/memory/outcomes"), { status: 503, body: { error: "Memory has not started." } }, "memory not started");
});
