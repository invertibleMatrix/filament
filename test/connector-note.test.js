// @ts-check
// What a project uses of a connector (the owner's word of 10-26: a company's Slack, this project's channels): a note
// kept per place as an account or a load is — `{ name, note }` on an inherited server, `note` on one the place holds —,
// the narrowest place's standing; Filament's own agent reads it on the server's line, a coding agent in its standing
// context; a change of it reopens no coding agent's session. A guide, no wall (services/mcp-servers.js, the settings'
// checks, app/sessions/mcp-servers.js `noted`, core/mcp-door.js, app/agent/prompt.js, app/agent-context.js, the list's
// words).
// (fails before: yes — nothing said which of Slack's channels a project's chats keep to)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isPick, mergeServers, noteOf, withNote } from "../src/services/mcp-servers.js";
import { mcpEntryProblem, mcpServerProblem } from "../src/services/session-settings.js";
import { chatKeyOf } from "../src/adapters/agents/chat-servers.js";
import { doorLines } from "../src/core/mcp-door.js";
import { PROMPT, systemPromptFor } from "../src/app/agent/prompt.js";
import { USES_BLOCK, agentContext, usesBlock } from "../src/app/agent-context.js";
import { createMcpServers } from "../src/app/sessions/mcp-servers.js";
import { rowLines } from "../src/ui/harness/lib/mcp-list.js";

const SLACK = { name: "slack", url: "https://slack.example/mcp" };

describe("the note, pure", () => {
  test("a pick of its own or beside the others; merged, the narrowest place's stands, an empty one takes it away; checked by its length", () => {
    assert.deepEqual([isPick({ name: "slack", note: "#proj-api" }), isPick({ name: "slack", note: "x", account: "work", enabled: false }), isPick({ name: "slack", note: 3 }), isPick({ name: "slack", note: "x", url: "https://x" })], [true, true, false, false]);
    assert.equal(noteOf({ note: "  #proj-api,\n  #proj-api-alerts " }), "#proj-api, #proj-api-alerts");
    assert.deepEqual([withNote({ ...SLACK, note: "a" }, "b"), withNote({ ...SLACK, note: "a" }, " ")], [{ ...SLACK, note: "b" }, SLACK]);
    const merged = mergeServers([{ at: "global", list: [SLACK] }, { at: "space", list: [{ name: "slack", note: "#work" }] }, { at: "project", list: [{ name: "slack", note: "#proj-api" }] }]);
    assert.deepEqual(merged.map((s) => [s.spec, s.from, s.noteAt]), [[{ ...SLACK, note: "#proj-api" }, "global", "project"]]);
    assert.deepEqual(mergeServers([{ at: "global", list: [{ ...SLACK, note: "#all" }] }, { at: "project", list: [{ name: "slack", note: "" }] }])[0].spec, SLACK, "an empty pick written by hand takes it away");
    assert.equal(mcpEntryProblem({ name: "slack", note: "#proj-api" }), null);
    assert.equal(mcpServerProblem({ ...SLACK, note: "x".repeat(300) }), null);
    assert.equal(mcpEntryProblem({ name: "slack", note: "x".repeat(301) }), "note must be words, 300 characters at most: what of this server the place uses");
  });

  test("a coding agent's session is not opened again for it; Filament's own agent reads it on the server's line, and keeps to it", () => {
    assert.equal(chatKeyOf([{ ...SLACK, note: "#proj-api" }]), chatKeyOf([SLACK]));
    assert.equal(doorLines([{ name: "slack", names: ["post", "read"], note: "#proj-api, #proj-api-alerts" }, { name: "linear", names: ["issues"] }]), "- slack: 2 tools — in this project: #proj-api, #proj-api-alerts\n- linear: 1 tool");
    const noted = systemPromptFor({ root: "/r", delegateRead: false, mcp: [{ name: "slack", tools: 12, names: ["post"], note: "#proj-api" }, { name: "gh", tools: 3, note: "the api repo" }] });
    assert.ok(noted.includes("- slack: 1 tool — in this project: #proj-api"), noted);
    assert.ok(noted.includes("gh (3 tools — in this project: the api repo)"), noted);
    assert.ok(noted.includes(PROMPT.mcpNoted));
    const plain = systemPromptFor({ root: "/r", delegateRead: false, mcp: [{ name: "slack", tools: 12, names: ["post"] }] });
    assert.ok(!plain.includes(PROMPT.mcpNoted) && !plain.includes("in this project"), "none noted: version 51's words");
  });

  test("a coding agent: one standing block for the servers that say, gone in words once none does", () => {
    assert.equal(usesBlock([SLACK]), null);
    const b = usesBlock([{ ...SLACK, note: "#proj-api, #proj-api-alerts" }, { name: "linear", url: "https://l", note: "team API" }, { name: "gh", command: "gh" }]);
    assert.equal(b?.id, USES_BLOCK);
    assert.equal(b?.text, '<filament-context kind="uses">\nThis project uses only these parts of its services: slack — #proj-api, #proj-api-alerts; linear — team API. Keep to them unless the person asks for more.\n</filament-context>');
    assert.match(String(b?.gone), /no longer stands/);
    const ctx = agentContext({ format: "anthropic", body: { messages: [{ role: "user", content: "hi" }] }, graph: false, servers: [{ ...SLACK, note: "#proj-api" }] });
    assert.deepEqual(ctx.standing.map((x) => x.id), [USES_BLOCK]);
    assert.deepEqual(agentContext({ format: "anthropic", body: { messages: [{ role: "user", content: "hi" }] }, graph: false }).standing, []);
  });
});

describe("the note in a project's Connectors", () => {
  /** Your defaults with Slack; Work (w1), a Space of yours, shows api. */
  function setup() {
    /** @type {{ defaults: any, projects: Record<string, any>, chats: Record<string, any> }} */
    const st = { defaults: { "plugins.mcp": [SLACK] }, projects: { w1: {}, api: {} }, chats: {} };
    /** @param {any} layer @param {any} change */
    const apply = (layer, change) => {
      for (const k of change.unset || []) delete layer[k];
      Object.assign(layer, change.patch || {});
    };
    const sessions = {
      patchDefaults: (/** @type {any} */ c) => apply(st.defaults, c),
      patchProjectSettings: (/** @type {string} */ id, /** @type {any} */ c) => apply(st.projects[id], c),
      patchSettings: () => {},
      launchInfo: () => null,
    };
    const archive = {
      getProject: (/** @type {string} */ id) => (st.projects[id] ? { id, name: id, cwd: `/w/${id}` } : null),
      projectSettings: (/** @type {string} */ id) => st.projects[id],
      chainSettings: () => ({}),
      spaceOf: (/** @type {string} */ id) => (id === "api" ? "w1" : null),
    };
    const servers = createMcpServers({ sessions, memory: { archive }, config: { get: () => ({ sessions: { defaults: st.defaults } }) }, home: "/home/me", ownName: (id) => (id === "w1" ? "Work" : null) });
    return { st, servers };
  }
  /** @param {any} list @param {string} name @returns {any} */
  const rowIn = (list, name) => list.servers.find((/** @type {any} */ r) => r.name === name);

  test("said for the project: kept as its pick, on its row, taken back by ↺'s call; empty, the Space's stands again", () => {
    const { st, servers } = setup();
    let list = servers.put("project:api", "slack", { note: " #proj-api,  #proj-api-alerts " });
    assert.deepEqual(st.projects.api["plugins.mcp"], [{ name: "slack", note: "#proj-api, #proj-api-alerts" }]);
    assert.equal(list.name, "api");
    let row = rowIn(list, "slack");
    assert.deepEqual([row.note, row.noteAt, row.on], ["#proj-api, #proj-api-alerts", "project", true]);
    assert.ok(rowLines(row, "project", 0).some((l) => l.text === "In this project: #proj-api, #proj-api-alerts"));
    // Work says its own; the project's stands over it, and once the project's goes, Work's shows, by its name.
    st.projects.w1["plugins.mcp"] = [{ name: "slack", note: "#work-standup" }];
    assert.equal(rowIn(servers.list("project:api"), "slack").note, "#proj-api, #proj-api-alerts");
    list = servers.put("project:api", "slack", { note: "" });
    assert.equal(st.projects.api["plugins.mcp"], undefined, "nothing of its own: the layer inherits again");
    row = rowIn(list, "slack");
    assert.deepEqual([row.note, row.noteAt], ["#work-standup", "space"]);
    assert.ok(rowLines(row, "project", 0).some((l) => l.text === "In Work: #work-standup"));
    // Beside a switch: one entry; ↺'s call takes both away.
    servers.put("project:api", "slack", { note: "#proj-api" });
    servers.put("project:api", "slack", { enabled: false });
    assert.deepEqual(st.projects.api["plugins.mcp"], [{ name: "slack", note: "#proj-api", enabled: false }]);
    servers.remove("project:api", "slack");
    assert.equal(st.projects.api["plugins.mcp"], undefined);
  });

  test("on a server the project holds: on its entry, kept through the editor's Save; refused past its length or for a server that reaches it not", () => {
    const { st, servers } = setup();
    servers.put("project:api", "linear", { url: "https://linear.example/mcp" });
    servers.put("project:api", "linear", { note: "team API" });
    assert.deepEqual(st.projects.api["plugins.mcp"], [{ name: "linear", url: "https://linear.example/mcp", note: "team API" }]);
    servers.put("project:api", "linear", { name: "linear", url: "https://linear.example/v2/mcp" });
    assert.deepEqual(st.projects.api["plugins.mcp"], [{ name: "linear", url: "https://linear.example/v2/mcp", note: "team API" }], "the editor knows no note: it stays");
    assert.throws(() => servers.put("project:api", "slack", { note: "x".repeat(301) }), { status: 400 });
    assert.throws(() => servers.put("project:api", "nope", { note: "x" }), { status: 404 });
  });
});
