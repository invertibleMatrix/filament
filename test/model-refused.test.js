// @ts-check
// A model the provider refuses this account (found on batch 1's live drive, 2026-10-15): zai answers a model its plan
// does not include with HTTP 429 and "Your current subscription plan does not yet include access to GLM-5.3-FlashX".
// Read as a rate, it was tried ten times over three minutes, every 429 cooled the whole provider down for everyone,
// and it taught the model a false ceiling — while zai served this account its other models all along. Now its words
// make it a `model` cause (core/provider-cause.js): no loop tries it again, the health board neither holds nor cools
// the provider for it, it teaches no ceiling, and a worker that stops on it tells its lead what only the developer
// can change. The other causes' readings are test/provider-cause.test.js's and test/provider-walls.test.js's.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FINAL, WALLS, causeWords, isFinal, isWall, providerCause } from "../src/core/provider-cause.js";
import { causeOf, transient } from "../src/core/retry.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { worded } from "../src/core/failure.js";
import { fakeUpstream, startApp } from "./helpers/app.js";
import { leadOf, running, watched } from "./helpers/team.js";
import { removeDirs } from "./helpers/wait.js";

const ZAI_MODEL = "Your current subscription plan does not yet include access to GLM-5.3-FlashX";
const ZAI_OUT = "Insufficient balance or no resource package. Please recharge.";

// (fails before: yes — zai's words were a rate's, by their 429; Moonshot's "Permission denied" an account's, a wall)
test("a provider's words that it refuses this account the model are a model's, whatever the status and type beside them; the others read as before", () => {
  /** @type {[string, import("../src/core/provider-cause.js").Said, string | null][]} */
  const readings = [
    ["zai's, on its own wire", { status: 429, said: ZAI_MODEL }, "model"],
    ["zai's, on the loop's wire", { status: 429, type: "api_error", said: ZAI_MODEL }, "model"],
    ["zai's, typed a rate", { status: 429, type: "rate_limit_error", said: ZAI_MODEL }, "model"],
    ["Moonshot's model it does not find", { status: 404, type: "resource_not_found_error", said: "Not found the model kimi-k9 or Permission denied" }, "model"],
    ["no access to the model", { status: 403, type: "permission_error", said: "You do not have access to the model claude-opus-9." }, "model"],
    ["a model not available for the account", { status: 400, said: "The model glm-9 is not available for your account." }, "model"],
    // The others stay what they were.
    ["zai's 1113", { status: 429, said: ZAI_OUT }, "out"],
    ["OpenAI's quota, which names a plan", { status: 429, type: "insufficient_quota", said: "You exceeded your current quota, please check your plan and billing details." }, "out"],
    ["Anthropic's key without permission", { status: 403, type: "permission_error", said: "Your API key does not have permission to use the specified resource." }, "account"],
    ["zai's 1302", { status: 429, said: "Rate limit reached for requests" }, "rate"],
    ["a 404 of a model's name", { status: 404, type: "not_found_error", said: "model: glm-9" }, null],
  ];
  for (const [who, said, kind] of readings) assert.equal(providerCause(said)?.kind ?? null, kind, who);
  assert.deepEqual([WALLS, FINAL], [["out", "account"], ["out", "account", "model"]]);
  const model = /** @type {const} */ ({ kind: "model", resets: null });
  assert.deepEqual([isWall(model), isFinal(model), isFinal({ kind: "rate", resets: null }), isFinal(null)], [false, true, false, false]);
  assert.equal(causeWords("model", "zai"), "zai says this account may not use this model");
});

const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
/** @param {Partial<import("../src/app/agent/loop.js").LoopArgs>} over */
const args = (over) =>
  /** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
    model: "glm-5.3-flashx",
    messages: [{ role: "user", content: "go" }],
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "edit",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async () => ({ ok: true, status: 200, json: { content: [{ type: "text", text: "Done." }], usage: { input_tokens: 1, output_tokens: 1 } }, id: null, upstream: "zai", retryAfter: null }),
    costOf: () => 0,
    runHand: async (/** @type {string} */ name) => `${name} ran`,
    delegateRead: null,
    mailbox: { read: () => [] },
    permissions: null,
    tree: null,
    onEvent: () => {},
    previewChars: 0,
    sink,
    signal: null,
    resume: null,
    ...over,
  });

// (fails before: yes — the round was tried ten times, waiting 1 s, 2 s … 32 s between them, about three minutes)
test("the loop's round asks once: its failure says the provider's words and that it was not tried again", async () => {
  const tried = { ok: false, status: 429, json: { type: "error", error: { type: "api_error", message: ZAI_MODEL } }, id: null, upstream: "zai", retryAfter: null };
  assert.deepEqual([causeOf(tried), transient(tried), transient({ ...tried, shouldRetry: true })], [{ kind: "model", resets: null }, false, false]);
  /** @type {any[]} */
  const events = [];
  let n = 0;
  const out = await runAgentTurn(args({ call: async () => (++n, tried), onEvent: (e) => events.push(e) }));
  assert.deepEqual([n, out.status, events.filter((e) => e.type === "turn-state" && e.to === "waiting").length], [1, "failed", 0]);
  assert.equal(out.error, `round 1's model call to glm-5.3-flashx at zai failed: ${ZAI_MODEL} (HTTP 429). Not tried again: zai says this account may not use this model.`);
  assert.deepEqual(out.failure?.cause, { kind: "model", provider: "zai", resets: null });
  assert.ok(out.notes.includes(`agent: round 1 failed (zai: model, not tried again — ${ZAI_MODEL})`), out.notes.join("\n"));
});

describe("through the front door", () => {
  /** @type {string} */
  let root;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let zai;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let zaiB;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-refused-"));
    // zai serves this account glm-5.3 and refuses it glm-5.3-flashx, as the live drive met it.
    zai = await fakeUpstream((call) => (call.body?.model === "glm-5.3-flashx" ? { status: 429, json: { error: { code: "1311", message: ZAI_MODEL } } } : undefined));
    zaiB = await fakeUpstream();
    shim = await startApp({
      configure: (cfg) => {
        const glm = { type: "openai-compatible", apiKey: "k1", enabled: true, wireApi: "chat-completions" };
        cfg.upstreams = [
          { id: "zai", name: "zai", baseUrl: `${zai.url}/v1`, ...glm },
          { id: "zai-b", name: "zai-b", baseUrl: `${zaiB.url}/v1`, ...glm },
        ];
        cfg.routes = [
          { match: "zai/*", upstream: "zai", upstreamModel: "{1}", enabled: true },
          { match: "both/*", upstream: "zai", upstreamModel: "{1}", enabled: true, fallbacks: [{ upstream: "zai-b", upstreamModel: "{1}" }] },
        ];
        // A cooldown long enough that one would send the next call past zai, to zai-b.
        cfg.rules.resilience = { ...(cfg.rules.resilience || {}), cooldownBaseSeconds: 60, cooldownMaxSeconds: 60 };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await zai.close();
    await zaiB.close();
    await removeDirs(root);
  });
  const healthOf = async (/** @type {string} */ id) => (await (await shim.api("/api/usage/upstreams?hours=1")).json()).health[id];

  // (fails before: yes — the 429 cooled zai down for 60 s, taught glm-5.3-flashx a ceiling of one, and the next call to
  // glm-5.3 went to zai-b)
  test("the refusal reaches the client as it came; zai is neither held nor cooled down, nothing learns a ceiling, and its other model goes to it first", async () => {
    const r = await shim.post("/v1/messages", { model: "zai/glm-5.3-flashx", max_tokens: 50, messages: [{ role: "user", content: "hi" }] });
    assert.equal(r.status, 429);
    assert.match(await r.text(), /does not yet include access to GLM-5\.3-FlashX/);
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    const changes = /** @type {string[]} */ (rec.changes || []);
    assert.ok(changes.includes("concurrency: zai says this account may not use glm-5.3-flashx (HTTP 429) — not its rate, so it teaches no ceiling"), changes.join("\n"));
    assert.ok(!changes.some((c) => /cooling down|^health: /.test(c)), changes.join("\n"));
    const zh = await healthOf("zai");
    assert.deepEqual([zh.wall, zh.ceilings, zh.cooldownLeftMs], [null, [], 0]);
    const was = [zai.received.length, zaiB.received.length];
    const next = await shim.post("/v1/messages", { model: "both/glm-5.3", max_tokens: 50, messages: [{ role: "user", content: "hi" }] });
    assert.equal(next.status, 200, await next.text());
    assert.deepEqual([zai.received.length - was[0], zaiB.received.length - was[1]], [1, 0], "zai first");
  });

  // (fails before: yes — the loop's round was tried ten times into it, about three minutes)
  test("a turn of Filament's loop on the refused model calls it once and fails at once, its record saying why", async () => {
    const before = zai.received.length;
    const r = await shim.house("/v1/messages", { model: "agent/zai/glm-5.3-flashx", max_tokens: 400, stream: false, messages: [{ role: "user", content: "go" }] }, { "x-filament-cwd": root, "x-session-id": "refused-loop" });
    await r.text();
    assert.equal(zai.received.length - before, 1);
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.ok((rec.changes || []).includes(`agent: round 1 failed (zai: model, not tried again — ${ZAI_MODEL})`), (rec.changes || []).join("\n"));
  });
});

// (fails before: yes — the lead read a rate's line: "through 10 tries over 3 min", and to follow it up in a few minutes
// or launch it again, which the pool would put on the same model)
test("a worker that stops on a model its provider refuses: its lead reads that only the developer can change the pool's model", async () => {
  const w = watched({ sub: { pool: [{ model: "zai/glm-5.3-flashx", seats: 2 }] } });
  const l = leadOf(w.registry, w.dir);
  const { id, r } = await running(w, l);
  const failure = worded({ what: "round 3's model call", where: "glm-5.3-flashx at zai", said: ZAI_MODEL, code: null, status: 429, tries: 1, began: 0, at: 2_000, streamed: { thinking: 0, text: 0 }, kept: "2 finished rounds are kept", next: null, cause: { kind: "model", provider: "zai", resets: null } });
  r.finish({ status: "failed", report: "", error: "round 3's model call failed", failure });
  await w.registry.settled(id);
  const [d] = l.door.inbox.take();
  assert.equal(
    d.text,
    `[Filament: your builder ${id} ("Fix the parser") stopped on its provider, not on its task: zai says this account may not use this model — "${ZAI_MODEL}" (HTTP 429). It was not tried again: every try of zai/glm-5.3-flashx meets the same refusal. Tell the developer: the session's pool needs a model zai serves this account in place of zai/glm-5.3-flashx.]`,
  );
  l.door.close();
});
