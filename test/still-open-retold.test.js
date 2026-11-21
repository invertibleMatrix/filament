// @ts-check
// What is still open, told again after every compaction, in every runtime (the owner's plan of 11-02, Phase 4b): the
// list's kinds — the coding agent's own background tasks, a sub-agent that asks the person, one that failed since the
// chat's newest summary an agent reads —, what the chat keeps of what its main agent heard of it and when it says the list
// again, and the chat's status; then through the app: a coding agent that compacts its own context hears the list at its
// next step in that turn, or with its next turn's first prompt — never as a prompt of its own —; the record moves only for
// what reached the agent; its own compaction outside a turn and Filament's summary of its chat each bring the list back;
// Filament's own loop says at a turn's start a change it was told of that went. The block after a summary is
// still-open.test.js's.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Archive } from "../src/services/memory/archive.js";
import { Sink } from "../src/services/memory/import/sink.js";
import { RECALL_AFTER, WAITS_LONG_MS, createStillOpen, goThrough, openList, openWords } from "../src/app/agent/still-open.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { CODER_UNPLANNED_LINE } from "../src/app/agent/tools.js";
import { capsuleWords, openCounts, stillOpenRows } from "../src/ui/harness/conversation/status-panel.js";
import { cancelComeBack, comeBackLater, comeBackOf, disposeBackgroundShells, disposeSpills, startCommandShell, stopShell, takeShellExits, tellLater } from "../src/adapters/tools/hands.js";
import { SHELL } from "../src/adapters/tools/shell.js";
import { FAKE_ACP_AGENT, FIXTURES, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

// An agent that takes no MCP server over HTTP stands for one Filament's tools don't reach: with the relay off, as
// FILAMENT_MCP_RELAY=off keeps it (the review of 11-10 gave such an agent the relay where it works).
process.env.FILAMENT_MCP_RELAY = "off";

after(async () => {
  await disposeBackgroundShells();
  disposeSpills();
});

const NOW = 1_800_000_000_000;
/** A running command, as the shells' registry says it. @param {string} id @param {number} minutes */
const shell = (id, minutes) => ({ id, command: "npm run dev", cwd: "/p", startedAt: NOW - minutes * 60_000, agent: null, out: "", produced: 0, logPath: null });
/** A command that runs until it is stopped. */
const LONG = SHELL.kind === "cmd" ? `node -e "setInterval(()=>{},1000)"` : "sleep 120";
/** The words a change that went says, with nothing else open. */
const CHANGED_ALONE = "[Filament: A sub-agent's change you were told waits for you to apply it was applied or dropped since. Nothing else is still open now.]";

// (fails before: yes — the list said the commands and the sub-agents working or waiting: never the agent's own background
// tasks, a question that waits for the person, or a sub-agent that failed)
test("the list: the agent's own background tasks, a sub-agent that asks the person, one that failed — each a line, and a key that says what it is and how it stands", () => {
  const got = openList({
    shells: [shell("bg_a", 3)],
    agent: null,
    agents: [
      { id: "sa_1", description: "run the tests", running: true, files: 0, asks: true },
      { id: "sa_2", description: "", running: true, files: 0 },
      { id: "sa_3", description: "port it", running: false, files: 2, failed: null },
      { id: "sa_4", description: "lint", running: false, files: 0, failed: "the provider said Authorization: Bearer abcdefghijklmnop1234 is no key" },
      { id: "sa_5", description: "done", running: false, files: 0 },
    ],
    tasks: [
      { id: "task_b", kind: "local_agent", description: "explore the repo", since: NOW - 60_000 },
      { id: "bash_1", kind: "local_bash", description: "npm run watch", since: NOW - 120_000 },
    ],
    now: NOW,
  });
  assert.deepEqual(got.lines, [
    "- background command bg_a: `npm run dev` in /p, running for 3 min [command:bg_a]",
    '- your own background shell bash_1 ("npm run watch"): running for 2 min — yours to read and to stop, with your own tools [task:bash_1]',
    '- your own background agent task_b ("explore the repo"): running for 1 min — yours to read and to stop, with your own tools [task:task_b]',
    '- sub-agent sa_1 ("run the tests"): still working; it waits for the person\'s answer to its question; its report comes to you [agent:sa_1:asks]',
    "- sub-agent sa_2: still working; its report comes to you [agent:sa_2:working]",
    '- sub-agent sa_3 ("port it"): 2 files of its work wait to be applied [agent:sa_3:waits]',
    '- sub-agent sa_4 ("lint"): failed — the provider said Authorization: Bearer [redacted] is no key; follow it up to try again, or leave it [agent:sa_4:failed]',
  ]);
  assert.deepEqual(got.keys, ["command:bg_a", "task:bash_1", "task:task_b", "agent:sa_1:asks", "agent:sa_2:working", "agent:sa_3:waits", "agent:sa_4:failed"]);
  assert.deepEqual(openList({ shells: [], agent: null, now: NOW }), { lines: [], keys: [], plain: [], rows: [], all: [] });
  // Said again: in the words of why, the lines in <open>; a change that went with nothing else open, that.
  // After a compaction, recall's list of the turns too (the owner's of 11-08: past one, what an earlier turn said was left
  // was lost); after a change alone, not. After every compaction, the agent is asked to go through it (the owner's of 11-09).
  assert.equal(openWords(["- a"], "compacted"), `[Filament: You compacted your context just now, and its summary may have left out what is still open. ${goThrough("it")} As it stands now — read a command's output or stop it by its id rather than starting it again:]\n<open>\n- a\n</open>\n${RECALL_AFTER}`);
  assert.equal(RECALL_AFTER, "[Filament: filament_recall with no arguments lists this chat's turns, newest first, with how each answer ended.]");
  // (fails before: yes — d-send's follow-up: "since your last message" was untrue of a compaction in the agent's last
  // turn, before its reply, of one said turns later, and of an agent the chat moved to, which sent none)
  assert.match(openWords(["- a"], "lost"), /^\[Filament: You compacted your context earlier, and its summary may have left out what is still open\. Go through it now: [^]*<\/open>\n\[Filament: filament_recall with no arguments/);
  assert.equal(["lost", "folded"].map((w) => openWords(["- a"], /** @type {any} */ (w))).concat(openWords([], "lost")).filter((t) => t.includes("since your last message")).length, 0, "no line says when the agent last wrote");
  assert.match(openWords(["- a"], "changed"), /^\[Filament: A sub-agent's change you were told waits for you to apply it was applied or dropped since\. As it stands now[^]*<\/open>$/);
  assert.equal(openWords([], "changed"), CHANGED_ALONE);
});

// (fails before: yes — the compaction audit of 11-07: a summary of the turn a letter came in could keep no word of it,
// and nothing after the summary said a reply was owed)
test("the letters that wait for an agent's reply: the main agent's from another chat or its sub-agent, a sub-agent's those written to it — each a line, oldest first, gone once answered", () => {
  /** @type {Record<string, any>} */
  const asks = {
    lt_b: { from: "ch_other", subject: "Which port does the API use?", at: NOW - 120_000 },
    lt_a: { from: "ch_1", subject: "Is the schema final?\nmore", at: NOW - 300_000, by: "sa_7" },
    lt_c: { from: "ch_1", subject: "Rebase first?", at: NOW - 60_000, for: "sa_9" },
  };
  const a = {
    metaOf: (/** @type {string} */ chain) => (chain === "ch_1" ? { letters: { asks } } : null),
    mergeMeta: () => {},
    getCompactions: () => [],
    getChain: (/** @type {string} */ id) => (id === "ch_other" ? { title: "API work" } : null),
  };
  const open = createStillOpen({ archive: () => a, now: () => NOW });
  assert.deepEqual(open.lines("ch_1").filter((l) => l.startsWith("- letter")), [
    '- letter lt_a, "Is the schema final? more", from your sub-agent sa_7, 5 min ago: it waits for your reply — send it with Filament\'s envelope tool (answer: "lt_a"), or leave it [letter:lt_a]',
    '- letter lt_b, "Which port does the API use?", from the chat "API work" (ch_other), 2 min ago: it waits for your reply — send it with Filament\'s envelope tool (answer: "lt_b"), or leave it [letter:lt_b]',
  ]);
  assert.deepEqual(open.keys("ch_1"), ["letter:lt_a", "letter:lt_b"]);
  assert.deepEqual(open.of("ch_1", "subagent:sa_9").lines, ['- letter lt_c, "Rebase first?", from the main agent, 1 min ago: it waits for your reply — send it with Filament\'s envelope tool (answer: "lt_c"), or leave it [letter:lt_c]'], "a sub-agent's own");
  // (fails before: yes — the review of 899e379e0: a letter whose writer is gone was listed after every summary, and
  // answering it said "Not sent")
  /** @type {Record<string, { chainId: string, status: string }>} */
  const agents = { sa_7: { chainId: "ch_1", status: "running" } };
  const reaching = createStillOpen({ registry: { get: (id) => agents[id] ?? null }, archive: () => a, now: () => NOW });
  assert.deepEqual(reaching.keys("ch_1"), ["letter:lt_a", "letter:lt_b"], "its writers there: each");
  agents.sa_7.status = "done";
  asks.lt_d = { from: "ch_deleted", subject: "Still there?", at: NOW - 30_000 };
  assert.deepEqual(reaching.keys("ch_1"), ["letter:lt_b"], "a sub-agent that finished, and a chat that is gone: a reply reaches neither, so neither is listed");
  delete asks.lt_a;
  delete asks.lt_b;
  delete asks.lt_d;
  assert.deepEqual(open.lines("ch_1"), [], "answered: none");
});

// (fails before: yes — the registry's open work said those working and those whose work waits: never one that asks the
// person, nor one that failed)
test("the registry's open work: a failure since the chat's newest summary — never a stop, a team's worker's, or one before it — and a change that waits over a failure", () => {
  /** A kept thread, as a session saves it. @param {number} i @param {string} status @param {Record<string, any>} over @param {Record<string, any>} [outcome] @returns {any} */
  const thread = (i, status, over, outcome = {}) => ({
    id: `sa_0000000${i}`, origin: "agent", may: "read", asked: false, card: { tag: "helper", name: "Helper", kind: "worker", may: "read", thinks: "" },
    team: null, model: "m", description: `Kept ${i}`, cwd: tmpdir(), mode: null, view: "none", running: false, changes: null, start: null, seen: null,
    memory: false, deliver: true, aside: false, status, startedAt: 1000 + i, shares: null, cut: false, thinking: null, opening: [], work: null,
    exchanges: [{ prompt: `do ${i}`, description: `Kept ${i}`, by: "agent", runId: `run-k${i}`, status, startedAt: 1000 + i, endedAt: 5000 + i, delivery: "delivered", outcome: { report: "", error: "the provider refused the request", ms: 5, rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, wrote: false, ...outcome } }],
    ...over,
  });
  const kept = [
    thread(1, "failed", {}),
    thread(2, "aborted", {}, { stoppedBy: "harness", error: "stopped" }),
    thread(3, "failed", { team: { key: "builders", name: "Builders", role: "builder" } }),
    thread(4, "failed", { may: "edit", work: { repo: join(tmpdir(), "no-such-repo"), base: "b4", head: "h4", files: [{ path: "a.txt", added: 1, removed: 0 }], applied: [] } }),
    thread(5, "done", {}),
    thread(6, "aborted", {}, { error: "Filament stopped before it finished" }),
    thread(7, "done", { may: "edit", team: { key: "builders", name: "Builders", role: "builder" }, work: { repo: join(tmpdir(), "no-such-repo"), base: "b7", head: "h7", files: [{ path: "b.txt", added: 1, removed: 0 }], applied: [] } }),
  ];
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }] }, loop: { permissions: "read-only" } }),
      session: () => ({ cwd: tmpdir(), model: "m", projectId: null }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      loadThreads: () => structuredClone(kept),
    },
    call: async () => ({ ok: false, status: 500, json: null, id: "x", upstream: "m", retryAfter: null, shouldRetry: null }),
  });
  assert.deepEqual(registry.openWork("c1"), [
    { id: "sa_00000001", description: "Kept 1", running: false, files: 0, failed: "the provider refused the request" },
    { id: "sa_00000004", description: "Kept 4", running: false, files: 1 },
    { id: "sa_00000006", description: "Kept 6", running: false, files: 0, failed: "Filament stopped before it finished" },
    { id: "sa_00000007", description: "Kept 7", running: false, files: 1 },
  ]);
  assert.deepEqual(registry.openWork("c1", { since: 5005 }).map((a) => a.id), ["sa_00000004", "sa_00000006", "sa_00000007"], "a failure before the chat's newest summary is in it");
  assert.deepEqual(registry.openWork("c1", { workers: false }).map((a) => a.id), ["sa_00000001", "sa_00000004", "sa_00000006"], "a lead hears its team's workers in its team's words");
});

/** A chat's list over a real archive, its sub-agents (`agents`) and its agent's tasks (`tasks`) set by the test. */
function heardRig() {
  const dir = mkdtempSync(join(tmpdir(), "filament-still-open-heard-"));
  const a = new Archive({ file: join(dir, "a.db") });
  const c = a.chainForKey("k1", { cwd: "H:\\p", client: "harness" }).id;
  const rig = {
    a,
    c,
    /** @type {(import("../src/app/agent/still-open.js").OpenAgent & { worker?: boolean })[]} */
    agents: [],
    /** @type {import("../src/app/agent/still-open.js").OwnTask[]} */
    tasks: [],
    /** The agent session the tasks run in. */
    taskSession: "s1",
    /** @type {(number | undefined)[]} */
    since: [],
    /** The list's clock: `NOW` until a test moves it. */
    clock: NOW,
    /** When each sub-agent's exchange ended, as the registry says it (`get`), by its id. @type {Record<string, number>} */
    ended: {},
    heard: () => a.metaOf(c, ["openHeard"])?.openHeard,
    close: () => {
      a.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  const registry = {
    openWork: (/** @type {string} */ chain, /** @type {{ since?: number, workers?: boolean } | undefined} */ o) => {
      rig.since.push(o?.since);
      return chain === c ? rig.agents.filter((x) => o?.workers !== false || !x.worker) : [];
    },
    get: (/** @type {string} */ id) => (Object.hasOwn(rig.ended, id) ? { chainId: c, status: "done", endedAt: rig.ended[id] } : null),
  };
  const open = createStillOpen({ registry, archive: () => a, tasks: (_chain, agentSession) => (agentSession === rig.taskSession ? rig.tasks : []), now: () => rig.clock });
  return { ...rig, open, get: () => rig };
}

// (fails before: yes — the owner's of 11-05: the list a chat's agent is told after a compaction could be seen nowhere)
test("the Plan's card reads the list as its agent is told it again, and whether the agent compacted since it heard it", () => {
  const r = heardRig();
  const s = r.get();
  try {
    const { open, c } = r;
    assert.deepEqual(open.shown(c), { lines: [], told: true, items: [] }, "nothing open");
    s.agents = [{ id: "sa_1", description: "tests", running: true, files: 0 }, { id: "sa_2", description: "lint", running: false, files: 2 }];
    assert.deepEqual(open.shown(c).lines, open.lines(c).map((l) => l.replace(/ \[[^\]]+\]$/, "")), "the lines the block after a summary says, without the ids the agent dismisses by");
    assert.deepEqual(open.shown(c).items.map((x) => [x.key, x.dismissed]), [["agent:sa_1:working", false], ["agent:sa_2:waits", false]]);
    assert.equal(open.shown(c).lines.length, 2);
    open.lost(c);
    assert.equal(open.shown(c).told, false, "compacted, nothing said after: its next message says it");
    open.ended(c, true);
    assert.equal(open.shown(c).told, true);
  } finally {
    r.close();
  }
});

// (fails before: yes — the review of 11-03: a command's end, the agent's own task's end and a sub-agent's turn from
// working to asking each said the whole list again at the next turn's start, though the agent hears each by itself)
test("a turn's start says the list again only where a change it was told waits for it went, or it compacted with nothing said after — not a command's end, its own task's, or a sub-agent between working and asking", () => {
  const r = heardRig();
  const s = r.get();
  try {
    const { open, c } = r;
    // Never told: nothing to say at a turn's start, and a turn's end keeps nothing.
    s.agents = [{ id: "sa_1", description: "tests", running: true, files: 0 }];
    assert.equal(open.due(c), null);
    open.ended(c);
    assert.equal(r.heard(), undefined);
    // A summary landed with the list in its block.
    open.told(c);
    assert.deepEqual(r.heard(), { keys: ["agent:sa_1:working"] });
    // Working to asking and back, and its report with its change waiting: nothing to say — its report says it.
    s.agents = [{ id: "sa_1", description: "tests", running: true, files: 0, asks: true }];
    assert.equal(open.due(c), null);
    s.agents = [{ id: "sa_1", description: "tests", running: false, files: 2 }];
    assert.equal(open.due(c), null);
    open.ended(c, false);
    assert.deepEqual(r.heard(), { keys: ["agent:sa_1:waits"] }, "a turn that reached it follows what it heard");
    // The change was applied by the person while no turn ran: the next turn's start says it.
    s.agents = [];
    assert.deepEqual(open.due(c), { text: CHANGED_ALONE, keys: [], why: "changed" });
    open.ended(c, true);
    assert.equal(r.heard(), undefined, "said, with nothing open: nothing kept");
    // The agent compacted with nothing said after: its turn's end keeps that while something is open, and the next start
    // says the list; a turn that took it in moves on.
    s.agents = [{ id: "sa_2", description: "lint", running: true, files: 0 }];
    open.lost(c);
    open.ended(c, false);
    assert.deepEqual(r.heard(), { lost: true });
    assert.equal(open.due(c)?.why, "lost");
    assert.match(String(open.due(c)?.text), /^\[Filament: You compacted your context earlier/);
    open.ended(c, true);
    assert.deepEqual(r.heard(), { keys: ["agent:sa_2:working"] });
    open.untold(c);
    assert.deepEqual(r.heard(), { lost: true });
    s.agents = [];
    // With nothing open, the compaction still waits for the next turn's start, which says recall's list of the turns
    // (the owner's of 11-08: past one, what an earlier turn said was left was lost).
    open.ended(c, false);
    assert.deepEqual(r.heard(), { lost: true }, "nothing open: recall's list to say after it");
    assert.deepEqual(open.due(c), { text: `[Filament: This chat's context was compacted earlier.]\n${RECALL_AFTER}`, keys: [], why: "lost" });
    open.ended(c, true);
    assert.equal(r.heard(), undefined, "said once");
    open.untold(c);
    assert.deepEqual(r.heard(), { lost: true });
  } finally {
    r.close();
  }
});

// (fails before: yes — the gap of 11-11: in a long turn with no compaction and no task ending, a sub-agent's change waited
// unapplied an hour and nothing named it — the list was said at a turn's start and after a compaction alone)
test("a change that waits WAITS_LONG_MS inside one turn with nothing said of it: the next call says the list, once a change in the turn — never in a turn shorter than that, nor for one dismissed", () => {
  const r = heardRig();
  const s = r.get();
  try {
    const { open, c } = r;
    // A change that waited an hour before the turn began, beside a sub-agent at work.
    s.agents = [{ id: "sa_1", description: "tests", running: true, files: 0 }, { id: "sa_2", description: "add export", running: false, files: 2 }];
    s.ended.sa_2 = NOW - 3_600_000;
    assert.equal(open.waited(c), null, "no turn begun: nothing weighed");
    open.begin(c);
    s.clock = NOW + WAITS_LONG_MS - 1_000;
    assert.equal(open.waited(c), null, "a turn shorter than the wait never says it, however long the change waited before it");
    s.clock = NOW + WAITS_LONG_MS;
    const w = open.waited(c);
    assert.deepEqual(w && { keys: w.keys, waits: w.waits }, { keys: ["agent:sa_1:working", "agent:sa_2:waits"], waits: ["agent:sa_2:waits"] });
    assert.equal(w?.text, openWords(open.lines(c), "long"), "the Still open block's words");
    assert.ok(String(w?.text).startsWith(`[Filament: A sub-agent's change still waits for you to apply it, and nothing said so for 20 min. ${goThrough("it")} As it stands now`), w?.text);
    assert.ok(String(w?.text).includes('- sub-agent sa_2 ("add export"): 2 files of its work wait to be applied (for 1 h 20 min) [agent:sa_2:waits]'), w?.text);
    assert.ok(!String(w?.text).includes(RECALL_AFTER), "no compaction: no recall's list");
    assert.deepEqual(open.waited(c)?.waits, ["agent:sa_2:waits"], "not heard yet: weighed again at the next call");
    open.waitedHeard(c, /** @type {any} */ (w));
    assert.deepEqual(r.heard(), { keys: ["agent:sa_1:working", "agent:sa_2:waits"] }, "the chat keeps it heard");
    s.clock = NOW + 5 * WAITS_LONG_MS;
    assert.equal(open.waited(c), null, "once a change in the turn, however long it waits on");
    // A change that came in the turn waits from its own start.
    s.agents.push({ id: "sa_3", description: "lint", running: false, files: 1 });
    s.ended.sa_3 = s.clock;
    assert.equal(open.waited(c), null, "it just came");
    s.clock += WAITS_LONG_MS - 1_000;
    assert.equal(open.waited(c), null);
    s.clock += 1_000;
    const again = open.waited(c);
    assert.deepEqual(again?.waits, ["agent:sa_3:waits"], "the list again, for the change it never named in the turn");
    open.waitedHeard(c, /** @type {any} */ (again));
    // One whose wait's start is unknown — a sub-agent kept over a restart, whose exchange never ended — waited before the
    // turn began: it counts from the turn's start, or the list said whole since (the re-read of 11-11: this pinned "from
    // the call that first saw it", so a change no call had seen for twenty minutes was said at forty).
    s.clock += WAITS_LONG_MS;
    s.agents.push({ id: "sa_4", description: "docs", running: false, files: 1 });
    assert.deepEqual(open.waited(c)?.waits, ["agent:sa_4:waits"], "twenty minutes since the list was said: said at the first call that sees it");
    // One dismissed is not weighed; the next turn weighs from its own start, a change said in a turn before too.
    open.dismiss(c, ["agent:sa_3:waits", "agent:sa_4:waits"]);
    assert.equal(open.waited(c), null, "dismissed: not weighed");
    open.begin(c);
    assert.equal(open.waited(c), null, "a new turn weighs from its start");
    s.clock += WAITS_LONG_MS;
    assert.deepEqual(open.waited(c)?.waits, ["agent:sa_2:waits"]);
  } finally {
    r.close();
  }
});

// (fails before: yes — the same gap: nothing weighed how long a change waited within a turn)
test("a long wait counts from the list said whole in the turn and from a done's word of the change; heard over a compaction nothing said after, that compaction stays for the next turn's start", () => {
  const r = heardRig();
  const s = r.get();
  try {
    const { open, c } = r;
    s.agents = [{ id: "sa_2", description: "add export", running: false, files: 2 }];
    s.ended.sa_2 = NOW - 3_600_000;
    open.begin(c);
    // What comes back after a compaction said the list whole, 15 minutes in.
    s.clock = NOW + 15 * 60_000;
    open.heard(c, open.keys(c));
    s.clock = NOW + 30 * 60_000;
    assert.equal(open.waited(c), null, "15 minutes since the list was said whole");
    s.clock = NOW + 35 * 60_000;
    assert.ok(open.waited(c));
    // A done's "Also still open" names it: from then.
    assert.match(open.also(c, new Set(), new Set()), /^Also still open, beside your graph: sub-agent sa_2 \("add export"\): 2 files/);
    assert.equal(open.waited(c), null, "just named");
    s.clock = NOW + 55 * 60_000;
    const w = open.waited(c);
    assert.ok(w);
    // The agent compacted with nothing said after: what its next turn's start owes stays.
    open.lost(c);
    open.waitedHeard(c, w);
    assert.deepEqual(r.heard(), { lost: true });
    assert.equal(open.due(c)?.why, "lost");
    assert.equal(open.waited(c), null, "said: once in the turn");
  } finally {
    r.close();
  }
});

// (fails before: yes — the review of 11-03: the record kept a command's id, and the list said the agent's own tasks to a
// session that may not run them)
test("what the chat keeps leaves out the agent's own tasks — said only to the session that runs them — and commands' ends say nothing again", async () => {
  const r = heardRig();
  const s = r.get();
  const owner = { session: r.c, agent: null };
  const run = startCommandShell(LONG, tmpdir(), owner, { onEnd: () => {} });
  try {
    const { open, c } = r;
    s.tasks = [{ id: "bash_1", kind: "local_bash", description: "watch", since: NOW - 5_000, background: true }, { id: "task_f", kind: "local_agent", description: "now", since: NOW, background: false }];
    assert.deepEqual(open.of(c, null, { agentSession: "s1" }).keys, [`command:${run.id}`, "task:bash_1"], "the session that runs it; a task in front of it is no background one");
    assert.deepEqual(open.of(c, null, { agentSession: "s2" }).keys, [`command:${run.id}`], "another session reaches none of them");
    assert.deepEqual(open.of(c).keys, [`command:${run.id}`], "nor does a summary's block, which a fresh session may read");
    open.told(c);
    assert.deepEqual(r.heard(), { keys: [`command:${run.id}`] });
    await stopShell(run.id, owner);
    assert.equal(open.due(c), null, "its end is told to the agent by itself");
    assert.deepEqual(open.of(c, "subagent:sa_3"), { lines: [], keys: [], plain: [], rows: [], all: [] }, "a sub-agent's: its own commands");
  } finally {
    await stopShell(run.id, owner).catch(() => {});
    r.close();
  }
});

// (fails before: yes — the review of 11-03: a lead's record kept its team's workers, and its turn's start said them, which
// its team's words say)
test("a team's lead: its record and its turn's start leave its team's workers out; the block after a summary keeps them", () => {
  const r = heardRig();
  const s = r.get();
  try {
    const { open, c } = r;
    s.agents = [{ id: "w_1", description: "build", running: false, files: 1, worker: true }, { id: "sa_9", description: "check", running: false, files: 2 }];
    assert.equal(open.lines(c).length, 2, "the summary's block: workers and all");
    open.told(c);
    assert.deepEqual(r.heard(), { keys: ["agent:sa_9:waits"] });
    // The worker's change is applied: its lead hears that in its team's words — nothing to say at its turn's start.
    s.agents = [s.agents[1]];
    assert.equal(open.due(c), null);
    // A change of a helper's went too: the list said again has no worker in it.
    s.agents = [{ id: "w_2", description: "build more", running: true, files: 0, worker: true }];
    assert.deepEqual(open.due(c), { text: CHANGED_ALONE, keys: [], why: "changed" });
    open.lost(c);
    assert.deepEqual(open.due(c), { text: `[Filament: This chat's context was compacted earlier.]\n${RECALL_AFTER}`, keys: [], why: "lost" }, "compacted with only its workers open: recall's list of the turns alone");
  } finally {
    r.close();
  }
});

// (fails before: yes — the review of 11-03: a summary written for Filament's copy alone moved where failures count from,
// though no agent reads it)
test("failures count from the newest summary an agent's session reads, never one written for Filament's copy alone", () => {
  const r = heardRig();
  const s = r.get();
  try {
    const { open, c, a } = r;
    open.of(c);
    a.addCompaction(c, { fromTurn: 1, toTurn: 1, summaryText: "S", method: "summary" });
    const read = Number(a.getCompactions(c).at(-1).created_at);
    open.of(c);
    a.addCompaction(c, { fromTurn: 1, toTurn: 2, summaryText: "COPY", method: "summary", kind: "plain", detail: { copy: "agent", before: 1, after: 1, exact: false } });
    open.of(c);
    assert.deepEqual(s.since, [0, read, read]);
  } finally {
    r.close();
  }
});

// (fails before: yes — the chat's status listed the agents at work, its own tasks and its commands, never a change that
// waits for the agent or an agent that failed, and its capsule hid with only those left)
test("the chat's status: a change that waits for the agent and a failure you have not opened are still open — never the person's own kept aside, a graph task's, one that started by itself or a team's worker — and the capsule says each as it is", () => {
  const row = (/** @type {string} */ id, /** @type {Record<string, any>} */ over) => ({ id, origin: "agent", status: "done", description: id, card: { tag: "helper", name: "Helper" }, team: null, task: null, aside: false, work: null, exchanges: [{ description: id, outcome: { failure: { said: "the provider refused" } } }], ...over });
  const rows = [
    row("sa_w", { work: { pending: 2 } }),
    row("sa_f", { status: "failed" }),
    row("sa_seen", { status: "failed" }),
    row("sa_r", { status: "running", work: { pending: 1 } }),
    row("sa_a", { aside: true, work: { pending: 1 } }),
    row("sa_t", { task: "t1", work: { pending: 1 } }),
    row("sa_s", { origin: "self", status: "failed" }),
    // (fails before: yes — the review of 11-03: a team's worker's change counted in the floating panel's list)
    row("sa_team", { team: { key: "builders", name: "Builders", role: "builder" }, work: { pending: 3 } }),
    row("sa_d", {}),
  ];
  const open = stillOpenRows(rows, (r) => r.id === "sa_seen");
  assert.deepEqual(open.map((o) => [o.row.id, o.fact, o.tone]), [
    ["sa_w", "its change waits for the agent to apply it — 2 files", "warn"],
    ["sa_f", "failed: the provider refused — open its thread to try again", "error"],
  ]);
  const idle = { turn: { phase: "ended", startedAt: null, round: 0, error: "" }, compacting: null, working: 0, asking: 0, tasks: 0, now: NOW };
  // (fails before: yes — the review of 11-03: the title called the failures you have not opened "still open for the agent")
  assert.deepEqual(capsuleWords({ ...idle, open: openCounts(open) }), { state: "later", lead: "Still open", more: "2", title: "A sub-agent's change waits for the agent to apply it; a sub-agent failed, and you have not opened its thread yet" });
  assert.equal(capsuleWords({ ...idle, open: { waits: 2, failed: 0 } }).title, "2 sub-agents' changes wait for the agent to apply them");
  assert.equal(capsuleWords({ ...idle, open: { waits: 0, failed: 0 } }).state, "idle");
  assert.equal(capsuleWords({ ...idle, working: 1, open: { waits: 1, failed: 0 } }).lead, "Working", "work at hand says itself first");
});

// ---- through the app ------------------------------------------------------------------------------------------------

describe("through the app", () => {
  const SUMMARY = "SUMMARY: the turns so far, condensed.";
  const LONG_ANSWER = `LOOP ANSWER ${"words of the loop's answer ".repeat(400)}`;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  /** The loop's next request is refused, as a provider refuses one. */
  let refuseNext = false;
  /** How far the Still open list's clock runs ahead of the machine's (`stillOpenNow`): a turn past a long wait at once. */
  let shift = 0;
  /** JSON lines of a file, oldest first. @param {string} file */
  const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  /** The prompts the coding agent was sent. */
  const prompts = () => lines(join(root, "own-prompts.jsonl"));
  /** The prompts the agent that takes no HTTP MCP server was sent. */
  const deafPrompts = () => lines(join(root, "deaf-prompts.jsonl"));
  /** What the coding agent was sent while a turn of its ran: the prompts queued at it. */
  const queued = () => lines(join(root, "own-calls.jsonl")).filter((c) => c.method === "queued prompt").map((c) => String(c.words));
  /** What the model behind Filament's loop and its summaries was sent: each request's body. */
  const sent = () => up.received.map((c) => c.body);
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-still-open-retold-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    mkdirSync(join(root, "qgate"));
    mkdirSync(join(root, "cxticks"));
    process.env.FAKE_SDK_LOG = join(root, "sdk.jsonl");
    // Filament's own model: a summary when one is asked for, else a long answer, so a summary leaves the chat smaller.
    up = await fakeUpstream((call) => {
      const asked = JSON.stringify(call.body || {});
      const summary = asked.includes("compaction summaries") || /summar/i.test(JSON.stringify(call.body?.messages?.at(-1) || ""));
      if (!summary && refuseNext) {
        refuseNext = false;
        return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "the request was refused as sent" } } };
      }
      // A turn whose message says `~comeback` sets a come-back first, as come_back's words have the agent do before it ends
      // its turn, then answers.
      const last = call.body?.messages?.at(-1);
      const answered = Array.isArray(last?.content) && last.content.some((/** @type {any} */ b) => b?.type === "tool_result");
      if (!summary && !answered && JSON.stringify(last || "").includes("~comeback"))
        return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: "cb_1", name: "come_back", input: { seconds: 600, note: "see whether the build passed" } }], usage: { input_tokens: 10, output_tokens: 5 } });
      // A turn whose message says `~tasks <json>` calls Filament's tasks tool with it first, then answers — a done's
      // `summary` in it is no summary asked for.
      const words = Array.isArray(last?.content) ? last.content.map((/** @type {any} */ b) => (b?.type === "text" ? String(b.text) : "")).join("\n") : String(last?.content ?? "");
      const tasks = !asked.includes("compaction summaries") && !answered ? /~tasks (\{.*\})/.exec(words) : null;
      if (tasks) return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: `tk_${up.received.length}`, name: "tasks", input: JSON.parse(tasks[1]) }], usage: { input_tokens: 10, output_tokens: 5 } });
      // A turn that says `~longwait` makes three calls before it answers; once its first call's result is in, the list's
      // clock runs a long wait ahead, so its second call's result is composed past it.
      if (!summary && asked.includes("~longwait")) {
        const calls = (call.body?.messages || []).flatMap((/** @type {any} */ m) => (m.role === "assistant" && Array.isArray(m.content) ? m.content : [])).filter((/** @type {any} */ b) => b?.type === "tool_use" && String(b.id).startsWith("lw_")).length;
        if (calls === 1) shift = WAITS_LONG_MS;
        if (calls < 3) return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: `lw_${calls + 1}`, name: "glob", input: { pattern: "*" } }], usage: { input_tokens: 10, output_tokens: 5 } });
      }
      // A turn that says `~cached` is answered as a provider that cached its prefix answers: its cache is warm after it.
      const cached = !summary && asked.includes("~cached");
      // A chat that says `~short` is answered in a word: a summary of it is bigger than its turns.
      const answer = asked.includes("~short") ? "ok" : LONG_ANSWER;
      return anthropicReply(summary ? SUMMARY : answer, { model: "m-1", usage: { input_tokens: 10, output_tokens: 5, ...(cached ? { cache_creation_input_tokens: 4000 } : {}) } });
    });
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          {
            id: "own",
            name: "own",
            type: "acp",
            acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, "own-calls.jsonl"), FAKE_ACP_LOG: join(root, "own-prompts.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_OWN_COMPACT: "1", FAKE_ACP_SESSION_CAPS: "resume,close,fork,delete", FAKE_ACP_QUEUE_GATE: join(root, "qgate") }, cwdDefault: projDir, permissions: "allow-all", hints: false },
          },
          {
            id: "deaf",
            name: "deaf",
            type: "acp",
            acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, "deaf-calls.jsonl"), FAKE_ACP_LOG: join(root, "deaf-prompts.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_OWN_COMPACT: "1", FAKE_ACP_MCP_CAPS: "none", FAKE_ACP_SESSION_CAPS: "resume,close" }, cwdDefault: projDir, permissions: "allow-all", hints: false },
          },
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 }, "m-2": { input: 1, output: 1, contextTokens: 200000 } } },
          { id: "cx", name: "Codex", type: "codex", acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], env: { FAKE_CODEX_CALLS: join(root, "cx.jsonl"), FAKE_CODEX_TICK_DIR: join(root, "cxticks") }, cwdDefault: projDir, permissions: "allow-all" } },
          { id: "cursor", name: "Cursor", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: projDir, permissions: "allow-all", hints: false } },
        ];
        cfg.routes = [
          { match: "own/*", upstream: "own", upstreamModel: "{1}", enabled: true },
          { match: "deaf/*", upstream: "deaf", upstreamModel: "{1}", enabled: true },
          { match: "cx/*", upstream: "cx", upstreamModel: "{1}", enabled: true },
          { match: "cursor/*", upstream: "cursor", upstreamModel: "{1}", enabled: true },
          { match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "m-2", upstream: "m", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
      overrides: { cursorSdkLoader: () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href), stillOpenNow: () => Date.now() + shift },
    });
  });
  after(async () => {
    await disposeBackgroundShells();
    await shim.stop();
    await up.close();
    delete process.env.FAKE_SDK_LOG;
    await removeDirs(root);
  });
  /** @param {string} path @param {any} [init] */
  const json = async (path, init) => (await shim.api(path, init)).json();
  /** @param {string} id */
  const at = (id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** A chat on `model`, its compaction model Filament's. @param {string} model */
  const open = async (model) => String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain", settings: { context: { compaction: { model: "m-1", mode: "auto" } } } } })).id);
  /** A turn sent: its reply's words and its record's notes, once it ends. @param {string} id @param {string} content */
  const send = async (id, content) => {
    const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: false } });
    const status = res.status;
    const body = await res.json();
    const rec = await shim.record(String(res.headers.get("x-filament-request-id")));
    const text = (body.content || []).filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join("");
    return { status, text, notes: [...(rec.changes || []), ...(rec.priorChanges || [])].map(String) };
  };
  /** A turn that must end well. @param {string} id @param {string} content */
  const say = async (id, content) => {
    const r = await send(id, content);
    assert.equal(r.status, 200, r.text);
    return r;
  };
  /** A command of the chat's main agent's, running until it is stopped. @param {string} id */
  const command = (id) => startCommandShell(LONG, projDir, { session: id, agent: null }, { onEnd: () => {} });
  /** What the chat keeps of what its main agent heard. @param {string} id */
  const heard = (id) => /** @type {any} */ (shim.app.memory).archive.metaOf(id, ["openHeard"])?.openHeard;
  /** The chat keeps that its agent was told a sub-agent's change waits — one no longer there. @param {string} id */
  const toldOfAChange = (id) => /** @type {any} */ (shim.app.memory).archive.mergeMeta(id, { openHeard: { keys: ["agent:sa_gone:waits"] } });
  const JUST_NOW = "You compacted your context just now";
  /** The head of the list a long wait says (still-open.js `openWords`, "long"). */
  const LONG_WAIT = "[Filament: A sub-agent's change still waits for you to apply it, and nothing said so for 20 min.";
  /** A change's line, as the list says it. */
  const LONG_LINE = '- sub-agent sa_long ("add export"): 2 files of its work wait to be applied';
  /**
   * The registry says a sub-agent's change waits for the chat's agent to apply it, its exchange ended an hour ago: until
   * the registry is given back as it was. @param {string} id
   */
  const waitingChange = (id) => {
    const reg = /** @type {any} */ (shim.app).subagents;
    const { openWork, get } = reg;
    reg.openWork = (/** @type {string} */ chain, /** @type {any} */ o) => (chain === id ? [{ id: "sa_long", description: "add export", running: false, files: 2 }] : openWork(chain, o));
    reg.get = (/** @type {string} */ sa) => (sa === "sa_long" ? { chainId: id, status: "done", endedAt: Date.now() - 3_600_000, work: { pending: 2, sig: "b1:h1" } } : get(sa));
    return () => Object.assign(reg, { openWork, get });
  };

  // (fails before: yes — the review of 11-03: the list went to the door, which steered it in as a prompt Claude ran after
  // its answer, or woke the agent with it: a paid model call on the compacted context for these words alone)
  test("Claude compacts and answers with no step after it: nothing goes to it in that turn — no prompt, nothing queued — and its next turn's first prompt says the list", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    const run = command(id);
    const promptsBefore = prompts().length;
    const { notes } = await say(id, "~compact");
    assert.equal(prompts().length, promptsBefore + 1, "the turn's own prompt alone");
    assert.ok(!queued().some((w) => w.includes(JUST_NOW)), "nothing queued at it");
    assert.ok(notes.includes("acp: own compacted its context and took no step Filament could send words in at: its next turn's first prompt says what the compaction may have lost"), notes.join("\n"));
    assert.deepEqual(heard(id), { lost: true });
    const two = await say(id, "two");
    const text = String(prompts().at(-1)?.text);
    assert.ok(text.startsWith("two") && text.includes("[Filament: You compacted your context before this message") && text.includes(`- background command ${run.id}: \``), text);
    assert.ok(two.notes.includes("acp: what is still open, listed with own's first prompt of the turn — it compacted its context since it was last told"), two.notes.join("\n"));
    assert.deepEqual(heard(id), { keys: [`command:${run.id}`] });
    await say(id, "three");
    assert.equal(prompts().at(-1)?.text, "three", "said once");
    await stopShell(run.id, { session: id, agent: null });
  });

  // (fails before: yes — the same review: the words were steered at once, whether or not a step of the agent's followed)
  test("Claude compacts and goes on to a tool step: the list goes in at that step — taken in its turn, never a cycle of its own", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    const run = command(id);
    const turn = send(id, "~queue ~compactfirst");
    await until(() => queued().some((w) => w.includes(JUST_NOW) && w.includes(`- background command ${run.id}: `)), "the list, queued at Claude once its first step started");
    for (const f of ["q1", "q2", "end"]) writeFileSync(join(root, "qgate", f), "");
    const { status, text, notes } = await turn;
    assert.equal(status, 200, text);
    assert.ok(text.includes(`heard:[Filament: ${JUST_NOW}`), "folded in at its next step");
    assert.ok(!text.includes(`next:[Filament: ${JUST_NOW}`), "no cycle of its own");
    assert.ok(notes.includes("acp: what comes back after own's compaction went into its turn"), notes.join("\n"));
    assert.deepEqual(heard(id), { keys: [`command:${run.id}`] });
    await stopShell(run.id, { session: id, agent: null });
  });

  // (fails before: yes — the owner's of 11-10, one block as the loop's fold has: after its own compaction a coding agent
  // heard what was open at its next step and where it stood on its graph as words of their own, each its own way in —
  // and nothing of the graph's whole, nor of one left open with all done)
  test("Claude compacts with its task graph open: the graph and what is still open come back in one block at its next step; with no step after, at its next turn's start in place of where it stands", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    const added = await say(id, `~mcpcall tasks ${JSON.stringify({ action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "Write the parser" }] })}`);
    assert.match(added.text, /Added t1\./, added.text);
    const run = command(id);
    // The queue's steps wait at their gates again: an earlier test opened them.
    for (const f of ["q1", "q2", "end"]) rmSync(join(root, "qgate", f), { force: true });
    const from = queued().length;
    const mine = () => queued().slice(from);
    const turn = send(id, "~queue ~compactfirst");
    await until(() => mine().some((w) => w.includes(JUST_NOW)), "what comes back, queued at Claude once its first step started");
    for (const f of ["q1", "q2", "end"]) writeFileSync(join(root, "qgate", f), "");
    const { status, text, notes } = await turn;
    assert.equal(status, 200, text);
    const back = mine().filter((w) => w.includes("compacted your context"));
    assert.equal(back.length, 1, back.join("\n----\n"));
    assert.ok(back[0].startsWith(`[Filament: ${JUST_NOW}, and its summary may have left out what stands: here are the task graph as it stands, and what is still open. What is open is as it stands now: `), back[0]);
    assert.match(back[0], /\n\n<tasks>\n[^]*Ship the parser[^]*\[Filament: where you are — [^]*\n<\/tasks>\n\n<open>\n- background command /);
    assert.ok(back[0].endsWith(`</open>\n${RECALL_AFTER}`), back[0]);
    assert.ok(!mine().some((w) => w.startsWith("[Filament: where you are")), "where it stands said once, in the block");
    assert.ok(notes.includes("acp: what comes back after own's compaction went into its turn, its task graph with it"), notes.join("\n"));
    assert.deepEqual(heard(id), { keys: [`command:${run.id}`] });

    // No step after it: its next turn's first prompt carries the block, where it stands in it alone.
    await say(id, "~compact");
    const two = await say(id, "two");
    const first = String(prompts().at(-1)?.text);
    assert.ok(first.startsWith("two\n\n[Filament: You compacted your context before this message, and its summary may have left out what stands: here are the task graph as it stands, and what is still open."), first);
    assert.equal(first.split("[Filament: where you are — ").length, 2, "where it stands, once");
    assert.ok(two.notes.includes("acp: what is still open, listed with own's first prompt of the turn — it compacted its context since it was last told"), two.notes.join("\n"));
    await stopShell(run.id, { session: id, agent: null });
  });

  // (fails before: yes — the nudge map of 11-10, c-skills: the loop's fold names the skills the folded rounds loaded, to
  // load again; a coding agent's own compaction named none)
  test("Claude compacts: the skills it loaded with Filament's tool come back by name, but one its next call loads again", async () => {
    const id = await open("own/fake-a");
    await say(id, `~rawmcp ~mcpcall skill ${JSON.stringify({ name: "filament-setup" })}`);
    await say(id, `~rawmcp ~mcpcall skill ${JSON.stringify({ name: "run-everywhere" })}`);
    /** What comes back after a compaction in a turn: queued at its step, or, where the turn ended first, a prompt after it. */
    const backSince = () => {
      const [q, p] = [queued().length, prompts().length];
      return () => [...new Set([...queued().slice(q), ...prompts().slice(p).map((x) => String(x.text ?? x.prompt))])].filter((w) => w.includes("compacted your context"));
    };
    // It compacts, and its next call loads one of them again: what comes back names the other alone.
    const first = backSince();
    const { notes } = await say(id, `~compactthen ~rawmcp ~mcpcall skill ${JSON.stringify({ name: "run-everywhere" })}`);
    const back = first();
    assert.equal(back.length, 1, back.join("\n----\n"));
    assert.ok(back[0].includes("the skills you had loaded") && back[0].includes("load it again with Filament's `skill` tool"), back[0]);
    assert.match(back[0], /\n<skills>\n- filament-setup\n<\/skills>/, back[0]);
    assert.ok(!back[0].includes("run-everywhere"), "its call loads it again: its text comes with that call");
    assert.ok(notes.some((n) => n.startsWith("acp: what comes back after own's compaction")), notes.join("\n"));
    // Its next compaction names what it loaded since the last, run-everywhere among them.
    const second = backSince();
    await say(id, `~compactthen ~rawmcp ~mcpcall skill ${JSON.stringify({ name: "filament-setup" })}`);
    const next = second()[0] || "";
    assert.match(next, /\n<skills>\n- run-everywhere\n<\/skills>/, next);
    // A compaction with no step after it: its next turn's first prompt names them, once — filament-setup too, which the
    // call after the last compaction loaded.
    await say(id, `~rawmcp ~mcpcall skill ${JSON.stringify({ name: "run-everywhere" })}`);
    await say(id, "~compact");
    await say(id, "seven");
    const owed = String(prompts().at(-1)?.text);
    assert.ok(owed.includes("[Filament: You compacted your context before this message, and its summary may have left out what stands: here are the skills you had loaded."), owed);
    assert.match(owed, /\n<skills>\n- run-everywhere\n- filament-setup\n<\/skills>/, owed);
    await say(id, "eight");
    assert.ok(!String(prompts().at(-1)?.text).includes("<skills>"), "said once");
  });

  // (fails before: yes — the nudge map of 11-10, c-news: the loop hears what changed in a file it read since; a coding
  // agent heard nothing of it)
  test("a file Claude read changes between its turns: its next turn's first prompt names it and how many lines changed, once; its own edit is no change", async () => {
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const id = await open("own/fake-a");
    // It reads the readme and edits it: what it wrote is what it saw.
    await say(id, "~work");
    await say(id, "two");
    assert.ok(!String(prompts().at(-1)?.text).includes("you read changed since"), String(prompts().at(-1)?.text));
    // The person changes it between its turns.
    writeFileSync(join(projDir, "README.md"), "hello agent\nedited by the person\nand again\n");
    const { notes } = await say(id, "three");
    const told = String(prompts().at(-1)?.text);
    assert.ok(told.startsWith("three\n\n"), told);
    assert.ok(told.includes("Note: a file you read changed since — the developer, a formatter or a command made the change.") && told.includes("\n- README.md: 2 lines added, 1 line removed."), told);
    assert.ok(!told.includes("edited by the person"), "named, not shown: it reads it again with its own tools");
    assert.ok(notes.includes("acp: files read or written in this chat changed since — named with own's first prompt of the turn"), notes.join("\n"));
    await say(id, "four");
    assert.ok(!String(prompts().at(-1)?.text).includes("you read changed since"), "said once");
  });

  // (fails before: yes — the review of 11-11: what changed was taken from the files' sightings as the turn's start was
  // composed, and a prompt that went as the agent's own command, which carries nothing of Filament's, lost it)
  test("a file Claude read changes, and its next prompt is its own command: what changed waits for the next prompt that carries Filament's words", async () => {
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const id = await open("own/fake-a");
    await say(id, "~work");
    writeFileSync(join(projDir, "README.md"), "hello agent\nedited by the person\nand again\n");
    await say(id, "/review");
    assert.equal(prompts().at(-1)?.text, "/review", "the command as typed");
    const { notes } = await say(id, "four");
    const told = String(prompts().at(-1)?.text);
    assert.ok(told.startsWith("four\n\n") && told.includes("Note: a file you read changed since") && told.includes("\n- README.md: 2 lines added, 1 line removed."), told);
    assert.ok(notes.includes("acp: files read or written in this chat changed since — named with own's first prompt of the turn"), notes.join("\n"));
    await say(id, "five");
    assert.ok(!String(prompts().at(-1)?.text).includes("you read changed since"), "said once");
  });

  /** Codex's first prompt of each turn, its words. */
  const codexStarts = () => lines(join(root, "cx.jsonl")).filter((c) => c.method === "turn/start").map((c) => (c.params?.input || []).filter((/** @type {any} */ i) => i.type === "text").map((/** @type {any} */ i) => i.text).join("\n"));

  // (fails before: yes — the review of 11-11: Codex's call ends say no kind, so neither a file it read nor one it patched
  // was seen, and a change to it went unsaid)
  test("a file Codex read and patched changes between its turns: its next turn's first prompt names it, once", async () => {
    writeFileSync(join(projDir, "notes.txt"), "hello\n");
    const id = await open("cx/gpt-5.5");
    await say(id, "~work");
    writeFileSync(join(projDir, "notes.txt"), "hello\nedited by the person\n");
    const { notes } = await say(id, "two");
    const told = String(codexStarts().at(-1));
    assert.ok(told.startsWith("two\n\n") && told.includes("Note: a file you read changed since") && told.includes("\n- notes.txt: 1 line added."), told);
    assert.ok(notes.includes("acp: files read or written in this chat changed since — named with Codex's first prompt of the turn"), notes.join("\n"));
    await say(id, "three");
    assert.ok(!String(codexStarts().at(-1)).includes("you read changed since"), "said once");
  });

  // (fails before: yes — the review of 11-11: Codex reads files with its shell, and only a command that read one file
  // alone was a read: one that read two left no sighting)
  test("files Codex read with one command change between its turns: its next turn's first prompt names them", async () => {
    writeFileSync(join(projDir, "a.txt"), "a\n");
    writeFileSync(join(projDir, "b.txt"), "b\n");
    const id = await open("cx/gpt-5.5");
    await say(id, "~readboth");
    writeFileSync(join(projDir, "a.txt"), "a\nand more\n");
    writeFileSync(join(projDir, "b.txt"), "B\n");
    await say(id, "two");
    const told = String(codexStarts().at(-1));
    assert.ok(told.startsWith("two\n\n") && told.includes("Note: 2 files you read changed since") && told.includes("\n- a.txt: 1 line added.") && told.includes("\n- b.txt: 1 line added, 1 line removed."), told);
  });

  // (fails before: yes — the review of 11-11: a sighting was kept by the path as its call spelled it — Claude's read with
  // forward slashes and by way of `./`, its edit as the folder is named — so its own edit left the read's sighting
  // behind, and its next turn was told the file changed since)
  test("a file Claude read by one spelling and edited by another is one file: its own edit is no change, the person's is", async () => {
    writeFileSync(join(projDir, "spelled.txt"), "hello\n");
    const id = await open("own/fake-a");
    await say(id, "~readslashed spelled.txt");
    await say(id, "~editnative spelled.txt");
    await say(id, "three");
    assert.ok(!String(prompts().at(-1)?.text).includes("changed since"), String(prompts().at(-1)?.text));
    writeFileSync(join(projDir, "spelled.txt"), "hello\na line of the agent's own\nedited by the person\n");
    await say(id, "four");
    const told = String(prompts().at(-1)?.text);
    assert.ok(told.includes("Note: a file you read changed since") && told.includes("\n- spelled.txt: 1 line added."), told);
    await say(id, "five");
    assert.ok(!String(prompts().at(-1)?.text).includes("changed since"), "said once");
  });

  // (fails before: yes — the review of 11-11: what a chat's coding agent saw is kept by the chat, and the agent the chat
  // moved to was told "a file you read changed since" of a file the agent before it read)
  test("a file Claude read changes, and the chat moves to Codex: Codex is told so as the chat's, never as a file it read", async () => {
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const id = await open("own/fake-a");
    await say(id, "~work");
    writeFileSync(join(projDir, "README.md"), "hello agent\nedited by the person\n");
    const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "two", stream: false, settingsPatch: { model: { name: "cx/gpt-5.5" } }, sendAsIs: true } });
    assert.equal(res.status, 200, await res.clone().text());
    const moved = String(codexStarts().at(-1));
    assert.ok(moved.includes("Note: a file read or written in this chat before it moved to you changed since — the developer, a formatter or a command made the change.") && moved.includes("Read it before you rely on what this chat says of it:\n- README.md: "), moved);
    assert.ok(!moved.includes("you read"), moved);
    // (fails before: yes — fxm's left: the record said "files Codex read changed since" of files Codex never read)
    const rec = await shim.record(String(res.headers.get("x-filament-request-id")));
    const notes = [...(rec.changes || []), ...(rec.priorChanges || [])].map(String);
    assert.ok(notes.includes("acp: files read or written in this chat changed since — named with Codex's first prompt of the turn"), notes.join("\n"));
    assert.ok(!notes.some((n) => n.includes("Codex read")), notes.join("\n"));
    await say(id, "three");
    assert.ok(!String(codexStarts().at(-1)).includes("changed since"), "said once");
    // It changes again, and Codex has still read none of it.
    writeFileSync(join(projDir, "README.md"), "hello agent\nedited by the person\nand again\n");
    await say(id, "four");
    const again = String(codexStarts().at(-1));
    assert.ok(again.includes("Note: a file read or written in this chat before it moved to you changed since") && !again.includes("you read"), again);
  });

  // (fails before: yes — FabeleHelper's D of 11-10: a coding agent's first prompt said where it stood before what was
  // open, the loop's turn start what was open first; both now come from checkpoint.js `compose`)
  test("a coding agent's turn start says what is open before where it stands, in the loop's order", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    const added = await say(id, `~mcpcall tasks ${JSON.stringify({ action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer" }] })}`);
    assert.match(added.text, /Added t1\./, added.text);
    toldOfAChange(id);
    await say(id, "two");
    const first = String(prompts().at(-1)?.text);
    const said = first.indexOf(CHANGED_ALONE);
    const where = first.indexOf("[Filament: where you are — ");
    assert.ok(said > 0 && where > said, first);
  });

  // (fails before: yes — the owner's of 11-10, drift, d-idle: a turn that ended with a task of its own running and nothing
  // at work on it went unsaid, a coding agent's and the loop's alike)
  test("a turn that ended with a task of its own running and nothing at work on it: the next turn's start says so, once a task — a coding agent's and the loop's", async () => {
    const IDLE = "t1 was left running as your last turn ended, with nothing at work on it";
    const LEXER = { action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer" }] };
    const id = await open("own/fake-a");
    await say(id, `~mcpcall tasks ${JSON.stringify(LEXER)}`);
    // A command of the chat's still running as its turns end is at work: nothing is said.
    const run = command(id);
    await say(id, `~mcpcall tasks ${JSON.stringify({ action: "start", ids: ["t1"] })}`);
    await say(id, "two");
    assert.ok(!String(prompts().at(-1)?.text).includes(IDLE), String(prompts().at(-1)?.text));
    await stopShell(run.id, { session: id, agent: null });
    await say(id, "three");
    assert.ok(!String(prompts().at(-1)?.text).includes(IDLE), "the turn before ended with the command at work");
    await say(id, "four");
    const four = String(prompts().at(-1)?.text);
    assert.ok(four.includes(`${IDLE} — go on with it now, or pause it with a checkpoint (tasks pause) where it waits on something`) && four.indexOf(IDLE) > four.indexOf("[Filament: where you are — "), four);
    await say(id, "five");
    assert.ok(!String(prompts().at(-1)?.text).includes(IDLE), "once a task");
    // The loop's: its graph put in place as its tasks tool puts it.
    const loop = await open("m-1");
    const graphs = /** @type {any} */ (shim.app).graphs;
    for (const input of [LEXER, { action: "start", ids: ["t1"] }]) assert.ok(graphs.apply(loop, input, { crew: "agent" }).ok);
    await say(loop, "one ~short");
    assert.ok(!JSON.stringify(sent().at(-1)?.messages?.at(-1)).includes(IDLE));
    await say(loop, "two ~short");
    const two = JSON.stringify(sent().at(-1)?.messages?.at(-1));
    assert.ok(two.includes(IDLE), two);
    await say(loop, "three ~short");
    assert.ok(!JSON.stringify(sent().at(-1)?.messages?.at(-1)).includes(IDLE), "once a task");
  });

  // (fails before: yes — the review of the drift signals, d-idle: come_back's words have the agent set it and end its turn,
  // and the turn it came back to opened saying its task was left with nothing at work on it)
  test("a turn that ended with a come-back set leaves its running task at work: the next turn's start says nothing of it idle — the loop's and a coding agent's", async () => {
    const IDLE = "t1 was left running as your last turn ended, with nothing at work on it";
    const LEXER = { action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer" }] };
    const graphs = /** @type {any} */ (shim.app).graphs;
    const loop = await open("m-1");
    const coder = await open("own/fake-a");
    try {
      for (const input of [LEXER, { action: "start", ids: ["t1"] }]) assert.ok(graphs.apply(loop, input, { crew: "agent" }).ok);
      await say(loop, "one ~short ~comeback");
      assert.ok(comeBackOf(loop), "its come_back set one");
      await say(loop, "two ~short");
      const two = JSON.stringify(sent().at(-1)?.messages?.at(-1));
      assert.ok(!two.includes(IDLE), two);
      // A coding agent's chat with a come-back still set, as a turn of the loop's in it left one before it moved there:
      // the turn that starts t1 ends with it set.
      await say(coder, `~mcpcall tasks ${JSON.stringify(LEXER)}`);
      comeBackLater(coder, { seconds: 600, note: "see whether the build passed" });
      await say(coder, `~mcpcall tasks ${JSON.stringify({ action: "start", ids: ["t1"] })}`);
      assert.ok(comeBackOf(coder), "still set as the turn ended");
      await say(coder, "two");
      const told = String(prompts().at(-1)?.text);
      assert.ok(told.startsWith("two") && !told.includes(IDLE), told);
    } finally {
      cancelComeBack(loop);
      cancelComeBack(coder);
    }
  });

  // (fails before: yes — the owner's of 11-08: with nothing open, nothing was said after a compaction, and past one the
  // agent could not find what an earlier turn said was left)
  test("Claude compacts with nothing open: nothing goes into that turn — words queued at a turn with no step left would run as a prompt of their own — and its next turn's first prompt names recall's list of the turns, once", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    const promptsBefore = prompts().length;
    const queuedBefore = queued().length;
    const { notes } = await say(id, "~compact");
    assert.equal(prompts().length, promptsBefore + 1, "the turn's own prompt alone");
    assert.equal(queued().length, queuedBefore, "nothing queued at it");
    assert.ok(!notes.some((n) => n.includes("still open")), notes.join("\n"));
    assert.deepEqual(heard(id), { lost: true }, "kept for its next turn");
    const two = await say(id, "two");
    assert.equal(prompts().at(-1)?.text, `two\n\n${openWords([], "lost")}`);
    assert.equal(openWords([], "lost"), `[Filament: This chat's context was compacted earlier.]\n${RECALL_AFTER}`);
    assert.ok(two.notes.includes("acp: recall's list of the turns, named with own's first prompt of the turn — it compacted its context since, with nothing open"), two.notes.join("\n"));
    assert.equal(heard(id), undefined);
    await say(id, "three");
    assert.equal(prompts().at(-1)?.text, "three", "said once");
    // (fails before: yes — the review of 11-08: a compaction in the turn whose first prompt carried the words was taken as
    // told at that turn's end, and the turn after said nothing)
    await say(id, "~compact");
    await say(id, "~compact again");
    assert.equal(prompts().at(-1)?.text, `~compact again\n\n${openWords([], "lost")}`);
    assert.deepEqual(heard(id), { lost: true }, "the second compaction waits");
    await say(id, "four");
    assert.equal(prompts().at(-1)?.text, `four\n\n${openWords([], "lost")}`);
    await say(id, "five");
    assert.equal(prompts().at(-1)?.text, "five");
  });

  // (fails before: yes — the owner's of 11-08: an agent that takes no HTTP MCP server, given none of Filament's tools,
  // was told after its compaction to call filament_recall, a tool it does not have)
  test("an agent given none of Filament's tools compacts: its next prompt says what is still open, and never names recall's list", async () => {
    const id = await open("deaf/fake-a");
    await say(id, "one");
    const run = command(id);
    await say(id, "~compact");
    await say(id, "two");
    const text = String(deafPrompts().at(-1)?.text);
    assert.ok(text.startsWith("two") && text.includes("[Filament: You compacted your context before this message") && text.includes(`- background command ${run.id}: \``), text);
    assert.ok(!text.includes("filament_recall"), text);
    await stopShell(run.id, { session: id, agent: null });
    // With nothing open, a compaction leaves it nothing to say: no tool of Filament's to list the turns with.
    await say(id, "~compact");
    await say(id, "three");
    assert.equal(deafPrompts().at(-1)?.text, "three");
    assert.equal(openWords([], "lost", false), "");
    assert.ok(!openWords(["- a"], "compacted", false).includes(RECALL_AFTER) && openWords(["- a"], "compacted").endsWith(RECALL_AFTER));
  });

  const THREE_TASKS = { action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "One" }, { id: "t2", name: "Two" }, { id: "t3", name: "Three" }] };
  /** The head of the list a turn's start says where its last turn's answers counted what they did not name (`openWords`, "more"). */
  const WHOLE_AGAIN = "[Filament: Your answers in your last turn named a part of what else is still open, and counted the rest: here it is whole.";
  const COUNTED = /Also still open, beside your graph: background command .*; and 1 more, which Still open names at your next turn's start\./;

  // (fails before: yes — the re-read of 11-11: the turn whose start said the list whole began its answers' set of what
  // was said empty, so its first done named three again, counted the rest and owed the next start the whole list: with
  // more than three things open beside the graph, every turn's start said it, turn after turn)
  test("more than three things open beside the graph, Claude: the turn whose start said the list whole names none of it again at a done, and the turn after starts with no list", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    const runs = [command(id), command(id), command(id), command(id)];
    /** A call of Filament's tasks tool, and its answer as the agent said it back, without the echo of its prompt. @param {any} call */
    const tasks = async (call) => {
      const { text } = await say(id, `~mcpcall tasks ${JSON.stringify(call)}`);
      return text.slice(text.indexOf("mcp:")).replace(/ echo\(\d+\):[^]*$/, "");
    };
    assert.match(await tasks(THREE_TASKS), /Added t1/);
    await tasks({ action: "start", ids: ["t1", "t2"] });
    // A turn whose start said nothing: its done names three and counts the fourth, which the next start owes.
    assert.match(await tasks({ action: "done", id: "t1", summary: "One done." }), COUNTED);
    const second = await tasks({ action: "done", id: "t2", summary: "Two done." });
    const start = String(prompts().at(-1)?.text);
    assert.ok(start.includes(WHOLE_AGAIN) && runs.every((r) => start.includes(`- background command ${r.id}: `)), start);
    assert.match(second, /^mcp:/);
    assert.ok(!second.includes("Also still open"), second);
    await say(id, "three");
    assert.ok(!String(prompts().at(-1)?.text).includes(WHOLE_AGAIN), String(prompts().at(-1)?.text));
    for (const r of runs) await stopShell(r.id, { session: id, agent: null });
  });

  // (fails before: yes — the same, through Filament's loop: its first request carries the list)
  test("more than three things open beside the graph, the loop: the turn whose start said the list whole names none of it again at a done, and the turn after starts with no list", async () => {
    const id = await open("m-1");
    await say(id, "one");
    const runs = [command(id), command(id), command(id), command(id)];
    /** The words of a request's newest message: the person's, with what Filament put on them, or a tool's result. @param {any} body */
    const newest = (body) => {
      const c = body?.messages?.at(-1)?.content;
      const text = (/** @type {any} */ x) => (x?.type === "text" ? String(x.text) : x?.type === "tool_result" ? (Array.isArray(x.content) ? x.content.map(text).join("\n") : String(x.content ?? "")) : "");
      return Array.isArray(c) ? c.map(text).join("\n") : String(c ?? "");
    };
    /** A turn that calls the tasks tool: its first request's newest message, and the tool's answer as the model was sent it. @param {any} call */
    const tasks = async (call) => {
      const from = sent().length;
      await say(id, `~tasks ${JSON.stringify(call)}`);
      const mine = sent().slice(from).filter((b) => JSON.stringify(b).includes(JSON.stringify(`~tasks ${JSON.stringify(call)}`).slice(1, -1)));
      const result = mine.find((b) => Array.isArray(b.messages?.at(-1)?.content) && b.messages.at(-1).content.some((/** @type {any} */ x) => x?.type === "tool_result"));
      return { start: newest(mine[0]), answer: newest(result) };
    };
    assert.match((await tasks(THREE_TASKS)).answer, /Added t1/);
    await tasks({ action: "start", ids: ["t1", "t2"] });
    assert.match((await tasks({ action: "done", id: "t1", summary: "One done." })).answer, COUNTED);
    const second = await tasks({ action: "done", id: "t2", summary: "Two done." });
    assert.ok(second.start.includes(WHOLE_AGAIN) && runs.every((r) => second.start.includes(`- background command ${r.id}: `)), second.start);
    assert.ok(second.answer.length > 0 && !second.answer.includes("Also still open"), second.answer);
    const from = sent().length;
    await say(id, "three");
    assert.ok(!sent().slice(from).some((b) => newest(b).includes(WHOLE_AGAIN)), "the next start owes no list");
    for (const r of runs) await stopShell(r.id, { session: id, agent: null });
  });

  // (fails before: yes — the re-read of 11-11: the list ends the agent's own task's line with [task:<id>], and the
  // envelope's dismiss answered that nothing open goes by that id)
  test("a coding agent dismisses its own background task by the id its line ends with, over Filament's envelope tool: the card shows it dismissed", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    const acp = /** @type {any} */ (shim.app).acp;
    acp.onTasks({ chain: id, sessionId: "agent-x", upstream: "own", tasks: [{ id: "bt-9", kind: "local_bash", description: "npm run dev", background: true, since: Date.now() - 60_000 }] });
    try {
      const { text } = await say(id, `~mcpcall envelope ${JSON.stringify({ dismiss: ["[task:bt-9]"] })}`);
      assert.match(text, /mcp:Dismissed task:bt-9: Filament leaves it out of what is still open until what it names changes\./, text);
      const mine = (await json(at(id))).open.items.filter((/** @type {any} */ i) => i.key.endsWith(":bt-9"));
      assert.deepEqual(mine.map((/** @type {any} */ i) => [i.key, i.dismissed]), [["theirs:bt-9", true]]);
    } finally {
      acp.onTasks({ chain: id, sessionId: "agent-x", upstream: "own", tasks: [] });
    }
  });

  /** Whether a turn's record says its agent was asked to plan its steps. @param {string[]} notes */
  const askedToPlan = (notes) => notes.some((n) => n.includes("changed a second file with neither a checklist nor a task graph"));

  // (fails before: yes — the re-read of 11-11: the chat kept that the agent's own todo list was open for good, whoever
  // answered next. After Filament's summary the agent's session is let go and a fresh one starts from the summary, which
  // carries nothing of the list: the session that never drew one was taken as planned, and never asked. This test said
  // the opposite until then, "the agent's own session continued", which Filament's summary never leaves so.)
  test("a todo list the agent left open is its session's: after Filament's summary a fresh session answers, which never drew it, and its two files are asked for a plan", async () => {
    const id = await open("own/fake-a");
    await say(id, "~plan");
    await say(id, "two ~holds 150000");
    const ours = await shim.api(`${at(id)}/compact`, { method: "POST", body: { way: "ours", method: "summary" } });
    assert.equal(ours.status, 200, await ours.clone().text());
    for (const f of ["q1", "q2", "end"]) writeFileSync(join(root, "qgate", f), "");
    const { notes } = await say(id, "~queue ~twoedits");
    assert.ok(notes.some((n) => n.includes("a fresh session starts from the compaction")), notes.join("\n"));
    assert.ok(!String(prompts().at(-2)?.prompt).includes("Read the failing test"), "the fresh session's seed says nothing of the list");
    assert.ok(askedToPlan(notes), notes.join("\n"));
  });

  // (fails before: yes — the review of e0a070c96, sa_3c539618: Filament's checklist draws its list on the turn as a plan
  // event with items and no entries, read as a list with none open, so the chat kept the agent's own list, open, closed)
  test("the agent's own todo list left open beside a Filament checklist all done: the chat keeps its own list open for the session's next turn", async () => {
    const id = await open("own/fake-a");
    await say(id, `~plan ~mcpcall checklist ${JSON.stringify({ items: [{ text: "Read a", status: "done" }, { text: "Edit b", status: "done" }] })}`);
    for (const f of ["q1", "q2", "end"]) writeFileSync(join(root, "qgate", f), "");
    const from = queued().length;
    const { notes } = await say(id, "~queue ~twoedits");
    assert.ok(!queued().slice(from).includes(CODER_UNPLANNED_LINE), queued().slice(from).join("\n----\n"));
    assert.ok(!askedToPlan(notes), notes.join("\n"));
  });

  // (fails before: yes — the re-read of 11-11: the mark was never cleared, so after the agent compacted its own
  // context — nothing says it still holds its list — its two files were never asked for a plan again)
  test("a todo list the agent left open, then its own compaction in a later turn: the two files of the turn after are asked for a plan", async () => {
    for (const f of ["q1", "q2", "end"]) writeFileSync(join(root, "qgate", f), "");
    const id = await open("own/fake-a");
    await say(id, "~plan");
    await say(id, "~compact");
    const { notes } = await say(id, "~queue ~twoedits");
    assert.ok(askedToPlan(notes), notes.join("\n"));
  });

  // (fails before: yes — the same: the compaction came in the turn of the two files, before them)
  test("a todo list the agent left open, then its own compaction in the turn of the two files: they are asked for a plan", async () => {
    for (const f of ["q1", "q2", "end"]) writeFileSync(join(root, "qgate", f), "");
    const id = await open("own/fake-a");
    await say(id, "~plan");
    const { notes } = await say(id, "~queue ~compactfirst ~twoedits");
    assert.ok(askedToPlan(notes), notes.join("\n"));
  });

  // (fails before: yes — the same: the compaction was asked for between turns, the way own)
  test("a todo list the agent left open, then its own compaction asked for between turns: the next turn's two files are asked for a plan", async () => {
    for (const f of ["q1", "q2", "end"]) writeFileSync(join(root, "qgate", f), "");
    const id = await open("own/fake-a");
    await say(id, "~plan");
    const own = await shim.api(`${at(id)}/compact`, { method: "POST", body: { way: "own" } });
    assert.equal(own.status, 200, await own.clone().text());
    const { notes } = await say(id, "~queue ~twoedits");
    assert.ok(askedToPlan(notes), notes.join("\n"));
  });

  // (fails before: yes — the re-read of 11-11: the chat kept the list as its own, so the agent it moved to, which never
  // drew one, was taken as planned)
  test("a todo list one agent left open is not the next agent's: the chat moves to Codex, whose two files are asked for a plan", async () => {
    const id = await open("own/fake-a");
    await say(id, "~plan");
    const steered = () => lines(join(root, "cx.jsonl")).filter((c) => c.method === "turn/steer").map((c) => (c.params?.input || []).filter((/** @type {any} */ i) => i.type === "text").map((/** @type {any} */ i) => i.text).join("\n"));
    const from = steered().length;
    writeFileSync(join(root, "cxticks", "tick"), "");
    const turn = shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "~steer ~twoedits", stream: false, settingsPatch: { model: { name: "cx/gpt-5.5" } }, sendAsIs: true } });
    let said = false;
    try {
      await until(() => steered().slice(from).includes(CODER_UNPLANNED_LINE) || null, "the line, steered into Codex's turn");
      said = true;
    } finally {
      // Codex's turn ends at the words steered into it: where none came, it is stopped, for the tests after this one.
      if (!said) await shim.api(`${at(id)}/stop`, { method: "POST", body: {} });
    }
    assert.equal((await turn).status, 200);
  });

  // (fails before: yes — the nudge map of 11-10, c-dupes: the block kept with Filament's summary asked every reader to
  // dismiss with Filament's envelope tool, a coding agent with no envelope tool among them)
  test("Filament's summary of a chat whose agent has no envelope tool: the fresh session's seed says what is open, and no dismiss", async () => {
    const id = await open("deaf/fake-a");
    await say(id, "one");
    const run = command(id);
    await say(id, "two ~holds 150000");
    const ours = await shim.api(`${at(id)}/compact`, { method: "POST", body: { way: "ours", method: "summary" } });
    assert.equal(ours.status, 200, await ours.clone().text());
    await say(id, "three");
    const seeded = String(deafPrompts().at(-1)?.text);
    assert.ok(seeded.includes(SUMMARY) && seeded.includes(`- background command ${run.id}: \``), seeded);
    assert.ok(seeded.includes("Go through what was open now:") && !seeded.includes("dismiss"), seeded);
    await stopShell(run.id, { session: id, agent: null });
  });

  // (fails before: yes — the owner's of 11-08: a switch handed the model the chat moved to none of what stood, the
  // carry form leaving the tool calls out: a command still running was started again by the new model)
  test("a switch hands the model the chat moved to what stands, once: the loop to a coding agent, and back", async () => {
    const id = await open("m-1");
    await say(id, "one");
    const run = command(id);
    /** A turn on another model, sent as it is past the switch's card. @param {string} content @param {string} model */
    const moveTo = async (content, model) => {
      const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: false, settingsPatch: { model: { name: model } }, sendAsIs: true } });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      const rec = await shim.record(String(res.headers.get("x-filament-request-id")));
      return [...(rec.changes || []), ...(rec.priorChanges || [])].map(String);
    };
    const toAgent = await moveTo("two", "own/fake-a");
    const seed = String(prompts().at(-1)?.prompt);
    assert.ok(seed.includes("[Filament handed these over as this chat moved to you from m-1: what is still open. What is open is as it stands now:") && seed.includes(`- background command ${run.id}: \``), seed.slice(-1200));
    assert.ok(toAgent.includes("acp: what stands, handed to own with its first prompt of the turn as the chat moved from m-1"), toAgent.join("\n"));
    assert.ok(toAgent.some((n) => /^compose: agent: the chat moved from m-1: its first prompt is handed what stands \(~\d+ tokens: 1 open\)$/.test(n)), toAgent.join("\n"));
    await say(id, "three");
    assert.ok(!String(prompts().at(-1)?.prompt).includes("handed these over"), "said once, with the first prompt");
    const toLoop = await moveTo("four", "m-1");
    const asked = JSON.stringify(sent().at(-1)?.messages?.at(-1));
    assert.ok(asked.includes("[Filament handed these over as this chat moved to you from own: what is still open.") && asked.includes(run.id), asked.slice(-1200));
    assert.ok(toLoop.includes("agent: what stands, handed to the loop with the turn's first request as the chat moved from own"), toLoop.join("\n"));
    await stopShell(run.id, { session: id, agent: null });
  });

  // (fails before: yes — FabeleHelper's of 11-10 on 21aaaf5f9, the parity map's switch double: the handover carried the
  // task graph with where its planner stands, and the turn's first prompt said where it stood again)
  test("a switch to a coding agent with its task graph open: where it stands is said once, in what is handed over", async () => {
    const id = await open("own/fake-a");
    const added = await say(id, `~mcpcall tasks ${JSON.stringify({ action: "add", goal: "Ship the scanner", tasks: [{ id: "t1", name: "Write the scanner" }] })}`);
    assert.match(added.text, /Added t1\./, added.text);
    /** A turn on another model, sent as it is past the switch's card: its record's notes. @param {string} content @param {string} model */
    const moveTo = async (content, model) => {
      const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: false, settingsPatch: { model: { name: model } }, sendAsIs: true } });
      assert.equal(res.status, 200, await res.clone().text());
      const rec = await shim.record(String(res.headers.get("x-filament-request-id")));
      return [...(rec.changes || []), ...(rec.priorChanges || [])].map(String);
    };
    // (fails before: yes — the hunt of 11-10 on switch-once, sw-loop: the loop's first request after a move carried the
    // handover, where it stands in it, and where it stood again as any turn start's)
    const toLoop = await moveTo("two", "m-1");
    const asked = JSON.stringify(sent().at(-1)?.messages?.at(-1));
    assert.ok(asked.includes("[Filament handed these over as this chat moved to you from own:") && asked.includes("Ship the scanner"), asked.slice(-1500));
    assert.equal(asked.split("[Filament: where you are — ").length, 2, asked.slice(-1500));
    assert.ok(!toLoop.includes("agent: where the agent stands on its task graph, with the turn's first request"), toLoop.join("\n"));
    await moveTo("three", "own/fake-a");
    const first = String(prompts().at(-1)?.prompt);
    assert.ok(first.includes("[Filament handed these over as this chat moved to you from m-1:") && first.includes("Ship the scanner"), first.slice(-1500));
    assert.equal(first.split("[Filament: where you are — ").length, 2, first.slice(-1500));
  });

  // (fails before: yes — the hunt of 11-10 on switch-once, sw-quiet: the handover's where was read before the turn's start
  // counted a turn, its quiet warning left out, and a coding agent's switch turn kept no count at all)
  test("a switch whose turn start makes a running task quiet: the handover's where says so, and the count is kept", async () => {
    const id = await open("own/fake-a");
    const added = await say(id, `~mcpcall tasks ${JSON.stringify({ action: "add", goal: "Ship the emitter", tasks: [{ id: "t1", name: "Write the emitter" }] })}`);
    assert.match(added.text, /Added t1\./, added.text);
    await say(id, `~mcpcall tasks ${JSON.stringify({ action: "start", ids: ["t1"] })}`);
    /** A turn on another model, sent as it is past the switch's card. @param {string} content @param {string} model */
    const moveTo = async (content, model) => {
      const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: false, settingsPatch: { model: { name: model } }, sendAsIs: true } });
      assert.equal(res.status, 200, await res.clone().text());
    };
    await say(id, "two");
    await say(id, "three");
    // Into the loop, its turn start the task's third: what is handed over says it.
    await moveTo("four", "m-1");
    const asked = sent().at(-1)?.messages?.at(-1)?.content;
    const handed = (Array.isArray(asked) ? asked : [{ text: String(asked) }]).find((b) => String(b?.text).includes("handed these over"));
    assert.match(String(handed?.text), /t1 has run 3 turns with no checkpoint/, String(handed?.text));
    await moveTo("five", "own/fake-a");
    const first = String(prompts().at(-1)?.prompt);
    assert.ok(first.includes("[Filament handed these over as this chat moved to you from m-1:"), first.slice(-1500));
    assert.match(first, /t1 has run 4 turns with no checkpoint/, first.slice(-1500));
    assert.equal(first.split("[Filament: where you are — ").length, 2, first.slice(-1500));
    await say(id, "six");
    assert.match(String(prompts().at(-1)?.prompt), /t1 has run 5 turns with no checkpoint/, "the switch turn's count was kept");
  });

  // (fails before: yes — the hunt of 11-08: the agent's own command as the first message after the switch went as typed,
  // carrying nothing of Filament's, and the turn after it was no switch: what stood was never handed over)
  test("a switch whose first message is the agent's own command: what stands goes with the agent's next prompt", async () => {
    const id = await open("m-1");
    await say(id, "one");
    const run = command(id);
    try {
      const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "/review", stream: false, settingsPatch: { model: { name: "own/fake-a" } }, sendAsIs: true } });
      assert.equal(res.status, 200, await res.clone().text());
      assert.equal(String(prompts().at(-1)?.prompt), "/review", "the command goes as typed");
      const next = await say(id, "go on");
      const told = String(prompts().at(-1)?.prompt);
      assert.ok(told.includes("[Filament handed these over as this chat moved to you from m-1: what is still open.") && told.includes(run.id), told.slice(-1500));
      assert.ok(next.notes.includes("acp: what stands, handed to own with its first prompt of the turn as the chat moved from m-1"), next.notes.join("\n"));
      await say(id, "and on");
      assert.ok(!String(prompts().at(-1)?.prompt).includes("handed these over"), "said once");
    } finally {
      await stopShell(run.id, { session: id, agent: null });
    }
  });

  // (fails before: yes — the hunt of 11-08: a switch right after the agent's own compaction handed the model the chat
  // moved to what stands in place of the words the compaction was owed, and the turn's end took them as said: recall's
  // list of the turns was never named)
  test("a switch after the agent's own compaction: the model the chat moved to is handed what stands and recall's list of the turns, once", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    const run = command(id);
    await say(id, "~compact");
    assert.deepEqual(heard(id), { lost: true });
    const startsOf = () => lines(join(root, "cx.jsonl")).filter((c) => c.method === "turn/start");
    const before = startsOf().length;
    const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "two", stream: false, settingsPatch: { model: { name: "cx/gpt-5.5" } }, sendAsIs: true } });
    assert.equal(res.status, 200, await res.clone().text());
    const first = JSON.stringify(startsOf().slice(before).map((c) => c.params));
    assert.ok(first.includes("[Filament handed these over as this chat moved to you from") && first.includes(run.id), first.slice(-1500));
    assert.ok(first.includes(RECALL_AFTER), first.slice(-1500));
    assert.ok(!first.includes("You compacted your context"), "the model the chat moved to never compacted its own");
    assert.deepEqual(heard(id), { keys: [`command:${run.id}`] });
    const next = startsOf().length;
    await say(id, "three");
    assert.ok(!JSON.stringify(startsOf().slice(next)).includes(RECALL_AFTER), "said once");
    await stopShell(run.id, { session: id, agent: null });
  });

  // (fails before: yes — the owner's of 11-08: a coding agent's checklist, called through Filament's tool by its MCP name,
  // was never read as a plan, so a switch handed the loop none of it)
  test("a coding agent's checklist, kept with Filament's tool, is handed to the loop the chat moves to while it is live", async () => {
    const id = await open("own/fake-a");
    const items = [{ text: "read the readme", status: "done" }, { text: "fix the typo", status: "doing" }, { text: "run the tests", status: "pending" }];
    await say(id, `~rawmcp ~mcpcall checklist ${JSON.stringify({ items })}`);
    assert.match(String(prompts().at(-1)?.prompt ?? ""), /~mcpcall checklist/, "the agent was asked to keep its checklist");
    const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "go on", stream: false, settingsPatch: { model: { name: "m-1" } }, sendAsIs: true } });
    assert.equal(res.status, 200, await res.clone().text());
    const asked = JSON.stringify(sent().at(-1)?.messages?.at(-1));
    assert.ok(asked.includes("[Filament handed these over as this chat moved to you from own:"), asked.slice(-900));
    assert.ok(asked.includes("<plan>\\n- [done] read the readme\\n- [doing] fix the typo\\n- [pending] run the tests\\n</plan>"), asked.slice(-900));
  });

  // (fails before: yes — the hunt of 11-08: the loop's handover read the turns as the adapter made them for the loop, and
  // a turn folded there — Claude's sub-agent launch has no equivalent in the loop's tools — kept no call to read: the
  // file the agent read and edited was never handed over)
  test("a coding agent's turn the loop's tools fold: the files it used are handed to the loop the chat moves to all the same", async () => {
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const id = await open("own/fake-a");
    await say(id, "~work");
    const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "go on", stream: false, settingsPatch: { model: { name: "m-1" } }, sendAsIs: true } });
    assert.equal(res.status, 200, await res.clone().text());
    const body = sent().at(-1);
    const calls = (body?.messages || []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : [])).filter((/** @type {any} */ b) => b?.type === "tool_use");
    assert.deepEqual(calls.map((/** @type {any} */ b) => b.name), [], "the turn reached the loop folded");
    const asked = JSON.stringify(body?.messages?.at(-1));
    assert.ok(asked.includes("[Filament handed these over as this chat moved to you from own: the files the work used most recently"), asked.slice(-1500));
    assert.ok(asked.includes("README.md") && asked.includes("edited by the agent"), asked.slice(-1500));
  });

  // (fails before: yes — the bug hunt of 11-09: a side the chat went back to was handed again what it had — a coding
  // agent's session that goes on, and the loop, whose copy keeps its own turns with what it was handed then: the files
  // and the skills of the turns it ran there itself)
  test("back on a side the chat ran on before — a coding agent's session that goes on, or the loop — only what came after its newest turn there is handed over", async () => {
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const id = await open("own/fake-a");
    await say(id, "~work");
    await say(id, `~rawmcp ~mcpcall skill ${JSON.stringify({ name: "filament-setup" })}`);
    const run = command(id);
    /** A turn on another model, sent as it is past the switch's card: its record's notes. @param {string} content @param {string} model */
    const moveTo = async (content, model) => {
      const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: false, settingsPatch: { model: { name: model } }, sendAsIs: true } });
      assert.equal(res.status, 200, await res.clone().text());
      const rec = await shim.record(String(res.headers.get("x-filament-request-id")));
      return [...(rec.changes || []), ...(rec.priorChanges || [])].map(String);
    };
    try {
      // The loop never ran the chat: it is handed the file the agent used and the skill it loaded.
      await moveTo("two", "m-1");
      const first = JSON.stringify(sent().at(-1)?.messages?.at(-1));
      assert.ok(first.includes("[Filament handed these over as this chat moved to you from own: the files the work used most recently") && first.includes("README.md"), first.slice(-1500));
      assert.ok(first.includes("the skills loaded before the move") && first.includes("filament-setup"), first.slice(-1500));
      // Back on the agent, whose session of the chat goes on: what is open, and nothing of its own turns.
      const back = await moveTo("three", "own/fake-a");
      assert.ok(back.some((n) => n.includes("own's own session of this chat is still up: it goes on in it")), back.join("\n"));
      const told = String(prompts().at(-1)?.prompt);
      assert.ok(told.includes(`[Filament handed these over as this chat moved to you from m-1: what is still open.`) && told.includes(run.id), told.slice(-1500));
      // Back on the loop, whose copy holds its own turn and what it was handed with it: nothing of before that again.
      await moveTo("four", "m-1");
      const again = JSON.stringify(sent().at(-1)?.messages?.at(-1));
      assert.ok(again.includes("[Filament handed these over as this chat moved to you from own: what is still open.") && again.includes(run.id), again.slice(-1500));
    } finally {
      await stopShell(run.id, { session: id, agent: null });
    }
  });

  // (fails before: yes — the bug hunt of 11-09: back on a coding agent's session that goes on, the agent's own command
  // first, what stood was owed to its next prompt — and that one was handed the session's own turns again)
  test("back on a coding agent's session that goes on, its own command first: its next prompt is handed only what came after its newest turn there", async () => {
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const id = await open("own/fake-a");
    await say(id, "~work");
    await say(id, `~rawmcp ~mcpcall skill ${JSON.stringify({ name: "filament-setup" })}`);
    const run = command(id);
    /** A turn on another model, sent as it is past the switch's card: its record's notes. @param {string} content @param {string} model */
    const moveTo = async (content, model) => {
      const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: false, settingsPatch: { model: { name: model } }, sendAsIs: true } });
      assert.equal(res.status, 200, await res.clone().text());
      const rec = await shim.record(String(res.headers.get("x-filament-request-id")));
      return [...(rec.changes || []), ...(rec.priorChanges || [])].map(String);
    };
    try {
      await moveTo("two", "m-1");
      const back = await moveTo("/review", "own/fake-a");
      assert.ok(back.some((n) => n.includes("own's own session of this chat is still up: it goes on in it")), back.join("\n"));
      assert.equal(String(prompts().at(-1)?.prompt), "/review", "the command goes as typed");
      const next = await say(id, "go on");
      const told = String(prompts().at(-1)?.prompt);
      assert.ok(told.includes("[Filament handed these over as this chat moved to you from m-1: what is still open.") && told.includes(run.id), told.slice(-1500));
      assert.ok(next.notes.includes("acp: what stands, handed to own with its first prompt of the turn as the chat moved from m-1"), next.notes.join("\n"));
    } finally {
      await stopShell(run.id, { session: id, agent: null });
    }
  });

  // (fails before: yes — the bug hunt of 11-09: the turn's record said a handover that held no file, plan, task graph or
  // open line was "the skills loaded", whatever it held — letters alone among them)
  test("the turn's record names what the handover holds: a skill loaded, by its count", async () => {
    const id = await open("own/fake-a");
    await say(id, `~rawmcp ~mcpcall skill ${JSON.stringify({ name: "filament-setup" })}`);
    const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "go on", stream: false, settingsPatch: { model: { name: "m-1" } }, sendAsIs: true } });
    assert.equal(res.status, 200, await res.clone().text());
    const rec = await shim.record(String(res.headers.get("x-filament-request-id")));
    const notes = [...(rec.changes || []), ...(rec.priorChanges || [])].map(String);
    assert.ok(notes.some((n) => /^compose: agent: the chat moved from own: its first request is handed what stands \(~\d+ tokens: 1 skill\)$/.test(n)), notes.join("\n"));
  });

  // (fails before: yes — the hunt of 11-08: the tools the adapter rebuilt a coding agent's turn against left out the skill
  // tool the loop's request carries, so a turn that loaded a skill with Filament's tool folded whole)
  test("a coding agent's turn that loaded a skill with Filament's tool reaches the loop translated, its call the loop's skill tool", async () => {
    const id = await open("own/fake-a");
    await say(id, `~rawmcp ~mcpcall skill ${JSON.stringify({ name: "filament-setup" })}`);
    const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "go on", stream: false, settingsPatch: { model: { name: "m-1" } }, sendAsIs: true } });
    assert.equal(res.status, 200, await res.clone().text());
    const body = sent().at(-1);
    const has = new Set((body?.tools || []).map((/** @type {any} */ t) => String(t.name)));
    assert.ok(has.has("skill"), [...has].join(", "));
    const calls = (body?.messages || []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : [])).filter((/** @type {any} */ b) => b?.type === "tool_use");
    assert.deepEqual(calls.map((/** @type {any} */ b) => [b.name, b.input?.name]), [["skill", "filament-setup"]], JSON.stringify(body?.messages).slice(0, 2000));
  });

  // (fails before: yes — the hunt of 11-08: a chat imported from Claude Code went on in the loop with its turns as the
  // agent made them, its Read and Bash by Claude's names, neither a tool the loop has)
  test("a chat imported from a coding agent goes on in the loop with its turns in the loop's own tools", async () => {
    const sink = new Sink(/** @type {any} */ (shim.app.memory).archive, { agent: "Claude Code" });
    const t0 = Date.now() - 60_000;
    const chain = sink.chain("claude-code:retold-import", { cwd: projDir, title: "Imported", meta: { import: "claude-code" }, startedAt: t0 });
    const w = sink.writer(chain);
    const work = [
      { role: "assistant", content: [{ type: "tool_use", id: "i_r1", name: "Read", input: { file_path: join(projDir, "README.md") } }, { type: "tool_use", id: "i_b1", name: "Bash", input: { command: "git status --short", description: "See what changed" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "i_r1", content: "hello agent" }, { type: "tool_result", tool_use_id: "i_b1", content: "" }] },
    ];
    w.put({ user: { role: "user", content: "look at the readme" }, work, final: { role: "assistant", content: [{ type: "text", text: "It says hello." }] }, at: t0, workAt: t0, endAt: t0 + 1000, model: "claude-opus-4", meta: { format: "anthropic" } });
    w.end();
    sink.close(chain, { at: t0 + 1000, title: "Imported", mark: 1 });
    const res = await shim.api(`${at(chain.id)}/turns`, { method: "POST", body: { content: "go on", stream: false, settingsPatch: { model: { name: "m-1" } }, sendAsIs: true } });
    assert.equal(res.status, 200, await res.clone().text());
    const body = sent().at(-1);
    const calls = (body?.messages || []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : [])).filter((/** @type {any} */ b) => b?.type === "tool_use");
    assert.deepEqual(calls.map((/** @type {any} */ b) => b.name), ["read", "bash"], JSON.stringify(body?.messages).slice(0, 2000));
  });

  // (fails before: yes — the owner's of 11-08: a coding agent's turns reached the loop as stored, its Bash and Filament's
  // tools by their MCP names, none of them a tool the loop has; a provider may refuse such a history)
  test("a coding agent's turns reach the loop the chat moves to in the loop's own tools: each call translated, or the turn folded", async () => {
    const id = await open("own/fake-a");
    await say(id, "~early");
    await say(id, `~rawmcp ~mcpcall checklist ${JSON.stringify({ items: [{ text: "look", status: "doing" }] })}`);
    const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "go on", stream: false, settingsPatch: { model: { name: "m-1" } }, sendAsIs: true } });
    assert.equal(res.status, 200, await res.clone().text());
    const body = sent().at(-1);
    const has = new Set((body?.tools || []).map((/** @type {any} */ t) => String(t.name)));
    const calls = (body?.messages || []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : [])).filter((/** @type {any} */ b) => b?.type === "tool_use");
    assert.deepEqual(calls.filter((/** @type {any} */ b) => !has.has(String(b.name))).map((/** @type {any} */ b) => b.name), [], "every call the loop is sent is one of its own tools");
    // The newest turn rides whole, Filament's checklist its plan; the one before folds as the loop's composer folds it, its
    // Bash a line of its bash.
    assert.ok(calls.some((/** @type {any} */ b) => b.name === "plan" && b.input?.items?.[0]?.text === "look"), JSON.stringify(body?.messages).slice(0, 3000));
    assert.match(JSON.stringify(body?.messages), /⚙ bash git log -1 → commit abc/);
  });

  // (fails before: yes — the owner's of 11-08: the picker writes the model at once, so Filament's wake after it was
  // refused by the switch's card, which nobody was there to answer, and the command's end waited for the person)
  test("a wake after the person picked another model goes through: the turn nobody is at the page for takes the chat's form", async () => {
    const id = await open("m-1");
    await say(id, "one");
    const moved = await shim.api(`${at(id)}/settings`, { method: "PATCH", body: { patch: { model: { name: "own/fake-a" } } } });
    assert.equal(moved.status, 200, await moved.clone().text());
    tellLater({ session: id, agent: null }, { id: "bg_pick", command: "npm test", code: 0, text: "[Filament: your background command bg_pick ended: `npm test` exited with code 0 after 1s.]" }, { now: false });
    try {
      const woke = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "", wake: true, stream: false } });
      assert.equal(woke.status, 200, await woke.clone().text());
      const seed = String(prompts().at(-1)?.prompt ?? "");
      assert.match(seed, /bg_pick/, "the end goes to the agent the chat moved to");
      const rec = await shim.record(String(woke.headers.get("x-filament-request-id")));
      assert.ok([...(rec.changes || []), ...(rec.priorChanges || [])].map(String).some((n) => /carried as Words \(context\.carry\)/.test(n)), "the chat's own form, as Send as it is takes it");
    } finally {
      takeShellExits({ session: id, agent: null });
    }
  });

  // (fails before: yes — the same review: Codex's refused turn/steer went back to the door, whose wake sent turn/start)
  test("Codex: no step after its compaction, no turn/start or turn/steer for the list; a command after it, the list by turn/steer into that turn; Cursor: run.steer at its step", async () => {
    const cx = await open("cx/gpt-5.5");
    const run = command(cx);
    const callsOf = () => lines(join(root, "cx.jsonl")).filter((c) => c.method === "turn/start" || c.method === "turn/steer");
    const before = callsOf().length;
    await say(cx, "~compact");
    const that = callsOf().slice(before);
    assert.deepEqual(that.map((c) => c.method), ["turn/start"], "its own message alone");
    assert.ok(!JSON.stringify(that).includes(JUST_NOW));
    assert.deepEqual(heard(cx), { lost: true });
    writeFileSync(join(root, "cxticks", "tick"), "");
    const after = callsOf().length;
    const { text } = await say(cx, "~steer ~compactfirst");
    const steered = callsOf().slice(after);
    assert.deepEqual(steered.map((c) => c.method), ["turn/start", "turn/steer"]);
    assert.ok(JSON.stringify(steered[0].params).includes("You compacted your context before this message"), "the first message carries what the last turn never said");
    assert.ok(JSON.stringify(steered[1].params).includes(JUST_NOW) && JSON.stringify(steered[1].params).includes(`- background command ${run.id}: `), JSON.stringify(steered[1].params));
    assert.ok(text.includes(`heard:[Filament: ${JUST_NOW}`), text);
    assert.deepEqual(heard(cx), { keys: [`command:${run.id}`] });
    await stopShell(run.id, { session: cx, agent: null });

    const cu = await open("cursor/composer-2.5");
    const other = command(cu);
    await say(cu, "~compact");
    assert.ok(!lines(join(root, "sdk.jsonl")).some((e) => e.event === "steer" && String(e.text).includes(other.id)), "no step after it: no steer");
    await say(cu, "~compact ~shell ~hang");
    const steers = lines(join(root, "sdk.jsonl")).filter((e) => e.event === "steer" && String(e.text).includes(other.id));
    assert.ok(steers.length === 1 && steers[0].takes && String(steers[0].text).includes(JUST_NOW), JSON.stringify(steers));
    assert.deepEqual(heard(cu), { keys: [`command:${other.id}`] });
    await stopShell(other.id, { session: cu, agent: null });
  });

  // (fails before: yes — the nudge map of 11-10, c-cursor: Cursor answered the steer that carried what comes back after
  // its compaction `revert_to_followup`, and it was taken as gone: the follow-up that carried the report behind it went
  // without it, and the chat kept the compaction for the next turn)
  test("Cursor hands back the words after its compaction (revert_to_followup): the steer marks nothing heard; the follow-up that carries them says what comes back, and marks it", async () => {
    const cu = await open("cursor/composer-2.5");
    const other = command(cu);
    try {
      const spawn = await shim.api(`${at(cu)}/subagents`, { method: "POST", body: { prompt: "List the files", description: "Side look", model: "m-1", deliver: false } });
      assert.equal(spawn.status, 200, await spawn.clone().text());
      const sa = /** @type {any} */ (await until(async () => (await json(`${at(cu)}/subagents`)).subagents.find((/** @type {any} */ s) => s.status !== "running") || null, "the side agent to answer"));
      const res = await shim.api(`${at(cu)}/turns`, { method: "POST", body: { content: "~compact ~followup", stream: true, runEvents: true } });
      const runId = String(res.headers.get("x-filament-request-id"));
      await until(() => heard(cu)?.lost === true, "the compaction, kept for what comes back");
      const sent = await shim.api(`${at(cu)}/subagents/${sa.id}/send`, { method: "POST", body: { when: "now" } });
      assert.deepEqual([sent.status, (await sent.json()).into], [200, "turn"]);
      await res.text();
      const log = lines(join(root, "sdk.jsonl"));
      const steers = log.filter((e) => e.event === "steer" && String(e.text).includes(sa.id));
      assert.ok(steers.length === 1 && steers[0].takes === false && String(steers[0].text).includes(JUST_NOW), JSON.stringify(steers).slice(0, 1500));
      const followUp = String(log.find((e) => e.event === "send" && e.agentId === steers[0].agentId && String(e.prompt).includes(sa.id))?.prompt);
      assert.ok(followUp.includes(JUST_NOW) && followUp.includes(`- background command ${other.id}: `), followUp.slice(0, 1500));
      assert.ok(followUp.indexOf(JUST_NOW) < followUp.indexOf(sa.id), "ahead of the report it rode with");
      assert.deepEqual(heard(cu), { keys: [`command:${other.id}`] });
      const rec = await shim.record(runId);
      const notes = [...(rec.changes || []), ...(rec.priorChanges || [])].map(String);
      assert.ok(!notes.some((n) => n.includes("went into Cursor's running turn")), notes.join("\n"));
      assert.ok(notes.includes("acp: Cursor woken in the same turn: 1 message from Filament"), notes.join("\n"));
      assert.ok(notes.includes("acp: what comes back after Cursor's compaction went into its turn, 1 message from Filament behind it"), notes.join("\n"));
    } finally {
      await stopShell(other.id, { session: cu, agent: null });
    }
  });

  // (fails before: yes — the review of 11-03: a turn that never carried the list, an agent's own command, still moved the
  // record at its end, and the change was never said)
  test("a change that went is said with the first prompt that carries it: an agent's own command carries none, and moves nothing", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    toldOfAChange(id);
    await say(id, "/review");
    assert.equal(prompts().at(-1)?.text, "/review", "the command as typed");
    assert.deepEqual(heard(id), { keys: ["agent:sa_gone:waits"] }, "nothing moved");
    const { notes } = await say(id, "two");
    assert.ok(String(prompts().at(-1)?.text).includes(CHANGED_ALONE), String(prompts().at(-1)?.text));
    assert.ok(notes.includes("acp: what is still open, listed with own's first prompt of the turn — a change it was told waits for it was applied or dropped since"), notes.join("\n"));
    assert.equal(heard(id), undefined);
  });

  // (fails before: yes — the agent compacting its own session outside a turn, and Filament's summary of a coding agent's
  // chat, said nothing of what was still open to the session the next turn went to)
  test("the agent's own compaction outside a turn: its next prompt says what is still open; Filament's summary of its chat: the fresh session's seed carries it", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    const run = command(id);
    const own = await shim.api(`${at(id)}/compact`, { method: "POST", body: { way: "own" } });
    assert.equal(own.status, 200, await own.clone().text());
    assert.deepEqual(heard(id), { lost: true });
    await say(id, "two");
    const text = String(prompts().at(-1)?.text);
    assert.ok(text.startsWith("two") && text.includes("[Filament: You compacted your context before this message") && text.includes(`- background command ${run.id}: \``), text);
    assert.deepEqual(heard(id), { keys: [`command:${run.id}`] });

    await say(id, "three ~holds 150000");
    const ours = await shim.api(`${at(id)}/compact`, { method: "POST", body: { way: "ours", method: "summary" } });
    assert.equal(ours.status, 200, await ours.clone().text());
    assert.deepEqual(heard(id), { keys: [`command:${run.id}`] }, "the summary's block says it");
    await say(id, "four");
    const seeded = String(prompts().at(-1)?.text);
    assert.ok(seeded.includes(SUMMARY) && seeded.includes(`<open>\n- background command ${run.id}: \``), seeded);
    assert.ok(!seeded.includes("[Filament: A sub-agent's change") && !seeded.includes("[Filament: You compacted"), "said by the block alone");
    await stopShell(run.id, { session: id, agent: null });
  });

  // (fails before: yes — the nudge map of 11-10, c-dupes: the fresh session's seed carried the graph with where it stood,
  // and the turn's first prompt said where it stood again, as the loop's summary head never does)
  test("Filament's summary of a coding agent's chat with its task graph open: where it stands is said once, in the seed", async () => {
    const id = await open("own/fake-a");
    const added = await say(id, `~mcpcall tasks ${JSON.stringify({ action: "add", goal: "Ship the tokenizer", tasks: [{ id: "t1", name: "Write the tokenizer" }] })}`);
    assert.match(added.text, /Added t1\./, added.text);
    await say(id, "two ~holds 150000");
    const ours = await shim.api(`${at(id)}/compact`, { method: "POST", body: { way: "ours", method: "summary" } });
    assert.equal(ours.status, 200, await ours.clone().text());
    const { notes } = await say(id, "three");
    const seeded = String(prompts().at(-1)?.text);
    assert.ok(seeded.includes(SUMMARY) && seeded.includes("Ship the tokenizer"), seeded);
    assert.equal(seeded.split("[Filament: where you are — ").length, 2, seeded);
    assert.ok(notes.includes("acp: what the where block says came with the session's seed — not said again with its prompt"), notes.join("\n"));
    // The turn after it, on the session the seed began: where it stands goes with its first prompt as at any start.
    await say(id, "four");
    assert.equal(String(prompts().at(-1)?.text).split("[Filament: where you are — ").length, 2, String(prompts().at(-1)?.text));
  });

  // (the hunt of 11-11 on c-dupes, where-drift — the loop's failed first, task-graph-memory.test.js: the turn's start
  // counts a turn on the running task, and says it has gone quiet; the seed is matched as the summary said it, before)
  test("Filament's summary of a coding agent's chat with a task of its own running: where it stands is said once, in the seed, though the turn's start counts a turn", async () => {
    const id = await open("own/fake-a");
    const added = await say(id, `~mcpcall tasks ${JSON.stringify({ action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer" }] })}`);
    assert.match(added.text, /Added t1\./, added.text);
    await say(id, `~mcpcall tasks ${JSON.stringify({ action: "start", ids: ["t1"] })}`);
    await say(id, "two");
    await say(id, "three ~holds 150000");
    const ours = await shim.api(`${at(id)}/compact`, { method: "POST", body: { way: "ours", method: "summary" } });
    assert.equal(ours.status, 200, await ours.clone().text());
    const { notes } = await say(id, "four");
    const seeded = String(prompts().at(-1)?.text);
    assert.ok(seeded.includes(SUMMARY) && seeded.includes("Ship the lexer"), seeded);
    assert.equal(seeded.split("[Filament: where you are — ").length, 2, seeded);
    assert.ok(!seeded.includes("t1 has run 3 turns"), "the turn's own words are not said beside the seed's");
    assert.ok(notes.includes("acp: what the where block says came with the session's seed — not said again with its prompt"), notes.join("\n"));
    // The count was kept all the same: the next turn's start says it has gone quiet.
    await say(id, "five");
    assert.match(String(prompts().at(-1)?.text), /t1 has run 4 turns with no checkpoint/, String(prompts().at(-1)?.text));
  });

  // (fails before: yes — the owner's of 11-08: a switch's handoff summary could only be written as the model picked,
  // cold, never by the one that answered last while its cache was warm)
  test("a compaction by the model that answered last, after the person picked another: the loop's from its warm cache, a coding agent's in its own session", async () => {
    const loop = await open("m-1");
    await say(loop, "one ~cached");
    await say(loop, "two ~cached");
    const toAgent = await shim.api(`${at(loop)}/settings`, { method: "PATCH", body: { patch: { model: { name: "own/fake-a" } } } });
    assert.equal(toAgent.status, 200);
    const warm = await shim.api(`${at(loop)}/compact`, { method: "POST", body: { method: "summary", once: { writer: "session" }, by: "last" } });
    const made = await warm.json();
    assert.equal(warm.status, 200, JSON.stringify(made));
    assert.equal(made.compaction.method, "summary");
    assert.match(String(made.note), /m-1, from its warm cache/, made.note);
    // (fails before: yes — the hunt of 11-09: asked again once written, as a handoff pressed again after its send was
    // refused, the refusal said nothing apart from its words for the page to take the summary that stands)
    const again = await shim.api(`${at(loop)}/compact`, { method: "POST", body: { method: "summary", once: { writer: "session" }, by: "last" } });
    const under = await again.json();
    assert.deepEqual([again.status, under.covered], [409, true], JSON.stringify(under));

    const agent = await open("own/fake-a");
    await say(agent, "one");
    const toLoop = await shim.api(`${at(agent)}/settings`, { method: "PATCH", body: { patch: { model: { name: "m-1" } } } });
    assert.equal(toLoop.status, 200);
    const own = await shim.api(`${at(agent)}/compact`, { method: "POST", body: { way: "own", by: "last" } });
    const itsOwn = await own.json();
    assert.equal(own.status, 200, JSON.stringify(itsOwn));
    assert.equal(itsOwn.compaction.method, "own");
    const none = await shim.api(`${at(await open("m-1"))}/compact`, { method: "POST", body: { method: "summary", by: "last" } });
    assert.equal(none.status, 409, "a chat with no turn has no model that answered last");
  });

  // (fails before: yes — the owner's of 11-08: after Claude's own summary nothing came back for what starts from the copy;
  // Claude's own background task was named to no other session; and the loop the chat moved to could be told it had
  // compacted its context)
  test("Claude's own summary keeps what came back after it; at a switch the loop is handed what stands, Claude's own task named as Claude's, never told it compacted", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    const run = command(id);
    const acp = /** @type {any} */ (shim.app).acp;
    try {
      await say(id, "~compact two");
      const own = /** @type {any[]} */ (/** @type {any} */ (shim.app.memory).archive.getCompactions(id)).findLast((r) => r.method === "own");
      assert.ok(own?.detail?.attached, `the block is kept with Claude's summary: ${JSON.stringify(own?.detail)}`);
      acp.onTasks({ chain: id, sessionId: "claude-own-s", upstream: "own", tasks: [{ id: "bt-1", kind: "local_bash", description: "npm run dev", background: true, since: Date.now() - 60_000 }] });
      const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "go on", stream: false, settingsPatch: { model: { name: "m-1" } }, sendAsIs: true } });
      assert.equal(res.status, 200, await res.clone().text());
      const words = (sent().at(-1)?.messages || []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }])).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text)).join("\n");
      assert.ok(words.includes(`- background command ${run.id}: \``), words.slice(-1500));
      assert.ok(words.includes(`- background shell bt-1 ("npm run dev") in own's session of this chat, not yours: running for`), words.slice(-1500));
      assert.ok(!words.includes("You compacted your context"), "the loop never compacted its context");
    } finally {
      acp.onTasks({ chain: id, sessionId: "claude-own-s", upstream: "own", tasks: [] });
      await stopShell(run.id, { session: id, agent: null });
    }
  });

  // (fails before: yes — the review of cb2d2d1f0: a chat keeps one list, so the session before's empty report cleared the
  // live tasks of the session after it)
  test("a session's empty task list ends its own: another session's of the chat stands", async () => {
    const id = await open("own/fake-a");
    const acp = /** @type {any} */ (shim.app).acp;
    const listed = async () => JSON.stringify(await json(`${at(id)}/transcript`)).includes("bt-5");
    try {
      acp.onTasks({ chain: id, sessionId: "s-after", upstream: "own", tasks: [{ id: "bt-5", kind: "local_bash", description: "npm run dev", background: true, since: Date.now() }] });
      assert.ok(await listed(), "the session after's task is listed");
      acp.onTasks({ chain: id, sessionId: "s-before", upstream: "own", tasks: [] });
      assert.ok(await listed(), "the session before's empty list leaves it");
      acp.onTasks({ chain: id, sessionId: "s-after", upstream: "own", tasks: [] });
      assert.ok(!(await listed()), "its own empty list ends it");
    } finally {
      acp.onTasks({ chain: id, sessionId: "s-after", upstream: "own", tasks: [] });
    }
  });

  // (fails before: yes — the review of cb2d2d1f0: the block kept with Claude's summary read the turn it compacted in as
  // kept whole, and the copy cuts that turn at the compaction: the file it read before was neither shown nor brought back)
  test("Claude's summary in the middle of a turn: what the turn read before it comes back with the block", async () => {
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const id = await open("own/fake-a");
    await say(id, "one");
    await say(id, "~readcompact");
    const archive = /** @type {any} */ (shim.app.memory).archive;
    const own = /** @type {any[]} */ (archive.getCompactions(id)).findLast((r) => r.method === "own");
    assert.equal(own?.detail?.cutAfter, "rc_r1", JSON.stringify(own?.detail));
    const hash = own?.detail?.attached?.hash;
    const text = hash ? JSON.stringify(archive.getMessage(hash)?.message?.content ?? "") : "";
    assert.ok(text.includes("README.md") && text.includes("hello agent"), text);
  });

  // (fails before: yes — the review of cb2d2d1f0: a block kept with a summary's row named Claude's own task as running on
  // in its session, said again at every later request after that session let it go; Claude's summary on request kept no
  // block at all; and the session the chat went back to was told its own task was another's, one it could neither read
  // nor stop)
  test("Claude's own tasks: never in a block kept with a summary's row, which Claude's on request keeps too; never told as another's to the session the chat goes back to", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    const run = command(id);
    const acp = /** @type {any} */ (shim.app).acp;
    const archive = /** @type {any} */ (shim.app.memory).archive;
    /** The words of the block kept with the chat's newest summary; "" where none is kept. */
    const block = () => {
      const hash = archive.getCompactions(id).at(-1)?.detail?.attached?.hash;
      return hash ? JSON.stringify(archive.getMessage(hash)?.message?.content ?? "") : "";
    };
    try {
      acp.onTasks({ chain: id, sessionId: "claude-own-s", upstream: "own", tasks: [{ id: "bt-9", kind: "local_bash", description: "npm run dev", background: true, since: Date.now() - 60_000 }] });
      const own = await shim.api(`${at(id)}/compact`, { method: "POST", body: { way: "own" } });
      assert.equal(own.status, 200, await own.clone().text());
      assert.ok(block().includes(run.id), `Claude's summary on request keeps the block: ${block()}`);
      assert.ok(!block().includes("bt-9"), block());
      await say(id, "two");
      // To the loop and back: the session the chat goes on in runs Claude's task, and hears nothing of it as another's.
      const moveTo = async (/** @type {string} */ content, /** @type {string} */ name) => {
        const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: false, settingsPatch: { model: { name } }, sendAsIs: true } });
        assert.equal(res.status, 200, await res.clone().text());
      };
      await moveTo("three", "m-1");
      const loopTold = JSON.stringify(sent().at(-1)?.messages?.at(-1));
      assert.ok(loopTold.includes(`- background shell bt-9 (\\"npm run dev\\") in own's session of this chat, not yours`), `the loop is told it is Claude's: ${loopTold.slice(-1500)}`);
      await moveTo("four", "own/fake-a");
      const told = JSON.stringify(prompts().at(-1));
      assert.ok(told.includes("[Filament handed these over as this chat moved to you from m-1") && told.includes(run.id), told.slice(-1500));
      assert.ok(!told.includes("bt-9"), told.slice(-1500));
      await say(id, "five ~holds 150000");
      const ours = await shim.api(`${at(id)}/compact`, { method: "POST", body: { way: "ours", method: "summary" } });
      assert.equal(ours.status, 200, await ours.clone().text());
      assert.ok(block().includes(run.id) && !block().includes("bt-9"), block());
    } finally {
      acp.onTasks({ chain: id, sessionId: "claude-own-s", upstream: "own", tasks: [] });
      await stopShell(run.id, { session: id, agent: null });
    }
  });

  // (fails before: yes — the review of cb2d2d1f0: the loop's card read a coding agent's turn that failed after doing work
  // as the chat's move, and the handover the finished turn before it, the loop's own: none was sent)
  test("a coding agent's turn that failed after doing work, then the loop: it is handed what stands, as its card said", async () => {
    const id = await open("m-1");
    await say(id, "one");
    const run = command(id);
    try {
      const failed = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "~failonce fz", stream: false, settingsPatch: { model: { name: "own/fake-a" } }, sendAsIs: true } });
      await failed.text();
      const turns = /** @type {any[]} */ (/** @type {any} */ (shim.app.memory).archive.turnBodies(id));
      assert.ok(turns.at(-1)?.meta?.failed && turns.at(-1)?.work?.length, "Claude's turn failed after doing work");
      const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "go on", stream: false, settingsPatch: { model: { name: "m-1" } }, sendAsIs: true } });
      assert.equal(res.status, 200, await res.clone().text());
      const asked = JSON.stringify(sent().at(-1)?.messages?.at(-1));
      assert.ok(asked.includes("[Filament handed these over as this chat moved to you from own") && asked.includes(run.id), asked.slice(-1200));
      await say(id, "and on");
      assert.ok(!JSON.stringify(sent().at(-1)?.messages?.at(-1)).includes("handed these over"), "said once");
    } finally {
      await stopShell(run.id, { session: id, agent: null });
    }
  });

  // (fails before: yes — the owner's of 11-08: a switch into Filament's loop, from a coding agent or another model, asked
  // nothing, and no switch's card offered a summary by the model that answered last)
  test("a switch into the loop asks first, offering a summary by the model that answered last; Send as it is, the handoff, and Filament's own turns go", async () => {
    /** A turn sent on its own, its refusal's question where it asked. @param {string} id @param {string} content @param {any} [more] */
    const ask = async (id, content, more = {}) => {
      const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: false, ...more } });
      return { status: res.status, body: await res.json() };
    };
    /** @param {string} id @param {string} name */
    const pick = async (id, name) => assert.equal((await shim.api(`${at(id)}/settings`, { method: "PATCH", body: { patch: { model: { name } } } })).status, 200);

    // Another model of the loop's: the same copy, read cold by the new one; the old one's cache is warm.
    const loop = await open("m-1");
    await say(loop, "one ~cached");
    await pick(loop, "m-2");
    const toM2 = await ask(loop, "two");
    assert.equal(toM2.status, 409, JSON.stringify(toM2.body));
    const q = toM2.body.switchQuestion;
    assert.deepEqual([q.loop, q.fromAgent, q.from.name, q.to.name, q.to.upstream, q.suggested], [true, false, "m-1", "m-2", "agent-loop", "send"]);
    assert.deepEqual([q.handoff.way, q.handoff.by, q.handoff.cache.state], ["summary", "m-1", "warm"]);
    assert.ok(q.held > 0 && q.usable > q.held, JSON.stringify(q));
    const words = String(toM2.body.error);
    assert.match(words, /You switched to m-2 from m-1\. Its instructions and tools are built for it now, and it reads the conversation from Filament's copy as it stands: every turn so far, every call with its result\. Nothing of the chat is cached on m-2 yet\. m-1 can write a summary of it first, from its cache while it is still warm, for m-2 to start from\./);
    assert.equal((await ask(loop, "two", { sendAsIs: true })).status, 200, "Send as it is");
    assert.equal((await ask(loop, "three")).status, 200, "on the model it moved to, nothing more is asked");

    // (fails before: yes — the review of fd62160df) Back on a model that answered before, nothing is said of its cache,
    // which may be warm still; compacted since the pick, no turn is left for a handoff, and nothing is asked.
    await pick(loop, "m-1");
    const back = await ask(loop, "four");
    assert.equal(back.status, 409, JSON.stringify(back.body));
    assert.equal(back.body.switchQuestion.answeredBefore, true);
    assert.doesNotMatch(String(back.body.error), /Nothing of the chat is cached/);
    const made = await shim.api(`${at(loop)}/compact`, { method: "POST", body: { method: "summary" } });
    assert.equal(made.status, 200, await made.clone().text());
    assert.equal((await ask(loop, "four")).status, 200, "no handoff to offer: nothing asked");

    // Filament's own turn after a pick goes as Send as it is would.
    await pick(loop, "m-1");
    tellLater({ session: loop, agent: null }, { id: "bg_loop", command: "npm test", code: 0, text: "[Filament: your background command bg_loop ended: `npm test` exited with code 0 after 1s.]" }, { now: false });
    try {
      const woke = await ask(loop, "", { wake: true });
      assert.equal(woke.status, 200, JSON.stringify(woke.body));
    } finally {
      takeShellExits({ session: loop, agent: null });
    }

    // From a coding agent: its calls in the loop's tools — with nothing that stands to hand over, none said (the bug hunt
    // of 11-09: the card said the plan, the task graph and what is still open whatever the handover held); its handoff
    // written in its session, then the message goes past the card.
    const agent = await open("own/fake-a");
    await say(agent, "one ~holds 150000");
    await pick(agent, "m-1");
    const fromAgent = await ask(agent, "two");
    assert.equal(fromAgent.status, 409, JSON.stringify(fromAgent.body));
    const a = fromAgent.body.switchQuestion;
    assert.deepEqual([a.loop, a.fromAgent, a.from.name, a.to.name], [true, true, "own", "m-1"]);
    assert.ok(a.handoff?.way === "self" && a.handoff.by === "own", JSON.stringify(a.handoff));
    assert.deepEqual(a.handed, []);
    assert.match(String(fromAgent.body.error), /it reads the conversation from Filament's copy: every turn so far, own's tool calls in its own tools\. own's thinking stays behind\./);
    const handed = await shim.api(`${at(agent)}/compact`, { method: "POST", body: { way: a.handoff.way, by: "last" } });
    assert.equal(handed.status, 200, await handed.clone().text());
    assert.equal((await ask(agent, "two", { sendAsIs: true })).status, 200, "the message goes once the handoff is written");

    // Into a coding agent from the loop: its card offers the loop model's summary too.
    const toAgent = await open("m-1");
    await say(toAgent, "one ~cached");
    await pick(toAgent, "own/fake-a");
    const into = await ask(toAgent, "two");
    assert.equal(into.status, 409, JSON.stringify(into.body));
    const s = into.body.switchQuestion;
    assert.ok(!s.loop && s.handoff?.way === "summary" && s.handoff.by === "m-1" && s.handoff.cache?.state === "warm", JSON.stringify(s));
    assert.match(String(into.body.error), /m-1 can write a summary of it first, from its cache while it is still warm, for own to start from\.$/);
  });

  // (fails before: yes — the bug hunt of 11-09: the card into the loop said the plan, the task graph and what is still open
  // whatever the handover would hold, and never named the files or the skills it did)
  test("a switch into the loop from a coding agent: its card names what the handover will carry, as the handover then does", async () => {
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const id = await open("own/fake-a");
    await say(id, "~work");
    await say(id, `~rawmcp ~mcpcall skill ${JSON.stringify({ name: "filament-setup" })} ~holds 150000`);
    const run = command(id);
    try {
      assert.equal((await shim.api(`${at(id)}/settings`, { method: "PATCH", body: { patch: { model: { name: "m-1" } } } })).status, 200);
      const asked = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "two", stream: false } });
      const body = await asked.json();
      assert.equal(asked.status, 409, JSON.stringify(body));
      assert.deepEqual(body.switchQuestion.handed, ["files", "open", "skills"]);
      assert.match(String(body.error), /own's tool calls in its own tools, and is handed the files the work used most recently, what is still open and the names of the skills loaded before the move\. own's thinking stays behind\./);
      // Sent as it is: the handover holds what the card named, and nothing it did not.
      const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "two", stream: false, sendAsIs: true } });
      assert.equal(res.status, 200, await res.clone().text());
      const told = JSON.stringify(sent().at(-1)?.messages?.at(-1));
      assert.ok(told.includes("[Filament handed these over as this chat moved to you from own: the files the work used most recently, as they are on disk now, what is still open, and the skills loaded before the move."), told.slice(-2500));
    } finally {
      await stopShell(run.id, { session: id, agent: null });
    }
  });

  // (fails before: yes — the owner's of 11-09: a short chat's card offered a summary by the model that answered last;
  // picked, that model wrote it, and the compactor refused it after the call as leaving the chat no smaller — the tokens
  // spent, "Room was not made", and the card back)
  test("a switch offers the handoff only where its summary would leave the chat smaller: a short chat's offers none", async () => {
    /** @param {string} id @param {string} content @param {any} [more] */
    const ask = async (id, content, more = {}) => {
      const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: false, ...more } });
      return { status: res.status, body: await res.json() };
    };
    /** @param {string} id @param {string} name */
    const pick = async (id, name) => assert.equal((await shim.api(`${at(id)}/settings`, { method: "PATCH", body: { patch: { model: { name } } } })).status, 200);

    // Into a coding agent: the card asks for the form, and lists no summary first.
    const toAgent = await open("m-1");
    await say(toAgent, "one ~short ~cached");
    await pick(toAgent, "own/fake-a");
    const into = await ask(toAgent, "two");
    assert.equal(into.status, 409, JSON.stringify(into.body));
    assert.equal(into.body.switchQuestion.handoff, null, JSON.stringify(into.body.switchQuestion));
    assert.doesNotMatch(String(into.body.error), /can write a summary of it first/);
    // What it would have run: the model writes, and the compactor refuses what it wrote.
    const made = await shim.api(`${at(toAgent)}/compact`, { method: "POST", body: { method: "summary", once: { writer: "session" }, by: "last" } });
    assert.equal(made.status, 409, await made.clone().text());
    assert.match(String((await made.json()).error), /leaves the chat no smaller/);

    // Into the loop from another model: with no summary to offer there is nothing to choose, and nothing is asked.
    const loop = await open("m-1");
    await say(loop, "one ~short ~cached");
    await pick(loop, "m-2");
    const toM2 = await ask(loop, "two");
    assert.equal(toM2.status, 200, JSON.stringify(toM2.body));

    // From a coding agent whose context holds less than a summary would: its own summary is none to offer either.
    const agent = await open("own/fake-a");
    await say(agent, "one ~holds 300");
    await pick(agent, "m-1");
    const fromAgent = await ask(agent, "two");
    assert.equal(fromAgent.status, 200, JSON.stringify(fromAgent.body));
  });

  // (fails before: yes — the review of 11-03: the loop marked the list heard as its first request was written, so a
  // request the provider refused lost it; and a command's end said the whole list again)
  test("Filament's loop: a command that ended says nothing again; a change that went is said with the turn's first request — kept for the next turn where no reply came to it", async () => {
    const id = await open("m-1");
    await say(id, "one");
    await say(id, "two");
    const run = command(id);
    const done = await shim.api(`${at(id)}/compact`, { method: "POST", body: { method: "summary" } });
    assert.equal(done.status, 200, await done.clone().text());
    assert.deepEqual(heard(id), { keys: [`command:${run.id}`] });
    await stopShell(run.id, { session: id, agent: null });
    const mark = sent().length;
    await say(id, "three");
    const asked = JSON.stringify(sent()[mark]?.messages || []);
    assert.ok(asked.includes(`<open>\\n- background command ${run.id}`), "the summary's block, as it was written");
    assert.ok(!asked.includes("[Filament: A sub-agent's change") && !asked.includes("[Filament: You compacted"), "its end is told by itself");
    assert.equal(heard(id), undefined, "the turn followed it: nothing open, nothing kept");

    toldOfAChange(id);
    refuseNext = true;
    await send(id, "four");
    assert.ok(JSON.stringify(sent().at(-1)?.messages || []).includes(CHANGED_ALONE), "the refused request carried it");
    assert.deepEqual(heard(id), { keys: ["agent:sa_gone:waits"] }, "no reply came: nothing moved");
    const again = sent().length;
    const { notes } = await say(id, "five");
    assert.ok(JSON.stringify(sent()[again]?.messages || []).includes(CHANGED_ALONE));
    assert.ok(notes.includes("agent: what is still open changed since the agent was told — said with the turn's first request"), notes.join("\n"));
    assert.equal(heard(id), undefined);
  });

  // (fails before: yes — the owner's of 11-09: the card had no items, and nothing brought a dismissed line back)
  test("the Plan's card reads every item by its key, in its words without the id; its Undo drops a dismissal — 400 without a key, 404 for no chat", async () => {
    const id = await open("m-1");
    await say(id, "one");
    const run = command(id);
    const key = `command:${run.id}`;
    const open1 = (await json(at(id))).open;
    assert.deepEqual(open1.items.map((/** @type {any} */ i) => [i.key, i.dismissed]), [[key, false]]);
    assert.ok(open1.items[0].line.startsWith(`background command ${run.id}: `) && !open1.items[0].line.includes("[command:"), open1.items[0].line);
    assert.deepEqual(open1.lines, [`- ${open1.items[0].line}`], "the agent's list as before, without the ids");
    const archive = /** @type {any} */ (shim.app.memory).archive;
    archive.mergeMeta(id, { openDismissed: { [key]: "a mark" } });
    const undo = await shim.api(`${at(id)}/open/undismiss`, { method: "POST", body: { key } });
    assert.equal(undo.status, 200);
    assert.deepEqual(await undo.json(), { ok: true });
    assert.equal(archive.metaOf(id, ["openDismissed"])?.openDismissed, undefined, "dropped");
    assert.equal((await shim.api(`${at(id)}/open/undismiss`, { method: "POST", body: {} })).status, 400);
    assert.equal((await shim.api(`${at("c_none")}/open/undismiss`, { method: "POST", body: { key } })).status, 404);
    await stopShell(run.id, { session: id, agent: null });
  });

  // (fails before: yes — the gap of 11-11: with no compaction and no task ending, a sub-agent's change waited unapplied
  // an hour inside one long turn of the loop's, and no call's result named it)
  test("Filament's loop: a change that waits a long while in one turn — the next call's result says the list, once", async () => {
    const id = await open("m-1");
    await say(id, "one");
    const giveBack = waitingChange(id);
    try {
      const mark = sent().length;
      const { notes } = await say(id, "~longwait");
      /** The turn's calls' results a request carries, each its words, in order. @param {any} b */
      const resultsIn = (b) =>
        (b?.messages || [])
          .flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : []))
          .filter((/** @type {any} */ x) => x?.type === "tool_result" && String(x.tool_use_id).startsWith("lw_"))
          .map((/** @type {any} */ x) => (typeof x.content === "string" ? x.content : (x.content || []).map((/** @type {any} */ y) => y?.text || "").join("\n")));
      const asks = sent().slice(mark).filter((b) => JSON.stringify(b.messages || []).includes("~longwait"));
      const results = resultsIn(asks.find((b) => resultsIn(b).length === 3));
      assert.equal(results.length, 3, "three calls, then its answer");
      assert.ok(!results[0].includes(LONG_WAIT), "its first call: the turn had just begun");
      assert.ok(results[1].includes(LONG_WAIT) && results[1].includes(LONG_LINE), results[1].slice(0, 1500));
      assert.ok(!results[2].includes(LONG_WAIT), "said once");
      assert.ok(!JSON.stringify(asks[0].messages).includes(LONG_WAIT), "nothing at the turn's start: it was due nowhere");
      assert.ok(notes.includes("agent: what is still open, said on glob's result — a sub-agent's change waited long in the turn with nothing said of it"), notes.join("\n"));
      assert.deepEqual(heard(id), { keys: ["agent:sa_long:waits"] }, "the chat keeps it heard");
    } finally {
      giveBack();
      shift = 0;
    }
  });

  // (fails before: yes — the same gap, a coding agent's: nothing at its steps said what waited)
  test("Claude: a change that waits a long while in one turn — the list goes in at its next step, once", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    const giveBack = waitingChange(id);
    const gate = (/** @type {string} */ f) => writeFileSync(join(root, "qgate", f), "");
    for (const f of ["q1", "q2", "q3", "end"]) rmSync(join(root, "qgate", f), { force: true });
    try {
      const from = queued().length;
      const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "~queue3", stream: true, runEvents: true } });
      const runId = String(res.headers.get("x-filament-request-id"));
      const body = res.text();
      const events = async () => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events;
      await until(async () => (await events()).some((/** @type {any} */ e) => e.type === "tool-start" && e.id === "q1") || null, "its first step");
      assert.deepEqual(queued().slice(from), [], "its first step: the turn had just begun");
      shift = WAITS_LONG_MS;
      gate("q1");
      await until(() => queued().slice(from).some((w) => w.includes(LONG_WAIT)) || null, "the list, queued at Claude as its next step began");
      gate("q2");
      await until(async () => (await events()).some((/** @type {any} */ e) => e.type === "tool-start" && e.id === "q3") || null, "its third step");
      gate("q3");
      gate("end");
      await body;
      const said = queued().slice(from);
      assert.equal(said.length, 1, said.join("\n----\n"));
      assert.ok(said[0].startsWith(LONG_WAIT) && said[0].includes(LONG_LINE), said[0]);
      const rec = await until(async () => {
        const x = await shim.record(runId);
        return x?.acp?.run ? x : null;
      }, "the turn's record");
      const notes = [...(rec.changes || []), ...(rec.priorChanges || [])].map(String);
      assert.ok(notes.includes("acp: what is still open, said to own at its next step — a sub-agent's change waited long in its turn with nothing said of it"), notes.join("\n"));
      assert.deepEqual(heard(id), { keys: ["agent:sa_long:waits"] });
    } finally {
      for (const f of ["q1", "q2", "q3", "end"]) gate(f);
      giveBack();
      shift = 0;
    }
  });
});
