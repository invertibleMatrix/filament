// @ts-check
// HarnessV3-TaskGraph-v2 TG2-D54, revised (2026-10-14): what a provider's failure says of the provider, read once for
// every caller and seat (core/provider-cause.js) — busy for everyone, limiting this account's rate, this account's
// allowance used up, or this account or its key refused; none of the four where the request was its own fault. Each
// provider in its own words, as Filament's request log and the providers' documents have them. And the words that
// carry it: the health board's hold, a coding agent's failure (`agentCause`), an error body in any provider's shape
// (`errorWordsOf`), a model whose every upstream is held (`walledProblem`) and the Providers page's pill (`wallPill`).
// What the code does with them is test/provider-walls.test.js's. Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NEAR_WAIT_S, OUT_HOLD_MS, WALLS, causeWords, holdWords, isWall, providerCause, wallWords } from "../src/core/provider-cause.js";
import { agentCause, classifyFailure, saysPlanRefused } from "../src/adapters/agents/acp/failures.js";
import { causeOf, transient } from "../src/core/retry.js";
import { walledProblem } from "../src/app/engine.js";
import { errorWordsOf } from "../src/app/pipeline/dispatch/verdict.js";
import { wallPill } from "../src/ui/pages/home.js";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const ZAI_OUT = "Insufficient balance or no resource package. Please recharge.";

/** @type {[string, import("../src/core/provider-cause.js").Said, string | null][]} */
const READINGS = [
  // zai (Z.ai, BigModel): its own code rides beside its words, which Filament's wire keeps whole.
  ["zai's 1302", { status: 429, said: "Rate limit reached for requests" }, "rate"],
  ["zai's 1302 on the loop's wire", { status: 429, type: "api_error", said: "Rate limit reached for requests" }, "rate"],
  ["zai's 1113", { status: 429, said: ZAI_OUT }, "out"],
  ["zai's 1113 in its own language", { status: 429, said: "余额不足或无可用资源包,请充值。" }, "out"],
  ["zai's 1308", { status: 429, said: "Usage limit reached for 5 hour. Your limit will reset at 2026-10-14 16:50:58" }, "out"],
  ["zai's 1310", { status: 429, said: "Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-10-20 08:00:00" }, "out"],
  ["zai's 1305", { status: 429, type: "api_error", said: "The service may be temporarily overloaded, please try again later" }, "busy"],
  // Anthropic
  ["Anthropic's 529", { status: 529, type: "overloaded_error", said: "Overloaded" }, "busy"],
  ["Anthropic's 429", { status: 429, type: "rate_limit_error", said: "This request would exceed the rate limit for your organization of 50,000 input tokens per minute." }, "rate"],
  ["Anthropic's 429 that says overloaded", { status: 429, type: "rate_limit_error", said: "The engine is currently overloaded, please try again later" }, "busy"],
  ["Anthropic's credit balance", { status: 400, type: "invalid_request_error", said: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." }, "out"],
  ["Anthropic's 401", { status: 401, type: "authentication_error", said: "invalid x-api-key" }, "account"],
  ["Anthropic's 403", { status: 403, type: "permission_error", said: "Your API key does not have permission to use the specified resource." }, "account"],
  ["Anthropic's disabled organization", { status: 400, type: "invalid_request_error", said: "This organization has been disabled." }, "account"],
  // OpenAI
  ["OpenAI's insufficient_quota", { status: 429, type: "insufficient_quota", said: "You exceeded your current quota, please check your plan and billing details." }, "out"],
  ["OpenAI's requests per minute", { status: 429, type: "requests", said: "Rate limit reached for gpt-4o in organization org-1 on requests per min (RPM): Limit 500, Used 500, Requested 1. Please try again in 120ms." }, "rate"],
  ["OpenAI's tokens per day", { status: 429, type: "tokens", said: "Rate limit reached for gpt-4o in organization org-1 on tokens per day (TPD): Limit 90000, Used 90000, Requested 500." }, "out"],
  ["OpenAI's 401", { status: 401, type: "invalid_request_error", said: "Incorrect API key provided: sk-...abcd." }, "account"],
  // Gemini, through its OpenAI door
  ["Gemini's quota with a near wait", { status: 429, said: "You exceeded your current quota, please check your plan and billing details. Please retry in 27.4s." }, "rate"],
  // OpenRouter
  ["OpenRouter's 402", { status: 402, said: "This request requires more credits, or fewer max_tokens. You requested up to 4096 tokens, but can only afford 1000." }, "out"],
  ["OpenRouter's free models per day", { status: 429, said: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day" }, "out"],
  // Moonshot (Kimi)
  ["Moonshot's exceeded_current_quota", { status: 429, type: "exceeded_current_quota_error", said: "Your account org-1 <ak-1> is suspended, please check your plan and billing details" }, "out"],
  ["Moonshot's engine_overloaded", { status: 429, type: "engine_overloaded_error", said: "The engine is currently overloaded, please try again later" }, "busy"],
  ["Moonshot's RPM", { status: 429, type: "rate_limit_reached_error", said: "Your account org-1 <ak-1> request reached organization max RPM: 3, please try again after 1 seconds" }, "rate"],
  // DeepSeek
  ["DeepSeek's 402", { status: 402, said: "Insufficient Balance" }, "out"],
  // The wait a provider asks
  ["a 429 that asks for an hour", { status: 429, type: "rate_limit_error", said: "Rate limit reached", retryAfter: 3600 }, "out"],
  ["a 429 that asks for ten minutes", { status: 429, type: "rate_limit_error", said: "Rate limit reached", retryAfter: NEAR_WAIT_S }, "rate"],
  ["a plain 429 that asks for an hour", { status: 429, said: "Too many requests", retryAfter: 3600 }, "out"],
  ["a 529 that asks for an hour", { status: 529, type: "overloaded_error", said: "Overloaded", retryAfter: 3600 }, "busy"],
  // A coding agent's sign-in, in its adapter's words
  ["a sign-in that expired", { said: "Authentication required: Failed to authenticate: OAuth session expired and could not be refreshed" }, "account"],
  // None of the four: the request's own fault
  ["a 403 that refuses the content", { status: 403, said: "Request blocked by content moderation" }, null],
  ["a 400 the request's own", { status: 400, type: "invalid_request_error", said: "messages: field required" }, null],
  ["a 404", { status: 404, type: "not_found_error", said: "model: glm-9" }, null],
  ["a 413", { status: 413, type: "request_too_large", said: "Request exceeds the maximum size" }, null],
  ["a 500", { status: 500, type: "api_error", said: "Internal server error" }, "busy"],
  ["a network error", { said: "fetch failed", network: true }, "busy"],
];

// (fails before: yes — Filament read a provider's failure by its status alone: a 429 that said the balance was gone was
// tried ten times, as one about the rate is)
test("each provider's words say what they say of it — busy, rate, out or account — or that the request was its own fault", () => {
  for (const [who, said, kind] of READINGS) assert.equal(providerCause(said, NOW)?.kind ?? null, kind, who);
  assert.deepEqual(WALLS, ["out", "account"]);
  assert.deepEqual(["busy", "rate", "out", "account"].map((kind) => isWall({ kind: /** @type {any} */ (kind), resets: null })), [false, false, true, true]);
  assert.equal(isWall(null), false);
});

// (fails before: yes)
test("an out's reset, where the provider said one Filament can read: its wait, an epoch after a bar, a time with its zone — never a time without one", () => {
  /** @param {string} said @param {Partial<import("../src/core/provider-cause.js").Said>} [more] */
  const resets = (said, more = {}) => providerCause({ status: 429, said, ...more }, NOW)?.resets ?? null;
  assert.equal(resets("Rate limit reached", { type: "rate_limit_error", retryAfter: 3600 }), NOW + 3_600_000, "its Retry-After");
  assert.equal(resets("You've hit your daily limit. Please try again in 5 hours."), NOW + 5 * 3_600_000, "its words' wait");
  const epoch = Math.round(NOW / 1000) + 5 * 3600;
  assert.equal(resets(`Claude AI usage limit reached|${epoch}`), epoch * 1000, "Claude's plan's, in epoch seconds");
  assert.equal(resets("Usage limit reached for 5 hour. Your limit will reset at 2026-10-14T16:50:58+08:00"), Date.parse("2026-10-14T16:50:58+08:00"));
  assert.equal(resets("Usage limit reached for 5 hour. Your limit will reset at 2026-10-14 16:50:58Z"), Date.parse("2026-10-14T16:50:58Z"));
  assert.equal(resets("Usage limit reached for 5 hour. Your limit will reset at 2026-10-14 16:50:58"), null, "zai's own has no zone: it is said, never read");
  assert.equal(resets(ZAI_OUT), null);
  assert.equal(providerCause({ status: 429, type: "rate_limit_error", said: "Rate limit reached", retryAfter: 30 }, NOW)?.resets, null, "a rate has no reset of its own");
});

// (fails before: yes)
test("the words a lead, the record and the pages read: the cause of its provider, a hold's length, and a held provider", () => {
  assert.deepEqual(
    ["busy", "rate", "out", "account"].map((kind) => causeWords(/** @type {any} */ (kind), "zai")),
    ["zai was busy or failing for everyone", "zai limited this account's rate of calls", "zai says this account's allowance is used up", "zai refuses this account or its key"],
  );
  assert.equal(causeWords("out", null), "the provider says this account's allowance is used up");
  assert.deepEqual([0, 40_000, 119_000, 14 * 60_000, 119 * 60_000, 120 * 60_000, 290 * 60_000].map(holdWords), ["1 s", "40 s", "119 s", "14 min", "119 min", "2 h", "4 h 50 min"]);
  assert.equal(OUT_HOLD_MS, 15 * 60_000);
  /** @type {import("../src/core/provider-cause.js").Wall} */
  const out = { kind: "out", said: `${ZAI_OUT.replace(". ", ".\n  ")}`, status: 429, at: NOW, until: NOW + OUT_HOLD_MS, reset: null, as: null };
  assert.equal(wallWords(out, "zai", NOW + 60_000), `zai cannot serve now: this account's allowance is used up ("${ZAI_OUT}") — for 14 min more, or until a call there succeeds`);
  assert.equal(wallWords({ ...out, said: "" }, "zai", NOW), "zai cannot serve now: this account's allowance is used up — for 15 min more, or until a call there succeeds");
  assert.equal(wallWords({ ...out, said: "x".repeat(400) }, "zai", NOW).length, `zai cannot serve now: this account's allowance is used up ("") — for 15 min more, or until a call there succeeds`.length + 160);
  /** @type {import("../src/core/provider-cause.js").Wall} */
  const account = { kind: "account", said: "invalid x-api-key", status: 401, at: NOW, until: null, reset: null, as: null };
  assert.equal(wallWords(account, "anthropic", NOW), `anthropic refuses this account or its key ("invalid x-api-key") — until it is fixed in Settings, or Reset on the Providers page`);
});

// (fails before: yes — every 429 was tried again, whatever it said)
test("a try of the loop's: what it says of its provider, and whether another try can pass", () => {
  /** @param {number} status @param {string} type @param {string} message @param {Record<string, any>} [more] */
  const tried = (status, type, message, more = {}) => ({ ok: false, status, json: { type: "error", error: { type, message } }, upstream: "zai", retryAfter: null, ...more });
  assert.deepEqual(causeOf(tried(429, "api_error", ZAI_OUT)), { kind: "out", resets: null });
  assert.equal(transient(tried(429, "api_error", ZAI_OUT)), false, "an out is never tried again");
  assert.equal(transient(tried(429, "api_error", ZAI_OUT, { shouldRetry: true })), false, "whatever x-should-retry says");
  assert.equal(transient(tried(401, "authentication_error", "invalid x-api-key")), false);
  assert.equal(transient(tried(429, "rate_limit_error", "Rate limit reached", { retryAfter: 3600 })), false, "a wait of an hour is an out");
  assert.equal(transient(tried(429, "api_error", "Rate limit reached for requests")), true, "zai's 1302 is tried again");
  assert.equal(transient(tried(529, "overloaded_error", "Overloaded", { retryAfter: 3600 })), true, "a busy one too — its wait is AH-F4's to judge");
  assert.equal(causeOf(tried(503, "api_error", "Filament is restarting", { upstream: null })), null, "Filament's own refusal names no provider");
  assert.equal(causeOf({ ok: true, status: 200, json: {}, upstream: "zai" }), null);
});

// (fails before: yes)
test("an error body's type and words, in each provider's shape", () => {
  assert.deepEqual(errorWordsOf(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })), { type: "overloaded_error", said: "Overloaded" });
  assert.deepEqual(errorWordsOf(JSON.stringify({ error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } })), { type: "insufficient_quota", said: "You exceeded your current quota" });
  assert.deepEqual(errorWordsOf(JSON.stringify({ error: { code: "1113", message: ZAI_OUT } })), { type: null, said: ZAI_OUT }, "zai's code is a number in words: no type");
  assert.deepEqual(errorWordsOf(JSON.stringify({ error: { code: "rate_limit_exceeded", message: "slow down" } })), { type: "rate_limit_exceeded", said: "slow down" }, "a code in words is one");
  assert.deepEqual(errorWordsOf(JSON.stringify({ error: { code: 429, message: "Resource has been exhausted", status: "RESOURCE_EXHAUSTED" } })), { type: null, said: "Resource has been exhausted" });
  assert.deepEqual(errorWordsOf(JSON.stringify({ message: "Unauthorized" })), { type: null, said: "Unauthorized" });
  assert.deepEqual(errorWordsOf(JSON.stringify({ error: "invalid api key" })), { type: null, said: "invalid api key" });
  assert.deepEqual(errorWordsOf("upstream connect error"), { type: null, said: "upstream connect error" });
  assert.equal(errorWordsOf("x".repeat(900)).said.length, 600);
});

// (fails before: yes — a coding agent's limit held a rate limit, an overload and a spent plan alike)
test("a coding agent's failure, read with its account: a sign-in an account, a spent window an out until it resets, an overload a busy, a rate limit a rate", () => {
  /** @param {string} errorKind @param {string} [details] */
  const rpc = (errorKind, details) => ({ code: -32603, message: "Internal error", data: { errorKind, ...(details ? { details } : {}) } });
  const freeAt = NOW + 3_600_000;
  assert.deepEqual(agentCause(rpc("rate_limit", "You've hit your 5-hour limit"), { spent: true, freeAt }), { kind: "out", resets: freeAt }, "its plan's window says until when");
  assert.deepEqual(agentCause(rpc("rate_limit", "You've hit your 5-hour limit")), { kind: "out", resets: null }, "its words say it, with no window read");
  assert.deepEqual(agentCause(rpc("rate_limit", "Rate limited"), { spent: false, freeAt: null }), { kind: "rate", resets: null });
  assert.deepEqual(agentCause(rpc("overloaded", "Overloaded")), { kind: "busy", resets: null });
  assert.deepEqual(agentCause(rpc("authentication_failed")), { kind: "account", resets: null });
  assert.deepEqual(agentCause({ code: -32603, message: "Authentication required: Failed to authenticate: OAuth session expired and could not be refreshed" }), { kind: "account", resets: null });
  assert.deepEqual(agentCause(rpc("billing_error", "Your credit balance is too low")), { kind: "out", resets: null }, "a balance is the allowance's, though it fails as a sign-in does");
  assert.deepEqual(agentCause({ message: "Codex: usage limit", data: { errorKind: "usageLimitExceeded" } }), { kind: "out", resets: null });
  assert.deepEqual(agentCause(rpc("server_error")), { kind: "busy", resets: null });
  // (fails before: yes — TinyQuest's of 11-18: Cursor's SDK on a free plan was read as busy, held 10 s and offered
  // again as one that can run)
  const CURSOR_FREE = "[plan_required] Cloud Agent is not available for free users. Please upgrade to Pro.";
  assert.deepEqual(agentCause(Object.assign(new Error(CURSOR_FREE), { code: "plan_required", isRetryable: false })), { kind: "account", resets: null }, "the SDK's error, by its code");
  assert.deepEqual(agentCause(new Error(CURSOR_FREE)), { kind: "account", resets: null }, "its words alone, by the code they open with");
  assert.deepEqual(agentCause(Object.assign(new Error("the agent's process exited"), { code: "ENOENT" })), { kind: "busy", resets: null }, "a code no cause names is no cause");
  // (fails before: yes — the review of 11-19: a code no reader knows hid the one its words open with, and the failure
  // itself was still a transport's, tried again and cooled 10 s)
  assert.deepEqual(agentCause(Object.assign(new Error(CURSOR_FREE), { code: "ERR_X" })), { kind: "account", resets: null }, "the words' code, past one no reader knows");
  for (const e of [Object.assign(new Error(CURSOR_FREE), { code: "plan_required" }), new Error(CURSOR_FREE)]) assert.deepEqual(classifyFailure(e), { kind: "auth", retryable: false, cools: true }, "never tried again");
  // (fails before: yes — the review of 11-19: its weight is a sign-in's, so its banner said nobody was signed in)
  for (const e of [Object.assign(new Error(CURSOR_FREE), { code: "plan_required" }), new Error(CURSOR_FREE), rpc("billing_error", "your plan has no credit"), new Error("Your credit balance is too low")]) assert.equal(saysPlanRefused(e), true, String(e.message));
  for (const e of [rpc("authentication_failed", "Not logged in"), new Error("Cursor SDK has no Cursor API key"), Object.assign(new Error("the agent's process exited"), { code: "ENOENT" })]) assert.equal(saysPlanRefused(e), false, String(e.message));
  assert.deepEqual(agentCause(new Error("the agent's process exited (code 1)")), { kind: "busy", resets: null }, "a process that died is not its account's");
  assert.equal(agentCause(rpc("invalid_request", "Prompt is too long: 212000 tokens > 200000 maximum")), null, "a prompt too long is the request's");
  assert.equal(agentCause(rpc("invalid_request", "the request was refused as sent")), null);
});

// (fails before: yes — a model on a provider that could not serve still ran agents)
test("a model whose every upstream is held cannot run an agent, in the first one's words; one with an upstream that serves still can", () => {
  const cfg = {
    upstreams: [{ id: "zai" }, { id: "zai-b" }],
    routes: [
      { match: "zai/*", upstream: "zai", upstreamModel: "{1}", enabled: true },
      { match: "both/*", upstream: "zai", upstreamModel: "{1}", enabled: true, fallbacks: [{ upstream: "zai-b", upstreamModel: "glm-5.3-flash" }] },
    ],
    // Failover is off until switched on (the owner's of 11-09).
    rules: { resilience: { failover: true } },
  };
  /** @type {import("../src/core/provider-cause.js").Wall} */
  const wall = { kind: "out", said: "Insufficient balance", status: 429, at: NOW, until: NOW + OUT_HOLD_MS, reset: null, as: null };
  const held = new Set(["zai"]);
  const wallOf = (/** @type {string} */ id) => (held.has(id) ? wall : null);
  const words = `zai cannot serve now: this account's allowance is used up ("Insufficient balance") — for 15 min more, or until a call there succeeds`;
  assert.equal(walledProblem(cfg, "zai/glm-5.3-flash", wallOf, NOW), words);
  assert.equal(walledProblem(cfg, "both/glm-5.3-flash", wallOf, NOW), null, "its fallback serves, and the failover order tries it first");
  assert.equal(walledProblem({ ...cfg, rules: { resilience: { failover: false } } }, "both/glm-5.3-flash", wallOf, NOW), words, "with failover off, its fallback is never tried");
  held.add("zai-b");
  assert.equal(walledProblem(cfg, "both/glm-5.3-flash", wallOf, NOW), words);
  assert.equal(walledProblem(cfg, "nowhere/x", wallOf, NOW), null, "a name with no route is another check's");
});

// (fails before: yes — the page drew a held provider as healthy, or as cooling down for seconds)
test("the Providers page's pill for a held provider: what it cannot do and for how long, its title the provider's words and what the hold does", () => {
  assert.deepEqual(wallPill({ kind: "out", said: "Insufficient balance", leftMs: 13 * 60_000 + 1 }), {
    text: "can't serve · allowance used up · 14 min",
    title: "Insufficient balance\nSub-agents skip it until then, or until a call there succeeds. Reset lets it be tried again now.",
  });
  assert.deepEqual(wallPill({ kind: "account", said: "invalid x-api-key", leftMs: null }), {
    text: "can't serve · refuses the account",
    title: "invalid x-api-key\nSub-agents skip it until you fix it in Settings, or a call there succeeds. Reset lets it be tried again now.",
  });
  assert.equal(wallPill({ kind: "out", said: "", leftMs: 5_000 }).text, "can't serve · allowance used up · 1 min");
  // The row draws it ahead of a cooldown — a held provider cools down too — with its Reset.
  const home = readFileSync(new URL("../src/ui/pages/home.js", import.meta.url), "utf8");
  const cell = home.slice(home.indexOf("const stateCell = "));
  assert.ok(cell.indexOf("if (hb?.wall)") > 0 && cell.indexOf("if (hb?.wall)") < cell.indexOf("if (hb?.coolingDown)"), "the wall's pill comes first");
  assert.match(cell.slice(cell.indexOf("if (hb?.wall)"), cell.indexOf("if (hb?.coolingDown)")), /api\(`\/health\/\$\{encodeURIComponent\(u\.id\)\}\/reset`, \{ method: "POST" \}\)/);
});
