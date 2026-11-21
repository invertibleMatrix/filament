// @ts-check
// The briefing's words for where a repository stands (the owner's of 10-29): a commit by its subject's head, a branch
// against its base, and a block that fits its room — small (the memory plan's e1): this folder, its newest commit, the
// other worktrees in one line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STANDING_HEAD, standingBlock, subjectHead } from "../src/services/memory/repo-lines.js";

/** @param {Partial<import("../src/core/repo-standing.js").RepoStanding>} [o] @returns {import("../src/core/repo-standing.js").RepoStanding} */
const standing = (o = {}) => ({
  place: "/w/app-feat",
  main: "/w/app",
  worktree: true,
  branch: "feat",
  head: "aaaaaaa",
  base: "main",
  baseHead: "bbbbbbb",
  onBase: false,
  ahead: 2,
  behind: 1,
  fresh: false,
  uncommitted: { files: 1, added: 3, removed: 2 },
  worktrees: [],
  moreWorktrees: 0,
  own: [
    { short: "aaaaaaa", date: "2026-10-29", subject: "Feat two" },
    { short: "ccccccc", date: "2026-10-28", subject: "Feat one" },
  ],
  commits: [{ short: "bbbbbbb", date: "2026-10-27", subject: "On main" }],
  ...o,
});

// (fails before: yes — the module did not exist)
test("a subject's head: up to its first colon after a few words, else clipped", () => {
  assert.equal(subjectHead("The Start's words are kept with the folder they were typed for: after a reload…"), "The Start's words are kept with the folder they were typed for");
  assert.equal(subjectHead("fix: a short prefix is no head"), "fix: a short prefix is no head");
  assert.equal(subjectHead("version bump"), "version bump");
  assert.ok(subjectHead("x ".repeat(200), 50).length <= 50);
  // (fails before: yes — the live drive of 10-29 cut one inside its quote: `… alone — "Make an app for Northwind's Space`)
  const quoted = `New app's Start says the person's request alone — "Make an app for Northwind's Space: a board" — and no more`;
  assert.equal(subjectHead(quoted), `New app's Start says the person's request alone — "Make an app for Northwind's Space: a board" — and no more`);
  assert.equal(subjectHead("The words “kept as typed: here” stay whole, and the rest: what follows"), "The words “kept as typed: here” stay whole, and the rest");
});

// (fails before: yes — each worktree took a line with its whole path, and the commits a block of their own)
test("a branch against its base: what it has the base lacks, merged, or nothing of its own yet; the others in one line by how each stands", () => {
  const s = standing({
    worktrees: [
      { path: "/w/app", main: true, branch: "main", head: "bbbbbbb", onBase: true, ahead: 0, behind: 0, fresh: false, uncommitted: null, missing: false, unread: null },
      { path: "/w/app-new", main: false, branch: "new", head: "bbbbbbb", onBase: false, ahead: 0, behind: 0, fresh: true, uncommitted: { files: 0, added: 0, removed: 0 }, missing: false, unread: null },
      { path: "/w/app-old", main: false, branch: "old", head: "ddddddd", onBase: false, ahead: null, behind: null, fresh: false, uncommitted: null, missing: true, unread: null },
      { path: "/w/app-far", main: false, branch: "far", head: "eeeeeee", onBase: false, ahead: null, behind: null, fresh: false, uncommitted: null, missing: false, unread: "git did not answer in time" },
      { path: "/w/app-perf", main: false, branch: "perf", head: "fffffff", onBase: false, ahead: 0, behind: 3, fresh: false, uncommitted: { files: 2, added: 10, removed: 1 }, missing: false, unread: null },
      { path: "/w/app-wip", main: false, branch: "wip", head: "1111111", onBase: false, ahead: 3, behind: 0, fresh: false, uncommitted: { files: 1, added: 1, removed: 0 }, missing: false, unread: null },
    ],
    moreWorktrees: 2,
  });
  const b = standingBlock(s, 10_000);
  assert.deepEqual(b.text.split("\n"), [
    STANDING_HEAD,
    "- This folder: /w/app-feat (a worktree of /w/app), on feat @ aaaaaaa — 2 commits main lacks; main has 1 more; main @ bbbbbbb; 1 file uncommitted (+3 −2)",
    "- Other worktrees (git worktree list): on main: app; nothing of its own yet: app-new; its folder gone: app-old; not read: app-far; merged into main: app-perf (2 uncommitted); ahead of main: app-wip (3 commits, 1 uncommitted); 2 more not read",
    "- Newest commit here: 2026-10-29 aaaaaaa Feat two (2 commits main lacks: git log main..HEAD)",
  ]);
  assert.equal(b.lines, 3);
  // (fails before: yes — the review of e1: the worktrees' line came after the newest commit and a row that did not fit
  // ended the block, so where the room was short the line the client's git status cannot give went first)
  const short = standingBlock(s, b.text.length - 20).text.split("\n");
  assert.deepEqual([short.length, short[2].startsWith("- Other worktrees")], [3, true], short.join("\n"));
  const passedOver = standingBlock(s, STANDING_HEAD.length + b.text.split("\n")[1].length + b.text.split("\n")[3].length + 3).text.split("\n");
  assert.deepEqual(passedOver.slice(1).map((l) => l.slice(0, 16)), ["- This folder: /", "- Newest commit "], "the long line passed over, the newest commit after it kept");
  // (fails before: yes — the review of e1: with no base branch every other worktree read "not read")
  const noBase = standingBlock(standing({ base: null, baseHead: null, worktrees: [
    { path: "/w/app", main: true, branch: "dev", head: "bbbbbbb", onBase: false, ahead: null, behind: null, fresh: false, uncommitted: null, missing: false, unread: null },
    { path: "/w/app-x", main: false, branch: null, head: "ccccccc", onBase: false, ahead: null, behind: null, fresh: false, uncommitted: { files: 2, added: 1, removed: 0 }, missing: false, unread: null },
  ] }), 10_000).text.split("\n")[2];
  assert.equal(noBase, "- Other worktrees (git worktree list): on dev: app; detached: app-x (2 uncommitted)");
  const notCompared = standingBlock(standing({ worktrees: [{ path: "/w/app-y", main: false, branch: "y", head: null, onBase: false, ahead: null, behind: null, fresh: false, uncommitted: null, missing: false, unread: null }] }), 10_000).text.split("\n")[2];
  assert.equal(notCompared, "- Other worktrees (git worktree list): not compared with main: app-y");
  const tight = standingBlock(s, STANDING_HEAD.length + 160);
  assert.equal(tight.lines, 1, "the rows that fit, this folder's first");
  assert.equal(standingBlock(s, 20).text, "", "not one fits: no block");
  // (fails before: yes — the live drive of 10-29: the main folder's one untracked file read "1 file uncommitted (+0 −0)")
  const untracked = standingBlock(standing({ uncommitted: { files: 1, added: 0, removed: 0 } }), 10_000).text.split("\n")[1];
  assert.ok(untracked.endsWith("; 1 file uncommitted"), untracked);
});

// (fails before: yes — the commits were a block of their own, up to a fifth of the briefing, which the client's own
// git status repeats)
test("the newest commit points to the rest: the branch's own where it has commits the base lacks, else the base's, else none", () => {
  const line = (/** @type {any} */ o) => standingBlock(standing(o), 10_000).text.split("\n").find((l) => l.startsWith("- Newest commit"));
  assert.equal(line({}), "- Newest commit here: 2026-10-29 aaaaaaa Feat two (2 commits main lacks: git log main..HEAD)");
  assert.equal(line({ branch: "main", onBase: true, ahead: 0, behind: 0, own: [] }), "- Newest commit on main: 2026-10-27 bbbbbbb On main (git log main for the rest)");
  assert.equal(line({ base: null, baseHead: null, own: [] }), "- Newest commit on feat: 2026-10-27 bbbbbbb On main (git log feat for the rest)");
  assert.equal(standingBlock(standing({ own: [], commits: [] }), 10_000).lines, 1, "no commit yet: this folder alone");
});
