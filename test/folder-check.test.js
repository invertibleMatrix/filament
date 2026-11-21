// @ts-check
// HarnessV3-TaskGraph-v2 TG2-D55 (§13.17): a check after every apply of a lead's, and an undo. Once a team's lead applies
// a worker's change, Filament checks the folder in a worktree of its own made from a snapshot of it — the change's own
// check where it passed in its worktree, every command that passed in the folder's check after the lead's earlier
// applies, and the session's loop.verify.afterEdits — and reads each red command: one that guarded the folder is run on
// the snapshot from before the apply too, and one of the change's own failed where it had passed. An apply that broke
// one is undone, and the change goes back to its worker, rebased onto the folder, twice at most; a folder red already
// keeps the apply, and its lead hears both. The verdict is the apply's answer, or — past the time a call may be held —
// a message at the lead's door, which its turn owes; a lead's applies into one repository go one at a time. The
// developer's own applies are never checked or held. Cases 1 to 10 of D55's words; case 11, the version, is kept by
// prompt-version.test.js.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { sentBackWords } from "../src/app/agent/check.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import * as teamLib from "../src/ui/harness/lib/team.js";
import { createLeadTurn } from "../src/app/agent-lead.js";
import { copyState } from "./helpers/copies.js";
import { BRIEF, TEAM, deferred, leadOf } from "./helpers/team.js";
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
const SHARED = "line 1\nline 2\nline 3\n";
/** The developer's red: twelve lines of output, of which a red already quotes the last ten. */
const ALL_RED = `${Array.from({ length: 11 }, (_, i) => `ok ${i + 1}`).join("\n")}\nFAIL broken.txt`;
const BROKEN_SHARED = "line 1\nline 2 BREAK\nline 3\n";
/** A repository with an API's version and a shared file committed, and `more` in its folder, uncommitted. @param {Record<string, string>} [more] */
const repo = (more = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-folder-check-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "api.txt"), "v1\n");
  writeFileSync(join(dir, "shared.txt"), SHARED);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  for (const [f, s] of Object.entries(more)) writeFileSync(join(dir, f), s);
  return dir;
};
/** A file's text, or null where there is none. @param {string} root @param {string} f */
const read = (root, f) => {
  try {
    return readFileSync(join(root, f), "utf8");
  } catch {
    return null;
  }
};
/** @param {string} output */
const pass = (output) => ({ exit: 0, output, stopped: false });
/** @param {string} output */
const fail = (output) => ({ exit: 1, output, stopped: false });
/**
 * The commands, as the test scripts them: each reads the folder it runs in. A's test leans on shared.txt as it is; B's
 * on its own file; C's on its own file, and on the API's first version; the developer's afterEdits on no broken.txt.
 * @type {Record<string, (root: string) => { exit: number | null, output: string, stopped: boolean }>}
 */
const JUDGES = {
  "check a": (root) => (read(root, "a.txt") === "A\n" && !String(read(root, "shared.txt")).includes("BREAK") ? pass("PASS a") : fail("FAIL a: shared.txt line 2 changed")),
  "check b": (root) => (read(root, "b.txt") === "B\n" ? pass("PASS b") : fail("FAIL b")),
  "check c": (root) => (read(root, "c.txt") !== "C\n" ? fail("FAIL c: c.txt not found") : read(root, "api.txt") === "v1\n" ? pass("PASS c") : fail("FAIL c: the API's first version expected")),
  "check all": (root) => (read(root, "broken.txt") == null ? pass("all pass") : fail(ALL_RED)),
  "check never": () => fail("FAIL w"),
  // A check whose tools are in no copy of the folder (the owner's of 11-10): it fails in each, the copy's path in its words.
  "check env": (root) => (where(root) === "worktree" ? pass("PASS env") : fail(`Error: Cannot find module '${join(root, "node_modules", "typescript", "bin", "tsc")}'`)),
};

/**
 * One run of the worker's, as the test scripts it.
 * @typedef {(o: { host: any, body: any, relay: (e: any) => void }) => Promise<{ status: string, report: string }> | { status: string, report: string }} Run
 */
/**
 * A team's registry over `dir` whose host serves each run as `runs` scripts it, and whose check runs each command as
 * `judges` reads the folder it runs in — `gates`, by command, hold a run where it is a folder check's, until the test
 * lets it go. `timers`: the registry's own, which the test fires (`held`). What each run was sent, each check's command
 * and folder, and every message the lead's door took are kept. `threads` and `queues`: what the session keeps across a
 * restart — a registry made again over them is Filament after one.
 * @param {string} dir @param {{ held?: boolean, threads?: Map<string, any[]>, queues?: Map<string, any[]> }} [o]
 */
const team = (dir, { held = false, threads = new Map(), queues = new Map() } = {}) => {
  /** @type {{ body: any, host: any }[]} */
  const posts = [];
  /** @type {{ command: string, root: string }[]} */
  const checked = [];
  /** @type {Run[]} */
  const runs = [];
  /** @type {Map<string, (root: string, signal: AbortSignal) => Promise<any>>} */
  const gates = new Map();
  /** @type {{ fn: () => void, ms: number }[]} */
  const timers = [];
  const clock = { at: 1_000_000 };
  /** @type {{ subagents: any, loop: { permissions: string, rules: any[], verify: Record<string, any> } }} */
  const doc = { subagents: { pool: [{ model: "", seats: 8 }] }, loop: { permissions: "edit", rules: [], verify: {} } };
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    now: () => clock.at,
    ...(held ? { later: (/** @type {() => void} */ fn, /** @type {number} */ ms) => void timers.push({ fn, ms }) } : {}),
    runCheck: async (/** @type {string} */ command, /** @type {{ root: string, signal: AbortSignal }} */ { root, signal }) => {
      checked.push({ command, root });
      const gate = /-check$/.test(root) ? gates.get(command) : null;
      if (gate) return gate(root, signal);
      const judge = JUDGES[command];
      return judge ? judge(root) : pass("ok");
    },
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
      saveQueue: (/** @type {string} */ c, /** @type {any[]} */ list) => queues.set(c, structuredClone(list)),
      loadQueue: (/** @type {string} */ c) => structuredClone(queues.get(c) || []),
    },
    call: async ({ body, headers = {} }) => {
      const id = String(headers["x-filament-subagent"]);
      const host = registry.hostOf(id);
      posts.push({ body, host });
      const runId = `run-${posts.length}`;
      registry.attach(id, runId);
      const script = runs.shift() || /** @type {Run} */ (() => ({ status: "done", report: "Done." }));
      const end = await script({ host, body, relay: (e) => registry.relay(id, e) });
      registry.finish(id, { status: end.status, error: null, report: end.report, stoppedBy: null, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: end.report }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: end.report }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  const lead = leadOf(registry, dir);
  /** @type {any[]} */
  const taken = [];
  /** What reached the lead's door since the last take, kept. */
  const take = () => {
    const got = lead.door.inbox.take();
    taken.push(...got);
    return got;
  };
  return { dir, registry, posts, checked, runs, gates, timers, clock, doc, threads, queues, lead, take, taken };
};
/** A run that writes these files in its folder and reports. @param {Record<string, string>} files @param {string} report @returns {Run} */
const writes = (files, report) => ({ host }) => {
  for (const [f, s] of Object.entries(files)) writeFileSync(join(host.workdir, f), s);
  return { status: "done", report };
};
/** A worker launched from `brief`, its id. @param {ReturnType<typeof team>} t @param {any} brief */
const launch = async (t, brief) => {
  const r = await t.lead.tools.agent(t.lead.call({ ...BRIEF, ...brief }));
  assert.equal(r.ok, true, r.text);
  return String(r.agentId);
};
/** Its exchange's end: the reports its lead's turn took. @param {ReturnType<typeof team>} t @param {string} id */
const reported = async (t, id) => {
  await until(() => t.registry.get(id)?.status !== "running", "the worker to report", { timeoutMs: 60_000 });
  return t.take().filter((d) => d.kind === "report");
};
/** A worker launched, its run scripted, and its report taken. @param {ReturnType<typeof team>} t @param {any} brief @param {Run} run */
const reportedFrom = async (t, brief, run) => {
  t.runs.push(run);
  const id = await launch(t, brief);
  await reported(t, id);
  return id;
};
/** The lead's apply of a worker's change. @param {ReturnType<typeof team>} t @param {string} id @param {Record<string, any>} [more] */
const apply = (t, id, more = {}) => t.lead.tools.worker(t.lead.call({ agent_id: id, apply_changes: true, ...more }));
/** Where a check ran: the folder's check worktree, the one of the folder before the apply, a worker's worktree. @param {string} root */
const where = (root) => (/filament-worktrees[\\/]sa_[0-9a-f]{8}-check$/.test(root) ? "after" : /filament-worktrees[\\/]sa_[0-9a-f]{8}-before$/.test(root) ? "before" : "worktree");
/** The folder checks since the nth check: each command with where it ran. @param {ReturnType<typeof team>} t @param {number} from */
const folderRuns = (t, from) => t.checked.slice(from).filter((c) => where(c.root) !== "worktree").map((c) => [c.command, where(c.root)]);
/** The newest user words a run was sent. @param {{ body: any }} p */
const lastSaid = (p) => String(p.body.messages.at(-1).content.at(-1).text);
const A = { description: "Write a", check: ["check a"] };
const B = { description: "Write b", check: ["check b"] };
const writesA = writes({ "a.txt": "A\n" }, "Wrote a.txt.");
const writesB = writes({ "b.txt": "B\n", "shared.txt": BROKEN_SHARED }, "Wrote b.txt.");

// ---- case 1: green ----------------------------------------------------------------------------------------------------

// (fails before: yes — nothing checked the folder after an apply: its answer named the files alone, and the folder's
// state after it was nobody's to know)
test("a lead's apply: Filament checks the folder in a worktree of its own, after the apply, and the answer says each command passed — the next apply runs its own check and the ones that passed before, each once", async () => {
  const t = team(repo());
  const a = await reportedFrom(t, A, writesA);
  const n = t.checked.length;
  const r = await apply(t, a);
  assert.equal(r.ok, true, r.text);
  assert.equal(r.text, `Applied the changes of sub-agent ${a} to your folder: 1 file (+1 −0) — a.txt. Filament's check of the folder with them passed: \`check a\` passed (exit 0, 1 s).`);
  assert.equal(r.note, `agent: applied sub-agent ${a}'s changes (1 file) — the folder's check passed`);
  assert.deepEqual(folderRuns(t, n), [["check a", "after"]]);
  // Its worktree held the folder with the change in it, given back free; the developer's folder has the change.
  const root = /** @type {{ root: string }} */ (t.checked.at(-1)).root;
  assert.equal(copyState(root), "free", "the check's copy is given back");
  assert.equal(read(t.dir, "a.txt"), "A\n");
  // The next apply: its own check first, then the folder's, each once — B's own names A's too.
  const b = await reportedFrom(t, { description: "Write b", check: ["check b", "check a"] }, writes({ "b.txt": "B\n" }, "Wrote b.txt."));
  const m = t.checked.length;
  const r2 = await apply(t, b);
  assert.equal(r2.text, `Applied the changes of sub-agent ${b} to your folder: 1 file (+1 −0) — b.txt. Filament's check of the folder with them passed: \`check b\` passed (exit 0, 1 s) and \`check a\` passed (exit 0, 1 s).`);
  assert.deepEqual(folderRuns(t, m), [["check b", "after"], ["check a", "after"]]);
  // A verdict its call heard is said there alone: none comes again at the lead's door.
  assert.deepEqual(t.take().filter((d) => d.kind === "check"), []);
});

// ---- case 2: an apply that breaks the folder's check ------------------------------------------------------------------

// (fails before: yes — B's change went in and stayed: A's test failed in the folder, and nobody heard of it)
test("an apply that turns a check of the folder red, green before it: undone, the folder as it was; the change waits again rebased onto the folder and goes back to its worker, whose check now holds that command — its fix goes in green", async () => {
  const t = team(repo());
  const a = await reportedFrom(t, A, writesA);
  assert.equal((await apply(t, a)).ok, true);
  const b = await reportedFrom(t, B, writesB);
  const gate = deferred();
  t.runs.push(async ({ host }) => {
    await gate.promise;
    writeFileSync(join(host.workdir, "shared.txt"), SHARED);
    return { status: "done", report: "Kept shared.txt as it was." };
  });
  const n = t.checked.length;
  const r = await apply(t, b);
  assert.equal(r.ok, false);
  assert.equal(
    r.text,
    `Not kept: with sub-agent ${b}'s change your folder's check fails, and without it the check passes — \`check a\` failed (exit 1, 1 s). Filament undid the apply: your folder is as it was before it. The change went back to its worker with the output (the first time), its worktree rebased onto your folder; its report comes again as a message. If it is the check that is wrong — flaky, say — apply the change with reason once it reports. The end of its output:\nFAIL a: shared.txt line 2 changed`,
  );
  assert.equal(r.note, `agent: sub-agent ${b}'s changes undone — \`check a\` failed with them and passed without (sent back, 1 of 2)`);
  // Its own check passed; A's failed with it, and passed on the folder from before it.
  assert.deepEqual(folderRuns(t, n), [["check b", "after"], ["check a", "after"], ["check a", "before"]]);
  // The folder as it was before the apply: A's change in it, B's not.
  assert.equal(read(t.dir, "b.txt"), null);
  assert.equal(read(t.dir, "shared.txt"), SHARED);
  assert.equal(read(t.dir, "a.txt"), "A\n");
  // It went back: its worktree holds the folder with its change in it, and the note gives the command and its output.
  await until(() => t.posts.length === 3, "the worker to be sent back");
  const wd = String(t.posts[2].host.workdir);
  assert.deepEqual([read(wd, "a.txt"), read(wd, "b.txt"), read(wd, "shared.txt")], ["A\n", "B\n", BROKEN_SHARED]);
  assert.equal(
    lastSaid(t.posts[2]),
    "[Filament: your lead applied your change to the developer's folder, and the folder's check failed with it: `check a` passes without your change and fails with it. The apply was undone. Your worktree now holds the developer's folder with your change in it, so the command fails here as it did there; Filament runs it again when you report. Make your change pass with the rest of the folder, never by weakening the check, run it yourself, and report again. This is the first time Filament sent your change back for the folder's check; after the second, your lead decides.\n\n$ check a\nexit 1 after 1 s — the end of its output:\nFAIL a: shared.txt line 2 changed]",
  );
  assert.ok(t.posts[2].body.messages.some((/** @type {any} */ m) => m.role === "assistant" && JSON.stringify(m.content).includes("Wrote b.txt.")), "it goes on in the context it has");
  assert.match(t.lead.tools.watch({ chainId: "c1" }).text, /sent back by Filament: the folder's check `check a` failed with its change \(first time\)/);
  // Its fix: its check runs the folder's command too, in its worktree, before its lead hears.
  const before = t.checked.length;
  gate.resolve();
  const [rep] = await reported(t, b);
  assert.deepEqual(t.checked.slice(before).map((c) => [c.command, where(c.root)]), [["check b", "worktree"], ["check a", "worktree"]]);
  assert.match(rep.text, /Its report:\nKept shared\.txt as it was\.\n\nFilament ran its check after it reported: `check b` passed \(exit 0, 1 s\) and `check a` passed \(exit 0, 1 s\)\./);
  assert.match(rep.text, /You asked it:\nYour task: Write b\n/, "the report answers its brief, never Filament's note");
  // What waits is its change as it goes in now — against the folder before the apply.
  const change = /** @type {any} */ (await t.registry.changes(b, "c1"));
  assert.deepEqual(change.files.map((/** @type {any} */ f) => f.path), ["b.txt"]);
  const m = t.checked.length;
  const again = await apply(t, b);
  assert.equal(again.ok, true, again.text);
  assert.match(again.text, /Filament's check of the folder with them passed: `check b` passed \(exit 0, 1 s\) and `check a` passed \(exit 0, 1 s\)\.$/);
  assert.deepEqual(folderRuns(t, m), [["check b", "after"], ["check a", "after"]]);
  assert.deepEqual([read(t.dir, "b.txt"), read(t.dir, "shared.txt")], ["B\n", SHARED]);
});

// (fails before: yes — the same; and a reason went only with a change whose own check Filament saw fail)
test("twice at most: the third undo leaves the change waiting for its lead, whose apply then needs a reason — with it the apply stands red, the reason kept, and the command no longer guards the folder", async () => {
  const t = team(repo());
  // A command that passes everywhere but in the folder's check: the folder's own flake. `check q` passes everywhere.
  t.gates.set("check z", async () => fail("FAIL z in the folder"));
  const z = await reportedFrom(t, { description: "Write z", check: ["check z", "check q"] }, writes({ "z.txt": "Z\n" }, "Wrote z.txt."));
  t.runs.push(writes({ "z.txt": "Z\n" }, "Checked z.txt."), writes({ "z.txt": "Z\n" }, "Checked z.txt again."));
  const first = await apply(t, z);
  assert.match(first.text, /\(the first time\)/);
  await reported(t, z);
  const second = await apply(t, z);
  assert.match(second.text, /The change went back to its worker with the output \(the second time\), its worktree rebased onto your folder; its report comes again as a message\./);
  await until(() => t.posts.length === 3, "the worker to be sent back again");
  assert.match(lastSaid(t.posts[2]), /This is the second time Filament sent your change back for the folder's check; after the second, your lead decides\./);
  await reported(t, z);
  const third = await apply(t, z);
  assert.equal(third.ok, false);
  assert.equal(
    third.text,
    `Not kept: sub-agent ${z}'s change does not pass its own check in your folder — \`check z\` passed in its worktree, and fails with the rest of your folder (exit 1, 1 s). Filament undid the apply: your folder is as it was before it. The change went back to its worker twice already, so it waits now, rebased onto your folder. Follow it up with worker; apply it anyway with reason, why it goes in though the folder's check fails; or leave it, and tell the developer. The end of its output:\nFAIL z in the folder`,
  );
  assert.equal(third.note, `agent: sub-agent ${z}'s changes undone — its own check \`check z\` failed in the folder (not sent back: it went back twice already)`);
  assert.equal(t.posts.length, 3, "not sent back a third time");
  assert.equal(read(t.dir, "z.txt"), null);
  // Its apply now needs a reason, which the record keeps.
  const no = await apply(t, z);
  assert.equal(no.ok, false);
  assert.equal(no.text, `Nothing applied: Filament's check of the folder failed with builder ${z}'s change (\`check z\`, exit 1), and the apply was undone. Apply it anyway with reason — why it goes in though the folder's check fails — or follow up on it.`);
  const why = "the folder's runner is flaky on z, tracked in #31";
  const atYes = t.checked.length;
  const yes = await apply(t, z, { reason: why });
  assert.equal(yes.ok, true, yes.text);
  // Its own check passed on the work before the undo, not on the change as it waits now: the command that failed runs
  // alone.
  assert.deepEqual(folderRuns(t, atYes), [["check z", "after"]]);
  assert.equal(yes.text, `Applied the changes of sub-agent ${z} to your folder: 1 file (+1 −0) — z.txt. Filament's check of the folder fails with them — \`check z\` failed (exit 1, 1 s) — and they stand, for your reason. The end of its output:\nFAIL z in the folder`);
  assert.equal(yes.note, `agent: applied sub-agent ${z}'s changes (1 file) over the folder's failed check (\`check z\`, exit 1), for this reason: ${why}`);
  assert.equal(read(t.dir, "z.txt"), "Z\n");
  const kept = (t.threads.get("c1") || []).find((x) => x.id === z);
  assert.deepEqual(kept.work.applied.map((/** @type {any} */ x) => [x.by, x.reason]), [["agent", why]], "the undone applies are not kept as applies");
  // It no longer guards the folder: the next apply runs its own check alone.
  const y = await reportedFrom(t, { description: "Write y", check: ["check y"] }, writes({ "y.txt": "Y\n" }, "Wrote y.txt."));
  const m = t.checked.length;
  assert.equal((await apply(t, y)).ok, true);
  assert.deepEqual(folderRuns(t, m), [["check y", "after"]]);
});

// (fails before: yes — whether its own check passed "on that work" went by the id of the folder's snapshot alone, and
// two snapshots of one folder in one second are one commit: with git's clock held still, the pass before the third undo
// counted for the change as it waited, and `check q` ran beside `check z`. Seen once in a whole-suite run)
test("an undone change is checked by none, whatever id its snapshot came to: with git's clock held still, the apply with a reason still runs the failed command alone", async () => {
  const CLOCK = ["GIT_AUTHOR_DATE", "GIT_COMMITTER_DATE"];
  const was = CLOCK.map((k) => process.env[k]);
  for (const k of CLOCK) process.env[k] = "@1767225600 +0000";
  try {
    const t = team(repo());
    t.gates.set("check z", async () => fail("FAIL z in the folder"));
    const z = await reportedFrom(t, { description: "Write z", check: ["check z", "check q"] }, writes({ "z.txt": "Z\n" }, "Wrote z.txt."));
    t.runs.push(writes({ "z.txt": "Z\n" }, "Checked z.txt."), writes({ "z.txt": "Z\n" }, "Checked z.txt again."));
    assert.match((await apply(t, z)).text, /\(the first time\)/);
    await reported(t, z);
    assert.match((await apply(t, z)).text, /\(the second time\)/);
    await until(() => t.posts.length === 3, "the worker to be sent back again");
    await reported(t, z);
    assert.equal((await apply(t, z)).ok, false, "undone a third time: it waits for its lead");
    const atYes = t.checked.length;
    const yes = await apply(t, z, { reason: "the folder's runner is flaky on z" });
    assert.equal(yes.ok, true, yes.text);
    assert.deepEqual(folderRuns(t, atYes), [["check z", "after"]], "its own check saw the work before the undo, not the change as it waits");
  } finally {
    CLOCK.forEach((k, i) => (was[i] === undefined ? delete process.env[k] : (process.env[k] = was[i])));
  }
});

// (fails before: yes — a reason went in only once the change waited unsent, after its third undo: a lead that judged the
// folder's check flaky had first to send its worker back twice, and the refusal's words named its own check alone; the
// drive's finding)
test("a reason after an undo: once the change reports again, its lead may apply it with a reason, which stands over the folder's red — a reason where nothing failed is refused, in words that name both checks", async () => {
  const t = team(repo());
  // The folder's flake: red wherever Filament checks the folder after an apply, green everywhere else.
  t.doc.loop.verify.afterEdits = "check flaky";
  t.gates.set("check flaky", async () => fail("FAIL flaky: the stock service did not answer"));
  const w = await reportedFrom(t, { description: "Write w", check: ["check w"] }, writes({ "w.txt": "W\n" }, "Wrote w.txt."));
  const early = await apply(t, w, { reason: "the folder's check is flaky" });
  assert.equal(early.ok, false);
  assert.equal(early.text, `Nothing applied: reason goes with a change whose check Filament saw fail, or one Filament's check of the folder undid after your apply, and neither happened to builder ${w}'s change — apply it without reason.`);
  t.runs.push(writes({ "w.txt": "W\n" }, "Nothing of mine fails it."));
  const first = await apply(t, w);
  assert.equal(first.ok, false);
  assert.match(first.text, /its report comes again as a message\. If it is the check that is wrong — flaky, say — apply the change with reason once it reports\./);
  await reported(t, w);
  // Back from its worker, the change waits with its own check green: the lead's reason carries it over the folder's red.
  const why = "the stock service the folder's check calls is down, not this change";
  const m = t.checked.length;
  const yes = await apply(t, w, { reason: why });
  assert.equal(yes.ok, true, yes.text);
  assert.equal(yes.text, `Applied the changes of sub-agent ${w} to your folder: 1 file (+1 −0) — w.txt. Filament's check of the folder fails with them — \`check flaky\` failed (exit 1, 1 s) — and they stand, for your reason. The end of its output:\nFAIL flaky: the stock service did not answer`);
  assert.equal(yes.note, `agent: applied sub-agent ${w}'s changes (1 file) over the folder's failed check (\`check flaky\`, exit 1), for this reason: ${why}`);
  assert.deepEqual(folderRuns(t, m), [["check w", "after"], ["check flaky", "after"]]);
  assert.equal(read(t.dir, "w.txt"), "W\n");
  const kept = (t.threads.get("c1") || []).find((x) => x.id === w);
  assert.deepEqual(kept.work.applied.map((/** @type {any} */ x) => [x.by, x.reason]), [["agent", why]]);
  // It stood, so the undo is over: its next change's reason needs a failed check again.
  t.runs.push(writes({ "w2.txt": "W2\n" }, "Wrote w2.txt."));
  const r = await t.lead.tools.worker(t.lead.call({ agent_id: w, prompt: "Write w2.txt too." }));
  assert.equal(r.ok, true, r.text);
  await reported(t, w);
  delete t.doc.loop.verify.afterEdits;
  assert.match((await apply(t, w, { reason: why })).text, /^Nothing applied: reason goes with a change whose check Filament saw fail, or one Filament's check of the folder undid after your apply, and neither happened/);
});

// (fails before: yes — the same: and the undo's red was the registry's alone, gone with a restart)
test("an undo's red outlives a restart: back from its worker, the change still goes in with its lead's reason", async () => {
  const t = team(repo());
  t.doc.loop.verify.afterEdits = "check flaky";
  t.gates.set("check flaky", async () => fail("FAIL flaky: the stock service did not answer"));
  const w = await reportedFrom(t, { description: "Write w", check: ["check w"] }, writes({ "w.txt": "W\n" }, "Wrote w.txt."));
  t.runs.push(writes({ "w.txt": "W\n" }, "Nothing of mine fails it."));
  assert.equal((await apply(t, w)).ok, false);
  await reported(t, w);
  // Filament restarts before its lead applies it again.
  const again = team(t.dir, { threads: t.threads, queues: t.queues });
  again.doc.loop.verify.afterEdits = "check flaky";
  again.gates.set("check flaky", async () => fail("FAIL flaky: the stock service did not answer"));
  const yes = await apply(again, w, { reason: "the stock service is down, not this change" });
  assert.equal(yes.ok, true, yes.text);
  assert.match(yes.text, /— and they stand, for your reason\./);
  assert.equal(read(t.dir, "w.txt"), "W\n");
});

// ---- case 3: the change's own check fails in the folder ---------------------------------------------------------------

// (fails before: yes — C's change went in over A's new API, and its own test failed in the folder unseen)
test("a change whose own check passed in its worktree and fails with the rest of the folder is undone — though that check fails before the apply too, which the words say", async () => {
  const t = team(repo());
  // C starts on the API's first version, and A moves it on before C's change goes in.
  const c = await reportedFrom(t, { description: "Write c", check: ["check c"] }, writes({ "c.txt": "C\n" }, "Wrote c.txt."));
  const a = await reportedFrom(t, A, writes({ "a.txt": "A\n", "api.txt": "v2\n" }, "Moved the API on."));
  assert.equal((await apply(t, a)).ok, true);
  t.runs.push(() => ({ status: "failed", report: "Cannot do it on v2." }));
  const n = t.checked.length;
  const r = await apply(t, c);
  assert.equal(r.ok, false);
  assert.ok(
    r.text.startsWith(`Not kept: sub-agent ${c}'s change does not pass its own check in your folder — \`check c\` passed in its worktree, and fails with the rest of your folder (exit 1, 1 s), and without the change too. Filament undid the apply: your folder is as it was before it. The change went back to its worker with the output (the first time)`),
    r.text,
  );
  // Its own failed with the change and without it; the folder's own were never run past it.
  assert.deepEqual(folderRuns(t, n), [["check c", "after"], ["check c", "before"]]);
  assert.equal(read(t.dir, "c.txt"), null);
  await until(() => t.posts.length === 3, "the worker to be sent back");
  assert.ok(lastSaid(t.posts[2]).startsWith("[Filament: your lead applied your change to the developer's folder, and the folder's check failed with it: your brief's check `check c` passed in your worktree, and fails with the rest of the folder, and without your change too. The apply was undone."), lastSaid(t.posts[2]));
  assert.equal(read(String(t.posts[2].host.workdir), "api.txt"), "v2\n", "its worktree holds the folder as it stands");
  await reported(t, c);
});

// (fails before: yes — the owner's of 11-10: a check that failed in every copy of the folder alike undid the apply and
// sent the change back, the environment's failure read as the change's)
test("a change whose own check fails the same way with it and without it keeps the apply: nothing goes back, and its lead hears the environment's failure with the output", async () => {
  const t = team(repo());
  const e = await reportedFrom(t, { description: "Write e", check: ["check env"] }, writes({ "e.txt": "E\n" }, "Wrote e.txt."));
  const n = t.checked.length;
  const r = await apply(t, e);
  assert.equal(r.ok, true, r.text);
  assert.match(r.text, /Filament's check of the folder fails with them, and failed before them too: `check env` failed \(exit 1, 1 s\)\. Your folder was red on it already, so the apply stands\. Its own check `check env` passed in its worktree, and fails the same way with them and without them: the failure is the environment's — your folder's, or what its checks run with, a missing dependency folder say — not the change's, so it did not go back to its worker\. The end of its output:\nError: Cannot find module '.*tsc'\n\[Filament: no dependency folder is linked into this copy of your folder/);
  assert.deepEqual(folderRuns(t, n), [["check env", "after"], ["check env", "before"]]);
  assert.equal(read(t.dir, "e.txt"), "E\n", "the change stays in the folder");
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(t.posts.length, 1, "nothing went back to its worker");
});

// ---- case 4: a folder red already ------------------------------------------------------------------------------------

// (fails before: yes — the same: nothing checked the folder, and its red was the developer's to find)
test("a folder red on a check before the apply too keeps the apply, and its lead hears both — afterEdits is one of the checks, and a kept command red already leaves the folder's list", async () => {
  const t = team(repo({ "broken.txt": "the developer's red\n" }));
  t.doc.loop.verify.afterEdits = "check all";
  const a = await reportedFrom(t, A, writesA);
  const n = t.checked.length;
  const r = await apply(t, a);
  assert.equal(r.ok, true, r.text);
  assert.equal(
    r.text,
    `Applied the changes of sub-agent ${a} to your folder: 1 file (+1 −0) — a.txt. Filament's check of the folder fails with them, and failed before them too: \`check all\` failed (exit 1, 1 s). Your folder was red on it already, so the apply stands. The end of its output:\n${ALL_RED.split("\n").slice(-10).join("\n")}`,
  );
  assert.equal(r.note, `agent: applied sub-agent ${a}'s changes (1 file) — the folder was red on \`check all\` already: it stands`);
  assert.deepEqual(folderRuns(t, n), [["check a", "after"], ["check all", "after"], ["check all", "before"]]);
  assert.equal(read(t.dir, "a.txt"), "A\n");
  // The developer breaks A's test themselves; the next apply finds it red before too, and it guards no more.
  delete t.doc.loop.verify.afterEdits;
  writeFileSync(join(t.dir, "shared.txt"), BROKEN_SHARED);
  const d = await reportedFrom(t, { description: "Write d" }, writes({ "d.txt": "D\n" }, "Wrote d.txt."));
  const m = t.checked.length;
  const r2 = await apply(t, d);
  assert.match(r2.text, /Filament's check of the folder fails with them, and failed before them too: `check a` failed \(exit 1, 1 s\)\. Your folder was red on it already, so the apply stands\./);
  assert.deepEqual(folderRuns(t, m), [["check a", "after"], ["check a", "before"]]);
  const e = await reportedFrom(t, { description: "Write e" }, writes({ "e.txt": "E\n" }, "Wrote e.txt."));
  const k = t.checked.length;
  const r3 = await apply(t, e);
  assert.equal(r3.text, `Applied the changes of sub-agent ${e} to your folder: 1 file (+1 −0) — e.txt.`, "no check to run: the words of an apply as they were");
  assert.deepEqual(folderRuns(t, k), []);
  // afterEdits is the session's, read at each apply: it passes once the developer fixed their red, and once they unset
  // it, it runs no more — it never joins the folder's list.
  rmSync(join(t.dir, "broken.txt"));
  t.doc.loop.verify.afterEdits = "check all";
  const f = await reportedFrom(t, { description: "Write f" }, writes({ "f.txt": "F\n" }, "Wrote f.txt."));
  const p = t.checked.length;
  assert.match((await apply(t, f)).text, /Filament's check of the folder with them passed: `check all` passed \(exit 0, 1 s\)\.$/);
  assert.deepEqual(folderRuns(t, p), [["check all", "after"]]);
  delete t.doc.loop.verify.afterEdits;
  const g = await reportedFrom(t, { description: "Write g" }, writes({ "g.txt": "G\n" }, "Wrote g.txt."));
  const j = t.checked.length;
  assert.equal((await apply(t, g)).text, `Applied the changes of sub-agent ${g} to your folder: 1 file (+1 −0) — g.txt.`);
  assert.deepEqual(folderRuns(t, j), []);
});

// ---- case 5: an undo that cannot go back cleanly ----------------------------------------------------------------------

// (fails before: yes — there was no undo)
test("an undo the folder's own change since keeps from going back cleanly leaves the apply standing, red, and says the files", async () => {
  const t = team(repo());
  const a = await reportedFrom(t, A, writesA);
  assert.equal((await apply(t, a)).ok, true);
  const b = await reportedFrom(t, B, writesB);
  // While Filament checks the folder, the developer edits the line B changed.
  t.gates.set("check a", async (root) => {
    writeFileSync(join(t.dir, "shared.txt"), "line 1\nline 2 DEV\nline 3\n");
    return JUDGES["check a"](root);
  });
  const r = await apply(t, b);
  assert.equal(r.ok, true, r.text);
  assert.equal(
    r.text,
    `Applied, and not undone: with sub-agent ${b}'s change your folder's check fails, and without it the check passes — \`check a\` failed (exit 1, 1 s). Filament could not undo the apply cleanly, since your folder changed there after it: shared.txt: 1 change overlaps yours. It stands, red. The end of its output:\nFAIL a: shared.txt line 2 changed`,
  );
  assert.equal(r.note, `agent: applied sub-agent ${b}'s changes (2 files) — \`check a\` failed with them, and the undo did not come through cleanly: it stands`);
  assert.deepEqual([read(t.dir, "b.txt"), read(t.dir, "shared.txt")], ["B\n", "line 1\nline 2 DEV\nline 3\n"]);
  assert.equal(t.posts.length, 2, "nothing went back");
});

// ---- case 6: which commands ------------------------------------------------------------------------------------------

// (fails before: yes — the same)
test("which commands: a change's own only where its check passed on that work; a rule that refuses one keeps it from running, said; none at all, the words as they were; the developer's apply is never checked", async () => {
  const t = team(repo());
  // W's own check failed in its worktree three times: it goes in with a reason, and its check is not the folder's.
  for (let i = 0; i < 3; i++) t.runs.push(writes({ "w.txt": "W\n" }, "Wrote w.txt."));
  const w = await launch(t, { description: "Write w", check: ["check never"] });
  await reported(t, w);
  const n = t.checked.length;
  const r = await apply(t, w, { reason: "the test is wrong" });
  assert.equal(r.text, `Applied the changes of sub-agent ${w} to your folder: 1 file (+1 −0) — w.txt.`);
  assert.equal(r.note, `agent: applied sub-agent ${w}'s changes (1 file) over its failed check (\`check never\`, exit 1), for this reason: the test is wrong`);
  assert.deepEqual(folderRuns(t, n), []);
  // A's check passes and guards the folder; a deny rule on it keeps it from running, and the rest runs.
  const a = await reportedFrom(t, A, writesA);
  assert.equal((await apply(t, a)).ok, true);
  t.doc.loop.rules = [{ tool: "bash", pattern: "check a", verdict: "deny" }];
  const b = await reportedFrom(t, B, writes({ "b.txt": "B\n" }, "Wrote b.txt."));
  const m = t.checked.length;
  const r2 = await apply(t, b);
  assert.equal(r2.text, `Applied the changes of sub-agent ${b} to your folder: 1 file (+1 −0) — b.txt. Filament's check of the folder with them passed: \`check b\` passed (exit 0, 1 s). It did not run \`check a\`: this session's rule bash(check a) deny refuses it.`);
  assert.deepEqual(folderRuns(t, m), [["check b", "after"]]);
  // Every command refused, or asked for first: no check, said.
  t.doc.loop.rules = [{ tool: "bash", pattern: "check *", verdict: "ask" }];
  const c = await reportedFrom(t, { description: "Write c2" }, writes({ "c2.txt": "C\n" }, "Wrote c2.txt."));
  const k = t.checked.length;
  const r3 = await apply(t, c);
  assert.equal(r3.text, `Applied the changes of sub-agent ${c} to your folder: 1 file (+1 −0) — c2.txt. Filament did not check the folder with them: this session's rule bash(check *) ask asks first for \`check a\`.`);
  assert.deepEqual(folderRuns(t, k), []);
  // The developer's own apply and the session agent's go in unchecked, as before.
  t.doc.loop.rules = [];
  const d = await reportedFrom(t, { description: "Write d" }, writes({ "d.txt": "D\n", "shared.txt": BROKEN_SHARED }, "Wrote d.txt."));
  const j = t.checked.length;
  const own = await t.registry.apply(d, "c1", "owner");
  assert.equal(own.ok, true);
  assert.equal("check" in own, false);
  assert.deepEqual(folderRuns(t, j), []);
  assert.equal(read(t.dir, "shared.txt"), BROKEN_SHARED, "the developer's apply stands");
});

// ---- case 7: a verdict later than a call may wait ---------------------------------------------------------------------

// (fails before: yes — an apply's call answered at once with nothing more to come)
test("a check past the time a call may be held: the call says it runs, its verdict reaches the lead's door once, as a message, and the turn owes it", async () => {
  const t = team(repo(), { held: true });
  const a = await reportedFrom(t, A, writesA);
  const gate = deferred();
  t.gates.set("check a", async (root) => {
    await gate.promise;
    return JUDGES["check a"](root);
  });
  const call = apply(t, a);
  await until(() => t.checked.some((c) => where(c.root) === "after"), "the folder's check to start");
  t.clock.at += 45_000;
  const hold = t.timers.filter((x) => x.ms === 45_000);
  assert.equal(hold.length, 1, "one hold, of 45 s");
  hold[0].fn();
  const r = await call;
  assert.equal(r.ok, true, r.text);
  assert.equal(r.text, `Applied the changes of sub-agent ${a} to your folder: 1 file (+1 −0) — a.txt. Filament checks the folder with them now (\`check a\`, 45 s so far), and undoes the apply if they break it: what comes of it reaches you as a message.`);
  assert.equal(r.note, `agent: applied sub-agent ${a}'s changes (1 file) — the folder's check still runs`);
  const owed = t.lead.door.inbox.owed();
  assert.ok(owed, "the turn owes the verdict");
  assert.equal(await Promise.race([owed, Promise.resolve("pending")]), "pending");
  assert.deepEqual(t.take(), []);
  gate.resolve();
  await owed;
  const got = t.take();
  assert.deepEqual(got.map((d) => d.kind), ["check"]);
  assert.equal(got[0].text, `[Filament: what came of your apply of builder ${a} ("Write a"): Applied the changes of sub-agent ${a} to your folder: 1 file (+1 −0) — a.txt. Filament's check of the folder with them passed: \`check a\` passed (exit 0, 45 s).]`);
  assert.deepEqual(t.take(), [], "said once");
});

// (fails before: yes — the same)
test("a turn that ends ends a check still running: the apply stands unchecked, and the session's next turn hears it", async () => {
  const t = team(repo(), { held: true });
  const a = await reportedFrom(t, A, writesA);
  t.gates.set("check a", (_root, signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ exit: null, output: "", stopped: true }), { once: true })));
  const call = apply(t, a);
  await until(() => t.checked.some((c) => where(c.root) === "after"), "the folder's check to start");
  /** @type {any} */ (t.timers.find((x) => x.ms === 45_000)).fn();
  assert.equal((await call).ok, true);
  t.lead.door.close();
  await until(() => t.registry.peekQueued("c1").some((d) => d.kind === "check"), "the verdict to wait for the next turn");
  const q = t.registry.peekQueued("c1").filter((d) => d.kind === "check");
  assert.equal(q.length, 1);
  assert.equal(q[0].text, `[Filament: what came of your apply of builder ${a} ("Write a"): Applied the changes of sub-agent ${a} to your folder: 1 file (+1 −0) — a.txt. Filament's check of the folder with them was cut before it finished: the apply stands, unchecked.]`);
  assert.equal(read(t.dir, "a.txt"), "A\n");
  // Filament restarts before the session's next turn: that turn hears it all the same.
  const again = team(t.dir, { threads: t.threads, queues: t.queues });
  assert.deepEqual(again.take().filter((d) => d.kind === "check").map((d) => d.text), [q[0].text]);
});

// (fails before: yes — the same)
test("Filament stopping ends a check still running too: the apply stands unchecked, kept for the session's next turn", async () => {
  const t = team(repo(), { held: true });
  const a = await reportedFrom(t, A, writesA);
  t.gates.set("check a", (_root, signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ exit: null, output: "", stopped: true }), { once: true })));
  const call = apply(t, a);
  await until(() => t.checked.some((c) => where(c.root) === "after"), "the folder's check to start");
  /** @type {any} */ (t.timers.find((x) => x.ms === 45_000)).fn();
  assert.equal((await call).ok, true);
  t.registry.shutdown();
  await until(() => (t.queues.get("c1") || []).some((d) => d.kind === "check"), "the verdict kept for the next turn");
  const kept = (t.queues.get("c1") || []).filter((d) => d.kind === "check");
  assert.deepEqual(kept.map((d) => d.text), [`[Filament: what came of your apply of builder ${a} ("Write a"): Applied the changes of sub-agent ${a} to your folder: 1 file (+1 −0) — a.txt. Filament's check of the folder with them was cut before it finished: the apply stands, unchecked.]`]);
  assert.deepEqual(t.take(), [], "no turn takes a message while Filament stops");
  assert.equal(read(t.dir, "a.txt"), "A\n");
});

// (fails before: yes — a coding agent's apply answered at once, unchecked)
test("a coding agent's lead: its apply waits for the folder's check as long as its call may run, less the margin", async () => {
  const t = team(repo(), { held: true });
  const a = await reportedFrom(t, A, writesA);
  const gate = deferred();
  t.gates.set("check a", async (root) => {
    await gate.promise;
    return JUDGES["check a"](root);
  });
  const lead = createLeadTurn({ registry: t.registry, door: /** @type {any} */ (t.lead.door), chainId: "c1", runId: "lead-1", cwd: t.dir, model: "m-lead", team: TEAM, emit: () => {}, note: () => {}, mailbox: () => null, signal: new AbortController().signal });
  const call = lead.call("worker", { agent_id: a, apply_changes: true }, { patienceMs: 20_000 });
  await until(() => t.checked.some((c) => where(c.root) === "after"), "the folder's check to start");
  assert.deepEqual(t.timers.filter((x) => x.ms >= 10_000).map((x) => x.ms), [15_000], "its 20 s less the 5 s margin");
  /** @type {any} */ (t.timers.find((x) => x.ms === 15_000)).fn();
  assert.match((await call).text, /Filament checks the folder with them now \(`check a`, /);
  gate.resolve();
  await until(() => (t.take(), t.taken.some((d) => d.kind === "check")), "the verdict at the door");
});

// ---- case 8: one at a time ---------------------------------------------------------------------------------------------

// (fails before: yes — two applies went in side by side, each unchecked)
test("a lead's second apply into the folder waits for the verdict on the first, and says so; the developer's apply meanwhile never waits", async () => {
  const t = team(repo(), { held: true });
  const a = await reportedFrom(t, A, writesA);
  const b = await reportedFrom(t, B, writes({ "b.txt": "B\n" }, "Wrote b.txt."));
  const c = await reportedFrom(t, { description: "Write c" }, writes({ "c.txt": "C\n" }, "Wrote c.txt."));
  const gate = deferred();
  t.gates.set("check a", async (root) => {
    await gate.promise;
    return JUDGES["check a"](root);
  });
  const first = apply(t, a);
  await until(() => t.checked.some((x) => where(x.root) === "after"), "the folder's check to start");
  const second = apply(t, b);
  await until(() => t.timers.filter((x) => x.ms === 45_000).length === 2, "both holds");
  for (const x of t.timers.filter((x) => x.ms === 45_000)) x.fn();
  assert.match((await first).text, /Filament checks the folder with them now/);
  const r2 = await second;
  assert.equal(r2.ok, true, r2.text);
  assert.equal(r2.text, `Not applied yet: Filament is still checking your folder with sub-agent ${a}'s change, applied before this one. Sub-agent ${b}'s goes in once that check has its verdict, and what comes of it reaches you as a message.`);
  assert.equal(r2.note, `agent: sub-agent ${b}'s changes wait to be applied, behind the folder's check of ${a}'s`);
  assert.equal(read(t.dir, "b.txt"), null);
  // The developer's apply goes in at once.
  const own = await t.registry.apply(c, "c1", "owner");
  assert.equal(own.ok, true);
  assert.equal(read(t.dir, "c.txt"), "C\n");
  gate.resolve();
  await until(() => (t.take(), t.taken.filter((d) => d.kind === "check").length >= 2), "both verdicts", { timeoutMs: 60_000 });
  const said = t.taken.filter((d) => d.kind === "check").map((d) => d.text);
  assert.equal(said.length, 2);
  assert.ok(said[0].startsWith(`[Filament: what came of your apply of builder ${a} ("Write a"): Applied`), said[0]);
  assert.ok(said[1].startsWith(`[Filament: what came of your apply of builder ${b} ("Write b"): Applied the changes of sub-agent ${b} to your folder: 1 file (+1 −0) — b.txt. Filament's check of the folder with them passed: \`check b\` passed`), said[1]);
  assert.equal(read(t.dir, "b.txt"), "B\n");
});

// (fails before: yes — overlap never reached the apply's cycle: its call heard "waits in line", and the send_back ran on
// that answer, which was no refusal, so the verdict's refusal at the door named send_back as a way on again)
test("a lead's send_back on an apply that waits in line goes with its verdict: refused where its change overlaps the folder, its worker redoes it, and the door says it was sent back", async () => {
  const t = team(repo(), { held: true });
  const a = await reportedFrom(t, A, writesA);
  const b = await reportedFrom(t, B, writes({ "b.txt": "B\n", "shared.txt": BROKEN_SHARED }, "Wrote b.txt."));
  writeFileSync(join(t.dir, "shared.txt"), "line 1\nline 2, yours\nline 3\n");
  const gate = deferred();
  t.gates.set("check a", async (root) => {
    await gate.promise;
    return JUDGES["check a"](root);
  });
  const first = apply(t, a);
  await until(() => t.checked.some((x) => where(x.root) === "after"), "the folder's check to start");
  const second = apply(t, b, { overlap: "send_back" });
  await until(() => t.timers.filter((x) => x.ms === 45_000).length === 2, "both holds");
  for (const x of t.timers.filter((x) => x.ms === 45_000)) x.fn();
  await first;
  assert.match((await second).text, /^Not applied yet: Filament is still checking your folder with sub-agent /);
  const posted = t.posts.length;
  gate.resolve();
  await until(() => (t.take(), t.taken.filter((d) => d.kind === "check").length >= 2), "both verdicts", { timeoutMs: 60_000 });
  const said = t.taken.filter((d) => d.kind === "check" && d.from === b).map((d) => d.text);
  assert.equal(said.length, 1);
  assert.match(said[0], new RegExp(`^\\[Filament: what came of your apply of builder ${b} \\("Write b"\\): Nothing applied: 1 file does not come through cleanly — shared\\.txt: 1 change overlaps yours\\. Your folder is as it was\\. Sent back: `), said[0]);
  await until(() => t.posts.length > posted, "its run to redo the change", { timeoutMs: 60_000 });
  assert.match(lastSaid(/** @type {{ body: any }} */ (t.posts.at(-1))), /^\[Filament: your lead sent your work back to rebase: the folder changed since you started/);
  assert.equal(read(t.dir, "shared.txt"), "line 1\nline 2, yours\nline 3\n");
});

// (fails before: yes — a call that joined the apply in line dropped its overlap)
test("a lead's send_back on a second call of an apply that waits in line joins it: the verdict sends it back", async () => {
  const t = team(repo(), { held: true });
  const a = await reportedFrom(t, A, writesA);
  const b = await reportedFrom(t, B, writes({ "b.txt": "B\n", "shared.txt": BROKEN_SHARED }, "Wrote b.txt."));
  writeFileSync(join(t.dir, "shared.txt"), "line 1\nline 2, yours\nline 3\n");
  const gate = deferred();
  t.gates.set("check a", async (root) => {
    await gate.promise;
    return JUDGES["check a"](root);
  });
  const first = apply(t, a);
  await until(() => t.checked.some((x) => where(x.root) === "after"), "the folder's check to start");
  const second = apply(t, b);
  await until(() => t.timers.filter((x) => x.ms === 45_000).length === 2, "both holds");
  for (const x of t.timers.filter((x) => x.ms === 45_000)) x.fn();
  await first;
  assert.match((await second).text, /^Not applied yet: /);
  assert.match((await apply(t, b, { overlap: "send_back" })).text, /^Not applied yet: /);
  gate.resolve();
  await until(() => (t.take(), t.taken.filter((d) => d.kind === "check").length >= 2), "both verdicts", { timeoutMs: 60_000 });
  const said = t.taken.filter((d) => d.kind === "check" && d.from === b).map((d) => d.text);
  assert.equal(said.length, 1);
  assert.match(said[0], /Your folder is as it was\. Sent back: /, said[0]);
});

// ---- case 10: the page --------------------------------------------------------------------------------------------------

// (fails before: yes — the page had no word for a worker the folder's check sent back, nor for a verdict at the door)
test("the page: a worker the folder's check sent back, and the lead's verdict at its step", () => {
  assert.equal(sentBackWords({ command: "check a", n: 1, folder: true }), "sent back by Filament: the folder's check `check a` failed with its change (first time)");
  assert.equal(sentBackWords({ command: "npm test", n: 2 }), "sent back by Filament: its check `npm test` failed (second time)", "its own check's words as they were");
  assert.equal(teamLib.checkLine({ bounce: { command: "check a", n: 2, folder: true } }, 0), "sent back by Filament: the folder's check `check a` failed with its change (second time)");
  const { byRound } = alignEvents([
    { type: "round-start", round: 1, blocksBefore: 0 },
    { type: "subagent-report", round: 1, agentId: "sa_1", kind: "check", description: "Write a" },
  ]);
  assert.deepEqual(byRound.get(1).reports[0], { agentId: "sa_1", kind: "check", description: "Write a" });
  const timeline = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
  assert.ok(timeline.includes("`↳ The lead read here how Filament's check of the folder went with ${who}'s change`"), "the row's words");
  // A verdict that waits for the next turn outlives a restart, as a report does.
  const service = readFileSync(new URL("../src/app/sessions/service.js", import.meta.url), "utf8");
  assert.match(service, /const QUEUE_KINDS = .*"check"/);
});
