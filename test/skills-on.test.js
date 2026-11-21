// @ts-check
// HarnessV4_Skills_Plan S1-6 — a skill on per place: `skills.on` adds up by name across your defaults, a Space of your
// own that shows the project, the project and the chat, as `plugins.on` does; a narrower layer turns one off. The
// skill store then hands the document the files of those on, and the loader names them.
// (fails before: there was one switch, skills.enabled, and a list of folders; no skill was on at a place)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KNOBS, SPACE_KNOBS, mergeSkillsOn, resolveSettings, skillOnProblem, validateLayer } from "../src/services/session-settings.js";
import { createSkillStore } from "../src/app/skill-store.js";
import { loadSkills } from "../src/app/agent/skills.js";

test("mergeSkillsOn: by name without case, broadest first; enabled false turns one off, a later entry back on", () => {
  assert.deepEqual(mergeSkillsOn([[{ name: "pdf" }, { name: "books" }], [{ name: "PDF", enabled: false }], [{ name: "books", enabled: true }]]), [{ name: "books" }]);
  assert.deepEqual(mergeSkillsOn([[{ name: "pdf" }], [{ name: "pdf", enabled: false }], [{ name: "Pdf", enabled: true }]]), [{ name: "pdf" }], "the broadest layer's spelling stays");
  assert.deepEqual(mergeSkillsOn([[{ name: "pdf" }], [{ name: "pdf", enabled: false }], [{ name: "pdf" }]]), [], "an entry that only names it keeps what is beneath, as plugins.on's does");
  assert.deepEqual(mergeSkillsOn([[{ name: "a:b" }, "x", null, { name: "ok", enabled: "yes" }]]), [], "an entry it refuses is skipped");
  assert.equal(skillOnProblem({ name: "linear:triage" }), "needs the skill's name, as Library › Skills gives it");
  assert.deepEqual(validateLayer({ skills: { on: [{ name: "pdf" }, { name: "PDF", enabled: false }] } }).errors, ['"skills.on" names the skill pdf twice']);
  assert.ok(!("skills.enabled" in KNOBS) && !("skills.folders" in KNOBS), "the master switch and the folder list are gone");
  assert.ok(SPACE_KNOBS.includes("skills.on"), "a Space of your own passes its skills to the projects it shows");
});

test("resolved through the layers: on for all chats, off in a project, back on in a chat; a Space's reach its projects", () => {
  const global = { skills: { on: [{ name: "pdf" }, { name: "books" }] } };
  const project = { skills: { on: [{ name: "pdf", enabled: false }] } };
  const space = { skills: { on: [{ name: "linear-notes" }] } };
  const at = (/** @type {any} */ layers) => resolveSettings(layers).effective.skills.on.map((/** @type {any} */ s) => s.name);
  assert.deepEqual(at({ global }), ["pdf", "books"]);
  assert.deepEqual(at({ global, space, project }), ["books", "linear-notes"]);
  assert.deepEqual(at({ global, space, project, session: { skills: { on: [{ name: "pdf", enabled: true }] } } }), ["pdf", "books", "linear-notes"]);
  assert.deepEqual(resolveSettings({}).effective.skills.on, []);
});

test("the store hands the loader the files of those on; a skill on that is gone is said", () => {
  const root = mkdtempSync(join(tmpdir(), "skills-on-"));
  mkdirSync(join(root, "mine", "books"), { recursive: true });
  writeFileSync(join(root, "mine", "books", "SKILL.md"), "---\nname: books\ndescription: What the books say\ntriggers: [chapter]\n---\nLook in references/.");
  const store = createSkillStore({ dataDir: join(root, "data"), home: join(root, "home"), env: {} });
  store.addPaths({ paths: [join(root, "mine", "books")] });
  const eff = resolveSettings({ global: { skills: { on: [{ name: "books" }, { name: "gone" }] } } }).effective;
  const set = loadSkills(store.into(eff));
  assert.deepEqual(set.skills.map((s) => [s.name, s.description, s.triggers, s.plugin]), [["books", "What the books say", ["chapter"], ""]]);
  assert.deepEqual(set.problems, ["the skill gone is on here but is not in Library › Skills, or its folder is gone"]);
  assert.deepEqual(loadSkills(store.into(resolveSettings({}).effective)).skills, [], "none on: none offered, whatever the Library holds");
  rmSync(root, { recursive: true, force: true });
});
