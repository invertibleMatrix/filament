// The context-fit contract (2026-09-28): NOTHING rewrites a request between a client and its provider — not
// proactively when the window is known, not reactively after a refusal, not by a local 413. The stage observes
// (rec.context on every request); the person drives with /autofit (the manual, fit-aware compact: the smallest
// prefix of oldest turns that holds the margin, verified by recomposing).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";
import { detectOverflow } from "../src/core/autofit.js";
import { clearResults } from "../src/app/sessions/shapes.js";
import { houseAuth } from "../src/services/house.js";
import { fakeUpstream, anthropicReply, startApp, TEST_ENVIRONMENT } from "./helpers/app.js";
import { until, readEvents } from "./helpers/wait.js";
import { parseAutofitCommand } from "../src/app/commands/parse.js";
import { COMPACTION_SYSTEM } from "../src/app/sessions/compaction.js";
import { LEARN_PROMPT } from "../src/services/memory/learn.js";

/** Whether a provider call is the compaction model's summary (its system prompt says so). @param {any} call */
const isSummaryCall = (call) => JSON.stringify(call.body?.system ?? "").includes(COMPACTION_SYSTEM.slice(0, 40));

/**
 * The harness sessions below run on the agent loop, and every request it sends carries its own part beside the
 * history: its system prompt and tool schemas, ~6,700 tokens on Windows at prompt v11. `/autofit` weighs that part
 * too (HarnessV3-Tools TL-D9), so each scenario places its window and compaction line around it, measured as the New
 * Task board and the loop's window event measure it (draft-start's `loopFixed`) — never sized by hand, which every
 * growth of the prompt or the tools broke. `target` is where the fit's margin of the line lands above that part (the
 * history a fit may leave), `room` the window above it (the history a turn can send); without `room`, the window is
 * the line. The percent is a whole number (the knob's type), rounded up, so the target lands at most a window's
 * hundredth higher. A part grown past what a scenario can hold fails here, in words, not somewhere downstream.
 * @param {any} shim @param {{ target: number, room?: number | null, margin?: number }} o
 * @returns {Promise<{ fixed: number, window: number, percent: number, settings: any }>}
 */
async function sizeAround(shim, { target, room = null, margin = 0.85 }) {
  let fixed = 0;
  let window = 0;
  let line = 0;
  // The prompt names the window, so the part is measured again once the window is set — a digit more or less.
  for (let pass = 0; pass < 2; pass++) {
    const d = await (await shim.api("/api/sessions/draft-start", { method: "POST", body: { cwd: shim.dataDir, model: "m-1", settings: LEAN } })).json();
    fixed = Number(d.loopFixed);
    assert.ok(fixed > 0, `the loop's own part is measured: ${JSON.stringify(d.engine)}`);
    line = Math.ceil((fixed + target) / margin);
    window = room == null ? line : fixed + room;
    const st = await (await shim.api("/api/state")).json();
    const upstreams = st.config.upstreams.map((u) => (u.id === "m" ? { ...u, pricing: { "m-1": { input: 1, output: 1, contextTokens: window } } } : u));
    const put = await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams } });
    assert.equal(put.status, 200, await put.text());
  }
  const percent = Math.ceil((100 * line) / window);
  assert.ok(percent <= 100, `the loop's own part (${fixed} tokens) has outgrown this scenario: its line (${line}) is past its window (${window})`);
  return { fixed, window, percent, settings: { ...LEAN, context: { compaction: { thresholdPercent: percent } } } };
}

/**
 * The tools a new chat has on by default since 10-23 (HarnessV4_AgentTools_Plan AT-D1) — the web's and the browser —
 * and the visuals', the artifacts', the Space's, the team tool and the flow tool switched off in these scenarios: each
 * sizes a small window around the loop's own part, and the fit's moves are what they test, the part's size the alarm
 * above. The task graph has no switch (always on, the owner's word of 10-29), so the others make its room.
 */
const LEAN = { plugins: { web: { fetch: false, search: false }, browser: false }, loop: { tools: { show_visual: false, artifact: false, space: false, team: false, flow: false } } };

/** The loop's window event for a turn: its window and its own part, as it measured them. @param {any} shim @param {Response} r */
const windowEventOf = async (shim, r) => {
  const rid = r.headers.get("x-filament-request-id");
  const events = (await (await shim.api(`/api/runs/${encodeURIComponent(String(rid))}/events?limit=500`)).json()).events || [];
  return events.find((/** @type {any} */ e) => e.type === "window");
};
/** A loop turn that stopped at the window instead of reaching the model says this. */
const STOPPED_AT_WINDOW = /cannot make the request fit/;

// ---- the pure pieces: the refusal reader the agent loop's own recovery uses, the session policy's clearing ----
test("detectOverflow: provider error shapes, limits parsed, non-overflow rejected", () => {
  const a = detectOverflow(`{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 123456 tokens > 200000 maximum"}}`);
  assert.deepEqual(a, { limit: 200000 });
  const o = detectOverflow(`{"error":{"message":"This model's maximum context length is 8192 tokens. However, you requested 12345 tokens."}}`);
  assert.deepEqual(o, { limit: 8192 });
  assert.deepEqual(detectOverflow(`{"error":{"message":"prompt is too long: 9000 tokens, 8000 maximum"}}`), { limit: 8000 });
  assert.equal(detectOverflow(`{"error":{"message":"Invalid model name"}}`), null);
  assert.equal(detectOverflow(`{"error":{"message":"max_tokens is too large: 100000"}}`), null);
});

test("clearResults: the session policy's own clearing, unchanged by the fit contract", () => {
  const mk = (n, text) => [
    { role: "user", content: "go" },
    { role: "assistant", content: [{ type: "tool_use", id: `t${n}`, name: "read", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: `t${n}`, content: text }] },
  ];
  const messages = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => mk(n, "R".repeat(100)));
  const out = clearResults(messages, { keepRecent: 5 });
  assert.equal(out.cleared, 3, "everything older than the newest five");
  const cleared = JSON.stringify(out.messages).match(/\[Old tool result content cleared\]/g) || [];
  assert.equal(cleared.length, 3);
  assert.ok(JSON.stringify(out.messages).includes("R".repeat(100)), "the newest results stay whole");
});

test("parseAutofitCommand: bare, a margin, or status — and the command must lead", () => {
  const pick = (r) => (r ? { rest: r.rest } : null);
  assert.deepEqual(pick(parseAutofitCommand("/autofit")), { rest: "" });
  assert.deepEqual(pick(parseAutofitCommand("/autofit 70")), { rest: "70" });
  assert.deepEqual(pick(parseAutofitCommand("/autofit 50%")), { rest: "50%" });
  assert.deepEqual(pick(parseAutofitCommand("/autofit status")), { rest: "status" });
  assert.equal(parseAutofitCommand("please /autofit"), null, "the command must lead the message");
  assert.equal(parseAutofitCommand("/autofitting"), null, "the word is whole");
});

// ---- through the real server: nothing ever sits between the client and its provider ----
let fake, app, port, dataDir, calls;
before(async () => {
  calls = [];
  fake = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const body = JSON.parse(b); calls.push(body);
    if (body.model === "claude-refuse") {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 9000 tokens > 20000 maximum" } }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_x", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "as sent" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 3 } }));
  }); });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  dataDir = mkdtempSync(join(tmpdir(), "filament-autofit-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.upstreams = [{ id: "m", name: "m", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${fake.address().port}`, apiKey: "s", pricing: { "claude-x": { input: 1, output: 1, contextTokens: 8000 } } }];
  cfg.routes = [{ match: "claude-*", upstream: "m", upstreamModel: "{model}" }];
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); fake.close(); rmSync(dataDir, { recursive: true, force: true }); });

const post = (body, headers = {}) => fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k", ...headers }, body: JSON.stringify(body) });
const recs = async (n = 5, scope = "") => (await (await fetch(`http://127.0.0.1:${port}/api/requests?limit=${n}${scope}`)).json()).requests;

test("a request past the window reaches the provider UNTOUCHED — no proactive ladder, no local 413", async () => {
  calls.length = 0;
  const messages = [];
  for (let i = 0; i < 8; i++)
    messages.push(
      { role: "user", content: `turn ${i}` },
      { role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "read", input: { path: `f${i}` } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "R".repeat(4000) }] },
    );
  messages.push({ role: "user", content: "the real question" });
  const r = await post({ model: "claude-x", max_tokens: 100, messages });
  assert.equal(r.status, 200, "the provider answered — it was the one asked");
  assert.equal(calls.length, 1, "one request: nothing was compacted, cleared or retried on the way");
  assert.equal(calls[0].messages.length, messages.length, "the body reached the provider as the client wrote it");
  assert.ok(!JSON.stringify(calls[0]).includes("[Old tool result content cleared"), "no result was touched");
  const rec = (await recs())[0];
  assert.ok(!rec.autofit, "no ladder bookkeeping — there is no ladder");
  assert.ok(rec.context, "the observation is stamped");
  assert.equal(rec.context.window, 8000);
  assert.equal(rec.context.source, "operator");
  assert.ok(rec.context.estimate > 8000, `the estimate says what the request wants: ${rec.context.estimate}`);
  assert.equal(rec.context.verdict, "over", "the verdict says over — and the request went out anyway");
});

test("a provider's size refusal reaches the client unchanged — no reactive retry", async () => {
  calls.length = 0;
  const messages = [];
  for (let i = 0; i < 8; i++) messages.push({ role: "user", content: `turn ${i} ${"filler ".repeat(120)}` }, { role: "assistant", content: `ok ${i}` });
  messages.push({ role: "user", content: "the real question" });
  const r = await post({ model: "claude-refuse", max_tokens: 100, messages });
  assert.equal(r.status, 400, "the client hears the provider's own refusal");
  assert.match(await r.text(), /prompt is too long/, "in the provider's words");
  assert.equal(calls.length, 1, "exactly one request: nothing retried behind the client's back");
});

test("the loop's own rounds are stamped like any other — and equally never rewritten", async () => {
  calls.length = 0;
  const messages = [];
  for (let i = 0; i < 10; i++) messages.push({ role: "user", content: `turn ${i} ${"filler ".repeat(120)}` }, { role: "assistant", content: `ok ${i}` });
  messages.push({ role: "user", content: "the real question" });
  const r = await post({ model: "claude-x", max_tokens: 100, messages }, { ...houseAuth(), "x-filament-agent-of": "parent-1" });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages.length, messages.length, "the round's body reached the provider untouched");
  const rec = (await recs(3, "&scope=all")).find((x) => x.agentOf === "parent-1");
  assert.ok(rec, "the round's record hangs off the parent");
  assert.ok(!rec.autofit, "no ladder — for anyone");
});

// ---- /autofit: the person's one move ----
describe("/autofit — the manual fit", () => {
  let shim, up, sized;
  /** Set once a session has frozen its Environment: the machine's capture then reads differently. */
  let recaptured = false;
  /** While set, the upstream holds every call until it opens: a summary being written. @type {Promise<void> | null} */
  let held = null;
  /** While set, the upstream answers as heavily as it answers its first call: a session that needs a fit. */
  let heavy = false;
  before(async () => {
    up = await fakeUpstream(async (call) => {
      if (held) await held;
      return anthropicReply("", { model: call.body?.model || "m-1", stop: "end_turn", blocks: [{ type: "text", text: up.received.length <= 1 || heavy ? "HEAVY TURN ONE. " + "detail ".repeat(1600) : "light." }], usage: { input_tokens: 5, output_tokens: 3 } });
    });
    shim = await startApp({
      memory: true,
      summarizer: "m-1",
      environment: async (root) => {
        const f = await TEST_ENVIRONMENT(root);
        return recaptured ? { ...f, system: { ...f.system, name: "Test OS 1, captured again after the session froze its own, with a longer name" } } : f;
      },
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
    // Turn one's reply is ~2,400 tokens: every turn fits the window beside it, and the fit's target is under it. The
    // room was 4,200 until the loop's part passed 13,800 tokens with the envelope tool (HarnessV4_Envelopes_Plan EN2),
    // 4,300 until it passed 14,350 with the Space's drafts (HarnessV4_Space_Plan S5c), 4,400 until it passed 15,100 with
    // its repro (S7), 4,500 until it passed 15,500 with letters between an agent and its sub-agents (11-04), 4,600 until
    // it passed 16,300 with the graph's steps, find and the plan's offer (the owner's plan mode of 11-06), 5,000 until
    // it passed 18,333 with the shell tools' sentence on the filtered environment (version 123).
    sized = await sizeAround(shim, { room: 5300, target: 1500 });
  });
  after(async () => { await shim.stop(); await up.close(); });

  const createSession = async (model, cwd = shim.dataDir) => (await (await shim.api("/api/sessions", { method: "POST", body: { cwd, model, settings: sized.settings } })).json());
  const turn = async (id, text) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: text } });
    const body = await r.text();
    assert.equal(r.status, 200, body);
    assert.doesNotMatch(body, STOPPED_AT_WINDOW, `"${text}" reached the model`);
    return r;
  };

  test("the fit: over a small window, one /autofit compacts the smallest prefix and the numbers say so", async () => {
    const { id } = await createSession("m-1");
    await turn(id, "turn one");
    await turn(id, "turn two");
    await turn(id, "turn three");
    const status = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/autofit`, { method: "POST", body: { status: true } })).json();
    assert.equal(status.action, "status");
    assert.ok(status.window === sized.window, `the window the fit judges by: ${JSON.stringify(status)}`);
    assert.ok(status.now > 0, "the current estimate is stated");
    // (fails before: yes — HarnessV4_Tasks U3-5: it was said on the session's own topic, which a page then followed only
    // while an outside client held the turn, so no page heard a compaction of its own chat) on the events feed every
    // page holds (HarnessV3-Responsiveness R3), with its session's id: its door, who writes the summary, its call as
    // the request log saw it run and end (this fake answers whole, so there is nothing streamed to count: the counts
    // are sessions-api's test), its end
    const feed = readEvents(await shim.api("/api/events"));
    const heard = () => feed.events.filter((e) => e.data?.type === "compaction-progress" && e.data.chainId === id).map((e) => e.data.progress);
    /** Each topic the bus said a compaction's progress on. */
    const topics = new Set();
    const off = shim.app.events.subscribe("*", (/** @type {any} */ p, /** @type {any} */ e) => void (p?.type === "compaction-progress" && topics.add(e.topic)));
    /** @type {any} */
    let done;
    try {
      await until(() => feed.events.some((e) => e.data?.type === "hello"), "the feed to open");
      done = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/autofit`, { method: "POST", body: {} })).json();
      await until(() => heard().length > 1 && heard().at(-1) === null, "the fit's end on the feed");
    } finally {
      off();
      await feed.stop();
    }
    const said = heard();
    assert.deepEqual([...topics], ["compactions"], "said once, on the feed's `compactions` topic alone");
    assert.equal(said[0]?.door, "autofit");
    assert.ok(said.some((p) => / writes the summary in one call$/.test(p?.step || "")), JSON.stringify(said));
    assert.ok(said.some((p) => p?.calls.running === 1) && said.some((p) => p?.calls.done === 1), JSON.stringify(said));
    assert.equal(said.at(-1), null);
    assert.equal(done.action, "compacted", done.note);
    assert.equal(done.compaction.kind, "autofit");
    assert.equal(done.compaction.method, "summary", "a fit is a summary of its cut (HarnessV3-Compaction §5)");
    assert.equal(done.compaction.fromTurn, 1, "the fit starts at the front");
    assert.ok(done.compaction.toTurn < 3, "the SMALLEST prefix — not every turn");
    assert.ok(done.after <= Math.floor(done.usable * 0.85) + 400, `the next request holds the margin: after ${done.after} of usable ${done.usable}`);
    // Learning from sessions is off here (the helper's default): the fit says so, and starts no run (HarnessV3-Memory M7-D27).
    assert.deepEqual(done.learning, { learning: false, why: "learning from sessions is off in Memory settings" });
    assert.ok(done.note.endsWith("; nothing learned from them now: learning from sessions is off in Memory settings."), done.note);
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    const b = (tr.boundaries || []).find((x) => x.type === "compaction");
    assert.ok(b, "the boundary row landed for the timeline");
    assert.equal(b.kind, "autofit");
    assert.equal(b.method, "summary");
  });

  // (fails before: yes — HarnessV4_Tasks U3-5: a fit's summary had no stop, its own or a turn's, and the route did not
  // exist; the page could only wait for it)
  test("a fit being written is stopped from its session: nothing is written, and the fit answers that it was stopped", async () => {
    const { id } = await createSession("m-1");
    heavy = true;
    await turn(id, "turn one").finally(() => (heavy = false));
    await turn(id, "turn two");
    await turn(id, "turn three");
    const at = `/api/sessions/${encodeURIComponent(id)}`;
    const none = await shim.api(`${at}/compact/stop`, { method: "POST", body: {} });
    assert.deepEqual([none.status, (await none.json()).error], [409, "no compaction is being written for this session"]);
    let open = () => {};
    held = new Promise((res) => (open = res));
    try {
      const fit = shim.api(`${at}/autofit`, { method: "POST", body: {} });
      // A page opened while it runs reads it with the transcript: its door, and that it can be stopped.
      const now = await until(async () => (await (await shim.api(`${at}/transcript`)).json()).compacting, "the fit to be running");
      assert.deepEqual([now.door, now.stoppable], ["autofit", true]);
      const stop = await shim.api(`${at}/compact/stop`, { method: "POST", body: {} });
      assert.deepEqual([stop.status, await stop.json()], [200, { ok: true }]);
      const res = await fit;
      const said = await res.json();
      assert.deepEqual([res.status, said.stopped, said.error], [409, true, "stopped before anything was written"]);
    } finally {
      open();
      held = null;
    }
    assert.equal(shim.app.memory.archive.getCompactions(id).length, 0, "nothing was written");
    assert.equal((await (await shim.api(`${at}/transcript`)).json()).compacting, null);
    const fit = await (await shim.api(`${at}/autofit`, { method: "POST", body: {} })).json();
    assert.equal(fit.action, "compacted", "a stop is no failure of the session's: the fit works after it");
    assert.ok(fit.boundary.detail.ms >= 0, "and its row keeps how long it took");
    // (fails before: yes — the look of U3-5: the row drawn at once had no summary to open)
    const drawn = (await (await shim.api(`${at}/transcript`)).json()).boundaries.find((/** @type {any} */ b) => b.type === "compaction");
    assert.ok(drawn.text, "the transcript's row carries the summary");
    assert.equal(fit.boundary.text, drawn.text, "and so does the row the page draws at once, to open under Show summary");
  });

  // (fails before: yes — the fit compacted under the question that waited for the person's answer: "compacted")
  test("a question waits for the person's answer: the fit writes nothing and says why; its numbers are still said", async () => {
    const { id } = await createSession("m-1");
    heavy = true;
    await turn(id, "turn one").finally(() => (heavy = false));
    await turn(id, "turn two");
    await turn(id, "turn three");
    const at = `/api/sessions/${encodeURIComponent(id)}`;
    // The question a turn of Filament's loop parks on its session as it pauses for the person's answer.
    const archive = shim.app.memory.archive;
    archive.mergeMeta(id, { paused: { kind: "ask", question: "Which parser?", requestId: "req-asked", at: Date.now(), expires: Date.now() + 3_600_000 } });
    try {
      const status = await (await shim.api(`${at}/autofit`, { method: "POST", body: { status: true } })).json();
      assert.equal(status.action, "status", "its numbers write nothing: said as ever");
      const r = await shim.api(`${at}/autofit`, { method: "POST", body: {} });
      assert.deepEqual([r.status, (await r.json()).error], [409, "a question waits for your answer: answer it first, then /autofit"]);
      assert.equal(archive.getCompactions(id).length, 0, "nothing was written");
    } finally {
      archive.mergeMeta(id, { paused: undefined });
    }
    assert.equal((await (await shim.api(`${at}/autofit`, { method: "POST", body: {} })).json()).action, "compacted", "answered, the fit works");
  });

  test("inside the margin: nothing is written", async () => {
    const { id } = await createSession("m-1");
    await turn(id, "only turn");
    const out = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/autofit`, { method: "POST", body: {} })).json();
    assert.equal(out.action, "none", out.note);
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.ok(!(tr.boundaries || []).some((x) => x.type === "compaction"), "no compaction was invented");
  });

  // (fails before: yes — the fit weighed the history alone, ~6,700 tokens under what the loop sends)
  for (const where of ["a folder", "a linked folder"]) {
    test(`the fit weighs what the loop sends: its own prompt and tools beside the history, as the loop measures them — in ${where} (TL-D9)`, async () => {
      let cwd = shim.dataDir;
      if (where === "a linked folder") {
        cwd = join(shim.dataDir, "work");
        mkdirSync(cwd, { recursive: true });
      }
      const { id } = await createSession("m-1", cwd);
      if (where === "a linked folder") {
        // The folder moved after the session began, a link left in its place: the loop works where the link
        // resolves, and freezes that folder's Environment.
        renameSync(cwd, join(shim.dataDir, "work-moved"));
        symlinkSync(join(shim.dataDir, "work-moved"), cwd, "junction");
      }
      const ev = await windowEventOf(shim, await turn(id, "a light turn"));
      assert.ok(ev?.fixed > 0, `the loop measured its own part: ${JSON.stringify(ev)}`);
      const history = (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/compose?dry=1&prompt=1`)).json()).current.tokens;
      // The session froze its Environment on that turn; the next turn sends those bytes, whatever the machine reads now.
      recaptured = true;
      try {
        const out = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/autofit`, { method: "POST", body: { status: true } })).json();
        assert.equal(out.fixed, ev.fixed, "the loop's own part, as the loop's window event measured it — with the Environment the session froze");
        assert.equal(out.now, ev.fixed + history, "the request: the loop's part and the history composed");
        assert.match(out.note, new RegExp(`its prompt and tools ≈${ev.fixed.toLocaleString("en-US")}`), out.note);
      } finally {
        recaptured = false;
      }
    });
  }

  // (fails before: yes — the fit knew nothing of the loop's part, so it offered a cut no compaction could make enough)
  test("the loop's own part alone past the target: no cut is offered or written, and the note says what would help", async () => {
    const { id } = await createSession("m-1");
    await turn(id, "a light turn");
    const status = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/autofit`, { method: "POST", body: { status: true, margin: 0.3 } })).json();
    assert.ok(status.fixed >= Math.floor(status.usable * 0.3), `the precondition: the part alone is past 30% of the line: ${JSON.stringify(status)}`);
    assert.equal(status.action, "status");
    assert.equal(status.wouldCompact, undefined, "no cut is offered");
    assert.match(status.note, /past the .* target .* on its own: compacting the history cannot reach it/, status.note);
    assert.doesNotMatch(status.note, /MCP/, "a session without MCP servers is not told to switch them off (TL-D22)");
    const out = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/autofit`, { method: "POST", body: { margin: 0.3 } })).json();
    assert.equal(out.action, "none", out.note);
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.ok(!(tr.boundaries || []).some((x) => x.type === "compaction"), "nothing was written");
  });
});

// ---- the fit learns what it compacted (HarnessV3-Memory M7-D27) ----
describe("/autofit learns what it compacted", () => {
  let shim, up, sized;
  /** What each learning call was given to read. @type {string[]} */
  const learned = [];
  before(async () => {
    up = await fakeUpstream(async (call) => {
      const model = call.body?.model || "m-1";
      if (JSON.stringify(call.body?.system ?? "").includes(LEARN_PROMPT.slice(0, 60))) {
        learned.push([].concat(call.body.messages[0].content).map((b) => (typeof b === "string" ? b : b.text)).join(""));
        return anthropicReply(JSON.stringify({ title: "The heavy work", state: { summary: "a heavy turn, then light ones" }, turns: [], items: [] }), { model });
      }
      const last = [...(call.body?.messages || [])].reverse().find((m) => m.role === "user");
      const said = typeof last?.content === "string" ? last.content : (last?.content || []).map((b) => b?.text || "").join("");
      return anthropicReply("", { model, stop: "end_turn", blocks: [{ type: "text", text: /heavy/.test(said) ? "HEAVY TURN. " + "detail ".repeat(1600) : "light." }], usage: { input_tokens: 5, output_tokens: 3 } });
    });
    shim = await startApp({
      memory: true,
      summarizer: "m-1",
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.capture = { ...cfg.memory.capture, learn: true };
        cfg.memory.models = { summarizer: "m-1", curator: "off" };
      },
    });
    sized = await sizeAround(shim, { room: 5300, target: 1500 });
  });
  after(async () => { await shim.stop(); await up.close(); });

  test("the fit's compaction starts its learning run, named by its door: every finished turn read, oldest first, and the note, the answer and the op say so", async () => {
    const { id } = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model: "m-1", settings: sized.settings } })).json();
    for (const text of ["the heavy turn one", "turn two", "turn three"]) {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: text } });
      const body = await r.text();
      assert.equal(r.status, 200, body);
      assert.doesNotMatch(body, STOPPED_AT_WINDOW, `"${text}" reached the model`);
    }
    const out = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/autofit`, { method: "POST", body: {} })).json();
    assert.equal(out.action, "compacted", out.note);
    assert.deepEqual(out.learning, { learning: true, model: "m-1" });
    assert.ok(out.note.endsWith("; learning from them now on m-1."), out.note);
    await shim.app.memory.learner.settled();
    const ops = async (kind) => (await (await shim.api(`/api/ops?limit=200&kinds=${kind}`)).json()).ops;
    const op = (await ops("compaction")).find((o) => o.detail?.chainId === id);
    assert.deepEqual([op?.sub, op?.detail?.learning], ["autofit", "started"]);
    const starts = (await ops("learner")).filter((o) => o.sub === "start" && o.detail?.chain === id);
    assert.deepEqual(starts.map((o) => [o.detail.reason, o.detail.door, o.detail.fromTurn, o.detail.toTurn]), [["compaction", "autofit", 1, 3]]);
    assert.equal(learned.length, 1, "one pass");
    assert.match(learned[0], /Session turns 1 to 3:\n\n### Turn 1 [^\n]*\nUser: the heavy turn one\n/);
    assert.equal(shim.app.memory.archive.getChain(id).meta.learnedThrough, 3, "the cursor at the newest turn");
  });
});

// ---- the deepen: a summary fatter than the first guess cuts deeper BEFORE anything is written ----
describe("/autofit deepens once, and writes once", () => {
  let shim, up, sized;
  before(async () => {
    up = await fakeUpstream(async (call) => {
      const last = [...(call.body?.messages || [])].reverse().find((m) => m.role === "user");
      const said = typeof last?.content === "string" ? last.content : (last?.content || []).map((b) => b?.text || "").join("");
      // ~3,500, ~1,500 and a few tokens of reply (the estimator reads a "detail " as ~1.5 tokens); every summary
      // ~2,700 — far past the ~800 first guess, so the first cut (turn 1) cannot hold the 50% target and turn 2 joins.
      const text = isSummaryCall(call) ? "summary ".repeat(1800) : said.includes("turn one") ? "detail ".repeat(2330) : said.includes("turn two") ? "detail ".repeat(1000) : "light.";
      return anthropicReply("", { model: call.body?.model || "m-1", stop: "end_turn", blocks: [{ type: "text", text }], usage: { input_tokens: 5, output_tokens: 3 } });
    });
    shim = await startApp({
      memory: true,
      summarizer: "m-1",
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
    // The 50% target 3,250 tokens above the loop's part: turns one and two (~5,000) are past it, the first cut
    // (turn 1, guessed at ~800 for its summary) would hold it, the real ~2,700 summary does not — turn 2 joins.
    sized = await sizeAround(shim, { target: 3250, margin: 0.5 });
  });
  after(async () => { await shim.stop(); await up.close(); });

  test("the fat summary moves the cut from turn 1 to turns 1–2: one compaction row, and every field names the range written", async () => {
    const { id } = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model: "m-1", settings: sized.settings } })).json();
    for (const t of ["turn one", "turn two", "turn three"]) {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: t } });
      const body = await r.text();
      assert.equal(r.status, 200, body);
      assert.doesNotMatch(body, STOPPED_AT_WINDOW, `"${t}" reached the model`);
    }
    const before = up.received.filter(isSummaryCall).length;
    const out = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/autofit`, { method: "POST", body: { margin: 0.5 } })).json();
    assert.equal(out.action, "compacted", out.note);
    assert.equal(out.compaction.toTurn, 2, `the deepened range, not the first guess: ${out.note}`);
    assert.equal(out.boundary.toTurn, 2);
    assert.equal(out.boundary.afterTurn, 2);
    assert.match(out.note, /compacted turns 1–2 into one summary/);
    assert.ok(out.after <= Math.floor(out.usable * 0.5), `the deepened cut holds the target: ${out.note}`);
    assert.equal(up.received.filter(isSummaryCall).length - before, 2, "one summary for the first cut, one for the deeper — re-summarized, never stacked");
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    const rows = (tr.boundaries || []).filter((x) => x.type === "compaction");
    assert.equal(rows.length, 1, `one compaction row — never a stale first cut beside the real one: ${JSON.stringify(rows)}`);
    assert.equal(rows[0].toTurn, 2);
  });
});

// ---- what comes back after the fit's summary (HarnessV3-AtHome AH-D9 b) ----
describe("/autofit brings back the files its summary stands for", () => {
  let shim, up, sized;
  before(async () => {
    up = await fakeUpstream(async (call) => {
      const model = call.body?.model || "m-1";
      if (isSummaryCall(call)) return anthropicReply("The user had notes.txt read; the answer ran long.", { model });
      const last = (call.body?.messages || []).at(-1);
      const blocks = Array.isArray(last?.content) ? last.content : [];
      const said = typeof last?.content === "string" ? last.content : blocks.map((b) => b?.text || "").join("");
      // Turn one reads the notes, then answers at length; the turns after it are light.
      if ((call.body?.tools || []).some((t) => t?.name === "read") && said.includes("turn one"))
        return anthropicReply("", { model, stop: "tool_use", blocks: [{ type: "tool_use", id: "t1", name: "read", input: { path: "notes.txt" } }], usage: { input_tokens: 5, output_tokens: 3 } });
      const answered = blocks.some((b) => b?.type === "tool_result");
      return anthropicReply("", { model, stop: "end_turn", blocks: [{ type: "text", text: answered ? "READ. " + "detail ".repeat(1600) : "light." }], usage: { input_tokens: 5, output_tokens: 3 } });
    });
    shim = await startApp({
      memory: true,
      summarizer: "m-1",
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
    sized = await sizeAround(shim, { room: 5300, target: 1500 });
  });
  after(async () => { await shim.stop(); await up.close(); });

  // (fails before: yes — the fit's row carried the summary alone: the file turn one read had to be read again)
  test("the summary of turn 1 brings back the file it read, as it is on disk, weighed with it: the fit's figure is what the next request weighs", async () => {
    const where = join(shim.dataDir, "fit-back");
    mkdirSync(where, { recursive: true });
    writeFileSync(join(where, "notes.txt"), "the notes, as they stand\n");
    const { id } = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: where, model: "m-1", settings: sized.settings } })).json();
    for (const text of ["turn one", "turn two", "turn three"]) {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: text } });
      const body = await r.text();
      assert.equal(r.status, 200, body);
      assert.doesNotMatch(body, STOPPED_AT_WINDOW, `"${text}" reached the model`);
    }
    const fit = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/autofit`, { method: "POST", body: {} })).json();
    assert.equal(fit.action, "compacted", fit.note);
    assert.equal(fit.compaction.toTurn, 1, fit.note);
    const row = shim.app.memory.archive.getCompactions(id).find((/** @type {any} */ c) => Number(c.id) === Number(fit.compaction.id));
    const back = row?.detail?.attached;
    assert.deepEqual(back && [back.shown, back.named, back.plan], [1, 0, false], JSON.stringify(row?.detail));
    const next = (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/compose?dry=1&prompt=1`)).json()).current;
    const block = String(next.prompt.messages[0]?.content?.[1]?.text || "");
    assert.ok(block.includes('<file path="notes.txt">\n     1\tthe notes, as they stand\n</file>'), block);
    assert.equal(fit.after, next.whole, "the fit weighed the block it wrote");
  });
});

// ---- the owner's flow, typed in the harness: refused for size → /autofit in the chat → the retry fits ----
describe("/autofit typed in the harness chat", () => {
  let shim, up, sized;
  const HEAVY = "HEAVY TURN ONE. ";
  /** @param {any} m */
  const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((b) => b?.type === "text").map((b) => b.text).join(""));
  before(async () => {
    up = await fakeUpstream(async (call) => {
      const summary = isSummaryCall(call);
      // The provider's own rule: a prompt still carrying turn one's words verbatim is past the window.
      if (!summary && JSON.stringify(call.body?.messages || []).includes(HEAVY))
        return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 3100 tokens > 2500 maximum" } } };
      const last = [...(call.body?.messages || [])].reverse().find((m) => m.role === "user");
      const text = summary ? "The user opened with turn one; the reply was long." : textOf(last).includes("turn one") ? HEAVY + "detail ".repeat(3200) : "light.";
      return anthropicReply("", { model: call.body?.model || "m-1", stop: "end_turn", blocks: [{ type: "text", text }], usage: { input_tokens: 5, output_tokens: 3 } });
    });
    shim = await startApp({
      memory: true,
      summarizer: "m-1",
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
    // Turn one's reply is ~4,800 tokens: turn one fits the window beside the loop's part, turn two (carrying that
    // reply) does not, and the fit's target holds once turn one alone is a summary. The target is 1,000 since the loop's
    // part passed ~17,000 tokens (prompt v111): at 1,500 the line, the part's 15% above it included, rose past turn two.
    sized = await sizeAround(shim, { room: 5000, target: 1000 });
  });
  after(async () => { await shim.stop(); await up.close(); });

  const send = async (id, text) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: text } });
    return { status: r.status, body: await r.text() };
  };
  /** The compose preview's `current`: what the next request would carry. */
  const preview = async (id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/compose?dry=1`)).json()).current;
  /** How many compactions the session's transcript shows. */
  const compactions = async (id) => ((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json()).boundaries || []).filter((x) => x.type === "compaction").length;

  // (fails before: yes — the line weighed the history alone, so turn two went out to the loop, which stopped it at the
  // window and asked for /autofit)
  test("the line weighs the request the loop sends: turn two, under it by its history alone, is compacted at its start and answered where the session makes room by itself (LD-D6)", async () => {
    const settings = { ...sized.settings, context: { ...sized.settings.context, compaction: { ...sized.settings.context.compaction, mode: "auto" } } };
    const { id } = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model: "m-1", settings } })).json();
    const one = await send(id, "turn one");
    assert.equal(one.status, 200, one.body);
    assert.doesNotMatch(one.body, STOPPED_AT_WINDOW, "turn one reached the model");
    const { current } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/compose?dry=1&prompt=1`)).json();
    assert.ok(current.tokens < current.usable, `the precondition: the history alone is under the line: ${JSON.stringify(current)}`);
    assert.equal(current.whole, current.tokens + current.fixed, "the next request is the history and the loop's own part");
    assert.ok(current.whole >= current.usable && current.wouldCompact === true, `the preview says the next turn compacts: ${JSON.stringify(current)}`);
    const two = await send(id, "turn two");
    assert.equal(two.status, 200, two.body);
    assert.doesNotMatch(two.body, STOPPED_AT_WINDOW, "turn two reached the model");
    assert.match(two.body, /light\./, "and was answered");
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    const b = (tr.boundaries || []).find((x) => x.type === "compaction");
    assert.ok(b && b.kind === "plain" && b.toTurn === 1, `turn one was compacted at the line, at turn two's start: ${JSON.stringify(tr.boundaries)}`);
  });

  // (fails before: yes — the command's own turn was stopped for size like any other, so the one move that makes room
  // could not be typed)
  test("compaction set to ask: turn two is stopped in words, /autofit typed in the chat runs in its own turn, and the retry is answered", async () => {
    const settings = { ...sized.settings, context: { ...sized.settings.context, compaction: { ...sized.settings.context.compaction, mode: "ask" } } };
    const { id } = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model: "m-1", settings } })).json();
    assert.equal((await send(id, "turn one")).status, 200);
    const refused = await send(id, "turn two");
    assert.equal(refused.status, 409, refused.body);
    assert.match(refused.body, /the request weighs [\d,]+ \(its prompt and tools ≈[\d,]+, the history ≈[\d,]+\) of the [\d,]+-token window, past the [\d,]+-token compaction line[^"]*Compact and send/, "the stop weighs the whole request, says it is past the line though the history alone is not, and names the move that makes room");
    const fit = await send(id, "/autofit");
    assert.equal(fit.status, 200, fit.body);
    assert.doesNotMatch(fit.body, /a turn is running/, "the command's own turn is no reason to refuse it");
    assert.match(fit.body, /compacted turn 1 into one summary/, fit.body);
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    const b = (tr.boundaries || []).find((x) => x.type === "compaction");
    assert.ok(b && b.kind === "autofit" && b.toTurn === 1, `the boundary names what was folded: ${JSON.stringify(tr.boundaries)}`);
    // (fails before: yes — HarnessV3-Launch RD-D4: the command's turn was stamped when its answer was recorded, after the
    // compaction it wrote, so the Undo was gone before the page could offer it)
    assert.equal(b.undoable, true, "undoable until the next message, as Compact now's compaction is");
    // (fails before: yes — nothing said a compaction had been written since the newest model turn, so the meter kept
    // that turn's figure through it: 8 % before Compact now and 8 % after, F20)
    assert.equal((await preview(id)).compactedSince, true, "written since the newest model turn: the meter reads this measure of the next request");
    const retry = await send(id, "turn two");
    assert.equal(retry.status, 200, retry.body);
    assert.match(retry.body, /light\./, "the retry reaches the model and is answered");
    assert.equal((await preview(id)).compactedSince, false, "the retry's own request says what the session holds again");
  });

  // (fails before: yes — HarnessV3-Readiness RD1 a: the card's kind was unknown to the validator, so it was refused and
  // logged, and the page painted the text alone)
  test("the answer's card reaches the page whole: the head names it, the turn keeps it, and it says what the text says", async () => {
    const { id } = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model: "m-1", settings: sized.settings } })).json();
    assert.equal((await send(id, "turn one")).status, 200);
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "/autofit" } });
    const body = await r.text();
    assert.equal(r.status, 200, body);
    assert.equal(r.headers.get("x-filament-card"), "autofit", "the head names the card");
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    const turn = (tr.turns || []).find((/** @type {any} */ t) => t.card);
    assert.ok(turn, `the command's turn keeps its card: ${JSON.stringify(tr.turns?.map((/** @type {any} */ t) => t.card || null))}`);
    const { card } = turn;
    assert.equal(card.kind, "autofit");
    assert.equal(card.v, 1);
    assert.equal(card.title, "/autofit — compacted to fit");
    assert.equal(card.lines.length, 3);
    assert.match(card.lines[2], /^turn 1 → one summary$/);
    assert.match(card.note, /^compacted turn 1 into one summary: the next request weighs ~[\d,]+ \(its prompt and tools ≈[\d,]+, the history ≈[\d,]+\) of the [\d,]+-token window/);
    assert.ok(body.includes(card.note), "the card's note is the answer's own words");
  });

  // (fails before: yes — a command was taken for a turn like any other, compacted at its start and stopped for size, and
  // a message read as one by its first character)
  test("over the line, Filament's own commands are answered, never compacted for or stopped; a message that only opens with a slash is a model's turn", async () => {
    const { id } = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model: "m-1", settings: sized.settings } })).json();
    assert.equal((await send(id, "turn one")).status, 200);
    assert.equal((await preview(id)).wouldCompact, true, "the precondition: the next request is past the line");
    const status = await send(id, "/status");
    assert.equal(status.status, 200, status.body);
    assert.equal(await compactions(id), 0, "/status reached no model: nothing was compacted for it");
    const settings = { context: { ...sized.settings.context, compaction: { ...sized.settings.context.compaction, mode: "ask" } } };
    const asked = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: settings } });
    assert.equal(asked.status, 200, await asked.text());
    assert.equal((await send(id, "/cost")).status, 200, "under ask, a command is answered, not stopped for size");
    const path = await send(id, "/src/app.js throws on start: fix it");
    assert.equal(path.status, 409, `no command of Filament's: it goes to the model, and is stopped for size like any turn — ${path.body}`);
    assert.equal(await compactions(id), 0);
  });

  // (fails before: yes — the compactor measured the history alone, so its plan and the compaction it wrote started from
  // a smaller figure than the meter, the map and the line)
  test("the compactor weighs the request too: its plan and the compaction it writes start from the preview's figure", async () => {
    const { id } = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model: "m-1", settings: sized.settings } })).json();
    assert.equal((await send(id, "turn one")).status, 200);
    const { current, compaction } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/compose?dry=1&compaction=1`)).json();
    assert.ok(current.fixed > 0, `the loop's part rides beside the history: ${JSON.stringify(current)}`);
    /** Nearer the whole request than the history alone. @param {number} n */
    const weighsWhole = (n) => Math.abs(n - current.whole) < Math.abs(n - current.tokens);
    assert.ok(weighsWhole(compaction.now), `the plan's now (${compaction.now}) is the request (${current.whole}), not the history (${current.tokens})`);
    const done = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/compact`, { method: "POST", body: {} })).json();
    assert.ok(done.ok, JSON.stringify(done));
    assert.ok(weighsWhole(done.compaction.detail.before), `the compaction's before (${done.compaction.detail.before}) likewise`);
  });

  test("the numbers are honest: a margin no cut can reach says so, and a margin outside 30–95 is refused, never clamped", async () => {
    const { id } = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model: "m-1", settings: sized.settings } })).json();
    assert.equal((await send(id, "turn one")).status, 200);
    // A margin whose target is ~300 tokens above the loop's part: under the summary the fit would leave behind (its
    // ~800 first guess), so no cut reaches it — though the part alone does not pass it.
    const { fixed, usable } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/autofit`, { method: "POST", body: { status: true } })).json();
    const margin = Math.min(95, Math.max(30, Math.ceil((100 * (fixed + 300)) / usable))) / 100;
    const out = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/autofit`, { method: "POST", body: { status: true, margin } })).json();
    assert.ok(out.fixed < Math.floor(out.usable * margin), `the precondition: the part alone is under the target: ${JSON.stringify(out)}`);
    assert.equal(out.action, "status");
    assert.match(out.note, /even compacting every completed turn \(turn 1,/, out.note);
    assert.doesNotMatch(out.note, /would hold the next request under/);
    const low = await send(id, "/autofit 10");
    assert.match(low.body, /takes a margin \(30–95, the share of the compaction line to hold\)/, "10 is not quietly read as 30; the margin is of the line, as the fit measures it");
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.ok(!(tr.boundaries || []).some((x) => x.type === "compaction"), "neither wrote anything");
  });
});

// ---- one writer at a time, and a turn that starts mid-summary owns the session ----
describe("a compaction write is exclusive", () => {
  let shim, up, sized;
  /** The summary calls that reached the provider: a test waits for the next one with `until`, so a fit that never
   * summarizes fails at the deadline and says so, where a bare wait hung the file. */
  let summaries = 0;
  before(async () => {
    up = await fakeUpstream(async (call) => {
      const last = [...(call.body?.messages || [])].reverse().find((m) => m.role === "user");
      const said = typeof last?.content === "string" ? last.content : (last?.content || []).map((b) => b?.text || "").join("");
      let text = "light.";
      if (isSummaryCall(call)) {
        summaries++;
        await new Promise((r) => setTimeout(r, 600)); // a summary takes its time — the window the guards exist for
        text = "The user opened with turn one.";
      } else if (said.includes("slow turn")) await new Promise((r) => setTimeout(r, 1500));
      else if (said.includes("turn one")) text = "detail ".repeat(2330);
      else if (said.includes("turn two")) text = "detail ".repeat(1000);
      return anthropicReply("", { model: call.body?.model || "m-1", stop: "end_turn", blocks: [{ type: "text", text }], usage: { input_tokens: 5, output_tokens: 3 } });
    });
    shim = await startApp({
      memory: true,
      summarizer: "m-1",
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
    // The 50% target 3,250 tokens above the loop's part: the two turns (~5,000) are past it, so each fit summarizes.
    sized = await sizeAround(shim, { target: 3250, margin: 0.5 });
  });
  after(async () => { await shim.stop(); await up.close(); });

  /** A session over half its usable room: turn one (~3,500 tokens) and turn two (~1,500). */
  const session = async () => {
    const { id } = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model: "m-1", settings: sized.settings } })).json();
    for (const t of ["turn one", "turn two"]) {
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: t } });
      assert.equal(res.status, 200);
      // A turn ends with its body, not its head: the head opens as the run starts (BUG-06), so the next turn waits
      // for this one's reply to be read to its end.
      assert.doesNotMatch(await res.text(), STOPPED_AT_WINDOW, `"${t}" reached the model`);
    }
    return id;
  };
  const fit = (id) => shim.api(`/api/sessions/${encodeURIComponent(id)}/autofit`, { method: "POST", body: { margin: 0.5 } });
  const rowsOf = async (id) => ((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json()).boundaries || []).filter((x) => x.type === "compaction");

  test("a second fit while the first is summarizing is refused — one summary paid, one row written", async () => {
    const id = await session();
    const asked = summaries;
    const first = fit(id);
    await until(() => summaries > asked, "the first fit's summary call");
    const second = await fit(id);
    assert.equal(second.status, 409);
    assert.match(await second.text(), /already being written/);
    const done = await (await first).json();
    assert.equal(done.action, "compacted", done.note);
    assert.equal((await rowsOf(id)).length, 1);
  });

  test("a turn that starts while the summary is written owns the session: the fit writes nothing", async () => {
    const id = await session();
    const asked = summaries;
    const pending = fit(id);
    await until(() => summaries > asked, "the fit's summary call");
    const turn = shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "slow turn" } });
    const r = await pending;
    assert.equal(r.status, 409);
    assert.match(await r.text(), /a turn started while \/autofit summarized; nothing was written/);
    assert.equal((await turn).status, 200, "the turn itself runs untouched");
    assert.equal((await rowsOf(id)).length, 0);
  });
});
