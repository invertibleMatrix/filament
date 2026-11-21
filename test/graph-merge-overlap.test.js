// @ts-check
// A graph task's change that overlaps edits made in the folder as it merges (the owner's of 11-09: tasks may overlap on
// files, their conflicts resolved at merge as a team does). With no way chosen — the planner's apply, a lead's merge —
// it goes back to its builder by itself to redo its change on the folder as it stands, twice at most, a counter kept on
// the task; past that the task fails for the planner to decide, its words naming the ways on. The planner's apply takes
// `overlap` on a graph task as on any: "markers" writes it with git's markers for the planner to resolve, "mine" keeps
// the folder's version and sets the change aside, "send_back" has the builder redo it. Nothing of Filament's writes into
// the folder; a restart keeps a task sent back waiting; the Plan names who shares a task's files and how its merge
// stands. The registry and the graph runner wired as server.js wires them, over a real git repository.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { appliedResult, createSubagentRegistry } from "../src/app/agent/subagents.js";
import * as tg from "../src/core/task-graph.js";
import { drawGraph } from "../src/ui/harness/views/task-graph.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
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
const TEN = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";
/** a.txt with its third line as `s`. @param {string} s */
const line3 = (s) => TEN.replace("3\n", `${s}\n`);
/** Git's conflict markers around one overlap, as an apply or a rebase writes them. */
const MARKS = /<<<<<<< [^\n]*\n[\s\S]*?\n>>>>>>> [^\n]*\n/;
/** What each task's builder writes on line 3. @type {Record<string, string>} */
const LINES = { t1: "THREE (t1)", t2: "three (t2)" };
/** A repository with a.txt — ten lines — committed. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-merge-overlap-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), TEN);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** @param {string} root @param {string} f */
const read = (root, f) => {
  try {
    return readFileSync(join(root, f), "utf8");
  } catch {
    return null;
  }
};

/**
 * Each worker as a builder: its task — the first named in its conversation — writes its line 3 of a.txt, and t1 adds
 * c.txt; sent back, its copy holds the folder with its change brought onto it, git's markers where they overlap, and it
 * resolves them into one line. t3 writes b.txt.
 * @param {{ host: any, body: any }} o
 */
const builder = ({ host, body }) => {
  const id = String(/Your task: (t\d)/.exec(JSON.stringify(body.messages))?.[1]);
  if (id === "t3") return writeFileSync(join(host.workdir, "b.txt"), "B\n");
  const a = join(host.workdir, "a.txt");
  const now = readFileSync(a, "utf8");
  if (MARKS.test(now)) return writeFileSync(a, now.replace(MARKS, `${LINES[id]}, over the folder's\n`));
  writeFileSync(a, line3(LINES[id]));
  if (id === "t1") writeFileSync(join(host.workdir, "c.txt"), "sea\n");
};

/**
 * The registry and the graph runner over `dir`, wired as server.js wires them: a worker's end reaches the runner, the
 * agent's apply its `applyAsked`, a send-back to rebase its `rebaseTask`. Every worker builds as `builder` does; `check
 * a` passes where a.txt holds no conflict marker. `chains`: the session's record — a second wiring over the same one is
 * Filament after a restart. What the runner tells the planner is kept, and each check run with where it ran.
 * @param {string} dir @param {Map<string, any>} [chains]
 */
const wired = (dir, chains = new Map([["c1", { id: "c1", meta: {} }]])) => {
  /** @type {any[]} */
  const told = [];
  /** @type {any[]} */
  const posts = [];
  /** @type {{ command: string, root: string }[]} */
  const ran = [];
  /** @type {any} */
  let graphs = null;
  const doc = { subagents: { pool: [{ model: "", seats: 8 }] }, loop: { permissions: "edit", rules: [], verify: {} } };
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    runCheck: async (/** @type {string} */ command, /** @type {{ root: string }} */ { root }) => {
      ran.push({ command, root });
      const marked = MARKS.test(read(root, "a.txt") || "");
      return command === "check a" && marked ? { exit: 1, output: "FAIL a: markers", stopped: false } : { exit: 0, output: "ok", stopped: false };
    },
    context: {
      settings: () => structuredClone(doc),
      session: () => ({ cwd: dir, model: "m-session", projectId: null, client: "harness" }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
      exchangeEnded: (/** @type {any} */ e) => graphs?.ended(e),
      taskApply: (/** @type {any} */ o) => graphs?.applyAsked(o) ?? null,
      workApplied: (/** @type {any} */ o) => graphs?.applied(o),
      rebaseTask: (/** @type {any} */ o) => graphs.rebaseTask(o),
      rebaseWaits: (/** @type {string} */ c, /** @type {string} */ a) => graphs.rebaseWaits(c, a),
      waitsForYou: (/** @type {string} */ c, /** @type {string} */ a) => graphs.waitsForYou(c, a),
    },
    call: async ({ body, headers = {} }) => {
      const id = String(headers["x-filament-subagent"]);
      const host = registry.hostOf(id);
      posts.push({ body, host });
      const runId = `run-${posts.length}`;
      registry.attach(id, runId);
      builder({ host, body });
      registry.finish(id, { status: "done", error: null, report: "Reported.", stoppedBy: null, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Reported." }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0.01, roundIds: [runId], taskReport: { status: "done", did: "Did it.", met: true, evidence: "it passed", left: "" } });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "Reported." }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  const archive = {
    /** @param {string} id @param {readonly string[]} keys */
    metaOf: (id, keys) => {
      const c = chains.get(id);
      return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
    },
    /** @param {string} id @param {Record<string, any>} patch */
    mergeMeta: (id, patch) => {
      const c = chains.get(id);
      if (!c) return null;
      c.meta = structuredClone({ ...c.meta, ...patch });
      return c.meta;
    },
    openGraphs: () => [...chains.values()].filter((c) => c.meta.graph && !c.meta.graph.closed).map((c) => ({ id: c.id, graph: structuredClone(c.meta.graph) })),
  };
  graphs = createGraphRunner({ archive, registry: /** @type {any} */ ({ ...registry, tell: (/** @type {string} */ c, /** @type {any} */ d) => (told.push(d), registry.tell(c, d)) }), events: { publish: () => {} }, crew: () => "agent", log: () => {} });
  /** @param {string} id @returns {any} */
  const task = (id) => chains.get("c1").meta.graph?.tasks.find((/** @type {any} */ t) => t.id === id);
  /** What the planner was told last of `id`. @param {string} id */
  const end = (id) => String(told.filter((d) => d.task === id).at(-1)?.text);
  const turn = (/** @type {string} */ runId) => graphs.attach("c1", { runId, cwd: dir, mode: null, model: "m", thinking: null, team: null });
  return { registry, graphs, told, posts, ran, chains, task, end, turn };
};

/**
 * `ids` added — t3 needing t2 where it is among them — each writing a.txt, and their changes ready in their copies. Two
 * tasks that write one file side by side: the graph's own refusal of that (which g1 takes away) is stepped round by
 * giving t2 its files once it is kept, as the owner's of 11-09 lets a planner name them.
 * @param {ReturnType<typeof wired>} w @param {string[]} ids
 */
const readyAll = async (w, ids) => {
  const all = [
    { id: "t1", name: "Shout three", by: "sub-agent", writes: ["a.txt", "c.txt"], goal: "line 3 shouts", steps: ["Write it"], acceptance: "check a passes", check: ["check a"] },
    { id: "t2", name: "Name three", by: "sub-agent", writes: ["notes/t2.txt"], goal: "line 3 names t2", steps: ["Write it"], acceptance: "check a passes", check: ["check a"] },
    { id: "t3", name: "Use three", needs: ["t2"], by: "sub-agent", writes: ["b.txt"], goal: "b.txt holds B", steps: ["Write it"], acceptance: "b.txt is there" },
  ];
  const add = w.graphs.apply("c1", { action: "add", goal: "Ship", tasks: all.filter((t) => ids.includes(t.id)) }, { crew: "agent" });
  assert.ok(add.ok, add.ok ? "" : add.error);
  const t2 = w.task("t2");
  if (t2) t2.writes = ["a.txt"];
  w.turn("turn-1");
  const writers = ids.filter((id) => id !== "t3");
  await until(() => writers.every((id) => w.task(id)?.step === "yours"), `${writers.join(", ")} ready`, { timeoutMs: 60_000 });
  return Object.fromEntries(writers.map((id) => [id, String(w.task(id).agent)]));
};

// (fails before: yes — the second's merge failed its task with cause "merge", its only ways on the developer's Changes)
test("two tasks write the same lines: the second's merge overlaps the first's, goes back to its builder by itself — nothing written into the folder — and, redone on the folder, merges clean, its counter at 1 until it merges and what needs it waiting throughout", async () => {
  const dir = repo();
  const w = wired(dir);
  const { t1: a1, t2: a2 } = await readyAll(w, ["t1", "t2", "t3"]);
  assert.equal(/** @type {any} */ (await w.registry.apply(a1, "c1", "agent")).ok, true);
  await until(() => w.task("t1").state === "done", "t1 merged", { timeoutMs: 60_000 });
  assert.equal(read(dir, "a.txt"), line3(LINES.t1));
  // t2's change overlaps t1's in the folder: its apply writes nothing, and its builder redoes it on the folder.
  const answer = /** @type {any} */ (await w.registry.apply(a2, "c1", "agent"));
  assert.match(appliedResult(a2, answer).text, new RegExp(`^Nothing applied: 1 file does not come through cleanly — a\\.txt: [^.]+\\. Your folder is as it was\\. Sent back to redo on the folder, 1 of 2: sub-agent ${a2} redoes its change on your folder as it stands now, git's conflict markers in its copy of a\\.txt for it to resolve\\. Its report reaches you as a message, and its work waits for your apply again\\.$`));
  assert.equal(read(dir, "a.txt"), line3(LINES.t1), "nothing of t2's is in the folder");
  assert.deepEqual([w.task("t2").rebases, w.task("t2").agent, w.task("t3").state], [1, a2, "waiting"]);
  // Its end follows the call's answer, as a merge's verdict does.
  await until(() => !w.end("t2").includes(" is ready: "), "t2's end", { timeoutMs: 60_000 });
  assert.match(w.end("t2"), new RegExp(`^\\[Filament: task t2 "Name three" did not merge: its change overlapped edits made in your folder since it began — a\\.txt: [^\\n]+\\. Filament sent it back to redo on the folder, 1 of 2: sub-agent ${a2} goes on with it in its own conversation, its copy holding your folder as it stands with its change brought onto it\\. Nothing of it was written into your folder\\. t3 needs it, and waits\\. Its change waits for your apply again once it reports\\.\\n`));
  // Redone on the folder as it stands, it is ready again — what needs it still waiting — and goes in clean.
  await until(() => w.task("t2").step === "yours", "t2 ready again", { timeoutMs: 60_000 });
  assert.deepEqual([w.task("t2").agent, w.task("t3").state, w.posts.length], [a2, "waiting", 3], "its own builder redid it, in its own conversation");
  assert.equal(/** @type {any} */ (await w.registry.apply(a2, "c1", "agent")).ok, true);
  await until(() => w.task("t2").state === "done", "t2 merged", { timeoutMs: 60_000 });
  // Merged, its try is over: Filament's send-backs count afresh for the next (the hunt on g2).
  assert.deepEqual([read(dir, "a.txt"), w.task("t2").rebases, w.task("t2").gate?.kind], [line3(`${LINES.t2}, over the folder's`), undefined, "passed"]);
  await until(() => w.task("t3").state !== "waiting", "t3 to start", { timeoutMs: 60_000 });
});

// (fails before: yes — the same: the first conflict failed the task, and nothing counted or bounded a send-back)
test("twice at most by itself: a third overlap fails the task, its words naming the ways on — the planner's send_back still goes", async () => {
  const dir = repo();
  const w = wired(dir);
  const { t2: a2 } = await readyAll(w, ["t2", "t3"]);
  for (const n of [1, 2]) {
    // The folder's line 3 changes again before each apply: the edits of someone at work there.
    writeFileSync(join(dir, "a.txt"), line3(`three, edit ${n}`));
    const answer = appliedResult(a2, /** @type {any} */ (await w.registry.apply(a2, "c1", "agent"))).text;
    assert.match(answer, new RegExp(`\\. Sent back to redo on the folder, ${n} of 2: `));
    assert.equal(w.task("t2").rebases, n);
    await until(() => w.task("t2").step === "yours", `t2 ready again, ${n}`, { timeoutMs: 60_000 });
  }
  writeFileSync(join(dir, "a.txt"), line3("three, edit 3"));
  const third = appliedResult(a2, /** @type {any} */ (await w.registry.apply(a2, "c1", "agent"))).text;
  assert.match(third, new RegExp(`^Nothing applied: 1 file does not come through cleanly — a\\.txt: [^.]+\\. Your folder is as it was\\. It was not sent back: Filament sent it back to redo on the folder twice already\\. To go on, call agent again with agent_id "${a2}", apply_changes: true and overlap: "markers" applies it all, those files with git's conflict markers for you to resolve; "mine" applies the rest and keeps your version of those files, its change to them set aside; "send_back" has it redo its change on your folder as it stands\\.$`));
  await until(() => w.task("t2").state === "failed", "t2 failed", { timeoutMs: 60_000 });
  assert.deepEqual([w.task("t2").rebases, w.task("t2").failures?.cause, read(dir, "a.txt")], [2, "merge", line3("three, edit 3")]);
  assert.match(w.task("t2").why, /^its change did not merge: 1 file does not come through cleanly — a\.txt: .*; it was not sent back: Filament sent it back to redo on the folder twice already$/);
  const end = w.end("t2");
  assert.match(end, /^\[Filament: task t2 "Name three" failed: its change did not merge: /);
  assert.match(end, new RegExp(`\\nApply it with overlap — agent with agent_id "${a2}", apply_changes: true and overlap: "markers" writes it all, git's conflict markers in the files that overlap for you to resolve; "mine" keeps your folder's version of those, its change to them set aside; "send_back" has its sub-agent redo it on your folder as it stands\\.\\n`));
  assert.equal(w.task("t3").state, "waiting");
  // The planner decides: its own send_back goes past Filament's two, and counts none.
  const asked = appliedResult(a2, /** @type {any} */ (await w.registry.apply(a2, "c1", "agent", { overlap: "send_back" })), { overlap: "send_back" }).text;
  assert.match(asked, new RegExp(`\\. Sent back to redo on the folder, as you asked: sub-agent ${a2} redoes its change on your folder as it stands now`));
  assert.equal(w.task("t2").rebases, 2);
  await until(() => w.task("t2").step === "yours", "t2 ready again, as asked", { timeoutMs: 60_000 });
  assert.equal(/** @type {any} */ (await w.registry.apply(a2, "c1", "agent")).ok, true);
  await until(() => w.task("t2").state === "done", "t2 merged", { timeoutMs: 60_000 });
  assert.equal(read(dir, "a.txt"), line3(`${LINES.t2}, over the folder's`));
});

// (fails before: yes — overlap on a graph task's apply was refused: "A task graph's change takes no overlap")
test("the planner's apply of a graph task takes overlap: markers writes it with git's markers for it to resolve, unchecked and said; mine keeps the folder's version, its change set aside and readable", async () => {
  const dir = repo();
  const w = wired(dir);
  const { t1 } = await readyAll(w, ["t1"]);
  writeFileSync(join(dir, "a.txt"), line3("three, yours"));
  const answer = /** @type {any} */ (await w.registry.apply(t1, "c1", "agent", { overlap: "markers" }));
  assert.match(appliedResult(t1, answer, { overlap: "markers" }).text, /^Applied the changes of sub-agent \S+ to your folder: 2 files \(.*\) — a\.txt, c\.txt\. Git's conflict markers stand in a\.txt: "<<<<<<< yours" over your lines, "=======", then its down to ">>>>>>> its change"\. Resolve it so it keeps what both meant, and leave no marker\./);
  assert.match(String(read(dir, "a.txt")), MARKS);
  await until(() => w.task("t1").state === "done", "t1 merged with markers", { timeoutMs: 60_000 });
  assert.deepEqual([w.task("t1").merged?.marked, w.task("t1").gate?.kind, read(dir, "c.txt")], [["a.txt"], "not", "sea\n"]);
  assert.deepEqual(w.ran.filter((c) => /-check$/.test(c.root)), [], "no check of a folder with markers in it");
  assert.match(w.end("t1"), /and its change is merged into your folder\. Git's conflict markers stand in a\.txt, for you to resolve: Filament did not check the folder with them in it\.\n/);
  // mine: the rest goes in, the folder's a.txt stays, and its change to it is read with the diff the answer gives.
  const dir2 = repo();
  const m = wired(dir2);
  const { t1: b1 } = await readyAll(m, ["t1"]);
  writeFileSync(join(dir2, "a.txt"), line3("three, yours"));
  const mine = /** @type {any} */ (await m.registry.apply(b1, "c1", "agent", { overlap: "mine" }));
  const said = appliedResult(b1, mine, { overlap: "mine" }).text;
  assert.match(said, /^Applied the changes of sub-agent \S+ to your folder: 1 file \(.*\) — c\.txt\. Kept your version of a\.txt, its change to it set aside: git diff (\w+) (\w+) -- a\.txt in your folder shows it, for 7 days or until this sub-agent's next apply\./);
  const [, base, head] = /** @type {RegExpExecArray} */ (/git diff (\w+) (\w+) --/.exec(said));
  assert.match(git(dir2, "diff", base, head, "--", "a.txt"), /\+THREE \(t1\)/);
  await until(() => m.task("t1").state === "done", "t1 merged, yours kept", { timeoutMs: 60_000 });
  assert.deepEqual([read(dir2, "a.txt"), read(dir2, "c.txt"), m.task("t1").merged?.kept, m.task("t1").gate?.kind], [line3("three, yours"), "sea\n", ["a.txt"], "passed"]);
});

// (fails before: yes — a restart failed a task sent back to rebase whose worker had not gone on with it yet)
test("a restart while a task is sent back keeps it waiting, its counter kept: a new builder redoes it on the folder as it stands, and it merges", async () => {
  const dir = repo();
  const w = wired(dir);
  const { t1: a1, t2: a2 } = await readyAll(w, ["t1", "t2"]);
  assert.equal(/** @type {any} */ (await w.registry.apply(a1, "c1", "agent")).ok, true);
  await until(() => w.task("t1").state === "done", "t1 merged", { timeoutMs: 60_000 });
  // No turn runs: sent back, it waits for its builder to go on with it, and Filament restarts first.
  w.graphs.detach("c1", "turn-1");
  assert.match(appliedResult(a2, /** @type {any} */ (await w.registry.apply(a2, "c1", "agent"))).text, /Sent back to redo on the folder, 1 of 2/);
  assert.deepEqual([w.task("t2").state, w.task("t2").resume], ["waiting", a2]);
  const later = wired(dir, w.chains);
  assert.equal(later.graphs.reconcile(), 1);
  assert.deepEqual([later.task("t2").state, later.task("t2").resume, later.task("t2").rebases], ["waiting", null, 1]);
  assert.match(later.end("t2"), new RegExp(`^\\[Filament: task t2 "Name three" was sent back to redo on the folder, 1 of 2, and a Filament restart came before sub-agent ${a2} went on with it: a new sub-agent takes it from your folder as it stands, the earlier try in its brief\\. Nothing of it was written into your folder\\.`));
  later.turn("turn-2");
  await until(() => later.task("t2")?.step === "yours", "t2 ready from a new builder", { timeoutMs: 60_000 });
  const fresh = String(later.task("t2").agent);
  assert.notEqual(fresh, a2);
  assert.match(JSON.stringify(later.posts[0].body.messages), /An earlier try at this task ended: /);
  assert.equal(/** @type {any} */ (await later.registry.apply(fresh, "c1", "agent")).ok, true);
  await until(() => later.task("t2").state === "done", "t2 merged", { timeoutMs: 60_000 });
  assert.deepEqual([read(dir, "a.txt"), later.task("t2").rebases], [line3(LINES.t2), undefined], "kept across the restart, cleared once it merges");
});

/** A graph of three writers of a.txt and one of docs, by the core alone. */
const shared = () => {
  const added = /** @type {any} */ (tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [
    { id: "w1", name: "One", by: "sub-agent", writes: ["a.txt"], goal: "g", steps: ["s"], acceptance: "a" },
    { id: "w2", name: "Two", by: "sub-agent", writes: ["notes/w2.txt"], goal: "g", steps: ["s"], acceptance: "a" },
    { id: "w3", name: "Three", by: "sub-agent", writes: ["notes/w3.txt"], goal: "g", steps: ["s"], acceptance: "a" },
    { id: "d1", name: "Docs", by: "sub-agent", writes: ["docs/x.md"], goal: "g", steps: ["s"], acceptance: "a" },
  ] }, { at: 1, crew: "agent" }));
  assert.ok(added.ok, added.error);
  /** @type {any} */
  let g = added.graph;
  for (const t of g.tasks) if (t.id === "w2" || t.id === "w3") t.writes = ["a.txt"];
  const files = [{ path: "a.txt", added: 1, removed: 1 }];
  for (const [id, agent] of [["w1", "sa-1"], ["w2", "sa-2"], ["w3", "sa-3"]]) {
    g = tg.launched(g, id, agent, 2, "sub-agent");
    g = /** @type {any} */ (tg.taskEnded(g, id, /** @type {any} */ ({ agent, status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Did it.", met: true, evidence: "ok", left: "" }, words: "", files, shared: false, wrote: false, workError: null, ran: [], calls: [], written: [], spentUsd: 0, ms: 1, cut: false }), 3)).graph;
  }
  return g;
};
/** The view's word on a task's shares. @param {any} g @param {string} id */
const sharesOf = (g, id) => /** @type {any} */ (tg.graphView(g))?.tasks.find((/** @type {any} */ t) => t.id === id).shares ?? null;

// (fails before: yes — the Plan named nothing of who shares a task's files, nor how its merge stood)
test("the Plan names, per task, the other open tasks it shares written files with, and how its merge stands: in line behind another, merged clean, with markers, sent back", () => {
  let g = shared();
  assert.deepEqual(sharesOf(g, "w1"), { with: ["w2", "w3"], files: ["a.txt"], merge: null });
  assert.equal(sharesOf(g, "d1"), null, "it shares nothing");
  g = /** @type {any} */ (tg.applyAsked(g, "sa-1")).graph;
  g = /** @type {any} */ (tg.applyAsked(g, "sa-2")).graph;
  assert.deepEqual([sharesOf(g, "w1").merge, sharesOf(g, "w2").merge], ["merging, three-way", "merging behind w1, three-way"]);
  g = tg.taskMerged(g, "w1", [{ path: "a.txt", added: 1, removed: 1 }], 4);
  assert.deepEqual(sharesOf(g, "w1"), { with: ["w2", "w3"], files: ["a.txt"], merge: "merged clean" });
  assert.equal(sharesOf(g, "w2").merge, "merging, three-way");
  // Sent back by the merge: the count of Filament's own two.
  const back = /** @type {any} */ (tg.sentToRebase(g, "sa-2", "redo it", { asked: false, why: "1 file does not come through cleanly — a.txt: both changed the same lines" }));
  assert.ok(back);
  g = back.graph;
  assert.deepEqual(sharesOf(g, "w2"), { with: ["w3"], files: ["a.txt"], merge: "sent back to redo, 1 of 2" });
  // The task's box shows it as a chip, its words whole in its title.
  const el = drawGraph(/** @type {any} */ (tg.graphView(g)), { h: fakeH, now: 10_000 }).el;
  /** @param {any} n @returns {any[]} */
  const nodes = (n) => (n && typeof n === "object" ? [...(String(n.attrs?.class || "").split(/\s+/).includes("tg-node") ? [n] : []), ...(n.kids || []).flatMap(nodes)] : []);
  const box = nodes(el).find((n) => String(n.attrs["aria-label"]).startsWith("w2 "));
  assert.match(textOf(box), /\|shares a\.txt with w3 · sent back to redo, 1 of 2$/);
  assert.match(String(box.attrs.title), /\nShares a\.txt with w3 · sent back to redo, 1 of 2/);
  g = /** @type {any} */ (tg.applyAsked(g, "sa-3")).graph;
  g = tg.taskMerged(g, "w3", [{ path: "a.txt", added: 1, removed: 1 }], 5, null, { marked: ["a.txt", "b.txt"] });
  assert.deepEqual(sharesOf(g, "w3"), { with: ["w2"], files: ["a.txt"], merge: "markers in 2 files, resolving" });
});

// (fails before: no — tried for the hunt on g2: a second apply while a task its merge sent back waits for its builder,
// and as its builder goes on, never writes the marked rebase into the folder)
test("a second apply while a task its merge sent back waits for its builder, or as the builder goes on, is refused and writes nothing", async () => {
  const dir = repo();
  const w = wired(dir);
  const { t1: a1, t2: a2 } = await readyAll(w, ["t1", "t2"]);
  assert.equal(/** @type {any} */ (await w.registry.apply(a1, "c1", "agent")).ok, true);
  await until(() => w.task("t1").state === "done", "t1 merged", { timeoutMs: 60_000 });
  // No turn runs: sent back, its builder has not gone on with it — the window the hunt named.
  w.graphs.detach("c1", "turn-1");
  assert.match(appliedResult(a2, /** @type {any} */ (await w.registry.apply(a2, "c1", "agent"))).text, /Sent back to redo on the folder, 1 of 2/);
  assert.deepEqual([w.task("t2").state, w.task("t2").resume], ["waiting", a2]);
  for (const by of /** @type {const} */ (["agent", "owner"])) {
    const again = /** @type {any} */ (await w.registry.apply(a2, "c1", by));
    assert.equal(again.ok, false, `${by}: ${JSON.stringify(again)}`);
    assert.equal(read(dir, "a.txt"), line3(LINES.t1), `${by}: nothing of t2's is in the folder`);
  }
  // Its builder goes on as a turn runs: an apply then finds it at work.
  w.turn("turn-2");
  const during = /** @type {any} */ (await w.registry.apply(a2, "c1", "agent"));
  assert.equal(during.ok, false, JSON.stringify(during));
  assert.equal(read(dir, "a.txt"), line3(LINES.t1));
  await until(() => w.task("t2").step === "yours", "t2 ready again", { timeoutMs: 60_000 });
  assert.equal(read(dir, "a.txt"), line3(LINES.t1), "redone, it waits for its apply: nothing in the folder");
});
