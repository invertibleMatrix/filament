// @ts-check
// HarnessV4_Tasks E15 step 4, the change an agent hands over. The agent's own tool takes `changes` (L-43), as the
// launch route does: a reviewer is handed the change as a patch, and nobody pastes it. Two sources are new: what the
// turn running now has changed so far (AG-82), read from the snapshots that turn took, and a range `since:<ref>`
// (L-44, AG-81), from a commit, tag or branch to the folder as it stands. A follow-up carries one too ("check again").
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";
import { until } from "./helpers/wait.js";
import { CHANGE_SOURCES, changeSource, changesView } from "../src/app/sessions/changes-view.js";
import { isRev } from "../src/adapters/git/changes.js";
import { snapshotTree } from "../src/adapters/git/snapshot.js";
import { parseSubagentCommand } from "../src/app/commands/parse.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { AGENT_TOOL, coderAgentToolFor } from "../src/app/agent/tools.js";
import { TOOL_TEXT } from "../src/app/agent/prompt.js";
import { createAgentCardStore, askablesOf } from "../src/services/agent-cards.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" }).trim();
/** A repository: `a.txt` committed and tagged `v1`. @param {string} [prefix] */
const repo = (prefix = "filament-chg-") => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  git(dir, "init", "-q");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "first");
  git(dir, "tag", "v1");
  return dir;
};

// (fails before: yes — a launch took two sources, and any other word was refused)
describe("the change a launch names", () => {
  test("three sources have a name; a range is `since:` and one word git could read as a commit", () => {
    assert.deepEqual([...CHANGE_SOURCES], ["running", "turn", "uncommitted"]);
    for (const s of ["running", "turn", "uncommitted", "since:v1.2", "since:main", "since:HEAD~3", "since:origin/main", "since:0a1b2c3", "since:@{1}"]) assert.deepEqual(changeSource(s), { ok: true, source: s }, s);
    for (const none of [null, undefined, "", "  "]) assert.deepEqual(changeSource(none), { ok: true, source: null });
    assert.deepEqual(changeSource("everything"), { ok: false, error: "changes must be one of running, turn, uncommitted, or since:<a commit, tag or branch>" });
    assert.deepEqual(changeSource("since:"), { ok: false, error: "since: needs a commit, tag or branch after it, as in since:v1.2" });
    // Never an option of git's, never two points, never a path inside a commit.
    for (const bad of ["--help", "-n1", "main..dev", "HEAD:a.txt", "a b"]) {
      assert.equal(isRev(bad), false, bad);
      assert.deepEqual(changeSource(`since:${bad}`), { ok: false, error: `\`${bad}\` is not a commit, tag or branch as git names one` });
    }
  });

  test("/subagent takes it before the task, on a launch and on a follow-up", () => {
    const l = /** @type {any} */ (parseSubagentCommand("/subagent as=reviewer changes=since:v1.2 what broke?"));
    assert.deepEqual([l.action, l.as, l.changes, l.prompt], ["launch", "reviewer", "since:v1.2", "what broke?"]);
    const a = /** @type {any} */ (parseSubagentCommand("/subagent ask sa_0123abcd changes=running check again"));
    assert.deepEqual([a.action, a.id, a.changes, a.prompt], ["ask", "sa_0123abcd", "running", "check again"]);
    assert.equal(/** @type {any} */ (parseSubagentCommand("/subagent look at the changes=turn option")).changes, null, "a word inside the task is the task's");
  });

  test("the agent's tool has the field, in each of its forms", () => {
    const cards = createAgentCardStore({ dataDir: null });
    const asks = askablesOf(["product"], (tag) => cards.find(tag));
    assert.deepEqual(AGENT_TOOL.input_schema.properties.changes, { type: "string", description: TOOL_TEXT.agentChanges });
    for (const source of ["running (", "turn (", "uncommitted (", "since:<ref> ("]) assert.ok(TOOL_TEXT.agentChanges.includes(source), source);
    assert.equal(coderAgentToolFor({ asks })?.input_schema.properties.changes, AGENT_TOOL.input_schema.properties.changes, "a coding agent launching Filament's sub-agents");
    assert.equal(coderAgentToolFor({ asks })?.input_schema.properties.changes, AGENT_TOOL.input_schema.properties.changes, "and one that only asks saved agents");
  });
});

// (fails before: yes — nothing read a range; and a session whose folder sits below its repository's top was handed
// no patch of a file changed elsewhere in the repository, only its name)
describe("a change as a patch, read from git", () => {
  const view = (/** @type {string} */ folder, /** @type {string} */ source) => changesView({ source, folder, turn: 0, rounds: null });

  test("a range: what was committed since, what is uncommitted, and the files git does not track yet", async () => {
    const dir = repo();
    assert.deepEqual(await view(dir, "since:v1"), { source: "since", ref: "v1", text: "", files: 0, shown: 0, turn: null, note: "nothing has changed since `v1`" });
    writeFileSync(join(dir, "b.txt"), "committed since\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "second");
    writeFileSync(join(dir, "a.txt"), "one\ntwo, not committed\n");
    writeFileSync(join(dir, "c.txt"), "not tracked\n");
    const v = await view(dir, "since:v1");
    assert.deepEqual([v.source, v.ref, v.files, v.shown, v.turn, v.note], ["since", "v1", 3, 3, null, null]);
    for (const part of ["+++ b/b.txt", "+committed since", "+two, not committed", "+++ b/c.txt", "+not tracked"]) assert.ok(v.text.includes(part), `${part} — in:\n${v.text}`);
    // From the second commit on, the first's file is no part of it.
    const later = await view(dir, "since:HEAD");
    assert.deepEqual([later.files, later.text.includes("b/b.txt")], [2, false]);
  });

  test("a point git does not know is said, and marked as the caller's word; no repository is said as it is", async () => {
    const dir = repo();
    assert.deepEqual(await view(dir, "since:v9"), { source: "since", ref: "v9", text: "", files: 0, shown: 0, turn: null, note: "git knows no commit, tag or branch `v9` in this repository", refused: true });
    const bare = mkdtempSync(join(tmpdir(), "filament-chg-none-"));
    made.push(bare);
    const none = await view(bare, "since:v1");
    assert.deepEqual([none.refused ?? false, /not a git repository/.test(String(none.note))], [false, true], String(none.note));
  });

  test("a turn that runs: none running, none recorded yet, each in words", async () => {
    const dir = repo();
    assert.equal((await view(dir, "running")).note, "no turn is running in the session now");
    const open = await changesView({ source: "running", folder: dir, turn: 3, rounds: null });
    assert.deepEqual([open.source, open.turn, open.note], ["running", 3, "turn 3, running now, has recorded no change so far (it has written nothing in a round that ended, or snapshots are off)"]);
  });

  // (fails before: yes — HarnessV4_Git_Plan §1.2: a turn's patch was the diff of the whole folder between its
  // snapshots, so a file written by hand meanwhile was handed over as the agent's, and one in another place was in
  // none)
  test("a turn's patch is its agents' own files, in every place; what else changed is named, never shown as theirs", async () => {
    const dir = repo();
    const other = repo("filament-chg-other-");
    const head = git(dir, "rev-parse", "HEAD");
    writeFileSync(join(dir, "own.txt"), "the agent's\n");
    writeFileSync(join(dir, "hand.txt"), "by hand\n");
    writeFileSync(join(dir, "made.txt"), "by its command\n");
    const s = await snapshotTree(dir, { name: "c1/3-1" });
    writeFileSync(join(other, "far.txt"), "in another repository\n");
    const o = await snapshotTree(other, { name: "c1/3-1-in-x" });
    const outside = join(tmpdir(), "filament-chg-nowhere", "loose.txt");
    /** @type {import("../src/services/memory/archive.js").RoundChange[]} */
    const rounds = [
      { place: git(dir, "rev-parse", "--show-toplevel"), round: 1, agent: "", before: head, after: String(s.commit), base: "round", own: ["own.txt"], command: false },
      { place: git(other, "rev-parse", "--show-toplevel"), round: 1, agent: "", before: String(o.parent), after: String(o.commit), base: "head", own: ["far.txt"], command: false },
      { place: "", round: 1, agent: "", before: null, after: null, base: "none", own: [outside], command: false },
    ];
    const v = await changesView({ source: "turn", folder: dir, turn: 3, rounds });
    assert.deepEqual([v.source, v.turn, v.files, v.shown, v.note], ["turn", 3, 2, 2, null]);
    assert.ok(v.text.includes("+++ b/own.txt") && v.text.includes(`# in ${rounds[1].place}\n`) && v.text.includes("+++ b/far.txt"), v.text);
    assert.ok(!v.text.includes("hand.txt") && !v.text.includes("made.txt"), "nobody's call named them");
    assert.ok(v.text.includes(`it also wrote outside any repository, so with no diff: ${outside}`), v.text);
    const ran = await changesView({ source: "turn", folder: dir, turn: 3, rounds: [{ ...rounds[0], command: true }] });
    assert.match(ran.text, /2 more files changed while its commands ran — by them or by someone else, Filament cannot tell: hand\.txt, made\.txt\./);
    // (fails before: yes — GW-D57: a session alone in its folder had its commands' files named apart, as anyone's)
    const alone = await changesView({ source: "turn", folder: dir, turn: 3, rounds: [{ ...rounds[0], command: true }], alone: new Set([rounds[0].place]) });
    assert.deepEqual([alone.files, alone.text.includes("+++ b/made.txt"), /while its commands ran/.test(alone.text)], [3, true, false], alone.text);
    assert.match(alone.text, /\(Filament: 2 of these changed through its commands, not its edit calls, in a folder only this session works in: hand\.txt, made\.txt\.\)/);
  });

  test("a session's folder below the repository's top is handed the patch of a file changed beside it", async () => {
    const dir = repo();
    mkdirSync(join(dir, "app"));
    mkdirSync(join(dir, "lib"));
    writeFileSync(join(dir, "app", "x.txt"), "x\n");
    writeFileSync(join(dir, "lib", "y.txt"), "y\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "two folders");
    writeFileSync(join(dir, "lib", "y.txt"), "y\nchanged beside the session's folder\n");
    const v = await view(join(dir, "app"), "uncommitted");
    assert.deepEqual([v.files, v.shown, v.text.includes("+changed beside the session's folder")], [1, 1, true], v.text);
  });

  // (fails before: yes — the bug hunt of 10-30, GIT-1: git named a new folder whole, `newdir/`, and reading it as a file
  // threw EISDIR out of the view, uncommitted and since a point alike)
  test("a new folder's files are each read as an addition; a repository inside the folder is named, never read as a file", async () => {
    const dir = repo();
    mkdirSync(join(dir, "newdir", "deeper"), { recursive: true });
    writeFileSync(join(dir, "newdir", "x.txt"), "ex\n");
    writeFileSync(join(dir, "newdir", "deeper", "y.txt"), "why\n");
    const v = await view(dir, "uncommitted");
    assert.deepEqual([v.files, v.shown, v.note], [2, 2, null]);
    for (const part of ["+++ b/newdir/x.txt", "+ex", "+++ b/newdir/deeper/y.txt", "+why"]) assert.ok(v.text.includes(part), `${part} — in:\n${v.text}`);
    const since = await view(dir, "since:v1");
    assert.deepEqual([since.files, since.shown, since.text.includes("+why")], [2, 2, true]);
    // A repository of its own inside it: git never looks into one, and names it whole even file by file.
    const nested = join(dir, "nested");
    mkdirSync(nested);
    git(nested, "init", "-q");
    writeFileSync(join(nested, "n.txt"), "n\n");
    const more = await view(dir, "uncommitted");
    assert.deepEqual([more.files, more.shown], [3, 2]);
    assert.ok(more.text.includes("(Filament: 1 more changed file not shown here — nested/; read them where you need them.)"), more.text);
    // git's own setting that untracked files are not listed stands.
    git(dir, "config", "status.showUntrackedFiles", "no");
    assert.equal((await view(dir, "uncommitted")).note, "nothing is uncommitted in the session's folder");
  });
});

// ---------------------------------------------------------------------------------------------------
// The registry: what a launch and a follow-up carry, and what their marks say
// ---------------------------------------------------------------------------------------------------

/** A registry over a scripted host whose session's view answers a change with a fixed patch. */
function scripted() {
  /** @type {any[]} */
  const posts = [];
  /** @type {any[]} */
  const marks = [];
  /** @type {any[]} */
  const asked = [];
  const cards = createAgentCardStore({ dataDir: null });
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { pool: [{ model: "m-sub", seats: 4 }], view: "none", worktree: false }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: tmpdir(), model: "m", projectId: null }),
      view: async (_chain, _strategy, o = {}) => {
        asked.push(o.changes ?? null);
        const source = String(o.changes || "");
        if (!source) return null;
        if (source === "since:v9") return { text: "", turns: 0, turn: 0, running: null, waiting: null, changes: { source: "since", ref: "v9", text: "", files: 0, shown: 0, turn: null, note: "git knows no commit, tag or branch `v9` in this repository", refused: true } };
        // A session with nothing to show yet: whatever is named holds no patch, and says why.
        if (_chain === "c-new") return { text: "", turns: 0, turn: 0, running: null, waiting: null, changes: { source, text: "", files: 0, shown: 0, turn: null, note: "the session has no finished turn yet" } };
        const since = source.startsWith("since:") ? source.slice(6) : null;
        return { text: "", turns: 0, turn: 0, running: null, waiting: null, changes: { source: since ? "since" : source, ...(since ? { ref: since } : {}), text: `PATCH of ${source}`, files: 2, shown: 2, turn: source === "running" ? 4 : source === "turn" ? 3 : null, note: null } };
      },
      brief: async () => null,
      modelProblem: () => null,
      mark: (chainId, m) => {
        marks.push({ chainId, ...m });
        return { ...m, afterTurn: 1 };
      },
    },
    call: async ({ body, headers = {} }) => {
      posts.push({ body, headers });
      const id = headers["x-filament-subagent"];
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      registry.finish(id, { status: "done", error: null, report: `REPORT ${n}`, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: `REPORT ${n}` }] }], rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: `REPORT ${n}` }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return { registry, posts, marks, asked };
}
/** The text blocks of a request's newest message. @param {any} post */
const lastTexts = (post) => post.body.messages.at(-1).content.filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => String(b.text));

// (fails before: yes — the agent's tool had no `changes`: a reviewer it launched was handed nothing, and a follow-up
// never carried a change)
describe("what a launch and a follow-up carry", () => {
  test("the agent's tool hands the change over, each source in its own words, and a follow-up carries one again", async () => {
    const { registry, posts, asked } = scripted();
    const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: tmpdir(), mode: "edit", model: "m", thinking: null, fork: null });
    try {
      const first = await door.subagents.run({ id: "toolu_1", input: { run_in_background: false, description: "review it", prompt: "is the retry right?", subagent_type: "reviewer", changes: "running" }, emit: () => {}, signal: null });
      const id = String(/agent_id "(sa_[0-9a-f]{8})"/.exec(first.text)?.[1]);
      assert.deepEqual(lastTexts(posts[0]), [
        `<changes source="running" files="2">\nWhat turn 4 of the session, the turn running now, has changed up to its last finished round, as a patch (2 files). Not your work: the main agent's. Background only — your task follows.\n\nPATCH of running\n</changes>`,
        "is the retry right?",
      ]);
      const row = registry.get(id);
      assert.deepEqual([row?.changes, row?.exchanges[0].handed], ["running", { source: "running", files: 2 }]);
      assert.ok(!first.text.includes("no change was handed"), "a patch that was handed over is not spoken of");
      await door.subagents.run({ id: "toolu_2", input: { run_in_background: false, description: "again", agent_id: id, prompt: "check again", changes: "since:v1.2" }, emit: () => {}, signal: null });
      assert.deepEqual(lastTexts(posts[1]).slice(-2), [
        `<changes source="since" since="v1.2" files="2">\nEverything that changed in the session's folder since \`v1.2\` — committed since then, and uncommitted — as a patch (2 files). Not your work. Background only — your task follows.\n\nPATCH of since:v1.2\n</changes>`,
        "check again",
      ]);
      assert.deepEqual(registry.get(id)?.exchanges[1].handed, { source: "since:v1.2", files: 2 });
      // A follow-up that names none carries none: the launch's is not handed over twice.
      await door.subagents.run({ id: "toolu_3", input: { run_in_background: false, description: "more", agent_id: id, prompt: "and the tests?" }, emit: () => {}, signal: null });
      assert.deepEqual([lastTexts(posts[2]), registry.get(id)?.exchanges[2].handed ?? null], [["and the tests?"], null]);
      assert.deepEqual(asked, ["running", "since:v1.2"]);
      // A word that is no source is refused before anything starts.
      await assert.rejects(door.subagents.run({ id: "toolu_4", input: { run_in_background: false, description: "x", prompt: "x", changes: "mine" }, emit: () => {}, signal: null }), /changes must be one of running, turn, uncommitted, or since:<a commit, tag or branch>/);
      await assert.rejects(door.subagents.run({ id: "toolu_5", input: { run_in_background: false, description: "x", agent_id: id, prompt: "x", changes: "since:--all" }, emit: () => {}, signal: null }), /`--all` is not a commit, tag or branch as git names one/);
      assert.equal(posts.length, 3);
    } finally {
      door.close();
    }
  });

  // (fails before: yes — found live on HarnessV4_Tasks E15 step 4: an agent that named `turn` for its own change in a
  // session's first turn handed its reviewer no patch, and its tool's result never said so)
  test("a change that held nothing is said to the launcher, with why — and for the last turn's, what names this turn's", async () => {
    const { registry, posts } = scripted();
    const door = registry.openTurn({ chainId: "c-new", runId: "turn-1", cwd: tmpdir(), mode: "edit", model: "m", thinking: null, fork: null });
    try {
      const r = await door.subagents.run({ id: "toolu_1", input: { run_in_background: false, description: "review it", prompt: "is it right?", subagent_type: "reviewer", changes: "turn" }, emit: () => {}, signal: null });
      assert.match(lastTexts(posts[0])[0], /^<changes source="turn" files="0">\nthe session has no finished turn yet: there is no patch to show\./);
      assert.match(r.text, /^REPORT 1\n\n\[Filament: no change was handed to it as a patch — the session has no finished turn yet\. What this turn has changed so far is changes: "running"\.\]\n\n\[Filament: sub-agent sa_/);
      const id = String(/agent_id "(sa_[0-9a-f]{8})"/.exec(r.text)?.[1]);
      assert.deepEqual(registry.get(id)?.exchanges[0].handed, { source: "turn", files: 0, note: "the session has no finished turn yet" });
      const u = await door.subagents.run({ id: "toolu_2", input: { run_in_background: false, description: "again", agent_id: id, prompt: "check again", changes: "uncommitted" }, emit: () => {}, signal: null });
      assert.match(u.text, /\[Filament: no change was handed to it as a patch — the session has no finished turn yet\.\]/, "any source's reason; the pointer is the last turn's alone");
    } finally {
      door.close();
    }
  });

  test("the developer's launch marks what was handed over, and how many files once it is back; a saved agent asked by its tag is handed one too", async () => {
    const { registry, posts, marks } = scripted();
    const r = registry.launch({ origin: "owner", chainId: "c1", prompt: "what broke?", as: "product", changes: "since:v1.2" });
    assert.equal(r.ok, true, String(/** @type {any} */ (r).error || ""));
    await /** @type {any} */ (r).done;
    assert.ok(lastTexts(posts[0]).some((t) => t.startsWith('<changes source="since" since="v1.2" files="2">')), JSON.stringify(lastTexts(posts[0])).slice(0, 300));
    assert.deepEqual(marks.map((m) => [m.event, m.handed, m.handedFiles ?? null]), [["dispatch", "since:v1.2", null], ["arrival", "since:v1.2", 2]]);
    const plain = registry.launch({ origin: "owner", chainId: "c1", prompt: "look", worker: "reviewer" });
    await /** @type {any} */ (plain).done;
    assert.deepEqual(marks.slice(2).map((m) => "handed" in m), [false, false], "a launch handed nothing says nothing of it");
  });

  test("a range from a point git does not know ends the launch in words: no model is asked", async () => {
    const { registry, posts } = scripted();
    const r = registry.launch({ origin: "owner", chainId: "c1", prompt: "what broke?", worker: "reviewer", changes: "since:v9" });
    assert.equal(r.ok, true);
    const o = await /** @type {any} */ (r).done;
    assert.deepEqual([o.ok, o.status, o.error, posts.length], [false, "failed", "git knows no commit, tag or branch `v9` in this repository", 0]);
    const ok = registry.launch({ origin: "owner", chainId: "c1", prompt: "look", worker: "reviewer" });
    await /** @type {any} */ (ok).done;
    const again = registry.followUp(/** @type {any} */ (ok).id, { prompt: "and since v9?", chainId: "c1", changes: "since:v9" });
    assert.equal(again.ok, true);
    const o2 = await /** @type {any} */ (again).done;
    assert.deepEqual([o2.ok, o2.error, posts.length], [false, "git knows no commit, tag or branch `v9` in this repository", 1]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Through the app: an agent hands a reviewer what its own turn changed
// ---------------------------------------------------------------------------------------------------

const CHILD = "You are a sub-agent run by Filament";
const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));
/** @param {any} m */
const blocksOf = (m) => (Array.isArray(m?.content) ? m.content : []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text));
/** @param {any} c */
const answersTo = (c) => (Array.isArray(c.body?.messages?.at(-1)?.content) ? c.body.messages.at(-1).content : []).filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id);
const isChild = (/** @type {any} */ c) => JSON.stringify(c.body?.system ?? "").includes(CHILD);

describe("through the app", () => {
  /** @type {string} */ let folder;
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  let reports = 0;

  before(async () => {
    folder = repo("filament-chg-app-");
    up = await fakeUpstream(async (call) => {
      const lastText = textOf((call.body?.messages || []).at(-1));
      const blocks = (/** @type {any[]} */ b, stop = "end_turn") => anthropicReply("", { model: call.body?.model || "m-1", stop, blocks: b, usage: { input_tokens: 5, output_tokens: 3 } });
      if (isChild(call)) return blocks([{ type: "text", text: `REVIEW ${++reports}` }]);
      if (answersTo(call).includes("toolu_a1")) return blocks([{ type: "text", text: "MAIN DONE" }]);
      if (answersTo(call).includes("toolu_w1")) return blocks([toolUse("toolu_a1", "agent", { run_in_background: false, description: "review the change", prompt: "read what I changed", subagent_type: "reviewer", changes: "running" })], "tool_use");
      if (/write then review/.test(lastText)) return blocks([toolUse("toolu_w1", "write", { path: "made.txt", content: "made by the main agent\n" })], "tool_use");
      return blocks([{ type: "text", text: `ANSWER TO ${lastText}` }]);
    });
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
      },
    });
    made.push(shim.dataDir);
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });

  const at = (/** @type {string} */ id, rest = "") => `/api/sessions/${encodeURIComponent(id)}${rest}`;
  /** A sub-agent once it is no longer running, whole. @param {string} id @param {string} sid @returns {Promise<any>} */
  const ended = (id, sid) =>
    until(async () => {
      const { subagent } = await (await shim.api(at(id, `/subagents/${sid}`))).json();
      return subagent && subagent.status !== "running" ? subagent : null;
    }, `sub-agent ${sid} to report`);
  const sideCalls = (/** @type {number} */ mark) => up.received.slice(mark).filter(isChild);

  // (fails before: yes — the tool's `changes` was no field: the reviewer got the prompt alone)
  test("mid-turn, the agent hands a reviewer what this turn has written so far; then the developer's follow-up and a range from /subagent", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain" } });
    const id = String((await s.json()).id);
    const mark = up.received.length;
    const t = await shim.api(at(id, "/turns"), { method: "POST", body: { content: "write then review", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    assert.match(await t.text(), /MAIN DONE/);
    const opening = blocksOf(sideCalls(mark)[0].body.messages[0]);
    assert.match(opening[0], /^<changes source="running" files="1">\nWhat turn 1 of the session, the turn running now, has changed up to its last finished round, as a patch \(1 file\)\. Not your work: the main agent's\./, opening[0]);
    assert.ok(opening[0].includes("+++ b/made.txt") && opening[0].includes("+made by the main agent"), opening[0]);
    assert.equal(opening.at(-1), "read what I changed");
    const { subagents } = await (await shim.api(at(id, "/subagents"))).json();
    assert.deepEqual([subagents[0].card.tag, subagents[0].changes, subagents[0].exchanges[0].handed], ["reviewer", "running", { source: "running", files: 1 }]);
    // The developer's follow-up on the route hands it everything uncommitted.
    const f = await shim.api(at(id, `/subagents/${subagents[0].id}/follow-up`), { method: "POST", body: { prompt: "check again", changes: "uncommitted" } });
    assert.equal(f.status, 200, await f.clone().text());
    const back = await ended(id, subagents[0].id);
    assert.deepEqual(back.exchanges[1].handed, { source: "uncommitted", files: 1 });
    const second = blocksOf(sideCalls(mark)[1].body.messages.at(-1));
    assert.match(second.at(-2) || "", /^<changes source="uncommitted" files="1">\nEverything uncommitted in the session's folder, as a patch/);
    assert.equal(second.at(-1), "check again");
    // With no turn running, "running" says so in words, and the launch goes on without a patch.
    const idle = await shim.api(at(id, "/subagents"), { method: "POST", body: { prompt: "anything running?", worker: "reviewer", deliver: false, view: "none", changes: "running" } });
    const idleRow = await ended(id, (await idle.json()).subagent.id);
    assert.match(idleRow.opening[0].text, /^<changes source="running" files="0">\nno turn is running in the session now: there is no patch to show\./);
    // The follow-up's report woke the chat (the owner's of 10-28): its turn takes it and ends before the command is typed,
    // as the person sees the chat at rest — a command sent while it runs is refused (409), which was this test's race.
    const key = /** @type {any} */ (shim.app).memory.archive.getChain(id).key;
    await until(async () => ((await (await shim.api(at(id, "/subagents"))).json()).queued === 0 && !(/** @type {any} */ (shim.app).sessionTurns.holder(key)) ? true : null), "the follow-up's wake to end");
    // A range, typed as a command: the file is not tracked yet, so it is part of everything since the tag.
    const said = await shim.api(at(id, "/turns"),{ method: "POST", body: { content: "/subagent as=reviewer changes=since:v1 what changed since the tag?", stream: false } });
    assert.match(await said.text(), /REVIEW \d+/);
    const ranged = blocksOf(sideCalls(mark).at(-1).body.messages[0]).find((b) => b.startsWith("<changes"));
    assert.match(ranged || "", /^<changes source="since" since="v1" files="1">\nEverything that changed in the session's folder since `v1` — committed since then, and uncommitted — as a patch \(1 file\)\. Not your work\. /);
    assert.ok(String(ranged).includes("+++ b/made.txt"));
    // Refused on the route before anything starts; a point git does not know ends the launch in words.
    const before = sideCalls(mark).length;
    for (const [changes, words] of /** @type {[string, RegExp][]} */ ([["everything", /changes must be one of running, turn, uncommitted, or since:<a commit, tag or branch>/], ["since:", /since: needs a commit, tag or branch after it/], ["since:--help", /`--help` is not a commit, tag or branch as git names one/]])) {
      const bad = await shim.api(at(id, "/subagents"), { method: "POST", body: { prompt: "x", worker: "reviewer", changes } });
      assert.equal(bad.status, 400, changes);
      assert.match((await bad.json()).error, words);
    }
    const lost = await shim.api(at(id, "/subagents"), { method: "POST", body: { prompt: "x", worker: "reviewer", deliver: false, changes: "since:v9" } });
    assert.equal(lost.status, 200, await lost.clone().text());
    const lostRow = await ended(id, (await lost.json()).subagent.id);
    assert.deepEqual([lostRow.status, lostRow.exchanges[0].error], ["failed", "git knows no commit, tag or branch `v9` in this repository"]);
    assert.equal(sideCalls(mark).length, before, "no model was asked");
  });
});
