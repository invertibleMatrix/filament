// @ts-check
// The loop's mid-turn nudges reach a coding agent too (the owner's of 11-10: every nudge reaches Filament's loop and the
// coding agents alike; checkpoint.js "action" and "note"): the line that asks for a plan once the agent changed a second
// file with neither a checklist nor a task graph, and the line that says which task of its own the person's words came
// during. A Claude-shaped fake takes them queued, at its next step (fixtures/fake-acp-agent.mjs `~queue`, `~twoedits`);
// Cursor's SDK fake takes them live, into its run (fixtures/fake-cursor-sdk.mjs `~hang`).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CODER_UNPLANNED_LINE } from "../src/app/agent/tools.js";
import { failingLine, outsideLine } from "../src/core/drift.js";
import { FAKE_ACP_AGENT, FIXTURES, startApp } from "./helpers/app.js";
import { projectIdOf } from "../src/core/project-id.js";
import { removeDirs, until } from "./helpers/wait.js";

describe("a coding agent hears the loop's mid-turn lines", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-coder-nudges-"));
  const projDir = join(root, "project");
  const gates = join(root, "gates");
  const calls = join(root, "calls.jsonl");
  before(async () => {
    mkdirSync(projDir);
    mkdirSync(gates);
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "own", name: "own", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_CALLS: calls, FAKE_ACP_QUEUE_GATE: gates }, cwdDefault: projDir, permissions: "allow-all", hints: false } }];
        cfg.routes = [{ match: "own/*", upstream: "own", upstreamModel: "{1}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });
  /** @param {string} id */
  const at = (id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** A chat on the Claude-shaped fake. */
  const open = async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "own/fake-a", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** A turn that must end well: its reply's words. @param {string} id @param {string} content */
  const say = async (id, content) => {
    const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: false } });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    return (body.content || []).filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join("");
  };
  /**
   * A `~queue` turn begun, its gates shut: its run's id, its record's notes and its words once it ends. `refuse`: the
   * first prompt queued at it is refused (fixtures/fake-acp-agent.mjs `refusequeue`).
   * @param {string} id @param {string} content @param {{ refuse?: boolean }} [o]
   */
  const begin = async (id, content, { refuse = false } = {}) => {
    rmSync(gates, { recursive: true, force: true });
    mkdirSync(gates);
    if (refuse) writeFileSync(join(gates, "refusequeue"), "");
    const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    return {
      runId,
      /** Its gates opened, the turn's end: the record's notes. */
      end: async () => {
        for (const g of ["q1", "q2", "end"]) writeFileSync(join(gates, g), "");
        await body;
        const rec = await until(async () => {
          const r = await shim.record(runId);
          return r?.acp?.run ? r : null;
        }, "the turn's record");
        return [...(rec.changes || []), ...(rec.priorChanges || [])].map(String);
      },
    };
  };
  /** What the agent was sent queued while a turn of its ran. */
  const queued = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []).filter((c) => c.method === "queued prompt").map((c) => String(c.words));
  /** @param {string} runId */
  const events = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events;

  // (fails before: yes — the owner's of 11-10: the loop asked for a plan where a second file changed with none, and a
  // coding agent heard nothing of it)
  test("Claude changes a second file with neither a checklist nor a task graph: the line goes in at its next step, once", async () => {
    const id = await open();
    await say(id, "one");
    const from = queued().length;
    const t = await begin(id, "~queue ~twoedits");
    await until(() => queued().slice(from).some((w) => w === CODER_UNPLANNED_LINE) || null, "the line, queued at Claude as its next step began");
    const notes = await t.end();
    assert.deepEqual(queued().slice(from), [CODER_UNPLANNED_LINE], "said once");
    assert.ok(notes.includes("acp: own changed a second file with neither a checklist nor a task graph — Filament asked it to plan its steps, at its next step"), notes.join("\n"));
  });

  // (fails before: yes — the owner's of 11-10, drift: the loop's agent hears its command failed a third time with nothing
  // changed between, and a coding agent heard nothing of it)
  test("Claude's same command fails a third time in a row with nothing changed between: the line goes in at its next step, once", async () => {
    const id = await open();
    await say(id, "one");
    const from = queued().length;
    const line = failingLine("npm test", "coding");
    const t = await begin(id, "~queue ~threefails");
    await until(() => queued().slice(from).includes(line) || null, "the line, queued at Claude as its next step began");
    const notes = await t.end();
    assert.deepEqual(queued().slice(from), [line], "said once");
    assert.ok(notes.includes("acp: own's `npm test` failed a third time in a row, and nothing Filament saw changed between them — Filament said so, at its next step"), notes.join("\n"));
    // An edit of its own between the second run and the third: nothing said.
    const fixed = queued().length;
    const edited = await (await begin(id, "~queue ~threefails ~editbetween")).end();
    assert.deepEqual(queued().slice(fixed), [], queued().slice(fixed).join("\n----\n"));
    assert.ok(!edited.some((n) => n.includes("failed a third time")), edited.join("\n"));
  });

  // (fails before: yes — the review of 11-11, d-fails: what starts the count again was written twice, and the coding
  // path's knew only a command and an edit: a sub-agent's change Claude applied between two failed runs, a task's it
  // merged or a command it started in the background was no change, and its third run was said to have failed with
  // nothing changed between)
  test("Claude applies a sub-agent's change, merges a task's or starts a command between the second failed run and the third: nothing is said; a call that changes nothing keeps the count", async () => {
    const id = await open();
    await say(id, "one");
    for (const between of [`agent ${JSON.stringify({ agent_id: "sa_1", apply_changes: true })}`, `tasks ${JSON.stringify({ action: "merge", id: "t1", reason: "its check is flaky" })}`, `background_command ${JSON.stringify({ command: "npm run build", description: "Build" })}`]) {
      const from = queued().length;
      const notes = await (await begin(id, `~queue ~threefails ~callbetween ${between}`)).end();
      assert.deepEqual(queued().slice(from), [], `${between}: ${queued().slice(from).join("\n----\n")}`);
      assert.ok(!notes.some((n) => n.includes("failed a third time")), `${between}: ${notes.join("\n")}`);
    }
    // The graph shown, or a sub-agent sent more words, changes nothing a command could pass by: the line goes.
    const line = failingLine("npm test", "coding");
    for (const between of [`tasks ${JSON.stringify({ action: "show" })}`, `agent ${JSON.stringify({ agent_id: "sa_1", prompt: "go on" })}`]) {
      const from = queued().length;
      const t = await begin(id, `~queue ~threefails ~callbetween ${between}`);
      await until(() => queued().slice(from).includes(line) || null, `the line, queued at Claude as its next step began (${between})`);
      await t.end();
      assert.deepEqual(queued().slice(from), [line], between);
    }
  });

  // (fails before: yes — the owner's of 11-10, drift: the loop hears it changed a file outside every open task's writes
  // while its own task named its files, and a coding agent heard nothing of it)
  test("Claude changes a file outside every open task's writes while its own task runs: the line goes in at its next step, once a task", async () => {
    const id = await open();
    const lexer = { action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer", writes: ["a.txt"] }] };
    assert.match(await say(id, `~mcpcall tasks ${JSON.stringify(lexer)}`), /Added t1\./);
    assert.match(await say(id, `~mcpcall tasks ${JSON.stringify({ action: "start", ids: ["t1"] })}`), /Started t1/);
    const from = queued().length;
    const line = outsideLine({ path: "b.txt", tasks: [{ id: "t1", name: "Write the lexer", writes: ["a.txt"] }] }, "coding");
    const t = await begin(id, "~queue ~twoedits");
    await until(() => queued().slice(from).includes(line) || null, "the line, queued at Claude as its next step began");
    const notes = await t.end();
    assert.deepEqual(queued().slice(from), [line], "said once, and a.txt, within its writes, not at all");
    assert.ok(notes.includes("acp: own changed b.txt outside every open task's writes while on t1 — Filament said so, at its next step"), notes.join("\n"));
    const again = queued().length;
    await (await begin(id, "~queue ~twoedits")).end();
    assert.deepEqual(queued().slice(again), [], "once a task");
  });

  // (fails before: yes — the review of the drift signals, d-writes: the edit outside the writes was the turn's last call,
  // so its line went nowhere, and its task was marked told all the same: no later edit said it either)
  test("Claude's turn ends on an edit outside every open task's writes: nothing is said then, and a later turn's step says it, once a task", async () => {
    const id = await open();
    const lexer = { action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer", writes: ["a.txt"] }] };
    assert.match(await say(id, `~mcpcall tasks ${JSON.stringify(lexer)}`), /Added t1\./);
    assert.match(await say(id, `~mcpcall tasks ${JSON.stringify({ action: "start", ids: ["t1"] })}`), /Started t1/);
    const from = queued().length;
    // Its last calls are its two edits, b.txt outside t1's writes: no step of the turn is left to say it at.
    await say(id, "~twoedits");
    assert.deepEqual(queued().slice(from), [], "words queued at a turn with no step left would run as a prompt of their own");
    const line = outsideLine({ path: "b.txt", tasks: [{ id: "t1", name: "Write the lexer", writes: ["a.txt"] }] }, "coding");
    const t = await begin(id, "~queue ~twoedits");
    await until(() => queued().slice(from).includes(line) || null, "the line, queued at Claude as the next turn's step began");
    const notes = await t.end();
    assert.deepEqual(queued().slice(from), [line], "said once");
    assert.ok(notes.includes("acp: own changed b.txt outside every open task's writes while on t1 — Filament said so, at its next step"), notes.join("\n"));
    const again = queued().length;
    await (await begin(id, "~queue ~twoedits")).end();
    assert.deepEqual(queued().slice(again), [], "once a task, once it was said");
  });

  // (fails before: yes — the review of the drift signals, d-fails: a Task sub-agent's events were the sub-agent's alone, so
  // its edit between two failed runs read as nothing changed)
  test("a Task sub-agent of Claude's edits a file between the second failed run and the third: nothing is said", async () => {
    const id = await open();
    await say(id, "one");
    const from = queued().length;
    const notes = await (await begin(id, "~queue ~threefails ~subeditbetween")).end();
    assert.deepEqual(queued().slice(from), [], queued().slice(from).join("\n----\n"));
    assert.ok(!notes.some((n) => n.includes("failed a third time")), notes.join("\n"));
  });

  // (fails before: yes — the hunt of c-unplanned, sa_0b8ff31c: the line owed at the second edit went out at the next step
  // though the agent wrote its todo list in between)
  test("a todo list written after the second edit, before the next step: the owed line is judged again and does not go", async () => {
    const id = await open();
    await say(id, "one");
    const from = queued().length;
    const notes = await (await begin(id, "~queue ~twoedits ~planlate")).end();
    assert.deepEqual(queued().slice(from), [], queued().slice(from).join("\n----\n"));
    assert.ok(!notes.some((n) => n.includes("changed a second file")), notes.join("\n"));
  });

  // (fails before: yes — FabeleHelper's lt_f840c285 on bcc37fbb7: a steer Claude refused took the unplanned line with it,
  // for the rest of the turn)
  test("a steer Claude refuses: the unplanned line waits for its next step and goes there, once", async () => {
    const id = await open();
    await say(id, "one");
    const from = queued().length;
    const t = await begin(id, "~queue ~twoedits", { refuse: true });
    // Each step is a call of the fake agent's process: under a full suite's load one took past 10 s (x25).
    await until(() => !existsSync(join(gates, "refusequeue")) || null, "the steer at q1's step, refused", { timeoutMs: 30_000 });
    writeFileSync(join(gates, "q1"), "");
    await until(() => queued().slice(from).includes(CODER_UNPLANNED_LINE) || null, "the line, at q2's step", { timeoutMs: 30_000 });
    const notes = await t.end();
    assert.deepEqual(queued().slice(from), [CODER_UNPLANNED_LINE]);
    assert.ok(notes.includes("acp: own changed a second file with neither a checklist nor a task graph — Filament asked it to plan its steps, at its next step"), notes.join("\n"));
  });

  // (fails before: no — what keeps it quiet, held: a checklist of the turn's, one the chat keeps still open, a graph with
  // open tasks)
  test("none where the turn kept a checklist, the chat holds one still open, or the graph has open tasks", async () => {
    const planned = await open();
    await say(planned, "one");
    let from = queued().length;
    await (await begin(planned, "~plan ~queue ~twoedits")).end();
    assert.deepEqual(queued().slice(from), [], "its own todo list in the turn");

    const kept = await open();
    await say(kept, `~rawmcp ~mcpcall checklist ${JSON.stringify({ items: [{ text: "edit a", status: "doing" }, { text: "edit b", status: "pending" }] })}`);
    from = queued().length;
    await (await begin(kept, "~queue ~twoedits")).end();
    assert.deepEqual(queued().slice(from), [], "Filament's checklist, kept in an earlier turn and still open: its items are open tasks on the graph");

    const graphed = await open();
    const added = await say(graphed, `~mcpcall tasks ${JSON.stringify({ action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer" }] })}`);
    assert.match(added, /Added t1\./, added);
    from = queued().length;
    await (await begin(graphed, "~queue ~twoedits")).end();
    assert.deepEqual(queued().slice(from), [], "a graph with an open task");
  });

  // (fails before: no — held: a list the agent left open in an earlier turn keeps the next turn quiet, and one it ticked
  // all done lets the line come again; the list is its session's — a fresh session after Filament's summary, the agent's
  // own compaction and the agent the chat moved to are still-open-retold's)
  test("none where the agent's own todo list, left open in an earlier turn, is still open: the chat keeps it", async () => {
    const id = await open();
    await say(id, "~plan");
    const from = queued().length;
    await (await begin(id, "~queue ~twoedits")).end();
    assert.deepEqual(queued().slice(from), [], "the list it left open in turn 1");
    // Done with it — an item given up is no open work (fails before: yes — the review of e0a070c96, sa_3c539618: a
    // cancelled item kept the list open, and the line never came again) — the next turn's two files are unplanned again.
    await say(id, "~planend");
    const again = queued().length;
    const t = await begin(id, "~queue ~twoedits");
    await until(() => queued().slice(again).includes(CODER_UNPLANNED_LINE) || null, "the line, its list ended");
    await t.end();
  });

  // (fails before: yes — the nudge map of 11-10, c-mirror: a coding agent's checklist answered "Checklist recorded" alone,
  // where the loop's goes on its task graph and says what moved and what comes next)
  test("a coding agent's Filament checklist is on its task graph, and a tick answers as the loop's does", async () => {
    const id = await open();
    const first = await say(id, `~mcpcall checklist ${JSON.stringify({ items: [{ text: "Read the lexer", status: "doing" }, { text: "Fix the lexer", status: "pending" }] })}`);
    assert.match(first, /^mcp:Checklist recorded: 2 items \(0 done\)\. Your checklist starts your task graph: p1, p2\./m, first);
    const tick = await say(id, `~mcpcall checklist ${JSON.stringify({ items: [{ text: "Read the lexer", status: "done" }, { text: "Fix the lexer", status: "pending" }] })}`);
    assert.match(tick, /^mcp:Checklist recorded: 2 items \(1 done\)\. On your task graph as p1, p2 — p1 done\./m, tick);
    assert.match(tick, / Next of yours: p2 "Fix the lexer" — its item to doing as you take it up\. 1 of 2 done/, tick);
    const drawn = (await (await shim.api(at(id))).json()).inForce.graph;
    assert.deepEqual([drawn?.counts.total, drawn?.counts.done], [2, 1], "drawn on the chat's graph");
  });

  // (fails before: yes — the owner's of 11-10: the loop said which task of its own the person's words came during, a
  // coding agent heard that only behind a sealed report)
  test("the person's words while a task of its own runs: which task, and how to take them up first, go with them", async () => {
    const id = await open();
    await say(id, `~mcpcall tasks ${JSON.stringify({ action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer" }] })}`);
    const started = await say(id, `~mcpcall tasks ${JSON.stringify({ action: "start", ids: ["t1"] })}`);
    assert.match(started, /Started t1/, started);
    const from = queued().length;
    const t = await begin(id, "~queue");
    await until(async () => (await events(t.runId)).some((e) => e.type === "tool-start" && e.id === "q1") || null, "its first step");
    const r = await shim.api(`/api/runs/${encodeURIComponent(t.runId)}/steer`, { method: "POST", body: { kind: "note", text: "also check the docs", from: "harness" } });
    assert.equal(r.status, 200, await r.clone().text());
    writeFileSync(join(gates, "q1"), "");
    await until(() => queued().slice(from).length || null, "the words, queued at Claude as its next step began");
    const notes = await t.end();
    assert.deepEqual(queued().slice(from), ['also check the docs\n\n[Filament: this came while you are on t1 "Write the lexer". To take it up first, pause t1 with a checkpoint (tasks pause) and add it as a task — or do it inside t1 if it belongs there.]']);
    assert.ok(notes.includes("acp: the person's words came while a task of the agent's own ran — Filament said which, and how to take them up first"), notes.join("\n"));
  });

  // (fails before: yes — the review of bcc37fbb7, sa_ea3782cd: the line was held for the step only once the words' echo
  // came, so two notes sent in one step each carried it)
  test("two notes in one step: only the first carries which task of its own the agent is on", async () => {
    const id = await open();
    await say(id, `~mcpcall tasks ${JSON.stringify({ action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer" }] })}`);
    await say(id, `~mcpcall tasks ${JSON.stringify({ action: "start", ids: ["t1"] })}`);
    const from = queued().length;
    const t = await begin(id, "~queue");
    await until(async () => (await events(t.runId)).some((e) => e.type === "tool-start" && e.id === "q1") || null, "its first step");
    for (const text of ["also check the docs", "and the changelog"]) {
      const r = await shim.api(`/api/runs/${encodeURIComponent(t.runId)}/steer`, { method: "POST", body: { kind: "note", text, from: "harness" } });
      assert.equal(r.status, 200, await r.clone().text());
    }
    writeFileSync(join(gates, "q1"), "");
    await until(() => queued().slice(from).length >= 2 || null, "both, queued at Claude as its next step began");
    await t.end();
    const got = queued().slice(from);
    assert.equal(got.filter((w) => w.includes('[Filament: this came while you are on t1 "Write the lexer".')).length, 1, got.join("\n----\n"));
  });

  // (fails before: yes — c-begin: a turn's start was kept as the turn opened — each running task of the agent's own a turn
  // more, a plan carried from another chat heard — though its first prompt went as the agent's own command, carrying none
  // of it)
  test("a turn whose prompt is the agent's own command keeps nothing of its start; one that carried where it stands counts", async () => {
    const id = await open();
    await say(id, `~mcpcall tasks ${JSON.stringify({ action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer" }] })}`);
    await say(id, `~mcpcall tasks ${JSON.stringify({ action: "start", ids: ["t1"] })}`);
    const turns = () => /** @type {any} */ (shim.app).memory.archive.getChain(id).meta.graph.tasks.find((/** @type {any} */ t) => t.id === "t1").quiet ?? 0;
    const was = turns();
    await say(id, "/review");
    assert.equal(turns(), was, "its own command: no turn of the task's counted");
    await say(id, "go on");
    assert.equal(turns(), was + 1, "a prompt that carried where it stands");
  });
});

describe("a coding agent hears memory at its own call", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-coder-memory-"));
  const projDir = join(root, "project");
  const gates = join(root, "gates");
  const calls = join(root, "calls.jsonl");
  before(async () => {
    mkdirSync(projDir);
    mkdirSync(gates);
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.memory.autopilot = { enabled: true }; // memory speaks into the turn (M6-7): off, the turn is silent
        cfg.upstreams = [{ id: "own", name: "own", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_CALLS: calls, FAKE_ACP_QUEUE_GATE: gates }, cwdDefault: projDir, permissions: "allow-all", hints: false } }];
        cfg.routes = [{ match: "own/*", upstream: "own", upstreamModel: "{1}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });
  const queued = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []).filter((c) => c.method === "queued prompt").map((c) => String(c.words));

  // (fails before: yes — the nudge map of 11-10, c-via: the loop's call carried the pitfall it walked into on its result,
  // a coding agent's call heard nothing of it)
  test("a pitfall the agent's step walks into goes in at its next step, once; the step that misses it carries none", async () => {
    const said = await shim.api("/api/memory/remember", { method: "POST", body: { text: "Never run `q1` bare in this repo; run it as `env FILAMENT_Q=1 q1`.", kind: "rule", project: projectIdOf(projDir) } });
    assert.equal(said.status, 200, await said.clone().text());
    const { id: rule } = await said.json();
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "own/fake-a", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    const from = queued().length;
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "~queue", stream: true, runEvents: true } });
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    const line = `[memory ${rule} · user said] Never run \`q1\` bare in this repo; run it as \`env FILAMENT_Q=1 q1\`.`;
    await until(() => queued().slice(from).includes(line) || null, "the pitfall's line, queued at Claude as its next step began");
    for (const g of ["q1", "q2", "end"]) writeFileSync(join(gates, g), "");
    await body;
    const rec = await until(async () => {
      const x = await shim.record(runId);
      return x?.acp?.run ? x : null;
    }, "the turn's record");
    assert.deepEqual(queued().slice(from), [line], "said once, at q1's step");
    const notes = [...(rec.changes || []), ...(rec.priorChanges || [])].map(String);
    assert.ok(notes.includes(`acp: memory reminded own's Bash call of ${rule}, at its next step`), notes.join("\n"));
  });

  /**
   * A `~queue` turn run to its end, its gates opened once `ready` holds: its record's notes. `refuse`: the first prompt
   * queued at it is refused (fixtures/fake-acp-agent.mjs `refusequeue`), and its gates open once it was.
   * @param {string} id @param {string} content @param {{ refuse?: boolean, ready?: () => boolean }} [o]
   */
  const run = async (id, content, { refuse = false, ready = () => true } = {}) => {
    rmSync(gates, { recursive: true, force: true });
    mkdirSync(gates);
    if (refuse) writeFileSync(join(gates, "refusequeue"), "");
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(() => ((!refuse || !existsSync(join(gates, "refusequeue"))) && ready()) || null, "the turn at its first step");
    for (const g of ["q1", "q2", "end"]) writeFileSync(join(gates, g), "");
    await body;
    const rec = await until(async () => {
      const x = await shim.record(runId);
      return x?.acp?.run ? x : null;
    }, "the turn's record");
    return [...(rec.changes || []), ...(rec.priorChanges || [])].map(String);
  };

  // (fails before: yes — FabeleHelper's lt_f840c285 on bcc37fbb7: memory recorded a reminder fired as it was read, so a
  // pitfall said once a conversation that a refused steer took was never said in that conversation again)
  test("a steer Claude refuses: the bare pitfall it carried is not recorded as said, and goes at the next call that walks into it, once", async () => {
    const said = await shim.api("/api/memory/remember", { method: "POST", body: { text: "Avoid invoking `q1` while the mirror syncs.", kind: "rule", project: projectIdOf(projDir) } });
    assert.equal(said.status, 200, await said.clone().text());
    const { id: rule, itemId } = await said.json();
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "own/fake-a", preset: "plain" } });
    const id = String((await r.json()).id);
    const fired = () => /** @type {any} */ (shim.app.memory).archive.items.events(itemId).filter((/** @type {any} */ e) => e.action === "fired").length;
    const line = `[memory ${rule} · user said] Avoid invoking \`q1\` while the mirror syncs.`;
    const from = queued().length;
    const first = await run(id, "~queue", { refuse: true });
    // The rule by its whole id: "i2" is in a note's temporary folder name by chance, as "Xi2k9a" (steer-flake).
    const names = (/** @type {string} */ n) => new RegExp(`\\b${rule}\\b`).test(n);
    /** What the turns said, for a failure to name its cause (steer-flake: one run in seven under load, never again). */
    const context = (/** @type {string} */ why) => `${why}\nrule ${rule} (item ${itemId}), fired ${fired()}\nqueued:\n${queued().slice(from).join("\n----\n")}\nfirst turn:\n${first.join("\n")}`;
    assert.equal(fired(), 0, context("the steer that carried it was refused"));
    assert.ok(!first.some(names), context("the refused steer said nothing of it"));
    const second = await run(id, "~queue", { ready: () => queued().slice(from).some((w) => w.includes(line)) });
    assert.equal(queued().slice(from).filter((w) => w.includes(line)).length, 1, context("queued once"));
    assert.equal(fired(), 1, context("fired once it went"));
    assert.ok(second.some((n) => n.startsWith("acp: memory reminded own's Bash call of") && names(n)), `${context("the record says it")}\nsecond turn:\n${second.join("\n")}`);
  });
});

describe("a coding agent's own background work at its turn's end", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-coder-idle-"));
  const projDir = join(root, "project");
  const wake = join(root, "wake");
  before(async () => {
    mkdirSync(projDir);
    mkdirSync(wake);
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "own", name: "own", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_WAKE_GATE: wake }, cwdDefault: projDir, permissions: "allow-all", hints: false } }];
        cfg.routes = [{ match: "own/*", upstream: "own", upstreamModel: "{1}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    writeFileSync(join(wake, "sh1"), "");
    await shim.stop();
    await removeDirs(root);
  });

  // (fails before: yes — the review of 11-11, d-idle: a turn's end counted Filament's commands for the chat and nothing
  // the agent runs by itself, so Claude's turn that ended with its own background command running left its task "with
  // nothing at work on it" — though that command's end begins a turn of Claude's own)
  test("Claude's turn ends with a command of its own running in the background: its running task is not left idle; a turn that ends with nothing at work leaves it so", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "own/fake-a", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    /** A turn that must end well. @param {string} content */
    const say = async (content) => {
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(res.status, 200, await res.clone().text());
    };
    await say("one");
    // A task of its own running, started outside any turn: no turn's end has weighed it yet.
    for (const input of [{ action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer" }] }, { action: "start", ids: ["t1"] }]) assert.ok(/** @type {any} */ (shim.app).graphs.apply(id, input, { crew: "agent" }).ok);
    const t1 = () => /** @type {any} */ (shim.app).memory.archive.getChain(id).meta.graph.tasks.find((/** @type {any} */ t) => t.id === "t1");
    const itsTasks = async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json()).agentTasks || [];
    // `~thinking`: its turn ends with a shell of its own, `sh1`, running on in the background.
    await say("~thinking");
    assert.deepEqual((await itsTasks()).map((/** @type {any} */ t) => [t.id, t.background]), [["sh1", true]], "its shell runs on after the turn");
    assert.equal(t1().idle, undefined, "its own command is at work: its end wakes it");
    writeFileSync(join(wake, "sh1"), "");
    await until(async () => (await itsTasks()).length === 0 || null, "its shell's end");
    await say("go on");
    assert.equal(t1().idle, true, "nothing at work as this turn ended");
  });
});

describe("Cursor's SDK hears the drift lines", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-coder-cursor-"));
  const projDir = join(root, "project");
  const sdkLog = join(root, "sdk.jsonl");
  before(async () => {
    mkdirSync(projDir);
    process.env.FAKE_SDK_LOG = sdkLog;
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "cursor", name: "Cursor", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: projDir, permissions: "allow-all", hints: false } }];
        cfg.routes = [{ match: "cursor/*", upstream: "cursor", upstreamModel: "{1}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
      overrides: { cursorSdkLoader: () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href) },
    });
  });
  after(async () => {
    await shim.stop();
    delete process.env.FAKE_SDK_LOG;
    await removeDirs(root);
  });
  /** What Filament steered into Cursor's runs. */
  const steers = () => (existsSync(sdkLog) ? readFileSync(sdkLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []).filter((e) => e.event === "steer");

  // (fails before: yes — the review of the drift signals, d-fails: Cursor's SDK says a command that ran is a success, its
  // exit code in its value, and its call named no command where the turn reads one, so its failed runs were never counted)
  test("Cursor's same command exits 1 a third time in a row with nothing changed between: the line goes into its run at its next call, once", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "cursor/composer-2.5", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    const line = failingLine("npm test", "coding");
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "~threefails ~shell ~hang", stream: true, runEvents: true } });
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    try {
      await until(() => steers().some((s) => String(s.text).includes(line)) || null, "the line, steered into Cursor's run at its next call");
    } finally {
      // A run no steer reached waits until it is stopped.
      if (!steers().length) await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
      await body;
    }
    assert.deepEqual(steers().map((s) => [s.text, s.takes]), [[line, true]], "once");
    const rec = await until(async () => {
      const x = await shim.record(runId);
      return x?.acp?.run ? x : null;
    }, "the turn's record");
    const notes = [...(rec.changes || []), ...(rec.priorChanges || [])].map(String);
    assert.ok(notes.some((n) => n.includes("`npm test` failed a third time in a row, and nothing Filament saw changed between them — Filament said so, at its next step")), notes.join("\n"));
  });
});
