// @ts-check
// What was left behind once Parallelize tasks became the person's consent and tasks given to sub-agents could share a
// file, each in its own worktree (the owner's of 11-09, g3b; the reviews of 11-09): a task ignored on a card stayed held
// back with the switch on; the row of a /parallel sent with the switch on promised a card; and a /plan took the person's
// consent from the page. Since the owner's of 11-10 the card is the agent's suggestion, and /parallel is gone.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tg from "../src/core/task-graph.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { parallelEl } from "../src/ui/harness/conversation/turn.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const T0 = Date.UTC(2026, 10, 9, 12, 0);
/** @type {import("../src/core/task-graph.js").Crew} */
const AGENT = "agent";
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** api and ui ready and apart; docs needs api. */
const ADD = {
  action: "add",
  goal: "Ship the card",
  tasks: [
    { id: "api", name: "The route", writes: ["src/http/a.js"], check: ["node -e 0"], steps: ["Write the route"] },
    { id: "ui", name: "The card", writes: ["src/ui/card.js"], check: ["node -e 0"], steps: ["Draw the card"] },
    { id: "docs", name: "The docs", needs: ["api"], writes: ["docs/GUIDE.md"], steps: ["Say it"] },
  ],
};
/** The tasks a graph keeps as ignored on a card. @param {any} g @returns {string[]} */
const ignoredMarks = (g) => (g?.told || []).filter((/** @type {string} */ m) => m.startsWith("ignored:"));

/**
 * A runner over one session's graph, Parallelize tasks as `s.on` says; `s.shared`: its sub-agents share its folder.
 * @param {{ on: boolean, shared?: boolean }} s
 */
function rig(s) {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: { graph: ok(tg.applyTasks(null, ADD, { at: T0, crew: AGENT })).graph } }]]);
  const registry = {
    launch: () => ({ ok: true, id: "sa_1", done: new Promise(() => {}), tree: Promise.resolve(true) }),
    room: () => ({ max: 4, running: 0, cwd: "/p", worktree: !s.shared }),
    turnOpen: () => false,
    /** @param {string} _c @param {() => void} go */
    afterTurn: (_c, go) => go(),
    notice: () => {},
    tell: () => {},
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
    openGraphs: () => [],
    newestTurnN: () => 2,
  };
  /** @type {any[]} */
  const published = [];
  let t = T0;
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: (_topic, e) => void published.push(e) }, crew: () => AGENT, log: () => {}, now: () => t++, parallel: () => s.on });
  return { runner, published, g: () => chains.get("c1").meta.graph };
}

/** The agent's suggestion through the runner. @param {any} r @param {string[]} ids */
const suggest = (r, ids) => r.runner.apply("c1", { action: "parallel", ids }, { crew: AGENT });

describe("tasks ignored on a card, and the switch turned on since", () => {
  // (fails before: yes — the review of 11-09: with the switch on, the agent's answers and where-you-are still left out
  // what was ignored on a card before)
  test("on, they are held back no more — the answers, where-you-are —; off again, the marks hold them back until the agent suggests them", () => {
    const s = { on: false };
    const r = rig(s);
    ok(suggest(r, ["api", "ui"]));
    const card = /** @type {any} */ (r.runner.offered("c1"));
    ok(r.runner.ignoreOffer("c1", card.at));
    assert.equal(String(r.runner.where("c1", AGENT)).includes("Side by side now"), false, "off: held back, as before");
    s.on = true;
    assert.match(String(r.runner.where("c1", AGENT)), /\n- Side by side now: api, ui\n/, "where-you-are");
    const said = ok(r.runner.apply("c1", { action: "add", tasks: [{ id: "more", name: "More", writes: ["src/more.js"], steps: ["Write it"] }] }, { crew: AGENT }));
    assert.match(said.text, /\nThe graph lets api, ui and more run side by side: none needs another's work\. Whether they should is your call[^\n]* If so, Parallelize tasks is on, so run them at once now/, "the answer");
    assert.equal(said.view?.offer, undefined, "no card");
    s.on = false;
    assert.equal(String(r.runner.where("c1", AGENT)).includes("Side by side now"), false, "off again: more alone beside the ignored");
    ok(suggest(r, ["api", "ui", "more"]));
    assert.deepEqual(ignoredMarks(r.g()), [], "suggested again: ignored no more");
    assert.match(String(r.runner.where("c1", AGENT)), /\n- Side by side now: api, ui, more\n/);
  });

  // (fails before: yes — the review of 11-09: an Ignore pressed with the switch on marked the tasks, which then held them
  // back, unseen, once the switch went off)
  test("a card suggested before the switch went on: its Ignore only clears it — nothing marked to hold the tasks back once it goes off", () => {
    const s = { on: false };
    const r = rig(s);
    ok(suggest(r, ["api", "ui"]));
    const card = /** @type {any} */ (r.runner.offered("c1"));
    s.on = true;
    const out = ok(r.runner.ignoreOffer("c1", card.at));
    assert.deepEqual([out.view.offer, r.runner.offered("c1"), ignoredMarks(r.g())], [undefined, null, []]);
    s.on = false;
    assert.match(String(r.runner.where("c1", AGENT)), /\n- Side by side now: api, ui\n/);
    assert.deepEqual(r.runner.ignoreOffer("c1", card.at), { ok: false, error: "that card is gone: its tasks were started, changed or ignored since, or another card took its place — nothing ignored; the Plan shows them as they are now" }, "cleared: gone");
  });
});

describe("where the session's sub-agents share its folder", () => {
  // (fails before: yes — the hunt of 11-09: the answers and where-you-are left out the second of two tasks that write one
  // file, as they would write there at once, but the card offered every one of them)
  test("the agent's suggestion takes what the answers say: never two that write one file", () => {
    const guard = { id: "api2", name: "The route's guard", writes: ["src/http/a.js"], steps: ["Guard it"] };
    const r = rig({ on: false, shared: true });
    ok(r.runner.apply("c1", { action: "add", tasks: [guard] }, { crew: AGENT }));
    assert.match(String(r.runner.where("c1", AGENT)), /\n- Side by side now: api, ui\n/, "where-you-are");
    const refused = suggest(r, ["api", "ui", "api2"]);
    assert.equal(refused.ok, false);
    assert.match(/** @type {any} */ (refused).error, /^api and api2 both write src\/http\/a\.js, and this chat's sub-agents work in its folder, where they would write it at once: suggest one of them\n/);
    ok(suggest(r, ["api", "ui"]));
    assert.deepEqual(/** @type {any} */ (r.runner.offered("c1"))?.ids, ["api", "ui"], "the card");
    // In copies of their own, all three: the second to land merges at its apply.
    const apart = rig({ on: false });
    ok(apart.runner.apply("c1", { action: "add", tasks: [guard] }, { crew: AGENT }));
    ok(suggest(apart, ["api", "ui", "api2"]));
    assert.deepEqual(/** @type {any} */ (apart.runner.offered("c1"))?.ids, ["api", "ui", "api2"]);
  });
});

describe("the /parallel row's hover, on rows from before 11-10", () => {
  // (fails before: yes — the review of 11-09: with the switch on, it promised a card and an Accept no turn drew)
  test("the switch the turn ran under: on, the agent starts them itself; off, the card as before", () => {
    const doc = stubDocument();
    try {
      const off = /** @type {any} */ (parallelEl({ parallel: true }));
      const on = /** @type {any} */ (parallelEl({ parallel: true, parallelOn: true }));
      assert.equal(off.getAttribute("title"), "You typed /parallel: Filament asked your agent to re-plan the work so its independent tasks can run in parallel. Where two or more can, a card after its reply offers them; nothing starts until you press Accept");
      assert.equal(on.getAttribute("title"), "You typed /parallel with Parallelize tasks on: Filament asked your agent to re-plan the work so its independent tasks can run in parallel, and to start those on sub-agents itself — your consent. No card asks you first");
      assert.equal(on.textContent, off.textContent, "the row's words the same");
      assert.equal(parallelEl({ parallelOn: true }), null);
    } finally {
      doc.restore();
    }
  });
});

describe("through a real Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** The newest user message's text blocks. @param {any} body @returns {string[]} */
  const lastTexts = (body) => {
    const last = [...(body?.messages || [])].reverse().find((/** @type {any} */ m) => m.role === "user");
    return Array.isArray(last?.content) ? last.content.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text)) : [String(last?.content ?? "")];
  };
  /** Whether a request's newest message carries a tool's result. @param {any} body @param {string} id */
  const resultOf = (body, id) => (body?.messages?.at(-1)?.content || []).some?.((/** @type {any} */ b) => b?.type === "tool_result" && b.tool_use_id === id);
  /** @param {any[]} blocks @param {string} [stop] */
  const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks });
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-parallel-agrees-"));
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      const body = call.body || {};
      if (!(body.tools || []).length) return anthropicReply("A title", { model: "brain-model" });
      if (resultOf(body, "plan")) return reply([{ type: "text", text: "api and ui can run in parallel." }]);
      if (lastTexts(body).some((t) => t.includes("split the card work"))) return reply([{ type: "tool_use", id: "plan", name: "tasks", input: { action: "add", goal: "Ship the card", tasks: ADD.tasks.map(({ check, ...t }) => t) } }], "tool_use");
      return reply([{ type: "text", text: "ok" }]);
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(shim?.dataDir, root);
  });
  /** A new chat: its path. @param {any} [settings] */
  const chat = async (settings = {}) => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { permissions: "auto" }, ...settings } } });
    assert.equal(created.status, 200, await created.clone().text());
    return `/api/sessions/${encodeURIComponent(String((await created.json()).id))}`;
  };
  /** @param {string} path @param {Record<string, any>} body */
  const send = async (path, body) => {
    const r = await shim.api(`${path}/turns`, { method: "POST", body: { stream: false, ...body } });
    assert.equal(r.status, 200, await r.clone().text());
    return r;
  };
  /** @param {boolean} on */
  const parallelize = async (on) => {
    const r = await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "experimental.parallelizeTasks": on } } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** The newest line ahead of a message that starts so, in any of its message's blocks. @param {string} start */
  const lineOf = (start) => String(up.received.flatMap((c) => lastTexts(c.body)).findLast((t) => t.startsWith(start)) ?? "");

  // (fails before: yes — the review of 11-09: a /plan sent with no `side` — another client's, or a page that had not heard
  // the switch move — got no consent bullet though the switch was on; and a page's `side` reached a team's lead)
  test("a /plan takes the switch from the config — never where a team leads the chat", async () => {
    await parallelize(true);
    try {
      await send(await chat(), { content: "/plan the importer", plan: true });
      assert.match(lineOf("[Filament: the person typed /plan."), /\n- Parallelize tasks is on, which is their consent: /);
      const led = await chat({ engine: { mode: "team", team: "builders" } });
      for (const side of [false, true]) {
        up.reset();
        await send(led, { content: "/plan the linter", plan: true, ...(side ? { side: true } : {}) });
        const line = lineOf("[Filament: the person typed /plan.");
        assert.ok(line, "the lead heard the /plan");
        assert.doesNotMatch(line, /Parallelize tasks is on/, `a team leads (side ${side})`);
      }
    } finally {
      await parallelize(false);
    }
    up.reset();
    await send(await chat(), { content: "/plan the exporter", plan: true, side: true });
    assert.doesNotMatch(lineOf("[Filament: the person typed /plan."), /Parallelize tasks is on/, "off: none, whatever a page sends");
  });
});
