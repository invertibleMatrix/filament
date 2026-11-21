// @ts-check
// An outside client's turn ends where its loop ends (memory's `turnStopped`, the server's `onClientTurnEnded`), on the
// live app with the upstream scripted: a reply that showed the client a tool call, or paused its turn, ends none,
// whatever its stop reason says; a reply whose calls were all memory's ends as one that called none, and ends its turn.
// A request whose memory failed once its turn was known still runs that turn, and so does a loop's leg on a branch of its
// turn or of a turn the archive does not hold. A request that fails ends its turn at once; the retry goes on with that
// turn, which What happened counts once. No fixed sleeps: a request is waited on until its record has closed, which is
// when memory hears it.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { fakeUpstream, anthropicReply, anthropicStream, openaiReply, startApp } from "./helpers/app.js";
import { until, removeDirs } from "./helpers/wait.js";
import { chainKeyForConversationId } from "../src/services/memory/brain.js";

describe("an outside client's turn ends where its loop ends", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** The upstream's answer while a test scripts it, else the default answer in the call's format. @type {((call: any) => any) | null} */
  let scripted = null;
  /** Each end memory said, as the server hears it: the chat, and what came with it. @type {any[][]} */
  const ended = [];
  const SYS = { role: "system", content: "You help." };
  const person = (/** @type {string} */ text) => ({ role: "user", content: [{ type: "text", text }] });
  const call = { type: "tool_use", id: "t1", name: "Read", input: { path: "notes.md" } };
  const result = { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "the notes" }] };
  const replyText = (/** @type {any} */ m) =>
    Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("") : String(m?.content ?? "");

  before(async () => {
    up = await fakeUpstream((c) => scripted?.(c));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
          { id: "o", name: "o", type: "openai-compatible", baseUrl: `${up.url}/v1`, apiKey: "s", enabled: true },
        ];
        cfg.routes = [
          { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "o-*", upstream: "o", upstreamModel: "{model}", enabled: true },
        ];
        // Memory's tools ride on a client's requests, one round of them a reply.
        cfg.memory.autopilot.enabled = true;
        cfg.memory.autopilot.toolIterations = 1;
      },
    });
    const memory = /** @type {any} */ (shim.app.memory);
    const said = memory.onClientTurnEnded;
    memory.onClientTurnEnded = (/** @type {any[]} */ ...args) => {
      ended.push(args);
      said?.(...args);
    };
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });

  /** @param {string} sid */
  const chainOf = (sid) => /** @type {any} */ (shim.app.memory).archive.chainIdForKey(chainKeyForConversationId(sid));
  /** The ends said of a client's chat, each as the server heard it. @param {string} sid */
  const endsOf = (sid) => ended.filter((e) => e[0] === chainOf(sid));
  /**
   * A client's request, sent and answered, its record closed — memory has heard its close by then (`finish` closes the
   * record and tells memory in one step).
   * @param {string} path @param {any} body @param {string} sid @param {string} [cwd]
   */
  const send = async (path, body, sid, cwd = process.cwd()) => {
    const r = await shim.post(path, body, { "x-session-id": sid, "x-filament-cwd": cwd, "user-agent": "opencode/1.2" });
    const text = await r.text();
    const id = String(r.headers.get("x-filament-request-id"));
    await until(async () => (await shim.record(id))?.totalMs != null || null, `${id}'s record closed`);
    return { status: r.status, text, id };
  };

  // (fails before: yes — the end rule read the stop reason alone: an OpenAI upstream's `stop` beside its tool calls, which
  // an Anthropic client is shown as tool_use blocks under `end_turn`, said the chat's turn ended while its loop went on)
  test("a reply that showed the client a tool call ends no turn, whatever its stop reason says: as JSON and as a stream; the leg that answers it does", async () => {
    const asked = [SYS, person("read my notes")];
    const read = { id: "call_1", type: "function", function: { name: "Read", arguments: JSON.stringify({ path: "notes.md" }) } };
    try {
      scripted = () => openaiReply("", { model: "o-1", finish: "stop", toolCalls: [read] });
      const json = await send("/v1/messages", { model: "o-1", max_tokens: 100, messages: asked }, "s1-json");
      assert.equal(json.status, 200, json.text);
      const shown = JSON.parse(json.text);
      assert.deepEqual([shown.stop_reason, shown.content.map((/** @type {any} */ b) => b.type)], ["end_turn", ["tool_use"]], "the client is shown the call, under end_turn");
      assert.deepEqual(endsOf("s1-json"), [], "as JSON: its loop goes on with the call");
      const chunk = (/** @type {any} */ delta, /** @type {string | null} */ finish_reason = null) => ({ data: { id: "chatcmpl-s", object: "chat.completion.chunk", created: 1, model: "o-1", choices: [{ index: 0, delta, finish_reason }] } });
      scripted = () => ({
        sse: [
          chunk({ role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "Read", arguments: "" } }] }),
          chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ path: "notes.md" }) } }] }),
          chunk({}, "stop"),
          "data: [DONE]\n",
        ],
      });
      const streamed = await send("/v1/messages", { model: "o-1", max_tokens: 100, stream: true, messages: asked }, "s1-stream");
      assert.match(streamed.text, /"content_block":\{"type":"tool_use"/, "the client is shown the call");
      assert.match(streamed.text, /"stop_reason":"end_turn"/, "under end_turn");
      assert.ok(chainOf("s1-stream"), "the client's chat is on record");
      assert.deepEqual(endsOf("s1-stream"), [], "as a stream: its loop goes on with the call");
      // The leg that answers the call: its reply ends the loop, and the turn
      scripted = null;
      const leg = await send("/v1/messages", { model: "o-1", max_tokens: 100, messages: [...asked, { role: "assistant", content: shown.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: shown.content[0].id, content: "the notes" }] }] }, "s1-json");
      assert.equal(leg.status, 200, leg.text);
      assert.equal(endsOf("s1-json").length, 1, "the leg says the end, once");
    } finally {
      scripted = null;
    }
  });

  // (fails before: yes — the end rule read the stop reason alone, and a Chat Completions client is shown an OpenAI
  // upstream's `stop` beside its tool calls as it came; the stream's half, with the scanner's count of the calls by their
  // index — adapters/providers/http.js — undone, says the end, the review of the client-retry commits)
  test("a Chat Completions client shown tool calls under `stop` ends no turn: as JSON and as a stream", async () => {
    const read = { id: "call_1", type: "function", function: { name: "read", arguments: JSON.stringify({ path: "notes.md" }) } };
    const asked = [{ role: "user", content: "read my notes" }];
    try {
      scripted = () => openaiReply("", { model: "o-1", finish: "stop", toolCalls: [read] });
      const json = await send("/v1/chat/completions", { model: "o-1", messages: asked }, "s1-chat-json");
      assert.equal(json.status, 200, json.text);
      const shown = JSON.parse(json.text).choices[0];
      assert.deepEqual([shown.finish_reason, shown.message.tool_calls?.length], ["stop", 1], "the client is shown the call, under stop");
      assert.ok(chainOf("s1-chat-json"), "the client's chat is on record");
      assert.deepEqual(endsOf("s1-chat-json"), [], "as JSON: its loop goes on with the call");
      const chunk = (/** @type {any} */ delta, /** @type {string | null} */ finish_reason = null) => ({ data: { id: "chatcmpl-c", object: "chat.completion.chunk", created: 1, model: "o-1", choices: [{ index: 0, delta, finish_reason }] } });
      scripted = () => ({
        sse: [
          chunk({ role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read", arguments: "" } }] }),
          chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ path: "notes.md" }) } }] }),
          chunk({}, "stop"),
          "data: [DONE]\n",
        ],
      });
      const streamed = await send("/v1/chat/completions", { model: "o-1", stream: true, messages: asked }, "s1-chat-stream");
      assert.match(streamed.text, /"tool_calls":\[\{"index":0,"id":"call_1"/, "the client is shown the call");
      assert.match(streamed.text, /"finish_reason":"stop"/, "under stop");
      assert.ok(chainOf("s1-chat-stream"), "the client's chat is on record");
      assert.deepEqual(endsOf("s1-chat-stream"), [], "as a stream: its loop goes on with the call");
    } finally {
      scripted = null;
    }
  });

  // (fails before: yes — `pause_turn` and Chat Completions' `function_call` were stop reasons the end rule did not know: a
  // turn its client sends again to go on, and a call of the client's own functions, each said the turn ended)
  test("a turn paused, and a call of the client's functions, end no turn", async () => {
    try {
      scripted = () => anthropicReply("searching the web", { model: "m-1", stop: "pause_turn" });
      const paused = await send("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("what is new in node 24")] }, "s1-pause");
      assert.equal(JSON.parse(paused.text).stop_reason, "pause_turn");
      assert.ok(chainOf("s1-pause"), "the client's chat is on record");
      assert.deepEqual(endsOf("s1-pause"), [], "a paused turn goes on as its client sends it again");
      scripted = () => ({
        json: {
          id: "chatcmpl-f",
          object: "chat.completion",
          created: 1,
          model: "o-1",
          choices: [{ index: 0, message: { role: "assistant", content: null, function_call: { name: "read_notes", arguments: "{}" } }, finish_reason: "function_call" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      });
      const called = await send("/v1/chat/completions", { model: "o-1", messages: [{ role: "user", content: "read my notes" }] }, "s1-function");
      assert.equal(JSON.parse(called.text).choices[0].finish_reason, "function_call");
      assert.ok(chainOf("s1-function"), "the client's chat is on record");
      assert.deepEqual(endsOf("s1-function"), [], "its loop goes on with the function's result");
    } finally {
      scripted = null;
    }
  });

  // (fails before: yes — a reply whose last round called memory alone, at the round limit or after a follow-up that failed,
  // kept that round's `tool_use` / `tool_calls`: its client was shown a call with no call in it, and the turn's end went
  // unsaid)
  test("a reply whose calls were all memory's ends as one that called none, and ends its turn at the round limit; one whose follow-up failed is answered with the failure and ends its turn as failed", async () => {
    /** A follow-up Filament sends with memory's results. @param {any} c */
    const followUp = (c) => {
      const last = c.body?.messages?.at(-1);
      return last?.role === "tool" || (Array.isArray(last?.content) && last.content.some((/** @type {any} */ b) => b?.type === "tool_result"));
    };
    const search = (/** @type {string} */ id) => ({ type: "tool_use", id, name: "filament_memory_search", input: { query: "the cache" } });
    const asked = [SYS, person("what did we decide about the cache")];
    try {
      // Anthropic, at the round limit: the second round calls memory again
      scripted = (c) => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "text", text: followUp(c) ? "One more look." : "Let me look." }, search(followUp(c) ? "m2" : "m1")] });
      const capped = await send("/v1/messages", { model: "m-1", max_tokens: 100, messages: asked }, "s2-limit");
      assert.equal(capped.status, 200, capped.text);
      const a = JSON.parse(capped.text);
      assert.deepEqual([a.stop_reason, a.content.map((/** @type {any} */ b) => b.type)], ["end_turn", ["text", "text"]], "the rounds' words under end_turn, no call");
      assert.equal(endsOf("s2-limit").length, 1, "at the round limit: the turn's end is said");
      // Anthropic, its follow-up failed, its provider out of reach: its client is answered as a first attempt so failing
      // is, never with the round's words (follow-up-abort.test.js)
      scripted = (c) => (followUp(c) ? { drop: true } : anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "text", text: "Let me look." }, search("m1")] }));
      const failed = await send("/v1/messages", { model: "m-1", max_tokens: 100, messages: asked }, "s2-failed");
      assert.equal(failed.status, 502, failed.text);
      assert.match(JSON.parse(failed.text).error.message, /^upstream m unreachable: /, "the failure's own words");
      assert.deepEqual(endsOf("s2-failed").map((e) => e[2]), [true], "after a failed follow-up: the turn's end is said, as failed");
      // Chat Completions, at the round limit
      const call = (/** @type {string} */ id) => ({ id, type: "function", function: { name: "filament_memory_search", arguments: JSON.stringify({ query: "the cache" }) } });
      scripted = (c) => openaiReply(followUp(c) ? "One more look." : "Let me look.", { model: "o-1", finish: "tool_calls", toolCalls: [call(followUp(c) ? "c2" : "c1")] });
      const cappedO = await send("/v1/chat/completions", { model: "o-1", messages: [{ role: "user", content: "what did we decide about the cache" }] }, "s2-limit-openai");
      assert.equal(cappedO.status, 200, cappedO.text);
      const o = JSON.parse(cappedO.text).choices[0];
      assert.deepEqual([o.finish_reason, o.message.tool_calls], ["stop", undefined], "the rounds' words under stop, no call");
      assert.equal(endsOf("s2-limit-openai").length, 1, "Chat Completions at the round limit: the turn's end is said");
    } finally {
      scripted = null;
    }
  });

  // (fails before: yes — a prepare that threw after it had opened the request's turn, or gone on with it, answered as if no
  // turn ran: the request left the turns running and its record named no turn, so its reply was never archived, its turn
  // read as running until a restart cut it off, and its end went unsaid)
  test("a request whose memory failed after its turn was known still runs that turn: its reply archived, its running mark gone at its close, its end said — a leg's too, with its work", async () => {
    const archive = /** @type {any} */ (shim.app.memory).archive;
    const blocksFor = archive.blocksFor;
    /** The next read of a chat's blocks throws, as a busy file would: prepare fails once the turn is known. */
    const failOnce = () => {
      archive.blocksFor = () => {
        archive.blocksFor = blocksFor;
        throw new Error("database is locked");
      };
    };
    try {
      failOnce();
      const one = await send("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("summarise the notes")] }, "s3a-turn");
      assert.equal(one.status, 200, one.text);
      assert.equal(archive.blocksFor, blocksFor, "its prepare failed");
      const [turn] = archive.getTurns(chainOf("s3a-turn"));
      assert.equal((await shim.record(one.id)).memory?.turnId, turn.id, "its record names the turn it ran");
      assert.equal(replyText(archive.getMessage(turn.final_hash)?.message), "MODEL ANSWER", "its reply is archived on it");
      assert.equal(turn.meta?.running, undefined, "its close took the turn's running mark");
      assert.equal(endsOf("s3a-turn").length, 1, "its end is said");
      // A loop's last leg whose prepare fails
      const asked = [SYS, person("read my notes")];
      scripted = () => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [call] });
      await send("/v1/messages", { model: "m-1", max_tokens: 100, messages: asked }, "s3a-leg");
      scripted = null;
      failOnce();
      await send("/v1/messages", { model: "m-1", max_tokens: 100, messages: [...asked, { role: "assistant", content: [call] }, result] }, "s3a-leg");
      assert.equal(archive.blocksFor, blocksFor, "the leg's prepare failed");
      const [looped] = archive.getTurns(chainOf("s3a-leg"));
      assert.equal(looped.work.length, 2, "the loop so far is the turn's work");
      assert.equal(replyText(archive.getMessage(looped.final_hash)?.message), "MODEL ANSWER", "the leg's reply is its final");
      assert.equal(endsOf("s3a-leg").length, 1, "the leg's end is said");
    } finally {
      archive.blocksFor = blocksFor;
      scripted = null;
    }
  });

  // (fails before: yes — a leg on a branch of its turn, and a leg of a turn the archive does not hold, archived nothing and
  // ran no turn as far as memory knew: the last leg of such a loop closed with no end said)
  test("a loop's last leg on a branch of its turn, or of a turn the archive does not hold, archives nothing and says the end", async () => {
    const archive = /** @type {any} */ (shim.app.memory).archive;
    const asked = [SYS, person("read my notes")];
    try {
      scripted = () => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [call] });
      await send("/v1/messages", { model: "m-1", max_tokens: 100, messages: asked }, "s3b-branch");
      scripted = null;
      assert.deepEqual(endsOf("s3b-branch"), [], "its loop waits on the call");
      // The client edited the call before it answered it: the leg's history parts from the archived turn
      const edited = { ...call, input: { path: "other.md" } };
      const leg = await send("/v1/messages", { model: "m-1", max_tokens: 100, messages: [...asked, { role: "assistant", content: [edited] }, result] }, "s3b-branch");
      assert.equal(leg.status, 200, leg.text);
      const [turn] = archive.getTurns(chainOf("s3b-branch"));
      assert.deepEqual([archive.getMessage(turn.final_hash)?.message?.content, turn.work], [[call], []], "nothing of the branch is archived: its final, and no work");
      assert.equal(endsOf("s3b-branch").length, 1, "the branch's last leg says the end");
      // A loop whose person message the archive never held
      const unknown = await send("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("a turn this archive never saw"), { role: "assistant", content: [call] }, result] }, "s3b-unknown");
      assert.equal(unknown.status, 200, unknown.text);
      assert.deepEqual(archive.getTurns(chainOf("s3b-unknown")), [], "nothing is archived");
      assert.equal(endsOf("s3b-unknown").length, 1, "its last leg says the end");
    } finally {
      scripted = null;
    }
  });

  // (fails before: yes — the end was said once per request and What happened counted each as a turn finished: a request
  // that failed ended its turn, and the retry that went on with that turn ended it again, as a second one)
  test("a client's request that fails ends its turn at once; its retry goes on with the same turn, which What happened counts once", async () => {
    const archive = /** @type {any} */ (shim.app.memory).archive;
    const folder = mkdtempSync(join(tmpdir(), "filament-retry-"));
    const sid = "d6-retry";
    try {
      const first = [SYS, person("start the work")];
      await send("/v1/messages", { model: "m-1", max_tokens: 100, messages: first }, sid, folder);
      const chain = chainOf(sid);
      const project = archive.getChain(chain)?.project_id;
      const made = await shim.api(`/api/space/${encodeURIComponent(project)}`, { method: "POST", body: {} });
      assert.equal(made.status, 200, await made.clone().text());
      /** The chat's line in its project's What happened. */
      const line = async () => ((await (await shim.api(`/api/space/${encodeURIComponent(project)}`)).json()).log || []).find((/** @type {any} */ e) => e.by?.kind === "filament" && e.by?.chain === chain) || null;
      const asked = [...first, { role: "assistant", content: "MODEL ANSWER" }, person("now read my notes")];
      // Its upstream is overloaded: the request fails, and its turn ends at once
      scripted = () => ({ status: 529, json: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } });
      const failed = await send("/v1/messages", { model: "m-1", max_tokens: 100, messages: asked }, sid, folder);
      assert.equal(failed.status, 529, failed.text);
      const said = await until(line, "the failed turn's line in What happened");
      assert.match(said.text, /finished a turn/);
      // The client sends it again: the same turn goes on, its reply calls a tool, and the leg that answers the call ends it
      scripted = () => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [call] });
      const again = await send("/v1/messages", { model: "m-1", max_tokens: 100, messages: asked }, sid, folder);
      assert.equal(again.status, 200, again.text);
      scripted = null;
      await send("/v1/messages", { model: "m-1", max_tokens: 100, messages: [...asked, { role: "assistant", content: [call] }, result] }, sid, folder);
      const turns = archive.getTurns(chain);
      assert.equal(turns.length, 2, "the retry and its leg go on with the turn that failed: no turn more");
      assert.equal(replyText(archive.getMessage(turns[1].final_hash)?.message), "MODEL ANSWER", "the leg's reply is its final");
      assert.deepEqual(
        endsOf(sid).map((e) => [e[1], e[2]]),
        [
          [1, false],
          [2, true],
          [2, false],
        ],
        "each end names its turn, and whether it failed: the failure's and the leg's are one",
      );
      const read = await until(async () => {
        const l = await line();
        return l && l.at > said.at ? l : null;
      }, "the leg's end read into What happened");
      assert.equal(read.id, said.id, "the same line");
      assert.match(read.text, /finished a turn/, "the turn counted once");
    } finally {
      scripted = null;
      await removeDirs(folder);
    }
  });

  // (fails before: yes — the review of 3e39c9cd9: a client that hung up while Filament waited for it to read its stream
  // (`waitDrain`) closed the request "ok", no error — a finished reply — and its end was said as not failed, so its
  // retry under the same turn counted as a turn more)
  test("a streamed request whose client hangs up while Filament waits for it to read is aborted, its end said as failed", async () => {
    const sid = "hung-up";
    const base = /** @type {any[]} */ (anthropicStream("ab", { model: "m-1" }).sse);
    const big = "x".repeat(64 * 1024);
    const delta = { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: big } } };
    try {
      // A reply far bigger than the sockets hold: the send waits for a client that reads nothing.
      scripted = () => ({ sse: [...base.slice(0, 2), ...Array.from({ length: 300 }, () => delta), ...base.slice(4)] });
      const id = await new Promise((resolve, reject) => {
        const req = request(`${shim.url}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": shim.key, "x-session-id": sid, "x-filament-cwd": process.cwd(), "user-agent": "opencode/1.2" } }, (res) => {
          res.pause();
          const rid = String(res.headers["x-filament-request-id"]);
          // Hung up once the reply has stalled on the client: its record's output, short of the whole, has stopped
          // growing — Filament waits for the client to read.
          /** @type {number[]} */
          const seen = [];
          const stalled = async () => {
            const n = Number((await shim.record(rid))?.liveOutChars) || 0;
            seen.push(n);
            return (n > 0 && n < 300 * big.length && seen.length >= 5 && seen.slice(-5).every((x) => x === n)) || null;
          };
          // One that never stalls fails the test with until's words, rather than leave it waiting.
          until(stalled, `${rid}'s reply stalled on its client`).then(
            () => {
              req.destroy();
              resolve(rid);
            },
            (e) => {
              req.destroy();
              reject(e);
            },
          );
        });
        req.on("error", () => {});
        req.end(JSON.stringify({ model: "m-1", max_tokens: 100, stream: true, messages: [SYS, person("write the whole book")] }));
      });
      await until(async () => (await shim.record(id))?.totalMs != null || null, `${id}'s record closed`);
      const rec = await shim.record(id);
      assert.deepEqual([rec.status, rec.error], ["aborted", "client disconnected"]);
      assert.deepEqual(
        endsOf(sid).map((e) => e[2]),
        [true],
        "its end is said as failed: a retry goes on with its turn",
      );
    } finally {
      scripted = null;
    }
  });

  // (fails before: yes — the review of the client-retry commits: What happened counted every end said again under a
  // turn's number as that turn, and a muted chat's streamed reply left its turn open, so the archive filed the client's
  // next message of the same words in it: two turns finished read "finished a turn". Since dc8094809 each streamed reply
  // finishes its turn, and the next message is a turn of its own — before it, the ends said were turns 1, 2 and 2 again;
  // the rule for a number said again stays pinned in space-server.test.js)
  test("a muted chat's two streamed turns, each ended by its reply, are two turns of the archive and two in What happened", async () => {
    const archive = /** @type {any} */ (shim.app.memory).archive;
    const folder = mkdtempSync(join(tmpdir(), "filament-muted-"));
    const sid = "d6-muted";
    try {
      const first = [SYS, person("start the work")];
      await send("/v1/messages", { model: "m-1", max_tokens: 100, messages: first }, sid, folder);
      const chain = chainOf(sid);
      assert.ok(chain, "the client's chat is on record");
      const project = archive.getChain(chain)?.project_id;
      const made = await shim.api(`/api/space/${encodeURIComponent(project)}`, { method: "POST", body: {} });
      assert.equal(made.status, 200, await made.clone().text());
      archive.mergeMeta(chain, { muted: true });
      /** The chat's line in its project's What happened. */
      const line = async () => ((await (await shim.api(`/api/space/${encodeURIComponent(project)}`)).json()).log || []).find((/** @type {any} */ e) => e.by?.kind === "filament" && e.by?.chain === chain) || null;
      const asked = [...first, { role: "assistant", content: "MODEL ANSWER" }, person("continue")];
      const one = await send("/v1/messages", { model: "m-1", max_tokens: 100, stream: true, messages: asked }, sid, folder);
      assert.equal(one.status, 200, one.text);
      const said = await until(line, "the first turn's line in What happened");
      assert.match(said.text, /finished a turn/);
      const two = await send("/v1/messages", { model: "m-1", max_tokens: 100, stream: true, messages: [...asked, { role: "assistant", content: "MODEL ANSWER" }, person("continue")] }, sid, folder);
      assert.equal(two.status, 200, two.text);
      const read = await until(async () => {
        const l = await line();
        return l && l.at > said.at ? l : null;
      }, "the second turn's end read into What happened");
      assert.equal(read.id, said.id, "the same line, grown");
      assert.match(read.text, /finished 2 turns/, "two turns");
      assert.deepEqual(
        endsOf(sid).map((e) => [e[1], e[2]]),
        [
          [1, false],
          [2, false],
          [3, false],
        ],
        "each streamed reply finishes its turn: the next message of the same words is a turn of its own",
      );
    } finally {
      await removeDirs(folder);
    }
  });
});

// (fails before: yes — at 93facea1e's parent: a prepare that threw once the turn was known answered with no chat, so a
// harness turn's request went without filament_recall, which rides on every request of Filament's own chats; the review
// of the client-retry commits asked that this be meant and pinned) The loop runs every harness turn now, never off (the
// owner's of 11-09), and carries it in its own tools whatever prepare did.
test("a harness turn whose memory failed after its turn was known carries filament_recall, as every request of Filament's own chats does", async (t) => {
  /** @type {any[]} */
  const calls = [];
  const up = await fakeUpstream((c) => {
    calls.push(c);
    return undefined;
  });
  const shim = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    },
  });
  const folder = mkdtempSync(join(tmpdir(), "filament-recall-"));
  t.after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(folder);
  });
  const archive = /** @type {any} */ (shim.app.memory).archive;
  const blocksFor = archive.blocksFor;
  const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: null } });
  assert.equal(made.status, 200, await made.clone().text());
  const id = String((await made.json()).id);
  archive.blocksFor = () => {
    archive.blocksFor = blocksFor;
    throw new Error("database is locked");
  };
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: [{ type: "text", text: "summarise the notes" }], stream: false } });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(archive.blocksFor, blocksFor, "its prepare failed");
  assert.deepEqual(
    calls.map((c) => (c.body?.tools || []).some((/** @type {any} */ x) => x.name === "filament_recall")),
    [true],
    "one request went upstream, filament_recall on it",
  );
});
