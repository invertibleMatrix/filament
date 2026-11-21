// @ts-check
// HarnessV4_Skills_Plan, the Designer's caution: a skill's own name loads it whole only typed as /<name> — a skill named
// "ui" found on this computer no longer rides whole on "fix the UI". And no word of the person's loads one (the memory
// upgrade's a4, the owner's rule that no code keys on the person's words): the trigger words a SKILL.md names ride on
// its line of # Skills, and the model, reading them, loads the skill the request needs.
// (fails before: the bare name, as a whole word, loaded the skill; then a trigger word did)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkillFile, triggeredSkills, skillLines, skillAnswer, calledNotes } from "../src/app/agent/skills.js";
import { loopSystem } from "../src/app/agent/system.js";

// (fails before: a description written as YAML's folded or literal block — `description: >` — was read as ">", and
// every agent was told the skill is for ">")
test("front matter: a folded block joins its lines, a literal one keeps them, up to the next key", () => {
  const folded = parseSkillFile("---\nname: tmp\ndescription: >\n  Covers TextMeshPro font stacks,\n  dynamic atlases.\n\n  Use for TMP.\ntriggers: [tmp]\n---\nBody.");
  assert.deepEqual(folded.meta, { name: "tmp", description: "Covers TextMeshPro font stacks, dynamic atlases.\nUse for TMP.", triggers: ["tmp"] });
  assert.equal(parseSkillFile("---\ndescription: >-\n  Imports a chat\n  and writes a digest.\n---\nx").meta.description, "Imports a chat and writes a digest.");
  assert.equal(parseSkillFile("---\ndescription: |\n  line one\n  line two\nname: lit\n---\nx").meta.description, "line one\nline two");
  assert.deepEqual(parseSkillFile("---\ntriggers:\n  - one\n  - two\n---\nbody").meta.triggers, ["one", "two"], "a list under a key stays a list");
  // (fails before: a double-quoted description kept its escapes — `\"your own browser\"`)
  assert.equal(parseSkillFile('---\ndescription: "the pane, or \\"your own browser\\", a \\\\ path"\n---\nx').meta.description, 'the pane, or "your own browser", a \\ path');
  assert.equal(parseSkillFile("---\ndescription: 'it''s here'\n---\nx").meta.description, "it's here");
});

/** @param {string} name @param {string[]} [triggers] @param {string} [plugin] */
const skill = (name, triggers = [], plugin = "") => ({ name, description: "", triggers, path: `/s/${name}/SKILL.md`, folder: "/s", body: "b", chars: 1, plugin, kind: /** @type {const} */ ("skill") });

test("a skill is called only as /name or $name: neither its bare name nor its trigger words call it", () => {
  const skills = [skill("ui"), skill("deploy", ["ship it", "release"]), skill("superpowers:plan", [], "superpowers")];
  const hits = (/** @type {string} */ m) => triggeredSkills(skills, m).map((s) => s.name);
  assert.deepEqual(hits("fix the UI"), [], "the bare name is a word of the request, not a call");
  assert.deepEqual(hits("deploy the build"), []);
  assert.deepEqual(hits("ship it today"), [], "a trigger word is a word of the request too");
  assert.deepEqual(hits("cut the Release"), []);
  assert.deepEqual(hits("/ui fix the header"), ["ui"]);
  assert.deepEqual(hits("please /UI, then ship it"), ["ui"]);
  assert.deepEqual(hits("run /deploy."), ["deploy"]);
  assert.deepEqual(hits("$deploy, then ship it"), ["deploy"]);
  assert.deepEqual(hits("a/ui path"), [], "a slash inside a word is not a call");
  assert.deepEqual(hits("/uikit"), [], "the whole name, not its start");
  assert.deepEqual(hits("/superpowers:plan the work"), ["superpowers:plan"]);
  assert.deepEqual(hits("superpowers:plan"), []);
  assert.deepEqual(hits("use /ui: the header first"), ["ui"], "a colon that ends the call");
  assert.deepEqual(hits("(then /ui)"), ["ui"]);
});

// (fails before: yes — Hunter's find: a path's segment or a file's stem was read as a call, so a skill named "ui" rode
// whole on "./ui/button" or "/ui/harness.html", one named "app" on "/app.js")
test("a path calls no skill: /name is a word of its own, and a dotted name is called whole", () => {
  const skills = [skill("ui"), skill("library"), skill("app"), skill("readme"), skill("foo"), skill("foo.bar")];
  const hits = (/** @type {string} */ m) => triggeredSkills(skills, m).map((s) => s.name);
  for (const path of ["open /ui/harness.html", "import it from \"./ui/button\"", "cd ../ui", "H:/ui", "C:/ui/foo", "</ui>", "[link](/ui)", "#/library/skills", "see /app.js", "edit /README.md", "src/ui"])
    assert.deepEqual(hits(path), [], path);
  assert.deepEqual(hits("/foo.bar now"), ["foo.bar"], "the dotted name whole, not its stem");
  assert.deepEqual(hits("/foo. Then more"), ["foo"], "a sentence's full stop ends the call");
});

// (fails before: yes — the triggers were not listed, the skill rode whole on one of them instead)
test("a skill's triggers ride on its line, in # Skills and the skill tool's list, for the model to choose it by", () => {
  const deploy = { ...skill("deploy", ["deploy", "ship it"]), description: "Ship a release to the store. Then tag it." };
  const plain = { ...skill("review"), description: "Review a diff." };
  const bare = skill("notes", ["changelog"]);
  assert.deepEqual(skillLines([plain, deploy, bare]), ["- deploy — Ship a release to the store. (triggers: deploy, ship it)", "- notes (triggers: changelog)", "- review — Review a diff."]);
  const many = { ...skill("many", Array.from({ length: 32 }, (_, i) => `the trigger numbered ${i}`)), description: "Many triggers." };
  const [line] = skillLines([many]);
  assert.ok(line.startsWith("- many — Many triggers. (triggers: the trigger numbered 0, the trigger numbered 1, "), line);
  assert.ok(line.endsWith("…)") && line.length < 200, `a long list is cut, the budget kept for the other skills: ${line.length}`);
  const list = skillAnswer([plain, deploy], { action: "list" });
  assert.equal(list.text, "The skills on here — load one by its name:\n- deploy — Ship a release to the store. (triggers: deploy, ship it)\n- review — Review a diff.");
});

// (fails before: yes — "please ship it today" put deploy's whole procedure in the system prompt)
test("the loop's system prompt holds no skill's body: a trigger word calls none; $name and /name call it onto the message", () => {
  const root = mkdtempSync(join(tmpdir(), "filament-skills-trigger-"));
  try {
    mkdirSync(join(root, "deploy"), { recursive: true });
    const path = join(root, "deploy", "SKILL.md");
    writeFileSync(path, "---\nname: deploy\ndescription: Ship a release\ntriggers: [deploy, ship it]\n---\nRun the release script.");
    const doc = { skills: { yours: [{ name: "deploy", path }] } };
    const said = loopSystem({ cfg: { agentLoop: {} }, doc, root });
    assert.ok(said.text.includes("\n- deploy — Ship a release (triggers: deploy, ship it)"), "listed with its triggers");
    assert.ok(!said.text.includes("Run the release script."), "no body in the prompt, whatever the message");
    for (const message of ["please ship it today", "deploy the build", "Ship It"]) assert.deepEqual(calledNotes(said.skillSet, message), [], message);
    for (const message of ["$deploy now", "/deploy now", "please /DEPLOY."]) {
      const called = calledNotes(said.skillSet, message);
      assert.deepEqual(called.map((c) => c.skill.name), ["deploy"], message);
      assert.ok(called[0].text.endsWith("\n\nRun the release script.\n</filament-context>"), `whole on "${message}"`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
