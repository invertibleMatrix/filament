// @ts-check
// The agent turn's failure and edge paths, end to end: what the client and the request record get when an ACP
// agent dies mid-turn, when the client hangs up, when the client moves on instead of answering, and when a
// housekeeping proxy call fails. Each test pins the behaviour end to end, so a structural change cannot bend it
// silently; a hang-up before a continuation reaches its turn, which no request can time, is pinned on the turn bridge.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startApp, parseSse, FAKE_ACP_AGENT } from "./helpers/app.js";
import { LiveTurn, TurnBridge } from "../src/adapters/agents/turn-bridge.js";

/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
let logPlain = "",
  logPar = "",
  logHk = "";

before(async () => {
  shim = await startApp({
    configure: (cfg, { dataDir }) => {
      // One upstream per role, so a health cooldown earned by one test (a dead agent cools its upstream down)
      // can never park another test's upstream and change what its record says.
      logPlain = join(dataDir, "acp.jsonl");
      logPar = join(dataDir, "par.jsonl");
      logHk = join(dataDir, "hk.jsonl");
      cfg.upstreams = [
        {
          id: "acp",
          name: "acp",
          type: "acp",
          acp: {
            command: process.execPath,
            args: [FAKE_ACP_AGENT],
            env: { FAKE_ACP_LOG: logPlain },
            cwdDefault: dataDir,
            permissions: "allow-all",
          },
        },
        {
          id: "crash",
          name: "crash",
          type: "acp",
          acp: {
            command: process.execPath,
            args: [FAKE_ACP_AGENT],
            cwdDefault: dataDir,
            permissions: "allow-all",
          },
        },
        {
          id: "hints",
          name: "hints",
          type: "acp",
          acp: {
            command: process.execPath,
            args: [FAKE_ACP_AGENT],
            cwdDefault: dataDir,
            permissions: "ask",
            hints: true,
          },
        },
        {
          id: "par",
          name: "par",
          type: "acp",
          acp: {
            command: process.execPath,
            args: [FAKE_ACP_AGENT],
            env: { FAKE_ACP_PARAMS: "1", FAKE_ACP_LOG: logPar },
            cwdDefault: dataDir,
            permissions: "allow-all",
          },
        },
        {
          id: "hk",
          name: "hk",
          type: "acp",
          acp: {
            command: process.execPath,
            args: [FAKE_ACP_AGENT],
            env: { FAKE_ACP_LOG: logHk },
            cwdDefault: dataDir,
            permissions: "allow-all",
            housekeeping: "model",
            housekeepingModel: "no-such-route-model",
          },
        },
      ];
      // Each with its own health, as the crash tests' upstream cools down (HarnessV3-ACP AC2-5).
      for (const id of ["crashrec", "failrec"])
        cfg.upstreams.push({
          id,
          name: id,
          type: "acp",
          acp: { command: process.execPath, args: [FAKE_ACP_AGENT], cwdDefault: dataDir, permissions: "allow-all", hints: false },
        });
      cfg.routes = ["acp/*", "crash/*", "hints/*", "par/*", "hk/*", "crashrec/*", "failrec/*"].map((match) => {
        const [upstream] = match.split("/");
        return { match, upstream, upstreamModel: "{1}", enabled: true };
      });
    },
  });
});
after(async () => {
  await shim.stop();
});

const healthOps = async () => (await (await shim.api("/api/ops?kinds=health&limit=100")).json()).ops;
/** Poll until `probe` returns a truthy value; the agent turn and the record run on their own ticks. */
async function waitFor(probe, { ms = 8000, step = 60 } = {}) {
  for (let t = 0; t < ms; t += step) {
    const v = await probe();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  return null;
}
const lastLogLine = (file) =>
  existsSync(file) ? JSON.parse(readFileSync(file, "utf8").trim().split("\n").at(-1) || "null") : null;

// ---- 1. the agent dies mid-turn ---------------------------------------------------------------------------------

test("an agent that dies mid-turn ends an Anthropic stream with Filament's sentence, an error event, and an error record", async () => {
  const r = await shim.post("/v1/messages", {
    model: "crash/fake-c1",
    max_tokens: 100,
    stream: true,
    messages: [{ role: "user", content: "~crash now" }],
  });
  assert.equal(r.status, 200);
  const events = parseSse(await r.text());
  // The reply the agent managed to write stays; Filament's own failure sentence follows it, and the stream ends
  // with an error event instead of the closing message_delta/message_stop a completed reply would have.
  const text = events
    .filter((e) => e.event === "content_block_delta" && e.data?.delta?.type === "text_delta")
    .map((e) => e.data.delta.text)
    .join("");
  assert.match(text, /_filament: crash failed: agent process exited \(code 3\) during the turn_/);
  const last = events.at(-1);
  assert.ok(last, "the stream carries at least one event");
  assert.equal(last.event, "error");
  assert.match(last.data?.error?.message, /agent process exited \(code 3\)/);
  assert.ok(!events.some((e) => e.event === "message_stop"), "no normal end-of-message after the death");
  const rec = await waitFor(() =>
    shim.records(5).then((rs) => rs.find((x) => x.model === "crash/fake-c1" && x.status !== "pending")),
  );
  assert.ok(rec, "the request was recorded and finished");
  assert.equal(rec.status, "error");
  assert.equal(rec.httpStatus, 200, "the stream had begun, so the status is the reply's own 200");
  assert.match(rec.error, /agent process exited \(code 3\)/);
});

// (fails before: yes — a failed turn's record had no `acp` block: its session, what it did and its run's end were lost,
// and the console's views of agent turns left it out; HarnessV3-ACP AC1's drive)
test("a turn that fails keeps its acp block on its record: its session, what it did, its run's end", async () => {
  const r = await shim.post("/v1/messages", { model: "crashrec/fake-r1", max_tokens: 100, stream: true, messages: [{ role: "user", content: "~diff ~crash now" }] });
  assert.equal(r.status, 200);
  await r.text();
  const rec = await waitFor(() => shim.records(5).then((rs) => rs.find((x) => x.model === "crashrec/fake-r1" && x.status !== "pending")));
  assert.equal(rec?.status, "error");
  const a = rec.acp;
  assert.ok(a, "the record keeps its acp block");
  assert.match(String(a.sessionId), /^sess_/);
  // The fake's turn reads its README before the edit: two calls.
  assert.deepEqual([a.reused, a.seeded, a.linesAdded, a.linesRemoved, a.toolStats?.calls], [false, false, 2, 1, 2]);
  assert.deepEqual(a.tools.map((/** @type {string} */ t) => /README\.md|src\/app\.js/.exec(t)?.[0]), ["README.md", "src/app.js"]);
  assert.deepEqual([a.run?.status, a.run?.tools], ["failed", 2]);
});

// (fails before: yes — for the silence limit's end, which this test's turn met until the limit went (HarnessV3-
// FailurePoints §4 B): its record had its session as new and its changes as none, whatever it had done)
test("a failed turn on a session it went on in says how its session began and what it changed", async () => {
  const conv = { "x-filament-conversation": "fail-rec" };
  const model = "failrec/fake-q";
  /** One turn of the conversation, to its record. @param {string} content */
  const ask = async (content) => {
    const seen = new Set((await shim.records(20)).map((/** @type {any} */ x) => x.id));
    const history = content === "first" ? [] : [{ role: "user", content: "first" }, { role: "assistant", content: "Echo: first" }];
    const r = await shim.post("/v1/messages", { model, max_tokens: 100, stream: true, messages: [...history, { role: "user", content }] }, conv);
    assert.equal(r.status, 200);
    await r.text();
    return waitFor(() => shim.records(20).then((rs) => rs.find((x) => !seen.has(x.id) && x.model === model && x.status !== "pending")));
  };
  await ask("first");
  const rec = await ask("~diff ~crash");
  assert.equal(rec?.status, "error");
  assert.match(String(rec.error), /agent process exited \(code 3\)/);
  assert.deepEqual([rec.acp?.reused, rec.acp?.seeded, rec.acp?.linesAdded, rec.acp?.linesRemoved, rec.acp?.run?.status], [true, false, 2, 1, "failed"]);
});

test("an agent that dies mid-turn ends an OpenAI stream with a server_error chunk, no finish chunk, and an error record", async () => {
  const r = await shim.post("/v1/chat/completions", {
    model: "crash/fake-c2",
    stream: true,
    messages: [{ role: "user", content: "~crash now" }],
  });
  assert.equal(r.status, 200);
  const events = parseSse(await r.text());
  assert.equal(
    events.at(-1)?.data,
    "[DONE]",
    "the terminator still arrives, so the client's parser finishes",
  );
  const err = events.at(-2)?.data;
  assert.equal(err.error.type, "server_error");
  assert.match(err.error.message, /agent process exited \(code 3\)/);
  // No normal closing chunk: a client that trusts finish_reason would read a dead turn as a complete answer.
  assert.ok(
    events.every((e) => e.data?.choices?.[0]?.finish_reason == null),
    `no finish_reason anywhere in a dead turn: ${JSON.stringify(events.map((e) => e.data?.choices?.[0]?.finish_reason))}`,
  );
  const rec = await waitFor(() =>
    shim.records(5).then((rs) => rs.find((x) => x.model === "crash/fake-c2" && x.status !== "pending")),
  );
  assert.ok(rec, "the request was recorded and finished");
  assert.equal(rec.status, "error");
  assert.equal(rec.httpStatus, 200);
  assert.match(rec.error, /agent process exited \(code 3\)/);
});

test("an agent that dies before any output is a 502 in the client's format, an error record, and a cooldown on the agent", async () => {
  // Nothing was ever streamed, so Filament can still fail the request properly: a 502 in each wire's error shape,
  // not a 200 whose stream ends in an error event.
  const anth = await shim.post("/v1/messages", {
    model: "crash/fake-c3",
    max_tokens: 100,
    stream: false,
    messages: [{ role: "user", content: "~crash now" }],
  });
  assert.equal(anth.status, 502);
  const a = await anth.json();
  assert.equal(a.type, "error");
  assert.equal(a.error.type, "api_error");
  assert.equal(a.error.message, 'ACP agent "crash" failed: agent process exited (code 3) during the turn');
  const oai = await shim.post("/v1/chat/completions", {
    model: "crash/fake-c4",
    stream: false,
    messages: [{ role: "user", content: "~crash now" }],
  });
  assert.equal(oai.status, 502);
  const o = await oai.json();
  assert.equal(o.error.type, "server_error");
  assert.equal(o.error.message, 'ACP agent "crash" failed: agent process exited (code 3) during the turn');
  const rec = await waitFor(() =>
    shim.records(5).then((rs) => rs.find((x) => x.model === "crash/fake-c4" && x.status !== "pending")),
  );
  assert.ok(rec, "the request was recorded and finished");
  assert.equal(rec.status, "error");
  assert.equal(rec.httpStatus, 502);
  assert.match(rec.error, /agent process exited \(code 3\)/);
  // A dead process is a broken upstream: the board cools it down, and says so on the health feed.
  const op = await waitFor(() =>
    healthOps().then((ops) => ops.find((o) => o.sub === "cooldown" && o.detail?.upstream === "crash")),
  );
  assert.ok(
    op,
    `a cooldown op for the crashed agent: ${JSON.stringify((await healthOps()).map((o) => o.sub))}`,
  );
});

// ---- 2. the client-tool bridge's drain path ----------------------------------------------------------------------

const ZTOOLS = [
  {
    type: "function",
    function: {
      name: "AskUserQuestion",
      parameters: { type: "object", properties: { questions: { type: "array" } } },
    },
  },
];

// (fails before: yes — a turn continued with the client's tool results heard no hang-up: the agent's turn ran on with
// nobody to read it, and its record waited for it)
test("a client that hangs up on a turn it continued with its tool results cancels the agent turn too", async () => {
  const sid = { "x-session-id": "hang-continued" };
  const ask = [{ role: "user", content: "perm then hang" }];
  const first = await shim.post("/v1/chat/completions", { model: "hints/fake-a", tools: ZTOOLS, messages: ask }, sid);
  const call = (await first.json()).choices[0].message.tool_calls[0];
  const ac = new AbortController();
  const res = await fetch(`${shim.url}/v1/chat/completions`, {
    method: "POST",
    headers: { ...shim.headers, ...sid },
    body: JSON.stringify({ model: "hints/fake-a", stream: true, tools: ZTOOLS, messages: [...ask, { role: "assistant", content: null, tool_calls: [call] }, { role: "tool", tool_call_id: call.id, content: "Allow" }] }),
    signal: ac.signal,
  });
  // The agent takes the answer and works on; then the client hangs up.
  const reader = /** @type {ReadableStream<Uint8Array>} */ (res.body).getReader();
  let seen = "";
  while (!seen.includes("working")) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += new TextDecoder().decode(value);
  }
  assert.match(seen, /permission:allow/);
  ac.abort();
  const rec = await waitFor(async () => {
    const r = await shim.record(String(res.headers.get("x-filament-request-id")));
    return r && r.status !== "pending" ? r : null;
  });
  assert.ok(rec, "the record finished instead of waiting with the socket gone");
  assert.deepEqual([rec.stopReason, rec.status, rec.error], ["cancelled", "aborted", "client disconnected"]);
});

// (fails before: no — a guard the mutation pass asked for: a continuation whose client had hung up before it reached
// the turn waited for the turn's end, which nobody would read)
test("a client that hangs up before its continuation reaches the turn cancels the turn at once", async () => {
  const turn = new LiveTurn();
  turn.cancel = () => turn.finish({ stopReason: "cancelled" }, null);
  /** @type {any} */
  let timer;
  const waited = /** @type {Promise<any>} */ (new Promise((r) => (timer = setTimeout(() => r({ res: { stopReason: "still waiting" } }), 3000))));
  const { res } = await Promise.race([new TurnBridge().resume({ turn, onEvent: () => {}, signal: AbortSignal.abort() }), waited]);
  clearTimeout(timer);
  assert.equal(res.stopReason, "cancelled");
});

test("moving on instead of answering drains the previous turn's buffered output first, labelled and set apart by a rule", async () => {
  // The agent is waiting for the client's permission answer; the user sends a new message instead. The old turn
  // is cancelled, and the words it produced in the meantime (they are the AGENT's own) are delivered at the top
  // of the new reply, set apart by a rule, with a label because this upstream has acp.hints on.
  const sid = { "x-session-id": "drain-1" };
  const first = await shim.post(
    "/v1/chat/completions",
    { model: "hints/fake-a", tools: ZTOOLS, messages: [{ role: "user", content: "perm one" }] },
    sid,
  );
  const j1 = await first.json();
  assert.equal(j1.choices[0].finish_reason, "tool_calls");
  const call = j1.choices[0].message.tool_calls[0];
  assert.equal(call.function.name, "AskUserQuestion");
  assert.match(call.id, /^filament_act_/);
  const second = await shim.post(
    "/v1/chat/completions",
    {
      model: "hints/fake-a",
      tools: ZTOOLS,
      messages: [
        { role: "user", content: "perm one" },
        { role: "assistant", content: "…" },
        { role: "user", content: "never mind, do something else" },
      ],
    },
    sid,
  );
  const j2 = await second.json();
  const text = j2.choices[0].message.content;
  assert.match(text, /_filament: from hints's previous turn, while it waited for the client:_/);
  assert.match(text, /permission:cancelled/, "the cancelled turn's own words are in the reply");
  assert.match(text, /echo\(1\): perm one/, "so is the answer it managed before it was cancelled");
  const iLabel = text.indexOf("previous turn");
  const iRule = text.indexOf("---");
  const iNew = text.indexOf("echo(2): never mind");
  assert.ok(
    iLabel >= 0 && iRule > iLabel && iNew > iRule,
    `label, rule, then the new turn's answer: ${JSON.stringify(text)}`,
  );
  const rec = await shim.record(second.headers.get("x-filament-request-id"));
  const notes = [...(rec.priorChanges || []), ...(rec.changes || [])];
  assert.ok(
    notes.some((c) =>
      /the previous turn was still waiting for the client \(1 action\(s\)\); it was cancelled because a new message arrived/.test(
        c,
      ),
    ),
    `the record says why the old turn went away: ${notes.join(" | ")}`,
  );
  assert.ok(
    notes.some((c) => /acp: \d+ buffered event\(s\) from the previous turn delivered first$/.test(c)),
    `and the record counts what was drained: ${notes.join(" | ")}`,
  );
  assert.ok(
    !notes.some((c) => c.includes("unlabelled")),
    "with hints on the drain is labelled, so the note drops its unlabelled caveat",
  );
});

// ---- 3. the client hangs up mid-turn -----------------------------------------------------------------------------

test("a client that hangs up mid-turn cancels the agent turn; the record is aborted, not a success, and no cooldown follows", async () => {
  const healthBefore = (await (await shim.api("/api/usage/upstreams")).json()).health?.acp;
  const ac = new AbortController();
  const pending = fetch(`${shim.url}/v1/messages`, {
    method: "POST",
    headers: { ...shim.headers },
    body: JSON.stringify({
      model: "acp/fake-hang",
      max_tokens: 100,
      stream: true,
      messages: [{ role: "user", content: "~hang please" }],
    }),
    signal: ac.signal,
  });
  // Wait until the agent's first output is actually streaming, so the cancel is guaranteed to reach a turn that
  // is genuinely in flight (the fake only completes its hung prompt when session/cancel arrives).
  const live = await waitFor(async () => {
    const l = await (await shim.api("/api/live")).json();
    return l.active?.find((x) => x.model === "acp/fake-hang" && x.phase === "streaming");
  });
  assert.ok(live, "the turn is streaming before the hang-up");
  ac.abort();
  await pending.catch(() => {});
  const rec = await waitFor(() =>
    shim.records(5).then((rs) => rs.find((x) => x.model === "acp/fake-hang" && x.status !== "pending")),
  );
  assert.ok(rec, "the record finished instead of hanging with the socket gone");
  assert.equal(
    rec.stopReason,
    "cancelled",
    "the agent's turn was cancelled, and the record says which way it ended",
  );
  // A cancelled turn used to finish `ok` with tokens and speed as if delivered, and counted as a health success for
  // the agent — the provider path had recorded the same hang-up as `aborted` all along.
  assert.equal(rec.status, "aborted", "a client hang-up is neither the agent failing nor a delivered reply");
  assert.equal(rec.error, "client disconnected");
  const healthAfter = (await (await shim.api("/api/usage/upstreams")).json()).health?.[rec.upstream];
  assert.equal(
    healthAfter?.lastOkAt ?? null,
    healthBefore?.lastOkAt ?? null,
    "the hung-up turn is not a success on the agent's health board",
  );
  const ops = await healthOps();
  assert.ok(
    !ops.some((o) => o.sub === "cooldown" && o.detail?.upstream === "acp"),
    `no cooldown for the hung-up agent: ${JSON.stringify(ops.map((o) => [o.sub, o.detail?.upstream]))}`,
  );
});

// ---- 4. the SSE head --------------------------------------------------------------------------------------------

test("a streaming agent reply opens with the SSE head: event-stream content type, no buffering, request id and upstream", async () => {
  for (const [path, body] of [
    [
      "/v1/messages",
      {
        model: "acp/fake-head-a",
        max_tokens: 50,
        stream: true,
        messages: [{ role: "user", content: "anthropic head" }],
      },
    ],
    [
      "/v1/chat/completions",
      { model: "acp/fake-head-o", stream: true, messages: [{ role: "user", content: "openai head" }] },
    ],
  ]) {
    const r = await shim.post(path, body);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(r.headers.get("cache-control"), "no-cache");
    assert.equal(r.headers.get("connection"), "keep-alive");
    assert.equal(
      r.headers.get("x-accel-buffering"),
      "no",
      "proxies must not hold the agent's first words back",
    );
    assert.ok(r.headers.get("x-filament-request-id"), "the request id travels on the head, before any event");
    assert.equal(r.headers.get("x-filament-upstream"), "acp");
    await r.text();
  }
});

// ---- 5. an OpenAI non-stream reply that carries rendered tool activity -------------------------------------------

test("a non-streaming OpenAI client gets the agent's tool activity inside message.content and the thought as reasoning_content", async () => {
  const r = await shim.post("/v1/chat/completions", {
    model: "acp/fake-diff",
    stream: false,
    messages: [
      { role: "system", content: "Working directory: placeholder" },
      { role: "user", content: "do a ~diff please" },
    ],
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.object, "chat.completion");
  assert.match(j.id, /^chatcmpl-acp-/);
  assert.equal(j.model, "acp/fake-diff");
  const msg = j.choices[0].message;
  assert.equal(j.choices[0].finish_reason, "stop");
  assert.equal(msg.role, "assistant");
  assert.equal(msg.tool_calls, undefined, "the agent ran its own tools; nothing is asked of the client");
  assert.equal(
    msg.reasoning_content,
    "thinking about it",
    "the thought before the first text stays a reasoning part",
  );
  // The tool activity is rendered into the text itself, in order, and the answer follows it.
  const iRead = msg.content.indexOf("⚙ Read");
  const iEdit = msg.content.indexOf("⚙ Edit src/app.js");
  const iDiff = msg.content.indexOf("✓ +2 −1");
  const iAnswer = msg.content.indexOf("echo(1):");
  assert.ok(
    iRead >= 0 && iEdit > iRead && iDiff > iEdit && iAnswer > iDiff,
    `activity then answer, in order: ${JSON.stringify(msg.content)}`,
  );
  // The agent reports no usage, so the counts are estimates — but they move, and the cache detail is honest.
  assert.ok(j.usage.prompt_tokens > 0 && j.usage.completion_tokens > 0, JSON.stringify(j.usage));
  assert.equal(j.usage.total_tokens, j.usage.prompt_tokens + j.usage.completion_tokens);
  assert.deepEqual(j.usage.prompt_tokens_details, { cached_tokens: 0 });
});

// ---- 6. effort hidden behind a session id ------------------------------------------------------------------------

test("an effort suffix hidden behind a session id is parsed and applied when the agent offers effort levels", async () => {
  // `sonnet-high#sess_old1` was always fine; the suffix AFTER the id is the case the generic suffix parser never
  // saw, because the model name ends in the session id. Read the agent's own log to prove the agent got the effort.
  const sid = { "x-session-id": "eff-par" };
  await shim.post(
    "/v1/messages",
    { model: "par/grok-4.6", max_tokens: 20, messages: [{ role: "user", content: "session start" }] },
    sid,
  );
  const first = await shim.records(3).then((rs) => rs.find((x) => x.model === "par/grok-4.6"));
  assert.ok(first?.acp?.sessionId, "the first turn opened an agent session");
  const shortId = first.acp.sessionId.slice(0, 8);
  const r = await shim.post(
    "/v1/messages",
    {
      model: `par/grok-4.6-xhigh#${shortId}`,
      max_tokens: 20,
      messages: [{ role: "user", content: "turn two with effort" }],
    },
    sid,
  );
  assert.equal(r.status, 200);
  await r.text();
  const rec = await shim.records(3).then((rs) => rs.find((x) => x.model.startsWith("par/grok-4.6-xhigh")));
  assert.ok(rec, "the request was recorded under the name the client sent");
  assert.equal(
    rec.upstreamModel,
    "grok-4.6",
    "the id and the effort suffix are stripped from the agent's model id",
  );
  assert.ok(
    rec.acp.sessionId.startsWith(shortId),
    "the same agent session continues — no reload, no new session",
  );
  const notes = [...(rec.priorChanges || []), ...(rec.changes || [])].join(" | ");
  assert.match(notes, /model grok-4\.6 \(fast off, effort xhigh\)/);
  assert.match(notes, /acp: effort xhigh requested \(model suffix\)/);
  const prompt = lastLogLine(logPar);
  assert.equal(prompt.sessionId, first.acp.sessionId);
  assert.equal(prompt.config?.effort, "xhigh", "the effort reached the agent as its session effort setting");
});

test("an effort suffix hidden behind a session id is only noted on the record when the agent has no effort setting", async () => {
  const sid = { "x-session-id": "eff-plain" };
  await shim.post(
    "/v1/messages",
    { model: "acp/fake-a", max_tokens: 20, messages: [{ role: "user", content: "session start" }] },
    sid,
  );
  const first = await shim.records(3).then((rs) => rs.find((x) => x.model === "acp/fake-a"));
  const shortId = first.acp.sessionId.slice(0, 8);
  const r = await shim.post(
    "/v1/messages",
    {
      model: `acp/fake-a-high#${shortId}`,
      max_tokens: 20,
      messages: [{ role: "user", content: "turn two with effort" }],
    },
    sid,
  );
  assert.equal(r.status, 200);
  await r.text();
  const rec = await shim.records(3).then((rs) => rs.find((x) => x.model.startsWith("acp/fake-a-high")));
  assert.ok(rec, "the request was recorded");
  assert.equal(rec.upstreamModel, "fake-a");
  const notes = [...(rec.priorChanges || []), ...(rec.changes || [])].join(" | ");
  assert.match(
    notes,
    /effort high not applied/,
    "the record says the effort could not happen, instead of dropping it",
  );
  assert.match(notes, /acp: effort high requested \(model suffix\)/);
  const prompt = lastLogLine(logPlain);
  assert.ok(!prompt.config?.effort, "nothing was sent to the agent as effort");
});

// ---- 7. the housekeeping proxy fails -----------------------------------------------------------------------------

test("a housekeeping request whose model proxy fails passes the failure through, records the error, and never wakes the agent", async () => {
  // A client's title-generation call must not become an agent task. With acp.housekeepingModel set, Filament hands
  // it to that model through its own front door; when that call fails, the client sees the failure and the record
  // says the proxy — not the agent — failed.
  const sys =
    'Generate a concise title for this coding session.\n\nThis is a title-generation task, not a conversation.\nNever answer the user\'s question.\nReturn exactly one valid json object: {"title":"..."}';
  const r = await shim.post("/v1/chat/completions", {
    model: "hk/fake-h",
    max_tokens: 50,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: "help me fix the flaky login test" },
    ],
  });
  // The proxy target matches no route, so the inner call is a 404 — passed through to the client untouched.
  assert.equal(r.status, 404);
  const body = await r.json();
  assert.match(body.error.message, /no route matches model "no-such-route-model"/);
  const rec = await shim.record(r.headers.get("x-filament-request-id"));
  assert.ok(rec, "the outer request was recorded");
  assert.equal(rec.status, "error");
  assert.equal(rec.httpStatus, 404);
  assert.equal(rec.error, "housekeeping model no-such-route-model answered HTTP 404");
  assert.equal(rec.upstreamModel, "no-such-route-model", "the record names the proxy target, not the agent");
  assert.equal(rec.url, "Filament://housekeeping/no-such-route-model");
  assert.equal(rec.local, true, "Filament answered this itself; no upstream carried it");
  assert.equal(rec.tokens.input, 0);
  assert.equal(rec.tokens.output, 0);
  assert.match((rec.changes || []).join(" | "), /sent to no-such-route-model instead of hk/);
  assert.ok(
    !existsSync(logHk) || readFileSync(logHk, "utf8") === "",
    "the agent was never woken for a title",
  );
});
