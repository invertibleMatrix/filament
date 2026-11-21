// @ts-check
// HarnessV3-TaskGraph-v2 TG2-D43: your message ends the lead's wait. A coding agent's wait ended only on a message
// that came while it ran: one queued before it began — sent while the agent decided to wait, or one it is yet to read
// — held the wait to its time, and an agent that takes your words only as its next message waited again and again
// while they sat there. Now a message of yours that waits for the agent ends its wait at once, in the words of how it
// reaches the agent: at its next step, "Filament hands it to you next"; only as its next message, "end your reply now".
// Each ends one wait: a later one answers as before, saying the message still waits. The agent's own command, held for
// the turn's end, ends none, so a wait never spins. The loop's own lead ends its wait at once on a message queued
// before it began (agent-wait.test.js: "a message typed while the model decides to wait ends the wait before it
// starts"): its wait is the loop's, and that test pins it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "../src/services/events.js";
import { createRunLog } from "../src/services/runs.js";
import { createLeadTurn, heardBlock } from "../src/app/agent-lead.js";
import { createLaunchTurn } from "../src/app/agent-launch.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import { MEMBERS } from "./helpers/roster.js";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { until } from "./helpers/wait.js";

const STEP = "Waited 0 s: the developer sent you a message — Filament hands it to you next.";
const REPLY = "Waited 0 s: the developer sent you a message, and it reaches you only as your next message: end your reply now — the workers keep running, and Filament wakes you with it.";
const STILL = "The developer's message still waits for you: end your reply to read it.";

/**
 * A lead's turn over a run log's own mailbox, its workers running: a door whose reports the test holds, and how each
 * message reaches the agent as the test says (`reach`, by its words).
 * @param {(text: string) => "step" | "reply" | null} reachOf
 */
const setUp = (reachOf) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-lead-wait-"));
  const runs = createRunLog({ events: createEventBus(), dataDir: dir, config: () => ({ observability: { runEvents: { persist: false } } }), ops: { record: () => {} } });
  runs.startRun({ id: "lead-1", kind: "coding-agent", meta: { steer: "next" } });
  const mb = runs.mailbox("lead-1");
  /** What waits at the door. @type {any[]} */
  const due = [];
  const door = /** @type {any} */ ({ inbox: { take: () => due.splice(0), arrival: () => new Promise(() => {}), owed: () => new Promise(() => {}), back: () => {} }, close() {} });
  const reach = (/** @type {any} */ m) => (m.kind === "note" ? reachOf(m.text) : null);
  const lead = createLeadTurn({
    registry: /** @type {any} */ ({ list: () => [] }),
    door,
    chainId: "c1",
    runId: "lead-1",
    cwd: dir,
    model: "m-1",
    team: { key: "architect", name: "Architect", members: MEMBERS },
    emit: () => {},
    note: () => {},
    mailbox: () => mb,
    reach,
    signal: new AbortController().signal,
  });
  /** The developer's message to the lead's run. @param {string} text */
  const say = (text) => {
    const r = runs.steer("lead-1", { kind: "note", text, from: "harness" });
    assert.equal(r.ok, true);
    return /** @type {any} */ (r).message;
  };
  /** The lead's wait, its answer's text. @param {number} seconds */
  const wait = async (seconds) => (await lead.call("wait", { seconds }, { patienceMs: 120_000 })).text;
  const done = () => {
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { lead, mb, due, door, say, wait, done, reach };
};

// (fails before: yes — a message queued before the wait began held it to its time)
test("a message of yours queued before the lead's wait began ends it at once, where the agent takes it at its next step", async () => {
  const t = setUp(() => "step");
  try {
    t.say("Check the docs folder too.");
    const t0 = Date.now();
    const said = await t.wait(30);
    assert.ok(Date.now() - t0 < 2_000, `it waited ${Date.now() - t0} ms of its 30 s`);
    assert.ok(said.startsWith(`${STEP}\n\n`), said);
    // A new one, while it waits, ends it too — as before.
    t.mb.took(/** @type {any} */ (t.mb.peek(() => true)));
    const waiting = t.wait(30);
    t.say("And the tests.");
    assert.ok((await waiting).startsWith(`${STEP}\n\n`));
  } finally {
    t.done();
  }
});

// (fails before: yes — the wait said "Filament hands it to you next" of a message that comes only once the reply ends,
// and the next wait held to its time while it sat there)
test("one that reaches the agent only as its next message ends the wait with end your reply now; a second wait holds, and says the message still waits", async () => {
  const t = setUp(() => "reply");
  try {
    t.say("Check the docs folder too.");
    assert.ok((await t.wait(30)).startsWith(`${REPLY}\n\n`));
    const again = await t.wait(1);
    assert.ok(again.startsWith(`Waited 1 s and nothing arrived; the workers are still running. Call wait again, or carry on with other work. ${STILL}\n\n`), again);
    // A message that came after it is new: it ends the next wait at once, in its own words.
    const waiting = t.wait(30);
    t.say("And the tests.");
    assert.ok((await waiting).startsWith(`${REPLY}\n\n`));
    // Read at last — its reply ended, and Filament handed both over — nothing still waits.
    t.mb.read();
    assert.ok(!(await t.wait(1)).includes(STILL));
  } finally {
    t.done();
  }
});

// (fails before: no — a guard: a held command that ended a wait would spin the agent's waits)
test("the agent's own command, held for the turn's end, never ends a wait, and is no message that still waits", async () => {
  const t = setUp((text) => (text.startsWith("/") ? null : "step"));
  try {
    t.say("/review the diff");
    const said = await t.wait(1);
    assert.ok(said.startsWith("Waited 1 s and nothing arrived; the workers are still running. Call wait again, or carry on with other work.\n\n"), said);
    assert.ok(!said.includes(STILL));
  } finally {
    t.done();
  }
});

// (fails before: no — a guard: a message that came with a report was said by neither)
test("reports that come with a message are said first, and the message then ends the agent's next wait", async () => {
  const t = setUp(() => "reply");
  try {
    t.due.push({ text: "[Filament: your scout sa_1 finished.]", from: "sa_1", description: "Map it", kind: "report", exchange: 0, wrote: false, spentUsd: 0, toolCalls: 1, roundIds: [] });
    t.say("Check the docs folder too.");
    const first = await t.wait(30);
    assert.ok(first.startsWith("Waited 0 s: one message from Filament:\n\n[Filament: your scout sa_1 finished.]"), first);
    assert.ok((await t.wait(30)).startsWith(`${REPLY}\n\n`));
  } finally {
    t.done();
  }
});

// (fails before: yes — the same held wait in a plain chat's agent)
test("a plain chat's wait for Filament's sub-agents ends at once on a message queued at its agent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-launch-wait-"));
  const runs = createRunLog({ events: createEventBus(), dataDir: dir, config: () => ({ observability: { runEvents: { persist: false } } }), ops: { record: () => {} } });
  try {
    runs.startRun({ id: "agent-1", kind: "coding-agent", meta: { steer: "queued" } });
    const mb = runs.mailbox("agent-1");
    const door = /** @type {any} */ ({ subagents: {}, inbox: { take: () => [], arrival: () => new Promise(() => {}), owed: () => new Promise(() => {}), back: () => {} }, close() {} });
    const turn = createLaunchTurn({ registry: /** @type {any} */ ({}), door, chainId: "c1", emit: () => {}, note: () => {}, mailbox: () => mb, reach: (m) => (m.kind === "note" ? "step" : null), signal: new AbortController().signal, stopSignal: new AbortController().signal });
    runs.steer("agent-1", { kind: "note", text: "Count the tests too.", from: "harness" });
    assert.equal((await turn.call("wait", { seconds: 30 }, { patienceMs: 120_000 })).text, STEP);
  } finally {
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- on the live app: a lead whose agent takes no words while its turn runs ------------------------------------------

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let folder;
/** @type {string} */
let logs;
/** Lets the worker that waits for it go on. @type {() => void} */
let release = () => {};
const HELD = { role: "scout", description: "Hold until released", goal: "wait", steps: ["Wait"], acceptance: "it is released" };
const TOLD = "Check the docs folder too.";

/** @param {any} b */
const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
/** The fake agent's prompts, each one's words. */
const prompts = () => (existsSync(join(logs, "prompts.jsonl")) ? readFileSync(join(logs, "prompts.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/** A run's events so far. @param {string} runId @returns {Promise<any[]>} */
const runEvents = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || [];

before(async () => {
  folder = mkdtempSync(join(tmpdir(), "filament-lead-wait-live-"));
  logs = mkdtempSync(join(tmpdir(), "filament-lead-wait-logs-"));
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: folder, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  writeFileSync(join(folder, "a.txt"), "one\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  /** @type {Promise<void>} */
  const held = new Promise((resolve) => (release = () => resolve(undefined)));
  up = await fakeUpstream(async (call) => {
    const b = call.body || {};
    const say = (/** @type {string} */ text) => anthropicReply("", { model: String(b.model || ""), stop: "end_turn", blocks: [{ type: "text", text }], usage: { input_tokens: 5, output_tokens: 3 } });
    if (sysOf(b).includes(String(PROMPT.workerRole))) {
      await held;
      return say("HELD WORKER DONE");
    }
    return say("MODEL ANSWER");
  });
  shim = await startApp({
    memory: true,
    configure: (cfg, { dataDir }) => {
      // An agent with no prompt queueing and no live steering: what is typed while its turn runs waits for its next prompt.
      const env = { FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_CALLS: join(logs, "calls.jsonl"), FAKE_ACP_LOG: join(logs, "prompts.jsonl") };
      cfg.upstreams = [
        { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
        { id: "plain", name: "plain", type: "acp", enabled: true, acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" } },
      ];
      cfg.routes = [
        { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
        { match: "plain-*", upstream: "plain", upstreamModel: "{model}", enabled: true },
      ];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
    },
  });
});
after(async () => {
  release();
  await shim.stop();
  await up.close();
  for (const dir of [folder, logs, shim.dataDir]) rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — its wait said "Filament hands it to you next", or held to its time, while the message waited for
// the reply's end)
test("a lead whose agent takes your words only as its next message: your message ends its wait with end your reply now, and reaches it as its next prompt", async () => {
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "plain-1", preset: "plain", settings: { engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "m-1", seats: 4 }] } } } });
  assert.equal(r.status, 200, await r.clone().text());
  const id = String((await r.json()).id);
  const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `~mcpcall agent ${JSON.stringify(HELD)}`, stream: true, runEvents: true } });
  assert.equal(res.status, 200);
  const runId = String(res.headers.get("x-filament-request-id"));
  const note = async (/** @type {string} */ text) => {
    const s = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text } });
    assert.equal(s.status, 200, await s.clone().text());
  };
  try {
    // The lead's prompt ended with its worker running; the developer's word wakes it, and it waits on its worker.
    await until(async () => (await runEvents(runId)).some((e) => e.type === "turn-state" && e.to === "waiting"), "the lead to wait for its worker");
    await note('~mcpcall wait {"seconds":30}');
    await until(() => prompts().some((p) => String(p.text).includes('~mcpcall wait {"seconds":30}')) || null, "the lead's wait");
    // Typed while it waits — or just before: the same answer.
    await note(TOLD);
    await until(() => prompts().some((p) => String(p.text).includes(heardBlock([{ text: TOLD }]))) || null, "the developer's message as the lead's next prompt", { timeoutMs: 20_000 });
  } finally {
    release();
  }
  const said = await res.text();
  assert.ok(said.includes(`mcp:${REPLY}`), said.slice(0, 3000));
});
