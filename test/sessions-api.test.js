// HarnessV2 P2: native sessions — the service over a real archive with a fake pipeline, and the admin rows over the
// router. No network: the "pipeline" archives the turn the way memoryPrepare + afterReply would and answers JSON.
import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryService } from "../src/services/memory/index.js";
import { sidecar } from "../src/adapters/sidecar/index.js";
import { createSessions } from "../src/app/sessions/service.js";
import { SessionTurns } from "../src/services/session-turns.js";
import { sessionRoutes } from "../src/http/admin/sessions.js";
import { memoryRoutes } from "../src/http/admin/memory.js";
import { createRouter } from "../src/http/router.js";
import { CLEARED_TEXT, CUT_OFF_LINE, resultRef } from "../src/app/sessions/shapes.js";
import { recallResult } from "../src/app/sessions/recall.js";
import { Archive } from "../src/services/memory/archive.js";
import { COMPACTION_SYSTEM } from "../src/app/sessions/compaction.js";
import { textOfMessage } from "../src/core/messages.js";
import { until } from "./helpers/wait.js";
import { HOUSE_ONLY_HEADERS } from "../src/services/house.js";
import { EventEmitter } from "node:events";

const dir = mkdtempSync(join(tmpdir(), "filament-sessions-"));
const folder = mkdtempSync(join(dir, "project-"));
let clock = 1_758_000_000_000;
const now = () => (clock += 1000);
after(async () => {
  await memory.shutdown();
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
});

class FakeRes {
  constructor() {
    this.headers = {};
    this.status = null;
    this.body = "";
    this.headersSent = false;
    this.writableEnded = false;
    this.destroyed = false;
  }
  setHeader(k, v) { this.headers[k.toLowerCase()] = String(v); }
  getHeader(k) { return this.headers[k.toLowerCase()]; }
  writeHead(status, h = {}) {
    this.status = status;
    for (const [k, v] of Object.entries(h)) this.headers[k.toLowerCase()] = String(v);
    this.headersSent = true;
    return this;
  }
  write(chunk) { this.body += chunk; }
  end(chunk = "") { this.body += chunk; this.writableEnded = true; }
  on() {}
  json() { return JSON.parse(this.body); }
}
const fakeReq = () => ({ headers: { "x-api-key": "k" }, method: "POST", socket: { remoteAddress: "127.0.0.1" }, on() {} });

/** What memoryPrepare + the loop + afterReply do to the archive, without a model: one tool round, then a final. */
function fakePipeline({ resultText = (n) => `contents of file ${n}`, finalText = (n) => `Turn ${n} done.`, gate = null, tail = null } = {}) {
  const calls = [];
  return {
    calls,
    async handle(req, res, format, pre) {
      calls.push({ format, pre, reqHeaders: req.headers });
      if (gate) await gate.promise;
      const chainId = pre.headers["x-filament-chain"];
      const rid = `req-${calls.length}`;
      const t = archive.beginTurn(chainId, { requestId: rid, model: pre.body.model, upstream: "fake", userMessage: pre.body.messages.at(-1) });
      archive.addWork(t.turnId, [
        { role: "assistant", content: [{ type: "text", text: "Reading." }, { type: "tool_use", id: `t${t.n}`, name: "read", input: { path: `f${t.n}.txt` } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: `t${t.n}`, content: resultText(t.n) }] },
      ]);
      // The real reply paths archive the final through memory's afterReply, whose turn-finished hook hears it.
      memory.afterReply({ chainId, turnId: t.turnId, requestId: rid, finalMessage: { role: "assistant", content: [{ type: "text", text: finalText(t.n) }] } });
      res.writeHead(200, { "content-type": "application/json", "x-filament-request-id": rid });
      res.end(JSON.stringify({ type: "message", role: "assistant", content: [{ type: "text", text: finalText(t.n) }] }));
      // The reply is sent whole; what the pipeline does after it (the run's last records) holds the turn till `tail` opens.
      if (tail) await tail.promise;
    },
  };
}
/** A person's message with words enough that a summary of its turn makes room beside the reply that comes back whole. @param {string} t */
const long = (t) => `${t} ${"and the words around it ".repeat(40)}`;
const deferred = () => { let resolve; const promise = new Promise((r) => (resolve = r)); return { promise, resolve }; };

const ops = [];
const summaries = [];
// A listener private to this machine, as a real config has: the loop works in a session's folder only then (no roots).
// A test that weighs the history against a line has a plain model's session ("m"): an agent/ model's carries the loop's
// prompt and tools too, the loop being always on (the owner's of 11-09).
const config = { get: () => ({ server: { host: "127.0.0.1" }, rules: { effort: { suffixes: ["low", "medium", "high"] } }, agentLoop: { permissions: "edit" }, memory: { enabled: true }, routes: [], upstreams: [] }) };
const memory = new MemoryService({
  sidecar,
  getConfig: config.get,
  dataDir: dir,
  log: () => {},
  selfBase: () => "http://127.0.0.1:20399",
  getModelNames: () => ["cheap"],
  now,
});
// The op forwarders the server wires (wireMemoryOps): the writer's audit lines land in the same list the rows read.
memory.onArchiveOp = (title, o) => ops.push({ kind: "archive", title, ...(o || {}) });
memory.start();
const archive = memory.archive;
// No network in the suite: the cheap model answers from the harness, as the old stub did.
memory.callModel = async (a) => { summaries.push(a); return `SUMMARY of ${a.chainId}`; };
const forks = [];
const deps = (pipeline) => ({
  memory,
  config,
  pipeline,
  ops: { record: (kind, title, o) => ops.push({ kind, title, ...(o || {}) }) },
  log: () => {},
  forkSession: async (chainId, args) => { forks.push({ chainId, args }); const r = archive.forkChain(chainId, { atTurn: args.atTurn, key: `h:fork-${forks.length}` }); return { chainId: r.id, forkedFrom: chainId, atTurn: args.atTurn, copied: r.copied }; },
});

describe("native sessions: the service", () => {
  const pipe = fakePipeline();
  const sessions = createSessions(deps(pipe));

  test("create: the folder must exist; the chain is the harness's, keyed n:<id>; a preset named is refused, none and plain are none", () => {
    assert.throws(() => sessions.create({ cwd: join(dir, "nope"), model: "agent/m" }), (e) => e.status === 400 && /does not exist/.test(e.message));
    assert.throws(() => sessions.create({ cwd: "", model: "agent/m" }), (e) => e.status === 400);
    // (the owner's of 11-07: there are no presets) A client written before them may still name one: none and plain
    // start from your defaults as they did; another is refused in words, never started on what it did not ask for.
    assert.throws(() => sessions.create({ cwd: folder, preset: "zebra" }), (e) => e.status === 400 && /^there are no presets: a new chat starts from your defaults/.test(e.message));
    assert.throws(() => sessions.create({ cwd: folder, preset: "review" }), (e) => e.status === 400 && /"review" names none/.test(e.message));
    const row = sessions.create({ cwd: folder, model: "agent/m", title: "Parity" });
    assert.equal(row.key, `n:${row.id}`);
    assert.equal(row.model, "agent/m");
    assert.equal("preset" in row, false);
    assert.equal(archive.getChain(sessions.create({ cwd: folder, model: "agent/m", preset: "None" }).id).meta.preset, undefined, "none: no preset said of it");
    const chain = archive.getChain(row.id);
    assert.equal(chain.key, `n:${row.id}`);
    assert.equal(chain.client, "harness");
    assert.equal(chain.kind, "interactive");
    assert.equal(chain.title, "Parity");
    assert.equal(chain.meta.native, true);
    assert.equal(!!chain.meta.muted, false, "memory on, as your defaults say (HarnessV3-AtHome AH-D8)");
    assert.equal(chain.settings.context, undefined, "no context knob of its own: every turn goes whole by default");
    assert.equal(chain.settings.model.name, "agent/m");
    const s = sessions.settingsOf(row.id);
    assert.equal(s.effective.context.results, "keep");
    assert.equal(s.sources["memory.enabled"], "global", "memory as your defaults have it: nothing stamped on the chat");
    assert.equal(s.sources["loop.permissions"], "global");
    assert.equal(s.effective.loop.permissions, "edit");
    assert.ok(s.knobs["context.results"].live && s.knobs["loop.resultCapChars"].live && s.knobs["subagents.pool"].live, "every declared knob is live once Phase 5 is built");
    assert.ok(Object.values(s.knobs).every((k) => k.live), "no knob is left inert");
    assert.ok(ops.some((o) => o.sub === "session-create"));
  });

  // (fails before: yes — the bug hunt of 10-30, ADM-5: a chat was made in any folder that was there, outside agentLoop.roots
  // too, and a coding agent's turn then worked in it, where Filament's own loop refused it)
  test("create, its check, the Start's draft and the row: a folder outside agentLoop.roots is refused in words; with none listed, any folder is made", async () => {
    const root = mkdtempSync(join(dir, "root-"));
    const under = mkdtempSync(join(root, "under-"));
    const outside = mkdtempSync(join(dir, "outside-"));
    let roots = [root];
    const cfg = { get: () => ({ ...config.get(), agentLoop: { ...config.get().agentLoop, roots } }) };
    const s = createSessions({ ...deps(fakePipeline()), config: cfg });
    const words = `${outside} is not under any folder listed in agentLoop.roots: add it there (Settings → Agent loop), or pick a folder under one`;
    const refusedOutside = (/** @type {any} */ e) => e.status === 403 && e.message === words;
    assert.throws(() => s.create({ cwd: outside, model: "agent/m" }), refusedOutside);
    assert.throws(() => s.check({ cwd: outside, model: "agent/m" }), refusedOutside);
    await assert.rejects(s.draftStart({ cwd: outside, model: "agent/m" }), refusedOutside);
    const a = { memory, usage: { forChain: () => ({ records: [], capped: false }), publicRecord: (/** @type {any} */ r) => r }, ops: { record() {} }, sessions: s, config: cfg };
    const m = createRouter(sessionRoutes(a))("POST", "/sessions");
    const res = new FakeRes();
    await m?.handler({ req: fakeReq(), res, url: new URL("http://x/sessions"), path: "/sessions", method: "POST", params: m.params, json: async () => ({ cwd: outside, model: "agent/m" }) }, a);
    assert.deepEqual([res.status, res.json().error], [403, words], "the row says it, with its status");
    assert.ok(s.create({ cwd: under, model: "agent/m" }).id, "a folder under a listed root is made");
    roots = [];
    assert.ok(s.create({ cwd: outside, model: "agent/m" }).id, "no roots listed: any folder that is there");
    assert.throws(() => s.create({ cwd: join(outside, "missing"), model: "agent/m" }), (/** @type {any} */ e) => e.status === 400 && /does not exist/.test(e.message), "a folder not there, as before");
  });

  /**
   * Add project's row (`POST /memory/projects`) under a configuration: its status and its answer.
   * @param {{ get: () => any }} cfg @param {string} cwd
   */
  const addProject = async (cfg, cwd) => {
    const a = { memory, usage: {}, config: cfg };
    const m = createRouter(memoryRoutes(a))("POST", "/memory/projects");
    const res = new FakeRes();
    await m?.handler({ req: fakeReq(), res, url: new URL("http://x/memory/projects"), path: "/memory/projects", method: "POST", params: m?.params, json: async () => ({ cwd }) }, a);
    return [res.status, res.json()];
  };

  // (fails before: yes — the production-readiness bug hunt of 10-30, ADM-5's Add project: a project was made of any folder
  // that was there, outside agentLoop.roots too, where its chats could not be made)
  test("Add project: a folder outside agentLoop.roots is refused in a chat's create's words and no project is made; with none listed, any folder that is there", async () => {
    const root = mkdtempSync(join(dir, "addroot-"));
    const under = mkdtempSync(join(root, "under-"));
    const outside = mkdtempSync(join(dir, "addout-"));
    let roots = [root];
    const cfg = { get: () => ({ ...config.get(), agentLoop: { ...config.get().agentLoop, roots } }) };
    const known = () => memory.projects().map((/** @type {any} */ p) => String(p.cwd).toLowerCase());
    const [status, body] = await addProject(cfg, outside);
    assert.deepEqual([status, body.error], [403, `${outside} is not under any folder listed in agentLoop.roots: add it there (Settings → Agent loop), or pick a folder under one`]);
    assert.ok(!known().includes(outside.toLowerCase()), "no project made of it");
    const [madeStatus, made] = await addProject(cfg, under);
    assert.equal(madeStatus, 200, JSON.stringify(made));
    assert.ok(known().includes(String(made.cwd).toLowerCase()), "a folder under a listed root is made");
    roots = [];
    assert.equal((await addProject(cfg, outside))[0], 200, "no roots listed: any folder that is there");
    const [goneStatus, gone] = await addProject(cfg, join(outside, "missing"));
    assert.deepEqual([goneStatus, gone.error], [400, `the folder does not exist on this machine: ${join(outside, "missing")}`], "a folder not there, as before");
  });

  // (fails before: yes — the production-readiness bug hunt of 10-30 and the owner's revision of it: with roots listed, a
  // share no root names was asked of its computer before anything judged it; with none listed on this machine's own
  // listener, every share was refused, where a share the person picks is a folder like any other)
  test("a folder on a network share: with roots listed and none on its share, a chat's create and Add project refuse it in the one sentence; with none listed it is asked as any folder is", { skip: process.platform !== "win32" && "a network share is a Windows path" }, async () => {
    const share = "\\\\127.0.0.1\\filament-no-such-share\\proj";
    let roots = [folder];
    const cfg = { get: () => ({ ...config.get(), agentLoop: { ...config.get().agentLoop, roots } }) };
    const s = createSessions({ ...deps(fakePipeline()), config: cfg });
    const words = `${share} is not under any folder listed in agentLoop.roots: add it there (Settings → Agent loop), or pick a folder under one`;
    assert.throws(() => s.create({ cwd: share, model: "agent/m" }), (/** @type {any} */ e) => e.status === 403 && e.message === words);
    await assert.rejects(s.draftStart({ cwd: share, model: "agent/m" }), (/** @type {any} */ e) => e.status === 403 && e.message === words);
    assert.deepEqual(await addProject(cfg, share).then(([status, body]) => [status, body.error]), [403, words], "Add project");
    roots = [];
    const gone = `the folder does not exist on this machine: ${share}`;
    assert.throws(() => s.create({ cwd: share, model: "agent/m" }), (/** @type {any} */ e) => e.status === 400 && e.message === gone, "none listed: asked, and not there");
    assert.deepEqual(await addProject(cfg, share).then(([status, body]) => [status, body.error]), [400, gone], "Add project, none listed");
  });

  // (fails before: yes — the production-readiness bug hunt of 10-30, a chat's weight: to weigh what the loop sends beside
  // the history, its folder was resolved, its Environment captured and its instruction files read there — a network
  // share's asked of its computer, whatever the folder rules said)
  test("a chat whose folder is a share the folder rules keep out is weighed without asking it: nothing of the loop's rides beside its history", { skip: process.platform !== "win32" && "a network share is a Windows path" }, async () => {
    const cfg = { get: () => ({ ...config.get(), agentLoop: { ...config.get().agentLoop, enabled: true, roots: [folder] } }) };
    let captured = 0;
    const s = createSessions({ ...deps(fakePipeline()), config: cfg, environment: async () => (captured++, null) });
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    assert.ok((await s.preview(id, {})).current.fixed > 0, "a folder of this machine's: the loop's prompt and tools");
    // Its folder as a share no listed root names (a chat made before the roots changed, or moved by hand).
    archive.mergeMeta(id, { cwd: "\\\\127.0.0.1\\filament-no-such-share\\proj" });
    captured = 0;
    assert.equal((await s.preview(id, {})).current.fixed, 0, "the loop refuses a turn there: nothing of its rides beside the history");
    assert.equal(captured, 0, "no Environment captured there");
  });

  // HarnessV3-AtHome AH-F1: the loop reads the session's mode at each call, so the service names one only when the turn
  // does; the switch's answer rides as a house header a client cannot send.
  // (fails before: yes — the service named the document's mode on every turn, and carried no switch)
  test("turn: a mode only when the turn names one; the switch's answer rides as a house header", async () => {
    const { id } = sessions.create({ cwd: folder, model: "agent/m" });
    await sessions.turn(id, { content: "plain" }, fakeReq(), new FakeRes());
    const plain = pipe.calls.at(-1).pre.headers;
    assert.deepEqual([plain["x-filament-permissions"], plain["x-filament-mode-switch"]], [undefined, undefined]);
    await sessions.turn(id, { content: "named", permissions: "ask" }, fakeReq(), new FakeRes());
    assert.equal(pipe.calls.at(-1).pre.headers["x-filament-permissions"], "ask");
    await sessions.turn(id, { content: "Switched to Full access", modeSwitch: true }, fakeReq(), new FakeRes());
    assert.equal(pipe.calls.at(-1).pre.headers["x-filament-mode-switch"], "1");
    assert.ok(HOUSE_ONLY_HEADERS.includes("x-filament-mode-switch"), "a client's copy is dropped at the door");
  });

  // (fails before: yes — a team's proposal an older Filament parked on the chain waited for its answer, which rode the
  // turn as a house header)
  test("turn: a park of a team's proposal an older Filament saved waits for nothing, and an answer a stale page sends rides as no header", async () => {
    const { id } = sessions.create({ cwd: folder, model: "agent/m" });
    archive.mergeMeta(id, { paused: { kind: "proposal", question: "The team's lead proposes…", orders: [], expires: Date.now() + 60_000 } });
    assert.equal(sessions.transcript(id).paused, null, "nothing waits");
    await sessions.turn(id, { content: "Why two?", proposal: "discuss" }, fakeReq(), new FakeRes());
    assert.equal(pipe.calls.at(-1).pre.headers["x-filament-proposal"], undefined);
  });

  test("turn: composed from the archive, addressed to the chain, stamped; parity — turn 3 sees turn 1's tool_result raw", async () => {
    const { id } = sessions.create({ cwd: folder, model: "agent/m" });
    const hash0 = sessions.settingsOf(id).hash;
    const r1 = new FakeRes();
    const out1 = await sessions.turn(id, { content: "turn 1: read f1.txt" }, fakeReq(), r1);
    assert.equal(out1.turn, 1);
    assert.equal(out1.requestId, `req-${pipe.calls.length}`);
    assert.equal(r1.headers["x-filament-settings-hash"], hash0);
    assert.equal(r1.headers["x-filament-session"], id);
    assert.equal(r1.headers["x-filament-settings-boundary"], undefined);
    const c1 = pipe.calls.at(-1);
    assert.equal(c1.format, "anthropic");
    assert.equal(c1.pre.api, "session");
    assert.equal(c1.pre.headers["x-filament-chain"], id);
    assert.equal(c1.pre.headers["x-filament-client"], "harness");
    assert.equal(c1.pre.headers["x-filament-permissions"], undefined, "the loop reads the session's mode at each call (AH-F1)");
    assert.ok(c1.pre.headers["x-filament-cwd"]);
    assert.equal(c1.pre.body.model, "agent/m");
    assert.equal(c1.pre.body.max_tokens, 128000, "no session cap, no stated maximum: the 128,000 floor");
    assert.equal(c1.pre.body.stream, true);
    assert.equal(c1.pre.body.messages.length, 1);
    assert.equal(c1.pre.composition.form, "plain");
    assert.equal(c1.pre.composition.settingsHash, hash0);
    assert.equal(archive.getTurns(id)[0].meta.settingsHash, hash0);
    assert.equal(archive.getTurns(id)[0].meta.composed.form, "plain");

    await sessions.turn(id, { content: "turn 2: read f2.txt" }, fakeReq(), new FakeRes());
    const out3 = await sessions.turn(id, { content: "what did you find in the file you read in turn 1" }, fakeReq(), new FakeRes());
    assert.equal(out3.turn, 3);
    const body3 = pipe.calls.at(-1).pre.body;
    // Two completed turns of 4 messages each, then the new user message: raw, in order, alternating.
    assert.equal(body3.messages.length, 9);
    assert.deepEqual(body3.messages.map((m) => m.role), ["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant", "user"]);
    const t1result = body3.messages[2].content[0];
    assert.equal(t1result.type, "tool_result");
    assert.equal(t1result.content, "contents of file 1", "turn 1's tool_result reaches the model byte for byte");
    assert.equal(pipe.calls.at(-1).pre.composition.turns.length, 2);
    assert.ok(pipe.calls.at(-1).pre.composition.turns.every((t) => t.shape === "raw"));
    const tr = sessions.transcript(id);
    assert.equal(tr.total, 3);
    assert.equal(tr.turns.length, 3);
    assert.equal(tr.turns[0].work.length, 2);
    assert.equal(tr.turns[0].final.content[0].text, "Turn 1 done.");
    assert.equal(tr.turns[0].settingsHash, hash0);
    assert.equal(tr.turns[0].open, false);
    assert.equal(tr.live, null);
    assert.deepEqual(tr.boundaries, []);
    assert.equal(tr.settings.hash, hash0);
    assert.equal(tr.meta.muted, false);
    const thin = sessions.transcript(id, { work: false, since: 2 });
    assert.equal(thin.turns.length, 1);
    assert.equal(thin.turns[0].n, 3);
    assert.equal(thin.turns[0].workCount, 2);
    assert.equal(thin.turns[0].work, undefined);
  });

  // (fails before: yes — the filament-agent plan's 2b-C D8: a turn a restart cut off was left out of the history, "1
  // unanswered turn … left out", so a fresh agent session's seed and every summary lost it)
  test("turn: one a restart cut off rides in the history, Filament's line as its reply; one that failed, before or since, is still left out", async () => {
    const { id } = sessions.create({ cwd: folder, model: "agent/m" });
    await sessions.turn(id, { content: "turn 1: read f1.txt" }, fakeReq(), new FakeRes());
    // Running when Filament stopped, before this one started: its message archived, no reply, its request's mark left.
    archive.beginTurn(id, { requestId: "req-cut", model: "agent/m", upstream: "fake", client: "harness", window: "harness", startedAt: 1_000, running: true, userMessage: { role: "user", content: [{ type: "text", text: "turn 2: refactor the parser" }] } });
    // (fails before: yes — begun before the restart with no reply, it was cut off though its request had failed:
    // HarnessV3-FailurePoints finding 3) Failed before Filament stopped: its request closed, and took its mark with it.
    archive.beginTurn(id, { requestId: "req-failed-before", model: "agent/m", upstream: "fake", client: "harness", window: "harness", startedAt: 1_100, userMessage: { role: "user", content: [{ type: "text", text: "turn 3: this one failed before" }] } });
    const restarted = createSessions(deps(pipe));
    // Failed in this Filament: its reply never archived.
    archive.beginTurn(id, { requestId: "req-failed", model: "agent/m", upstream: "fake", client: "harness", window: "harness", userMessage: { role: "user", content: [{ type: "text", text: "turn 4: this one failed" }] } });
    await restarted.turn(id, { content: "turn 5: go on" }, fakeReq(), new FakeRes());
    const pre = pipe.calls.at(-1).pre;
    const texts = pre.body.messages.map((m) => textOfMessage(m));
    assert.deepEqual(texts.slice(-3), ["turn 2: refactor the parser", CUT_OFF_LINE, "turn 5: go on"]);
    assert.ok(!texts.includes("turn 3: this one failed before"), "a turn that failed before the restart is left out, as it was then");
    assert.ok(!texts.includes("turn 4: this one failed"), "a turn that failed in this Filament is still left out");
    assert.ok(pre.composition.notes.includes("1 turn cut off before its reply (running when Filament last stopped) in the history, Filament's line as the reply"));
    assert.ok(pre.composition.notes.includes("2 unanswered turns (no final reply archived) left out of the history"));
    assert.deepEqual(restarted.transcript(id).turns.filter((t) => t.open).map((t) => [t.n, !!t.cutOff]), [[2, true], [3, false], [4, false]], "the page says which a restart cut off");
  });

  // (fails before: yes — a turn that failed after doing work was left out of the history: HarnessV3-FailurePoints §6
  // item 1)
  test("turn: one that failed after doing work rides in the history, its work kept and why it failed as its reply", async () => {
    const { id } = sessions.create({ cwd: folder, model: "agent/m" });
    await sessions.turn(id, { content: "turn 1: read f1.txt" }, fakeReq(), new FakeRes());
    const { turnId } = archive.beginTurn(id, { requestId: "req-failed-work", model: "agent/m", upstream: "fake", client: "harness", window: "harness", userMessage: { role: "user", content: [{ type: "text", text: "turn 2: fix the parser" }] } });
    archive.addWork(turnId, [{ role: "assistant", content: [{ type: "tool_use", id: "w1", name: "read", input: { path: "parser.js" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "w1", content: "the parser" }] }]);
    const failed = { at: Date.now(), cause: "round 2's model call to m failed: the connection was reset (ECONNRESET). 1 finished round is kept." };
    archive.mergeTurnMeta(turnId, { failed });
    await sessions.turn(id, { content: "turn 3: try again" }, fakeReq(), new FakeRes());
    const pre = pipe.calls.at(-1).pre;
    const texts = pre.body.messages.map((m) => textOfMessage(m));
    assert.equal(texts.at(-2), `[this turn failed: ${failed.cause}]`, "why it failed is its reply");
    assert.ok(texts.includes("turn 2: fix the parser") && texts.includes("the parser"), "its message and its work ride");
    assert.ok(pre.composition.notes.includes("1 turn that failed after doing work in the history, its work kept and why it failed as the reply"), JSON.stringify(pre.composition.notes));
    assert.ok(!pre.composition.notes.some((n) => /cut off before/.test(n)), "never called a cut-off");
    assert.equal(sessions.transcript(id).turns.find((t) => t.n === 2)?.failed?.cause, failed.cause, "the page reads why it failed");
  });

  // (fails before: yes — the owner's of 11-10, chat Fable52: a turn that failed went on in its row with a second try
  // (HarnessV4_Tasks B8), and the transcript still said the first try's failure while the second ran — the page drew the
  // turn failed, never followed it again, and offered no Stop, every message answered "still running — following it now")
  test("transcript: a turn that failed is open while a newer try runs in its row, and failed again once that try fails", async () => {
    const { id } = sessions.create({ cwd: folder, model: "agent/m" });
    await sessions.turn(id, { content: "turn 1: read f1.txt" }, fakeReq(), new FakeRes());
    const message = { role: "user", content: [{ type: "text", text: "turn 2: fix the parser" }] };
    const { turnId } = archive.beginTurn(id, { requestId: "req-try-1", model: "agent/m", upstream: "fake", client: "harness", window: "harness", running: true, userMessage: message });
    archive.addWork(turnId, [{ role: "assistant", content: [{ type: "tool_use", id: "w1", name: "read", input: { path: "parser.js" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "w1", content: "the parser" }] }]);
    const thrash = "Internal error: Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row.";
    // The first try's record closes failed: its mark goes, its failure stays on the turn.
    archive.mergeTurnMeta(turnId, { running: undefined, failed: { at: Date.now(), cause: thrash }, facts: { v: 1, error: thrash, errorDetail: "the agent's own words", needsRoom: true } });
    const was = sessions.transcript(id).turns.find((t) => t.n === 2);
    assert.equal(was?.failed?.cause, thrash, "failed, as the page draws it");
    assert.equal(was?.facts?.error, thrash);
    // The same message again — a Compact and send's retry, a wake sent again — goes on in the turn's row and runs.
    const again = archive.beginTurn(id, { requestId: "req-try-2", model: "agent/m", upstream: "fake", client: "harness", window: "harness", running: true, userMessage: message });
    assert.equal(again.turnId, turnId, "the try goes on in the failed turn's row");
    const now = sessions.transcript(id).turns.find((t) => t.n === 2);
    assert.equal(now?.open, true);
    assert.equal(now?.failed, undefined, "the earlier try's failure is not the turn's while a newer try runs");
    assert.equal(now?.facts?.error ?? null, null, "nor its error, which the page draws as the turn's");
    assert.equal(now?.facts?.errorDetail ?? null, null);
    assert.equal(now?.facts?.needsRoom ?? null, null);
    assert.deepEqual(now?.requestIds, ["req-try-1", "req-try-2"]);
    // The newer try fails too: its failure is the turn's.
    archive.mergeTurnMeta(turnId, { running: undefined, failed: { at: Date.now() + 1, cause: "the second try failed" }, facts: { v: 1, error: "the second try failed" } });
    const after = sessions.transcript(id).turns.find((t) => t.n === 2);
    assert.equal(after?.failed?.cause, "the second try failed");
    assert.equal(after?.facts?.error, "the second try failed");
  });

  test("turn: no content → 400; unknown session → no such session; no model → 400; effort suffix from the document", async () => {
    const { id } = sessions.create({ cwd: folder, model: null });
    await assert.rejects(sessions.turn(id, { content: "" }, fakeReq(), new FakeRes()), (e) => e.status === 400 && /content is required/.test(e.message));
    await assert.rejects(sessions.turn(id, { content: "hi" }, fakeReq(), new FakeRes()), (e) => e.status === 400 && /no model/.test(e.message));
    await assert.rejects(sessions.turn("zzzz", { content: "hi" }, fakeReq(), new FakeRes()), /no such session/);
    await sessions.turn(id, { content: "hi", settingsPatch: { model: { name: "agent/m", effort: "high" } } }, fakeReq(), new FakeRes());
    assert.equal(pipe.calls.at(-1).pre.body.model, "agent/m-high");
    assert.equal(archive.getChain(id).model, "agent/m", "the chain's model column follows model.name");
    assert.equal(sessions.settingsOf(id).effective.model.effort, "high");
  });

  test("turn: one live turn per session — the second sender gets 409 with the live request's id", async () => {
    const gate = deferred();
    const slow = createSessions(deps(fakePipeline({ gate })));
    const { id } = slow.create({ cwd: folder, model: "agent/m" });
    const first = slow.turn(id, { content: "long one" }, fakeReq(), new FakeRes());
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(slow.live(id) && { requestId: slow.live(id).requestId }, { requestId: null }, "no head written yet: the id is not known");
    await assert.rejects(slow.turn(id, { content: "me too" }, fakeReq(), new FakeRes()), (e) => e.status === 409 && "requestId" in e.extra);
    assert.equal(slow.transcript(id).live?.startedAt > 0, true, "the transcript names the live turn");
    gate.resolve();
    const out = await first;
    assert.equal(out.turn, 1);
    assert.equal(slow.live(id), null);
  });

  // (fails before: yes — the reply had landed whole while the turn's last bookkeeping still held the session, and a
  // message sent the moment it landed was refused: shell-notices' RD1 c under the full suite's load, 10-25)
  test("turn: a message sent the moment the last reply lands waits for that turn to give the session back", async () => {
    const tail = deferred();
    const s = createSessions(deps(fakePipeline({ tail })));
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    const res = new FakeRes();
    const first = s.turn(id, { content: "one" }, fakeReq(), res);
    await until(() => res.writableEnded, "the first reply to be sent whole");
    const second = s.turn(id, { content: "two" }, fakeReq(), new FakeRes());
    await new Promise((r) => setImmediate(r));
    tail.resolve();
    assert.equal((await first).turn, 1);
    assert.equal((await second).turn, 2, "it waited for the first turn's end, then ran");
  });

  test("settings: PATCH validates by name, changes the hash, mirrors memory.enabled; the next turn carries the boundary", async () => {
    const { id } = sessions.create({ cwd: folder, model: "agent/m" });
    for (let i = 1; i <= 3; i++) await sessions.turn(id, { content: `turn ${i}` }, fakeReq(), new FakeRes());
    const before = sessions.settingsOf(id);
    assert.throws(() => sessions.patchSettings(id, { patch: { context: { results: "zigzag" } } }), (e) => e.status === 400 && /must be one of/.test(e.message));
    assert.throws(() => sessions.patchSettings(id, { patch: { nonsense: { x: 1 } } }), (e) => e.status === 400 && /unknown setting "nonsense.x"/.test(e.message));
    assert.throws(() => sessions.patchSettings(id, { unset: ["bogus.path"] }), (e) => e.status === 400);
    assert.equal(sessions.settingsOf(id).hash, before.hash, "a refused patch writes nothing");
    const r = sessions.patchSettings(id, { patch: { context: { results: "status" }, memory: { enabled: false } } });
    assert.deepEqual(r.changes.map((c) => c.path).sort(), ["context.results", "memory.enabled"]);
    assert.notEqual(r.hash, before.hash);
    assert.equal(r.effective.context.results, "status");
    assert.equal(archive.getChain(id).meta.muted, true, "memory.enabled=false mutes");
    assert.ok(ops.some((o) => o.sub === "session-settings" && o.detail.chainId === id));
    const res4 = new FakeRes();
    const out4 = await sessions.turn(id, { content: "turn 4" }, fakeReq(), res4);
    assert.equal(out4.boundary, true);
    assert.equal(res4.headers["x-filament-settings-boundary"], before.hash);
    assert.equal(res4.headers["x-filament-settings-hash"], r.hash);
    const comp = pipe.calls.at(-1).pre.composition;
    assert.equal(comp.form, "plain");
    assert.deepEqual(comp.turns.map((t) => t.shape), ["raw", "raw", "raw"], "every turn whole: a result policy is no fold");
    const body4 = pipe.calls.at(-1).pre.body;
    // Three finished turns whole, then the new message; `status` on their results (a short result is itself).
    assert.equal(body4.messages.length, 4 + 4 + 4 + 1);
    assert.equal(body4.messages[6].content[0].type, "tool_result");
    assert.equal(body4.messages[6].content[0].content, "contents of file 2");
    const tr = sessions.transcript(id);
    const b = tr.boundaries.find((x) => x.type === "settings");
    assert.deepEqual({ beforeTurn: b.beforeTurn, from: b.from, to: b.to }, { beforeTurn: 4, from: before.hash, to: r.hash });
    assert.equal(tr.turns[0].shape, null, "no compaction marked it");
    // Display knobs never move the hash, and are mirrored to the chain's flags.
    const r2 = sessions.patchSettings(id, { patch: { display: { pinned: true, title: "Renamed" } } });
    assert.equal(r2.hash, r.hash);
    assert.equal(archive.getChain(id).meta.pinned, true);
    assert.equal(archive.getChain(id).title, "Renamed");
  });

  test("the project layer carries repo facts, modes refused", () => {
    const { id } = sessions.create({ cwd: folder, model: "agent/m" });
    const projectId = archive.getChain(id).project_id;
    // The project layer holds repo facts only (D3): mode and session knobs are refused by name.
    assert.throws(() => sessions.patchProjectSettings(projectId, { patch: { context: { results: "status" } } }), (e) => e.status === 400 && /mode setting/.test(e.message));
    assert.throws(() => sessions.patchProjectSettings(projectId, { patch: { model: { name: "m2" } } }), (e) => e.status === 400 && /belongs to one session/.test(e.message));
    const pr = sessions.patchProjectSettings(projectId, { patch: { instructions: { files: ["AGENTS.md"] } } });
    assert.deepEqual(pr.changes.map((c) => c.path), ["instructions.files"]);
    assert.throws(() => sessions.patchProjectSettings(projectId, { patch: { loop: { permissions: "god" } } }), (e) => e.status === 400);
    assert.throws(() => sessions.patchProjectSettings("proj-nope", { patch: {} }), (e) => e.status === 404);
    const fresh = sessions.create({ cwd: folder, model: "agent/m" });
    const s = sessions.settingsOf(fresh.id);
    assert.deepEqual(s.effective.instructions.files, ["AGENTS.md"]);
    assert.equal(s.sources["instructions.files"], "project");
    assert.deepEqual(sessions.settingsOf(id).effective.instructions.files, ["AGENTS.md"], "the session inherits the repo facts too");
    // Unsetting the project's section drops it from the row (the display flags beside it stay).
    archive.setProjectArchived(projectId, true);
    sessions.patchProjectSettings(projectId, { unset: ["instructions.files"] });
    assert.equal(sessions.settingsOf(fresh.id).sources["instructions.files"], "default");
    assert.equal(archive.projectSettings(projectId).display.archived, true);
    archive.setProjectArchived(projectId, false);
  });

  // (Step 6 §2.2, fails before: yes — the answer carried no usage) The settings answer carries the session's usage
  // ledger — the harness view's loader passes it straight to the Spend and Cache widgets, so this answer is the only
  // road those figures have to a client.
  test("the settings answer carries the usage ledger beside the settings", () => {
    const { id } = sessions.create({ cwd: folder, model: "agent/m" });
    const fresh = sessions.settingsOf(id).usage;
    assert.deepEqual({ ...fresh, last: fresh.last || null }, { usd: 0, agents: { usd: 0, listUsd: 0, requests: 0, before: 0 }, teams: { usd: 0, listUsd: 0, runs: 0 }, listUsd: 0, listUnpriced: 0, byModel: {}, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, savedUsd: 0, unpriced: 0, turns: fresh.turns, last: null }, "a fresh session reads as zeros, never undefined — the widgets stand on real numbers");
    memory.spendAdd(id, { usd: 0.315, inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 1000000, cacheWriteTokens: 0, savedUsd: 2.7, unpriced: 0, model: "agent/m", at: now() });
    const u = sessions.settingsOf(id).usage;
    assert.deepEqual({ usd: u.usd, requests: u.requests, cacheRead: u.cacheRead, savedUsd: u.savedUsd, unpriced: u.unpriced }, { usd: 0.315, requests: 1, cacheRead: 1000000, savedUsd: 2.7, unpriced: 0 });
    assert.equal(u.last?.cacheRead, 1000000, "the newest request's own numbers ride along");
    // A write answers with the same fields (the harness view's loader expects it): the ledger survives a patch.
    const w = sessions.patchSettings(id, { patch: { loop: { resultCapChars: 12000 } } });
    assert.equal(w.usage.requests, 1, "a write's answer carries the usage too");
    assert.ok(Array.isArray(w.derived), "and the derivations — a write can move them, and the loader reads this answer, not a fresh document");
  });

  test("plain compaction: at the usable edge the history is summarised once and the next request starts from it", async () => {
    const big = fakePipeline({ finalText: (n) => (n === 1 ? `Turn ${n} done. ${"y".repeat(100000)}` : `Turn ${n} done.`) });
    const s = createSessions(deps(big));
    const { id } = s.create({ cwd: folder, model: "m", settings: { context: { compaction: { mode: "auto", thresholdPercent: 10 } } } });
    // 10% of the 200,000 window = a 20,000-token line; one big final (~25k tokens) fills it.
    await s.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
    assert.equal(summaries.length, 0);
    const out2 = await s.turn(id, { content: "turn 2" }, fakeReq(), new FakeRes());
    assert.equal(summaries.length, 1, "one compaction call");
    assert.equal(summaries[0].purpose, "compact");
    assert.equal(summaries[0].model, "m", "the session's model, agent/ prefix off");
    assert.equal(summaries[0].chainId, id);
    assert.deepEqual(out2.report.compactions.map((c) => ({ fromTurn: c.fromTurn, toTurn: c.toTurn })), [{ fromTurn: 1, toTurn: 1 }]);
    const body2 = big.calls.at(-1).pre.body;
    assert.equal(body2.messages.length, 3, "the history restarts: summary, acknowledgment, the new message");
    assert.match(body2.messages[0].content[0].text, /^\[Filament compacted turn 1 into the summary below\. /);
    assert.match(body2.messages[0].content[0].text, new RegExp(`SUMMARY of ${id}`));
    assert.equal(body2.messages[1].role, "assistant");
    assert.equal(body2.messages[2].content[0].text, "turn 2");
    assert.equal(archive.turnBodies(id)[1].user.content[0].text, "turn 2", "the archived user message carries no summary text");
    const rows = archive.getCompactions(id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "plain");
    assert.equal(rows[0].from_turn, 1);
    assert.equal(rows[0].to_turn, 1);
    assert.ok(ops.some((o) => o.kind === "compaction" && o.sub === "plain" && o.detail.chainId === id));
    // The compose answer lists each compaction by its figures, its summary not opened for the list (HarnessV4_Tasks
    // C30 item 5: the quote it carried went to no page).
    const comp = await s.preview(id, {});
    assert.equal(comp.compactions.length, 1);
    assert.deepEqual([comp.compactions[0].fromTurn, comp.compactions[0].toTurn, comp.compactions[0].kind, "preview" in comp.compactions[0]], [1, 1, "plain", false]);
    assert.deepEqual({ fromTurn: comp.current.head?.fromTurn, toTurn: comp.current.head?.toTurn, kind: comp.current.head?.kind }, { fromTurn: 1, toTurn: 1, kind: "plain" }, "the head stands for turn 1");
    const tr = s.transcript(id);
    const b = tr.boundaries.find((x) => x.type === "compaction");
    assert.deepEqual({ afterTurn: b.afterTurn, fromTurn: b.fromTurn, toTurn: b.toTurn, kind: b.kind }, { afterTurn: 1, fromTurn: 1, toTurn: 1, kind: "plain" });
    assert.equal(tr.turns.length, 2, "the archive keeps every turn");
    // Turn 3: the head stands for turn 1; turn 2 rides raw after it.
    await s.turn(id, { content: "turn 3" }, fakeReq(), new FakeRes());
    const body3 = big.calls.at(-1).pre.body;
    assert.equal(big.calls.at(-1).pre.composition.head.toTurn, 1);
    assert.match(body3.messages[0].content[0].text, /^\[Filament compacted turn 1 /);
    assert.equal(body3.messages[2].content[0].text, "turn 2");
    assert.equal(body3.messages.length, 2 + 4 + 1);
  });

  // (fails before: yes — HarnessV4_Tasks C33: a running turn of Filament's loop could fold its own steps alone; the
  // session's earlier turns were out of its reach until the next message)
  test("room in the whole chat in the middle of a turn: the turn's request carries a hand that compacts the earlier turns by the session's method and hands back the history composed again", async () => {
    const before = summaries.length;
    /** @type {any} */
    let got = null;
    /** @type {any} */
    let phase = null;
    const turns = new SessionTurns();
    const pipe = fakePipeline({ finalText: (n) => (n === 1 ? `Turn ${n} done. ${"y".repeat(60000)}` : `Turn ${n} done.`) });
    const handle = pipe.handle;
    const callModel = memory.callModel;
    // Turn 2's loop asks for room in the middle of its turn, as it does at its line: its row has begun, as memory's
    // prepare begins it before the loop's first round, and it ends after.
    pipe.handle = async (req, res, format, pre) => {
      if (pipe.calls.length !== 1) return handle.call(pipe, req, res, format, pre);
      pipe.calls.push({ format, pre, reqHeaders: req.headers });
      const chainId = pre.headers["x-filament-chain"];
      const t = archive.beginTurn(chainId, { requestId: "req-mid", model: pre.body.model, upstream: "fake", userMessage: pre.body.messages.at(-1) });
      memory.callModel = async (a) => { phase = turns.holder(pre.lock.key)?.phase ?? null; return callModel(a); };
      try {
        got = await pre.earlier();
      } finally {
        memory.callModel = callModel;
      }
      memory.afterReply({ chainId, turnId: t.turnId, requestId: "req-mid", finalMessage: { role: "assistant", content: [{ type: "text", text: "Turn 2 done." }] } });
      res.writeHead(200, { "content-type": "application/json", "x-filament-request-id": "req-mid" });
      res.end(JSON.stringify({ type: "message", role: "assistant", content: [{ type: "text", text: "Turn 2 done." }] }));
    };
    const s = createSessions({ ...deps(pipe), sessionTurns: turns });
    // The line at 50% of the 200,000 window: turn 1 (~15,000 tokens) sits under it, so nothing is compacted at a send.
    const { id } = s.create({ cwd: folder, model: "agent/m", settings: { context: { compaction: { mode: "auto", thresholdPercent: 50, method: "summary" } } } });
    await s.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
    assert.equal(typeof pipe.calls[0].pre.earlier, "function", "Filament's own loop is handed it");
    assert.equal(summaries.length, before, "nothing compacted as turn 1 or turn 2 was sent");
    const out = await s.turn(id, { content: "turn 2" }, fakeReq(), new FakeRes());
    assert.equal(pipe.calls[1].pre.body.messages.length, 5, "turn 2 went out with turn 1 whole");
    assert.equal(summaries.length, before + 1, "one summary, written in the middle of the turn");
    assert.equal(summaries.at(-1).purpose, "compact");
    assert.deepEqual([got.fromTurn, got.toTurn, got.method], [1, 1, "summary"]);
    assert.match(got.note, /^compaction: turn 1 /);
    // Every message ahead of the turn's own, as the session now composes them: the summary and its acknowledgment.
    assert.deepEqual(got.history.map((/** @type {any} */ m) => m.role), ["user", "assistant"]);
    assert.match(got.history[0].content[0].text, /^\[Filament compacted turn 1 into the summary below\. /);
    assert.match(got.history[0].content[0].text, new RegExp(`SUMMARY of ${id}`));
    assert.equal(phase?.kind, "compacting", "said on the turn's lock while the summary was written");
    assert.equal(turns.holder(pipe.calls[1].pre.lock?.key) ?? null, null, "and the lock is free once the turn has ended");
    // The turn's stamp carries the compaction, and the archive holds its row: the next message starts from it.
    assert.deepEqual(out.report.compactions.map((c) => ({ fromTurn: c.fromTurn, toTurn: c.toTurn, method: c.method })), [{ fromTurn: 1, toTurn: 1, method: "summary" }]);
    assert.equal(archive.getCompactions(id).length, 1);
    // Undo is on its row once the turn has ended, as after any compaction: until the next message is sent.
    assert.equal(s.transcript(id).boundaries.find((x) => x.type === "compaction")?.undoable, true);
    await s.turn(id, { content: "turn 3" }, fakeReq(), new FakeRes());
    assert.equal(pipe.calls.at(-1).pre.composition.head.toTurn, 1);
    assert.match(pipe.calls.at(-1).pre.body.messages[0].content[0].text, /^\[Filament compacted turn 1 /);
  });

  // (fails before: yes — the 11-01 report's B9: the compaction made in the middle of the turn took the place of the one
  // made at its line, so the turn's answer and its stamp named one of the two, by no id)
  test("a turn that compacts at its line and again in the middle of it names both, in the order made, each by its row's id: its answer, its stamp, and the mid-turn hand's own", async () => {
    const pipe = fakePipeline({ resultText: (n) => (n <= 2 ? `contents ${"x".repeat(60000)}` : `contents of file ${n}`) });
    const handle = pipe.handle;
    /** @type {any} */
    let got = null;
    // Turn 3's loop asks for room in the whole chat in the middle of it, as at its line.
    pipe.handle = async (req, res, format, pre) => {
      if (pipe.calls.length !== 2) return handle.call(pipe, req, res, format, pre);
      pipe.calls.push({ format, pre, reqHeaders: req.headers });
      const chainId = pre.headers["x-filament-chain"];
      const t = archive.beginTurn(chainId, { requestId: "req-two-rooms", model: pre.body.model, upstream: "fake", userMessage: pre.body.messages.at(-1) });
      got = await pre.earlier();
      memory.afterReply({ chainId, turnId: t.turnId, requestId: "req-two-rooms", finalMessage: { role: "assistant", content: [{ type: "text", text: "Turn 3 done." }] } });
      res.writeHead(200, { "content-type": "application/json", "x-filament-request-id": "req-two-rooms" });
      res.end(JSON.stringify({ type: "message", role: "assistant", content: [{ type: "text", text: "Turn 3 done." }] }));
    };
    // The summary at the line fails, so fold makes the room there; the one in the middle of the turn is written.
    const realCall = memory.callModel;
    let compacts = 0;
    memory.callModel = async (a) => {
      if (a.purpose === "compact" && !compacts++) throw new Error("the model is down");
      return realCall(a);
    };
    try {
      const s = createSessions(deps(pipe));
      // A 30,000-token line: turn 1 (~17,000 tokens) sits under it, turns 1 and 2 are past it.
      const { id } = s.create({ cwd: folder, model: "m", settings: { context: { compaction: { mode: "auto", thresholdPercent: 15, method: "summary" } } } });
      for (const n of [1, 2]) await s.turn(id, { content: `turn ${n}` }, fakeReq(), new FakeRes());
      assert.deepEqual(archive.getCompactions(id), [], "under the line until turn 3");
      const out = await s.turn(id, { content: "turn 3" }, fakeReq(), new FakeRes());
      const made = archive.getCompactions(id).map((r) => ({ id: r.id, fromTurn: r.from_turn, toTurn: r.to_turn, kind: r.kind, method: r.method }));
      assert.deepEqual(made.map((m) => [m.method, m.fromTurn, m.toTurn]), [["fold", 1, 1], ["summary", 1, 2]], out.report.notes.join("\n"));
      assert.deepEqual(pipe.calls[2].pre.composition.compactions, made.slice(0, 1), "the turn went out composed after the line's");
      assert.deepEqual({ id: got.id, fromTurn: got.fromTurn, toTurn: got.toTurn, kind: got.kind, method: got.method }, made[1], "the hand hands back the one it made");
      assert.deepEqual(out.report.compactions, made, "the turn's answer names both");
      assert.deepEqual(archive.getTurns(id).at(-1).meta.composed.compactions, made, "and so does its stamp");
    } finally {
      memory.callModel = realCall;
    }
  });

  // (fails before: the lock's holder said nothing while the start-of-turn summary was written — minutes in which the
  // page's turn showed a bare spinner and no run; HarnessV3-CodebasePass decision 1)
  test("a turn compacting at its line says so while the summary is written; the phase is gone before the request goes out", async () => {
    const turns = new SessionTurns();
    let key = "";
    /** @type {any[]} */
    const atHandle = [];
    const big = fakePipeline({ finalText: (n) => (n === 1 ? `Turn ${n} done. ${"y".repeat(100000)}` : `Turn ${n} done.`) });
    const handle = big.handle;
    big.handle = async (...a) => { atHandle.push(turns.holder(key)?.phase ?? null); return handle.apply(big, a); };
    const s = createSessions({ ...deps(big), sessionTurns: turns });
    const { id } = s.create({ cwd: folder, model: "agent/m", settings: { context: { compaction: { mode: "auto", thresholdPercent: 10 } } } });
    key = archive.getChain(id).key;
    await s.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
    const phases = [];
    const un = turns.onChange(key, (h) => phases.push(h?.phase?.kind ?? null));
    const realCall = memory.callModel;
    const writing = deferred();
    const written = deferred();
    memory.callModel = async (a) => {
      if (a.purpose === "compact") {
        writing.resolve();
        await written.promise;
      }
      return realCall(a);
    };
    try {
      const out = s.turn(id, { content: "turn 2" }, fakeReq(), new FakeRes());
      await writing.promise;
      const live = s.live(id);
      assert.deepEqual(live?.phase && { kind: live.phase.kind, method: live.phase.method }, { kind: "compacting", method: "summary" }, "the session's live view says it");
      assert.equal(s.transcript(id).live?.phase?.kind, "compacting", "the transcript's holder too (a reload mid-compaction)");
      assert.equal(big.calls.length, 1, "turn 2's request has not gone out yet");
      assert.ok(phases.includes("compacting"), "the holder's listeners heard it");
      written.resolve();
      const o2 = await out;
      assert.equal(o2.report.compactions.length, 1, "the summary landed");
      assert.deepEqual(atHandle, [null, null], "no request goes out still marked compacting");
      assert.equal(phases.at(-1), null, "the turn ended: nobody holds it");
    } finally {
      written.resolve();
      memory.callModel = realCall;
      un();
    }
  });

  // (fails before: yes — the turn went out past its line, uncompacted, and counted a failure; the filament-agent plan's D6)
  test("a summary that fails at the line gives way to fold: the turn goes out folded at once, says why, and counts no failure", async () => {
    const big = fakePipeline({ resultText: (n) => (n === 1 ? `contents ${"x".repeat(100000)}` : `contents of file ${n}`) });
    const realCall = memory.callModel;
    memory.callModel = async (a) => {
      if (a.purpose === "compact") throw new Error("the model is down");
      return realCall(a);
    };
    try {
      const s = createSessions(deps(big));
      const { id } = s.create({ cwd: folder, model: "agent/m", settings: { context: { compaction: { mode: "auto", thresholdPercent: 10, method: "summary", keepWhole: 0 } } } });
      await s.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
      const out = await s.turn(id, { content: "turn 2" }, fakeReq(), new FakeRes());
      assert.deepEqual(out.report.compactions.map((c) => c.method), ["fold"], "fold made the room");
      assert.ok(out.report.notes.some((x) => /^compaction: turn 1 folded at the compaction line \(the compaction model \(m\) failed: the model is down, so folding made the room; it calls no model\)/.test(x)), out.report.notes.join("\n"));
      assert.equal(archive.getChain(id).meta.compactionFailures, undefined, "room was made: no failure counted");
      assert.ok(!JSON.stringify(big.calls.at(-1).pre.body.messages).includes("x".repeat(1000)), "turn 1's big result went out folded");
    } finally {
      memory.callModel = realCall;
    }
  });

  // (fails before: yes — nothing let a slow summary go: the turn waited it out, or was stopped whole; D6)
  test("Send without it: the summary the turn waits on is let go and the turn goes out folded at once; with none being written the route answers 409", async () => {
    const turns = new SessionTurns();
    const big = fakePipeline({ resultText: (n) => (n === 1 ? `contents ${"x".repeat(100000)}` : `contents of file ${n}`) });
    const s = createSessions({ ...deps(big), sessionTurns: turns });
    const a = { memory, usage: { forChain: () => ({ records: [], capped: false }), publicRecord: (r) => r }, ops: { record() {} }, sessions: s, sessionTurns: turns };
    const route = createRouter(sessionRoutes(a));
    /** @param {string} id */
    const skip = async (id) => {
      const url = new URL(`http://x/sessions/${id}/wait/skip`);
      const m = route("POST", url.pathname);
      assert.ok(m, "the skip has a row");
      const res = new FakeRes();
      await m.handler({ req: fakeReq(), res, url, path: url.pathname, method: "POST", params: m.params, json: async () => ({}) }, a);
      return res;
    };
    const { id } = s.create({ cwd: folder, model: "agent/m", settings: { context: { compaction: { mode: "auto", thresholdPercent: 10, method: "summary", keepWhole: 0 } } } });
    await s.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
    let r = await skip(id);
    assert.deepEqual([r.status, r.json().error], [409, "this session's turn waits on nothing it can be sent without"]);
    const realCall = memory.callModel;
    const writing = deferred();
    /** @type {AbortSignal | null} */
    let heard = null;
    // A writer that takes its time: only its signal ends it.
    memory.callModel = async (c) => {
      if (c.purpose !== "compact") return realCall(c);
      heard = c.signal || null;
      writing.resolve();
      return new Promise((_, rej) => c.signal?.addEventListener("abort", () => rej(new Error("aborted")), { once: true }));
    };
    try {
      const out = s.turn(id, { content: "turn 2" }, fakeReq(), new FakeRes());
      await writing.promise;
      assert.deepEqual(s.live(id)?.phase && { kind: s.live(id).phase.kind, method: s.live(id).phase.method, skippable: s.live(id).phase.skippable }, { kind: "compacting", method: "summary", skippable: true }, "the phase offers Send without it");
      r = await skip(id);
      assert.deepEqual([r.status, r.json()], [200, { ok: true }]);
      const o2 = await out;
      assert.ok(heard?.aborted, "the writer was stopped");
      assert.deepEqual(o2.report.compactions.map((c) => c.method), ["fold"], "fold made the room");
      assert.ok(o2.report.notes.some((x) => /^compaction: turn 1 folded at the compaction line \(you sent it on without the summary; folding calls no model\)/.test(x)), o2.report.notes.join("\n"));
      assert.equal(big.calls.length, 2, "turn 2 went out");
      assert.equal(archive.getChain(id).meta.compactionFailures, undefined);
      r = await skip(id);
      assert.equal(r.status, 409, "the turn is over: nothing to let go");
    } finally {
      memory.callModel = realCall;
    }
  });

  // (fails before: yes — a harness turn's memory waits reached nobody: no phase said them, and the route let go a summary
  // only — HarnessV3-FailurePoints §5.1 item 3)
  test("Send without it reaches memory's waits: the turn's phase says it recalls, the route lets it go, and the turn goes on", async () => {
    const turns = new SessionTurns();
    const inner = fakePipeline();
    const asked = deferred();
    /** @type {AbortSignal | null} */
    let heard = null;
    // Memory's lookup, as the pipeline's memory stage makes it on the turn's lock: it waits until let go.
    const pipe = {
      calls: inner.calls,
      async handle(req, res, format, pre) {
        const w = pre.lock?.turns.waiting(pre.lock.key, pre.lock.token)({ kind: "recalling" });
        if (w) {
          heard = w.signal;
          asked.resolve();
          await new Promise((r) => w.signal.addEventListener("abort", r, { once: true }));
          w.end();
        }
        return inner.handle(req, res, format, pre);
      },
    };
    const s = createSessions({ ...deps(pipe), sessionTurns: turns });
    const a = { memory, usage: { forChain: () => ({ records: [], capped: false }), publicRecord: (r) => r }, ops: { record() {} }, sessions: s, sessionTurns: turns };
    const route = createRouter(sessionRoutes(a));
    /** @param {string} id */
    const skip = async (id) => {
      const url = new URL(`http://x/sessions/${id}/wait/skip`);
      const m = route("POST", url.pathname);
      const res = new FakeRes();
      await m.handler({ req: fakeReq(), res, url, path: url.pathname, method: "POST", params: m.params, json: async () => ({}) }, a);
      return res;
    };
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    const out = s.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
    await asked.promise;
    assert.deepEqual(s.live(id)?.phase && { kind: s.live(id).phase.kind, skippable: s.live(id).phase.skippable }, { kind: "recalling", skippable: true }, "the phase offers Send without it");
    const r = await skip(id);
    assert.deepEqual([r.status, r.json()], [200, { ok: true }]);
    assert.ok(heard?.aborted, "the lookup's wait was let go");
    await out;
    assert.equal(inner.calls.length, 1, "the turn went out");
    assert.equal((await skip(id)).status, 409, "the turn is over: nothing to let go");
  });

  test("plain compaction failing: twice the body still goes out (autofit is the net), the third time in a row the turn is refused in words; a success resets the count", async () => {
    const big = fakePipeline({ finalText: (n) => `Turn ${n} done. ${"y".repeat(100000)}` });
    let fail = true;
    const realCall = memory.callModel;
    memory.callModel = async (a) => {
      if (fail) throw new Error("the model is down");
      return `SUMMARY of ${a.chainId}`;
    };
    const s = createSessions(deps(big));
    // Every turn kept whole: fold has nothing to make room with, so the summary's failure stands (where fold can, it
    // makes the room instead — the filament-agent plan's D6, the test above).
    const { id } = s.create({ cwd: folder, model: "agent/m", settings: { context: { compaction: { mode: "auto", thresholdPercent: 10, keepWhole: 10 } } } });
    await s.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
    for (const n of [2, 3]) {
      const out = await s.turn(id, { content: `turn ${n}` }, fakeReq(), new FakeRes());
      assert.deepEqual(out.report.compactions, []);
      assert.ok(out.report.notes.some((x) => /compaction skipped/.test(x)), `turn ${n} says the summary came back empty`);
      assert.equal(archive.getChain(id).meta.compactionFailures, n - 1);
      assert.ok(big.calls.at(-1).pre.body.messages.length > 3, "the history went out uncompacted");
    }
    await assert.rejects(s.turn(id, { content: "turn 4" }, fakeReq(), new FakeRes()), (e) => e.status === 502 && /failed 3 times in a row/.test(e.message) && e.extra.failures === 3);
    assert.equal(archive.turnBodies(id).filter((t) => t.final).length, 3, "the refused turn archived nothing");
    fail = false;
    const ok = await s.turn(id, { content: "turn 4 again" }, fakeReq(), new FakeRes());
    assert.equal(ok.report.compactions.length, 1, "the summary landed");
    assert.equal(archive.getChain(id).meta.compactionFailures, undefined, "a success clears the count");
    memory.callModel = realCall;
  });

  // (fails before: yes — the turn start could only summarize: context.compaction.method did not exist)
  test("the turn start makes room by the session's method: fold marks the older turns, calls no model, and the request goes out with them folded", async () => {
    const big = fakePipeline({ resultText: (n) => (n === 1 ? `contents ${"x".repeat(100000)}` : `contents of file ${n}`) });
    const s = createSessions(deps(big));
    const { id } = s.create({ cwd: folder, model: "agent/m", settings: { context: { compaction: { mode: "auto", thresholdPercent: 10, method: "fold", keepWhole: 0 } } } });
    await s.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
    const before = summaries.length;
    const out2 = await s.turn(id, { content: "turn 2" }, fakeReq(), new FakeRes());
    assert.equal(summaries.slice(before).filter((x) => x.purpose === "compact").length, 0, "a fold calls no model");
    const rows = archive.getCompactions(id);
    assert.deepEqual(out2.report.compactions, [{ id: rows[0]?.id, fromTurn: 1, toTurn: 1, kind: "plain", method: "fold" }]);
    assert.deepEqual(rows.map((r) => [r.kind, r.method, r.summary_hash]), [["plain", "fold", null]]);
    assert.equal(archive.turnBodies(id)[0].meta.compacted.shape, "fold");
    const body2 = big.calls.at(-1).pre.body;
    assert.equal(body2.messages.length, 3, "turn 1 folded to its two messages, then the new one — under plain");
    assert.ok(!JSON.stringify(body2.messages).includes("x".repeat(100)), "the big result stayed home");
    // (fails before: yes — HarnessV3-Launch RD-D4: one turn read "turns 1–1", in a note `/trim now` now answers with)
    assert.ok(out2.report.notes.some((n) => /^compaction: turn 1 folded at the compaction line/.test(n)), out2.report.notes.join(" | "));
    const b = s.transcript(id).boundaries.find((x) => x.type === "compaction");
    assert.deepEqual({ method: b.method, chars: b.chars, kind: b.kind }, { method: "fold", chars: 0, kind: "plain" });
    const pv = await s.preview(id, {});
    assert.deepEqual(pv.compactions.map((x) => [x.method, "preview" in x]), [["fold", false]], "the row rides the preview with its method, no quote");
  });

  // (fails before: yes — HarnessV4_Tasks C26: a compaction's writer could only be changed in the session's settings, for
  // every compaction after)
  test("a compaction's writer for this once: the plan is weighed with it and Compact now writes with it; the session's settings stay as they are; a model no route reaches, a writer Filament does not know, a side model named with the same model, or a once without the summary, is refused", async () => {
    const routed = { get: () => ({ ...config.get(), upstreams: [{ id: "api", type: "anthropic", baseUrl: "http://127.0.0.1:9" }], routes: [{ match: "w-1", upstream: "api" }] }) };
    const s = createSessions({ ...deps(fakePipeline({ resultText: (n) => `contents ${"x".repeat(20000)} of file ${n}` })), config: routed });
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    for (const n of [1, 2, 3, 4]) await s.turn(id, { content: `once turn ${n}` }, fakeReq(), new FakeRes());
    const own = (await s.preview(id, { compaction: true })).compaction;
    const once = (await s.preview(id, { compaction: true, once: { model: "w-1" } })).compaction;
    assert.equal(own.methods.summary.model, "m");
    assert.deepEqual([once.methods.summary.model, once.writer, once.writers.chosen.why], ["w-1", "model", "context.compaction.model (writer: model)"]);
    const same = (await s.preview(id, { compaction: true, once: { writer: "session" } })).compaction;
    assert.deepEqual([same.methods.summary.model, same.writer], ["m", "session"]);
    await assert.rejects(s.preview(id, { compaction: true, once: { model: "nowhere" } }), (e) => e.status === 400 && /^once\.model: no route reaches "nowhere"$/.test(e.message));
    await assert.rejects(s.preview(id, { compaction: true, once: { writer: "cheaper" } }), (e) => e.status === 400 && /^once\.writer must be one of session, model$/.test(e.message));
    await assert.rejects(s.preview(id, { compaction: true, once: { model: "w-1", writer: "session" } }), (e) => e.status === 400 && /^once\.model names the side model/.test(e.message));
    await assert.rejects(s.compact(id, { once: { model: "w-1" } }), (e) => e.status === 400 && /name the method summary with it$/.test(e.message));
    await assert.rejects(s.compact(id, { method: "fold", once: { model: "w-1" } }), (e) => e.status === 400 && /name the method summary with it$/.test(e.message));
    const before = summaries.length;
    const made = await s.compact(id, { method: "summary", once: { model: "w-1" } });
    assert.equal(made.compaction.method, "summary");
    assert.deepEqual([summaries.length - before, summaries.at(-1).model], [1, "w-1"], "written by the model picked for this once");
    const set = s.settingsOf(id);
    assert.deepEqual([set.sources["context.compaction.model"], set.sources["context.compaction.writer"]].map((x) => x === "session"), [false, false], "nothing was written to the session");
  });

  // (fails before: yes — the owner's rules of 10-31: a method but the summary and the fold could still be named, Newest
  // turns only among them)
  test("Compact now takes the two kinds Filament writes, a summary and an instant fold: any other method is refused", async () => {
    const s = createSessions(deps(fakePipeline({ resultText: (n) => `contents ${"x".repeat(20000)} of file ${n}` })));
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    for (const n of [1, 2, 3]) await s.turn(id, { content: `kinds turn ${n}` }, fakeReq(), new FakeRes());
    for (const method of ["oldest", "digest", "trim", "newest", "auto"])
      await assert.rejects(s.compact(id, { method }), (e) => e.status === 400 && e.message === "method must be one of summary, fold", method);
    assert.deepEqual(Object.keys((await s.preview(id, { compaction: true })).compaction.methods), ["fold", "summary"]);
  });

  // (fails before: yes — nothing could undo a compaction; rows had no detail for the words that report them)
  test("Undo compaction: the newest one, until the next message — the turns come back, the timeline row goes; refused for any other, after a turn, for a brief, and through the route", async () => {
    const s = createSessions(deps(fakePipeline({ resultText: (n) => `contents ${"x".repeat(8000)} of file ${n}` })));
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    for (const n of [1, 2, 3]) await s.turn(id, { content: `turn ${n}` }, fakeReq(), new FakeRes());
    const before = (await s.preview(id, {})).current.tokens;
    const fold = await s.compact(id, { method: "fold" });
    let b = s.transcript(id).boundaries.find((x) => x.type === "compaction");
    assert.deepEqual([b.undoable, b.detail.how, b.detail.before > b.detail.after], [true, "local", true], "the row says what it did, and that it can be taken back");
    assert.ok((await s.preview(id, {})).current.tokens < before);
    const u = await s.undoCompaction(id, fold.compaction.id);
    assert.deepEqual([u.undone.method, u.undone.unmarked, u.undone.fromTurn, u.undone.toTurn], ["fold", 2, 1, 2]);
    assert.equal(s.transcript(id).boundaries.filter((x) => x.type === "compaction").length, 0, "the timeline row goes");
    assert.equal((await s.preview(id, {})).current.tokens, before, "the next request is composed as if it never ran");
    assert.ok(ops.some((o) => o.kind === "compaction" && o.sub === "undo" && o.detail.chainId === id));
    // A summary: undoable until the next message is sent, and only the newest.
    const first = await s.compact(id, { method: "fold" });
    const second = await s.compact(id);
    await assert.rejects(s.undoCompaction(id, first.compaction.id), (e) => e.status === 409 && /only the newest compaction/.test(e.message));
    assert.equal((await s.preview(id, {})).compactions.find((c) => c.id === second.compaction.id).undoable, true);
    await s.turn(id, { content: "turn 4" }, fakeReq(), new FakeRes());
    await assert.rejects(s.undoCompaction(id, second.compaction.id), (e) => e.status === 409 && /until the next message is sent/.test(e.message));
    assert.equal(s.transcript(id).boundaries.some((x) => x.type === "compaction" && x.undoable), false);
    // A fork's brief is its birth, not a compaction to take back.
    const brief = await s.fork(id, { atTurn: 2, strategy: "brief" });
    const briefRow = archive.getCompactions(brief.chainId).find((c) => c.kind === "brief");
    await assert.rejects(s.undoCompaction(brief.chainId, briefRow.id), (e) => e.status === 409);
    await assert.rejects(s.undoCompaction(id, "x"), (e) => e.status === 400);
  });

  // HarnessV3-FixRound item 32, decision 24. (fails before: yes — the answer named nothing, so the page offered the
  // older compaction's Undo only after a reload)
  test("an Undo's answer names the compaction now undoable: the one under it while no turn came between, else none", async () => {
    const s = createSessions(deps(fakePipeline({ resultText: (n) => `contents ${"x".repeat(8000)} of file ${n}` })));
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    for (const n of [1, 2, 3]) await s.turn(id, { content: `turn ${n}` }, fakeReq(), new FakeRes());
    const first = await s.compact(id, { method: "fold" });
    const second = await s.compact(id);
    const u = await s.undoCompaction(id, second.compaction.id);
    assert.equal(u.undoable, first.compaction.id, "the fold under it can be taken back now");
    assert.equal(s.transcript(id).boundaries.find((x) => x.type === "compaction")?.undoable, true, "as a reload draws it");
    const last = await s.undoCompaction(id, first.compaction.id);
    assert.equal(last.undoable, null, "nothing is left to undo");
    const older = await s.compact(id, { method: "fold" });
    await s.turn(id, { content: "turn 4" }, fakeReq(), new FakeRes());
    const newer = await s.compact(id);
    assert.ok(Number(newer.compaction.id) > Number(older.compaction.id));
    assert.equal((await s.undoCompaction(id, newer.compaction.id)).undoable, null, "a turn started after the one under it: it stays");
  });

  // (fails before: yes — the 11-01 report (B8): an Undo told no other tab; theirs kept the row and its Undo, which the
  // server refused, until a reload)
  test("an Undo is said on the feed: the compaction undone, and the one now undoable", async () => {
    /** @type {any[]} */
    const said = [];
    const s = createSessions({ ...deps(fakePipeline({ resultText: (n) => `contents ${"x".repeat(8000)} of file ${n}` })), publish: (chainId, e) => said.push({ chainId, ...e }) });
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    for (const n of [1, 2, 3]) await s.turn(id, { content: `turn ${n}` }, fakeReq(), new FakeRes());
    const first = await s.compact(id, { method: "fold" });
    const second = await s.compact(id);
    await s.undoCompaction(id, second.compaction.id);
    await s.undoCompaction(id, first.compaction.id);
    assert.deepEqual(said.filter((e) => e.type === "compaction-undone"), [
      { chainId: id, type: "compaction-undone", id: Number(second.compaction.id), undoable: Number(first.compaction.id) },
      { chainId: id, type: "compaction-undone", id: Number(first.compaction.id), undoable: null },
    ]);
  });

  // (fails before: yes — the preview had no compaction plan: a person could not see what each way of making room would leave)
  test("the preview carries the compactor's plan when asked: every method weighed on the preview's own figures, nothing called or written; a client's session gets the client's plan", async () => {
    const s = createSessions(deps(fakePipeline({ resultText: (n) => `contents ${"x".repeat(8000)} of file ${n}` })));
    const { id } = s.create({ cwd: folder, model: "m" });
    for (const n of [1, 2, 3]) await s.turn(id, { content: `turn ${n}` }, fakeReq(), new FakeRes());
    const before = summaries.length;
    assert.equal((await s.preview(id, {})).compaction, undefined, "not asked: not composed");
    const p = await s.preview(id, { compaction: true });
    const c = p.compaction;
    assert.equal(c.native, true);
    assert.deepEqual(Object.keys(c.methods), ["fold", "summary"]);
    assert.deepEqual([c.method, c.writer, c.mode, c.keepWhole, c.instantTokens], ["summary", null, "ask", 1, 20000], "the session's settings, their defaults");
    assert.equal(c.now, p.current.tokens, "the plan's now is the preview's own figure");
    assert.equal(c.methods.fold.turns, 2, "turns 1–2; turn 3 kept whole");
    assert.ok(c.methods.fold.after < c.now && c.methods.fold.calls === 0);
    assert.equal(c.methods.summary.headTurns, 3);
    assert.equal(c.methods.summary.model, "m", "today's rule: the session's model, agent/ prefix off");
    assert.equal(summaries.length, before, "a plan calls no model");
    assert.equal(archive.getCompactions(id).length, 0, "and writes nothing");
    assert.equal(archive.turnBodies(id)[0].meta.compacted, undefined, "nor marks a turn");
    const client = archive.chainForKey("zc:plan-client", { cwd: folder, client: "opencode", model: "m" });
    const cp = await s.preview(client.id, { compaction: true });
    // HarnessV3-Compaction §7.3: the client compacts by itself and its own model writes the summary — Filament weighs no
    // way of its own (fails before: yes — the preview weighed how Filament would answer the client's compaction).
    assert.equal(cp.compaction, undefined, "a client's session has no plan of Filament's");
  });

  // (fails before: yes — the pass rendered each message under its cap of 24,000 characters: of a longer summary the
  // rest was never read, and the summary written next stood for less than the one before it)
  test("memory.sliceSummarize: the summary a pass continues from is read whole, whatever its length", async () => {
    const realCall = memory.callModel;
    const seen = [];
    memory.callModel = async (a) => {
      seen.push(a);
      return `part ${seen.length}: ${"what the earlier summary held, kept. ".repeat(12)}`;
    };
    try {
      const facts = Array.from({ length: 600 }, (_, i) => `FACT-${i}-HELD: ${"a decision that was taken and why ".repeat(3)}`);
      const lead = `[The summary an earlier compaction wrote of turns 1–62]\n${facts.join("\n")}`;
      assert.ok(lead.length > 60000, "a long summary");
      const messages = [
        { role: "user", content: [{ type: "text", text: lead }] },
        { role: "assistant", content: [{ type: "text", text: "Understood — I continue from that summary." }] },
        { role: "user", content: [{ type: "text", text: "the newest turn's question" }] },
        { role: "assistant", content: [{ type: "text", text: "the newest turn's answer" }] },
      ];
      const r = await memory.sliceSummarize({ chainId: null, messages, model: "writer-lead", windowTokens: 8000 });
      const sent = seen.map((a) => String(a.user).slice(String(a.user).indexOf("EXCERPT (")));
      const where = facts.map((_, i) => sent.flatMap((s, k) => (s.includes(`FACT-${i}-HELD`) ? [k] : [])));
      assert.ok(where.every((w) => w.length === 1), `every line of the summary is read, once: ${where.findIndex((w) => w.length !== 1)}`);
      assert.deepEqual(where.flat(), where.flat().slice().sort((a, b) => a - b), "in order");
      assert.ok(!sent.some((s) => /more characters/.test(s)), "nothing cut");
      assert.ok(sent.at(-1).includes("the newest turn's answer"));
      assert.doesNotMatch(r.text, /left out|could not be summarized|clipped/);
    } finally {
      memory.callModel = realCall;
    }
  });

  // (fails before: yes — a turn bigger than the writer's slice was one group: the pass read its newest messages and left the older out)
  test("memory.sliceSummarize: a turn bigger than one slice is cut at its steps and read whole, a call beside its result", async () => {
    const realCall = memory.callModel;
    const seen = [];
    memory.callModel = async (a) => {
      seen.push(a);
      return `part ${seen.length}: ${"the turn read a file and noted what it held. ".repeat(12)}`;
    };
    try {
      const messages = [{ role: "user", content: [{ type: "text", text: "one long turn: read every file" }] }];
      for (let i = 0; i < 30; i++) {
        messages.push({ role: "assistant", content: [{ type: "text", text: `STEP-${i}-SAYS reading` }, { type: "tool_use", id: `s${i}`, name: "Read", input: { file_path: `src/s${i}.js` } }] });
        messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `s${i}`, content: `STEP-${i}-GOT ${"file line ".repeat(260)}` }] });
      }
      messages.push({ role: "assistant", content: [{ type: "text", text: "the long turn's report" }] });
      const r = await memory.sliceSummarize({ chainId: null, messages, model: "writer-long", windowTokens: 8000 });
      assert.ok(r.calls >= 3, `several slices: ${JSON.stringify({ calls: r.calls, notes: r.notes })}`);
      const sent = seen.map((a) => String(a.user).slice(String(a.user).indexOf("EXCERPT (")));
      for (let i = 0; i < 30; i++) {
        const said = sent.flatMap((s, k) => (s.includes(`STEP-${i}-SAYS`) ? [k] : []));
        const got = sent.flatMap((s, k) => (s.includes(`STEP-${i}-GOT`) ? [k] : []));
        assert.equal(said.length, 1, `step ${i} is read once`);
        assert.deepEqual(got, said, `step ${i}'s result is read with its call`);
      }
      assert.ok(sent.at(-1).includes("the long turn's report"), "to its end");
      assert.doesNotMatch(r.text, /left out|could not be summarized|clipped/, "and the summary names nothing as missing");
    } finally {
      memory.callModel = realCall;
    }
  });

  // (fails before: yes — the slice pass lived inside /trim's bundle alone; a harness summary was one call however big)
  test("memory.sliceSummarize: messages too big for the writer's window are summarized in sequential slices on the writer's model, joined into one text, each slice cached", async () => {
    const realCall = memory.callModel;
    const seen = [];
    memory.callModel = async (a) => {
      seen.push(a);
      return `part ${seen.length}: ${"the conversation read files and settled on a plan. ".repeat(30)}`;
    };
    try {
      const messages = [1, 2, 3, 4, 5, 6].flatMap((n) => [
        { role: "user", content: [{ type: "text", text: `turn ${n}: ${"question words ".repeat(300)}` }] },
        { role: "assistant", content: [{ type: "text", text: `answer ${n}: ${"answer words ".repeat(300)}` }] },
      ]);
      /** @type {any[]} */
      const steps = [];
      const r = await memory.sliceSummarize({ chainId: null, messages, model: "writer-m", windowTokens: 8000, jobId: "job-s", onProgress: (p) => steps.push(p.message) });
      assert.ok(r.calls >= 2 && r.slices >= 2, `sliced: ${JSON.stringify({ calls: r.calls, slices: r.slices, notes: r.notes })}`);
      assert.ok(seen.every((a) => a.model === "writer-m" && a.purpose === "compact"), "the writer's model, booked as compaction");
      // (fails before: yes — HarnessV3-FailurePoints §5.1 item 3) each call carries the compaction's job; each step is said
      assert.ok(seen.every((a) => a.jobId === "job-s"), "every slice's call names the job");
      assert.ok(steps.some((s) => /^summarizing slice 1 /.test(s)) && steps.some((s) => /^summarizing slice 2 /.test(s)), JSON.stringify(steps));
      assert.match(r.text, /^## Part 1 — messages 1 to \d+\npart 1: /);
      assert.match(r.text, /## Part 2 — messages \d+ to \d+/);
      const calls = seen.length;
      const again = await memory.sliceSummarize({ chainId: null, messages, model: "writer-m", windowTokens: 8000 });
      assert.ok(again.cached > 0, "the same excerpts are read from the slice cache");
      assert.ok(seen.length - calls < calls, "and paid for again at most in part");
    } finally {
      memory.callModel = realCall;
    }
  });

  // (fails before: yes — a stop while the turn composed reached nothing: no request existed to cancel until the
  // compaction summary came back and the turn went out)
  test("a stop while the turn composes cancels the compaction call; nothing is sent, frozen or counted as a failed compaction", async () => {
    const big = fakePipeline({ finalText: (n) => (n === 1 ? `Turn ${n} done. ${"y".repeat(100000)}` : `Turn ${n} done.`) });
    const s = createSessions(deps(big));
    const { id } = s.create({ cwd: folder, model: "agent/m", settings: { context: { compaction: { mode: "auto", thresholdPercent: 10 } } } });
    await s.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
    const realCall = memory.callModel;
    const summarizing = deferred();
    memory.callModel = (a) => {
      summarizing.resolve(a);
      return new Promise((_, reject) => a.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    };
    try {
      const turn2 = s.turn(id, { content: "turn 2" }, fakeReq(), new FakeRes());
      assert.equal((await summarizing.promise).purpose, "compact", "the turn is writing its compaction summary");
      // (fails before: yes — HarnessV4_Tasks U3-5, there was no such stop) a compaction a turn writes is the turn's to stop
      assert.throws(() => s.stopCompaction(id), (/** @type {any} */ e) => e.status === 409 && /part of a running turn: stop the turn to stop it/.test(e.message));
      assert.equal(s.cancelTurn(id), true, "a turn was running");
      await assert.rejects(turn2, (e) => e.status === 409 && /stopped from the harness before it was sent/.test(e.message));
      assert.equal(big.calls.length, 1, "nothing went to the pipeline");
      assert.equal(archive.getCompactions(id).length, 0, "no compaction was recorded");
      assert.equal(archive.getChain(id).meta.compactionFailures, undefined, "a stop is not a failed compaction");
      assert.equal(s.live(id), null, "the session is free");
      assert.equal(s.cancelTurn(id), false, "nothing is left to stop");
    } finally {
      memory.callModel = realCall;
    }
  });

  test("the session's stop reaches the pipeline: the turn's request follows the signal the stop aborts", async () => {
    const gate = deferred();
    const pipe = fakePipeline({ gate });
    const s = createSessions(deps(pipe));
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    const running = s.turn(id, { content: "go" }, fakeReq(), new FakeRes());
    await until(() => pipe.calls.length === 1, "the turn to reach the pipeline");
    const { signal } = pipe.calls[0].pre;
    assert.equal(signal.aborted, false, "a running turn's signal is live");
    assert.equal(s.cancelTurn(id), true);
    assert.equal(signal.aborted, true, "the stop aborts it");
    gate.resolve();
    await running;
  });

  test("plain never clears: every result stays whole under the line, and at the line the history compacts once", async () => {
    const big = fakePipeline({ resultText: (n) => `file ${n}: ${"z".repeat(3000)}`, finalText: (n) => `Turn ${n} done.` });
    /** @type {any[]} */
    const said = [];
    const s = createSessions({ ...deps(big), publish: (chainId, e) => said.push({ chainId, ...e }) });
    // 10% of the 200,000 window = a 20,000-token line; each result ≈ 760 tokens, so the 26th completed turn crosses it.
    const { id } = s.create({ cwd: folder, model: "m", settings: { context: { compaction: { mode: "auto", thresholdPercent: 10 } } } });
    for (let i = 1; i <= 27; i++) await s.turn(id, { content: `turn ${i}` }, fakeReq(), new FakeRes());
    const bodies = big.calls.map((c) => c.pre.body.messages);
    assert.ok(!JSON.stringify(bodies).includes(CLEARED_TEXT), "no result was ever cleared at compose time");
    assert.ok(bodies.slice(1, -1).some((m) => JSON.stringify(m).includes("z".repeat(200))), "long results reached the model whole while under the line");
    assert.ok(summaries.some((x) => x.chainId === id), "at the line the history compacted once");
    // (fails before: yes — HarnessV3-FailurePoints §5.1 item 3) the line's compaction said how it went, its call named its job
    const progress = said.filter((e) => e.type === "compaction-progress" && e.chainId === id).map((e) => e.progress);
    assert.equal(progress[0]?.door, "line");
    assert.equal(progress.at(-1), null, "and its end");
    assert.ok(summaries.some((x) => x.chainId === id && /^compaction-/.test(String(x.jobId))), "its summary's call named the job");
    assert.match(String(bodies.at(-1)[0]?.content?.[0]?.text || ""), /^\[Filament compacted turns? /, "the last request starts from the compaction head");
  });

  // (fails before: yes — a compaction said nothing while it ran: the person pressed Compact and send and waited on
  // silence, the Activity tray alone showing its calls; HarnessV3-FailurePoints §5.1 item 3)
  test("a running compaction says how it goes, with its session's id: its step, its calls' streamed thinking and text, then its end", async () => {
    const log = Object.assign(new EventEmitter(), { forChain: () => ({ records: [] }), detail: () => null });
    /** @type {any[]} */
    const said = [];
    const s2 = createSessions({ ...deps(fakePipeline()), records: log, publish: (chainId, e) => said.push({ chainId, ...e }) });
    const { id } = s2.create({ cwd: folder, model: "agent/m" });
    await s2.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
    await s2.turn(id, { content: "turn 2" }, fakeReq(), new FakeRes());
    const was = memory.callModel;
    /** @type {any[]} */
    const asked = [];
    memory.callModel = async (a) => {
      asked.push(a);
      // The request log's records of the call, as the pipeline writes them: its job's, and another call's beside it.
      const record = { id: "rec-c1", jobId: a.jobId, status: "pending" };
      log.emit("event", { type: "start", record });
      // (said 700 ms after its output last grew: the log's held-back word, HarnessV4_Tasks U3-5)
      log.emit("event", { type: "progress", record: { ...record, liveOutChars: 4400, liveThinkChars: 4000 }, quietMs: 700 });
      log.emit("event", { type: "progress", record: { id: "rec-other", status: "pending", liveOutChars: 99, liveThinkChars: 0 } });
      log.emit("event", { type: "finish", record: { ...record, status: "ok" } });
      // A call heard only at its end: what it wrote is its finished record's.
      log.emit("event", { type: "start", record: { id: "rec-c2", jobId: a.jobId, status: "pending" } });
      log.emit("event", { type: "finish", record: { id: "rec-c2", jobId: a.jobId, status: "ok", textChars: 120, thinkingChars: 0 } });
      return `SUMMARY of ${a.chainId}`;
    };
    try {
      await s2.compact(id);
    } finally {
      memory.callModel = was;
    }
    const mine = said.filter((e) => e.type === "compaction-progress");
    assert.ok(mine.length && mine.every((e) => e.chainId === id), "with its own session's id");
    assert.match(String(asked[0]?.jobId), /^compaction-/, "the call carried the compaction's job");
    const first = mine[0].progress;
    assert.deepEqual([first.door, first.step, first.calls, first.thinkingChars, first.textChars, first.lastByteAt], ["manual", null, { running: 0, done: 0 }, 0, 0, null]);
    assert.match(String(mine[1]?.progress?.step), / writes the summary in one call$/, "who writes the summary, said as it begins");
    assert.deepEqual(mine[1]?.progress?.calls, { running: 0, done: 0 });
    const streaming = mine.find((e) => e.progress?.thinkingChars === 4000);
    assert.deepEqual([streaming?.progress.calls, streaming?.progress.textChars, typeof streaming?.progress.lastByteAt], [{ running: 1, done: 0 }, 400, "number"]);
    // (fails before: yes — the last byte was when the log said it, not when it came)
    assert.ok(streaming?.progress.lastByteAt <= Date.now() - 700, "the last byte is when the output last grew, not when the log said so");
    assert.deepEqual(mine.at(-2)?.progress.calls, { running: 0, done: 2 }, "the calls ended, their counts kept");
    assert.deepEqual([mine.at(-2)?.progress.thinkingChars, mine.at(-2)?.progress.textChars], [4000, 520]);
    assert.equal(mine.at(-1)?.progress, null, "its end");
    assert.ok(!mine.some((e) => e.progress?.textChars === 4499), "another call's record is not this compaction's");
  });

  // (fails before: yes — HarnessV4_Tasks U3-5: a Compact outside a turn had no stop of its own, the page could only
  // wait for it; and nothing told a page opened while it ran that it was running)
  test("a compaction written outside a turn can be stopped: nothing is written and the answer says it was stopped; the transcript says one is running", async () => {
    /** @type {any[]} */
    const said = [];
    const s3 = createSessions({ ...deps(fakePipeline()), publish: (chainId, e) => said.push({ chainId, ...e }) });
    const { id } = s3.create({ cwd: folder, model: "agent/m" });
    await s3.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
    await s3.turn(id, { content: "turn 2" }, fakeReq(), new FakeRes());
    assert.throws(() => s3.stopCompaction(id), (/** @type {any} */ e) => e.status === 409 && /no compaction is being written for this session/.test(e.message));
    assert.equal(s3.transcript(id).compacting, null);
    const was = memory.callModel;
    const writing = deferred();
    memory.callModel = (a) => {
      writing.resolve(a);
      return new Promise((_, reject) => a.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    };
    try {
      const outcome = assert.rejects(s3.compact(id), (/** @type {any} */ e) => e.status === 409 && e.extra?.stopped === true && /stopped before anything was written/.test(e.message));
      await writing.promise;
      assert.equal(said.find((e) => e.type === "compaction-progress")?.progress?.stoppable, true, "its progress says it can be stopped");
      const now = s3.transcript(id).compacting;
      assert.deepEqual([now?.door, now?.stoppable, now?.calls], ["manual", true, { running: 0, done: 0 }], "a page opened now reads it with the transcript");
      assert.deepEqual(s3.stopCompaction(id), { ok: true });
      await outcome;
    } finally {
      memory.callModel = was;
    }
    assert.equal(archive.getCompactions(id).length, 0, "nothing was written");
    assert.equal(said.filter((e) => e.type === "compaction-progress").at(-1)?.progress, null, "its end is said");
    assert.equal(s3.transcript(id).compacting, null);
    assert.throws(() => s3.stopCompaction(id), (/** @type {any} */ e) => e.status === 409, "nothing is left to stop");
    assert.equal((await s3.compact(id)).ok, true, "a stop is no failure of the session's: Compact works after it");
  });

  // (fails before: yes — the owner's of 11-09: a letter came while room was made for the person's message, and its wake
  // ran on the session being compacted away, its cold context read whole, ahead of the message the room was made for)
  test("no wake or goal round while room is made, nor before the message it was made for; where none comes, they are asked again", async () => {
    /** @type {string[]} */
    const asked = [];
    const s4 = createSessions({ ...deps(fakePipeline()), roomMade: (chainId) => asked.push(chainId), roomHoldMs: 150 });
    const { id } = s4.create({ cwd: folder, model: "agent/m" });
    const say = (/** @type {string} */ content) => s4.turn(id, { content }, fakeReq(), new FakeRes());
    const room = (/** @type {any} */ e) => e.status === 409 && e.extra?.wake === "room";
    await say("turn 1");
    await say("turn 2");
    const was = memory.callModel;
    const writing = deferred();
    const go = deferred();
    memory.callModel = async (a) => {
      writing.resolve(a);
      await go.promise;
      return was(a);
    };
    try {
      const made = s4.compact(id, { sending: true });
      await writing.promise;
      await assert.rejects(s4.turn(id, { wake: true }, fakeReq(), new FakeRes()), room, "no wake while its summary is written");
      await assert.rejects(s4.turn(id, { goal: true }, fakeReq(), new FakeRes()), room, "nor a goal's round");
      go.resolve(undefined);
      assert.equal((await made).ok, true);
    } finally {
      memory.callModel = was;
    }
    await assert.rejects(s4.turn(id, { wake: true }, fakeReq(), new FakeRes()), room, "nor before the message the room was made for");
    await say("the message");
    await assert.rejects(s4.turn(id, { wake: true }, fakeReq(), new FakeRes()), (/** @type {any} */ e) => e.extra?.wake === "told", "its turn took what came");
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(asked, [], "the message came: nothing is asked again");
    // Room made with no message to follow: asked again at once.
    await say("turn 4");
    assert.equal((await s4.compact(id)).ok, true);
    assert.deepEqual(asked, [id]);
    // Made for a message that never comes: asked again once its wait is over.
    await say("turn 5");
    assert.equal((await s4.compact(id, { sending: true })).ok, true);
    assert.deepEqual(asked, [id], "it waits for the message");
    await until(() => (asked.length === 2 ? true : null), "asked again past the wait", { timeoutMs: 5000 });
    assert.equal((await s4.turn(id, { goal: true }, fakeReq(), new FakeRes()).catch((e) => e)).extra?.wake, "told", "and nothing holds a round any more");
  });

  // (fails before: yes — HarnessV4_Tasks U3-5, UX-8: the row kept how long a compaction took only where a coding agent
  // compacted its own session; a summary Filament wrote had no time to show)
  test("a compaction's row keeps how long its summary took to write", async () => {
    let clock = 1_800_000_000_000;
    const s4 = createSessions({ ...deps(fakePipeline()), now: () => clock });
    const { id } = s4.create({ cwd: folder, model: "agent/m" });
    await s4.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
    await s4.turn(id, { content: "turn 2" }, fakeReq(), new FakeRes());
    const was = memory.callModel;
    memory.callModel = async (a) => {
      clock += 72_000;
      return `SUMMARY of ${a.chainId}`;
    };
    try {
      const c = await s4.compact(id);
      assert.equal(c.compaction.detail.ms, 72_000);
      assert.equal(c.boundary.detail.ms, 72_000, "the row the page draws at once has it");
      // (fails before: yes — the look of U3-5: the row drawn at once had no summary to open until the chat was read again)
      assert.equal(c.boundary.text, s4.transcript(id).boundaries.find((/** @type {any} */ b) => b.type === "compaction")?.text, "and its summary, as the transcript's row carries it");
      assert.match(String(c.boundary.text), /^SUMMARY of /);
      assert.equal(archive.getCompactions(id).at(-1)?.detail?.ms, 72_000, "and the archive's");
    } finally {
      memory.callModel = was;
    }
  });

  // (fails before: yes — HarnessV4_Tasks U3-11, V4-D89: what a compaction cost stood only on the Traffic page, under
  // its job; its row said how long it took and who wrote it, never what it cost)
  test("a compaction's row takes what it cost once its calls' records have finished: summed, written after the fact, said on the feed", async () => {
    const log = Object.assign(new EventEmitter(), { forChain: () => ({ records: [] }), detail: () => null });
    /** @type {any[]} */
    const said = [];
    const s5 = createSessions({ ...deps(fakePipeline()), records: log, publish: (chainId, e) => said.push({ chainId, ...e }) });
    const { id } = s5.create({ cwd: folder, model: "agent/m" });
    await s5.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
    await s5.turn(id, { content: "turn 2" }, fakeReq(), new FakeRes());
    const was = memory.callModel;
    let job = "";
    memory.callModel = async (a) => {
      job = String(a.jobId);
      // Two calls under the job: the first's record finishes while the summary is written, the second's a beat after
      // the summary lands (the reply reaches its caller before the request log closes the record).
      log.emit("event", { type: "start", record: { id: "rec-k1", jobId: job, status: "pending" } });
      log.emit("event", { type: "finish", record: { id: "rec-k1", jobId: job, status: "ok", cost: 0.012, listCost: 0.012 } });
      log.emit("event", { type: "start", record: { id: "rec-k2", jobId: job, status: "pending" } });
      return `SUMMARY of ${a.chainId}`;
    };
    try {
      const c = await s5.compact(id);
      const rowId = Number(c.compaction.id);
      const row = () => archive.getCompactions(id).find((r) => Number(r.id) === rowId);
      assert.equal(row()?.detail?.cost, undefined, "one call's record has not finished: no figure is written of a part");
      assert.equal(said.some((e) => e.type === "compaction-cost"), false);
      // Another job's record, and one of no job, are not this compaction's.
      log.emit("event", { type: "finish", record: { id: "rec-x", jobId: "compaction-other-9", status: "ok", cost: 9, listCost: 9 } });
      log.emit("event", { type: "finish", record: { id: "rec-y", status: "ok", cost: 9, listCost: 9 } });
      assert.equal(row()?.detail?.cost, undefined);
      log.emit("event", { type: "finish", record: { id: "rec-k2", jobId: job, status: "ok", cost: 0.03, listCost: 0.031 } });
      assert.deepEqual(row()?.detail?.cost, { paid: 0.042, list: 0.043, calls: 2 });
      assert.equal(row()?.detail?.ms != null && row()?.detail?.model != null, true, "the row's other figures stand");
      assert.deepEqual(said.filter((e) => e.type === "compaction-cost"), [{ chainId: id, type: "compaction-cost", id: rowId, cost: { paid: 0.042, list: 0.043, calls: 2 } }]);
      // Written once: a record said again changes nothing.
      log.emit("event", { type: "finish", record: { id: "rec-k2", jobId: job, status: "ok", cost: 5, listCost: 5 } });
      assert.deepEqual(row()?.detail?.cost, { paid: 0.042, list: 0.043, calls: 2 });
      assert.equal(said.filter((e) => e.type === "compaction-cost").length, 1);
      const drawn = s5.transcript(id).boundaries.find((/** @type {any} */ b) => b.type === "compaction" && Number(b.id) === rowId);
      assert.equal(drawn?.detail?.cost?.paid, 0.042, "a page opened later reads it with the row");
    } finally {
      memory.callModel = was;
    }
  });

  // (fails before: yes — HarnessV4_Tasks U3-11)
  test("a compaction's cost says only what is known: a plan's $0 beside its list price at once, nothing where no call was priced, nothing for a fold or a row undone meanwhile", async () => {
    const log = Object.assign(new EventEmitter(), { forChain: () => ({ records: [] }), detail: () => null });
    /** @type {any[]} */
    const said = [];
    const s6 = createSessions({ ...deps(fakePipeline()), records: log, publish: (chainId, e) => said.push({ chainId, ...e }) });
    const fresh = async () => {
      const { id } = s6.create({ cwd: folder, model: "agent/m" });
      await s6.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
      await s6.turn(id, { content: "turn 2" }, fakeReq(), new FakeRes());
      return id;
    };
    const costOf = (/** @type {string} */ id) => archive.getCompactions(id).at(-1)?.detail?.cost;
    const was = memory.callModel;
    /** @type {(job: string) => void} */
    let calls = () => {};
    memory.callModel = async (a) => {
      calls(String(a.jobId));
      return `SUMMARY of ${a.chainId}`;
    };
    try {
      // On a plan: paid $0, the same tokens at list price. Every record finished before the summary landed, so the
      // answer's own row has the figure.
      calls = (job) => {
        log.emit("event", { type: "start", record: { id: "rec-p1", jobId: job, status: "pending" } });
        log.emit("event", { type: "finish", record: { id: "rec-p1", jobId: job, status: "ok", cost: 0, listCost: 0.29, billing: "plan" } });
      };
      const plan = await fresh();
      const c = await s6.compact(plan);
      assert.deepEqual(c.compaction.detail.cost, { paid: 0, list: 0.29, calls: 1 });
      assert.deepEqual(c.boundary.detail.cost, { paid: 0, list: 0.29, calls: 1 }, "the row the page draws at once has it");
      // A call nobody priced (a failed try, a model with no price card): no figure, and nothing is said.
      calls = (job) => {
        log.emit("event", { type: "start", record: { id: "rec-n1", jobId: job, status: "pending" } });
        log.emit("event", { type: "finish", record: { id: "rec-n1", jobId: job, status: "ok", cost: null, listCost: null } });
      };
      const unpriced = await fresh();
      await s6.compact(unpriced);
      assert.equal(costOf(unpriced), undefined);
      assert.equal(said.some((e) => e.type === "compaction-cost" && e.chainId === unpriced), false);
      // What was paid is unknown, the list price is not (an agent's estimated tokens under an operator's card).
      calls = (job) => {
        log.emit("event", { type: "start", record: { id: "rec-l1", jobId: job, status: "pending" } });
        log.emit("event", { type: "finish", record: { id: "rec-l1", jobId: job, status: "ok", cost: null, listCost: 0.05 } });
      };
      const listed = await fresh();
      await s6.compact(listed);
      assert.deepEqual(costOf(listed), { paid: null, list: 0.05, calls: 1 });
      // A fold calls no model: nothing to sum.
      calls = () => {};
      const folded = await fresh();
      const f = await s6.compact(folded, { method: "fold" });
      assert.equal(f.compaction.method, "fold");
      assert.equal(costOf(folded), undefined);
      // Undone before its last record finished: the row is gone, and nothing is written or said of it.
      let job = "";
      calls = (j) => {
        job = j;
        log.emit("event", { type: "start", record: { id: "rec-u1", jobId: j, status: "pending" } });
      };
      const undone = await fresh();
      const u = await s6.compact(undone);
      await s6.undoCompaction(undone, u.compaction.id);
      log.emit("event", { type: "finish", record: { id: "rec-u1", jobId: job, status: "ok", cost: 0.02, listCost: 0.02 } });
      assert.equal(archive.getCompactions(undone).length, 0);
      assert.equal(said.some((e) => e.type === "compaction-cost" && e.chainId === undone), false);
    } finally {
      memory.callModel = was;
    }
  });

  test("compact on request writes a manual compaction; fork copies the settings layer", async () => {
    const { id } = sessions.create({ cwd: folder, model: "agent/m" });
    await assert.rejects(sessions.compact(id), (e) => e.status === 409 && /no completed turns/.test(e.message));
    await sessions.turn(id, { content: long("turn 1") }, fakeReq(), new FakeRes());
    await sessions.turn(id, { content: long("turn 2") }, fakeReq(), new FakeRes());
    // The files the two turns read (the fake pipeline's f1.txt and f2.txt), on disk when the summary lands.
    const n0 = archive.getTurns(id)[0].n;
    for (const n of [n0, n0 + 1]) writeFileSync(join(folder, `f${n}.txt`), `file ${n} on disk\n`);
    const c = await sessions.compact(id);
    assert.deepEqual({ from: c.compaction.fromTurn, to: c.compaction.toTurn, kind: c.compaction.kind }, { from: 1, to: 2, kind: "manual" });
    // (fails before: no — added for the mutant that brought nothing back after the compactor's summary, HarnessV3-AtHome
    // AH-D9 b) what the summarized turns read comes back after it, newest first
    const row = archive.getCompactions(id).at(-1);
    assert.deepEqual([row?.detail?.attached?.shown, row?.detail?.attached?.named], [2, 0]);
    const block = textOfMessage(archive.getMessage(row?.detail?.attached?.hash)?.message);
    assert.ok(block.indexOf(`<file path="f${n0 + 1}.txt">`) >= 0 && block.indexOf(`<file path="f${n0 + 1}.txt">`) < block.indexOf(`<file path="f${n0}.txt">`), block);
    // Said apart too (`covered`): a Compact and send pressed again, its send refused after the room was made, takes it.
    await assert.rejects(sessions.compact(id), (e) => e.status === 409 && /already under the summary/.test(e.message) && e.extra?.covered === true);
    // The method is the compaction's (HarnessV3-Compaction §5): one it does not know is refused before anything runs.
    await assert.rejects(sessions.compact(id, { method: "squash" }), (e) => e.status === 400 && /method must be one of/.test(e.message));
    const f = await sessions.fork(id, { atTurn: 1 });
    assert.equal(f.forkedFrom, id);
    assert.deepEqual(archive.chainSettings(f.chainId), archive.chainSettings(id));
    assert.equal(archive.getChain(f.chainId).meta.native, true);
    assert.equal(archive.getChain(f.chainId).meta.preset, undefined, "no preset is copied: there are none");
    await assert.rejects(sessions.fork(id, { atTurn: 0 }), (e) => e.status === 400);
  });

  // (fails before: yes — a fork's brief read every turn from the first, whatever summary the session had of them)
  test("a fork's brief continues from the newest summary at or before the fork point: the turns since are read, and with none since that summary is the brief", async () => {
    const s = createSessions(deps(fakePipeline()));
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    // Words enough that a summary leaves the chat smaller: one of a few words grows by its summary and what comes back
    // after it, and is not compacted (the order of this file's tests moved it either way).
    const said = (/** @type {number} */ n) => `lineage turn ${n}: ${"a question about the plan. ".repeat(60)}`;
    for (const n of [1, 2]) await s.turn(id, { content: said(n) }, fakeReq(), new FakeRes());
    const sum = await s.compact(id, { method: "summary" });
    assert.deepEqual([sum.compaction.fromTurn, sum.compaction.toTurn], [1, 2]);
    for (const n of [3, 4]) await s.turn(id, { content: said(n) }, fakeReq(), new FakeRes());
    let before = summaries.length;
    const f = await s.fork(id, { atTurn: 4, strategy: "brief" });
    const asked = summaries.slice(before).map((a) => String(a.user)).join("\n");
    assert.match(asked, /\[The summary an earlier compaction wrote of turns 1–2\]\nSUMMARY of /, "the summary there is, first");
    assert.ok(asked.includes("lineage turn 3") && asked.includes("lineage turn 4"), "then the turns since");
    assert.ok(!asked.includes("lineage turn 1") && !asked.includes("lineage turn 2"), "the turns under it are not read again");
    assert.equal(archive.getCompactions(f.chainId).filter((c) => c.kind === "brief").length, 1);
    // At the summary's own last turn nothing is left to read: it is the brief, and no model is called.
    before = summaries.length;
    const at = await s.fork(id, { atTurn: 2, strategy: "brief" });
    assert.equal(summaries.length, before, "no call");
    const row = archive.getCompactions(at.chainId).find((c) => c.kind === "brief");
    assert.deepEqual([row.detail?.how, textOfMessage(archive.getMessage(row.summary_hash).message)], ["kept", `SUMMARY of ${id}`]);
    // Before any summary: every turn up to the fork point, as ever.
    before = summaries.length;
    await s.fork(id, { atTurn: 1, strategy: "brief" });
    const first = summaries.slice(before).map((a) => String(a.user)).join("\n");
    assert.ok(first.includes("lineage turn 1") && !first.includes("The summary an earlier compaction wrote") && !first.includes("lineage turn 2"));
    // A summary a coding agent wrote in the middle of turn 4 knows part of turn 4: a fork at turn 3 passes it over.
    archive.addCompaction(id, { fromTurn: 1, toTurn: 3, summaryText: "WRITTEN INSIDE TURN 4", kind: "manual", window: "harness", method: "own", detail: { during: 4, by: "Claude Code", how: "agent-own" } });
    before = summaries.length;
    await s.fork(id, { atTurn: 3, strategy: "brief" });
    const third = summaries.slice(before).map((a) => String(a.user)).join("\n");
    assert.ok(!third.includes("WRITTEN INSIDE TURN 4"), "not the later turn's summary");
    assert.match(third, /\[The summary an earlier compaction wrote of turns 1–2\]/);
    assert.ok(third.includes("lineage turn 3"));
  });

  test("no archive (a failed open): every native row says so (503 through the rows)", async () => {
    const off = createSessions(deps(pipe));
    const saved = memory.archive;
    memory.archive = null;
    try {
      assert.throws(() => off.create({ cwd: folder, model: "agent/m" }), /no archive/);
      assert.throws(() => off.transcript("abc"), /no archive/);
    } finally {
      memory.archive = saved;
    }
  });

  test("P3 preview (dry compose): the session's figure and per-turn shapes, the forms a fresh agent session carries weighed, nothing written or summarised", async () => {
    const big = fakePipeline({ resultText: (n) => "z".repeat(24000), finalText: (n) => `Turn ${n} done.` });
    const s = createSessions(deps(big));
    const { id } = s.create({ cwd: folder, model: "m", settings: { context: { results: "status", compaction: { mode: "auto", thresholdPercent: 10 } } } });
    const empty = await s.preview(id);
    assert.equal(empty.turns, 0); assert.deepEqual(empty.current.perTurn, []); assert.equal(empty.current.form, "plain");
    await s.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
    await s.turn(id, { content: "turn 2" }, fakeReq(), new FakeRes());
    await s.turn(id, { content: "turn 3" }, fakeReq(), new FakeRes());
    const before = summaries.length;
    const p = await s.preview(id);
    assert.equal(p.turns, 3);
    assert.deepEqual(p.current.perTurn.map((t) => [t.n, t.shape]), [[1, "raw"], [2, "raw"], [3, "raw"]], "every turn whole until a compaction");
    assert.deepEqual(Object.keys(p.forms).sort(), ["fold", "fold+2", "plain", "words"], "the forms a fresh agent session can carry, for a start or a switch into one");
    assert.deepEqual(p.forms.plain.perTurn.map((t) => t.shape), ["raw", "raw", "raw"]);
    assert.deepEqual(p.forms["fold+2"].perTurn.map((t) => t.shape), ["fold", "raw", "raw"]);
    assert.ok(p.forms.fold.tokens < p.forms.plain.tokens, "a folded start weighs less than a whole one");
    assert.equal(p.forms.plain.results, "status", "the session pins results: status; a pinned policy holds in every form weighed");
    s.patchSettings(id, { unset: ["context.results"] });
    const unpinned = await s.preview(id, { forms: ["plain", "words"] });
    assert.deepEqual([unpinned.forms.plain.results, unpinned.forms.words.results], ["keep", "status"], "unpinned, the policy follows the form weighed");
    assert.equal(unpinned.current.wouldCompact, true, "whole 24k-char results weigh past the 20,000-token line: the session would compact");
    assert.equal(summaries.length, before, "a preview never calls the compaction model");
    assert.equal(archive.getCompactions(id).length, 0, "nothing written");
    const narrow = await s.preview(id, { forms: ["plain", "fold+1"] });
    assert.deepEqual(Object.keys(narrow.forms), ["plain", "fold+1"]);
    assert.match(narrow.forms["fold+1"].error, /no form a fresh agent session carries/, "an old view is no form");
    await assert.rejects(s.preview("nope"), /no such session/);
  });

  test("the dry-run turn (§14): prompt=1 returns the composed messages with the draft newest, skips the forms' sweep, sends and writes nothing", async () => {
    const pipe = fakePipeline();
    const s = createSessions(deps(pipe));
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    await s.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
    await s.turn(id, { content: "turn 2" }, fakeReq(), new FakeRes());
    const before = { turns: archive.getTurns(id).length, calls: pipe.calls.length };
    const p = await s.preview(id, { prompt: true, text: "a draft, not sent" });
    assert.deepEqual(Object.keys(p.forms), [], "a prompt-only dry run does not sweep the forms");
    const msgs = p.current.prompt.messages;
    assert.equal(msgs.length, 9, "two completed turns raw under plain (user, tool call, tool result, final each) and the draft");
    assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant", "user"]);
    assert.equal(msgs[1].content[1].type, "tool_use", "plain keeps the tool round raw");
    assert.equal(msgs.at(-1).content[0].text, "a draft, not sent");
    assert.equal(p.current.prompt.tokens, p.current.tokens);
    assert.match(p.current.prompt.added, /system prompt/, "says what the pipeline adds on the way out");
    assert.equal(archive.getTurns(id).length, before.turns, "nothing recorded");
    assert.equal(pipe.calls.length, before.calls, "nothing sent");
    const plain = await s.preview(id);
    assert.equal(plain.current.prompt, undefined, "the shape preview carries no prompt");
    assert.ok(Object.keys(plain.forms).length > 1, "and still sweeps the forms");
    const both = await s.preview(id, { prompt: true, text: "x", forms: ["fold"] });
    assert.deepEqual(Object.keys(both.forms), ["fold"], "named forms still run alongside the prompt");
  });

  // (fails before: no — a guard: the owner's of 11-07, "cache should not break at all". A preset was copied into the
  // chat's own layer when it started; its name, kept on the chain, was a label nothing composes from. A chat a preset
  // started keeps its bytes, and its knob says it is the chat's own.)
  test("a chat a preset started composes the same bytes with its name kept or not: the knob is the chat's own", async () => {
    const s = createSessions(deps(fakePipeline()));
    const { id } = s.create({ cwd: folder, model: "agent/m", settings: { context: { results: "status" } } });
    await s.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
    await s.turn(id, { content: "turn 2" }, fakeReq(), new FakeRes());
    const bytes = async () => JSON.stringify((await s.preview(id, { prompt: true, text: "the next message" })).current.prompt.messages);
    const before = { bytes: await bytes(), hash: s.settingsOf(id).hash };
    archive.mergeMeta(id, { preset: "balanced" });
    assert.equal(await bytes(), before.bytes, "the same messages, byte for byte");
    const after = s.settingsOf(id);
    assert.equal(after.hash, before.hash, "the same settings");
    assert.equal(after.flat["context.results"], "status"); assert.equal(after.sources["context.results"], "session");
    assert.ok(!("preset" in after) && !("presetStatus" in after) && !("presets" in after), "and no preset is said of it");
  });

  test("P3 mirrors: learn off marks the chain for the learner; index off takes its text out of the search index and on puts it back", async () => {
    const s = createSessions(deps(fakePipeline()));
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    await s.turn(id, { content: "indexed words zebra" }, fakeReq(), new FakeRes());
    const hits = () => archive.searchInputs("zebra", { limit: 50 }).filter((h) => h.chainId === id).length;
    assert.ok(hits() >= 1, "the turn's text is searchable");
    s.patchSettings(id, { patch: { privacy: { index: false } } });
    assert.equal(archive.getChain(id).meta.noIndex, true);
    assert.equal(hits(), 0, "off: the rows are gone");
    await s.turn(id, { content: "later zebra too" }, fakeReq(), new FakeRes());
    assert.equal(hits(), 0, "off: later turns stay out");
    s.patchSettings(id, { unset: ["privacy.index"] });
    assert.equal(archive.getChain(id).meta.noIndex, undefined);
    assert.ok(hits() >= 2, "on again: every turn re-indexed");
    s.patchSettings(id, { patch: { memory: { learn: false } } });
    assert.equal(archive.getChain(id).meta.noLearn, true);
    s.patchSettings(id, { patch: { memory: { learn: true }, privacy: { learn: false } } });
    assert.equal(archive.getChain(id).meta.noLearn, true, "either switch off keeps the learner out");
    s.patchSettings(id, { unset: ["privacy.learn"] });
    assert.equal(archive.getChain(id).meta.noLearn, undefined);
    // A fork of a session that opted out keeps the opt-out: its copied turns never reach the index, its meta carries
    // both flags (the settings layer is copied, so the document says the same).
    s.patchSettings(id, { patch: { privacy: { index: false, learn: false } } });
    assert.equal(hits(), 0);
    const f = await s.fork(id, { atTurn: 1 });
    const fm = archive.getChain(f.chainId).meta;
    assert.equal(fm.noIndex, true, "the fork is out of the index like its source");
    assert.equal(fm.noLearn, true, "and out of the learner's reach");
    assert.equal(archive.searchInputs("zebra", { limit: 50 }).filter((h) => h.chainId === f.chainId).length, 0, "the copied turn's text was not indexed");
    s.patchSettings(f.chainId, { unset: ["privacy.index"] });
    assert.ok(archive.searchInputs("zebra", { limit: 50 }).some((h) => h.chainId === f.chainId), "the fork's own document lets it back in");
    s.patchSettings(id, { unset: ["privacy.index", "privacy.learn"] });
    assert.ok(hits() >= 2, "the source is back in");
    // The project layer reaches every session of the project now, not at each one's next turn.
    const sibling = s.create({ cwd: folder, model: "agent/m" });
    await s.turn(sibling.id, { content: "sibling zebra" }, fakeReq(), new FakeRes());
    const projectId = archive.getChain(id).project_id;
    s.patchProjectSettings(projectId, { patch: { privacy: { index: false, learn: false } } });
    for (const c of [id, f.chainId, sibling.id]) {
      assert.equal(archive.getChain(c).meta.noIndex, true, `${c}: out of the index by the project's layer`);
      assert.equal(archive.getChain(c).meta.noLearn, true, `${c}: out of the learner's reach by the project's layer`);
    }
    assert.equal(archive.searchInputs("zebra", { limit: 50 }).length, 0, "no zebra anywhere while the project says so");
    s.patchProjectSettings(projectId, { unset: ["privacy.index", "privacy.learn"] });
    assert.equal(archive.getChain(sibling.id).meta.noIndex, undefined);
    assert.equal(archive.getChain(sibling.id).meta.noLearn, undefined);
    assert.ok(archive.searchInputs("zebra", { limit: 50 }).some((h) => h.chainId === sibling.id), "the project lifting the flag re-indexes every session");
  });

  test("P3 settings history: the session's own changes and its project's layer, newest first, from the operation log", async () => {
    const log = [];
    const listing = { record: (kind, title, o) => { const op = { id: `op${log.length}`, ts: new Date(now()).toISOString(), kind, title, ...(o || {}) }; log.push(op); ops.push(op); }, list: ({ kinds }) => log.filter((o) => (Array.isArray(kinds) ? kinds : [kinds]).includes(o.kind)).slice().reverse() };
    const realArchiveOp = memory.onArchiveOp;
    memory.onArchiveOp = (title, o) => listing.record("archive", title, o);
    const s = createSessions({ ...deps(fakePipeline()), ops: listing });
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    const other = s.create({ cwd: folder, model: "agent/m" });
    s.patchSettings(id, { patch: { context: { results: "status" } } });
    s.patchSettings(id, { patch: { loop: { permissions: "read-only" } } });
    s.patchSettings(other.id, { patch: { context: { results: "pointer" } } });
    // The project layer holds repo facts only (D3): a mode knob is refused there, so the history test uses one.
    s.patchProjectSettings(archive.getChain(id).project_id, { patch: { loop: { rules: [{ tool: "bash", pattern: "rm -rf *", verdict: "deny" }] } } });
    const hst = s.settingsHistory(id);
    assert.deepEqual(hst.entries.map((e) => [e.layer, e.sub]), [["project", "project-settings"], ["session", "session-settings"], ["session", "session-settings"], ["session", "session-create"]], "the other session's change is not mine; the project's is; the creation closes the list");
    assert.deepEqual(hst.entries.at(-1).changes, ["created, model agent/m"]);
    assert.ok(hst.entries[0].changes.some((c) => /loop\.rules/.test(c)));
    assert.ok(hst.entries[1].changes.some((c) => /loop\.permissions/.test(c)), JSON.stringify(hst.entries[1]));
    assert.equal(s.settingsHistory(id, { limit: 1 }).entries.length, 1);
    assert.equal(s.settingsHistory(id, { limit: 1 }).entries[0].sub, "project-settings");
    assert.deepEqual(createSessions(deps(fakePipeline())).settingsHistory(id).entries, [], "without ops.list the history is empty and says so");
    s.patchProjectSettings(archive.getChain(id).project_id, { unset: ["loop.rules"] });
    memory.onArchiveOp = realArchiveOp;
  });

  // (fails before: yes — every turn's stamp kept `shapes`, and the transcript carried them)
  test("P4 the stamp: what each request had is its record's; no turn keeps a copy of every earlier turn's shape", async () => {
    const p = fakePipeline();
    const s = createSessions(deps(p));
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    for (const n of [1, 2, 3]) await s.turn(id, { content: `turn ${n}` }, fakeReq(), new FakeRes());
    const tr = s.transcript(id);
    // What each request had is its record's (the composer's report, `view.shapes`); no turn keeps a copy of every earlier
    // turn's shape — it grew with the square of the chat, and nothing read it there.
    const shapesOf = (/** @type {number} */ i) => p.calls[i].pre.composition.turns.map((/** @type {any} */ t) => [t.n, t.shape]);
    assert.deepEqual(shapesOf(1), [[1, "raw"]], "turn 2's request: turn 1, the newest finished, whole");
    assert.deepEqual(shapesOf(2), [[1, "raw"], [2, "raw"]], "turn 3's request: both whole");
    const stamps = archive.getTurns(id).map((t) => t.meta.composed);
    assert.deepEqual(stamps.map((c) => "shapes" in c), [false, false, false]);
    assert.deepEqual(tr.turns.map((t) => "shapes" in (t.composed || {})), [false, false, false]);
    assert.deepEqual(tr.turns[2].composed, stamps[2], "the stamp as it is kept");
    assert.equal(tr.turns[0].shape, null, "no compaction marked it");
    assert.equal(tr.turns[2].composed.form, "plain");
  });

  test("P4 recall: the row answers a turn whole (calls, results with pointers, reply) and a result by r:<hash8>; unknown pointers are refused in words", async () => {
    const s = createSessions(deps(fakePipeline({ resultText: (n) => `line one of file ${n}\nline two` })));
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    await s.turn(id, { content: "first" }, fakeReq(), new FakeRes());
    await s.turn(id, { content: "second" }, fakeReq(), new FakeRes());
    const t = s.recallFor(id, { turn: 1 });
    assert.equal(t.turn, 1); assert.equal(t.calls, 1);
    assert.match(t.text, /^## Turn 1\nUser: first\nAssistant: Reading.\nTool call read \{"path":"f1.txt"\}\nResult of read \(r:[0-9a-f]{8}\):\nline one of file 1\nline two\nAssistant: Turn 1 done./);
    const ref = t.text.match(/r:([0-9a-f]{8})/)[1];
    const r = s.recallFor(id, { result: `r:${ref}` });
    assert.equal(r.text, `Result of read in turn 1:\nline one of file 1\nline two`);
    assert.equal(s.recallFor(id, { result: ref }).text, r.text, "with or without the r: prefix");
    assert.throws(() => s.recallFor(id, { turn: 9 }), (e) => e.status === 404 && /no turn 9/.test(e.message));
    assert.throws(() => s.recallFor(id, { result: "r:00000000" }), (e) => e.status === 404 && /no archived result r:00000000/.test(e.message));
    // With neither, the chat's turns as a list, newest first (the owner's of 11-08).
    assert.match(s.recallFor(id, {}).text, /^## This chat's turns 2 back to 1, newest first: [^\n]*\n\n### Turn 2 [^]*\nUser: second\n[^]*### Turn 1 [^]*\nUser: first\nAssistant: Turn 1 done\./);
    assert.throws(() => s.recallFor(id, { pointer: "x" }), (e) => e.status === 404 && /give \{ turn/.test(e.message));
  });

  // (fails before: yes — the bug hunt of 10-30, L5: every filament_recall({ result }) opened and hashed every result of
  // the session again, newest turn first, however often the same pointer was asked for)
  test("P4 recall: a result asked for again is found without opening the session's every message again", async () => {
    const s = createSessions(deps(fakePipeline()));
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    for (let i = 1; i <= 12; i++) await s.turn(id, { content: `turn ${i}` }, fakeReq(), new FakeRes());
    const ref = s.recallFor(id, { turn: 1 }).text.match(/r:([0-9a-f]{8})/)[1];
    const first = s.recallFor(id, { result: `r:${ref}` });
    assert.equal(first.text, "Result of read in turn 1:\ncontents of file 1");
    let opened = 0;
    const real = archive.getMessage;
    archive.getMessage = function (/** @type {string} */ hash) {
      opened++;
      return real.call(this, hash);
    };
    try {
      assert.equal(s.recallFor(id, { result: ref }).text, first.text, "the same answer");
    } finally {
      delete archive.getMessage;
    }
    const work = archive.getTurns(id)[0].work.length;
    assert.ok(opened <= work, `the turn that holds it, ${work} messages of work, not the session's: ${opened} opened`);
  });

  // (fails before: yes — the bug hunt of 10-30, L5: its memo, kept at first by a message's hash alone, let one archive's
  // reading of a message it stores cut short answer the recall of another archive that holds it whole; the source
  // before L5 kept no memo, and passes)
  test("P4 recall: each archive's messages answer for themselves — one cut short under another archive's cap hides nothing", () => {
    const home = mkdtempSync(join(dir, "recall-caps-"));
    const text = "line of the file ".repeat(20);
    const short = new Archive({ file: join(home, "short.db"), caps: { messageBytes: 120 } });
    const whole = new Archive({ file: join(home, "whole.db") });
    /** The same turn in an archive: a read and its result. @param {Archive} a */
    const turnIn = (a) => {
      const chain = a.chainForKey("n:recall-caps", { cwd: home, client: "harness", model: "m" });
      const { turnId } = a.beginTurn(chain.id, { requestId: "r1", model: "m", upstream: "u", userMessage: { role: "user", content: [{ type: "text", text: "read it" }] } });
      a.addWork(turnId, [
        { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "read", input: { path: "f.txt" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: text }] },
      ]);
      a.finishTurn(turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: "read" }] } });
      return chain.id;
    };
    try {
      assert.equal(recallResult(short, turnIn(short), resultRef(text)), null, "stored cut short there: no result to find");
      assert.equal(recallResult(whole, turnIn(whole), resultRef(text))?.text, text, "stored whole here: found");
    } finally {
      short.close();
      whole.close();
    }
  });

  test("P4 fork strategies: folds marks every inherited turn with a fold compaction of its own; brief writes one lineage summary over the turns; results seeds the fork's document; the source is untouched", async () => {
    const s = createSessions(deps(fakePipeline()));
    const { id } = s.create({ cwd: folder, model: "agent/m", settings: { context: { results: "status" } } });
    for (const c of ["one", "two", "three"]) await s.turn(id, { content: c }, fakeReq(), new FakeRes());
    const folds = await s.fork(id, { atTurn: 3, strategy: "folds", results: "pointer" });
    assert.deepEqual(folds.strategy, { transcript: "folds", results: "pointer", settings: "inherit", shaped: 3, brief: null });
    const ft = s.transcript(folds.chainId);
    assert.deepEqual(ft.turns.map((t) => t.shape), ["fold", "fold", "fold"]);
    assert.equal(ft.settings.effective.context.results, "pointer"); assert.equal(ft.settings.sources["context.results"], "session");
    const fp = await s.preview(folds.chainId);
    assert.deepEqual(fp.current.perTurn.map((t) => t.shape), ["fold", "fold", "fold"], "the fold compaction's marks hold every inherited turn, the newest too");
    const mark = ft.boundaries.find((b) => b.type === "compaction" && b.kind === "fork");
    assert.deepEqual([mark?.method, mark?.fromTurn, mark?.toTurn, mark?.undoable], ["fold", 1, 3, false], "the fork's own fold, not one to undo: its turns came folded");
    assert.deepEqual(s.transcript(id).turns.map((t) => t.shape), [null, null, null], "the source is untouched");
    const plainParent = s.create({ cwd: folder, model: "agent/m" });
    for (const c of ["one", "two"]) await s.turn(plainParent.id, { content: c }, fakeReq(), new FakeRes());
    const plainFolds = await s.fork(plainParent.id, { atTurn: 2, strategy: "folds" });
    assert.deepEqual((await s.preview(plainFolds.chainId)).current.perTurn.map((t) => t.shape), ["fold", "fold"], "a whole chat's fork folds as asked");
    await assert.rejects(s.fork(plainParent.id, { atTurn: 2, strategy: "summaries" }), (e) => e.status === 400, "no summaries to fork with");
    const ditto = await s.fork(plainParent.id, { atTurn: 2, strategy: "ditto" });
    assert.deepEqual((await s.preview(ditto.chainId)).current.perTurn.map((t) => t.shape), ["raw", "raw"]);
    const before = summaries.length;
    const brief = await s.fork(id, { atTurn: 3, strategy: "brief", settings: "project" });
    assert.equal(summaries.length, before + 1, "one lineage summary written with the compaction model");
    assert.equal(summaries.at(-1).purpose, "compact");
    assert.ok(brief.strategy.brief.chars > 0); assert.equal(brief.strategy.settings, "project"); assert.equal(brief.settingsCopied, false);
    const bt = s.transcript(brief.chainId);
    assert.equal(bt.boundaries.filter((b) => b.type === "compaction" && b.kind === "brief" && b.method === "summary").length, 1);
    assert.deepEqual(bt.turns.map((t) => t.shape), [null, null, null], "the brief stands over them: no shape of their own");
    assert.equal(bt.settings.sources["context.results"], "default", "settings: project — the source's own layer stayed behind");
    const bp = await s.preview(brief.chainId);
    assert.equal(bp.current.perTurn.length, 0, "every inherited turn is under the brief");
    assert.deepEqual(bp.current.head, { fromTurn: 1, toTurn: 3, kind: "brief" });
    await assert.rejects(s.fork(id, { atTurn: 3, strategy: "sideways" }), (e) => e.status === 400 && /strategy must be one of/.test(e.message));
    await assert.rejects(s.fork(id, { atTurn: 3, results: "clear" }), (e) => e.status === 400 && /results must be one of/.test(e.message));
    await assert.rejects(s.fork(id, { atTurn: 9 }), (e) => e.status === 400 && /the session has 3 turns; cannot fork at turn 9/.test(e.message), "past the last turn: a refusal, not a 500");
    const empty = s.create({ cwd: folder, model: "agent/m" });
    await assert.rejects(s.fork(empty.id, { atTurn: 1 }), (e) => e.status === 400 && /no turns to fork from/.test(e.message));
    assert.ok(ops.some((o) => o.sub === "fork-strategy" && o.detail?.chainId === brief.chainId));
  });

  // (fails before: yes — HarnessV4_Tasks C26: a session made room by itself unless it was switched to ask, and the
  // refusal said nothing of what would read the session)
  test("a message past the line asks first, the default: refused with 409 and needsCompaction, saying what will read the session; nothing is sent or frozen; compact on request, then the turn goes", async () => {
    const pipe = fakePipeline({ resultText: (n) => "x".repeat(40000), finalText: (n) => "y".repeat(40000) });
    let window = 40000;
    const s = createSessions({ ...deps(pipe), config: { get: () => ({ ...config.get(), upstreams: [{ id: "u", type: "anthropic", pricing: { m: { input: 1, output: 1, contextTokens: window } } }], routes: [{ match: "*", upstream: "u", upstreamModel: "{model}", enabled: true }] }) } });
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    // The loop's prompt and tools ride every request, the loop being always on (the owner's of 11-09): the window grows
    // by them, so the 85% line sits as far over them as it sat over nothing when this test was written.
    window += Math.ceil((await s.preview(id, {})).current.fixed / 0.85 / 100) * 100;
    const line = window * 0.85;
    assert.equal(s.settingsOf(id).sources["context.compaction.mode"], "default", "nothing chose it");
    await s.turn(id, { content: "one" }, fakeReq(), new FakeRes());
    await s.turn(id, { content: "two" }, fakeReq(), new FakeRes());
    const sent = pipe.calls.length;
    await assert.rejects(s.turn(id, { content: "three" }, fakeReq(), new FakeRes()), (e) => {
      assert.equal(e.status, 409);
      assert.ok(e.message.endsWith(`past the ${line.toLocaleString()}-token compaction line — choose how to make room and send again (Compact and send), or set context.compaction.mode to auto`), e.message);
      assert.deepEqual([e.extra.needsCompaction, e.extra.usable, e.extra.window, e.extra.estimated, e.extra.reads, e.extra.cache], [true, line, window, true, { kind: "model", name: "m", from: "copy" }, null]);
      assert.equal(`${e.extra.why} — choose how to make room and send again (Compact and send), or set context.compaction.mode to auto`, e.message, "what does not fit, said apart from what to do next");
      return true;
    });
    assert.equal(pipe.calls.length, sent, "nothing went out");
    assert.equal(s.transcript(id).turns.length, 2);
    assert.equal(s.live(id), null, "the live slot is released");
    const c = await s.compact(id);
    assert.equal(c.compaction.toTurn, 2);
    const r = await s.turn(id, { content: "three" }, fakeReq(), new FakeRes());
    assert.equal(r.report.underSummary, 2); assert.equal(r.report.needsCompaction, false);
  });

  // (fails before: yes — HarnessV4_Tasks C26: the turns Filament replays in a session's copy were refused with the
  // question a person answers, and the replay ended there)
  test("a turn nobody is at the page for asks nothing: past the line it makes room by the session's method and goes, in a session that asks a person first", async () => {
    const pipe = fakePipeline({ resultText: (n) => "x".repeat(40000), finalText: (n) => "y".repeat(40000) });
    let window = 40000;
    const s = createSessions({ ...deps(pipe), config: { get: () => ({ ...config.get(), upstreams: [{ id: "u", type: "anthropic", pricing: { m: { input: 1, output: 1, contextTokens: window } } }], routes: [{ match: "*", upstream: "u", upstreamModel: "{model}", enabled: true }] }) } });
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    // The window grows by the loop's prompt and tools, which ride every request (the owner's of 11-09), as above.
    window += Math.ceil((await s.preview(id, {})).current.fixed / 0.85 / 100) * 100;
    await s.turn(id, { content: "one" }, fakeReq(), new FakeRes());
    await s.turn(id, { content: "two" }, fakeReq(), new FakeRes());
    await assert.rejects(s.turn(id, { content: "three" }, fakeReq(), new FakeRes()), (/** @type {any} */ e) => e.status === 409 && e.extra.needsCompaction === true, "a person's message is asked");
    const r = await s.turn(id, { content: "three", unattended: true }, fakeReq(), new FakeRes());
    assert.deepEqual(r.report.compactions.map((c) => c.toTurn), [2], "room was made at the turn's start");
    assert.equal(r.report.needsCompaction, false);
    assert.equal(s.transcript(id).turns.length, 3, "the turn ran");
    assert.equal(s.settingsOf(id).effective.context.compaction.mode, "ask", "the session's own answer stands: its next message from a person asks");
  });

  // (fails before: yes — the hunt of 11-08, T1 #4: Filament's own turns past the line were refused with the question a
  // person answers, which nobody saw; a goal's round was counted first, and no other was owed — the drive stalled)
  test("Filament's own turns ask nothing past the line either: a goal's round, a flow's line and a sync make room by the session's method and go", async () => {
    const pipe = fakePipeline({ resultText: (n) => "x".repeat(40000), finalText: (n) => "y".repeat(40000) });
    /** @type {string[]} */
    const owed = [];
    let window = 40000;
    const s = createSessions({ ...deps(pipe), config: { get: () => ({ ...config.get(), upstreams: [{ id: "u", type: "anthropic", pricing: { m: { input: 1, output: 1, contextTokens: window } } }], routes: [{ match: "*", upstream: "u", upstreamModel: "{model}", enabled: true }] }) }, goalRound: (chainId) => owed.push(chainId) });
    const past = async (/** @type {(id: string) => Promise<any>} */ own) => {
      const { id } = s.create({ cwd: folder, model: "agent/m" });
      // The window grows by the loop's prompt and tools, which ride every request (the owner's of 11-09), as above.
      window = 40000 + Math.ceil((await s.preview(id, {})).current.fixed / 0.85 / 100) * 100;
      await s.turn(id, { content: "one" }, fakeReq(), new FakeRes());
      await s.turn(id, { content: "two" }, fakeReq(), new FakeRes());
      await assert.rejects(s.turn(id, { content: "three" }, fakeReq(), new FakeRes()), (/** @type {any} */ e) => e.status === 409 && e.extra.needsCompaction === true, "a person's message is asked");
      return { id, r: await own(id) };
    };
    const goalOf = (/** @type {string} */ id) => /** @type {any} */ (memory).goalFor(id);
    const goalRun = await past(async (id) => {
      memory.setGoal(id, { text: "the parser ships", createdAt: 1, status: "active", acceptedAt: 1, estimate: null, drive: { on: true, round: 0, cap: 20, halted: null } });
      // A turn of Filament's own after Compact and send — a message of the person's halts the drive (the owner's of
      // 11-10) —: its end owes the goal's first round.
      await s.compact(id);
      await s.turn(id, { content: "go on with the parser", byFilament: true }, fakeReq(), new FakeRes());
      assert.deepEqual([owed.at(-1), s.goalOwed(id)], [id, true], "its round is owed");
      // Another of Filament's, which brings the chat past the line again; its end owes the round once more.
      await s.turn(id, { content: "four", byFilament: true }, fakeReq(), new FakeRes());
      return s.turn(id, { goal: true }, fakeReq(), new FakeRes());
    });
    assert.equal(goalRun.r.report.needsCompaction, false);
    assert.ok(goalRun.r.report.compactions.length, "room was made at the round's start");
    assert.equal(goalOf(goalRun.id).drive.round, 1, "the round counted is the one that ran");
    assert.match(JSON.stringify(s.transcript(goalRun.id).turns.at(-1).user), /goal round 1 of 20/);
    const flowRun = await past((id) => s.turn(id, { content: "go on with the box's work", byFilament: true }, fakeReq(), new FakeRes()));
    assert.deepEqual([flowRun.r.report.needsCompaction, flowRun.r.report.compactions.map((c) => c.toTurn)], [false, [2]], "a flow's line in its team box's chat");
    const syncRun = await past((id) => s.turn(id, { content: "[Filament: a sync from this project's Space — the board as it stands]", sync: true }, fakeReq(), new FakeRes()));
    assert.deepEqual([syncRun.r.report.needsCompaction, syncRun.r.report.compactions.map((c) => c.toTurn)], [false, [2]], "a sync");
    assert.equal(s.settingsOf(syncRun.id).effective.context.compaction.mode, "ask", "the session's own answer stands: a person's next message past the line asks");
  });

  // (fails before: yes — the review of 54f63529f, i1: a flow's line into its team box's chat went in as the answer to the
  // question its loop waited on — a permission without Allow read as Not run —, where a wake, a goal's round, a sync and a
  // team's result are refused)
  test("Filament's own line in a flow's team chat is refused while a question waits for the person, as a team's result is; the question stands", async () => {
    const pipe = fakePipeline();
    const s = createSessions(deps(pipe));
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    await s.turn(id, { content: "one" }, fakeReq(), new FakeRes());
    const sent = pipe.calls.length;
    for (const kind of ["ask", "permission"]) {
      archive.mergeMeta(id, { paused: { kind, requestId: "req-1" } });
      await assert.rejects(s.turn(id, { content: "Your work was sent back: run the tests", byFilament: true }, fakeReq(), new FakeRes()), (/** @type {any} */ e) => {
        assert.equal(e.status, 409);
        assert.deepEqual(e.extra, { byFilament: "asking" });
        assert.equal(e.message, "a question waits for the person's answer: the flow's line goes once the answer's turn ends");
        return true;
      }, kind);
      assert.equal(archive.getChain(id).meta.paused?.kind, kind, "the question still waits");
    }
    assert.equal(pipe.calls.length, sent, "nothing went");
    archive.mergeMeta(id, { paused: undefined });
    await s.turn(id, { content: "Your work was sent back: run the tests", byFilament: true }, fakeReq(), new FakeRes());
    assert.equal(pipe.calls.length, sent + 1, "with no question waiting, it goes");
  });

  // (fails before: yes — HarnessV4_Tasks C26: only a coding agent's session asked; a model Filament calls went on
  // into a cold cache without a word)
  test("the cold question for a model Filament calls: asked once its route's cache life has run out since the last turn — five minutes, or the hour its rules give; never where the replies used no cache, nor after another model answered", async () => {
    let skew = 0;
    /** @param {string | null} ttl */
    const make = (ttl = null) => {
      const cfg = { ...config.get(), upstreams: [{ id: "u", type: "anthropic", ...(ttl ? { rules: { cache: { ttl } } } : {}) }], routes: [{ match: "*", upstream: "u", upstreamModel: "{model}", enabled: true }] };
      const s = createSessions({ ...deps(fakePipeline()), config: { get: () => cfg }, now: () => Date.now() + skew });
      return { s, id: s.create({ cwd: folder, model: "agent/m" }).id };
    };
    /** The newest turn's facts, as its records leave them: who answered, and what it read and wrote of the cache. */
    const ended = (/** @type {string} */ id, facts = {}) => archive.mergeTurnMeta(archive.turnBodies(id).at(-1).turnId, { facts: { upstream: "u", model: "m", tokens: { input: 10, output: 5, cacheRead: 900, cacheWrite: 100 }, ...facts } });
    const say = (/** @type {any} */ s, /** @type {string} */ id, /** @type {string} */ content, extra = {}) => s.turn(id, { content, ...extra }, fakeReq(), new FakeRes());
    const { s, id } = make();
    await say(s, id, "turn 1");
    ended(id);
    skew = 4 * 60_000;
    await say(s, id, "turn 2: within the five minutes");
    ended(id);
    skew = 6 * 60_000;
    await assert.rejects(say(s, id, "turn 3"), (/** @type {any} */ e) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /^This session has been idle 6 m, and m keeps its cache 5 m after a turn: the cache has gone cold, so going on sends all ≈[\d,]+ tokens of its 200,000-token window at the full price again\. Send it as it is, or make room first\?$/);
      const q = e.extra.resumeQuestion;
      assert.deepEqual([q.why, q.estimated, q.window, q.usable, q.reads, q.cache.state, q.cache.ttlMs, q.cache.seen], ["cold", true, 200_000, 170_000, { kind: "model", name: "m", from: "copy" }, "cold", 300_000, true]);
      assert.ok(q.held > 0);
      return true;
    });
    await say(s, id, "turn 3", { sendAsIs: true });
    ended(id, { tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } });
    await say(s, id, "turn 4: its replies used no cache, so there is none to lose");
    ended(id, { model: "other" });
    await say(s, id, "turn 5: another model answered last");
    ended(id, { upstream: "elsewhere" });
    await say(s, id, "turn 6: another upstream answered last");
    ended(id);
    archive.mergeMeta(id, { paused: { kind: "ask" } });
    await say(s, id, "turn 7: the answer to what a waiting turn asked");
    archive.mergeMeta(id, { paused: undefined });
    ended(id);
    await assert.rejects(say(s, id, "turn 8"), (/** @type {any} */ e) => e.status === 409 && e.extra.resumeQuestion?.why === "cold");
    await say(s, id, "turn 8", { settingsPatch: { context: { compaction: { resumeQuestion: false } } } });
    ended(id);
    await say(s, id, "turn 9: switched off for the session");
    // (fails before: yes — the owner's of 11-06: a turn of Filament's own loop says its upstream is the loop's, and its
    // chat never asked) The loop asks as any model Filament calls does, its cache read through the route its turns went by.
    const loop = make();
    await say(loop.s, loop.id, "turn 1");
    ended(loop.id, { upstream: "agent-loop" });
    skew += 6 * 60_000;
    await assert.rejects(say(loop.s, loop.id, "turn 2"), (/** @type {any} */ e) => e.status === 409 && e.extra.resumeQuestion?.why === "cold" && e.extra.resumeQuestion.cache.ttlMs === 300_000);
    await say(loop.s, loop.id, "turn 2", { sendAsIs: true });
    // An hour, where the route's rules ask the provider for one.
    skew = 0;
    const hour = make("1h");
    await say(hour.s, hour.id, "turn 1");
    ended(hour.id);
    skew = 59 * 60_000;
    await say(hour.s, hour.id, "turn 2: within the hour");
    ended(hour.id);
    skew = 61 * 60_000;
    await assert.rejects(say(hour.s, hour.id, "turn 3"), (/** @type {any} */ e) => e.status === 409 && e.extra.resumeQuestion.cache.ttlMs === 3_600_000 && /keeps its cache 1 h after a turn/.test(e.message));
    // (fails before: yes — the review of 10-29: a chat that chose an hour after its last turn read that turn's five
    // minutes' cache as an hour's, and went on into it cold without a word) The life of the cache the last turn left
    // is the one its writes had, as the provider split them; a lifetime chosen since is the next turn's.
    skew = 0;
    const chose = make();
    await say(chose.s, chose.id, "turn 1");
    ended(chose.id, { tokens: { input: 10, output: 5, cacheRead: 900, cacheWrite: 100, cacheWrite1h: 0 } });
    chose.s.patchSettings(chose.id, { patch: { model: { cacheTtl: "1h" } } });
    skew = 20 * 60_000;
    await assert.rejects(say(chose.s, chose.id, "turn 2"), (/** @type {any} */ e) => e.status === 409 && e.extra.resumeQuestion.cache.ttlMs === 300_000);
    await say(chose.s, chose.id, "turn 2", { sendAsIs: true });
    ended(chose.id, { tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 1000, cacheWrite1h: 1000 } });
    skew = 40 * 60_000;
    await say(chose.s, chose.id, "turn 3: within the hour its writes asked for");
  });

  // (fails before: yes — the refusal called every stop "past the compaction line", even the one taken BELOW the
  // line at thresholdPercent 100, where what ran out was the reply floor, not the line)
  test("the AUTO refusal names the true cause: a request under the line (100%) but without the reply floor is refused as the floor, not as the line", async () => {
    const pipe = fakePipeline({ resultText: () => "x", finalText: () => "y" });
    let window = 20000;
    const s = createSessions({ ...deps(pipe), config: { get: () => ({ ...config.get(), upstreams: [{ id: "u", type: "anthropic", pricing: { m: { input: 1, output: 1, contextTokens: window } } }], routes: [{ match: "*", upstream: "u", upstreamModel: "{model}", enabled: true }] }) } });
    const { id } = s.create({ cwd: folder, model: "agent/m", settings: { context: { compaction: { mode: "auto", thresholdPercent: 100 } } } });
    // The loop's prompt and tools ride every request, the loop being always on (the owner's of 11-09): the window grows
    // by them, so the history has the room it had when this test was written.
    const { fixed } = (await s.preview(id, {})).current;
    window += fixed;
    await s.turn(id, { content: "one" }, fakeReq(), new FakeRes());
    await assert.rejects(
      s.turn(id, { content: [{ type: "text", text: "z".repeat(67000) }] }, fakeReq(), new FakeRes()),
      (e) => e.status === 409 && e.extra?.needsCompaction === true
        && e.extra.sentTokens >= 18976 + fixed && e.extra.sentTokens < window && e.extra.usable === window
        && /leaving under the 1,024-token reply floor/.test(e.message)
        && !/past the [\d,]+-token compaction line/.test(e.message),
    );
    assert.equal(s.transcript(id).turns.length, 1, "nothing went out, nothing archived");
  });

  // (fails before: yes — Compact now summarised a transcript that left out the tool calls and their results)
  test("Compact now summarises turnTranscript's text: the tool calls and what they returned ride along (Step 4 D7)", async () => {
    const pipe = fakePipeline();
    const s = createSessions(deps(pipe));
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    await s.turn(id, { content: long("one") }, fakeReq(), new FakeRes());
    await s.turn(id, { content: long("two") }, fakeReq(), new FakeRes());
    const before = summaries.length;
    await s.compact(id);
    assert.equal(summaries.length, before + 1, "one summary call");
    const call = summaries.at(-1);
    assert.equal(call.system, COMPACTION_SYSTEM, "compaction's own brief");
    assert.ok(!("maxTokens" in call), "no cap of compaction's own: the call asks for all the model can write");
    assert.equal(call.model, "m", "the session's model, agent/ prefix off, when no compaction model is named");
    for (const line of ["## Turn 1", "User: one", 'Tool call read: {"path":"f1.txt"}', "Result: contents of file 1", "Assistant: Turn 1 done.", "## Turn 2"])
      assert.ok(call.user.includes(line), `the transcript carries "${line}"`);
  });

  // (fails before: yes — the head was the summary alone: the files its turns read had to be read again)
  test("Compact now brings back the files the summarized turns read, as they are on disk; the next request carries them after the summary (HarnessV3-AtHome AH-D9 b)", async () => {
    const pipe = fakePipeline();
    const s = createSessions(deps(pipe));
    const where = mkdtempSync(join(dir, "back-"));
    writeFileSync(join(where, "f1.txt"), "file one, on disk\n");
    writeFileSync(join(where, "f2.txt"), "file two, on disk\n");
    const { id } = s.create({ cwd: where, model: "agent/m" });
    await s.turn(id, { content: long("one") }, fakeReq(), new FakeRes());
    await s.turn(id, { content: long("two") }, fakeReq(), new FakeRes());
    const done = await s.compact(id);
    const back = done.compaction.detail?.attached;
    assert.deepEqual(back && [back.shown, back.named, back.plan], [2, 0, false], JSON.stringify(done.compaction.detail));
    await s.turn(id, { content: "three" }, fakeReq(), new FakeRes());
    const head = pipe.calls.at(-1).pre.body.messages[0];
    assert.match(head.content[0].text, /^\[Filament compacted turns 1–2 into the summary below\./);
    const block = String(head.content[1]?.text || "");
    assert.ok(block.includes('<file path="f2.txt">\n     1\tfile two, on disk\n</file>'), block);
    assert.ok(block.indexOf('"f2.txt"') < block.indexOf('"f1.txt"'), "the newest first");
  });

  // (fails before: no — written after loopRootOf; it holds the fence a mutant reading the refused folder would breach)
  test("a folder the loop would refuse brings no file back: outside agentLoop.roots, nothing is read from it (AH-D9 b)", async () => {
    const pipe = fakePipeline();
    const elsewhere = mkdtempSync(join(dir, "roots-"));
    /** @type {string[]} */
    let roots = [];
    const s = createSessions({ ...deps(pipe), config: { get: () => ({ ...config.get(), agentLoop: { ...config.get().agentLoop, roots } }) } });
    const where = mkdtempSync(join(dir, "refused-"));
    writeFileSync(join(where, "f1.txt"), "file one, on disk\n");
    // Made while no root was listed; the roots listed since leave its folder outside them.
    const { id } = s.create({ cwd: where, model: "agent/m" });
    roots = [elsewhere];
    await s.turn(id, { content: long("one") }, fakeReq(), new FakeRes());
    const done = await s.compact(id);
    const back = done.compaction.detail?.attached;
    assert.deepEqual([back?.shown, back?.named], [0, 0], JSON.stringify(done.compaction.detail));
    assert.ok(!textOfMessage(archive.getMessage(back.hash)?.message).includes("<file"), "the last reply comes back, no file");
  });

  // (fails before: yes — the page looked the window up in the model list; the settings answer carried none)
  test("the settings answer carries the window of the model in force, and it follows a model change (Step 4 D4)", () => {
    const pipe = fakePipeline();
    const cfg = () => ({ ...config.get(), upstreams: [{ id: "u", type: "anthropic", pricing: { m: { input: 1, output: 1, contextTokens: 40000 } } }], routes: [{ match: "*", upstream: "u", upstreamModel: "{model}", enabled: true }] });
    const s = createSessions({ ...deps(pipe), config: { get: cfg } });
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    // (HarnessV4_Tasks C33) `own`: the figure is on the model's own row of its upstream's table, so the page can change it or take it back.
    assert.deepEqual(s.settingsOf(id).window, { tokens: 40000, source: "operator", model: "m", sent: "m", settable: true, own: true }, "the loop's model inside the agent/ name, from its upstream's model card");
    const written = s.patchSettings(id, { patch: { model: { name: "agent/zz-unpriced" } } });
    assert.deepEqual(written.window, { tokens: null, source: null, model: "zz-unpriced", sent: "zz-unpriced", settable: true, own: false }, "a write answers with the new model's window — unknown here, said as unknown, and the page can say one");
  });

  // (fails before: yes — finding 16 of the re-read: the window answer named no name to add, and the Context card worked
  // one out by a rule of its own, which never asked what the card holds)
  test("the settings answer carries the name that runs a Claude Code model in 1M, only where its card does not hold it", () => {
    const pipe = fakePipeline();
    let typed = ["claude-fable-5-2"];
    const said = { contextTokens: 1_000_000 };
    const cfg = () => ({
      ...config.get(),
      upstreams: [
        { id: "cc", type: "acp", enabled: true, models: typed, pricing: { "claude-fable-5-2": said }, acp: { command: "claude-agent-acp" } },
        { id: "cur", type: "acp", enabled: true, models: ["grok-5"], pricing: { "grok-5": said }, acp: { command: "cursor-agent" } },
      ],
      routes: ["cc", "cur"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true })),
    });
    const s = createSessions({ ...deps(pipe), config: { get: cfg } });
    const { id } = s.create({ cwd: folder, model: "cc/claude-fable-5-2" });
    assert.deepEqual(s.settingsOf(id).window, { tokens: 1_000_000, source: "operator", model: "cc/claude-fable-5-2", sent: "claude-fable-5-2", settable: true, own: true, add: "claude-fable-5-2[1m]" }, "said 1M here, and Claude Code runs the plain id in its standard window: the name to add");
    typed = ["claude-fable-5-2", "claude-fable-5-2[1m]"];
    assert.deepEqual(s.settingsOf(id).window, { tokens: 1_000_000, source: "operator", model: "cc/claude-fable-5-2", sent: "claude-fable-5-2", settable: true, own: true }, "its card holds the [1m] name: nothing to add");
    const other = s.create({ cwd: folder, model: "cur/grok-5" });
    assert.equal("add" in s.settingsOf(other.id).window, false, "another agent's has no name of Claude's");
  });
});

describe("native sessions: the rows", () => {
  const pipe = fakePipeline();
  const sessions = createSessions(deps(pipe));
  const a = { memory, usage: { forChain: () => ({ records: [], capped: false }), publicRecord: (r) => r }, ops: { record() {} }, sessions };
  const route = createRouter(sessionRoutes(a));
  /** @param {string} method @param {string} path @param {any} [body] */
  const call = async (method, path, body = undefined) => {
    const url = new URL(`http://x${path}`);
    const m = route(method, url.pathname);
    assert.ok(m, `${method} ${path} has a row`);
    const res = new FakeRes();
    await m.handler({ req: fakeReq(), res, url, path: url.pathname, method, params: m.params, json: async () => body }, a);
    return res;
  };

  test("create → settings → turns → transcript → project settings, with their statuses", async () => {
    let r = await call("POST", "/sessions", { cwd: folder, model: "agent/m", title: "Rows" });
    assert.equal(r.status, 200);
    const { id } = r.json();
    r = await call("POST", "/sessions", { cwd: join(dir, "missing") });
    assert.equal(r.status, 400);
    r = await call("GET", `/sessions/${id}/settings`);
    assert.equal(r.status, 200);
    assert.equal(r.json().effective.context.results, "keep");
    assert.ok(!("presets" in r.json()), "there are no presets (the owner's of 11-07)");
    // Long enough that its summary leaves it smaller: a chat of a few words would grow by one, and is not compacted.
    r = await call("POST", `/sessions/${id}/turns`, { content: `turn 1: ${"a long question about the plan. ".repeat(100)}` });
    assert.equal(r.status, 200);
    assert.equal(r.json().type, "message");
    assert.ok(r.headers["x-filament-request-id"]);
    assert.ok(r.headers["x-filament-settings-hash"]);
    r = await call("POST", `/sessions/${id}/turns`, {});
    assert.equal(r.status, 400);
    r = await call("POST", `/sessions/nope/turns`, { content: "x" });
    assert.equal(r.status, 404);
    r = await call("PATCH", `/sessions/${id}/settings`, { patch: { context: { results: "pointer" } } });
    assert.equal(r.status, 200);
    assert.equal(r.json().changes.length, 1);
    r = await call("PATCH", `/sessions/${id}/settings`, { context: { results: "nope" } });
    assert.equal(r.status, 400);
    assert.match(r.json().error, /must be one of/);
    r = await call("PATCH", `/sessions/${id}/settings`, "not an object");
    assert.equal(r.status, 400);
    r = await call("GET", `/sessions/${id}/transcript?work=0&since=0`);
    assert.equal(r.status, 200);
    assert.equal(r.json().turns.length, 1);
    assert.equal(r.json().turns[0].workCount, 2);
    // (the owner's of 11-07: there are no presets) The row is gone; what Balanced chose, a chat chooses as its own.
    assert.equal(route("POST", `/sessions/${id}/settings/preset`), null);
    r = await call("PATCH", `/sessions/${id}/settings`, { patch: { context: { results: "status" } } });
    assert.equal(r.status, 200);
    const s = (await call("GET", `/sessions/${id}/settings`)).json();
    assert.equal(s.sources["context.results"], "session");
    const projectId = archive.getChain(id).project_id;
    r = await call("POST", `/projects/${projectId}/settings`, { patch: { context: { results: "status" } } });
    assert.equal(r.status, 400, "a mode knob is refused at the project layer (D3)");
    r = await call("POST", `/projects/${projectId}/settings`, { patch: { instructions: { files: ["AGENTS.md"] } } });
    assert.equal(r.status, 200);
    r = await call("POST", `/projects/none-such/settings`, { patch: {} });
    assert.equal(r.status, 404);
    r = await call("POST", `/sessions/${id}/compact`, {});
    assert.equal(r.status, 200);
    assert.equal(r.json().compaction.kind, "manual");
    const compactedId = r.json().compaction.id;
    r = await call("POST", `/sessions/${id}/compactions/${compactedId}/undo`, {});
    assert.equal(r.status, 200, "Undo through the row");
    assert.equal(r.json().undone.id, compactedId);
    r = await call("POST", `/sessions/${id}/compactions/${compactedId}/undo`, {});
    assert.equal(r.status, 409, "nothing left to undo");
    r = await call("POST", `/sessions/${id}/compact`, {});
    assert.equal(r.status, 200);
    // Always accept in this chat stays the chat's: its fork asks on its card again, and keeps the rest of its own
    // (the review of fe6b8d579).
    sessions.patchSettings(id, { patch: { subagents: { parallelize: true } } });
    r = await call("POST", `/sessions/${id}/fork`, { atTurn: 1 });
    assert.equal(r.status, 200);
    assert.ok(r.json().chainId);
    const forked = (await call("GET", `/sessions/${r.json().chainId}/settings`)).json();
    assert.deepEqual([forked.sources["subagents.parallelize"], forked.sources["context.results"]], ["default", "session"]);
    sessions.patchSettings(id, { unset: ["subagents.parallelize"] });
    r = await call("GET", `/sessions/zzzz/transcript`);
    assert.equal(r.status, 404);
    // Phase 3 rows: the dry preview and the history.
    r = await call("GET", `/sessions/${id}/compose?dry=1&form=plain,fold`);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json().forms), ["plain", "fold"]);
    assert.ok(Array.isArray(r.json().current.perTurn));
    r = await call("GET", `/sessions/${id}/compose?dry=0`);
    assert.equal(r.status, 400);
    r = await call("GET", `/sessions/${id}/compose?dry=1&prompt=1&text=${encodeURIComponent("the draft")}`);
    assert.equal(r.status, 200);
    assert.equal(r.json().current.prompt.messages.at(-1).content[0].text, "the draft", "the dry-run turn through the row");
    assert.equal(r.json().compaction, undefined, "the compaction plan only when asked");
    r = await call("GET", `/sessions/${id}/compose?dry=1&form=plain&compaction=1`);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json().compaction.methods), ["fold", "summary"], "the plan through the row (HarnessV3-Compaction §6)");
    r = await call("GET", `/sessions/${id}/settings/history?limit=5`);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json().entries));
    r = await call("GET", `/sessions/${id}/settings`);
    assert.ok(r.json().usage, "the settings row carries the spend ledger");
    assert.equal(r.json().budget, undefined, "and no budget standing: spend is tracked, never capped (Providers P3)");
    sessions.patchProjectSettings(projectId, { unset: ["instructions.files"] });
  });

  test("409 while a turn runs, through the row", async () => {
    const gate = deferred();
    const slow = createSessions(deps(fakePipeline({ gate })));
    const a2 = { ...a, sessions: slow };
    const route2 = createRouter(sessionRoutes(a2));
    const { id } = slow.create({ cwd: folder, model: "agent/m" });
    const run = (body) => {
      const m = route2("POST", `/sessions/${id}/turns`);
      const res = new FakeRes();
      const url = new URL(`http://x/sessions/${id}/turns`);
      return { res, done: m.handler({ req: fakeReq(), res, url, path: url.pathname, method: "POST", params: m.params, json: async () => body }, a2) };
    };
    const first = run({ content: "one" });
    await new Promise((r) => setImmediate(r));
    const second = run({ content: "two" });
    await second.done;
    assert.equal(second.res.status, 409);
    assert.match(second.res.json().error, /already running/);
    gate.resolve();
    await first.done;
    assert.equal(first.res.status, 200);
  });

  test("no archive (a failed open — memory off alone still records) → 503 on the native rows", async () => {
    const closed = { ...memory, archive: null, archiveWhy: () => "Memory has not started." };
    const a3 = { ...a, memory: closed, sessions: createSessions({ ...deps(pipe), memory: closed }) };
    const route3 = createRouter(sessionRoutes(a3));
    const m = route3("POST", "/sessions");
    const res = new FakeRes();
    await m.handler({ req: fakeReq(), res, url: new URL("http://x/sessions"), path: "/sessions", method: "POST", params: m.params, json: async () => ({ cwd: folder }) }, a3);
    assert.deepEqual([res.status, res.json().error], [503, "no archive: native sessions need it. Memory has not started."]);
  });
});

describe("Phase 2C: project settings and the draft", () => {
  const sessions = createSessions(deps(fakePipeline()));
  const a = { memory, usage: { forChain: () => ({ records: [], capped: false }), publicRecord: (r) => r }, ops: { record() {} }, sessions };
  const route = createRouter(sessionRoutes(a));
  const call = async (method, path, body = undefined) => {
    const url = new URL(`http://x${path}`);
    const m = route(method, url.pathname);
    assert.ok(m, `${method} ${path} has a row`);
    const res = new FakeRes();
    await m.handler({ req: fakeReq(), res, url, path: url.pathname, method, params: m.params, json: async () => body }, a);
    return res;
  };

  test("the override layer is gone (D12): the row 404s and display writes go through the settings route unaudited", async () => {
    const r0 = await call("POST", "/sessions", { cwd: folder, model: "agent/m" });
    const id = r0.json().id;
    const gone = route("POST", `/sessions/${id}/override`);
    assert.ok(!gone, "POST /sessions/:id/override has no row");
    for (const [m, p] of [["DELETE", "/sessions/presets/x"], ["GET", "/presets"], ["POST", "/presets/default"], ["PUT", `/projects/x/default-preset`], ["POST", `/sessions/${id}/settings/save-preset`]])
      assert.ok(!route(m, p), `${m} ${p}: the presets' rows are gone (the owner's of 11-07)`);
    const opsBefore = ops.filter((o) => o.sub === "session-settings").length;
    const r = await call("PATCH", `/sessions/${id}/settings`, { patch: { display: { pinned: true, title: "Renamed by hand" } } });
    assert.equal(r.status, 200);
    const ch = archive.getChain(id);
    assert.equal(ch.meta.pinned, true, "the pin lands on the chain's meta through the mirror");
    assert.equal(ch.title, "Renamed by hand");
    assert.equal(ops.filter((o) => o.sub === "session-settings").length, opsBefore, "display knobs are not audited (D7)");
  });

  test("a project's settings row: the repo knobs only, its layer resolved", async () => {
    const p = archive.ensureProject(join(dir, "p-set"));
    archive.setProjectSettings(p.id, { instructions: { files: ["AGENTS.md"] } });
    const r = await call("GET", `/projects/${p.id}/settings`);
    assert.equal(r.status, 200);
    const doc = r.json();
    assert.equal(doc.projectId, p.id);
    assert.equal(doc.layer.instructions.files[0], "AGENTS.md");
    assert.ok(doc.resolved.sources["instructions.files"] === "project");
    assert.ok(Object.keys(doc.knobs).every((k) => !k.startsWith("context.results")), "mode knobs are not in a project's catalogue");
    assert.ok(doc.knobs["instructions.files"], "repo knobs are");
    assert.equal("defaultPreset" in doc, false);
    const missing = await call("GET", "/projects/nope/settings");
    assert.equal(missing.status, 404);
  });

  test("draft-start answers with exactly what create then writes (one function), and writes nothing", async () => {
    const draftFolder = join(dir, "p-draft");
    mkdirSync(draftFolder);
    const p = archive.ensureProject(draftFolder);
    const before = archive.listChains({ limit: 1000, archived: "all" }).length;
    let r = await call("POST", "/sessions/draft-start", { cwd: p.cwd, settings: { memory: { enabled: false } } });
    assert.equal(r.status, 200, r.body);
    const draft = r.json();
    assert.equal("preset" in draft, false, "a new chat starts from your defaults");
    assert.equal(draft.flat["memory.enabled"], false);
    assert.equal(draft.sources["memory.enabled"], "session");
    assert.equal(archive.listChains({ limit: 1000, archived: "all" }).length, before, "a draft writes nothing");
    const created = sessions.create({ cwd: p.cwd, settings: { memory: { enabled: false } } });
    const s = sessions.settingsOf(created.id);
    assert.deepEqual(s.flat["memory.enabled"], draft.flat["memory.enabled"], "create writes what the draft answered");
    assert.deepEqual(s.sources["memory.enabled"], draft.sources["memory.enabled"]);
    r = await call("POST", "/sessions/draft-start", { cwd: p.cwd, preset: "review" });
    assert.equal(r.status, 400, "a preset named is refused, as create refuses it");
    r = await call("POST", "/sessions/draft-start", { cwd: join(dir, "no-such-folder") });
    assert.equal(r.status, 400);
  });

  test("Phase 2D: the first send's body — the board's changes, and the permission rule (D15)", async () => {
    const folder = join(dir, "p-start");
    mkdirSync(folder);
    // The board's changes ride in one create; nothing else is sent (an untouched picker sends no mode).
    let r = await call("POST", "/sessions", { cwd: folder, model: "agent/m", title: "Start", settings: { context: { view: { stubChars: 200 } } } });
    assert.equal(r.status, 200, r.body);
    let s = sessions.settingsOf(r.json().id);
    assert.equal(s.effective.context?.view?.stubChars, 200, "the held change landed");
    assert.equal(s.sources["loop.permissions"] === "session", false, "no mode of its own: New chats start in holds");
    // A changed picker sends exactly that.
    r = await call("POST", "/sessions", { cwd: folder, model: "agent/m", settings: { loop: { permissions: "read-only" } } });
    s = sessions.settingsOf(r.json().id);
    assert.equal(s.effective.loop?.permissions, "read-only");
  });
});

describe("a coding agent's session at the turn start (HarnessV3-ACP AC5-3)", () => {
  // The resume question reads the session service's clock against the archive's, which stamps the real time: the
  // service's runs `skew` ahead, so the newest turn ended that long ago.
  let skew = 0;
  const idle = (/** @type {number} */ ms) => { skew = ms; };
  const agentConfig = {
    get: () => ({
      ...config.get(),
      upstreams: [{ id: "ag", type: "acp", acp: { command: "agent" } }, { id: "api", type: "anthropic", baseUrl: "http://127.0.0.1:9" }],
      routes: [{ match: "ag/*", upstream: "ag", upstreamModel: "{1}" }, { match: "w-1", upstream: "api" }],
    }),
  };
  /**
   * A session on the agent, its turns answered by `pipe`. It makes room by itself at the line (Automatic) unless a
   * test says otherwise: asking first is the default (HarnessV4_Tasks C26).
   * @param {any} pipe @param {any} [settings]
   */
  const open = (pipe, settings = {}) => {
    const s = createSessions({ ...deps(pipe), config: agentConfig, now: () => Date.now() + skew });
    const withMode = { ...settings, context: { ...settings.context, compaction: { mode: "auto", ...settings.context?.compaction } } };
    const { id } = s.create({ cwd: folder, model: "ag/sonnet", settings: withMode });
    return { s, id };
  };
  /** What the agent said its context holds as the newest turn ended, as its record leaves it (AC3-5). */
  const holds = (/** @type {string} */ id, /** @type {number} */ held, upstream = "ag") => {
    const t = archive.turnBodies(id).at(-1);
    archive.mergeTurnMeta(t.turnId, { facts: { upstream, agentSession: true, context: { held, window: 200000, usable: null, verdict: null, source: "agent" } } });
  };
  const say = (/** @type {any} */ s, /** @type {string} */ id, /** @type {string} */ content, extra = {}) => s.turn(id, { content, ...extra }, fakeReq(), new FakeRes());

  test("the line is the agent's: past it, Automatic makes room by Ours, weighed by what the agent holds, and this turn starts the fresh agent session; under it nothing runs, whatever the composition weighs", async () => {
    const pipe = fakePipeline({ resultText: (n) => (n === 1 ? `contents ${"x".repeat(100000)}` : `contents of file ${n}`) });
    // Whole: the copy carries what the tools read, so it is past its own line while the agent is under the agent's.
    const { s, id } = open(pipe, { context: { carry: "plain", compaction: { model: "w-1", thresholdPercent: 10 } } });
    await say(s, id, "turn 1");
    holds(id, 15_000);
    const under = await say(s, id, "turn 2");
    assert.equal(under.report.overLine, true, "the composition is past its own line");
    assert.deepEqual(under.report.compactions, [], "the agent's 15,000 is under its 20,000-token line: nothing runs");
    holds(id, 30_000);
    const asked = summaries.length;
    const past = await say(s, id, "turn 3");
    assert.deepEqual(past.report.compactions.map((c) => [c.method, c.fromTurn, c.toTurn]), [["summary", 1, 2]]);
    assert.equal(summaries.length, asked + 1, "the summary was written by the model named");
    const row = archive.getCompactions(id).at(-1);
    assert.equal(row.detail.before, 30_000, "weighed by what the agent holds");
    assert.ok(past.report.notes.includes("agent: the agent's context holds 30,000 of its 200,000-token window, past the 20,000-token compaction line — suggested: the agent cannot write the summary, so Filament makes room on its copy; this turn starts a fresh agent session from the compaction"), past.report.notes.join("\n"));
    assert.equal(pipe.calls.at(-1).pre.headers["x-filament-compaction"], String(row.id), "the request names it: the bridge starts the fresh session");
    // The turn after it: the agent said nothing of the fresh session yet — nothing to judge, nothing runs.
    assert.deepEqual((await say(s, id, "turn 4")).report.compactions, []);
  });

  /** Once no compaction is being written: a copy's summary is written in the background, after its turn. @param {any} s */
  const settled = async (s) => {
    while (s.compactionsNow().length) await new Promise((r) => setImmediate(r));
  };

  // (fails before: yes — a copy past its own line stayed there: nothing summarized it until a fresh start asked)
  test("the copy past its line: once the turn has ended Filament summarizes it for the copy alone, all but the newest turn; no session moves, and the one that goes on is told its place", async () => {
    const pipe = fakePipeline({ resultText: (n) => (n === 1 ? `contents ${"x".repeat(100000)}` : `contents of file ${n}`) });
    const { s, id } = open(pipe, { context: { carry: "plain", compaction: { model: "w-1", thresholdPercent: 10 } } });
    await say(s, id, "turn 1");
    holds(id, 15_000);
    await settled(s);
    assert.equal(archive.getCompactions(id).length, 0, "one finished turn: it stays as it was said");
    const asked = summaries.length;
    const two = await say(s, id, "turn 2");
    assert.equal(two.report.overLine, true, "the copy is past its line; the agent, at 15,000, is not past its own");
    assert.deepEqual(two.report.compactions, [], "nothing was compacted at the send");
    assert.deepEqual(s.compactionsNow().map((/** @type {any} */ c) => [c.chainId, c.progress.door, c.progress.stoppable, c.progress.step]), [[id, "copy", true, "Filament's copy: w-1 writes the summary in one call"]]);
    await settled(s);
    const [row, ...more] = archive.getCompactions(id);
    assert.deepEqual(more, []);
    assert.deepEqual([row.from_turn, row.to_turn, row.method, row.kind, row.detail.copy, row.detail.model], [1, 1, "summary", "plain", "line", "w-1"]);
    assert.equal(summaries.length, asked + 1, "one call, on the compaction model");
    assert.ok(/## Turn 1\nUser: turn 1/.test(String(summaries.at(-1).user)) && !String(summaries.at(-1).user).includes("x".repeat(200)), "read as the turn's fold: no tool output");
    assert.ok(ops.some((o) => o.kind === "compaction" && o.sub === "copy" && o.detail?.chainId === id && o.detail?.trigger === "line"));
    // What the agent holds is its own turn's count, and the row is no compaction to take back.
    holds(id, 16_000);
    const pv = await s.preview(id, { compaction: true });
    assert.deepEqual(pv.compactions.map((/** @type {any} */ c) => [c.method, c.undoable, c.detail.copy]), [["summary", false, "line"]]);
    assert.deepEqual([pv.current.compactedSince, pv.compaction.agent.held], [false, 16_000]);
    await assert.rejects(s.undoCompaction(id, row.id), (e) => e.status === 409);
    // The next turn: the same compaction for the bridge (none), and the session's place in the copy.
    const three = await say(s, id, "turn 3");
    const h = pipe.calls.at(-1).pre.headers;
    assert.deepEqual([h["x-filament-compaction"], h["x-filament-seen"]], ["0", `${row.id}:2`]);
    assert.deepEqual([three.report.compactions, three.report.overLine, three.report.head?.toTurn], [[], false, 1]);
    await settled(s);
    assert.equal(archive.getCompactions(id).length, 1, "under its line now: nothing more is written");
  });

  // (fails before: yes — there was no such summary to stop or to give way)
  test("the copy's summary gives way and can be stopped: a compaction asked for meanwhile takes its place; stopped from its row, it is not tried again; switched off, never started", async () => {
    const real = memory.callModel;
    /** @type {((text: string) => void)[]} */
    const waiting = [];
    // A writer that answers when let, and ends with its call's stop.
    memory.callModel = (/** @type {any} */ a) => new Promise((done, fail) => {
      summaries.push(a);
      waiting.push(done);
      a.signal?.addEventListener("abort", () => fail(new Error("aborted")));
    });
    try {
      const big = () => fakePipeline({ resultText: (n) => (n === 1 ? `contents ${"x".repeat(100000)}` : `contents of file ${n}`) });
      const settings = { context: { carry: "plain", compaction: { model: "w-1", thresholdPercent: 10 } } };
      // Compact now while it writes: the person's compaction is the one written.
      const a = open(big(), settings);
      await say(a.s, a.id, "turn 1");
      holds(a.id, 15_000);
      await say(a.s, a.id, "turn 2");
      holds(a.id, 15_000);
      assert.equal(a.s.compactionsNow()[0]?.progress.door, "copy");
      const asked = a.s.compact(a.id, { method: "summary" });
      await until(() => waiting.length >= 2, "the person's summary to be asked for");
      waiting.at(-1)?.("THEIR SUMMARY");
      const made = await asked;
      await settled(a.s);
      assert.deepEqual(archive.getCompactions(a.id).map((/** @type {any} */ r) => [r.id === made.compaction.id, r.from_turn, r.to_turn, r.kind, r.detail.copy]), [[true, 1, 2, "manual", undefined]]);
      // Stopped from its row: nothing written, and the line does not ask again while the copy stands there.
      const b = open(big(), settings);
      await say(b.s, b.id, "turn 1");
      holds(b.id, 15_000);
      await say(b.s, b.id, "turn 2");
      holds(b.id, 15_000);
      assert.deepEqual(b.s.stopCompaction(b.id), { ok: true, copy: true });
      await settled(b.s);
      assert.equal(archive.getCompactions(b.id).length, 0);
      assert.equal(archive.getChain(b.id).meta.copyHeld, 1, "the last turn the stopped summary would have taken");
      const calls = summaries.length;
      await say(b.s, b.id, "turn 3");
      assert.deepEqual([b.s.compactionsNow().length, summaries.length], [0, calls], "not tried again");
      assert.throws(() => b.s.stopCompaction(b.id), (e) => e.status === 409 && /no compaction is being written/.test(e.message));
      // The session that keeps every turn: never started.
      const c = open(big(), { context: { ...settings.context, compaction: { ...settings.context.compaction, follow: false } } });
      await say(c.s, c.id, "turn 1");
      holds(c.id, 15_000);
      assert.equal((await say(c.s, c.id, "turn 2")).report.overLine, true);
      assert.deepEqual([c.s.compactionsNow().length, summaries.length], [0, calls]);
    } finally {
      memory.callModel = real;
    }
  });

  test("no model to write with: Ours folds, which calls none; a failed compaction never stops the agent's turn", async () => {
    const pipe = fakePipeline();
    const { s, id } = open(pipe, { context: { compaction: { thresholdPercent: 10 } } });
    for (const n of [1, 2]) await say(s, id, `turn ${n}`);
    holds(id, 30_000);
    const asked = summaries.length;
    const folded = await say(s, id, "turn 3");
    assert.deepEqual(folded.report.compactions.map((c) => c.method), ["fold"]);
    assert.equal(summaries.length, asked, "no model was called");
    assert.ok(folded.report.notes.some((x) => /^compaction: turn 1 folded at the compaction line \(One summary: no model to write with, and folding calls none\) — ≈30,000 → ≈/.test(x)), folded.report.notes.join("\n"));

    // (fails before: no — a guard: the copy's own summary is started only where a model can write it)
    const big = open(fakePipeline({ resultText: (n) => (n === 1 ? `contents ${"x".repeat(100000)}` : `contents of file ${n}`) }), { context: { carry: "plain", compaction: { thresholdPercent: 10 } } });
    await say(big.s, big.id, "turn 1");
    holds(big.id, 15_000);
    assert.equal((await say(big.s, big.id, "turn 2")).report.overLine, true, "the copy is past its line");
    assert.deepEqual([big.s.compactionsNow().length, summaries.length, archive.getCompactions(big.id).length], [0, asked, 0], "no model: nothing is started for the copy");

    const failing = open(fakePipeline(), { context: { compaction: { model: "w-1", thresholdPercent: 10 } } });
    const realCall = memory.callModel;
    memory.callModel = async () => { throw new Error("the model is down"); };
    try {
      await say(failing.s, failing.id, "turn 1");
      for (const n of [2, 3, 4]) {
        holds(failing.id, 30_000);
        const out = await say(failing.s, failing.id, `turn ${n}`);
        assert.deepEqual(out.report.compactions, []);
        assert.ok(out.report.notes.includes("compaction skipped: the compaction model (w-1) failed: the model is down — the agent goes on as it is, and compacts by itself at its own line"), out.report.notes.join("\n"));
      }
      assert.equal(archive.getChain(failing.id).meta.compactionFailures, undefined, "never counted toward the third-time refusal");
    } finally {
      memory.callModel = realCall;
    }
  });

  // (fails before: yes — Compact now on an agent's session with no model to write a summary was refused, where the line
  // folds)
  test("Compact now with no model to write with: an agent's session folds, as at its line; a method named for this once is refused in its words", async () => {
    // (fails before: no — HarnessV4_Tasks C28, a guard: under Words, the default, the copy is each turn's words already;
    // a fold frees nothing, so only a summary makes room, and with no model to write one the refusal says so)
    const words = open(fakePipeline());
    for (const n of [1, 2]) await say(words.s, words.id, `turn ${n}`);
    await assert.rejects(words.s.compact(words.id, {}), (/** @type {any} */ e) => {
      assert.deepEqual([e.status, e.message], [400, "summary: no model to summarize with: name one in context.compaction.model (a coding agent's model writes it too, in a session of its own), or set memory's model (Settings › Memory › Model)"]);
      return true;
    });
    const { s, id } = open(fakePipeline(), { context: { carry: "plain" } });
    for (const n of [1, 2]) await say(s, id, `turn ${n}`);
    const asked = summaries.length;
    await assert.rejects(s.compact(id, { method: "summary" }), (/** @type {any} */ e) => {
      assert.deepEqual([e.status, e.message], [400, "summary: no model to summarize with: name one in context.compaction.model (a coding agent's model writes it too, in a session of its own), or set memory's model (Settings › Memory › Model) — Instant fold, newest 1 whole makes room with no model call"], "the way that needs no model, named where it frees room");
      return true;
    });
    const folded = await s.compact(id, {});
    assert.equal(folded.compaction.method, "fold");
    assert.equal(summaries.length, asked, "no model was called");
    assert.match(folded.note, /^compaction: turn 1 folded on request \(One summary: no model to write with, and folding calls none\)/, folded.note);
    // (fails before: yes — HarnessV4_Tasks C33: a compaction model that reached a coding agent was refused in words)
    // An API model's session that names a coding agent's model as its writer: that model is called, as any writer is.
    const api = s.create({ cwd: folder, model: "w-1", settings: { context: { compaction: { model: "ag/haiku" } } } }).id;
    for (const n of [1, 2]) await say(s, api, long(`turn ${n}`));
    const byAgent = await s.compact(api, {});
    assert.deepEqual([byAgent.compaction.method, summaries.length, summaries.at(-1).model], ["summary", asked + 1, "ag/haiku"]);
    assert.match(byAgent.note, /ag\/haiku/, "the note names its writer");
  });

  test("under ask, past the agent's line the turn stops with Compact and send, in the agent's figures", async () => {
    const { s, id } = open(fakePipeline(), { context: { compaction: { mode: "ask" } } });
    await say(s, id, "turn 1");
    holds(id, 180_000);
    await assert.rejects(say(s, id, "turn 2"), (/** @type {any} */ e) => {
      assert.equal(e.status, 409);
      assert.equal(e.message, "the agent's context holds 180,000 of its 200,000-token window, past the 170,000-token compaction line — choose how to make room and send again (Compact and send), or set context.compaction.mode to auto");
      assert.deepEqual({ ...e.extra, cache: e.extra.cache.state }, { needsCompaction: true, why: "the agent's context holds 180,000 of its 200,000-token window, past the 170,000-token compaction line", sentTokens: 180_000, usable: 170_000, window: 200_000, estimated: false, reads: { kind: "agent", name: "ag", from: "session" }, cache: "warm" });
      return true;
    });
    assert.equal(archive.turnBodies(id).length, 1, "nothing was sent");
    holds(id, 160_000);
    await say(s, id, "turn 2");
  });

  // (fails before: yes — the owner's of 11-12: a chat on Claude Code whose last request an older Filament had booked,
  // with no lifetime, read "Cache 100%" hours later, where the cold question would have asked: the settings named no
  // bound for the Cache instrument to go cold by)
  test("the chat's cache setting names the longest a coding agent's cache is kept — the cold question's own hour — and none for a model Filament calls", () => {
    const { s, id } = open(fakePipeline());
    assert.deepEqual(s.settingsOf(id).cache, { ttl: "5m", from: "rules", settable: false, atMost: 3_600_000 });
    const api = s.create({ cwd: folder, model: "w-1" }).id;
    assert.equal("atMost" in s.settingsOf(api).cache, false, "its cache's life is its markers', or its provider's own");
  });

  // (fails before: yes — HarnessV4_Tasks C26: the question waited 70 idle minutes and 100,000 tokens held)
  test("the cold question: a session an hour idle asks first, whatever its agent holds; Send as it is goes on once, Don't ask again for the session", async () => {
    idle(0);
    const { s, id } = open(fakePipeline());
    await say(s, id, "turn 1");
    holds(id, 5_000);
    idle(61 * 60_000);
    await assert.rejects(say(s, id, "turn 2"), (/** @type {any} */ e) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /^This session has been idle 1 h 1 m, and ag holds 5,000 tokens of its 200,000-token window: a coding agent's cache lasts 1 h at the most, so going on pays for all of it again at the full price\. Send it as it is, or make room first\?$/);
      const q = e.extra.resumeQuestion;
      assert.deepEqual([q.why, q.held, q.estimated, q.window, q.usable, q.idleMs >= 61 * 60_000, q.reads, q.cache.state, q.cache.ttlMs, q.cache.seen], ["cold", 5_000, false, 200_000, 170_000, true, { kind: "agent", name: "ag", from: "session" }, "cold", 3_600_000, false]);
      return true;
    });
    assert.equal(archive.turnBodies(id).length, 1, "nothing was sent");
    await say(s, id, "turn 2", { sendAsIs: true });
    holds(id, 5_000);
    await assert.rejects(say(s, id, "turn 3"), (/** @type {any} */ e) => e.status === 409 && !!e.extra.resumeQuestion, "Send as it is answers once");
    await say(s, id, "turn 3", { settingsPatch: { context: { compaction: { resumeQuestion: false } } } });
    holds(id, 5_000);
    await say(s, id, "turn 4");
    assert.equal(s.settingsOf(id).sources["context.compaction.resumeQuestion"], "session", "Don't ask again is the session's setting");
  });

  test("the cold question asks only once the cache is cold for sure, on the session's own agent, with no compaction since — never of a command Filament answers, nor of an answer to a waiting turn", async () => {
    idle(0);
    const { s, id } = open(fakePipeline());
    await say(s, id, "turn 1");
    holds(id, 150_000);
    idle(59 * 60_000);
    await say(s, id, "idle under the hour");
    holds(id, 150_000, "another");
    idle(61 * 60_000);
    // The switch's own question answered with a form (HarnessV4_Tasks A7): the cold question is still not asked.
    await say(s, id, "another engine answered last", { carry: "words" });
    holds(id, 150_000);
    await say(s, id, "/status");
    // A question parked by a turn of Filament's loop is answered by the loop's turn alone (the decision of 11-02): the
    // person's message to the agent answers none of it, and is asked as any message is.
    // (fails before: yes — the message to the agent counted as the loop's answer and went without the cold question)
    holds(id, 150_000);
    archive.mergeMeta(id, { paused: { kind: "ask" } });
    await assert.rejects(say(s, id, "words for the agent"), (/** @type {any} */ e) => e.status === 409 && !!e.extra.resumeQuestion);
    archive.mergeMeta(id, { paused: undefined });
    holds(id, 150_000);
    idle(0);
    assert.equal((await s.compact(id, { method: "fold" })).ok, true);
    idle(61 * 60_000);
    await say(s, id, "compacted since: this turn starts a fresh agent session");
    // (fails before: yes — C26: a session whose agent named no count was never asked)
    idle(0);
    const quiet = open(fakePipeline());
    await say(quiet.s, quiet.id, "turn 1");
    archive.mergeTurnMeta(archive.turnBodies(quiet.id).at(-1).turnId, { facts: { upstream: "ag" } });
    idle(61 * 60_000);
    await assert.rejects(say(quiet.s, quiet.id, "turn 2"), (/** @type {any} */ e) => e.status === 409 && e.extra.resumeQuestion.held === null && /^This session has been idle 1 h 1 m, and ag has not said how much it holds: /.test(e.message));
  });

  // A coding agent's turn answers no question of the loop's (the decision of 11-02): an answer to the loop's question or
  // the permission switch sent while the chat's model is a coding agent is words for the agent — asked what any message
  // is asked, sent with no header only the loop reads, and the question left unanswered.
  // (fails before: yes — each counted as the loop's answer: no cold question was asked, and the switch's header went to
  // the agent)
  test("an answer to the loop's question or the permission switch sent to a coding agent is plain words: the loop's question is left unanswered", async () => {
    idle(0);
    const pipe = fakePipeline();
    const { s, id } = open(pipe);
    await say(s, id, "turn 1");
    holds(id, 5_000);
    idle(61 * 60_000);
    const asked = archive.turnBodies(id).at(-1);
    const park = (/** @type {string} */ kind) => archive.mergeMeta(id, { paused: { kind, requestId: asked.requestIds[0] } });
    park("ask");
    await assert.rejects(say(s, id, "The first one."), (/** @type {any} */ e) => e.status === 409 && !!e.extra.resumeQuestion, "asked as any message is");
    park("permission");
    await assert.rejects(say(s, id, "Switched to Edit automatically", { modeSwitch: true }), (/** @type {any} */ e) => e.status === 409 && !!e.extra.resumeQuestion, "asked as any message is");
    // Sent as it is: the words go to the agent with no header of the loop's, and the question is left unanswered.
    await say(s, id, "Switched to Edit automatically", { modeSwitch: true, sendAsIs: true });
    assert.equal(pipe.calls.at(-1).pre.headers["x-filament-mode-switch"], undefined);
    assert.equal(archive.metaOf(id, ["paused"])?.paused, undefined, "its park ended");
    assert.equal(archive.turnBodies(id).find((/** @type {any} */ t) => t.n === asked.n)?.meta?.unanswered?.by, "ag", "the turn that asked says it was left unanswered");
    holds(id, 5_000);
    idle(61 * 60_000);
    park("ask");
    await say(s, id, "The first one.", { sendAsIs: true });
    assert.equal(archive.metaOf(id, ["paused"])?.paused, undefined, "its park ended");
  });

  // (fails before: yes — HarnessV4_Tasks C26: a turn Filament itself sends was asked the cold question, and how to
  // make room, with nobody at the page to answer)
  test("a coding agent's turn nobody is at the page for: no cold question, and past the agent's line it makes room by the session's way", async () => {
    idle(0);
    const { s, id } = open(fakePipeline(), { context: { compaction: { mode: "ask", model: "w-1" } } });
    await say(s, id, "turn 1");
    holds(id, 5_000);
    idle(61 * 60_000);
    await assert.rejects(say(s, id, "a person's message"), (/** @type {any} */ e) => e.status === 409 && e.extra.resumeQuestion?.why === "cold");
    await say(s, id, "turn 2", { unattended: true });
    idle(0);
    holds(id, 180_000);
    await assert.rejects(say(s, id, "a person's message"), (/** @type {any} */ e) => e.status === 409 && e.extra.needsCompaction === true);
    const made = await say(s, id, "turn 3", { unattended: true });
    assert.deepEqual(made.report.compactions.map((c) => [c.fromTurn, c.toTurn]), [[1, 2]], made.report.notes.join("\n"));
    assert.equal(archive.getCompactions(id).at(-1).detail.before, 180_000, "weighed by what the agent holds");
  });

  // (fails before: yes — HarnessV4_Tasks C26: a chat whose agent session was gone was weighed by what the agent last
  // said it held, and its fresh start from Filament's copy went out unasked)
  test("a session the agent's bridge no longer keeps: the message asks first and says a new one starts from Filament's copy; past the line it asks for room, or makes it under Automatic", async () => {
    idle(0);
    /** The bridge keeps no session of any chat. @param {any} pipe */
    const gone = (pipe) => createSessions({ ...deps(pipe), config: agentConfig, agentSelf: /** @type {any} */ ({ holds: () => false, how: () => null, compacts: () => null }), now: () => Date.now() + skew });
    const s = gone(fakePipeline());
    const { id } = s.create({ cwd: folder, model: "ag/sonnet" });
    await say(s, id, "turn 1");
    holds(id, 150_000);
    await assert.rejects(say(s, id, "turn 2"), (/** @type {any} */ e) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /^ag keeps no session of this chat any more, so this message starts a new one from Filament's copy of the chat as Whole \(every finished turn as it was sent, tool output as text\), which weighs ≈[\d,]+ tokens of its 200,000-token window: nothing of it is cached, so all of it is paid for at the full price\. Send it as it is, or make room first\?$/);
      const q = e.extra.resumeQuestion;
      assert.deepEqual([q.why, q.estimated, q.window, q.usable, q.reads, q.cache, q.carry], ["lost", true, 200_000, 170_000, { kind: "agent", name: "ag", from: "copy" }, null, "plain"]);
      assert.ok(q.held > 0 && q.held < 150_000, `the copy's weight, not what the lost session held: ${q.held}`);
      return true;
    });
    const went = await say(s, id, "turn 2", { sendAsIs: true });
    assert.ok(went.report.notes.includes("agent: ag keeps no session of this chat any more, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as Whole (a lost session keeps the agent and its model, so the turns go whole)"), went.report.notes.join("\n"));
    // Past the composition's line: the seed is what the agent will hold, so the message asks for room — after the lost
    // session's question, which names the form and offers the others (the hunt of carry-card: past the line it was
    // skipped, and the size card named no form and offered none).
    const big = gone(fakePipeline({ resultText: () => `contents ${"x".repeat(100000)}` }));
    const b = big.create({ cwd: folder, model: "ag/sonnet", settings: { context: { carry: "plain", compaction: { model: "w-1", thresholdPercent: 10 } } } }).id;
    await say(big, b, "turn 1");
    holds(b, 5_000);
    await assert.rejects(say(big, b, "turn 2"), (/** @type {any} */ e) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /^ag keeps no session of this chat any more, so this message starts a new one from Filament's copy of the chat as Whole \(every finished turn as it was sent, tool output as text\), which weighs ≈[\d,]+ tokens of its 200,000-token window, past its 20,000-token line: nothing of it is cached/);
      const q = e.extra.resumeQuestion;
      assert.deepEqual([q.why, q.carry, q.usable], ["lost", "plain", 20_000]);
      assert.ok(q.held > q.usable, `past the line: ${q.held}`);
      return true;
    });
    await assert.rejects(say(big, b, "turn 2", { sendAsIs: true }), (/** @type {any} */ e) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /^ag keeps no session of this chat any more, so this turn starts a fresh agent session from Filament's copy of the chat, which weighs ≈[\d,]+ of the agent's 200,000-token window, past the 20,000-token compaction line — choose how to make room and send again \(Compact and send\), or set context\.compaction\.mode to auto$/);
      assert.deepEqual([e.extra.needsCompaction, e.extra.reads.from, e.extra.estimated], [true, "copy", true]);
      // (fails before: yes — the review of 8bcb358fc) The form its fresh session was weighed in goes back with the
      // question, so Compact and send carries it once room is made.
      assert.equal(e.extra.carry, "plain");
      return true;
    });
    big.patchSettings(b, { patch: { context: { compaction: { mode: "auto" } } } });
    const made = await say(big, b, "turn 2", { sendAsIs: true });
    assert.deepEqual(made.report.compactions.map((c) => c.method), ["summary"]);
    assert.ok(made.report.notes.includes("agent: ag keeps no session of this chat any more, so this turn starts a fresh agent session from the composition — it was past the line, so Filament made room on its copy first"), made.report.notes.join("\n"));
    // (fails before: yes — a turn stopped before the agent's session was up read as a session the agent had held:
    // the next message was asked about a lost one) No session was ever up: none is lost, and the message goes out,
    // its fresh session seeded from the copy.
    const never = gone(fakePipeline());
    const n = never.create({ cwd: folder, model: "ag/sonnet" }).id;
    await say(never, n, "turn 1");
    archive.mergeTurnMeta(archive.turnBodies(n).at(-1).turnId, { facts: { upstream: "ag", agentSession: false, stopReason: "cancelled", context: { held: 11, window: null, usable: null, verdict: null, source: null, estimated: true } } });
    const out = await say(never, n, "turn 2");
    assert.ok(out.report.notes.includes("agent: ag has no session of this chat yet, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as Words (context.carry)"), out.report.notes.join("\n"));
  });

  // (fails before: yes — a turn of the agent's that carried a team's stamp was read as the other engine's: its calls
  // went through the adapter as made with the loop lead's tools, which the agent never had)
  test("a turn the agent answered as its team's lead rides its fresh session as it ran: its stamp makes it no other engine's turn", async () => {
    idle(0);
    const s = createSessions({ ...deps(fakePipeline()), config: agentConfig, agentSelf: /** @type {any} */ ({ holds: () => false, how: () => null, compacts: () => null }), now: () => Date.now() + skew });
    const { id } = s.create({ cwd: folder, model: "ag/sonnet", settings: { context: { carry: "plain", compaction: { mode: "auto" } } } });
    await say(s, id, "turn 1");
    archive.mergeTurnMeta(archive.turnBodies(id).at(-1).turnId, {
      engine: { kind: "team", team: "builders", name: "Builders" },
      facts: { upstream: "ag", agentSession: false, stopReason: "cancelled", context: { held: 11, window: null, usable: null, verdict: null, source: null, estimated: true } },
    });
    const out = await say(s, id, "turn 2");
    assert.deepEqual(out.report.turns.map((/** @type {any} */ t) => [t.n, t.adapted ?? null]), [[1, null]], "as stored: never through the adapter");
  });

  // (fails before: yes — the owner's of 11-06: a chat moved to another folder started its agent's fresh session there
  // from the Words form, each turn's calls one counted line, so five sub-agents' reports never reached it)
  test("a chat moved to another folder: the agent's fresh session there is handed the turns whole, tool results and all; a form the session chose, or the card's answer, still stands", async () => {
    idle(0);
    /** @param {any} pipe @param {any} [more] */
    const gone = (pipe, more = {}) => createSessions({ ...deps(pipe), config: agentConfig, agentSelf: /** @type {any} */ ({ holds: () => false, how: () => null, compacts: () => null }), now: () => Date.now() + skew, ...more });
    /** A chat on the agent whose turns read a sub-agent's report, then moved to fix-login. @param {any} [settings] @param {number} [turns] @param {any} [more] */
    const moved = async (settings = {}, turns = 1, more = {}, report = "") => {
      const pipe = fakePipeline({ resultText: (n) => `the report of sub-agent ${n}${report}` });
      const s = gone(pipe, more);
      const { id } = s.create({ cwd: folder, model: "ag/sonnet", settings: { ...settings, context: { ...settings.context, compaction: { mode: "auto" } } } });
      for (let n = 1; n <= turns; n++) await say(s, id, `turn ${n}`);
      holds(id, 5_000);
      archive.mergeMeta(id, { moves: [{ atTurn: archive.turnBodies(id).at(-1).n, from: { cwd: folder }, to: { cwd: join(folder, "fix-login") } }] });
      return { pipe, s, id, seed: () => JSON.stringify(pipe.calls.at(-1).pre.body.messages) };
    };
    const whole = await moved();
    await assert.rejects(say(whole.s, whole.id, "turn 2"), (/** @type {any} */ e) => e.status === 409 && e.extra.resumeQuestion?.why === "lost" && e.extra.resumeQuestion?.moved === "fix-login" && e.extra.resumeQuestion?.carry === "plain" && /from Filament's copy of the chat as Whole \(/.test(e.message));
    const went = await say(whole.s, whole.id, "turn 2", { sendAsIs: true });
    assert.ok(went.report.notes.includes("agent: the chat moved to fix-login, where ag has no session of it yet, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as Whole (a move keeps the agent and its model, so the turns go whole)"), went.report.notes.join("\n"));
    assert.match(whole.seed(), /the report of sub-agent 1/, "the tool's result reached the fresh session");
    // The session chose Words: that stands, and the result stays behind.
    const words = await moved({ context: { carry: "words" } });
    const thin = await say(words.s, words.id, "turn 2", { sendAsIs: true });
    assert.ok(thin.report.notes.includes("agent: the chat moved to fix-login, where ag has no session of it yet, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as Words (context.carry)"), thin.report.notes.join("\n"));
    assert.doesNotMatch(words.seed(), /the report of sub-agent 1/);
    assert.match(words.seed(), /filament_recall\(\{ turn: 1 \}\) brings its output back\]/, "its count names the recall that brings the result back");
    // (fails before: yes — the review of 8bcb358fc) An agent that takes no MCP tools has no filament_recall: its count
    // says to re-run a tool.
    const bare = await moved({ context: { carry: "words" } }, 1, { agentTakesMcp: () => false });
    await say(bare.s, bare.id, "turn 2", { sendAsIs: true });
    assert.match(bare.seed(), /re-run a tool if you need its output\]/);
    assert.doesNotMatch(bare.seed(), /filament_recall/);
    // The card's answer names the form.
    const folded = await moved();
    const chose = await say(folded.s, folded.id, "turn 2", { sendAsIs: true, carry: "fold" });
    assert.ok(chose.report.notes.includes("agent: the chat moved to fix-login, where ag has no session of it yet, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as Folded (chosen on the card)"), chose.report.notes.join("\n"));
    // (fails before: yes — the review of 8bcb358fc: the card's Compact and send made room first; the session then
    // started from Filament's compaction, no lost one any more, and carried the chat's Words whatever the card said)
    const room = await moved({}, 2);
    await room.s.compact(room.id, { method: "fold" });
    const after = await say(room.s, room.id, "turn 3", { sendAsIs: true, carry: "plain" });
    assert.ok(after.report.notes.includes("agent: Filament compacted its copy of the chat since the agent's last turn, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as Whole (chosen on the card)"), after.report.notes.join("\n"));
    // A layer's Whole is the layer's, not the move's.
    const layered = await moved({ context: { carry: "plain" } });
    const its = await say(layered.s, layered.id, "turn 2", { sendAsIs: true });
    assert.ok(its.report.notes.includes("agent: the chat moved to fix-login, where ag has no session of it yet, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as Whole (context.carry)"), its.report.notes.join("\n"));
    // (fails before: yes — the hunt of carry-move: Compact now after the move, then a message, seeded the session's
    // Words, the newest turn's results one counted line again; the preview and Compact now weighed Words too)
    const ring = await moved({}, 2, {}, ` ${"x".repeat(40_000)}`);
    assert.equal((await ring.s.preview(ring.id)).current.form, "plain", "the preview weighs the form the next turn carries");
    // A move after another engine's turn is a switch into the agent: the switch's form, not the move's.
    const switched = await moved();
    holds(switched.id, 5_000, "api");
    assert.equal((await switched.s.preview(switched.id)).current.form, "words");
    await ring.s.compact(ring.id, { method: "fold" });
    assert.ok(archive.getCompactions(ring.id).at(-1).detail.before > 10_000, `Compact now weighed the turns whole: ${archive.getCompactions(ring.id).at(-1).detail.before}`);
    const next = await say(ring.s, ring.id, "turn 3");
    assert.ok(next.report.notes.includes("agent: Filament compacted its copy of the chat since the agent's last turn, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as Whole (a move keeps the agent and its model, so the turns go whole)"), next.report.notes.join("\n"));
    // A layer's form still stands after a Compact now.
    const layerRing = await moved({ context: { carry: "fold+2" } }, 2);
    await layerRing.s.compact(layerRing.id, { method: "fold" });
    const layerNext = await say(layerRing.s, layerRing.id, "turn 3");
    assert.equal(layerNext.report.form, "fold+2", layerNext.report.notes.join("\n"));
  });

  // (fails before: yes — the hunt of carry-move: the turns a rewind left went to the agent's fresh session as Words,
  // though it is the same agent on the same model)
  test("a rewind of turns the agent answered: its fresh session is handed the turns left whole; a form the session chose stands", async () => {
    idle(0);
    /** A chat on the agent of three turns, the newest two rewound. @param {any} [settings] */
    const rewound = async (settings = {}) => {
      const pipe = fakePipeline({ resultText: (n) => `the report of sub-agent ${n}` });
      const s = createSessions({ ...deps(pipe), config: agentConfig, now: () => Date.now() + skew });
      const { id } = s.create({ cwd: folder, model: "ag/sonnet", settings: { ...settings, context: { ...settings.context, compaction: { mode: "auto" } } } });
      for (let n = 1; n <= 3; n++) {
        await say(s, id, `turn ${n}`);
        holds(id, 5_000);
      }
      for (const t of archive.turnBodies(id).slice(1)) archive.mergeTurnMeta(t.turnId, { rewound: { line: 1, by: "person", at: Date.now() } });
      return { pipe, s, id, seed: () => JSON.stringify(pipe.calls.at(-1).pre.body.messages) };
    };
    const whole = await rewound();
    assert.equal((await whole.s.preview(whole.id)).current.form, "plain", "the preview weighs it whole");
    const went = await say(whole.s, whole.id, "turn 2 again");
    assert.ok(went.report.notes.includes("agent: you rewound turns ag answered, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as Whole (a rewind keeps the agent and its model, so the turns go whole)"), went.report.notes.join("\n"));
    assert.match(whole.seed(), /the report of sub-agent 1/, "the turn left reached the fresh session with its result");
    assert.doesNotMatch(whole.seed(), /the report of sub-agent [23]/, "the rewound ones did not");
    const words = await rewound({ context: { carry: "words" } });
    const thin = await say(words.s, words.id, "turn 2 again");
    assert.ok(thin.report.notes.includes("agent: you rewound turns ag answered, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as Words (context.carry)"), thin.report.notes.join("\n"));
  });

  // (fails before: yes — HarnessV4_Tasks C26: after Filament's compaction nothing weighed the agent's fresh start, so a
  // seed still past the line went to the agent whole, under Ask first too)
  test("after Filament's compaction the agent's fresh start is weighed at the composition's line: still past it, the message asks for room", async () => {
    idle(0);
    const { s, id } = open(fakePipeline({ resultText: () => `contents ${"x".repeat(100000)}` }), { context: { carry: "plain", compaction: { mode: "ask", thresholdPercent: 10 } } });
    for (const n of [1, 2]) await say(s, id, `turn ${n}`);
    // The agent answered, and named no count: Compact now weighs Filament's copy.
    archive.mergeTurnMeta(archive.turnBodies(id).at(-1).turnId, { facts: { upstream: "ag" } });
    // A fold keeps the newest turn whole, and that one alone is past the 20,000-token line.
    assert.equal((await s.compact(id, { method: "fold" })).ok, true);
    await assert.rejects(say(s, id, "turn 3"), (/** @type {any} */ e) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /^Filament compacted its copy of the chat since the agent's last turn, so this turn starts a fresh agent session from Filament's copy of the chat, which weighs ≈[\d,]+ of the agent's 200,000-token window, past the 20,000-token compaction line/);
      assert.deepEqual([e.extra.needsCompaction, e.extra.reads], [true, { kind: "agent", name: "ag", from: "copy" }]);
      return true;
    });
  });

  test("Compact now and the preview weigh an agent's session by what the agent holds, in its window", async () => {
    idle(0);
    const { s, id } = open(fakePipeline());
    for (const n of [1, 2]) await say(s, id, `turn ${n}`);
    holds(id, 150_000);
    const plan = (await s.preview(id, { compaction: true })).compaction;
    assert.deepEqual([plan.now, plan.window, plan.line], [150_000, 200_000, 170_000]);
    assert.equal(plan.methods.fold.possible, true);
    const done = await s.compact(id, { method: "fold" });
    assert.equal(done.compaction.detail.before, 150_000);
  });

  // (fails before: yes — the 11-01 report's B9: the compaction for the refused seed took the place of the one made at
  // the line, in the turn's answer and its stamp, and the composition it handed back named its own alone)
  test("a turn that compacts at its line and again for a seed its agent refused names both, in the order made, each by its row's id: the composition its fresh session is seeded from, its stamp and its answer", async () => {
    idle(0);
    /** @type {any} */
    let reseeded = null;
    const pipe = fakePipeline({ resultText: (n) => (n <= 2 ? `contents ${"x".repeat(60000)}` : `contents of file ${n}`) });
    const handle = pipe.handle;
    // Turn 3's agent refuses its seed for its size, saying what it takes: its bridge asks for one made to fit.
    pipe.handle = async (req, res, format, pre) => {
      if (pipe.calls.length === 2) reseeded = await pre.reseed({ max: 10_000, counted: 10_200 });
      return handle.call(pipe, req, res, format, pre);
    };
    // The summary at the line fails, so fold makes the room there; the one for the refused seed is written.
    const realCall = memory.callModel;
    let compacts = 0;
    memory.callModel = async (a) => {
      if (a.purpose === "compact" && !compacts++) throw new Error("the model is down");
      return realCall(a);
    };
    try {
      // The bridge keeps no session of the chat: each turn starts a fresh one from Filament's copy.
      const s = createSessions({ ...deps(pipe), config: agentConfig, agentSelf: /** @type {any} */ ({ holds: () => false, how: () => null, compacts: () => null }), now: () => Date.now() + skew });
      const { id } = s.create({ cwd: folder, model: "ag/sonnet", settings: { context: { carry: "plain", compaction: { mode: "auto", model: "w-1", thresholdPercent: 10 } } } });
      for (const n of [1, 2]) {
        await say(s, id, `turn ${n}`, { sendAsIs: true });
        holds(id, 5_000);
      }
      assert.deepEqual(archive.getCompactions(id), [], "under the line until turn 3");
      const out = await say(s, id, "turn 3", { sendAsIs: true });
      const made = archive.getCompactions(id).map((r) => ({ id: r.id, fromTurn: r.from_turn, toTurn: r.to_turn, kind: r.kind, method: r.method }));
      assert.deepEqual(made.map((m) => [m.method, m.fromTurn, m.toTurn]), [["fold", 1, 1], ["summary", 1, 2]], out.report.notes.join("\n"));
      assert.deepEqual(pipe.calls[2].pre.composition.compactions, made.slice(0, 1), "the turn went to the agent composed after the line's");
      assert.deepEqual(reseeded.composition.compactions, made, "the seed made to fit names both");
      assert.deepEqual(out.report.compactions, made, "so does the turn's answer");
      assert.deepEqual(archive.getTurns(id).at(-1).meta.composed.compactions, made, "and its stamp");
    } finally {
      memory.callModel = realCall;
    }
  });
});

describe("what a composition opens (HarnessV4_Tasks C29)", () => {
  /** The archived messages `run` opens, by hash. @param {() => any} run @returns {Promise<string[]>} */
  const opened = async (run) => {
    /** @type {string[]} */
    const seen = [];
    const real = archive.getMessage;
    archive.getMessage = function (hash) {
      seen.push(hash);
      return real.call(this, hash);
    };
    try {
      await run();
    } finally {
      delete archive.getMessage;
    }
    return seen;
  };
  /** The hashes of the messages of a session's turns `ns`. @param {string} id @param {number[]} ns */
  const messagesOf = (id, ns) => archive.getTurns(id).filter((t) => ns.includes(t.n)).flatMap((t) => [t.user_hash, ...t.work, t.final_hash]);

  // (fails before: yes — listing a session's turns opened and decoded every message of every one)
  test("the archive lists a session's turns without opening a message: a turn's are opened when they are read, once, and its row says whether it finished", async () => {
    const s = createSessions(deps(fakePipeline()));
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    for (const n of [1, 2, 3]) await s.turn(id, { content: `turn ${n}` }, fakeReq(), new FakeRes());
    archive.beginTurn(id, { requestId: "open-1", model: "m", upstream: "fake", userMessage: { role: "user", content: "still open" } });
    /** @type {any[]} */
    let bodies = [];
    assert.deepEqual(await opened(() => { bodies = archive.turnBodies(id); }), [], "listing opens nothing");
    assert.deepEqual(bodies.map((b) => [b.n, b.finished]), [[1, true], [2, true], [3, true], [4, false]]);
    const [, two, three, open] = archive.getTurns(id);
    assert.deepEqual(await opened(() => { assert.equal(bodies[1].work.length, 2); assert.equal(bodies[1].work.length, 2); }), two.work, "a turn's work: its messages, once");
    assert.deepEqual(await opened(() => assert.equal(textOfMessage(bodies[2].final), "Turn 3 done.")), [three.final_hash]);
    assert.deepEqual(await opened(() => assert.deepEqual([bodies[3].final, textOfMessage(bodies[3].user)], [null, "still open"])), [open.user_hash], "an open turn has no answer to open");
    assert.deepEqual(await opened(() => assert.deepEqual(Object.keys({ ...bodies[0] }).slice(-3), ["user", "work", "final"])), messagesOf(id, [1]), "a copy of a turn reads it whole");
  });

  // (fails before: yes — every composition opened every message of the session, and rebuilt every turn another window
  // made, whatever the copy's summary stood for)
  test("a composition opens what its copy holds: with a summary standing, no message of a turn behind it is opened — by a dry compose, the plan, or a turn", async () => {
    const pipe = fakePipeline();
    const s = createSessions(deps(pipe));
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    const say = (/** @type {string} */ content) => s.turn(id, { content }, fakeReq(), new FakeRes());
    await say("turn 1");
    // Turns another window made (archived with no composition of the harness's): the turn adapter rebuilds those.
    for (const n of [2, 3, 4, 5, 6]) await pipe.handle(fakeReq(), new FakeRes(), "anthropic", { headers: { "x-filament-chain": id }, body: { model: "m", messages: [{ role: "user", content: `client turn ${n}` }] } });
    const behind = new Set(messagesOf(id, [1, 2, 3, 4, 5, 6]));
    const ofBehind = (/** @type {string[]} */ seen) => seen.filter((h) => behind.has(h));
    assert.equal(ofBehind(await opened(() => s.preview(id, {}))).length, behind.size, "no summary: the copy holds every turn, and a composition opens each once");
    const made = await s.compact(id, { method: "summary" });
    assert.deepEqual([made.compaction.fromTurn, made.compaction.toTurn], [1, 6]);
    await say("turn 7");
    // The copy: the summary, then turn 7.
    const dry = await opened(() => s.preview(id, {}));
    assert.deepEqual(ofBehind(dry), [], "a dry compose");
    assert.ok(messagesOf(id, [7]).every((h) => dry.includes(h)), "turn 7 is the copy's: opened");
    assert.deepEqual(ofBehind(await opened(() => s.preview(id, { compaction: true }))), [], "the plan, with every way weighed");
    assert.deepEqual(ofBehind(await opened(() => say("turn 8"))), [], "a turn");
    assert.deepEqual(ofBehind(await opened(() => s.transcript(id, { limit: 1 }))), [], "the transcript's newest turn");
  });
});

// (fails before: yes — the owner's of 10-28: past the newest 30 a helper whose work waited for your Apply went, and its
// work with it from Changes)
test("a thread whose work waits for your Apply is kept past the newest 30: the oldest idle one with nothing waiting goes", () => {
  const s = createSessions(deps(fakePipeline()));
  const { id } = s.create({ cwd: folder, model: "agent/m" });
  /** @param {number} i @param {Record<string, any>} [over] @returns {any} */
  const thread = (i, over = {}) => ({
    id: `sa_${String(i).padStart(8, "0")}`, origin: "owner", may: "edit", asked: false,
    card: { tag: "helper", name: "Helper", kind: "worker", may: "edit", thinks: "" },
    team: null, model: "m", description: `Thread ${i}`, cwd: folder, mode: null, view: "none", running: false, changes: null, start: null, seen: null,
    memory: false, deliver: false, aside: true, status: "done", startedAt: 1000 + i, shares: null, cut: false, thinking: null, opening: [], work: null,
    exchanges: [{ prompt: `PROMPT ${i}`, description: `Thread ${i}`, by: "owner", runId: `run-${i}`, status: "done", startedAt: 1000 + i, endedAt: 2000 + i, delivery: "held", outcome: { report: "", error: null, ms: 5, rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, wrote: true } }],
    ...over,
  });
  const ids = () => s.loadSubagentThreads(id).map((t) => Number(t.id.slice(3)));
  s.saveSubagentThread(id, thread(1, { work: { repo: folder, base: "b1", head: "h1", files: [{ path: "a.txt", added: 1, removed: 0 }], applied: [] }, task: "t1" }), 30);
  for (let i = 2; i <= 31; i++) s.saveSubagentThread(id, thread(i), 30);
  assert.deepEqual(ids().slice(0, 2), [1, 2], "thread 1's work waits: it counts toward no 30, and the thirty others stay");
  s.saveSubagentThread(id, thread(32), 30);
  assert.deepEqual(ids().slice(0, 2), [1, 3], "the thirty-first other: thread 2 went");
  assert.equal(s.loadSubagentThreads(id)[0].task, "t1", "a graph worker keeps its task");
  // Applied, nothing of it waits: it goes as any other would.
  s.saveSubagentThread(id, thread(1, { work: { repo: folder, base: "h1", head: "h1", files: [], applied: [{ at: 1, files: 1, by: "owner" }] } }), 30);
  s.saveSubagentThread(id, thread(33), 30);
  assert.equal(ids()[0], 4, "applied, it went first");
  // Marked as applied, its mark still to be undone (10-29): its work is held for the undo, which only its thread can
  // make — it stays as one whose work waits does.
  // (fails before: yes — nothing of a marked thread waited, so it went first, and the commits held for its undo with it)
  /** A mark of thread 5's, made `ago` ms before now. @param {number} ago */
  const marked5 = (ago) => thread(5, { work: { repo: folder, base: "h5", head: "h5", files: [], applied: [{ at: Date.now() - ago, files: 1, by: "owner", hand: { base: "b5", head: "h5" } }] } });
  s.saveSubagentThread(id, marked5(0), 30);
  s.saveSubagentThread(id, thread(34), 30);
  s.saveSubagentThread(id, thread(35), 30);
  assert.deepEqual(ids().slice(0, 3), [5, 6, 7], "thread 4 went, then none: thread 5 counts toward no 30");
  // (fails before: yes — the owner's of 11-04: a mark could be undone for good, so its thread was kept for good) A mark
  // made more than a day ago can be undone no more: its thread is one of the thirty again.
  const DAY = 24 * 3600_000;
  s.saveSubagentThread(id, marked5(DAY + 60_000), 30);
  assert.deepEqual(ids().slice(0, 2), [5, 7], "counted again, the thirty-first: thread 6, idle the longest of the others, went");
  s.saveSubagentThread(id, thread(36), 30);
  assert.deepEqual(ids().slice(0, 2), [7, 8], "then thread 5 itself, idle the longest");
});

// (fails before: yes — the owner's of 11-04: 75 threads whose marks could be undone held a chat's every place, so each
// thread saved put out the one before it, and a Product agent the person started was gone after a restart)
test("threads whose work waits count toward none of the newest 30: past thirty of them, a thread the person started stays as the next come", () => {
  const s = createSessions(deps(fakePipeline()));
  const { id } = s.create({ cwd: folder, model: "agent/m" });
  /** @param {number} i @param {Record<string, any>} [over] @returns {any} */
  const thread = (i, over = {}) => ({
    id: `sa_${String(i).padStart(8, "0")}`, origin: "owner", may: "edit", asked: false,
    card: { tag: "helper", name: "Helper", kind: "worker", may: "edit", thinks: "" },
    team: null, model: "m", description: `Thread ${i}`, cwd: folder, mode: null, view: "none", running: false, changes: null, start: null, seen: null,
    memory: false, deliver: false, aside: true, status: "done", startedAt: 1000 + i, shares: null, cut: false, thinking: null, opening: [], work: null,
    exchanges: [{ prompt: `PROMPT ${i}`, description: `Thread ${i}`, by: "owner", runId: `run-${i}`, status: "done", startedAt: 1000 + i, endedAt: 2000 + i, delivery: "held", outcome: { report: "", error: null, ms: 5, rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, wrote: true } }],
    ...over,
  });
  /** A builder whose change was marked as applied, the mark still to be undone. @param {number} i */
  const marked = (i) => thread(i, { work: { repo: folder, base: `h${i}`, head: `h${i}`, files: [], applied: [{ at: Date.now(), files: 1, by: "agent", hand: { base: `b${i}`, head: `h${i}` } }] } });
  const ids = () => s.loadSubagentThreads(id).map((t) => Number(t.id.slice(3)));
  for (let i = 1; i <= 31; i++) s.saveSubagentThread(id, marked(i), 30);
  s.saveSubagentThread(id, thread(100, { card: { tag: "product", name: "Product", kind: "advisor", may: "read", thinks: "" }, description: "Reimagine the Plan view" }), 30);
  s.saveSubagentThread(id, thread(101), 30);
  s.saveSubagentThread(id, thread(102), 30);
  assert.deepEqual(ids().slice(31), [100, 101, 102], "the Product agent stays as the reviewers after it come");
  assert.equal(ids().length, 34, "and every marked one with them");
  for (let i = 103; i <= 129; i++) s.saveSubagentThread(id, thread(i), 30);
  assert.equal(ids().filter((n) => n >= 100).length, 30, "thirty threads that may go, besides the marked");
  s.saveSubagentThread(id, thread(130), 30);
  assert.deepEqual([ids().length, ids()[31]], [61, 101], "the thirty-first that may go: the one idle the longest went, the Product agent");
});

// (fails before: yes — HarnessV4_Tasks E15 step 5 (BW-10): a session kept nothing of its sub-agents)
test("a session keeps its sub-agents' threads: their texts as archived messages, in the order they began, the newest 30 — the one idle the longest goes, one that runs never; a fork carries none", async () => {
  const s = createSessions(deps(fakePipeline()));
  const { id } = s.create({ cwd: folder, model: "agent/m" });
  /** @param {number} i @param {Record<string, any>} [over] @returns {any} */
  const thread = (i, over = {}) => ({
    id: `sa_${String(i).padStart(8, "0")}`, origin: "owner", may: "read", asked: false,
    card: { tag: "helper", name: "Helper", kind: "worker", may: "edit", thinks: `THINKS ${i}` },
    team: null, model: "m", description: `Thread ${i}`, cwd: folder, mode: null, view: "none", running: false, changes: null, start: null, seen: null,
    memory: false, deliver: false, aside: true, status: "done", startedAt: 1000 + i, shares: null, cut: false, thinking: null, opening: [{ kind: "view", count: 2, chars: 900 }], work: null,
    exchanges: [{ prompt: `PROMPT ${i}`, description: `Thread ${i}`, by: "owner", runId: `run-${i}`, status: "done", startedAt: 1000 + i, endedAt: 2000 + i, delivery: "held", outcome: { report: `REPORT ${i}`, error: null, ms: 5, rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, wrote: false } }],
    ...over,
  });
  const ids = () => s.loadSubagentThreads(id).map((t) => Number(t.id.slice(3)));
  const working = thread(2, { status: "running", startedAt: 1, exchanges: [{ prompt: "PROMPT 2", description: "Thread 2", by: "owner", runId: "run-2", status: "running", startedAt: 1, endedAt: null, delivery: null, outcome: null }] });
  s.saveSubagentThread(id, working, 30);
  s.saveSubagentThread(id, thread(1), 30);
  assert.doesNotMatch(JSON.stringify(archive.getChain(id).meta.subagentThreads), /PROMPT|REPORT|THINKS/, "its texts are archived as messages, never in the session's own row");
  assert.deepEqual(s.loadSubagentThreads(id), [{ ...working, convo: null }, { ...thread(1), convo: null }], "and come back whole, an exchange that runs with no outcome");
  s.saveSubagentThread(id, thread(1, { status: "error" }), 30);
  assert.deepEqual(s.loadSubagentThreads(id).map((t) => [t.id, t.status]), [["sa_00000002", "running"], ["sa_00000001", "error"]], "a thread saved again takes its own place");
  for (let i = 3; i <= 30; i++) s.saveSubagentThread(id, thread(i), 30);
  assert.equal(ids().length, 30);
  s.saveSubagentThread(id, thread(31), 30);
  assert.deepEqual(ids(), [2, ...Array.from({ length: 29 }, (_, k) => k + 3)], "the thirty-first: the one idle the longest went — never the one that runs, though it began first");
  // A message in an old thread makes it the newest at work: the next to go is the one after it.
  const more = thread(3);
  s.saveSubagentThread(id, { ...more, exchanges: [...more.exchanges, { ...more.exchanges[0], prompt: "MORE", startedAt: 9000, endedAt: 9001 }] }, 30);
  s.saveSubagentThread(id, thread(32), 30);
  assert.deepEqual(ids().slice(0, 3), [2, 3, 5], "thread 4 went, thread 3 stays in its place");
  assert.deepEqual(s.loadSubagentThreads(id).find((t) => t.id === "sa_00000003")?.exchanges.map((e) => e.prompt), ["PROMPT 3", "MORE"]);
  await s.turn(id, { content: "turn 1" }, fakeReq(), new FakeRes());
  const fork = archive.forkChain(id, { atTurn: 1, key: "h:fork-threads" });
  assert.equal(archive.getChain(fork.id).meta?.subagentThreads, undefined, "a fork begins with no sub-agents of its own");
  assert.deepEqual(s.loadSubagentThreads(fork.id), []);
});

// (fails before: yes — a session kept what was said in a sub-agent's thread, never its conversation)
test("a session keeps a sub-agent's conversation: each message archived once, the list by one hash on its row; back whole, or null where a message was kept cut", () => {
  const s = createSessions(deps(fakePipeline()));
  const { id } = s.create({ cwd: folder, model: "agent/m" });
  const convo = [
    { role: "user", content: [{ type: "text", text: "CONVO ASK" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "read", input: { path: "a.js" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "CONVO FILE" }] },
    { role: "assistant", content: [{ type: "text", text: "CONVO ANSWER" }] },
  ];
  const thread = {
    id: "sa_0000000a", origin: "owner", may: "read", asked: false, card: { tag: "helper", name: "Helper", may: "read", thinks: "" }, team: null, model: "m",
    description: "Read", cwd: folder, mode: null, view: "none", running: false, changes: null, start: null, seen: null, memory: false, deliver: false, aside: true,
    status: "done", startedAt: 1, shares: null, cut: false, thinking: null, opening: [], work: null,
    exchanges: [{ prompt: "CONVO ASK", description: "Read", by: "owner", runId: "run-a", status: "done", startedAt: 1, endedAt: 2, delivery: "held", outcome: { report: "CONVO ANSWER", error: null, ms: 1, rounds: 2, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0, wrote: false } }],
  };
  s.saveSubagentThread(id, /** @type {any} */ ({ ...thread, convo }), 30);
  const row = JSON.stringify(archive.getChain(id).meta.subagentThreads);
  assert.doesNotMatch(row, /CONVO/, "never in the session's own row");
  assert.match(row, /"convoHash":"[0-9a-f]{64}"/);
  assert.deepEqual(s.loadSubagentThreads(id)[0].convo, convo, "back whole: its calls and what they returned too");
  // Saved again as it stands, the same list: nothing archived anew.
  const hash = /** @type {any} */ (archive.getChain(id).meta.subagentThreads[0]).convoHash;
  s.saveSubagentThread(id, /** @type {any} */ ({ ...thread, convo }), 30);
  assert.equal(/** @type {any} */ (archive.getChain(id).meta.subagentThreads[0]).convoHash, hash);
  // A message past the archive's size cap is kept cut: the conversation is not there whole, so none of it comes back.
  const big = [...convo, { role: "user", content: [{ type: "text", text: "x".repeat(archive.caps.messageBytes + 10) }] }];
  s.saveSubagentThread(id, /** @type {any} */ ({ ...thread, convo: big }), 30);
  assert.equal(s.loadSubagentThreads(id)[0].convo, null);
});

// A question a turn of the loop paused on lapses after PAUSE_TTL_MS unanswered (the decision of 11-02): a lapse is the
// question ending, as an answer or a message to a coding agent ends it — what waited on it goes then: what the registry
// held for the turn's end (`pauseLetGo`), the loop's park with its in-process work (`parks.letGo`), and the asker of a
// coding agent's own turn, told on the feed (`question-over`). It is watched from the end of the turn that asked, and
// from the first look of one waiting on it (`asking`) — a park from before a restart.
describe("a question out of time ends there", () => {
  /** @param {string[]} told */
  const watching = (told) =>
    createSessions(/** @type {any} */ ({
      ...deps(fakePipeline()),
      subagents: { peekQueued: () => [], ackQueued() {}, pauseLetGo: (/** @type {string} */ id) => told.push(`registry ${id}`) },
      parks: { letGo: (/** @type {string} */ id) => told.push(`park ${id}`) },
      publish: (/** @type {string} */ id, /** @type {any} */ e) => void (e?.type === "question-over" && told.push(`feed ${id} ${e.why}`)),
    }));

  // (fails before: yes — nothing heard the lapse: the registry's held runs and the park waited on, told [])
  test("watched from a look of one waiting on it: the registry, the loop's park and the feed hear it lapse", async () => {
    /** @type {string[]} */
    const told = [];
    const s = watching(told);
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    const at = Date.now();
    archive.mergeMeta(id, { paused: { kind: "permission", requestId: "r-1", at, expires: at + 150 } });
    assert.equal(s.asking(id), true, "it waits");
    await until(() => told.length >= 3, "the lapse heard", { timeoutMs: 5000 });
    assert.deepEqual(told, [`registry ${id}`, `park ${id}`, `feed ${id} lapsed`]);
    assert.equal(s.asking(id), false);
  });

  // (fails before: yes — the question a turn left waiting lapsed unheard: told [])
  test("watched from the end of the turn that asked; answered before its time, its lapse is nothing", async () => {
    /** @type {string[]} */
    const told = [];
    const s = watching(told);
    const { id } = s.create({ cwd: folder, model: "agent/m" });
    // The turn's end finds its question waiting, as the loop parked it.
    const parkIt = fakePipeline().handle;
    const t = createSessions(/** @type {any} */ ({
      ...deps({ handle: async (/** @type {any[]} */ ...a) => { await parkIt(...a); const now = Date.now(); archive.mergeMeta(id, { paused: { kind: "ask", requestId: "r-2", at: now, expires: now + 150 } }); } }),
      subagents: { peekQueued: () => [], ackQueued() {}, pauseLetGo: (/** @type {string} */ c) => told.push(`registry ${c}`) },
      parks: { letGo: (/** @type {string} */ c) => told.push(`park ${c}`) },
    }));
    await t.turn(id, { content: "ask me" }, fakeReq(), new FakeRes());
    await until(() => told.length >= 2, "the lapse heard", { timeoutMs: 5000 });
    assert.deepEqual(told, [`registry ${id}`, `park ${id}`]);
    // A question answered in its time: its watch finds it gone, and says nothing.
    told.length = 0;
    const at = Date.now();
    archive.mergeMeta(id, { paused: { kind: "ask", requestId: "r-3", at, expires: at + 150 } });
    assert.equal(s.asking(id), true);
    archive.mergeMeta(id, { paused: undefined });
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(told, []);
  });
});
