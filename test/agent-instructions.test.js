// @ts-check
// HarnessV2 Phase 5 — instructions and skills: the pure block builder and the SKILL.md loader, then the loop end to
// end (the system prompt the model receives ends with the files, the session text, the skills catalogue and the
// triggered skill; the record carries the block's hash; the row shows what is in force).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { argSummary } from "../src/app/agent/tools.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { instructionsBlock, folderInstructions, folderNoteHead, yourFilesCheck, INSTRUCTIONS_FILE_CAP } from "../src/app/agent/instructions.js";
import { alignEvents, roundNotes, toldWords } from "../src/ui/harness/lib/labels.js";
import { cardsEl } from "../src/ui/harness/conversation/timeline.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { parseSkillFile, loadSkills, triggeredSkills, skillsSections, skillAnswer, pluginLine, calledNotes, calledWords } from "../src/app/agent/skills.js";

const text = (blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (blocks, stop = "end_turn", model = "brain-model") =>
  anthropicReply("", { model, stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });

describe("instructions and skills, pure (HarnessV2 §5.6)", () => {
  test("instructionsBlock: the files found in the document's order, missing ones named, a long file cut with the cut said, the session text after; the same bytes hash the same", () => {
    const root = mkdtempSync(join(tmpdir(), "filament-instr-"));
    writeFileSync(join(root, "AGENTS.md"), "# Agents\nUse tabs.\n");
    mkdirSync(join(root, ".filament"));
    writeFileSync(join(root, ".filament", "instructions.md"), "x".repeat(INSTRUCTIONS_FILE_CAP + 50));
    const doc = { instructions: { files: ["AGENTS.md", "CLAUDE.md", ".filament/instructions.md", "../outside.md"], session: "Answer in French." } };
    const b = instructionsBlock(doc, root);
    assert.deepEqual(b.files.map((f) => [f.file, f.truncated]), [["AGENTS.md", false], [".filament/instructions.md", true]]);
    assert.deepEqual(b.missing, ["CLAUDE.md", "../outside.md"]);
    assert.equal(b.sessionChars, 17);
    assert.match(b.text, /^# Project instructions\n## AGENTS\.md\n# Agents\nUse tabs\.\n\n## \.filament\/instructions\.md\nx{24000}\n…\[Filament: \.filament\/instructions\.md cut at 24,000 of 24,050 characters\]\n\n# Session instructions\nAnswer in French\.$/);
    assert.equal(b.hash, instructionsBlock(doc, root).hash);
    assert.notEqual(b.hash, instructionsBlock({ instructions: { files: ["AGENTS.md"] } }, root).hash);
    const none = instructionsBlock({ instructions: { files: ["nope.md"], session: "" } }, root);
    assert.equal(none.text, ""); assert.equal(none.hash, null); assert.deepEqual(none.missing, ["nope.md"]);
    assert.equal(instructionsBlock(null, root).text, "");
    rmSync(root, { recursive: true, force: true });
  });
  test("parseSkillFile: front matter keys, inline and block lists, quotes stripped; no front matter is all body", () => {
    const { meta, body } = parseSkillFile(`---\nname: release-notes\ndescription: "Write the notes from the changelog"\ntriggers: [release, "notes", changelog]\n---\n# Steps\n1. read CHANGELOG.md\n`);
    assert.deepEqual(meta, { name: "release-notes", description: "Write the notes from the changelog", triggers: ["release", "notes", "changelog"] });
    assert.equal(body, "# Steps\n1. read CHANGELOG.md");
    const block = parseSkillFile("---\nname: x\ntriggers:\n  - one\n  - two\n---\nbody");
    assert.deepEqual(block.meta.triggers, ["one", "two"]);
    assert.deepEqual(parseSkillFile("just a body"), { meta: {}, body: "just a body" });
  });
  test("loadSkills: your skills on here by their name in the Library, none on = none, one gone is a problem in words; a skill is called by $name or /name, not a trigger word; the sections carry the catalogue and the called skill whole", () => {
    const root = mkdtempSync(join(tmpdir(), "filament-skills-"));
    mkdirSync(join(root, "skills", "deploy"), { recursive: true });
    mkdirSync(join(root, "skills", "review"), { recursive: true });
    writeFileSync(join(root, "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Ship a release\ntriggers: [deploy, ship it]\n---\nRun the release script.");
    writeFileSync(join(root, "skills", "review", "SKILL.md"), "---\ndescription: Review a diff\ntriggers: [review]\n---\nRead the diff twice.");
    const off = loadSkills({ skills: {} });
    assert.deepEqual(off, { skills: [], problems: [], plugins: [], library: [] });
    const yours = [{ name: "deploy", path: join(root, "skills", "deploy", "SKILL.md") }, { name: "review", path: join(root, "skills", "review", "SKILL.md") }];
    const on = loadSkills({ skills: { yours, gone: ["old"] } });
    assert.deepEqual(on.skills.map((s) => [s.name, s.description, s.triggers]), [["deploy", "Ship a release", ["deploy", "ship it"]], ["review", "Review a diff", ["review"]]]);
    assert.deepEqual(on.problems, ["the skill old is on here but is not in Library › Skills, or its folder is gone"]);
    assert.deepEqual(triggeredSkills(on.skills, "please ship it today").map((s) => s.name), [], "a trigger word calls no skill (the memory upgrade's a4)");
    assert.deepEqual(triggeredSkills(on.skills, "the deployment is late").map((s) => s.name), []);
    assert.deepEqual(triggeredSkills(on.skills, "$review this and /deploy").map((s) => s.name), ["deploy", "review"]);
    const sections = skillsSections(on.skills);
    assert.equal(sections.length, 1, "a called skill rides the person's message, never the prompt (calledNotes)");
    // Each by what it is for and its triggers, A to Z: the model reads them and loads the skill a request needs.
    assert.match(sections[0], /^# Skills\n.*\n- deploy — Ship a release \(triggers: deploy, ship it\)\n- review — Review a diff \(triggers: review\)$/s);
    assert.deepEqual(calledNotes(on, "/deploy").map((c) => c.text), [calledWords(on.skills[0])]);
    assert.match(calledWords(on.skills[0]), /^<filament-context kind="skill">\nThe person called \$deploy: here it is whole\. Its folder: .+\n\nRun the release script\.\n<\/filament-context>$/);
    assert.deepEqual(skillsSections([]), []);
    // A model that takes no tools is not told to load one with the skill tool (the Hunter on B4).
    assert.match(skillsSections(on.skills)[0], /load it with the skill tool/);
    assert.doesNotMatch(skillsSections(on.skills, { tool: false })[0], /skill tool/);
    rmSync(root, { recursive: true, force: true });
  });
  // (fails before: every skill and command of a plugin on rode every request in a line of its own — the owner's words of
  // 10-26: "everything should be loaded on demand even if enabled")
  test("a plugin on is one line under # Plugins, your own skills one each under # Skills; the skill tool loads a plugin's index by its name, then its skill by its full name", () => {
    const root = mkdtempSync(join(tmpdir(), "filament-skills-plug-"));
    mkdirSync(join(root, "mine", "deploy"), { recursive: true });
    writeFileSync(join(root, "mine", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Ship a release\n---\nRun the release script.");
    const put = (/** @type {string} */ rel, /** @type {string} */ body) => {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), body);
    };
    put("sp/skills/tdd/SKILL.md", "---\nname: tdd\ndescription: Write the failing test first\n---\nRed, green, refactor.");
    put("sp/skills/debug/SKILL.md", "---\nname: debug\ndescription: Find the cause before the fix\n---\nReproduce it.");
    put("sp/commands/plan.md", "---\ndescription: Write a plan\n---\nList the steps.");
    put("lin/skills/triage/SKILL.md", "---\nname: triage\ndescription: Triage new issues\n---\nLabel each.");
    const doc = {
      skills: {
        yours: [{ name: "deploy", path: join(root, "mine", "deploy", "SKILL.md") }],
        plugins: [
          { plugin: "superpowers", kind: "skill", path: join(root, "sp/skills/tdd/SKILL.md") },
          { plugin: "superpowers", kind: "skill", path: join(root, "sp/skills/debug/SKILL.md") },
          { plugin: "superpowers", kind: "command", path: join(root, "sp/commands/plan.md") },
          { plugin: "linear", kind: "skill", path: join(root, "lin/skills/triage/SKILL.md") },
        ],
        pluginsOn: [
          { name: "superpowers", title: "Superpowers", description: "Core skills for coding agents. TDD, debugging and planning, each a procedure.", servers: [] },
          { name: "linear", title: "Linear", description: "Linear's issues and projects", servers: ["linear"] },
        ],
      },
    };
    const set = loadSkills(doc);
    assert.deepEqual(set.plugins.map((p) => [p.name, p.skills.map((s) => [s.name, s.kind])]), [["superpowers", [["superpowers:tdd", "skill"], ["superpowers:debug", "skill"], ["superpowers:plan", "command"]]], ["linear", [["linear:triage", "skill"]]]]);
    const [mine, plugs, ...rest] = skillsSections(set.skills, { plugins: set.plugins });
    assert.equal(rest.length, 0);
    assert.match(mine, /^# Skills\n.*\n- deploy — Ship a release$/s);
    assert.match(plugs, /^# Plugins\nPlugins on here, one line each; .*load it with the skill tool by its name.*\n- superpowers — Core skills for coding agents\. \(2 skills, 1 command\)\n- linear — Linear's issues and projects \(1 skill; connector linear\)$/s);
    assert.ok(!plugs.includes("superpowers:tdd") && !mine.includes("superpowers:"), "a plugin's skills are not listed until it is loaded");
    assert.doesNotMatch(skillsSections(set.skills, { tool: false, plugins: set.plugins })[1], /skill tool/);
    // Only plugins: no # Skills.
    const only = loadSkills({ skills: { plugins: doc.skills.plugins, pluginsOn: doc.skills.pluginsOn } });
    assert.deepEqual(skillsSections(only.skills, { plugins: only.plugins }).map((s) => s.split("\n")[0]), ["# Plugins"]);
    // The skill tool: a plugin by its name gives its index; its skill by its full name; an unknown name the names there are.
    const index = skillAnswer(set.skills, { name: "Superpowers" }, set.plugins);
    assert.ok(index.ok && "plugin" in index);
    assert.equal(index.text, [
      "Plugin: superpowers — Core skills for coding agents. TDD, debugging and planning, each a procedure.",
      "",
      "Its skills — load the one whose description fits with this tool, by its full name, before you start that work:",
      "- superpowers:tdd — Write the failing test first",
      "- superpowers:debug — Find the cause before the fix",
      "",
      "Its commands — procedures the developer may also type as /<name>; load one the same way:",
      "- superpowers:plan — Write a plan",
    ].join("\n"));
    assert.match(skillAnswer(set.skills, { name: "linear" }, set.plugins).text, /\nIts connector, MCP server of this session: linear\. The mcp tool lists its tools/);
    const one = skillAnswer(set.skills, { name: "/superpowers:tdd" }, set.plugins);
    assert.ok(one.ok && "skill" in one && one.text.endsWith("Red, green, refactor."));
    assert.deepEqual(skillAnswer(set.skills, { name: "nope" }, set.plugins), { ok: false, text: 'There is no skill or plugin "nope". The skills are: deploy. The plugins are: superpowers, linear; load one by its name to see its skills.' });
    // The plugin sheet weighs the same line before the plugin is installed.
    assert.equal(pluginLine("linear", "Linear's issues and projects", { skills: 1, commands: 0, servers: ["linear"] }), "- linear — Linear's issues and projects (1 skill; connector linear)");
    rmSync(root, { recursive: true, force: true });
  });
  // (fails before: yes — the Hunter on B4: the run's line and the card said "skill" and nothing of which)
  test("a skill loaded is named on the timeline: the run's line and the card, Filament's tool and Claude Code's", () => {
    assert.equal(argSummary("skill", { name: "deploy" }), "deploy");
    assert.deepEqual(cardOf("skill", { name: "deploy" }), { kind: "other", title: "Load skill", subject: "deploy" });
    assert.deepEqual(cardOf("Skill", { skill: "review" }), { kind: "other", title: "Load skill", subject: "review" });
  });
});

// Instruction files as Claude Code reads them (the Designer's answer of 10-27, accepted).
describe("instruction files from your own folder, the folders above and the folders below", () => {
  /** A set the conversation's heads are kept in, as the loop keeps them. */
  const heads = () => {
    const set = new Set();
    return { set, has: (/** @type {string} */ h) => set.has(h), add: (/** @type {string} */ h) => void set.add(h) };
  };

  // (fails before: yes — only the chat's own folder was read: your own files were never read, a folder above the chat's
  // in its repository told nothing, and a CLAUDE.md that holds what the AGENTS.md beside it holds was told twice)
  test("your files first, then each folder above the chat's up to the repository's top, outermost first; a file the same as one before it told once", () => {
    const base = mkdtempSync(join(tmpdir(), "filament-instr-up-"));
    const top = join(base, "repo");
    const home = join(base, "home");
    mkdirSync(join(top, ".git"), { recursive: true });
    mkdirSync(join(top, "sub"), { recursive: true });
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(base, "AGENTS.md"), "above the repository: never told");
    writeFileSync(join(top, "AGENTS.md"), "top rules\n");
    writeFileSync(join(top, "sub", "AGENTS.md"), "sub rules\n");
    writeFileSync(join(top, "sub", "CLAUDE.md"), "sub rules\r\n");
    writeFileSync(join(home, ".claude", "CLAUDE.md"), "mine\n");
    const doc = { instructions: { files: ["AGENTS.md", "CLAUDE.md"], userFiles: ["~/.claude/CLAUDE.md", "~/nope.md"] } };
    const b = instructionsBlock(doc, join(top, "sub"), { home });
    assert.deepEqual(b.files.map((x) => [x.file, x.from ?? "here"]), [["~/.claude/CLAUDE.md", "yours"], ["../AGENTS.md", "above"], ["AGENTS.md", "here"]]);
    assert.deepEqual(b.same, [{ file: "CLAUDE.md", as: "AGENTS.md" }], "its line endings aside, the same text");
    assert.deepEqual(b.yoursMissing, ["~/nope.md"]);
    assert.deepEqual(b.missing, [], "CLAUDE.md is there, told once");
    assert.equal(b.text, "# The user's instructions for every project\n## ~/.claude/CLAUDE.md\nmine\n\n# Project instructions\n## ../AGENTS.md\ntop rules\n\n## AGENTS.md\nsub rules");
    // A worktree's top is its own: its .git is a file, and the walk stops there.
    mkdirSync(join(top, "wt", "pkg"), { recursive: true });
    writeFileSync(join(top, "wt", ".git"), "gitdir: ../.git/worktrees/wt\n");
    writeFileSync(join(top, "wt", "AGENTS.md"), "worktree rules\n");
    assert.deepEqual(instructionsBlock({ instructions: { files: ["AGENTS.md"] } }, join(top, "wt", "pkg"), { home }).files.map((x) => x.file), ["../AGENTS.md"]);
    // Outside a repository the chat's folder stands alone.
    mkdirSync(join(base, "loose", "inner"), { recursive: true });
    writeFileSync(join(base, "loose", "AGENTS.md"), "loose rules");
    assert.deepEqual(instructionsBlock({ instructions: { files: ["AGENTS.md"] } }, join(base, "loose", "inner"), { home }).missing, ["AGENTS.md"]);
    // None of your own by default: the block is what it was.
    assert.ok(!instructionsBlock({ instructions: { files: ["AGENTS.md"] } }, top, { home }).text.includes("The user's instructions"));
    // The settings row's lines: each of yours there or not, sizes only; Claude Code's own offered where it is.
    assert.deepEqual(yourFilesCheck(["~/.claude/CLAUDE.md", "~/nope.md"], home), { files: [{ path: "~/.claude/CLAUDE.md", found: true, chars: 5 }, { path: "~/nope.md", found: false }], offer: { path: "~/.claude/CLAUDE.md", chars: 5 } });
    assert.equal(yourFilesCheck([], join(base, "nobody")).offer, null);
    rmSync(base, { recursive: true, force: true });
  });

  // (fails before: yes — a folder below the chat's told the agent nothing of its AGENTS.md, as Claude Code tells a
  // subfolder's CLAUDE.md when it reads there)
  test("a folder below the chat's tells its files as the agent works there: outermost first, once while the conversation holds them, redacted; a search is no work there", () => {
    const root = mkdtempSync(join(tmpdir(), "filament-instr-down-"));
    mkdirSync(join(root, "src", "ui"), { recursive: true });
    writeFileSync(join(root, "src", "AGENTS.md"), "src rules\n");
    writeFileSync(join(root, "src", "ui", "AGENTS.md"), "ui rules: the key is sk-SECRET\n");
    writeFileSync(join(root, "src", "ui", "CLAUDE.md"), "ui rules: the key is sk-SECRET\n");
    const names = ["AGENTS.md", "CLAUDE.md"];
    const told = heads();
    const redact = (/** @type {string} */ t) => t.replace(/sk-\w+/g, "[redacted]");
    const got = folderInstructions(root, names, [{ path: "src/ui/app.js", how: "read" }], told, { redact });
    assert.deepEqual(got.told.map((t) => [t.file, t.as, t.how]), [["src/AGENTS.md", "src/ui/app.js", "read"], ["src/ui/AGENTS.md", "src/ui/app.js", "read"]]);
    assert.equal(got.text, [
      `${folderNoteHead("src/AGENTS.md")}\nTold as you read src/ui/app.js: these hold for your work in src and the folders below it, beside the project's instructions.\n\nsrc rules\n</folder-instructions>`,
      `${folderNoteHead("src/ui/AGENTS.md")}\nTold as you read src/ui/app.js: these hold for your work in src/ui and the folders below it, beside the project's instructions.\n\nui rules: the key is [redacted]\n</folder-instructions>`,
    ].join("\n\n"));
    assert.ok(told.set.has(folderNoteHead("src/ui/CLAUDE.md")), "the CLAUDE.md beside it holds the same: told once, and known told");
    assert.equal(folderInstructions(root, names, [{ path: join(root, "src", "ui", "b.js"), how: "edit" }], told).text, "", "told once while the conversation holds it, whatever the path's spelling");
    // A compaction drops the note: told again.
    const after = folderInstructions(root, names, [{ path: "src/ui/b.js", how: "write" }], heads());
    assert.deepEqual(after.told.map((t) => [t.file, t.how]), [["src/AGENTS.md", "write"], ["src/ui/AGENTS.md", "write"]]);
    assert.match(after.text, /Told as you wrote src\/ui\/b\.js/);
    // A folder's file the round read itself is not told again; outside the folder, nothing.
    assert.deepEqual(folderInstructions(root, names, [{ path: "src/AGENTS.md", how: "read" }], heads()).told, []);
    assert.deepEqual(folderInstructions(root, names, [{ path: "../elsewhere/x.js", how: "read" }], heads()).told, []);
    assert.deepEqual(folderInstructions(root, names, [{ path: "top.js", how: "read" }], heads()).told, [], "the chat's own folder's files ride the prompt");
    // Past the room, a file is named, to be told when the agent next works there.
    mkdirSync(join(root, "a", "b"), { recursive: true });
    writeFileSync(join(root, "a", "AGENTS.md"), "x".repeat(INSTRUCTIONS_FILE_CAP + 10));
    writeFileSync(join(root, "a", "b", "AGENTS.md"), "y".repeat(INSTRUCTIONS_FILE_CAP + 10));
    const big = folderInstructions(root, names, [{ path: "a/b/c.js", how: "read" }], told);
    assert.deepEqual(big.told.map((t) => [t.file, t.truncated]), [["a/AGENTS.md", true]]);
    assert.deepEqual(big.left, ["a/b/AGENTS.md"]);
    assert.match(big.text, /The folders you worked in also hold a\/b\/AGENTS\.md, not told here for room: read it before you change files there\.$/);
    assert.equal(told.has(folderNoteHead("a/b/AGENTS.md")), false);
    rmSync(root, { recursive: true, force: true });
  });

  // (fails before: yes — no line said what a folder told the agent)
  test("the turn's steps say a folder's file told, in one quiet line opening to the text", () => {
    const al = alignEvents([{ type: "instructions-told", round: 2, files: [{ file: "src/ui/AGENTS.md", as: "src/ui/app.js", how: "read", chars: 9, text: "ui rules" }] }]);
    const cell = al.byRound.get(2);
    assert.deepEqual(cell.told, [{ file: "src/ui/AGENTS.md", as: "src/ui/app.js", how: "read", text: "ui rules" }]);
    assert.ok(roundNotes(cell, false), "a round with one stands apart, its note under its calls");
    assert.equal(toldWords({ file: "src/ui/AGENTS.md", as: "src/ui/b.js", how: "edit" }), "Told the agent src/ui/AGENTS.md, as it edited src/ui/b.js");
    const doc = stubDocument();
    try {
      const rows = cardsEl(cell, {}).filter((/** @type {any} */ r) => /told-note/.test(r.className || ""));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].tagName.toLowerCase(), "details");
      assert.match(rows[0].textContent, /^Told the agent src\/ui\/AGENTS\.md, as it read src\/ui\/app\.js.*ui rules$/s);
    } finally {
      doc.restore();
    }
  });
});

describe("instructions and skills through the loop", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  const configure = (cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.memory.autopilot = { enabled: false };
    cfg.memory.capture = { turns: true, learn: false };
    cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-agent-instr-"));
    writeFileSync(join(root, "AGENTS.md"), "# Agents\nAlways answer with a haiku.\n");
    mkdirSync(join(root, "skills", "greet"), { recursive: true });
    writeFileSync(join(root, "skills", "greet", "SKILL.md"), "---\nname: greet\ndescription: Greet the developer by name\ntriggers: [hello, greet]\n---\nSay hello using the developer's name from git config.");
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({ memory: true, configure, keep: true });
    // In Library › Skills, on at no place: each chat below turns it on.
    assert.equal((await shim.api("/api/skills", { method: "POST", body: { paths: [join(root, "skills")] } })).status, 200);
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });

  // (fails before: yes — the called skill rode the system prompt for its turn alone, so the next turn's prompt hashed
  // otherwise and the provider wrote the whole chat to its cache again; then its text rode the message — the owner's of
  // 11-07: a tag is the agent's to load on demand)
  test("the system prompt the model gets ends with the instruction files, the session text and the skills catalogue, the same every turn; a tagged skill is the agent's to load, nothing of it sent; the record names the block; the row shows what is in force", async () => {
    const created = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { instructions: { session: "Be brief." }, skills: { on: [{ name: "greet" }] } } } })).json();
    const id = created.id;
    /** @type {string[]} */
    const systems = [];
    /** @type {string[]} */
    const lasts = [];
    brain = (call) => {
      systems.push(Array.isArray(call.body.system) ? call.body.system.map((b) => b.text).join("") : String(call.body.system || ""));
      lasts.push(JSON.stringify((call.body.messages || []).at(-1)));
      return reply([{ type: "text", text: "Hi there." }]);
    };
    up.reset();
    const r1 = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "$greet hello, who am I?", stream: false } });
    assert.equal(r1.status, 200);
    assert.equal(text((await r1.json()).content), "Hi there.");
    const sys = systems[0];
    assert.match(sys, /\n\n# Project instructions\n## AGENTS\.md\n# Agents\nAlways answer with a haiku\.\n\n# Session instructions\nBe brief\.\n\n# Skills\n.*\n- greet — Greet the developer by name \(triggers: hello, greet\)$/s);
    assert.ok(!lasts[0].includes("Say hello using the developer's name from git config."), "nothing of the tagged skill on the message");
    assert.ok(!sys.includes("CLAUDE.md"), "a missing file is not in the prompt");
    const rec = await shim.record(r1.headers.get("x-filament-request-id"));
    assert.deepEqual(rec.agent.instructions.files, ["AGENTS.md"]);
    assert.deepEqual(rec.agent.instructions.missing, ["CLAUDE.md", ".filament/instructions.md"]);
    assert.deepEqual(rec.agent.instructions.triggered, ["greet"]);
    assert.match(rec.agent.instructions.hash, /^[0-9a-f]{12}$/);
    assert.ok(rec.changes.some((c) => /^agent: instructions in the system prompt — AGENTS\.md \(37 chars\), session text \(9 chars\), 1 skill listed \(hash [0-9a-f]{12}\)$/.test(c)), rec.changes.join("\n"));
    assert.ok(rec.changes.includes("agent: the message tags greet — the agent's to load with the skill tool, nothing of it sent"), rec.changes.join("\n"));
    assert.ok(rec.changes.some((c) => c === "agent: instruction files not found in the working folder or the folders above it: CLAUDE.md, .filament/instructions.md"));

    // No call: the same prompt, byte for byte.
    const r2 = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "what is 2+2?", stream: false } });
    assert.equal(r2.status, 200);
    await r2.json();
    assert.equal(systems[1], systems[0], "the system prompt holds from the turn that called the skill to the next");
    const rec2 = await shim.record(r2.headers.get("x-filament-request-id"));
    assert.deepEqual(rec2.agent.instructions.triggered, []);
    assert.equal(rec2.agent.instructions.hash, rec.agent.instructions.hash);

    const row = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/instructions`)).json();
    assert.deepEqual(row.files.map((f) => f.file), ["AGENTS.md"]);
    assert.deepEqual(row.missing, ["CLAUDE.md", ".filament/instructions.md"]);
    assert.equal(row.sessionChars, 9);
    assert.deepEqual(row.skills.list.map((s) => s.name), ["greet"]);
    assert.deepEqual(row.skills.on, ["greet"]);
    assert.equal(row.hash, rec2.agent.instructions.hash, "the row is the block every turn sends");
    assert.ok(row.text.startsWith("# Project instructions\n## AGENTS.md"));
  });

  // (fails before: yes — HarnessV4_SpacesPlugins_Plan B4: a skill reached the model only when the developer's message
  // named a trigger; a Claude or Codex skill, written to be picked by its description, never loaded)
  test("the model loads a skill itself: the skill tool is offered where skills are listed, its result is the skill whole with its folder; an unknown name is answered with the names there are", async () => {
    const created = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { skills: { on: [{ name: "greet" }] } } } })).json();
    /** @type {any[]} */
    const results = [];
    brain = (call) => {
      // A call with no tools is Filament's own (a title): not the turn's.
      if (!(call.body.tools || []).length) return reply([{ type: "text", text: "A title" }]);
      const last = call.body.messages.at(-1);
      const got = Array.isArray(last?.content) ? last.content.filter((/** @type {any} */ c) => c.type === "tool_result") : [];
      if (!got.length) {
        const def = call.body.tools.find((/** @type {any} */ t) => t.name === "skill");
        assert.ok(def, "the skill tool is offered");
        assert.equal(def.input_schema.required, undefined, "with no name it finds or lists across every skill");
        return reply([toolUse("s1", "skill", { name: "Greet" }), toolUse("s2", "skill", { name: "deploy" })], "tool_use");
      }
      results.push(...got);
      return reply([{ type: "text", text: "Hello, developer." }]);
    };
    up.reset();
    const r = await shim.api(`/api/sessions/${encodeURIComponent(created.id)}/turns`, { method: "POST", body: { content: "say something nice", stream: false } });
    assert.equal(r.status, 200);
    assert.equal(text((await r.json()).content), "Hello, developer.");
    const body = (/** @type {any} */ c) => (Array.isArray(c.content) ? c.content.map((x) => x.text).join("") : String(c.content));
    assert.equal(body(results[0]), `Skill: greet — Greet the developer by name\nIts folder: ${join(root, "skills", "greet")} — the files it names are there: read them with your own tools, or list, read and find in them with this tool.\n\nSay hello using the developer's name from git config.`);
    assert.notEqual(results[0].is_error, true);
    assert.equal(results[1].is_error, true);
    assert.match(body(results[1]), /There is no skill or plugin "deploy"\. The skills are: greet\./);
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.ok(rec.changes.includes("agent: the skill greet loaded (53 chars)"), rec.changes.join("\n"));
  });

  // (fails before: yes — the Hunter on B4: a fork keeps the main agent's tools, the skill tool among them, and its call
  // was answered from no skills at all: "There is no skill "greet". No skill is listed here.")
  test("a fork loads a skill as the main agent would: its call is answered from the same skills", async () => {
    const created = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { skills: { on: [{ name: "greet" }] } } } })).json();
    /** @type {any[]} */
    const forkResults = [];
    brain = (call) => {
      if (!(call.body.tools || []).length) return reply([{ type: "text", text: "A title" }]);
      const msgs = call.body.messages || [];
      const last = msgs.at(-1);
      const got = Array.isArray(last?.content) ? last.content.filter((/** @type {any} */ c) => c.type === "tool_result") : [];
      if (JSON.stringify(msgs).includes("from here on you are a sub-agent")) {
        // Its first request answers the call that launched it; then its own skill call's result.
        const own = got.filter((/** @type {any} */ c) => c.tool_use_id === "k1");
        if (!own.length) return reply([toolUse("k1", "skill", { name: "greet" })], "tool_use");
        forkResults.push(...own);
        return reply([{ type: "text", text: "FORK REPORT" }]);
      }
      if (got.length) return reply([{ type: "text", text: "PARENT DONE" }]);
      return reply([toolUse("f1", "agent", { run_in_background: false, description: "Forked look", prompt: "Look again.", context: "fork" })], "tool_use");
    };
    up.reset();
    const r = await shim.api(`/api/sessions/${encodeURIComponent(created.id)}/turns`, { method: "POST", body: { content: "look at it twice", stream: false } });
    assert.equal(r.status, 200);
    await r.json();
    await until(() => forkResults.length > 0, "the fork's skill call answered");
    const body = (/** @type {any} */ c) => (Array.isArray(c.content) ? c.content.map((x) => x.text).join("") : String(c.content));
    assert.notEqual(forkResults[0].is_error, true, body(forkResults[0]));
    assert.match(body(forkResults[0]), /^Skill: greet — Greet the developer by name\n/);
  });

  test("a session with no instructions and skills off adds nothing to the prompt and says nothing on the record", async () => {
    const dir = join(root, "empty");
    mkdirSync(dir, { recursive: true });
    const created = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: dir, model: "agent/brain-model", preset: "plain" } })).json();
    let system = "";
    brain = (call) => {
      system = Array.isArray(call.body.system) ? call.body.system.map((b) => b.text).join("") : String(call.body.system || "");
      return reply([{ type: "text", text: "ok" }]);
    };
    up.reset();
    const r = await shim.api(`/api/sessions/${encodeURIComponent(created.id)}/turns`, { method: "POST", body: { content: "hi", stream: false } });
    assert.equal(r.status, 200);
    await r.json();
    assert.ok(!system.includes("# Project instructions") && !system.includes("# Skills"));
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.equal(rec.agent.instructions, undefined);
    assert.ok(rec.changes.some((c) => /instruction files not found/.test(c)), "the default file list is looked for and said to be missing");
    // The running app may still hold the chat's folder a moment (EPERM under the full suite's load): removed once it lets go.
    await removeDirs(dir);
  });

  // (fails before: yes — the agent that read src/ui/app.js was told nothing of src/ui/AGENTS.md)
  test("the loop tells a folder's file with the round's results as the agent reads there, once; the record names it", async () => {
    mkdirSync(join(root, "pkg", "ui"), { recursive: true });
    writeFileSync(join(root, "pkg", "ui", "AGENTS.md"), "Use the ui kit.\n");
    writeFileSync(join(root, "pkg", "ui", "app.js"), "export const app = 1;\n");
    writeFileSync(join(root, "pkg", "ui", "b.js"), "export const b = 2;\n");
    const created = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } })).json();
    const head = folderNoteHead("pkg/ui/AGENTS.md");
    /** @type {string[]} */
    const seen = [];
    brain = (call) => {
      if (!(call.body.tools || []).length) return reply([{ type: "text", text: "A title" }]);
      const wire = JSON.stringify(call.body.messages);
      seen.push(wire);
      const n = seen.length;
      if (n === 1) return reply([toolUse("r1", "read", { path: "pkg/ui/app.js" })], "tool_use");
      if (n === 2) return reply([toolUse("r2", "read", { path: "pkg/ui/b.js" })], "tool_use");
      return reply([{ type: "text", text: "Read both." }]);
    };
    up.reset();
    const r = await shim.api(`/api/sessions/${encodeURIComponent(created.id)}/turns`, { method: "POST", body: { content: "read the ui", stream: false } });
    assert.equal(r.status, 200);
    assert.equal(text((await r.json()).content), "Read both.");
    const count = (/** @type {string} */ w) => w.split(JSON.stringify(head).slice(1, -1)).length - 1;
    assert.equal(count(seen[0]), 0, "nothing before the agent works there");
    assert.equal(count(seen[1]), 1, "told with the first read's result");
    assert.match(seen[1], /Told as you read pkg\/ui\/app\.js: these hold for your work in pkg\/ui/);
    assert.match(seen[1], /Use the ui kit\./);
    assert.equal(count(seen[2]), 1, "not again while the conversation holds it");
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.deepEqual(rec.agent.instructions.told, [{ file: "pkg/ui/AGENTS.md", as: "pkg/ui/app.js", how: "read" }]);
    assert.ok(rec.changes.includes("agent: pkg/ui/AGENTS.md (as it read pkg/ui/app.js) told at the round boundary"), rec.changes.join("\n"));
    // Where the agent works now is asked of git in the folder it read in (now-in.js), a git the turn does not wait for.
    await removeDirs(join(root, "pkg"));
  });
});
