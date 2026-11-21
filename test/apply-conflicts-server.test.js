// @ts-check
// The registry's side of a sub-agent's work that overlaps the developer's edits (the Designer's of 10-27, built
// 10-28): the dry run names each file's kind and the choices it offers, and how the rest would come in with the
// developer's choices so far; Apply with my choices writes them, and the session's agent is told to leave a file with
// markers alone, the row naming it while they stand; Compare reads one file's overlaps; Send back to rebase redoes its
// change on the folder as it is and sends it on to resolve the overlaps, its work then waiting again; git failing
// under the dry run is said in words, never a 500.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskRefs } from "../src/adapters/git/worktree.js";
import { choicesOf, createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";

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
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-applyconfsrv-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), TEN);
  writeFileSync(join(dir, "b.txt"), "bee\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** @param {string} p */
const read = (p) => readFileSync(p, "utf8");
/** @param {{ path: string, how: string }[]} came */
const ways = (came) => Object.fromEntries(came.map((c) => [c.path, c.how]));
/** The newest user words of a request. @param {any} body */
const lastAsk = (body) => {
  const m = [...body.messages].reverse().find((x) => x.role === "user");
  return typeof m?.content === "string" ? m.content : (m?.content || []).map((/** @type {any} */ c) => c.text || "").join("\n");
};
/** @param {() => boolean} ok */
const until = async (ok) => {
  for (let i = 0; i < 500 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(ok(), "it came in time");
};

/**
 * A registry over a real folder whose sub-agent works in its own copy as `work` says, by exchange.
 * @param {string} dir @param {(o: { n: number, cwd: string, body: any }) => void} work
 * @param {{ problem?: string | null, more?: Record<string, any>, publish?: (type: string, data: any) => void }} [knobs]  `publish`: what the bus hears
 */
const working = (dir, work, knobs = {}) => {
  const cards = createAgentCardStore({ dataDir: null });
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: knobs.publish || (() => {}) },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { ask: [] }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: dir, model: "m", projectId: null }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => knobs.problem || null,
      mark: () => null,
      folderProblem: () => null,
      ...(knobs.more || {}),
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const cwd = registry.hostOf(id)?.workdir || String(headers["x-filament-cwd"]);
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      work({ n, cwd, body });
      registry.relay(id, { type: "tool-end", name: "write", ok: true });
      registry.finish(id, { status: "done", error: null, report: "done", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "done" }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "done" }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return registry;
};
/**
 * The session's settings with its sub-agents in a worktree: a model here that reads its copy's disk, or a test that
 * reads the copy's own record, stands for a worktree's (a patch's are test/subagent-patch.test.js's).
 */
const IN_A_WORKTREE = { settings: () => ({ subagents: { ask: [], workspace: "worktree" }, loop: { permissions: "edit" } }) };
/** @param {ReturnType<typeof createSubagentRegistry>} registry @param {string} prompt */
const launched = async (registry, prompt) => {
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  return String(r.id);
};

test("a request's choices keep only the three, by path", () => {
  assert.deepEqual(choicesOf({ "a.txt": "both", "b.txt": "mine", "": "its", "c.txt": "its" }), { "a.txt": "both", "c.txt": "its" });
  assert.deepEqual([choicesOf(null), choicesOf(["its"]), choicesOf("its")], [{}, {}, {}]);
});

// (fails before: yes — the dry run named no kind and offered no choice, and an apply took none: the work stopped there)
test("the dry run names each overlap's kind and choices, and says how all would come in with the choices made; Apply with both leaves markers — the agent told to leave that file alone, the row naming it until they are gone", async () => {
  const dir = repo();
  const registry = working(dir, ({ cwd }) => {
    writeFileSync(join(cwd, "a.txt"), TEN.replace("3\n", "THREE, its\n"));
    writeFileSync(join(cwd, "c.txt"), "sea\n");
  });
  const id = await launched(registry, "shout three, and add c.txt");
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "three, yours\n"));
  const p = await registry.preview(id, "c1");
  assert.ok(p.ok, !p.ok ? p.error : "");
  assert.deepEqual(p.conflicts, [{ path: "a.txt", why: "1 change overlaps yours", kind: "lines", overlaps: 1, choices: ["yours", "its", "both"] }]);
  const chosen = await registry.preview(id, "c1", { choices: { "a.txt": "both" } });
  assert.deepEqual(chosen.ok && [chosen.conflicts, ways(chosen.came)], [[], { "a.txt": "markers", "c.txt": "took" }]);

  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  try {
    const a = await registry.apply(id, "c1", "owner", { choices: { "a.txt": "both" } });
    assert.ok(a.ok, !a.ok ? a.error : "");
    assert.equal(read(join(dir, "a.txt")), TEN.replace("3\n", "<<<<<<< yours\nthree, yours\n=======\nTHREE, its\n>>>>>>> its change\n"));
    const last = /** @type {any} */ (registry.get(id))?.work?.lastApplied;
    assert.deepEqual([last?.came, last?.marked], [{ took: 1, merged: [], deleted: 0, same: 0, markers: ["a.txt"] }, ["a.txt"]]);
    const told = door.inbox.take().find((d) => d.kind === "applied");
    assert.match(String(told?.text), /2 files changed under you — a\.txt, c\.txt\. .* a\.txt has git's conflict markers in it — their edits and the sub-agent's, both — for the developer to resolve: leave that file alone unless they ask you to\.\]$/);
  } finally {
    door.close();
  }
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "three, both\n"));
  assert.equal(/** @type {any} */ (registry.get(id))?.work?.lastApplied?.marked, undefined, "resolved: the row names it no more");
});

// (fails before: yes — the same: an apply took no choices)
test("Apply keeping yours writes the rest, and the agent hears only of the files that changed under it", async () => {
  const dir = repo();
  const registry = working(dir, ({ cwd }) => {
    writeFileSync(join(cwd, "a.txt"), TEN.replace("3\n", "THREE, its\n"));
    writeFileSync(join(cwd, "c.txt"), "sea\n");
  });
  const id = await launched(registry, "shout three, and add c.txt");
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "three, yours\n"));
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  try {
    const a = await registry.apply(id, "c1", "owner", { choices: { "a.txt": "yours" } });
    assert.ok(a.ok, !a.ok ? a.error : "");
    assert.deepEqual([read(join(dir, "a.txt")), read(join(dir, "c.txt"))], [TEN.replace("3\n", "three, yours\n"), "sea\n"]);
    const told = door.inbox.take().find((d) => d.kind === "applied");
    assert.match(String(told?.text), /: 1 file changed under you — c\.txt\. What you read of it before may be out of date: read again before you edit\.\]$/);
  } finally {
    door.close();
  }
});

// (fails before: yes — there was no Compare in the registry)
test("Compare reads one file's overlaps from the work that waits", async () => {
  const dir = repo();
  const registry = working(dir, ({ cwd }) => writeFileSync(join(cwd, "a.txt"), TEN.replace("3\n", "THREE, its\n")));
  const id = await launched(registry, "shout three");
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "three, yours\n"));
  const c = /** @type {any} */ (await registry.compare(id, "c1", "a.txt"));
  assert.deepEqual([c.ok, c.kind, c.overlaps], [true, "lines", [{ at: 3, yours: ["three, yours"], start: ["3"], its: ["THREE, its"] }]]);
});

// (fails before: yes — there was no rebase: work that overlapped could be dropped, or applied by hand)
test("Send back to rebase: its change redone on your folder as it is, it goes on to resolve the markers, and its work then applies cleanly; one that cannot go on now leaves its work as it was", async () => {
  const dir = repo();
  /** @type {{ ask: string, found: string }[]} */
  const seen = [];
  const knobs = { problem: /** @type {string | null} */ (null), more: IN_A_WORKTREE };
  const registry = working(
    dir,
    ({ n, cwd, body }) => {
      if (n === 1) {
        writeFileSync(join(cwd, "a.txt"), TEN.replace("3\n", "THREE, its\n"));
        writeFileSync(join(cwd, "b.txt"), "BEE, its\n");
        return;
      }
      seen.push({ ask: lastAsk(body), found: read(join(cwd, "a.txt")) });
      writeFileSync(join(cwd, "a.txt"), TEN.replace("3\n", "three, yours — THREE, its\n"));
    },
    knobs,
  );
  const id = await launched(registry, "shout three and bee");
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "three, yours\n"));
  const before = await taskRefs(dir, id);

  // Its model cannot run now: nothing changes.
  knobs.problem = "its provider is switched off";
  const no = await registry.rebase(id, "c1");
  assert.match(!no.ok ? no.error : "", /its provider is switched off/);
  assert.deepEqual(await taskRefs(dir, id), before, "its refs as they were");
  const still = await registry.preview(id, "c1");
  assert.deepEqual(still.ok && still.conflicts.map((c) => c.path), ["a.txt"], "its work waits as it did");

  knobs.problem = null;
  const r = await registry.rebase(id, "c1");
  assert.ok(r.ok, !r.ok ? r.error : "");
  assert.deepEqual([r.marked, r.left, r.files, r.task], [["a.txt"], [], 2, null]);
  await until(() => seen.length === 1 && /** @type {any} */ (registry.get(id))?.status !== "running");
  assert.match(seen[0].ask, /^\[Filament: the developer sent your work back to rebase: .* git's conflict markers stand in a\.txt: .* Then report again: your work waits for their apply once more\.\]$/);
  assert.equal(seen[0].found, TEN.replace("3\n", "<<<<<<< yours\nthree, yours\n=======\nTHREE, its\n>>>>>>> its change\n"), "its copy held your folder with its change, the overlap marked");
  assert.equal(read(join(dir, "a.txt")), TEN.replace("3\n", "three, yours\n"), "your folder untouched");

  const p = await registry.preview(id, "c1");
  assert.deepEqual(p.ok && [p.conflicts, ways(p.came)], [[], { "a.txt": "took", "b.txt": "took" }], "it comes in cleanly now");
  const a = await registry.apply(id, "c1", "owner");
  assert.ok(a.ok, !a.ok ? a.error : "");
  assert.deepEqual([read(join(dir, "a.txt")), read(join(dir, "b.txt"))], [TEN.replace("3\n", "three, yours — THREE, its\n"), "BEE, its\n"]);
});

// (fails before: yes — the Hunter's of 10-28: git failing under the dry run threw, and the route answered 500)
test("git failing under the dry run is said in words", async () => {
  const dir = repo();
  const registry = working(dir, ({ cwd }) => writeFileSync(join(cwd, "a.txt"), TEN.replace("3\n", "THREE, its\n")));
  const id = await launched(registry, "shout three");
  const refs = await taskRefs(dir, id);
  assert.ok(refs);
  // Its work's commit is gone from the repository.
  rmSync(join(dir, ".git", "objects", refs.head.slice(0, 2), refs.head.slice(2)));
  const p = await registry.preview(id, "c1");
  assert.match(!p.ok ? p.error : "", /^Filament could not work out what an apply would do \(git could not list the changed files/);
});

// (fails before: yes — a graph task's sub-agent could not be sent back to rebase: followUp refuses a task's agent)
test("a graph task's change sent back to rebase goes back the graph's way, its note the brief; no Apply of its marked work until it goes on", async () => {
  const dir = repo();
  /** @type {any[]} */
  const sent = [];
  const registry = working(
    dir,
    ({ n, cwd }) => {
      if (n === 1) writeFileSync(join(cwd, "a.txt"), TEN.replace("3\n", "THREE, its\n"));
      else writeFileSync(join(cwd, "a.txt"), TEN.replace("3\n", "three, yours — THREE, its\n"));
    },
    { more: { exchangeEnded: () => {}, rebaseTask: (/** @type {any} */ o) => (sent.push(o), { ok: true }) } },
  );
  const t = /** @type {any} */ (registry.launch({ origin: "agent", chainId: "c1", prompt: "THE BRIEF OF t1", description: "t1: shout three", background: true, task: { id: "t1", review: false }, requestId: "turn-1" }));
  assert.equal(t.ok, true, String(t.error || ""));
  await t.done;
  const id = String(t.id);
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "three, yours\n"));

  const r = await registry.rebase(id, "c1");
  assert.ok(r.ok, !r.ok ? r.error : "");
  assert.deepEqual([r.task, sent.length, sent[0]?.taskId, sent[0]?.agentId], ["t1", 1, "t1", id]);
  assert.match(sent[0].note, /^\[Filament: the developer sent your work back to rebase: .* git's conflict markers stand in a\.txt/);
  assert.equal(/** @type {any} */ (registry.get(id))?.rebaseDue, true, "its row says it was sent back");
  const no = await registry.apply(id, "c1", "owner", { choices: { "a.txt": "its" } });
  assert.match(!no.ok ? no.error : "", /was sent back to rebase: its work waits again once it has redone it$/);

  // The graph starts it again: it goes on, resolves the markers, and its work applies cleanly.
  const back = /** @type {any} */ (registry.resumeTask(id, { chainId: "c1", prompt: sent[0].note, requestId: "turn-2" }));
  assert.equal(back.ok, true, String(back.error || ""));
  await back.done;
  assert.equal(/** @type {any} */ (registry.get(id))?.rebaseDue, undefined);
  const p = await registry.preview(id, "c1");
  assert.deepEqual(p.ok && [p.conflicts, ways(p.came)], [[], { "a.txt": "took" }]);
});

// (fails before: yes — the Hunter's of 10-28: the graph's merge took a rebase's markers in as clean lines, the task done,
// and once its worker made a commit after the rebase no apply knew them for markers)
test("a merge of work that still holds its rebase's markers is refused in words, however many commits came after; your Apply brings them in as markers", async () => {
  const dir = repo();
  /** @type {any[]} */
  const sent = [];
  const registry = working(
    dir,
    ({ n, cwd }) => {
      if (n === 1) writeFileSync(join(cwd, "a.txt"), TEN.replace("3\n", "THREE, its\n"));
      // It goes on, and leaves the markers in a.txt.
      else writeFileSync(join(cwd, "b.txt"), "bee, its\n");
    },
    { more: { exchangeEnded: () => {}, rebaseTask: (/** @type {any} */ o) => (sent.push(o), { ok: true }) } },
  );
  const t = /** @type {any} */ (registry.launch({ origin: "agent", chainId: "c1", prompt: "THE BRIEF OF t1", description: "t1: shout three", background: true, task: { id: "t1", review: false }, requestId: "turn-1" }));
  await t.done;
  const id = String(t.id);
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "three, yours\n"));
  const r = await registry.rebase(id, "c1");
  assert.ok(r.ok, !r.ok ? r.error : "");
  const back = /** @type {any} */ (registry.resumeTask(id, { chainId: "c1", prompt: sent[0].note, requestId: "turn-2" }));
  await back.done;
  const m = await registry.mergeTask(id, "c1");
  assert.deepEqual(m, { ok: false, error: "its change still holds the conflict markers its rebase left in a.txt — they are resolved first, by its sub-agent or by the developer in Changes" });
  assert.equal(read(join(dir, "a.txt")), TEN.replace("3\n", "three, yours\n"), "nothing came in");
  const p = await registry.preview(id, "c1");
  assert.deepEqual(p.ok && ways(p.came), { "a.txt": "markers", "b.txt": "took" }, "your Apply says what it brings");
});

// (fails before: yes — the Hunter's of 10-28: Open its version opened its parked copy's old place, which another agent
// may have taken since)
test("its version opens from its own copy only: once the copy is another agent's, no folder is offered", async () => {
  const dir = repo();
  const registry = working(dir, ({ cwd }) => writeFileSync(join(cwd, "a.txt"), TEN.replace("3\n", "THREE, its\n")), { more: IN_A_WORKTREE });
  const id = await launched(registry, "shout three");
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "three, yours\n"));
  const p = await registry.preview(id, "c1");
  const folder = p.ok ? p.folder : null;
  assert.ok(folder, "its parked copy, its own");
  const c = await registry.compare(id, "c1", "a.txt");
  assert.equal(/** @type {any} */ (c).folder, folder);
  // The copy is taken for another agent: its record says whose it is now.
  const gitdir = read(join(String(folder), ".git")).replace(/^gitdir:\s*/, "").trim();
  const meta = JSON.parse(read(join(gitdir, "filament.json")));
  writeFileSync(join(gitdir, "filament.json"), JSON.stringify({ ...meta, agent: "sa_someone", state: "busy" }));
  const q = await registry.preview(id, "c1");
  assert.equal(q.ok ? q.folder : "x", null, "no Open its version into another agent's copy");
  assert.equal(/** @type {any} */ (await registry.compare(id, "c1", "a.txt")).folder, null);
  assert.equal(/** @type {any} */ (registry.get(id))?.work?.folder ?? null, null, "its row names no folder either");
});

// (fails before: yes — the owner's of 10-28: a graph worker's thread was never kept, so after a restart its change that
// waited for your Apply was gone from Changes; and the review of 11-03: its follow-up's refusal named the developer's
// Apply alone, though its planner may apply it too)
test("a graph worker whose change waits for your Apply is kept across a restart: its work in Changes, its task named, no follow-up", async () => {
  const dir = repo();
  /** @type {Map<string, any[]>} */
  const threads = new Map();
  const waits = { now: false };
  const more = {
    exchangeEnded: () => {},
    waitsForYou: () => waits.now,
    saveThread: (/** @type {string} */ c, /** @type {any} */ t) => threads.set(c, [...(threads.get(c) || []).filter((x) => x.id !== t.id), structuredClone(t)]),
    loadThreads: (/** @type {string} */ c) => structuredClone(threads.get(c) || []),
  };
  const registry = working(dir, ({ cwd }) => writeFileSync(join(cwd, "a.txt"), TEN.replace("3\n", "THREE, its\n")), { more });
  const t = /** @type {any} */ (registry.launch({ origin: "agent", chainId: "c1", prompt: "THE BRIEF OF t1", description: "t1: shout three", background: true, task: { id: "t1", review: false }, requestId: "turn-1" }));
  await t.done;
  const id = String(t.id);
  assert.deepEqual(threads.get("c1") || [], [], "a graph task's record is its graph while it merges");

  // Its change did not merge, or it is a side run's kept for you: the graph says so.
  waits.now = true;
  registry.keepWork(id, "c1");
  assert.deepEqual((threads.get("c1") || []).map((x) => [x.id, x.task, x.work?.files.length]), [[id, "t1", 1]]);

  // A restart: a registry that never knew it reads it back.
  const fresh = working(dir, () => {}, { more });
  const row = /** @type {any} */ (fresh.list("c1").find((x) => x.id === id));
  assert.deepEqual([row?.task, row?.work?.pending], ["t1", 1], "its task named, its work waiting");
  const p = await fresh.preview(id, "c1");
  assert.deepEqual(p.ok && ways(p.came), { "a.txt": "took" }, "its Apply works as before");
  const no = /** @type {any} */ (fresh.followUp(id, { prompt: "go on", chainId: "c1", by: "owner" }));
  assert.match(no.ok ? "" : no.error, /did task t1 of the task graph before Filament restarted: its change waits for its apply — yours in Changes, or its planner's — and a new worker takes the task if it starts again/);
  // The planner's follow-up is told its own way to it: the apply it may make.
  const asked = /** @type {any} */ (fresh.followUp(id, { prompt: "go on", chainId: "c1", by: "agent" }));
  assert.match(asked.ok ? "" : asked.error, new RegExp(`its change waits for its apply — yours, with agent_id "${id}" and apply_changes: true, or the developer's in Changes — `));
});

// (fails before: yes — found reviewing the Changes tab, 10-29: an Apply said itself applied — the bus's event the pane
// reads again on, and its reply — before what it wrote was kept under its sub-agent's name, so that read could find its
// files no one's, and the pane read again only 30 s later)
test("an Apply keeps what it wrote under its sub-agent's name before it says itself applied", async () => {
  const dir = repo();
  /** What happened, in order. @type {string[]} */
  const said = [];
  let applying = false;
  const more = {
    appliedWrote: async (/** @type {any} */ o) => {
      said.push(`record ${o.agentId} ${o.paths.join(",")}`);
      // As the server's: the repository's place is read first, from git.
      await new Promise((r) => setTimeout(r, 40));
      said.push("recorded");
    },
  };
  const registry = working(dir, ({ cwd }) => writeFileSync(join(cwd, "c.txt"), "sea\n"), {
    more,
    publish: (type, data) => {
      if (applying && type === "subagents") said.push(`event ${data.id}`);
    },
  });
  const id = await launched(registry, "add c.txt");
  applying = true;
  const a = await registry.apply(id, "c1", "owner");
  said.push("answered");
  assert.ok(a.ok, !a.ok ? a.error : "");
  assert.deepEqual(said.slice(0, 3), [`record ${id} c.txt`, "recorded", `event ${id}`], said.join(" · "));
  assert.equal(said.at(-1), "answered");
});

// (fails before: yes — the Hunter's of 10-28: once its task failed or went to a new worker, its work stayed "sent back
// to rebase" for good, no Apply's; and an apply of it after a restart wrote the rebase's markers into the folder unsaid)
test("work sent back to rebase whose task no longer waits for its worker is yours to apply again, its marked files said so — after a restart too", async () => {
  const dir = repo();
  const waits = { now: true };
  /** @type {any[]} */
  const applied = [];
  const more = {
    exchangeEnded: () => {},
    rebaseTask: () => ({ ok: true }),
    rebaseWaits: () => waits.now,
    workApplied: (/** @type {any} */ o) => applied.push(o),
  };
  const registry = working(dir, ({ cwd }) => writeFileSync(join(cwd, "a.txt"), TEN.replace("3\n", "THREE, its\n")), { more });
  const t = /** @type {any} */ (registry.launch({ origin: "agent", chainId: "c1", prompt: "THE BRIEF OF t1", description: "t1: shout three", background: true, task: { id: "t1", review: false }, requestId: "turn-1" }));
  await t.done;
  const id = String(t.id);
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "three, yours\n"));
  const r = await registry.rebase(id, "c1");
  assert.ok(r.ok, !r.ok ? r.error : "");
  assert.equal(/** @type {any} */ (registry.get(id))?.rebaseDue, true, "due while its task waits for it");

  // Its task failed, or went to a new worker: the graph waits for it no more.
  waits.now = false;
  assert.equal(/** @type {any} */ (registry.get(id))?.rebaseDue, undefined, "no longer said to go on");
  const p = await registry.preview(id, "c1");
  assert.deepEqual(p.ok && [p.conflicts, ways(p.came)], [[], { "a.txt": "markers" }], "the dry run says it comes with markers");

  // After a restart: a registry that never knew it reads the same from the repository.
  const fresh = working(dir, () => {}, { more });
  const q = await fresh.preview(id, "c1");
  assert.deepEqual(q.ok && ways(q.came), { "a.txt": "markers" }, "after a restart too");

  const a = await registry.apply(id, "c1", "owner");
  assert.ok(a.ok, !a.ok ? a.error : "");
  assert.deepEqual(ways(a.ok ? a.came || [] : []), { "a.txt": "markers" });
  assert.match(read(join(dir, "a.txt")), /^<<<<<<< yours$/m, "the markers it held are in the folder");
  assert.deepEqual(applied.map((o) => o.marked), [["a.txt"]], "the graph hears which files hold markers");
  assert.deepEqual(/** @type {any} */ (registry.get(id))?.work?.lastApplied?.marked, ["a.txt"], "its row names the file until the markers are gone");
});
