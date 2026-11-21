// @ts-check
// Every agent turn of every chat lists the skills on at its place (skills.js `loadSkills`), and read each one's file
// anew: a stat, an open, a read of its first bytes and its front matter parsed, per skill per turn. A skill's file is
// read again only once its size or time moved — an edit is seen on the next turn — and otherwise its reading stands.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "../src/app/agent/skills.js";

const dir = mkdtempSync(join(tmpdir(), "skills-once-"));
after(() => rmSync(dir, { recursive: true, force: true }));
/** A SKILL.md in its own folder. @param {string} name @param {string} description */
const skill = (name, description) => {
  const folder = join(dir, name);
  mkdirSync(folder, { recursive: true });
  const path = join(folder, "SKILL.md");
  writeFileSync(path, `---\nname: ${name}\ndescription: ${description}\ntriggers: [${name} it]\n---\n\nHow to ${name}: step one.\n`);
  return path;
};

/** How many files `fn` opened. @template T @param {() => T} fn @returns {{ value: T, opened: number }} */
const opening = (fn) => {
  const real = fs.openSync;
  let opened = 0;
  fs.openSync = /** @type {any} */ ((/** @type {any[]} */ ...a) => (opened++, real(.../** @type {[any, any]} */ (a))));
  syncBuiltinESMExports();
  try {
    return { value: fn(), opened };
  } finally {
    fs.openSync = real;
    syncBuiltinESMExports();
  }
};

// (fails before: yes — each listing opened and read every skill's file again)
test("a skill's file is read once while it stays as it was; an edit is read on the next listing", () => {
  const paths = ["deploy", "review", "release"].map((n) => skill(n, `the ${n} procedure`));
  const doc = { skills: { yours: paths.map((path, i) => ({ name: ["deploy", "review", "release"][i], path })), plugins: [{ plugin: "kit", path: skill("lint", "lint the code") }] } };
  const first = opening(() => loadSkills(doc));
  assert.equal(first.opened, 4, "each read once");
  assert.deepEqual(first.value.skills.map((s) => [s.name, s.description, s.triggers]), [
    ["deploy", "the deploy procedure", ["deploy it"]],
    ["review", "the review procedure", ["review it"]],
    ["release", "the release procedure", ["release it"]],
    ["kit:lint", "lint the code", []],
  ]);
  assert.match(first.value.skills[0].body, /^How to deploy: step one\.$/);
  const again = opening(() => loadSkills(doc));
  assert.equal(again.opened, 0, "nothing opened again");
  assert.deepEqual(again.value.skills.map((s) => [s.name, s.description, s.body]), first.value.skills.map((s) => [s.name, s.description, s.body]));
  // The developer edits one: the next listing reads it, the rest stand.
  writeFileSync(paths[1], "---\nname: review\ndescription: review the change, twice\n---\n\nHow to review: read it twice.\n");
  utimesSync(paths[1], new Date(), new Date(Date.now() + 5000));
  const edited = opening(() => loadSkills(doc));
  assert.equal(edited.opened, 1);
  assert.equal(edited.value.skills[1].description, "review the change, twice");
  assert.match(edited.value.skills[1].body, /read it twice/);
  // One named otherwise, in another plugin, is its own reading.
  const other = loadSkills({ skills: { plugins: [{ plugin: "other", path: paths[0] }] } });
  assert.equal(other.skills[0].name, "other:deploy");
  // One gone is a problem said, as before.
  rmSync(paths[2]);
  const gone = loadSkills(doc);
  assert.deepEqual(gone.skills.map((s) => s.name), ["deploy", "review", "kit:lint"]);
  assert.deepEqual(gone.problems, [`skill not readable: ${paths[2]}`]);
});
