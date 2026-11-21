// @ts-check
// Filament's footprint in a repository (the footprint plan, Phase 7): what it keeps there — its copies with their disk,
// its refs under refs/filament/ by kind, the branches it made for its routines' runs — and Clean up, on the person's
// press, with the plan the sheet showed. Many Filaments share one repository's refs: nothing goes unless a durable record
// shows this Filament's data folder made it (its archive's chats, live or deleted, and the helpers they kept; a copy's
// record naming this data folder), or that the data folder that made it is gone. Refs no record shows to be this
// Filament's go only ticked, never with work that waits. A press takes only what is in both its plan and the read at the
// press. The plan's words (core), the archive's and the registry's reads, and the two admin rows against real throwaway
// repositories under the temp folder — never this one —, a second Filament's data folder among them, live, stopped and
// gone.
// (fails before: yes — the modules, reads and rows are new; against the first build of the plan, the second Filament's
// refs and a helper no record shows to be this Filament's went without a tick, and a press took what its sheet showed
// staying — see each test's note)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copyKind, footprintAnswer, planFootprint, pressedPlanOf, pressedTakes, refKind } from "../src/core/footprint.js";
import { runBranch, runOfBranch, runSlug } from "../src/core/routines.js";
import { copiesOf as readCopies, letGoCopy, setCopiesHome, sweepAside } from "../src/adapters/git/worktree.js";
import { captureTaskWork, holdMarkedWork, keepTaskWork, makeSpareCopy, openCheckTree, openTaskWorktree, releaseTaskWorktree, removeTaskWorktree } from "../src/adapters/git/worktree.js";
import { dropRefGroups, filamentRefs, folderBytes } from "../src/adapters/git/footprint.js";
import { Archive } from "../src/services/memory/archive.js";
import { BackupManager } from "../src/services/memory/backup.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { gitRoutes } from "../src/http/admin/git.js";
import { createRouter } from "../src/http/router.js";
import { copiesOf as copyStates, copyMeta } from "./helpers/copies.js";
import { removeDirs } from "./helpers/wait.js";

let hasGit = true;
try {
  execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
  hasGit = false;
}
const skip = !hasGit && "git is not on PATH";
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made.reverse()));
after(() => setCopiesHome(""));
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: ENV, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).trim();
/** @param {string} prefix */
const fresh = (prefix) => {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  made.push(d);
  return d;
};
/** A repository on main with one commit. @param {string} dir */
const repoIn = (dir) => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** The refs under refs/filament/, by name. @param {string} dir */
const filamentRefNames = (dir) => git(dir, "for-each-ref", "--format=%(refname)", "refs/filament/").split(/\r?\n/).filter(Boolean).sort();
/** The local branches. @param {string} dir */
const branches = (dir) => git(dir, "for-each-ref", "--format=%(refname:short)", "refs/heads/").split(/\r?\n/).filter(Boolean).sort();
/**
 * A copy's record rewritten as another Filament's would stand: its owner and the data folder that wrote it.
 * @param {string} dest @param {Record<string, unknown>} patch
 */
const recordAs = (dest, patch) => {
  const named = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(join(dest, ".git"), "utf8"))?.[1];
  assert.ok(named, `${dest} names its record`);
  const file = join(resolve(dest, named), "filament.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...patch }));
};
/** The plan a press sends of a read with `plan=1`: what goes, and the ticked groups' refs. @param {any} a @param {(g: any, kind: string) => boolean} [tick] */
const planOf = (a, tick = () => false) => ({
  copies: a.copies.items.filter((/** @type {any} */ c) => c.goes).map((/** @type {any} */ c) => ({ name: c.name, at: c.at })),
  left: (a.left?.items || []).filter((/** @type {any} */ l) => l.goes).map((/** @type {any} */ l) => ({ name: l.name })),
  refs: a.refs.kinds.flatMap((/** @type {any} */ k) => k.groups.filter((/** @type {any} */ g) => g.goes || (g.tick && tick(g, k.kind))).flatMap((/** @type {any} */ g) => g.refs)),
  branches: a.branches.items.filter((/** @type {any} */ b) => b.goes).map((/** @type {any} */ b) => ({ name: b.name, commit: b.commit })),
});

// ---- the plan's words (core) ----------------------------------------------------------------------------------------

const OWN = resolve("/data/own");
/** When the test's deleted chats went, in ms: after every ref the plan's tests read was written (their times, ≤ 100 s). */
const DELETED = 1_000_000;
/** @type {import("../src/core/footprint.js").FootprintFacts} */
const NONE = {
  copies: [], left: [], refs: [], standing: new Map(), deletedHelpers: new Map(), inUse: new Set(),
  chats: { here: () => false, deletedAt: () => null, since: null }, named: new Set(), heldSince: null, homes: { own: (h) => h === OWN, gone: () => false }, branches: [],
};
/** A ref read. @param {string} ref @param {string} [tree] @param {number} [date] */
const R = (ref, tree = "t1", date = 100) => ({ ref, commit: `c-${ref}`, tree, date });
/** A copy read, this Filament's unless its record says otherwise. @param {string} name @param {"busy" | "parked" | "free"} state @param {Partial<import("../src/core/footprint.js").CopyFact>} [more] @param {Record<string, unknown>} [meta] */
const C = (name, state, more = {}, meta = {}) => ({ name, meta: { state, agent: /^sa_/.test(name) ? name : "", at: 1, home: OWN, ...meta }, whole: true, claimed: false, othersHold: false, bytes: 10, partial: false, ...more });
/** What a registry says of a helper. @param {Partial<import("../src/core/footprint.js").Standing>} s */
const S = (s) => ({ chainId: "live0001", running: false, inUse: false, held: false, waits: false, undo: false, here: true, ...s });
/** @param {import("../src/core/footprint.js").FootprintPlan} p */
const groupsOf = (p) => p.groups.map((g) => [g.kind, g.owner, g.part, g.refs.length, g.goes, g.tick, g.why]);
const NOT_OURS = "no record shows this Filament made it";

describe("the plan (core/footprint.js)", () => {
  test("refs by kind and owner; copies by kind; a routine's runs' branches by its title", () => {
    assert.deepEqual(refKind("refs/filament/subagents/sa_0000000a/work"), { kind: "subagents", owner: "sa_0000000a", rest: "work" });
    assert.deepEqual(refKind("refs/filament/snapshots/ab12cd34/3-start-in-x"), { kind: "snapshots", owner: "ab12cd34", rest: "3-start-in-x" });
    assert.deepEqual(refKind("refs/filament/moves/ab12cd34/u-1/from"), { kind: "moves", owner: "ab12cd34", rest: "u-1/from" });
    assert.deepEqual(refKind("refs/filament/odd/x"), { kind: "other", owner: null, rest: "odd/x" });
    assert.deepEqual(["sa_0000000a", "spare-1a2b3c4d", "task-1-ab12cd34", "x-check"].map(copyKind), ["helper", "spare", "check", "check"]);
    assert.equal(runSlug("Morning brief!"), "morning-brief");
    const slugs = new Map([[runSlug("Morning brief"), "Morning brief"], [runSlug("Brief 2"), "Brief 2"]]);
    assert.equal(runOfBranch(runBranch("Morning brief", new Date(2026, 9, 27).getTime()), slugs), "Morning brief");
    assert.deepEqual(
      ["routine-morning-brief-1027-2", "routine-brief-2-1101", "routine-brief-2-1101-3", "routine-morning-brief-1327", "routine-morning-brief-1027-100", "fix-login", "routine-other-1027"].map((b) => runOfBranch(b, slugs)),
      ["Morning brief", "Brief 2", "Brief 2", null, null, null, null],
    );
  });

  // (fails before: yes — a copy went on its beat alone: another Filament's, stopped, at rest, was taken)
  test("copies: this Filament's, or one whose data folder is gone, goes at rest; another Filament's stays, live or stopped", () => {
    const other = resolve("/data/other");
    const goneHome = resolve("/data/gone");
    const p = planFootprint({
      ...NONE,
      copies: [
        C("spare-1", "free"),
        C("sa_00000001", "parked"),
        C("sa_00000002", "parked"),
        C("sa_00000003", "parked"),
        C("sa_00000004", "busy"),
        C("sa_00000005", "free", { claimed: true }),
        C("chk-1", "free", { othersHold: true }, { home: other }),
        C("chk-2", "free", { meta: null }),
        C("chk-3", "free", { whole: false }),
        C("chk-4", "free"),
        C("chk-5", "free", {}, { home: other }),
        C("chk-6", "free", {}, { home: goneHome }),
        C("chk-7", "free", {}, { home: undefined }),
        C("sa_00000008", "free", {}, { home: undefined }),
      ],
      refs: [R("refs/filament/subagents/sa_00000002/base", "t1"), R("refs/filament/subagents/sa_00000002/work", "t2")],
      standing: new Map([["sa_00000003", S({ running: true })], ["sa_00000008", S({})]]),
      inUse: new Set(["chk-4"]),
      homes: { own: (h) => h === OWN, gone: (h) => h === goneHome },
    });
    assert.deepEqual(p.copies.map((c) => [c.name, c.goes, c.why]), [
      ["spare-1", true, "free: nothing of it is anyone's"],
      ["sa_00000001", true, "its sub-agent's work no longer waits"],
      ["sa_00000002", false, "it holds its sub-agent's work, which waits to be applied or discarded"],
      ["sa_00000003", false, "its sub-agent is at work"],
      ["sa_00000004", false, "it is at work, or was left at work as a Filament stopped: what it holds goes onto its sub-agent's refs the next time a sub-agent starts here"],
      ["sa_00000005", false, "in use now"],
      ["chk-1", false, "another Filament that works in this repository holds it"],
      ["chk-2", false, "Filament has no record of it yet: it may still be being made"],
      ["chk-3", false, "its checkout is not whole: it may still be being made"],
      ["chk-4", false, "in use now"],
      ["chk-5", false, `another Filament's: its data folder ${other} made it`],
      ["chk-6", true, "free: nothing of it is anyone's; the data folder that made it is gone"],
      ["chk-7", false, NOT_OURS],
      ["sa_00000008", true, "free: nothing of it is anyone's"],
    ]);
    assert.deepEqual(p.copies.filter((c) => c.waits).map((c) => c.name), ["sa_00000002"]);
    assert.deepEqual([p.copies[0].at, p.copies[0].home], [1, OWN], "its record's last use and data folder, for the press");
  });

  // (fails before: yes — the review's finding 2, the old test's :403: a helper no record shows to be this Filament's had
  // its refs and its mark's hold go, while another Filament ran it)
  test("a helper's refs: one this Filament knows, or a deleted chat kept, goes where nothing waits; one no record shows is its own goes only ticked, and never with work that waits", () => {
    const h = (/** @type {string} */ id, /** @type {string} */ leaf, tree = "t1") => R(`refs/filament/subagents/${id}/${leaf}`, tree);
    const p = planFootprint({
      ...NONE,
      copies: [C("sa_00000006", "busy")],
      refs: [
        h("sa_00000001", "base", "t1"), h("sa_00000001", "work", "t2"),
        h("sa_00000002", "base"), h("sa_00000002", "work"),
        h("sa_00000003", "base"), h("sa_00000003", "work"),
        h("sa_00000004", "base"), h("sa_00000004", "work"),
        h("sa_00000005", "marked-base"), h("sa_00000005", "marked-work"),
        h("sa_00000006", "base"),
        h("sa_00000007", "marked-base"), h("sa_00000007", "marked-work"),
        h("sa_00000008", "marked-base"), h("sa_00000008", "marked-work"),
        h("sa_00000009", "base"), h("sa_00000009", "odd"),
        h("sa_0000000a", "work"),
        h("not-a-helper", "base"),
        h("sa_000000b1", "base", "t1"), h("sa_000000b1", "work", "t2"),
        h("sa_000000b2", "base"), h("sa_000000b2", "work"),
        h("sa_000000b3", "marked-base"), h("sa_000000b3", "marked-work"),
        h("sa_000000c1", "base"), h("sa_000000c1", "work"),
        h("sa_0000000d", "marked-base"), h("sa_0000000d", "marked-work"),
      ],
      standing: new Map([
        ["sa_00000001", S({})],
        ["sa_00000002", S({})],
        ["sa_00000003", S({ held: true })],
        ["sa_00000004", S({ waits: true })],
        ["sa_00000005", S({ undo: true })],
        ["sa_00000007", S({ undo: true, here: false })],
        ["sa_00000008", S({ undo: false })],
        ["sa_00000009", S({})],
        ["sa_0000000d", S({ undo: false, here: false })],
      ]),
      deletedHelpers: new Map([["sa_000000c1", DELETED]]),
    });
    assert.deepEqual(groupsOf(p), [
      ["subagents", "sa_00000001", "work", 2, false, false, "its work waits to be applied or discarded"],
      ["subagents", "sa_00000002", "work", 2, true, false, "nothing of its work waits"],
      ["subagents", "sa_00000003", "work", 2, false, false, "its chat's task graph still asks for its sub-agent"],
      ["subagents", "sa_00000004", "work", 2, false, false, "its chat says its work waits"],
      ["subagents", "sa_00000005", "mark", 2, false, false, "its mark as applied can still be undone in its chat"],
      ["subagents", "sa_00000006", "work", 1, false, false, "its copy may hold work not kept on its refs yet"],
      ["subagents", "sa_00000007", "mark", 2, false, false, "its mark as applied can still be undone in its chat"],
      ["subagents", "sa_00000008", "mark", 2, true, false, "its mark as applied can no longer be undone"],
      ["subagents", "sa_00000009", "work", 1, true, false, "nothing of its work waits"],
      ["subagents", "sa_00000009", "other", 1, false, false, "Filament does not know what this ref is for"],
      ["subagents", "sa_0000000a", "work", 1, false, false, "its work has no base to tell what of it waits"],
      ["subagents", "not-a-helper", "work", 1, false, false, "Filament does not know a sub-agent by that name"],
      ["subagents", "sa_000000b1", "work", 2, false, false, `its work waits to be applied or discarded; ${NOT_OURS}`],
      ["subagents", "sa_000000b2", "work", 2, false, true, `nothing of its work waits; ${NOT_OURS}: another Filament's sub-agent may be at work`],
      ["subagents", "sa_000000b3", "mark", 2, false, true, `a mark's hold ${NOT_OURS}: another Filament may still undo it`],
      ["subagents", "sa_000000c1", "work", 2, true, false, "nothing of its work waits"],
      ["subagents", "sa_0000000d", "mark", 2, true, false, "no chat keeps its sub-agent, so nothing can undo its mark"],
    ]);
  });

  // (fails before: yes — the review's finding 1: every chat the archive did not know was "gone", and its Undo points went)
  test("a chat's Undo points and ways back go only where this Filament deleted it and no chat here names them; another Filament's go only ticked", () => {
    const refs = [
      R("refs/filament/snapshots/live0001/1-start"),
      R("refs/filament/snapshots/gone0001/1-start", "t1", 50), R("refs/filament/snapshots/gone0001/rewind-2-x", "t1", 70),
      R("refs/filament/snapshots/gone0002/3-start"),
      R("refs/filament/snapshots/othr0001/1-start", "t1", 10), R("refs/filament/snapshots/othr0001/2-start", "t1", 90),
      R("refs/filament/snapshots/loose"),
      R("refs/filament/moves/gone0001/u1/from"), R("refs/filament/moves/live0001/u2/from"), R("refs/filament/moves/othr0002/u3/from"),
      R("refs/filament/elsewhere/x"),
    ];
    const deleted = new Set(["gone0001", "gone0002"]);
    const facts = { ...NONE, refs, chats: { here: (/** @type {string} */ o) => o === "live0001", deletedAt: (/** @type {string} */ o) => (deleted.has(o) ? DELETED : null), since: null }, named: new Set(["refs/filament/snapshots/gone0002/3-start"]) };
    const p = planFootprint(facts);
    assert.deepEqual(groupsOf(p), [
      ["snapshots", "live0001", "undo", 1, false, false, "its chat is here"],
      ["snapshots", "gone0001", "undo", 2, true, false, "you deleted its chat"],
      ["snapshots", "gone0002", "named", 1, false, false, "a chat here names it: a fork keeps its source's"],
      ["snapshots", "othr0001", "undo", 2, false, true, `${NOT_OURS}: another Filament's chat may be among these`],
      ["snapshots", "loose", "other", 1, false, false, "it is not named for a chat"],
      ["moves", "gone0001", "undo", 1, true, false, "you deleted its chat"],
      ["moves", "live0001", "undo", 1, false, false, "its chat is here"],
      ["moves", "othr0002", "undo", 1, false, true, `${NOT_OURS}: another Filament's chat may be among these`],
      ["other", null, "other", 1, false, false, "Filament does not know what keeps these"],
    ]);
    const blind = groupsOf(planFootprint({ ...facts, chats: null })).filter((g) => g[1] === "gone0001" || g[1] === "othr0001");
    assert.ok(blind.every((g) => g[4] === false && g[5] === false && g[6] === "Filament's record of its chats is not open, so it cannot tell whose these are"), "with no record of its chats, none of it goes, ticked or not");
    const a = footprintAnswer(p, { refs: true });
    const othr = a.refs.kinds[1].groups.find((g) => g.owner === "othr0001");
    assert.deepEqual([othr?.count, othr?.newest, othr?.refs?.map((r) => r.ref)], [2, 90, ["refs/filament/snapshots/othr0001/1-start", "refs/filament/snapshots/othr0001/2-start"]], "listed apart by chat: its count, its newest time, its refs");
    assert.equal(a.refs.kinds[1].groups.find((g) => g.owner === "live0001")?.refs, undefined, "a group that stays sends no refs");
    assert.equal(footprintAnswer(p).refs.kinds[1].groups[1].refs, undefined, "the line's read lists none");
    assert.deepEqual([a.refs.count, a.refs.goes, a.refs.tick], [11, 3, 3]);
  });

  test("a routine run's branch goes only with no worktree and every commit on its base; the answer counts what goes", () => {
    const b = (/** @type {Partial<import("../src/core/footprint.js").BranchFact>} */ o) => ({ name: "routine-x-1027", routine: "X", commit: "c", worktree: null, uncommitted: null, base: "main", ahead: 0, ...o });
    const p = planFootprint({
      ...NONE,
      copies: [C("spare-1", "free", { bytes: 1000, partial: true }), C("sa_00000001", "busy", { bytes: 24 })],
      refs: [R("refs/filament/snapshots/gone0001/1-start")],
      chats: { here: () => false, deletedAt: () => DELETED, since: null },
      branches: [b({}), b({ name: "routine-x-1028", ahead: 2 }), b({ name: "routine-x-1029", worktree: "/r-x", uncommitted: 1 }), b({ name: "routine-x-1030", worktree: "/r-y", uncommitted: 0 }), b({ name: "routine-x-1031", base: null }), b({ name: "routine-x-1101", ahead: null })],
    });
    assert.deepEqual(p.branches.map((x) => [x.name, x.goes, x.why]), [
      ["routine-x-1027", true, "main has every commit of it"],
      ["routine-x-1028", false, "it holds 2 commits main lacks"],
      ["routine-x-1029", false, "it has a worktree, with 1 file uncommitted"],
      ["routine-x-1030", false, "it has a worktree: remove that first"],
      ["routine-x-1031", false, "no base branch to compare it with"],
      ["routine-x-1101", false, "git could not compare it with main"],
    ]);
    const a = footprintAnswer(p);
    assert.deepEqual([a.copies.count, a.copies.bytes, a.copies.partial, a.copies.goes, a.copies.goesBytes, a.copies.goesPartial], [2, 1024, true, 1, 1000, true], "at least where a copy that goes was cut short");
    assert.deepEqual([a.branches.count, a.branches.goes, a.goes, a.branches.items[0].commit], [6, 1, 3, "c"]);
  });

  // (fails before: yes — the review's finding 3: a press planned again from nothing and took what qualified then)
  test("a press takes only what is in both its plan and the read at the press; what moved, was used, was not shown or not ticked stays", () => {
    const refs = [
      R("refs/filament/snapshots/gone0001/1-start"), R("refs/filament/snapshots/gone0001/2-start"),
      R("refs/filament/snapshots/othr0001/1-start"),
      R("refs/filament/snapshots/live0001/1-start"),
      R("refs/filament/snapshots/gone0003/1-start"),
    ];
    const p = planFootprint({
      ...NONE,
      refs,
      copies: [C("chk-1", "free"), C("chk-2", "free"), C("chk-3", "free"), C("chk-4", "busy")],
      chats: { here: (o) => o === "live0001", deletedAt: (o) => (o.startsWith("gone") ? DELETED : null), since: null },
      branches: [{ name: "routine-x-1027", routine: "X", commit: "c1", worktree: null, uncommitted: null, base: "main", ahead: 0 }, { name: "routine-x-1028", routine: "X", commit: "c2", worktree: null, uncommitted: null, base: "main", ahead: 0 }],
    });
    const t = pressedTakes(p, {
      copies: [{ name: "chk-1", at: 1 }, { name: "chk-2", at: 0 }, { name: "chk-4", at: 1 }, { name: "chk-9", at: 1 }],
      left: [],
      refs: [
        { ref: "refs/filament/snapshots/gone0001/1-start", commit: "c-refs/filament/snapshots/gone0001/1-start" },
        { ref: "refs/filament/snapshots/gone0001/2-start", commit: "moved" },
        { ref: "refs/filament/snapshots/othr0001/1-start", commit: "c-refs/filament/snapshots/othr0001/1-start" },
        { ref: "refs/filament/snapshots/live0001/1-start", commit: "c-refs/filament/snapshots/live0001/1-start" },
        { ref: "refs/filament/snapshots/gone0009/1-start", commit: "x" },
      ],
      branches: [{ name: "routine-x-1027", commit: "c1" }, { name: "routine-x-1028", commit: "old" }],
    });
    assert.deepEqual(t.copies.map((c) => c.name), ["chk-1"]);
    assert.deepEqual(t.groups.map((g) => [g.group.owner, g.refs.map((r) => r.ref)]), [["gone0001", ["refs/filament/snapshots/gone0001/1-start"]], ["othr0001", ["refs/filament/snapshots/othr0001/1-start"]]], "a ticked group goes as sent");
    assert.deepEqual(t.branches.map((b) => b.name), ["routine-x-1027"]);
    assert.deepEqual(t.stayed.map((s) => [s.kind, s.why, s.count]).sort(), [
      ["branches", "it moved since you read it", 1],
      ["copies", "it is at work, or was left at work as a Filament stopped: what it holds goes onto its sub-agent's refs the next time a sub-agent starts here", 1],
      ["copies", "it is gone already", 1],
      ["copies", "it was used since you read it", 1],
      ["copies", "the sheet you pressed on did not show it going", 1],
      ["refs", "it is gone already", 1],
      ["snapshots", "it moved since you read it", 1],
      ["snapshots", "its chat is here", 1],
      ["snapshots", "the sheet you pressed on did not show it going", 1],
    ].sort());
    assert.equal(pressedPlanOf({ left: [{}] }).ok, false, "a folder a Clean up left, by its name");
    assert.deepEqual(pressedPlanOf(undefined), { ok: false, error: "plan is the plan the sheet showed: { copies, refs, branches }, each as it was read" });
    assert.equal(pressedPlanOf({ refs: [{ ref: "refs/heads/main", commit: "a".repeat(40) }] }).ok, false, "only refs under refs/filament/");
    assert.equal(pressedPlanOf({ copies: [{ name: "x" }] }).ok, false, "a copy as it was read");
    assert.deepEqual(pressedPlanOf({ refs: [{ ref: "refs/filament/x", commit: "a".repeat(40) }] }), { ok: true, plan: { copies: [], left: [], refs: [{ ref: "refs/filament/x", commit: "a".repeat(40) }], branches: [] } });
  });

  // (fails before: yes — the review's (round 2) items 1, 2 and 10: a deleted chat's Undo points went while a memory
  // backup kept here holds the chat, and while one of them was written after the delete; a chat this archive never had,
  // written since it began keeping its deletes, read as any chat no record shows)
  test("a deleted chat's refs go only ticked where a backup holds the chat or one was written since; a chat never had here, written since the archive kept its deletes, is another Filament's", () => {
    const h = (/** @type {string} */ id, /** @type {string} */ leaf) => R(`refs/filament/subagents/${id}/${leaf}`);
    const refs = [
      h("sa_000000e1", "base"), h("sa_000000e1", "work"),
      h("sa_000000e2", "marked-base"), h("sa_000000e2", "marked-work"),
      R("refs/filament/snapshots/old00001/1-start", "t1", 50),
      R("refs/filament/snapshots/new00001/1-start", "t1", 50),
      R("refs/filament/snapshots/cpy00001/1-start", "t1", 50), R("refs/filament/snapshots/cpy00001/2-start", "t1", 1500),
      R("refs/filament/snapshots/othr0001/1-start", "t1", 100), R("refs/filament/snapshots/othr0001/2-start", "t1", 4000),
      R("refs/filament/snapshots/othr0002/1-start", "t1", 100),
    ];
    // old00001 went before the oldest backup kept (2,000 s), new00001 after it; a ref of cpy00001 was written after it
    // went; the archive kept its deletes from 2,500 s on.
    const deleted = new Map([["old00001", 1_000_000], ["new00001", 3_000_000], ["cpy00001", 1_000_000]]);
    const facts = {
      ...NONE,
      refs,
      heldSince: 2_000_000,
      chats: { here: () => false, deletedAt: (/** @type {string} */ o) => deleted.get(o) ?? null, since: 2_500_000 },
      deletedHelpers: new Map([["sa_000000e1", 3_000_000], ["sa_000000e2", 1_000_000]]),
    };
    const BACKUP = "you deleted its chat after a memory backup kept here was taken: restoring that backup would bring the chat back without these";
    const p = planFootprint(facts);
    assert.deepEqual(p.groups.map((g) => [g.owner, g.part, g.goes, g.tick, g.others, g.why]), [
      ["sa_000000e1", "work", false, true, false, BACKUP],
      ["sa_000000e2", "mark", true, false, false, "no chat keeps its sub-agent, so nothing can undo its mark"],
      ["old00001", "undo", true, false, false, "you deleted its chat"],
      ["new00001", "undo", false, true, false, BACKUP],
      ["cpy00001", "undo", false, true, false, "you deleted its chat, but some of these were written since: another Filament working from a copy of this data folder may have it still"],
      ["othr0001", "undo", false, true, true, "another Filament's: written since this Filament began keeping the chats it deletes, for a chat it neither has nor deleted"],
      ["othr0002", "undo", false, true, false, `${NOT_OURS}: another Filament's chat may be among these`],
    ]);
    const a = footprintAnswer(p, { refs: true });
    assert.deepEqual(a.refs.kinds[1].groups.map((g) => [g.owner, g.others]), [["old00001", false], ["new00001", false], ["cpy00001", false], ["othr0001", true], ["othr0002", false]], "the page is told which are another Filament's");
    const noBackup = planFootprint({ ...facts, heldSince: null });
    assert.deepEqual(noBackup.groups.filter((g) => g.goes).map((g) => g.owner), ["sa_000000e1", "sa_000000e2", "old00001", "new00001"], "with no backup kept, a chat deleted goes, a ref written since its delete aside");
  });

  // (fails before: yes — the review's (round 2) item 11: a helper's work ref moved since the read, its tree still its
  // base's, left the base going alone and the work behind with no base)
  test("a press takes a helper's refs together or not at all", () => {
    const base = R("refs/filament/subagents/sa_000000f1/base");
    const work = R("refs/filament/subagents/sa_000000f1/work");
    const p = planFootprint({ ...NONE, refs: [base, work], standing: new Map([["sa_000000f1", S({})]]) });
    assert.deepEqual(groupsOf(p), [["subagents", "sa_000000f1", "work", 2, true, false, "nothing of its work waits"]]);
    const moved = pressedTakes(p, { copies: [], left: [], refs: [{ ref: base.ref, commit: base.commit }, { ref: work.ref, commit: "moved" }], branches: [] });
    assert.deepEqual([moved.groups, moved.stayed], [[], [{ kind: "subagents", why: "part of it moved since you read it, and a sub-agent's refs go together", count: 2 }]]);
    const grew = pressedTakes(p, { copies: [], left: [], refs: [{ ref: base.ref, commit: base.commit }], branches: [] });
    assert.deepEqual(grew.groups, [], "a ref of it made since the read keeps the rest");
    const whole = pressedTakes(p, { copies: [], left: [], refs: [{ ref: base.ref, commit: base.commit }, { ref: work.ref, commit: work.commit }], branches: [] });
    assert.deepEqual(whole.groups.map((g) => g.refs.length), [2]);
  });
});

// ---- what the archive and the registry are asked ----------------------------------------------------------------------

describe("the archive's and the registry's reads", () => {
  // (fails before: yes — nothing kept a deleted chat's id, and a fork's naming was read from every chat's turns; the
  // review of the revision: the record kept a deleted chat's title or its first message's words)
  test("the archive: every chat's id; each chat it deleted with the helpers it kept and no word it held; the refs its forks name; the helpers' threads its chats keep", () => {
    const dir = fresh("filament-footprint-archive-");
    const a = /** @type {any} */ (new Archive({ file: join(dir, "a.db") }));
    try {
      const one = a.chainForKey("one", { cwd: "H:\\p", client: "harness" });
      const two = a.chainForKey("two", { cwd: "H:\\p", client: "harness" });
      const three = a.chainForKey("three", { cwd: "H:\\q", client: "harness" });
      assert.deepEqual(a.chainIds().sort(), [one.id, two.id, three.id].sort());
      const { turnId } = a.beginTurn(one.id, { requestId: "r1", model: "m", userMessage: { role: "user", content: [{ type: "text", text: "go" }] } });
      a.finishTurn(turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
      a.setTurnTree(turnId, { ref: `refs/filament/snapshots/${one.id}/1-start`, commit: "abc" });
      assert.deepEqual([...a.snapshotRefsNamed()], [], "a chat's own turns name its own refs: not read");
      const fork = a.forkChain(one.id, { atTurn: 1, key: "fork-of-one" });
      assert.equal(fork?.error, undefined, JSON.stringify(fork));
      assert.deepEqual([...a.snapshotRefsNamed()], [`refs/filament/snapshots/${one.id}/1-start`], "a fork's copied turn names its source's");
      a.mergeMeta(one.id, { subagentThreads: [{ id: "sa_00000001", status: "done", work: { files: [{ path: "x" }] } }, { id: "sa_00000002", status: "done" }] });
      a.setTitle(one.id, "Fix login");
      a.mergeMeta(two.id, { subagentThreads: [{ id: "sa_00000003", status: "running" }] });
      const got = a.threadsNamed(["sa_00000001", "sa_00000003", "sa_00000009"]).map((/** @type {any} */ x) => [x.chainId, x.thread.id, x.thread.status]).sort();
      assert.deepEqual(got, [[one.id, "sa_00000001", "done"], [two.id, "sa_00000003", "running"]].sort());
      assert.deepEqual(a.threadsNamed([]), []);
      assert.equal(a.goneChains().size, 0);
      a.deleteChain(one.id);
      const gone = a.goneChains().get(one.id);
      assert.deepEqual(gone?.helpers, ["sa_00000001", "sa_00000002"], "the helpers its threads kept");
      assert.deepEqual(Object.keys(gone || {}).sort(), ["at", "helpers"], "no title, no word of its messages: a delete takes its text");
      assert.ok([...a.snapshotRefsNamed()].includes(`refs/filament/snapshots/${one.id}/1-start`), "its fork still names its source's ref");
      a.deleteProject(three.project_id);
      assert.deepEqual([...a.goneChains().keys()].sort(), [one.id, three.id].sort(), "a project's delete keeps each of its chats' ids");
    } finally {
      a.close();
    }
  });

  // (fails before: yes — the review's (round 2) items 1 and 2: nothing kept since when the archive keeps its deletes, nor
  // since when a backup may hold a chat)
  test("the archive keeps since when it keeps the chats it deletes; memory's backups say since when one kept may hold a chat", () => {
    const dir = fresh("filament-footprint-since-");
    const first = new Archive({ file: join(dir, "a.db"), now: () => 5000 });
    assert.equal(first.goneSince(), 5000);
    first.close();
    const again = new Archive({ file: join(dir, "a.db"), now: () => 9000 });
    assert.equal(again.goneSince(), 5000, "stamped once, as the file first opens");
    again.close();
    const folder = join(dir, "backups");
    for (const at of ["2026-10-20T03:00:00.000Z", "2026-10-30T03:00:00.000Z"]) {
      const b = join(folder, `filament-memory-${at.replace(/[:.]/g, "-").slice(0, 19)}`);
      mkdirSync(b, { recursive: true });
      writeFileSync(join(b, "manifest.json"), JSON.stringify({ at, files: {} }));
    }
    mkdirSync(join(folder, "filament-memory-broken"));
    const now = Date.parse("2026-11-03T12:00:00.000Z");
    const day = 24 * 60 * 60 * 1000;
    /** @param {any} backups */
    const held = (backups) => new BackupManager({ getConfig: () => ({ backups }), now: () => now }).heldSince();
    assert.equal(held({ enabled: false, folder }), Date.parse("2026-10-20T03:00:00.000Z"), "the oldest backup kept");
    assert.equal(held({ enabled: true, folder, keep: 30 }), now - 30 * day, "daily backups kept 30 days hold a month, listed or not");
    assert.equal(held({ enabled: true, folder: join(dir, "away"), keep: 7 }), now - 7 * day, "a destination that does not read still holds what it keeps");
    assert.equal(held({ enabled: false, folder: "" }), null, "none kept, none taken");
  });

  // (fails before: yes — the review's (round 2) item 3: each 50 ids scanned every chat's meta again, with 50 patterns:
  // 3,000 chats and 5,000 ids took seconds on the event loop)
  test("the helpers' threads, asked for thousands of ids over thousands of chats, are read in one pass", () => {
    const dir = fresh("filament-footprint-threads-");
    const a = /** @type {any} */ (new Archive({ file: join(dir, "a.db") }));
    try {
      const hex = (/** @type {number} */ n) => n.toString(16).padStart(8, "0");
      const filler = "lorem ipsum dolor sit amet ".repeat(150);
      /** @type {string[]} */
      const ids = [];
      /** @type {[string, string][]} */
      const kept = [];
      for (let i = 0; i < 3000; i++) {
        const c = a.chainForKey(`many-${i}`, { cwd: `H:\\p${i % 20}`, client: "harness" });
        /** @type {any} */
        const meta = { notes: filler, tree: { snapshotRef: `refs/filament/snapshots/${c.id}/1-start` } };
        if (i < 1000)
          meta.subagentThreads = [0, 1, 2].map((k) => {
            const id = `sa_${hex(i * 3 + k)}`;
            ids.push(id);
            kept.push([c.id, id]);
            return { id, status: "done", work: { files: [{ path: "src/x.js" }], applied: [] }, exchanges: [0, 1, 2, 3].map((e) => ({ startedAt: e, report: filler.slice(0, 200) })) };
          });
        a.mergeMeta(c.id, meta);
      }
      for (let i = 0; i < 2000; i++) ids.push(`sa_${hex(0x10000000 + i)}`);
      /** @type {number[]} */
      const ms = [];
      /** @type {[string, string][]} */
      let got = [];
      for (let r = 0; r < 3; r++) {
        const t0 = performance.now();
        got = a.threadsNamed(ids).map((/** @type {any} */ x) => [x.chainId, x.thread.id]);
        ms.push(performance.now() - t0);
      }
      const t0 = performance.now();
      const few = a.threadsNamed(ids.slice(0, 50)).length;
      const fewMs = performance.now() - t0;
      console.log(`threadsNamed: 3000 chats, ${ids.length} ids: ${ms.map((x) => x.toFixed(1)).join(", ")} ms; 50 ids: ${fewMs.toFixed(1)} ms`);
      assert.deepEqual(got.sort(), kept.sort(), "every thread asked for, with the chat that keeps it, and none else");
      assert.equal(few, 50);
      assert.ok(Math.min(...ms) < 400, `one pass: ${ms.map((x) => x.toFixed(0)).join(", ")} ms`);
    } finally {
      a.close();
    }
  });

  test("the registry's `known`: a helper it holds, one whose thread a chat keeps, none for one no chat knows — and nothing joins it", async () => {
    const root = fresh("filament-footprint-registry-");
    /** @type {any[]} */
    const threads = [
      { chainId: "c2", thread: { id: "sa_000000b1", status: "done", work: { files: [{ path: "x" }], applied: [] }, exchanges: [] } },
      { chainId: "c2", thread: { id: "sa_000000b2", status: "done", work: { base: "h1", files: [], applied: [{ at: Date.now(), hand: { base: "h0", head: "h1" } }] }, exchanges: [{ startedAt: 1 }] } },
    ];
    /** @type {string[][]} */
    const asked = [];
    let n = 0;
    /** @type {ReturnType<typeof createSubagentRegistry>} */
    const registry = createSubagentRegistry({
      config: () => ({ agentLoop: {} }),
      log: () => {},
      events: { publish: () => {} },
      runs: null,
      now: Date.now,
      context: {
        settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }] }, loop: { permissions: "read-only" } }),
        session: () => ({ cwd: root, model: "m", projectId: "p1" }),
        view: async () => ({ text: "User: look", turns: 1 }),
        brief: async () => null,
        modelProblem: () => null,
        mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
        holds: (/** @type {string} */ chainId) => (id) => chainId === "c2" && id === "sa_000000b1",
        threadsNamed: (ids) => (asked.push([...ids]), threads.filter((t) => ids.includes(t.thread.id))),
      },
      call: async ({ body, headers = {} }) => {
        const id = headers["x-filament-subagent"];
        const runId = `run-${++n}`;
        registry.attach(id, runId);
        registry.finish(id, { status: "done", error: null, report: "Done.", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Done." }] }], rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
        return { ok: true, status: 200, json: { content: [{ type: "text", text: "Done." }], usage: { input_tokens: 1, output_tokens: 1 } }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
      },
    });
    const launched = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "look", description: "Look", background: true }));
    assert.ok(launched.ok, JSON.stringify(launched));
    await launched.done;
    const mine = String(launched.id);
    const known = registry.known([mine, "sa_000000b1", "sa_000000b2", "sa_000000b9"]);
    assert.deepEqual(Object.fromEntries(known), {
      [mine]: { chainId: "c1", running: false, inUse: false, held: false, waits: false, undo: false },
      sa_000000b1: { chainId: "c2", running: false, inUse: false, held: true, waits: true, undo: false },
      sa_000000b2: { chainId: "c2", running: false, inUse: false, held: false, waits: false, undo: true },
    });
    assert.deepEqual(asked, [["sa_000000b1", "sa_000000b2", "sa_000000b9"]], "only those it does not hold are asked of the chats");
    assert.equal(registry.get("sa_000000b1"), null, "a kept thread read does not join the registry");
    assert.deepEqual(registry.treesInUse(), []);
  });
});

// ---- the admin rows, against real repositories --------------------------------------------------------------------------

/**
 * The git rows over a folder of roots for a Filament running from `dataDir`, with what its registry, its archive and its
 * Spaces say.
 * @param {string} root @param {{ dataDir: string, subagents?: any, archive?: any, spaces?: any, heldSince?: number | null }} ctx
 *   `heldSince`: since when memory's backups may hold a chat
 */
const routes = (root, { dataDir, subagents = null, archive = null, spaces = null, heldSince = null }) => {
  const memory = { placesOf: () => [], chatsIn: () => new Map(), archive, backups: { heldSince: () => heldSince } };
  const rows = gitRoutes({ config: { get: () => ({ agentLoop: { roots: [root] }, server: {} }) }, memory, subagents, spaces, dataDir, events: null });
  /** @param {string} method @param {string} path @param {any} [body] @returns {Promise<{ status: number, body: any }>} */
  const call = async (method, path, body = {}) => {
    const m = createRouter(rows)(method, path.split("?")[0]);
    if (!m) return { status: 404, body: { error: "no row" } };
    const got = { status: 0, body: /** @type {any} */ (null) };
    const res = { headersSent: false, writableEnded: false, setHeader() {}, writeHead: (/** @type {number} */ s) => Object.assign(got, { status: s }), end: (/** @type {string} */ b) => void (got.body = JSON.parse(String(b))) };
    await m.handler({ req: { headers: {}, method, socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url: new URL(`http://localhost/api${path}`), params: m.params, json: async () => body }, {});
    return got;
  };
  const read = async (/** @type {string} */ repo, plan = true) => {
    const r = await call("GET", `/git/footprint?cwd=${encodeURIComponent(repo)}${plan ? "&plan=1" : ""}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true, r.body.error);
    return r.body;
  };
  return { call, read };
};
/**
 * An archive's reads as a test sets them: a deleted chat went as it is asked of, unless its `at` says when; the archive
 * keeps its deletes from `since`, as it is made unless said.
 * @param {{ live?: string[], gone?: Record<string, { helpers?: string[], at?: number }>, named?: string[], projects?: Record<string, string>, since?: number }} o
 */
const archiveOf = ({ live = [], gone = {}, named = [], projects = {}, since = Date.now() }) => ({
  chainIds: () => [...live],
  hasChain: (/** @type {string} */ id) => live.includes(id),
  goneChains: () => new Map(Object.entries(gone).map(([id, g]) => [id, { helpers: g.helpers || [], at: g.at ?? Date.now() }])),
  goneSince: () => since,
  snapshotRefsNamed: () => new Set(named),
  getProject: (/** @type {string} */ p) => (projects[p] ? { cwd: projects[p] } : null),
});

describe("GET /api/git/footprint and POST /api/git/footprint/clean", () => {
  test("the read lists each kind; a press takes exactly what its sheet showed going, and a group no record shows to be this Filament's only once ticked", { skip }, async () => {
    const base = fresh("filament-footprint-");
    const dataDir = join(base, "data-own");
    mkdirSync(dataDir);
    setCopiesHome(dataDir);
    const repo = repoIn(join(base, "proj"));
    const home = join(repo, ".git", "filament-worktrees");
    const head = git(repo, "rev-parse", "HEAD");
    const a = await openTaskWorktree(repo, { id: "sa_aaaaaaaa" });
    assert.ok(a.ok, !a.ok ? a.error : "");
    writeFileSync(join(a.wt.workdir, "new.txt"), "its work\n");
    const capA = await captureTaskWork(a.wt, { id: "sa_aaaaaaaa" });
    assert.ok(capA.ok && capA.files.length === 1);
    const b = await openTaskWorktree(repo, { id: "sa_bbbbbbbb" });
    assert.ok(b.ok);
    assert.ok(await keepTaskWork(repo, "sa_bbbbbbbb", { base: head, head }));
    const chk = await openCheckTree(repo, { id: "chk-1", commit: head });
    assert.ok(chk.ok);
    const d = await openTaskWorktree(repo, { id: "sa_dddddddd" });
    assert.ok(d.ok);
    await releaseTaskWorktree(a.wt, "parked");
    await makeSpareCopy(repo, home);
    await releaseTaskWorktree(b.wt, "free");
    await releaseTaskWorktree(chk.wt, "free");
    assert.equal(/** @type {any} */ (copyMeta(b.wt.dest))?.home, resolve(dataDir), "a copy's record names the data folder that wrote it");
    const big = join(base, "big");
    mkdirSync(big);
    writeFileSync(join(big, "blob.bin"), Buffer.alloc(3 * 1024 * 1024, 1));
    symlinkSync(big, join(b.wt.dest, "big-link"), process.platform === "win32" ? "junction" : "dir");
    assert.ok(await holdMarkedWork(repo, "sa_cccccccc", { base: head, head: capA.head }));
    assert.ok(await holdMarkedWork(repo, "sa_eeeeeeee", { base: head, head: capA.head }));
    assert.ok(await keepTaskWork(repo, "sa_ffffffff", { base: head, head }));
    for (const ref of ["snapshots/live0001/1-start", "snapshots/gone0001/1-start", "snapshots/gone0001/2-start", "snapshots/gone0002/3-start", "snapshots/gone0002/rewind-1-x", "snapshots/othr0001/1-start", "moves/gone0001/u1/from", "moves/live0001/u2/from", "elsewhere/x"])
      git(repo, "update-ref", `refs/filament/${ref}`, head);
    git(repo, "branch", "routine-morning-brief-1027", head);
    git(repo, "branch", "routine-morning-brief-1028", head);
    const ahead = join(base, "proj-ahead");
    git(repo, "worktree", "add", "-q", ahead, "routine-morning-brief-1028");
    writeFileSync(join(ahead, "b.txt"), "b\n");
    git(ahead, "add", "-A");
    git(ahead, "commit", "-qm", "b");
    git(repo, "worktree", "remove", ahead);
    const lane = join(base, "proj-routine-morning-brief-1029");
    git(repo, "worktree", "add", "-q", "-b", "routine-morning-brief-1029", lane, head);
    writeFileSync(join(lane, "loose.txt"), "x\n");
    git(repo, "branch", "fix-login", head);
    git(repo, "branch", "routine-other-1027", head);

    const registry = {
      known: (/** @type {string[]} */ ids) => new Map(/** @type {[string, any][]} */ ([
        ["sa_aaaaaaaa", { chainId: "live0001", running: false, inUse: false, held: false, waits: true, undo: false }],
        ["sa_eeeeeeee", { chainId: "live0001", running: false, inUse: false, held: false, waits: false, undo: true }],
        ["sa_ffffffff", { chainId: "live0001", running: true, inUse: false, held: false, waits: false, undo: false }],
      ]).filter(([id]) => ids.includes(id))),
      treesInUse: () => [],
    };
    const archive = archiveOf({
      live: ["live0001", "fork0001"],
      gone: { gone0001: { helpers: ["sa_bbbbbbbb"] }, gone0002: {} },
      named: ["refs/filament/snapshots/gone0002/3-start"],
      projects: { p1: repo },
    });
    const spaces = { routinesAll: () => [{ project: "p1", r: { title: "Morning brief" } }, { project: "p2", r: { title: "Other" } }] };
    const { call, read } = routes(base, { dataDir, subagents: registry, archive, spaces });

    const fp = await read(repo);
    assert.deepEqual(
      fp.copies.items.map((/** @type {any} */ c) => [c.name, c.kind, c.state, c.goes, c.why]).sort(),
      [
        ["chk-1", "check", "free", true, "free: nothing of it is anyone's"],
        ["sa_aaaaaaaa", "helper", "parked", false, "it holds its sub-agent's work, which waits to be applied or discarded"],
        ["sa_bbbbbbbb", "helper", "free", true, "free: nothing of it is anyone's"],
        ["sa_dddddddd", "helper", "busy", false, "in use now"],
        [fp.copies.items.find((/** @type {any} */ c) => c.kind === "spare")?.name, "spare", "free", true, "free: nothing of it is anyone's"],
      ].sort(),
    );
    const bOf = fp.copies.items.find((/** @type {any} */ c) => c.name === "sa_bbbbbbbb");
    assert.ok(bOf.bytes > 0 && bOf.bytes < 1024 * 1024, `measured, the link not followed: ${bOf.bytes}`);
    assert.deepEqual(fp.refs.kinds.map((/** @type {any} */ k) => [k.kind, k.count, k.goes, k.tick]), [["subagents", 11, 2, 2], ["snapshots", 6, 3, 1], ["moves", 2, 1, 0], ["forks", 0, 0, 0], ["other", 1, 0, 0]]);
    assert.deepEqual(
      fp.refs.kinds[0].groups.map((/** @type {any} */ g) => [g.owner, g.part, g.count, g.goes, g.tick]),
      [["sa_aaaaaaaa", "work", 2, false, false], ["sa_bbbbbbbb", "work", 2, true, false], ["sa_cccccccc", "mark", 2, false, true], ["sa_dddddddd", "work", 1, false, false], ["sa_eeeeeeee", "mark", 2, false, false], ["sa_ffffffff", "work", 2, false, false]],
      "a helper of a chat this Filament deleted goes; one no record shows is its own waits for a tick",
    );
    assert.equal("title" in (fp.refs.kinds[1].groups.find((/** @type {any} */ g) => g.owner === "gone0001") || {}), false, "a deleted chat's group says no word of it");
    assert.deepEqual(fp.branches.items.map((/** @type {any} */ x) => [x.name, x.goes]), [["routine-morning-brief-1027", true], ["routine-morning-brief-1028", false], ["routine-morning-brief-1029", false]]);
    assert.equal(fp.goes, 3 + 2 + 3 + 1 + 1, "three copies, six refs, one branch");

    const before = filamentRefNames(repo);
    const done = await call("POST", "/git/footprint/clean", { cwd: repo, plan: planOf(fp) });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.deepEqual([...done.body.went.copies].sort(), [fp.copies.items.find((/** @type {any} */ c) => c.kind === "spare").name, "chk-1", "sa_bbbbbbbb"].sort());
    assert.deepEqual(done.body.went.refs, { subagents: 2, snapshots: 3, moves: 1, forks: 0, other: 0 });
    assert.deepEqual(done.body.went.branches, ["routine-morning-brief-1027"]);
    assert.ok(done.body.stayed.some((/** @type {any} */ s) => s.kind === "subagents" && s.why === "you did not tick it" && s.count === 2), JSON.stringify(done.body.stayed));
    assert.ok(done.body.stayed.some((/** @type {any} */ s) => s.kind === "snapshots" && s.why === "you did not tick it" && s.count === 1));
    const gone = new Set(["refs/filament/subagents/sa_bbbbbbbb/base", "refs/filament/subagents/sa_bbbbbbbb/work", "refs/filament/snapshots/gone0001/1-start", "refs/filament/snapshots/gone0001/2-start", "refs/filament/snapshots/gone0002/rewind-1-x", "refs/filament/moves/gone0001/u1/from"]);
    assert.deepEqual(filamentRefNames(repo), before.filter((r) => !gone.has(r)), "exactly the plan's refs went");
    assert.deepEqual(copyStates(repo), [["sa_aaaaaaaa", "parked"], ["sa_dddddddd", "busy"]]);
    assert.equal(existsSync(join(big, "blob.bin")), true, "the link was taken as a link");
    assert.deepEqual(branches(repo), ["fix-login", "main", "routine-morning-brief-1028", "routine-morning-brief-1029", "routine-other-1027"]);
    assert.equal(existsSync(join(lane, "loose.txt")), true, "the worktree with its uncommitted file is as it was");
    assert.doesNotMatch(git(repo, "worktree", "list", "--porcelain"), /filament-worktrees[\\/]sa_bbbbbbbb/, "git's record of a copy that went goes with it");
    assert.deepEqual(readdirSync(home).filter((n) => n.includes("letting-go")), [], "nothing moved aside is left");

    // The ticked groups, ticked: they go — the helper's mark's hold no record shows, and the other chat's Undo point.
    const again = await read(repo);
    assert.deepEqual([again.goes, again.refs.tick], [0, 3]);
    const ticked = await call("POST", "/git/footprint/clean", { cwd: repo, plan: planOf(again, () => true) });
    assert.equal(ticked.status, 200, JSON.stringify(ticked.body));
    assert.deepEqual(ticked.body.went.refs, { subagents: 2, snapshots: 1, moves: 0, forks: 0, other: 0 });
    assert.equal(filamentRefNames(repo).some((r) => /sa_cccccccc|othr0001/.test(r)), false);
    await removeTaskWorktree(d.wt);
  });

  // (fails before: yes — the review's finding 1: with the other Filament stopped, or not holding a copy, its chats' Undo
  // points and a stopped Filament's copy went)
  test("a second Filament's data folder on the same repository: its refs never go unticked, live, stopped or gone; its copies go only once its data folder is gone", { skip }, async () => {
    const base = fresh("filament-footprint-two-");
    const ownData = join(base, "data-own");
    const liveData = join(base, "data-live");
    const stoppedData = join(base, "data-stopped");
    const goneData = join(base, "data-gone");
    for (const d of [ownData, liveData, stoppedData, goneData]) mkdirSync(d);
    const repo = repoIn(join(base, "proj"));
    const home = join(repo, ".git", "filament-worktrees");
    const head = git(repo, "rev-parse", "HEAD");
    // Each copy taken first — a free one would be taken for the next —, then given back free as the Filament running
    // from its data folder gives it back, its record naming that folder.
    /** @type {[string, string][]} */
    const whose = [["chk-own", ownData], ["chk-live", liveData], ["chk-stopped", stoppedData], ["chk-gone", goneData]];
    const taken = [];
    for (const [id] of whose) {
      const c = await openCheckTree(repo, { id, commit: head });
      assert.ok(c.ok, !c.ok ? c.error : "");
      taken.push(c.wt);
    }
    for (const [i, [, data]] of whose.entries()) {
      setCopiesHome(data);
      await releaseTaskWorktree(taken[i], "free");
    }
    setCopiesHome(ownData);
    const [mine, live, stopped, goneCopy] = taken.map((w) => w.dest);
    // The live one says it lives: a process that runs, its beat fresh.
    const beat = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    try {
      mkdirSync(join(home, ".alive"), { recursive: true });
      writeFileSync(join(home, ".alive", "aaaaaaaa-live-filament"), String(beat.pid));
      recordAs(live, { owner: "aaaaaaaa-live-filament" });
      recordAs(stopped, { owner: "bbbbbbbb-stopped-filament" });
      recordAs(goneCopy, { owner: "cccccccc-gone-filament" });
      rmSync(goneData, { recursive: true, force: true });
      // Each one's chats wrote Undo points and a way back; this one's own deleted chat too.
      for (const ref of ["snapshots/live0009/1-start", "snapshots/stop0009/1-start", "snapshots/gone0009/1-start", "moves/stop0009/u1/from", "snapshots/mine0001/1-start"])
        git(repo, "update-ref", `refs/filament/${ref}`, head);
      const { call, read } = routes(base, { dataDir: ownData, archive: archiveOf({ gone: { mine0001: {} } }) });
      const fp = await read(repo);
      assert.deepEqual(
        fp.copies.items.map((/** @type {any} */ c) => [c.name, c.goes, c.why]).sort(),
        [
          ["chk-gone", true, "free: nothing of it is anyone's; the data folder that made it is gone"],
          ["chk-live", false, "another Filament that works in this repository holds it"],
          ["chk-own", true, "free: nothing of it is anyone's"],
          ["chk-stopped", false, `another Filament's: its data folder ${resolve(stoppedData)} made it`],
        ].sort(),
      );
      assert.deepEqual(
        fp.refs.kinds.flatMap((/** @type {any} */ k) => k.groups.map((/** @type {any} */ g) => [k.kind, g.owner, g.goes, g.tick])),
        [["snapshots", "gone0009", false, true], ["snapshots", "live0009", false, true], ["snapshots", "mine0001", true, false], ["snapshots", "stop0009", false, true], ["moves", "stop0009", false, true]],
      );
      const before = filamentRefNames(repo);
      const done = await call("POST", "/git/footprint/clean", { cwd: repo, plan: planOf(fp) });
      assert.equal(done.status, 200, JSON.stringify(done.body));
      assert.deepEqual(filamentRefNames(repo), before.filter((r) => r !== "refs/filament/snapshots/mine0001/1-start"), "only this Filament's deleted chat's Undo point went");
      assert.deepEqual(copyStates(repo).map(([n]) => n), ["chk-live", "chk-stopped"]);
      assert.equal(existsSync(mine), false);
      // Ticked, a gone Filament's chat's Undo point goes; the others stay as they were.
      const again = await read(repo);
      const t = await call("POST", "/git/footprint/clean", { cwd: repo, plan: planOf(again, (g) => g.owner === "gone0009") });
      assert.equal(t.status, 200, JSON.stringify(t.body));
      assert.deepEqual(filamentRefNames(repo), ["refs/filament/moves/stop0009/u1/from", "refs/filament/snapshots/live0009/1-start", "refs/filament/snapshots/stop0009/1-start"]);
    } finally {
      beat.kill();
    }
  });

  // (fails before: yes — the review's findings 3 and 7: the press read again and took whatever went then)
  test("between the read and the press: a ref that moved, a copy used, a chat deleted since — each stays; the rest of the plan goes", { skip }, async () => {
    const base = fresh("filament-footprint-press-");
    const dataDir = join(base, "data");
    mkdirSync(dataDir);
    setCopiesHome(dataDir);
    const repo = repoIn(join(base, "proj"));
    const head = git(repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "b.txt"), "b\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "b");
    const next = git(repo, "rev-parse", "HEAD");
    const taken = [];
    for (const id of ["chk-a", "chk-b", "chk-c"]) {
      const c = await openCheckTree(repo, { id, commit: head });
      assert.ok(c.ok);
      taken.push(c.wt);
    }
    for (const wt of taken) await releaseTaskWorktree(wt, "free");
    for (const ref of ["snapshots/gone0001/1-start", "snapshots/gone0001/2-start", "snapshots/live0001/1-start"]) git(repo, "update-ref", `refs/filament/${ref}`, head);
    let live = ["live0001"];
    /** @type {Record<string, {}>} */
    const deleted = { gone0001: {} };
    const archive = {
      chainIds: () => [...live],
      hasChain: (/** @type {string} */ id) => live.includes(id),
      goneChains: () => new Map(Object.keys(deleted).map((id) => [id, { helpers: [], at: Date.now() }])),
      goneSince: () => 0,
      snapshotRefsNamed: () => new Set(),
    };
    const { call, read } = routes(base, { dataDir, archive });
    const fp = await read(repo);
    assert.deepEqual(fp.copies.items.map((/** @type {any} */ c) => c.goes), [true, true, true]);
    const plan = planOf(fp);
    // Meanwhile: one ref moves, the live chat is deleted, one copy is taken and given back, another is taken and kept.
    git(repo, "update-ref", "refs/filament/snapshots/gone0001/2-start", next);
    live = [];
    deleted.live0001 = {};
    await new Promise((r) => setTimeout(r, 5));
    const used = await openCheckTree(repo, { id: "chk-b", commit: head });
    assert.ok(used.ok);
    await releaseTaskWorktree(used.wt, "free");
    const held = await openCheckTree(repo, { id: "chk-c", commit: head });
    assert.ok(held.ok);
    const done = await call("POST", "/git/footprint/clean", { cwd: repo, plan });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.deepEqual(done.body.went.copies, ["chk-a"]);
    assert.deepEqual(done.body.went.refs, { subagents: 0, snapshots: 1, moves: 0, forks: 0, other: 0 });
    assert.deepEqual(filamentRefNames(repo), ["refs/filament/snapshots/gone0001/2-start", "refs/filament/snapshots/live0001/1-start"], "the moved ref and the one the sheet showed staying stay");
    assert.equal(git(repo, "rev-parse", "refs/filament/snapshots/gone0001/2-start"), next);
    const why = Object.fromEntries(done.body.stayed.map((/** @type {any} */ s) => [`${s.kind}: ${s.why}`, s.count]));
    assert.equal(why["snapshots: it moved since you read it"], 1);
    assert.equal(why["snapshots: the sheet you pressed on did not show it going"], 1);
    assert.equal(why["copies: it was used since you read it"], 1);
    assert.equal(why["copies: in use now"], 1);
    assert.deepEqual(copyStates(repo), [["chk-b", "free"], ["chk-c", "busy"]]);
    await removeTaskWorktree(held.wt);
  });

  test("a copy is read again under its claim: one in use, one used since, one another data folder's record names stays; a name out of the copies' home is refused", { skip }, async () => {
    const base = fresh("filament-footprint-claim-");
    const dataDir = join(base, "data");
    mkdirSync(dataDir);
    setCopiesHome(dataDir);
    const repo = repoIn(join(base, "proj"));
    const head = git(repo, "rev-parse", "HEAD");
    const c = await openCheckTree(repo, { id: "chk-9", commit: head });
    assert.ok(c.ok);
    await releaseTaskWorktree(c.wt, "free");
    const read = await readCopies(repo);
    assert.ok(read.ok);
    const at = Number(read.copies[0].meta?.at);
    assert.deepEqual(read.copies.map((x) => [x.name, x.meta?.state, x.meta?.home, x.whole, x.claimed, x.othersHold]), [["chk-9", "free", resolve(dataDir), true, false, false]]);
    const mineOnly = (/** @type {string | undefined} */ h) => h === resolve(dataDir);
    assert.deepEqual(await letGoCopy(repo, "chk-9", { keep: () => new Set(["chk-9"]), at, homes: mineOnly }), { ok: false, error: "in use now" });
    assert.deepEqual(await letGoCopy(repo, "chk-9", { at: at - 1, homes: mineOnly }), { ok: false, error: "it was used since you read it" });
    assert.deepEqual(await letGoCopy(repo, "chk-9", { at, homes: () => false }), { ok: false, error: "no record shows this Filament made it" });
    assert.deepEqual(await letGoCopy(repo, "../x", { at, homes: mineOnly }), { ok: false, error: "no copy goes by that name" });
    assert.deepEqual(await letGoCopy(repo, "chk-9", { at, homes: mineOnly }), { ok: true, left: null });
    assert.deepEqual(copyStates(repo), []);
  });

  // (fails before: yes — the review's (round 2) items 6 and 7: a data folder under a folder that does not read — a drive
  // not mounted — was taken for gone, and its copy went; a relative data folder took this Filament's own copies for
  // another's)
  test("a relative data folder knows its own copies; a data folder whose place does not read is not gone", { skip }, async () => {
    const base = fresh("filament-footprint-homes-");
    const dataDir = join(base, "data");
    mkdirSync(dataDir);
    const repo = repoIn(join(base, "proj"));
    const head = git(repo, "rev-parse", "HEAD");
    const taken = [];
    for (const id of ["chk-own", "chk-away", "chk-gone"]) {
      const c = await openCheckTree(repo, { id, commit: head });
      assert.ok(c.ok, !c.ok ? c.error : "");
      taken.push(c.wt);
    }
    // The data folder named as `--data-dir data` names it, from the folder Filament starts in.
    const was = process.cwd();
    /** @type {ReturnType<typeof routes>} */
    let rows;
    process.chdir(base);
    try {
      setCopiesHome("data");
      for (const wt of taken) await releaseTaskWorktree(wt, "free");
      rows = routes(base, { dataDir: "data" });
    } finally {
      process.chdir(was);
    }
    const away = join(base, "no-such-drive", "data");
    recordAs(taken[1].dest, { home: away, owner: "dddddddd-away-filament" });
    recordAs(taken[2].dest, { home: join(base, "data-gone"), owner: "eeeeeeee-gone-filament" });
    const fp = await rows.read(repo);
    assert.deepEqual(fp.copies.items.map((/** @type {any} */ c) => [c.name, c.goes, c.why]).sort(), [
      ["chk-away", false, `another Filament's: its data folder ${away} made it`],
      ["chk-gone", true, "free: nothing of it is anyone's; the data folder that made it is gone"],
      ["chk-own", true, "free: nothing of it is anyone's"],
    ]);
    const done = await rows.call("POST", "/git/footprint/clean", { cwd: repo, plan: planOf(fp) });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.deepEqual([...done.body.went.copies].sort(), ["chk-gone", "chk-own"]);
    assert.deepEqual(copyStates(repo).map(([n]) => n), ["chk-away"]);
  });

  // (fails before: yes — the review's (round 2) item 4: a folder a Clean up moved aside and could not remove stayed in
  // the repository's git folder, unseen, for ever)
  test("a folder a Clean up left is listed, with its disk, and goes with the next Clean up", { skip }, async () => {
    const base = fresh("filament-footprint-left-");
    const dataDir = join(base, "data");
    mkdirSync(dataDir);
    setCopiesHome(dataDir);
    const repo = repoIn(join(base, "proj"));
    const head = git(repo, "rev-parse", "HEAD");
    const c = await openCheckTree(repo, { id: "chk-1", commit: head });
    assert.ok(c.ok);
    await releaseTaskWorktree(c.wt, "free");
    const home = join(repo, ".git", "filament-worktrees");
    const aside = join(home, ".chk-0.letting-go-m1abc");
    mkdirSync(join(aside, "src"), { recursive: true });
    writeFileSync(join(aside, "src", "held.txt"), "x".repeat(1000));
    const { call, read } = routes(base, { dataDir });
    const line = await read(repo, false);
    assert.deepEqual([line.left.count, line.left.bytes, line.goes], [1, 1000, 2]);
    assert.deepEqual(line.left.items.map((/** @type {any} */ l) => [l.name, l.goes, l.why]), [[".chk-0.letting-go-m1abc", true, "a Clean up moved it aside to remove it, and its removal stopped part way: no Filament uses it"]]);
    assert.deepEqual(line.copies.items.map((/** @type {any} */ x) => x.name), ["chk-1"], "it is no copy");
    const done = await call("POST", "/git/footprint/clean", { cwd: repo, plan: planOf(await read(repo)) });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.deepEqual([done.body.went.left, done.body.went.copies, done.body.left], [[".chk-0.letting-go-m1abc"], ["chk-1"], []]);
    assert.equal(existsSync(aside), false);
    assert.deepEqual([(await read(repo, false)).left.count, readdirSync(home).filter((n) => n.includes("letting-go"))], [0, []]);
    assert.deepEqual(await sweepAside(repo, "chk-1"), { ok: false, error: "no folder a Clean up left goes by that name" });
    assert.deepEqual(await sweepAside(repo, ".x.letting-go-1/../../proj"), { ok: false, error: "no folder a Clean up left goes by that name" });
    assert.deepEqual(await sweepAside(repo, ".chk-0.letting-go-m1abc"), { ok: false, error: "it is gone already" });
  });

  // (fails before: yes — the review's (round 2) item 9: each group's refs went in a git process of their own, each
  // rewriting the packed refs)
  test("a press drops every group's refs in one git transaction; where a ref moved, only its group stays", { skip }, async () => {
    const base = fresh("filament-footprint-batch-");
    const dataDir = join(base, "data");
    mkdirSync(dataDir);
    const repo = repoIn(join(base, "proj"));
    const head = git(repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "b.txt"), "b\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "b");
    const next = git(repo, "rev-parse", "HEAD");
    const chats = ["gone0000", "gone0001", "gone0002", "gone0003"];
    const make = () => {
      for (const c of chats) for (const leaf of ["1-start", "2-start"]) git(repo, "update-ref", `refs/filament/snapshots/${c}/${leaf}`, head);
      git(repo, "pack-refs", "--all");
    };
    make();
    const { call, read } = routes(base, { dataDir, archive: archiveOf({ gone: Object.fromEntries(chats.map((c) => [c, {}])) }) });
    const trace = join(base, "trace.txt");
    /** What `run` gives, each git it starts tracing to `trace` meanwhile. @template T @param {() => Promise<T>} run */
    const traced = async (run) => {
      const had = process.env.GIT_TRACE;
      rmSync(trace, { force: true });
      process.env.GIT_TRACE = trace;
      try {
        return await run();
      } finally {
        if (had === undefined) delete process.env.GIT_TRACE;
        else process.env.GIT_TRACE = had;
      }
    };
    /** @param {any} plan */
    const press = (plan) => traced(() => call("POST", "/git/footprint/clean", { cwd: repo, plan }));
    const transactions = () => readFileSync(trace, "utf8").split(/\r?\n/).filter((l) => /trace: built-in: git update-ref --stdin/.test(l)).length;
    const plan = planOf(await read(repo));
    assert.equal(plan.refs.length, 8);
    const done = await press(plan);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.deepEqual([done.body.went.refs.snapshots, filamentRefNames(repo), transactions()], [8, [], 1], "four groups, one transaction");
    // A ref that moves after the press's own read: git refuses the one transaction whole, and each group is dropped
    // again on its own — only the group with the ref that moved stays.
    make();
    const at = (/** @type {string} */ c, /** @type {string} */ leaf) => ({ ref: `refs/filament/snapshots/${c}/${leaf}`, commit: head });
    git(repo, "update-ref", "refs/filament/snapshots/gone0002/2-start", next);
    const groups = chats.map((c) => [at(c, "1-start"), at(c, "2-start")]);
    const each = await traced(() => dropRefGroups(repo, groups));
    assert.deepEqual(each.map((r) => r.ok), [true, true, false, true]);
    assert.match(String(/** @type {any} */ (each[2]).error), /gone0002\/2-start/);
    assert.equal(transactions(), 1 + chats.length, "the one, then each group's");
    assert.deepEqual(filamentRefNames(repo), ["refs/filament/snapshots/gone0002/1-start", "refs/filament/snapshots/gone0002/2-start"], "a group goes whole or not at all");
    assert.deepEqual(await dropRefGroups(repo, []), []);
  });

  // (fails before: yes — the review's (round 2) item 1: Clean up took a deleted chat's Undo points while a memory backup
  // kept here held the chat, so restoring it brought the chat back without them)
  test("a chat deleted after the oldest memory backup kept was taken keeps its Undo points until they are ticked", { skip }, async () => {
    const base = fresh("filament-footprint-backup-");
    const dataDir = join(base, "data");
    mkdirSync(dataDir);
    const repo = repoIn(join(base, "proj"));
    const tree = git(repo, "rev-parse", "HEAD^{tree}");
    // Undo points written on 2026-01-01; one chat deleted on 02-01, another on 06-01; the oldest backup kept, 05-01.
    const old = execFileSync("git", ["commit-tree", tree, "-m", "old"], { cwd: repo, encoding: "utf8", env: { ...ENV, GIT_COMMITTER_DATE: "1767225600 +0000" }, windowsHide: true }).trim();
    for (const c of ["gone0001", "back0001"]) git(repo, "update-ref", `refs/filament/snapshots/${c}/1-start`, old);
    const archive = archiveOf({ gone: { gone0001: { at: Date.parse("2026-02-01T00:00:00Z") }, back0001: { at: Date.parse("2026-06-01T00:00:00Z") } } });
    const { call, read } = routes(base, { dataDir, archive, heldSince: Date.parse("2026-05-01T00:00:00Z") });
    const fp = await read(repo);
    assert.deepEqual(fp.refs.kinds[1].groups.map((/** @type {any} */ g) => [g.owner, g.goes, g.tick, g.why]), [
      ["back0001", false, true, "you deleted its chat after a memory backup kept here was taken: restoring that backup would bring the chat back without these"],
      ["gone0001", true, false, "you deleted its chat"],
    ]);
    const done = await call("POST", "/git/footprint/clean", { cwd: repo, plan: planOf(fp) });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.deepEqual(filamentRefNames(repo), ["refs/filament/snapshots/back0001/1-start"], "unticked, it stays");
    const ticked = await call("POST", "/git/footprint/clean", { cwd: repo, plan: planOf(await read(repo), () => true) });
    assert.equal(ticked.status, 200, JSON.stringify(ticked.body));
    assert.deepEqual(filamentRefNames(repo), [], "ticked, it goes");
  });

  test("two presses at once clean once; refusals in words; the rows are fenced; a press needs the plan its sheet showed", { skip }, async () => {
    const base = fresh("filament-footprint-fence-");
    const dataDir = join(base, "data");
    mkdirSync(dataDir);
    const repo = repoIn(join(base, "proj"));
    const plain = join(base, "plain");
    mkdirSync(plain);
    for (let i = 0; i < 3; i++) git(repo, "update-ref", `refs/filament/snapshots/gone000${i}/1-start`, "HEAD");
    const { call, read } = routes(base, { dataDir, archive: archiveOf({ gone: { gone0000: {}, gone0001: {}, gone0002: {} } }) });
    const plan = planOf(await read(repo));
    assert.equal(plan.refs.length, 3);
    const both = await Promise.all([call("POST", "/git/footprint/clean", { cwd: repo, plan }), call("POST", "/git/footprint/clean", { cwd: repo, plan })]);
    assert.deepEqual(both.map((x) => x.status).sort(), [200, 409], JSON.stringify(both.map((x) => x.body)));
    assert.equal(both.find((x) => x.status === 409)?.body.error, "a Clean up runs in this repository already");
    assert.deepEqual(filamentRefNames(repo), []);
    // With no record of its chats, an Undo point stays, and is no tick's either.
    git(repo, "update-ref", "refs/filament/snapshots/gone0001/1-start", "HEAD");
    const blind = routes(base, { dataDir });
    const fp = await blind.read(repo);
    assert.deepEqual([fp.goes, fp.refs.tick], [0, 0]);
    const none = await blind.call("GET", `/git/footprint?cwd=${encodeURIComponent(plain)}`);
    assert.deepEqual([none.status, none.body.ok, /not a git repository/.test(none.body.error)], [200, false, true], JSON.stringify(none.body));
    const refused = await blind.call("POST", "/git/footprint/clean", { cwd: plain, plan: { copies: [], refs: [], branches: [] } });
    assert.deepEqual([refused.status, refused.body.error], [409, "not in a git repository"]);
    const noPlan = await blind.call("POST", "/git/footprint/clean", { cwd: repo });
    assert.deepEqual([noPlan.status, noPlan.body.error], [400, "plan is the plan the sheet showed: { copies, refs, branches }, each as it was read"]);
    const badPlan = await blind.call("POST", "/git/footprint/clean", { cwd: repo, plan: { refs: [{ ref: "refs/heads/main", commit: "a".repeat(40) }] } });
    assert.equal(badPlan.status, 400);
    const outside = fresh("filament-footprint-outside-");
    assert.equal((await blind.call("GET", `/git/footprint?cwd=${encodeURIComponent(outside)}`)).status, 403);
    assert.equal((await blind.call("POST", "/git/footprint/clean", { cwd: outside, plan: { copies: [], refs: [], branches: [] } })).status, 403);
    assert.equal((await blind.call("GET", `/git/footprint?cwd=${encodeURIComponent(join(base, "nope"))}`)).status, 404);
    assert.equal((await blind.call("POST", "/git/footprint/clean", {})).status, 400);
  });

  // (fails before: yes — the review's finding 6: past git's 8 MB answer the read failed whole)
  test("refs past what one git answer holds are read a part at a time, each with its commit, its tree and its time", { skip }, async () => {
    const base = fresh("filament-footprint-many-");
    const repo = repoIn(join(base, "proj"));
    const head = git(repo, "rev-parse", "HEAD");
    const tree = git(repo, "rev-parse", "HEAD^{tree}");
    const names = [];
    for (let c = 0; c < 700; c++)
      for (let n = 0; n < 100; n++) names.push(`refs/filament/snapshots/c${String(c).padStart(7, "0")}/${n}-start-in-a-place-whose-name-is-long-enough`);
    names.sort();
    writeFileSync(join(repo, ".git", "packed-refs"), `# pack-refs with: peeled fully-peeled sorted \n${names.map((r) => `${head} ${r}`).join("\n")}\n`);
    const whole = Buffer.byteLength(git(repo, "for-each-ref", "--format=%(refname)%09%(objectname)%09%(tree)%09%(committerdate:unix)", "refs/filament/"));
    assert.ok(whole > 8 * 1024 * 1024, `past one answer: ${whole} bytes`);
    const got = await filamentRefs(repo);
    assert.ok(got.ok, !got.ok ? got.error : "");
    assert.equal(got.refs.length, 70_000);
    assert.equal(new Set(got.refs.map((r) => r.ref)).size, 70_000, "each once");
    assert.deepEqual([got.refs[0].commit, got.refs[0].tree, typeof got.refs[0].date], [head, tree, "number"]);
  });

  test("a folder's measure stops at its budget and says so", async () => {
    const dir = fresh("filament-footprint-measure-");
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `f${i}.txt`), "12345");
    assert.deepEqual(await folderBytes(dir, { until: Date.now() + 10_000, entries: 1000 }), { bytes: 25, partial: false });
    const cut = await folderBytes(dir, { until: Date.now() - 1, entries: 1000 });
    assert.deepEqual(cut, { bytes: 0, partial: true });
  });
});
