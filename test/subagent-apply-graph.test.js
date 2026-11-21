// @ts-check
// The owner's of 11-02 (efficiency plan, step 3), for real: the sub-agent registry and the graph runner wired as the
// server wires them, over a git repository. A graph worker's finished change is not written into the folder by
// Filament; the main agent's apply_changes takes it the graph's way — the call answers once the change is in, the
// folder's check still running — and the check's verdict comes after, as the task's end, the tasks that need it
// starting then. And the registry's half of the batched wake: a graph end held for the graph's other workers wakes no
// wait and no chat, until `wake`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchHand } from "../src/adapters/tools/patch-hands.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { appliedResult, createSubagentRegistry } from "../src/app/agent/subagents.js";
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
/** A repository with one file committed. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-apply-graph-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "shared.txt"), "line 1\n");
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
const pass = (/** @type {string} */ output) => ({ exit: 0, output, stopped: false });
const fail = (/** @type {string} */ output) => ({ exit: 1, output, stopped: false });

/**
 * The registry and the graph runner over `dir`, wired as server.js wires them: a worker's end reaches the runner, an
 * apply of the agent's reaches the runner's `applyAsked`, the developer's apply its `applied`. Each worker's run writes
 * what `runs` scripts; `check a` passes where a.txt holds "A"; `gate`, set, holds each run in the folder's check
 * worktree until the test lets it go, or its check is cut; `refuseKeeps`: how many of the session's next writes fail,
 * `refuseReads` its next reads; `pagesBreak`: how many of the graph's next page events throw; `graphBreaks`: how many
 * of the agent's next applies throw once the graph has taken them. What the runner tells the planner is kept.
 * `workspace`: the session's `subagents.workspace`, where a test reads its workers' copies on their disk.
 * @param {string} dir @param {string | null} [workspace]
 */
const wired = (dir, workspace = null) => {
  /** @type {any[]} */
  const told = [];
  /** @type {((o: { host: any, body: any }) => any)[]} */
  const runs = [];
  /** @type {any[]} */
  const posts = [];
  const state = { gate: /** @type {Promise<any> | null} */ (null), refuseKeeps: 0, refuseReads: 0, pagesBreak: 0, graphBreaks: 0 };
  /** Each check run: its command and where. @type {{ command: string, root: string }[]} */
  const ran = [];
  /** @type {any} */
  let graphs = null;
  const doc = { subagents: { pool: [{ model: "", seats: 8 }], ...(workspace ? { workspace } : {}) }, loop: { permissions: "edit", rules: [], verify: {} } };
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    runCheck: async (/** @type {string} */ command, /** @type {{ root: string, signal?: AbortSignal }} */ { root, signal }) => {
      ran.push({ command, root });
      if (/-check$/.test(root) && state.gate) {
        /** @type {Promise<any>} */
        const cut = new Promise((done) => (signal?.aborted ? done({ exit: null, output: "", stopped: true }) : signal?.addEventListener("abort", () => done({ exit: null, output: "", stopped: true }), { once: true })));
        return Promise.race([state.gate, cut]);
      }
      return command === "check a" ? (read(root, "a.txt") === "A\n" ? pass("PASS a") : fail("FAIL a")) : pass("ok");
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
      taskApply: (/** @type {any} */ o) => {
        const r = graphs?.applyAsked(o) ?? null;
        if (state.graphBreaks > 0) {
          state.graphBreaks -= 1;
          throw new Error("the line to the graph broke");
        }
        return r;
      },
      workApplied: (/** @type {any} */ o) => graphs?.applied(o),
    },
    call: async ({ body, headers = {} }) => {
      const id = String(headers["x-filament-subagent"]);
      const host = registry.hostOf(id);
      posts.push({ body, host });
      const runId = `run-${posts.length}`;
      registry.attach(id, runId);
      await (runs.shift() || (() => {}))({ host, body });
      registry.finish(id, { status: "done", error: null, report: "Reported.", stoppedBy: null, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Reported." }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0.01, roundIds: [runId], taskReport: { status: "done", did: "Did it.", met: true, evidence: "it passed", left: "" } });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "Reported." }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: {} }]]);
  const archive = {
    /** @param {string} id @param {readonly string[]} keys */
    metaOf: (id, keys) => {
      const c = chains.get(id);
      if (state.refuseReads > 0) {
        state.refuseReads -= 1;
        throw new Error("database is locked");
      }
      return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
    },
    /** @param {string} id @param {Record<string, any>} patch */
    mergeMeta: (id, patch) => {
      const c = chains.get(id);
      if (!c) return null;
      if (state.refuseKeeps > 0) {
        state.refuseKeeps -= 1;
        throw new Error("database is locked");
      }
      c.meta = structuredClone({ ...c.meta, ...patch });
      return c.meta;
    },
    openGraphs: () => [],
  };
  /** A page that hears the graph, and breaks while `pagesBreak` says so. @param {string} topic */
  const publish = (topic) => {
    if (topic === "graph" && state.pagesBreak > 0) {
      state.pagesBreak -= 1;
      throw new Error("a page that hears the graph broke");
    }
  };
  graphs = createGraphRunner({ archive, registry: /** @type {any} */ ({ ...registry, tell: (/** @type {string} */ c, /** @type {any} */ d) => (told.push(d), registry.tell(c, d)) }), events: { publish }, crew: () => "agent", log: () => {} });
  /** @param {string} id @returns {any} */
  const task = (id) => chains.get("c1").meta.graph?.tasks.find((/** @type {any} */ t) => t.id === id);
  return { registry, graphs, told, runs, posts, state, task, ran };
};
/** A run that writes these files in its worktree. @param {Record<string, string>} files */
const writes = (files) => (/** @type {{ host: any }} */ { host }) => {
  for (const [f, s] of Object.entries(files)) writeFileSync(join(host.workdir, f), s);
};

// (fails before: yes — the runner merged t1's change into the folder as its worker ended, and the agent's apply_changes
// of a graph worker was a plain apply that told the graph nothing of a check)
test("a graph worker's change waits in its copy until the agent applies it; the apply answers once it is in, the check's verdict comes after, and what needs it starts then", async () => {
  const dir = repo();
  // In worktrees: t2's copy is read on its disk (a patch's, through its own tools, is the test after this one).
  const w = wired(dir, "worktree");
  w.runs.push(writes({ "a.txt": "A\n" }), writes({ "b.txt": "B\n" }));
  const add = w.graphs.apply("c1", { action: "add", goal: "Ship", tasks: [
    { id: "t1", name: "Write a", by: "sub-agent", writes: ["a.txt"], goal: "a.txt holds A", steps: ["Write it"], acceptance: "check a passes", check: ["check a"] },
    { id: "t2", name: "Write b", needs: ["t1"], by: "sub-agent", writes: ["b.txt"], goal: "b.txt holds B", steps: ["Write it"], acceptance: "b.txt is there" },
  ] }, { crew: "agent" });
  assert.ok(add.ok, add.ok ? "" : add.error);
  w.graphs.attach("c1", { runId: "turn-1", cwd: dir, mode: null, model: "m", thinking: null, team: null });
  await until(() => w.task("t1")?.step === "yours", "t1 ready", { timeoutMs: 60_000 });
  const agent = String(w.task("t1").agent);
  // Ready: nothing written into the folder, nothing that needs it started, its check passed in its copy.
  assert.deepEqual([read(dir, "a.txt"), w.posts.length, w.task("t2").state, w.task("t1").verdict.kind], [null, 1, "waiting", "passed"]);
  assert.match(w.told.at(-1).text, new RegExp(`is ready: .* apply it when you choose — agent with agent_id "${agent}" and apply_changes: true\\.`));
  // The agent applies it while the folder's check of it is held: the call answers with the change in, the check running.
  /** @type {(v: any) => void} */
  let free = () => {};
  w.state.gate = new Promise((go) => (free = go));
  const answer = /** @type {any} */ (await w.registry.apply(agent, "c1", "agent"));
  assert.deepEqual([answer.ok, answer.files.map((/** @type {any} */ f) => f.path), answer.check?.kind, answer.check?.command], [true, ["a.txt"], "late", "check a"]);
  assert.equal(read(dir, "a.txt"), "A\n", "in the folder as the call answers");
  assert.match(appliedResult(agent, answer).text, new RegExp(`^Applied the changes of sub-agent ${agent} to your folder: 1 file \\(\\+1 −0\\) — a\\.txt\\. Filament checks the folder with them now \\(\`check a\`, .* so far\\), and undoes the apply if they break it: what comes of it reaches you as a message\\.$`));
  assert.deepEqual([w.task("t1").state, w.task("t1").step, w.posts.length], ["merging", null, 1], "merging, its check running: t2 still waits");
  assert.equal(w.told.filter((d) => d.task === "t1").length, 1, "nothing told of the verdict yet");
  // The developer's own Apply meanwhile writes nothing twice: refused in words, the checked apply's end to come.
  assert.deepEqual(await w.registry.apply(agent, "c1", "owner"), { ok: false, error: `sub-agent ${agent}'s work is being applied now, and the folder checked with it — its end comes as a message` });
  // The verdict: t1 done, told, waking the planner, and t2 starts from the folder with t1's change.
  free(pass("PASS a"));
  await until(() => w.task("t1").state === "done", "t1 done", { timeoutMs: 60_000 });
  const verdict = w.told.filter((d) => d.task === "t1").at(-1);
  assert.match(verdict.text, /^\[Filament: task t1 "Write a" is done: .* and its change is merged into your folder\. Filament's check of the folder with it passed: `check a` passed/);
  assert.equal(verdict.wakes, true);
  await until(() => w.posts.length === 2, "t2 to start", { timeoutMs: 60_000 });
  assert.equal(read(w.posts[1].host.workdir, "a.txt"), "A\n", "t2's copy holds t1's change");
  await until(() => w.task("t2")?.step === "yours", "t2 ready", { timeoutMs: 60_000 });
  assert.equal(read(dir, "b.txt"), null, "t2's change waits for its apply too");
});

// (fails before: no — the counterpart of the one above for a patch: t2, with no check of its own, works in one — no
// checkout — and reads t1's change through its own read hand)
test("a graph task in a patch reads the change of the task it needs through its own tools, once that change is merged", async () => {
  const dir = repo();
  const w = wired(dir);
  /** @type {{ patch: boolean, a: string }[]} */
  const saw = [];
  w.runs.push(writes({ "a.txt": "A\n" }), async ({ host }) => {
    const o = { root: host.workdir, fenced: true, seen: new Map() };
    saw.push({ patch: !!host.workspace, a: String(await patchHand("read", { path: "a.txt" }, host.workspace, o)) });
    await patchHand("write", { path: "b.txt", content: "B\n" }, host.workspace, o);
  });
  const add = w.graphs.apply("c1", { action: "add", goal: "Ship", tasks: [
    { id: "t1", name: "Write a", by: "sub-agent", writes: ["a.txt"], goal: "a.txt holds A", steps: ["Write it"], acceptance: "check a passes", check: ["check a"] },
    { id: "t2", name: "Write b", needs: ["t1"], by: "sub-agent", writes: ["b.txt"], goal: "b.txt holds B", steps: ["Write it"], acceptance: "b.txt is there" },
  ] }, { crew: "agent" });
  assert.ok(add.ok, add.ok ? "" : add.error);
  w.graphs.attach("c1", { runId: "turn-1", cwd: dir, mode: null, model: "m", thinking: null, team: null });
  await until(() => w.task("t1")?.step === "yours", "t1 ready", { timeoutMs: 60_000 });
  const answer = /** @type {any} */ (await w.registry.apply(String(w.task("t1").agent), "c1", "agent"));
  assert.equal(answer.ok, true, answer.error);
  await until(() => w.task("t1").state === "done", "t1 done", { timeoutMs: 60_000 });
  await until(() => w.task("t2")?.step === "yours", "t2 ready", { timeoutMs: 60_000 });
  assert.deepEqual(saw, [{ patch: true, a: "     1\tA" }], "t2 worked in a patch, and read t1's change there");
  assert.deepEqual(/** @type {any} */ (w.registry.get(String(w.task("t2").agent)))?.work?.files.map((/** @type {any} */ f) => f.path), ["b.txt"], "its own change alone waits: t1's was its start");
  assert.equal(read(dir, "b.txt"), null, "t2's change waits for its apply too");
});

/** Two writers side by side, each with a check that passes in its copy. */
// (fails before: yes — the owner's of 11-09: overlap did not exist. Then a graph task's change took none of it, refused
// where it overlapped the folder; since g2 its planner's mine keeps the folder's version, its change set aside — and its
// own check, which passed on a change no longer all in, does not send back a change that wrote nothing)
test("a graph task's change takes mine: the folder's file is kept, its change to it set aside and readable, nothing written, and the task done with the folder's red said", async () => {
  const dir = repo();
  const w = wired(dir);
  w.runs.push(writes({ "a.txt": "A\n" }));
  const add = w.graphs.apply("c1", { action: "add", goal: "Ship", tasks: [{ id: "t1", name: "Write a", by: "sub-agent", writes: ["a.txt"], goal: "a.txt holds A", steps: ["Write it"], acceptance: "check a passes", check: ["check a"] }] }, { crew: "agent" });
  assert.ok(add.ok, add.ok ? "" : add.error);
  w.graphs.attach("c1", { runId: "turn-1", cwd: dir, mode: null, model: "m", thinking: null, team: null });
  await until(() => w.task("t1")?.step === "yours", "t1 ready", { timeoutMs: 60_000 });
  const agent = String(w.task("t1").agent);
  writeFileSync(join(dir, "a.txt"), "MINE\n");
  const r = /** @type {any} */ (await w.registry.apply(agent, "c1", "agent", { overlap: "mine" }));
  const said = appliedResult(agent, r, { overlap: "mine" }).text;
  assert.match(said, new RegExp(`^Applied the changes of sub-agent ${agent} with nothing written\\. Kept your version of a\\.txt, its change to it set aside: git diff (\\w+) (\\w+) -- a\\.txt in your folder shows it, for 7 days or until this sub-agent's next apply\\.`));
  const [, base, head] = /** @type {RegExpExecArray} */ (/git diff (\w+) (\w+) --/.exec(said));
  assert.match(git(dir, "diff", base, head, "--", "a.txt"), /\+A$/m);
  assert.equal(read(dir, "a.txt"), "MINE\n", "nothing written");
  await until(() => w.task("t1").state === "done", "t1 done, the folder's kept", { timeoutMs: 60_000 });
  assert.deepEqual([w.task("t1").merged?.kept, w.task("t1").gate?.kind, read(dir, "a.txt")], [["a.txt"], "red", "MINE\n"], "not sent back: it wrote nothing for its check to break");
});

const PAIR = { action: "add", goal: "Ship", tasks: [
  { id: "t1", name: "Write a", by: "sub-agent", writes: ["a.txt"], goal: "a.txt holds A", steps: ["Write it"], acceptance: "check a passes", check: ["check a"] },
  { id: "t2", name: "Write b", by: "sub-agent", writes: ["b.txt"], goal: "b.txt holds B", steps: ["Write it"], acceptance: "check b passes", check: ["check b"] },
] };

// (fails before: yes — the apply's answer carried what it wrote, and the verdict's end carried the same files again)
test("one apply records what it wrote once: with the call that answered as it went in, the verdict carrying none", async () => {
  const dir = repo();
  const w = wired(dir);
  w.runs.push(writes({ "a.txt": "A\n" }));
  const add = w.graphs.apply("c1", { ...PAIR, tasks: [PAIR.tasks[0]] }, { crew: "agent" });
  assert.ok(add.ok, add.ok ? "" : add.error);
  w.graphs.attach("c1", { runId: "turn-1", cwd: dir, mode: null, model: "m", thinking: null, team: null });
  await until(() => w.task("t1")?.step === "yours", "t1 ready", { timeoutMs: 60_000 });
  const agent = String(w.task("t1").agent);
  /** @type {(v: any) => void} */
  let free = () => {};
  w.state.gate = new Promise((go) => (free = go));
  const answered = appliedResult(agent, /** @type {any} */ (await w.registry.apply(agent, "c1", "agent")));
  assert.deepEqual([answered.wrote, answered.writes?.paths.map((p) => p.replace(/\\/g, "/").split("/").pop())], [true, ["a.txt"]], "the call records it");
  free(pass("PASS a"));
  await until(() => w.task("t1").state === "done", "t1 done", { timeoutMs: 60_000 });
  const verdict = w.told.filter((d) => d.task === "t1").at(-1);
  assert.deepEqual([verdict.wrote, "writes" in verdict], [false, false], "the verdict does not record it again");
});

// (fails before: yes — waiting behind an apply still going in, the words said Filament was checking the folder with it)
test("an apply waiting behind another says what is ahead of it: that one going in, or in and being checked", () => {
  const writing = appliedResult("sa-2", { ok: true, files: [], repo: "/p", check: { kind: "waiting", behind: "sa-1", writing: true } });
  assert.equal(writing.text, "Not applied yet: sub-agent sa-1's change, applied before this one, is going into your folder now. Sub-agent sa-2's goes in once that apply — and Filament's check of your folder with it, where there is one — has ended, and what comes of it reaches you as a message.");
  assert.equal(writing.note, "agent: sub-agent sa-2's changes wait to be applied, behind the apply of sa-1's");
  const checking = appliedResult("sa-2", { ok: true, files: [], repo: "/p", check: { kind: "waiting", behind: "sa-1" } });
  assert.match(checking.text, /^Not applied yet: Filament is still checking your folder with sub-agent sa-1's change, applied before this one\./);
  assert.equal(checking.note, "agent: sub-agent sa-2's changes wait to be applied, behind the folder's check of sa-1's");
});

/** Two ready changes, each in its worker's copy. @param {string} dir */
const pairReady = async (dir) => {
  const w = wired(dir);
  // The two start side by side: each writes its own task's file, whichever calls first.
  const own = (/** @type {{ host: any, body: any }} */ o) => (JSON.stringify(o.body.messages).includes("a.txt holds A") ? writes({ "a.txt": "A\n" }) : writes({ "b.txt": "B\n" }))(o);
  w.runs.push(own, own);
  const add = w.graphs.apply("c1", PAIR, { crew: "agent" });
  assert.ok(add.ok, add.ok ? "" : add.error);
  w.graphs.attach("c1", { runId: "turn-1", cwd: dir, mode: null, model: "m", thinking: null, team: null });
  await until(() => w.task("t1")?.step === "yours" && w.task("t2")?.step === "yours", "both ready", { timeoutMs: 60_000 });
  return { w, a1: String(w.task("t1").agent), a2: String(w.task("t2").agent) };
};

/**
 * Two ready changes, t1's applied by the agent and in the folder, its check held — the gate the test lets go with `free`.
 * @param {string} dir
 */
const firstIn = async (dir) => {
  const { w, a1, a2 } = await pairReady(dir);
  /** @type {{ free: (v: any) => void }} */
  const gate = { free: () => {} };
  w.state.gate = new Promise((go) => (gate.free = go));
  assert.equal(/** @type {any} */ (await w.registry.apply(a1, "c1", "agent")).check?.kind, "late", "t1 in, its check held");
  return { w, a1, a2, free: (/** @type {any} */ v) => gate.free(v) };
};

// (fails before: yes — the developer's Apply in the moment between the agent's apply and its merge opening went through,
// and the task then failed as "no changes waiting" with its change in the folder)
test("an apply the agent asked holds its change from its call on: the developer's Apply meanwhile is refused, and the agent's apply waits behind the one ahead, saying so", async () => {
  const dir = repo();
  const { w, a1, a2, free } = await firstIn(dir);
  const second = w.registry.apply(a2, "c1", "agent");
  assert.deepEqual(await w.registry.apply(a2, "c1", "owner"), { ok: false, error: `sub-agent ${a2}'s work is being applied now, and the folder checked with it — its end comes as a message` });
  const waits = appliedResult(a2, /** @type {any} */ (await second));
  assert.match(waits.text, new RegExp(`^Not applied yet: Filament is still checking your folder with sub-agent ${a1}'s change, applied before this one\\.`));
  assert.equal(read(dir, "b.txt"), null);
  // The agent's apply goes in its turn, checked.
  free(pass("ok"));
  await until(() => w.task("t2").state === "done", "t2 done", { timeoutMs: 60_000 });
  assert.deepEqual([w.task("t2").gate?.kind, read(dir, "b.txt")], ["passed", "B\n"]);
});

// (fails before: yes — the developer's Send back took up the work of an apply waiting its turn: it checked an apply under
// way, and none that waited)
test("the developer's Send back of a change the agent applied, waiting its turn, is refused", async () => {
  const dir = repo();
  const { w, a2, free } = await firstIn(dir);
  assert.equal(/** @type {any} */ (await w.registry.apply(a2, "c1", "agent")).check?.kind, "waiting");
  assert.deepEqual(await w.registry.rebase(a2, "c1"), { ok: false, error: `sub-agent ${a2}'s work is being applied now` });
  free(pass("ok"));
  await until(() => w.task("t2").state === "done", "t2 done", { timeoutMs: 60_000 });
  assert.deepEqual([w.task("t2").gate?.kind, read(dir, "b.txt")], ["passed", "B\n"]);
});

// (fails before: yes — the developer's Stop cut the check of the merge that ran alone, so a change the agent applied that
// waited its turn was checked all the same)
test("the developer's stop cuts the check of each merge the agent applied: the one running, and the one waiting its turn — each stands, unchecked, said", async () => {
  const dir = repo();
  const { w, a2, free } = await firstIn(dir);
  assert.equal(/** @type {any} */ (await w.registry.apply(a2, "c1", "agent")).check?.kind, "waiting");
  w.graphs.stop("c1");
  free(pass("ok"));
  await until(() => w.task("t2").state === "done", "t2 done", { timeoutMs: 60_000 });
  assert.deepEqual([w.task("t1").gate?.kind, w.task("t2").gate?.kind], ["not", "not"]);
  assert.deepEqual([read(dir, "a.txt"), read(dir, "b.txt")], ["A\n", "B\n"]);
  assert.match(w.told.filter((d) => d.task === "t2").at(-1).text, /^\[Filament: task t2 "Write b" is done: .* and its change is merged into your folder\. Filament's check of the folder with it was cut before it finished: the merge stands, unchecked\.\n/);
});

// (fails before: yes — Filament stopping cut the check of the merge its graph had in hand; a change the agent applied that
// its graph had not taken up — its merge pass broken, the session refusing a write — was checked all the same)
test("Filament stopping cuts the check of a change the agent applied that its graph has not taken up: it stands, unchecked, said", async () => {
  const dir = repo();
  const { w, a2, free } = await firstIn(dir);
  assert.equal(/** @type {any} */ (await w.registry.apply(a2, "c1", "agent")).check?.kind, "waiting");
  // t1's end is not kept: the graph's merge pass breaks, and t2 waits, its apply opened, for a pass to take it up.
  w.state.refuseKeeps = 1;
  w.registry.shutdown();
  free(pass("ok"));
  await until(() => read(dir, "b.txt") === "B\n", "t2 in the folder", { timeoutMs: 60_000 });
  // Nothing takes t2 up for a while: its check would run now, were it not cut.
  await new Promise((done) => setTimeout(done, 1500));
  assert.deepEqual(w.ran.filter((c) => c.command === "check b" && /-check$/.test(c.root)), [], "t2's check never ran in the folder's copy");
  // The graph's next pass takes it up: it stands, unchecked, said.
  await until(() => w.task("t2").state === "done", "t2 done", { timeoutMs: 60_000 });
  assert.equal(w.task("t2").gate?.kind, "not");
  assert.match(w.told.filter((d) => d.task === "t2").at(-1).text, /Filament's check of the folder with it was cut before it finished: the merge stands, unchecked\.\n/);
});

// (fails before: yes — the throw escaped the agent's apply, and the apply it had asked stayed asked: every later apply of
// that worker waited on it for good, and the developer's Apply was refused as "being applied now")
test("an apply the graph could not take — reading it threw — opens nothing and says so: the change stays ready, and the agent's next apply, or the developer's, goes in", async () => {
  const dir = repo();
  const { w, a1, a2 } = await pairReady(dir);
  w.state.refuseReads = 1;
  const failed = /** @type {any} */ (await w.registry.apply(a1, "c1", "agent"));
  assert.equal(appliedResult(a1, failed).text, "Nothing applied: the apply failed (database is locked). Your folder is as it was.");
  assert.deepEqual(failed, { ok: false, error: "the apply failed (database is locked)" });
  assert.deepEqual([w.task("t1").state, w.task("t1").step, read(dir, "a.txt")], ["merging", "yours", null], "ready, nothing in the folder");
  // The agent applies it again: it goes in, checked.
  assert.equal(/** @type {any} */ (await w.registry.apply(a1, "c1", "agent")).ok, true);
  await until(() => w.task("t1").state === "done", "t1 done", { timeoutMs: 60_000 });
  // The other's agent apply throws the same way; the developer's own Apply of it after is no one's to refuse.
  w.state.refuseReads = 1;
  assert.equal(/** @type {any} */ (await w.registry.apply(a2, "c1", "agent")).ok, false);
  const own = /** @type {any} */ (await w.registry.apply(a2, "c1", "owner"));
  assert.deepEqual([own.ok, read(dir, "b.txt")], [true, "B\n"]);
  await until(() => w.task("t2").state === "done", "t2 done by the developer's apply", { timeoutMs: 60_000 });
  assert.equal(w.graphs.owes("c1"), null);
});

// (fails before: yes — the graph kept the task merging, then a page that hears the graph threw: the throw escaped the
// agent's apply, no merge of it began, and every turn owed it for good)
test("an apply the graph kept goes on though a page that hears the graph broke: the change goes in and its verdict comes", async () => {
  const dir = repo();
  const { w, a1 } = await pairReady(dir);
  w.state.pagesBreak = 1;
  assert.equal(/** @type {any} */ (await w.registry.apply(a1, "c1", "agent")).ok, true);
  assert.equal(read(dir, "a.txt"), "A\n");
  await until(() => w.task("t1").state === "done", "t1 done", { timeoutMs: 60_000 });
  assert.match(w.told.filter((d) => d.task === "t1").at(-1).text, /^\[Filament: task t1 "Write a" is done: .* and its change is merged into your folder\./);
  assert.equal(w.graphs.owes("c1"), null);
});

// (fails before: yes — the throw escaped the agent's apply after the graph took it: the merge the graph began waited on
// that apply for good, holding the session's merges, and the turn owed it)
test("an apply that threw once the graph took it opens nothing and says so: the graph's merge of it ends failed, saying why, and the agent's next apply goes in", async () => {
  const dir = repo();
  const { w, a1 } = await pairReady(dir);
  w.state.graphBreaks = 1;
  assert.deepEqual(await w.registry.apply(a1, "c1", "agent"), { ok: false, error: "the apply failed (the line to the graph broke)" });
  await until(() => w.task("t1").state === "failed", "t1 failed", { timeoutMs: 60_000 });
  assert.deepEqual([w.task("t1").why, read(dir, "a.txt"), w.graphs.owes("c1")], ["its change did not merge: the apply failed (the line to the graph broke)", null, null]);
  assert.equal(/** @type {any} */ (await w.registry.apply(a1, "c1", "agent")).ok, true);
  await until(() => w.task("t1").state === "done", "t1 done", { timeoutMs: 60_000 });
  assert.equal(read(dir, "a.txt"), "A\n");
});

// (fails before: yes — a graph end woke every wait as it came, and no `wake` was there)
test("the registry: a graph end held for the graph's other workers wakes no wait and no chat; wake lets it go — into the running turn, or the chat goes on by itself", async () => {
  /** @type {string[]} */
  const woken = [];
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: { settings: () => ({}), session: () => null, view: async () => null, brief: async () => null, modelProblem: () => null, mark: () => null, reportWaits: (/** @type {string} */ c) => void woken.push(c) },
  });
  const d = (/** @type {string} */ task, /** @type {Record<string, any>} */ more = {}) => ({ text: `[Filament: task ${task} ended]`, from: "sa-1", description: `${task}: x`, task, spends: [], wrote: false, ...more });
  // No turn: held, it waits in the queue; the graph's wake makes it due and wakes the chat.
  registry.tell("c1", d("t1", { held: true }));
  assert.deepEqual([registry.reportsDue("c1"), woken], [false, []]);
  registry.wake("c1");
  assert.deepEqual([registry.reportsDue("c1"), woken], [true, ["c1"]]);
  registry.wake("c1");
  assert.deepEqual(woken, ["c1"], "once: nothing held waits now");
  // An end the runner says wakes: the chat goes on by itself to read it, as a report.
  registry.tell("c2", d("t2", { wakes: true }));
  assert.deepEqual([registry.reportsDue("c2"), woken], [true, ["c1", "c2"]]);
  // A running turn: a held end is no arrival; the next one, not held, is — and the take carries both.
  const door = registry.openTurn({ chainId: "c3", runId: "r1", cwd: "/p", mode: null, model: "m", thinking: null, fork: null });
  registry.tell("c3", d("t1", { held: true }));
  const quiet = await Promise.race([door.inbox.arrival().then(() => "arrived"), new Promise((r) => setTimeout(r, 50, "quiet"))]);
  assert.equal(quiet, "quiet");
  const arriving = door.inbox.arrival();
  registry.tell("c3", d("t2"));
  await arriving;
  assert.deepEqual(door.inbox.take().filter((x) => x.kind === "task").map((x) => x.task), ["t1", "t2"]);
  // Held alone, then the graph goes quiet: wake lets the turn's wait go.
  registry.tell("c3", d("t3", { held: true }));
  const waiting = door.inbox.arrival();
  registry.wake("c3");
  await waiting;
  assert.deepEqual(door.inbox.take().filter((x) => x.kind === "task").map((x) => x.task), ["t3"]);
  door.close();
});
