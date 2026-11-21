// @ts-check
// Native mode keeps Claude Code's own Skill (HarnessV4_Skills_Plan S1-4): Filament switches the agent's built-in tools
// off and hands it its own file tools, and Claude's adapter makes `disableBuiltInTools` an empty tool list, which turns
// off every built-in — Claude Code's Skill among them, so its own skills were gone in a native chat. The adapter takes
// `options.tools` first: an explicit list of the one built-in kept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planToolset } from "../src/adapters/agents/acp/toolset.js";
import { readProfile } from "../src/adapters/agents/acp/profile.js";
import { confirmedOf } from "../src/core/catalogues.js";
import { ActivityRenderer } from "../src/app/acp-render.js";

// The answer claude-agent-acp gives `initialize`, as far as the profile reads it.
const claudeInit = {
  protocolVersion: 1,
  agentCapabilities: {
    _meta: { claudeCode: { promptQueueing: true }, authStatus: {} },
    promptCapabilities: { image: true, embeddedContext: true },
    mcpCapabilities: { http: true, sse: true },
    loadSession: true,
    sessionCapabilities: { close: {}, fork: {}, list: {}, resume: {} },
  },
  agentInfo: { name: "@agentclientprotocol/claude-agent-acp", title: "Claude Agent", version: "0.90.0" },
};
const claude = { id: "claude-code", acp: { command: "claude-agent-acp" } };

/** @param {string} bridge @param {{ init?: any, upstream?: any }} [o] */
const metaOf = (bridge, o = {}) => {
  const init = o.init || claudeInit;
  const upstream = o.upstream || claude;
  const p = planToolset({ acp: upstream.acp || {}, upstream, proc: { initResult: init }, profile: readProfile(init, confirmedOf(upstream)), turn: { bridge }, fullBridge: bridge === "full" || bridge === "native", cwd: "/w", mcpBase: "http://127.0.0.1:1", memoryWanted: false, existingToken: null, notes: [] });
  return { native: p.native, meta: /** @type {any} */ (p.sessionMeta)._meta || {} };
};

// (fails before: yes — the meta held disableBuiltInTools alone, which Claude's adapter makes `tools: []`)
test("a native session hands Claude's adapter the one built-in it keeps, its Skill, beside switching the rest off", () => {
  const { native, meta } = metaOf("native");
  assert.equal(native, true);
  assert.equal(meta.disableBuiltInTools, true, "any agent's session still hears its built-ins are off");
  assert.deepEqual(meta.claudeCode?.options?.tools, ["Skill"]);
});

test("a session that is not native keeps Claude Code's whole preset: no tool list is handed", () => {
  for (const bridge of ["prompts", "full", "off"]) {
    const { native, meta } = metaOf(bridge);
    assert.equal(native, false, bridge);
    assert.equal(meta.disableBuiltInTools, undefined, bridge);
    assert.equal(meta.claudeCode?.options?.tools, undefined, bridge);
  }
});

// (fails before: yes — seen live 10-27: one Skill call in a native turn read as a 100% leak)
test("a call to the Skill a native session keeps is the agent's own, and no leak", () => {
  const r = new ActivityRenderer({ toolMode: "quiet" });
  r.handle({ type: "tool", id: "a", title: "Load skill: hello-own", status: "completed", toolName: "Skill" });
  r.handle({ type: "tool", id: "b", title: "mcp__filament__Read", status: "completed", routed: true, toolName: "mcp__filament__Read" });
  r.handle({ type: "tool", id: "c", title: "Read a.js", status: "completed", toolName: "Read" });
  // A name that comes on a later update moves the call to kept.
  r.handle({ type: "tool", id: "d", title: "tool call", status: "pending" });
  r.handle({ type: "tool", id: "d", title: "Load skill: books", status: "completed", toolName: "Skill" });
  const { announced, ...counts } = r.summary;
  assert.deepEqual(counts, { calls: 4, updatesMerged: 0, failures: 0, routed: 1, builtIn: 3, kept: 2, leakRate: 50 }, "one leak (Read) of the two calls that are not kept");
  const none = new ActivityRenderer({ toolMode: "quiet" });
  none.handle({ type: "tool", id: "a", title: "Load skill: x", status: "completed", toolName: "Skill" });
  assert.equal(none.summary.leakRate, null, "nothing but kept calls: nothing to measure");
});

test("an agent that is not Claude's adapter takes no claudeCode options in native mode", () => {
  const other = { id: "own-agent", acp: { command: "own-agent", nativeTools: true } };
  const init = { protocolVersion: 1, agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } }, agentInfo: { name: "own-agent", version: "1.0.0" } };
  const { native, meta } = metaOf("native", { init, upstream: other });
  assert.equal(native, true);
  assert.equal(meta.disableBuiltInTools, true);
  assert.equal(meta.claudeCode, undefined);
});
