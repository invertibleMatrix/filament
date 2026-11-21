import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeRules, parseModelSuffix, shapeAnthropic, shapeOpenAI, shapeHeaders } from "../src/rules.js";
import { upstreamModelOf } from "../src/app/plan.js";
import { findRoute } from "../src/core/routing.js";

const rules = mergeRules();
const req = (model) => parseModelSuffix(model, rules);
const agentBody = (over = {}) => ({ model: "claude-fable-5-1", max_tokens: 1000, stream: true, thinking: { type: "enabled", budget_tokens: 32000 }, output_config: { effort: "xhigh" }, messages: [{ role: "user", content: "hi" }], ...over });

test("legacy enabled+budget becomes adaptive with summarized display on Fable", () => {
  const { body, changes } = shapeAnthropic({ body: agentBody(), rules, requested: req("claude-fable-5-1") });
  assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized" });
  assert.equal(body.output_config.effort, "xhigh");
  assert.ok(changes.some((c) => c.includes("adaptive")));
});

test("suffix wins over client effort and is stripped from the model", () => {
  const r = req("claude-opus-5-max");
  assert.equal(r.base, "claude-opus-5"); assert.equal(r.suffixEffort, "max");
  const { body } = shapeAnthropic({ body: agentBody({ model: "claude-opus-5-max" }), rules, requested: r });
  assert.equal(body.model, "claude-opus-5"); assert.equal(body.output_config.effort, "max");
});

test("-fast suffix requests Anthropic fast mode on supported models and is downgraded elsewhere", () => {
  const a = req("claude-opus-5-xhigh-fast"); assert.equal(a.base, "claude-opus-5"); assert.equal(a.suffixEffort, "xhigh"); assert.equal(a.suffixFast, true);
  const b = req("claude-opus-5-fast-xhigh"); assert.equal(b.base, "claude-opus-5"); assert.equal(b.suffixEffort, "xhigh"); assert.equal(b.suffixFast, true);
  const s1 = shapeAnthropic({ body: agentBody({ model: "claude-opus-5-xhigh-fast" }), rules, requested: a });
  assert.equal(s1.body.model, "claude-opus-5"); assert.equal(s1.body.speed, "fast"); assert.deepEqual(s1.extraBetas, ["fast-mode-2026-02-01"]);
  const hdr = shapeHeaders({ rules, inbound: {}, format: "anthropic", extraBetas: s1.extraBetas });
  assert.ok(hdr["anthropic-beta"].includes("fast-mode-2026-02-01"));
  const c = req("claude-fable-5-1-fast");
  const s2 = shapeAnthropic({ body: agentBody({ model: "claude-fable-5-1-fast" }), rules, requested: c });
  assert.equal(s2.body.model, "claude-fable-5-1"); assert.equal(s2.body.speed, undefined); assert.ok(s2.changes.some((x) => x.includes("standard speed")));
  const s3 = shapeAnthropic({ body: agentBody({ model: "claude-opus-5", speed: "fast" }), rules: mergeRules({ speed: { mode: "never" } }), requested: req("claude-opus-5") });
  assert.equal(s3.body.speed, undefined);
  const plain = req("claude-opus-5"); assert.equal(plain.suffixFast, false); assert.equal(shapeAnthropic({ body: agentBody({ model: "claude-opus-5" }), rules, requested: plain }).body.speed, undefined);
});

test("upstream model template is applied", () => {
  const { body } = shapeAnthropic({ body: agentBody(), rules, requested: req("claude-fable-5-1"), upstreamModel: "anthropic/claude-fable-5-1" });
  assert.equal(body.model, "anthropic/claude-fable-5-1");
});

test("effort is clamped for models without xhigh, removed for models without effort", () => {
  const a = shapeAnthropic({ body: agentBody({ model: "claude-opus-4-6", output_config: { effort: "xhigh" }, thinking: { type: "adaptive" } }), rules, requested: req("claude-opus-4-6") });
  assert.equal(a.body.output_config.effort, "high");
  const b = shapeAnthropic({ body: agentBody({ model: "claude-haiku-4-5", thinking: { type: "adaptive" } }), rules, requested: req("claude-haiku-4-5") });
  assert.equal(b.body.output_config, undefined);
  assert.deepEqual(b.body.thinking, { type: "enabled", budget_tokens: 16000 });
});

test("thinking disabled is removed on Fable, kept on Opus 5 with effort capped", () => {
  const a = shapeAnthropic({ body: agentBody({ thinking: { type: "disabled" } }), rules, requested: req("claude-fable-5-1") });
  assert.equal(a.body.thinking, undefined);
  const b = shapeAnthropic({ body: agentBody({ model: "claude-opus-5", thinking: { type: "disabled" }, output_config: { effort: "max" } }), rules, requested: req("claude-opus-5") });
  assert.deepEqual(b.body.thinking, { type: "disabled" }); assert.equal(b.body.output_config.effort, "high");
});

test("sampling params are stripped on 4.7+ and kept on 4.6", () => {
  const a = shapeAnthropic({ body: agentBody({ temperature: 0.2, top_p: 0.9 }), rules, requested: req("claude-fable-5-1") });
  assert.equal(a.body.temperature, undefined);
  const b = shapeAnthropic({ body: agentBody({ model: "claude-sonnet-4-6", temperature: 0.2, thinking: { type: "adaptive" }, output_config: { effort: "high" } }), rules, requested: req("claude-sonnet-4-6") });
  assert.equal(b.body.temperature, 0.2);
});

test("cache breakpoints are added only when the client sent none, and respect minSystemChars", () => {
  const sys = "x".repeat(3000);
  const a = shapeAnthropic({ body: agentBody({ system: sys, messages: [{ role: "user", content: "q" }] }), rules, requested: req("claude-fable-5-1") });
  assert.equal(a.body.system[0].cache_control.type, "ephemeral");
  assert.equal(a.body.messages[0].content[0].cache_control.type, "ephemeral");
  const b = shapeAnthropic({ body: agentBody({ system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }] }), rules, requested: req("claude-fable-5-1") });
  assert.ok(!b.changes.some((c) => c.includes("cache_control added")));
  const c = shapeAnthropic({ body: agentBody({ system: "short" }), rules, requested: req("claude-fable-5-1") });
  assert.equal(typeof c.body.system, "string");
});

test("rule layers merge with route overriding upstream overriding global", () => {
  const merged = mergeRules({ effort: { default: "low" } }, { effort: { default: "medium" } }, { thinking: { display: "omitted" } });
  assert.equal(merged.effort.default, "medium"); assert.equal(merged.thinking.display, "omitted"); assert.equal(merged.effort.onUnsupported, "clamp");
});

test("default effort applies when neither suffix nor client provide one", () => {
  const r2 = mergeRules({ effort: { default: "high" } });
  const { body } = shapeAnthropic({ body: agentBody({ output_config: undefined }), rules: r2, requested: req("claude-fable-5-1") });
  assert.equal(body.output_config.effort, "high");
});

test("openai format: suffix -> reasoning_effort, include_usage added on streams", () => {
  const { body } = shapeOpenAI({ body: { model: "glm-5.3-high", stream: true, messages: [] }, rules, requested: parseModelSuffix("glm-5.3-high", rules) });
  assert.equal(body.model, "glm-5.3"); assert.equal(body.reasoning_effort, "high"); assert.equal(body.stream_options.include_usage, true);
});

test("headers: redact-thinking removed, client betas merged, claude-code identity", () => {
  const r2 = mergeRules({ headers: { identity: "claude-code", anthropicBetaAdd: ["interleaved-thinking-2025-05-14"] } });
  const hdr = shapeHeaders({ rules: r2, inbound: { "anthropic-beta": "redact-thinking-2026-02-12,effort-2025-11-24", authorization: "Bearer client" }, format: "anthropic", upstreamHeaders: {}, auth: { "x-api-key": "k" } });
  assert.equal(hdr["anthropic-beta"], "effort-2025-11-24,interleaved-thinking-2025-05-14");
  assert.equal(hdr["x-app"], "cli"); assert.match(hdr["user-agent"], /^claude-cli/); assert.equal(hdr["x-api-key"], "k"); assert.equal(hdr["authorization"], undefined);
});

test("forceStream on/off reports the client preference", () => {
  const r2 = mergeRules({ params: { forceStream: "on" } });
  const s = shapeAnthropic({ body: agentBody({ stream: false }), rules: r2, requested: req("claude-fable-5-1") });
  assert.equal(s.clientWantsStream, false); assert.equal(s.upstreamStream, true);
});

test("effort.stripSuffix off keeps the exact model name for routing while the suffix still selects the effort", () => {
  const keep = mergeRules({ effort: { stripSuffix: false } });
  const r = parseModelSuffix("gpt-5-high", keep);
  assert.equal(r.base, "gpt-5-high"); assert.equal(r.suffixEffort, "high");
  const f = parseModelSuffix("claude-opus-5-fast", keep); assert.equal(f.base, "claude-opus-5-fast"); assert.equal(f.suffixFast, true);
  const strip = parseModelSuffix("gpt-5-high", mergeRules()); assert.equal(strip.base, "gpt-5"); assert.equal(strip.original, "gpt-5-high");
  const { body } = shapeOpenAI({ body: { model: "gpt-5-high", messages: [] }, rules: keep, requested: r });
  assert.equal(body.model, "gpt-5-high"); assert.equal(body.reasoning_effort, "high");
});

// (fails before: no — written after upstreamModelOf was drawn out of the plan for memory's tools-refused lookup
// (HarnessV3-AtHome AH-D1), for the mutant that never forwarded the effort spelling) stripSuffix off on one route: the
// name parsed with the global rules has its suffix stripped, and that route's upstream still gets the name as sent
test("upstreamModelOf: a route that keeps the effort suffix forwards the client's spelling; another route the base", () => {
  const cfg = {
    rules: mergeRules(),
    upstreams: [{ id: "u", type: "openai-compatible" }],
    routes: [
      { match: "gpt-5*", upstream: "u", upstreamModel: "{model}", rules: { effort: { stripSuffix: false } } },
      { match: "o4*", upstream: "u", upstreamModel: "{model}" },
    ],
  };
  const at = (/** @type {string} */ name) => {
    const requested = parseModelSuffix(name, cfg.rules);
    const route = findRoute(cfg, requested.base);
    return upstreamModelOf(cfg, /** @type {any} */ (route), route, requested);
  };
  assert.equal(parseModelSuffix("gpt-5-high", cfg.rules).base, "gpt-5", "the global rules strip the suffix");
  assert.equal(at("gpt-5-high"), "gpt-5-high");
  assert.equal(at("o4-mini-high"), "o4-mini");
  assert.equal(at("gpt-5"), "gpt-5");
});

test("a request with no thinking object is treated as thinking-disabled for effort caps", () => {
  const { body } = shapeAnthropic({ body: { model: "claude-opus-5", max_tokens: 100, output_config: { effort: "max" }, messages: [{ role: "user", content: "hi" }] }, rules, requested: req("claude-opus-5") });
  assert.notEqual(body.output_config?.effort, "max", JSON.stringify(body.output_config));
});
