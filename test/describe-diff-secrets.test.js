// describeDiff's secret mask has THREE independent clauses (segment-shaped names, anything inside a `headers` map,
// anything inside an `env` map). The e2e save test (ops.test.js) pins the headers clause but passes with the segment
// clause mutated away — its upstream credential lives under `headers.`, so the headers clause masks it either way.
// These unit tests pin each clause distinctly, plus the over-masking negative (maxOutputTokens is a number, not a
// credential — substring matching would mask it; anchored segment matching must not).
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeDiff } from "../src/server.js";

const base = {
  rules: {}, server: {}, observability: {}, pricing: {},
  upstreams: [{ id: "u", apiKey: "old-key-aaaa1111", acp: { env: { CURSOR_API_KEY: "cursor-secret-abc" } }, rules: { headers: { set: { "X-Routing": "plain-value-1" } } } }],
  routes: [],
};
const changed = () => {
  const b = structuredClone(base);
  b.upstreams[0].apiKey = "new-key-bbbb2222";                        // segment clause: `apiKey` is credential-shaped
  b.upstreams[0].acp.env.CURSOR_API_KEY = "cursor-secret-xyz";       // env clause: the segment alone is NOT credential-shaped
  b.upstreams[0].rules.headers.set["X-Routing"] = "plain-value-2";   // headers clause: the value has no secret shape at all
  b.server = { adminToken: "brand-new-admin-token" };                // segment clause on a top-level group
  b.rules = { maxOutputTokens: 9999 };                               // the negative: a number under a token-ish name
  return b;
};

test("the segment clause masks credentials by path shape, even outside headers/env maps", () => {
  const d = describeDiff(base, changed());
  const by = Object.fromEntries(d.map((x) => [x.path, x]));
  assert.equal(by["upstreams.u.apiKey"]?.secret, true, "apiKey is masked by its path segment alone");
  assert.equal(by["upstreams.u.apiKey"]?.to, "••••••");
  assert.equal(by["server.adminToken"]?.secret, true, "adminToken likewise");
  const flat = JSON.stringify(d);
  assert.ok(!flat.includes("new-key-bbbb2222") && !flat.includes("brand-new-admin-token"), `no raw value survives: ${flat.slice(0, 300)}`);
});

test("the headers and env clauses mask values that have no secret SHAPE", () => {
  const d = describeDiff(base, changed());
  const by = Object.fromEntries(d.map((x) => [x.path, x]));
  assert.equal(by["upstreams.u.rules.headers.set.X-Routing"]?.secret, true, "a plain string inside a headers map is masked — the map, not the value, decides");
  assert.equal(by["upstreams.u.acp.env.CURSOR_API_KEY"]?.secret, true, "and inside an env map");
  const flat = JSON.stringify(d);
  assert.ok(!flat.includes("plain-value-2"), `the headers value is masked: ${flat.slice(0, 300)}`);
  assert.ok(!flat.includes("cursor-secret-xyz"), "and the env value");
});

test("the negative: a non-secret path is NOT masked, so the trail stays useful", () => {
  const d = describeDiff(base, changed());
  const by = Object.fromEntries(d.map((x) => [x.path, x]));
  assert.equal(by["rules.maxOutputTokens"]?.to, 9999, "an ordinary number is recorded in clear");
  assert.ok(!by["rules.maxOutputTokens"]?.secret, "and carries no secret flag");
});

// (fails before: yes — the walk named its sections by hand and left the agent loop's and the sessions' out, so an
// assistant apply that changed only the loop's permissions said "0 changes")
test("describeDiff walks every section, so an assistant apply cannot hide as 0 changes", () => {
  const a = { rules: {}, server: {}, observability: {}, memory: { enabled: true }, alerts: { dailyCostUsd: 10 }, agentLoop: { enabled: true, permissions: "edit" }, sessions: { resumeAfterRestart: true }, upstreams: [], routes: [] };
  const b = structuredClone(a);
  b.memory.enabled = false;
  b.alerts.dailyCostUsd = 50;
  b.agentLoop.permissions = "auto";
  b.sessions.resumeAfterRestart = false;
  assert.deepEqual(describeDiff(a, b).map((x) => [x.path, x.from, x.to]), [
    ["memory.enabled", true, false],
    ["alerts.dailyCostUsd", 10, 50],
    ["agentLoop.permissions", "edit", "auto"],
    ["sessions.resumeAfterRestart", true, false],
  ]);
});
