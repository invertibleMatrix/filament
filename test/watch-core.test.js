// @ts-check
// HarnessV4_Tasks E15 step 7, what a turn's log shows (core/watch.js): the signs Filament sees in it by itself — the
// same command failed a third time, a step that cannot be undone, "verified" said where no command ran after the
// newest change — rules over the log, which a lead's look at its workers names. The agent that watched a turn and gave
// a verdict went on the owner's word of 11-05.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { WATCH_SIGNS, newWatchState, uncheckedAt, watchStep } from "../src/core/watch.js";
import { oneWayOf } from "../src/core/signs.js";

/** A run's events, numbered. @param {any[]} list */
const numbered = (list) => list.map((e, i) => ({ n: i + 1, ...e }));
/** Every sign a run's events show, and the state they leave. @param {any[]} events */
const read = (events) => {
  const state = newWatchState();
  const signs = numbered(events).flatMap((e) => watchStep(state, e));
  return { state, signs };
};
/** A command's start and its end. @param {string} id @param {string} command @param {object} [end] */
const shell = (id, command, end = { exitCode: 0 }) => [
  { type: "tool-start", id, name: "bash", args: command },
  { type: "tool-end", id, ...end },
];
/** A write's start. @param {string} path */
const wrote = (path) => ({ type: "tool-start", id: `w-${path}`, name: "edit", card: { kind: "edit", subject: path } });

// (fails before: yes — step 7: Filament read no sign off a main turn's log; the trail's signs were a worker's alone)
describe("the signs Filament sees in a turn's log (design case 5)", () => {
  test("the same command failing a third time is a sign once, at the third", () => {
    const { signs, state } = read([...shell("a", "npm test", { exitCode: 1 }), ...shell("b", "npm test", { exitCode: 1 }), ...shell("c", "npm test", { exitCode: 1 }), ...shell("d", "npm test", { exitCode: 1 })]);
    assert.deepEqual(signs.map((s) => [s.kind, s.at, s.words]), [["failing", 6, "the same command failed a third time (`npm test`)"]], "the fourth failure is the same sign: said once");
    assert.equal(state.tools, 4);
  });

  test("a step that cannot be undone is named by its shape, the first time that command runs", () => {
    for (const [command, what] of /** @type {[string, string][]} */ ([
      ["git push origin main", "a push"],
      ["git reset --hard HEAD~1", "a hard reset"],
      ["git clean -fd", "a clean of untracked files"],
      ["git checkout -- src/a.js", "changes discarded"],
      ["rm -rf build", "a recursive delete"],
      ["Remove-Item .\\out -Recurse -Force", "a recursive delete"],
      ["psql -c 'DROP TABLE users'", "a table or database dropped"],
      ["npm publish", "a publish"],
      ["gh pr merge 12", "a release, merge or deletion on GitHub"],
      ["terraform apply -auto-approve", "a change to live infrastructure"],
    ])) assert.equal(oneWayOf(command), what, command);
    for (const command of ["git status", "git checkout main", "git stash", "rm notes.txt", "npm test", "git branch -d old", ""]) assert.equal(oneWayOf(command), null, command);
    const { signs } = read([...shell("a", "git push"), ...shell("b", "git push"), ...shell("c", "rm -rf dist")]);
    assert.deepEqual(signs.map((s) => [s.kind, s.at, s.words]), [
      ["one-way", 1, "ran a step that cannot be undone: a push (`git push`)"],
      ["one-way", 5, "ran a step that cannot be undone: a recursive delete (`rm -rf dist`)"],
    ]);
  });

  test("\"verified\" with no check run: the report says the work was checked, and no command ran to its end after the newest change", () => {
    const changed = read([...shell("a", "npm test"), wrote("src/a.js")]);
    assert.deepEqual(uncheckedAt(changed.state, "Fixed the parser and verified it."), { kind: "unchecked", at: 0, words: 'says "verified", and no command ran to its end after its last change (src/a.js)' });
    assert.deepEqual([...changed.state.wrote], ["src/a.js"]);
    const checked = read([wrote("src/a.js"), ...shell("a", "npm test", { exitCode: 1 })]);
    assert.equal(uncheckedAt(checked.state, "All tests pass."), null, "a command ran after the change — whether it passed is the watcher's to read");
    const nothing = read([{ type: "tool-start", id: "r", name: "read", args: "src/a.js" }]);
    assert.equal(uncheckedAt(nothing.state, "Tests pass now.")?.words, 'says "Tests pass", and no command ran to its end in the turn');
    // A command refused, declined, never run or cut by a stop checked nothing.
    for (const end of [{ refused: true }, { declined: true }, { notRun: true }, { stopped: true, exitCode: 1 }]) {
      const cut = read([wrote("src/a.js"), ...shell("a", "npm test", end)]);
      assert.equal(uncheckedAt(cut.state, "Verified.")?.kind, "unchecked", JSON.stringify(end));
    }
    // A report that denies the claim, or makes none, shows no sign.
    for (const report of ["Not verified: I could not run the tests.", "This is unverified.", "I haven't tested it.", "Changed the parser.", ""]) assert.equal(uncheckedAt(changed.state, report), null, report);
    // With no report given, its newest words stand for it.
    const said = read([wrote("src/a.js"), { type: "round-text", text: "Done, and tested." }]);
    assert.equal(uncheckedAt(said.state)?.words, 'says "tested", and no command ran to its end after its last change (src/a.js)');
  });

  test("what is no event, and a call that is neither a write nor a command, shows nothing", () => {
    const state = newWatchState();
    assert.deepEqual([watchStep(state, null), watchStep(state, "x"), watchStep(state, { type: "tool-start", id: "r", name: "grep", args: "git push" })], [[], [], []]);
    assert.equal(state.tools, 1, "a search for the words `git push` runs nothing");
  });
});
