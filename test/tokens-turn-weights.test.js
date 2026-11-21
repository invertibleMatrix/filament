// @ts-check
// The owner's report of 11-02: "filament starts crawling". Their main chat holds 120 turns and 27,436 messages, 55.8 MB
// of tool calls and results. The composition weighs its history by what the sessions keep (tokens.js `createBlockWeights`,
// by the archive's names), but the turn then weighed all of it again from its bytes, stringifying and hashing every call
// and result: its start estimate (turn.js), the loop's first measure of its own copy (loop.js), and at every round the
// calibration's estimate of the request as the front door read it back (reply-stream.js) — about a quarter of a second
// each on a 58 MB chat, seconds once the memo of texts had let them go — and once more for each fork the loop's fold at
// the line makes (turn.js `forkRounds`, autofit.js). They weigh by the kept weights now, and send and decide exactly as
// a fresh count does.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { estimateBodyTokens } from "../src/core/tokens.js";
import { calibFactor, calibKey, calibSnapshot } from "../src/services/token-calib.js";

/** @param {any} b */
const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
/** @param {any} m */
const lastText = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ c) => c?.type === "text").map((/** @type {any} */ c) => c.text).join("\n"));
// Every reply says what it read, as a provider's does: the calibration weighs the request against it.
const USAGE = { input_tokens: 30, output_tokens: 7, cache_read_input_tokens: 20, cache_creation_input_tokens: 10 };
/** A reply as JSON. @param {any[]} blocks @param {string} [stop] @param {any} [usage] */
const answer = (blocks, stop = "end_turn", usage = USAGE) => anthropicReply("", { model: "weigh-model", stop, blocks, usage });
/**
 * A reply as a stream of events, its blocks each whole in one delta.
 * @param {any[]} blocks @param {string} [stop] @param {any} [usage]
 */
const streamed = (blocks, stop = "end_turn", usage = USAGE) => {
  const ev = (/** @type {string} */ event, /** @type {any} */ data) => ({ event, data: { type: event, ...data } });
  return {
    sse: [
      ev("message_start", { message: { id: "msg_w", type: "message", role: "assistant", model: "weigh-model", content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } }),
      ...blocks.flatMap((b, index) =>
        b.type === "tool_use"
          ? [ev("content_block_start", { index, content_block: { ...b, input: {} } }), ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }), ev("content_block_stop", { index })]
          : [ev("content_block_start", { index, content_block: { type: "text", text: "" } }), ev("content_block_delta", { index, delta: { type: "text_delta", text: b.text } }), ev("content_block_stop", { index })],
      ),
      ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output_tokens } }),
      ev("message_stop", {}),
    ],
  };
};
/** @param {string} id @param {string} path */
const read =(id, path) => ({ type: "tool_use", id, name: "read", input: { path } });

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let root;
/** The loop's rounds of the turn running, as the provider received them. @type {any[]} */
let rounds = [];
/** The summaries the loop's fold at the line asked for in the turn running. @type {any[]} */
let summaries = [];

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-turn-weights-"));
  for (const f of ["a", "b"]) writeFileSync(join(root, `${f}.txt`), `MARKER-${f.toUpperCase()} ${"words ".repeat(6000)}`);
  up = await fakeUpstream(async (call) => {
    const b = call.body || {};
    // A reply to fresh-model reads what a fresh count of its request says, so the calibration learns 1 from each.
    const usage = b.model === "fresh-model" ? { input_tokens: estimateBodyTokens(b, "request"), output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } : USAGE;
    if (sysOf(b).includes("compaction summaries") || /^\[Filament: this turn has reached the compaction line\./.test(lastText(b.messages?.at(-1)))) {
      summaries.push(b);
      return answer([{ type: "text", text: "<summary>\nSUMMARY-OF-EARLIER-ROUNDS\n</summary>" }], "end_turn", usage);
    }
    // The rounds stream (reply-stream.js); the fold's fork is answered whole (reply-json.js).
    rounds.push(b);
    if (rounds.length === 1) return streamed([read("r1", "a.txt")], "tool_use", usage);
    if (rounds.length === 2) return streamed([read("r2", "b.txt")], "tool_use", usage);
    return streamed([{ type: "text", text: "Done." }], "end_turn", usage);
  });
  shim = await startApp({
    memory: true,
    configure: (/** @type {any} */ cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "weigh-model": { input: 1, output: 1, contextTokens: 100000 }, "fresh-model": { input: 1, output: 1, contextTokens: 100000 } } }];
      cfg.routes = [
        { match: "weigh-*", upstream: "m", upstreamModel: "{model}", enabled: true },
        { match: "fresh-*", upstream: "m", upstreamModel: "{model}", enabled: true },
      ];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  await removeDirs(root);
});

/**
 * A chat of three finished turns of tool calls and results, the same words in every chat made: the archive keeps a
 * message once by its bytes, so every such chat's blocks have the same names. Its line, 35% of the 100,000-token
 * window, is under what the turn starts with (≈31,000, the loop's prompt and tools most of it) and past it once the turn
 * read both files: the loop folds its first round at its third.
 */
async function chat(model = "weigh-model") {
  const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain", settings: { context: { compaction: { thresholdPercent: 35, mode: "auto" } } } } });
  assert.equal(made.status, 200, await made.clone().text());
  const id = String((await made.json()).id);
  const archive = /** @type {any} */ (shim.app.memory).archive;
  for (let t = 1; t <= 3; t++) {
    const turn = archive.beginTurn(id, { requestId: `h${t}`, model, client: "harness", userMessage: { role: "user", content: [{ type: "text", text: `look at part ${t} ${"of the project ".repeat(20)}` }] } });
    const work = [];
    for (let k = 1; k <= 3; k++)
      work.push(
        { role: "assistant", content: [{ type: "text", text: `Reading part ${t}.${k}.` }, { type: "tool_use", id: `h_${t}_${k}`, name: "read", input: { path: `src/part${t}_${k}.js` } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: `h_${t}_${k}`, content: `const part${t}_${k} = ${k}; // ${"what the file holds ".repeat(60)}` }] },
      );
    archive.addWork(turn.turnId, work);
    archive.finishTurn(turn.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: `Part ${t} read.` }] }, requestId: `h${t}` });
  }
  return id;
}

/**
 * How many times JSON.stringify ran on a block `which` picks, while `fn` ran: what weighs a block from its bytes
 * stringifies it.
 * @template T @param {(b: any) => boolean} which @param {() => Promise<T>} fn @returns {Promise<{ value: T, n: number }>}
 */
const stringified = async (which, fn) => {
  const was = JSON.stringify;
  let n = 0;
  JSON.stringify = /** @type {any} */ ((/** @type {any[]} */ ...a) => {
    const v = a[0];
    if (v && typeof v === "object" && !Array.isArray(v) && which(v)) n++;
    return was.apply(JSON, /** @type {any} */ (a));
  });
  try {
    return { value: await fn(), n };
  } finally {
    JSON.stringify = was;
  }
};
/** The history's calls and results (their ids `h_…`). @template T @param {() => Promise<T>} fn */
const historyStringified = (fn) => stringified((v) => (v.type === "tool_use" && /^h_/.test(v.id)) || (v.type === "tool_result" && /^h_/.test(v.tool_use_id)), fn);

/** One turn of a chat: the provider's rounds and the fold's summaries, and the turn's own record. @param {string} id */
async function turnOf(id) {
  rounds = [];
  summaries = [];
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "read a and b", stream: false } });
  assert.equal(r.status, 200, await r.clone().text());
  await r.json();
  const rec = (await shim.records(20)).find((/** @type {any} */ x) => x.view?.composed === true) || null;
  return { rounds, summaries, rec: rec ? await shim.record(rec.id) : null };
}

// (fails before: yes — the second turn stringified each of the history's 18 calls and results at its start estimate, at
// the loop's first measure, and at each round's calibration and fork)
test("a turn weighs its history by what the composition kept, and sends and decides as a fresh count does", async () => {
  const fresh = await chat();
  const reused = await chat();
  // The first chat's turn weighs its blocks from their bytes: none of them was weighed before.
  const first = await historyStringified(() => turnOf(fresh));
  assert.ok(first.n > 0, `the first turn weighed the history from its bytes (${first.n})`);
  // The second's are the same blocks by name, weighed in the first — but the copy the cache's marker makes of the result
  // the request before ended at (shaping.js `applyCache`), a new block, as the newest message's marked block is.
  const second = await stringified((v) => !v.cache_control && ((v.type === "tool_use" && /^h_/.test(v.id)) || (v.type === "tool_result" && /^h_/.test(v.tool_use_id))), () => turnOf(reused));
  assert.equal(second.n, 0, "the second turn stringified no call or result of the history");
  assert.equal(first.value.summaries.length, 1, "the loop's fold at the line ran");
  assert.equal(first.value.rounds.length, 3);
  assert.deepEqual(second.value.rounds, first.value.rounds, "the same requests, round by round");
  assert.deepEqual(second.value.summaries, first.value.summaries, "the same fork of the conversation for the fold");
  assert.ok(first.value.rec?.context?.estimate > 0);
  assert.deepEqual(second.value.rec?.context, first.value.rec?.context, "the same start estimate, line and verdict");
  assert.ok(first.value.rec?.changes?.some((/** @type {string} */ c) => /compacted rounds 1–1 of this turn at the compaction line.*→/.test(c)), "the fold's figures are said");
  assert.deepEqual(second.value.rec?.changes, first.value.rec?.changes, "the same notes: the clamps, and the fold with its figures");
});

// (fails before: yes — the fork named the loop's blocks anew, so its front door weighed the turn's own call from its
// bytes once more: 3)
test("the fold's fork sends the loop's blocks by the names its rounds sent them by: the front door weighs none of them again", async () => {
  const id = await chat();
  const own = await stringified((v) => v.type === "tool_use" && v.id === "r1", () => turnOf(id));
  assert.equal(own.value.summaries.length, 1, "the loop's fold at the line ran");
  assert.ok(own.value.summaries[0].messages.some((/** @type {any} */ m) => Array.isArray(m.content) && m.content.some((/** @type {any} */ c) => c?.type === "tool_use" && c.id === "r1")), "the fork carries the turn's own call");
  // The second round sent it, not the newest block (which the cache's marker makes a new one): weighed there by its name.
  assert.equal(own.n, 2, "the turn's own call, weighed from its bytes by the loop's keeper and once at the front door");
});

// (fails before: no — a guard of what the kept weights stand for: a copy named after a block of other words, as a copy
// named after the message beside its own at the loop's start or at the front door is, weighs by the other's words — the
// factor learned 1.0018 so)
test("each round and the fold's fork are weighed at the front door as a fresh count weighs them: replies that read what a fresh count says teach the calibration 1, exactly", async () => {
  let replies = 0;
  for (let c = 0; c < 2; c++) {
    const t = await turnOf(await chat("fresh-model"));
    assert.equal(t.summaries.length, 1, "the loop's fold at the line ran");
    replies += t.rounds.length + t.summaries.length;
  }
  const learned = calibSnapshot().find((e) => e.key === calibKey("m", "fresh-model"));
  assert.equal(learned?.n, replies, "every reply was weighed against its request");
  assert.equal(calibFactor("m", "fresh-model"), 1);
});
