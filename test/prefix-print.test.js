// @ts-check
// What a chat's agent loop sends ahead of its history, as a print (the owner's of 11-06: a card when the tools or the
// system prompt changed — Filament updated, an MCP server connected, whatever happened): the build's words and tools,
// and the chat's MCP servers, switched-off tools, skills, web and browser. The same settings give the same print, so
// the card never comes for nothing; what changed is said in words.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { agentBuildPrint, agentPrint, buildPrint, loopPrint, printChanges } from "../src/app/agent/prefix.js";
import { buildAgentTools } from "../src/app/agent-tools.js";

const doc = (o = {}) => ({ plugins: { mcp: [{ name: "github", type: "http", url: "https://api.example/mcp", headers: { Authorization: "Bearer one" } }], web: { fetch: true } }, loop: { tools: {} }, ...o });

describe("a chat's print", () => {
  // (fails before: yes — there was none)
  test("the same settings give the same print; a token renewed moves nothing", () => {
    const a = loopPrint(doc());
    assert.deepEqual(loopPrint(doc()), a);
    assert.equal(a.build, buildPrint());
    assert.match(a.build, /^[0-9a-f]{16}$/);
    const renewed = doc({ plugins: { mcp: [{ name: "github", type: "http", url: "https://api.example/mcp", headers: { Authorization: "Bearer two" } }], web: { fetch: true } } });
    assert.deepEqual(loopPrint(renewed), a, "a header's value is no change of what is sent");
    assert.deepEqual(printChanges(a, loopPrint(doc())), []);
    assert.deepEqual(printChanges(null, a), [], "a chat that kept none asks nothing");
  });

  test("what changed, in words: the build, MCP servers, tools, web and browser", () => {
    const was = loopPrint(doc());
    assert.deepEqual(printChanges({ ...was, build: "0000000000000000" }, was), ["Filament was updated: what it tells the agent, or its tools, changed"]);
    const more = loopPrint(doc({ plugins: { mcp: [{ name: "github", type: "http", url: "https://api.example/mcp" }, { name: "linear", type: "http", url: "https://linear.example/mcp" }], web: { fetch: true } } }));
    assert.deepEqual(printChanges(was, more), ["MCP server linear connected"]);
    assert.deepEqual(printChanges(more, was), ["MCP server linear removed"]);
    const moved = loopPrint(doc({ plugins: { mcp: [{ name: "github", type: "http", url: "https://other.example/mcp" }], web: { fetch: true } } }));
    assert.deepEqual(printChanges(was, moved), ["MCP server github changed"]);
    const off = loopPrint(doc({ loop: { tools: { bash: false } } }));
    assert.deepEqual(printChanges(was, off), ["tools switched off: bash"]);
    assert.deepEqual(printChanges(off, was), ["tools switched on: bash"]);
    const web = loopPrint(doc({ plugins: { mcp: [{ name: "github", type: "http", url: "https://api.example/mcp" }], web: { fetch: true, search: true } } }));
    assert.deepEqual(printChanges(was, web), ["web search switched on"]);
  });
});

describe("a coding agent's print", () => {
  // (fails before: yes — there was none; a resumed Claude Code session kept the tools it first loaded, unsaid)
  test("Filament's tools for it and its standing words, with the chat's MCP servers; the session's own switches stay out", () => {
    const a = agentPrint(doc());
    assert.equal(a.build, agentBuildPrint());
    assert.notEqual(a.build, buildPrint(), "an agent's tools are not the loop's");
    assert.deepEqual(agentPrint(doc({ loop: { tools: { bash: false } }, plugins: { mcp: [{ name: "github", type: "http", url: "https://api.example/mcp" }], web: { search: true } } })), a, "the loop's switches are no agent's");
    const names = buildAgentTools().map((t) => t.name);
    for (const n of ["tasks", "envelope", "background_command", "skill", "filament_memory_search"]) assert.ok(names.includes(n), n);
    const more = agentPrint(doc({ plugins: { mcp: [{ name: "github", type: "http", url: "https://api.example/mcp" }, { name: "linear", type: "http", url: "https://linear.example/mcp" }] } }));
    assert.deepEqual(printChanges(a, more), ["MCP server linear connected"]);
    assert.deepEqual(printChanges({ ...a, build: "0000000000000000" }, a), ["Filament was updated: what it tells the agent, or its tools, changed"]);
  });
});
