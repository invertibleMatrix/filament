// @ts-check
// The owner's report of 11-02: "filament starts crawling … makes filament totally unusable". Their main chat holds 120
// turns and 27,436 messages, 55.8 MB of tool calls and results, and every preview, view and composition weighed every
// block of it again — the turns are read from the archive anew each time, so the keeper of one composition knew none
// of them, and the memo of texts (20,000 of them) was past its bound, dropping each text just before the next pass
// read it: 4–6 s on the main thread a pass. A block the archive names is weighed once, whichever copy of it a pass
// reads, and the memo holds a long chat's texts.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBlockWeights, createTokenMemo, estimateBodyParts } from "../src/core/tokens.js";
import * as tokens from "../src/core/tokens.js";
import { MEDIA_BYTES } from "../src/core/media.js";
import { MemoryService } from "../src/services/memory/index.js";
import { sidecar } from "../src/adapters/sidecar/index.js";
import { createSessions } from "../src/app/sessions/service.js";
import { compose } from "../src/app/sessions/compose.js";

const long = (/** @type {string} */ s) => `${s} `.repeat(120);
/** A conversation with every kind of block a count treats apart. @returns {any[]} */
const convo = () => [
  { role: "user", content: long("the developer's first message, as one string") },
  {
    role: "assistant",
    content: [
      { type: "thinking", thinking: long("signed thought"), signature: "sig" },
      { type: "thinking", thinking: long("unsigned thought") },
      { type: "redacted_thinking", data: "x".repeat(400) },
      { type: "text", text: long("a reply") },
      { type: "tool_use", id: "t1", name: "read", input: { path: "a.txt", note: long("input") } },
    ],
  },
  {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "t1", content: long("what the file holds") },
      { type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: long("seen") }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] },
      { type: "document", source: { type: "base64", data: "B".repeat(8000) } },
    ],
  },
];

/**
 * How many times JSON.stringify ran on a value `pick` names, while `fn` ran.
 * @template T @param {(v: any) => boolean} pick @param {() => T} fn @returns {Promise<{ value: Awaited<T>, n: number }>}
 */
const stringified = async (pick, fn) => {
  const was = JSON.stringify;
  let n = 0;
  JSON.stringify = /** @type {any} */ ((/** @type {any[]} */ ...a) => {
    if (pick(a[0])) n++;
    return was.apply(JSON, /** @type {any} */ (a));
  });
  try {
    return { value: await fn(), n };
  } finally {
    JSON.stringify = was;
  }
};
const isBlock = (/** @type {any} */ v) => !!v && typeof v === "object" && !Array.isArray(v) && typeof v.type === "string";
const isCall = (/** @type {any} */ v) => isBlock(v) && (v.type === "tool_use" || v.type === "tool_result");

/** A copy of the conversation as a pass reads it from the archive, each block named as the archive names it. */
const named = () => {
  /** @type {WeakMap<object, string>} */
  const names = new WeakMap();
  const read = () => {
    const c = structuredClone(convo());
    c.forEach((m, i) => Array.isArray(m.content) && m.content.forEach((/** @type {any} */ b, j) => names.set(b, `m${i}:${j}`)));
    return c;
  };
  return { read, nameOf: (/** @type {object} */ b) => names.get(b) };
};

// (fails before: yes — the keeper knew a block by the object alone, and each pass's copy was weighed and stringified anew)
test("a block the archive names is weighed once, whichever copy of it a pass reads, in every choice of thinking", async () => {
  const { read, nameOf } = named();
  const weights = createBlockWeights(nameOf);
  for (const thinking of /** @type {const} */ (["all", "signed", "none"])) {
    const plain = estimateBodyParts({ messages: read() }, "conversation", { thinking });
    const first = await stringified(isBlock, () => estimateBodyParts({ messages: read() }, "conversation", { thinking, weights }));
    assert.deepEqual(first.value, plain, thinking);
    assert.ok(first.n >= 2, `${thinking}: the first copy's calls and results were weighed (${first.n} stringified)`);
    const again = await stringified(isBlock, () => estimateBodyParts({ messages: read() }, "conversation", { thinking, weights }));
    assert.deepEqual(again.value, plain, `${thinking}, a second copy`);
    assert.equal(again.n, 0, `${thinking}: no block of the second copy stringified`);
  }
});

test("a named block put in another's place, or a block no name is given, is weighed by what it holds", () => {
  const { read, nameOf } = named();
  const weights = createBlockWeights(nameOf);
  estimateBodyParts({ messages: read() }, "conversation", { weights });
  const c = read();
  // As a result rewritten for the request: a new block where the named one was.
  c[2] = { ...c[2], content: [{ ...c[2].content[0], content: "[cleared]" }, ...c[2].content.slice(1)] };
  c[1].content.push({ type: "text", text: long("a note no name is given") });
  assert.deepEqual(estimateBodyParts({ messages: c }, "conversation", { weights }), estimateBodyParts({ messages: structuredClone(c) }, "conversation"));
});

// (fails before: yes — a keeper's block was taken as it was first weighed, whatever the next count said its media go as)
test("a keeper shared by counts that say different words for a picture weighs it by each count's own", () => {
  const { read, nameOf } = named();
  for (const weights of [createBlockWeights(), createBlockWeights(nameOf)]) {
    const c = read();
    const words = (/** @type {string} */ w) => (/** @type {any} */ b) => (b?.type === "image" || b?.type === "document" ? w : null);
    estimateBodyParts({ messages: c }, "conversation", { weights });
    for (const media of [words(long("a picture's words")), words("short"), null])
      assert.deepEqual(estimateBodyParts({ messages: c }, "conversation", { weights, media }), estimateBodyParts({ messages: c }, "conversation", { media }), `named: ${!!weights.named}`);
  }
});

// (fails before: yes — nothing cut a keeper's named weights: a long chat's kept every block it ever read, those under a
// summary or taken back with them)
test("a keeper is cut to the blocks read most recently, a block read again going to the back of the line", () => {
  const nameOf = (/** @type {any} */ b) => b.name;
  const weights = createBlockWeights(nameOf);
  const block = (/** @type {string} */ name) => ({ type: "text", text: long(name), name });
  const count = (/** @type {string[]} */ names) => estimateBodyParts({ messages: [{ role: "user", content: names.map(block) }] }, "conversation", { weights });
  const want = count(["a", "b", "c", "d", "e"]);
  count(["b"]);
  tokens.keepNamed(weights, 3);
  assert.deepEqual([...(weights.named?.kept.keys() || [])], ["d", "e", "b"], "a, then c, read longest ago, went first");
  tokens.keepNamed(weights, 3);
  assert.equal(weights.named?.kept.size, 3, "within its bound it keeps every one");
  assert.deepEqual(count(["a", "b", "c", "d", "e"]), want, "and the counts are the same, the cut ones weighed again");
  assert.equal(weights.named?.kept.size, 5, "a count never cuts its own keeper as it goes");
});

// (fails before: yes — 20,000 texts: a pass over more drops each text just before the next pass reads it, and counts all of them again)
test("the memo holds a long chat's texts: a second pass over 30,000 of them counts none again", () => {
  let calls = 0;
  const memo = createTokenMemo({ count: (s) => (calls++, s.length) });
  const texts = Array.from({ length: 30_000 }, (_, i) => `${i} `.padEnd(300, "x"));
  for (const s of texts) memo.count(s);
  assert.equal(calls, 30_000);
  for (const s of texts) memo.count(s);
  assert.equal(calls, 30_000, "every text of the second pass was remembered");
});

const dir = mkdtempSync(join(tmpdir(), "filament-tokens-named-"));
const folder = mkdtempSync(join(dir, "project-"));
let clock = 1_760_000_000_000;
const now = () => (clock += 1000);
// A route that reaches the chats' model: their requests weigh pictures as the send puts them (pdfs.js `mediaWeights`).
/** @type {any} */
const cfg = {
  server: { host: "127.0.0.1" }, rules: {}, agentLoop: { permissions: "edit" }, memory: { enabled: true }, sessions: { defaults: {} },
  upstreams: [{ id: "anth", type: "anthropic-compatible", enabled: true }],
  routes: [{ match: "claude-*", upstream: "anth", upstreamModel: "{model}", enabled: true }],
};
const config = { get: () => cfg };
const memory = new MemoryService(/** @type {any} */ ({ sidecar, getConfig: config.get, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20399", getModelNames: () => ["cheap"], now }));
memory.start();
const archive = /** @type {any} */ (memory.archive);
/** A sessions service of its own — its kept weights its own, none yet. @param {any} [extra] */
const sessionsWith = (extra = {}) => createSessions(/** @type {any} */ ({ memory, config, pipeline: { handle: async () => {} }, ops: { record: () => {} }, log: () => {}, forkSession: async () => ({}), now, ...extra }));
const sessions = sessionsWith();
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

let chats = 0;
/**
 * A chat of `n` finished turns, each of a few tool rounds, its words its own: the archive keeps a message once by its
 * bytes, so two chats of the same words would hold the same blocks.
 * @param {number} n
 */
function chatWith(n) {
  const { id } = sessions.create({ cwd: folder, model: "claude-x", preset: "plain" });
  const c = ++chats;
  for (let i = 1; i <= n; i++) {
    const t = archive.beginTurn(id, { requestId: `r${i}`, model: "claude-x", client: "harness", userMessage: { role: "user", content: [{ type: "text", text: `chat ${c}, turn ${i}: ${long("go on")}` }] } });
    const work = [];
    for (let k = 1; k <= 3; k++)
      work.push(
        { role: "assistant", content: [{ type: "thinking", thinking: long(`thought ${c}.${i}.${k}`), signature: `s${c}.${i}.${k}` }, { type: "tool_use", id: `t${c}_${i}_${k}`, name: "read", input: { path: `f${c}_${i}_${k}.js` } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: `t${c}_${i}_${k}`, content: long(`const x${c}_${i}_${k} = ${k}; // what file ${c}.${i}.${k} holds`) }] },
      );
    archive.addWork(t.turnId, work);
    archive.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: `chat ${c}, done ${i}` }] }, requestId: `r${i}` });
  }
  return id;
}

// (fails before: yes — each view and preview read the turns anew and stringified every call and result to weigh it again)
test("a second view and preview of a long chat weigh none of its calls and results again, and answer the same", async () => {
  const id = chatWith(6);
  const first = await stringified(isCall, () => sessions.contextView(id, "plain", { resultChars: Infinity }));
  assert.ok(first.n >= 36, `the first view weighs each call and result (${first.n})`);
  const second = await stringified(isCall, () => sessions.contextView(id, "plain", { resultChars: Infinity }));
  assert.equal(second.n, 0, "the second view stringified no call or result");
  assert.deepEqual(second.value, first.value);
  const folded = await sessions.contextView(id, "fold");
  const window = await stringified(isCall, () => sessions.windowView(id, {}));
  assert.equal(window.n, 0, "the window's view stringified none either");
  assert.equal(window.value.text, first.value?.text);
  assert.deepEqual(await sessions.contextView(id, "fold"), folded);
  const plan = await sessions.preview(id, { prompt: true, compaction: true });
  const again = await stringified(isCall, () => sessions.preview(id, { prompt: true, compaction: true }));
  assert.equal(again.n, 0, "the second preview, its compactor's plan with it, stringified none");
  assert.deepEqual(again.value, plan);
});

test("a request composed with the named weights is the same bytes and the same report, its reply's room clamped by them", async () => {
  const id = chatWith(5);
  const weights = createBlockWeights((b) => archive.contentName(b));
  const args = { compactions: [], settings: { model: { thinking: { budget: 4000 } } }, newUser: { role: "user", content: [{ type: "text", text: "next" }] }, model: "m", maxTokens: 64000 };
  const fresh = await compose({ ...args, turns: archive.turnBodies(id), window: 200000 });
  // A window the history nearly fills: max_tokens is clamped by what the request weighs.
  const window = fresh.report.sentTokens + 6000;
  const plain = await compose({ ...args, turns: archive.turnBodies(id), window });
  assert.ok(plain.body.max_tokens < 64000, "the window clamps the reply's room");
  for (let read = 0; read < 3; read++) {
    const kept = await stringified(isCall, () => compose({ ...args, turns: archive.turnBodies(id), window, weights }));
    assert.equal(JSON.stringify(kept.value.body), JSON.stringify(plain.body), `read ${read}: the same bytes`);
    assert.deepEqual(kept.value.report, plain.report, `read ${read}: the same report`);
    if (read) assert.equal(kept.n, 0, `read ${read}: no call or result weighed again`);
  }
});

// A chat of four turns holds 44 named blocks (each turn's message, three calls with their thinking and results, and its
// reply), 24 of them calls and results; one of a turn, 11 and 6.

// (fails before: yes — the bound was per session and never cut the one composed: a chat past it was kept whole, and the
// next composition of another chat dropped all of it)
test("the kept weights hold their bound, the chat composed last kept whole and the one before giving up only what it read longest ago", async () => {
  const small = sessionsWith({ weightsKept: 50 });
  const big = chatWith(4);
  const other = chatWith(1);
  const first = await small.contextView(big, "plain");
  await small.contextView(other, "plain");
  const again = await stringified(isCall, () => small.contextView(other, "plain"));
  assert.equal(again.n, 0, "the chat composed last is kept whole");
  const back = await stringified(isCall, () => small.contextView(big, "plain"));
  assert.ok(back.n > 0 && back.n < 24, `the one before gave up only the blocks it read longest ago (${back.n} of 24 weighed again)`);
  assert.deepEqual(back.value, first);
});

// (fails before: yes — the same)
test("a chat past the bound keeps the bound's worth of its weights, view after view", async () => {
  const small = sessionsWith({ weightsKept: 30 });
  const big = chatWith(4);
  const first = await small.contextView(big, "plain");
  for (let look = 0; look < 3; look++) {
    const again = await stringified(isCall, () => small.contextView(big, "plain"));
    assert.ok(again.n > 0 && again.n < 24, `look ${look}: weighed again only what the bound left out (${again.n} of 24)`);
    assert.deepEqual(again.value, first);
  }
});

// (fails before: yes — the prefix was cut from the block itself, which the composition had weighed and kept: the turns
// measured again, as a turn's compactor measures them, weighed the reply with the words the request no longer sent)
test("a recorded prefix taken off a composed reply goes as a copy of its block: the same bytes, and the turns measured again weigh what is left", async () => {
  const { id } = sessions.create({ cwd: folder, model: "claude-x", preset: "plain" });
  const cue = "Memory: past sessions may know this — `@mem sessions <words>`.";
  const t = archive.beginTurn(id, { requestId: "r1", model: "claude-x", client: "harness", userMessage: { role: "user", content: [{ type: "text", text: long("a question") }] } });
  archive.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: `${cue}\n\n${long("the model's own words")}` }] }, requestId: "r1" });
  memory.recordLocalText(id, "prefix", cue);
  const weights = createBlockWeights((b) => archive.contentName(b));
  const turns = archive.turnBodies(id);
  const args = { turns, compactions: [], settings: {}, newUser: { role: "user", content: [{ type: "text", text: "next" }] }, model: "m", window: 200000 };
  const c = await compose({ ...args, weights });
  // What the request goes as once the prefix is cut, as cutting it from the block itself made it.
  const want = structuredClone(c.body);
  const reply = want.messages.find((/** @type {any} */ m) => m.role === "assistant");
  reply.content[0].text = reply.content[0].text.slice(cue.length + 2);
  assert.equal(reply.content[0].text, long("the model's own words"));
  const sit = { format: "anthropic", body: c.body, responsesBody: null };
  assert.equal(memory.dropLocalTexts(sit, id), 1, "the reply lost its prefix");
  assert.equal(JSON.stringify(sit.body), JSON.stringify(want), "the same bytes as before");
  const measured = await compose({ ...args, weights });
  const fresh = await compose({ ...args });
  assert.ok(measured.report.sentTokens < c.report.sentTokens, "the prefix weighs no more");
  assert.deepEqual(measured.report, fresh.report, "the kept weights weigh the stripped reply as a fresh count does");
});

/** A picture of `n` characters of base64. @param {number} n */
const pic = (n) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(n) } });
/** A chat of two tool turns that show 30 MB of pictures in all, past a request's room of 24: the oldest go as words. */
function picturesChat() {
  const { id } = sessions.create({ cwd: folder, model: "claude-x", preset: "plain" });
  for (let i = 1; i <= 2; i++) {
    const t = archive.beginTurn(id, { requestId: `p${i}`, model: "claude-x", client: "harness", userMessage: { role: "user", content: [{ type: "text", text: long(`look ${i}`) }] } });
    archive.addWork(t.turnId, [
      { role: "assistant", content: [{ type: "tool_use", id: `v${i}`, name: "view", input: { path: `shots${i}` } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: `v${i}`, content: [{ type: "text", text: long(`shots ${i}`) }, ...Array.from({ length: 5 }, () => pic(3 * 1024 * 1024))] }] },
    ]);
    archive.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: long(`seen ${i}`) }] }, requestId: `p${i}` });
  }
  return id;
}

/** A preview's figures, every one: what each form weighs, and each way of making room. @param {any} p */
const figures = (p) => ({
  current: { tokens: p.current.tokens, whole: p.current.whole, historyTokens: p.current.historyTokens, perTurn: p.current.perTurn.map((/** @type {any} */ t) => t.tokens), prompt: p.current.prompt?.tokens ?? null },
  forms: Object.fromEntries(Object.entries(p.forms).map(([k, f]) => [k, [f.tokens, f.historyTokens, ...(f.perTurn || []).map((/** @type {any} */ t) => t.tokens)]])),
  plan: p.compaction ? JSON.stringify(p.compaction, (_k, v) => (typeof v === "string" ? undefined : v)) : null,
});

test("a preview's figures — across the forms, with pictures past the room, and the compactor's plan — are the ones a fresh count gives", async () => {
  const id = picturesChat();
  for (const asked of [{}, { prompt: true, compaction: true }]) {
    // Cold: a service of its own, whose keeper has weighed nothing.
    const cold = await sessionsWith().preview(id, asked);
    // Warm: the kept weights of earlier views and previews.
    const warmed = sessionsWith();
    await warmed.contextView(id, "plain");
    await warmed.preview(id, {});
    await warmed.preview(id, { prompt: true, compaction: true });
    // A result that shows pictures is weighed anew at every count (what goes of them moves with the request); a call is kept.
    const warm = await stringified((v) => isBlock(v) && v.type === "tool_use", () => warmed.preview(id, asked));
    assert.equal(warm.n, 0, "the warm preview weighed no call again");
    assert.deepEqual(figures(warm.value), figures(cold), "the same figures");
    assert.deepEqual(warm.value, cold, "and the same answer");
  }
  // The pictures past the room weighed as their words: less than every picture at its own rate.
  assert.ok(10 * 3 * 1024 * 1024 > MEDIA_BYTES, "the chat's pictures are past a request's room");
  const p = await sessions.preview(id, { prompt: true });
  const flat = estimateBodyParts({ messages: p.current.prompt.messages });
  assert.ok(p.current.tokens <= flat.text + flat.fixed - 2 * 1500, `${p.current.tokens} tokens, ${flat.text + flat.fixed} with every picture at ~1,500`);
});
