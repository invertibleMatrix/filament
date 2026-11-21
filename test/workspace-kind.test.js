// @ts-check
// Where a sub-agent works (the owner's plan of 11-09 for big repos): the launch rules, the first that matches winning,
// and the chat's setting as the older switch said it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BRIEF_PATHS, MOVED_LAUNCHES, MOVED_WITHIN, copyKind, launchPaths, workspaceKind, workspaceSetting } from "../src/app/agent/workspace-kind.js";
import { parseSubagentCommand } from "../src/app/commands/parse.js";

/** A builder on Filament's loop, in a repository, with the chat's Auto. @type {import("../src/app/agent/workspace-kind.js").WorkspaceAsk} */
const builder = { may: "edit", setting: "auto", engine: "loop" };
/** @param {Partial<import("../src/app/agent/workspace-kind.js").WorkspaceAsk>} over */
const kindOf = (over) => {
  const k = workspaceKind({ ...builder, ...over });
  return `${k.kind} (${k.rule})`;
};

// (fails before: yes — every builder that changes files took a worktree, whatever its project's size)
test("the rules, the first that matches winning", () => {
  assert.equal(kindOf({}), "patch (11)", "a builder on Filament's loop gets a patch");
  assert.equal(kindOf({ may: "read", engine: "acp", setting: "worktree" }), "none (1)", "one that only reads has none, whatever else");
  assert.equal(kindOf({ inFolder: true, engine: "acp" }), "folder (2)", "the launch's or the developer's folder");
  assert.equal(kindOf({ setting: "folder" }), "folder (2)", "the chat's Session folder");
  assert.equal(kindOf({ setting: "folder", may: "copy" }), "worktree (6)", "never for one that runs in a copy: only the developer's launch gives it the folder");
  assert.equal(kindOf({ noRepo: true, engine: "acp" }), "folder (3)", "no repository, or none with a commit");
  assert.equal(kindOf({ engine: "acp", setting: "patch" }), "worktree (5)", "a coding agent, whatever the setting");
  assert.equal(kindOf({ setting: "patch", may: "copy", checked: true, attempt: true, hooks: true }), "patch (4)", "the chat's Patch over the rest");
  assert.equal(kindOf({ setting: "worktree" }), "worktree (4)");
  assert.equal(kindOf({ may: "copy" }), "worktree (6)");
  assert.equal(kindOf({ checked: true }), "worktree (7)");
  assert.equal(kindOf({ attempt: true }), "worktree (8)");
  assert.equal(kindOf({ hooks: true }), "worktree (9)");
});

// (fails before: yes — a builder whose session runs MCP servers on this computer got a patch, whose move to a worktree
// renames its folder aside: on Windows the servers started in it hold it, so its first command could never run)
test("MCP servers on this computer start in its folder at its first step: a worktree from the start, whatever the setting", () => {
  assert.equal(kindOf({ localMcp: true }), "worktree (5)");
  assert.equal(kindOf({ localMcp: true, setting: "patch" }), "worktree (5)", "the chat's Patch could never move");
  assert.equal(kindOf({ localMcp: true, setting: "folder" }), "folder (2)", "the folder needs no move");
  assert.equal(kindOf({ localMcp: true, may: "read" }), "none (1)");
  assert.equal(kindOf({ localMcp: false }), "patch (11)");
});

test(`a card whose last ${MOVED_LAUNCHES} launches here each moved within ${MOVED_WITHIN} calls starts in a worktree`, () => {
  const soon = Array(MOVED_LAUNCHES).fill(MOVED_WITHIN);
  assert.equal(kindOf({ moves: soon }), "worktree (10)");
  assert.equal(kindOf({ moves: [null, ...soon] }), "worktree (10)", "the newest ones count");
  assert.equal(kindOf({ moves: [...soon.slice(1), null] }), "patch (11)", "one that never moved");
  assert.equal(kindOf({ moves: [...soon.slice(1), MOVED_WITHIN + 1] }), "patch (11)", "one that moved later");
  assert.equal(kindOf({ moves: soon.slice(1) }), "patch (11)", "too few launches yet");
});

test("the chat's setting: workspace where it names one, else the older worktree switch — off the folder, on or unsaid Auto", () => {
  assert.deepEqual(
    [{}, { worktree: true }, { worktree: false }, { workspace: "patch", worktree: false }, { workspace: "worktree" }, { workspace: "folder" }, { workspace: "nonsense", worktree: false }, null].map((s) => workspaceSetting(s)),
    ["auto", "auto", "folder", "patch", "worktree", "folder", "folder", "auto"],
  );
});

/** A builder's copy on Auto, in a repository nothing makes big, on a drive that copies. @type {import("../src/app/agent/workspace-kind.js").CopyAsk} */
const plainCopy = { setting: "auto", may: "edit", big: null, cow: false, caches: [] };
/** @param {Partial<import("../src/app/agent/workspace-kind.js").CopyAsk>} over */
const copyOf = (over) => copyKind({ ...plainCopy, ...over }).kind;

// (fails before: yes — nothing chose a sparse copy or a clone: every builder's worktree checked every file out)
test("the copy's kind: the chat's Worktree whole; a clone where the drive clones and git ignores build caches, ahead of sparse; sparse for a builder in a big repository", () => {
  const all = { big: /** @type {const} */ ("lfs"), cow: true, caches: ["Library"] };
  assert.equal(copyOf({ setting: "worktree", ...all }), "worktree", "the person's Worktree is a full one, whatever the repository");
  assert.equal(copyOf(all), "clone", "both apply: the clone, whole and warm");
  assert.equal(copyOf({ ...all, setting: "patch" }), "clone", "a patch's move is Auto's to choose");
  assert.equal(copyOf({ may: "copy", cow: true, caches: ["Library"] }), "clone", "one that runs in a copy takes a clone too");
  assert.equal(copyOf({ cow: true, caches: [], big: "entries" }), "sparse", "nothing warm to keep: no clone");
  assert.equal(copyOf({ cow: false, caches: ["Library"], big: "slow" }), "sparse", "a drive that copies makes no clone");
  assert.equal(copyOf({ setting: "patch", big: "lfs" }), "sparse");
  assert.equal(copyOf({ may: "copy", big: "lfs" }), "worktree", "one that runs in a copy runs the project: never sparse");
  assert.equal(copyOf({}), "worktree");
  assert.match(copyKind({ ...plainCopy, ...all }).why, /Library/, "the why names what comes warm");
});

// (fails before: yes — the same: a launch named no paths for a copy's cone)
test("the paths a launch names: a task's writes — a glob by the folder ahead of its pattern —, its brief's files, and the paths its brief's words name", () => {
  assert.deepEqual(launchPaths({ writes: ["src/a/x.js", "lib/**/*.ts", "**/*.md", "docs/", "pkg/b/[ab].js"] }), ["src/a/x.js", "lib", "docs", "pkg/b"]);
  assert.deepEqual(launchPaths({ files: ["pkg/b/index.js", "not a path", ""] }), ["pkg/b/index.js"]);
  assert.deepEqual(
    launchPaths({ brief: "Fix `src/app/agent/loop.js:2030` (see https://example.com/a/b and ./tools/e/run.js), then lib/c. Leave --out=x/y and README.md, and src/app/agent/loop.js#L12 again." }),
    ["src/app/agent/loop.js", "tools/e/run.js", "lib/c"],
  );
  assert.deepEqual(launchPaths({ writes: ["a/b.js"], brief: "a/b.js and c/d" }), ["a/b.js", "c/d"], "each once");
  const many = Array.from({ length: BRIEF_PATHS + 5 }, (_, i) => `f${i}/x.js`).join(" ");
  assert.equal(launchPaths({ brief: many }).length, BRIEF_PATHS, "a brief's words name so many at most");
  assert.deepEqual(launchPaths({}), []);
});

// (fails before: yes — workspace= was no option: it was read as the task's first word)
test("/subagent workspace= names where it works, one of the four; another word is not understood", () => {
  const c = /** @type {any} */ (parseSubagentCommand("/subagent workspace=Patch worktree=on fix the flag"));
  assert.deepEqual([c.action, c.workspace, c.worktree, c.prompt], ["launch", "patch", true, "fix the flag"]);
  assert.equal(/** @type {any} */ (parseSubagentCommand("/subagent fix it")).workspace, null, "left out: the session's choice");
  const no = /** @type {any} */ (parseSubagentCommand("/subagent workspace=sparse fix it"));
  assert.deepEqual([no.action, no.arg], ["unknown", "workspace=sparse (workspace= takes auto, patch, worktree, folder)"]);
});
