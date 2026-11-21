// @ts-check
// HarnessV3-Responsiveness R5 (2026-10-01): a model that wanted to wait for its background sub-agents reached for
// bash — the owner's session slept five times for 240–280 s and asked Filament's own API whether its GLM sub-agents
// were done (21 of 50 minutes), and read one report 2.5 minutes after it landed. The loop could always wait properly
// (a reply without a tool call waits, and wakes on the first report), but nothing said so and nothing offered it
// while the model was mid-work. Now `wait` returns the moment a report or a message arrives, the words say never to
// sleep or poll, and a command that only sleeps is refused while a background sub-agent runs.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until } from "./helpers/wait.js";
import { plainSleepSeconds, SLEEP_REFUSAL, SLEEP_REFUSAL_REASON, toolSetFor, SUBAGENT_OFF, FORK_REFUSALS } from "../src/app/agent/tools.js";
import { comeBackLater, comeBackOf, tellLater, takeShellExits } from "../src/adapters/tools/hands.js";
import { wakeLineFor } from "../src/app/sessions/wake.js";
import { houseAuth } from "../src/services/house.js";

const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
const text = (t) => reply([{ type: "text", text: t }]);
const systemOf = (/** @type {any} */ body) => JSON.stringify(body?.system ?? "");
/** The tool results in the request's newest message, by tool_use id. @param {any} body */
const resultsOf = (body) => {
  const last = (body?.messages || []).at(-1);
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const b of Array.isArray(last?.content) ? last.content : []) if (b?.type === "tool_result") out.set(String(b.tool_use_id), JSON.stringify(b.content));
  return out;
};
const lastText = (/** @type {any} */ body) => JSON.stringify((body?.messages || []).at(-1)?.content ?? "");
/** The words that open each turn Filament starts by itself (sessions/wake.js): a command's end, a watch's lines, the time set, Filament's check-in, a report, several at once. */
const WAKES = ["exit", "lines", "wake", "idle", "report", "mixed"].map((kind) => wakeLineFor(kind).slice(0, 40));
const sleepMs = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/**
 * A command that runs until the test lets it end, by the file `gate` in the chat's folder: one that slept a time of its
 * own raced the turn's rounds, which a busy machine runs late (the full suite's flake of 11-04).
 * @param {string} gate
 */
const exitsOn = (gate) => `node -e "const fs=require('fs');setInterval(()=>fs.existsSync('${gate}')&&process.exit(0),50)"`;

describe("plainSleepSeconds: only a command that does nothing but sleep", () => {
  test("the sleeping forms, with their seconds", () => {
    assert.equal(plainSleepSeconds("sleep 240"), 240);
    assert.equal(plainSleepSeconds("  sleep 2m "), 120);
    assert.equal(plainSleepSeconds("sleep 1.5"), 1.5);
    assert.equal(plainSleepSeconds("sleep 30 > /dev/null 2>&1"), 30);
    assert.equal(plainSleepSeconds("timeout /t 60 /nobreak >nul"), 60);
    assert.equal(plainSleepSeconds("Start-Sleep 45"), 45);
    assert.equal(plainSleepSeconds("Start-Sleep -Seconds 45"), 45);
    assert.equal(plainSleepSeconds("Start-Sleep -Milliseconds 9000"), 9);
    assert.equal(plainSleepSeconds('powershell -NoProfile -Command "Start-Sleep -s 20"'), 20);
    assert.equal(plainSleepSeconds("ping -n 31 127.0.0.1 >nul"), 30);
  });
  test("anything that also does work is not a plain sleep", () => {
    for (const c of ["npm test && sleep 5", "sleep 5; cat log.txt", "node -e \"setTimeout(()=>{},60000)\"", "npm test", "ping -n 5 example.com", "echo sleep 60", ""])
      assert.equal(plainSleepSeconds(c), null, c);
  });
  test("wait is the main agent's alone: never offered to a sub-agent, refused in words to a fork", () => {
    assert.ok(toolSetFor({ delegateRead: false }).some((t) => t.name === "wait"));
    assert.ok(SUBAGENT_OFF.includes("wait"));
    assert.match(FORK_REFUSALS.wait, /nothing to wait for/);
  });
});

describe("waiting for background sub-agents, end to end", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-agent-wait-"));
    // What the agent waited on that comes after its turn ended wakes the chat — a background sub-agent's report (the
    // owner's of 10-28), a background command's end, a watch's lines —, often once a later test's brain is the one
    // set: that turn of Filament's is answered in a word, whatever the test's brain does. Run by a later test's brain,
    // it took that test's script for its own.
    up = await fakeUpstream(async (call) => (call.kind === "anthropic" && WAKES.some((w) => lastText(call.body).includes(w)) ? text("noted") : brain(call)));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
  const session = async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true } });
    assert.equal(res.status, 200);
    return { runId: String(res.headers.get("x-filament-request-id") || ""), body: res.text() };
  };
  /** @param {string} runId */
  const events = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=2000`)).json()).events || [];
  const launch = (/** @type {string} */ id) => toolUse(id, "agent", { description: "count the files", prompt: "Count the files in the folder and report the number.", subagent_type: "reviewer", run_in_background: true });

  // (fails before: wait was no tool, so the call errored and nothing woke on the report)
  test("wait returns the moment a background sub-agent reports, and the report comes with it", async () => {
    const id = await session();
    let reportedAt = 0;
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (systemOf(call.body).includes("You are a sub-agent")) {
        await sleepMs(1500); // the sub-agent works a while
        reportedAt = Date.now();
        return text("SUB REPORT: 3 files.");
      }
      const got = resultsOf(call.body);
      if (got.has("w1")) return text("All done: the folder has 3 files.");
      if (got.has("a1")) return reply([toolUse("w1", "wait", { seconds: 120 })], "tool_use");
      return reply([launch("a1")], "tool_use");
    };
    const t = await turn(id, "count the files with a background sub-agent, then wait for it");
    await t.body;
    const ev = await events(t.runId);
    const end = ev.find((e) => e.type === "tool-end" && e.name === "wait");
    assert.ok(end, "the wait ran");
    assert.equal(end.ok, true, JSON.stringify(end));
    assert.ok(reportedAt > 0, "the sub-agent reported");
    assert.ok(end.ms < 15_000, `the wait took ${end.ms} ms of its 120 s: it returned on the report`);
    const final = up.received.filter((c) => c.kind === "anthropic" && !systemOf(c.body).includes("You are a sub-agent")).at(-1);
    assert.match(lastText(final?.body), /a sub-agent reported/, "the wait's result says what woke it");
    assert.match(lastText(final?.body), /SUB REPORT: 3 files/, "and the report rides the same step");
  });

  // (fails before: yes — HarnessV3-Views V6's live run: the lead's answered proposal resumed its turn as a new run that
  // owned none of the workers launched before it, so each of its waits said "Nothing to wait for" at once while its
  // Builder ran, six in 36 s)
  test("a turn resumed after its question still waits on the background sub-agent it launched before it", async () => {
    const id = await session();
    let release = () => {};
    const held = new Promise((r) => (release = () => r(undefined)));
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (systemOf(call.body).includes("You are a sub-agent")) {
        await held; // runs until the test lets it go
        return text("SUB REPORT: 4 files.");
      }
      const got = resultsOf(call.body);
      if (got.has("w4")) return text("done");
      if (got.has("q4")) return reply([toolUse("w4", "wait", { seconds: 300 })], "tool_use");
      return reply([launch("a4"), toolUse("q4", "ask", { question: "Count the hidden files too? I recommend yes." })], "tool_use");
    };
    const asked = await turn(id, "launch one, then ask me");
    await asked.body;
    const answered = await turn(id, "yes");
    await until(async () => (await events(answered.runId)).some((e) => e.type === "tool-start" && e.name === "wait"), "the resumed turn's wait");
    release();
    await answered.body;
    const after = up.received.find((c) => c.kind === "anthropic" && resultsOf(c.body).has("w4"));
    assert.doesNotMatch(lastText(after?.body), /Nothing to wait for/);
    assert.match(lastText(after?.body), /a sub-agent reported/, "the wait waited on the launch made before the question");
    assert.match(lastText(after?.body), /SUB REPORT: 4 files/, "and its report rides the same step");
  });

  test("with nothing running in the background, wait returns at once", async () => {
    const id = await session();
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (resultsOf(call.body).has("w2")) return text("ok");
      return reply([toolUse("w2", "wait", { seconds: 60 })], "tool_use");
    };
    const t = await turn(id, "wait for nothing");
    await t.body;
    const end = (await events(t.runId)).find((e) => e.type === "tool-end" && e.name === "wait");
    assert.ok(end && end.ms < 2000, `returned in ${end?.ms} ms`);
    const final = up.received.filter((c) => c.kind === "anthropic").at(-1);
    assert.match(lastText(final?.body), /Nothing to wait for/);
  });

  test("a message from the developer ends the wait", async () => {
    const id = await session();
    let release = () => {};
    const held = new Promise((r) => (release = () => r(undefined)));
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (systemOf(call.body).includes("You are a sub-agent")) {
        await held; // runs until the test lets it go
        return text("SUB REPORT: late.");
      }
      const got = resultsOf(call.body);
      if (got.has("w3")) return text("heard you");
      if (got.has("a3")) return reply([toolUse("w3", "wait", { seconds: 300 })], "tool_use");
      return reply([launch("a3")], "tool_use");
    };
    const t = await turn(id, "launch one and wait");
    await until(async () => (await events(t.runId)).some((e) => e.type === "tool-start" && e.name === "wait"), "the wait to start");
    const steer = await shim.api(`/api/runs/${encodeURIComponent(t.runId)}/steer`, { method: "POST", body: { kind: "note", text: "also check the tests folder", from: "chat" } });
    assert.equal(steer.status, 200);
    await until(async () => (await events(t.runId)).some((e) => e.type === "tool-end" && e.name === "wait"), "the wait to end on the message", { timeoutMs: 10_000 });
    const end = (await events(t.runId)).find((e) => e.type === "tool-end" && e.name === "wait");
    assert.ok(end.ms < 10_000, `the wait took ${end.ms} ms of its 300 s`);
    release(); // the sub-agent reports; the turn may end
    await t.body;
    const after = up.received.find((c) => c.kind === "anthropic" && resultsOf(c.body).has("w3"));
    assert.match(lastText(after?.body), /the developer sent a message/);
    assert.match(lastText(after?.body), /also check the tests folder/, "and the message rides the same step");
  });

  // (fails before: yes — the wait said "the developer sent a message. It follows." and no message followed: a Compact
  // is acted on, never given to the model)
  test("a Compact pressed during the wait ends it in words that say what it was", async () => {
    const id = await session();
    let release = () => {};
    const held = new Promise((r) => (release = () => r(undefined)));
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (systemOf(call.body).includes("You are a sub-agent")) {
        await held;
        return text("SUB REPORT: late.");
      }
      const got = resultsOf(call.body);
      if (got.has("cw-w1")) return text("noted");
      if (got.has("cw-a1")) return reply([toolUse("cw-w1", "wait", { seconds: 300 })], "tool_use");
      if (/SUB REPORT/.test(lastText(call.body))) return text("all in");
      return reply([launch("cw-a1")], "tool_use");
    };
    const t = await turn(id, "launch one and wait");
    await until(async () => (await events(t.runId)).some((e) => e.type === "tool-start" && e.name === "wait"), "the wait to start");
    const steer = await shim.api(`/api/runs/${encodeURIComponent(t.runId)}/steer`, { method: "POST", body: { kind: "compact", text: "", from: "chat" } });
    assert.equal(steer.status, 200, await steer.clone().text());
    await until(async () => (await events(t.runId)).some((e) => e.type === "tool-end" && e.name === "wait"), "the wait to end on the Compact", { timeoutMs: 10_000 });
    release();
    await t.body;
    const after = up.received.find((c) => c.kind === "anthropic" && resultsOf(c.body).has("cw-w1"));
    assert.match(lastText(after?.body), /the developer asked to compact the conversation/);
    assert.doesNotMatch(lastText(after?.body), /sent a message/);
  });

  // (fails before: yes — a background shell's exit woke neither wait: the model, waiting on a sub-agent, heard of its
  // command's end only once the report came or the 300 s ran out, and the turn's own end waited the same way)
  test("a background command of the model's own that exits ends the wait, and its exit comes with it", async () => {
    const id = await session();
    let release = () => {};
    const held = new Promise((r) => (release = () => r(undefined)));
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (systemOf(call.body).includes("You are a sub-agent")) {
        await held; // runs until the test lets it go
        return text("SUB REPORT: late.");
      }
      const got = resultsOf(call.body);
      if (got.has("shell-w1")) return text("the build is done");
      if (got.has("shell-a1")) return reply([toolUse("shell-w1", "wait", { seconds: 300 })], "tool_use");
      // The report, once the test lets the sub-agent go: the turn ends on it, launching nothing more into the next test.
      if (/SUB REPORT/.test(lastText(call.body))) return text("all in");
      return reply([launch("shell-a1"), toolUse("shell-b1", "bash_background", { command: exitsOn("build-1.done") })], "tool_use");
    };
    const t = await turn(id, "launch one, start the build, and wait");
    await until(async () => (await events(t.runId)).some((e) => e.type === "tool-start" && e.name === "wait"), "the wait to start", { timeoutMs: 30_000 });
    writeFileSync(join(root, "build-1.done"), "");
    await until(async () => (await events(t.runId)).some((e) => e.type === "tool-end" && e.name === "wait"), "the wait to end on the command's exit", { timeoutMs: 15_000 });
    const end = (await events(t.runId)).find((e) => e.type === "tool-end" && e.name === "wait");
    assert.ok(end.ms < 15_000, `the wait took ${end.ms} ms of its 300 s`);
    release(); // the sub-agent reports; the turn may end
    await t.body;
    const after = up.received.find((c) => c.kind === "anthropic" && resultsOf(c.body).has("shell-w1"));
    assert.match(lastText(after?.body), /a background command of yours ended/, "the wait says what woke it");
    assert.match(lastText(after?.body), /exited with code 0/, "and the exit rides the same step");
  });

  test("the turn's own end, waiting on a sub-agent, wakes on its command's exit too, and goes a round with it", async () => {
    const id = await session();
    let release = () => {};
    const held = new Promise((r) => (release = () => r(undefined)));
    /** @type {any} */
    let told = null;
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (systemOf(call.body).includes("You are a sub-agent")) {
        await held;
        return text("SUB REPORT: late.");
      }
      const said = lastText(call.body);
      if (/SUB REPORT/.test(said)) return text("all in");
      if (/exited with code 0/.test(said)) {
        told = call.body;
        return text("the build is done; the count still runs");
      }
      if (resultsOf(call.body).has("shell-a2")) return text("both started");
      return reply([launch("shell-a2"), toolUse("shell-b2", "bash_background", { command: exitsOn("build-2.done") })], "tool_use");
    };
    const t = await turn(id, "launch one, start the build, and end");
    // The command ends once the turn's own end waits on its sub-agent — the case this test is for.
    await until(async () => (await events(t.runId)).some((e) => e.type === "waiting"), "the turn's end to wait on its sub-agent", { timeoutMs: 30_000 });
    writeFileSync(join(root, "build-2.done"), "");
    await until(() => !!told, "a round on the command's exit, before the sub-agent reports", { timeoutMs: 15_000 });
    release();
    await t.body;
    assert.match(lastText(told), /exited with code 0/);
  });

  // (fails before: yes — HarnessV3-Views V6's live run: the developer's message to the lead, typed while the lead
  // decided to wait, was read as the round began and kept for the round's end, so the wait ran on until the worker
  // reported, a minute later)
  test("a message typed while the model decides to wait ends the wait before it starts", async () => {
    const id = await session();
    let release = () => {};
    const held = new Promise((r) => (release = () => r(undefined)));
    let decide = () => {};
    const deciding = new Promise((r) => (decide = () => r(undefined)));
    let asked = false;
    let waited = false;
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (systemOf(call.body).includes("You are a sub-agent")) {
        await held;
        return text("SUB REPORT: late.");
      }
      if (waited) return text("ok");
      const got = resultsOf(call.body);
      if (got.has("w9")) {
        waited = true;
        return text("heard you");
      }
      if (got.has("a9")) {
        asked = true;
        await deciding; // the model decides to wait while the developer types
        return reply([toolUse("w9", "wait", { seconds: 300 })], "tool_use");
      }
      return reply([launch("a9")], "tool_use");
    };
    const t = await turn(id, "launch one and wait");
    try {
      await until(() => asked, "the model to be deciding");
      const steer = await shim.api(`/api/runs/${encodeURIComponent(t.runId)}/steer`, { method: "POST", body: { kind: "note", text: "also check the tests folder", from: "chat" } });
      assert.equal(steer.status, 200);
      decide();
      const after = await until(() => up.received.find((c) => c.kind === "anthropic" && resultsOf(c.body).has("w9")), "the step after the wait to reach the model");
      assert.match(lastText(after?.body), /the developer sent a message/);
      assert.match(lastText(after?.body), /also check the tests folder/, "and the message rides the same step");
      const end = (await events(t.runId)).find((e) => e.type === "tool-end" && e.name === "wait");
      assert.ok(end && end.ms < 2000, `the wait took ${end?.ms} ms`);
    } finally {
      decide();
      release();
      await t.body;
    }
  });

  test("with two running, wait returns on the first report, not on the last", async () => {
    const id = await session();
    let release = () => {};
    const held = new Promise((r) => (release = () => r(undefined)));
    let waited = false;
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (systemOf(call.body).includes("You are a sub-agent")) {
        if (JSON.stringify(call.body.messages).includes("SLOW")) {
          await held;
          return text("SUB REPORT: slow.");
        }
        await sleepMs(800);
        return text("SUB REPORT: fast.");
      }
      if (waited) return text("ok");
      const got = resultsOf(call.body);
      if (got.has("w5")) {
        waited = true;
        return text("the fast one is in");
      }
      if (got.has("a5")) return reply([toolUse("w5", "wait", { seconds: 120 })], "tool_use");
      return reply(
        [
          toolUse("a5", "agent", { description: "fast", prompt: "FAST: count the files.", subagent_type: "reviewer", run_in_background: true }),
          toolUse("a6", "agent", { description: "slow", prompt: "SLOW: count the folders.", subagent_type: "reviewer", run_in_background: true }),
        ],
        "tool_use",
      );
    };
    const t = await turn(id, "launch two and wait");
    try {
      await until(async () => (await events(t.runId)).some((e) => e.type === "tool-end" && e.name === "wait"), "the wait to end on the first report", { timeoutMs: 15_000 });
      // The wait's end is a run event, published before the loop's next call reaches the model: wait for that call.
      const after = await until(() => up.received.find((c) => c.kind === "anthropic" && resultsOf(c.body).has("w5")), "the step after the wait to reach the model");
      assert.match(lastText(after?.body), /a sub-agent reported/);
      assert.match(lastText(after?.body), /SUB REPORT: fast/);
    } finally {
      release();
      await t.body;
    }
  });

  test("a stop ends the wait and the turn at once", async () => {
    const id = await session();
    let release = () => {};
    const held = new Promise((r) => (release = () => r(undefined)));
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (systemOf(call.body).includes("You are a sub-agent")) {
        await held;
        return text("SUB REPORT: late.");
      }
      if (resultsOf(call.body).has("a7")) return reply([toolUse("w7", "wait", { seconds: 300 })], "tool_use");
      return reply([launch("a7")], "tool_use");
    };
    const t = await turn(id, "launch one and wait");
    try {
      await until(async () => (await events(t.runId)).some((e) => e.type === "tool-start" && e.name === "wait"), "the wait to start");
      const t0 = Date.now();
      const stop = await shim.api(`/api/runs/${encodeURIComponent(t.runId)}/steer`, { method: "POST", body: { kind: "stop", text: "", from: "harness" } });
      assert.equal(stop.status, 200);
      const ended = await Promise.race([t.body.then(() => true), sleepMs(10_000).then(() => false)]);
      assert.ok(ended, "the turn ended within 10 s of the stop, not after the wait's 300 s");
      const end = (await events(t.runId)).find((e) => e.type === "tool-end" && e.name === "wait");
      assert.ok(!end || end.ms < 10_000, `the wait took ${end?.ms} ms`);
      assert.ok(Date.now() - t0 < 10_000);
    } finally {
      release();
      await t.body;
    }
  });

  test("a client that hangs up mid-wait ends the wait and the run at once", async () => {
    let release = () => {};
    const held = new Promise((r) => (release = () => r(undefined)));
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (systemOf(call.body).includes("You are a sub-agent")) {
        await held;
        return text("SUB REPORT: late.");
      }
      if (resultsOf(call.body).has("a8")) return reply([toolUse("w8", "wait", { seconds: 300 })], "tool_use");
      return reply([launch("a8")], "tool_use");
    };
    const ctl = new AbortController();
    try {
      const res = await fetch(`${shim.url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", ...houseAuth(), "x-filament-cwd": root, "x-session-id": "s-hangup-wait" },
        body: JSON.stringify({ model: "agent/brain-model", max_tokens: 400, stream: true, messages: [{ role: "user", content: "launch one and wait" }] }),
        signal: ctl.signal,
      });
      const runId = String(res.headers.get("x-filament-request-id") || "");
      assert.ok(runId, "the run has an id");
      await until(async () => (await events(runId)).some((e) => e.type === "tool-start" && e.name === "wait"), "the wait to start");
      const t0 = Date.now();
      ctl.abort();
      await until(async () => (await events(runId)).some((e) => e.type === "run-end"), "the run to end on the hang-up", { timeoutMs: 10_000 });
      assert.ok(Date.now() - t0 < 10_000, "not after the wait's 300 s");
    } finally {
      release();
    }
  });

  // (fails before: the sleep ran, and the report waited behind it)
  test("a command that only sleeps is refused while a background sub-agent runs, and runs when none does", async () => {
    const id = await session();
    let release = () => {};
    const held = new Promise((r) => (release = () => r(undefined)));
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (systemOf(call.body).includes("You are a sub-agent")) {
        await held;
        return text("SUB REPORT: done.");
      }
      // The turn's end waits for the report and goes a round with it: taken for a first call, it launched again and
      // ran a real sleep 30, the test's minute and more.
      if (/SUB REPORT/.test(lastText(call.body))) return text("all in");
      const got = resultsOf(call.body);
      if (got.has("s1")) {
        release();
        return text("ok");
      }
      if (got.has("a4")) return reply([toolUse("s1", "bash", { command: "sleep 30" })], "tool_use");
      return reply([launch("a4")], "tool_use");
    };
    const t = await turn(id, "launch one, then sleep");
    await t.body;
    const end = (await events(t.runId)).find((e) => e.type === "tool-end" && e.name === "bash");
    assert.equal(end?.refused, true, "the sleep was answered in words, never run");
    assert.equal(end?.reason, SLEEP_REFUSAL_REASON, "the card says why, not the permission mode");
    const after = up.received.find((c) => c.kind === "anthropic" && resultsOf(c.body).has("s1"));
    assert.ok(lastText(after?.body).includes(JSON.stringify(SLEEP_REFUSAL).slice(1, 60)), "the model was told why, and to call wait");
    // With nothing running in the background the same kind of command runs (here a short one).
    const id2 = await session();
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (resultsOf(call.body).has("s2")) return text("ok");
      return reply([toolUse("s2", "bash", { command: "sleep 5" })], "tool_use");
    };
    const t2 = await turn(id2, "sleep with nothing running");
    await t2.body;
    const end2 = (await events(t2.runId)).find((e) => e.type === "tool-end" && e.name === "bash");
    assert.notEqual(end2?.refused, true, "not refused: nothing waits behind it");
  });

  // (fails before: yes — the gate asked the developer first, and a yes ran into the refusal: the card asked "May I
  // run `sleep 30`?" for a call Filament was going to refuse whatever the answer)
  test("a sleep that will be refused is refused before anyone is asked about it", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { rules: [{ tool: "bash", pattern: "sleep *", verdict: "ask" }] } } } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    let release = () => {};
    const held = new Promise((r) => (release = () => r(undefined)));
    let refused = false;
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (systemOf(call.body).includes("You are a sub-agent")) {
        await held;
        return text("SUB REPORT: done.");
      }
      const got = resultsOf(call.body);
      if (refused) return text("all in");
      if (got.has("sleep-s1")) {
        refused = true;
        release();
        return text("ok");
      }
      if (got.has("sleep-a1")) return reply([toolUse("sleep-s1", "bash", { command: "sleep 30" })], "tool_use");
      return reply([launch("sleep-a1")], "tool_use");
    };
    const t = await turn(id, "launch one, then sleep");
    await t.body;
    const ev = await events(t.runId);
    assert.ok(!ev.some((e) => e.type === "ask" && e.tool === "bash"), "nobody was asked");
    const end = ev.find((e) => e.type === "tool-end" && e.name === "bash");
    assert.equal(end?.refused, true);
    assert.equal(end?.reason, SLEEP_REFUSAL_REASON);
  });

  // The Hunters' finds of 10-27, each verified against the code before it was fixed.
  // (fails before: yes — a line a watch caught ended the wait as "a background command of yours ended")
  test("a line a watch catches ends the wait in its own words: no command ended", async () => {
    const id = await session();
    let release = () => {};
    const held = new Promise((r) => (release = () => r(undefined)));
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (systemOf(call.body).includes("You are a sub-agent")) {
        await held;
        return text("SUB REPORT: late.");
      }
      const got = resultsOf(call.body);
      if (got.has("watch-w1")) return text("the server is up");
      if (got.has("watch-a1")) return reply([toolUse("watch-w1", "wait", { seconds: 300 })], "tool_use");
      return reply([launch("watch-a1"), toolUse("watch-b1", "bash_background", { command: `node -e "setTimeout(()=>console.log('READY on 3000'),2500);setTimeout(()=>{},6000)"`, watch: "^READY" })], "tool_use");
    };
    const t = await turn(id, "launch one, start the server, and wait");
    try {
      await until(async () => (await events(t.runId)).some((e) => e.type === "tool-end" && e.name === "wait"), "the wait to end on the watched line", { timeoutMs: 15_000 });
    } finally {
      release();
      await t.body;
    }
    const after = up.received.find((c) => c.kind === "anthropic" && resultsOf(c.body).has("watch-w1"));
    assert.match(lastText(after?.body), /a background command you watch printed lines you watch for\. They follow; the command is still running/, "the wait says what came");
    assert.ok(!/a background command of yours ended/.test(lastText(after?.body)), "and no end it did not see");
    assert.match(lastText(after?.body), /READY on 3000/, "the line rides the same step");
  });

  // (fails before: yes — the page's Stop steers the run, which neither dropped the come-back nor held Filament's own
  // turns back: the chat came back by itself after the person stopped it)
  test("the person's Stop on a running turn drops the chat's come-back and holds Filament's own turns back", async () => {
    const id = await session();
    let release = () => {};
    const held = new Promise((r) => (release = () => r(undefined)));
    brain = async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (systemOf(call.body).includes("You are a sub-agent")) {
        await held;
        return text("SUB REPORT: late.");
      }
      if (resultsOf(call.body).has("cb-a1")) return reply([toolUse("cb-w1", "wait", { seconds: 300 })], "tool_use");
      return reply([launch("cb-a1")], "tool_use");
    };
    const t = await turn(id, "launch one and wait");
    try {
      await until(async () => (await events(t.runId)).some((e) => e.type === "tool-start" && e.name === "wait"), "the wait to start");
      comeBackLater(id, { seconds: 600, note: "check again" });
      const stop = await shim.api(`/api/runs/${encodeURIComponent(t.runId)}/steer`, { method: "POST", body: { kind: "stop", text: "", from: "harness" } });
      assert.equal(stop.status, 200);
      assert.equal(comeBackOf(id), null, "the come-back went with the Stop");
    } finally {
      release();
      await t.body;
    }
    tellLater({ session: id, agent: null }, { id: "bg_cb", command: "npm test", code: 0, text: "[Filament: background shell bg_cb (npm test) exited with code 0.]" }, { now: false });
    const woke = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "", wake: true, stream: false } });
    assert.equal(woke.status, 409, await woke.clone().text());
    assert.equal((await woke.json()).wake, "stopped", "Filament starts no turn of its own after the person's Stop");
    takeShellExits({ session: id, agent: null });
  });
});
