// @ts-check
// A chat's work stretch (the owner's of 11-03: "it says 1h even though you have been running for more than 30 hours … if
// you have any background command running and you end your turn, it should not reset the time but accumulate that time.
// Also keep the thread in the Working region of the left bar … if a background command is running"): it begins with a
// turn begun while nothing of the chat's was open, and goes on through every turn that ended while something whose end
// wakes its agent was — a command, a sub-agent working for its main agent (a graph's tasks too), its coding agent's own
// background task, a team beside it that notifies it — and the turn what it waited on woke. An end that wakes nobody
// ends it: the person's Stop, a restart's word, a refused wake. Now's row counts its age from the stretch's start, and
// between its turns keeps the chat under Working, saying what keeps it as the server counts it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStretches } from "../src/app/sessions/stretch.js";
import { createWaker, WAKE_LINE } from "../src/app/sessions/wake.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import * as nowLib from "../src/ui/harness/lib/now.js";
import { createNow } from "../src/ui/harness/now-list.js";
import * as trayCard from "../src/ui/tray-card.js";
import { disposeBackgroundShells, peekShellExits, runningShellsOf, wakeDue } from "../src/adapters/tools/hands.js";
import { fakeH, fakeDrawIn, textOf } from "./helpers/fake-dom.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

after(() => disposeBackgroundShells());

const FAKE_ACP = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");

/** A chat's meta as the archive keeps it, in memory, its writes counted. */
const memoryArchive = () => {
  /** @type {Map<string, Record<string, any>>} */
  const meta = new Map();
  const counts = { writes: 0 };
  return {
    meta,
    counts,
    archive: {
      /** @param {string} c @param {readonly string[]} keys */
      metaOf: (c, keys) => Object.fromEntries(keys.filter((k) => meta.get(c)?.[k] !== undefined).map((k) => [k, meta.get(c)?.[k]])),
      /** @param {string} c @param {Record<string, any>} patch */
      mergeMeta: (c, patch) => {
        counts.writes++;
        const m = { ...(meta.get(c) || {}) };
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) delete m[k];
          else m[k] = v;
        }
        meta.set(c, m);
      },
    },
  };
};
/** What keeps a stretch, as a test sets it. @param {Partial<import("../src/app/sessions/stretch.js").Waits>} [w] */
const W = (w = {}) => ({ commands: 0, agents: 0, tasks: 0, teams: 0, checks: 0, coming: false, ...w });

describe("the stretch, kept with the chat (sessions/stretch.js)", () => {
  // (fails before: yes — nothing kept a stretch: each turn's row counted from its own start)
  test("begun by a turn begun with nothing open; past the turn that ended with a command running, said with what keeps it; on with the turn its end woke; over with the turn that left nothing", () => {
    let t = 1_000;
    let w = W();
    /** @type {[string, number | null, any][]} */
    const heard = [];
    const { meta, archive } = memoryArchive();
    const s = createStretches({ archive: () => archive, waits: () => w, moved: (c, since, waits) => void heard.push([c, since, waits ?? null]), now: () => t });
    assert.equal(s.began("c1"), 1_000);
    w = W({ commands: 1 });
    t = 5_000;
    s.ended("c1");
    assert.deepEqual(s.going(() => false), [{ chainId: "c1", since: 1_000, waits: { commands: 1, agents: 0, tasks: 0, teams: 0, checks: 0 } }], "between its turns, while its command runs");
    assert.equal(meta.get("c1")?.workSince, 1_000, "kept with the chat while it outlasts its turn");
    w = W({ coming: true });
    assert.equal(s.going(() => false).length, 1, "its end on its way to wake the agent keeps it");
    t = 9_000;
    assert.equal(s.began("c1", { woken: true }), 1_000, "the turn its end woke goes on with it");
    w = W();
    assert.deepEqual(s.going((c) => c === "c1"), [{ chainId: "c1", since: 1_000 }], "while that turn runs");
    s.ended("c1");
    assert.equal(meta.get("c1")?.workSince, undefined, "its end leaves nothing kept");
    assert.deepEqual(s.going(() => false), []);
    t = 12_000;
    assert.equal(s.began("c1"), 12_000, "the next turn begins anew");
    assert.deepEqual(heard, [["c1", 1_000, null], ["c1", 1_000, { commands: 1, agents: 0, tasks: 0, teams: 0, checks: 0 }], ["c1", 1_000, null], ["c1", null, null], ["c1", 12_000, null]]);
  });

  // (fails before: yes — the review of 11-03: two full meta rewrites per turn, every chat)
  test("the chat's meta is written only as a stretch outlasts its turn — once — and let go of only where it was kept", () => {
    let w = W();
    const { counts, archive } = memoryArchive();
    const s = createStretches({ archive: () => archive, waits: () => w, now: () => 1_000 });
    s.began("c1");
    s.ended("c1");
    assert.equal(counts.writes, 0, "a turn that begins and ends with nothing open writes nothing");
    s.began("c1");
    w = W({ agents: 1 });
    s.ended("c1");
    s.began("c1");
    s.ended("c1");
    assert.equal(counts.writes, 1, "outlasting two turns: written once");
    w = W();
    s.settle("c1");
    assert.equal(counts.writes, 2, "its end lets go of it");
  });

  // (fails before: yes)
  test("the person's turn goes on with it while something keeps it, and begins anew where nothing does, letting go of what the meta kept", () => {
    let t = 1_000;
    let w = W({ commands: 1 });
    const { meta, archive } = memoryArchive();
    const s = createStretches({ archive: () => archive, waits: () => w, now: () => t });
    s.began("c1");
    s.ended("c1");
    t = 2_000;
    assert.equal(s.began("c1"), 1_000, "a command still runs: the person's turn goes on with it");
    s.ended("c1");
    w = W();
    t = 3_000;
    assert.equal(s.began("c1"), 3_000, "its end came and woke nobody: theirs begins anew");
    assert.equal(meta.get("c1")?.workSince, undefined, "the old start let go of");
  });

  // (fails before: yes)
  test("kept across a restart: the turn that goes on with a cut one goes on with it; one begun with nothing keeping it begins anew", () => {
    const { meta, archive } = memoryArchive();
    const first = createStretches({ archive: () => archive, waits: () => W({ commands: 1 }), now: () => 1_000 });
    first.began("c1");
    first.ended("c1");
    first.began("c1", { woken: true });
    const again = createStretches({ archive: () => archive, waits: () => W(), now: () => 50_000 });
    assert.deepEqual(again.going(() => false), [], "nothing of it open after the restart");
    assert.equal(again.began("c1", { woken: true }), 1_000, "the cut turn going on");
    const third = createStretches({ archive: () => archive, waits: () => W(), now: () => 90_000 });
    assert.equal(third.began("c1"), 90_000, "the person's turn, nothing keeping it");
    assert.equal(meta.get("c1")?.workSince, undefined);
  });

  // (fails before: yes — the review of 11-03: the read dropped a stretch from memory, its start left in the meta and no
  // end said; a later turn its agent began by itself inherited it)
  test("between turns, a stretch nothing keeps any more ends — at the read or as something of it ends —: the meta let go of, its end said", () => {
    let w = W({ commands: 1 });
    /** @type {(number | null)[]} */
    const heard = [];
    const { meta, archive } = memoryArchive();
    const s = createStretches({ archive: () => archive, waits: () => w, moved: (_c, since) => void heard.push(since), now: () => 1_000 });
    s.began("c1");
    s.ended("c1");
    s.began("c2");
    s.ended("c2");
    s.settle("c1");
    assert.equal(heard.length, 4, "something keeps it: settled, it goes on");
    w = W();
    s.settle("c1");
    assert.deepEqual([heard.at(-1), meta.get("c1")?.workSince], [null, undefined], "the person stopped its command: over");
    assert.deepEqual(s.going(() => false), [], "the read finds the other over too");
    assert.deepEqual([heard.at(-1), meta.get("c2")?.workSince], [null, undefined]);
    assert.equal(s.began("c1", { woken: true }), 1_000, "a turn its agent began by itself begins anew");
  });
});

describe("what keeps a stretch, counted where it is", () => {
  // (fails before: yes — the waker let go of a chat without a word: the stretch it kept went on with nothing to end it)
  test("the waker says each chat it lets go of with no turn sent, and whether a wake is on its way", async () => {
    /** @type {string[]} */
    const idle = [];
    /** @type {{ status: number, body: any }} */
    let answer = { status: 409, body: { wake: "stopped", error: "the chat was stopped" } };
    let due = true;
    let attended = false;
    const waker = createWaker({ post: async () => answer, due: () => due, attended: () => attended, idle: (s) => void idle.push(s), settleMs: 0, retryMs: 0, tries: 2 });
    waker.wake("a");
    assert.equal(waker.coming("a"), true, "on its way");
    await until(() => !waker.coming("a"), "the wake's end");
    assert.deepEqual(idle, ["a"], "refused: let go of");
    answer = { status: 200, body: null };
    waker.wake("b");
    await until(() => !waker.coming("b"), "the wake's end");
    assert.deepEqual(idle, ["a"], "a turn sent: nothing said");
    due = false;
    waker.wake("c");
    await until(() => !waker.coming("c"), "the wake's end");
    due = true;
    attended = true;
    waker.wake("d");
    await until(() => !waker.coming("d"), "the wake's end");
    answer = { status: 409, body: { wake: "held" } };
    attended = false;
    waker.wake("e");
    await until(() => !waker.coming("e"), "the wake's end");
    assert.deepEqual(idle, ["a", "c", "d", "e"], "nothing due, a turn there to hear it, a turn that held it throughout");
  });

  // (fails before: yes — the review of 11-03: a graph task's end wakes the chat, and `openWork` leaves graph tasks out)
  test("the registry's working sub-agents whose end comes to the main agent: one it reports to, a graph's task — not the person's own kept aside", async () => {
    /** @type {(() => void)[]} */
    const gates = [];
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
        loadThreads: () => [],
      },
      call: async ({ headers = {} }) => {
        const id = headers["x-filament-subagent"];
        registry.attach(id, `run-${id}`);
        await new Promise((r) => gates.push(() => r(undefined)));
        registry.finish(id, { status: "done", error: null, report: "done", convo: null, rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [] });
        return { ok: true, status: 200, json: { content: [{ type: "text", text: "done" }] }, id: `run-${id}`, upstream: "m", retryAfter: null, shouldRetry: null };
      },
    });
    const told = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "look", description: "Told", may: "read" }));
    const aside = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "look too", description: "Aside", may: "read", deliver: false }));
    const task = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "build it", description: "Task", may: "read", task: { id: "t1", review: false } }));
    assert.ok(told.ok && aside.ok && task.ok, String(told.error || aside.error || task.error || ""));
    try {
      await until(() => gates.length === 3, "all three to run");
      assert.equal(registry.wakingWork("c1"), 2, "the one it reports to and the graph's task");
      assert.deepEqual(registry.openWork("c1").map((a) => a.id), [told.id], "the still-open list leaves the graph's task to its graph");
      assert.equal(registry.wakingWork("c2"), 0, "another chat's are not this one's");
    } finally {
      for (const go of gates) go();
      await Promise.all([told.done, aside.done, task.done]);
    }
    assert.equal(registry.wakingWork("c1"), 0, "done: none");
  });
});

describe("Now: the chat's row through its stretch", () => {
  const NOW = 1_800_000_000_000;
  const SINCE = NOW - 31 * 3_600_000;
  /** The chat's newest turn as the runs list says it. @param {Record<string, any>} [over] */
  const run = (over = {}) => ({ id: "r2", kind: "coding-agent", status: "running", startedAt: NOW - 3_600_000, endedAt: null, parentId: null, events: 1, meta: { chain: "c1", model: "opus" }, ...over });
  const ended = run({ status: "done", endedAt: NOW - 60_000 });
  /** @param {string} id @param {string} command */
  const cmd = (id, command) => ({ id, command, cwd: "C:\\work", startedAt: NOW - 120_000, agent: null, line: "", logPath: null });
  /** An agent at work for the chat: the main agent's, or the person's own. @param {string} id @param {string} [origin] */
  const helper = (id, origin = "agent") => ({ id, origin, status: "running", card: { name: "Builder" }, description: `Job ${id}`, exchanges: [{ description: `Job ${id}`, startedAt: NOW - 600_000, endedAt: null }], startedAt: NOW - 600_000, progress: {} });
  /** A stretch as the server says it. @param {Partial<{ commands: number, agents: number, tasks: number, teams: number, checks: number }>} [w] */
  const stretch = (w) => new Map([["c1", { since: SINCE, waits: w ? { commands: 0, agents: 0, tasks: 0, teams: 0, ...w } : null }]]);
  /** @param {Partial<Parameters<typeof nowLib.nowRows>[0]>} o */
  const rows = (o) => nowLib.nowRows({ runs: [], folds: new Map(), threads: new Map(), chats: () => ({ title: "filament_main", project: "webshop", when: NOW - 60_000, unread: false }), unread: new Set(), holders: new Map(), now: NOW, ...o });

  // (fails before: yes — the owner's screenshot: "filament_main … 1h", its stretch thirty hours old)
  test("a turn's row counts from its stretch's start, as another window's turn's does; none, from its own", () => {
    assert.equal(rows({ runs: [run()], stretches: stretch() }).works[0].at, SINCE);
    assert.equal(rows({ runs: [run()] }).works[0].at, NOW - 3_600_000, "no stretch: from its turn's start");
    assert.equal(rows({ holders: new Map([["c1", { label: "VS Code", since: NOW - 5_000 }]]), stretches: stretch() }).works[0].at, SINCE);
  });

  // (fails before: yes — its row read "finished · 1 command running: …", its age from the command's start, and counted
  // the person's own agents and the teams beside it as what its agent waited for)
  test("between its turns: under Working, what keeps it as the server counts it in place of its end, its age from the stretch's start", () => {
    const one = rows({ runs: [ended], unread: new Set(["c1"]), commands: new Map([["c1", [cmd("bg_1", "npm run build")]]]), stretches: stretch({ commands: 1 }) });
    assert.deepEqual(one.done, [], "it has not finished");
    assert.deepEqual([one.works[0].fact, one.works[0].at, one.works[0].icon], ["waiting for 1 command: npm run build", SINCE, "terminal"]);
    const yours = rows({ runs: [ended], threads: new Map([["c1", [helper("y1", "owner")]]]), commands: new Map([["c1", [cmd("bg_1", "npm run build"), cmd("bg_2", "npm test")]]]), stretches: stretch({ commands: 2 }) });
    assert.deepEqual([yours.works[0].fact, yours.works[0].under.map((u) => u.thread)], ["waiting for 2 commands", ["y1"]], "the person's own agent is a line under it, and nothing its agent waits for");
    const all = rows({ runs: [ended], threads: new Map([["c1", [helper("h1"), helper("h2")]]]), commands: new Map([["c1", [cmd("bg_1", "npm run build")]]]), stretches: stretch({ agents: 2, teams: 1, tasks: 1, commands: 1 }) });
    assert.equal(all.works[0].fact, "waiting for 2 agents, 1 team, 1 task and 1 command: npm run build");
    assert.equal(rows({ runs: [ended], stretches: stretch({ tasks: 1 }) }).works[0].fact, "waiting for 1 task", "its coding agent's own background task keeps it under Working");
    assert.equal(nowLib.waitWords({ commands: 0, agents: 3, tasks: 0, teams: 0 }, [], true), "waiting for 3 workers", "a lead's are its workers");
  });

  // (fails before: yes — the owner's of 11-06: a chat whose turn ended as Filament ran its task's check read as idle,
  // though the check's verdict wakes its agent)
  test("a check Filament runs for the chat's task graph keeps its stretch, said as what it waits for", () => {
    const { archive } = memoryArchive();
    let w = W({ checks: 1 });
    const s = createStretches({ archive: () => archive, waits: () => w, now: () => 1_000 });
    s.began("c1");
    s.ended("c1");
    assert.deepEqual(s.going(() => false), [{ chainId: "c1", since: 1_000, waits: { commands: 0, agents: 0, tasks: 0, teams: 0, checks: 1 } }]);
    assert.equal(rows({ runs: [ended], stretches: stretch({ checks: 1 }) }).works[0].fact, "waiting for 1 check");
    assert.equal(nowLib.waitWords({ commands: 0, agents: 1, tasks: 0, teams: 0, checks: 2 }, [], false), "waiting for 1 agent and 2 checks");
    w = W();
    s.settle("c1");
    assert.deepEqual(s.going(() => false), [], "its end, with nothing else, ends the stretch");
  });

  // (fails before: yes — with nothing the page knew of at work, the chat went to Done as its end woke its agent)
  test("its stretch with nothing said keeps it under Working — the turn its agent is woken with on its way —; over, it is done", () => {
    const alone = rows({ runs: [ended], unread: new Set(["c1"]), stretches: stretch() });
    assert.deepEqual([alone.works.length, alone.works[0]?.fact, alone.works[0]?.icon, alone.works[0]?.at, alone.done.length], [1, "working", "messageSquare", SINCE, 0]);
    const over = rows({ runs: [ended], unread: new Set(["c1"]) });
    assert.deepEqual([over.works.length, over.done[0]?.fact], [0, "finished"]);
    const before = rows({ runs: [ended], unread: new Set(["c1"]), commands: new Map([["c1", [cmd("bg_1", "npm run build")]]]) });
    assert.deepEqual([before.works[0].fact, before.works[0].at], ["finished · 1 command running: npm run build", NOW - 120_000], "a command with no stretch: its own words, from its own start");
  });

  // (fails before: yes — a row drew again only when its words moved: the stretch heard after it was drawn left "1h")
  test("drawn: the row's age moves as its stretch is heard after the row was drawn, as a page that loads afresh hears it", async () => {
    const t = Date.now();
    /** @type {Map<string, import("../src/ui/harness/lib/now.js").Stretch>} */
    const stretches = new Map();
    const now = createNow({ h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn, call: /** @type {any} */ (async () => ({ events: [] })), chats: () => ({ title: "filament_main", project: "webshop", when: t, unread: false }), unread: () => new Set(), holders: () => new Map(), stretches: () => stretches, onOpen() {}, onSeen() {} });
    await now.update(/** @type {any} */ ([{ id: "r1", kind: "coding-agent", status: "running", startedAt: t - 3_600_000, endedAt: null, events: 1, meta: { chain: "c1", model: "opus" } }]));
    assert.equal(ageOf(now.el), "1h");
    stretches.set("c1", { since: t - 31 * 3_600_000 });
    now.refresh();
    assert.equal(ageOf(now.el), "1d");
  });

  // (fails before: yes — the tray's card read no stretch: its Now said the woken turn's own age)
  test("the tray's card: each tick's holders read gives its Now the chats' stretches, as the page's", async () => {
    const t = Date.now();
    const card = trayCard.cardNow({ h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn, call: /** @type {any} */ (async () => ({ events: [] })), chats: () => ({ title: "filament_main", project: "webshop", when: t, unread: false }), unread: () => new Set(), onOpen() {}, onSeen() {} });
    const runs = { runs: [{ id: "r1", kind: "coding-agent", status: "running", startedAt: t - 3_600_000, endedAt: null, events: 1, meta: { chain: "c1", model: "opus" } }] };
    await card.read({ runs, holders: { holders: [], stretches: [] } });
    assert.equal(ageOf(card.now.el), "1h");
    await card.read({ runs, holders: { holders: [], stretches: [{ chainId: "c1", since: t - 31 * 3_600_000 }, { chainId: "c2", since: 0 }] } });
    assert.equal(ageOf(card.now.el), "1d");
  });
});

/** The first row's age in a drawn Now. @param {any} el */
function ageOf(el) {
  /** @param {any} n @returns {any[]} */
  const ages = (n) => [...(String(n?.attrs?.class || "").split(/\s+/).includes("now-age") ? [n] : []), ...(n?.kids || []).flatMap((/** @type {any} */ k) => (k && typeof k === "object" ? ages(k) : []))];
  return textOf(ages(el)[0]);
}

/** The loop's fake model and a Filament around it: a chat's turns, its stretch as the holders read and the feed say it. */
const loopBench = () => {
  const b = {
    /** @type {any} */ up: null,
    /** @type {any} */ shim: null,
    root: "",
    /** The woken turn's model call waits on this, let go once the test has looked. @type {() => void} */
    letWakeGo: () => {},
    /** @type {Promise<unknown>} */ wakeHeld: Promise.resolve(),
    woken: false,
    /** The stopped turn's model call waits on this, let go at the end. @type {() => void} */
    release: () => {},
    /** @type {Promise<unknown>} */ held: Promise.resolve(),
    holding: false,
    /** Each stretch's move the feed said: its chat, its start, null at its end, and what keeps it past a turn. @type {[string, number | null, any][]} */
    heard: [],
    unhear: () => {},
  };
  b.wakeHeld = new Promise((r) => (b.letWakeGo = () => r(undefined)));
  b.held = new Promise((r) => (b.release = () => r(undefined)));
  return b;
};
const answered = (/** @type {any} */ body) => new Set((body?.messages || []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : []))
  .filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id));
const said = (/** @type {any} */ body) => JSON.stringify(body?.messages || []);
/** @param {string} js */
const nodeCmd = (js) => `node -e "${js}"`;
/** @param {string} id @param {string} js */
const background = (id, js) => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id, name: "bash_background", input: { command: nodeCmd(js), grace: 0.1 } }] });
/** @param {ReturnType<typeof loopBench>} b @param {string} root @returns {(cfg: any) => void} */
const loopConfig = (b, root) => (cfg) => {
  cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: b.up.url, apiKey: "s", enabled: true }];
  cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
  cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
};
/** The script: a build that ends by itself, a long one, one the turn waits on until stopped. @param {ReturnType<typeof loopBench>} b */
const loopScript = (b) => async (/** @type {any} */ call) => {
  if (call.kind !== "anthropic") return undefined;
  if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
  const all = said(call.body);
  if (all.includes("and now?")) return anthropicReply("All done.", { model: "m-1" });
  if (all.includes(WAKE_LINE.slice(0, 60))) {
    b.woken = true;
    await b.wakeHeld;
    return anthropicReply("The build ended: it passed.", { model: "m-1" });
  }
  if (all.includes("start the build")) {
    if (!answered(call.body).has("b1")) return background("b1", "setTimeout(()=>process.exit(0),4000)");
    return anthropicReply("The build runs in the background; I will look when it ends.", { model: "m-1" });
  }
  if (all.includes("start the long build")) {
    if (!answered(call.body).has("b2")) return background("b2", "setTimeout(()=>{},60000)");
    return anthropicReply("It runs.", { model: "m-1" });
  }
  if (!answered(call.body).has("s1")) return background("s1", "setTimeout(()=>process.exit(0),8000)");
  b.holding = true;
  await b.held;
  return anthropicReply("late", { model: "m-1" });
};
/** A shim's helpers over a chat. @param {any} shim @param {string} root */
const chatTools = (shim, root) => ({
  /** @param {string} content @param {boolean} [stream] */
  chat: async (content, stream = false) => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    const id = String((await made.json()).id);
    return { id, turn: shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content, stream } }) };
  },
  /** The chat's stretch as the holders read says it, or null. @param {string} id */
  stretchOf: async (id) => ((await (await shim.api("/api/sessions/holders")).json()).stretches || []).find((/** @type {any} */ x) => x.chainId === id) || null,
  /** The chat's turns in the runs list, newest first. @param {string} id */
  turnsOf: async (id) => ((await (await shim.api("/api/runs?limit=50")).json()).runs || []).filter((/** @type {any} */ r) => r.meta?.chain === id && (r.kind === "agent-turn" || r.kind === "coding-agent")),
});

describe("through a real Filament", () => {
  const b = loopBench();
  /** @type {ReturnType<typeof chatTools>} */
  let tools;
  before(async () => {
    b.root = mkdtempSync(join(tmpdir(), "filament-stretch-"));
    b.up = await fakeUpstream(loopScript(b));
    b.shim = await startApp({ memory: true, configure: loopConfig(b, b.root) });
    tools = chatTools(b.shim, b.root);
    b.unhear = /** @type {any} */ (b.shim.app).events.subscribe("compactions", (/** @type {any} */ m) => {
      if (m?.type === "stretch") b.heard.push([String(m.chainId), m.since ?? null, m.waits ?? null]);
    });
  });
  after(async () => {
    b.unhear();
    b.letWakeGo();
    b.release();
    await b.shim?.stop();
    await b.up?.close();
    rmSync(b.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  /** The feed's word on the chat: its start, or null at its end. @param {string} id */
  const movesOf = (id) => b.heard.filter(([c]) => c === id).map(([, s]) => s);
  /** Now's rows for the chat, from what the page reads: the runs list, the holders read's commands and stretches. @param {string} id */
  const nowOf = async (id) => {
    const h = await (await b.shim.api("/api/sessions/holders")).json();
    return nowLib.nowRows({
      runs: await tools.turnsOf(id), folds: new Map(), threads: new Map(), unread: new Set([id]), holders: new Map(), now: Date.now(),
      chats: (c) => (c === id ? { title: "the build", project: "p", when: Date.now(), unread: true } : null),
      commands: new Map((h.commands || []).map((/** @type {any} */ x) => [x.chainId, x.commands])),
      stretches: new Map((h.stretches || []).map((/** @type {any} */ x) => [x.chainId, { since: x.since, waits: x.waits || null }])),
    });
  };

  // (fails before: yes — the woken turn's row counted from its own start, and no read said the stretch)
  test("a turn starts a build in the background and ends: the chat works on from its start, through the turn the build's end wakes, until that turn leaves nothing open", async () => {
    const asked = Date.now();
    const { id, turn } = await tools.chat("start the build");
    const done = await turn;
    assert.equal(done.status, 200, await done.clone().text());
    assert.equal(runningShellsOf(id).length, 1, "the build runs on after the turn");
    const [first] = await tools.turnsOf(id);
    const s = await tools.stretchOf(id);
    assert.ok(s && s.since >= asked && s.since <= first.startedAt, `the stretch began with the first turn: ${JSON.stringify(s)} in ${asked}…${first.startedAt}`);
    assert.deepEqual(s.waits, { commands: 1, agents: 0, tasks: 0, teams: 0, checks: 0 }, "what keeps it, counted");
    const between = await nowOf(id);
    assert.deepEqual([between.done.length, between.works.length, between.works[0]?.at], [0, 1, s.since], "between its turns: under Working, from the first turn's start");
    assert.match(String(between.works[0]?.fact), /^waiting for 1 command: node -e /);

    await until(() => b.woken, "the build's end wakes the chat", { timeoutMs: 20_000 });
    const woke = await until(async () => (await tools.turnsOf(id)).find((/** @type {any} */ r) => r.id !== first.id && r.status === "running") || null, "the woken turn in the runs list");
    assert.ok(woke.startedAt > first.endedAt, "a turn of its own");
    assert.equal((await tools.stretchOf(id))?.since, s.since, "the woken turn goes on with the stretch");
    const running = await nowOf(id);
    assert.deepEqual([running.works.length, running.works[0]?.at], [1, s.since], "its row counts from the first turn's start");

    b.letWakeGo();
    await until(async () => (await tools.turnsOf(id)).every((/** @type {any} */ r) => r.status !== "running") && !(await tools.stretchOf(id)), "the woken turn's end, nothing left open");
    const over = await nowOf(id);
    assert.deepEqual([over.works.length, over.done[0]?.fact], [0, "finished"], "its work over: done");

    const next = await b.shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "and now?", stream: false } });
    assert.equal(next.status, 200, await next.clone().text());
    const moves = movesOf(id);
    assert.deepEqual(moves.slice(0, 4), [s.since, s.since, s.since, null], "begun, past the first turn, on with the woken one, ended with it");
    assert.ok(Number(moves[4]) > s.since, "the person's next turn, nothing open: a stretch of its own");
    assert.equal(moves[5], null);
  });

  // (fails before: yes — the stretch outlasted the Stop: the build's end, which wakes nothing after it, kept it going)
  test("the person's Stop: the stretch goes on while the build runs, and is over as it ends — its end wakes nothing; their next message begins anew", async () => {
    const { id, turn } = await tools.chat("build it, then wait", true);
    await until(() => b.holding, "the turn's model call after the build's start");
    const s = await tools.stretchOf(id);
    assert.ok(s, "the turn runs: its stretch with it");
    const stop = await b.shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200, await stop.clone().text());
    await (await turn).text();
    await until(async () => (await tools.turnsOf(id)).every((/** @type {any} */ r) => r.status !== "running"), "the stopped turn's end");
    assert.equal(runningShellsOf(id).length, 1, "the build still runs");
    assert.equal((await tools.stretchOf(id))?.since, s?.since, "the build still runs: the stretch goes on");
    await until(async () => !runningShellsOf(id).length && !(await tools.stretchOf(id)), "the build's end, and the stretch over", { timeoutMs: 20_000 });
    assert.equal(wakeDue(id), true, "its end waits untold: the Stop holds Filament's turn back");
    assert.equal(movesOf(id).at(-1), null, "its end said");
    const next = await b.shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "and now?", stream: false } });
    assert.equal(next.status, 200, await next.clone().text());
    const fresh = movesOf(id).find((x, i) => i > 0 && x != null && x !== s?.since);
    assert.ok(Number(fresh) > Number(s?.since), `their message begins a stretch of its own: ${JSON.stringify(movesOf(id))}`);
  });

  // (fails before: yes — the review of 11-03: the person's Stop of `npm run dev` between turns left the chat under Working
  // for good — its word, kept for the next turn, counted as an end that wakes — and their next message inherited the start)
  test("the person's Stop of the last command between turns ends the stretch at once: its word waits for the next turn and wakes nobody", async () => {
    const { id, turn } = await tools.chat("start the long build");
    const done = await turn;
    assert.equal(done.status, 200, await done.clone().text());
    const s = await tools.stretchOf(id);
    assert.ok(s, "the long build keeps it");
    const [cmd] = runningShellsOf(id);
    const stop = await b.shim.api(`/api/sessions/${encodeURIComponent(id)}/commands/${encodeURIComponent(cmd.id)}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200, await stop.clone().text());
    await until(async () => !(await tools.stretchOf(id)), "the stretch over");
    assert.equal(peekShellExits({ session: id, agent: null }).length, 1, "the person's word waits untold, for the next turn");
    assert.equal(wakeDue(id), false, "and wakes nobody (FabeleHelper's of 11-10: it is kept quiet)");
    assert.deepEqual(movesOf(id), [s?.since, s?.since, null], "begun, past its turn, ended at the Stop");
    const next = await b.shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "and now?", stream: false } });
    assert.equal(next.status, 200, await next.clone().text());
    assert.ok(Number(movesOf(id)[3]) > Number(s?.since), "their next message begins a stretch of its own");
  });

  // (fails before: yes — the review of 11-03: a stretch's step that threw failed the person's turn, and the holders read)
  test("the stretch is bookkeeping: what throws in it is logged, and neither the person's turn nor the holders read fails", async () => {
    const { id, turn } = await tools.chat("start the long build");
    const done = await turn;
    assert.equal(done.status, 200, await done.clone().text());
    assert.ok(await tools.stretchOf(id), "a stretch past its turn, for the read to weigh");
    const a = /** @type {any} */ (b.shim.app).memory.archive;
    const { metaOf, besideOf } = a;
    a.metaOf = (/** @type {string} */ chain, /** @type {string[]} */ keys) => {
      if (keys.includes("workSince")) throw new Error("the meta could not be read");
      return metaOf.call(a, chain, keys);
    };
    a.besideOf = () => {
      throw new Error("the links could not be read");
    };
    try {
      const read = await b.shim.api("/api/sessions/holders");
      assert.equal(read.status, 200, await read.clone().text());
      const other = await tools.chat("and now?");
      const answered = await other.turn;
      assert.equal(answered.status, 200, await answered.clone().text());
      assert.match(JSON.stringify(await answered.json()), /All done\./);
    } finally {
      a.metaOf = metaOf;
      a.besideOf = besideOf;
    }
    const [cmd] = runningShellsOf(id);
    await b.shim.api(`/api/sessions/${encodeURIComponent(id)}/commands/${encodeURIComponent(cmd.id)}/stop`, { method: "POST", body: {} });
    await until(async () => !(await tools.stretchOf(id)), "the stretch over once its command is stopped");
  });
});

describe("through a real Filament, across its restart", () => {
  // (fails before: yes — the review of 11-03: a restart with a command running between turns told the chat of it, a word
  // that wakes nobody, and the next morning's message went on with the old stretch)
  test("Filament stops with a command running between turns: as it starts again its word of the command wakes nobody, and the next message begins a stretch of its own", async () => {
    const b = loopBench();
    const root = mkdtempSync(join(tmpdir(), "filament-stretch-restart-"));
    b.up = await fakeUpstream(loopScript(b));
    /** @type {any} */
    let again = null;
    const first = await startApp({ memory: true, keep: true, configure: loopConfig(b, root) });
    try {
      const { id, turn } = await chatTools(first, root).chat("start the long build");
      const done = await turn;
      assert.equal(done.status, 200, await done.clone().text());
      const s = await chatTools(first, root).stretchOf(id);
      assert.ok(s, "the long build keeps it as Filament stops");
      await first.stop();
      again = await startApp({ memory: true, dataDir: first.dataDir, configure: loopConfig(b, root) });
      /** @type {(number | null)[]} */
      const moves = [];
      const off = /** @type {any} */ (again.app).events.subscribe("compactions", (/** @type {any} */ m) => {
        if (m?.type === "stretch" && m.chainId === id) moves.push(m.since ?? null);
      });
      try {
        assert.equal(peekShellExits({ session: id, agent: null }).length, 1, "the word of the command the stop ended waits untold");
        assert.equal(wakeDue(id), false, "and wakes nobody");
        assert.equal(await chatTools(again, root).stretchOf(id), null, "nothing of it goes on");
        const next = await again.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "and now?", stream: false } });
        assert.equal(next.status, 200, await next.clone().text());
        assert.ok(Number(moves[0]) > Number(s?.since), `a stretch of its own: ${JSON.stringify(moves)} after ${s?.since}`);
        assert.equal(moves[1], null, "over with it: nothing keeps it");
      } finally {
        off();
      }
    } finally {
      await again?.stop();
      await b.up?.close();
      await removeDirs(root);
    }
  });
});

describe("through a real Filament, its coding agent's own background task", () => {
  /** @type {any} */ let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-stretch-acp-"));
  const projDir = join(root, "project");
  /** Each stretch's move the feed said: its chat, its start, null at its end, and its own tasks past a turn. @type {[string, number | null, number | null][]} */
  const heard = [];
  /** @type {() => void} */
  let unhear = () => {};
  before(async () => {
    mkdirSync(projDir);
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "claude", name: "Claude Code", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_WAKE_MS: "2500" }, cwdDefault: projDir, permissions: "allow-all", hints: false } }];
        cfg.routes = [{ match: "claude/*", upstream: "claude", upstreamModel: "{1}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    unhear = /** @type {any} */ (shim.app).events.subscribe("compactions", (/** @type {any} */ m) => {
      if (m?.type === "stretch") heard.push([String(m.chainId), m.since ?? null, m.waits?.tasks ?? null]);
    });
  });
  after(async () => {
    unhear();
    await shim?.stop();
    await removeDirs(root);
  });

  // (fails before: yes — the review of 11-03: the stretch ended with the turn while Claude's own task ran, and the turn
  // its end began started a new one)
  test("its turn ends with its own task running in the background: the stretch goes on, and the turn the task's end begins goes on with it", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "claude/haiku", preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "~wake-task please", stream: true, runEvents: true } });
    assert.equal(res.status, 200, await res.clone().text());
    await res.text();
    const s = await until(async () => ((await (await shim.api("/api/sessions/holders")).json()).stretches || []).find((/** @type {any} */ x) => x.chainId === id && !shimTurnRuns(x)) || null, "its stretch past its turn");
    assert.equal(s.waits?.tasks, 1, "its own background task keeps it");
    const tr = await until(async () => {
      const t = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
      return t.turns.length >= 2 && t.turns.every((/** @type {any} */ x) => x.final) && !t.live ? t : null;
    }, "the turn of its own, finished", { timeoutMs: 30_000 });
    assert.ok(tr.turns[1].own, "a turn of the agent's own");
    await until(async () => !((await (await shim.api("/api/sessions/holders")).json()).stretches || []).some((/** @type {any} */ x) => x.chainId === id), "the stretch over");
    const moves = heard.filter(([c]) => c === id).map(([, since, tasks]) => [since, tasks]);
    assert.deepEqual(moves, [[s.since, null], [s.since, 1], [s.since, null], [null, null]], "begun, past its turn with its task, on with the agent's own turn, ended with it");
  });
  /** A stretch row the read says of a turn running: none says what keeps it. @param {any} x */
  const shimTurnRuns = (x) => !x.waits;
});
