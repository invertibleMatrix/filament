import { test } from "node:test";
import assert from "node:assert/strict";
import { routeMatches, findRoute, renderUpstreamModel, upstreamEndpoint } from "../src/upstreams.js";

test("glob routes capture wildcard parts", () => {
  assert.deepEqual(routeMatches("claude-*", "claude-opus-5"), ["opus-5"]);
  assert.deepEqual(routeMatches("direct/claude-*", "direct/claude-opus-5"), ["opus-5"]);
  assert.deepEqual(routeMatches("*", "anything"), ["anything"]);
  assert.equal(routeMatches("claude-*", "gpt-5"), null);
  assert.deepEqual(routeMatches("re:^(9r|omni)/(.+)$", "omni/claude-opus-5"), ["omni", "claude-opus-5"]);
});

test("first matching route wins and carries its captures", () => {
  const cfg = { routes: [{ match: "direct/claude-*", upstream: "anthropic", upstreamModel: "claude-{1}" }, { match: "claude-*", upstream: "9router", upstreamModel: "{model}" }] };
  const r = findRoute(cfg, "direct/claude-opus-5");
  assert.equal(r.upstream, "anthropic");
  assert.equal(renderUpstreamModel(r.upstreamModel, "direct/claude-opus-5", r.captures), "claude-opus-5");
  const r2 = findRoute(cfg, "claude-opus-5");
  assert.equal(r2.upstream, "9router");
  assert.equal(renderUpstreamModel(r2.upstreamModel, "claude-opus-5", r2.captures), "claude-opus-5");
});

test("endpoint URLs never double the /v1 segment", () => {
  assert.equal(upstreamEndpoint({ type: "anthropic-compatible", baseUrl: "http://localhost:20228/v1" }, "anthropic"), "http://localhost:20228/v1/messages");
  assert.equal(upstreamEndpoint({ type: "openai-compatible", baseUrl: "http://localhost:20228" }, "openai"), "http://localhost:20228/v1/chat/completions");
  assert.equal(upstreamEndpoint({ type: "anthropic", baseUrl: "https://api.anthropic.com" }, "anthropic"), "https://api.anthropic.com/v1/messages?beta=true");
});
