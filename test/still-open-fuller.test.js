// @ts-check
// The Still open list made fuller (the owner's of 11-09, d1): waiting changes from a graph's tasks and a team's workers,
// a dropped task's change, how long each waited and whether the folder moved on since, failed captures, a deleted chat's
// work, Filament's copies on disk, leftover worktrees, branches and forks — each line with its id, which the envelope
// tool's dismiss takes, so a false alarm stops coming back until what it names changes; and a sub-agent's change that
// waits, said again once a few turns went by without a word of it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { openCheckTree, releaseTaskWorktree } from "../src/adapters/git/worktree.js";
import { changesOf, createStillOpen, moreOf, openList, openWords, OPEN_MOST, WAITS_AGAIN } from "../src/app/agent/still-open.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createAgentTurns } from "../src/app/agent-inbox.js";
import { afterSummaryCandidates, blockFiles, blockLetters, blockPlan, handoverFor, reattachBlock } from "../src/app/sessions/reattach.js";
import { dismissAnswer, envelopeAnswer, envelopeLine, openedLetters } from "../src/app/agent/envelopes.js";
import { handedNote, handedOf } from "../src/app/sessions/switch-question.js";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
/**
 * Where the person sees to what a folder left behind, in a project's lines: its Folders and worktrees…, one road whether
 * or not the project has a Space (d-send's third follow-up).
 */
const ROAD = "the project's Folders and worktrees… (its menu in the left bar, or ⋯ on its page)";

/** A chat's meta as the archive keeps it, in memory: `mergeMeta` with undefined takes a key away. */
const archiveOf = () => {
  /** @type {Map<string, Record<string, any>>} */
  const metas = new Map();
  return {
    metas,
    metaOf: (/** @type {string} */ id, /** @type {readonly string[]} */ keys) => {
      const m = metas.get(id) || {};
      return Object.fromEntries(keys.filter((k) => k in m).map((k) => [k, structuredClone(m[k])]));
    },
    mergeMeta: (/** @type {string} */ id, /** @type {Record<string, any>} */ patch) => {
      const m = { ...(metas.get(id) || {}) };
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete m[k];
      else m[k] = structuredClone(v);
      metas.set(id, m);
    },
    getCompactions: () => [],
    getChain: (/** @type {string} */ id) => ({ id, title: "chat" }),
  };
};

// (fails before: yes — the list had none of these, and no line carried an id)
test("the lines: each ends with its id; graph tasks', workers' and a dropped task's changes, with how long they waited and the folder's drift; failed captures, a deleted chat's work, copies and leftovers", () => {
  const o = openList({
    shells: [],
    agent: null,
    agents: [{ id: "sa_3", description: "add export", running: false, files: 3, since: NOW - 125 * MIN, drift: 4, mark: "b:h" }],
    changes: [
      { kind: "graph", id: "sa_7", task: "t3", title: "parse the config", files: 2, mark: "b7:h7", since: NOW - 5 * MIN, drift: 0 },
      { kind: "dropped", id: "sa_8", task: "t4", title: "old idea", files: 1, mark: "b8:h8", since: null, drift: 1 },
      { kind: "worker", id: "sa_9", description: "tests", files: 2, mark: "b9:h9" },
    ],
    uncaptured: [{ id: "sa_5", error: "git: index.lock exists", dest: "/r/.git/filament-tasks/sa_5", at: NOW - 3 * MIN }],
    deleted: [{ id: "sa_6", chainId: "c_gone", deletedAt: NOW - 60 * MIN, head: "abc123", at: NOW - 90 * MIN }],
    copies: [{ repo: "/r", count: 4, bytes: 3 * 1024 * 1024 * 1024 }],
    worktrees: [{ path: "/r-old", branch: "old", into: "main", head: "w1", age: NOW - 3 * 24 * 60 * MIN }],
    branches: [{ name: "spike", into: "main", head: "b1", age: NOW - 2 * 24 * 60 * MIN }],
    forks: [{ chain: "c_f", path: "/r-fork", head: "f1", why: "locked" }],
    now: NOW,
  });
  assert.deepEqual(o.keys, ["agent:sa_3:waits", "graph:t3:waits", "worker:sa_9:waits", "graph:t4:dropped", "agent:sa_5:uncaptured", "deleted:sa_6", "copies:/r", "worktree:/r-old", "branch:spike", "fork:c_f"]);
  assert.equal(o.lines[0], '- sub-agent sa_3 ("add export"): 3 files of its work wait to be applied (for 2 h 5 min; your folder has 4 commits it did not start from) [agent:sa_3:waits]');
  assert.equal(o.lines[1], '- task t3 of your task graph ("parse the config"): 2 files of sub-agent sa_7\'s change wait to be applied (for 5 min) — agent with agent_id "sa_7" and apply_changes: true, or leave it [graph:t3:waits]', "the drift's words dropped at 0");
  assert.equal(o.lines[2], '- worker sa_9 ("tests") of your team: 2 files of its change wait to be applied — worker with its agent_id and apply_changes: true, or leave it [worker:sa_9:waits]');
  assert.equal(o.lines[3], '- task t4 of your task graph ("old idea"), dropped: 1 file of sub-agent sa_8\'s change still waits in its copy (your folder has 1 commit it did not start from) — agent with agent_id "sa_8" and apply_changes: true to apply it, mark_applied: true where it came into your folder another way, or leave it [graph:t4:dropped]');
  assert.match(o.lines[4], /^- sub-agent sa_5: its work could not be saved \(git: index\.lock exists\), so it is only in its copy at \/r\/\.git\/filament-tasks\/sa_5, kept as it is .+ \[agent:sa_5:uncaptured\]$/);
  assert.equal(o.lines[5], `- sub-agent sa_6 of a chat deleted 1 h ago (c_gone): its work waits on the repository's refs, which only the person can apply or let go — at ${ROAD}, Filament's footprint at its foot [deleted:sa_6]`);
  assert.match(o.lines[6], /^- Filament's copies of \/r: 4 on disk, 3\.0 GB — .* \[copies:\/r\]$/);
  assert.match(o.lines[7], /^- worktree \/r-old \(branch old\): merged into main, nothing uncommitted, its last commit 3 days ago — .* \[worktree:\/r-old\]$/);
  assert.match(o.lines[8], /^- branch spike: merged into main and checked out nowhere, its last commit 2 days ago — .* \[branch:spike\]$/);
  assert.match(o.lines[9], /^- fork \/r-fork of a deleted chat \(c_f\): it stays — locked — .* \[fork:c_f\]$/);
  assert.deepEqual(
    o.rows.map((r) => r.key),
    o.keys,
    "a row each, with its key",
  );
  assert.ok(o.plain.every((l, i) => o.lines[i] === `${l} [${o.keys[i]}]`), "the card's lines carry no id");
});

// (fails before: yes — fxo's left: a chat in no project has no Space, yet every line of what its folder left behind sent
// the person to Space › places; its Plan's Still open card tidies what the footprint's Clean up… takes, and the rest
// nowhere)
test("what a folder left behind, for a chat in no project: no line names Space › places; Clean up… where the card has it, the rest the person's", async () => {
  const left = {
    deleted: [{ id: "sa_6", chainId: "c_gone", deletedAt: NOW - 60 * MIN, head: "abc123", at: NOW - 90 * MIN }],
    copies: [{ repo: "/r", count: 4, bytes: 3 * 1024 * 1024 * 1024 }],
    worktrees: [{ path: "/r-old", branch: "old", into: "main", head: "w1", age: NOW - 3 * 24 * 60 * MIN }],
    forks: [{ chain: "c_f", path: "/r-fork", head: "f1", why: "locked" }],
  };
  const inOne = openList({ shells: [], agent: null, ...left, now: NOW });
  // (fails before: yes — d-send's third follow-up: a project's lines sent the person to "Space › places", which a project
  // with no Space has not; the sheet is the project's Folders and worktrees…, from its menu in the left bar or ⋯ on its
  // page, whether or not it has a Space)
  assert.deepEqual(inOne.lines, [
    `- sub-agent sa_6 of a chat deleted 1 h ago (c_gone): its work waits on the repository's refs, which only the person can apply or let go — at ${ROAD}, Filament's footprint at its foot [deleted:sa_6]`,
    `- Filament's copies of /r: 4 on disk, 3.0 GB — the person sees them, and lets go of those nothing needs, at ${ROAD}, Filament's footprint at its foot (Clean up…) [copies:/r]`,
    `- worktree /r-old (branch old): merged into main, nothing uncommitted, its last commit 3 days ago — the person removes it at ${ROAD} with its … › Remove worktree and branch…, or leaves it [worktree:/r-old]`,
    `- fork /r-fork of a deleted chat (c_f): it stays — locked — and what it holds is the person's to keep or remove, at ${ROAD} [fork:c_f]`,
  ], "a chat of a project: each names its Folders and worktrees…");
  assert.deepEqual(inOne.lines.filter((l) => /\bSpace\b|\bplaces\b/.test(l)), [], "and no Space, nor places");
  const none = openList({ shells: [], agent: null, ...left, project: false, now: NOW });
  assert.deepEqual(none.keys, inOne.keys, "the same things, said");
  assert.deepEqual(none.lines.filter((l) => l.includes("Space ›")), []);
  assert.match(none.lines[0], /^- sub-agent sa_6 of a chat deleted 1 h ago \(c_gone\): its work waits on the repository's refs, which only the person can apply or let go — at this chat's Plan page, Still open › Left behind \[deleted:sa_6\]$/);
  assert.match(none.lines[1], /^- Filament's copies of \/r: 4 on disk, 3\.0 GB — the person sees them, and lets go of those nothing needs, at this chat's Plan page, Still open › Left behind \(Clean up…\) \[copies:\/r\]$/);
  assert.match(none.lines[2], /^- worktree \/r-old \(branch old\): merged into main, nothing uncommitted, its last commit 3 days ago — the person's to remove, or leave: a chat in no project has no Folders and worktrees… to remove it from \[worktree:\/r-old\]$/);
  assert.equal(none.lines[3], "- fork /r-fork of a deleted chat (c_f): it stays — locked — and what it holds is the person's to keep or remove [fork:c_f]");
  // The folder's reads carry it, as the server reads the chat's project.
  const read = await moreOf({ chain: "c1", folder: "/r", subs: [], holds: { worktrees: left.worktrees, forks: left.forks }, project: false });
  assert.equal(read.project, false);
  assert.equal((await moreOf({ chain: "c1", folder: "/r", subs: [], holds: null })).project, undefined, "unsaid where the caller says nothing: a project's words");
  // And the chat's list, which keeps the reads: its agent's line says it so.
  const so = createStillOpen({ archive: () => archiveOf(), more: async () => ({ worktrees: left.worktrees, project: false }), now: () => NOW });
  await so.refresh("c1");
  assert.deepEqual(so.lines("c1"), ["- worktree /r-old (branch old): merged into main, nothing uncommitted, its last commit 3 days ago — the person's to remove, or leave: a chat in no project has no Folders and worktrees… to remove it from [worktree:/r-old]"]);
});

// (fails before: yes — the card had the agent's lines alone, ids, tool calls and "the person" in them: "a mess and un
// explainable", the owner's of 11-10)
test("the card's words: each row's view — its group, how it stands, a title and a line under it in the person's words, and what its button opens", () => {
  const o = openList({
    shells: /** @type {any} */ ([{ id: "bg_1", command: "npm run dev -- --port 5173", cwd: "H:\\proj", agent: null, startedAt: NOW - 3 * MIN }]),
    agent: null,
    agents: [
      { id: "sa_1", description: "Review: auth", running: true, files: 0 },
      { id: "sa_2", description: "", running: true, files: 0, asks: true },
      { id: "sa_3", description: "add export", running: false, files: 3, since: NOW - 125 * MIN, drift: 4, mark: "b:h" },
      { id: "sa_4", description: "port the parser", running: false, files: 0, failed: "rate limited: try again in 30 s" },
    ],
    tasks: [{ id: "t_own", kind: "local_bash", description: "watch the build", since: NOW - 2 * MIN }],
    theirs: { who: "Codex", tasks: [{ id: "t_th", kind: "local_agent", description: "", since: NOW - MIN }] },
    letters: [{ id: "lt_1", subject: "The <version> placeholders", from: "the Website chat", at: NOW - 30 * MIN }],
    changes: [
      { kind: "graph", id: "sa_7", task: "t3", title: "parse the config", files: 2, mark: "b7:h7", since: NOW - 5 * MIN, drift: 0 },
      { kind: "dropped", id: "sa_8", task: "c1", title: "old idea", files: 35, mark: "b8:h8", since: null, drift: 1 },
      { kind: "worker", id: "sa_9", description: "tests", files: 1, mark: "b9:h9" },
    ],
    uncaptured: [{ id: "sa_5", error: "git: index.lock exists", dest: "/r/.git/filament-tasks/sa_5", at: NOW - 3 * MIN }],
    deleted: [{ id: "sa_6", chainId: "c_gone", deletedAt: NOW - 60 * MIN, head: "abc123", at: NOW - 90 * MIN }],
    copies: [{ repo: "H:/webshop", count: 4, bytes: 3 * 1024 * 1024 * 1024, partial: true }],
    worktrees: [{ path: "H:/app-fixes", branch: "fixes", into: "main", head: "w1", age: null }],
    branches: [{ name: "spike", into: "main", head: "b1", age: null }],
    forks: [{ chain: "c_f", path: "/r-fork", head: "f1", why: null }],
    now: NOW,
  });
  const views = Object.fromEntries(o.rows.map((r) => [r.key, r.view]));
  assert.deepEqual(views, {
    "command:bg_1": { group: "running", tone: "run", title: "npm run dev -- --port 5173", detail: "Background command, running 3 min · in proj" },
    "task:t_own": { group: "running", tone: "run", title: "watch the build", detail: "The agent's own background shell, running 2 min" },
    "theirs:t_th": { group: "running", tone: "run", title: "Background agent t_th", detail: "In Codex's session of this chat, running 1 min" },
    "agent:sa_1:working": { group: "running", tone: "run", title: "Review: auth", detail: "Sub-agent at work: its report comes to the agent", act: "thread", agent: "sa_1" },
    "agent:sa_2:asks": { group: "waiting", tone: "ask", title: "Sub-agent sa_2", detail: "A sub-agent at work asks you a question", act: "thread", agent: "sa_2" },
    "agent:sa_3:waits": { group: "waiting", tone: "wait", title: "add export", detail: "3 files to apply · waiting 2 h 5 min · 4 commits in your folder since it started", act: "review", agent: "sa_3" },
    "graph:t3:waits": { group: "waiting", tone: "wait", title: "Task t3: parse the config", detail: "2 files to apply, from its sub-agent · waiting 5 min", act: "review", agent: "sa_7" },
    "worker:sa_9:waits": { group: "waiting", tone: "wait", title: "tests", detail: "Team worker · 1 file to apply", act: "review", agent: "sa_9" },
    "graph:c1:dropped": { group: "waiting", tone: "wait", title: "Task c1: old idea", detail: "Dropped task · 35 files of its change still to apply · 1 commit in your folder since it started", act: "review", agent: "sa_8" },
    "agent:sa_4:failed": { group: "waiting", tone: "fail", title: "port the parser", detail: "Failed: rate limited: try again in 30 s", act: "thread", agent: "sa_4" },
    "agent:sa_5:uncaptured": { group: "waiting", tone: "fail", title: "Sub-agent sa_5", detail: "Its work could not be saved: it is only in its copy at /r/.git/filament-tasks/sa_5", act: "thread", agent: "sa_5" },
    "letter:lt_1": { group: "waiting", tone: "wait", title: "The <version> placeholders", detail: "Letter from the Website chat, 30 min ago · waits for the agent's reply" },
    "deleted:sa_6": { group: "left", tone: "left", what: "deleted", title: "Sub-agent sa_6 of a deleted chat", detail: "Its work waits in git since the chat was deleted 1 h ago" },
    "copies:H:/webshop": { group: "left", tone: "left", what: "copies", count: 4, size: "at least 3.0 GB", title: "Filament's copies of webshop", detail: "4 on disk · at least 3.0 GB" },
    "worktree:H:/app-fixes": { group: "left", tone: "left", what: "worktree", title: "app-fixes", detail: "Worktree merged into main, nothing uncommitted" },
    "branch:spike": { group: "left", tone: "left", what: "branch", title: "spike", detail: "Branch merged into main, checked out nowhere" },
    "fork:c_f": { group: "left", tone: "left", what: "fork", title: "r-fork", detail: "A deleted chat's fork" },
  });
  const words = Object.values(views).map((v) => `${v.title} ${v.detail}`).join("\n");
  assert.doesNotMatch(words, /agent_id|apply_changes|envelope|\[|the person/, "no tool's words, no id in brackets, no \"the person\"");
  const dismissed = openList({ shells: [], agent: null, changes: [{ kind: "graph", id: "sa_7", task: "t3", title: "x", files: 2, mark: "m" }], dismissed: { "graph:t3:waits": "m" }, now: NOW });
  assert.deepEqual(dismissed.rows[0].view, { group: "waiting", tone: "wait", title: "Task t3: x", detail: "2 files to apply, from its sub-agent", act: "review", agent: "sa_7" }, "a dismissed row keeps its view");
});

// (fails before: yes — nothing let the agent say a line no longer holds)
test("dismissed: left out of the lines and the keys while what it names stands as it was dismissed; back once it changes; the rows keep it, marked", () => {
  const changes = [{ kind: /** @type {const} */ ("graph"), id: "sa_7", task: "t3", title: "x", files: 2, mark: "b7:h7" }];
  const gone = openList({ shells: [], agent: null, changes, dismissed: { "graph:t3:waits": "b7:h7" }, now: NOW });
  assert.deepEqual(gone.lines, []);
  assert.deepEqual(gone.keys, []);
  assert.deepEqual(gone.all, ["graph:t3:waits"], "every key, the dismissed one too");
  assert.deepEqual(gone.rows.map((r) => ({ key: r.key, dismissed: !!r.dismissed })), [{ key: "graph:t3:waits", dismissed: true }]);
  const back = openList({ shells: [], agent: null, changes: [{ ...changes[0], mark: "b7:h8" }], dismissed: { "graph:t3:waits": "b7:h7" }, now: NOW });
  assert.deepEqual(back.keys, ["graph:t3:waits"], "its work moved on: back");
});

/**
 * A chat's Still open with a registry of one sub-agent whose work waits, a graph task's change and a folder's leftovers.
 * @param {{ files?: number }} [o]
 */
const chatOf = ({ files = 2 } = {}) => {
  const archive = archiveOf();
  const agents = { sa_1: { id: "sa_1", description: "build it", running: false, files, sig: "b1:h1", endedAt: NOW - 10 * MIN } };
  const registry = {
    openWork: () => Object.values(agents).filter((a) => a.files > 0).map(({ id, description, running, files }) => ({ id, description, running, files })),
    get: (/** @type {string} */ id) => {
      const a = /** @type {any} */ (agents)[id];
      return a ? { chainId: "c1", status: "done", endedAt: a.endedAt, work: { pending: a.files, sig: a.sig } } : null;
    },
  };
  let reads = 0;
  const so = createStillOpen({
    registry,
    archive: () => archive,
    changes: () => [{ kind: "graph", id: "sa_7", task: "t3", title: "x", files: 1, mark: "b7:h7" }],
    more: async () => {
      reads++;
      return { drift: { sa_1: 2 }, worktrees: [{ path: "/r-old", branch: "old", into: "main", head: "w1", age: null }] };
    },
    now: () => NOW,
  });
  return { so, archive, agents, reads: () => reads };
};

// (fails before: yes — the list read nothing of git, and nothing could be dismissed)
test("a chat's list: the folder's reads come in once refreshed, and are kept; dismissing by the ids takes them out of the agent's list and the card's, never firing `changed`; Undo brings one back", async () => {
  const { so, archive, reads } = chatOf();
  assert.deepEqual(so.keys("c1"), ["agent:sa_1:waits", "graph:t3:waits"], "nothing of git before a refresh");
  await so.refresh("c1");
  await so.refresh("c1");
  assert.equal(reads(), 1, "kept: one read serves the next");
  assert.deepEqual(so.keys("c1"), ["agent:sa_1:waits", "graph:t3:waits", "worktree:/r-old"]);
  assert.match(so.lines("c1")[0], /\(for 10 min; your folder has 2 commits it did not start from\) \[agent:sa_1:waits\]$/);
  so.told("c1");
  const r = so.dismiss("c1", ["agent:sa_1:waits", "worktree:/r-old", "nope:1"]);
  assert.deepEqual(r, { dismissed: ["agent:sa_1:waits", "worktree:/r-old"], unknown: ["nope:1"], waits: ["sa_1"] });
  assert.deepEqual(so.keys("c1"), ["graph:t3:waits"]);
  assert.equal(so.due("c1"), null, "a waits key dismissed is no change applied or dropped");
  const shown = so.shown("c1");
  assert.equal(shown.lines.length, 1);
  assert.doesNotMatch(shown.lines[0], /\[graph:t3:waits\]/, "the card's lines carry no id");
  assert.deepEqual(shown.items.map((x) => [x.key, x.dismissed]), [["agent:sa_1:waits", true], ["graph:t3:waits", false], ["worktree:/r-old", true]]);
  assert.match(shown.items[0].line, /^sub-agent sa_1 \("build it"\): 2 files of its work wait to be applied/, "the card's words, who: what, no id");
  assert.doesNotMatch(shown.items.map((x) => x.line).join("\n"), /\[(agent|graph|worktree):/);
  assert.equal(so.undismiss("c1", "worktree:/r-old"), true);
  assert.deepEqual(so.keys("c1"), ["graph:t3:waits", "worktree:/r-old"]);
  assert.ok(archive.metas.get("c1")?.openDismissed?.["agent:sa_1:waits"], "kept with the chat");
});

// (fails before: yes — the reviewer's of 11-10: after a Clean up or a Tidy up the card said what went for a minute and
// more, its reads kept)
test("what the folders hold moved — a worktree removed or put back, copies cleaned up —: the kept reads are stale, said so until one begun after lands, and one under way then is read again behind it", async () => {
  let worktrees = [{ path: "/r-old", branch: "old", into: "main", head: "w1", age: null }];
  let reads = 0;
  /** @type {(() => void) | null} */
  let release = null;
  let holding = false;
  const so = createStillOpen({
    archive: () => archiveOf(),
    more: async () => {
      reads++;
      const w = worktrees;
      if (holding) await new Promise((r) => (release = () => r(undefined)));
      return { worktrees: w };
    },
    now: () => NOW,
  });
  await so.refresh("c1");
  assert.deepEqual(so.keys("c1"), ["worktree:/r-old"]);
  assert.equal(so.stale("c1"), false);
  worktrees = [];
  so.moved();
  assert.equal(so.stale("c1"), true, "moved: stale, within the minute it is kept too");
  assert.deepEqual(so.keys("c1"), ["worktree:/r-old"], "what it had, until the read lands");
  await so.refresh("c1");
  assert.equal(reads, 2, "read again");
  assert.deepEqual(so.keys("c1"), []);
  assert.equal(so.stale("c1"), false);
  // One under way when it moved: what it reads may be from before, so another follows it.
  worktrees = [{ path: "/r-new", branch: "new", into: "main", head: "w2", age: null }];
  so.moved();
  holding = true;
  const first = so.refresh("c1");
  while (!release) await new Promise((r) => setImmediate(r));
  holding = false;
  worktrees = [];
  so.moved();
  const second = so.refresh("c1");
  /** @type {any} */ (release)();
  await Promise.all([first, second]);
  assert.equal(reads, 4, "the read under way, then one begun after the move");
  assert.deepEqual(so.keys("c1"), [], "the newer read stands");
  assert.equal(so.stale("c1"), false);
});

// (fails before: yes — the reviewer's of 11-10: the card said "Letter from your sub-agent sa_2", and a chat's id)
test("a letter that waits names who wrote it on the card in the person's words — a sub-agent by its task, a chat by its title, no id —, the agent's line as before", () => {
  const archive = archiveOf();
  archive.mergeMeta("c1", { letters: { asks: {
    lt_1: { subject: "Placeholders", from: "c_web", at: NOW - 40 * MIN },
    lt_2: { subject: "Which port?", from: "c1", by: "sa_2", at: NOW - 5 * MIN },
    lt_3: { subject: "Shall I?", from: "c1", by: "sa_3", at: NOW - 4 * MIN },
  } } });
  archive.getChain = (/** @type {string} */ id) => ({ id, title: id === "c_web" ? "Website" : "chat" });
  const agents = { sa_2: { chainId: "c1", status: "running", description: "Map the routes" }, sa_3: { chainId: "c1", status: "running" } };
  const registry = { openWork: () => [], get: (/** @type {string} */ id) => /** @type {any} */ (agents)[id] || null };
  const so = createStillOpen({ registry, archive: () => archive, now: () => NOW });
  const items = so.shown("c1").items;
  assert.deepEqual(items.map((i) => i.view.detail), [
    "Letter from the chat “Website”, 40 min ago · waits for the agent's reply",
    "Letter from the sub-agent “Map the routes”, 5 min ago · waits for the agent's reply",
    "Letter from one of this chat's sub-agents, 4 min ago · waits for the agent's reply",
  ]);
  assert.match(so.lines("c1").join("\n"), /letter lt_1, "Placeholders", from the chat "Website" \(c_web\), 40 min ago/, "the agent's own words keep the id it answers by");
  assert.match(so.lines("c1").join("\n"), /letter lt_2, "Which port\?", from your sub-agent sa_2, 5 min ago/);
});

// (fails before: yes — a dismissed change came back never, or always)
test("a dismissed sub-agent's change comes back once its work moves on; one that goes is pruned at the turn's end", async () => {
  const { so, archive, agents } = chatOf();
  so.dismiss("c1", ["agent:sa_1:waits"]);
  assert.deepEqual(so.keys("c1"), ["graph:t3:waits"]);
  agents.sa_1.sig = "b1:h2";
  assert.deepEqual(so.keys("c1"), ["agent:sa_1:waits", "graph:t3:waits"], "a follow-up moved its work: back");
  so.dismiss("c1", ["agent:sa_1:waits"]);
  agents.sa_1.files = 0;
  so.ended("c1", false);
  assert.equal(archive.metas.get("c1")?.openDismissed, undefined, "gone: nothing kept of it");
});

// (fails before: yes — the new keys would have forced a block at a turn's start as they went)
test("a graph task's change, a worker's and a leftover going fire no `changed`; a sub-agent's change going still does", async () => {
  const { so, agents } = chatOf();
  await so.refresh("c1");
  so.heard("c1", [...so.keys("c1"), "worker:sa_9:waits", "graph:t9:dropped"]);
  assert.equal(so.due("c1"), null);
  agents.sa_1.files = 0;
  const d = so.due("c1");
  assert.equal(d?.why, "changed");
});

// (fails before: yes — the owner's of 11-09: "not sure if those are nudged back to the agent or not")
test(`a sub-agent's change that waits, unsaid for ${WAITS_AGAIN} turns, is said again at the next turn's start; said, the count starts over — a chat never compacted too`, () => {
  const { so } = chatOf();
  assert.equal(so.due("c1"), null);
  for (let i = 0; i < WAITS_AGAIN; i++) {
    so.ended("c1", false);
    if (i < WAITS_AGAIN - 1) assert.equal(so.due("c1"), null, `turn ${i + 1}`);
  }
  // The first end found it new: its report had just said it. Then WAITS_AGAIN turns without a word.
  so.ended("c1", false);
  const d = so.due("c1");
  assert.equal(d?.why, "waits");
  assert.match(d?.text || "", /^\[Filament: A sub-agent's change still waits for you to apply it, and nothing said so for \d+ turns\./);
  assert.match(d?.text || "", /<open>\n- sub-agent sa_1 /);
  so.ended("c1", true);
  assert.equal(so.due("c1"), null, "said: the count starts over");
});

// (fails before: yes — a fold-method compaction said nothing of what was open)
test("a fold-method compaction: the next turn's start says the list in the fold's words; with nothing open nothing, and the turn's end settles it", () => {
  const { so, agents } = chatOf();
  so.folded("c1");
  const d = so.due("c1");
  assert.equal(d?.why, "folded");
  assert.match(d?.text || "", /^\[Filament: This chat's context was compacted earlier, and what is still open may have gone with it\./);
  agents.sa_1.files = 0;
  const archive = archiveOf();
  const empty = createStillOpen({ archive: () => archive, now: () => NOW });
  empty.folded("c1");
  assert.equal(empty.due("c1"), null, "nothing open: nothing to say of a fold");
  empty.ended("c1", false);
  assert.equal(archive.metas.get("c1")?.openHeard, undefined, "settled by the turn's end");
});

// (fails before: yes — the list was said, and nothing asked the agent to go through it)
test("the reminder: after every compaction the list asks to be gone through — apply or leave, follow up or leave, dismiss what no longer holds; none with nothing open, and no dismiss without Filament's tools", () => {
  const lines = ["- sub-agent sa_1: 1 file of its work waits to be applied [agent:sa_1:waits]"];
  const said = openWords(lines, "compacted");
  assert.match(said, /Go through it now: apply a change that waits or leave it, follow up a sub-agent or leave it, and dismiss a line that no longer holds with Filament's envelope tool \(dismiss: the ids in brackets\), which Filament then stops saying\./);
  assert.doesNotMatch(openWords(lines, "compacted", false), /dismiss/);
  // A coding agent given Filament's tools but no envelope (no launch offer, no team): recall's words, never dismiss.
  const noEnvelope = openWords(lines, "compacted", true, false);
  assert.match(noEnvelope, /Go through it now: apply a change that waits or leave it, follow up a sub-agent or leave it\./);
  assert.match(noEnvelope, /filament_recall/);
  assert.doesNotMatch(noEnvelope, /dismiss/);
  assert.doesNotMatch(openWords([], "compacted"), /Go through it/);
  const base = { root: "", rules: [], redact: null, window: 200_000, files: [], plan: null };
  assert.match(reattachBlock({ ...base, open: lines }).text, /Go through what was open now: apply a change that waits or leave it, follow up a sub-agent or leave it, and dismiss a line that no longer holds with Filament's envelope tool \(dismiss: the ids in brackets\), which Filament then stops saying\./);
  assert.doesNotMatch(reattachBlock({ ...base, open: [], plan: [{ text: "x", status: "pending" }] }).text, /Go through/);
});

/** A letter opened as the agent's envelope tool gives it: its body, then the footer letters.js writes. @param {number} n @param {string} id @param {string} sender @param {boolean} reply */
const opened = (n, id, sender, reply) => ({ text: `the build is green\n\n[Filament: letter ${id}, from ${sender}. ${reply ? "It asks for a reply: once you have one, send it." : "It asks for no reply."}]`, from: "", description: "", sender, envelope: n, kind: /** @type {const} */ ("report"), wrote: false, spentUsd: 0, toolCalls: 0, roundIds: [], opened: true });

// (fails before: yes — the compaction audit of 11-07, the owner's of 11-09: a letter that asked no reply, once opened,
// was the summary's to keep or lose, and nothing named it after)
test("letters opened in the summarized turns: named after the summary — id, who wrote, subject, the turn to recall —, never one answered there or one still owed", () => {
  const sender = 'the chat "Ops" (c_ops)';
  const sealedLine = envelopeLine({ n: 4, from: "c_ops", description: "", sender, subject: "Deploy done" }, 1);
  const answer = envelopeAnswer([/** @type {any} */ (opened(4, "lt_aa11", sender, false)), /** @type {any} */ (opened(5, "lt_bb22", sender, true)), /** @type {any} */ (opened(6, "lt_cc33", sender, true))], 0);
  const work = [
    { role: "user", content: [{ type: "text", text: sealedLine }] },
    { role: "assistant", content: [{ type: "tool_use", id: "u1", name: "envelope", input: { all: true } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: answer }] },
    { role: "assistant", content: [{ type: "tool_use", id: "u2", name: "envelope", input: { answer: "lt_cc33", text: "thanks" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "u2", content: "Sent." }] },
  ];
  assert.deepEqual(openedLetters(work), [
    { id: "lt_aa11", from: sender, subject: "Deploy done" },
    { id: "lt_bb22", from: sender, subject: "" },
    { id: "lt_cc33", from: sender, subject: "" },
  ]);
  const got = afterSummaryCandidates([{ n: 1, work: [] }, { n: 2, work }], 2, null, { owed: ["lt_bb22"] });
  assert.deepEqual(got.letters, [{ id: "lt_aa11", from: sender, subject: "Deploy done", turn: 2 }], "lt_bb22 still owed, lt_cc33 answered");
  const base = { root: "", rules: [], redact: null, window: 200_000, files: [], plan: [{ text: "ship", status: "pending" }] };
  const b = reattachBlock({ ...base, letters: got.letters, open: ["- x [agent:sa_1:waits]"] });
  assert.match(b.text, /\n\n<letters>\n- letter lt_aa11, "Deploy done", from the chat "Ops" \(c_ops\), opened in turn 2 — it asked no reply; its words come back with filament_recall\(\{ turn: 2 \}\)\n<\/letters>$/);
  assert.match(b.text, /the letters you opened in those turns/);
  assert.deepEqual(blockPlan(b.text), [{ status: "pending", text: "ship" }], "the plan still reads as the block's");
  assert.deepEqual(blockFiles(b.text), []);
});

// (fails before: yes — the review of 11-09: a summary took the place of the one before it with the letters of its own
// turns alone, and a letter opened before the first was forgotten at the second)
test("letters named after one summary are named after the next — and the loop's fold's, in a turn — unless answered since or still owed", () => {
  const sender = 'the chat "Ops" (c_ops)';
  const sealedLine = envelopeLine({ n: 4, from: "c_ops", description: "", sender, subject: "Deploy, done" }, 1);
  const work5 = [
    { role: "user", content: [{ type: "text", text: sealedLine }] },
    { role: "assistant", content: [{ type: "tool_use", id: "u1", name: "envelope", input: { all: true } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: envelopeAnswer([/** @type {any} */ (opened(4, "lt_aa11", sender, false))], 0) }] },
  ];
  const turns10 = Array.from({ length: 10 }, (_, i) => ({ n: i + 1, work: i + 1 === 5 ? work5 : [] }));
  const first = afterSummaryCandidates(turns10, 10);
  assert.deepEqual(first.letters, [{ id: "lt_aa11", from: sender, subject: "Deploy, done", turn: 5 }]);
  const base = { root: "", rules: [], redact: null, window: 200_000, files: [], plan: null };
  const head = { to_turn: 10, attached: reattachBlock({ ...base, letters: first.letters }).text };
  assert.deepEqual(afterSummaryCandidates([{ n: 11, work: [] }], 20, head).letters, first.letters, "the next summary names them again");
  assert.deepEqual(blockLetters(head.attached), first.letters, "read back as written");
  // A turn the loop folded in: its block after the fold names a letter its folded rounds opened.
  const fold = reattachBlock({ ...base, letters: [{ id: "lt_bb22", from: "your sub-agent sa_1", subject: "", turn: 12 }] }).text;
  const work12 = [{ role: "assistant", content: [{ type: "text", text: "[compacted]" }] }, { role: "user", content: [{ type: "text", text: "SUMMARY" }, { type: "text", text: fold }] }];
  const turns20 = Array.from({ length: 10 }, (_, i) => ({ n: i + 11, work: i + 11 === 12 ? work12 : [] }));
  assert.deepEqual(afterSummaryCandidates(turns20, 20, head).letters, [
    { id: "lt_aa11", from: sender, subject: "Deploy, done", turn: 5 },
    { id: "lt_bb22", from: "your sub-agent sa_1", subject: "", turn: 12 },
  ]);
  const answer = [{ role: "assistant", content: [{ type: "tool_use", id: "u9", name: "envelope", input: { answer: "lt_aa11", text: "thanks" } }] }];
  assert.deepEqual(afterSummaryCandidates([{ n: 15, work: answer }], 20, head).letters, [], "answered since: not named");
  assert.deepEqual(afterSummaryCandidates([{ n: 15, work: [] }], 20, head, { owed: ["lt_aa11"] }).letters, [], "owed: the list of what is open names it");
  // A reply that holds a block's words names no letter.
  const replied = reattachBlock({ ...base, plan: [{ text: "x", status: "pending" }], reply: { text: "\n\n<letters>\n- letter lt_cc33, from x, opened in turn 3 — it asked no reply\n</letters>", turn: 9 } }).text;
  assert.deepEqual(blockLetters(replied), []);
  assert.equal(blockLetters("no block"), null);
});

// (fails before: yes — the review of 11-09: a switch handed over the files, the plan and the skills of the folded
// turns, never the letters they opened)
test("a switch hands over the letters the folded turns opened that asked no reply, in words of the move — not one still owed", () => {
  const sender = 'the chat "Ops" (c_ops)';
  const work = [
    { role: "assistant", content: [{ type: "tool_use", id: "u1", name: "envelope", input: { all: true } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: envelopeAnswer([/** @type {any} */ (opened(4, "lt_aa11", sender, false))], 0) }] },
  ];
  const turns = [{ n: 1, work }, { n: 2, work: [] }];
  const o = { doc: {}, turns, root: "", window: 200_000, from: "Claude Code" };
  const h = handoverFor(o);
  assert.match(h.text, /^\[Filament handed these over as this chat moved to you from Claude Code: the letters opened before the move, which asked no reply\./);
  assert.match(h.text, /\n\n<letters>\n- letter lt_aa11, from the chat "Ops" \(c_ops\), opened in turn 1 — it asked no reply/);
  assert.doesNotMatch(handoverFor({ ...o, owed: ["lt_aa11"] }).text, /lt_aa11/);
});

// (fails before: yes — the bug hunt of 11-09: the turn's record said a handover of letters alone was "the skills loaded")
test("the turn's record and the switch's card name what the handover holds: letters alone are letters, a skill loaded with them is a skill", () => {
  const sender = 'the chat "Ops" (c_ops)';
  const letters = [
    { role: "assistant", content: [{ type: "tool_use", id: "u1", name: "envelope", input: { all: true } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: envelopeAnswer([/** @type {any} */ (opened(4, "lt_aa11", sender, false)), /** @type {any} */ (opened(5, "lt_bb22", sender, false))], 0) }] },
  ];
  const o = { doc: {}, turns: [{ n: 1, work: letters }, { n: 2, work: [] }], root: "", window: 200_000, from: "Claude Code" };
  const alone = handoverFor(o);
  assert.deepEqual([handedOf(alone), handedNote(alone)], [["letters"], "2 letters"]);
  const skill = [{ role: "assistant", content: [{ type: "tool_use", id: "k1", name: "mcp__filament__skill", input: { name: "filament-setup" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "k1", content: "the skill" }] }];
  const both = handoverFor({ ...o, turns: [...o.turns, { n: 3, work: skill }, { n: 4, work: [] }] });
  assert.deepEqual([handedOf(both), handedNote(both)], [["letters", "skills"], "2 letters, 1 skill"]);
  assert.match(both.text, /the letters opened before the move, which asked no reply, and the skills loaded before the move\./);
});

// (fails before: yes — the review of 11-09: past OPEN_MOST of a kind the rest had no row, and dismiss called them unknown)
test("past the most of a kind, each one is still dismissed by its id: the rows hold every one; the lines say the rest as how many more", async () => {
  const archive = archiveOf();
  const worktrees = Array.from({ length: OPEN_MOST + 1 }, (_, i) => ({ path: `/r-${i}`, branch: `b${i}`, into: "main", head: `h${i}`, age: null }));
  const so = createStillOpen({ archive: () => archive, more: async () => ({ worktrees }), now: () => NOW });
  await so.refresh("c1");
  const o = so.of("c1");
  assert.equal(o.lines.length, OPEN_MOST + 1);
  assert.equal(o.lines.at(-1), "- and 1 more worktrees left over");
  assert.equal(o.rows.length, OPEN_MOST + 1, "a row each");
  const last = `worktree:/r-${OPEN_MOST}`;
  assert.deepEqual(so.dismiss("c1", [last]), { dismissed: [last], unknown: [], waits: [] });
  assert.ok(!so.keys("c1").includes(last));
  assert.equal(so.of("c1").lines.length, OPEN_MOST, "the most, and no more");
});

// (fails before: yes — the review of 11-09: a sub-agent followed up was told as its change "applied or dropped")
test("a sub-agent whose change waited, followed up and at work again, is no change applied or dropped; once it goes, it is", () => {
  const { so, agents } = chatOf();
  so.heard("c1", so.keys("c1"));
  agents.sa_1.running = true;
  assert.deepEqual(so.keys("c1"), ["agent:sa_1:working", "graph:t3:waits"]);
  assert.equal(so.due("c1"), null);
  agents.sa_1.running = false;
  agents.sa_1.files = 0;
  assert.equal(so.due("c1")?.why, "changed");
});

// (fails before: yes — nothing read a chat's graph tasks' or workers' changes for the list)
// (fails before: yes — the owner's of 11-10: sa_9c3a5f84's 35 files, its task c1 dropped and its graph closed by the next
// checklist, waited in Changes while Still open said "Nothing is waiting or running": the registry's list leaves a task's
// change to its graph, and the graph that holds it was gone.)
test("an earlier graph's task's change still waits: its id gone from the graph, or taken by one of a graph begun after its sub-agent ended — said with its ways out, mark_applied among them; an earlier try of this graph's own task is an earlier try's", () => {
  const work = { pending: 35, sig: "b:h" };
  const sub = { id: "sa_9c3a5f84", status: "done", task: "c1", description: "c1: The switch", endedAt: NOW - 16 * 60 * MIN, work };
  const was = /** @type {const} */ ({ kind: "earlier", task: "c1", description: "c1: The switch", id: "sa_9c3a5f84", files: 35, mark: "b:h", since: NOW - 16 * 60 * MIN });
  // Its id gone from the graph.
  assert.deepEqual(changesOf([sub], { startedAt: NOW - 60 * MIN, tasks: [{ id: "p1", state: "running" }] }), [was]);
  // Its id taken by the new graph's own c1.
  assert.deepEqual(changesOf([sub], { startedAt: NOW - 60 * MIN, tasks: [{ id: "c1", state: "merging", step: "yours", agent: "sa_new" }] }), [was]);
  // This graph's c1, sent to a new sub-agent: the earlier try's change waits in Changes all the same (Fable52's of 11-10).
  assert.deepEqual(changesOf([sub], { startedAt: NOW - 20 * 60 * MIN, tasks: [{ id: "c1", state: "merging", step: "yours", agent: "sa_new" }] }), [
    { kind: "try", task: "c1", description: "c1: The switch", id: "sa_9c3a5f84", files: 35, mark: "b:h", since: NOW - 16 * 60 * MIN },
  ]);
  const o = openList({ shells: [], agent: null, changes: [was], now: NOW });
  assert.deepEqual(o.keys, ["agent:sa_9c3a5f84:waits"]);
  assert.equal(o.lines[0], '- sub-agent sa_9c3a5f84 ("c1: The switch"), of task c1 of an earlier task graph: 35 files of its change still wait in its copy (for 16 h) — agent with agent_id "sa_9c3a5f84" and apply_changes: true to apply it, mark_applied: true where it came into your folder another way, or leave it [agent:sa_9c3a5f84:waits]');
  assert.deepEqual(o.rows[0].view, { group: "waiting", tone: "wait", title: "c1: The switch", detail: "An earlier task graph's c1 · 35 files of its change still to apply · waiting 16 h", act: "review", agent: "sa_9c3a5f84" });
});

// (fails before: yes — the owner's of 11-10: a dismissed change kept waiting in Changes, and the agent was told only that
// Filament would leave it out)
test("dismissing a sub-agent's change that waits says it still waits in the person's Changes, and how a mark ends that; a worker's is its lead's", () => {
  const so = createStillOpen({ archive: () => archiveOf(), changes: () => [{ kind: "dropped", id: "sa_8", task: "t4", title: "old", files: 1, mark: "m" }, { kind: "worker", id: "sa_9", description: "tests", files: 2, mark: "w" }], now: () => NOW });
  const r = so.dismiss("c1", ["graph:t4:dropped", "worker:sa_9:waits"]);
  assert.deepEqual(r, { dismissed: ["graph:t4:dropped", "worker:sa_9:waits"], unknown: [], waits: ["sa_8"] });
  assert.equal(dismissAnswer(r), "Dismissed graph:t4:dropped, worker:sa_9:waits: Filament leaves them out of what is still open until what they name changes. The change of sub-agent sa_8 still waits in the person's Changes: where it came into your folder another way, mark it applied (agent with its agent_id and mark_applied: true), so it waits there no more either.");
  assert.equal(dismissAnswer({ dismissed: ["copies:/r"], unknown: [] }), "Dismissed copies:/r: Filament leaves it out of what is still open until what it names changes.");
});

test("the changes that wait, from the chat's sub-agents and its graph: a task's ready change, a dropped task's, a task's older sub-agent's, a worker's — never one that works, a lost attempt or one in review", () => {
  const work = (/** @type {number} */ pending) => ({ pending, sig: "aaaaaaaaaaaa:bbbbbbbbbbbb" });
  const subs = [
    { id: "sa_1", status: "done", task: "t1", endedAt: NOW - 5 * MIN, work: work(2) },
    { id: "sa_2", status: "done", task: "t2", endedAt: NOW, work: work(1) },
    { id: "sa_3", status: "done", task: "t3", work: work(1) },
    { id: "sa_4", status: "done", task: "t4", work: work(3) },
    { id: "sa_5", status: "done", team: { key: "builders" }, description: "tests", work: work(2) },
    { id: "sa_6", status: "running", team: { key: "builders" }, work: work(2) },
    { id: "sa_7", status: "done", team: { key: "builders" }, attempt: { dropped: "sa_5" }, work: work(2) },
    { id: "sa_8", status: "done", work: work(4) },
    { id: "sa_9", status: "done", team: { key: "builders" }, work: work(0) },
  ];
  const graph = {
    tasks: [
      { id: "t1", name: "parser", state: "merging", step: "yours", agent: "sa_1" },
      { id: "t2", name: "old idea", state: "dropped", agent: "sa_2" },
      { id: "t3", name: "lexer", state: "review", step: "reading", agent: "sa_3" },
      { id: "t4", name: "docs", state: "merging", step: "yours", agent: "sa_40" },
    ],
  };
  const worker = { kind: "worker", description: "tests", id: "sa_5", files: 2, mark: "aaaaaaaaaaaa:bbbbbbbbbbbb", since: null };
  assert.deepEqual(changesOf(subs, graph), [
    { kind: "graph", task: "t1", title: "parser", id: "sa_1", files: 2, mark: "aaaaaaaaaaaa:bbbbbbbbbbbb", since: NOW - 5 * MIN },
    { kind: "dropped", task: "t2", title: "old idea", id: "sa_2", files: 1, mark: "aaaaaaaaaaaa:bbbbbbbbbbbb", since: NOW },
    // t4's older sub-agent: its change waits in Changes, and no task holds it (Fable52's of 11-10).
    { kind: "try", task: "t4", description: "", id: "sa_4", files: 3, mark: "aaaaaaaaaaaa:bbbbbbbbbbbb", since: null },
    worker,
  ]);
  // No graph holds a task's change any more: each is an earlier graph's (the owner's of 11-10), never one that works,
  // a lost attempt or a worker's.
  const earlier = (/** @type {string} */ id, /** @type {string} */ task, /** @type {number} */ files, /** @type {number | null} */ since) => ({ kind: "earlier", task, description: "", id, files, mark: "aaaaaaaaaaaa:bbbbbbbbbbbb", since });
  assert.deepEqual(changesOf(subs, null), [earlier("sa_1", "t1", 2, NOW - 5 * MIN), earlier("sa_2", "t2", 1, NOW), earlier("sa_3", "t3", 1, null), earlier("sa_4", "t4", 3, null), worker], "no graph: each task's change is an earlier graph's");
  // A lead's list (workers false) leaves its workers' changes to its team's words.
  const open = createStillOpen({ archive: () => archiveOf(), changes: () => changesOf(subs, graph), now: () => NOW });
  assert.ok(open.lines("c1").some((l) => l.endsWith("[worker:sa_5:waits]")));
  assert.ok(!open.of("c1", null, { workers: false }).keys.includes("worker:sa_5:waits"), "a lead's list: none of its workers");
});

// (fails before: yes — no folder was read for the list)
test("what the folder holds, for a chat: each change's drift by its base, this chat's failed captures — the registry's and the copies marked unsaved, once each —, the chat's own worktree never a leftover", async () => {
  /** @type {string[]} */
  const bases = [];
  const more = await moreOf({
    chain: "c1",
    folder: "H:\\proj\\app-feature",
    subs: [
      { id: "sa_1", status: "done", work: { pending: 2, sig: "1111111111aa:2222222222bb" } },
      { id: "sa_2", status: "running", work: { pending: 1, sig: "3333333333cc:4444444444dd" } },
      { id: "sa_3", status: "done", work: { pending: 1, sig: "5555555555ee:6666666666ff" } },
      { id: "sa_4", status: "done", work: null },
    ],
    failed: [
      { id: "sa_4", chainId: "c1", error: "disk full", dest: "/c/4", at: NOW },
      { id: "sa_x", chainId: "c2", error: "disk full", dest: "/c/x", at: NOW },
    ],
    holds: {
      unsaved: [
        { agent: "sa_4", dest: "/c/4", error: "older words", at: NOW - MIN },
        { agent: "sa_3", dest: "/c/3", error: "locked", at: NOW - MIN },
        { agent: "sa_other", dest: "/c/o", error: "locked", at: NOW - MIN },
      ],
      copies: [{ repo: "/r", count: 0, bytes: null }],
      worktrees: [
        { path: "H:/proj/app-feature", branch: "feature", into: "main", head: "abc", age: null },
        { path: "H:/proj/app-old", branch: "old", into: "main", head: "def", age: null },
      ],
      forks: [{ chain: "c_gone", path: "/f", head: "f1", why: null }],
    },
    count: async (base) => {
      bases.push(base);
      if (base === "5555555555ee") throw new Error("git could not tell");
      return 3;
    },
  });
  assert.deepEqual(bases.sort(), ["1111111111aa", "5555555555ee"], "the waiting changes' bases alone, not one that works");
  assert.deepEqual(more.drift, { sa_1: 3 }, "one git could not tell: no drift said");
  assert.deepEqual(more.uncaptured, [
    { id: "sa_4", error: "disk full", dest: "/c/4", at: NOW },
    { id: "sa_3", error: "locked", dest: "/c/3", at: NOW - MIN },
  ]);
  assert.deepEqual(more.copies, [], "no copy on disk: nothing to say");
  assert.deepEqual(more.worktrees?.map((w) => w.path), ["H:/proj/app-old"], "the chat's own folder is no leftover");
  assert.deepEqual(more.forks?.map((f) => f.chain), ["c_gone"]);
  assert.deepEqual(await moreOf({ chain: "c1", folder: "/x", subs: [], holds: null }), { drift: {}, uncaptured: [], deleted: [], copies: [], worktrees: [], branches: [], forks: [] }, "no repository: nothing");
});

// (fails before: yes — a coding agent's envelope took no dismiss)
test("a coding agent's envelope dismisses by the ids, over Filament's tools: a call of its own; a session with no chat has nothing to dismiss from", async () => {
  /** @type {any[]} */
  const asked = [];
  const tools = createAgentTools({
    memory: null,
    memoryToolsOn: () => false,
    graphs: () => null,
    turns: createAgentTurns(),
    subagents: () => null,
    membersOf: () => null,
    dismiss: (chain, ids) => {
      asked.push({ chain, ids: [...ids] });
      return { dismissed: ["graph:t1:waits"], unknown: ["nope"] };
    },
  });
  const ctx = { cwd: "/w", upstream: "claude-code", chain: "c1", turn: null, graph: false };
  const r = await tools.call("envelope", { dismiss: ["[graph:t1:waits]", "nope"] }, /** @type {any} */ (ctx));
  assert.deepEqual(asked, [{ chain: "c1", ids: ["[graph:t1:waits]", "nope"] }]);
  assert.equal(r.isError, undefined);
  assert.equal(r.text, "Dismissed graph:t1:waits: Filament leaves it out of what is still open until what it names changes. Nothing open now goes by nope: give the ids in brackets that end the lines of what is still open.");
  const both = await tools.call("envelope", { dismiss: ["graph:t1:waits"], all: true }, /** @type {any} */ (ctx));
  assert.match(both.text, /The rest of the call was not run: dismiss goes in a call of its own\.$/);
  const none = await tools.call("envelope", { dismiss: ["graph:t1:waits"] }, /** @type {any} */ ({ ...ctx, chain: null }));
  assert.equal(none.isError, true);
  assert.equal(asked.length, 2, "nothing asked without a chat");
});

// What Filament reads of a chat's repository for the list, end to end (server.js): a real repository with a worktree
// whose branch main has whole, one whose branch holds a commit main lacks, and Filament's copies folder.
describe("the folder's reads, through Filament", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  let root = "";
  let repo = "";
  const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...args) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd, stdio: "pipe" });
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-still-open-fuller-"));
    repo = join(root, "app");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "commit", "-q", "--allow-empty", "-m", "one");
    git(repo, "worktree", "add", "-q", "-b", "done-feature", join(root, "app-done"));
    git(repo, "worktree", "add", "-q", "-b", "open-feature", join(root, "app-open"));
    git(join(root, "app-open"), "commit", "-q", "--allow-empty", "-m", "two");
    up = await fakeUpstream(() => anthropicReply("ok", { model: "m-1" }));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });

  // (fails before: yes — nothing read the chat's folder for the list)
  test("a worktree main has whole is left over, named by its path; one ahead of main, and the chat's own folder, are not; Undo of a key not dismissed is ok", async () => {
    const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: repo, model: "m-1", preset: "plain" } })).json()).id);
    /** @type {any[]} */
    let items = [];
    await until(async () => {
      items = (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}`)).json()).open?.items || [];
      return items.some((/** @type {any} */ i) => i.key.startsWith("worktree:"));
    }, "the folder's reads, in the card's items");
    const left = items.filter((/** @type {any} */ i) => i.key.startsWith("worktree:"));
    assert.equal(left.length, 1, JSON.stringify(items));
    assert.match(left[0].key, /app-done$/);
    assert.match(left[0].line, /^worktree .*app-done \(branch done-feature\): merged into main, nothing uncommitted, its last commit .* ago — the person removes it at the project's Folders and worktrees… \(its menu in the left bar, or ⋯ on its page\) with its … › Remove worktree and branch…, or leaves it/);
    assert.equal(left[0].dismissed, false);
    assert.ok(!items.some((/** @type {any} */ i) => /app-open|app$/.test(i.key)), "ahead of main, or the chat's own: none");
    const undo = await shim.api(`/api/sessions/${encodeURIComponent(id)}/open/undismiss`, { method: "POST", body: { key: left[0].key } });
    assert.deepEqual(await undo.json(), { ok: true });
  });

  // (fails before: yes — the reviewer's of 11-10 and the review of 4569417b8: the folder's holds were kept five minutes
  // and the chat's reads one, so the card said a worktree removed at Space › places for minutes after)
  test("a merged worktree removed at Space › places leaves the chat's Still open at its next look: the answer waits for the read anew", async () => {
    const repo2 = join(root, "tidy");
    mkdirSync(repo2);
    git(repo2, "init", "-q", "-b", "main");
    git(repo2, "commit", "-q", "--allow-empty", "-m", "one");
    const done = join(root, "tidy-done");
    git(repo2, "worktree", "add", "-q", "-b", "tidy-feature", done);
    const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: repo2, model: "m-1", preset: "plain" } })).json()).id);
    // The card's read, which waits for the folder's (`?open=fresh`).
    const openOf = async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}?open=fresh`)).json()).open;
    await until(async () => (await openOf())?.items?.some((/** @type {any} */ i) => /tidy-done$/.test(i.key)), "the worktree left over, in the card's items");
    const removed = await shim.api("/api/git/places/remove", { method: "POST", body: { cwd: repo2, path: done, branch: true } });
    assert.equal(removed.status, 200, await removed.clone().text());
    const open = await openOf();
    assert.deepEqual(open.items.filter((/** @type {any} */ i) => i.key.startsWith("worktree:")), [], "at the next look");
    assert.equal(open.stale, undefined, "read anew within the wait");
  });

  // (fails before: yes — the review of 11-09: the list read nobody at work in a worktree, and told another chat to remove
  // the merged worktree a chat works in now, which Space › places refuses)
  test("a merged worktree another chat works in now is no leftover; once that chat is idle, it is", async () => {
    const app = /** @type {any} */ (shim.app);
    const chatAt = async (/** @type {string} */ cwd) => String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd, model: "m-1", preset: "plain" } })).json()).id);
    const itemsOf = async (/** @type {string} */ id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}`)).json()).open?.items || [];
    const done = /app-done$/;
    const working = await chatAt(join(root, "app-done"));
    const key = app.memory.archive.getChain(working).key;
    const lock = await app.sessionTurns.acquire(key, { window: "harness", client: "harness" });
    assert.equal(lock.ok, true);
    try {
      const other = await chatAt(repo);
      // The folder's reads land behind an ask: none of the asks while that chat works names its worktree.
      for (let i = 0; i < 10; i++) {
        const items = await itemsOf(other);
        assert.ok(!items.some((/** @type {any} */ x) => done.test(x.key)), JSON.stringify(items));
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      app.sessionTurns.release(key, lock.token);
    }
    const idle = await chatAt(repo);
    await until(async () => (await itemsOf(idle)).some((/** @type {any} */ x) => done.test(x.key)), "idle: left over again");
  });

  // (fails before: yes — the hunt of 11-09: the footprint that measured the copies was the git rows' own, and the list's
  // read of the repository counted them with no size, ever)
  test("Filament's copies of the chat's repository say their disk once Space › places measured them", async () => {
    const sized = join(root, "sized");
    mkdirSync(sized);
    git(sized, "init", "-q", "-b", "main");
    writeFileSync(join(sized, "a.txt"), "x".repeat(4096));
    git(sized, "add", "-A");
    git(sized, "commit", "-q", "-m", "one");
    const c = await openCheckTree(sized, { id: "chk-sized", commit: git(sized, "rev-parse", "HEAD").toString().trim() });
    assert.ok(c.ok, c.ok ? "" : c.error);
    if (!c.ok) return;
    await releaseTaskWorktree(c.wt, "free");
    // Space › places' footprint line reads the repository, and measures its copies.
    const fp = await (await shim.api(`/api/git/footprint?cwd=${encodeURIComponent(sized)}`)).json();
    assert.equal(fp.ok, true, fp.error);
    assert.ok(fp.copies.count === 1 && fp.copies.bytes > 0, JSON.stringify(fp.copies));
    const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: sized, model: "m-1", preset: "plain" } })).json()).id);
    let line = "";
    await until(async () => {
      const items = (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}`)).json()).open?.items || [];
      line = items.find((/** @type {any} */ i) => i.key.startsWith("copies:"))?.line || "";
      return !!line;
    }, "the copies' line, in the card's items");
    assert.match(line, /Filament's copies of .*: 1 on disk, \d+(\.\d)? (KB|MB) — the person sees them/);
  });

  /** A repository of its own under the rig's root, with a worktree whose branch main has whole. @param {string} name */
  const repoWithMerged = (name) => {
    const at = join(root, name);
    mkdirSync(at);
    git(at, "init", "-q", "-b", "main");
    git(at, "commit", "-q", "--allow-empty", "-m", "one");
    git(at, "worktree", "add", "-q", "-b", `${name}-feature`, join(root, `${name}-done`));
    return at;
  };
  /** A chat in a folder. @param {string} cwd */
  const chatIn = async (cwd) => String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd, model: "m-1", preset: "plain" } })).json()).id);
  /** A repository's read runs a score of git commands: beside other suites it takes longer than a wait's ten seconds. */
  const READ = { timeoutMs: 30_000 };
  /** What the session's answer says is still open, as the Plan's card asks it: the read that waits for the folder's. @param {string} id */
  const openOf = async (id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}?open=fresh`)).json()).open;
  /** The same of a read that shows no list — a pin's, a title's —, which waits for nothing. @param {string} id */
  const openAtOnce = async (id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}`)).json()).open;

  // (fails before: yes — the re-read of 11-11: the first look at a chat had none of its folder's rows and no word that
  // they were being read, so the card said nothing was left behind until the page asked again half a minute on)
  test("the first look at a chat whose folder was never read waits a moment for the read, and says where it is still under way: never nothing, unsaid", async () => {
    const id = await chatIn(repoWithMerged("first"));
    const open = await openOf(id);
    assert.ok(open.stale === true || open.items.some((/** @type {any} */ i) => /first-done$/.test(i.key)), JSON.stringify(open));
    await until(async () => (await openOf(id)).items.some((/** @type {any} */ i) => /first-done$/.test(i.key)), "the worktree left over, in the card's items", READ);
    assert.equal((await openOf(id)).stale, undefined, "read: nothing under way");
  });

  // (fails before: yes — every read of a session waited for the folder's read, two and a half seconds at most: the
  // header's read of a pin, a phone's, the command line's, none of which shows the list)
  test("only the read that shows the list waits for the folder's read: any other answers at once, with the list as last read and the word that a read is under way", async () => {
    const id = await chatIn(repoWithMerged("pin"));
    const mine = (/** @type {any} */ open) => open.items.filter((/** @type {any} */ i) => /pin-done$/.test(i.key)).length;
    // A folder never read: its first read begins behind the answer, which says so and has none of its rows yet.
    const first = await openAtOnce(id);
    assert.equal(first.stale, true, "the first read is under way, said");
    assert.equal(mine(first), 0, "none of the folder's rows yet");
    await until(async () => mine(await openOf(id)) === 1, "the worktree left over, in the card's items", READ);
    assert.equal((await openAtOnce(id)).stale, undefined, "read: nothing under way");
    // What the folders hold moved: the read anew begins behind the answer, which has the last read's rows and says so.
    assert.equal((await shim.api("/api/git/footprint/clean", { method: "POST", body: { cwd: repo, plan: {} } })).status, 200);
    const moved = await openAtOnce(id);
    assert.equal(moved.stale, true, "the read anew is under way, said");
    assert.equal(mine(moved), 1, "the last read's rows");
    await until(async () => (await openOf(id)).stale === undefined, "the read anew, landed", READ);
    assert.equal(mine(await openAtOnce(id)), 1);
  });

  // (fails before: yes — the re-read of 11-11: a read git refused listed nothing, taken as word that nothing was there:
  // the turn's end let go of every dismissal of the folder's lines, and each came back at the next read that worked)
  test("a read of the repository that fails lets go of no dismissal: once git reads it again, the line the agent dismissed is still dismissed", async () => {
    const flaky = repoWithMerged("flaky");
    const id = await chatIn(flaky);
    /** @type {any} */
    let row = null;
    const rowNow = async () => (row = (await openOf(id)).items.find((/** @type {any} */ i) => /flaky-done$/.test(i.key)) || null);
    await until(rowNow, "the worktree left over, in the card's items", READ);
    // The agent dismissed the line, as its envelope's dismiss keeps it: by the worktree's head.
    const head = git(join(root, "flaky-done"), "rev-parse", "HEAD").toString().trim();
    /** @type {any} */ (shim.app.memory).archive.mergeMeta(id, { openDismissed: { [row.key]: head } });
    assert.equal((await rowNow())?.dismissed, true, "dismissed as it stands");
    // What the folders hold moved (a Clean up of another repository's nothing): every chat's reads are read anew.
    const moved = async () => assert.equal((await shim.api("/api/git/footprint/clean", { method: "POST", body: { cwd: repo, plan: {} } })).status, 200);
    renameSync(join(flaky, ".git", "HEAD"), join(flaky, ".git", "HEAD.away"));
    try {
      await moved();
      await until(async () => !(await rowNow()) && (await openOf(id)).stale === undefined, "the read that failed, landed: nothing of the folder listed", READ);
      // A turn ends: what was dismissed and stands no more is let go — never for a read that could not tell.
      const turn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
      assert.equal(turn.status, 200, await turn.clone().text());
    } finally {
      renameSync(join(flaky, ".git", "HEAD.away"), join(flaky, ".git", "HEAD"));
    }
    await moved();
    await until(rowNow, "the worktree left over, read again", READ);
    assert.equal(row.dismissed, true, "still dismissed");
  });

  // (fails before: yes — the re-read of 11-11: the card's read of the list took none of the coding agent's own tasks)
  test("the coding agent's own background tasks are among the card's items, as a reader that runs none hears them; ended, they go", async () => {
    const id = await chatIn(repo);
    const acp = /** @type {any} */ (shim.app).acp;
    acp.onTasks({ chain: id, sessionId: "agent-x", tasks: [{ id: "bt-dev", kind: "local_bash", description: "npm run dev", background: true, since: Date.now() - 3 * 60_000 }] });
    const mine = async () => (await openOf(id)).items.filter((/** @type {any} */ i) => i.key.startsWith("theirs:") || i.key.startsWith("task:"));
    const items = await mine();
    assert.deepEqual(items.map((/** @type {any} */ i) => [i.key, i.view.group, i.view.title, i.dismissed]), [["theirs:bt-dev", "running", "npm run dev", false]]);
    // Its clock runs on while the answer waits for the folder's first read: the seconds past its three minutes are its own.
    assert.match(items[0].view.detail, /^In the coding agent's session of this chat, running 3 min( \d+ s)?$/);
    acp.onTasks({ chain: id, sessionId: "agent-x", tasks: [] });
    assert.deepEqual(await mine(), []);
  });
});
