// The recall tool on every request of Filament's own chats (the owner's rules of 10-31: prompt caching stays intact).
// A fork reads the ticks' cache, so it carries the ticks' exact tools, filament_recall among them, or its prefix
// differs from theirs and the provider reads it all again at full price; a fold changes the messages, never the tools.
// An outside client's request is proxied: memory apart, Filament adds nothing to it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeUpstream, startApp, anthropicReply } from "./helpers/app.js";

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let root;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-recall-fork-"));
  for (const name of ["one", "two", "three"]) writeFileSync(join(root, `${name}.txt`), Array.from({ length: 400 }, (_, i) => `${name} line ${i}: some words to read`).join("\n"));
  up = await fakeUpstream(async (call) => {
    const b = call.body;
    const last = b.messages.at(-1);
    const text = typeof last?.content === "string" ? last.content : (last?.content || []).map((/** @type {any} */ x) => x?.text || "").join("");
    if (/compaction line/.test(text)) return anthropicReply("<summary>Read one, two and three.</summary>", { model: "brain-model" });
    const answered = Array.isArray(last?.content) && last.content.some((/** @type {any} */ x) => x.type === "tool_result");
    const file = (/read (\w+)\.txt/.exec(text) || [])[1] || "one";
    return answered
      ? anthropicReply("Read it.", { model: "brain-model" })
      : anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: `r-${file}-${call.n}`, name: "read", input: { path: `${file}.txt` } }] });
  });
  shim = await startApp({
    memory: true,
    keep: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, contextTokens: 200_000 } } }];
      cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.memory.autopilot = { enabled: false };
      cfg.memory.capture = { turns: true, learn: false };
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
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

/** The tools a call offered, by name. @param {any} body */
const toolNames = (body) => (body.tools || []).map((/** @type {any} */ t) => t.name);

/** A fresh session, and its turns and its same-model summary as the provider saw them, each by its tools' names. */
const session = async () => {
  const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
  if (made.status !== 200) assert.fail(await made.text());
  const id = (await made.json()).id;
  return {
    id,
    /** Each round's tools of one turn. @param {string} content */
    turn: async (content) => {
      const from = up.received.length;
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
      if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
      const rounds = up.received.slice(from).map((c) => toolNames(c.body));
      assert.ok(rounds.length >= 2, `the turn's rounds: ${rounds.length}`);
      return rounds;
    },
    fork: async () => {
      const before = up.received.length;
      // Whether the summary is then kept is the compaction's own weighing: what is asked here is the call that wrote it.
      await shim.api(`/api/sessions/${encodeURIComponent(id)}/compact`, { method: "POST", body: { method: "summary", once: { writer: "session" } } });
      const fork = up.received.slice(before).map((c) => c.body).find((b) => /compaction line/.test(JSON.stringify(b.messages.at(-1))));
      assert.ok(fork, "the same model's summary forked the warm cache");
      return toolNames(fork);
    },
  };
};

// (fails before: the recall tool came with the fold — the session's first ticks and a fork before any fold went
// without it and the ticks after the fold carried it, so the tools section changed under the cached conversation)
test("the same model's summary forks the warm cache with the ticks' exact tools, filament_recall among them — before a fold and after", async () => {
  const fresh = await session();
  const first = await fresh.turn("read one.txt");
  const tickTools = first[0];
  assert.ok(tickTools.includes("filament_recall"), `the session's first tick offers the recall tool: ${tickTools.join(", ")}`);
  assert.deepEqual(first, first.map(() => tickTools), "every round of the turn the same tools");
  assert.deepEqual(await fresh.fork(), tickTools, "a fork before any fold: the ticks' tools, in their order");

  const s = await session();
  assert.deepEqual(await s.turn("read one.txt"), first, "a session's first turn: the same tools");
  await s.turn("read two.txt");
  const folded = await shim.api(`/api/sessions/${encodeURIComponent(s.id)}/compact`, { method: "POST", body: { method: "fold" } });
  assert.equal(folded.status, 200, await folded.clone().text());
  const after = await s.turn("read three.txt");
  assert.deepEqual(after, after.map(() => tickTools), "after the fold, the tools of the session's first tick");
  assert.deepEqual(await s.fork(), tickTools, "and a fork after the fold");
});

// (fails before: yes — the tool rode by the chain's document wherever a request was situated on it, so a client naming
// a Filament session by x-filament-chain was offered it by the session's result cap; the owner's rule of 10-31: a
// client's x-filament-chain was believed, so its request went on in the Filament session it named)
test("an outside client's request is proxied with no recall tool, on its own chain — one naming a Filament session by x-filament-chain too, which is dropped", async () => {
  const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { resultCapChars: 400 } } } });
  if (made.status !== 200) assert.fail(await made.text());
  const id = (await made.json()).id;
  for (const headers of [{ "x-session-id": "recall-client-own", "x-filament-cwd": root }, { "x-filament-chain": id, "x-filament-cwd": root }]) {
    const from = up.received.length;
    const r = await shim.post("/v1/messages", { model: "brain-model", max_tokens: 100, messages: [{ role: "user", content: "hello there" }] }, headers);
    assert.equal(r.status, 200, await r.clone().text());
    const sent = up.received.slice(from).map((c) => c.body);
    assert.equal(sent.length, 1, `one request, as the client sent it: ${sent.length}`);
    assert.ok(!toolNames(sent[0]).includes("filament_recall"), `${JSON.stringify(headers)}: ${toolNames(sent[0]).join(", ")}`);
    const rec = await shim.record(String(r.headers.get("x-filament-request-id")));
    assert.notEqual(rec.memory?.chain, id, "not the Filament session's");
    const notes = [...(rec.changes || []), ...(rec.priorChanges || [])];
    if (headers["x-filament-chain"]) assert.ok(notes.some((/** @type {string} */ c) => /dropped x-filament-chain/.test(c)), notes.join(" | "));
  }
});
