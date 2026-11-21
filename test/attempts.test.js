// @ts-check
// HarnessV3-TaskGraph-v2 TG2-D53 (§13.17): several attempts per task. A team's lead may launch one brief as two or three
// workers at once (the agent tool's `attempts`), each in a worktree of its own. Filament runs each one's check when it
// reports (TG2-D45): the first that passes is the lead's worker, and the lead hears its report alone, with a line on the
// others, which are stopped and their work dropped. With none passing, the lead hears each report once the last ends.
// The attempts are not read along — three trails of one task would fill the lead's window — and their questions reach
// the lead as messages. Cases 1 to 10 of D53's words.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { AGENT_TOOL, ATTEMPTS_FIELD, leadToolsOf, teamAgentToolFor, WORKER_TOOL } from "../src/app/agent/tools.js";
import { PROMPT_VERSION } from "../src/app/agent/prompt.js";
import { whoseStop } from "../src/app/agent/looks.js";
import { taskRefs } from "../src/adapters/git/worktree.js";
import { attemptBadge, attemptTries } from "../src/ui/harness/lib/team.js";
import { BRIEF, leadOf } from "./helpers/team.js";
import { until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
/** A repository with the parser committed. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-attempts-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "parser.txt"), "BROKEN\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** A folder with no repository. */
const bare = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-attempts-bare-"));
  made.push(dir);
  return dir;
};
/** A file's text, or null. @param {string} root @param {string} f */
const read = (root, f) => {
  try {
    return readFileSync(join(root, f), "utf8");
  } catch {
    return null;
  }
};
/** The brief's check: the parser is fixed in the folder it runs in. */
const CHECK = "check parser";
const ATTEMPTED = { ...BRIEF, check: [CHECK], attempts: 3 };

/**
 * One run of an attempt's, as the test scripts it: it may write in its worktree, and ends when its promise does — or
 * when Filament stops it, as a run's mailbox takes a stop.
 * @typedef {(o: { host: any, body: any, id: string }) => Promise<{ status: string, report: string }> | { status: string, report: string }} Run
 */
/**
 * A team's registry over `dir`. Each attempt's runs are scripted by its number (`script(n, run)`), in order; a run with
 * no script never ends by itself. A stop steered into a run ends it "stopped", as a loop does. `gate`: a check held
 * until the test lets it go, by the worktree's attempt number. `threads` and `queues`: what the session keeps across a
 * restart — a registry made again over them is Filament after one. `deaf`: the attempts whose runs never end, a stop
 * and an abort included.
 * @param {string} dir
 * @param {{ seats?: number, sub?: Record<string, unknown>, loop?: Record<string, unknown>, looks?: number | null, threads?: Map<string, any[]>, queues?: Map<string, any[]>, deaf?: Set<number> }} [o]
 */
const team = (dir, { seats = 8, sub = {}, loop = {}, looks = null, threads = new Map(), queues = new Map(), deaf = new Set() } = {}) => {
  /** @type {{ id: string, body: any, host: any, runId: string }[]} */
  const posts = [];
  /** @type {{ command: string, root: string, n: number }[]} */
  const checked = [];
  /** @type {Map<number, Run[]>} */
  const scripts = new Map();
  /** @type {Map<string, (from: string) => void>} */
  const stops = new Map();
  /** @type {Map<number, Promise<void>>} */
  const gates = new Map();
  /** @type {{ runId: string, kind: string, from: string }[]} */
  const steers = [];
  /** @type {string[]} the workers whose reports reached memory */
  const learned = [];
  const doc ={ subagents: { pool: [{ model: "" }], ...sub }, loop: { permissions: "edit", rules: [], verify: {}, ...loop } };
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    // `seats`: the lead's model's limit, on its row (the owner's word of 11-05: the only one).
    config: () => ({ agentLoop: { subagents: { slots: [{ upstream: "u", model: "m-lead", n: seats }] } } }),
    log: () => {},
    events: { publish: () => {} },
    runs: /** @type {any} */ ({
      steer: (/** @type {string} */ runId, /** @type {any} */ m) => {
        steers.push({ runId, kind: m.kind, from: m.from });
        if (m.kind === "stop") stops.get(runId)?.(m.from);
        return { ok: true };
      },
      // A run log, so a lead with `looks` reads along in earnest (the registry reads along only over one): the
      // attempts' runs log nothing here.
      events: () => ({ events: [] }),
      subscribe: () => () => {},
    }),
    runCheck: async (/** @type {string} */ command, /** @type {{ root: string, signal: AbortSignal }} */ { root, signal }) => {
      const sa = posts.find((p) => root.includes(p.id));
      const n = sa ? Number(registry.get(sa.id)?.attempt?.n || 0) : 0;
      checked.push({ command, root, n });
      const gate = gates.get(n);
      if (gate) {
        const stopped = new Promise((resolve) => signal.addEventListener("abort", () => resolve("stopped"), { once: true }));
        if ((await Promise.race([gate.then(() => "go"), stopped])) === "stopped") return { exit: null, output: "", stopped: true };
      }
      return read(root, "parser.txt") === "FIXED\n" ? { exit: 0, output: "PASS parser", stopped: false } : { exit: 1, output: "FAIL parser: still broken", stopped: false };
    },
    context: {
      settings: () => structuredClone(doc),
      session: () => ({ cwd: dir, model: "m-session", projectId: null, client: "harness" }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      modelFacts: (/** @type {string} */ name) => ({ problem: null, limit: null, at: { upstream: "u", model: name } }),
      mark: () => null,
      folderProblem: () => null,
      reported: (/** @type {any} */ r) => void learned.push(r.agentId),
      saveThread: (/** @type {string} */ c, /** @type {any} */ t) => threads.set(c, [...(threads.get(c) || []).filter((x) => x.id !== t.id), structuredClone(t)]),
      loadThreads: (/** @type {string} */ c) => structuredClone(threads.get(c) || []),
      saveQueue: (/** @type {string} */ c, /** @type {any[]} */ list) => queues.set(c, structuredClone(list)),
      loadQueue: (/** @type {string} */ c) => structuredClone(queues.get(c) || []),
    },
    call: async ({ body, headers = {}, signal = null }) => {
      const id = String(headers["x-filament-subagent"]);
      const host = registry.hostOf(id);
      const runId = `run-${posts.length + 1}`;
      posts.push({ id, body, host, runId });
      registry.attach(id, runId);
      const n = Number(registry.get(id)?.attempt?.n || 0);
      if (deaf.has(n)) return await new Promise(() => {});
      const script = scripts.get(n)?.shift() || null;
      /** @type {Promise<{ status: string, report: string, stoppedBy?: string }>} */
      const stopped = new Promise((resolve) => stops.set(runId, (from) => resolve({ status: "stopped", report: "Stopped part way.", stoppedBy: from })));
      const cut = new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")), { once: true }));
      const end = await Promise.race([script ? Promise.resolve(script({ host, body, id })) : new Promise(() => {}), stopped, cut]);
      registry.finish(id, { status: end.status, error: null, report: end.report, stoppedBy: end.stoppedBy ?? null, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: end.report }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 1, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: end.report }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  const lead = leadOf(registry, dir, { looks });
  /** @type {any[]} */
  const taken = [];
  const take = () => {
    const got = lead.door.inbox.take();
    taken.push(...got);
    return got;
  };
  /** Attempt n's runs, in order. @param {number} n @param {...Run} runs */
  const script = (n, ...runs) => scripts.set(n, [...(scripts.get(n) || []), ...runs]);
  return { dir, registry, posts, checked, gates, steers, learned, doc, threads, queues, lead, take, taken, script };
};
/** A run that fixes the parser and reports. @type {Run} */
const fixes = ({ host }) => {
  writeFileSync(join(host.workdir, "parser.txt"), "FIXED\n");
  return { status: "done", report: "Fixed the parser." };
};
/** A run that changes the parser, wrongly, and reports. @type {Run} */
const breaks = ({ host }) => {
  writeFileSync(join(host.workdir, "parser.txt"), "STILL BROKEN\n");
  return { status: "done", report: "Changed the parser." };
};
/** The lead's launch of the brief as attempts. @param {ReturnType<typeof team>} t @param {Record<string, any>} [more] */
const launch = (t, more = {}) => t.lead.tools.agent(t.lead.call({ ...ATTEMPTED, ...more }));
/** The attempts the registry holds, by number. @param {ReturnType<typeof team>} t */
const attempts = (t) => /** @type {any[]} */ (t.registry.list("c1")).filter((s) => s.attempt).sort((a, b) => a.attempt.n - b.attempt.n);
/**
 * How long a wait on the attempts' work is given: each attempt's worktree, its work's refs and its checks are git
 * processes, which a full suite's load spreads over many times the seconds they take alone.
 */
const WORK = { timeoutMs: 60_000 };
/**
 * Every attempt has ended, and none still settles: a winner waits for the others' ends before its report goes. @param {ReturnType<typeof team>} t
 */
const allEnded = (t) => until(() => attempts(t).length > 0 && attempts(t).every((s) => s.status !== "running" && t.registry.settled(s.id) == null), "every attempt to end", WORK);
/**
 * Every attempt's run has begun. Each attempt's copy is a worktree made for it, which a busy machine makes late, and an
 * attempt stopped before its run began has no work and no spend: a test of how the others end, once one wins or is
 * held, waits for this before it lets that happen. @param {ReturnType<typeof team>} t
 */
const allRunning = (t) => until(() => attempts(t).length === 3 && attempts(t).every((s) => t.posts.some((p) => p.id === s.id)), "every attempt's run to begin", WORK);
/** The reports the lead's door took. @param {ReturnType<typeof team>} t */
const reports = (t) => t.take().filter((d) => d.kind === "report");

// ---- case 1: the field -----------------------------------------------------------------------------------------------

// (fails before: yes — a lead's agent tool had no attempts: one launch was one worker)
test("the team lead's agent tool takes attempts, 2 or 3, in both seats; the session's agent and a worker have none; prompt version 31 (32 since E4, 33 since V2-1's check)", () => {
  assert.deepEqual(leadToolsOf(null).agent.input_schema.properties.attempts, ATTEMPTS_FIELD);
  assert.deepEqual(ATTEMPTS_FIELD, {
    type: "integer",
    enum: [2, 3],
    description:
      "2 or 3: that many workers take this brief at once, each in a worktree of its own, for a task worth trying more than once. Filament runs each one's check when it reports: the first that passes is your worker, and you hear its report alone; the others are stopped and their work dropped. If none passes, you hear each. Needs check; never with plan_review, nor for a worker that changes nothing. You do not read along with them.",
  });
  // A coding agent's lead reads the same tool over MCP (agent-tools.js `teamAgentToolFor`), saved agents it asks or not.
  const asks = [{ tag: "critic", name: "Critic", kind: /** @type {const} */ ("lead"), goodFor: "reads a plan", may: "read" }];
  assert.deepEqual(teamAgentToolFor([], null).input_schema.properties.attempts, ATTEMPTS_FIELD);
  assert.deepEqual(teamAgentToolFor(/** @type {any} */ (asks), null).input_schema.properties.attempts, ATTEMPTS_FIELD);
  assert.equal("attempts" in AGENT_TOOL.input_schema.properties, false);
  assert.equal("attempts" in WORKER_TOOL.input_schema.properties, false);
  assert.equal(PROMPT_VERSION, 129);
});

// (fails before: yes — a stop from Filament read as the developer's: the D53 drive's dropped attempts said "the developer
// stopped this turn", in the loop's seat and a coding agent's alike)
test("whose stop a run's last words name: the developer's turn; its lead's, the agent's or Filament's task", () => {
  assert.deepEqual([undefined, "harness", "lead", "agent", "filament"].map((f) => whoseStop(f)), [
    { who: "the developer", what: "turn" },
    { who: "the developer", what: "turn" },
    { who: "your team's lead", what: "task" },
    { who: "the agent", what: "task" },
    { who: "Filament", what: "task" },
  ]);
});

// ---- case 2: refused at launch -----------------------------------------------------------------------------------------

// (fails before: yes — attempts was no field: every one of these launched one worker)
test("attempts refused at launch, in words, nothing launched: not 2 or 3, a saved agent's question, no check, a member that changes nothing, plan_review, a check Filament cannot run, no worktree, too few seats", async () => {
  /** @param {ReturnType<typeof team>} t @param {Record<string, any>} more @param {string} why */
  const refused = async (t, more, why) => {
    const r = await launch(t, more);
    assert.equal(r.ok, false, r.text);
    assert.equal(r.text, `Not launched: ${why}`);
    assert.equal(r.note, `agent: a launch refused — ${why.replace(/\.$/, "")}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(t.registry.list("c1"), [], "nothing launched");
    assert.equal(t.posts.length, 0);
  };
  const t = team(repo());
  await refused(t, { attempts: 4 }, "attempts is 2 or 3: that many workers take the brief at once — leave it out for one.");
  await refused(t, { role: "critic", goal: "Is the plan sound?" }, "attempts are for a worker's brief: a saved agent you ask answers once.");
  await refused(t, { check: undefined }, "attempts needs check: Filament runs each one's check when it reports, and the first that passes wins.");
  await refused(t, { role: "scout" }, "attempts are for a worker that changes files, and scout changes nothing.");
  await refused(team(repo(), { looks: 300 }), { plan_review: true }, "plan_review and attempts go apart: you would review each attempt's plan.");
  // A rule that speaks for a brief's check refuses any launch of it already (TG2-D44), in its own words.
  await refused(team(repo(), { loop: { rules: [{ tool: "bash", pattern: "check parser*", verdict: "deny" }] } }), {}, "check's `check parser` is refused by this session's rule bash(check parser*) deny: leave it out.");
  await refused(team(repo(), { loop: { rules: [{ tool: "bash", pattern: "check parser*", verdict: "ask" }] } }), {}, "check's `check parser` asks first by this session's rule bash(check parser*) ask, which a brief does not lift: leave it out.");
  await refused(team(repo(), { loop: { permissions: "read-only" } }), {}, "attempts need a check Filament can run, and the session is read-only.");
  await refused(team(repo(), { sub: { worktree: false } }), {}, "attempts need a worktree each, and this session's sub-agents share its folder (subagents.worktree is off): launch one worker.");
  const none = bare();
  const r = await launch(team(none));
  assert.equal(r.ok, false);
  assert.match(r.text, /^Not launched: attempts need a worktree each, and this folder has none to give \(.+\): launch one worker\.$/);
  await refused(team(repo(), { seats: 2 }), {}, "attempts 3 need 3 seats at once, and the pool has 2 free now: launch fewer, or wait for a worker to report.");
});

// ---- case 3: the launch ------------------------------------------------------------------------------------------------

// (fails before: yes — one worker launched, read along where its lead reads along)
test("the launch: three workers of the member, the same brief, each in a worktree and a seat of its own, said in one answer — none read along, though their lead reads along", async () => {
  const t = team(repo(), { looks: 300 });
  const r = await launch(t);
  assert.equal(r.ok, true, r.text);
  await until(() => t.posts.length === 3, "three runs to start", WORK);
  const [a, b, c] = attempts(t);
  assert.deepEqual([a, b, c].map((s) => s.attempt), [1, 2, 3].map((n) => ({ group: a.id, n, of: 3, won: false, dropped: null })));
  assert.equal(r.agentId, a.id);
  assert.equal(
    r.text,
    `Launched 3 attempts at "Fix the parser" in the background: builder ${a.id}, ${b.id} and ${c.id}, each in a worktree of its own. Filament runs each one's check when it reports: the first that passes is your worker, and its report alone reaches you; the others are stopped and their work dropped. If none passes, each report reaches you. You do not read along with them; a question of theirs reaches you as a message. To message or stop one, call worker with its agent_id. 3 running.`,
  );
  assert.equal(r.note, `agent: launched 3 attempts of builder (${a.id}, ${b.id}, ${c.id}; m-lead) for team Architect in the background`);
  const brief = (/** @type {any} */ p) => String(p.body.messages[0].content.at(-1).text);
  assert.deepEqual(t.posts.map(brief), [0, 1, 2].map(() => brief(t.posts[0])), "the same brief");
  assert.match(brief(t.posts[0]), /^Your task: Fix the parser/);
  assert.equal(new Set(t.posts.map((p) => p.host.workdir)).size, 3, "three worktrees");
  assert.deepEqual(t.posts.map((p) => p.host.supervise), [false, false, false], "none read along");
  // The lead does read along: a worker it launches alone is read from its start.
  const one = await launch(t, { attempts: undefined });
  assert.equal(one.ok, true, one.text);
  await until(() => t.posts.length === 4, "the lone worker's run to start", WORK);
  assert.equal(t.posts[3].host.supervise, true);
  for (const id of [a.id, b.id, c.id, String(one.agentId)]) t.registry.stop(id, { from: "lead" });
  await allEnded(t);
  await until(() => t.registry.get(String(one.agentId))?.status !== "running", "the lone worker to end", WORK);
});

// ---- case 4: the first green wins --------------------------------------------------------------------------------------

// (fails before: yes — each of three launches reported on its own, and each change waited)
test("the first green wins: its report alone reaches the lead, with a line; the others are stopped — one running, one in its check — their reports never come, their work is dropped, and every attempt's spend goes with the report", async () => {
  const t = team(repo());
  t.script(1, breaks);
  t.gates.set(1, new Promise(() => {}));
  t.script(2, async (o) => {
    await until(() => t.checked.some((c) => c.n === 1), "attempt 1's check to start", WORK);
    await allRunning(t);
    return fixes(o);
  });
  const r = await launch(t);
  assert.equal(r.ok, true, r.text);
  await allEnded(t);
  const [a, b, c] = attempts(t);
  const got = reports(t);
  assert.equal(got.length, 1, "one report");
  assert.equal(got[0].from, b.id);
  assert.match(got[0].text, /Its report:\nFixed the parser\./);
  // The time is the winner's, from its launch: a second or two, as the machine runs.
  assert.match(got[0].text, new RegExp(`\\n\\n\\[Filament: 3 attempts at "Fix the parser": ${b.id}'s check passed first, after \\d+ s\\. ${a.id} and ${c.id} were stopped; their work is dropped\\.\\]$`));
  assert.equal(got[0].spentUsd, 3, "every attempt's run");
  assert.equal(got[0].toolCalls, 3);
  // Attempt 1's run had reported: Filament stopped its check.
  assert.deepEqual([a, b, c].map((s) => [s.status, s.attempt.won, s.attempt.dropped]), [["done", false, b.id], ["done", true, null], ["stopped", false, b.id]]);
  assert.deepEqual([a.work.pending, b.work.pending, c.work.pending], [0, 1, 0], "the winner's change alone waits");
  assert.equal(await taskRefs(t.dir, a.id), null, "attempt 1's refs are gone");
  assert.equal(await taskRefs(t.dir, c.id), null);
  assert.notEqual(await taskRefs(t.dir, b.id), null);
  assert.deepEqual(t.steers.filter((s) => s.kind === "stop").map((s) => s.from), ["filament"], "the running one is stopped by Filament; the one in its check by its abort");
  // Attempt 1 reported, and its work is dropped: what it says it did never reaches memory.
  assert.deepEqual(t.learned, [b.id], "the winner's report alone reaches memory");
});

// ---- case 5: a red attempt goes back, and may still win ---------------------------------------------------------------

// (fails before: yes — attempts was no field)
test("a red attempt goes back to its worker as TG2-D45 says, and wins when its check passes the next time", async () => {
  const t = team(repo());
  t.script(
    1,
    async (o) => {
      await allRunning(t);
      return breaks(o);
    },
    fixes,
  );
  const r = await launch(t);
  assert.equal(r.ok, true, r.text);
  await allEnded(t);
  const [a, b, c] = attempts(t);
  const got = reports(t);
  assert.deepEqual(got.map((d) => d.from), [a.id]);
  assert.match(got[0].text, new RegExp(`${a.id}'s check passed first, after \\d+ s\\. ${b.id} and ${c.id} were stopped; their work is dropped\\.\\]$`));
  assert.equal(a.exchanges.length, 2, "sent back once");
  assert.equal(got[0].spentUsd, 4, "its two runs and the others' one each");
});

// (fails before: yes — attempts was no field)
test("a red attempt held while another runs: once another wins, its report never comes, its work is dropped, and the winner's line says its check failed", async () => {
  const t = team(repo());
  t.script(1, breaks, breaks, breaks);
  t.script(2, async (o) => {
    await until(() => attempts(t)[0]?.exchanges.at(-1)?.delivery === "attempt", "attempt 1's report to be held", WORK);
    await allRunning(t);
    return fixes(o);
  });
  const r = await launch(t);
  assert.equal(r.ok, true, r.text);
  await allEnded(t);
  const [a, b, c] = attempts(t);
  const got = reports(t);
  assert.deepEqual(got.map((d) => d.from), [b.id]);
  assert.match(got[0].text, new RegExp(`\\n\\n\\[Filament: 3 attempts at "Fix the parser": ${b.id}'s check passed first, after \\d+ s\\. ${a.id}'s check had failed \\(\`check parser\`, exit 1\\) and ${c.id} was stopped; their work is dropped\\.\\]$`));
  assert.deepEqual([a.status, a.attempt.dropped, a.exchanges.at(-1).delivery], ["done", b.id, "attempt"], "held, and never sent");
  assert.deepEqual([a.work.pending, c.work.pending, b.work.pending], [0, 0, 1]);
  assert.equal(await taskRefs(t.dir, a.id), null, "the held one's refs are gone");
  assert.deepEqual(t.learned, [b.id]);
});

// ---- case 6: none green ------------------------------------------------------------------------------------------------

// (fails before: yes — attempts was no field)
test("none green: each report waits until the last attempt ends, then each reaches the lead with a line, and each change waits", async () => {
  const t = team(repo());
  t.script(1, breaks, breaks, breaks);
  t.script(2, breaks, breaks, breaks);
  const r = await launch(t);
  assert.equal(r.ok, true, r.text);
  await until(() => attempts(t).filter((s) => s.status !== "running").length === 2, "two attempts to end", WORK);
  assert.deepEqual(reports(t), [], "held while one still runs");
  const [a, b, c] = attempts(t);
  assert.deepEqual([a.exchanges.at(-1).delivery, b.exchanges.at(-1).delivery], ["attempt", "attempt"]);
  await allRunning(t);
  t.registry.stop(c.id, { from: "lead" });
  await allEnded(t);
  const got = reports(t);
  assert.deepEqual(got.map((d) => d.from), [a.id, b.id, c.id]);
  for (const [i, d] of got.entries()) assert.ok(d.text.endsWith(`\n\n[Filament: attempt ${i + 1} of 3 at "Fix the parser" — none of the 3 passed its check, so each report reaches you: apply a change with reason, follow one up, or brief the task again.]`), d.text);
  assert.match(got[0].text, /`check parser` failed \(exit 1, /);
  assert.match(got[2].text, /was stopped as you asked/);
  assert.deepEqual(attempts(t).map((s) => [s.work.pending, s.attempt.dropped]), [[1, null], [1, null], [0, null]]);
});

// ---- case 7: a question ------------------------------------------------------------------------------------------------

// (fails before: yes — attempts was no field)
test("an attempt's question reaches its lead as a message that names the attempt, though its lead reads along", async () => {
  const t = team(repo(), { looks: 300 });
  const r = await launch(t);
  assert.equal(r.ok, true, r.text);
  await until(() => t.posts.length === 3, "three runs to start", WORK);
  const [, b] = attempts(t);
  void t.registry.askLead(b.id, { question: "Keep the old signature?", options: ["yes", "no"] });
  const asked = t.take().filter((d) => d.kind === "ask");
  assert.deepEqual(asked.map((d) => d.text), [`[Filament: your builder ${b.id} ("Fix the parser", attempt 2 of 3) asks you (ask 1), and waits for your answer:\nKeep the old signature?\nIts options, its pick first: yes · no\n\nAnswer it with worker: agent_id "${b.id}", ask 1 and answer.]`]);
  for (const s of attempts(t)) t.registry.stop(s.id, { from: "lead" });
  await allEnded(t);
});

// ---- case 8: after ------------------------------------------------------------------------------------------------------

// (fails before: yes — attempts was no field)
test("after the win: a follow-up or an apply of a dropped attempt is refused in words that name the winner; the winner's change applies, and the folder's check runs, as any", async () => {
  const t = team(repo());
  t.script(3, async (o) => {
    await allRunning(t);
    return fixes(o);
  });
  const r = await launch(t);
  assert.equal(r.ok, true, r.text);
  await allEnded(t);
  reports(t);
  const [a, , c] = attempts(t);
  const follow = await t.lead.tools.worker(t.lead.call({ agent_id: a.id, prompt: "Try again." }));
  assert.equal(follow.ok, false);
  assert.match(follow.text, new RegExp(`${a.id} was attempt 1 of 3 at "Fix the parser", which ${c.id} won: its work was dropped — follow up on ${c.id}`));
  const dropped = await t.lead.tools.worker(t.lead.call({ agent_id: a.id, apply_changes: true }));
  assert.equal(dropped.ok, false);
  assert.match(dropped.text, new RegExp(`${a.id} was attempt 1 of 3 at "Fix the parser", which ${c.id} won: its work was dropped — apply ${c.id}'s`));
  const applied = await t.lead.tools.worker(t.lead.call({ agent_id: c.id, apply_changes: true }));
  assert.equal(applied.ok, true, applied.text);
  assert.match(applied.text, /Filament's check of the folder with them passed: `check parser` passed/);
  assert.equal(read(t.dir, "parser.txt"), "FIXED\n");
});

// ---- case 9: a restart --------------------------------------------------------------------------------------------------

// (fails before: yes — attempts was no field)
test("a graceful stop: the held reports reach the lead's next turn with the cut ones; after a crash, an attempt's orphan notice brings its group's held reports", async () => {
  {
    const t = team(repo());
    t.script(1, breaks, breaks, breaks);
    const r = await launch(t);
    assert.equal(r.ok, true, r.text);
    await until(() => attempts(t)[0]?.status === "done", "attempt 1 to end", WORK);
    await allRunning(t);
    const [a, b, c] = attempts(t);
    assert.equal(t.registry.shutdown(), 2);
    await allEnded(t);
    // Filament stopping keeps them for the session's next turn.
    const got = (t.queues.get("c1") || []).filter((d) => d.kind === "report");
    assert.deepEqual(got.map((d) => d.from).sort(), [a.id, b.id, c.id].sort());
    assert.match(got.find((d) => d.from === a.id)?.text || "", /none of the 3 passed its check/);
    assert.match(got.find((d) => d.from === b.id)?.text || "", /was cut by a Filament restart/);
  }
  {
    const threads = new Map();
    const queues = new Map();
    const t = team(repo(), { threads, queues });
    t.script(1, breaks, breaks, breaks);
    const r = await launch(t);
    assert.equal(r.ok, true, r.text);
    await until(() => attempts(t)[0]?.status === "done", "attempt 1 to end", WORK);
    await allRunning(t);
    const [a, b] = attempts(t);
    // A crash: the process is gone, its runs with it. The next one finds attempt 2's run left open.
    const next = team(t.dir, { threads, queues });
    const runId = String(t.posts.find((p) => p.id === b.id)?.runId);
    assert.equal(next.registry.orphaned({ runId, chainId: "c1", brief: { agentId: b.id, description: "Fix the parser", task: "Fix the parser" } }), true);
    const queued = (queues.get("c1") || []).filter((d) => d.kind === "report");
    assert.deepEqual(queued.map((d) => d.from).sort(), [a.id, b.id].sort());
    assert.match(queued.find((d) => d.from === a.id)?.text || "", /none of the 3 passed its check/);
  }
  {
    // An attempt whose run does not end on Filament's stop — its agent slow to let go — holds back none of the others':
    // Filament stopping waits for no sibling.
    const t = team(repo(), { deaf: new Set([3]) });
    t.script(1, breaks, breaks, breaks);
    const r = await launch(t);
    assert.equal(r.ok, true, r.text);
    await until(() => attempts(t)[0]?.status === "done", "attempt 1 to end", WORK);
    await allRunning(t);
    const [a, b, c] = attempts(t);
    assert.equal(t.registry.shutdown(), 2);
    await until(() => (t.queues.get("c1") || []).filter((d) => d.kind === "report").length === 2, "attempts 1 and 2's reports kept", WORK);
    const got = (t.queues.get("c1") || []).filter((d) => d.kind === "report");
    assert.deepEqual(got.map((d) => d.from).sort(), [a.id, b.id].sort());
    assert.match(got.find((d) => d.from === a.id)?.text || "", /none of the 3 passed its check/);
    assert.equal(t.registry.get(c.id)?.status, "running", "attempt 3's run has not ended");
  }
});

// ---- case 10: the page -------------------------------------------------------------------------------------------------

// (fails before: yes — attemptTries was not there: three cards for one launch, none saying which won)
test("the page: once one won, one card for the launch — the winner's — the others its tries, each with how it ended; before that, each attempt its own card, its badge saying which", () => {
  const row = (/** @type {string} */ id, /** @type {number} */ n, /** @type {string} */ status, /** @type {any} */ more = {}) => ({ id, status, startedAt: n, attempt: { group: "sa_1", n, of: 3, won: false, dropped: null, ...more.attempt }, exchanges: [{ status, startedAt: n, endedAt: status === "running" ? null : n + 60_000, report: more.report || "", error: more.error || null }] });
  const other = { id: "sa_9", status: "running", startedAt: 0, attempt: null, exchanges: [] };
  const won = attemptTries([row("sa_1", 1, "stopped", { attempt: { dropped: "sa_2" }, report: "Stopped part way." }), row("sa_2", 2, "done", { attempt: { won: true } }), row("sa_3", 3, "stopped", { attempt: { dropped: "sa_2" } }), other]);
  assert.deepEqual(won.rows.map((r) => r.id), ["sa_2", "sa_9"]);
  assert.deepEqual(won.tries.get("sa_2"), [
    // (fails before: yes — the cause named the winner by its id, "sa_2 passed first")
    { agent: "sa_1", state: "stopped", how: "stopped", cause: "attempt 2 passed first", ms: 60_000 },
    { agent: "sa_3", state: "stopped", how: "stopped", cause: "attempt 2 passed first", ms: 60_000 },
  ]);
  const live = attemptTries([row("sa_1", 1, "done", { report: "Changed the parser." }), row("sa_2", 2, "running"), row("sa_3", 3, "running")]);
  assert.deepEqual(live.rows.map((r) => r.id), ["sa_1", "sa_2", "sa_3"]);
  assert.equal(live.tries.size, 0);
  assert.deepEqual(["sa_1", "sa_2", "sa_3"].map((id) => attemptBadge(live.rows.find((r) => r.id === id))), ["attempt 1 of 3", "attempt 2 of 3", "attempt 3 of 3"]);
  assert.equal(attemptBadge(won.rows[0]), "won, of 3 attempts");
  assert.equal(attemptBadge(other), "");
});
