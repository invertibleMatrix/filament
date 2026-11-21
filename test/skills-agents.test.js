// @ts-check
// Skills for every agent (HarnessV4_Skills_Plan S1-3, S1-5): Filament offers a coding agent the chat's skills less the
// ones its own folders hold, and the skill tool lists, reads and finds in a skill's folder — that folder only.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { agentSkillFolders, skillsForAgent, skillAnswer, loadSkills, SKILL_READ_LINES, SKILL_TOOL } from "../src/app/agent/skills.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { argSummary } from "../src/app/agent/tools.js";

describe("who has which skills", () => {
  // (fails before: yes — no agent's own folders were known: agentSkillFolders did not exist)
  test("each coding agent's own skill folders: its account's folder, else its home's, and the project's", () => {
    const cwd = resolve("/work/app");
    assert.deepEqual(agentSkillFolders({ acp: { command: "claude-agent-acp" } }, cwd), [resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "skills"), join(cwd, ".claude", "skills")]);
    assert.deepEqual(agentSkillFolders({ acp: { command: "claude-agent-acp", home: resolve("/acct/work") } }, cwd)[0], resolve("/acct/work/skills"), "an added account reads its own folder");
    assert.deepEqual(agentSkillFolders({ type: "codex", acp: { command: "codex" } }, cwd), [resolve(process.env.CODEX_HOME || join(homedir(), ".codex"), "skills"), join(homedir(), ".agents", "skills"), join(cwd, ".agents", "skills")]);
    assert.deepEqual(agentSkillFolders({ type: "cursor-sdk" }, cwd), [join(homedir(), ".cursor", "skills"), join(cwd, ".cursor", "skills")]);
    assert.deepEqual(agentSkillFolders({ acp: { command: "gemini" } }, cwd), [], "an agent whose folders Filament doesn't know keeps the whole list");
    assert.deepEqual(agentSkillFolders(null, cwd), []);
  });

  test("the chat's skills less those of the agent's own folders; a plugin goes with its last skill", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-agents-"));
    const skill = (/** @type {string} */ at, /** @type {string} */ name) => {
      mkdirSync(join(root, at, name), { recursive: true });
      writeFileSync(join(root, at, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} things\n---\nDo ${name}.`);
      return join(root, at, name, "SKILL.md");
    };
    const deploy = skill("mine", "deploy");
    const review = skill(".claude/skills", "review");
    const plug = skill("plug/skills", "tdd");
    const doc = { skills: { yours: [{ name: "deploy", path: deploy }, { name: "review", path: review }], plugins: [{ plugin: "superpowers", kind: "skill", path: plug }], pluginsOn: [{ name: "superpowers", title: "Superpowers", description: "", servers: [] }] } };
    const set = loadSkills(doc);
    assert.deepEqual(set.skills.map((s) => s.name), ["deploy", "review", "superpowers:tdd"]);
    const own = agentSkillFolders({ acp: { command: "claude-agent-acp" } }, root);
    const offered = skillsForAgent(set, own);
    assert.deepEqual(offered.skills.map((s) => s.name), ["deploy", "superpowers:tdd"], "Claude Code loads review with its own Skill");
    assert.deepEqual(offered.plugins.map((p) => p.name), ["superpowers"]);
    const none = skillsForAgent(set, [join(root, "plug")]);
    assert.deepEqual([none.skills.map((s) => s.name), none.plugins], [["deploy", "review"], []]);
    if (process.platform === "win32") assert.deepEqual(skillsForAgent(set, [join(root, ".CLAUDE", "Skills")]).skills.map((s) => s.name), ["deploy", "superpowers:tdd"], "Windows names a folder without case");
    assert.deepEqual(skillsForAgent(set, []), set);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("the skill tool in a skill's folder", () => {
  /** @type {string} */
  let root;
  /** @type {any} */
  let set;
  before(() => {
    root = mkdtempSync(join(tmpdir(), "skills-look-"));
    const dir = join(root, "skills", "books");
    mkdirSync(join(dir, "references", "ch1"), { recursive: true });
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: books\ndescription: What the books say\n---\nLook in references/.");
    writeFileSync(join(dir, "references", "INDEX.md"), "# Index\n- ch1/retry.md — Retry and backoff, pages 10-14\n");
    writeFileSync(join(dir, "references", "ch1", "retry.md"), Array.from({ length: 500 }, (_, i) => (i === 449 ? "Use exponential Backoff with jitter on every Retry." : `line ${i + 1}`)).join("\n"));
    writeFileSync(join(dir, "references", "cover.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
    writeFileSync(join(dir, ".git", "HEAD"), "ref: secret backoff");
    writeFileSync(join(root, "outside.md"), "backoff outside");
    mkdirSync(join(root, "plug", "skills", "tdd"), { recursive: true });
    writeFileSync(join(root, "plug", "skills", "tdd", "SKILL.md"), "---\nname: tdd\n---\nRed, green.");
    set = loadSkills({ skills: { yours: [{ name: "books", path: join(dir, "SKILL.md") }], plugins: [{ plugin: "superpowers", kind: "skill", path: join(root, "plug", "skills", "tdd", "SKILL.md") }], pluginsOn: [{ name: "superpowers", title: "Superpowers", description: "", servers: [] }] } });
  });
  after(() => rmSync(root, { recursive: true, force: true }));
  const ask = (/** @type {any} */ input) => skillAnswer(set.skills, input, set.plugins);

  // (fails before: yes — the tool took a name alone and every call loaded the skill)
  test("the tool says its actions; load stays the default and says the folder can be looked in", () => {
    assert.deepEqual(Object.keys(SKILL_TOOL.input_schema.properties), ["name", "action", "path", "from", "words"]);
    const got = ask({ name: "books" });
    assert.ok(got.ok && "skill" in got);
    assert.match(got.text, /list, read and find in them with this tool/);
    assert.deepEqual(ask({ name: "books", action: "dance" }), { ok: false, text: 'There is no action "dance": load, list, read or find.' });
  });

  test("list: the folder's files, breadth first, hidden ones left out; a subfolder by path", () => {
    const got = ask({ name: "books", action: "list" });
    assert.ok(got.ok && "looked" in got);
    const lines = got.text.split("\n");
    assert.match(lines[0], /^The folder of books: /);
    assert.deepEqual(lines.slice(1).map((l) => l.replace(/ \(.*\)$/, "")), ["- references/", "- SKILL.md", "- references/ch1/", "- references/cover.png", "- references/INDEX.md", "- references/ch1/retry.md"]);
    assert.ok(!got.text.includes(".git"));
    assert.deepEqual(ask({ name: "books", action: "list", path: "references/ch1" }).text.split("\n").slice(1).map((l) => l.replace(/ \(.*\)$/, "")), ["- references/ch1/retry.md"]);
  });

  test("read: a page at a time, saying where the next starts; a folder, a picture and a line past the end refused in words", () => {
    const first = ask({ name: "books", action: "read", path: "references/ch1/retry.md" });
    assert.ok(first.ok);
    assert.match(first.text, new RegExp(`^references/ch1/retry\\.md — lines 1–${SKILL_READ_LINES} of 500, from the folder of books\\n\\nline 1\\n`));
    assert.match(first.text, /\n\[100 more lines: read again with from 401\]$/);
    const next = ask({ name: "books", action: "read", path: "references/ch1/retry.md", from: 401 });
    assert.match(next.text, /lines 401–500 of 500/);
    assert.match(next.text, /Use exponential Backoff/);
    assert.doesNotMatch(next.text, /more lines/);
    assert.deepEqual(ask({ name: "books", action: "read", path: "references" }), { ok: false, text: "references is a folder: list it, then read one of its files." });
    assert.match(ask({ name: "books", action: "read", path: "references/cover.png" }).text, /^references\/cover\.png is not text/);
    assert.match(ask({ name: "books", action: "read", path: "references/ch1/retry.md", from: 900 }).text, /has 500 lines; from 900 is past its end/);
    assert.match(ask({ name: "books", action: "read", path: "nope.md" }).text, /has no "nope\.md": list shows what it holds/);
  });

  // (fails before: yes — nothing fenced a path: the tool read no file at all)
  test("only the skill's own folder: a path out of it, by its words or by a link, is refused", () => {
    const refused = /is outside the skill's folder/;
    assert.match(ask({ name: "books", action: "read", path: "../../outside.md" }).text, refused);
    assert.match(ask({ name: "books", action: "read", path: join(root, "outside.md") }).text, refused);
    assert.match(ask({ name: "books", action: "list", path: ".." }).text, refused);
    assert.match(ask({ name: "books", action: "find", words: "backoff", path: "../.." }).text, refused);
    let linked = true;
    try {
      symlinkSync(join(root, "outside.md"), join(root, "skills", "books", "out.md"), "file");
    } catch {
      linked = false; // Windows without the right to make links
    }
    if (linked) assert.match(ask({ name: "books", action: "read", path: "out.md" }).text, refused);
  });

  test("find: the lines that hold every word, any case, with their paths and lines; none said so", () => {
    const got = ask({ name: "books", action: "find", words: "retry BACKOFF" });
    assert.ok(got.ok);
    assert.deepEqual(got.text.split("\n"), [
      'The lines of books\'s files that hold "retry" and "backoff" — read one with action read, its path and from:',
      "references/INDEX.md:2: - ch1/retry.md — Retry and backoff, pages 10-14",
      "references/ch1/retry.md:450: Use exponential Backoff with jitter on every Retry.",
    ]);
    assert.ok(!got.text.includes(".git") && !got.text.includes("outside"));
    assert.equal(ask({ name: "books", action: "find", words: "zebra" }).text, 'No line of books\'s files holds "zebra".');
    assert.deepEqual(ask({ name: "books", action: "find" }), { ok: false, text: "find needs words: the ones a line must hold." });
  });

  test("the timeline names what was looked at: the card and the run's line, an MCP call's alike", () => {
    assert.deepEqual(cardOf("skill", { name: "books", action: "read", path: "references/ch1/retry.md" }), { kind: "other", title: "Read skill file", subject: "books · references/ch1/retry.md" });
    assert.deepEqual(cardOf("mcp__filament__skill", { name: "books", action: "find", words: "backoff" }), { kind: "other", title: "Search skill", subject: "books · backoff" });
    assert.deepEqual(cardOf("skill", { name: "books", action: "list" }), { kind: "other", title: "List skill files", subject: "books" });
    assert.deepEqual(cardOf("skill", { name: "books", action: "load" }), { kind: "other", title: "Load skill", subject: "books" });
    assert.equal(argSummary("skill", { name: "books", action: "find", words: "retry backoff" }), "books find retry backoff");
    assert.equal(argSummary("skill", { name: "books" }), "books");
  });

  test("a plugin's skill is looked in by its full name; the plugin's own name is not a folder", () => {
    assert.match(ask({ name: "superpowers:tdd", action: "read", path: "SKILL.md" }).text, /Red, green\./);
    assert.deepEqual(ask({ name: "superpowers", action: "list" }), { ok: false, text: "superpowers is a plugin: list in the folder of one of its skills, by its full name (superpowers:tdd)." });
  });
});
