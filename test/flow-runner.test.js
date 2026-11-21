// @ts-check
// A flow's runner (HarnessV4_Flow_Plan F3; HarnessV4_OneAgent_Plan OA3, OA4) on fakes: the registry, teams beside, the team
// chats' facts and the events feed held by the test. Every server case of §6: the owner's example end to end, a gate's
// not yet and a send-back, no verdict, a box that fails (Retry, Skip), Stop, a box stopped, a restart (Stopped by a
// restart, Go on), a box with no seat, a team box that asks or ends on a question, a newer reply taken, an edit while it
// runs, the end message kept until it went, a team chat refused; and OA3's: each box handed only what it needs, Start
// telling the main agent, the person's review, and the main agent's draft — only after /flow, checked whole, changed by
// it while it stands; OA4's In place: the turn that drives it, the word it hears a burst, its acts on the flow, the
// person's review kept theirs, the end of that turn, and a restart; and OA5's: the flow's own worktree, made by its first
// team box that writes, every box after it working there, the end saying where, and outside git the folder.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createFlowRunner, GO_ON_LINE } from "../src/app/flow-runner.js";
import { createFlowStore } from "../src/services/flow-store.js";
import { createSavedFlows } from "../src/services/saved-flows.js";
import { FLOW_DRIVE_HEAD, FLOW_END_HEAD, FLOW_NEWS_HEAD, FLOW_RESTART_HEAD, FLOW_START_HEAD, VERDICT_RULE } from "../src/core/flow.js";
import { SHIPPED_CARDS } from "../src/services/agent-cards.js";
import { OWN_CARDS } from "./helpers/flow-cards.js";
import { SHIPPED_TEAMS } from "../src/services/teams.js";
import { sessionRoutes } from "../src/http/admin/sessions.js";
import { createRouter } from "../src/http/router.js";

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const settle = () => new Promise((r) => setImmediate(r));
const settled = async (n = 15) => {
  for (let i = 0; i < n; i++) await settle();
};
/** @type {import("../src/core/flow.js").Roster} */
const ROSTER = {
  cards: [...Object.entries(SHIPPED_CARDS).map(([tag, c]) => ({ tag, name: c.name, goodFor: c.goodFor })), ...OWN_CARDS.map(({ tag, name, goodFor }) => ({ tag, name, goodFor }))],
  teams: Object.entries(SHIPPED_TEAMS).map(([key, t]) => ({ key, name: t.name, readOnly: /** @type {any} */ (t).readOnly === true })),
};
/** An agent box. @param {string} agent @param {string} words @param {any} [more] */
const ask = (agent, words, more = {}) => ({ agent, words, ...more });
/** A team box. @param {string} agent @param {string} words @param {any} [more] */
const teamBox = (agent, words, more = {}) => ({ kind: "team", agent, words, ...more });
/** The owner's example, each box naming what it needs (OA-D5). */
const EXAMPLE = {
  goal: "hey pm plan a desktop app … hey bug hunter once implementation is done check for bugs",
  title: "Plan a desktop app",
  steps: [
    { why: "The plan first.", boxes: [ask("pm", "Plan a desktop app.", { id: "plan" })] },
    { why: "Both read the plan.", boxes: [ask("engineer", "An architecture.", { id: "arch", needs: ["plan"] }), ask("designer", "Mocks if needed.", { id: "mocks", needs: ["plan"] })] },
    { why: "Check before building.", boxes: [ask("reviewer", "Check the plan.", { id: "check", gate: true, needs: ["plan", "arch", "mocks"] })] },
    { why: "Build on all of it.", boxes: [teamBox("builders", "Build it.", { id: "build", needs: ["plan", "arch", "mocks", "check"] })] },
    { why: "Hunt in the build.", boxes: [teamBox("bughunters", "Hunt.", { id: "hunt", needs: ["build"] })] },
  ],
};
/** A flow of plain steps, each box needing the step before's. @param {any[][]} steps */
const plain = (steps) => ({ ...EXAMPLE, steps: steps.map((boxes) => ({ boxes })) });

function world({ kind = "harness" } = {}) {
  /** @type {Map<string, Set<(m: any) => void>>} */
  const topics = new Map();
  const events = {
    /** @type {any[]} */ said: [],
    publish: (/** @type {string} */ topic, /** @type {any} */ msg) => {
      events.said.push({ topic, ...msg });
      for (const fn of topics.get(topic) || []) fn(msg);
    },
    subscribe: (/** @type {string} */ topic, /** @type {(m: any) => void} */ fn) => {
      if (!topics.has(topic)) topics.set(topic, new Set());
      topics.get(topic)?.add(fn);
      return () => topics.get(topic)?.delete(fn);
    },
  };
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", kind, meta: {} }]]);
  const w = {
    events,
    chains,
    /** @type {any[]} */ launched: [],
    /** @type {any[]} */ followed: [],
    /** @type {string[]} */ stopped: [],
    /** @type {Map<string, any>} */ subs: new Map(),
    /** @type {string | null} */ refuse: null,
    noFollow: false,
    full: false,
    /** @type {any[]} */ fired: [],
    /** Where teams beside make a flow's worktree (OA5): null makes none, as a fire with no `own` makes none. @type {((name: string) => any) | null} */ ownPlace: null,
    /** A fire held until the test lets it go, as git's worktree add and a lead's first call take their seconds. @type {Promise<void> | null} */ fireWait: null,
    /** The folders no longer there. @type {Set<string>} */ gone: new Set(),
    /** The team chats deleted. @type {Set<string>} */ deleted: new Set(),
    /** @type {Map<string, any>} */ rows: new Map(),
    /** @type {Record<string, any>} */ facts: {},
    /** @type {any[]} */ delivered: [],
    /** @type {any[]} */ notices: [],
    /** @type {any} */ how: "sent",
    /** @type {any[]} */ posted: [],
    /** What a turn posted to a chat answers: 200, or a refusal's status. */
    postStatus: 200,
    /** A refusal's body, where it says more than its words. @type {any} */ postBody: null,
    /** @type {any[]} */ alerts: [],
    /** The threads let go, and the team chats deleted, by a flow's delete. @type {any[][]} */ forgot: [],
    /** @type {any[][]} */ dropped: [],
    /** What a thread's forget answers: ok, else a refusal the delete counts out. @type {any} */ forgets: { ok: true, files: 0 },
    store: createFlowStore({ dir: null }),
    /** Settings › Experimental's Teams switch, as the runner reads it (core/teams-on.js). */ teams: true,
    /** @type {ReturnType<typeof createFlowRunner>} */ runner: /** @type {any} */ (null),
    /**
     * A sub-agent box's report. What it published and drew (`made`, `drew`) its thread keeps on its exchange, as the
     * registry's does — never in its outcome (HarnessV4_DesignPass_Plan, case 13: a fake that put them there hid that a
     * box's artifacts never reached its flow).
     * @param {string} id @param {string} report @param {any} [more]
     */
    end: async (id, report, more = {}) => {
      const { made, drew, ...rest } = more;
      const sub = w.subs.get(id);
      sub.exchange = { ...(made ? { made } : {}), ...(drew ? { drew } : {}) };
      sub.resolve({ ok: true, status: "done", report, spentUsd: 0.01, ...rest });
      await settled();
    },
    /** A team box's chat as it stands, said as teams beside say it. @param {string} id @param {string} state @param {any} [last] */
    team: async (id, state, last = null) => {
      w.rows.set(id, { id, state });
      if (last) w.facts[id] = { busy: false, asking: false, turns: last.n, last: { final: true, cut: false, failed: false, endedAt: NOW, ...last } };
      events.publish("turns", { type: "beside", main: "c1", id, what: "state" });
      await settled();
    },
    /** The newest launch of a card. @param {string} as */
    sub: (as) => [...w.launched].reverse().find((s) => s.spec.as === as),
  };
  const registry = {
    launch: (/** @type {any} */ spec) => {
      if (w.refuse) return { ok: false, error: w.refuse };
      const id = `s${w.launched.length + 1}`;
      /** @type {any} */
      const sub = { id, spec, waiting: spec.waits && w.full ? { words: "This chat runs at most 4 agents at once" } : null };
      const done = new Promise((res) => (sub.resolve = res));
      w.subs.set(id, sub);
      w.launched.push(sub);
      return { ok: true, id, done, tree: Promise.resolve(false) };
    },
    followUp: (/** @type {string} */ id, /** @type {any} */ o) => {
      const sub = w.subs.get(id);
      if (!sub || w.noFollow) return { ok: false, error: "let go" };
      const done = new Promise((res) => (sub.resolve = res));
      w.followed.push({ id, ...o });
      return { ok: true, id, done, marked: 0 };
    },
    stop: (/** @type {string} */ id) => {
      w.stopped.push(id);
      w.subs.get(id)?.resolve({ ok: false, status: "stopped", report: "" });
      return { ok: true };
    },
    get: (/** @type {string} */ id) => (w.subs.has(id) ? { id, waiting: w.subs.get(id).waiting, exchanges: [w.subs.get(id).exchange || {}] } : null),
    drewWords: (/** @type {string} */ chainId, /** @type {any[]} */ drew, /** @type {string} */ who) => `${who} drew ${drew.map((d) => `${d.title} (${d.bytes} bytes)`).join(", ")} in ${chainId}: open one by its name.`,
    notice: (/** @type {string} */ chainId, /** @type {any} */ n) => {
      w.notices.push({ chainId, ...n });
      return { ok: true };
    },
    forget: async (/** @type {string} */ id, /** @type {string} */ chainId) => {
      w.forgot.push([id, chainId]);
      return w.forgets;
    },
  };
  const besides = {
    fire: async (/** @type {string} */ main, /** @type {any} */ input) => {
      const id = `t${w.fired.length + 1}`;
      w.fired.push({ main, input, id });
      if (w.fireWait) await w.fireWait;
      w.rows.set(id, { id, state: "working" });
      const place = input.own?.use || (input.own?.name && w.ownPlace ? w.ownPlace(input.own.name) : null);
      return { id, state: "working", ...(place ? { place } : {}) };
    },
    stop: (/** @type {string} */ id) => {
      w.stopped.push(id);
      w.rows.set(id, { id, state: "stopped" });
      w.facts[id] = { last: { final: false, cut: false, failed: false } };
      queueMicrotask(() => events.publish("turns", { type: "beside", main: "c1", id, what: "state" }));
      return { turn: true, workers: 0 };
    },
    row: (/** @type {string} */ id) => w.rows.get(id) || null,
    list: (/** @type {string} */ main) => w.fired.filter((f) => f.main === main).map((f) => ({ ...w.rows.get(f.id), id: f.id, flow: f.input.flow || null })),
    drop: async (/** @type {string} */ id, /** @type {any} */ o) => {
      w.dropped.push([id, o]);
      return { ok: true, id };
    },
    deliverOwn: async (/** @type {string} */ main, /** @type {any} */ d) => {
      w.delivered.push({ main, ...d });
      return w.how;
    },
  };
  const archive = {
    getChain: (/** @type {string} */ id) => chains.get(id) || null,
    besideOf: (/** @type {string} */ main) => [...chains.values()].filter((c) => c.beside === main).map((c) => c.id),
    mergeMeta: (/** @type {string} */ id, /** @type {Record<string, any>} */ patch) => {
      const c = chains.get(id);
      if (!c) return null;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete c.meta[k];
        else c.meta[k] = v;
      }
      return c.meta;
    },
  };
  const make = () =>
    createFlowRunner({
      store: w.store,
      archive: () => archive,
      registry: () => registry,
      besides: () => besides,
      sessions: {
        besideFacts: (id) => {
          if (w.deleted.has(id)) throw new Error("no such session");
          return w.facts[id] || { last: null };
        },
        leadFacts: () => ({ usd: 0.5 }),
      },
      roster: () => ROSTER,
      postTurn: async (chain, body) => {
        w.posted.push({ chain, body });
        return w.postStatus === 200 ? { status: 200, body: null } : { status: w.postStatus, body: w.postBody || { error: "the chat refused it" } };
      },
      events,
      alert: (text, key) => w.alerts.push({ text, key }),
      now: () => NOW,
      saved: createSavedFlows({ dataDir: null }),
      here: (folder) => !w.gone.has(folder),
      teamsOn: () => w.teams,
    });
  w.runner = make();
  return Object.assign(w, { make });
}
/** @param {ReturnType<typeof world>} w @param {any} [input] */
const started = (w, input = EXAMPLE) => {
  const d = w.runner.create("c1", input);
  return w.runner.start("c1", d.id);
};

// (fails before: yes — the review of 4f02eeb86, the owner's word of 11-05 "include reasoning effort across every model
// picker": a box ran on the model drawn for it at no level drawn, as none could be)
describe("a box's effort", () => {
  test("a box drawn at a level keeps it, a review none and a word no level drops; its agent launches at it, a team's lead is fired at it", async () => {
    const w = world();
    const f = started(w, { goal: "plan and build", steps: [
      { boxes: [{ id: "plan", agent: "pm", words: "Plan it.", effort: "high" }, { id: "look", agent: "engineer", words: "Look.", effort: "turbo" }] },
      { boxes: [{ id: "build", team: "builders", words: "Build it.", needs: ["plan"], effort: "low" }] },
    ] });
    assert.deepEqual(f.steps.flatMap((/** @type {any} */ s) => s.boxes).map((/** @type {any} */ b) => [b.id, b.effort]), [["plan", "high"], ["look", undefined], ["build", "low"]]);
    assert.deepEqual(w.launched.map((s) => [s.spec.as, s.spec.effort]), [["pm", "high"], ["engineer", undefined]]);
    await w.end(w.sub("pm").id, "THE PLAN");
    await w.end(w.sub("engineer").id, "LOOKED");
    assert.deepEqual([w.fired.length, w.fired[0]?.input.team, w.fired[0]?.input.effort], [1, "builders", "low"]);
  });
  // (fails before: yes — the review of a8e034ded: a flow kept to start again, and the agent's edit of its title alone,
  // dropped each box's effort)
  test("a flow kept to start again keeps each box's effort, as an edit of its title alone does; the saved flows keep none for a review or a word no level", () => {
    const w = world();
    w.runner.asked("c1", "plan it");
    const d = w.runner.draftBy("c1", { title: "Plan and build", steps: [
      { boxes: [{ id: "plan", agent: "pm", words: "Plan it.", effort: "high" }] },
      { boxes: [{ id: "build", team: "builders", words: "Build it.", needs: ["plan"], effort: "low" }] },
    ] });
    const efforts = (/** @type {any} */ f) => f.steps.flatMap((/** @type {any} */ s) => s.boxes).map((/** @type {any} */ b) => b.effort);
    assert.deepEqual(efforts(w.runner.editBy("c1", { title: "Renamed" })), ["high", "low"]);
    assert.deepEqual(efforts(w.runner.keep("c1", d.id, { name: "Plan and build" })), ["high", "low"]);
    const kept = createSavedFlows({ dataDir: null }).save({ name: "Mixed", steps: [{ boxes: [{ kind: "review", effort: "high" }, { agent: "pm", effort: "turbo" }, { agent: "pm", effort: "max" }] }] });
    assert.deepEqual(kept.steps[0].boxes.map((b) => [b.kind, b.effort]), [["review", undefined], ["agent", undefined], ["agent", "max"]]);
  });
  // (fails before: yes — the owner's of 11-05: the main agent's steps sent whole, its flow tool's boxes carrying no model,
  // effort or reading, dropped what the person picked for every box)
  test("the main agent's steps sent whole keep each box's model, effort and reading where its id, kind and agent stand; a box it moves to another agent, or whose effort it names, takes what it says; the person's edit keeps only what it sends", () => {
    const w = world();
    w.runner.asked("c1", "plan it");
    const d = w.runner.draftBy("c1", { title: "Plan and build", steps: [
      { boxes: [{ id: "plan", agent: "pm", words: "Plan it.", model: "m-plan", effort: "high", sees: "folded" }, { id: "look", agent: "engineer", words: "Look.", model: "m-look", effort: "low" }] },
      { boxes: [{ id: "build", team: "builders", words: "Build it.", needs: ["plan", "look"], model: "m-team", effort: "max" }] },
    ] });
    const box = (/** @type {any} */ f, /** @type {string} */ id) => f.steps.flatMap((/** @type {any} */ s) => s.boxes).find((/** @type {any} */ b) => b.id === id);
    const e = w.runner.editBy("c1", { steps: [
      { boxes: [{ id: "plan", agent: "pm", words: "Plan it first." }, { id: "look", agent: "designer", words: "Look." }] },
      { boxes: [{ id: "build", team: "builders", words: "Build it.", needs: ["plan", "look"], effort: "medium" }] },
    ] });
    assert.deepEqual([box(e, "plan").words, box(e, "plan").model, box(e, "plan").effort, box(e, "plan").sees], ["Plan it first.", "m-plan", "high", "folded"]);
    assert.deepEqual([box(e, "look").agent, box(e, "look").model, box(e, "look").effort ?? null], ["designer", null, null], "picked for the engineer, not the designer");
    assert.deepEqual([box(e, "build").model, box(e, "build").effort], ["m-team", "medium"], "the effort it names, the model kept");
    const p = w.runner.edit("c1", d.id, { steps: [
      { boxes: [{ id: "plan", agent: "pm", words: "Plan it first." }, { id: "look", agent: "designer", words: "Look." }] },
      { boxes: [{ id: "build", team: "builders", words: "Build it.", needs: ["plan", "look"] }] },
    ] });
    assert.deepEqual([box(p, "plan").model, box(p, "plan").effort ?? null, box(p, "build").model], [null, null, null], "the person's sheet sends each box whole");
  });
  // (fails before: yes — the review of 7f95cc28e: an id flowOf cannot keep is numbered in order, so the old b1's picks
  // went to whichever box came first; and a second draft in the same ask dropped the first's)
  test("only an id the agent sent keeps a box's picks — one numbered in place of an id it cannot keep is a new box; steps sent as lists read as flowOf reads them; a model it names stands; a second draft in the same ask keeps the first's", () => {
    const w = world();
    w.runner.asked("c1", "plan it");
    w.runner.draftBy("c1", { title: "Plan and look", steps: [
      { boxes: [{ id: "plan_1", agent: "pm", words: "Plan it.", model: "m-plan", effort: "high" }] },
      { boxes: [{ id: "look_1", agent: "engineer", words: "Look.", model: "m-look" }] },
    ] });
    const box = (/** @type {any} */ f, /** @type {string} */ id) => f.steps.flatMap((/** @type {any} */ s) => s.boxes).find((/** @type {any} */ b) => b.id === id);
    const all = (/** @type {any} */ f) => f.steps.flatMap((/** @type {any} */ s) => s.boxes).map((/** @type {any} */ b) => [b.words, b.model, b.effort ?? null]);
    const e = w.runner.editBy("c1", { steps: [
      { boxes: [{ id: "research_0", agent: "pm", words: "Research." }] },
      { boxes: [{ id: "plan_1", agent: "pm", words: "Plan it." }] },
      { boxes: [{ id: "look_1", agent: "engineer", words: "Look." }] },
    ] });
    assert.deepEqual(all(e), [["Research.", null, null], ["Plan it.", null, null], ["Look.", null, null]], "b1 is the research now: the plan's picks are not its");
    const w2 = world();
    w2.runner.asked("c1", "plan it");
    w2.runner.draftBy("c1", { title: "Plan and look", steps: [
      { boxes: [{ id: "plan", agent: "pm", words: "Plan it.", model: "m-plan", effort: "high" }] },
      { boxes: [{ id: "look", agent: "engineer", words: "Look.", model: "m-look", effort: "low" }] },
    ] });
    const again = w2.runner.draftBy("c1", { title: "Plan and look", steps: [
      { boxes: [{ id: "plan", agent: "pm", words: "Plan it well." }] },
      { boxes: [{ id: "look", agent: "engineer", words: "Look.", model: "m-new" }] },
    ] });
    assert.deepEqual([box(again, "plan").model, box(again, "plan").effort, box(again, "look").model, box(again, "look").effort], ["m-plan", "high", "m-new", "low"], "the model it names stands; the rest is kept");
    const listed = w2.runner.editBy("c1", { steps: [[{ id: "plan", agent: "pm", words: "Plan." }], [{ id: "look", agent: "engineer", words: "Look." }]] });
    assert.deepEqual(all(listed), [["Plan.", "m-plan", "high"], ["Look.", "m-new", "low"]], "steps sent as lists");
  });
});
/** A box of a flow as the runner reads it now. @param {ReturnType<typeof world>} w @param {string} fid @param {string} name */
const boxNamed = (w, fid, name) => {
  const f = w.runner.get("c1", fid);
  return /** @type {any} */ (f.steps.flatMap((s) => s.boxes).find((b) => b.name === name));
};
/** A box of a flow by its id, as the runner reads it now: two boxes of one team share its name. @param {ReturnType<typeof world>} w @param {string} fid @param {string} id */
const boxWithId = (w, fid, id) => {
  const f = w.runner.get("c1", fid);
  return /** @type {any} */ (f.steps.flatMap((s) => s.boxes).find((b) => b.id === id));
};

describe("the owner's example, all well (case 1)", () => {
  test("step by step, each handed only what it needs; the team boxes fired with their hand-off; the start told, one end message", async () => {
    const w = world();
    const f = started(w);
    assert.equal(f.state, "running");
    assert.deepEqual(w.launched.map((s) => s.spec.as), ["pm"], "only the first step starts");
    // (OA-D8: Start tells the main agent the flow as it stands, once)
    assert.equal(w.notices.length, 1);
    assert.equal(w.notices[0].chainId, "c1");
    assert.ok(w.notices[0].text.startsWith(FLOW_START_HEAD));
    assert.match(w.notices[0].text, /- build: Builders \(team, writes\) · needs plan \(PM\), arch \(Engineer\), mocks \(Designer\), check \(Reviewer\)/);
    const pm = w.sub("pm");
    // (OA3: a box goes as its card, at its card's level — no verb, no level of the flow's own)
    assert.deepEqual([pm.spec.origin, "verb" in pm.spec, "may" in pm.spec, pm.spec.deliver, pm.spec.waits], ["flow", false, false, false, true]);
    assert.doesNotMatch(pm.spec.prompt, /flow-results/, "the first step is handed nothing");
    await w.end(pm.id, "THE PLAN");
    assert.deepEqual(w.launched.map((s) => s.spec.as), ["pm", "engineer", "designer"], "step 2's boxes side by side");
    assert.match(w.sub("engineer").spec.prompt, /<flow-result step="1" box="PM" kind="agent">\nTHE PLAN/);
    await w.end(w.sub("engineer").id, "THE ARCHITECTURE");
    assert.equal(w.launched.length, 3, "the step waits for its slowest box");
    await w.end(w.sub("designer").id, "TWO MOCKS", { made: [{ name: "tray", v: 1, title: "Tray card", address: "http://tray.art.localhost:20300/" }], drew: [{ id: "toolu_m1", title: "tray_card", bytes: 2048, session: true }] });
    const gate = w.sub("reviewer");
    assert.ok(gate.spec.prompt.endsWith(VERDICT_RULE));
    assert.match(gate.spec.prompt, /THE PLAN[\s\S]*THE ARCHITECTURE[\s\S]*TWO MOCKS[\s\S]*Tray card — http:\/\/tray\.art\.localhost:20300\//);
    await w.end(gate.id, "Verdict: go\n\nIt holds.");
    assert.equal(w.fired.length, 1);
    const build = w.fired[0];
    assert.deepEqual([build.input.team, build.input.by, build.input.flow.box, build.input.notify, build.input.verify], ["builders", "flow", "build", false, false]);
    assert.match(build.input.ask, /^Your part: Build it\./);
    assert.match(build.input.handoff, /THE PLAN[\s\S]*TWO MOCKS[\s\S]*verdict="go"/);
    await w.team("t1", "done", { n: 2, text: "Built: the tray and the alerts." });
    assert.equal(w.fired.length, 2);
    // (OA3 case 1: the hunt needs the build alone)
    assert.match(w.fired[1].input.handoff, /Built: the tray and the alerts\./);
    assert.doesNotMatch(w.fired[1].input.handoff, /THE PLAN|THE ARCHITECTURE/);
    assert.equal(w.delivered.length, 0, "nothing but the start's notice reaches the main agent before the end (FL-D10)");
    await w.team("t2", "done", { n: 1, text: "Findings:\n- Found | a bug | a.js:1 | read it", drew: [{ id: "v9", title: "bug_map", bytes: 900, turn: 1 }] });
    const end = w.runner.get("c1", f.id);
    assert.equal(end.state, "done");
    assert.equal(w.delivered.length, 1, "one message at the end (FL-D11)");
    assert.ok(w.delivered[0].text.startsWith(FLOW_END_HEAD));
    assert.match(w.delivered[0].text, /<flow-result step="5" box="BugHunters">\nFindings:/);
    // (fails before: yes — HarnessV4_DesignPass_Plan, case 13: a box's artifacts and pictures never reached its flow, so its
    // end said nothing of them) Each box's line counts them, and the end names the pictures as the registry words them.
    assert.match(w.delivered[0].text, /Designer \(agent\) — done, 1 artifact, 1 picture/);
    assert.match(w.delivered[0].text, /BugHunters \([^)]*\) — done, 1 picture/);
    assert.match(w.delivered[0].text, /\n\nIts boxes drew tray_card \(2048 bytes\), bug_map \(900 bytes\) in c1: open one by its name\.\n<\/flow-end>$/);
    assert.deepEqual(boxNamed(w, f.id, "Designer").result.drew, [{ title: "tray_card", bytes: 2048 }]);
    assert.deepEqual(end.end?.sent, { at: NOW, how: "sent" });
    assert.ok(w.alerts.some((a) => /is done/.test(a.text)));
    assert.equal(w.notices.length, 1, "the start is told once");
    // Each box's spend: an ask's report's, a team chat's own.
    assert.equal(boxNamed(w, f.id, "PM").usd, 0.01);
    assert.equal(boxNamed(w, f.id, "Builders").usd, 0.5);
  });
  test("a box drawn Reads only goes reading only; the view says what each box needs, and which need does not hold", () => {
    const w = world();
    const f = started(w, { ...EXAMPLE, steps: [{ boxes: [ask("pm", "Plan.", { readOnly: true })] }, { boxes: [ask("skeptic", "Doubt.")] }] });
    assert.equal(w.sub("pm").spec.may, "read");
    assert.deepEqual(boxNamed(w, f.id, "Skeptic").needsOf, [{ id: "b1", name: "PM" }]);
    const d = w.runner.create("c1", { ...EXAMPLE, steps: [{ boxes: [ask("pm", "Plan.", { id: "plan", needs: ["doubt"] }), ask("skeptic", "Doubt.", { id: "doubt", needs: [] })] }, { boxes: [ask("scout", "Read.")] }] });
    assert.deepEqual(d.steps[0].boxes[0].broken, ["Skeptic"]);
    assert.match(String(d.problem), /PM \(step 1\) needs Skeptic \(step 1\)/);
    assert.equal(d.steps[0].why, "");
  });
});

describe("gates (cases 2, 3)", () => {
  /** The example up to its gate's answer. @param {string} answer */
  const atGate = async (answer) => {
    const w = world();
    const f = started(w);
    await w.end(w.sub("pm").id, "PLAN");
    await w.end(w.sub("engineer").id, "ARCH");
    await w.end(w.sub("designer").id, "MOCKS");
    await w.end(w.sub("reviewer").id, answer);
    return { w, f };
  };
  test("not yet holds and asks; Send back to Engineer with a line: a follow-up, then the gate reads again; go goes on", async () => {
    const { w, f } = await atGate("Verdict: not yet — two files it names do not exist");
    let v = w.runner.get("c1", f.id);
    assert.equal(v.state, "holds");
    assert.deepEqual(v.hold, { kind: "gate", box: "check" });
    assert.equal(v.line, "Flow · step 3 of 5 · Reviewer asks you");
    assert.deepEqual(boxNamed(w, f.id, "Reviewer").verdict, { go: false, why: "two files it names do not exist" });
    assert.ok(w.alerts.some((a) => /Reviewer says not yet/.test(a.text)));
    assert.equal(w.fired.length, 0, "the build waits");
    v = w.runner.decide("c1", f.id, { action: "back", to: "arch", line: "keep the tray out" });
    assert.equal(v.state, "running");
    assert.equal(w.followed.length, 1);
    assert.equal(w.followed[0].id, w.sub("engineer").id, "its own exchange, while the registry holds it");
    assert.equal(w.followed[0].by, "flow");
    assert.match(w.followed[0].prompt, /two files it names do not exist[\s\S]*The person's line: keep the tray out/);
    assert.equal(boxNamed(w, f.id, "Engineer").sentBack, 1);
    // (the gate counts what it sent back, which its card says: "sent back once")
    assert.deepEqual([boxNamed(w, f.id, "Reviewer").sends, boxNamed(w, f.id, "Reviewer").sentBack], [1, 0]);
    assert.equal(boxNamed(w, f.id, "Reviewer").state, "waits");
    assert.equal(boxNamed(w, f.id, "Reviewer").past.length, 1);
    await w.end(w.sub("engineer").id, "ARCH, AGAIN");
    const second = w.sub("reviewer");
    assert.notEqual(second.id, "s4", "the gate reads afresh");
    assert.match(second.spec.prompt, /ARCH, AGAIN/);
    assert.match(second.spec.prompt, /MOCKS/, "the box not sent back keeps its result");
    await w.end(second.id, "Verdict: go");
    assert.equal(w.fired.length, 1, "the build starts");
    // (fails before: yes — the gate's first sub-agent was forgotten, and its thread stood apart from the flow on the page)
    assert.deepEqual(boxNamed(w, f.id, "Reviewer").ran, ["s4"], "the gate's first run is kept beside its second");
  });
  test("no verdict line holds the flow as not yet does; Go on anyway goes on", async () => {
    const { w, f } = await atGate("Looks fine overall.");
    assert.equal(w.runner.get("c1", f.id).state, "holds");
    assert.equal(boxNamed(w, f.id, "Reviewer").verdict, null);
    assert.ok(w.alerts.some((a) => /no verdict/.test(a.text)));
    w.runner.decide("c1", f.id, { action: "on" });
    await settled();
    assert.equal(w.fired.length, 1);
  });
  test("a send-back the registry can no longer follow up starts the box afresh, with its ask and the gate's answer", async () => {
    const { w, f } = await atGate("Verdict: not yet — no");
    w.noFollow = true;
    w.runner.decide("c1", f.id, { action: "back", to: "mocks", line: "" });
    const again = w.sub("designer");
    assert.equal(again.id, "s5", "a launch of its own after the gate's s4");
    assert.equal(boxNamed(w, f.id, "Designer").ran?.length, 1, "the run it could not follow up is kept");
    assert.match(again.spec.prompt, /Your part: Mocks if needed\.[\s\S]*<flow-gate box="Reviewer">/);
  });
  test("a send-back names a box the gate needs — the plan two steps up too — and only while it waits there", async () => {
    const { w, f } = await atGate("Verdict: not yet — x");
    assert.throws(() => w.runner.decide("c1", f.id, { action: "back", to: "hunt" }), /send it back to a box the gate needs/);
    w.runner.decide("c1", f.id, { action: "back", to: "plan", line: "" });
    assert.equal(boxNamed(w, f.id, "PM").sentBack, 1);
    assert.throws(() => w.runner.decide("c1", f.id, { action: "on" }), /does not wait at a gate now/);
  });
});

describe("your review (OA-D10)", () => {
  const REVIEWED = {
    goal: "g",
    title: "Reviewed",
    steps: [
      { boxes: [ask("pm", "Plan.", { id: "plan" })] },
      { boxes: [ask("engineer", "Arch.", { id: "arch", needs: ["plan"] })] },
      { why: "You look before the build.", boxes: [{ id: "you", review: true, words: "Is the plan right?", needs: ["plan", "arch"] }] },
      { boxes: [teamBox("builders", "Build.", { id: "build", needs: ["plan", "arch", "you"] })] },
    ],
  };
  /** The flow up to your review. */
  const atReview = async () => {
    const w = world();
    const f = started(w, REVIEWED);
    await w.end(w.sub("pm").id, "PLAN");
    await w.end(w.sub("engineer").id, "ARCH");
    return { w, f };
  };
  test("its step asks you, with an alert, and nothing after it runs; Go on hands on your line", async () => {
    const { w, f } = await atReview();
    const v = w.runner.get("c1", f.id);
    assert.equal(v.state, "running", "your review holds the flow as running, never cut by a restart");
    assert.equal(boxNamed(w, f.id, "Your review").state, "asking");
    assert.equal(v.line, "Flow · step 3 of 4 · your review");
    assert.ok(w.alerts.some((a) => /Your review in your flow "Reviewed"/.test(a.text)));
    assert.equal(w.fired.length, 0);
    assert.throws(() => w.runner.box("c1", f.id, "you", "stop"), /your review has no run to stop/);
    assert.throws(() => w.runner.decide("c1", f.id, { action: "on", box: "you", line: "x".repeat(700) }), /your line is 600 characters at most/);
    w.runner.decide("c1", f.id, { action: "on", box: "you", line: "keep it small" });
    await settled();
    assert.equal(boxNamed(w, f.id, "Your review").state, "done");
    assert.equal(w.fired.length, 1);
    assert.match(w.fired[0].input.handoff, /box="Your review" kind="review">\nThe person reviewed the work before this point and went on, with a line of theirs: keep it small/);
    assert.throws(() => w.runner.decide("c1", f.id, { action: "on", box: "you" }), /your review does not wait now/);
  });
  test("Send back to a box it needs: it goes again with your line, then you review again; never a box it does not need", async () => {
    const { w, f } = await atReview();
    assert.throws(() => w.runner.decide("c1", f.id, { action: "back", box: "you", to: "build" }), /send it back to a box your review needs/);
    w.runner.decide("c1", f.id, { action: "back", box: "you", to: "arch", line: "smaller" });
    assert.equal(boxNamed(w, f.id, "Your review").state, "waits");
    assert.equal(w.followed.length, 1);
    assert.equal(w.followed[0].id, w.sub("engineer").id);
    assert.match(w.followed[0].prompt, /the person reviewed it and sent it back with a line of their own[\s\S]*The person's line: smaller/);
    assert.doesNotMatch(w.followed[0].prompt, /<flow-gate/);
    assert.equal(boxNamed(w, f.id, "Engineer").sentBack, 1);
    await w.end(w.sub("engineer").id, "ARCH, SMALLER");
    assert.equal(boxNamed(w, f.id, "Your review").state, "asking", "you review again");
    assert.equal(boxNamed(w, f.id, "Your review").sends, 1, "and its card says you sent back once");
    assert.equal(w.fired.length, 0);
  });
  // (fails before: yes — the bug round of 10-23: a send-back that named a review launched Helper in its place)
  test("a review is never sent back: from a gate or from another review, it is refused in words", async () => {
    const w = world();
    const f = started(w, {
      goal: "g",
      title: "Two looks",
      steps: [
        { boxes: [ask("pm", "Plan.", { id: "plan" })] },
        { boxes: [{ id: "you", review: true, words: "Right?", needs: ["plan"] }] },
        { boxes: [ask("skeptic", "Gate.", { id: "check", gate: true, needs: ["plan", "you"] })] },
        { boxes: [{ id: "again", review: true, words: "Still right?", needs: ["plan", "you"] }] },
      ],
    });
    await w.end(w.sub("pm").id, "PLAN");
    w.runner.decide("c1", f.id, { action: "on", box: "you", line: "" });
    await settled();
    await w.end(w.sub("skeptic").id, "Verdict: not yet — x");
    const launched = w.launched.length;
    assert.throws(() => w.runner.decide("c1", f.id, { action: "back", to: "you", line: "" }), /a review is not sent back: it has no run of its own — send back a box it needs that works/);
    assert.equal(w.runner.get("c1", f.id).state, "holds", "the gate still waits");
    w.runner.decide("c1", f.id, { action: "on" });
    await settled();
    assert.throws(() => w.runner.decide("c1", f.id, { action: "back", box: "again", to: "you", line: "" }), /a review is not sent back/);
    assert.equal(w.launched.length, launched, "nothing launched in a review's place");
    w.runner.decide("c1", f.id, { action: "back", box: "again", to: "plan", line: "smaller" });
    assert.equal(w.followed.at(-1)?.id, w.sub("pm").id, "a box that works goes back");
  });

  test("Stop the flow at your review; a restart leaves it waiting for you", async () => {
    const { w, f } = await atReview();
    w.runner.close();
    w.runner = w.make();
    assert.equal(w.runner.reconcile(), 0);
    assert.equal(boxNamed(w, f.id, "Your review").state, "asking");
    const v = w.runner.decide("c1", f.id, { action: "stop", box: "you" });
    assert.equal(v.state, "stopped");
    assert.equal(boxNamed(w, f.id, "Your review").state, "stopped");
  });
});

describe("a box that fails, is stopped or skipped (cases 4, 5, 6)", () => {
  test("Failed holds the flow with why; Retry starts it again; Skip hands on nothing and the next is told", async () => {
    const w = world();
    const f = started(w);
    w.subs.get(w.sub("pm").id).resolve({ ok: false, status: "failed", error: "its key is out", report: "" });
    await settled();
    let v = w.runner.get("c1", f.id);
    assert.equal(v.state, "holds");
    assert.deepEqual(v.hold, { kind: "box", box: "plan" });
    assert.equal(boxNamed(w, f.id, "PM").error, "its key is out");
    assert.ok(w.alerts.some((a) => /PM failed/.test(a.text)));
    v = w.runner.box("c1", f.id, "plan", "retry");
    assert.equal(v.state, "running");
    assert.equal(w.launched.filter((s) => s.spec.as === "pm").length, 2);
    w.subs.get(w.sub("pm").id).resolve({ ok: false, status: "failed", error: "again", report: "" });
    await settled();
    w.runner.box("c1", f.id, "plan", "skip");
    await settled();
    assert.equal(boxNamed(w, f.id, "PM").state, "skipped");
    assert.match(w.sub("engineer").spec.prompt, /box="PM" kind="agent" skipped="yes">\nThe person skipped this box/);
  });
  test("a launch refused at its start fails its box in its words", async () => {
    const w = world();
    w.refuse = "there is no agent `@pm`";
    const f = started(w);
    assert.equal(w.runner.get("c1", f.id).state, "holds");
    assert.match(String(boxNamed(w, f.id, "PM").error), /could not start: there is no agent/);
  });
  test("Stop the flow: every box at work stops; it says stopped, and moves no more", async () => {
    const w = world();
    const f = started(w);
    await w.end(w.sub("pm").id, "PLAN");
    const v = w.runner.stop("c1", f.id);
    assert.equal(v.state, "stopped");
    assert.deepEqual(w.stopped, [w.sub("engineer").id, w.sub("designer").id]);
    await settled();
    assert.equal(boxNamed(w, f.id, "Engineer").state, "stopped");
    assert.equal(w.launched.length, 3, "nothing after it starts");
    assert.throws(() => w.runner.stop("c1", f.id), /has ended/);
  });
  test("one box stopped: it says stopped, the flow holds for it once its step is done; a team box skipped stops its chat", async () => {
    const w = world();
    const f = started(w);
    await w.end(w.sub("pm").id, "PLAN");
    w.runner.box("c1", f.id, "mocks", "stop");
    await settled();
    assert.equal(boxNamed(w, f.id, "Designer").state, "stopped");
    assert.equal(w.runner.get("c1", f.id).state, "running", "its neighbour still works");
    await w.end(w.sub("engineer").id, "ARCH");
    assert.equal(w.runner.get("c1", f.id).state, "holds");
    w.runner.box("c1", f.id, "mocks", "skip");
    await w.end(w.sub("reviewer").id, "Verdict: go");
    assert.equal(w.fired.length, 1);
    await settled();
    w.runner.box("c1", f.id, "build", "skip");
    await settled();
    assert.ok(w.stopped.includes("t1"));
    assert.equal(boxNamed(w, f.id, "Builders").state, "skipped");
    assert.equal(w.fired.length, 2, "the hunt starts, told the build was skipped");
    assert.match(w.fired[1].input.handoff, /box="Builders" kind="team" skipped="yes"/);
  });
});

describe("a restart (case 7, FL-D19)", () => {
  test("a running flow says Stopped by a restart; nothing goes on by itself; Go on resumes its team box and starts its cut asks again", async () => {
    const w = world();
    const f = started(w, plain([[ask("pm", "Plan a desktop app.")], [teamBox("builders", "An architecture.", { readOnly: true }), ask("skeptic", "Doubt it.")]]));
    await w.end(w.sub("pm").id, "PLAN");
    assert.equal(w.fired.length, 1);
    assert.equal(w.fired[0].input.readOnly, true);
    // Filament restarts: a new runner over the same store.
    w.runner.close();
    w.runner = w.make();
    assert.equal(w.runner.reconcile(), 1);
    let v = w.runner.get("c1", f.id);
    assert.equal(v.state, "cut");
    assert.equal(v.line, "Flow · step 2 of 2 · stopped by a restart");
    assert.deepEqual(v.steps[1].boxes.map((b) => b.state), ["cut", "cut"]);
    assert.equal(boxNamed(w, f.id, "PM").state, "done", "done boxes stay done");
    assert.equal(w.posted.length, 0, "nothing goes on by itself");
    v = w.runner.goOn("c1", f.id);
    await settled();
    assert.equal(v.state, "running");
    // (fails before: yes — it went on as Filament's own resume, which its chat drew as Filament going on by itself)
    assert.deepEqual(w.posted, [{ chain: "t1", body: { content: [{ type: "text", text: GO_ON_LINE }], by: "flow" } }], "the team chat goes on from where it was cut, on the flow's line");
    assert.equal(w.launched.filter((s) => s.spec.as === "skeptic").length, 2, "the cut ask starts again");
    await w.team("t1", "done", { n: 2, text: "THE ARCHITECTURE" });
    await w.end(w.sub("skeptic").id, "DOUBTS");
    assert.equal(w.runner.get("c1", f.id).state, "done");
  });
  test("a flow that waited at its gate still waits after a restart", async () => {
    const w = world();
    const f = started(w, plain([[ask("pm", "Plan a desktop app.")], [ask("skeptic", "Check.", { gate: true })], [teamBox("bughunters", "Hunt.")]]));
    await w.end(w.sub("pm").id, "PLAN");
    await w.end(w.sub("skeptic").id, "Verdict: not yet — no");
    w.runner.close();
    w.runner = w.make();
    assert.equal(w.runner.reconcile(), 0);
    assert.equal(w.runner.get("c1", f.id).state, "holds");
  });
  test("an end message that waited when Filament stopped is offered again; Send sends it", async () => {
    const w = world();
    w.how = "waits";
    const f = started(w, plain([[ask("pm", "Plan a desktop app.")], [ask("skeptic", "Doubt.")]]));
    await w.end(w.sub("pm").id, "PLAN");
    await w.end(w.sub("skeptic").id, "DOUBT");
    assert.deepEqual([w.runner.get("c1", f.id).end?.waits, w.runner.get("c1", f.id).end?.lost], [true, false]);
    w.runner.close();
    w.runner = w.make();
    assert.deepEqual([w.runner.get("c1", f.id).end?.waits, w.runner.get("c1", f.id).end?.lost], [false, true]);
    w.how = "sent";
    w.runner.send("c1", f.id);
    await settled();
    assert.equal(w.delivered.length, 2);
    assert.equal(w.runner.get("c1", f.id).end?.sent?.how, "sent");
    assert.throws(() => w.runner.send("c1", f.id), /went already/);
  });
});

describe("team boxes that need the person (cases 10, 11, 12)", () => {
  /** The example up to its build. */
  const atBuild = async () => {
    const w = world();
    const f = started(w);
    await w.end(w.sub("pm").id, "PLAN");
    await w.end(w.sub("engineer").id, "ARCH");
    await w.end(w.sub("designer").id, "MOCKS");
    await w.end(w.sub("reviewer").id, "Verdict: go");
    return { w, f };
  };
  test("its lead asks: Asks you, with an alert; nothing is handed on until it ends", async () => {
    const { w, f } = await atBuild();
    await w.team("t1", "asking");
    assert.equal(boxNamed(w, f.id, "Builders").state, "asking");
    assert.equal(w.runner.get("c1", f.id).line, "Flow · step 4 of 5 · Builders asks you");
    assert.ok(w.alerts.some((a) => /Builders asks you/.test(a.text)));
    await w.team("t1", "working");
    await w.team("t1", "done", { n: 3, text: "Built." });
    assert.equal(w.fired.length, 2);
  });
  test("a reply that ends on a question asks you; Hand on anyway hands it on", async () => {
    const { w, f } = await atBuild();
    await w.team("t1", "done", { n: 2, text: "Built most of it.\n\nShould I use NSIS or MSI?" });
    assert.equal(boxNamed(w, f.id, "Builders").state, "asking");
    assert.equal(w.fired.length, 1);
    w.runner.box("c1", f.id, "build", "hand-on");
    await settled();
    assert.equal(w.fired.length, 2);
    assert.match(w.fired[1].input.handoff, /Should I use NSIS or MSI\?/);
  });
  test("the reply it ended on is kept; Hand on this reply takes a newer one, before the next step starts", async () => {
    const w = world();
    const f = started(w, plain([[ask("pm", "Plan a desktop app.")], [teamBox("builders", "Build it.")], [ask("skeptic", "Gate.", { gate: true })]]));
    await w.end(w.sub("pm").id, "PLAN");
    await w.team("t1", "done", { n: 2, text: "BUILT v1" });
    // The person talks to the lead afterwards: its newer reply is theirs, not the flow's.
    w.facts.t1 = { last: { n: 3, final: true, text: "BUILT v2" } };
    await w.team("t1", "done");
    assert.equal(boxNamed(w, f.id, "Builders").result.text, "BUILT v1");
    assert.throws(() => w.runner.box("c1", f.id, boxNamed(w, f.id, "Builders").id, "take"), /the step after it has started/);
  });
});

describe("seats, edits and the draft (cases 13, 15, 17, 18)", () => {
  test("a box with no free seat says so, and is at work once the registry starts it", async () => {
    const w = world();
    w.full = true;
    const f = started(w);
    assert.equal(boxNamed(w, f.id, "PM").state, "seat");
    assert.equal(boxNamed(w, f.id, "PM").waiting, "This chat runs at most 4 agents at once");
    assert.equal(w.runner.get("c1", f.id).line, "Flow · step 1 of 5 · waits for a seat");
    w.subs.get(w.sub("pm").id).waiting = null;
    w.events.publish("subagents", { type: "subagent", chainId: "c1", id: w.sub("pm").id, status: "running" });
    assert.equal(boxNamed(w, f.id, "PM").state, "working");
  });
  test("while it runs, the steps after the one it is at can change; those before cannot", async () => {
    const w = world();
    const f = started(w);
    const steps = structuredClone(w.runner.get("c1", f.id).steps);
    steps[0].boxes[0].words = "changed";
    steps.splice(4, 1);
    const v = w.runner.edit("c1", f.id, { steps });
    assert.equal(v.steps.length, 4);
    assert.equal(v.steps[0].boxes[0].words, "Plan a desktop app.", "the running step stays");
    assert.deepEqual(v.steps[3].boxes[0].needs, ["plan", "arch", "mocks", "check"], "its needs stay with it");
    assert.throws(() => w.runner.edit("c1", f.id, { steps: [steps[0]] }), /a flow of one box/);
  });
  // (fails before: yes — the bug round of 10-23: the first step an edit gave needed nothing, not the step before it)
  test("an edit while it runs: a box of the first step to come that names no needs needs the step before it", async () => {
    const w = world();
    const f = started(w);
    const steps = structuredClone(w.runner.get("c1", f.id).steps);
    steps.splice(1, 0, { why: "A look first.", boxes: [ask("skeptic", "Look at the plan.", { id: "look" })] });
    const v = w.runner.edit("c1", f.id, { steps });
    assert.equal(v.steps[1].boxes[0].id, "look");
    assert.deepEqual(v.steps[1].boxes[0].needs, ["plan"], "it needs the step it follows, as a draft's would");
  });
  // (fails before: yes — the owner's ask of 10-23: a flow went off the list and left its threads and its teams' chats)
  test("deleted from the Agents tab: refused until it ended; then the flow, each thread its boxes ran and its teams' chats go with it", async () => {
    const w = world();
    const f = started(w);
    await assert.rejects(w.runner.removeAll("c1", f.id), /the flow has not ended: stop it first/);
    assert.deepEqual([w.forgot, w.dropped, w.runner.list("c1").length], [[], [], 1], "nothing went");
    await w.end(w.sub("pm").id, "THE PLAN");
    await w.end(w.sub("engineer").id, "THE ARCHITECTURE");
    await w.end(w.sub("designer").id, "TWO MOCKS");
    await w.end(w.sub("reviewer").id, "Verdict: go\n\nIt holds.");
    await w.team("t1", "done", { n: 2, text: "Built." });
    await w.team("t2", "done", { n: 1, text: "Findings: none" });
    assert.equal(w.runner.get("c1", f.id).state, "done");
    // A team beside the chat that is no box of this flow stays.
    w.fired.push({ main: "c1", input: { team: "bughunters" }, id: "t9" });
    const out = await w.runner.removeAll("c1", f.id);
    assert.deepEqual(out, { ok: true, threads: 4, teams: 2 });
    assert.deepEqual(w.forgot, [["s1", "c1"], ["s2", "c1"], ["s3", "c1"], ["s4", "c1"]]);
    assert.deepEqual(w.dropped, [["t1", { flow: true }], ["t2", { flow: true }]], "its teams' chats, as a flow's");
    assert.equal(w.runner.list("c1").length, 0);
    assert.ok(w.events.said.some((m) => m.topic === "turns" && m.type === "flow" && m.id === f.id && m.state === "removed"));
  });
  // (fails before: yes — the owner's ask of 10-23)
  test("a draft deleted: nothing of it ran, nothing else goes; a thread that will not go is counted out, and the flow goes all the same", async () => {
    const w = world();
    const d = w.runner.create("c1", EXAMPLE);
    assert.deepEqual(await w.runner.removeAll("c1", d.id), { ok: true, threads: 0, teams: 0 });
    assert.deepEqual([w.forgot, w.dropped, w.runner.list("c1").length], [[], [], 0]);
    const v = world();
    const f = started(v);
    await v.end(v.sub("pm").id, "THE PLAN");
    v.runner.stop("c1", f.id);
    await settled();
    v.forgets = { ok: false, status: 409, error: "the chat's task graph still asks for it" };
    const out = await v.runner.removeAll("c1", f.id);
    assert.equal(out.threads, 0, "each refused, none counted");
    assert.ok(v.forgot.length >= 1);
    assert.equal(v.runner.list("c1").length, 0);
  });
  test("a team's own chat draws no flow; a draft that does not hold is refused at Start, in its words, and tells nobody", async () => {
    const t = world({ kind: "team" });
    assert.throws(() => t.runner.create("c1", EXAMPLE), /a team's own chat draws no flow/);
    assert.throws(() => t.runner.draftBy("c1", EXAMPLE), /a team's own chat draws no flow/);
    const w = world();
    const d = w.runner.create("c1", plain([[teamBox("builders", "a"), teamBox("builders", "b")]]));
    assert.match(String(d.problem), /two writers side by side change the same files/);
    assert.throws(() => w.runner.start("c1", d.id), /two writers side by side change the same files/);
    assert.equal(w.notices.length, 0);
    assert.equal(w.runner.remove("c1", d.id).ok, true);
    assert.equal(w.runner.list("c1").length, 0);
  });
  test("a saved flow: the one that ships drafts with the person's words, its needs and whys with it; a drawn one is kept and drafts again", async () => {
    const w = world();
    const d = w.runner.fromSaved("c1", "plan-check-build-hunt", "a desktop app for the harness");
    assert.deepEqual([d.drawn, d.title, d.goal, d.steps.length, d.problem], ["saved", "Plan, check, build, hunt", "a desktop app for the harness", 5, null]);
    assert.deepEqual(d.steps.map((s) => s.boxes.map((b) => [b.id, b.needs])), [[["plan", []]], [["arch", ["plan"]], ["mocks", ["plan"]]], [["check", ["plan", "arch", "mocks"]]], [["build", ["plan", "arch", "mocks", "check"]]], [["hunt", ["build"]]]]);
    assert.match(d.steps[2].why, /the Reviewer's not yet holds the flow/);
    // ("Teams, improved and kept" of 11-03: Product plans and draws the screens, a Builder the architecture, the Reviewer is the gate)
    assert.deepEqual(d.steps.map((s) => s.boxes.map((b) => b.agent)), [["product"], ["builder", "product"], ["reviewer"], ["builders"], ["bughunters"]]);
    const kept = w.runner.keep("c1", d.id, { name: "My plan flow" });
    assert.equal(kept.key, "my-plan-flow");
    const again = w.runner.fromSaved("c1", "my-plan-flow", "again");
    assert.equal(again.steps[2].boxes[0].gate, true);
    assert.deepEqual(again.steps[4].boxes[0].needs, ["build"]);
    assert.equal(again.steps[1].why, d.steps[1].why);
    assert.throws(() => w.runner.fromSaved("c1", "nope", "x"), /no saved flow answers to "nope"/);
  });
});

describe("the main agent's draft (OA3, OA-D6)", () => {
  const STEPS = [
    { why: "The plan first.", boxes: [{ id: "plan", agent: "pm", words: "Plan the engine" }] },
    { why: "The build reads the plan.", boxes: [{ id: "build", team: "builders", words: "Build it", needs: ["plan"] }] },
  ];
  test("only after a /flow; its words the goal; nothing runs; a second draft in the same ask replaces the first", () => {
    const w = world();
    assert.throws(() => w.runner.draftBy("c1", { steps: STEPS }), /a flow is drawn only when the person asks for one with \/flow/);
    w.runner.asked("c1", "plan and build a game engine");
    assert.deepEqual(w.chains.get("c1").meta.flowAsk, { goal: "plan and build a game engine", at: NOW, drafted: null });
    const d = w.runner.draftBy("c1", { title: "Game engine", steps: STEPS });
    assert.deepEqual([d.state, d.drawn, d.title, d.goal], ["draft", "agent", "Game engine", "plan and build a game engine"]);
    assert.equal(w.chains.get("c1").meta.flowAsk.drafted, d.id);
    assert.equal(w.launched.length + w.fired.length + w.notices.length, 0, "nothing runs before Start (FL-D2)");
    assert.ok(w.events.said.some((m) => m.type === "flow"), "the page hears of it");
    const again = w.runner.draftBy("c1", { title: "Game engine, again", steps: STEPS });
    assert.equal(again.id, d.id);
    assert.equal(w.runner.list("c1").length, 1);
    assert.equal(w.runner.get("c1", d.id).title, "Game engine, again");
  });
  // (OA3 cases 2, 3, 4: a stranger, a need out of order, two writers)
  test("checked whole: a refusal says why in words, and the draft that stands stays as it was", () => {
    const w = world();
    w.runner.asked("c1", "plan it");
    const d = w.runner.draftBy("c1", { title: "First", steps: STEPS });
    assert.throws(() => w.runner.draftBy("c1", { steps: [{ boxes: [{ agent: "qa", words: "Test it" }] }, STEPS[1]] }), /no agent of the person's is called "qa": theirs are /);
    assert.throws(() => w.runner.draftBy("c1", { steps: [{ boxes: [{ id: "plan", agent: "pm", words: "p", needs: ["build"] }, { id: "build", team: "builders", words: "b" }] }] }), /PM \(step 1\) needs Builders \(step 1\)/);
    assert.throws(() => w.runner.draftBy("c1", { steps: [STEPS[0], { boxes: [{ team: "builders", words: "a" }, { team: "builders", words: "b" }] }] }), /two writers side by side change the same files/);
    assert.equal(w.runner.get("c1", d.id).title, "First");
    assert.equal(w.runner.list("c1").length, 1);
  });
  // (fails before: yes — the bug round of 10-23: the /flow stood after its draft started or went, so the agent could
  // draw a second flow from the same ask)
  test("its draft started or removed, the /flow is answered: no second flow is drawn from it", () => {
    const w = world();
    w.runner.asked("c1", "plan it");
    const d = w.runner.draftBy("c1", { steps: STEPS });
    w.runner.start("c1", d.id);
    assert.equal(w.chains.get("c1").meta.flowAsk, undefined);
    assert.throws(() => w.runner.draftBy("c1", { steps: STEPS }), /only when the person asks for one with \/flow/);
    w.runner.asked("c1", "plan it again");
    const hand = w.runner.create("c1", { goal: "by hand", steps: STEPS });
    w.runner.remove("c1", hand.id);
    assert.equal(w.chains.get("c1").meta.flowAsk?.goal, "plan it again", "a flow it was not drafted as leaves it");
    const e = w.runner.draftBy("c1", { steps: STEPS });
    w.runner.remove("c1", e.id);
    assert.equal(w.chains.get("c1").meta.flowAsk, undefined);
  });

  test("another message of the person's closes the drafting; the agent still changes the draft it drew until it is started", () => {
    const w = world();
    w.runner.asked("c1", "plan it");
    const d = w.runner.draftBy("c1", { steps: STEPS });
    w.runner.asked("c1", null);
    assert.equal(w.chains.get("c1").meta.flowAsk, undefined);
    assert.throws(() => w.runner.draftBy("c1", { steps: STEPS }), /only when the person asks for one with \/flow/);
    const e = w.runner.editBy("c1", { steps: [STEPS[0], { boxes: [{ id: "build", team: "builders", words: "Build it in Rust", needs: ["plan"] }] }] });
    assert.equal(e.id, d.id);
    assert.equal(e.steps[1].boxes[0].words, "Build it in Rust");
    assert.equal(e.steps[1].why, "", "an edit gives its steps whole");
    assert.throws(() => w.runner.editBy("c1", { steps: [{ boxes: [{ agent: "pm", words: "alone" }] }] }), /a flow of one box/);
    assert.equal(w.runner.get("c1", d.id).steps[1].boxes[0].words, "Build it in Rust", "a refusal leaves it as it was");
    assert.equal(w.runner.editBy("c1", { title: "Renamed" }).title, "Renamed", "a title alone keeps the steps");
    assert.equal(w.runner.get("c1", d.id).steps.length, 2);
    // Started, it is the person's; one drawn by hand never was the agent's.
    w.runner.start("c1", d.id);
    assert.throws(() => w.runner.editBy("c1", { title: "x" }), /no draft of yours stands in this chat/);
    w.runner.create("c1", plain([[ask("pm", "a")], [ask("skeptic", "b")]]));
    assert.throws(() => w.runner.editBy("c1", { title: "x" }), /no draft of yours stands/);
  });
  test("read: whether it may draft now, the chat's flows newest first with its own drafts marked, and the person's agents and teams", () => {
    const w = world();
    assert.match(w.runner.read("c1"), /^The person's newest message is no \/flow: you may not draft a flow now[\s\S]*No flow stands in this chat\.[\s\S]*Their agents \(a box's "agent"\):/);
    w.runner.asked("c1", "plan it");
    w.runner.draftBy("c1", { title: "Mine", steps: STEPS });
    const r = w.runner.read("c1");
    assert.match(r, /^The person's newest message is \/flow: you may draft its flow \(action draft\)\./);
    assert.match(r, /<flow id="[^"]+" title="Mine" state="draft">[\s\S]*<\/flow>\n\(a draft of yours: you may change it until the person starts it\)/);
    assert.match(r, /- build: Builders \(team, writes\) · needs plan \(PM\) · "Build it"/);
  });
});

describe("a team box's chat stopped or failed, and a team box sent back", () => {
  test("its lead's turn failed: Failed, with where to look; Retry goes on in its chat with Filament's line", async () => {
    const w = world();
    const f = started(w, plain([[ask("pm", "Plan a desktop app.")], [teamBox("builders", "Build it.")]]));
    await w.end(w.sub("pm").id, "PLAN");
    w.facts.t1 = { last: { n: 2, final: false, failed: true, cut: false } };
    await w.team("t1", "stopped");
    assert.equal(boxNamed(w, f.id, "Builders").state, "failed");
    assert.match(String(boxNamed(w, f.id, "Builders").error), /open its chat to see why/);
    w.runner.box("c1", f.id, boxNamed(w, f.id, "Builders").id, "retry");
    await settled();
    // (fails before: yes — the line went as the person's Send as it is: a coding agent's session kept a print it never
    // loaded, and the line counted as the person's message)
    assert.deepEqual(w.posted, [{ chain: "t1", body: { content: [{ type: "text", text: GO_ON_LINE }], by: "flow" } }]);
  });
  test("a team box sent back gets a new turn in its chat; its changes stay", async () => {
    const w = world();
    const f = started(w, plain([[ask("pm", "Plan a desktop app.")], [teamBox("builders", "Build it.")], [ask("skeptic", "Gate.", { gate: true })]]));
    await w.end(w.sub("pm").id, "PLAN");
    await w.team("t1", "done", { n: 2, text: "BUILT" });
    await w.end(w.sub("skeptic").id, "Verdict: not yet — the tests fail");
    w.runner.decide("c1", f.id, { action: "back", to: boxNamed(w, f.id, "Builders").id, line: "run the tests" });
    await settled();
    assert.equal(w.posted.length, 1);
    assert.equal(w.posted[0].chain, "t1");
    assert.match(w.posted[0].body.content[0].text, /What you already changed stays[\s\S]*the tests fail[\s\S]*run the tests/);
    assert.deepEqual([w.posted[0].body.by, w.posted[0].body.sendAsIs], ["flow", undefined], "Filament's own turn, never the person's Send as it is");
    await w.team("t1", "done", { n: 3, text: "BUILT, TESTED" });
    assert.match(w.sub("skeptic").spec.prompt, /BUILT, TESTED/);
  });

  // (fails before: yes — the review of 54f63529f, i1: the chat refused the line while its lead's question waited for the
  // person, and the box failed with the line lost)
  test("a team box sent back while its lead asks the person: the box waits with its chat, and its line goes once the answer's turn ends — never the answer's reply as its result", async () => {
    const w = world();
    const f = started(w, plain([[ask("pm", "Plan a desktop app.")], [teamBox("builders", "Build it.")], [ask("skeptic", "Gate.", { gate: true })]]));
    await w.end(w.sub("pm").id, "PLAN");
    await w.team("t1", "done", { n: 2, text: "BUILT" });
    await w.end(w.sub("skeptic").id, "Verdict: not yet — the tests fail");
    // The person wrote in the team chat meanwhile, and its lead asks them something.
    w.rows.set("t1", { id: "t1", state: "asking" });
    w.postStatus = 409;
    w.postBody = { error: "a question waits for the person's answer: the flow's line goes once the answer's turn ends", byFilament: "asking" };
    w.runner.decide("c1", f.id, { action: "back", to: boxNamed(w, f.id, "Builders").id, line: "run the tests" });
    await settled();
    const box = () => boxNamed(w, f.id, "Builders");
    assert.deepEqual([box().state, box().error], ["asking", "its lead asks you a question: open its chat to answer — what the flow sent it goes once you have"]);
    assert.equal(w.posted.length, 1);
    w.postStatus = 200;
    await w.team("t1", "working");
    assert.equal(w.posted.length, 1, "the answer's turn runs: the line still waits");
    await w.team("t1", "done", { n: 4, text: "Answered: PNG and JPEG." });
    assert.equal(w.posted.length, 2, "the answer's turn ended: the line goes");
    assert.deepEqual(w.posted[1], w.posted[0], "the same line, whole");
    assert.equal(box().state, "working", "the answer's reply is no result of the box's");
    await w.team("t1", "done", { n: 5, text: "BUILT, TESTED" });
    assert.match(w.sub("skeptic").spec.prompt, /BUILT, TESTED/);
  });

  // (fails before: yes — the hunt of 11-09: the line waited out a question alone; sent while a turn ran in the chat — the
  // person's, typed there meanwhile —, the chat refused it as busy, and the box failed with the line lost)
  test("a team box sent back while a turn runs in its chat: the box stays at work, and its line goes once that turn ends — never into it, never lost", async () => {
    const w = world();
    const f = started(w, plain([[ask("pm", "Plan a desktop app.")], [teamBox("builders", "Build it.")], [ask("skeptic", "Gate.", { gate: true })]]));
    await w.end(w.sub("pm").id, "PLAN");
    await w.team("t1", "done", { n: 2, text: "BUILT" });
    await w.end(w.sub("skeptic").id, "Verdict: not yet — the tests fail");
    // The person wrote in the team chat meanwhile, and its turn runs.
    w.rows.set("t1", { id: "t1", state: "working" });
    w.facts.t1 = { ...w.facts.t1, busy: true };
    w.postStatus = 409;
    w.postBody = { error: "a turn is already running in this session — steer it through its run, or wait for it to end", requestId: "r-7", holder: { window: "harness", client: "harness", label: "Harness", requestId: "r-7" } };
    w.runner.decide("c1", f.id, { action: "back", to: boxNamed(w, f.id, "Builders").id, line: "run the tests" });
    await settled();
    const box = () => boxNamed(w, f.id, "Builders");
    assert.deepEqual([box().state, box().error], ["working", null], "at work with its chat, not failed");
    assert.equal(w.posted.length, 1);
    w.postStatus = 200;
    await w.team("t1", "working");
    assert.equal(w.posted.length, 1, "the turn still runs: the line waits");
    await w.team("t1", "done", { n: 3, text: "Done what you asked: renamed the tray." });
    assert.equal(w.posted.length, 2, "the turn ended: the line goes");
    assert.deepEqual(w.posted[1], w.posted[0], "the same line, whole");
    assert.equal(box().state, "working", "the person's turn's reply is no result of the box's");
    await w.team("t1", "done", { n: 4, text: "BUILT, TESTED" });
    assert.match(w.sub("skeptic").spec.prompt, /BUILT, TESTED/);
  });

  test("a line refused as the chat's turn ended goes at once: the end said before the line was kept is not waited for again", async () => {
    const w = world();
    const f = started(w, plain([[ask("pm", "Plan a desktop app.")], [teamBox("builders", "Build it.")]]));
    await w.end(w.sub("pm").id, "PLAN");
    w.facts.t1 = { last: { n: 2, final: false, failed: true, cut: false } };
    await w.team("t1", "stopped");
    assert.equal(boxNamed(w, f.id, "Builders").state, "failed");
    // Retry's line is refused by a turn that ends before the refusal is back: the chat says it is free again.
    w.postStatus = 409;
    w.postBody = { error: "a turn is already running in this session", holder: { window: "harness" } };
    const posting = w.runner.box("c1", f.id, boxNamed(w, f.id, "Builders").id, "retry");
    w.postStatus = 200;
    await posting;
    await settled();
    assert.equal(w.posted.length, 2, "looked at once kept: the chat is free, so the line goes");
    assert.deepEqual(w.posted[1], w.posted[0]);
    assert.equal(boxNamed(w, f.id, "Builders").state, "working");
  });

  test("a line the box still owed its chat when Filament restarted goes with its Go on, in place of the line to go on", async () => {
    const w = world();
    const f = started(w, plain([[ask("pm", "Plan a desktop app.")], [teamBox("builders", "Build it.")], [ask("skeptic", "Gate.", { gate: true })]]));
    await w.end(w.sub("pm").id, "PLAN");
    await w.team("t1", "done", { n: 2, text: "BUILT" });
    await w.end(w.sub("skeptic").id, "Verdict: not yet — the tests fail");
    w.rows.set("t1", { id: "t1", state: "asking" });
    w.postStatus = 409;
    w.postBody = { error: "a question waits", byFilament: "asking" };
    w.runner.decide("c1", f.id, { action: "back", to: boxNamed(w, f.id, "Builders").id, line: "run the tests" });
    await settled();
    w.runner.close();
    w.runner = w.make();
    w.runner.reconcile();
    assert.equal(boxNamed(w, f.id, "Builders").state, "cut");
    w.postStatus = 200;
    w.runner.box("c1", f.id, boxNamed(w, f.id, "Builders").id, "retry");
    await settled();
    assert.equal(w.posted.length, 2);
    assert.deepEqual(w.posted[1], w.posted[0], "what sent it back, not the line to go on");
    assert.equal(boxNamed(w, f.id, "Builders").owed, undefined, "owed no more");
  });
});

describe("a writer beside your chat: the flow's own worktree (OA5)", () => {
  /** The flow's worktree as teams beside make it. @param {string} name */
  const tree = (name) => ({ kind: "worktree", name, branch: name, folder: `H:/repo-${name}`, cwd: `H:/repo-${name}` });
  const MADE = tree("flow-plan-a-desktop-app");

  test("its first team box that writes makes the flow's worktree, named for the flow; every box after it works there, those before it in the folder; the end says where, nothing merged (cases 1, 2, 3)", async () => {
    const w = world();
    w.ownPlace = tree;
    const f = started(w, plain([[ask("pm", "Plan it.")], [teamBox("builders", "Build it.")], [ask("skeptic", "Gate.", { gate: true }), teamBox("bughunters", "Hunt.")]]));
    assert.equal("cwd" in w.sub("pm").spec, false, "a box before it works in the folder");
    await w.end(w.sub("pm").id, "PLAN");
    assert.deepEqual(w.fired[0].input.own, { name: "flow-plan-a-desktop-app" });
    assert.deepEqual(w.runner.get("c1", f.id).place, MADE);
    assert.deepEqual(boxNamed(w, f.id, "Builders").place, MADE, "its card names the worktree and its branch");
    await w.team("t1", "done", { n: 2, text: "BUILT" });
    // (case 2) The boxes after it work in the flow's worktree — an agent at its folder, a team in it — never in the main agent's.
    assert.equal(w.sub("skeptic").spec.cwd, MADE.cwd);
    assert.deepEqual(w.fired[1].input.own, { use: MADE });
    assert.equal(boxNamed(w, f.id, "BugHunters").place, undefined, "a team that reads only has no changes to say");
    await w.end(w.sub("skeptic").id, "Verdict: go");
    await w.team("t2", "done", { n: 1, text: "No bugs." });
    assert.equal(w.runner.get("c1", f.id).state, "done");
    // (case 3) The end says where its changes are; nothing merged.
    const end = String(w.delivered[0].text);
    assert.match(end, /<flow-end title="Plan a desktop app">\nWorks in: the worktree H:\/repo-flow-plan-a-desktop-app, on branch flow-plan-a-desktop-app — made from the folder's last commit/);
    assert.match(end, /^2\. Builders \(team, writes in the flow's worktree on branch flow-plan-a-desktop-app\) — done; its changes are on branch flow-plan-a-desktop-app, in the worktree H:\/repo-flow-plan-a-desktop-app$/m);
    assert.match(end, /^3\. Skeptic \(gate\) — go; BugHunters \(team, reads only\) — done$/m);
    assert.match(end, /Nothing of it is merged/);
  });

  test("sent back, or retried, its team goes on in the flow's worktree: no second one is made", async () => {
    const w = world();
    w.ownPlace = tree;
    const f = started(w, plain([[teamBox("builders", "Build it.")], [ask("skeptic", "Gate.", { gate: true })]]));
    await settled();
    await w.team("t1", "done", { n: 1, text: "BUILT" });
    await w.end(w.sub("skeptic").id, "Verdict: not yet — no tests");
    w.runner.decide("c1", f.id, { action: "back", to: boxNamed(w, f.id, "Builders").id, line: "add tests" });
    await settled();
    assert.deepEqual([w.fired.length, w.posted[0].chain], [1, "t1"], "a new turn in its own chat, in the worktree");
    assert.deepEqual(boxNamed(w, f.id, "Builders").place, MADE);
    await w.team("t1", "done", { n: 2, text: "BUILT, TESTED" });
    assert.equal(w.launched.filter((s) => s.spec.as === "skeptic").every((s) => s.spec.cwd === MADE.cwd), true, "the gate reads again where the changes are");
  });

  test("outside git its team that writes works in the folder, and says so; git is not asked again (case 4)", async () => {
    const w = world();
    const outside = { kind: "folder", folder: "H:/plain", why: "it is not in a git repository" };
    w.ownPlace = () => outside;
    const f = started(w, plain([[teamBox("builders", "Build it.")], [ask("skeptic", "Gate.", { gate: true })], [teamBox("builders", "Polish it.", { id: "polish" })]]));
    await settled();
    assert.deepEqual(w.fired[0].input.own, { name: "flow-plan-a-desktop-app" });
    assert.deepEqual(w.runner.get("c1", f.id).place, outside);
    assert.deepEqual(boxNamed(w, f.id, "Builders").place, outside, "its card says so");
    await w.team("t1", "done", { n: 1, text: "BUILT" });
    assert.equal("cwd" in w.sub("skeptic").spec, false);
    await w.end(w.sub("skeptic").id, "Verdict: go");
    assert.equal("own" in w.fired[1].input, false, "outside git nothing is asked of git again");
    assert.deepEqual(boxWithId(w, f.id, "polish").place, outside);
    await w.team("t2", "done", { n: 1, text: "POLISHED" });
    const end = String(w.delivered[0].text);
    assert.match(end, /Works in: the folder — it is not in a git repository, so its boxes that write change your folder's files\./);
    assert.match(end, /^3\. Builders \(team, writes in the folder\) — done; its changes are in the folder$/m);
  });

  test("In place: the same rule — the agent that drives it hears where the flow works, and its own folder stays its own (case 5)", async () => {
    const w = world();
    w.ownPlace = tree;
    const d = w.runner.create("c1", { goal: "build a lexer", title: "A lexer", steps: [{ boxes: [teamBox("builders", "Build it.", { id: "build" })] }, { boxes: [ask("skeptic", "Gate.", { id: "check", gate: true, needs: ["build"] })] }] });
    await w.runner.startInPlace("c1", d.id);
    await settled();
    const lexer = tree("flow-a-lexer");
    assert.deepEqual(w.fired[0].input.own, { name: "flow-a-lexer" });
    const news = w.notices.filter((n) => String(n.text).startsWith(FLOW_NEWS_HEAD));
    const told = news.find((n) => /Works in: the worktree H:\/repo-flow-a-lexer, on branch flow-a-lexer/.test(String(n.text)));
    assert.ok(told, "it hears where the flow works");
    assert.match(String(told?.text), /never in your folder/);
    assert.match(String(told?.description), /works on branch flow-a-lexer/);
    await w.team("t1", "done", { n: 1, text: "LEXED" });
    const done = String(w.notices.filter((n) => String(n.text).startsWith(FLOW_NEWS_HEAD)).at(-1)?.text);
    assert.match(done, /Builders is done; its changes are on branch flow-a-lexer, in the worktree H:\/repo-flow-a-lexer, nothing merged\./);
    assert.equal(w.sub("skeptic").spec.cwd, lexer.cwd);
  });
});

describe("the flows hunt of 10-23: one worktree a flow, the steps whole, a chat or a worktree gone", () => {
  /** The flow's worktree as teams beside make it. @param {string} name */
  const tree = (name) => ({ kind: "worktree", name, branch: name, folder: `H:/repo-${name}`, cwd: `H:/repo-${name}` });
  const MADE = tree("flow-plan-a-desktop-app");
  /** Its fires held until the test lets them go. @param {ReturnType<typeof world>} w */
  const held = (w) => {
    /** @type {() => void} */
    let go = () => {};
    w.fireWait = new Promise((res) => (go = () => res(undefined)));
    return () => {
      w.fireWait = null;
      go();
    };
  };
  const WRITERS = plain([[teamBox("builders", "Build it.")], [teamBox("builders", "Polish it.", { id: "polish" })]]);

  // (fails before: yes — Skip ended the box at once, the next writer made a second worktree, and the late fire pointed
  // the flow at the skipped box's)
  test("a writer skipped while its lead starts: the next writer waits for that fire and works in the worktree it made — one a flow", async () => {
    const w = world();
    w.ownPlace = tree;
    const go = held(w);
    const f = started(w, WRITERS);
    await settled();
    w.runner.box("c1", f.id, boxNamed(w, f.id, "Builders").id, "skip");
    await settled();
    assert.equal(w.fired.length, 1, "the next writer waits for the fire that makes the worktree");
    go();
    await settled();
    assert.deepEqual(w.fired.map((x) => x.input.own), [{ name: "flow-plan-a-desktop-app" }, { use: MADE }]);
    assert.deepEqual(w.runner.get("c1", f.id).place, MADE);
    assert.deepEqual([boxNamed(w, f.id, "Builders").state, w.stopped], ["skipped", ["t1"]], "the skipped box's team stops once its lead started");
  });

  // (fails before: yes — a box's Stop while its lead started found no run to stop, and the lead went on working)
  test("a team box stopped while its lead starts stops once it has; one stopped while it waits for another's fire never starts", async () => {
    const w = world();
    w.ownPlace = tree;
    let go = held(w);
    const f = started(w, plain([[teamBox("builders", "Build it.")], [ask("skeptic", "Gate.", { gate: true })]]));
    await settled();
    w.runner.box("c1", f.id, boxNamed(w, f.id, "Builders").id, "stop");
    go();
    await settled();
    assert.deepEqual(w.stopped, ["t1"], "its team stops as soon as its lead has started");
    const v = world();
    v.ownPlace = tree;
    go = held(v);
    const g = started(v, WRITERS);
    await settled();
    v.runner.box("c1", g.id, boxNamed(v, g.id, "Builders").id, "skip");
    await settled();
    v.runner.box("c1", g.id, boxWithId(v, g.id, "polish").id, "stop");
    go();
    await settled();
    assert.equal(v.fired.length, 1, "it never fired");
    assert.deepEqual([boxWithId(v, g.id, "polish").state, boxWithId(v, g.id, "polish").error], ["stopped", "it was stopped before its lead started"]);
    assert.equal(v.runner.get("c1", g.id).state, "holds");
  });

  // (fails before: yes — the steps to come alone were read as none to come, and the flow lost them without a word)
  test("an edit while it runs takes the steps whole: the steps to come alone are refused in words, and the flow keeps its steps", async () => {
    const w = world();
    const f = started(w, plain([[ask("pm", "Plan it.")], [ask("engineer", "An architecture.")], [ask("skeptic", "Doubt it.")]]));
    await w.end(w.sub("pm").id, "PLAN");
    const steps = structuredClone(w.runner.get("c1", f.id).steps);
    assert.throws(() => w.runner.edit("c1", f.id, { steps: steps.slice(2) }, { by: "agent" }), /^Error: send the steps whole: the 2 steps that started, as they stand \(.+; .+\), then the steps to come$/);
    assert.equal(w.runner.get("c1", f.id).steps.length, 3, "nothing lost");
    assert.equal(w.runner.edit("c1", f.id, { steps }).steps.length, 3, "sent whole, it is taken");
  });

  // (fails before: yes — the restart knew nothing of the chat and the worktree its fire had made, and Go on made a
  // second worktree beside the first)
  test("a restart while the first writer's lead starts: its chat and its worktree are found again, and Go on goes on in them", async () => {
    const w = world();
    w.ownPlace = tree;
    held(w);
    const f = started(w, plain([[teamBox("builders", "Build it.")], [ask("skeptic", "Gate.", { gate: true })]]));
    await settled();
    const build = boxNamed(w, f.id, "Builders").id;
    // What its fire had made when Filament stopped: its chat — its flow, its box and its worktree on its card — and its lead's first turn.
    w.chains.set("t1", { id: "t1", kind: "team", beside: "c1", meta: { beside: { flow: { id: f.id, box: build }, place: MADE } } });
    w.facts.t1 = { last: { n: 1, final: false, cut: true, failed: false } };
    w.runner.close();
    w.runner = w.make();
    assert.equal(w.runner.reconcile(), 1);
    assert.deepEqual(w.runner.get("c1", f.id).place, MADE, "the worktree its fire made is the flow's");
    assert.deepEqual(boxNamed(w, f.id, "Builders").place, MADE);
    w.fireWait = null;
    w.runner.goOn("c1", f.id);
    await settled();
    assert.equal(w.fired.length, 1, "no second fire, no second worktree");
    assert.deepEqual(w.posted, [{ chain: "t1", body: { content: [{ type: "text", text: GO_ON_LINE }], by: "flow" } }]);
    // A chat with no turn yet gives its worktree alone: the box starts afresh there.
    const v = world();
    v.ownPlace = tree;
    held(v);
    const g = started(v, plain([[teamBox("builders", "Build it.")], [ask("skeptic", "Gate.", { gate: true })]]));
    await settled();
    v.chains.set("t1", { id: "t1", kind: "team", beside: "c1", meta: { beside: { flow: { id: g.id, box: boxNamed(v, g.id, "Builders").id }, place: MADE } } });
    v.runner.close();
    v.runner = v.make();
    v.runner.reconcile();
    v.fireWait = null;
    v.runner.goOn("c1", g.id);
    await settled();
    assert.deepEqual(v.fired.map((x) => x.input.own), [{ name: "flow-plan-a-desktop-app" }, { use: MADE }]);
    assert.equal(v.posted.length, 0);
  });

  // (fails before: yes — an agent box after the flow's worktree went started in a folder that was not there, and failed
  // late, after a model call)
  test("the flow's worktree gone: an agent box after it fails in words before any model is asked; a team box's Go on the same", async () => {
    const w = world();
    w.ownPlace = tree;
    const f = started(w, plain([[teamBox("builders", "Build it.")], [ask("skeptic", "Gate.", { gate: true })]]));
    await settled();
    w.gone.add(MADE.cwd);
    await w.team("t1", "done", { n: 2, text: "BUILT" });
    const gone = "its flow's worktree H:/repo-flow-plan-a-desktop-app is gone: put it back, or start the flow again";
    assert.equal(w.launched.length, 0, "no model asked");
    assert.equal(boxNamed(w, f.id, "Skeptic").error, `it could not start: ${gone}`);
    assert.equal(w.runner.get("c1", f.id).state, "holds");
    const v = world();
    v.ownPlace = tree;
    const g = started(v, plain([[teamBox("builders", "Build it.")], [ask("skeptic", "Gate.", { gate: true })]]));
    await settled();
    v.runner.close();
    v.runner = v.make();
    v.runner.reconcile();
    v.gone.add(MADE.cwd);
    v.runner.goOn("c1", g.id);
    await settled();
    assert.deepEqual([boxNamed(v, g.id, "Builders").state, boxNamed(v, g.id, "Builders").error, v.posted.length], ["failed", `it could not go on: ${gone}`, 0]);
    assert.equal(v.runner.get("c1", g.id).state, "holds");
  });

  // (fails before: yes — its chat's facts threw a bare error, which the flows route answered with a 500)
  test("Hand on this reply with its team's chat gone: refused in words, with a status", async () => {
    const w = world();
    const f = started(w, plain([[ask("pm", "Plan it.")], [teamBox("builders", "Build it."), ask("skeptic", "Doubt it.")], [ask("designer", "Mocks.")]]));
    await w.end(w.sub("pm").id, "PLAN");
    await w.team("t1", "done", { n: 2, text: "BUILT" });
    assert.equal(boxNamed(w, f.id, "Builders").state, "done");
    w.deleted.add("t1");
    assert.throws(
      () => w.runner.box("c1", f.id, boxNamed(w, f.id, "Builders").id, "take"),
      (/** @type {any} */ e) => e.status === 409 && e.message === "Builders' chat is gone: it has no reply to hand on",
    );
  });
});

describe("In place (OA4)", () => {
  /** The plan, its gate, the person's review, the mocks. */
  const GATED = {
    goal: "plan a parser",
    title: "A parser",
    steps: [
      { why: "The plan first.", boxes: [ask("pm", "Plan it.", { id: "plan" })] },
      { why: "Checked before the rest.", boxes: [ask("reviewer", "Check the plan.", { id: "check", gate: true, needs: ["plan"] })] },
      { why: "You look before the mocks.", boxes: [{ id: "you", review: true, words: "Read the plan.", needs: ["plan"] }] },
      { why: "Mocks last.", boxes: [ask("designer", "Mocks.", { id: "mocks", needs: ["plan"] })] },
    ],
  };
  /** @param {ReturnType<typeof world>} w @param {any} [input] */
  const inPlace = async (w, input = GATED) => {
    const d = w.runner.create("c1", input);
    const f = await w.runner.startInPlace("c1", d.id);
    await settled();
    return f;
  };
  /** @param {ReturnType<typeof world>} w */
  const news = (w) => w.notices.filter((n) => String(n.text).startsWith(FLOW_NEWS_HEAD));
  /** @param {ReturnType<typeof world>} w */
  const lastNews = (w) => String(news(w).at(-1)?.text || "");

  test("Start · In place opens a turn of the main agent through the route a message takes; each box's end reaches it as one word, its result whole; a gate is its to decide with why; the person's review is theirs; the chat's turns owe the flow until it ends (cases 1, 4, 5)", async () => {
    const w = world();
    const f = await inPlace(w);
    assert.deepEqual([f.state, f.inPlace, f.drives], ["running", true, true]);
    assert.equal(w.posted.length, 1);
    assert.deepEqual([w.posted[0].chain, w.posted[0].body.by], ["c1", "beside"]);
    const opened = String(w.posted[0].body.content[0].text);
    assert.ok(opened.startsWith(FLOW_DRIVE_HEAD));
    assert.match(opened, /you drive it in this turn, which stays open until the flow ends/);
    assert.match(opened, /- check: Reviewer \(gate\) · needs plan \(PM\)/);
    assert.equal(w.notices.filter((n) => String(n.text).startsWith(FLOW_START_HEAD)).length, 0, "no start notice beside it: the turn is the start");
    assert.match(lastNews(w), /Started: PM \(plan\)\./);
    const owed = w.runner.drives("c1");
    assert.ok(owed instanceof Promise);
    assert.equal(w.runner.driven("c1"), true);
    let letGo = false;
    void owed.then(() => (letGo = true));
    const n0 = news(w).length;
    await w.end(w.sub("pm").id, "THE PLAN");
    assert.equal(news(w).length, n0 + 1, "one word a burst");
    assert.match(lastNews(w), /- PM is done\.\n- Started: Reviewer \(check\)\./);
    assert.match(lastNews(w), /<flow-result step="1" box="PM" id="plan">\nTHE PLAN\n<\/flow-result>/);
    assert.equal(news(w).at(-1).description, 'the flow "A parser": PM done · Reviewer started');
    // (case 4) A gate's not yet: the agent is told what it may do there; the person's alert says it, or they, decide.
    await w.end(w.sub("reviewer").id, "Verdict: not yet — no numbers\n\nIt needs numbers.");
    assert.match(lastNews(w), /Reviewer, the gate, says not yet: no numbers\./);
    assert.match(lastNews(w), /The flow waits at Reviewer \(check\): decide — "do": "go" goes on past it; "do": "back" with "to" sends a box it needs back with your why \(plan \(PM\)\)/);
    assert.match(w.alerts.at(-1).text, /Reviewer says not yet in your flow "A parser": your agent decides, or you do/);
    assert.equal(w.runner.get("c1", f.id).line, "Flow in place · step 2 of 4 · Reviewer asks your agent or you");
    assert.throws(() => w.runner.actBy("c1", { action: "box", box: "check", do: "go" }), /say why/);
    const back = w.runner.actBy("c1", { action: "box", box: "check", do: "back", to: "plan", why: "add the numbers" });
    assert.equal(back.did, "sent PM back from Reviewer");
    const pmBack = w.followed.at(-1);
    assert.match(pmBack.prompt, /and the main agent that drives the flow sent your part back with a line of its own/);
    assert.match(pmBack.prompt, /Its line: add the numbers/);
    const n1 = news(w).length;
    await settled();
    assert.equal(news(w).length, n1, "what it did itself it is not told");
    await w.end(w.sub("pm").id, "THE PLAN, WITH NUMBERS");
    await w.end(w.sub("reviewer").id, "Verdict: go\n\nNumbers now.");
    // (case 5) The person's review is theirs alone.
    assert.match(lastNews(w), /The person's review \(you, step 3\) waits for them: it is theirs alone/);
    assert.throws(() => w.runner.actBy("c1", { action: "box", box: "you", do: "skip" }), /the person's review is theirs alone/);
    assert.equal(letGo, false, "the turn still owes the flow");
    w.runner.decide("c1", f.id, { box: "you", action: "on", line: "fine by me" });
    await settled();
    assert.match(lastNews(w), /The person went on past their review: "fine by me"\./);
    assert.match(lastNews(w), /Started: Designer \(mocks\)\./);
    await w.end(w.sub("designer").id, "TWO MOCKS");
    const end = w.runner.get("c1", f.id);
    assert.equal(end.state, "done");
    assert.match(lastNews(w), /The flow is done: 1\. PM — done 2\. Reviewer — go 3\. Your review — the person went on 4\. Designer — done\. End your turn/);
    assert.equal(end.end, null, "no end message of its own: the turn that drove it heard it");
    assert.equal(w.delivered.length, 0);
    await settled();
    assert.equal(letGo, true, "the turns that owed it are let go");
    assert.equal(w.runner.drives("c1"), null);
    assert.deepEqual(/** @type {any[]} */ (end.acts).map((a) => [a.by, a.what, a.why || ""]), [["agent", "sent PM back from Reviewer", "add the numbers"], ["person", "went on past their review", "fine by me"]]);
  });

  test("it stops, skips or retries a box and edits the steps to come, each kept on the flow with its why; a flow beside the chat is not its to act on (case 3)", async () => {
    const w = world();
    const PAIR = {
      goal: "a page",
      title: "A page",
      steps: [
        { why: "Side by side.", boxes: [ask("pm", "Plan it.", { id: "plan" }), ask("designer", "Mocks.", { id: "mocks" })] },
        { why: "On both.", boxes: [ask("engineer", "Shape it.", { id: "arch", needs: ["plan", "mocks"] })] },
      ],
    };
    const f = await inPlace(w, PAIR);
    assert.equal(w.runner.actBy("c1", { action: "box", box: "mocks", do: "skip", why: "no screens in it" }).did, "skipped Designer");
    await settled();
    assert.ok(w.stopped.includes(w.sub("designer").id));
    await w.end(w.sub("pm").id, "THE PLAN");
    assert.equal(w.runner.get("c1", f.id).steps[0].boxes[1].state, "skipped");
    w.runner.actBy("c1", { action: "box", box: "arch", do: "stop", why: "wrong brief" });
    await settled();
    assert.match(lastNews(w), /Engineer \(arch\) stopped: it was stopped\./);
    assert.match(lastNews(w), /The flow holds at Engineer \(arch\): "do": "retry" or "skip" it/);
    const launched = w.launched.length;
    w.runner.actBy("c1", { action: "box", box: "arch", do: "retry" });
    assert.equal(w.launched.length, launched + 1);
    const steps = [...PAIR.steps, { why: "A last look.", boxes: [ask("reviewer", "Check the shape.", { id: "look", needs: ["arch"] })] }];
    w.runner.editBy("c1", { steps, why: "a check at the end" });
    const now_ = w.runner.get("c1", f.id);
    assert.deepEqual(now_.steps.map((s) => s.boxes.map((b) => b.id)), [["plan", "mocks"], ["arch"], ["look"]]);
    assert.deepEqual(/** @type {any[]} */ (now_.acts).map((a) => [a.by, a.what, a.why || ""]), [
      ["agent", "skipped Designer", "no screens in it"],
      ["agent", "stopped Engineer", "wrong brief"],
      ["agent", "retried Engineer", ""],
      ["agent", "changed the steps to come", "a check at the end"],
    ]);
    assert.throws(() => w.runner.actBy("c1", { action: "box", box: "arch", do: "go", why: "x" }), /the flow does not wait at Engineer/);
    assert.throws(() => w.runner.actBy("c1", { action: "box", box: "nope", do: "skip" }), /name a box of the flow by its id \("box"\): plan, mocks, arch, look/);
    assert.throws(() => w.runner.actBy("c1", { action: "box", box: "arch", do: "sing" }), /"do" is stop, skip or retry/);
    const w2 = world();
    started(w2);
    assert.throws(() => w2.runner.actBy("c1", { action: "stop" }), /you drive no flow now/);
  });
  // (fails before: yes — the owner's of 11-05: the steps to come it sent whole dropped what the person picked for each)
  test("a flow it drives: the steps to come it sends whole keep each box's model and effort where its id, kind and agent stand", async () => {
    const w = world();
    const PAIR = { goal: "a page", title: "A page", steps: [
      { why: "First.", boxes: [ask("pm", "Plan it.", { id: "plan" })] },
      { why: "Then.", boxes: [ask("engineer", "Shape it.", { id: "arch", needs: ["plan"], model: "m-arch", effort: "high" })] },
    ] };
    const f = await inPlace(w, PAIR);
    w.runner.editBy("c1", { steps: [PAIR.steps[0], { why: "Then.", boxes: [ask("engineer", "Shape it well.", { id: "arch", needs: ["plan"] })] }], why: "sharper words" });
    const arch = /** @type {any} */ (w.runner.get("c1", f.id).steps[1].boxes[0]);
    assert.deepEqual([arch.words, arch.model, arch.effort], ["Shape it well.", "m-arch", "high"]);
  });

  test("Stop on the turn stops the flow; a turn that fails leaves it holding, its box at work going on — Go on beside runs the rest as a flow beside the chat runs (cases 6, 8)", async () => {
    const w = world();
    const f = await inPlace(w);
    // A turn that waits for the person's answer still drives it.
    w.facts.c1 = { busy: false, asking: true, last: { n: 2, final: false, failed: false, stopped: false } };
    w.events.publish("turns", { type: "turn", chainId: "c1", holder: null });
    assert.equal(w.runner.get("c1", f.id).drives, true);
    w.facts.c1 = { busy: false, asking: false, last: { n: 2, final: true, failed: false, stopped: true } };
    w.events.publish("turns", { type: "turn", chainId: "c1", holder: null });
    await settled();
    const stopped = w.runner.get("c1", f.id);
    assert.equal(stopped.state, "stopped");
    assert.ok(w.stopped.includes(w.sub("pm").id), "its box at work stopped");
    assert.deepEqual(/** @type {any[]} */ (stopped.acts).at(-1), { n: 1, at: NOW, by: "person", what: "stopped the turn that drove it, and the flow with it" });
    const g = await inPlace(w);
    w.facts.c1 = { busy: false, asking: false, last: { n: 3, final: false, failed: true, why: "the provider answered 529", stopped: false } };
    w.events.publish("turns", { type: "turn", chainId: "c1", holder: null });
    await settled();
    const held = w.runner.get("c1", g.id);
    assert.deepEqual([held.state, held.hold, held.drives, held.lost], ["holds", { kind: "driver", box: "" }, false, "your agent's turn failed: the provider answered 529"]);
    assert.equal(held.line, "Flow · step 1 of 4 · your agent's turn ended");
    assert.match(w.alerts.at(-1).text, /Your flow "A parser" waits for you: your agent's turn failed/);
    assert.equal(w.runner.drives("c1"), null, "no turn owes it now");
    await w.end(w.sub("pm").id, "THE PLAN");
    assert.equal(w.sub("reviewer"), undefined, "nothing new starts until the person chooses");
    const n0 = news(w).length;
    w.runner.decide("c1", g.id, { action: "on" });
    await settled();
    assert.ok(w.sub("reviewer"), "Go on beside: the next step starts");
    assert.equal(news(w).length, n0, "no word to the agent: it drives it no more");
    assert.equal(/** @type {any[]} */ (w.runner.get("c1", g.id).acts).at(-1).what, "went on with it beside the chat");
    await w.end(w.sub("reviewer").id, "Verdict: go\n\nFine.");
    w.runner.decide("c1", g.id, { box: "you", action: "on" });
    await w.end(w.sub("designer").id, "MOCKS");
    assert.equal(w.runner.get("c1", g.id).state, "done");
    assert.equal(w.delivered.length, 1, "beside the chat now, its end goes as one message");
  });

  test("Start · In place is refused while a turn runs or a question waits; a turn that does not start leaves the draft as it was", async () => {
    const w = world();
    const d = w.runner.create("c1", GATED);
    w.facts.c1 = { busy: true, asking: false, last: null };
    await assert.rejects(w.runner.startInPlace("c1", d.id), /a turn runs in your chat: start the flow in place once it ends, or beside your chat now/);
    w.facts.c1 = { busy: false, asking: true, last: null };
    await assert.rejects(w.runner.startInPlace("c1", d.id), /a question waits for your answer/);
    w.facts.c1 = { busy: false, asking: false, last: null };
    w.postStatus = 409;
    await assert.rejects(w.runner.startInPlace("c1", d.id), /your agent's turn did not start, so the flow did not: the chat refused it/);
    const back = w.runner.get("c1", d.id);
    assert.deepEqual([back.state, back.inPlace, back.drives, back.startedAt], ["draft", false, false, null]);
    assert.equal(w.launched.length, 0);
    assert.equal(w.runner.drives("c1"), null);
  });

  test("a restart: the agent is told what was cut, with the turn that goes on by itself, and retries it; Go on with no turn of the chat runs it beside (case 7)", async () => {
    const w = world();
    const f = await inPlace(w);
    w.notices.length = 0;
    w.runner.close();
    w.runner = w.make();
    assert.equal(w.runner.reconcile(), 1);
    const cut = w.runner.get("c1", f.id);
    assert.deepEqual([cut.state, cut.drives], ["cut", true]);
    assert.equal(w.notices.length, 1);
    assert.ok(String(w.notices[0].text).startsWith(FLOW_RESTART_HEAD));
    assert.match(w.notices[0].text, /, and cut PM at work: each is yours to retry or skip with your flow tool/);
    assert.equal(w.notices[0].description, 'the flow "A parser": Filament restarted, 1 box cut');
    assert.equal(w.runner.drives("c1"), null, "a cut flow owes nothing until it goes on");
    assert.equal(w.runner.actBy("c1", { action: "box", box: "plan", do: "retry" }).did, "retried PM");
    assert.equal(w.runner.get("c1", f.id).state, "running");
    assert.ok(w.runner.drives("c1"));
    await w.end(w.sub("pm").id, "THE PLAN");
    assert.match(String(w.notices.at(-1).text), /PM is done/);
    w.runner.close();
    w.runner = w.make();
    w.runner.reconcile();
    w.facts.c1 = { busy: false, asking: false, last: null };
    w.runner.goOn("c1", f.id);
    const beside = w.runner.get("c1", f.id);
    assert.deepEqual([beside.state, beside.drives, /** @type {any[]} */ (beside.acts).at(-1).what], ["running", false, "went on after the restart, beside the chat"]);
  });
});

// (fails before: yes — the owner's of 10-28: "flow was running but the thread was moved back into project. the condition
// should be if anything under this thread is running like flows, sub agents then it should still stay inside working";
// no read said which chats had a flow at work)
describe("the flows at work, every chat's, for Now", () => {
  test("live() lists each flow running or holding with its line and whether it asks you; one that ends or stops leaves it; a new runner reads them from the store", async () => {
    const w = world();
    assert.deepEqual(w.runner.live(), []);
    const d = w.runner.create("c1", plain([[ask("pm", "Plan.", { id: "plan" })], [{ id: "you", review: true, words: "Right?", needs: ["plan"] }], [ask("skeptic", "Doubt.", { needs: ["you"] })]]));
    assert.deepEqual(w.runner.live(), [], "a draft is not at work");
    w.runner.start("c1", d.id);
    assert.deepEqual(w.runner.live(), [{ chainId: "c1", id: d.id, state: "running", line: "Flow · step 1 of 3", asks: false, at: NOW }]);
    await w.end(w.sub("pm").id, "PLAN");
    assert.deepEqual(w.runner.live(), [{ chainId: "c1", id: d.id, state: "running", line: "Flow · step 2 of 3 · your review", asks: true, at: NOW }], "your review asks you");
    // Read again from the store, as after a restart of the page's server before anything moved.
    assert.deepEqual(w.make().live(), w.runner.live());
    w.runner.stop("c1", d.id);
    await settled();
    assert.deepEqual(w.runner.live(), [], "a stopped flow is at work no more");
  });

  // (fails before: yes — the Hunter of 10-28: a flow a restart cut, which waits for your Go on, left the list, and its
  // chat left Now with it; a chat that went left its flows in the list, ghosts in Now)
  test("a flow a restart cut asks you for its Go on; a chat that goes takes its flows out of the list", async () => {
    const w = world();
    const f = started(w, plain([[ask("pm", "Plan.")], [ask("skeptic", "Doubt.")]]));
    w.runner.close();
    w.runner = w.make();
    assert.deepEqual(w.runner.live().map((x) => [x.id, x.state]), [[f.id, "running"]], "read before the restart's word");
    assert.equal(w.runner.reconcile(), 1);
    assert.deepEqual(w.runner.live().map((x) => [x.chainId, x.id, x.state, x.line, x.asks]), [["c1", f.id, "cut", "Flow · step 1 of 2 · stopped by a restart", true]], "it waits for your Go on");
    w.runner.goOn("c1", f.id);
    await settled();
    assert.deepEqual(w.runner.live().map((x) => [x.state, x.asks]), [["running", false]]);
    w.runner.drop("c1");
    assert.deepEqual(w.runner.live(), [], "the chat went: its flows with it");
  });

  test("the holders read says them, the page's five-second resync for Now", async () => {
    const w = world();
    const d = w.runner.create("c1", plain([[ask("pm", "Plan.")], [ask("skeptic", "Doubt.")]]));
    w.runner.start("c1", d.id);
    const m = createRouter(sessionRoutes(/** @type {any} */ ({ memory: {}, usage: {}, ops: {}, sessions: { compactionsNow: () => [] }, config: { get: () => ({}) }, flows: w.runner })))("GET", "/sessions/holders");
    assert.ok(m, "GET /sessions/holders has a row");
    const res = { status: 0, body: "", headersSent: false, setHeader() {}, getHeader() {}, writeHead(/** @type {number} */ s) { this.status = s; this.headersSent = true; return this; }, write(/** @type {string} */ c) { this.body += c; }, end(/** @type {string} */ c = "") { this.body += c; }, on() {} };
    await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, path: "/sessions/holders", method: "GET", params: m.params }), /** @type {any} */ ({}));
    assert.deepEqual(JSON.parse(res.body).flows, [{ chainId: "c1", id: d.id, state: "running", line: "Flow · step 1 of 2", asks: false, at: NOW }]);
  });
});

// (fails before: yes — the owner's of 11-17: teams are "still untested and not fully done", so they sit behind Settings ›
// Experimental's Teams switch, off by default; a flow drawn while it was off took a team box all the same)
describe("teams switched off in Settings › Experimental (core/teams-on.js)", () => {
  const OFF = /is a team, and teams are off in Settings › Experimental \(Teams\)/;
  test("no team box is drawn, changed in a draft, drafted or read: the roster the page and the main agent read holds none; a flow of agents runs", () => {
    const w = world();
    w.teams = false;
    assert.deepEqual([w.runner.roster().teams, w.runner.roster().cards.length], [[], ROSTER.cards.length]);
    assert.throws(
      () => w.runner.create("c1", EXAMPLE),
      (/** @type {any} */ e) => e.status === 400 && e.message === "Builders (step 4) is a team, and teams are off in Settings › Experimental (Teams): draw the flow with the person's agents, or turn teams on",
    );
    const solo = w.runner.create("c1", plain([[ask("pm", "Plan it.", { id: "plan" })], [ask("reviewer", "Check it.", { id: "check", needs: ["plan"] })]]));
    assert.throws(() => w.runner.edit("c1", solo.id, { steps: EXAMPLE.steps }), OFF, "the person's change of a draft");
    assert.equal(w.runner.get("c1", solo.id).steps.length, 2, "the draft as it was");
    w.runner.asked("c1", "plan and build");
    assert.throws(() => w.runner.draftBy("c1", { title: "Plan and build", steps: EXAMPLE.steps }), OFF, "the main agent's draft");
    const read = w.runner.read("c1");
    assert.match(read, /Their agents \(a box's "agent"\):/);
    assert.doesNotMatch(read, /Their teams|a box's "team"/);
    w.runner.start("c1", solo.id);
    assert.equal(w.launched[0]?.spec.as, "pm", "a flow of agents starts");
  });

  test("a draft drawn while teams were on is not started once they are off; a flow started before runs on, its team boxes to come put in an agent's place to change it", async () => {
    const w = world();
    const d = w.runner.create("c1", EXAMPLE);
    w.teams = false;
    assert.throws(() => w.runner.start("c1", d.id), OFF);
    await assert.rejects(w.runner.startInPlace("c1", d.id), OFF);
    assert.equal(w.runner.get("c1", d.id).state, "draft");
    w.teams = true;
    const run = world();
    const f = started(run);
    run.teams = false;
    assert.equal(run.runner.get("c1", f.id).state, "running", "a flow at work goes on");
    const steps = structuredClone(run.runner.get("c1", f.id).steps);
    assert.throws(() => run.runner.edit("c1", f.id, { steps }), OFF, "its team boxes to come stand in the way of a change");
    steps[3].boxes[0] = ask("builder", "Build it.", { id: "build", needs: ["plan", "arch", "mocks", "check"] });
    steps.splice(4, 1);
    const v = run.runner.edit("c1", f.id, { steps });
    assert.deepEqual(v.steps.map((/** @type {any} */ s) => s.boxes.map((/** @type {any} */ b) => b.kind)), [["agent"], ["agent", "agent"], ["agent"], ["agent"]]);
  });
});
