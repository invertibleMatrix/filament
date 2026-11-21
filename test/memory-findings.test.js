// @ts-check
// What a sub-agent finds becomes claims (HarnessV3-Memory M7-2, M7-D17..D21): its report goes on the observation bus,
// the learner reads it on a line of its own and files what it established as the sub-agent's — inferred, named, in its
// session and on the turn that launched it — and what the sub-agent says itself through the memory tools carries the
// same. Where nothing is filed, the learner's trace says why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { world } from "./fixtures/memory-world.mjs";
import { FINDINGS_MAX, FINDINGS_PROMPT, LEARN_PROMPT } from "../src/services/memory/learn.js";
import { executeMemoryTool, memoryToolCtx } from "../src/app/memory-tools.js";

const TASK = "Find where the API server takes its port, and how the tests run.";
const REPORT = "The API server reads its port from config/server.json. The tests run with `bun test`; `npm test` fails here.";
const CALLS = [
  { tool: "read", input: '{"path":"config/server.json"}', ok: true },
  { tool: "bash", input: '{"command":"npm test"}', ok: false },
  { tool: "bash", input: '{"command":"bun test"}', ok: true },
];
const PORT = "The API server reads its port from config/server.json.";
const TESTS = "Tests in this repo run with `bun test`, never `npm test`.";
const RESET = "How to reset the dev database: 1. stop the server 2. delete data/dev.sqlite 3. run `bun run seed`";

/**
 * A project folder, and a world whose learning model answers what the test says, recording each findings prompt; `hold`
 * keeps the next findings answers back until the function it returns is called.
 * @param {(w: any, m: { answer: (a: any) => void, prompts: any[], hold: () => () => void, live: () => number, most: () => number }) => Promise<void>} body
 */
async function findingsWorld(body) {
  const dir = mkdtempSync(join(tmpdir(), "filament-findings-"));
  /** @type {any} */
  let answer = { items: [] };
  /** @type {any[]} */
  const prompts = [];
  /** @type {Promise<void> | null} */
  let gate = null;
  let live = 0;
  let most = 0;
  const callModel = async (/** @type {any} */ a) => {
    if (a.system !== FINDINGS_PROMPT) return JSON.stringify({});
    prompts.push(a);
    live++;
    most = Math.max(most, live);
    try {
      if (gate) await gate;
      return typeof answer === "string" ? answer : JSON.stringify(answer);
    } finally {
      live--;
    }
  };
  const hold = () => {
    /** @type {() => void} */
    let release = () => {};
    gate = new Promise((r) => (release = r));
    return () => {
      gate = null;
      release();
    };
  };
  try {
    await world({ cwd: dir, models: { summarizer: "cheap" }, callModel }, (w) =>
      body(w, { answer: (a) => (answer = a), prompts, hold, live: () => live, most: () => most }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A sub-agent's exchange that ended done, as the server pushes it. @param {string} chain @param {number | null} turn @param {any} [o] */
const report = (chain, turn, o = {}) => ({ type: "subagent.report", chain, turn, id: "sa_0000abcd", agentType: "explore", model: "brain-model", task: TASK, report: REPORT, calls: CALLS, ...o });
/** Onto the bus, and read: the bus's observers, then the learner's findings line, then the engine's writes. @param {any} w @param {any} e */
async function tell(w, e) {
  w.svc.observe(e);
  await w.svc.observations.settled();
  await w.svc.learner.settled();
  await w.settle();
}
/** The claims a sub-agent's run gave in a session. @param {any} w @param {string} chain */
const findingsIn = (w, chain) => w.svc.archive.items.list({ chainId: chain }).filter((/** @type {any} */ it) => it.origin === "subagent");
/** What the learner's trace said: each operation's title, step and detail. @param {any} w */
function trace(w) {
  /** @type {any[]} */
  const ops = [];
  w.svc.onLearnerOp = (/** @type {string} */ title, /** @type {any} */ o) => ops.push({ title, ...o });
  return ops;
}

test("a sub-agent's report files what it found as the sub-agent's — inferred, named, in its session and on the turn that launched it — and never a rule, a decision, a thread, code or a secret", () =>
  findingsWorld(async (w, m) => {
    const first = await w.session("parent").send("look into the API server");
    const { chain, turn } = first.prep;
    const ops = trace(w);
    /** @type {string[]} */
    const curated = [];
    w.svc.learner.onLearned = (/** @type {string} */ p) => curated.push(p);
    m.answer({
      items: [
        { kind: "fact", text: PORT, importance: 0.7 },
        { kind: "convention", text: TESTS, importance: 0.8, slot: { subject: "project", attribute: "test command", value: "bun test" } },
        { kind: "procedure", text: RESET, importance: 0.7 },
        { kind: "rule", text: "Always use bun for every command in this repo.", importance: 0.9 },
        { kind: "decision", text: "The team keeps the API on the port the config file names.", importance: 0.8 },
        { kind: "thread", text: "src/api.js still needs the retry wrapper.", importance: 0.9 },
        { kind: "fact", text: "const x = require('y'); module.exports = x;", importance: 0.9 },
        { kind: "fact", text: "The staging deploy key is api_key = sk-abcdefghijklmnop.", importance: 0.9 },
        { kind: "fact", text: "The fourth finding is never filed: a report files at most three.", importance: 0.4 },
      ],
    });
    await tell(w, report(chain, turn));
    const found = findingsIn(w, chain);
    assert.deepEqual(
      found.map((/** @type {any} */ it) => [it.kind, it.text, it.status, it.turn_id, it.project_id]).sort(),
      [
        ["convention", TESTS, "inferred", turn, first.sit.project.id],
        ["fact", PORT, "inferred", turn, first.sit.project.id],
        ["procedure", RESET, "inferred", turn, first.sit.project.id],
      ],
    );
    assert.equal(w.svc.archive.items.list({}).filter((/** @type {any} */ it) => /fourth finding|always use bun|retry wrapper|keeps the API|require\('y'\)|sk-abc/i.test(it.text)).length, 0, "nothing else is on file");
    const convention = found.find((/** @type {any} */ it) => it.kind === "convention");
    assert.deepEqual([convention.slot, convention.slot_value], ["project · test command", "bun test"], "its slot as any learned value's");
    const finder = { agent: "sa_0000abcd", type: "explore", model: "brain-model" };
    for (const it of found) {
      const created = w.svc.archive.items.events(it.id).find((/** @type {any} */ e) => e.action === "created");
      assert.deepEqual([created.by, created.detail.finder], ["subagent", finder], "named on its record");
    }
    const owner = w.svc.scope({ role: "owner" });
    const card = owner.claim(`i${convention.id}`);
    assert.deepEqual([card.trust, card.finder], ["a sub-agent found", finder]);
    assert.deepEqual(owner.history(`i${convention.id}`).finder, finder);
    const listed = w.svc.claims(first.sit.project.id, { q: "bun test" }).claims.find((/** @type {any} */ c) => c.id === `i${convention.id}`);
    assert.deepEqual([listed?.sure, listed?.trust, listed?.finder], [0.55, "a sub-agent found", finder], "the claim browser's card: a finding's 0.55, named");
    // Served as found, with the words that say what that means.
    const brief = await w.svc.scope({ role: "agent", project: first.sit.project.id }).brief({ purpose: "subagent", task: "Where does the API server read its port from?", tools: [] });
    const fact = found.find((/** @type {any} */ it) => it.kind === "fact");
    assert.ok(brief.text.split("\n").some((l) => l.startsWith(`- [i${fact.id} fact · a sub-agent found · `) && l.endsWith(PORT)), brief.text);
    assert.ok(brief.text.endsWith('\n"a sub-agent found": what a sub-agent of a session reported or stored, unchecked.'), brief.text);
    const mine = await owner.remember("The owner's own note on the API.", { kind: "fact" });
    assert.equal(owner.claim(mine.id).finder, undefined, "only a sub-agent's claim names one");
    // What the model read: who, the task, each call with a failed one marked, the report.
    assert.equal(m.prompts.length, 1);
    const read = m.prompts[0];
    assert.deepEqual([read.purpose, read.chainId], ["learn", chain]);
    assert.ok(read.user.includes(`Sub-agent sa_0000abcd (explore, on brain-model) of session ${chain}.`), read.user);
    assert.ok(read.user.includes(`Its task:\n${TASK}\n`), read.user);
    assert.ok(read.user.includes('The calls it made, oldest first (3):\n- read {"path":"config/server.json"}\n- bash {"command":"npm test"} (failed)\n- bash {"command":"bun test"}\n'), read.user);
    assert.ok(read.user.includes(`Its report:\n${REPORT}`), read.user);
    assert.ok(FINDINGS_PROMPT.startsWith("A coding session had an AI assistant working in the same project do one task (a sub-agent it launched), and it has reported."));
    // The trace: started, proposed, done — counts and ids only, never the words.
    assert.deepEqual(ops.map((o) => o.sub), ["start", "milestone", "done"]);
    assert.equal(ops[2].title, `learned from sub-agent sa_0000abcd's report (session ${chain}): 3 notes`);
    assert.deepEqual(
      [ops[2].detail.items, ops[2].detail.refused, ops[2].detail.junk, ops[2].detail.secrets, ops[2].detail.over, ops[2].detail.agent, ops[2].detail.reason, ops[2].detail.advanced],
      [3, 3, 1, 1, 1, "sa_0000abcd", "subagent", false],
    );
    assert.equal(ops[1].detail.proposed, 9);
    assert.ok(!JSON.stringify(ops).includes("config/server.json"), "no finding's words in the trace");
    assert.deepEqual(curated, [first.sit.project.id], "the curator hears of it, as of a learning run");
    assert.deepEqual([w.svc.learner.recent[0].reason, w.svc.learner.recent[0].agent, w.svc.learner.recent[0].items], ["subagent", "sa_0000abcd", 3]);
  }));

test("a finding is evidence for a claim another session holds, never for its own session's; and it is said at a call only once a second session backs it", () =>
  findingsWorld(async (w, m) => {
    const other = await w.session("other").send("hello");
    const first = await w.session("parent").send("look into the compose stack");
    const pid = first.sit.project.id;
    const learned = async (/** @type {string} */ chainId, /** @type {string} */ text) => (await w.svc.brain.fileLearned({ projectId: pid, chainId, kind: "fact", text, importance: 0.6 })).id;
    const theirs = await learned(other.prep.chain, "The dev stack starts with `make dev`.");
    const ours = await learned(first.prep.chain, "The dev stack logs to logs/dev.log.");
    await w.settle();
    const trap = "Never run `docker compose up` bare here: run it as `docker compose -f dev.yml up`.";
    m.answer({ items: [{ kind: "fact", text: "The dev stack starts with `make dev`." }, { kind: "fact", text: "The dev stack logs to logs/dev.log." }, { kind: "fact", text: trap }] });
    const ops = trace(w);
    await tell(w, report(first.prep.chain, first.prep.turn));
    const evidence = (/** @type {number} */ id) => w.svc.archive.items.events(id).filter((/** @type {any} */ e) => e.action === "evidence").map((/** @type {any} */ e) => e.detail.chain);
    assert.deepEqual(evidence(theirs), [first.prep.chain], "another session's claim: the sub-agent's session says it again");
    assert.deepEqual(evidence(ours), [], "its own session's: nothing new");
    assert.deepEqual([ops.at(-1).detail.items, ops.at(-1).detail.deduped], [1, 2]);
    const [pit] = findingsIn(w, first.prep.chain);
    assert.equal(pit.text, trap);
    assert.deepEqual(w.svc.archive.triggers.of(pit.id).map((/** @type {any} */ t) => t.tool), ["bash"], "its words name a pitfall");
    const walk = async (/** @type {string} */ id) => {
      const cc = w.claudeCode(id, "start the stack");
      await cc.start();
      return (await cc.ran("bash", { command: "docker compose up" })).back;
    };
    assert.ok(!(await walk("cc-1")).includes(`[memory i${pit.id}`), "a sub-agent's word alone is no reminder");
    w.svc.archive.items.note(pit.id, "evidence", { by: "learner", detail: { chain: other.prep.chain } });
    assert.ok((await walk("cc-2")).includes(`[memory i${pit.id} · a sub-agent found`), "a second session backs it: said at the call, as found");
  }));

test("nothing is filed where the session does not learn, with no learning model, from an empty report or an answer that is no JSON — and the learner's trace says why, naming the sub-agent", () =>
  findingsWorld(async (w, m) => {
    const first = await w.session("parent").send("look into the API server");
    const chain = first.prep.chain;
    m.answer({ items: [{ kind: "fact", text: PORT }] });
    const ops = trace(w);
    /** @param {any} [o] */
    const skipped = async (o = {}) => {
      const before = m.prompts.length;
      await tell(w, report(chain, first.prep.turn, o));
      const end = ops.at(-1);
      assert.equal(end.sub, "skip", JSON.stringify(end));
      assert.equal(end.detail.agent, "sa_0000abcd");
      assert.equal(findingsIn(w, chain).length, 0);
      assert.equal(w.svc.learner.recent[0].skipped, end.detail.skipped);
      return [end.title, m.prompts.length - before];
    };
    const head = `learning from sub-agent sa_0000abcd's report (session ${chain}) skipped — `;
    w.cfg.memory.capture.learn = false;
    assert.deepEqual(await skipped(), [`${head}learning is off (memory.capture.learn)`, 0]);
    w.cfg.memory.capture.learn = true;
    w.svc.archive.mergeMeta(chain, { muted: true });
    assert.deepEqual(await skipped(), [`${head}memory is off for this chat (@mem off, or memory.enabled off): nothing is learned from it`, 0]);
    w.svc.archive.mergeMeta(chain, { muted: undefined, noLearn: true });
    assert.deepEqual(await skipped(), [`${head}the session opted out of learning (memory.learn or privacy.learn is off)`, 0]);
    w.svc.archive.mergeMeta(chain, { noLearn: undefined });
    w.cfg.memory.models.summarizer = "";
    assert.deepEqual(await skipped(), [`${head}no learning model: no model to call: set one in Settings › Memory › Model, or chat on a model a provider serves (a coding agent's alone is no plain model)`, 0], "not set, and nothing a provider serves");
    w.cfg.memory.models.summarizer = "off";
    assert.deepEqual(await skipped(), [`${head}no learning model: memory's model is off (Settings › Memory › Model)`, 0]);
    w.cfg.memory.models.summarizer = "cheap";
    assert.deepEqual(await skipped({ report: "  \n " }), [`${head}the report is empty`, 0]);
    m.answer("I looked at the config file and the tests.");
    const errors = w.svc.learner.stats.errors;
    assert.deepEqual(await skipped(), [`${head}bad json`, 2], "asked again once, firmer");
    assert.deepEqual([w.svc.learner.stats.errors - errors, w.svc.learner.stats.lastError], [1, "model returned no JSON"], "the learner's counts say it");
    assert.ok(m.prompts.at(-1).user.startsWith("Return ONLY the JSON object described, nothing else.\n\n"));
    assert.deepEqual(await skipped({ chain: "no-such-session" }), ["learning from sub-agent sa_0000abcd's report (session no-such-session) skipped — no chain", 0]);
    m.answer({ items: [{ kind: "fact", text: PORT }] });
    const { runs, items } = w.svc.learner.stats;
    await tell(w, report(chain, first.prep.turn));
    assert.equal(findingsIn(w, chain).length, 1, "with all of it back, the same report files");
    assert.deepEqual([w.svc.learner.stats.runs - runs, w.svc.learner.stats.items - items, typeof w.svc.learner.stats.lastRun], [1, 1, "string"], "a reading is a learning run on the status page");
  }));

// (fails before: yes — the owner's decision of 11-01, exclusion follows the chat: a sub-agent's brief and the reading of
// its report asked no exclusion list, so a chat Memory settings leave out still handed its sub-agents what memory holds,
// and what they reported was learned)
test("a chat Memory settings leave out — by its client, its model or its folder — hands its sub-agents no brief, saying why, and nothing is learned from their reports", () =>
  findingsWorld(async (w, m) => {
    const first = await w.session("parent").send("look into the API server");
    const { chain, turn } = first.prep;
    const project = first.sit.project.id;
    const RULE = "Never push without the owner's word.";
    await w.svc.scope({ role: "owner", project }).remember(RULE, { kind: "rule" });
    await w.settle();
    const brief = () => w.svc.scope({ role: "agent", project, chain }).brief({ purpose: "subagent", task: "How do the tests run here?", tools: [] });
    assert.ok((await brief()).text.includes(RULE), "a chat memory works in: its sub-agent's brief carries the user's rules");
    m.answer({ items: [{ kind: "fact", text: PORT }] });
    const none = { excludeClients: [], excludeModels: [], excludeFolders: [] };
    /** @type {[any, string][]} */
    const lists = [
      [{ excludeClients: ["claude"] }, 'client "claude-code" is excluded in Memory settings'],
      [{ excludeModels: ["claude-*"] }, 'model "claude-x" is excluded in Memory settings'],
      [{ excludeFolders: [first.sit.project.cwd] }, "the working folder is excluded in Memory settings"],
    ];
    for (const [list, why] of lists) {
      w.cfg.memory.capture = { ...w.cfg.memory.capture, ...none, ...list };
      const b = await brief();
      assert.deepEqual([b.text, b.why], ["", why], why);
      await tell(w, report(chain, turn));
      assert.deepEqual([m.prompts.length, findingsIn(w, chain).length], [0, 0], `${why}: its sub-agent's report is not read`);
    }
    // An outside agent's brief over /mcp/memory stands in no chat: no exclusion list is asked for it.
    assert.ok((await w.svc.scope({ role: "agent", project }).brief({ purpose: "agent", task: "How do the tests run here?", tools: [] })).text.includes(RULE));
    w.cfg.memory.capture = { ...w.cfg.memory.capture, ...none };
    assert.ok((await brief()).text.includes(RULE));
    await tell(w, report(chain, turn));
    assert.deepEqual([m.prompts.length, findingsIn(w, chain).length], [1, 1], "in again, the same report is read and files");
  }));

// (fails before: yes — the review of dc9d0b837: a sub-agent on a model Memory settings exclude, launched by a chat they
// leave in, was handed the brief — the user's rules and the dossier in its first message, sent to that model every round
// — and what it reported was learned: the brief and the report asked the chat alone)
test("a sub-agent on a model Memory settings exclude, from a chat they leave in, is handed no brief, saying why, and nothing is learned from its report", () =>
  findingsWorld(async (w, m) => {
    const first = await w.session("parent").send("look into the API server");
    const { chain, turn } = first.prep;
    const project = first.sit.project.id;
    const RULE = "Never push without the owner's word.";
    await w.svc.scope({ role: "owner", project }).remember(RULE, { kind: "rule" });
    await w.settle();
    const brief = (/** @type {string} */ model) => w.svc.scope({ role: "agent", project, chain }).brief({ purpose: "subagent", task: "How do the tests run here?", tools: [], model });
    // The effort a sub-agent runs at is in the name its calls send (`sentModel`), never in its model: Memory settings that
    // exclude the one leave the other in, and the report is judged by the name sent.
    w.cfg.memory.capture = { ...w.cfg.memory.capture, excludeClients: [], excludeModels: ["gpt-6-high"], excludeFolders: [] };
    const out = await brief("agent/gpt-6-high");
    assert.deepEqual([out.text, out.why], ["", 'model "agent/gpt-6-high" is excluded in Memory settings']);
    m.answer({ items: [{ kind: "fact", text: PORT }] });
    await tell(w, report(chain, turn, { model: "gpt-6", sentModel: "agent/gpt-6-high" }));
    assert.deepEqual([m.prompts.length, findingsIn(w, chain).length], [0, 0], "its report is not read");
    // A sub-agent of the same chat on a model left in: its brief, and its report read.
    assert.ok((await brief("agent/gpt-6")).text.includes(RULE), "a model left in: the brief carries the user's rules");
    await tell(w, report(chain, turn, { model: "gpt-6-high", sentModel: "agent/gpt-6" }));
    assert.deepEqual([m.prompts.length, findingsIn(w, chain).length], [1, 1], "its report is read and files");
  }));

test("the bus never waits on a report's reading, and the learner reads one report at a time, in the order they came", () =>
  findingsWorld(async (w, m) => {
    const first = await w.session("parent").send("look into the API server");
    const chain = first.prep.chain;
    m.answer({ items: [{ kind: "fact", text: PORT }] });
    const release = m.hold();
    w.svc.observe(report(chain, first.prep.turn));
    w.svc.observe(report(chain, first.prep.turn, { id: "sa_0000beef", report: "A second report." }));
    const raced = await Promise.race([w.svc.observations.settled().then(() => "the bus is free"), new Promise((r) => setTimeout(() => r("the bus waits"), 3000))]);
    const waiting = [m.prompts.length, m.live()];
    // Let go before asserting: a bus that waited fails here instead of holding the world open.
    release();
    assert.equal(raced, "the bus is free");
    assert.deepEqual(waiting, [1, 1], "the second report waits for the first");
    await w.svc.learner.settled();
    await w.settle();
    assert.equal(m.prompts.length, 2);
    assert.equal(m.most(), 1, "never two at once");
    assert.ok(m.prompts[1].user.includes("Sub-agent sa_0000beef"), "in the order they came");
    const [only] = findingsIn(w, chain);
    assert.deepEqual(w.svc.archive.items.events(only.id).find((/** @type {any} */ e) => e.action === "created").detail.finder.agent, "sa_0000abcd", "the first filed it; the second found it on file");
  }));

test("a loop's own tick files what its memory tools write on its loop's turn; a sub-agent's run's tick on the turn that launched it, as the sub-agent's (M7-D20)", () =>
  findingsWorld(async (w) => {
    const s = w.session("dev");
    const dev = await s.send("tidy the API server");
    const tickOf = (/** @type {string} */ run) => s.send("tick", { headers: { "x-filament-memory": "tools", "x-filament-agent-of": run } });
    /** @param {any} t @param {string} name @param {any} input */
    const call = async (t, name, input) => JSON.parse(await executeMemoryTool(memoryToolCtx(w.svc, t.sit, t.prep).scope, name, input));
    const item = (/** @type {string} */ ref) => w.svc.archive.items.get(Number(ref.slice(1)));

    const own = await tickOf(dev.requestId);
    assert.deepEqual([own.prep.loopTurn, own.prep.finder], [dev.prep.turn, undefined], "the developer's loop: its request's turn");
    const noted = await call(own, "filament_memory_remember", { text: "The API server's routes live in src/routes.", kind: "fact" });
    assert.deepEqual([item(noted.id).origin, item(noted.id).turn_id, item(noted.id).chain_id], ["model", dev.prep.turn, dev.prep.chain]);

    // A sub-agent's run: its request's record names the sub-agent and the request that launched it.
    w.svc.records = { byId: new Map([["run-sa", { id: "run-sa", subagent: "sa_00000001", subagentOf: dev.requestId }], ["run-owner", { id: "run-owner", subagent: "sa_00000002", subagentOf: "owner" }], ["run-plain", { id: "run-plain" }]]) };
    const sa = await tickOf("run-sa");
    assert.deepEqual([sa.prep.loopTurn, sa.prep.finder], [dev.prep.turn, { agent: "sa_00000001", model: "claude-x" }]);
    const found = await call(sa, "filament_memory_remember", { text: "The API server's port is set in config/server.json.", kind: "fact" });
    const it = item(found.id);
    assert.deepEqual([it.origin, it.status, it.turn_id, it.chain_id], ["subagent", "inferred", dev.prep.turn, dev.prep.chain]);
    const owner = w.svc.scope({ role: "owner" });
    assert.deepEqual([owner.claim(found.id).trust, owner.claim(found.id).finder], ["a sub-agent found", { agent: "sa_00000001", model: "claude-x" }]);
    const fixed = await call(sa, "filament_memory_correct", { id: noted.id, text: "The API server's routes live in src/http/routes.", reason: "they moved" });
    assert.equal(fixed.ok, true, JSON.stringify(fixed));
    assert.deepEqual([item(fixed.id).origin, item(fixed.id).turn_id, owner.claim(fixed.id).finder?.agent], ["subagent", dev.prep.turn, "sa_00000001"], "its correction is its finding too");
    assert.equal(item(noted.id).status, "superseded");

    const launched = await tickOf("run-owner");
    assert.deepEqual([launched.prep.loopTurn, launched.prep.finder?.agent], [null, "sa_00000002"], "the developer's own launch has no turn behind it");
    const plain = await tickOf("run-plain");
    assert.deepEqual([plain.prep.loopTurn, plain.prep.finder], [null, undefined], "a run that is no sub-agent's and no turn's request");
    const quiet = await s.send("not a tick", { headers: { "x-filament-memory": "off" } });
    assert.deepEqual([quiet.prep.loopTurn, quiet.prep.finder], [undefined, undefined], "a quiet request that is no loop's tick");
    const offTick = await s.send("tick", { headers: { "x-filament-memory": "off", "x-filament-agent-of": "run-sa" } });
    assert.deepEqual([offTick.prep.loopTurn, offTick.prep.finder?.agent], [dev.prep.turn, "sa_00000001"], "a tick is its loop's, whatever memory header it carries");

    // A finder names a sub-agent's note only: a handle that speaks for the user writes the user's word, and no record
    // of it names a sub-agent, whatever finder the handle was given.
    const user = w.svc.scope({ role: "person", project: dev.sit.project.id, chain: dev.prep.chain, turn: dev.prep.turn, finder: { agent: "sa_00000009", model: "claude-x" } });
    const created = (/** @type {string} */ ref) => w.svc.archive.items.events(Number(ref.slice(1))).find((/** @type {any} */ e) => e.action === "created");
    const theirs = await user.remember("The API server listens on port 8080.", { kind: "fact" });
    assert.deepEqual([item(theirs.id).origin, created(theirs.id).detail.finder], ["person", undefined]);
    const corrected = await user.correct(found.id, { text: "The API server's port is set in config/http.json.", reason: "it moved" });
    assert.equal(corrected.ok, true, JSON.stringify(corrected));
    assert.deepEqual([item(corrected.id).origin, created(corrected.id).detail.finder], ["correction", undefined]);
  }));

test("what the learner reads of an exchange is bounded and clean: the task's head, the newest 40 calls (said so), the report's both ends, no secret, and the project's procedure goals", () =>
  findingsWorld(async (w, m) => {
    const first = await w.session("parent").send("look into the API server");
    const chain = first.prep.chain;
    // A procedure on file: its goal rides the prompt, as it does a session's learning run.
    await w.svc.scope({ role: "person", project: first.sit.project.id }).remember(RESET, { kind: "procedure" });
    const calls = Array.from({ length: 45 }, (_, i) => ({ tool: "grep", input: `{"pattern":"call-${i}-"}`, ok: true }));
    const task = `TASK-HEAD the key sk-abcdefghijklmnop1234 is in .env; ${"t ".repeat(2100)}TASK-TAIL`;
    const long = `REPORT-HEAD ${"a".repeat(11000)} REPORT-MIDDLE ${"b".repeat(9000)} REPORT-TAIL`;
    // A procedure is filed as it is kept: twelve steps at most.
    const setup = `How to set up the dev box: ${Array.from({ length: 13 }, (_, i) => `${i + 1}. run step-${i + 1}-now`).join(" ")}`;
    m.answer({ items: [{ kind: "procedure", text: setup }] });
    const ops = trace(w);
    await tell(w, report(chain, first.prep.turn, { task, report: long, calls }));
    assert.equal(m.prompts.length, 1);
    const user = m.prompts[0].user;
    assert.deepEqual([ops[0].sub, ops[0].detail.calls, ops[0].detail.chars], ["start", 45, user.length], "the start says how much it reads");
    const [kept] = findingsIn(w, chain);
    assert.ok(kept.text.endsWith("12. run step-12-now") && !kept.text.includes("step-13"), kept.text);
    assert.equal(kept.slot, "how to · set up dev box", "in its goal's slot");
    assert.ok(user.includes("The calls it made, oldest first (the newest 40 of 45):"), user.slice(0, 300));
    assert.ok(!user.includes("call-4-") && user.includes("call-5-") && user.includes("call-44-"), "the oldest five are left out");
    assert.ok(user.includes("TASK-HEAD") && !user.includes("TASK-TAIL"), "the task's first 4,000 characters");
    assert.ok(user.includes("REPORT-HEAD") && user.includes("REPORT-TAIL") && !user.includes("REPORT-MIDDLE"), "the report's both ends");
    assert.match(user, /characters of the middle were left out/);
    assert.ok(!user.includes("sk-abcdefghijklmnop1234") && user.includes("sk-abcd…"), "no secret leaves");
    assert.match(user, /\n\nThe project's procedures, by goal: reset the dev database\.$/);
  }));

test("too few words, a one-step procedure and a secret's shape are left out, and the daily cap stops the filing — the trace says what it left", () =>
  findingsWorld(async (w, m) => {
    const first = await w.session("parent").send("look into the API server");
    const chain = first.prep.chain;
    const ops = trace(w);
    m.answer({ items: [{ kind: "fact", text: "It runs" }, { kind: "procedure", text: "How to build the app: 1. run `make`" }, { kind: "fact", text: "The deploy token here is sk-abcdefghijklmnop1234." }, { kind: "fact", text: PORT }, { kind: "convention", text: TESTS }] });
    w.cfg.memory.capture.dailyCap = 1;
    await tell(w, report(chain, first.prep.turn));
    assert.deepEqual(findingsIn(w, chain).map((/** @type {any} */ it) => it.text), [PORT], "the cap stops the second");
    const end = ops.find((o) => o.sub === "done");
    assert.deepEqual([end?.detail.items, end?.detail.junk, end?.detail.secrets, end?.detail.capped], [1, 2, 1, true], JSON.stringify(end));
  }));

// (fails before: yes — a report filed up to eight findings, in the model's order, and the prompts said nothing of what
// memory is for)
test("a report files at most three findings, the ones the model weighed most important, and its prompt says what memory keeps; the learner's says it too (the memory plan's d5)", () =>
  findingsWorld(async (w, m) => {
    const first = await w.session("parent").send("look into the API server");
    const chain = first.prep.chain;
    const ops = trace(w);
    const said = [
      ["The API server's health check answers on /healthz.", 0.5],
      ["Running `npm test` here fails: the tests run with `bun test`.", 0.9],
      ["The fixtures for the api tests live under test/fixtures/api.", 0.7],
      ["The dev server reloads on a change under src/ only.", 0.8],
      ["The API server logs to logs/api.log.", 0.6],
    ];
    m.answer({ items: said.map(([text, importance]) => ({ kind: "fact", text, importance })) });
    await tell(w, report(chain, first.prep.turn));
    assert.equal(FINDINGS_MAX, 3);
    assert.deepEqual(findingsIn(w, chain).map((/** @type {any} */ it) => it.text).sort(), [said[1][0], said[2][0], said[3][0]].sort(), "the three weighed most important");
    const end = ops.find((o) => o.sub === "done");
    assert.deepEqual([end?.detail.items, end?.detail.over], [3, 2], JSON.stringify(end));
    for (const p of [FINDINGS_PROMPT, LEARN_PROMPT]) assert.ok(p.includes("start from what memory holds: keep there") && p.includes("could not re-read from the code or git"), p.slice(0, 400));
    assert.match(FINDINGS_PROMPT, /At most 3 items, the ones a later session would miss most/);
    assert.ok(!/0 to 8/.test(FINDINGS_PROMPT));
    assert.ok(LEARN_PROMPT.startsWith("You extract durable knowledge from a coding session between a user and an AI assistant. Later sessions with this user start from what memory holds"), LEARN_PROMPT.slice(0, 200));
  }));
