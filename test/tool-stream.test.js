// Z.ai streams a tool call's arguments only when asked (`tool_stream`). (fails before: yes — the owner's word of 10-27:
// the speed gauge stood still while an agent on GLM wrote a file; measured through Filament on GLM-5.3, the call's whole
// input came in one piece at the end without it, in 499 over 7.6 s with it.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultsOf, RULES } from "../src/core/schema.js";
import { dryRunWith } from "../src/app/plan.js";
import { applyToolStream } from "../src/core/shaping.js";

const TOOLS = [{ name: "write", description: "Write a file", input_schema: { type: "object", properties: { path: { type: "string" } } } }];
/** Z.ai's coding plan, another OpenAI-compatible server, and an Anthropic one, each routed by its prefix. */
const cfg = {
  rules: defaultsOf(RULES),
  upstreams: [
    { id: "zai", type: "openai-compatible", enabled: true, baseUrl: "https://api.z.ai/api/coding/paas/v4" },
    { id: "cn", type: "openai-compatible", enabled: true, baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
    { id: "other", type: "openai-compatible", enabled: true, baseUrl: "https://api.example.com/v1" },
    { id: "a", type: "anthropic", enabled: true },
  ],
  routes: [
    { match: "zai/*", upstream: "zai", upstreamModel: "{model}" },
    { match: "cn/*", upstream: "cn", upstreamModel: "{model}" },
    { match: "other/*", upstream: "other", upstreamModel: "{model}" },
    { match: "claude-*", upstream: "a", upstreamModel: "{model}" },
  ],
};
/** The loop's own request: Anthropic's format, streamed, with its tools. @param {string} model @param {any} [extra] */
const dry = (model, extra = {}) =>
  /** @type {any} */ (dryRunWith(() => cfg, () => null, { format: "anthropic", body: { model, max_tokens: 100, stream: true, tools: TOOLS, messages: [{ role: "user", content: "hi" }], ...extra } }, cfg));

test("a streamed request with tools to Z.ai asks for each call's arguments as the model writes them, and says so", () => {
  for (const model of ["zai/glm-5.3", "cn/glm-5.3"]) {
    const p = dry(model);
    assert.equal(p.ok, true, JSON.stringify(p).slice(0, 300));
    assert.equal(p.body.tool_stream, true, model);
    assert.ok(p.changes.some((/** @type {string} */ c) => /^tool_stream on/.test(c)), p.changes.join(" | "));
  }
});

test("nowhere else, and never without a stream or tools", () => {
  assert.equal("tool_stream" in dry("other/some-model").body, false, "another server may refuse a field it does not know");
  assert.equal("tool_stream" in dry("claude-opus-5-5").body, false, "Anthropic streams its calls already");
  assert.equal("tool_stream" in dry("zai/glm-5.3", { stream: false }).body, false, "nothing streams to ask about");
  assert.equal("tool_stream" in dry("zai/glm-5.3", { tools: [] }).body, false, "no calls to stream");
  /** @type {string[]} */
  const changes = [];
  const body = { stream: true, tools: [{}], tool_stream: false };
  assert.equal(applyToolStream(body, "https://api.z.ai/api/paas/v4", changes), false, "the client's own word stands");
  assert.equal(body.tool_stream, false);
  assert.equal(applyToolStream({ stream: true, tools: [{}] }, "https://api.z.ai.evil.example/v1", changes), false, "the host itself, not a name that starts like it");
  assert.deepEqual(changes, []);
});
