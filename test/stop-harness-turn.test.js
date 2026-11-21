// @ts-check
// BUG-06 (FILAMENT Bug Tracker, 2026-09-30): a harness turn whose first reply is a bare tool call wrote its reply head
// — the one thing carrying the run id the page steers by — only with the first text or the 15 s heartbeat. For those
// seconds the page had no run id, so Stop took its fallback (POST /sessions/:id/stop), and the route cancelled the
// turn: "aborted — client disconnected", no final archived, the turn lost. And once the head WAS out, the route both
// steered and cancelled, so with another call queued the hang-up check won and the turn still ended "aborted".
// Now the head opens as the run starts, and the route cancels only when its stop did not land as a steer.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply, parseSse, FAKE_ACP_AGENT } from "./helpers/app.js";
import { until, removeDirs, upstreamControls, readEvents } from "./helpers/wait.js";
import { textOpen, textDelta } from "./helpers/sse.js";
import { chainKeyForConversationId } from "../src/services/memory/brain.js";

const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (blocks, stop = "end_turn") =>
  anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** @template T @param {Promise<T>} p @param {number} ms @param {string} what @returns {Promise<T>} */
const within = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} did not happen within ${ms} ms`)), ms).unref())]);
const streamedText = (raw) =>
  parseSse(raw).map((f) => f.data).filter((d) => d?.type === "content_block_delta" && d.delta?.type === "text_delta").map((d) => d.delta.text).join("");

describe("stopping a harness turn in its first seconds", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-stop-harness-"));
    up = await fakeUpstream(async (call) => brain(call));
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
    await removeDirs(shim.dataDir, root);
  });

  // (fails before: the head waited for the 15 s heartbeat; and the route's cancel beat the steer, ending "aborted")
  test("the head names the run at once, and the session's stop ends the turn stopped, never aborted", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = (await r.json()).id;
    // A bare command first (no text: nothing else would open the stream), and a call after it that must never run.
    brain = () => reply([
      toolUse("b1", "bash", { command: `node -e "setTimeout(()=>{},15000)"` }),
      toolUse("w1", "write", { path: "after-stop.txt", content: "must not be written\n" }),
    ], "tool_use");
    up.reset();
    const t0 = Date.now();
    const res = await within(
      shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "run the long command, then write", stream: true } }),
      8000,
      "the reply's head",
    );
    assert.ok(Date.now() - t0 < 8000, "the head came as the run started, not with the 15 s heartbeat");
    assert.equal(res.status, 200);
    const runId = String(res.headers.get("x-filament-request-id") || "");
    assert.ok(runId, "the head carries the run id the page steers by");
    const body = res.text();
    const events = async () => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=500`)).json()).events || [];
    await until(async () => (await events()).some((e) => e.type === "tool-start" && e.name === "bash"), "the command to start");
    // The page's fallback (no run id yet) and any outside caller: the session's stop.
    const stop = await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST" });
    const out = await stop.json();
    assert.equal(stop.status, 200);
    assert.equal(out.stopped, "steered", "the run took the stop as a steer — no cancel under it");
    const raw = await within(body, 8000, "the turn's end after the stop");
    const text = streamedText(raw);
    // The model wrote no words before its command, so the note points at none (HarnessV3-Launch LD-D7).
    assert.match(text, /\(Filament: the developer stopped this turn after 1 tool call; no reply had been written yet\.\)/, text.slice(-300));
    assert.ok(!text.includes("stopped from Filament's harness"), "the note does not quote words the developer never typed");
    assert.ok(!existsSync(join(root, "after-stop.txt")), "the call after the stopped command never ran");
    const ev = await events();
    assert.equal(ev.at(-1)?.type, "run-end");
    assert.equal(ev.at(-1)?.status, "stopped", "stopped, not aborted");
    const rec = await shim.record(runId);
    assert.equal(rec.agent?.status, "stopped");
    assert.equal(rec.agent?.stoppedBy, "harness", "the record says whose stop it was (BUG-07)");
    assert.notEqual(rec.status, "aborted", "the record is no hang-up");
    await until(async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json()).live === null, "the session to be free again");
    // After a reload the turn still reads stopped (BUG-07): the archive stamps it as it stamps a cut reply.
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    const row = (tr.turns || []).find((t) => (t.requestIds || []).includes(runId));
    assert.ok(row, "the stopped turn is in the transcript");
    assert.equal(row.stopped?.by, "harness", `the turn is stamped stopped: ${JSON.stringify(row.stopped)}`);
    assert.ok(!row.open, "and it closed with its note, not left open");
  });

  // (fails before: yes — a turn not streamed writes its head at its end, so the lock named no run: the route cancelled
  // it, "client disconnected", 502, its work unarchived and no stopped mark; found by HarnessV4_Four_Plan §4.5's tests)
  test("a turn not streamed takes the session's stop as a steer too: found by its run, ended stopped with its work", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    const id = (await r.json()).id;
    brain = () => reply([toolUse("b2", "bash", { command: `node -e "setTimeout(()=>{},15000)"` })], "tool_use");
    up.reset();
    const turn = shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "run the long command", stream: false } });
    const run = /** @type {any} */ (await until(async () => {
      const list = (await (await shim.api("/api/runs?kind=agent-turn")).json()).runs || [];
      return list.find((/** @type {any} */ x) => x.meta?.chain === id && x.endedAt == null) || null;
    }, "the turn's run"));
    await until(async () => ((await (await shim.api(`/api/runs/${encodeURIComponent(run.id)}/events?since=0&limit=500`)).json()).events || []).some((/** @type {any} */ e) => e.type === "tool-start" && e.name === "bash"), "the command to start");
    const out = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST" })).json();
    assert.equal(out.holder?.requestId ?? null, null, "the lock names no run: the head is not out");
    assert.deepEqual([out.stopped, out.runs], ["steered", [run.id]], "the run took the stop as a steer, and is named for Force");
    const done = await within(turn, 8000, "the turn's end after the stop");
    assert.equal(done.status, 200, await done.clone().text());
    assert.match(JSON.stringify(await done.json()), /the developer stopped this turn after 1 tool call/);
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.equal(tr.turns?.[0]?.stopped?.by, "harness", "stamped stopped, not lost");
  });

  // (fails before: yes — Compact knew no `onceTurnEnds`: it was refused while the turn ran, "compact when it ends", and
  // a runaway turn's session could be compacted only by a second press after the stop had landed)
  test("Stop and compact: a Compact that waits for the running turn compacts once the stop has ended it; one whose page left compacts nothing", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    const id = (await r.json()).id;
    const at = `/api/sessions/${encodeURIComponent(id)}`;
    // The turn's model call asks for the long command; the call after the stop is the summary's.
    brain = (call) =>
      (call.body?.tools || []).length
        ? reply([toolUse("b1", "bash", { command: `node -e "setTimeout(()=>{},15000)"` })], "tool_use")
        : reply([{ type: "text", text: "The developer asked for a long command; it was stopped before it ended." }]);
    up.reset();
    const res = await within(shim.api(`${at}/turns`, { method: "POST", body: { content: "run the long command", stream: true } }), 8000, "the reply's head");
    const runId = String(res.headers.get("x-filament-request-id") || "");
    const body = res.text();
    const events = async () => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=500`)).json()).events || [];
    await until(async () => (await events()).some((e) => e.type === "tool-start" && e.name === "bash"), "the command to start");
    // Compact alone is refused while the turn runs, as ever.
    const refused = await shim.api(`${at}/compact`, { method: "POST", body: {} });
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /a turn is running in this session; compact when it ends/);
    // The lock's listeners, counted: a wait that ended has let its own go.
    const turns = /** @type {any} */ (shim.app).sessionTurns;
    const subscribe = turns.onChange.bind(turns);
    let waits = 0;
    turns.onChange = (/** @type {string} */ key, /** @type {any} */ fn) => {
      waits++;
      const un = subscribe(key, fn);
      return () => (waits--, un());
    };
    try {
      // A page that asks, then leaves: its wait ends with it.
      const left = new AbortController();
      const gone = fetch(`${shim.url}${at}/compact`, { method: "POST", headers: shim.headers, body: JSON.stringify({ onceTurnEnds: true }), signal: left.signal }).catch((e) => e);
      await until(() => waits === 1, "the first wait to begin");
      left.abort();
      await gone;
      await until(() => waits === 0, "the wait of the page that left to end");
      // A page that asks and stays.
      const asked = shim.api(`${at}/compact`, { method: "POST", body: { onceTurnEnds: true } });
      await until(() => waits === 1, "the wait to begin");
      assert.equal((await (await shim.api(`${at}/transcript`)).json()).live?.requestId, runId, "the turn still runs: the wait cut nothing");
      const stop = await (await shim.api(`${at}/stop`, { method: "POST" })).json();
      assert.equal(stop.stopped, "steered");
      await within(body, 8000, "the turn's end after the stop");
      const done = await within(asked, 8000, "the compaction's answer");
      const out = await done.json();
      assert.equal(done.status, 200, JSON.stringify(out));
      assert.deepEqual([out.ok, out.boundary?.type, out.boundary?.fromTurn, out.boundary?.toTurn], [true, "compaction", 1, 1], "the stopped turn is under the summary");
      assert.equal(waits, 0, "and its wait is over");
      const tr = await (await shim.api(`${at}/transcript`)).json();
      assert.equal(tr.live, null);
      assert.equal((tr.boundaries || []).filter((/** @type {any} */ b) => b.type === "compaction").length + (tr.turns || []).flatMap((/** @type {any} */ t) => [...(t.boundaries || []), ...(t.boundariesAfter || [])]).filter((/** @type {any} */ b) => b.type === "compaction").length, 1, "one compaction: the page that left got none");
    } finally {
      turns.onChange = subscribe;
    }
  });

  // (fails before: no — a guard: the Force stop from the session, for a page with no run id in hand, forces the harness
  // turn's run the session finds while the turn's head is not out)
  test("the session's stop with force forces the harness turn's run while its head is not out: the turn ends force-stopped", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    const id = (await r.json()).id;
    brain = () => reply([toolUse("b3", "bash", { command: `node -e "setTimeout(()=>{},15000)"` })], "tool_use");
    up.reset();
    const turn = shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "run the long command", stream: false } });
    const run = /** @type {any} */ (await until(async () => {
      const list = (await (await shim.api("/api/runs?kind=agent-turn")).json()).runs || [];
      return list.find((/** @type {any} */ x) => x.meta?.chain === id && x.endedAt == null) || null;
    }, "the turn's run"));
    const events = async () => (await (await shim.api(`/api/runs/${encodeURIComponent(run.id)}/events?since=0&limit=500`)).json()).events || [];
    await until(async () => (await events()).some((/** @type {any} */ e) => e.type === "tool-start" && e.name === "bash"), "the command to start");
    const out = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: { force: true } })).json();
    assert.equal(out.holder?.window, "harness", "the harness's turn holds the session");
    assert.equal(out.holder?.requestId ?? null, null, "the lock names no run: the head is not out");
    assert.deepEqual([out.stopped, out.runs], ["forced", [run.id]], "the run the session found was forced");
    const done = await within(turn, 8000, "the turn's end after the force");
    assert.equal(done.status, 200, await done.clone().text());
    assert.match(JSON.stringify(await done.json()), /the developer force-stopped this turn after 1 tool call/);
    const ev = await events();
    assert.ok(ev.some((/** @type {any} */ e) => e.type === "force-stop"), "the run heard a Force stop");
    assert.equal(ev.at(-1)?.status, "stopped", "stopped, not aborted");
    await until(async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json()).live === null, "the session to be free again");
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.equal(tr.turns?.[0]?.stopped?.forced, true, "stamped force-stopped, not lost");
  });

  // (fails before: yes — on b4ee117a2 a Stop with no turn running answered `pending: true` and left `meta.pendingStop` on
  // the chat, which answered an outside client's next tool-call leg with the stop in the model's place)
  test("the session's stop with no turn running reaches none and leaves nothing waiting", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    const id = (await r.json()).id;
    const out = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST" })).json();
    assert.deepEqual(out, { ok: true, holder: null, stopped: null }, "the stop reached no turn");
    const forced = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: { force: true } })).json();
    assert.deepEqual(forced, { ok: true, holder: null, stopped: null }, "nor did the stop with force");
    assert.equal(/** @type {any} */ (shim.app).memory.archive.getChain(id).meta?.pendingStop, undefined, "nothing waits to answer a leg");
  });

  // (fails before: yes — the archive kept the stop note alone, so the next turn's model read that nothing had been
  // written and told the developer so: the drive's S4, HarnessV3-Launch F27)
  test("a reply stopped mid-stream keeps its words: the session's next request carries them, then the note", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = (await r.json()).id;
    const { feed, letGo } = upstreamControls();
    try {
      brain = () => feed([...textOpen(), textDelta("Retry strategies, part one: back off ")]);
      up.reset();
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "write the essay", stream: true } });
      assert.equal(res.status, 200);
      const runId = String(res.headers.get("x-filament-request-id") || "");
      const reading = readEvents(res);
      await until(() => reading.events.some((e) => /part one/.test(String(e.data?.delta?.text || ""))), "the words to stream to the page");
      const stop = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "stop", text: "", from: "harness" } });
      assert.equal(stop.status, 200, await stop.text());
      await until(() => reading.ended, "the turn's end after the stop");
      // The cut words' block closed before the note's (LD-D7): a client that draws no card reads them apart.
      /** @param {RegExp} re */
      const blockOf = (re) => reading.events.find((e) => e.data?.type === "content_block_delta" && re.test(String(e.data.delta?.text || "")))?.data.index;
      assert.equal(typeof blockOf(/the developer stopped/), "number", "the note streamed");
      assert.notEqual(blockOf(/part one/), blockOf(/the developer stopped/), "the note is a block of its own");
      await until(async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json()).live === null, "the session to be free again");
      brain = () => reply([{ type: "text", text: "I was on retries." }]);
      up.reset();
      const next = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "what were you writing?", stream: false } });
      assert.equal(next.status, 200, await next.clone().text());
      const call = up.received.find((c) => c.kind === "anthropic" && /coding agent/.test(JSON.stringify(c.body?.system || "")));
      assert.ok(call, "the loop's call reached the model");
      const msgs = call.body.messages;
      const stopped = msgs[msgs.length - 2];
      assert.equal(stopped.role, "assistant");
      const words = (Array.isArray(stopped.content) ? stopped.content : [{ type: "text", text: stopped.content }]).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      assert.match(words, /^Retry strategies, part one: back off\s+\(Filament: the developer stopped this turn after 0 tool calls; what was finished is above\.\)$/, words);
    } finally {
      letGo();
    }
  });
});

describe("stopping a harness turn with no run under it", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-stop-plain-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        // No loop: the harness's turn is one request to the model, with no run to steer. The loop is always on (the
        // owner's of 11-09) and runs a route whose own upstream is on; this one's is off, and its fallback answers.
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }, { id: "off", name: "off", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: false }];
        cfg.routes = [{ match: "brain-*", upstream: "off", upstreamModel: "{model}", fallbacks: [{ upstream: "m", upstreamModel: "{model}" }], enabled: true }];
        cfg.rules.resilience.failover = true; // the fallback is tried: off until switched on (the owner's of 11-09)
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, root);
  });

  // (fails before: yes — past the lease the lock named nobody, and the route never tried the turn's own cancel: a turn
  // with no run under it — a plain model's, one still composing — worked on under a Stop. Now the lock keeps naming it,
  // however long it is silent)
  test("a turn silent for hours is still the lock's, and the session's stop cancels it", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = (await r.json()).id;
    const { feed, letGo } = upstreamControls();
    try {
      brain = () => feed([...textOpen(), textDelta("A long answer, part one ")]);
      up.reset();
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "write at length", stream: true } });
      assert.equal(res.status, 200);
      const reading = readEvents(res);
      await until(() => reading.events.some((e) => /part one/.test(String(e.data?.delta?.text || ""))), "the words to stream to the page");
      assert.deepEqual(/** @type {any} */ (shim.app).runs.runningIn(id), [], "no run under the turn");
      const turns = /** @type {any} */ (shim.app).sessionTurns;
      const realNow = turns.now;
      turns.now = () => realNow() + 10 * 60 * 60_000;
      const back = () => void (turns.now = realNow);
      try {
        const out = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST" })).json();
        assert.deepEqual([out.holder?.window, out.stopped, out.runs, out.pending], ["harness", "cancelled", undefined, undefined]);
        await until(() => reading.ended, "the turn's end after the cancel");
        await until(async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json()).live === null, "the session to be free again");
      } finally {
        back();
      }
    } finally {
      letGo();
    }
  });
});

describe("the session's stop and an outside client's coding-agent turn", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {string} */
  let gate;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-stop-acp-"));
    // The file the fake agent's `~slowtool` command runs until: written, the command ends and the turn with it.
    gate = join(root, "tool-gate");
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "acp", name: "acp", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_TOOL_GATE: gate }, cwdDefault: root, permissions: "allow-all", hints: false } }];
        cfg.routes = [{ match: "acp-*", upstream: "acp", upstreamModel: "{1}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
      },
    });
  });
  after(async () => {
    writeFileSync(gate, "");
    await shim.stop();
    await removeDirs(shim.dataDir, root);
  });

  // (fails before: yes — on b4ee117a2, with the client's lease run out, the route found the client's coding-agent run by
  // the session (`runs.runningIn`) and steered it to a stop: the session's Stop ended another client's turn; on
  // faa022089 the turn gate's lock named the client's window while its turn ran)
  test("a coding-agent turn an outside client runs holds no lock, and the session's stop leaves its run running", async () => {
    const sid = "stop-outside-acp";
    const res = shim.post("/v1/messages", { model: "acp-x", max_tokens: 100, stream: true, messages: [{ role: "user", content: "~slowtool" }] }, { "x-session-id": sid, "x-filament-cwd": root, "user-agent": "opencode/1.0" });
    const id = String(await until(() => /** @type {any} */ (shim.app).memory.archive.chainIdForKey(chainKeyForConversationId(sid)) || null, "the client's session to have its chain"));
    const run = /** @type {any} */ (await until(async () => {
      const list = (await (await shim.api("/api/runs?kind=coding-agent")).json()).runs || [];
      return list.find((/** @type {any} */ x) => x.meta?.chain === id && x.endedAt == null) || null;
    }, "the client's coding-agent run"));
    const events = async () => (await (await shim.api(`/api/runs/${encodeURIComponent(run.id)}/events?since=0&limit=500`)).json()).events || [];
    await until(async () => (await events()).some((/** @type {any} */ e) => e.type === "tool-start"), "the agent's command to start");
    const app = /** @type {any} */ (shim.app);
    assert.equal(app.sessionTurns.holder(app.memory.archive.getChain(id).key), null, "the lock names nobody");
    const out = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST" })).json();
    assert.deepEqual(out, { ok: true, holder: null, stopped: null }, "the stop reached no turn of the harness's");
    const forced = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: { force: true } })).json();
    assert.deepEqual(forced, { ok: true, holder: null, stopped: null }, "nor did the stop with force");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(/** @type {any} */ (shim.app).runs.getRun(run.id)?.endedAt ?? null, null, "the client's run still runs");
    assert.ok(!(await events()).some((/** @type {any} */ e) => e.type === "steer" || e.type === "force-stop" || e.type === "stopped"), "and heard no stop");
    writeFileSync(gate, "");
    const reply = await within(res, 15000, "the client's reply");
    const text = streamedText(await within(reply.text(), 15000, "the client's reply to end"));
    assert.match(text, /All 42 tests passed\./, "the turn ran to its own end");
    assert.ok(!/stopped this turn/.test(text), "with no stop note");
    await until(() => /** @type {any} */ (shim.app).runs.getRun(run.id)?.endedAt != null, "the run's end");
    assert.notEqual(/** @type {any} */ (shim.app).runs.getRun(run.id)?.status, "stopped", "ended as it ran, not stopped");
  });
});
