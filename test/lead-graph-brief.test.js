// @ts-check
// A team's lead beside a chat reads that chat's task graph (g3b, the owner's of 11-09: nothing forgotten). The record
// its lead starts from — and the Brief's What its lead reads, which is the same text — carries the main chat's graph as
// it stands now, whole, while it has open tasks: by itself, no field to ask for it, since the lead reads the whole chat
// already and a graph's tool results in it are as old as their calls. Its words say whose graph it is.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tg from "../src/core/task-graph.js";
import { GRAPH_HEAD } from "../src/core/beside.js";
import { estimateTokens } from "../src/core/tokens.js";
import { MemoryService } from "../src/services/memory/index.js";
import { sidecar } from "../src/adapters/sidecar/index.js";
import { createSessions } from "../src/app/sessions/service.js";
import { removeDirs } from "./helpers/wait.js";

const dir = mkdtempSync(join(tmpdir(), "filament-lead-graph-"));
let clock = 1_760_000_000_000;
const now = () => (clock += 1000);
/** @type {any} */
const cfg = { server: { host: "127.0.0.1" }, rules: {}, agentLoop: { permissions: "edit" }, memory: { enabled: true }, routes: [], upstreams: [], sessions: { defaults: {} } };
const config = { get: () => cfg };
const memory = new MemoryService(/** @type {any} */ ({ sidecar, getConfig: config.get, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20399", getModelNames: () => ["cheap"], now }));
memory.start();
const sessions = createSessions({ memory, config, pipeline: { handle: async () => {} }, ops: { record: () => {} }, log: () => {}, forkSession: async () => ({}), now });
after(async () => {
  await memory.shutdown();
  await removeDirs(dir);
});

const ok = (/** @type {any} */ r) => (assert.ok(r.ok, JSON.stringify(r)), r);
const GRAPH = () =>
  ok(
    tg.applyTasks(
      null,
      {
        action: "add",
        goal: "Close the gaps",
        tasks: [
          { id: "nowgap", name: "Close the gap in Now", writes: ["src/ui/harness/lib/now.js"] },
          { id: "later", name: "Then the docs", needs: ["nowgap"], writes: ["docs/x.md"] },
        ],
      },
      { at: clock, crew: "agent" },
    ),
  ).graph;

// (fails before: yes — a lead beside read the chat's turns, its graph only as old tasks calls in them, or not at all)
test("a lead's record carries the main chat's open task graph whole, as the main agent's; a closed graph, or none, adds nothing", async () => {
  const id = sessions.create({ cwd: dir, model: "agent/m", preset: "plain" }).id;
  const bare = await sessions.recordFor(id, { model: "m", team: "BugHunters" });
  assert.ok(!bare.includes(GRAPH_HEAD), "no graph, no block");
  const graph = GRAPH();
  /** @type {any} */ (memory.archive).mergeMeta(id, { graph });
  const record = await sessions.recordFor(id, { model: "m", team: "BugHunters" });
  const at = record.indexOf(GRAPH_HEAD);
  assert.ok(at > 0, record);
  const block = record.slice(at, record.indexOf("</task-graph>") + "</task-graph>".length);
  assert.equal(
    block,
    `${GRAPH_HEAD}\nThe main chat's task graph as it stands now: the main agent's plan, where "you" is the main agent and its tasks calls are its own. Your tasks tool keeps your own graph, never this one: plan your work around it where the two meet.\n\n${tg.openGraphText(graph, "agent")}\n</task-graph>`,
  );
  assert.ok(record.endsWith("</task-graph>\n</main-chat>"), "inside the record, at its end");
  // The Brief's What its lead reads is the same text.
  assert.equal((await sessions.recordFacts(id, { model: "m", team: "BugHunters" })).text, record);
  const closed = ok(tg.applyTasks(graph, { action: "close", reason: "done with it" }, { at: clock, crew: "agent" })).graph;
  /** @type {any} */ (memory.archive).mergeMeta(id, { graph: closed });
  assert.ok(!(await sessions.recordFor(id, { model: "m", team: "BugHunters" })).includes(GRAPH_HEAD), "a closed graph adds nothing");
});

// (fails before: yes — the record called openGraphText with the graph alone: the lead read no notes kept behind its
// tasks and no where-you-are, which the graph a compaction hands back carries; and a graph of hundreds of tasks went in
// whole, crowding out the chat it rides with)
test("a lead's record carries the graph as a compaction hands it back — what is kept behind its tasks, and where the main agent stands — and a graph too big for its room keeps its newest part", async () => {
  /** @type {any} */
  let kept = { nowgap: { notes: 1, files: 0, titles: ["How Now draws the gap"] } };
  const where = "Where you stand: on nowgap.";
  /** @type {import("../src/core/task-graph.js").Crew[]} */
  const crews = [];
  const s = createSessions({ memory, config, pipeline: { handle: async () => {} }, ops: { record: () => {} }, log: () => {}, forkSession: async () => ({}), now, graphKept: () => kept, graphWhere: (_c, crew) => (crews.push(crew), where) });
  const id = s.create({ cwd: dir, model: "agent/m", preset: "plain" }).id;
  const graph = GRAPH();
  /** @type {any} */ (memory.archive).mergeMeta(id, { graph });
  const record = await s.recordFor(id, { model: "m", team: "BugHunters" });
  const block = record.slice(record.indexOf(GRAPH_HEAD), record.indexOf("</task-graph>"));
  assert.ok(block.endsWith(`${tg.openGraphText(graph, "agent", kept, where)}\n`), block);
  assert.match(block, /How Now draws the gap/);
  assert.deepEqual(crews, ["agent"], "the main agent's place, as the main agent plans it");
  // Hundreds of tasks: the graph keeps a quarter of the record's room, its newest part, and the chat still has its own.
  kept = null;
  const tasks = Array.from({ length: 400 }, (_, i) => ({ id: `t${i}`, name: `Task ${i} ${"x".repeat(110)}`, writes: Array.from({ length: 6 }, (_, k) => `src/some/deep/folder/module_${i}_${k}/file_${k}.js`) }));
  const big = ok(tg.applyTasks(null, { action: "add", goal: "Many", tasks }, { at: clock, crew: "agent" })).graph;
  /** @type {any} */ (memory.archive).mergeMeta(id, { graph: big });
  const large = await s.recordFor(id, { model: "m", team: "BugHunters" });
  const part = large.slice(large.indexOf(GRAPH_HEAD), large.indexOf("</task-graph>"));
  assert.ok(estimateTokens(part) <= 200_000 / 2 / 4 + 200, `the graph's part is ${estimateTokens(part)} tokens`);
  assert.match(part, /\n…\n/, "said to be cut");
  assert.ok(part.endsWith(`${where}\n`), "its newest part: where the main agent stands");
  // (fails before: yes — FabeleHelper's of 11-10: 0e809e1d3 handed a graph left open with all done back as the main
  // agent's ask to weigh and close it, which the lead read in the main agent's voice, of a graph not its own)
  const all = ok(tg.applyTasks(graph, { action: "done", id: "nowgap", summary: "Closed." }, { at: clock, crew: "agent" })).graph;
  const allDone = ok(tg.applyTasks(all, { action: "done", id: "later", summary: "Written." }, { at: clock, crew: "agent" })).graph;
  /** @type {any} */ (memory.archive).mergeMeta(id, { graph: allDone });
  assert.ok(!(await s.recordFor(id, { model: "m", team: "BugHunters" })).includes(GRAPH_HEAD), "all done: nothing open to read");
});
