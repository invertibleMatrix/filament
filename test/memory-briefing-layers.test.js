// The session briefing's blocks, each in its own share (the owner's of 10-29: "the memory system could have done a
// better job when i started the session"). A session opened with "hello" in webshop was told none of the project's
// recent sessions — three rows that did not fit together behind a full dossier left none, and one of them said the perf
// work was merged — while recall on "hello" filled the rest, two of its lines saying it was not merged; and nothing said
// where the repository stood or what its last commits were. The blocks git and a session's end state fill are small
// (the memory plan's e1): the room is the dossier's and recall's, what only memory holds.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryBrain, RELATED_HEAD, signalsOf } from "../src/services/memory/brain.js";
import { Archive } from "../src/services/memory/archive.js";

const dir = mkdtempSync(join(tmpdir(), "memory-briefing-layers-"));
/** @type {any[]} */
const opened = [];
after(() => {
  for (const a of opened) a.close();
  rmSync(dir, { recursive: true, force: true });
});

const HOME = join(tmpdir(), "briefing-layers-app");
const RELEASE = "How to cut a release: 1. run the full suite in an exported copy 2. bump the version in package.json 3. tag it v<version> and push the tag";

/**
 * A project whose dossier fills its room — six confirmed facts and six decisions, each a long sentence —, three earlier
 * chats with long summaries and open items, the user's rule, a procedure, and this session.
 * @param {string} name
 */
const world = (name) => {
  const archive = /** @type {any} */ (new Archive({ file: join(dir, `${name}.db`) }));
  opened.push(archive);
  const long = (/** @type {string} */ what) => `${what} ${"and what it means for the work that follows it ".repeat(8)}`;
  for (const i of [1, 2, 3]) {
    const c = archive.chainForKey(`${name}-k${i}`, { cwd: HOME });
    archive.setTitle(c.id, `chat ${i}`);
    archive.setState(c.id, { summary: long(`summary ${i}: the perf work landed on main`), open: [long("one"), long("two"), long("three")] });
  }
  const me = archive.chainForKey(`${name}-k0`, { cwd: HOME });
  const pid = me.project_id;
  archive.items.add({ projectId: pid, kind: "rule", text: "Never push without the owner's word.", status: "confirmed", importance: 0.9 });
  for (const n of [1, 2, 3, 4, 5, 6]) {
    archive.items.add({ projectId: pid, kind: "fact", text: `Fact ${n} of the project: the server keeps its sessions in one archive, and every client reaches it through the same port on this computer.`, status: "confirmed", importance: 0.8 });
    archive.items.add({ projectId: pid, kind: "decision", text: `Decision ${n} of the project: the owner chose to reset the data over keeping compatibility, so old folders are read once and set aside.`, status: "confirmed", importance: 0.8 });
  }
  const release = archive.items.add({ projectId: pid, kind: "procedure", text: RELEASE, status: "confirmed", importance: 0.8 });
  // Learned once, unconfirmed: recall finds it for a task that names its words; the dossier never shows it.
  archive.items.add({ projectId: pid, kind: "fact", text: "The flaky archive test passes once the lint cache is cleared first.", importance: 0.7 });
  /**
   * @param {{ briefingTokens?: number, newest?: string, repoState?: any, cwd?: string, store?: any }} [o]  the signals are read from `newest`
   */
  const brief = ({ briefingTokens = 1200, newest = "hello", repoState = null, cwd = HOME, store = undefined } = {}) =>
    new MemoryBrain({ archive, getConfig: () => ({ enabled: true, autopilot: { briefingTokens } }), repoState, store }).buildBriefing({
      chain: archive.getChain(me.id),
      sit: { project: { id: pid, name: "app", cwd }, newest, key: `${name}-k0` },
      signals: signalsOf(newest),
    });
  return { archive, me, pid, release: `i${release.id}`, brief };
};
const LEARNED = "The flaky archive test passes once the lint cache is cleared first.";

/** The lines of a block, from its head to the next blank-free head. @param {string} text @param {string} head */
const block = (text, head) => {
  const at = text.indexOf(head);
  if (at < 0) return [];
  return text.slice(at + head.length + 1).split("\n").filter((l, i, all) => all.slice(0, i + 1).every((x) => x.startsWith("- ")));
};

// (fails before: yes — the recent sessions had to fit, all three together, under 55% of the briefing after the rules
// and a dossier of up to 35%: behind a full dossier none were told, the live briefing of 10-29 among them; e1: a row
// carried up to three of its open items, which the project's open threads hold, and only two rows fit)
test("a full dossier no longer leaves the recent sessions out: each row what it ended with and how much it left open", async () => {
  const w = world("full");
  const out = await w.brief();
  assert.ok(out.text.includes("The project's dossier"), "the dossier is there");
  const rows = block(out.text, "Recent sessions in this project:");
  assert.ok(rows.length >= 2, out.text);
  assert.ok(rows[0].includes("summary 3: the perf work landed on main") && rows[0].endsWith(" — 3 left open"), `the newest: ${rows[0]}`);
  assert.ok(rows.every((l) => !l.includes("open: ") && l.length <= 260), rows.join("\n"));
  assert.equal(block((await w.brief({ briefingTokens: 4500 })).text, "Recent sessions in this project:").length, 3, "at the budget's default, every one");
  assert.deepEqual(
    (out.cue?.sessions || []).map((/** @type {any} */ s) => s.title),
    rows.map((l) => /"([^"]+)"/.exec(l)?.[1]),
    "the note names the chats the briefing did, and only those",
  );
});

// (fails before: yes — recall ran on "hello", and the procedures were only ever listed by goal)
test("a first message with no task gets no recall: the project's procedures come whole, the dossier no longer lists them by goal", async () => {
  const w = world("hello");
  const out = await w.brief({ briefingTokens: 4500 });
  const howTo = block(out.text, "How things are done in this project (its procedures, whole):");
  assert.equal(howTo.length, 1, out.text);
  assert.ok(howTo[0].endsWith(RELEASE), howTo[0]);
  assert.ok(!out.text.includes("How to cut a release (3 steps)"), "not listed by goal beside it");
  assert.ok(!out.text.includes("Relevant memory:") && !out.text.includes(LEARNED), "no recall");
  assert.ok(out.sources.split("+").includes("procedures"), out.sources);
  assert.ok(out.ids.includes(w.release) && !out.listed.includes(w.release), "shown whole: recall never serves it again");
  // A message with a task: as before — the dossier lists the procedure by goal, its steps come when the task names it;
  // recall finds what the task names.
  const task = await w.brief({ newest: "fix the flaky archive test", briefingTokens: 4500 });
  assert.ok(!task.text.includes("How things are done in this project"), task.text);
  assert.ok(task.text.includes("How to cut a release (3 steps)"), task.text);
  assert.ok(block(task.text, "Relevant memory:").some((l) => l.endsWith(LEARNED)), task.text);
  // (fails before: yes — the reviewer's of 10-29: a short task was trivial by its length, and lost its recall) "fix lint"
  // has its words.
  const short = await w.brief({ newest: "fix lint", briefingTokens: 4500 });
  assert.ok(block(short.text, "Relevant memory:").some((l) => l.endsWith(LEARNED)), short.text);
  assert.ok(!short.text.includes("How things are done in this project"), "a task: the procedures by goal");
});

// (fails before: yes — the reviewer's of 10-29: a curator's line citing the procedure beside another claim kept it
// listed by goal, so recall could serve its steps again beside the steps the briefing showed whole)
test("a procedure shown whole is not served again, though the curator's line that cites it beside a fact stays", async () => {
  const w = world("mixed");
  const fact = w.archive.items.add({ projectId: w.pid, kind: "fact", text: "Releases go out on Thursdays.", status: "confirmed", importance: 0.8 });
  w.archive.dossiers.add({
    projectId: w.pid,
    sections: [{ title: "How to", lines: [{ text: "Ship a release on a Thursday, as its procedure says.", cites: [w.release, `i${fact.id}`] }] }],
    cites: [Number(w.release.slice(1)), fact.id],
    basis: "test",
  });
  const out = await w.brief({ briefingTokens: 4500 });
  assert.ok(out.text.includes("- Ship a release on a Thursday, as its procedure says."), out.text);
  assert.ok(block(out.text, "How things are done in this project (its procedures, whole):").some((l) => l.endsWith(RELEASE)), out.text);
  assert.deepEqual(out.listed, [], "nothing left for recall to serve whole");
  assert.ok(!out.text.includes('A "How to" line names a procedure'), "no line to ask its steps of");
});

/** A worktree one behind main, beside main's own folder and a merged worktree with work uncommitted. */
const STANDING = {
  place: "C:/w/app-hello",
  main: "C:/w/app",
  worktree: true,
  branch: "hello",
  head: "c8a4b7b",
  base: "main",
  baseHead: "621a8a4",
  onBase: false,
  ahead: 0,
  behind: 1,
  fresh: false,
  uncommitted: { files: 0, added: 0, removed: 0 },
  worktrees: [
    { path: "C:/w/app", main: true, branch: "main", head: "621a8a4", onBase: true, ahead: 0, behind: 0, fresh: false, uncommitted: { files: 0, added: 0, removed: 0 }, missing: false },
    { path: "C:/w/app-perf", main: false, branch: "perf", head: "4ae14a9", onBase: false, ahead: 0, behind: 3, fresh: false, uncommitted: { files: 2, added: 10, removed: 1 }, missing: false },
  ],
  moreWorktrees: 0,
  own: [],
  commits: [
    { short: "621a8a4", date: "2026-10-29", subject: "A Space's first screen says what it is for: while it holds nothing, Start here — Make an app" },
    { short: "c8a4b7b", date: "2026-10-28", subject: "version bump" },
  ],
};

// (fails before: yes — nothing told a session where its repository stood; memory's own line said the perf work was not
// merged, which git would have contradicted)
test("where the repository stands and its newest commit come from git, read as the session starts, for the session's folder", async () => {
  const w = world("git");
  /** @type {string[]} */
  const asked = [];
  const out = await w.brief({ briefingTokens: 4500, repoState: async (/** @type {string} */ folder) => (asked.push(folder), STANDING) });
  assert.deepEqual(asked, [HOME]);
  const here = block(out.text, "Where things stand (git, read as this session started; ask git for the state now):");
  assert.deepEqual(here, [
    "- This folder: C:\\w\\app-hello (a worktree of C:\\w\\app), on hello @ c8a4b7b — merged into main; main has 1 more; main @ 621a8a4; clean",
    "- Other worktrees (git worktree list): on main: app; merged into main: app-perf (2 uncommitted)",
    "- Newest commit on main: 2026-10-29 621a8a4 A Space's first screen says what it is for (git log main for the rest)",
  ]);
  // (fails before: yes — the base's newest commits were a block of their own, which the client's own git status repeats)
  assert.ok(!out.text.includes("Recent commits"), out.text);
  assert.ok(out.sources.split("+").includes("git"), out.sources);
  // A reader that fails leaves the blocks out, and the rest stands.
  const failed = await w.brief({ briefingTokens: 4500, repoState: async () => { throw new Error("git is not installed"); } });
  assert.ok(!failed.text.includes("Where things stand"), failed.text);
  assert.ok(failed.text.includes("Recent sessions in this project:"), failed.text);
});

// (fails before: yes — a session's row never said its folder, and the owner works in several worktrees of one project)
test("a recent session worked in another folder of the project says which", async () => {
  const w = world("folders");
  const other = join(tmpdir(), "briefing-layers-app-perf");
  const c = w.archive.chainForKey("folders-k9", { cwd: HOME, meta: { cwd: other } });
  w.archive.setTitle(c.id, "performance_issues");
  w.archive.setState(c.id, { summary: "landed all pending work on main" });
  const out = await w.brief({ briefingTokens: 4500 });
  const row = block(out.text, "Recent sessions in this project:").find((l) => l.includes('"performance_issues"'));
  assert.ok(row && row.includes(` — in ${other} — landed all pending work on main`), row);
  assert.ok(!block(out.text, "Recent sessions in this project:").some((l) => l.includes('"chat 1"') && l.includes(" — in ")), "one in this folder says none");
  // (fails before: yes — the reviewer's of 10-29: a chain keeps its folder only where it is not the project's, so from
  // a worktree a session of the main folder read as one of this folder)
  const fromWorktree = await w.brief({ briefingTokens: 4500, cwd: other });
  const main = block(fromWorktree.text, "Recent sessions in this project:").find((l) => l.includes('"chat 3"'));
  assert.ok(main && main.includes(` — in ${HOME} — `), main);
  assert.ok(!block(fromWorktree.text, "Recent sessions in this project:").some((l) => l.includes('"performance_issues"') && l.includes(" — in ")), "the worktree's own says none");
});

// (fails before: yes — the owner's of 10-30: "before working on anything verify all these claims since they are coming
// from memory system and a lot might have changed since then … telling it would help agent not take these words as source
// of truth which could be a disaster"; the head said only "it may be outdated", after the lines' marks)
test("memory says first that its lines are leads to check against the code and the system now, the user's rules excepted", async () => {
  const w = world("leads");
  const out = await w.brief({ briefingTokens: 4500 });
  const head = out.text.split("\n")[0];
  assert.match(head, /^Long-term memory \(Filament\): what past sessions recorded about the user and this project — leads, not the source of truth\. /);
  assert.match(head, /Before you act on a line — a file, a function, a setting, a command, the state of the work, what is done or still open — check it against the code, git and the running system now; never build on it unchecked\./);
  assert.ok(head.indexOf("never build on it unchecked") < head.indexOf("Each line starts with its id"), "said before how to read a line");
  assert.match(head, /The user's own rules and preferences are their instructions, not claims: follow them\./);
  assert.match(head, /When what you find contradicts a memory, trust what you find/);
  // The turn's recalled claims say it under their own heading.
  const brain = /** @type {any} */ (new MemoryBrain({ archive: w.archive, getConfig: () => ({ enabled: true }) }));
  const fact = w.archive.items.get(Number(w.release.slice(1)));
  brain.retrieve = async () => ({ items: [fact], sources: "fts" });
  const turn = await brain.buildTurnBlock({ chain: w.archive.getChain(w.me.id), sit: { project: { id: w.pid, name: "app", cwd: HOME }, newest: "how do we cut a release" }, signals: { entities: [] }, budgetTokens: 300, excludeIds: [] });
  assert.equal(turn.text.split("\n")[0], RELATED_HEAD);
  assert.equal(RELATED_HEAD, "Related memory for this message (Filament; claims from past sessions, not the source of truth — check each against the code and the system now before acting on it):");
});

// (fails before: yes — the briefing read the engine's canonical facts of every owner; the user's word of no project had
// no place of its own: e1 capped those at six, f5 gives the place to the user's facts that hold in every project)
test("the facts about the user: their word of no project, six at most in a tenth of the briefing, one in a slot about them first", async () => {
  const w = world("identity");
  for (let i = 0; i < 10; i++) w.archive.items.add({ projectId: null, kind: "fact", text: `The user's fact number ${i}.`, status: "confirmed", importance: 0.8 });
  w.archive.items.add({ projectId: null, kind: "fact", text: "The user wants short answers, no lists.", status: "confirmed", importance: 0.8, slot: { slot: "user · answer style", value: "short", multi: false } });
  // Learned once, never their word, and a project's own: none of them is told here.
  w.archive.items.add({ projectId: null, kind: "fact", text: "The user may like dark themes.", importance: 0.6 });
  w.archive.items.add({ projectId: w.pid, kind: "fact", text: "The user runs this project's tests on Fridays.", status: "confirmed", importance: 0.8 });
  const out = await w.brief({ briefingTokens: 4500 });
  const lines = block(out.text, "What holds in every project (the user's own word):");
  assert.equal(lines.length, 6, out.text);
  assert.match(lines[0], /^- \[i\d+ fact · [^\]]+\] The user wants short answers, no lists\.$/);
  assert.match(lines[1], /\] The user's fact number 0\.$/);
  assert.ok(out.text.includes("…and 5 more; filament_memory_search finds them."), out.text);
  assert.ok(!lines.some((l) => /dark themes|on Fridays/.test(l)), out.text);
  assert.ok(!out.text.includes("dark themes"), "learned once, never their word: not in the briefing's own blocks");
});
