// @ts-check
// HarnessV3-TaskGraph G2, end to end: the sub-agents' tasks of a session's graph, run by Filament in a real git
// repository against a fake upstream. Filament starts each task once its needs are done and a slot is free, in the
// order tasks may start, and briefs its sub-agent from the graph; a writer's change is ready in its worktree, and the
// agent's apply of it merges it into the folder — nothing of Filament's writes it there by itself (the owner's of
// 11-02) — so the tasks that build on it start from it; the agent hears each end in the graph's words while its turn
// waits on the graph, the ends told while the graph's other workers still work with the last one's. A sub-agent that
// would end without its report is asked for it once; a failure — no report, the check not met, a change that does not
// merge — is the agent's to answer: sent back with a note, or dropped. The developer's Stop holds the graph until the
// agent's next tasks call; a task a crash cut fails, told once. G3: a team's lead runs the graph through its turn —
// its orders run at once beside what is refused, each task goes to the team's worker of its role, a reviewer reads a
// builder's change before it is ready, and the lead applies it; what a crash cut is told in the lead's words.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until, removeDirs } from "./helpers/wait.js";
import { PROMPT, readAlongReport } from "../src/app/agent/prompt.js";
import { SUBAGENT_NOTES } from "../src/app/agent/subagents.js";
import { REPORT_ASK, applyTasks, briefText, endText, launched, resumeText, reviewBrief } from "../src/core/task-graph.js";
import { MEMBERS as LED } from "./helpers/roster.js";

const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
const said = (/** @type {string} */ t) => reply([{ type: "text", text: t }]);
const call1 = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => reply([toolUse(id, name, input)], "tool_use");
const textOf = (/** @type {any} */ content) => (typeof content === "string" ? content : (content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));
const sysOf = (/** @type {any} */ b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
const toolNames = (/** @type {any} */ b) => (b?.tools || []).map((/** @type {any} */ t) => t.name);
/** The blocks of the request's newest user message. @param {any} b @returns {any[]} */
const newest = (b) => {
  const m = [...(b?.messages || [])].reverse().find((/** @type {any} */ x) => x.role === "user");
  return typeof m?.content === "string" ? [{ type: "text", text: m.content }] : m?.content || [];
};
const newestTexts = (/** @type {any} */ b) => newest(b).filter((c) => c?.type === "text").map((c) => String(c.text));
/** The tool calls the newest user message answers. @param {any} b */
const answered = (b) => newest(b).filter((c) => c?.type === "tool_result").map((c) => String(c.tool_use_id));
/** What a tool call answered in a request: its tool_result block, or null. @param {any} body @param {string} id */
const resultIn = (body, id) => {
  for (const m of body?.messages || []) for (const b of Array.isArray(m.content) ? m.content : []) if (b?.type === "tool_result" && b.tool_use_id === id) return b;
  return null;
};
/** The graph's words to the agent as a task ends — done, failed, or stopped by the developer — naming the task. */
const TOLD = /^\[Filament: (?:task|the developer stopped sub-agent \S+ on task) (\S+) "/;
/** Each task's end the newest message tells the agent. @param {any} b @returns {{ task: string, text: string }[]} */
const toldIn = (b) =>
  newestTexts(b).flatMap((text) => {
    const m = TOLD.exec(text);
    return m ? [{ task: m[1], text }] : [];
  });
/** How a told end leaves its task, in a word: done, ready — its change waiting for its apply — failed, or stopped. @param {{ text: string }} h */
const endWord = (h) => /^\[Filament: task \S+ "[^"]*" (?:is )?(done|ready|failed)\b/.exec(h.text)?.[1] ?? (/^\[Filament: the developer stopped /.test(h.text) ? "stopped" : "?");
/** Whether `task` was heard done — its change merged, or none to merge. @param {{ task: string, text: string }[]} heard @param {string} task */
const heardDone = (heard, task) => heard.some((h) => h.task === task && endWord(h) === "done");
/** A told end whose worker's change is ready, waiting in its copy for its planner's apply (the owner's of 11-02): its worker. */
const READY = / is ready: .*? apply it when you choose — (?:agent|worker) with agent_id "(sa_[0-9a-f]{8})" and apply_changes: true\./;
/**
 * The planner applies each ready change the newest message tells (the owner's of 11-02): a reply of one `tool` call a
 * worker — the agent's `agent`, a lead's `worker` — with `apply_changes: true`, its id `ap_` and the worker's; null where
 * the message tells none. `as`: the reply's maker.
 * @param {any} b @param {"agent" | "worker"} [tool] @param {(blocks: any[], stop: string) => any} [as]
 */
const applyReady = (b, tool = "agent", as = reply) => {
  const ids = toldIn(b).flatMap((h) => READY.exec(h.text)?.[1] ?? []);
  return ids.length ? as(ids.map((sa) => toolUse(`ap_${sa}`, tool, { agent_id: sa, apply_changes: true })), "tool_use") : null;
};
/** A graph task's sub-agent's call: its prompt has the task's report line. @param {any} call */
const isTask = (call) => sysOf(call.body).includes(PROMPT.taskReport);
/** The session's own loop's call: a sub-agent has no ask. @param {any} call */
const isAgent = (call) => !isTask(call) && toolNames(call.body).includes("ask");
/** A team's lead's call, a graph task's worker's, and a reviewer's: each prompt has its own line (G3). @param {any} call */
const isLead = (call) => sysOf(call.body).includes(String(PROMPT.leadRole));
// Each report line of a team's worker ends on asking its lead (TG2-D58, prompt version 29).
const isWorkerTask = (/** @type {any} */ call) => sysOf(call.body).includes(readAlongReport(PROMPT.workerTaskReport, PROMPT.workerAsksLead));
const isReviewer = (/** @type {any} */ call) => sysOf(call.body).includes(readAlongReport(PROMPT.reviewReport, PROMPT.workerAsksLead));
/** The texts a sub-agent's first message opens with: the worktree's note for a writer, then its brief. @param {any} call @returns {string[]} */
const openingOf = (call) => {
  const c = call.body.messages[0].content;
  return typeof c === "string" ? [c] : c.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text));
};
/** The task a sub-agent's call works on, from its brief. @param {any} call */
const taskOf = (call) => /Your task: (\S+) — /.exec(openingOf(call).at(-1) || "")?.[1] ?? "";
/** The sub-agent's round: one past the replies it gave. @param {any} call */
const roundOf = (call) => call.body.messages.filter((/** @type {any} */ m) => m.role === "assistant").length + 1;
const states = (/** @type {any} */ g) => g.tasks.map((/** @type {any} */ t) => t.state).join(",");
/** What the agent says while the graph works: a reply that ends no turn the graph owes. */
const WAITING = "Waiting for the graph.";

const PARSE = 'module.exports.parse = (s) => s.split(",");\n';
const MAIN = 'const { parse } = require("./parse.js");\nconsole.log(parse("a,b"));\n';
const FIXED = 'module.exports.parse = (s) => s.split(",").filter(Boolean);\n';
const DOC = "# parse\n\nSplits a line on its commas; an empty field is dropped.\n";
const TEST = 'const { parse } = require("../src/parse.js");\nif (parse("a,").length !== 1) process.exit(1);\n';
/** A report of a task done with its check passed. @param {string} did @param {string} evidence */
const DONE = (did, evidence) => ({ status: "done", did, met: true, evidence });
/**
 * A sub-agent that changes a file of the project, round by round: it reads it (an existing file is overwritten only
 * once read), writes it, reports, and ends.
 * @param {number} round @param {string} path @param {string} content @param {any} report
 */
const rewrites = (round, path, content, report) =>
  round === 1 ? call1("rd", "read", { path }) : round === 2 ? call1("wr", "write", { path, content }) : round === 3 ? call1("rp", "report", report) : said("Reported.");
/** A sub-agent that writes a new file, reports, and ends. @param {number} round @param {string} path @param {string} content @param {any} report */
const creates = (round, path, content, report) => (round === 1 ? call1("wr", "write", { path, content }) : round === 2 ? call1("rp", "report", report) : said("Reported."));
const FIX_DONE = DONE("parse() filters the empty fields out.", 'parse("a,") gives ["a"]');
const MAP = { id: "t1", name: "Map the parser", by: "explorer", goal: "Every caller of parse() is known", steps: ["Search the project for parse("], acceptance: "each caller is listed with its file and line" };
const FIX = { id: "t2", name: "Fix the parser", needs: ["t1"], by: "sub-agent", writes: ["src/parse.js"], goal: "parse() drops the empty field a trailing comma leaves", steps: ["Filter the empty fields out"], acceptance: 'parse("a,") gives one field' };
const DOCS = { id: "t3", name: "Document the parser", needs: ["t1"], by: "sub-agent", writes: ["docs/parse.md"], goal: "The docs say what parse() does", steps: ["Write docs/parse.md"], acceptance: "docs/parse.md says how an empty field goes" };
const CHECK = { id: "t4", name: "Test the parser", needs: ["t2", "t3"], by: "sub-agent", writes: ["test/parse.test.js"], goal: "A test pins the trailing comma", steps: ["Write the test", "Run it with node"], acceptance: "node test/parse.test.js exits 0" };

describe("the task graph's sub-agents, end to end", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let parent;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  /** What each scenario's watch on its graph lets go of at the end (`keptGraphs`). @type {(() => void)[]} */
  const offs = [];
  /** The app's settings, at its start and at a restart on the same data. @param {any} cfg */
  const configure = (cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.memory.autopilot = { enabled: false };
    cfg.memory.capture = { turns: true, learn: false };
    // One agent at a time on the model, as its row says: the graph's slots, one by one (the owner's word of 11-05: a
    // model's limit is the only one).
    cfg.agentLoop = { enabled: true, permissions: "auto", roots: [parent], readerModel: "", subagents: { slots: [{ upstream: "m", model: "brain-model", n: 1 }] } };
  };
  before(async () => {
    parent = mkdtempSync(join(tmpdir(), "filament-task-graph-run-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({ memory: true, keep: true, configure });
  });
  after(async () => {
    for (const off of offs.splice(0)) off();
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, parent);
  });

  /** A repository of the scenario's own: the parser and its caller, committed. @param {string} name */
  const repo = (name) => {
    const dir = join(parent, name);
    mkdirSync(join(dir, "src"), { recursive: true });
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    git("init", "-q");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(dir, "src", "parse.js"), PARSE);
    writeFileSync(join(dir, "src", "main.js"), MAIN);
    git("add", "-A");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    return { dir, git, read: (/** @type {string} */ p) => readFileSync(join(dir, p), "utf8") };
  };
  /**
   * Twenty-four notes beside the parser, each a read carries whole within one result's budget: read in one round, they
   * add some 130,000 tokens to the conversation as the estimator counts them — past half the 108,800-token line of the
   * window assumed, 54,400, at the least factor the estimator's calibration serves (×0.5) too.
   * @param {string} dir @returns {string[]} their paths
   */
  const notes = (dir) => {
    mkdirSync(join(dir, "notes"), { recursive: true });
    const paths = Array.from({ length: 24 }, (_, i) => `notes/n${i}.md`);
    paths.forEach((p, i) => writeFileSync(join(dir, p), `note ${i}: the parser reads tokens one at a time and builds the tree.\n`.repeat(300)));
    return paths;
  };
  /** A session in the repository with the graph on and one sub-agent at a time. @param {string} cwd */
  const create = async (cwd) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd, model: "agent/brain-model", preset: "plain", settings: { engine: { supervise: false }, subagents: { pool: [{ model: "" }] } } } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return String((await r.json()).id);
  };
  /** A session in the repository that team Builders leads, the graph on and one worker at a time. @param {string} cwd */
  const teamSession = async (cwd) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd, model: "brain-model", preset: "plain", settings: { engine: { mode: "team", team: "builders", supervise: false }, subagents: { pool: [{ model: "" }] } } } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content @param {Record<string, any>} [more] */
  const turn = async (id, content, more = {}) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false, ...more } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    const json = await r.json();
    return { text: textOf(json.content), runId: String(r.headers.get("x-filament-request-id")) };
  };
  /** A turn streamed: its head names its run while it runs. @param {string} id @param {string} content */
  const streamed = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true } });
    assert.equal(r.status, 200);
    return { runId: String(r.headers.get("x-filament-request-id")), body: r.text() };
  };
  /** The session's graph as it keeps it now. @param {string} id @returns {any} */
  const graphNow = (id) => structuredClone(/** @type {any} */ (shim.app).memory.archive.getChain(id).meta.graph);
  /**
   * Each graph the session keeps, as it keeps it (its "graph" events): Filament tells an end in the words of the graph
   * as it stands then — and an end nothing waits on, told while the graph's other workers still work, is heard once
   * they are done, the graph moved on since (the owner's of 11-02).
   * @param {string} id @returns {any[]}
   */
  const keptGraphs = (id) => {
    /** @type {any[]} */
    const graphs = [];
    offs.push(shim.app.events.subscribe("graph", (/** @type {any} */ e) => void (e.chainId === id && e.type === "graph" && graphs.push(graphNow(id)))));
    return graphs;
  };
  /**
   * The graph an end the planner heard was told from: the newest of `graphs` the session kept by the time it was heard
   * (`h.graph`) whose words for the task are the ones heard — else the graph as it was heard, so a check shows how the
   * words differ.
   * @param {any[]} graphs @param {{ task: string, text: string, graph: any }} h @param {any} crew
   */
  const toldFrom = (graphs, h, crew) => [...graphs.filter((g) => g.rev <= h.graph.rev)].reverse().find((g) => wordsOf(g, h, crew) === h.text) ?? h.graph;
  /**
   * The graph's words for the end heard: with how the graph stands — all done, said so, weighed against what the person
   * asked since it began where they wrote since (the owner's of 11-10) —, or — an end held for the graph's other workers
   * — without (the review of 11-03). @param {any} g @param {{ task: string, text: string }} h @param {any} crew
   */
  const wordsOf = (g, h, crew) =>
    /\n(Now: |All \d+ tasks are done|Its one task is done)[^\n]*\]$/.test(h.text)
      ? endText(g, h.task, { crew, personAt: / and what the person asked since the graph began: /.test(h.text) ? Number.MAX_SAFE_INTEGER : null })
      : endText(g, h.task, { crew, now: false });
  const eventsOf = async (/** @type {string} */ runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=2000`)).json()).events || [];
  const subsOf = async (/** @type {string} */ id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents || [];

  /**
   * The upstream's script for one session: the agent's calls to `agent`, each graph task's sub-agent's to `task` with
   * its task and round. A sub-agent's first call waits on `gate` first; then what it opened with is kept, and each end
   * the agent hears, each beside the graph as the session held it then and the agent's call it came in (`at`, from 0),
   * and what each of the agent's applies answered (`applied`). Each graph the session keeps is kept too (`graphs`).
   * @param {string} id
   * @param {{ agent: (call: any) => any, task: (task: string, round: number, call: any) => any, gate?: (task: string) => Promise<unknown> }} o
   */
  const play = (id, { agent, task, gate }) => {
    /** @type {{ starts: { task: string, opening: string[], graph: any }[], heard: { task: string, text: string, graph: any, at: number }[], applied: { agent: string, text: string }[], graphs: any[], calls: number }} */
    const seen = { starts: [], heard: [], applied: [], graphs: keptGraphs(id), calls: 0 };
    brain = async (call) => {
      if (isTask(call)) {
        const t = taskOf(call);
        const round = roundOf(call);
        if (round === 1) {
          await gate?.(t);
          seen.starts.push({ task: t, opening: openingOf(call), graph: graphNow(id) });
        }
        return task(t, round, call);
      }
      if (!isAgent(call)) return undefined;
      const at = seen.calls++;
      for (const h of toldIn(call.body)) seen.heard.push({ ...h, graph: graphNow(id), at });
      for (const u of answered(call.body)) if (u.startsWith("ap_")) seen.applied.push({ agent: u.slice(3), text: textOf(resultIn(call.body, u)?.content) });
      return agent(call);
    };
    return seen;
  };
  /**
   * Each sub-agent opened with the graph's own brief for its task, as the graph stood as it started — a writer's
   * after the worktree's note — and each end the agent heard was the graph's words for it, as the graph stood when
   * Filament told it: then, or — an end nothing waited on, told while the graph's other workers still worked — before
   * they were done, without how the graph stood (the owner's of 11-02, the review of 11-03).
   * @param {ReturnType<typeof play>} seen
   */
  const inTheGraphsWords = (seen) => {
    for (const s of seen.starts) {
      const brief = briefText(s.graph, s.task, "agent");
      const by = s.graph.tasks.find((/** @type {any} */ t) => t.id === s.task).by;
      assert.deepEqual(s.opening, by === "explorer" ? [brief] : [SUBAGENT_NOTES.taskWorktree, brief], `${s.task}'s brief`);
    }
    for (const h of seen.heard) assert.equal(h.text, wordsOf(toldFrom(seen.graphs, h, "agent"), h, "agent"), `what the agent heard of ${h.task}`);
  };

  // (fails before: yes — there was no runner: a sub-agent's task waited for a start nothing made, and the turn ended)
  // The owner's of 11-02: a writer's change is ready in its copy, and nothing of Filament's writes it into the folder —
  // the agent applies it. An end another task waits on wakes the agent at once (the review of 11-03); here each does.
  test("Filament runs the graph: in the order tasks may start, a slot at a time, each briefed from the graph; a change the agent applies merges, and what builds on it starts from it; the agent hears the workers' ends while its turn waits", async () => {
    const r0 = repo("run");
    const id = await create(r0.dir);
    /** @type {number[]} */
    const revs = [];
    const off = shim.app.events.subscribe("graph", (/** @type {any} */ e) => void (e.chainId === id && revs.push(e.rev)));
    /** @type {Record<string, string>} */
    const t4saw = {};
    let added = false;
    const seen = play(id, {
      // t1 starts once the agent read the add's answer, so its end is heard with what its workers do next; t4 once the
      // agent heard t3's change merged, so its own end is heard on its own.
      gate: (task) =>
        task === "t1" ? until(() => added, "the agent to read the add's answer") : task === "t4" ? until(() => heardDone(seen.heard, "t3"), "the agent to hear t3 done") : Promise.resolve(),
      agent: (call) => {
        if (newestTexts(call.body).includes("ship the parser")) return call1("ga", "tasks", { action: "add", goal: "Ship the parser", tasks: [MAP, FIX, DOCS, CHECK] });
        added ||= answered(call.body).includes("ga");
        // Each apply's verdict comes as a message as its change merges — one that waited in line behind the apply
        // before it, after the call answered: the agent waits for those it has not heard yet.
        const merged = new Set(seen.heard.filter((h) => endWord(h) === "done").map((h) => h.graph.tasks.find((/** @type {any} */ t) => t.id === h.task).agent));
        const due = seen.applied.some((a) => !merged.has(a.agent));
        return applyReady(call.body) ?? (due ? call1(`wt${seen.calls}`, "wait", {}) : said(heardDone(seen.heard, "t4") ? "Shipped." : WAITING));
      },
      task: (task, round, call) => {
        if (task === "t2") return rewrites(round, "src/parse.js", FIXED, FIX_DONE);
        if (task === "t3") return creates(round, "docs/parse.md", DOC, DONE("docs/parse.md says what parse() does.", "docs/parse.md says how an empty field goes"));
        switch (`${task}/${round}`) {
          case "t1/1":
            return call1("r1", "report", DONE("One caller: src/main.js:2", "grep -rn 'parse(' src lists src/main.js:2"));
          case "t4/1":
            return reply([toolUse("f4", "read", { path: "src/parse.js" }), toolUse("d4", "read", { path: "docs/parse.md" })], "tool_use");
          case "t4/2":
            Object.assign(t4saw, { parse: textOf(resultIn(call.body, "f4")?.content), doc: textOf(resultIn(call.body, "d4")?.content) });
            return reply([toolUse("w4", "write", { path: "test/parse.test.js", content: TEST }), toolUse("b4", "bash", { command: "node test/parse.test.js" })], "tool_use");
          case "t4/3":
            return call1("r4", "report", DONE("test/parse.test.js pins the trailing comma.", "node test/parse.test.js exits 0"));
          default:
            return said("Reported.");
        }
      },
    });
    let r;
    try {
      r = await turn(id, "ship the parser");
    } finally {
      off();
    }
    // The agent's word after the add's answer, and after ends it had nothing to do for; the applies' calls, and the ends
    // the agent heard with them, never ended the turn.
    assert.match(r.text, /^(?:Waiting for the graph\.){2,}Shipped\.$/, "the turn waited for the graph: the agent's word between ends never ended it");
    const addedText = textOf(resultIn(up.received.filter(isAgent)[1].body, "ga")?.content);
    assert.match(addedText, /\nFilament started t1 on an explorer \(sa_[0-9a-f]{8}\)\. Now: /, "the add's words say what started");
    // The order tasks may start, a slot at a time: t3 was ready as t2 started, and waited for its slot — it started as
    // t2's change waited, ready, for the agent's apply, which may have merged by its first step; t4, which builds on both,
    // once both were applied and merged.
    assert.deepEqual(seen.starts.map((s) => s.task), ["t1", "t2", "t3", "t4"]);
    assert.deepEqual([states(seen.starts[0].graph), states(seen.starts[1].graph), states(seen.starts[3].graph)], ["running,waiting,waiting,waiting", "done,running,waiting,waiting", "done,done,done,running"]);
    assert.match(states(seen.starts[2].graph), /^done,(?:merging|done),running,waiting$/);
    // Each end heard once: a writer's as its change is ready, and again as the agent's apply of it merged. t2's and t3's
    // ends each wake the agent, t4 needing both; t3 starts once t2's slot is free, so its ready end may come before or
    // after t2's merge.
    const order = seen.heard.map((h) => [h.task, endWord(h)].join(" "));
    assert.ok(
      [
        ["t1 done", "t2 ready", "t2 done", "t3 ready", "t3 done", "t4 ready", "t4 done"],
        ["t1 done", "t2 ready", "t3 ready", "t2 done", "t3 done", "t4 ready", "t4 done"],
      ].some((o) => o.join(",") === order.join(",")),
      order.join(","),
    );
    // t1's end, told as t2 started, which needs it, woke the agent at once, on its own; t2's ready end the next call,
    // never held for t3's (the review of 11-03).
    assert.deepEqual(seen.heard.slice(0, 2).map((h) => h.at), [2, 3], "t1's end in the agent's third call, t2's in its fourth");
    inTheGraphsWords(seen);
    const ready = /^\[Filament: task t2 "Fix the parser" is ready: sub-agent (sa_[0-9a-f]{8}) reported it done with its acceptance check passed — unchecked: the task has no check, and its report named none\. Its change waits in \1's own copy, not in your folder yet: apply it when you choose — agent with agent_id "\1" and apply_changes: true\. .* t4 needs it, and waits for its apply\. To have its sub-agent change it first, send it back with a note: tasks start with its id and note\. The developer may apply it themselves instead\.\n/;
    assert.match(seen.heard[1].text, ready);
    // The agent applied each ready change as it heard it: the call answered as it went into the folder — or that it
    // waited in line behind the one applied before it.
    const ids = seen.heard.filter((h) => endWord(h) === "ready").map((h) => h.graph.tasks.find((/** @type {any} */ t) => t.id === h.task).agent);
    assert.deepEqual(seen.applied.map((a) => a.agent), ids);
    for (const a of seen.applied) assert.match(a.text, new RegExp(`^(?:Applied the changes of sub-agent ${a.agent} to your folder: 1 file \\(\\+\\d+ −\\d+\\) — \\S+\\.|Not applied yet: Filament is still checking your folder with sub-agent sa_[0-9a-f]{8}'s change, applied before this one\\.)`));
    assert.match(String(seen.heard.at(-1)?.text), /^\[Filament: task t4 "Test the parser" is done: sub-agent sa_[0-9a-f]{8} reported it done with its acceptance check passed — unchecked: the task has no check, and its report named none — and its change is merged into your folder\.\n/);
    // What builds on a merged change starts from it: t4's worktree held t2's fix and t3's docs, and its test passed there.
    assert.match(t4saw.parse, /filter\(Boolean\)/);
    assert.match(t4saw.doc, /an empty field is dropped/);
    const g = graphNow(id);
    assert.deepEqual(g.tasks.find((/** @type {any} */ t) => t.id === "t4").report.ran, [{ command: "node test/parse.test.js", exit: 0 }]);
    assert.deepEqual(g.tasks.map((/** @type {any} */ t) => [t.id, t.state, t.merged?.files ?? 0, t.tries]), [["t1", "done", 0, 1], ["t2", "done", 1, 1], ["t3", "done", 1, 1], ["t4", "done", 1, 1]]);
    // The folder holds every writer's change, merged in; nothing is committed.
    assert.deepEqual([r0.read("src/parse.js"), r0.read("docs/parse.md"), r0.read("test/parse.test.js")], [FIXED, DOC, TEST]);
    assert.equal(r0.git("rev-list", "--count", "HEAD"), "1");
    // The pages drew each change in order, the newest last; the run's timeline has each end as a row of its own — a
    // ready change's while it waits for its apply, merging.
    assert.ok(revs.length >= 9 && revs.every((v, i) => i === 0 || v > revs[i - 1]), revs.join(","));
    assert.equal(revs.at(-1), g.rev);
    const rows = (await eventsOf(r.runId)).filter((/** @type {any} */ e) => e.type === "subagent-report").map((/** @type {any} */ e) => [e.kind, e.task, e.state]);
    assert.deepEqual(rows, seen.heard.map((h) => ["task", h.task, endWord(h) === "ready" ? "merging" : "done"]));
  });

  // (fails before: yes — there was no runner, and a sub-agent ended as it liked: no report to ask for. And
  // HarnessV3-FailurePoints §6 item 2: sent back, the task went to a new sub-agent, the first one's work lost but for
  // its report)
  test("a failure is the agent's to answer: no report — asked for once — fails the task; sent back with a note, its sub-agent goes on in its own conversation, told what failed and the note; a check not met leaves the change in its worktree; dropped, the task goes", async () => {
    const r0 = repo("fail");
    const id = await create(r0.dir);
    /** @type {string[][]} */
    const asked = [];
    /** What the sub-agent read as it went on, the graph then, and the round it went on at. @type {{ texts: string[], graph: any, round: number }[]} */
    const wentOn = [];
    /** @type {string[]} */
    const sentBack = [];
    const seen = play(id, {
      agent: (call) => {
        const heard = toldIn(call.body);
        if (answered(call.body).includes("gs")) sentBack.push(textOf(resultIn(call.body, "gs")?.content));
        if (newestTexts(call.body).includes("fix the parser")) return call1("ga", "tasks", { action: "add", goal: "Fix the parser", tasks: [{ ...FIX, needs: [] }] });
        if (heard.some((h) => /failed: it ended without its report/.test(h.text))) return call1("gs", "tasks", { action: "start", ids: ["t2"], note: "End with the report tool." });
        if (heard.some((h) => /failed: its acceptance check did not pass/.test(h.text))) return call1("gd", "tasks", { action: "drop", ids: ["t2"], reason: "the split cannot hold; another way it is" });
        return said(answered(call.body).includes("gd") ? "Dropped it." : WAITING);
      },
      task: (task, round, call) => {
        const texts = newestTexts(call.body);
        if (!wentOn.length && texts.some((t) => t.startsWith(`[Filament: your try at task ${task} ended`))) wentOn.push({ texts, graph: graphNow(id), round });
        const [on] = wentOn;
        if (!on) {
          if (round > 1) asked.push(texts);
          return said(round === 1 ? "I fixed it." : "Fixed, as I said.");
        }
        return rewrites(round - on.round + 1, "src/parse.js", 'module.exports.parse = (s) => s.split(", ");\n', { status: "done", did: "Split on a comma and a space.", met: false, evidence: 'parse("a,") still gives ["a,"]' });
      },
    });
    const r = await turn(id, "fix the parser");
    assert.equal(r.text, `${WAITING.repeat(2)}Dropped it.`);
    assert.deepEqual(asked, [[REPORT_ASK]], "its sub-agent was asked for its report once, and ended without it");
    assert.deepEqual(seen.heard.map((h) => [h.task, states(h.graph)]), [["t2", "failed"], ["t2", "failed"]]);
    inTheGraphsWords(seen);
    assert.equal(seen.starts.length, 1, "one sub-agent: sent back, it went on");
    assert.match(seen.heard[0].text, /^\[Filament: task t2 "Fix the parser" failed: it ended without its report\.\n/);
    const agent = seen.heard[0].graph.tasks[0].agent;
    assert.deepEqual(sentBack, [`Sent t2 back: sub-agent ${agent} goes on with it once its needs are done and a slot is free, in its own conversation — what it did is there, and it reads what failed and your note. 0 of 1 done · ready: t2.\nFilament started t2 again on its sub-agent ${agent}, in its own conversation. Now: 0 of 1 done · running: t2.`]);
    // It went on in the conversation it had, reading what failed, the note and its task as Filament wrote them.
    const [on] = wentOn;
    assert.deepEqual([on.round, on.texts], [3, [resumeText(on.graph, "t2", "agent")]]);
    assert.ok(on.texts[0].startsWith("[Filament: your try at task t2 ended: it ended without its report. The agent sent the task back to you: go on from where you stopped"), on.texts[0]);
    assert.ok(on.texts[0].includes("\n\nThe agent's note for you: End with the report tool.\n\n"), on.texts[0]);
    const [, second] = seen.heard;
    assert.match(second.text, /^\[Filament: task t2 "Fix the parser" failed: its acceptance check did not pass: parse\("a,"\) still gives \["a,"\]\.\n/);
    assert.equal(second.graph.tasks[0].agent, agent, "the same sub-agent");
    assert.ok(second.text.includes(`Its change is not in your folder: it waits in sub-agent ${agent}'s own worktree`), second.text);
    assert.equal(r0.read("src/parse.js"), PARSE, "nothing merged");
    const g = graphNow(id);
    assert.deepEqual([g.tasks[0].state, g.tasks[0].tries, g.tasks[0].why], ["dropped", 2, "the split cannot hold; another way it is"]);
  });

  // (fails before: yes — there was no runner, and no change of a task's merged)
  // The owner's of 11-02: the change waits, ready, for the agent's apply — and that apply is what does not go in.
  // (fails before: yes — g2, the owner's of 11-09: a change that did not merge failed its task, waiting in its worktree)
  test("a change that does not merge goes back to its sub-agent by itself, in the apply's words: the developer's edit stays, and redone on the folder as it stands, it merges", async () => {
    const r0 = repo("conflict");
    const id = await create(r0.dir);
    const MINE = 'module.exports.parse = (s) => s.split(";");\n';
    const BOTH = 'module.exports.parse = (s) => s.split(";").filter(Boolean);\n';
    const seen = play(id, {
      agent: (call) =>
        newestTexts(call.body).includes("fix the parser")
          ? call1("ga", "tasks", { action: "add", goal: "Fix the parser", tasks: [{ ...FIX, needs: [] }] })
          : (applyReady(call.body) ?? said(heardDone(seen.heard, "t2") ? "Merged." : WAITING)),
      task: (task, round) => {
        // The developer changes the same line while the sub-agent works.
        if (round === 1) writeFileSync(join(r0.dir, "src", "parse.js"), MINE);
        // Sent back, it goes on in its conversation: it reads its copy, git's markers in it, and writes what both meant.
        return round <= 4 ? rewrites(round, "src/parse.js", FIXED, FIX_DONE) : rewrites(round - 4, "src/parse.js", BOTH, FIX_DONE);
      },
    });
    const r = await turn(id, "fix the parser");
    assert.match(r.text, /^(Waiting for the graph\.)+Merged\.$/);
    // Heard ready, the agent applied it; nothing went in, and it went back to its sub-agent, which redid it: ready again,
    // applied, merged.
    assert.deepEqual(seen.heard.map((h) => [h.task, endWord(h)]), [["t2", "ready"], ["t2", "?"], ["t2", "ready"], ["t2", "done"]]);
    inTheGraphsWords(seen);
    const [ready, h, again] = seen.heard;
    const agent = ready.graph.tasks[0].agent;
    assert.equal(again.graph.tasks[0].agent, agent, "its own sub-agent redid it");
    // The apply answered at once that nothing went in, and that it went back — as its task's end says.
    assert.equal(seen.applied[0].text, `Nothing applied: 1 file does not come through cleanly — src/parse.js: 1 change overlaps yours. Your folder is as it was. Sent back to redo on the folder, 1 of 2: sub-agent ${agent} redoes its change on your folder as it stands now, git's conflict markers in its copy of src/parse.js for it to resolve. Its report reaches you as a message, and its work waits for your apply again.`);
    assert.match(h.text, new RegExp(`^\\[Filament: task t2 "Fix the parser" did not merge: its change overlapped edits made in your folder since it began — src/parse\\.js: 1 change overlaps yours\\. Filament sent it back to redo on the folder, 1 of 2: sub-agent ${agent} goes on with it in its own conversation`));
    // Merged, its try is over: Filament's send-backs count afresh for the next (the hunt on g2).
    assert.deepEqual([r0.read("src/parse.js"), graphNow(id).tasks[0].rebases], [BOTH, undefined], "the developer's edit and the change, both");
  });

  // (fails before: yes — there was no runner: the Stop left the graph's sub-agent working, and nothing held the graph)
  // (fails before: yes — B4, decision 4: after the agent's tasks call a new sub-agent took the stopped task from the
  // folder as it stood)
  test("the developer's Stop stops the graph's sub-agent and holds the graph: the task waits again, told with the next turn, and its sub-agent goes on with it after the agent's tasks call", async () => {
    const r0 = repo("stop");
    const id = await create(r0.dir);
    /** @type {any[]} */
    const before = [];
    const seen = play(id, {
      agent: (call) => {
        const texts = newestTexts(call.body);
        if (texts.includes("fix the parser")) return call1("ga", "tasks", { action: "add", goal: "Fix the parser", tasks: [{ ...FIX, needs: [] }] });
        if (texts.includes("carry on")) {
          before.push(graphNow(id));
          return call1("gs", "tasks", { action: "show" });
        }
        return applyReady(call.body) ?? said(heardDone(seen.heard, "t2") ? "Fixed." : WAITING);
      },
      // Its try runs a long command, which the Stop cuts; started again, it goes on in the conversation it has.
      task: (task, round, call) => {
        const msgs = /** @type {any[]} */ (call.body.messages);
        const texts = (/** @type {any} */ m) => (typeof m.content === "string" ? [m.content] : m.content.filter((/** @type {any} */ c) => c?.type === "text").map((/** @type {any} */ c) => String(c.text)));
        const back = msgs.findLastIndex((m) => m.role === "user" && texts(m).some((/** @type {string} */ t) => t.startsWith("[Filament: the developer stopped you on task t2.")));
        if (back < 0) return call1("b", "bash", { command: 'node -e "setTimeout(() => {}, 15000)"' });
        wentOn.push({ words: texts(msgs[back]).at(-1), earlier: msgs.slice(0, back).filter((m) => m.role === "assistant").length });
        return rewrites(msgs.slice(back).filter((m) => m.role === "assistant").length + 1, "src/parse.js", FIXED, FIX_DONE);
      },
    });
    /** What the sub-agent read as it went on, at each of its calls since. @type {{ words: string, earlier: number }[]} */
    const wentOn = [];
    const first = await streamed(id, "fix the parser");
    const sa = await until(async () => {
      const s = (await subsOf(id)).find((/** @type {any} */ x) => x.task === "t2" && x.status === "running");
      return s?.runId && (await eventsOf(s.runId)).some((/** @type {any} */ e) => e.type === "tool-start" && e.name === "bash") ? s : null;
    }, "the sub-agent's command to start");
    const stop = await shim.api(`/api/runs/${encodeURIComponent(first.runId)}/steer`, { method: "POST", body: { kind: "stop", text: "", from: "harness" } });
    assert.equal(stop.status, 200, await stop.text());
    await first.body;
    const held = await until(() => (graphNow(id).tasks[0].state === "waiting" ? graphNow(id) : null), "the task to wait again");
    assert.deepEqual([!!held.held, held.tasks[0].stopped, held.tasks[0].tries, held.tasks[0].earlier?.why, held.tasks[0].earlier?.agent], [true, "developer", 1, "stopped by the developer", sa.id]);
    assert.equal((await subsOf(id)).find((/** @type {any} */ x) => x.id === sa.id)?.status, "stopped", "its command cut, its run ended stopped");
    assert.equal(seen.heard.length, 0, "the stopped turn heard nothing more");
    const r = await turn(id, "carry on");
    assert.equal(r.text, `${WAITING}Fixed.`);
    // The next turn opened on the stop's words, the graph held: nothing started before the agent's tasks call.
    assert.deepEqual(before.map((g) => [!!g.held, states(g)]), [[true, "waiting"]]);
    // Then its change was ready, and the agent's apply of it merged (the owner's of 11-02).
    assert.deepEqual(seen.heard.map((h) => [h.task, endWord(h)]), [["t2", "stopped"], ["t2", "ready"], ["t2", "done"]]);
    assert.deepEqual(seen.applied.map((a) => a.agent), [sa.id]);
    assert.equal(seen.heard[0].text, endText(held, "t2", { crew: "agent" }));
    assert.match(seen.heard[0].text, /^\[Filament: the developer stopped sub-agent sa_[0-9a-f]{8} on task t2 "Fix the parser"\. The task waits again: after your next tasks call sa_[0-9a-f]{8} goes on with it where it stopped, in its own conversation/);
    inTheGraphsWords(seen);
    // The same sub-agent went on: no second one started, and it read the stop's words under the rounds it had done.
    assert.equal(seen.starts.length, 1);
    assert.ok(wentOn.length >= 3 && wentOn.every((w) => w.earlier >= 1), JSON.stringify(wentOn.map((w) => w.earlier)));
    assert.match(wentOn[0].words, /^\[Filament: the developer stopped you on task t2\. The task is yours again: go on from where you stopped — your work so far is above\.\n\nYour task as it stands now: t2 — Fix the parser\n/);
    assert.equal(r0.read("src/parse.js"), FIXED);
    const g = graphNow(id);
    assert.deepEqual([g.held, g.tasks[0].state, g.tasks[0].tries, g.tasks[0].stopped, g.tasks[0].agent], [null, "done", 2, false, sa.id]);
  });

  // (fails before: no — a guard the mutation pass asked for: no turn ended while its graph's sub-agent ran, so nothing
  // showed that a turn's end lets go of the graph — what a sub-agent's end makes ready waits for the turn that answers)
  test("a turn paused on the developer starts nothing more: what the running sub-agent's end makes ready waits for the turn that answers", async () => {
    const r0 = repo("pause");
    const id = await create(r0.dir);
    const mode = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { loop: { permissions: "edit" } } } });
    assert.equal(mode.status, 200, await mode.text());
    /** @type {() => void} */
    let open = () => {};
    const opened = new Promise((res) => (open = () => res(undefined)));
    /** @type {string[][]} */
    const resumed = [];
    const seen = play(id, {
      agent: (call) => {
        if (newestTexts(call.body).includes("map and fix")) return call1("ga", "tasks", { action: "add", goal: "Fix the parser", tasks: [MAP, FIX] });
        if (answered(call.body).includes("ga")) return call1("b", "bash", { command: 'node -e "1"' });
        if (answered(call.body).includes("b")) resumed.push(newestTexts(call.body));
        return applyReady(call.body) ?? said(heardDone(seen.heard, "t2") ? "Fixed." : WAITING);
      },
      task: (task, round) => (task === "t1" ? (round === 1 ? call1("rp", "report", DONE("One caller: src/main.js.", "rg lists one")) : said("Reported.")) : rewrites(round, "src/parse.js", FIXED, FIX_DONE)),
      gate: (task) => (task === "t1" ? opened : Promise.resolve()),
    });
    assert.match((await turn(id, "map and fix")).text, /May I run this command\?/);
    open();
    const ended = await until(() => (graphNow(id).tasks[0].state === "done" ? graphNow(id) : null), "the explorer's end");
    assert.deepEqual([states(ended), (await subsOf(id)).filter((/** @type {any} */ x) => x.task === "t2").length], ["done,waiting", 0], "nothing starts while the agent waits on the developer");
    const r = await turn(id, "no");
    assert.equal(r.text, `${WAITING}Fixed.`);
    // The answer's turn hears the explorer's end as the graph stood then, and what started as it opened; then t2's change
    // ready, and — the agent's apply of it merged — t2 done (the owner's of 11-02).
    assert.deepEqual(seen.heard.map((h) => [h.task, endWord(h)]), [["t1", "done"], ["t2", "ready"], ["t2", "done"]]);
    assert.equal(seen.heard[0].text, endText(ended, "t1", { crew: "agent" }));
    for (const h of seen.heard.slice(1)) assert.equal(h.text, wordsOf(toldFrom(seen.graphs, h, "agent"), h, "agent"));
    assert.deepEqual(seen.applied.map((a) => a.agent), [seen.heard[1].graph.tasks[1].agent]);
    assert.ok(resumed[0].some((t) => /^\[Filament started t2 on a sub-agent \(sa_[0-9a-f]{8}\)\. /.test(t)), resumed[0].join("\n"));
    assert.equal(r0.read("src/parse.js"), FIXED);
    assert.equal(states(graphNow(id)), "done,done");
  });

  // (fails before: yes — there was no runner: a task a crash cut stayed running, and the agent never heard of it)
  test("a task a crash cut fails as Filament starts again, and the agent hears it once, with its next turn; nothing starts it again by itself", async () => {
    const r0 = repo("crash");
    const id = await create(r0.dir);
    // The graph as a crash left it: t2's sub-agent ran.
    const added = applyTasks(null, { action: "add", goal: "Fix the parser", tasks: [{ ...FIX, needs: [] }, { ...CHECK, needs: ["t2"] }] }, { at: 1, crew: "agent" });
    assert.ok(added.ok);
    const running = launched(/** @type {any} */ (added.graph), "t2", "sa_0c0ffee0", 2, "sub-agent");
    /** @type {any} */ (shim.app).memory.archive.mergeMeta(id, { graph: { ...running, rev: 3 } });
    const dataDir = shim.dataDir;
    await shim.stop();
    shim = await startApp({ memory: true, keep: true, dataDir, configure });
    const cut = graphNow(id);
    assert.deepEqual([cut.rev, cut.tasks.map((/** @type {any} */ t) => [t.id, t.state, t.why])], [4, [["t2", "failed", "cut by a Filament restart"], ["t4", "waiting", ""]]]);
    const seen = play(id, { agent: (call) => said(newestTexts(call.body).includes("where were we") ? "I will send it back." : "Again."), task: () => said("Nothing.") });
    assert.equal((await turn(id, "where were we")).text, "I will send it back.");
    await turn(id, "again");
    assert.deepEqual(seen.heard.map((h) => h.task), ["t2"], "told once");
    assert.equal(seen.heard[0].text, endText(cut, "t2", { crew: "agent" }));
    inTheGraphsWords(seen);
    assert.deepEqual([seen.starts.length, states(graphNow(id))], [0, "failed,waiting"]);
  });

  // (fails before: no — a guard the mutation pass asked for: no test ran a team's lead on the graph through its
  // session's turns, so the turn's wiring for a lead went unchecked — who plans, the graph's run with the team's
  // workers, and its launcher's refusals)
  // The owner's of 11-02: the builder's change, its review met, is ready, and nothing of Filament's merges it — the lead
  // applies it through its worker tool, an order as any other, which runs at once.
  test("a team's lead runs the graph: its add runs at once beside what is refused; each task goes to the team's worker of its role, a reviewer reads the builder's change before it is ready, and the lead's apply of it merges it", async () => {
    const r0 = repo("team");
    const id = await teamSession(r0.dir);
    const ADD = { action: "add", goal: "Fix the parser", tasks: [{ ...MAP, by: "scout" }, { ...FIX, by: "builder", review: true }] };
    const WHY = "A scout maps the callers; a builder fixes the parser, and a reviewer reads its change first.";
    const MET = { status: "done", did: "Read the change to src/parse.js against the task.", met: true, evidence: 'parse("a,") gives ["a"]', left: "" };
    /** Each end the lead heard, the graph then, and the lead's call it came in (from 0). @type {{ task: string, text: string, graph: any, at: number }[]} */
    const heard = [];
    /** @type {{ opening: string[], graph: any }[]} */
    const reviews = [];
    /** @type {any[]} */
    const leads = [];
    const graphs = keptGraphs(id);
    /** t2 and the folder as the lead's apply of t2's change is made. @type {any} */
    let atApply = null;
    brain = async (call) => {
      if (isReviewer(call)) {
        if (roundOf(call) > 1) return said("Reviewed.");
        reviews.push({ opening: openingOf(call), graph: graphNow(id) });
        return call1("rv", "report", MET);
      }
      if (isWorkerTask(call)) {
        const task = taskOf(call);
        const round = roundOf(call);
        // t1 starts once the lead's call with the add's answer was made: its end, told as t2 started, wakes the lead at
        // once, t2 needing it (the review of 11-03).
        if (round === 1 && task === "t1") await until(() => leads.length >= 2, "the lead's call with the add's answer");
        if (task === "t1") return round === 1 ? call1("r1", "report", DONE("One caller: src/main.js:2", "grep -rn 'parse(' src lists src/main.js:2")) : said("Reported.");
        return rewrites(round, "src/parse.js", FIXED, FIX_DONE);
      }
      if (!isLead(call)) return undefined;
      const at = leads.push(call.body) - 1;
      for (const h of toldIn(call.body)) heard.push({ ...h, graph: graphNow(id), at });
      if (newestTexts(call.body).includes("fix the parser, as a team"))
        return reply([{ type: "text", text: WHY }, toolUse("gs", "tasks", { action: "start", ids: ["t1"] }), toolUse("bad", "agent", { role: "scout", description: "Look around", steps: ["List the files"], acceptance: "every file is named" }), toolUse("ga", "tasks", ADD)], "tool_use");
      const apply = applyReady(call.body, "worker");
      if (apply && !atApply) {
        const t2 = graphNow(id).tasks.find((/** @type {any} */ t) => t.id === "t2");
        atApply = { state: t2.state, step: t2.step, file: r0.read("src/parse.js") };
      }
      return apply ?? said(heardDone(heard, "t2") ? "Shipped." : WAITING);
    };
    // One turn: the start the graph refuses, the brief its launcher refuses and the add ran at once; the turn waited for
    // the graph's work — t1's end, then t2's — and the lead's apply heard its verdict.
    const first = await turn(id, "fix the parser, as a team");
    assert.equal(first.text, `${WHY}${WAITING.repeat(2)}Shipped.`);
    assert.ok(!(await shim.record(first.runId)).changes.some((/** @type {string} */ c) => c.includes("proposal")));
    const builder = heard.find((h) => h.task === "t2")?.graph.tasks.find((/** @type {any} */ t) => t.id === "t2").agent;
    assert.deepEqual(atApply, { state: "merging", step: "yours", file: PARSE }, "ready, and nothing in the folder before the lead's apply");
    const [results] = leads.slice(1);
    assert.deepEqual([resultIn(results, "gs")?.is_error, textOf(resultIn(results, "gs")?.content)], [true, "Error: there is no graph yet — tasks add starts one, with its goal"]);
    assert.deepEqual([resultIn(results, "bad")?.is_error, /goal is required/.test(textOf(resultIn(results, "bad")?.content))], [true, true]);
    assert.match(textOf(resultIn(results, "ga")?.content), /^Added t1, t2\. [\s\S]*\nFilament started t1 on a scout \(sa_[0-9a-f]{8}\)\. Now: /);
    // Each task went to the team's worker of its role, and a reviewer of the team read the builder's change first.
    const rows = (await subsOf(id)).map((/** @type {any} */ s) => [s.task, s.team?.role, s.status]);
    assert.deepEqual(rows.sort(), [["t1", "scout", "done"], ["t2", "builder", "done"], ["t2", "reviewer", "done"]]);
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].opening.at(-1), reviewBrief(reviews[0].graph, "t2", LED));
    // The lead heard each end in its own words, as the graph stood when Filament told it: t1's — told as t2 started, which
    // needs it — at once, on its own; then t2's change ready; then t2 done as its apply merged, in the call that heard
    // what the apply answered.
    assert.deepEqual(heard.map((h) => [h.task, endWord(h), h.at]), [["t1", "done", 2], ["t2", "ready", 3], ["t2", "done", 4]]);
    for (const h of heard) assert.equal(h.text, wordsOf(toldFrom(graphs, h, LED), h, LED), `what the lead heard of ${h.task}`);
    assert.match(heard[1].text, new RegExp(`^\\[Filament: task t2 "Fix the parser" is ready: builder ${builder} reported it done with its acceptance check passed — unchecked: the task has no check, and its report named none — its reviewer found the change does what the task asks\\. Its change waits in ${builder}'s own copy, not in the folder yet: apply it when you choose — worker with agent_id "${builder}" and apply_changes: true\\.`));
    // Its apply answered as the change went into the folder.
    assert.equal(textOf(resultIn(leads[4], `ap_${builder}`)?.content), `Applied the changes of sub-agent ${builder} to your folder: 1 file (+1 −1) — src/parse.js.`);
    const g = graphNow(id);
    const t2 = g.tasks.find((/** @type {any} */ t) => t.id === "t2");
    assert.deepEqual([states(g), t2.agent, t2.ranAs, t2.merged?.files, t2.reviews.map((/** @type {any} */ r) => [r.round, r.met])], ["done,done", builder, "builder", 1, [[1, true]]]);
    assert.equal(r0.read("src/parse.js"), FIXED);
    assert.equal(r0.git("rev-list", "--count", "HEAD"), "1");
  });

  // (fails before: yes — the owner's words of 10-26: a task under the session's agent always started from its brief, so
  // none of its work read the planner's conversation from the provider's cache)
  test("while the agent's cache is warm and its request leaves room, its task starts as its fork: the planner's prompt and tools as sent, its conversation, told the task is the graph's; its report ends the task", async () => {
    // A window to weigh the request against: with none known a task starts from its brief.
    const st = await (await shim.api("/api/state")).json();
    const priced = st.config.upstreams.map((/** @type {any} */ u) => (u.id === "m" ? { ...u, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200_000 } } } : u));
    assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams: priced } })).status, 200);
    try {
      const r0 = repo("fork");
      const id = await create(r0.dir);
      /** The agent's replies, read from the provider's cache: 2,000 tokens, far under half the 170,000-token line. */
      const warm = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7, cache_read_input_tokens: 2_000 } });
      /** @type {any[]} */
      const agents = [];
      /** @type {any[]} */
      const forks = [];
      /** @type {any[]} */
      const fresh = [];
      let heard = false;
      brain = async (call) => {
        if (newestTexts(call.body).some((t) => t.includes("which planned its work as a task graph and gave you one of its tasks"))) {
          forks.push(call.body);
          return reply([toolUse("fr", "report", DONE("One caller: src/main.js:2", "grep -rn 'parse(' src lists src/main.js:2"))], "tool_use");
        }
        if (answered(call.body).includes("fr")) return said("Reported.");
        if (isTask(call)) {
          fresh.push(call.body);
          return said("Reported.");
        }
        if (!isAgent(call)) return undefined;
        agents.push(call.body);
        heard ||= toldIn(call.body).some((h) => h.task === "t1");
        if (newestTexts(call.body).includes("map the parser")) return warm([toolUse("ga", "tasks", { action: "add", goal: "Map the parser", tasks: [MAP] })], "tool_use");
        return warm([{ type: "text", text: heard ? "Mapped." : WAITING }]);
      };
      const r = await turn(id, "map the parser");
      assert.ok(r.text.endsWith("Mapped."), r.text);
      assert.deepEqual([forks.length, fresh.length], [1, 0], "a fork, and no fresh start");
      const [fork] = forks;
      const planner = agents[0];
      assert.deepEqual([fork.model, fork.system, fork.tools], [planner.model, planner.system, planner.tools], "the planner's model, prompt and tools, byte for byte");
      // Its conversation first, the cache's breakpoints aside: each request marks its own newest message.
      const unmarked = (/** @type {any} */ m) => ({ ...m, content: m.content.map((/** @type {any} */ { cache_control: _, ...rest }) => rest) });
      assert.deepEqual(unmarked(fork.messages[0]), unmarked(planner.messages[0]), "its conversation first");
      const told = newestTexts(fork).join("\n\n");
      assert.ok(told.includes(briefText(graphNow(id), "t1", "agent")), "the task's brief follows the note");
      assert.match(told, /end it with the report tool/);
      const g = graphNow(id);
      assert.deepEqual(g.tasks.map((/** @type {any} */ t) => [t.id, t.state, t.report?.did]), [["t1", "done", "One caller: src/main.js:2"]]);
      const sub = (await subsOf(id)).find((/** @type {any} */ x) => x.id === g.tasks[0].agent);
      assert.equal(sub?.model, "brain-model", "on the planner's model");
    } finally {
      assert.equal((await shim.api("/api/config", { method: "PUT", body: st.config })).status, 200);
    }
  });

  // The owner's word of 11-02: a fork works under its own line, the lower of 400K and 85% of its window, so it is
  // weighed against that line, not its planner's.
  // (fails before: yes — weighed against the planner's 850,000-token line, a 300,000-token conversation forked, past
  // half the fork's own 400,000 before its first round)
  test("on a 1M window, a task whose planner's request is past half the fork's 400,000-token line starts from its brief", async () => {
    const st = await (await shim.api("/api/state")).json();
    const priced = st.config.upstreams.map((/** @type {any} */ u) => (u.id === "m" ? { ...u, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 1_000_000 } } } : u));
    assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams: priced } })).status, 200);
    try {
      const r0 = repo("fork-big");
      const id = await create(r0.dir);
      /** The agent's replies, read from the provider's cache: 300,000 tokens, under its own 850,000 line, past half the fork's. */
      const big = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7, cache_read_input_tokens: 300_000 } });
      /** @type {any[]} */
      const forks = [];
      /** @type {any[]} */
      const fresh = [];
      let heard = false;
      brain = async (call) => {
        if (newestTexts(call.body).some((t) => t.includes("which planned its work as a task graph and gave you one of its tasks"))) {
          forks.push(call.body);
          return reply([toolUse("fr", "report", DONE("One caller: src/main.js:2", "grep -rn 'parse(' src lists src/main.js:2"))], "tool_use");
        }
        if (answered(call.body).includes("fr")) return said("Reported.");
        if (isTask(call)) {
          fresh.push(call.body);
          return said("Reported.");
        }
        if (!isAgent(call)) return undefined;
        heard ||= toldIn(call.body).some((h) => h.task === "t1");
        if (newestTexts(call.body).includes("map the parser")) return big([toolUse("ga", "tasks", { action: "add", goal: "Map the parser", tasks: [MAP] })], "tool_use");
        return big([{ type: "text", text: heard ? "Mapped." : WAITING }]);
      };
      await turn(id, "map the parser");
      assert.deepEqual([forks.length, fresh.length > 0], [0, true], "no fork: it started from its brief");
    } finally {
      assert.equal((await shim.api("/api/config", { method: "PUT", body: st.config })).status, 200);
    }
  });

  // (fails before: yes — the bug hunt of 11-02: a task's fork was weighed by the newest request's count alone, which a
  // conversation grown since leaves behind — here a count of 2,000 tokens, its conversation over 100,000)
  test("a task whose planner's conversation as it stands is past half the fork's line starts from its brief, though its newest request's count is small", async () => {
    const st = await (await shim.api("/api/state")).json();
    const priced = st.config.upstreams.map((/** @type {any} */ u) => (u.id === "m" ? { ...u, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200_000 } } } : u));
    assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams: priced } })).status, 200);
    try {
      const r0 = repo("fork-grown");
      const id = await create(r0.dir);
      /** The agent's replies, counted 2,000 tokens read from the provider's cache, as the 85,000 half line would let fork. */
      const warm = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7, cache_read_input_tokens: 2_000 } });
      /** @type {any[]} */
      const forks = [];
      /** @type {any[]} */
      const fresh = [];
      let heard = false;
      brain = async (call) => {
        if (newestTexts(call.body).some((t) => t.includes("which planned its work as a task graph and gave you one of its tasks"))) {
          forks.push(call.body);
          return reply([toolUse("fr", "report", DONE("One caller: src/main.js:2", "grep -rn 'parse(' src lists src/main.js:2"))], "tool_use");
        }
        if (answered(call.body).includes("fr")) return said("Reported.");
        if (isTask(call)) {
          fresh.push(call.body);
          return said("Reported.");
        }
        if (!isAgent(call)) return undefined;
        heard ||= toldIn(call.body).some((h) => h.task === "t1");
        if (newestTexts(call.body).some((t) => t.startsWith("map the parser"))) return warm([toolUse("ga", "tasks", { action: "add", goal: "Map the parser", tasks: [MAP] })], "tool_use");
        return warm([{ type: "text", text: heard ? "Mapped." : WAITING }]);
      };
      // Over 100,000 tokens of notes the planner was handed: past half the fork's 170,000-token line.
      await turn(id, `map the parser\n\n${"the parser reads tokens one at a time and builds the tree. ".repeat(8_000)}`);
      assert.deepEqual([forks.length, fresh.length > 0], [0, true], "no fork: it started from its brief");
    } finally {
      assert.equal((await shim.api("/api/config", { method: "PUT", body: st.config })).status, 200);
    }
  });

  // (fails before: yes — the bug hunt of 11-02: with no window known the graph weighed a task's fork against a line of 0,
  // so a warm 2,000-token request never forked, while a fork launched by name was weighed against no line at all)
  test("with no window known, a task forks while its planner's request is under half the assumed window's line, and starts from its brief past it", async () => {
    for (const [read, forked] of /** @type {[number, boolean][]} */ ([[2_000, true], [60_000, false]])) {
      const r0 = repo(`fork-assumed-${read}`);
      const id = await create(r0.dir);
      /** The agent's replies, read from the provider's cache: half the 108,800-token line of the window assumed is 54,400. */
      const warm = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7, cache_read_input_tokens: read } });
      /** @type {any[]} */
      const forks = [];
      /** @type {any[]} */
      const fresh = [];
      let heard = false;
      brain = async (call) => {
        if (newestTexts(call.body).some((t) => t.includes("which planned its work as a task graph and gave you one of its tasks"))) {
          forks.push(call.body);
          return reply([toolUse("fr", "report", DONE("One caller: src/main.js:2", "grep -rn 'parse(' src lists src/main.js:2"))], "tool_use");
        }
        if (answered(call.body).includes("fr")) return said("Reported.");
        if (isTask(call)) {
          fresh.push(call.body);
          return said("Reported.");
        }
        if (!isAgent(call)) return undefined;
        heard ||= toldIn(call.body).some((h) => h.task === "t1");
        if (newestTexts(call.body).includes("map the parser")) return warm([toolUse("ga", "tasks", { action: "add", goal: "Map the parser", tasks: [MAP] })], "tool_use");
        return warm([{ type: "text", text: heard ? "Mapped." : WAITING }]);
      };
      await turn(id, "map the parser");
      assert.deepEqual([forks.length > 0, fresh.length > 0], [forked, !forked], `${read.toLocaleString()} tokens read from the cache: ${forked ? "a fork" : "no fork, it started from its brief"}`);
    }
  });

  // (fails before: yes — the bug hunt of 11-03: with no window known the loop weighed none of its conversation, so a
  // task that started while its planner's request was out was weighed by the newest count alone — 2,037 tokens, the
  // request before the one out — and forked with the some 130,000 tokens read since)
  test("with no window known, a task that starts while its planner's request is out starts from its brief where the conversation grew past half the assumed line since the newest count", async () => {
    const r0 = repo("fork-assumed-grown");
    const paths = notes(r0.dir);
    const id = await create(r0.dir);
    const TESTS = { id: "t2", name: "List the parser's tests", needs: ["t1"], by: "explorer", goal: "Every test of parse() is known", steps: ["Search the tests for parse("], acceptance: "each test is listed with its file" };
    /** The agent's replies, read from the provider's cache: 2,000 tokens, far under half the assumed line. */
    const warm = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7, cache_read_input_tokens: 2_000 } });
    const NOTE = "which planned its work as a task graph and gave you one of its tasks";
    /** The task a fork does, from its instruction; "" for any other call. @param {any} body */
    const forkOf = (body) => {
      for (const m of body?.messages || []) for (const b of Array.isArray(m.content) ? m.content : []) if (b?.type === "text" && String(b.text).includes(NOTE)) return /Your task: (\S+) — /.exec(String(b.text))?.[1] || "?";
      return "";
    };
    /** @type {string[]} */
    const forks = [];
    /** @type {string[]} */
    const fresh = [];
    /** @type {() => void} */
    let grow = () => {};
    const grown = new Promise((res) => (grow = () => res(undefined)));
    /** @type {() => void} */
    let begin = () => {};
    const begun = new Promise((res) => (begin = () => res(undefined)));
    let heard = false;
    brain = async (call) => {
      const t = forkOf(call.body);
      if (t) {
        if (answered(call.body).includes("fr")) return said("Reported.");
        forks.push(t);
        if (t === "t2") begin();
        // t1 ends, and t2 starts, once the notes are read: while the request that carries them is out.
        if (t === "t1") await grown;
        return call1("fr", "report", DONE("One caller: src/main.js:2", "grep -rn 'parse(' src lists src/main.js:2"));
      }
      if (isTask(call)) {
        if (answered(call.body).includes("rp")) return said("Reported.");
        fresh.push(taskOf(call));
        if (taskOf(call) === "t2") begin();
        return call1("rp", "report", DONE("No test calls parse()", "grep -rn 'parse(' test lists none"));
      }
      if (!isAgent(call)) return undefined;
      heard ||= toldIn(call.body).some((h) => h.task === "t2");
      if (newestTexts(call.body).includes("map the parser and its tests")) return warm([toolUse("ga", "tasks", { action: "add", goal: "Map the parser and its tests", tasks: [MAP, TESTS] })], "tool_use");
      if (answered(call.body).includes("ga")) return warm(paths.map((path, i) => toolUse(`rd${i}`, "read", { path })), "tool_use");
      if (answered(call.body).includes("rd0")) {
        // The request with the notes is out; the newest count is the request before it.
        grow();
        await begun;
        return warm([{ type: "text", text: WAITING }]);
      }
      return warm([{ type: "text", text: heard ? "Mapped." : WAITING }]);
    };
    const r = await turn(id, "map the parser and its tests");
    assert.ok(r.text.endsWith("Mapped."), r.text);
    assert.deepEqual([forks, fresh], [["t1"], ["t2"]], "t1 a fork of the request as it was; t2, the conversation grown past half the line since, from its brief");
  });

  // (fails before: yes — the bug hunt of 11-03: with no window known the loop weighed none of its conversation, so a
  // fork launched by name while a request was out was weighed by the request before it — 2,037 tokens — and copied the
  // some 130,000 tokens read since)
  test("with no window known, a fork launched by name while the agent's request is out is weighed by the conversation it copies: past half the assumed line, refused", async () => {
    const r0 = repo("fork-named-grown");
    const paths = notes(r0.dir);
    const id = await create(r0.dir);
    const warm = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7, cache_read_input_tokens: 2_000 } });
    /** @type {any[]} */
    const forks = [];
    /** @type {() => void} */
    let out = () => {};
    const sent = new Promise((res) => (out = () => res(undefined)));
    /** @type {() => void} */
    let go = () => {};
    const answer = new Promise((res) => (go = () => res(undefined)));
    brain = async (call) => {
      if (newestTexts(call.body).some((t) => t.includes(SUBAGENT_NOTES.fork))) {
        forks.push(call.body);
        return said("Looked.");
      }
      if (!isAgent(call)) return undefined;
      if (newestTexts(call.body).includes("read the notes")) return warm(paths.map((path, i) => toolUse(`rd${i}`, "read", { path })), "tool_use");
      if (answered(call.body).includes("rd0")) {
        // The request with the notes is out; the newest count is the request before it.
        out();
        await answer;
      }
      return warm([{ type: "text", text: "Read." }]);
    };
    const ended = turn(id, "read the notes");
    await sent;
    const launched = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "Say what the notes add up to.", description: "Notes", view: "fork", deliver: false } });
    go();
    assert.ok((await ended).text.endsWith("Read."));
    const why = String((await launched.json()).error || "");
    assert.equal(launched.status, 400, why);
    const weighed = /^the main agent's conversation is ([\d,]+) tokens, past half a fork's 108,800-token compaction line/.exec(why);
    assert.ok(weighed && Number(weighed[1].replace(/,/g, "")) > 54_400, why);
    assert.equal(forks.length, 0, "no fork ran");
  });

  // A fork's own run keeps the window the session holds as it starts, which its launch weighs it against: a task's fork
  // is weighed against that one too, not the one its planner's turn started on.
  // (fails before: yes — the bug hunt of 11-03: the graph weighed a task's fork against the line of the window its
  // planner's turn started on, 200,000, while the launch read the session's as it stood, widened to 1,000,000: a
  // 100,037-token request, under half the fork's 400,000 line, started from its brief as past half 170,000)
  test("a task's fork is weighed against the window the session holds as the task starts: one widened while the turn runs is the fork's", async () => {
    const st = await (await shim.api("/api/state")).json();
    const priced = st.config.upstreams.map((/** @type {any} */ u) => (u.id === "m" ? { ...u, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200_000, windows: [200_000, 1_000_000] } } } : u));
    assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams: priced } })).status, 200);
    try {
      const r0 = repo("fork-widened");
      const id = await create(r0.dir);
      const TESTS = { id: "t2", name: "List the parser's tests", needs: ["t1"], by: "explorer", goal: "Every test of parse() is known", steps: ["Search the tests for parse("], acceptance: "each test is listed with its file" };
      /** The agent's replies, read from the provider's cache: 100,000 tokens, past half the 200,000 window's line, under half the 1M window's. */
      const big = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7, cache_read_input_tokens: 100_000 } });
      const NOTE = "which planned its work as a task graph and gave you one of its tasks";
      /** The task a fork does, from its instruction; "" for any other call. @param {any} body */
      const forkOf = (body) => {
        for (const m of body?.messages || []) for (const b of Array.isArray(m.content) ? m.content : []) if (b?.type === "text" && String(b.text).includes(NOTE)) return /Your task: (\S+) — /.exec(String(b.text))?.[1] || "?";
        return "";
      };
      /** @type {string[]} */
      const forks = [];
      /** @type {string[]} */
      const fresh = [];
      /** @type {() => void} */
      let out = () => {};
      const sent = new Promise((res) => (out = () => res(undefined)));
      /** @type {() => void} */
      let widen = () => {};
      const widened = new Promise((res) => (widen = () => res(undefined)));
      /** @type {() => void} */
      let begin = () => {};
      const begun = new Promise((res) => (begin = () => res(undefined)));
      let heard = false;
      brain = async (call) => {
        const t = forkOf(call.body);
        if (t) {
          if (answered(call.body).includes("fr")) return said("Reported.");
          forks.push(t);
          if (t === "t2") begin();
          return call1("fr", "report", DONE("No test calls parse()", "grep -rn 'parse(' test lists none"));
        }
        if (isTask(call)) {
          if (answered(call.body).includes("rp")) return said("Reported.");
          fresh.push(taskOf(call));
          if (taskOf(call) === "t2") begin();
          // t1 ends, and t2 starts, once the window is widened.
          if (taskOf(call) === "t1") await widened;
          return call1("rp", "report", DONE("One caller: src/main.js:2", "grep -rn 'parse(' src lists src/main.js:2"));
        }
        if (!isAgent(call)) return undefined;
        heard ||= toldIn(call.body).some((h) => h.task === "t2");
        if (newestTexts(call.body).includes("map the parser and its tests")) return big([toolUse("ga", "tasks", { action: "add", goal: "Map the parser and its tests", tasks: [MAP, TESTS] })], "tool_use");
        if (answered(call.body).includes("ga")) {
          out();
          await begun;
          return big([{ type: "text", text: WAITING }]);
        }
        return big([{ type: "text", text: heard ? "Mapped." : WAITING }]);
      };
      const ended = turn(id, "map the parser and its tests");
      await sent;
      const wide = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { model: { window: 1_000_000 } } } });
      widen();
      assert.equal(wide.status, 200, await wide.text());
      assert.ok((await ended).text.endsWith("Mapped."));
      assert.deepEqual([forks, fresh], [["t2"], ["t1"]], "t1 from its brief, past half the 200,000 window's line; t2 a fork, under half the line of the 1M window the session holds as it starts");
    } finally {
      assert.equal((await shim.api("/api/config", { method: "PUT", body: st.config })).status, 200);
    }
  });

  // (fails before: yes — the bug hunt of 10-26: a task waiting as a turn opens was weighed against a turn that had sent
  // nothing yet, so it started from its brief though the last turn's request was cached and kept for it)
  test("a task that waits for the turn that answers starts as a fork of the last turn's request, kept while it is cached", async () => {
    const st = await (await shim.api("/api/state")).json();
    const priced = st.config.upstreams.map((/** @type {any} */ u) => (u.id === "m" ? { ...u, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200_000 } } } : u));
    assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams: priced } })).status, 200);
    try {
      const r0 = repo("fork-waits");
      const id = await create(r0.dir);
      const mode = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { loop: { permissions: "edit" } } } });
      assert.equal(mode.status, 200, await mode.text());
      const warm = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7, cache_read_input_tokens: 2_000 } });
      const NOTE = "which planned its work as a task graph and gave you one of its tasks";
      /** The task a fork does, from its instruction; "" for any other call. @param {any} body */
      const forkOf = (body) => {
        for (const m of body?.messages || []) for (const b of Array.isArray(m.content) ? m.content : []) if (b?.type === "text" && String(b.text).includes(NOTE)) return /Your task: (\S+) — /.exec(String(b.text))?.[1] || "?";
        return "";
      };
      /** @type {Record<string, number>} */
      const forks = {};
      /** @type {string[]} */
      const fresh = [];
      /** @type {() => void} */
      let open = () => {};
      const opened = new Promise((res) => (open = () => res(undefined)));
      let t2done = false;
      brain = async (call) => {
        const t = forkOf(call.body);
        if (t) {
          forks[t] = (forks[t] || 0) + 1;
          const done = answered(call.body);
          if (t === "t1") {
            if (forks[t] === 1) await opened;
            return done.includes("rp1") ? said("Reported.") : call1("rp1", "report", DONE("One caller: src/main.js.", "rg lists one"));
          }
          if (done.includes("rp2")) return said("Reported.");
          if (done.includes("wr2")) return call1("rp2", "report", FIX_DONE);
          if (done.includes("rd2")) return call1("wr2", "write", { path: "src/parse.js", content: FIXED });
          return call1("rd2", "read", { path: "src/parse.js" });
        }
        if (isTask(call)) {
          fresh.push(taskOf(call));
          return said("Reported.");
        }
        if (!isAgent(call)) return undefined;
        t2done ||= heardDone(toldIn(call.body), "t2");
        if (newestTexts(call.body).includes("map and fix")) return warm([toolUse("ga", "tasks", { action: "add", goal: "Fix the parser", tasks: [MAP, FIX] })], "tool_use");
        if (answered(call.body).includes("ga")) return warm([toolUse("b", "bash", { command: 'node -e "1"' })], "tool_use");
        // t2's change is ready in its copy: the agent applies it (the owner's of 11-02).
        return applyReady(call.body, "agent", warm) ?? warm([{ type: "text", text: t2done ? "Fixed." : WAITING }]);
      };
      assert.match((await turn(id, "map and fix")).text, /May I run this command\?/);
      open();
      await until(() => (graphNow(id).tasks[0].state === "done" ? true : null), "the explorer's end");
      assert.equal(states(graphNow(id)), "done,waiting", "t2 waits for the turn that answers");
      const r = await turn(id, "no");
      assert.ok(r.text.endsWith("Fixed."), r.text);
      assert.deepEqual([Object.keys(forks).sort(), fresh], [["t1", "t2"], []], "both forks: t1 of the running turn, t2 of the paused one's request, kept");
      assert.equal(r0.read("src/parse.js"), FIXED, "its change merged, applied by the agent");
      assert.equal(states(graphNow(id)), "done,done");
    } finally {
      assert.equal((await shim.api("/api/config", { method: "PUT", body: st.config })).status, 200);
    }
  });

  // (fails before: no — a guard the mutation pass asked for: what a restart cut is told while no turn runs, in the
  // words of whoever plans the session's graph — under a team its lead, which the server reads from the session)
  test("a task a crash cut under a team is told to its lead in a lead's words, with its next turn", async () => {
    const r0 = repo("team-crash");
    const id = await teamSession(r0.dir);
    const added = applyTasks(null, { action: "add", goal: "Fix the parser", tasks: [{ ...FIX, needs: [], by: "builder" }] }, { at: 1, crew: LED });
    assert.ok(added.ok);
    const running = launched(/** @type {any} */ (added.graph), "t2", "sa_0c0ffee1", 2, "builder");
    /** @type {any} */ (shim.app).memory.archive.mergeMeta(id, { graph: { ...running, rev: 3 } });
    const dataDir = shim.dataDir;
    await shim.stop();
    shim = await startApp({ memory: true, keep: true, dataDir, configure });
    const cut = graphNow(id);
    assert.deepEqual(cut.tasks.map((/** @type {any} */ t) => [t.id, t.state, t.why]), [["t2", "failed", "cut by a Filament restart"]]);
    /** @type {string[]} */
    const heard = [];
    brain = (call) => {
      if (!isLead(call)) return undefined;
      heard.push(...toldIn(call.body).map((h) => h.text));
      return said("I will send it back.");
    };
    assert.equal((await turn(id, "where were we")).text, "I will send it back.");
    assert.deepEqual(heard, [endText(cut, "t2", { crew: LED })]);
    assert.match(heard[0], /\nYour choices: send it back — tasks start with its id and a note: its worker goes on where it stopped, in its own conversation, or with fresh: true a new one starts from the folder as it stands; re-plan around it/);
  });
});
