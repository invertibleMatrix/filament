// @ts-check
// The side-by-side card answers itself (the plan of 11-14): while Parallelize tasks is off, the card the agent's tasks
// `parallel` puts is answered on the server 60 seconds after it was put, if the person has not — its tasks start, as an
// Accept starts them, wherever each would work (the owner's choice of 11-14), where a model is known — the turn's, else
// the chat's own —; else they stay the agent's, as an Ignore keeps them. The agent hears which, and that no answer came. The person's Ignore, the card leaving, Parallelize
// tasks switched on and Filament stopping let go of the timer; after a restart the card waits for the person alone. The
// card counts down to the server's deadline, by the server's clock.
// (fails before: yes — the card waited for the person's press alone, for hours where nobody came)
import { test, describe, after, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tg from "../src/core/task-graph.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { CLOCK_GRACE_MS, sideActions, sideClockWords, sideOfferRow } from "../src/ui/harness/conversation/side-offer.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { removeDirs, until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));

const T0 = Date.UTC(2026, 10, 14, 9, 0);
/** @type {import("../src/core/task-graph.js").Crew} */
const AGENT = "agent";
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** api and ui ready, apart, and each writes; docs needs api; look only reads. */
const ADD = {
  action: "add",
  goal: "Ship the card",
  tasks: [
    { id: "api", name: "The route", writes: ["src/http/a.js"], steps: ["Write the route"] },
    { id: "ui", name: "The card", writes: ["src/ui/card.js"], steps: ["Draw the card"] },
    { id: "docs", name: "The docs", needs: ["api"], writes: ["docs/GUIDE.md"], steps: ["Say it"] },
    { id: "look", name: "A look", steps: ["Read the code"] },
  ],
};
const graph = () => ok(tg.applyTasks(null, ADD, { at: T0, crew: AGENT })).graph;
const NO_MODEL = "no model is known for them to run on";

/** A folder git holds. */
/** A git repository with a commit, which gives copies. @param {{ commit?: boolean }} [o] */
const repo = ({ commit = true } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-side-timeout-repo-"));
  made.push(dir);
  execFileSync("git", ["init", "-q", dir]);
  if (commit) execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start"]);
  return dir;
};
/** A folder no git repository holds. */
const plain = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-side-timeout-plain-"));
  made.push(dir);
  return dir;
};

describe("the card's answer, as it is put", () => {
  /** @param {any} o */
  const offerOf = (o) => ok(tg.applyTasks(graph(), { action: "parallel", ids: ["api", "ui"] }, { at: T0 + 1, crew: AGENT, turn: 2, ...o })).graph.offer;

  test("it starts its tasks by itself where a model is known, 60 seconds after it was put", () => {
    assert.equal(tg.SIDE_ANSWER_MS, 60_000);
    const offer = offerOf({ model: "m-main" });
    assert.deepEqual(offer, { ids: ["api", "ui"], at: T0 + 1, turn: 2, model: "m-main", until: T0 + 1 + 60_000, onTimeout: "accept" });
    const g = ok(tg.applyTasks(graph(), { action: "parallel", ids: ["api", "ui"] }, { at: T0 + 1, crew: AGENT, turn: 2, model: "m-main" })).graph;
    const card = /** @type {any} */ (tg.sideOfferOf(g));
    assert.deepEqual([card.until, card.onTimeout, "why" in card, "model" in card], [T0 + 60_001, "accept", false, false], "every page counts down from the server's deadline");
    assert.deepEqual(tg.graphView(g)?.offer, card, "the pages hear it with the graph");
  });

  // (fails before: yes — the owner's choice of 11-14, on the review of fc944b32: a card whose tasks would work in the
  // chat's folder kept them with the agent at its deadline; it starts them all, only a missing model keeping them)
  test("its tasks stay the agent's only where no model is known — said why", () => {
    const offer = offerOf({});
    assert.deepEqual([offer.onTimeout, offer.why, offer.until], ["decline", NO_MODEL, T0 + 60_001]);
    assert.deepEqual([tg.sideTimeoutWhy("m-main"), tg.sideTimeoutWhy(null), tg.sideTimeoutWhy("")], ["", NO_MODEL, NO_MODEL]);
  });

  test("a card kept with no deadline waits for the person alone: none is drawn", () => {
    const g = { ...graph(), offer: { ids: ["api", "ui"], at: T0 + 1, turn: 2 } };
    const card = /** @type {any} */ (tg.sideOfferOf(g));
    assert.deepEqual([card.ids, "until" in card, "onTimeout" in card], [["api", "ui"], false, false]);
  });

  test("what the agent hears of it: started by itself, or kept its own and why — no answer in 60 seconds either way", () => {
    assert.equal(tg.sideTimedNote(["api", "ui"]), "[Filament: the card that suggested api and ui had no answer in 60 seconds, so it started them on sub-agents by itself; leave them — their reports come to you]");
    assert.equal(tg.sideTimedNote(["api"]), "[Filament: the card that suggested api had no answer in 60 seconds, so it started it on a sub-agent by itself; leave it — its report comes to you]");
    assert.equal(tg.sideTimedNote(["api", "ui"], NO_MODEL), "[Filament: the card that suggested api and ui had no answer in 60 seconds, and no model is known for them to run on, so nothing started: they stay yours — do them yourself, as you planned; suggest them again only if the person asks]");
  });
});

/**
 * A session's graph in memory, kept across runners as the archive keeps it, and a registry that records the launches.
 * `cwd`: the chat's folder; `worktree`: its editing sub-agents work in copies; `switches.parallel`: Parallelize tasks;
 * `chatModel`: the chat's own model, as its settings name it.
 * @param {{ cwd: string, worktree?: boolean, chains?: Map<string, any>, switches?: { parallel: boolean, own?: Set<string> }, clock?: { t: number }, chatModel?: (() => string | null) | null }} o
 */
function rig({ cwd, worktree = true, chains = new Map([["c1", { id: "c1", meta: { graph: graph() } }]]), switches = { parallel: false }, clock = { t: T0 }, chatModel = null }) {
  /** @type {any[]} */
  const launches = [];
  /** @type {any[]} */
  const tells = [];
  /** @type {Set<(e: any) => void>} */
  const config = new Set();
  /** A chat's settings written: the bus's settings topic says which. @type {Set<(e: any) => void>} */
  const chatSettings = new Set();
  let n = 0;
  const registry = {
    /** @param {any} spec */
    launch: (spec) => {
      launches.push(spec);
      return { ok: true, id: `sa_${++n}`, done: new Promise(() => {}), tree: Promise.resolve(true) };
    },
    room: () => ({ running: 0, cwd, worktree }),
    turnOpen: () => false,
    /** @param {string} _c @param {() => void} go */
    afterTurn: (_c, go) => go(),
    notice: () => {},
    /** @param {string} _c @param {any} d */
    tell: (_c, d) => void tells.push(d),
    slots: () => 4,
    stop: () => ({ ok: true }),
    guard: () => {},
    resumable: () => null,
    forkPays: () => false,
  };
  const archive = {
    /** @param {string} id @param {readonly string[]} keys */
    metaOf: (id, keys) => {
      const c = chains.get(id);
      return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
    },
    /** @param {string} id @param {any} patch */
    mergeMeta: (id, patch) => {
      const c = chains.get(id);
      c.meta = structuredClone({ ...c.meta, ...patch });
      return c.meta;
    },
    openGraphs: () => [...chains.values()].filter((c) => c.meta?.graph && !c.meta.graph.closed).map((c) => ({ id: c.id, graph: c.meta.graph })),
    newestTurnN: () => 2,
  };
  const events = {
    publish: () => {},
    /** @param {string} topic @param {(e: any) => void} fn */
    subscribe: (topic, fn) => {
      const set = topic === "config" ? config : topic === "settings" ? chatSettings : null;
      if (!set) return () => {};
      set.add(fn);
      return () => void set.delete(fn);
    },
  };
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events, crew: () => AGENT, log: () => {}, now: () => clock.t, parallel: (/** @type {string} */ chainId) => switches.parallel || !!switches.own?.has(chainId), chatModel });
  return {
    runner,
    launches,
    tells,
    chains,
    switches,
    clock,
    g: () => chains.get("c1").meta.graph,
    /** The chat's turn, on `model`. @param {string} model */
    turn: (model) => runner.attach("c1", { runId: "r1", cwd, mode: null, model, thinking: null, team: null }),
    suggest: () => ok(runner.apply("c1", { action: "parallel", ids: ["api", "ui"] }, { crew: AGENT })),
    /** Settings saved: the bus's config topic says so. */
    saved: () => config.forEach((fn) => fn({ type: "config-changed", version: 2 })),
    /** A chat's settings written. @param {string} chainId */
    chatSaved: (chainId) => chatSettings.forEach((fn) => fn({ type: "settings", chainId, hash: "h" })),
    /** The clock and the timers `ms` on. @param {number} ms */
    pass: (ms) => {
      clock.t += ms;
      mock.timers.tick(ms);
    },
  };
}

describe("the runner answers the card at its deadline", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());
  /**
   * Time for what a card's answer reads first — git, on a real clock — to land, so "nothing started" is seen after it
   * would have; the test's own clock held again after. No timer of the test's waits across it.
   */
  const quiet = async () => {
    mock.timers.reset();
    await new Promise((r) => setTimeout(r, 500));
    mock.timers.enable({ apis: ["setTimeout"] });
  };

  test("copies and a model: at 60 seconds its tasks start, each in its own copy on the turn's model, and the agent hears no answer came", async () => {
    const r = rig({ cwd: repo() });
    r.turn("m-main");
    r.suggest();
    const card = /** @type {any} */ (r.runner.offered("c1"));
    assert.deepEqual([card.onTimeout, card.until - card.at], ["accept", 60_000]);
    r.pass(59_999);
    assert.deepEqual(r.launches, [], "not before its deadline");
    r.pass(1);
    mock.timers.reset();
    await until(() => r.launches.length === 2, "the card's tasks start");
    // Read as recorded: the "nothing yet" assert above narrowed the list's type to an empty one.
    assert.deepEqual(/** @type {any[]} */ (r.launches).map((l) => [l.task.id, l.model, l.worktree, l.worker]), [["api", "m-main", true, "builder"], ["ui", "m-main", true, "builder"]]);
    assert.deepEqual([r.runner.offered("c1"), "offer" in r.g()], [null, false], "answered: the card goes");
    assert.deepEqual(r.tells.map((d) => [d.text, d.wakes, d.about]), [[tg.sideTimedNote(["api", "ui"]), true, "card"]]);
  });

  test("no model: at 60 seconds its tasks stay the agent's, kept as ignored, and it hears why", async () => {
    const r = rig({ cwd: repo() });
    r.suggest();
    assert.deepEqual([r.runner.offered("c1")?.onTimeout, r.runner.offered("c1")?.why], ["decline", NO_MODEL]);
    r.pass(60_000);
    assert.deepEqual(r.launches, []);
    assert.equal(r.runner.offered("c1"), null);
    assert.deepEqual([...tg.ignoredOf(r.g())], ["api", "ui"], "as an Ignore keeps them");
    assert.deepEqual(r.tells.map((d) => [d.text, d.wakes, d.about]), [[tg.sideTimedNote(["api", "ui"], NO_MODEL), true, "card"]]);
  });

  // (fails before: yes — the owner's choice of 11-14, on the review of fc944b32: where its tasks would work in the
  // chat's folder — no repository, one with no commit, or a chat whose sub-agents work there — they stayed the agent's)
  // (fails before: yes — the review of this change: the clock put every task that writes in a copy of its own, unlike
  // Accept — a Session-folder chat's in worktrees it opted out of, a plain folder's past the guard on one file)
  test("no git repository, one with no commit, or the chat's folder: at 60 seconds its tasks start all the same, in the folder itself, as an Accept would", async () => {
    for (const o of [{ cwd: plain() }, { cwd: repo({ commit: false }) }, { cwd: repo(), worktree: false }]) {
      const r = rig(o);
      r.turn("m-main");
      r.suggest();
      assert.equal(r.runner.offered("c1")?.onTimeout, "accept");
      r.pass(60_000);
      mock.timers.reset();
      await until(() => r.launches.length === 2, "the card's tasks start");
      mock.timers.enable({ apis: ["setTimeout"] });
      assert.deepEqual(/** @type {any[]} */ (r.launches).map((l) => [l.task.id, l.worktree]), [["api", false], ["ui", false]], JSON.stringify(o));
      assert.deepEqual(r.g().tasks.filter((/** @type {any} */ t) => t.side).map((/** @type {any} */ t) => t.side.folder), ["yours", "yours"]);
      assert.deepEqual(r.tells.map((d) => d.text), [tg.sideTimedNote(["api", "ui"])], JSON.stringify(o));
    }
  });

  test("two that write one file, in a folder that gives no copy: at 60 seconds neither starts, and the agent hears why", async () => {
    const both = ok(tg.applyTasks(null, { ...ADD, tasks: ADD.tasks.map((t) => (t.id === "ui" ? { ...t, writes: ["src/http/a.js"] } : t)) }, { at: T0, crew: AGENT })).graph;
    const r = rig({ cwd: plain(), chains: new Map([["c1", { id: "c1", meta: { graph: both } }]]) });
    r.turn("m-main");
    r.suggest();
    r.pass(60_000);
    mock.timers.reset();
    await until(() => r.tells.length === 1, "the agent told");
    assert.deepEqual(r.launches, []);
    assert.match(r.tells[0].text, /^\[Filament: the card that suggested api and ui had no answer in 60 seconds, and their start was refused \(.*src\/http\/a\.js.*\), so nothing started/);
    assert.deepEqual([...tg.ignoredOf(r.g())], ["api", "ui"], "as an Ignore keeps them");
  });

  // (fails before: yes — the review of fc944b32: a coding agent's chat runs no turn of the graph's, so its card knew no
  // model and kept its tasks with the agent at every deadline)
  test("a coding agent's chat: the card runs its tasks on the chat's own model", async () => {
    const r = rig({ cwd: repo(), chatModel: () => "m-chat" });
    r.suggest();
    assert.deepEqual([r.runner.offered("c1")?.onTimeout, r.g().offer.model], ["accept", "m-chat"]);
    r.pass(60_000);
    mock.timers.reset();
    await until(() => r.launches.length === 2, "the card's tasks start");
    assert.deepEqual(/** @type {any[]} */ (r.launches).map((l) => l.model), ["m-chat", "m-chat"]);
  });

  test("the person's Ignore lets go of the timer: nothing starts at 60 seconds, and the agent hears the Ignore alone", async () => {
    const r = rig({ cwd: repo() });
    r.turn("m-main");
    r.suggest();
    ok(r.runner.ignoreOffer("c1", /** @type {any} */ (r.runner.offered("c1")).at));
    r.pass(120_000);
    await quiet();
    assert.deepEqual(r.launches, []);
    assert.deepEqual(r.tells.map((d) => d.text), [tg.ignoredNote(["api", "ui"])]);
  });

  test("the card leaving lets go of its timer: a task of it started by the agent, or another card in its place, which keeps its own deadline", async () => {
    const r = rig({ cwd: plain() });
    r.turn("m-main");
    r.suggest();
    ok(r.runner.apply("c1", { action: "start", ids: ["api"] }, { crew: AGENT }));
    assert.equal(r.runner.offered("c1"), null, "the agent started api itself");
    r.pass(60_000);
    assert.deepEqual([r.launches, r.tells], [[], []], "nothing answered, nothing told");

    const again = rig({ cwd: plain() });
    again.turn("m-main");
    again.suggest();
    const first = /** @type {any} */ (again.runner.offered("c1"));
    again.pass(30_000);
    again.suggest();
    const second = /** @type {any} */ (again.runner.offered("c1"));
    assert.deepEqual([second.at > first.at, second.until], [true, second.at + 60_000]);
    again.pass(30_000);
    assert.deepEqual([again.tells, again.runner.offered("c1")?.at], [[], second.at], "the first card's deadline came: nothing");
    again.pass(30_000);
    mock.timers.reset();
    await until(() => again.launches.length === 2, "the second card's tasks start");
    assert.deepEqual(again.tells.map((d) => d.text), [tg.sideTimedNote(["api", "ui"])], "the second card's");
  });

  test("Parallelize tasks switched on: the card waits for the person, its deadline let go — heard as settings are saved, or at the deadline", () => {
    const heard = rig({ cwd: plain() });
    heard.turn("m-main");
    heard.suggest();
    heard.switches.parallel = true;
    heard.saved();
    const card = /** @type {any} */ (heard.runner.offered("c1"));
    assert.deepEqual([card.ids, "until" in card, "onTimeout" in card], [["api", "ui"], false, false], "the pages hear it with no countdown");
    heard.pass(120_000);
    assert.deepEqual([heard.launches, heard.tells, heard.runner.offered("c1")?.ids], [[], [], ["api", "ui"]], "it stands, for the person's press");
    heard.switches.parallel = false;
    heard.saved();
    heard.pass(120_000);
    assert.deepEqual(heard.tells, [], "switched off again: it still waits for the person");

    // (fails before: yes — the review of fe6b8d579: the chat's own switch, its card's Always accept in this chat, was
    // heard at the deadline alone, the card counting down until then)
    const own = rig({ cwd: plain(), switches: { parallel: false, own: new Set() } });
    own.turn("m-main");
    own.suggest();
    own.switches.own?.add("other");
    own.chatSaved("c1");
    assert.ok("until" in /** @type {any} */ (own.runner.offered("c1")), "another chat's switch on: it counts on");
    own.switches.own?.add("c1");
    own.chatSaved("other");
    assert.ok("until" in /** @type {any} */ (own.runner.offered("c1")), "another chat's write: it counts on");
    own.chatSaved("c1");
    const mine = /** @type {any} */ (own.runner.offered("c1"));
    assert.deepEqual([mine.ids, "until" in mine], [["api", "ui"], false], "the chat's own switch on: it waits for the person");

    const late = rig({ cwd: plain() });
    late.turn("m-main");
    late.suggest();
    late.switches.parallel = true;
    late.pass(60_000);
    const stands = /** @type {any} */ (late.runner.offered("c1"));
    assert.deepEqual([late.launches, late.tells, stands.ids, "until" in stands], [[], [], ["api", "ui"], false]);
  });

  // (fails before: yes — the review of 11-14: a card kept through a restart answered itself at once, starting sub-agents
  // as Filament opened, days later perhaps, with nobody there)
  test("Filament stopping lets go of the timer; its next start keeps the card for the person alone, its deadline gone", async () => {
    const dir = repo();
    const first = rig({ cwd: dir });
    first.turn("m-main");
    first.suggest();
    const card = /** @type {any} */ (first.runner.offered("c1"));
    first.pass(20_000);
    first.runner.shutdown();
    first.pass(60_000);
    await quiet();
    assert.deepEqual([first.launches, first.tells, first.runner.offered("c1")?.at], [[], [], card.at], "stopped: nothing answers it, and it is kept");

    // Started again, before its deadline or after it, a sub-agent's task the restart cut beside it or none: the card
    // waits for the person.
    for (const [until, cut] of /** @type {[number, boolean][]} */ ([[first.clock.t + 40_000, false], [first.clock.t - 1, false], [first.clock.t - 1, true]])) {
      const chains = new Map([["c1", structuredClone(first.chains.get("c1"))]]);
      chains.get("c1").meta.graph.offer.until = until;
      if (cut) {
        const docs = chains.get("c1").meta.graph.tasks.find((/** @type {any} */ t) => t.id === "docs");
        Object.assign(docs, { state: "running", by: "sub-agent", agent: "sa_old", startedAt: first.clock.t - 5_000 });
      }
      const again = rig({ cwd: dir, chains, clock: { t: first.clock.t } });
      again.runner.reconcile();
      again.pass(120_000);
      await quiet();
      const offer = /** @type {any} */ (again.runner.offered("c1"));
      assert.deepEqual([again.launches, offer?.at, offer?.until], [[], card.at, undefined], `cut: ${cut}`);
      if (cut) assert.equal(again.g().tasks.find((/** @type {any} */ t) => t.id === "docs").state === "running", false, "the restart cut it");
    }
  });
});

describe("the card counts down", () => {
  /** @type {ReturnType<typeof stubDocument> | null} */
  let doc = null;
  beforeEach(() => {
    doc = stubDocument();
    mock.timers.enable({ apis: ["setInterval", "Date"], now: T0 });
  });
  afterEach(() => {
    mock.timers.reset();
    Object.assign(sideActions, { offer: null, watch: null, model: null, facts: null, accept: null, ignore: null, said: null });
    doc?.restore();
  });
  const TASKS = [{ id: "api", name: "The route", writes: ["src/http/a.js"] }, { id: "ui", name: "The card", writes: ["src/ui/card.js"] }];
  /** @param {any} [o] */
  const mark = (o = {}) => ({ type: /** @type {const} */ ("side"), at: T0 - 18_000, afterTurn: 2, turn: 2, ids: ["api", "ui"], tasks: TASKS, ...o });
  /** @param {any} m */
  const draw = (m) => {
    Object.assign(sideActions, { model: () => "m-main" });
    const row = /** @type {any} */ (sideOfferRow(m, "c1"));
    /** @type {any} */ (document.body).append(row);
    return row;
  };

  test("its words: the time left in minutes and seconds, what comes then, and why where its tasks stay with your agent", () => {
    assert.equal(sideClockWords({ until: T0, onTimeout: "accept" }, 60_000), "Starts by itself in 1:00.");
    assert.equal(sideClockWords({ until: T0, onTimeout: "accept" }, 41_001), "Starts by itself in 0:42.");
    assert.equal(sideClockWords({ until: T0, onTimeout: "decline", why: NO_MODEL }, 42_000), `Stays with your agent in 0:42: ${NO_MODEL}.`);
    assert.equal(sideClockWords({ until: T0, onTimeout: "accept" }, 0), "Starts by itself now.");
    assert.equal(sideClockWords({}, 10_000), "", "a card that waits for your press alone");
  });

  test("from the server's deadline, each second while it is drawn, and no more once it has left", () => {
    const row = draw(mark({ until: T0 + 42_000, onTimeout: "accept" }));
    assert.ok(row.textContent.includes("Starts by itself in 0:42."), row.textContent);
    mock.timers.tick(1_000);
    assert.ok(row.textContent.includes("Starts by itself in 0:41."), row.textContent);
    mock.timers.tick(41_000);
    assert.ok(row.textContent.includes("Starts by itself now."), row.textContent);
    // Still standing well past its deadline: the server let it wait (Parallelize tasks switched on), and so does the card.
    mock.timers.tick(CLOCK_GRACE_MS + 1_000);
    assert.equal(row.textContent.includes("by itself"), false, row.textContent);
    const away = draw(mark({ until: T0 + 120_000, onTimeout: "accept" }));
    away.remove();
    const left = away.textContent;
    mock.timers.tick(5_000);
    assert.equal(away.textContent, left, "drawn away: the clock stops");
  });

  test("one that keeps its tasks your agent's says why; one with no deadline says nothing of one", () => {
    const decline = draw(mark({ until: T0 + 60_000, onTimeout: "decline", why: NO_MODEL }));
    assert.ok(decline.textContent.includes(`Stays with your agent in 1:00: ${NO_MODEL}.`), decline.textContent);
    const none = draw(mark());
    assert.equal(/by itself|Stays with your agent/.test(none.textContent), false, none.textContent);
  });
});
