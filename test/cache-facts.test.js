// @ts-check
// Whether a model call said its cache numbers, carried from where its usage is read to the ledger the page reads (the
// owner's of 11-11: a chat on Cursor, which gives none, drew "Cache 0% warm 5 min", "Session average 0%" and "$0.00
// saved"; one on Antigravity drew "48%" at every turn). A usage either carried what it read from its provider's cache
// and wrote to it, or it did not: each reader marks the one that did (`cacheSeen`), a sum keeps the prompt tokens of
// those that did, and a share is taken of them alone (core/cache-facts.js, and the page's copy).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as server from "../src/core/cache-facts.js";
import * as page from "../src/ui/lib/cache-facts.js";
import { usageFromAnthropic, usageFromOpenAI, usageFromResponses } from "../src/core/wire/usage.js";
import { usageAndCost } from "../src/core/usage-cost.js";
import { totalUsageOf } from "../src/app/memory-tools.js";
import { readUsage, turnUsage, readResultUsage } from "../src/adapters/agents/acp/updates.js";
import { readProfile } from "../src/adapters/agents/acp/profile.js";
import { confirmedOf, KNOWN_AGENTS } from "../src/core/catalogues.js";
import { createCodexReader } from "../src/adapters/agents/codex/items.js";
import { createAgentRun } from "../src/app/agent-run.js";
import { foldTurnFacts } from "../src/core/turn-facts.js";
import { ledgerEntry } from "../src/app/finish.js";
import { usageOf } from "../src/services/spend.js";
import { churnLegOf } from "../src/services/cache-churn.js";
import { MemoryService } from "../src/memory-service.js";

const { promptOf, saysCache, seenPrompt, cacheSaid, cacheTouched, hitOf, carriedOf, seenWith } = server;

/**
 * What a turn's prompts spent, as the bridge sums their answers (`turnUsage`).
 * @param {any[]} results @param {any} [how]  the agent's profile, where it says how it counts its input @returns {any}
 */
const spent = (results, how = null) => turnUsage(results, [], how).usage;

describe("the rule: a share is taken of the prompt tokens whose cache numbers were said", () => {
  test("the page's copy is the server's: the same rule, word for word, below each file's own header", () => {
    const body = (/** @type {string} */ f) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/^(\/\/.*\r?\n)+/, "");
    assert.equal(body("../src/ui/lib/cache-facts.js"), body("../src/core/cache-facts.js"));
    assert.deepEqual(Object.keys(page).sort(), Object.keys(server).sort());
  });

  test("a call that carried its cache numbers has a share, 0% where it read none; one that carried none has no share", () => {
    assert.equal(hitOf({ input: 10, cacheRead: 80, cacheWrite: 10, cacheSeen: true }), 0.8);
    assert.equal(hitOf({ input: 1400, cacheRead: 0, cacheWrite: 0, cacheSeen: true }), 0, "counted, and none of it read: 0%");
    assert.equal(hitOf({ input: 1400, cacheRead: 0, cacheWrite: 0 }), null, "not counted: no share, never 0%");
    assert.equal(carriedOf({ input: 1400, cacheRead: 0, cacheWrite: 0 }), null);
    assert.equal(cacheSaid({ input: 1400, cacheRead: 0, cacheWrite: 0 }), false);
    assert.equal(cacheSaid(null), false);
    assert.equal(hitOf({ input: 0, cacheRead: 0, cacheWrite: 0, cacheSeen: true }), null, "no prompt: no share");
    assert.equal(promptOf({ input: 3, cacheRead: 4, cacheWrite: 5 }), 12);
    assert.deepEqual([cacheTouched({ cacheRead: 0, cacheWrite: 0, cacheSeen: true }), cacheTouched({ cacheRead: 0, cacheWrite: 9 })], [false, true]);
  });

  test("a usage kept before the mark was written says it by its figures: one that read or wrote any carried them", () => {
    assert.equal(hitOf({ input: 100, cacheRead: 30_000, cacheWrite: 900 }), 30_000 / 31_000);
    assert.equal(carriedOf({ input: 130, cacheRead: 0, cacheWrite: 3100 }), 3100 / 3230);
    assert.equal(seenPrompt({ input: 500, cacheRead: 0, cacheWrite: 0 }), 0);
  });

  test("a sum counts the prompts of the calls that said theirs: the rest are no part of its share", () => {
    // 1,000 of the 3,000 prompt tokens came with cache numbers, 600 of them read: 60%, not 20%.
    const sum = { input: 2400, cacheRead: 600, cacheWrite: 0, cacheSeen: 1000 };
    assert.equal(seenPrompt(sum), 1000);
    assert.equal(hitOf(sum), 0.6);
    assert.equal(hitOf({ input: 2400, cacheRead: 0, cacheWrite: 0, cacheSeen: 0 }), null, "a sum none of whose calls said any");
    assert.equal(seenPrompt({ input: 10, cacheRead: 0, cacheWrite: 0, cacheSeen: 500 }), 10, "never more than the prompt");
    assert.equal(seenWith({ input: 400, cacheRead: 600, cacheWrite: 0 }, { input: 50, cacheRead: 0, cacheWrite: 0 }), 1000, "a sum kept before the count, by its figures, and a call that said none");
    assert.equal(seenWith({ input: 400, cacheRead: 600, cacheWrite: 0, cacheSeen: 1000 }, { input: 50, cacheRead: 150, cacheWrite: 0, cacheSeen: true }), 1200);
    assert.deepEqual([saysCache(undefined, null), saysCache(undefined, 0)], [false, true], "a field left out says nothing; one that says 0 says it was counted");
  });
});

describe("what each engine's usage carries, read where it is read", () => {
  test("the loop's providers: Anthropic's and OpenAI's cache fields mark the record's tokens; a usage without them does not", () => {
    const rec = { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 } };
    const seen = (/** @type {any} */ u) => usageAndCost(rec, u).tokens.cacheSeen === true;
    assert.equal(seen(usageFromAnthropic({ input_tokens: 8, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })), true, "Anthropic says them, at 0 too");
    assert.equal(seen(usageFromAnthropic({ input_tokens: 8, output_tokens: 2 })), false, "an Anthropic-format server that says none");
    assert.equal(seen(usageFromOpenAI({ prompt_tokens: 900, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } })), true, "OpenAI's cached_tokens, at 0 too");
    assert.equal(seen(usageFromOpenAI({ prompt_tokens: 900, completion_tokens: 20, prompt_cache_hit_tokens: 700, prompt_cache_miss_tokens: 200 })), true, "DeepSeek's spelling");
    assert.equal(seen(usageFromOpenAI({ prompt_tokens: 900, completion_tokens: 20 })), false, "an OpenAI-format server that says none");
    assert.equal(seen(usageFromResponses({ input_tokens: 900, output_tokens: 20, input_tokens_details: { cached_tokens: 0 } })), true, "a Responses usage that counted none read");
    assert.equal(seen(usageFromResponses({ input_tokens: 900, output_tokens: 20 })), false);
    // A reply of several rounds (memory's tools): its sum says them where a round did.
    assert.equal(seen(totalUsageOf("openai", [{ prompt_tokens: 900, completion_tokens: 20 }, { prompt_tokens: 950, completion_tokens: 5 }])), false, "no round said any");
    assert.equal(seen(totalUsageOf("openai", [{ prompt_tokens: 900, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } }, { prompt_tokens: 950, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 900 } }])), true);
    assert.deepEqual(usageAndCost(rec, usageFromOpenAI({ prompt_tokens: 900, completion_tokens: 20 })).tokens, { input: 900, output: 20, cacheRead: 0, cacheWrite: 0, thinking: 0 }, "the record's columns stay numbers");
  });

  test("an agent over ACP: Claude's usage carries them; an answer with no usage, or with counts and no cache field, carries none", () => {
    const claude = { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 46, cachedReadTokens: 100, cachedWriteTokens: 2000, totalTokens: 2156 } };
    assert.equal(spent([claude])?.cacheSeen, true);
    assert.equal(spent([{ stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 46, cachedReadTokens: 0, cachedWriteTokens: 0, totalTokens: 56 } }])?.cacheSeen, true, "counted, at 0");
    // Cursor's CLI answers a prompt with its stop reason alone: no usage, so Filament estimates, and nothing is said.
    assert.equal(spent([{ stopReason: "end_turn" }]), null);
    // Counts with no cache field (ACP's `usage` without the optional ones; Gemini CLI's `_meta.quota`).
    assert.equal(spent([{ stopReason: "end_turn", usage: { inputTokens: 700, outputTokens: 30, totalTokens: 730 } }])?.cacheSeen, undefined);
    assert.equal(readUsage({ _meta: { quota: { token_count: { input_tokens: 700, output_tokens: 30 } } } })?.cacheSeen, undefined);
    // A turn of two prompts: said by either, said.
    assert.equal(spent([{ usage: { inputTokens: 700, outputTokens: 30, totalTokens: 730 } }, claude])?.cacheSeen, true);
    // The models that counted a prompt (Claude's adapter, per model): said where a row carries a cache field.
    const byModel = { usage: claude.usage, _meta: { quota: { model_usage: [{ model: "claude-sonnet-5", token_count: { inputTokens: 10, outputTokens: 46, cachedInputTokens: 100, cachedWriteTokens: 2000 } }] } } };
    assert.equal(spent([byModel])?.cacheSeen, true);
    assert.equal(spent([{ _meta: { quota: { model_usage: [{ model: "gemini-3", token_count: { input_tokens: 700, output_tokens: 30 } }] } } }])?.cacheSeen, undefined);
    // One of Claude's cycles by its raw result (the API's usage).
    assert.equal(readResultUsage({ usage: { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 20_000 } })?.cacheSeen, true);
    assert.equal(readResultUsage({ usage: { input_tokens: 3, output_tokens: 1 } })?.cacheSeen, undefined);
  });

  // (fails before: yes — the owner's of 11-11, "the cache seems to be showing 48% all the time": Antigravity's
  // `inputTokens` is its whole prompt, what it read from the cache among them, and was read as the tokens beside those:
  // 33,184 read of 35,769 drew 33,184 of 68,953)
  test("Antigravity, as agy_acp_server 1.4.5 sends it: its input holds its cached reads, so its share is of the input, never of the two added", () => {
    const agy = KNOWN_AGENTS.find((a) => a.id === "antigravity-acp");
    const profile = readProfile({ protocolVersion: 1, agentCapabilities: {} }, confirmedOf({ type: "acp", acp: { command: agy?.command } }));
    assert.equal(profile.cachedInInput, true, "its card says so, as the drive saw");
    // Three prompts of one session, as its records hold them: a cold start, then two warm ones.
    const turns = [[17096, 0, 9], [17273, 15217, 58], [35769, 33184, 21]].map(([inputTokens, cachedReadTokens, outputTokens]) => spent([{ stopReason: "end_turn", usage: { inputTokens, outputTokens, cachedReadTokens } }], profile));
    assert.deepEqual(turns.map((u) => [u?.input, u?.cacheRead, u?.cacheSeen]), [[17096, 0, true], [2056, 15217, true], [2585, 33184, true]]);
    assert.deepEqual(turns.map((u) => Math.round(/** @type {number} */ (hitOf(u)) * 100)), [0, 88, 93], "not 0, 47 and 48");
    // An agent whose card says nothing of it is read as ACP words it: its input beside its cached reads.
    assert.equal(readProfile({ protocolVersion: 1 }, confirmedOf({ type: "acp", acp: { command: "claude-agent-acp" } })).cachedInInput, false);
    assert.equal(spent([{ usage: { inputTokens: 10, outputTokens: 46, cachedReadTokens: 100, cachedWriteTokens: 2000 } }])?.input, 10);
  });

  // (fails before: yes — read live on agy 1.5.14: its input is beside its cached reads, and its total says so; read as
  // the older server counted, 2,275 input with 7,482 cached went as none)
  test("Antigravity as agy 1.5 sends it: a total that adds the cache beside the input says so, whatever its card; one that adds it within says that", () => {
    const agy = KNOWN_AGENTS.find((a) => a.id === "antigravity-acp");
    const profile = readProfile({ protocolVersion: 1, agentCapabilities: {} }, confirmedOf({ type: "acp", acp: { command: agy?.command } }));
    const live = { stopReason: "end_turn", usage: { inputTokens: 2275, outputTokens: 261, cachedReadTokens: 7482, cachedWriteTokens: 0, thoughtTokens: 206, totalTokens: 10018 } };
    assert.deepEqual([readUsage(live, profile)?.input, readUsage(live, profile)?.cacheRead, readUsage(live, profile)?.total], [2275, 7482, 10018]);
    assert.equal(Math.round(/** @type {number} */ (hitOf(spent([live], profile))) * 100), 77, "7,482 of 9,757");
    // A total that holds the cache within the input, as the older server's would: taken out, card or not.
    const within = { usage: { inputTokens: 35769, outputTokens: 21, cachedReadTokens: 33184, totalTokens: 35790 } };
    assert.equal(readUsage(within)?.input, 2585);
    // A total that adds up neither way leaves it to the card.
    const odd = { usage: { inputTokens: 1000, outputTokens: 10, cachedReadTokens: 500, totalTokens: 5 } };
    assert.deepEqual([readUsage(odd, profile)?.input, readUsage(odd)?.input], [500, 1000]);
  });

  test("Codex: its token counts carry what it read from the cache; a report without the field says none", () => {
    const reading = () => {
      /** @type {any[]} */
      const events = [];
      const reader = createCodexReader({ threadId: "T", out: { text: "", tools: [], linesAdded: 0, linesRemoved: 0, title: null, agentModel: null, error: null }, onEvent: (/** @type {any} */ ev) => events.push(ev), notes: [], turn: { bridgePlan: () => false }, version: "0.154.0" });
      return { reader, events };
    };
    const a = reading();
    a.reader.read("thread/tokenUsage/updated", { threadId: "T", turnId: "U", tokenUsage: { total: { totalTokens: 1240, inputTokens: 1200, cachedInputTokens: 1000, outputTokens: 40 }, last: { totalTokens: 1240, inputTokens: 1200, cachedInputTokens: 1000, outputTokens: 40 }, modelContextWindow: 400000 } });
    assert.equal(a.reader.usage().usage?.cacheSeen, true);
    assert.deepEqual(a.events.find((e) => e.type === "usage")?.call, { input: 200, cacheRead: 1000, cacheWrite: 0 });
    const b = reading();
    b.reader.read("thread/tokenUsage/updated", { threadId: "T", turnId: "U", tokenUsage: { total: { totalTokens: 1240, inputTokens: 1200, outputTokens: 40 }, last: { totalTokens: 1240, inputTokens: 1200, outputTokens: 40 }, modelContextWindow: 400000 } });
    assert.equal(b.reader.usage().usage?.cacheSeen, undefined);
    assert.equal(b.events.find((e) => e.type === "usage")?.call, undefined, "no call for the Cache to read");
  });

  test("a model call is the run's `round-cache` only where it said its cache numbers: the Cache instrument's last request is never a call that said none", () => {
    /** @type {any[]} */
    const events = [];
    const run = createAgentRun({ publish: (/** @type {any} */ e) => events.push(e), sink: { breakBlock: () => 0 } });
    run.take({ type: "text", text: "Looking." });
    // Cursor's SDK where a call's usage came without the cache fields.
    run.take({ type: "usage", call: { input: 1400 } });
    assert.deepEqual(events.filter((e) => e.type === "round-cache"), []);
    assert.equal(run.lastModelCall(), null);
    run.take({ type: "usage", call: { input: 300, cacheRead: 0, cacheWrite: 0 } });
    assert.deepEqual(events.filter((e) => e.type === "round-cache"), [{ type: "round-cache", round: 1, input: 300, cacheRead: 0, cacheWrite: 0 }], "counted, at 0: said");
  });
});

describe("a turn's facts, the session's ledger and the churn watch count the calls that said theirs", () => {
  const rec = (/** @type {string} */ id, /** @type {any} */ tokens, /** @type {any} */ over = {}) => ({ id, status: "ok", ts: "2026-11-11T00:00:00.000Z", totalMs: 1000, model: "m", upstream: "u", tokens, cost: 0.01, listCost: 0.01, memory: { chain: "c1", turnId: "t1" }, ...over });

  test("a turn's facts keep the prompt of its calls that said cache numbers; a turn none of whose calls did keeps none", () => {
    const none = foldTurnFacts(null, rec("a", { input: 1400, output: 30, cacheRead: 0, cacheWrite: 0 }), { own: true });
    assert.equal(none.tokens.cacheSeen, undefined);
    assert.equal(hitOf(none.tokens), null, "a gap, not 0%");
    const said = foldTurnFacts(null, rec("b", { input: 100, output: 30, cacheRead: 900, cacheWrite: 0, cacheSeen: true }), { own: true });
    assert.equal(said.tokens.cacheSeen, 1000);
    // Its sub-agent ran on a model that says none: the turn's share stays its own call's.
    const mixed = foldTurnFacts(said, rec("c", { input: 4000, output: 10, cacheRead: 0, cacheWrite: 0 }, { subagentOf: "b" }));
    assert.deepEqual([mixed.tokens.input, mixed.tokens.cacheSeen, hitOf(mixed.tokens)], [4100, 1000, 0.9]);
    const zero = foldTurnFacts(null, rec("d", { input: 700, output: 30, cacheRead: 0, cacheWrite: 0, cacheSeen: true }), { own: true });
    assert.deepEqual([zero.tokens.cacheSeen, hitOf(zero.tokens)], [700, 0], "counted and none read: 0%");
  });

  test("the ledger's entry says whether its request said them", () => {
    assert.equal(ledgerEntry(rec("a", { input: 1400, output: 30, cacheRead: 0, cacheWrite: 0 }), null, true).cacheSeen, false);
    assert.equal(ledgerEntry(rec("b", { input: 100, output: 30, cacheRead: 900, cacheWrite: 0, cacheSeen: true }), null, true).cacheSeen, true);
    assert.equal(ledgerEntry(rec("c", { input: 100, output: 30, cacheRead: 900, cacheWrite: 0 }), null, true).cacheSeen, true, "a record kept before the mark, by its figures");
  });

  test("a request whose usage said no cache numbers is no leg of the churn watch: nothing says its prompt was written again", () => {
    const big = { input: 90_000, output: 100, cacheRead: 0, cacheWrite: 0 };
    assert.equal(churnLegOf(rec("a", big)), null);
    assert.equal(churnLegOf(rec("b", { ...big, cacheSeen: true }))?.churned, true, "counted, and none of it read: a leg that churned");
    assert.equal(churnLegOf(rec("c", { input: 500, output: 100, cacheRead: 89_000, cacheWrite: 500 }))?.churned, false);
  });
});

describe("the session's ledger, as the archive keeps it", () => {
  /** @type {string} */
  let dir;
  /** @type {any} */
  let svc;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-cache-facts-"));
    const cfg = { server: { port: 20398, inboundKeys: ["k"] }, memory: { enabled: true, folder: join(dir, "memory"), engine: { embeddings: false, bank: "default" }, autopilot: { enabled: false }, capture: { turns: true, learn: false }, commands: { enabled: true, prefix: "@mem" }, privacy: { encryptArchive: false } } };
    svc = new MemoryService({ getConfig: () => cfg, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20398", getModelNames: () => [] });
    svc.start();
  });
  after(async () => {
    await svc?.store?.stop?.();
    svc?.stop();
    for (let i = 0; i < 10; i++) {
      try { rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
    }
  });
  /** @param {string} key */
  const chainOf = (key) => svc.archive.chainForKey(key, { project: "p", client: "harness", model: "m" }).id;
  /** A request's entry, as its close books it. @param {any} tokens @param {any} [over] */
  const entry = (tokens, over = {}) => ({ ...ledgerEntry({ id: "r", upstreamModel: "m", upstream: "u", tokens, cost: 0, listCost: 0.02, ...over }, null, true), at: over.at || 1000 });

  test("a chat whose requests said no cache numbers: its ledger counts none, and its last request says none", () => {
    const id = chainOf("n:cursor-only");
    svc.spendAdd(id, entry({ input: 1400, output: 30, cacheRead: 0, cacheWrite: 0 }));
    const u = usageOf(svc.archive.getChain(id));
    assert.deepEqual([u.requests, u.input, u.cacheRead, cacheSaid(u), hitOf(u)], [1, 1400, 0, false, null]);
    assert.deepEqual([u.last.input, cacheSaid(u.last)], [1400, false]);
  });

  test("numbers, then none: the average and the count are of the requests that said theirs; the last request is the newest, which said none", () => {
    const id = chainOf("n:claude-then-cursor");
    svc.spendAdd(id, entry({ input: 100, output: 30, cacheRead: 900, cacheWrite: 0, cacheSeen: true }, { at: 1000 }));
    let u = usageOf(svc.archive.getChain(id));
    assert.deepEqual([hitOf(u), hitOf(u.last)], [0.9, 0.9]);
    svc.spendAdd(id, entry({ input: 9000, output: 30, cacheRead: 0, cacheWrite: 0 }, { at: 2000, upstream: "cursor" }));
    u = usageOf(svc.archive.getChain(id));
    assert.deepEqual([u.input, u.cacheSeen, hitOf(u)], [9100, 1000, 0.9], "9,000 tokens that came with no cache numbers are no part of the average");
    assert.deepEqual([u.last.at, u.last.input, u.last.upstream, cacheSaid(u.last)], [2000, 9000, "cursor", false]);
  });

  test("none, then numbers: the ledger counts from the first request that said them", () => {
    const id = chainOf("n:cursor-then-claude");
    svc.spendAdd(id, entry({ input: 9000, output: 30, cacheRead: 0, cacheWrite: 0 }, { at: 1000 }));
    svc.spendAdd(id, entry({ input: 50, output: 30, cacheRead: 0, cacheWrite: 950, cacheSeen: true }, { at: 2000 }));
    const u = usageOf(svc.archive.getChain(id));
    assert.deepEqual([u.cacheSeen, hitOf(u), carriedOf(u.last), cacheSaid(u.last)], [1000, 0, 0.95, true]);
  });

  test("a ledger kept before the count: what it read says its requests said theirs, and a new request adds to that", () => {
    const id = chainOf("n:older");
    svc.archive.updateMeta(id, (/** @type {any} */ meta) => { meta.spend = { usd: 0, requests: 2, inputTokens: 200, outputTokens: 60, cacheReadTokens: 1800, cacheWriteTokens: 0 }; });
    assert.equal(hitOf(usageOf(svc.archive.getChain(id))), 0.9);
    svc.spendAdd(id, entry({ input: 3000, output: 30, cacheRead: 0, cacheWrite: 0 }, { at: 3000 }));
    const u = usageOf(svc.archive.getChain(id));
    assert.deepEqual([u.input, u.cacheSeen, hitOf(u)], [3200, 2000, 0.9]);
  });

  test("a coding agent's turn books its newest call as the last request, with the lifetime its markers asked for", () => {
    const id = chainOf("n:claude-code");
    svc.spendAdd(id, { ...entry({ input: 11, output: 40, cacheRead: 20_000, cacheWrite: 20_400, cacheSeen: true }), call: { input: 8, cacheRead: 20_000, cacheWrite: 400, ttlMs: 3_600_000 } });
    const { last } = usageOf(svc.archive.getChain(id));
    assert.deepEqual([last.input, last.cacheRead, last.cacheWrite, last.ttlMs, cacheSaid(last)], [8, 20_000, 400, 3_600_000, true]);
  });
});

describe("`/cost` says the cache's share of the requests that said theirs", () => {
  const ts = "2026-11-11T00:00:00.000Z";
  // (fails before: yes — a chat on an agent that gives no cache numbers read "0% of input tokens from cache · 0 misses ·
  // warm (5m TTL, …)": a share, a count of misses and a clock nothing said)
  test("no request said any: no share, no misses; some did: the share is theirs, and the line says of how many", async () => {
    const { cacheWords } = /** @type {any} */ (await import("../src/app/commands/status.js"));
    const unsaid = { id: "a", ts, tokens: { input: 1400, output: 30, cacheRead: 0, cacheWrite: 0 } };
    const said = { id: "b", ts, tokens: { input: 100, output: 30, cacheRead: 900, cacheWrite: 0, cacheSeen: true } };
    const cold = { id: "c", ts, tokens: { input: 50, output: 30, cacheRead: 0, cacheWrite: 950, cacheSeen: true } };
    assert.equal(cacheWords([unsaid]), "no cache numbers reported");
    assert.equal(cacheWords([said, cold]), "45% of input tokens from cache · 1 miss");
    assert.equal(cacheWords([unsaid, said]), "90% of input tokens from cache, of the 1 request that reported cache numbers · 0 misses");
    assert.equal(cacheWords([{ id: "d", ts, tokens: { input: 700, output: 3, cacheRead: 0, cacheWrite: 0, cacheSeen: true } }]), "0% of input tokens from cache · 0 misses", "counted, and none read: 0%");
  });
});

describe("`/cost` in a chat, through the app", () => {
  /** @type {any} */
  let up;
  /** @type {any} */
  let shim;
  /** @type {string} */
  let root;
  before(async () => {
    const { startApp, fakeUpstream, anthropicReply } = await import("./helpers/app.js");
    root = mkdtempSync(join(tmpdir(), "filament-cache-cost-"));
    up = await fakeUpstream((/** @type {any} */ call) => {
      if (call.kind !== "anthropic") return undefined;
      // "plain-*": a server that says no cache numbers; "cached-*": one that says them.
      const said = String(call.body?.model || "").startsWith("cached-");
      return anthropicReply("", { model: call.body?.model, stop: "end_turn", blocks: [{ type: "text", text: "pong" }], usage: { input_tokens: 100, output_tokens: 20, ...(said ? { cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } : {}) } });
    });
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "plain-*", upstream: "m", upstreamModel: "{model}", enabled: true }, { match: "cached-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    const { removeDirs } = await import("./helpers/wait.js");
    await removeDirs(root);
  });
  /** @param {string} model @param {string[]} says */
  const chat = async (model, says) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    let text = "";
    for (const content of says) {
      const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(t.status, 200, await t.clone().text());
      text = ((await t.json()).content || []).map((/** @type {any} */ b) => b.text || "").join("");
    }
    return { id, text };
  };

  // (fails before: yes — "Prompt cache: 1 request · 0% of input tokens from cache · 0 misses · warm (5m TTL, last
  // activity 0s ago)" for a provider that said nothing of a cache)
  test("a chat whose provider says no cache numbers: no share, no misses, no clock; one whose provider says them: its share", async () => {
    const plain = await chat("plain-model", ["hi", "/cost"]);
    const line = (/** @type {string} */ t) => t.split("\n").find((l) => l.startsWith("Prompt cache:")) || "";
    assert.match(line(plain.text), /^Prompt cache: +1 request · no cache numbers reported · last activity /, line(plain.text));
    assert.doesNotMatch(line(plain.text), /%|miss|warm|cold|TTL/, line(plain.text));
    const cached = await chat("cached-model", ["hi", "/cost"]);
    assert.match(line(cached.text), /^Prompt cache: +1 request · 90% of input tokens from cache · 0 misses · last activity /, line(cached.text));
    assert.doesNotMatch(line(cached.text), /warm|cold|TTL/, "no clock: nothing here says how long this cache lasts");
    // The ledger the page reads: the plain chat's last request says no cache numbers, the cached one's says them.
    const usage = async (/** @type {string} */ id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json()).usage;
    const [pu, cu] = [await usage(plain.id), await usage(cached.id)];
    assert.deepEqual([cacheSaid(pu), cacheSaid(pu.last), hitOf(pu)], [false, false, null]);
    assert.deepEqual([cacheSaid(cu), cacheSaid(cu.last), hitOf(cu), hitOf(cu.last), cu.last.upstream], [true, true, 0.9, 0.9, "m"]);
  });
});
