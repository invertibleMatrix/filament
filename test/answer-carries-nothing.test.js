// @ts-check
// HarnessV3-AtHome AH-F3 (2026-10-04): a sub-agent's report that came in while a question waited rode ahead of the
// owner's answer, in the same message, and the loop read the whole message as the answer: a plain "yes" arrived as a
// report followed by "yes" — no yes at all — and the call was declined in the report's words. Now a turn that answers
// a waiting question or permission carries nothing ahead of it. The resumed loop's inbox opens with the session's
// queue, and its next round delivers the reports, and a background shell's exit, beside the answered call's result.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { disposeBackgroundShells, peekShellExits } from "../src/adapters/tools/hands.js";
import { PROMPT } from "../src/app/agent/prompt.js";

/** @type {string} */
let root;
/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {(call: any) => any} */
let brain = () => undefined;
const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
const said = (/** @type {string} */ t) => reply([{ type: "text", text: t }]);
const resultsOf = (/** @type {any} */ m) => (Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ b) => b?.type === "tool_result") : []);
const textsOf = (/** @type {any} */ m) => (Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text)) : []);
const isSub = (/** @type {any} */ call) => JSON.stringify(call.body?.system ?? "").includes(PROMPT.subagentRole);

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-answer-carries-"));
  up = await fakeUpstream(async (call) => brain(call));
  shim = await startApp({
    memory: true,
    keep: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.memory.autopilot = { enabled: false };
      cfg.memory.capture = { turns: true, learn: false };
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
    },
  });
});
after(async () => {
  disposeBackgroundShells();
  await shim.stop();
  await up.close();
  await removeDirs(shim.dataDir, root);
});

/** @param {any} settings */
const create = async (settings) => {
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings } });
  if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
  return String((await r.json()).id);
};
/** @param {string} id @param {string} content */
const turn = async (id, content, extra = {}) => {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false, ...extra } });
  if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
  return { headers: r.headers, json: await r.json(), rec: await shim.record(r.headers.get("x-filament-request-id")) };
};
/** The session's sub-agents and its queue. @param {string} id */
const subagentsOf = async (id) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();

// (fails before: yes — the answer's message opened with the report, so "yes" was no yes: the call was declined in the
// report's words, and nothing was written). Since HarnessV4_Envelopes_Plan EN2 the resumed loop is at work, so the
// report reaches its next round as its envelope's line, and the turn's end says once that it is still sealed.
test("a report that came while a permission waited does not ride ahead of the answer: the yes runs the call, and the report's line reaches the loop at its next round", async () => {
  const id = await create({ subagents: { worktree: false } });
  /** @type {any} */
  let next = null;
  brain = (call) => {
    if (isSub(call)) return said("SUB REPORT");
    const last = call.body.messages.at(-1);
    if (textsOf(last).some((t) => t.startsWith("[Filament: one envelope is still sealed"))) return said(" It can wait.");
    if (!resultsOf(last).length) return reply([toolUse("b1", "bash", { command: "echo one > one.txt" })], "tool_use");
    next = last;
    return said("DONE");
  };
  up.reset();
  const asked = await turn(id, "write one.txt");
  assert.equal(asked.rec.agent.status, "paused", "Edit mode asks before a command that writes");
  const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "audit the folder", description: "Audit", inform: true } });
  assert.equal(spawn.status, 200, await spawn.clone().text());
  await until(async () => {
    const s = await subagentsOf(id);
    return s.subagents.length && s.subagents.every((/** @type {any} */ x) => x.status !== "running") ? s : null;
  }, "the sub-agent's report");
  assert.equal((await subagentsOf(id)).queued, 1, "the report waits for the session's loop");

  const answered = await turn(id, "yes", { allow: true });
  assert.equal(answered.headers.get("x-filament-deliveries"), null, "nothing rode ahead of the answer");
  assert.ok(existsSync(join(root, "one.txt")), "the yes ran the call");
  assert.ok(answered.rec.changes.includes("agent: the developer allowed bash"), answered.rec.changes.join("\n"));
  const results = resultsOf(next);
  assert.deepEqual(results.map((/** @type {any} */ r) => [r.tool_use_id, r.is_error === true]), [["b1", false]]);
  assert.ok(textsOf(next).some((t) => /^\[Filament: envelope 1, sealed — from the developer's sub-agent sa_[0-9a-f]{8} \("Audit"\), which ran alongside you: it wrote no subject line; it finished\./.test(t)), "the report's line, beside the answered call's result");
  assert.ok(!textsOf(next).some((t) => t.includes("SUB REPORT")), "its report waits, sealed");
  assert.ok(answered.rec.changes.some((/** @type {string} */ c) => /^agent: 1 result sealed before round \d+: its line delivered, its report waits for the envelope tool$/.test(c)), answered.rec.changes.join("\n"));
  assert.ok(answered.rec.changes.includes("agent: 1 envelope was still sealed as the turn would end — said once"), answered.rec.changes.join("\n"));
  assert.equal((await subagentsOf(id)).queued, 0, "delivered once");
  assert.equal(answered.json.content.map((/** @type {any} */ b) => b.text).join(""), "DONE It can wait.", "its answer, then its word on the envelope it leaves sealed");
});

// (fails before: yes — the answer to a pause opens a new run, and a report counted only on the run that launched its
// sub-agent: what the audit did counted on no turn). The audit reads only once the resumed turn's model has replied
// without it, so the turn must wait for a sub-agent the paused run launched; a report that came sooner would ride with
// the answered call's result, and the wait would go untested.
test("a background sub-agent launched before a pause counts on the resumed turn: its calls are the turn's, as they would be without the question", async () => {
  const id = await create({ subagents: { worktree: false } });
  writeFileSync(join(root, "audit.txt"), "audit me\n");
  /** @type {(v?: any) => void} */
  let release = () => {};
  const gate = new Promise((r) => (release = r));
  brain = async (call) => {
    const last = call.body.messages.at(-1);
    const answers = resultsOf(last).map((/** @type {any} */ r) => r.tool_use_id);
    if (isSub(call)) {
      if (answers.includes("s1")) return said("AUDITED");
      await gate;
      return reply([toolUse("s1", "read", { path: "audit.txt" })], "tool_use");
    }
    if (textsOf(last).some((t) => t.includes("AUDITED"))) return said("DONE");
    if (answers.includes("b1")) {
      release();
      return said("WAITING FOR THE AUDIT");
    }
    if (answers.includes("g1")) return reply([toolUse("b1", "bash", { command: "echo two > two.txt" })], "tool_use");
    return reply([toolUse("g1", "agent", { description: "Audit", prompt: "audit the folder", run_in_background: true })], "tool_use");
  };
  up.reset();
  const asked = await turn(id, "audit, then write two.txt");
  assert.equal(asked.rec.agent.status, "paused", "Edit mode asks before a command that writes");
  const answered = await turn(id, "yes", { allow: true });
  assert.ok(existsSync(join(root, "two.txt")), "the yes ran the command");
  assert.deepEqual(answered.json.content.map((/** @type {any} */ b) => b.text), ["WAITING FOR THE AUDIT", "DONE"], "the turn waited for the audit and went on with its report");
  assert.equal(answered.rec.agent.toolCalls, 2, "the answered command, and the audit's read");
});

// (fails before: no — a guard the mutation pass asked for: nothing checked that a question past its time stops holding
// back what waits for the session)
test("a question left past its time no longer waits: after a restart the next message is a new turn, and the report rides with it", async () => {
  /** @param {any} cfg */
  const configure = (cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.memory.autopilot = { enabled: false };
    cfg.memory.capture = { turns: true, learn: false };
    cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
  };
  const first = await startApp({ memory: true, keep: true, configure });
  /** @type {Awaited<ReturnType<typeof startApp>> | null} */
  let second = null;
  let firstStopped = false;
  try {
    const created = await first.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { subagents: { worktree: false } } } });
    assert.equal(created.status, 200, await created.clone().text());
    const id = String((await created.json()).id);
    /** @type {any} */
    let firstAsk = null;
    brain = (call) => {
      if (isSub(call)) return said("SUB REPORT");
      const last = call.body.messages.at(-1);
      if (!resultsOf(last).length && /write late\.txt/.test(JSON.stringify(last))) return reply([toolUse("b1", "bash", { command: "echo late > late.txt" })], "tool_use");
      firstAsk ??= last;
      return said("DONE");
    };
    up.reset();
    const asked = await first.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "write late.txt", stream: false } });
    assert.equal((await first.record(asked.headers.get("x-filament-request-id"))).agent.status, "paused");
    const spawn = await first.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "audit the folder", description: "Audit", inform: true } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    await until(async () => {
      const s = await (await first.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
      return s.subagents.length && s.subagents.every((/** @type {any} */ x) => x.status !== "running") && s.queued === 1;
    }, "the sub-agent's report");
    // The question's time runs out while Filament is stopped.
    const archive = first.app.memory.archive;
    assert.ok(archive, "the first run's archive");
    archive.mergeMeta(id, { paused: { ...archive.getChain(id).meta.paused, expires: Date.now() - 1000 } });
    await first.stop();
    firstStopped = true;
    second = await startApp({ memory: true, dataDir: first.dataDir, configure });
    const view = await (await second.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.equal(view.paused, null, "nothing waits on the session");
    firstAsk = null;
    const r = await second.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "go on", stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    assert.notEqual(r.headers.get("x-filament-deliveries"), null, "the report rode with the new turn's message");
    assert.ok(JSON.stringify(firstAsk).includes("SUB REPORT"), JSON.stringify(firstAsk));
    const rec = await second.record(r.headers.get("x-filament-request-id"));
    assert.ok(!rec.changes.some((/** @type {string} */ c) => /the developer (?:allowed|declined)/.test(c)), "no answer to the old question");
    assert.ok(!existsSync(join(root, "late.txt")), "the old question's command did not run");
  } finally {
    if (!firstStopped) await first.stop();
    if (second) await second.stop();
    else await removeDirs(first.dataDir);
  }
});

// (fails before: yes — the exit's line opened the answer's message, so the question's answer was that line and the
// developer's words together)
test("a background shell's exit while a question waits does not ride ahead of the answer: the answer is the developer's words, and the exit is told at the next round", async () => {
  const id = await create({ loop: { permissions: "auto" } });
  /** @type {any} */
  let next = null;
  brain = (call) => {
    const last = call.body.messages.at(-1);
    if (!resultsOf(last).length)
      return reply([toolUse("g1", "bash_background", { command: `node -e "setTimeout(()=>process.exit(5),300)"`, grace: 0.1 }), toolUse("q1", "ask", { question: "Which file?" })], "tool_use");
    next = last;
    return said("DONE");
  };
  up.reset();
  const asked = await turn(id, "start it, then ask me");
  assert.equal(asked.rec.agent.status, "paused");
  const owner = { session: id, agent: null };
  await until(() => peekShellExits(owner).length > 0, "the shell's exit", { timeoutMs: 15_000 });

  const answered = await turn(id, "notes.txt");
  assert.deepEqual([answered.headers.get("x-filament-deliveries"), answered.headers.get("x-filament-shell-exits")], [null, null], "nothing rode ahead of the answer");
  const results = resultsOf(next);
  assert.deepEqual(results.map((/** @type {any} */ r) => r.tool_use_id), ["g1", "q1"], "the shell's start, then the question's answer");
  assert.equal(results[1].content, "notes.txt", "the answer is the developer's words alone");
  assert.ok(textsOf(next).some((t) => /^\[Filament: background shell bg_[0-9a-z]+ \(node -e .*\) exited with code 5/.test(t)), JSON.stringify(next));
  assert.deepEqual(peekShellExits(owner), [], "told once");
});
