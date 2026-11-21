// @ts-check
// The Still open list, read again (the re-read of 11-11): a dropped, failed or done task's change that still waits is
// said at a done and again once turns went by without a word of it; the list a turn's start said is not said again by
// that turn's answers; every id a line ends with can be dismissed; the Plan's card shows the coding agent's own
// background tasks; a line said beside the graph is never cut inside words an agent wrote; a long wait is weighed in
// every running turn, from the turn's start where a change's own start is unknown; the dismiss words leave only the
// blocks Filament wrote; and a read of the folder that failed, or has not landed, neither brings a dismissed line back
// nor reads as nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DISMISS_WORDS, WAITS_AGAIN, WAITS_LONG_MS, alsoOpenWords, alsoRows, bodyWithDismiss, createStillOpen, moreOf, openList, openWords, withDismiss } from "../src/app/agent/still-open.js";
import { reattachBlock } from "../src/app/sessions/reattach.js";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const GB = 1024 ** 3;
const CHANGED_ALONE = "[Filament: A sub-agent's change you were told waits for you to apply it was applied or dropped since. Nothing else is still open now.]";

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

/** A failed task's change that still waits in its sub-agent's copy. */
const FAILED = /** @type {const} */ ({ kind: "ended", state: "failed", id: "sa_f", task: "t3", title: "lexer", files: 2, mark: "b3:h3" });

// (fails before: yes — the re-read of 11-11: a done's "Also still open" left out every key of the graph's, and the
// graph's own sub-agents: a dropped, failed or done task's change that still waits was said by neither the graph's
// words nor these)
test("a done says a dropped, failed or done task's change that still waits, though its sub-agent is the graph's own; a task's change ready for its apply stays the graph's to say", () => {
  const rows = openList({
    shells: [],
    agent: null,
    changes: [
      { kind: "graph", id: "sa_g", task: "t1", title: "ready", files: 2, mark: "b1:h1" },
      { kind: "dropped", id: "sa_d", task: "t2", title: "old idea", files: 1, mark: "b2:h2" },
      FAILED,
      { kind: "ended", state: "done", id: "sa_e", task: "t4", title: "docs", files: 1, mark: "b4:h4" },
    ],
    now: NOW,
  }).rows;
  // As graph-runner.js `alsoAfter` skips: every task's own sub-agent.
  const skip = new Set(["sa_g", "sa_d", "sa_f", "sa_e"]);
  assert.deepEqual(alsoRows(rows, skip).map((r) => r.key), ["graph:t2:dropped", "graph:t3:failed", "graph:t4:done"]);
  assert.equal(
    alsoOpenWords(rows, { skip }),
    'Also still open, beside your graph: task t2 of your task graph ("old idea"), dropped: 1 file of sub-agent sa_d\'s change still waits in its copy; task t3 of your task graph ("lexer"), failed: 2 files of sub-agent sa_f\'s change still wait in its copy; task t4 of your task graph ("docs"), done: 1 file of sub-agent sa_e\'s change still waits in its copy.',
  );
});

// (fails before: yes — the same re-read: only a sub-agent's own change counted the turns it went unsaid)
test(`a failed task's change that still waits, unsaid for ${WAITS_AGAIN} turns, is said again at the next turn's start; said, the count starts over`, () => {
  const so = createStillOpen({ archive: (() => { const a = archiveOf(); return () => a; })(), changes: () => [FAILED], now: () => NOW });
  // The first end found it new: its task's end had just said it. Then WAITS_AGAIN turns without a word.
  for (let i = 0; i < WAITS_AGAIN; i++) {
    so.ended("c1", false);
    assert.equal(so.due("c1"), null, `turn ${i + 1}`);
  }
  so.ended("c1", false);
  const d = so.due("c1");
  assert.equal(d?.why, "waits");
  assert.ok(String(d?.text).includes("- task t3 of your task graph (\"lexer\"), failed: 2 files of sub-agent sa_f's change still wait in its copy"), d?.text);
  so.ended("c1", true);
  assert.equal(so.due("c1"), null, "said: the count starts over");
});

// (fails before: yes — the same re-read: a failed task's change the person applied while no turn ran went without a
// word to the agent that was told it waits)
test("a failed task's change the agent was told waits, applied while no turn ran: the next turn's start says it went — never where its task is at work on it again, or where the chat kept no word of whose it was", () => {
  const archive = archiveOf();
  /** @type {Record<string, any>} */
  const subs = { sa_f: { chainId: "c1", status: "failed", endedAt: NOW - MIN, work: { pending: 2, sig: "b3:h3" } } };
  /** @type {any[]} */
  let changes = [FAILED];
  const so = createStillOpen({ registry: { openWork: () => [], get: (id) => subs[id] || null }, archive: () => archive, changes: () => changes, now: () => NOW });
  so.heard("c1", so.keys("c1"));
  const kept = structuredClone(archive.metas.get("c1")?.openHeard);
  assert.equal(so.due("c1"), null, "it stands as it heard it");
  // Its task was sent back to it: the graph's own again, no line of the list — and no change applied or dropped.
  changes = [];
  subs.sa_f = { ...subs.sa_f, status: "running" };
  assert.equal(so.due("c1"), null, "at work on it again");
  subs.sa_f = { ...subs.sa_f, status: "done" };
  assert.equal(so.due("c1"), null, "its work still waits, under another line or none: nothing went");
  // The person applied it in Changes.
  subs.sa_f = { ...subs.sa_f, work: { pending: 0, sig: "b3:h3" } };
  assert.deepEqual(so.due("c1"), { text: CHANGED_ALONE, keys: [], why: "changed" });
  assert.deepEqual(kept, { keys: ["graph:t3:failed"], whose: { "graph:t3:failed": "sa_f" } }, "by the sub-agent the chat kept with the key as it was heard");
  so.ended("c1", true);
  assert.equal(so.due("c1"), null, "said once");
  // A record from before the chat kept whose change a task's key named: nothing tells why it went, so nothing is said.
  archive.mergeMeta("c1", { openHeard: { keys: ["graph:t3:failed"] } });
  assert.equal(so.due("c1"), null);
});

// (fails before: yes — the re-read of 11-11: the turn whose start said the list whole counted its rest again at its
// first done, which owed the next start the whole list again, turn after turn)
test("the list a turn's start said is said: a done of that turn names none of it again and owes the next start nothing; what came since is named as new", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  /** @param {string} x @param {number} i */
  const tryOf = (x, i) => ({ kind: /** @type {const} */ ("try"), task: `t${i + 1}`, description: `try ${x}`, id: `sa_${x}`, files: 1, mark: "b:h", since: NOW - MIN });
  let changes = ids.map(tryOf);
  const archive = archiveOf();
  const so = createStillOpen({ archive: () => archive, changes: () => changes, now: () => NOW });
  // Turn 1: its done names three and counts three, which it says the next start names.
  so.begin("c1");
  assert.match(so.also("c1", new Set(), new Set()), /; and 3 more, which Still open names at your next turn's start\.$/);
  so.ended("c1", false);
  so.over("c1");
  // Turn 2: its start says the list whole, and the list reached the agent.
  const start = so.due("c1");
  assert.equal(start?.why, "more");
  so.begin("c1");
  so.startSaid("c1", start?.keys || []);
  // The runner's set of what the turn's answers said, emptied as the turn began (graph-runner.js `alsoSaid`).
  /** @type {Set<string>} */
  const said = new Set();
  assert.equal(so.also("c1", new Set(), said), "", "each of them said at the turn's start: nothing again");
  changes = [...changes, tryOf("g", 6)];
  assert.equal(so.also("c1", new Set(), said), 'Also still open, beside your graph: sub-agent sa_g ("try g"), an earlier try at task t7 of your task graph: 1 file of its change still waits in its copy (for 1 min) (new); 6 as said before.');
  so.ended("c1", true);
  so.over("c1");
  assert.equal(so.due("c1"), null, "nothing counted and never named: the next start says no list");
  // Turn 3, whose start said nothing: a done says what is open, as before.
  so.begin("c1");
  assert.match(so.also("c1", new Set(), new Set()), /^Also still open, beside your graph: sub-agent sa_a .*; and 4 more, which Still open names at your next turn's start\.$/);
});

// (fails before: yes — the re-read of 11-11: a line of the coding agent's own background task ends with [task:<id>] or
// [theirs:<id>], and dismiss answered that nothing open goes by it)
test("a coding agent's own background task is dismissed by the id its line ends with — as the session that runs it hears it, or another reader — and stays dismissed for both until it ends or the person undoes it", () => {
  const archive = archiveOf();
  /** @type {import("../src/app/agent/still-open.js").OwnTask[]} */
  let running = [{ id: "bt-1", kind: "local_bash", description: "npm run dev", since: NOW - MIN, background: true }];
  const so = createStillOpen({
    archive: () => archive,
    // As server.js wires them: the tasks of the session that runs them, and to any other reader whose they are.
    tasks: (_chain, session) => (session === "s1" ? running : []),
    theirs: (_chain, session) => (session === "s1" || !running.length ? null : { who: "Claude Code", tasks: running }),
    now: () => NOW,
  });
  /** The lines the session that runs it is told (acp-turn.js), and those any other reader is (the loop: turn.js). */
  const own = () => so.of("c1", null, { workers: false, agentSession: "s1", others: true }).lines;
  const other = () => so.of("c1", null, { others: true }).lines;
  assert.match(own()[0], /^- your own background shell bt-1 \("npm run dev"\): running for 1 min — .* \[task:bt-1\]$/);
  assert.match(other()[0], /^- background shell bt-1 \("npm run dev"\) in Claude Code's session of this chat, not yours: .* \[theirs:bt-1\]$/);
  assert.deepEqual(so.dismiss("c1", ["[task:bt-1]"]), { dismissed: ["task:bt-1"], unknown: [], waits: [] });
  assert.deepEqual([own(), other()], [[], []], "the same task under its other name: dismissed for both");
  so.ended("c1", false);
  assert.deepEqual([own(), other()], [[], []], "a turn's end keeps the dismissal while the task runs");
  assert.deepEqual(so.shown("c1").items.map((i) => [i.key, i.dismissed]), [["theirs:bt-1", true]], "on the card, dimmed");
  // The person's Undo on the card brings it back for both.
  assert.equal(so.undismiss("c1", "theirs:bt-1"), true);
  assert.deepEqual([own().length, other().length], [1, 1]);
  // By the id another reader's line ends with; and once the task ended, nothing is kept of it.
  assert.deepEqual(so.dismiss("c1", ["theirs:bt-1", "task:bt-9"]), { dismissed: ["theirs:bt-1"], unknown: ["task:bt-9"], waits: [] });
  assert.deepEqual([own(), other()], [[], []]);
  running = [];
  so.ended("c1", false);
  assert.equal(archive.metas.get("c1")?.openDismissed, undefined, "its task ended: nothing kept");
});

// (fails before: yes — the re-read of 11-11: the card read the list with no tasks of the agent's own)
test("the Plan's card shows the coding agent's own background tasks, running in its session", () => {
  const archive = archiveOf();
  const running = [
    { id: "bt-1", kind: "local_bash", description: "npm run dev", since: NOW - 2 * MIN, background: true },
    { id: "bt-2", kind: "local_agent", description: "", since: NOW - MIN, background: true },
  ];
  const so = createStillOpen({ archive: () => archive, tasks: (_c, s) => (s === "s1" ? running : []), theirs: (_c, s) => (s === "s1" ? null : { who: "Claude Code", tasks: running }), now: () => NOW });
  assert.deepEqual(
    so.shown("c1").items.map((i) => [i.key, i.view.group, i.view.title, i.view.detail]),
    [
      ["theirs:bt-1", "running", "npm run dev", "In Claude Code's session of this chat, running 2 min"],
      ["theirs:bt-2", "running", "Background agent bt-2", "In Claude Code's session of this chat, running 1 min"],
    ],
  );
  assert.deepEqual(so.keys("c1"), [], "the chat's record of what its agent heard still leaves them out");
});

// (fails before: yes — the re-read of 11-11: a line said beside the graph was cut at the first " — " of its composed
// text, which a letter's subject, a sub-agent's description or a command can hold)
test("a line said beside the graph is whole up to its instructions, whatever dashes the words an agent wrote hold", () => {
  const o = openList({
    shells: /** @type {any} */ ([{ id: "bc_1", command: 'git commit -m "lexer — second pass"', cwd: "/p", agent: null, startedAt: NOW - 2 * MIN }]),
    agent: null,
    agents: [{ id: "sa_1", description: "parser — second pass", running: false, files: 0, failed: "exit 1 — see the log" }],
    tasks: [{ id: "bt-1", kind: "local_bash", description: "watch — rebuild", since: NOW - MIN }],
    letters: [{ id: "lt_1", subject: "Ship it — or wait?", from: 'the chat "Fable" (aco2a1bn)', at: NOW - MIN }],
    now: NOW,
  });
  assert.equal(
    alsoOpenWords(o.rows.filter((r) => !r.key.startsWith("task:"))),
    'Also still open, beside your graph: sub-agent sa_1 ("parser — second pass"): failed; letter lt_1, "Ship it — or wait?", from the chat "Fable" (aco2a1bn), 1 min ago: it waits for your reply; background command bc_1: `git commit -m "lexer — second pass"` in /p, running for 2 min.',
  );
  assert.equal(alsoOpenWords(o.rows.filter((r) => r.key.startsWith("task:"))), 'Also still open, beside your graph: your own background shell bt-1 ("watch — rebuild"): running for 1 min.');
  // The list's own lines are as they were: each whole, its instructions after its dash.
  assert.equal(o.lines[1], '- your own background shell bt-1 ("watch — rebuild"): running for 1 min — yours to read and to stop, with your own tools [task:bt-1]');
  assert.equal(o.lines[2], '- sub-agent sa_1 ("parser — second pass"): failed — exit 1 — see the log; follow it up to try again, or leave it [agent:sa_1:failed]');
  assert.equal(o.lines[3], '- letter lt_1, "Ship it — or wait?", from the chat "Fable" (aco2a1bn), 1 min ago: it waits for your reply — send it with Filament\'s envelope tool (answer: "lt_1"), or leave it [letter:lt_1]');
});

/** A chat's list over a registry of sub-agents whose work waits: each one's exchange's end by its id, none where unknown. */
const waitRig = () => {
  const archive = archiveOf();
  const rig = {
    clock: NOW,
    /** @type {import("../src/app/agent/still-open.js").OpenAgent[]} */
    agents: [],
    /** @type {Record<string, number | null>} */
    ended: {},
  };
  const registry = {
    openWork: (/** @type {string} */ chain) => (chain === "c1" ? rig.agents : []),
    get: (/** @type {string} */ id) => (Object.hasOwn(rig.ended, id) ? { chainId: "c1", status: rig.ended[id] ? "done" : "aborted", endedAt: rig.ended[id], work: { pending: 1, sig: "b:h" } } : null),
  };
  return { rig, open: createStillOpen({ registry, archive: () => archive, now: () => rig.clock }) };
};

// (fails before: yes — the re-read of 11-11: past 200 chats' turns begun, the oldest turn's entry went, though it ran
// on, and nothing weighed its long wait again; and an entry stayed after its turn ended)
test("a long wait is weighed in every running turn, however many chats began one since; a turn's end lets go of it", () => {
  const { rig, open } = waitRig();
  rig.agents = [{ id: "sa_2", description: "add export", running: false, files: 2 }];
  rig.ended.sa_2 = NOW - 60 * MIN;
  open.begin("c1");
  for (let i = 0; i < 250; i++) open.begin(`other-${i}`);
  rig.clock = NOW + WAITS_LONG_MS;
  assert.deepEqual(open.waited("c1")?.waits, ["agent:sa_2:waits"], "the turn still runs: weighed");
  open.over("c1");
  assert.equal(open.waited("c1"), null, "its turn ended: nothing weighed");
});

// (fails before: yes — the re-read of 11-11: a change whose wait's start is unknown — a sub-agent kept over a restart,
// its exchange never ended — was counted from the first call past 20 minutes that saw it, so said at 40)
test("a change whose wait's start is unknown waits from its turn's start: said once the turn ran WAITS_LONG_MS", () => {
  const { rig, open } = waitRig();
  rig.agents = [{ id: "sa_k", description: "kept over a restart", running: false, files: 1 }];
  rig.ended.sa_k = null;
  open.begin("c1");
  rig.clock = NOW + WAITS_LONG_MS - 1_000;
  assert.equal(open.waited("c1"), null);
  rig.clock = NOW + WAITS_LONG_MS;
  assert.deepEqual(open.waited("c1")?.waits, ["agent:sa_k:waits"]);
});

// (fails before: yes — the re-read of 11-11: the words were taken out of every message of the request — the person's
// own, the agent's replies, a file a block brought back)
test("the dismiss words leave only the lead of a block Filament wrote: the person's words, the agent's and what a block brought back stand as they are", () => {
  const quoted = `Your block said "Go through it now: apply a change that waits or leave it${DISMISS_WORDS}." Why is that said to an agent with no envelope tool?`;
  const open = ["- background command bc_1: `npm test` in /p, running for 2 min [command:bc_1]"];
  /** @param {boolean} dismiss */
  const block = (dismiss) => reattachBlock({ files: [], plan: null, root: "/p", rules: [], redact: null, window: 200_000, open, reply: { text: quoted, turn: 3 }, dismiss }).text;
  assert.ok(block(true).startsWith("[Filament brought these back after the summary: ") && block(true).split("\n")[0].includes(DISMISS_WORDS) && block(true).includes(quoted), block(true));
  /** @type {{ messages: any[] }} */
  const body = {
    messages: [
      { role: "user", content: [{ type: "text", text: "SUMMARY" }, { type: "text", text: block(true) }] },
      { role: "user", content: quoted },
      { role: "assistant", content: [{ type: "text", text: quoted }] },
      { role: "user", content: [{ type: "text", text: openWords(open, "lost") }, { type: "text", text: quoted }] },
    ],
  };
  const told = bodyWithDismiss(body, false);
  assert.equal(told.messages[0].content[1].text, block(false), "Filament's block: as written for a reader without the tool, what it brought back whole");
  assert.equal(told.messages[3].content[0].text, openWords(open, "lost", true, false), "the list said again: its lead without the ask");
  assert.equal(told.messages[1], body.messages[1], "the person's message, as typed");
  assert.equal(told.messages[2], body.messages[2], "the agent's reply");
  assert.equal(told.messages[3].content[1], body.messages[3].content[1], "the person's words beside a block");
  assert.equal(bodyWithDismiss(body, true), body, "a reader with the tool: the same body");
  assert.equal(withDismiss(quoted, false), quoted);
  assert.equal(withDismiss(block(true), false), block(false));
});

// (fails before: yes — the re-read of 11-11: the copies' mark said "?" for a size not measured, so a dismissed line came
// back the moment Space › places measured it, and again after a restart forgot the measure)
test("Filament's copies, dismissed, stay dismissed as their size becomes known or unknown; one more, or grown twice as big, brings the line back", async () => {
  const archive = archiveOf();
  /** @type {import("../src/app/agent/still-open.js").CopiesOnDisk[]} */
  let copies = [{ repo: "/r", count: 4, bytes: null }];
  const so = createStillOpen({ archive: () => archive, more: async () => ({ copies }), now: () => NOW });
  /** The folder read anew, as after a Clean up. @param {import("../src/app/agent/still-open.js").CopiesOnDisk[]} now */
  const read = async (now) => {
    copies = now;
    so.moved();
    await so.refresh("c1");
  };
  await so.refresh("c1");
  assert.deepEqual(so.dismiss("c1", ["copies:/r"]).dismissed, ["copies:/r"]);
  assert.deepEqual(so.keys("c1"), []);
  await read([{ repo: "/r", count: 4, bytes: 3 * GB }]);
  assert.deepEqual(so.keys("c1"), [], "measured since: the same copies");
  so.ended("c1", false);
  await read([{ repo: "/r", count: 4, bytes: null }]);
  assert.deepEqual(so.keys("c1"), [], "not measured after a restart: the same copies");
  so.ended("c1", false);
  await read([{ repo: "/r", count: 4, bytes: 7 * GB }]);
  assert.deepEqual(so.keys("c1"), ["copies:/r"], "grown twice as big since it was measured: back");
  so.dismiss("c1", ["copies:/r"]);
  await read([{ repo: "/r", count: 5, bytes: null }]);
  assert.deepEqual(so.keys("c1"), ["copies:/r"], "one more: back");
});

// (fails before: yes — the re-read of 11-11: a read that failed came back as a folder that holds nothing, so a turn's
// end let go of each dismissal of what it holds, and the next good read said those lines again)
test("a read of the folder that could not read a part lets go of no dismissal of that part; one that read it and found nothing does", async () => {
  const archive = archiveOf();
  const held = { worktrees: [{ path: "/r-old", branch: "old", into: "main", head: "w1", age: null }], copies: [{ repo: "/r", count: 4, bytes: 3 * GB }] };
  /** @type {import("../src/app/agent/still-open.js").OpenMore} */
  let more = held;
  const so = createStillOpen({ archive: () => archive, more: async () => more, now: () => NOW });
  /** @param {import("../src/app/agent/still-open.js").OpenMore} now */
  const read = async (now) => {
    more = now;
    so.moved();
    await so.refresh("c1");
  };
  await so.refresh("c1");
  so.dismiss("c1", ["worktree:/r-old", "copies:/r"]);
  assert.deepEqual(so.keys("c1"), []);
  // git would not read the worktrees; the copies' read found none.
  await read({ worktrees: [], copies: [], unread: ["worktrees"] });
  so.ended("c1", false);
  await read(held);
  assert.deepEqual(so.keys("c1"), ["copies:/r"], "the worktree's dismissal stands; the copies went and came back, a new line");
  // What a repository's read could not read reaches the chat's list (`moreOf`).
  assert.deepEqual((await moreOf({ chain: "c1", folder: "/r", subs: [], holds: { unread: ["copies", "forks"] } })).unread, ["copies", "forks"]);
  assert.equal((await moreOf({ chain: "c1", folder: "/r", subs: [], holds: {} })).unread, undefined);
});

// (fails before: yes — the re-read of 11-11: the first look at a chat after a start had none of its folder's rows and
// no word that they were being read, so the card said nothing was left behind for half a minute)
test("a chat's folder not read yet says it is being read until its first read lands; a read that failed is none under way", async () => {
  const archive = archiveOf();
  /** @type {(() => void) | null} */
  let release = null;
  const so = createStillOpen({ archive: () => archive, more: () => new Promise((r) => (release = () => r({ worktrees: [{ path: "/r-old", branch: "old", into: "main", head: "w1", age: null }] }))), now: () => NOW });
  assert.deepEqual(so.shown("c1").items, [], "the card's first look has none of the folder's rows, and asks for the read");
  assert.equal(so.reading("c1"), true, "on its way");
  assert.equal(so.stale("c1"), false, "nothing moved: no look waits for it");
  const landed = so.refresh("c1");
  while (!release) await new Promise((r) => setImmediate(r));
  /** @type {any} */ (release)();
  await landed;
  assert.equal(so.reading("c1"), false);
  assert.deepEqual(so.shown("c1").items.map((i) => i.key), ["worktree:/r-old"]);
  assert.equal(createStillOpen({ archive: () => archive, now: () => NOW }).reading("c1"), false, "no reads of the folder wired: none on its way");
  const failing = createStillOpen({ archive: () => archive, more: async () => { throw new Error("git: index.lock exists"); }, now: () => NOW });
  await failing.refresh("c1");
  assert.equal(failing.reading("c1"), false, "it failed: nothing is on its way");
});

// (fails before: yes — the re-read of 11-11: the card said the agent compacted its context where Filament had)
test("the card is told which compaction left the list unsaid: the agent's own, or Filament's", () => {
  const archive = archiveOf();
  const so = createStillOpen({ archive: () => archive, changes: () => [FAILED], now: () => NOW });
  so.folded("c1");
  assert.deepEqual([so.shown("c1").told, so.shown("c1").folded], [false, true], "Filament's");
  so.ended("c1", true);
  assert.deepEqual([so.shown("c1").told, so.shown("c1").folded], [true, undefined]);
  so.lost("c1");
  assert.deepEqual([so.shown("c1").told, so.shown("c1").folded], [false, undefined], "the agent's own");
});
