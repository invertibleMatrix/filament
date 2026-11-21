// @ts-check
// The skill tool for every agent (HarnessV4_Skills_Plan S1-1, S1-2): a coding agent's session is given Filament's skill
// tool where its chat offers skills — over Filament's MCP server, or as Cursor's custom tool — with the skills named in
// one standing block, told from the agent's own Skill tool. The skills are read at each call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createAgentTurns } from "../src/app/agent-inbox.js";
import { agentContext, skillsBlock, SKILLS_BLOCK } from "../src/app/agent-context.js";
import { givenTools, standingFor, SKILLS_TOOL } from "../src/adapters/agents/context.js";
import { loadSkills } from "../src/app/agent/skills.js";
import { serverInstructions } from "../src/http/mcp.js";
import { planToolset } from "../src/adapters/agents/acp/toolset.js";
import { readProfile } from "../src/adapters/agents/acp/profile.js";

const root = mkdtempSync(join(tmpdir(), "agent-tools-skill-"));
mkdirSync(join(root, "skills", "deploy"), { recursive: true });
writeFileSync(join(root, "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Ship a release\n---\nTag, build, publish.");
mkdirSync(join(root, "plug", "skills", "tdd"), { recursive: true });
writeFileSync(join(root, "plug", "skills", "tdd", "SKILL.md"), "---\nname: tdd\ndescription: Write the failing test first\n---\nRed, green.");
const doc = { skills: { yours: [{ name: "deploy", path: join(root, "skills", "deploy", "SKILL.md") }], plugins: [{ plugin: "superpowers", kind: "skill", path: join(root, "plug", "skills", "tdd", "SKILL.md") }], pluginsOn: [{ name: "superpowers", title: "Superpowers", description: "Core skills for coding agents. Each a procedure.", servers: [] }] } };
test.after(() => rmSync(root, { recursive: true, force: true }));

/** The chat's skills as the server reads them, here from a document that can change between calls. */
let offered = loadSkills(doc);
/** @type {{ chain: string, upstream: string, cwd: string }[]} */
const asked = [];
const tools = createAgentTools({
  memory: null,
  memoryToolsOn: () => false,
  graphs: () => null,
  turns: createAgentTurns(),
  subagents: () => null,
  membersOf: () => null,
  skills: (chain, upstream, cwd) => {
    asked.push({ chain, upstream, cwd });
    return offered;
  },
});
const ctx = (/** @type {Record<string, any>} */ o = {}) => ({ cwd: root, upstream: "claude-code", chain: "c1", turn: null, graph: false, ...o });

// (fails before: yes — no coding agent's session was given the skill tool: agent-tools listed none)
test("a session whose chat offers skills is given the skill tool, loaded whole; one given none never lists it", () => {
  const listed = tools.list(ctx({ skills: true }));
  const def = listed.find((t) => t.name === "skill");
  assert.ok(def, "listed");
  assert.equal(def.upfront, true, "held whole, beside the agent's own Skill");
  assert.deepEqual(Object.keys(def.inputSchema.properties), ["name", "action", "path", "from", "words"]);
  assert.deepEqual(asked.at(-1), { chain: "c1", upstream: "claude-code", cwd: root }, "the agent's upstream and folder pick what it is offered");
  assert.ok(!tools.list(ctx({ skills: false })).some((t) => t.name === "skill"));
  assert.ok(!tools.list(ctx({ skills: true, chain: null })).some((t) => t.name === "skill"));
  assert.equal(tools.has("skill"), true);
});

test("a call loads a skill, a plugin's index, or looks in a skill's folder — from the skills as they stand at the call", async () => {
  const one = await tools.call("skill", { name: "deploy" }, ctx({ skills: true }));
  assert.equal(one.isError, undefined);
  assert.match(one.text, /^Skill: deploy — Ship a release\n.*\n\nTag, build, publish\.$/s);
  assert.match((await tools.call("skill", { name: "superpowers" }, ctx({ skills: true }))).text, /^Plugin: superpowers/);
  assert.match((await tools.call("skill", { name: "superpowers:tdd", action: "find", words: "green" }, ctx({ skills: true }))).text, /SKILL\.md:5: Red, green\./);
  const unknown = await tools.call("skill", { name: "nope" }, ctx({ skills: true }));
  assert.equal(unknown.isError, true);
  // The chat's skills went away after the session opened: the call says so.
  const was = offered;
  offered = { skills: [], problems: [], plugins: [], library: [] };
  const gone = await tools.call("skill", { name: "deploy" }, ctx({ skills: true }));
  assert.deepEqual([gone.isError, /offers no skills now/.test(gone.text)], [true, true]);
  offered = was;
  const notGiven = await tools.call("skill", { name: "deploy" }, ctx({ skills: false }));
  assert.equal(notGiven.isError, true);
});

// (fails before: yes — the owner's of 11-07: the load turned the skill on for the chat, and a look in its folder was
// refused until it was; before 11-06 the load was refused)
test("a coding agent loads a skill off in its chat on demand, turning nothing on; a look in its folder answers too", async () => {
  mkdirSync(join(root, "skills", "pdf"), { recursive: true });
  writeFileSync(join(root, "skills", "pdf", "SKILL.md"), "---\nname: pdf\ndescription: Fill PDF forms\n---\nOpen the form.");
  const off = { name: "pdf", path: join(root, "skills", "pdf", "SKILL.md"), description: "Fill PDF forms" };
  const library = [off];
  const own = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: createAgentTurns(), subagents: () => null, membersOf: () => null, skills: () => ({ ...loadSkills(doc), library }) });
  const look = await own.call("skill", { name: "pdf", action: "list" }, ctx({ skills: true }));
  assert.equal(look.isError, undefined);
  assert.match(look.text, /SKILL\.md/);
  const got = await own.call("skill", { name: "pdf" }, ctx({ skills: true }));
  assert.equal(got.isError, undefined);
  assert.match(got.text, /^Skill: pdf — Fill PDF forms\n.*\n\nOpen the form\.$/s, "its text, with no word of turning it on");
  assert.deepEqual(library, [off], "still off: the Library's list as it was");
});

// (fails before: yes — a coding agent's context named no skill of Filament's)
test("the skills stand in one block, told from the agent's own Skill, only in a session given the tool", () => {
  const block = skillsBlock(offered);
  assert.ok(block);
  assert.equal(block.id, SKILLS_BLOCK);
  assert.equal(block.tool, SKILLS_TOOL);
  assert.equal(
    block.text,
    [
      '<filament-context kind="skills">',
      "This chat's skills, from Filament. Load one with Filament's `skill` tool — not your own Skill tool, which loads the skills of your own folders. When a request matches one's description or triggers, load it before you start that work, and follow it; its folder's references are listed, read and searched with the same tool. A $<name> in the person's message names one to load with it, listed here or not.",
      "- deploy — Ship a release",
      "Plugins on here, one line each; what one holds is not loaded until you need it. Load a plugin by its name with Filament's skill tool: its skills and commands come back, each then loaded by its full name (<plugin>:<name>).",
      "- superpowers — Core skills for coding agents. (1 skill)",
      "</filament-context>",
    ].join("\n"),
  );
  assert.equal(skillsBlock({ skills: [], plugins: [] }), null);
  assert.equal(skillsBlock(null), null);
  const context = agentContext({ format: "anthropic", body: { messages: [{ role: "user", content: "hi" }] }, graph: false, skills: offered });
  assert.deepEqual(standingFor(context, givenTools({ graph: false, launch: false, skills: true })).map((b) => b.id), [SKILLS_BLOCK]);
  assert.deepEqual(standingFor(context, givenTools({ graph: false, launch: false, skills: false })), [], "an agent the tool never reached is not told of it");
});

test("Filament's server names its skill tool as the agent connects, apart from the agent's own", () => {
  assert.match(serverInstructions({ cwd: "/w", skills: true, native: false }), /Its `skill` loads the skills this chat offers.*It is not your own Skill tool/);
  assert.doesNotMatch(serverInstructions({ cwd: "/w", native: false }), /`skill`/);
});

test("skills alone are enough for Filament's MCP server to be given; the pending context says so", () => {
  const init = { protocolVersion: 1, agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } }, agentInfo: { name: "@agentclientprotocol/claude-agent-acp", version: "0.90.0" } };
  const upstream = { id: "claude-code", acp: { command: "claude-agent-acp" } };
  const plan = (/** @type {boolean} */ skillsWanted) => planToolset({ acp: {}, upstream, proc: { initResult: init }, profile: readProfile(init), turn: { bridge: "prompts" }, fullBridge: false, cwd: "/w", mcpBase: "http://127.0.0.1:1", memoryWanted: false, skillsWanted, existingToken: null, notes: [] });
  const on = plan(true);
  assert.equal(on.wantMcp, true);
  assert.equal(/** @type {any} */ (on.pending).skills, true);
  assert.equal(plan(false).wantMcp, false);
});
