// @ts-check
// An apply that overlaps a file edited in the folder offers a way on (the owner's of 11-09: "apply refuses a change that
// overlaps a file you edited, with no merge offered"): the agent's `overlap` beside apply_changes — "markers" applies it
// all, those files with git's conflict markers for it to resolve, as the developer's "both"; "mine" applies the rest and
// keeps the folder's version of those files, its change to them set aside and readable after; "send_back" has the
// sub-agent redo its change on the folder as it stands, as the developer's Send back to rebase, its report coming back
// as any report does. Left out, nothing is applied, and the refusal names those ways. A team's lead, whose applies
// Filament checks, takes send_back alone.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTaskWork, captureTaskWork, openTaskWorktree, removeTaskWorktree } from "../src/adapters/git/worktree.js";
import { appliedResult, createSubagentRegistry } from "../src/app/agent/subagents.js";
import { inputRefusal } from "../src/app/agent/team-tools.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { BRIEF, leadOf } from "./helpers/team.js";

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
const TEN = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";
const YOURS = TEN.replace("3\n", "three, yours\n");
const ITS = TEN.replace("3\n", "THREE, its\n");
const MARKED = TEN.replace("3\n", "<<<<<<< yours\nthree, yours\n=======\nTHREE, its\n>>>>>>> its change\n");
/** A repository with a.txt (ten lines) and d.txt committed. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-overlap-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), TEN);
  writeFileSync(join(dir, "d.txt"), "dee\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** @param {string} p */
const read = (p) => readFileSync(p, "utf8");
/** @param {{ path: string, how: string }[]} came */
const ways = (came) => Object.fromEntries(came.map((c) => [c.path, c.how]));
/** @param {() => boolean} ok @param {string} what */
const until = async (ok, what) => {
  for (let i = 0; i < 500 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(ok(), `${what} came in time`);
};

// (fails before: yes — applyTaskWork took the developer's choices alone, file by file: an overlap with no choice stopped it)
test("overlap answers every file that stops an apply: mine keeps yours of each, markers writes git's markers where lines overlap and keeps yours where no marker fits — the rest comes in as it would, and a choice named for a file wins", async () => {
  /** @param {any} opt */
  const run = async (opt) => {
    const dir = repo();
    const o = await openTaskWorktree(dir, { id: "sa_0e000001" });
    assert.ok(o.ok);
    writeFileSync(join(o.wt.workdir, "a.txt"), ITS);
    rmSync(join(o.wt.workdir, "d.txt"));
    writeFileSync(join(o.wt.workdir, "c.txt"), "sea\n");
    const cap = await captureTaskWork(o.wt, { id: "sa_0e000001" });
    assert.ok(cap.ok);
    await removeTaskWorktree(o.wt);
    writeFileSync(join(dir, "a.txt"), YOURS);
    writeFileSync(join(dir, "d.txt"), "dee, yours\n");
    const ap = await applyTaskWork(dir, { base: o.wt.base, head: cap.head }, opt);
    assert.ok(ap.ok, !ap.ok ? JSON.stringify(ap.conflicts) : "");
    return { came: ways(ap.came), a: read(join(dir, "a.txt")), d: read(join(dir, "d.txt")), c: read(join(dir, "c.txt")) };
  };
  assert.deepEqual(await run({ overlap: "mine" }), { came: { "a.txt": "kept", "c.txt": "took", "d.txt": "kept" }, a: YOURS, d: "dee, yours\n", c: "sea\n" });
  // Its delete against your edit takes no marker: yours is kept, as mine keeps it.
  assert.deepEqual(await run({ overlap: "markers" }), { came: { "a.txt": "markers", "c.txt": "took", "d.txt": "kept" }, a: MARKED, d: "dee, yours\n", c: "sea\n" });
  assert.deepEqual((await run({ overlap: "markers", choices: { "a.txt": "its" } })).came, { "a.txt": "replaced", "c.txt": "took", "d.txt": "kept" });
});

/**
 * A registry over a real folder whose sub-agent works in its own copy as `work` says, by exchange; each brief it was
 * sent is kept in `briefs`.
 * @param {string} dir @param {(o: { n: number, cwd: string }) => void} work @param {string[]} [briefs]
 */
const working = (dir, work, briefs = []) => {
  const cards = createAgentCardStore({ dataDir: null });
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { ask: [], workspace: "worktree" }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: dir, model: "m", projectId: null }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
      exchangeEnded: () => {},
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const cwd = registry.hostOf(id)?.workdir || String(headers["x-filament-cwd"]);
      const runId = `run-${++n}`;
      briefs.push(String(body.messages.at(-1).content.at(-1).text));
      registry.attach(id, runId);
      work({ n, cwd });
      registry.relay(id, { type: "tool-end", name: "write", ok: true });
      registry.finish(id, { status: "done", error: null, report: "done", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "done" }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "done" }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return registry;
};
/** Its change: line 3 shouted, and a new file; sent back, it resolves the markers it finds. @param {{ n: number, cwd: string }} o */
const shout = ({ n, cwd }) => {
  if (n === 1) {
    writeFileSync(join(cwd, "a.txt"), ITS);
    writeFileSync(join(cwd, "c.txt"), "sea\n");
  } else if (read(join(cwd, "a.txt")) === MARKED) writeFileSync(join(cwd, "a.txt"), TEN.replace("3\n", "three, yours — and THREE, its\n"));
};
/**
 * The session's agent's turn over a folder where a sub-agent shouted line 3 and added c.txt, and the developer edited
 * line 3 meanwhile: its agent tool, its door, the sub-agent's id.
 * @param {string[]} [briefs]
 */
const overlapping = async (briefs = []) => {
  const dir = repo();
  const registry = working(dir, shout, briefs);
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "shout three, and add c.txt" }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  const id = String(r.id);
  writeFileSync(join(dir, "a.txt"), YOURS);
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  /** @param {any} input */
  const call = (input) => door.subagents.run({ id: "toolu_1", input: { description: "apply", ...input }, emit: () => {}, signal: null });
  return { dir, registry, id, door, call };
};

// (fails before: yes — the refusal said nothing applied and named the files, and the agent had no way on but by hand)
test("an apply refused where its change overlaps your edits names the ways on: overlap markers, mine or send_back, or by hand and mark_applied", async () => {
  const { dir, id, door, call } = await overlapping();
  try {
    const r = await call({ agent_id: id, apply_changes: true });
    assert.deepEqual([r.ok, r.wrote], [false, false]);
    assert.equal(
      r.text,
      `Nothing applied: 1 file does not come through cleanly — a.txt: 1 change overlaps yours. Your folder is as it was. To go on, call agent again with agent_id "${id}", apply_changes: true and overlap: "markers" applies it all, those files with git's conflict markers for you to resolve; "mine" applies the rest and keeps your version of those files, its change to them set aside; "send_back" has it redo its change on your folder as it stands. Or bring its change in by hand, then call agent with agent_id "${id}" and mark_applied: true.`,
    );
    assert.equal(read(join(dir, "a.txt")), YOURS);
  } finally {
    door.close();
  }
});

// (fails before: yes — the agent tool took no overlap)
test("overlap markers applies it all: each overlapping file with git's markers, named for the agent to resolve; nothing of it waits", async () => {
  const { dir, registry, id, door, call } = await overlapping();
  try {
    const r = await call({ agent_id: id, apply_changes: true, overlap: "markers" });
    assert.deepEqual([r.ok, r.wrote], [true, true]);
    assert.equal(r.text, `Applied the changes of sub-agent ${id} to your folder: 2 files (+2 −1) — a.txt, c.txt. Git's conflict markers stand in a.txt: "<<<<<<< yours" over your lines, "=======", then its down to ">>>>>>> its change". Resolve it so it keeps what both meant, and leave no marker.`);
    assert.deepEqual([read(join(dir, "a.txt")), read(join(dir, "c.txt"))], [MARKED, "sea\n"]);
    assert.equal(/** @type {any} */ (registry.get(id))?.work?.pending, 0);
  } finally {
    door.close();
  }
});

// (fails before: yes — the same)
test("overlap mine applies the rest and keeps your version of each overlapping file: its change to them is set aside, named, and stays readable — git's garbage collected too", async () => {
  const { dir, registry, id, door, call } = await overlapping();
  try {
    const r = await call({ agent_id: id, apply_changes: true, overlap: "mine" });
    assert.deepEqual([r.ok, r.wrote], [true, true]);
    const m = /^Applied the changes of sub-agent sa_[0-9a-f]{8} to your folder: 1 file \(\+1 −0\) — c\.txt\. Kept your version of a\.txt, its change to it set aside: git diff ([0-9a-f]{40}) ([0-9a-f]{40}) -- a\.txt in your folder shows it, for 7 days or until this sub-agent's next apply\.$/.exec(r.text);
    assert.ok(m, r.text);
    assert.deepEqual([read(join(dir, "a.txt")), read(join(dir, "c.txt"))], [YOURS, "sea\n"]);
    assert.deepEqual(r.writes?.paths.map((p) => p.split(/[\\/]/).pop()), ["c.txt"], "a.txt was not written");
    assert.equal(/** @type {any} */ (registry.get(id))?.work?.pending, 0, "nothing of it waits");
    git(dir, "gc", "-q", "--prune=now");
    const diff = git(dir, "diff", m[1], m[2], "--", "a.txt");
    assert.match(diff, /^-3$/m);
    assert.match(diff, /^\+THREE, its$/m);
  } finally {
    door.close();
  }
});

// (fails before: yes — the same: only the developer could send it back to rebase)
test("overlap send_back applies nothing and has it redo its change on your folder as it stands: it reads why, from the agent, resolves the markers, reports as any report does, and its work then applies cleanly", async () => {
  /** @type {string[]} */
  const briefs = [];
  const { dir, registry, id, door, call } = await overlapping(briefs);
  try {
    const r = await call({ agent_id: id, apply_changes: true, overlap: "send_back" });
    assert.deepEqual([r.ok, r.wrote], [false, false]);
    assert.equal(
      r.text,
      `Nothing applied: 1 file does not come through cleanly — a.txt: 1 change overlaps yours. Your folder is as it was. Sent back: sub-agent ${id} redoes its change on your folder as it stands now, git's conflict markers in its copy of a.txt for it to resolve. Its report reaches you as a message, and its work waits for your apply again.`,
    );
    assert.equal(read(join(dir, "a.txt")), YOURS, "your folder is as it was");
    await until(() => briefs.length === 2 && registry.get(id)?.status === "done", "its second run");
    assert.match(briefs[1], /^\[Filament: the agent that launched you sent your work back to rebase: the folder changed since you started, and your change overlapped edits made there\. Your copy holds the folder as it stands now, with your change brought onto it again\. Where your lines and theirs overlap, git's conflict markers stand in a\.txt: "<<<<<<< yours" over the folder's lines/);
    /** @type {any[]} */
    const taken = [];
    await until(() => (taken.push(...door.inbox.take()), taken.some((d) => d.from === id && d.kind === "report" && d.exchange === 1)), "its report at the agent's door");
    const again = await call({ agent_id: id, apply_changes: true });
    assert.equal(again.ok, true, again.text);
    assert.equal(read(join(dir, "a.txt")), TEN.replace("3\n", "three, yours — and THREE, its\n"));
  } finally {
    door.close();
  }
});

// (fails before: yes — overlap was no field of the agent tool: it was never read)
test("overlap is refused in words where it cannot go: without apply_changes, or a word it does not take", async () => {
  const { dir, id, door, call } = await overlapping();
  try {
    await assert.rejects(call({ agent_id: id, mark_applied: true, overlap: "mine" }), /^Error: overlap goes with apply_changes: what to do with the files where its change overlaps yours$/);
    await assert.rejects(call({ agent_id: id, prompt: "again", overlap: "mine" }), /^Error: overlap goes with apply_changes/);
    await assert.rejects(call({ agent_id: id, apply_changes: true, overlap: "theirs" }), /^Error: overlap is "markers", "mine" or "send_back", not "theirs"$/);
    assert.equal(read(join(dir, "a.txt")), YOURS);
  } finally {
    door.close();
  }
});

// (fails before: yes — its report's line said nothing applied where a change overlaps, with no way on)
test("a sub-agent's report says how to apply its change, and that overlap answers what overlaps", async () => {
  const dir = repo();
  const registry = working(dir, shout);
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  try {
    const r = await door.subagents.run({ id: "toolu_1", input: { description: "shout", prompt: "shout three, and add c.txt", run_in_background: false }, emit: () => {}, signal: null });
    assert.ok(
      r.text.includes(`call agent with agent_id "${registry.list("c1")[0].id}" and apply_changes: true — a file you changed meanwhile is merged with yours; where changes overlap, overlap says what happens ("markers", "mine" or "send_back"), and left out nothing is applied and you hear which files.`),
      r.text,
    );
  } finally {
    door.close();
  }
});

// (fails before: yes — the lead's worker took no overlap)
test("a lead's overlap: send_back alone — its worker redoes its change on the folder, and its report reaches the lead; markers or mine are refused before anything runs", () => {
  assert.equal(inputRefusal("worker", { agent_id: "sa_1", apply_changes: true, overlap: "send_back" }), null);
  for (const overlap of ["markers", "mine"]) {
    const no = inputRefusal("worker", { agent_id: "sa_1", apply_changes: true, overlap });
    assert.equal(no?.text, `Nothing done: overlap takes send_back alone in a lead's apply — Filament checks the folder with each change you apply, so nothing goes in half-merged. Send it back, or apply it once the files it overlaps are as its change needs them.`);
  }
  assert.equal(inputRefusal("worker", { agent_id: "sa_1", prompt: "go on", overlap: "send_back" })?.text, "Nothing done: overlap goes with apply_changes, for a change that overlaps edits in your folder.");
});

/** A lead's registry over `dir`, its worker's runs scripted by `runs`, each brief kept. @param {string} dir @param {((wd: string) => void)[]} runs @param {string[]} briefs */
const leading = (dir, runs, briefs) => {
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    runCheck: async () => ({ exit: 0, output: "ok", stopped: false }),
    context: {
      settings: () => ({ subagents: { pool: [{ model: "", seats: 8 }] }, loop: { permissions: "edit", rules: [], verify: {} } }),
      session: () => ({ cwd: dir, model: "m-session", projectId: null, client: "harness" }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
    },
    call: async ({ body, headers = {} }) => {
      const id = String(headers["x-filament-subagent"]);
      const host = registry.hostOf(id);
      briefs.push(String(body.messages.at(-1).content.at(-1).text));
      const runId = `run-${briefs.length}`;
      registry.attach(id, runId);
      (runs.shift() || (() => {}))(String(host?.workdir));
      registry.finish(id, { status: "done", error: null, report: "Done.", stoppedBy: null, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Done." }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "Done." }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return registry;
};

// (fails before: yes — the same)
test("a lead's apply refused where its worker's change overlaps the folder names send_back, which sends it back: it redoes its change on the folder, and its report reaches the lead", async () => {
  const dir = repo();
  /** @type {string[]} */
  const briefs = [];
  const registry = leading(dir, [(wd) => writeFileSync(join(wd, "a.txt"), ITS), (wd) => writeFileSync(join(wd, "a.txt"), TEN.replace("3\n", "three, yours — and THREE, its\n"))], briefs);
  const lead = leadOf(registry, dir);
  const launched = await lead.tools.agent(lead.call(BRIEF));
  assert.equal(launched.ok, true, launched.text);
  const id = String(launched.agentId);
  await until(() => registry.get(id)?.status === "done", "its report");
  lead.door.inbox.take();
  writeFileSync(join(dir, "a.txt"), YOURS);
  const no = await lead.tools.worker(lead.call({ agent_id: id, apply_changes: true }));
  assert.equal(no.text, `Nothing applied: 1 file does not come through cleanly — a.txt: 1 change overlaps yours. Your folder is as it was. To go on, call worker again with agent_id "${id}", apply_changes: true and overlap: "send_back": it redoes its change on your folder as it stands, and reports again.`);
  const back = await lead.tools.worker(lead.call({ agent_id: id, apply_changes: true, overlap: "send_back" }));
  assert.equal(back.text, `Nothing applied: 1 file does not come through cleanly — a.txt: 1 change overlaps yours. Your folder is as it was. Sent back: sub-agent ${id} redoes its change on your folder as it stands now, git's conflict markers in its copy of a.txt for it to resolve. Its report reaches you as a message, and its work waits for your apply again.`);
  await until(() => briefs.length === 2 && registry.get(id)?.status === "done", "its second run");
  assert.match(briefs[1], /^\[Filament: your lead sent your work back to rebase: the folder changed since you started/);
  /** @type {any[]} */
  const taken = [];
  await until(() => (taken.push(...lead.door.inbox.take()), taken.some((d) => d.from === id && d.kind === "report" && d.exchange === 1)), "its report at the lead's door");
  const ap = await lead.tools.worker(lead.call({ agent_id: id, apply_changes: true }));
  assert.equal(ap.ok, true, ap.text);
  assert.equal(read(join(dir, "a.txt")), TEN.replace("3\n", "three, yours — and THREE, its\n"));
});

// (fails before: yes — the swarm's review of 11-10: a sub-agent's work in its own copy on another machine takes markers
// and mine alone, and its refused apply still named send_back, which is refused there)
test("a refused apply names only the ways its work takes: a copy's on another machine, markers and mine", () => {
  const refused = { ok: false, error: "1 file does not come through cleanly — a.txt: 1 change overlaps yours", conflicts: [{ path: "a.txt", kind: "content" }], takes: ["markers", "mine"] };
  const r = appliedResult("sa_there", /** @type {any} */ (refused));
  assert.equal(
    r.text,
    `Nothing applied: 1 file does not come through cleanly — a.txt: 1 change overlaps yours. Your folder is as it was. To go on, call agent again with agent_id "sa_there", apply_changes: true and overlap: "markers" applies it all, those files with git's conflict markers for you to resolve; "mine" applies the rest and keeps your version of those files, its change to them set aside. Or bring its change in by hand, then call agent with agent_id "sa_there" and mark_applied: true.`,
  );
  const all = appliedResult("sa_here", /** @type {any} */ ({ ...refused, takes: ["markers", "mine", "send_back"] }));
  assert.match(all.text, /set aside; "send_back" has it redo its change on your folder as it stands\. Or bring/);
});
