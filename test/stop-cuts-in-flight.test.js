// @ts-check
// A stop from the harness cuts the agent loop's in-flight work at once (2026-09-30). The composer's Stop posts a
// `stop` steer to the run (`POST /api/runs/:id/steer`), and the loop used to read it only at its next decision point:
// a running command held that point off until the command's own timeout (a 600 s test run ignored the stop for ten
// minutes; a 120 s sleep ran to its end twice in a live repro). The stop steer now aborts the run's stop signal: the
// command is killed, a held model call is hung up, the calls not started yet are answered "Not run", and the turn
// ends `stopped` in its words — the same ending a stop at a decision point always had.
import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply, parseSse } from "./helpers/app.js";
import { removeDirs, until, upstreamControls } from "./helpers/wait.js";
import { textOpen, textDelta } from "./helpers/sse.js";
import { createEventBus } from "../src/services/events.js";
import { createRunLog } from "../src/services/runs.js";

const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (blocks, stop = "end_turn") =>
  anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** Settle within `ms` or fail saying what did not happen — a broken stop must fail the test, not hang it. */
const within = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} did not happen within ${ms} ms`)), ms).unref())]);
const STOP_NOTE = /\(Filament: the developer stopped this turn after (\d+) tool calls?; what was finished is above\.\)/;
/** The text a streamed Anthropic reply carried, joined. @param {string} raw */
const streamedText = (raw) =>
  parseSse(raw)
    .map((f) => f.data)
    .filter((d) => d?.type === "content_block_delta" && d.delta?.type === "text_delta")
    .map((d) => d.delta.text)
    .join("");

describe("the run's stop signal", () => {
  test("a stop steer aborts the mailbox's stopSignal at once; a note never does; the stop's words stay readable", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-stopsig-"));
    const runs = createRunLog({
      events: createEventBus(),
      dataDir: dir,
      config: () => ({ observability: { runEvents: { persist: false } } }),
      ops: { record: () => {} },
    });
    try {
      runs.startRun({ id: "s1", kind: "agent-turn" });
      const box = runs.mailbox("s1");
      assert.ok(box.stopSignal, "the mailbox hands the loop a stop signal");
      assert.equal(box.stopSignal.aborted, false);
      assert.equal(runs.steer("s1", { kind: "note", text: "keep going" }).ok, true);
      assert.equal(box.stopSignal.aborted, false, "a note waits for the boundary, it never cuts");
      assert.equal(runs.steer("s1", { kind: "stop", text: "", from: "harness" }).ok, true);
      assert.equal(box.stopSignal.aborted, true, "a stop cuts at once, without waiting for a read");
      assert.deepEqual(box.read().map((m) => m.kind), ["note", "stop"], "the message stays queued for the turn's own words");
    } finally {
      runs.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a stop from the harness cuts the loop's in-flight work", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  const { feed, letGo } = upstreamControls();
  afterEach(letGo);
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-stopcut-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    // A command the stop killed may hold its folder a moment past its kill on Windows (EPERM): waited out, not failed on.
    await removeDirs(root);
  });
  /** An agent-loop turn, streamed: the head carries the request id, which is the run's id, while the turn runs. */
  const start = async (content) => {
    const res = await shim.house(
      "/v1/messages",
      { model: "agent/brain-model", max_tokens: 400, stream: true, messages: [{ role: "user", content }] },
      { "x-filament-cwd": root, "x-session-id": `stop-${Math.random().toString(36).slice(2, 8)}` },
    );
    assert.equal(res.status, 200);
    const runId = res.headers.get("x-filament-request-id");
    assert.ok(runId, "the head names the run");
    return { runId: String(runId), body: res.text() };
  };
  const eventsOf = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || [];
  /** Exactly what the composer's Stop sends (src/ui/harness/app.js stopCurrent). */
  const stopFromComposer = async (runId) => {
    const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "stop", text: "", from: "harness" } });
    assert.equal(r.status, 200, await r.text());
  };

  // (fails before: the stop sat queued until the command ended on its own — 15 s here, 600 s in the incident)
  test("a running command is killed on the stop, the calls after it never run, and the turn ends stopped", async () => {
    // A line before the calls, as models usually write: it opens the stream, so the head (the run id) is out at once.
    brain = () => reply([
      { type: "text", text: "Running it." },
      toolUse("b1", "bash", { command: `node -e "setTimeout(()=>{},15000)"` }),
      toolUse("w1", "write", { path: "after-stop.txt", content: "must not be written\n" }),
    ], "tool_use");
    up.reset();
    const { runId, body } = await start("run the long command, then write the file");
    await until(async () => (await eventsOf(runId)).some((e) => e.type === "tool-start" && e.name === "bash"), "the command to start");
    const t0 = Date.now();
    await stopFromComposer(runId);
    const raw = await within(body, 8000, "the turn's end after the stop");
    const took = Date.now() - t0;
    assert.ok(took < 5000, `the stop cut the command: the turn ended ${took} ms after it`);
    assert.ok(took < 8000, `the turn ended ${took} ms after the stop, not when the 15 s command finished`);
    const text = streamedText(raw);
    const note = STOP_NOTE.exec(text);
    assert.ok(note, `the turn closes with the stop note: ${text.slice(-300)}`);
    assert.equal(note[1], "1", "the command counts as the one call that ran");
    assert.equal(up.received.length, 1, "no round after the stop: the model was never asked again");
    assert.ok(!existsSync(join(root, "after-stop.txt")), "the call after the stopped command never ran");
    const ev = await eventsOf(runId);
    const bashEnd = ev.find((e) => e.type === "tool-end" && e.name === "bash");
    assert.ok(bashEnd, "the command's card closed");
    assert.equal(bashEnd.ok, false);
    assert.match(String(bashEnd.preview || ""), /Command stopped with the turn after \d+ seconds/, "killed by the stop, not timed out");
    // BUG-09: a killed process never exited on its own — no "exited with code ?" — and the card draws it softly.
    assert.match(String(bashEnd.preview || ""), /\(the process was stopped with the turn\)/);
    assert.doesNotMatch(String(bashEnd.preview || ""), /exited with code/);
    assert.equal(bashEnd.stopped, true, "the tool end says the stop cut it");
    // The write never ran (no file, above); its card is drawn live as a reload draws it: Stopped, not run (F2 item 12).
    const writeEnd = ev.find((e) => e.type === "tool-end" && e.name === "write");
    assert.equal(writeEnd?.notRun, true, "the write's card says it never ran");
    assert.equal(writeEnd?.stopped, true);
    assert.equal(writeEnd?.ms, 0);
    assert.deepEqual(
      ev.filter((e) => e.type === "steer" || e.type === "steer-read").map((e) => e.type),
      ["steer", "steer-read"],
      "the stop was queued and then read — the timeline's bar leaves \"waiting for the run's next step\"",
    );
    assert.equal(ev.filter((e) => e.type === "turn-state").at(-1)?.to, "stopped");
    assert.equal(ev.at(-1)?.type, "run-end");
    assert.equal(ev.at(-1)?.status, "stopped");
    const rec = await shim.record(runId);
    assert.equal(rec.agent?.status, "stopped", "the record says stopped, not a hang-up");
  });

  // (fails before: the stop waited for a boundary a held model stream never reaches)
  test("a model call the stop lands in is hung up, and the turn ends stopped with what streamed", async () => {
    const stream = feed([...textOpen(), textDelta("Working on it ")]);
    brain = () => stream;
    up.reset();
    const { runId, body } = await start("say something slowly");
    await until(() => up.received.length === 1, "the round's model call to reach the upstream");
    await until(async () => (await eventsOf(runId)).some((e) => e.type === "round-start"), "round 1 to start");
    const t0 = Date.now();
    await stopFromComposer(runId);
    const raw = await within(body, 8000, "the turn's end after the stop");
    assert.ok(Date.now() - t0 < 8000);
    await until(() => stream.cancelled, "the upstream stream to be hung up on");
    const text = streamedText(raw);
    assert.ok(text.includes("Working on it "), "what streamed before the stop stays");
    const note = STOP_NOTE.exec(text);
    assert.ok(note, `the turn closes with the stop note: ${text.slice(-300)}`);
    assert.equal(note[1], "0");
    assert.equal(up.received.length, 1, "no second call");
    const ev = await eventsOf(runId);
    assert.equal(ev.at(-1)?.status, "stopped");
    assert.equal((await shim.record(runId)).agent?.status, "stopped");
  });

  test("a note typed mid-command does not cut it: the command finishes and the note rides the boundary", async () => {
    let round = 0;
    /** @type {any[]} */
    let seen = [];
    brain = (call) => {
      round++;
      if (round === 1) return reply([{ type: "text", text: "Running it." }, toolUse("b1", "bash", { command: `node -e "setTimeout(()=>console.log('finished'),1500)"` })], "tool_use");
      seen = call.body.messages.at(-1)?.content || [];
      return reply([{ type: "text", text: "Heard you." }]);
    };
    up.reset();
    const { runId, body } = await start("run the short command");
    await until(async () => (await eventsOf(runId)).some((e) => e.type === "tool-start" && e.name === "bash"), "the command to start");
    const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text: "also check the logs", from: "harness" } });
    assert.equal(r.status, 200);
    const raw = await within(body, 15000, "the turn's end");
    assert.ok(streamedText(raw).includes("Heard you."));
    const result = seen.find((c) => c?.type === "tool_result");
    assert.ok(result && !result.is_error, "the command ran to its end");
    assert.match(String(result.content), /finished/);
    assert.ok(seen.some((c) => c?.type === "text" && /also check the logs/.test(c.text)), "the note rode with the results");
  });
});
