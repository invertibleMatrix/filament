// @ts-check
// HarnessV3-TaskGraph-v2 TG2-D45 (§13): Filament runs a worker's check, and a red one goes back by itself. When a team's
// worker whose brief gave a check reports done in its own worktree, Filament runs the check there before its lead hears
// anything: after its work is captured, so nothing the check writes enters the change; one command after another,
// stopping at the first that fails; with no clock of its own — the lead's stop of the worker, or the turn's, ends it. A
// green check reaches the lead with the report. A red one goes back to the worker with its output, twice at most, while
// the lead hears nothing; after the second the report comes with the failing output, and its apply needs a reason. No
// check runs for a worker that failed, was stopped or shares the developer's folder, in a read-only session, or for a
// command a rule speaks for — the report says why. A report that says "tested" where no command ran after its last
// change, and Filament ran no check, says what Filament saw. Cases 16 to 22 of §13.7.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { inputRefusal } from "../src/app/agent/team-tools.js";
import { WORKER_TOOL } from "../src/app/agent/tools.js";
import { runOwnCommand } from "../src/adapters/tools/hands.js";
import { copyState } from "./helpers/copies.js";
import { BRIEF, deferred, leadOf } from "./helpers/team.js";
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
/** The parser as the developer's folder has it, and the check that proves it takes an empty input. */
const PARSE = "exports.parse = (s) => s.split(',');\n";
const FIXED = "exports.parse = (s) => (s ? s.split(',') : []);\n";
const CHECK_JS = [
  "const { parse } = require('./parse.js');",
  "require('fs').writeFileSync('out.txt', 'the check wrote this\\n');",
  "console.log('checking parse');",
  "console.log('one');",
  "console.log('two');",
  "const got = parse('');",
  "console.log(got.length === 0 ? 'ok: an empty input gives []' : 'FAIL: an empty input gives ' + JSON.stringify(got));",
  "process.exit(got.length === 0 ? 0 : 1);",
  "",
].join("\n");
/** A repository with the parser and its check committed. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-check-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "parse.js"), PARSE);
  writeFileSync(join(dir, "check.js"), CHECK_JS);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** A folder that is no repository. */
const plainFolder = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-check-plain-"));
  made.push(dir);
  writeFileSync(join(dir, "parse.js"), PARSE);
  return dir;
};

/**
 * One run of the worker's, as the test scripts it: what it does in its folder, the events it relays, how it ends.
 * @typedef {(o: { host: any, body: any, relay: (e: any) => void }) => Promise<{ status: string, report: string, stoppedBy?: string }> | { status: string, report: string, stoppedBy?: string }} Run
 */
/**
 * One run of Filament's check, as the test scripts it: what it answers, given its command, where it ran and its stop.
 * @typedef {(command: string, root: string, signal: AbortSignal) => Promise<{ exit: number | null, output: string, stopped: boolean }> | { exit: number | null, output: string, stopped: boolean }} Check
 */
/**
 * A team's registry over `dir`, whose host serves each run of a worker as `runs` scripts it, in order, and finishes it
 * as turn.js does — and whose check runs as `checks` scripts them (`own`: Filament's own runner, for real). Its clock is
 * the test's (`clock`). The session's settings are `doc`, which a test may change mid-work: a rule added, its mode.
 * What each run was sent, what `hostOf` gave it, and each check's call are kept.
 * @param {string} dir @param {{ own?: boolean, threads?: Map<string, any[]> }} [o]
 */
const team = (dir, { own = false, threads = new Map() } = {}) => {
  /** @type {{ body: any, host: any }[]} */
  const posts = [];
  /** @type {{ command: string, root: string, files: string[] }[]} */
  const checked = [];
  /** @type {Run[]} */
  const runs = [];
  /** @type {Check[]} */
  const checks = [];
  const clock = { at: 1_000_000 };
  /** @type {{ subagents: any, loop: { permissions: string, rules: any[] } }} */
  const doc = { subagents: { pool: [{ model: "", seats: 8 }] }, loop: { permissions: "edit", rules: [] } };
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    now: () => clock.at,
    ...(own
      ? {}
      : {
          runCheck: async (/** @type {string} */ command, /** @type {{ root: string, signal: AbortSignal }} */ { root, signal }) => {
            checked.push({ command, root, files: readdirSync(root).filter((f) => f !== ".git").sort() });
            const next = checks.shift();
            return next ? next(command, root, signal) : { exit: 0, output: "ok", stopped: false };
          },
        }),
    context: {
      settings: () => structuredClone(doc),
      session: () => ({ cwd: dir, model: "m-session", projectId: null, client: "harness" }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
      saveThread: (/** @type {string} */ c, /** @type {any} */ t) => threads.set(c, [...(threads.get(c) || []).filter((x) => x.id !== t.id), structuredClone(t)]),
      loadThreads: (/** @type {string} */ c) => structuredClone(threads.get(c) || []),
    },
    call: async ({ body, headers = {} }) => {
      const id = String(headers["x-filament-subagent"]);
      const host = registry.hostOf(id);
      posts.push({ body, host });
      const runId = `run-${posts.length}`;
      registry.attach(id, runId);
      const script = runs.shift() || /** @type {Run} */ (() => ({ status: "done", report: "Done." }));
      const end = await script({ host, body, relay: (e) => registry.relay(id, e) });
      registry.finish(id, { status: end.status, error: null, report: end.report, stoppedBy: end.stoppedBy ?? null, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: end.report }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0.01, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: end.report }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return { registry, posts, checked, runs, checks, clock, doc, threads, lead: leadOf(registry, dir) };
};
/** A worker launched from `brief`, its id. @param {ReturnType<typeof team>} t @param {any} brief */
const launch = async (t, brief) => {
  const r = await t.lead.tools.agent(t.lead.call(brief));
  assert.equal(r.ok, true, r.text);
  return String(r.agentId);
};
/**
 * Its exchange's end: the reports its lead's turn took. Its end can come after two returns, each a capture, a worktree
 * made again and a check — git's work, which a loaded machine makes slow: the deadline is a minute.
 * @param {ReturnType<typeof team>} t @param {string} id
 */
const reported = async (t, id) => {
  await until(() => t.registry.get(id)?.status !== "running", "the worker to report", { timeoutMs: 60_000 });
  return t.lead.door.inbox.take().filter((d) => d.kind === "report");
};
/** The newest user words a run was sent. @param {{ body: any }} p */
const lastSaid = (p) => String(p.body.messages.at(-1).content.at(-1).text);
/** A run that writes the fixed parser in its folder and reports. @param {string} report @returns {Run} */
const fixes = (report) => ({ host }) => {
  writeFileSync(join(host.workdir, "parse.js"), FIXED);
  return { status: "done", report };
};
const CHECKED = { ...BRIEF, check: ["npm test"] };
const RED = "FAIL parse.test.js\n  expected [] to equal ['']\n";

// ---- Filament's own runner: no clock ----------------------------------------------------------------------------------

// (fails before: yes — there was no runner of Filament's own: a command ran only as the bash hand runs one, on a clock
// of 120 s by default, which a test suite outlives)
test("Filament's own run of a command answers its exit and the end of its output, a stop ends it, and it sets no clock of its own", async () => {
  const root = plainFolder();
  assert.deepEqual(await runOwnCommand("echo one; echo two; exit 3", { root }), { exit: 3, output: "one\ntwo", stopped: false });
  assert.deepEqual(await runOwnCommand("echo passed", { root }), { exit: 0, output: "passed", stopped: false });
  const stop = new AbortController();
  const began = Date.now();
  const cut = runOwnCommand("sleep 20", { root, signal: stop.signal });
  setTimeout(() => stop.abort(), 300);
  const r = await cut;
  assert.equal(r.stopped, true);
  assert.equal(r.exit, null);
  assert.ok(Date.now() - began < 10_000, "the stop ended it, not its end");
  // No clock: the bash hand's 120 s is never set for Filament's own command.
  const real = globalThis.setTimeout;
  /** @type {number[]} */
  const set = [];
  globalThis.setTimeout = /** @type {any} */ ((/** @type {any} */ fn, /** @type {number} */ ms, /** @type {any[]} */ ...rest) => {
    set.push(Number(ms) || 0);
    return real(fn, ms, ...rest);
  });
  try {
    assert.equal((await runOwnCommand("echo timed", { root })).exit, 0);
  } finally {
    globalThis.setTimeout = real;
  }
  assert.deepEqual(set.filter((ms) => ms >= 60_000), [], "no timer of a minute or more");
});

// ---- case 16: green -------------------------------------------------------------------------------------------------

// (fails before: yes — Filament ran no check: the lead heard the worker's claim alone, and ran the tests itself or not)
test("a worker with a check that reports done: Filament runs it in the worktree after its work is captured, and the lead hears it passed, with its output's end — what the check wrote is not in the change", async () => {
  const dir = repo();
  const t = team(dir, { own: true });
  t.runs.push(fixes("Fixed: an empty input gives [] now."));
  const id = await launch(t, { ...BRIEF, check: ["node check.js"] });
  const [r, more] = await reported(t, id);
  assert.equal(more, undefined, "one report");
  assert.match(r.text, /Its report:\nFixed: an empty input gives \[\] now\.\n\nFilament ran its check after it reported: `node check\.js` passed \(exit 0, 1 s\)\. The end of its output:\none\ntwo\nok: an empty input gives \[\]\n\nIt worked in its own git worktree/);
  // The check ran in the worktree, where it wrote out.txt: the capture came first, and the copy was parked after it.
  const change = await t.registry.changes(id, "c1");
  assert.equal(change.ok, true);
  assert.deepEqual(/** @type {any} */ (change).files.map((/** @type {any} */ f) => f.path), ["parse.js"]);
  assert.equal(copyState(String(t.posts[0].host.workdir)), "parked", "the copy was parked after the check");
  assert.equal(existsSync(join(dir, "out.txt")), false, "your folder is untouched");
  assert.equal(readFileSync(join(dir, "parse.js"), "utf8"), PARSE);
});

// (fails before: yes — the same)
test("a check of several commands runs them in order, in the worktree, and the report names each", async () => {
  const t = team(repo());
  t.runs.push(fixes("Fixed."));
  t.checks.push(
    () => {
      t.clock.at += 3_000;
      return { exit: 0, output: "built\n", stopped: false };
    },
    () => {
      t.clock.at += 12_000;
      return { exit: 0, output: "PASS a\nPASS b\nPASS c\nTests: 3 passed\n", stopped: false };
    },
  );
  const id = await launch(t, { ...BRIEF, check: ["npm run build", "npm test"] });
  const [r] = await reported(t, id);
  assert.deepEqual(t.checked.map((c) => [c.command, c.root]), [["npm run build", t.posts[0].host.workdir], ["npm test", t.posts[0].host.workdir]]);
  assert.match(r.text, /\n\nFilament ran its check after it reported: `npm run build` passed \(exit 0, 3 s\) and `npm test` passed \(exit 0, 12 s\)\. The end of its output:\nPASS b\nPASS c\nTests: 3 passed\n\n/);
});

// ---- case 17: red, then green ---------------------------------------------------------------------------------------

// (fails before: yes — a red check went nowhere: there was none, and the lead read "tests pass" from a worker that had
// not made them pass)
test("a red check goes back to the worker with its output, in Filament's words, while the lead hears nothing; after the green run the lead hears once that it went back once", async () => {
  const dir = repo();
  const t = team(dir);
  const second = deferred();
  t.runs.push(fixes("Fixed."), async ({ host, relay }) => {
    relay({ type: "round-start", round: 3 });
    await second.promise;
    writeFileSync(join(host.workdir, "parse.js"), FIXED.replace("[]", "[ ]"));
    return { status: "done", report: "Fixed for real: the empty input case." };
  });
  t.checks.push(
    (_c, root) => {
      writeFileSync(join(root, "coverage.txt"), "the check wrote this");
      t.clock.at += 12_000;
      return { exit: 1, output: RED, stopped: false };
    },
    () => {
      t.clock.at += 5_000;
      return { exit: 0, output: "PASS parse.test.js\nTests: 3 passed\n", stopped: false };
    },
  );
  const id = await launch(t, CHECKED);
  const owed = t.lead.door.inbox.owed();
  await until(() => t.posts.length === 2, "the worker to be sent back");
  // The worker reads Filament's words, with the output, in the context it has.
  assert.equal(
    lastSaid(t.posts[1]),
    "[Filament: you reported, and Filament ran your brief's check in your worktree before your lead heard of it. It failed:\n\n$ npm test\nexit 1 after 12 s — the end of its output:\nFAIL parse.test.js\n  expected [] to equal ['']\n\nYour lead hears your report once the check passes, or after Filament has sent it back to you twice — this is the first time. Fix the cause the output shows, never the check: a test weakened or skipped to get green is still a failure. Run the check yourself, then report again.]",
  );
  assert.ok(t.posts[1].body.messages.some((/** @type {any} */ m) => m.role === "assistant" && JSON.stringify(m.content).includes("Fixed.")), "it goes on in the context it has");
  // Its worktree is back with its change, and without what the check wrote.
  assert.equal(readFileSync(join(t.posts[1].host.workdir, "parse.js"), "utf8"), FIXED);
  assert.equal(existsSync(join(t.posts[1].host.workdir, "coverage.txt")), false);
  // Meanwhile the lead hears nothing, its turn still owes the report, and its watch says the worker was sent back.
  await until(() => t.registry.get(id)?.progress?.round === 3, "its second run to start its round");
  assert.deepEqual(t.lead.door.inbox.take(), []);
  assert.equal(t.registry.get(id)?.status, "running");
  assert.equal(await Promise.race([owed, Promise.resolve("pending")]), "pending");
  assert.equal(t.lead.timeline.filter((e) => e.type === "subagent-end").length, 0, "no end for the run that went back");
  assert.match(t.lead.tools.watch({ chainId: "c1" }).text, /: round 3 · sent back by Filament: its check `npm test` failed \(first time\)/);
  second.resolve();
  const reports = await reported(t, id);
  await owed;
  assert.equal(reports.length, 1, "the lead hears once");
  const [r] = reports;
  assert.match(r.text, /You asked it:\nYour task: Fix the parser\n/, "the report answers the lead's brief");
  assert.match(r.text, /Its report:\nFixed for real: the empty input case\.\n\nFilament ran its check after it reported: `npm test` passed \(exit 0, 5 s\), after going back to the worker once with a failing run's output\. The end of its output:\nPASS parse\.test\.js\nTests: 3 passed\n\n/);
  // Both runs' spend goes with the one report.
  assert.deepEqual(r.roundIds, ["run-1", "run-2"]);
  assert.equal(Math.round(r.spentUsd * 100), 2);
  const change = /** @type {any} */ (await t.registry.changes(id, "c1"));
  assert.deepEqual(change.files.map((/** @type {any} */ f) => f.path), ["parse.js"]);
  assert.deepEqual(t.registry.get(id)?.exchanges.map((x) => [x.delivery, x.bounce ?? 0]), [["back", 0], ["auto", 1]]);
});

// ---- case 18: red three times ---------------------------------------------------------------------------------------

// (fails before: yes — the same; and an apply took any change, whatever Filament had seen of it)
test("a check red three times: the lead hears after the second return, with the output; its apply needs a reason, which the record keeps — after a restart too", async () => {
  const dir = repo();
  const t = team(dir);
  t.runs.push(fixes("Fixed."), fixes("Fixed again."), fixes("Fixed, surely."));
  const long = Array.from({ length: 45 }, (_, i) => `line ${i + 1}`).join("\n");
  for (const output of [RED, RED, long])
    t.checks.push(() => {
      t.clock.at += 12_000;
      return { exit: 1, output, stopped: false };
    });
  const id = await launch(t, CHECKED);
  const [r, more] = await reported(t, id);
  assert.equal(more, undefined);
  assert.equal(t.posts.length, 3);
  assert.match(lastSaid(t.posts[1]), / — this is the first time\. /);
  assert.match(lastSaid(t.posts[2]), / — this is the second time\. /);
  const end = Array.from({ length: 40 }, (_, i) => `line ${i + 6}`).join("\n");
  assert.ok(
    r.text.includes(`Its report:\nFixed, surely.\n\nFilament ran its check after it reported: \`npm test\` failed (exit 1, 12 s), the third run — it went back to the worker twice, with the output each time. The end of its output:\n${end}\n\nApply it only with a reason (worker with apply_changes and reason), or follow up on it.\n\nIt worked in its own git worktree`),
    r.text,
  );
  // The apply needs a reason; reason goes with apply_changes alone.
  const call = (/** @type {any} */ input) => t.lead.tools.worker(t.lead.call({ agent_id: id, ...input }));
  const no = await call({ apply_changes: true });
  assert.equal(no.ok, false);
  assert.equal(no.text, `Nothing applied: Filament's check of builder ${id}'s change failed (\`npm test\`, exit 1). Apply it anyway with reason — why it goes in failing — or follow up on it.`);
  assert.equal(readFileSync(join(dir, "parse.js"), "utf8"), PARSE, "nothing applied");
  assert.equal(inputRefusal("worker", { agent_id: id, reason: "it is fine" })?.text, "Nothing done: reason goes with apply_changes, for a change whose check failed.");
  assert.equal(inputRefusal("worker", { agent_id: id, prompt: "Try again.", reason: "it is fine" })?.text, "Nothing done: reason goes with apply_changes, for a change whose check failed.");
  assert.equal(inputRefusal("worker", { agent_id: id, apply_changes: true, reason: "it is fine" }), null);
  // A restart keeps what Filament saw: the registry made again over the session's record still asks for the reason.
  const again = team(dir, { threads: t.threads });
  const call2 = (/** @type {any} */ input) => again.lead.tools.worker(again.lead.call({ agent_id: id, ...input }));
  assert.equal((await call2({ apply_changes: true })).text, no.text);
  const why = "the failing case is the known flaky one, tracked in #12";
  const yes = await call2({ apply_changes: true, reason: why });
  assert.equal(yes.ok, true, yes.text);
  assert.equal(yes.note, `agent: applied sub-agent ${id}'s changes (1 file) over its failed check (\`npm test\`, exit 1), for this reason: ${why}`);
  assert.equal(readFileSync(join(dir, "parse.js"), "utf8"), FIXED);
  const kept = (again.threads.get("c1") || []).find((x) => x.id === id);
  assert.deepEqual(kept.work.applied.map((/** @type {any} */ a) => [a.by, a.reason]), [["agent", why]]);
});

// (fails before: yes — reason was unknown to the worker tool)
test("worker's reason, in the words its tool gives", () => {
  assert.equal(/** @type {any} */ (WORKER_TOOL.input_schema.properties).reason.description, "With apply_changes, for a change whose check Filament saw fail: why it goes in anyway.");
});

// (fails before: no — a guard: a green check, or one Filament saw on an older change, asks no reason; and a reason goes
// with no change but one Filament saw fail, so the record never says a check failed that did not)
test("an apply needs no reason where the check passed, or where the change moved on since Filament saw it fail — and takes none there", async () => {
  const t = team(repo());
  t.runs.push(fixes("Fixed."));
  const id = await launch(t, CHECKED);
  await reported(t, id);
  const stray = await t.lead.tools.worker(t.lead.call({ agent_id: id, apply_changes: true, reason: "just in case" }));
  assert.equal(stray.text, `Nothing applied: reason goes with a change whose check Filament saw fail, or one Filament's check of the folder undid after your apply, and neither happened to builder ${id}'s change — apply it without reason.`);
  assert.equal((await t.lead.tools.worker(t.lead.call({ agent_id: id, apply_changes: true }))).ok, true);
  // Red three times, then the lead's follow-up changes the work and its check cannot run: what Filament saw was another change's.
  const u = team(repo());
  u.runs.push(fixes("Fixed."), fixes("Fixed."), fixes("Fixed."), ({ host }) => {
    writeFileSync(join(host.workdir, "notes.md"), "why\n");
    return { status: "done", report: "Added a note." };
  });
  for (let i = 0; i < 3; i++) u.checks.push(() => ({ exit: 1, output: RED, stopped: false }));
  const red = await launch(u, CHECKED);
  await reported(u, red);
  u.doc.loop.rules.push({ tool: "bash", pattern: "npm test*", verdict: "deny" });
  const f = await u.lead.tools.worker(u.lead.call({ agent_id: red, prompt: "Add a note on why." }));
  assert.equal(f.ok, true, f.text);
  await reported(u, red);
  assert.equal((await u.lead.tools.worker(u.lead.call({ agent_id: red, apply_changes: true }))).ok, true);
});

// (fails before: yes — Filament ran no check. Written in the mutation pass, which found no test of a check command that
// ends with no exit code and no stop — a shell that could not start, a test runner a signal killed: it has not passed)
test("a check that ends with no exit code and no stop is red: it goes back to the worker, and after the returns its apply needs a reason", async () => {
  const t = team(repo());
  t.runs.push(fixes("Fixed."), fixes("Fixed again."), fixes("Fixed, surely."));
  for (let i = 0; i < 3; i++)
    t.checks.push(() => {
      t.clock.at += 3_000;
      return { exit: null, output: "Killed", stopped: false };
    });
  const id = await launch(t, CHECKED);
  const [r] = await reported(t, id);
  assert.equal(t.posts.length, 3, "it went back twice");
  assert.match(lastSaid(t.posts[1]), /\n\$ npm test\nit ended without an exit code after 3 s — the end of its output:\nKilled\n\n/);
  assert.match(r.text, /Filament ran its check after it reported: `npm test` failed \(no exit code, 3 s\), the third run — it went back to the worker twice, with the output each time\. The end of its output:\nKilled\n\nApply it only with a reason/);
  const no = await t.lead.tools.worker(t.lead.call({ agent_id: id, apply_changes: true }));
  assert.equal(no.text, `Nothing applied: Filament's check of builder ${id}'s change failed (\`npm test\`, no exit code). Apply it anyway with reason — why it goes in failing — or follow up on it.`);
});

// ---- case 19: no check for a worker that failed, was stopped, or shared your folder ---------------------------------

// (fails before: no — a guard: a check runs only for the work a worker reported done, in a worktree of its own)
test("no check for a worker that failed or was stopped; one that shared your folder says so in its report", async () => {
  const t = team(repo());
  t.runs.push(() => ({ status: "failed", report: "It broke." }), () => ({ status: "stopped", report: "Stopped early.", stoppedBy: "lead" }));
  const failed = await launch(t, CHECKED);
  const [f] = await reported(t, failed);
  const stopped = await launch(t, CHECKED);
  const [s] = await reported(t, stopped);
  assert.deepEqual(t.checked, []);
  for (const r of [f, s]) assert.doesNotMatch(r.text, /Filament (ran|did not run|was running) its check/);
  const shared = team(plainFolder());
  const launched = await shared.lead.tools.agent(shared.lead.call(CHECKED));
  assert.match(launched.text, /Filament runs no check/);
  const [r] = await reported(shared, String(launched.agentId));
  assert.deepEqual(shared.checked, []);
  assert.match(r.text, /Its report:\nDone\.\n\nFilament did not run its check: the worker shared your folder, so there was no worktree of its own to run it in\./);
});

// ---- case 20: a stop ends a running check, which has no clock --------------------------------------------------------

// (fails before: yes — there was no check to stop)
test("a running check: the watch shows it with its time, no clock of Filament's ends it, and the lead's stop does — the change is unchecked, and its apply needs no reason", async () => {
  const t = team(repo());
  t.runs.push(({ host, relay }) => {
    relay({ type: "round-start", round: 4 });
    writeFileSync(join(host.workdir, "parse.js"), FIXED);
    return { status: "done", report: "Fixed it." };
  });
  /** @type {AbortSignal | null} */
  let seen = null;
  t.checks.push(
    (_c, _root, signal) =>
      new Promise((resolve) => {
        seen = signal;
        signal.addEventListener("abort", () => resolve({ exit: null, output: "PASS a\n", stopped: true }), { once: true });
      }),
  );
  const id = await launch(t, CHECKED);
  await until(() => t.checked.length === 1, "the check to start");
  t.clock.at += 40_000;
  assert.match(t.lead.tools.watch({ chainId: "c1" }).text, new RegExp(`- builder ${id} \\("Fix the parser"\\): round 4 · Filament runs its check \`npm test\` · 40 s so far`));
  assert.deepEqual(t.registry.get(id)?.progress?.check, { command: "npm test", began: 1_000_000 });
  // An hour on Filament's clock ends nothing.
  t.clock.at += 3_600_000;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(t.registry.get(id)?.status, "running");
  assert.equal(/** @type {AbortSignal | null} */ (seen)?.aborted, false);
  t.clock.at -= 3_600_000;
  const msg = await t.lead.tools.worker(t.lead.call({ agent_id: id, prompt: "Also add a test." }));
  assert.equal(msg.ok, false);
  assert.match(msg.text, /^Nothing sent: builder .* has reported, and Filament runs its check now/);
  // Nor does one message to all of a lead that reads along (TG2-D46): the worker is named, with why.
  const all = await t.lead.tools.worker({ ...t.lead.call({ agent_id: "all", prompt: "Also add a test." }), reads: true });
  assert.equal(all.ok, false);
  assert.ok(all.text.startsWith(`Nothing sent. To builder ${id}: builder ${id} has reported, and Filament runs its check now`), all.text);
  const stop = await t.lead.tools.worker(t.lead.call({ agent_id: id, stop: true }));
  assert.equal(stop.ok, true, stop.text);
  const [r] = await reported(t, id);
  assert.match(r.text, /^\[Filament: your builder sa_[0-9a-f]{8} \("Fix the parser"\) was stopped as you asked\./);
  assert.match(r.text, /Its report:\nFixed it\.\n\nFilament was running its check when it was stopped: `npm test` did not finish \(after 40 s\), so its change is unchecked\.\n\nIt worked in its own git worktree/);
  assert.equal(t.posts.length, 1, "a stopped check never goes back");
  assert.equal((await t.lead.tools.worker(t.lead.call({ agent_id: id, apply_changes: true }))).ok, true);
});

// ---- case 21: "tested" with nothing run -----------------------------------------------------------------------------

// (fails before: yes — a worker's "tests pass" reached its lead as said, though no command had run after its change)
test('"tests pass" where no command ran after the last change gets "Filament saw: …" — none when a command ran after it, and none when Filament\'s check ran', async () => {
  const t = team(repo());
  /** @param {boolean} runs @returns {Run} */
  const wrote = (runs) => ({ host, relay }) => {
    writeFileSync(join(host.workdir, "parse.js"), FIXED);
    relay({ type: "tool-start", name: "write", args: join(host.workdir, "src", "money.js"), id: "w1" });
    relay({ type: "tool-end", name: "write", id: "w1", ok: true });
    if (runs) {
      relay({ type: "tool-start", name: "bash", args: "npm test", id: "b1" });
      relay({ type: "tool-end", name: "bash", id: "b1", ok: true, exitCode: 0 });
    }
    return { status: "done", report: "Fixed the rounding; tests pass." };
  };
  t.runs.push(wrote(false), wrote(true), wrote(false));
  const plain = { ...BRIEF };
  const [a] = await reported(t, await launch(t, plain));
  assert.match(a.text, /Its report:\nFixed the rounding; tests pass\.\n\nFilament saw: it says "tests pass", and no command ran to its end after its last change \(src\/money\.js\)\.\n\nIt worked in its own git worktree/);
  const [b] = await reported(t, await launch(t, plain));
  assert.doesNotMatch(b.text, /Filament saw/);
  const [c] = await reported(t, await launch(t, CHECKED));
  assert.doesNotMatch(c.text, /Filament saw/);
  assert.match(c.text, /Filament ran its check after it reported: `npm test` passed/);
});

// ---- case 22: a rule added after the launch -------------------------------------------------------------------------

// (fails before: yes — there was no check for a rule to keep from running)
test("a deny or an ask rule added after the launch keeps the check from running, and so does a read-only session — each report says so", async () => {
  const t = team(repo());
  const cases = /** @type {const} */ ([
    [(/** @type {any} */ doc) => doc.loop.rules.push({ tool: "bash", pattern: "npm test*", verdict: "deny" }), "Filament did not run its check `npm test`: this session's rule bash(npm test*) deny refuses it."],
    [(/** @type {any} */ doc) => (doc.loop.rules = [{ tool: "bash", pattern: "npm *", verdict: "ask" }]), "Filament did not run its check `npm test`: this session's rule bash(npm *) ask asks first."],
    [(/** @type {any} */ doc) => ((doc.loop.rules = []), (doc.loop.permissions = "read-only")), "Filament did not run its check: the session is read-only."],
  ]);
  for (const [change, words] of cases) {
    t.doc.loop = { permissions: "edit", rules: [] };
    const gate = deferred();
    t.runs.push(async ({ host }) => {
      await gate.promise;
      writeFileSync(join(host.workdir, "parse.js"), FIXED);
      return { status: "done", report: "Fixed." };
    });
    const id = await launch(t, CHECKED);
    await until(() => t.registry.get(id)?.runId, "its run to attach");
    change(t.doc);
    gate.resolve();
    const [r] = await reported(t, id);
    assert.ok(r.text.includes(`Its report:\nFixed.\n\n${words}\n\nIt worked in its own git worktree`), r.text);
  }
  assert.deepEqual(t.checked, []);
});
