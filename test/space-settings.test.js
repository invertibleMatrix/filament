// @ts-check
// A Space's settings (the owner's of 11-04: "a model selection per space so that some automated agentic work like
// Routines could run on that model without users having to open a chat"): core/space-settings.js — their shapes, their
// checks, what a Space runs on —, the store's Settings › Space and each Space's own, a routine's run on its Space's model
// and effort, a model that cannot run giving way to it, and the admin routes the pages call.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ASKS_DEFAULT, SPACE_ASKS, SPACE_EFFORTS, runsOnOf, settingsChange, settingsIn } from "../src/core/space-settings.js";
import { routineRunsOn, rowWords, runsOnWhose } from "../src/core/routines.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createRoutines } from "../src/app/routines.js";
import { askRunWords, createSpaceAsks } from "../src/app/space-asks.js";
import { spaceRoutes } from "../src/http/admin/spaces.js";
import { createRouter } from "../src/http/router.js";
import { removeDirs } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-space-settings-${tag}-`));
  made.push(d);
  return d;
};
/** @param {{ ok: boolean, error?: string }} got */
const errorOf = (got) => (got.ok ? "" : String(got.error));

describe("a Space's settings (core)", () => {
  test("settingsIn keeps what reads: a model's name, its effort only with it, what an app's ask does", () => {
    assert.deepEqual(settingsIn({ model: " claude-opus-5-5 ", effort: "high", asks: "run" }), { model: "claude-opus-5-5", effort: "high", asks: "run" });
    assert.deepEqual(settingsIn({ effort: "high", asks: "chat" }), { asks: "chat" }, "an effort without its model is none");
    assert.deepEqual(settingsIn({ model: "m", effort: "turbo", asks: "never" }), { model: "m" }, "an effort and an ask that are none");
    assert.deepEqual(settingsIn({ model: "a\nb" }), {}, "a name on two lines is none");
    assert.deepEqual(settingsIn({ model: "x".repeat(201) }), {});
    assert.deepEqual([settingsIn(null), settingsIn([]), settingsIn("m")], [{}, {}, {}]);
    assert.deepEqual([SPACE_EFFORTS, SPACE_ASKS, ASKS_DEFAULT], [["low", "medium", "high", "xhigh", "max"], ["ask", "run", "chat"], "ask"]);
  });

  test("settingsChange: each field set or taken away; a model taken away or changed takes its effort; refusals in words", () => {
    const set = settingsChange({}, { model: "m1", effort: "high", asks: "run" });
    assert.deepEqual(set, { ok: true, settings: { model: "m1", effort: "high", asks: "run" }, changed: ["model", "effort", "asks"] });
    assert.deepEqual(settingsChange({ model: "m1", effort: "high" }, { model: "m2" }), { ok: true, settings: { model: "m2" }, changed: ["model", "effort"] }, "another model: the effort was the one before's");
    assert.deepEqual(settingsChange({ model: "m1", effort: "high" }, { model: "m2", effort: "low" }), { ok: true, settings: { model: "m2", effort: "low" }, changed: ["model", "effort"] });
    assert.deepEqual(settingsChange({ model: "m1", effort: "high" }, { model: "m1" }), { ok: true, settings: { model: "m1", effort: "high" }, changed: [] }, "the same model keeps its effort");
    assert.deepEqual(settingsChange({ model: "m1", effort: "high", asks: "run" }, { model: null }), { ok: true, settings: { asks: "run" }, changed: ["model", "effort"] });
    assert.deepEqual(settingsChange({ model: "m1", effort: "high" }, { effort: "" }), { ok: true, settings: { model: "m1" }, changed: ["effort"] });
    assert.deepEqual(settingsChange({ asks: "run" }, { asks: "" }), { ok: true, settings: {}, changed: ["asks"] });
    assert.equal(errorOf(settingsChange({}, { effort: "high" })), "an effort is its model's: choose the model first");
    assert.equal(errorOf(settingsChange({ model: "m" }, { effort: "turbo" })), 'effort is one of low, medium, high, xhigh, max, or "" for the model\'s own');
    assert.equal(errorOf(settingsChange({}, { asks: "always" })), 'asks is ask, run, chat, or "" for the default');
    assert.equal(errorOf(settingsChange({}, { model: 7 })), 'model is a model\'s name, or "" for none');
    assert.equal(errorOf(settingsChange({}, { model: "a\nb" })), "model is a model's name, 200 characters at most, on one line");
    assert.equal(errorOf(settingsChange({}, { colour: "red" })), "a Space's settings are model, effort and asks, not colour");
    assert.equal(errorOf(settingsChange({}, [])), "a Space's settings are a JSON object: { model?, effort?, asks? }");
  });

  test("runsOnOf: the Space's own model with its own effort, else Settings › Space's with that one, else none; the ask the same way", () => {
    assert.deepEqual(runsOnOf({ model: "own", effort: "low" }, { model: "def", effort: "max", asks: "run" }), { model: "own", effort: "low", from: "space", asks: "run", asksFrom: "default" });
    assert.deepEqual(runsOnOf({ model: "own" }, { model: "def", effort: "max" }), { model: "own", effort: "", from: "space", asks: "ask", asksFrom: "" }, "its own model at its own effort, never the default's");
    assert.deepEqual(runsOnOf({ asks: "chat" }, { model: "def", effort: "max" }), { model: "def", effort: "max", from: "default", asks: "chat", asksFrom: "space" });
    assert.deepEqual(runsOnOf(undefined, undefined), { model: "", effort: "", from: "", asks: "ask", asksFrom: "" });
  });

  test("routineRunsOn: the person's pick for it first, then its Space's, then the model it was proposed on; whose it is in words", () => {
    const space = { model: "space-m", effort: "high", from: /** @type {const} */ ("space") };
    const none = { model: "", effort: "", from: /** @type {const} */ ("") };
    assert.deepEqual(routineRunsOn({ model: "mine", modelBy: "you", effort: "low" }, space), { model: "mine", effort: "low", from: "routine" });
    assert.deepEqual(routineRunsOn({ model: "proposed" }, space), { model: "space-m", effort: "high", from: "space" }, "a chat's model gives way to the Space's");
    assert.deepEqual(routineRunsOn({ model: "", modelBy: "you" }, space), { model: "space-m", effort: "high", from: "space" }, "Use the default: the Space's");
    assert.deepEqual(routineRunsOn({ model: "proposed" }, none), { model: "proposed", effort: "", from: "proposed" });
    assert.deepEqual(routineRunsOn({ model: "", modelBy: "you" }, none), { model: "", effort: "", from: "" });
    assert.equal(runsOnWhose("proposed", "Release"), "The model Release ran on when it proposed it");
    assert.equal(runsOnWhose("default", ""), "Every Space's model, from Settings › Space");
  });
});

describe("the store: Settings › Space and a Space's own", () => {
  test("Settings › Space is kept in its file beside the Spaces, read back by a new store, said to every Space", () => {
    const dir = fresh("defaults");
    /** @type {any[]} */
    const heard = [];
    const store = createSpaceStore({ dir, events: { publish: (topic, p) => heard.push([topic, p]) } });
    assert.deepEqual(store.defaults(), {});
    assert.deepEqual(store.setDefaults({ model: "claude-opus-5-5", effort: "high" }), { model: "claude-opus-5-5", effort: "high" });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "_space-settings.json"), "utf8")), { model: "claude-opus-5-5", effort: "high" });
    assert.deepEqual(heard, [["space", { type: "space", project: "*", seq: 0 }]], "every Space's page reads it again");
    store.setDefaults({ model: "claude-opus-5-5" });
    assert.equal(heard.length, 1, "nothing moved: nothing said, nothing written");
    assert.throws(() => store.setDefaults({ effort: "turbo" }), { status: 400 });
    const again = createSpaceStore({ dir });
    assert.deepEqual(again.defaults(), { model: "claude-opus-5-5", effort: "high" });
    assert.deepEqual(again.projects(), [], "its file is no Space");
  });

  test("a Space's own: kept in its file, a line in What happened each time; what it runs on stands over Settings › Space's", () => {
    const dir = fresh("own");
    const store = createSpaceStore({ dir, madeOnly: true });
    assert.throws(() => store.setSettings("p1", { model: "m" }), { status: 404 }, "a project with no Space has no settings");
    store.make("p1");
    store.setDefaults({ model: "def", effort: "max" });
    assert.deepEqual(store.runsOn("p1"), { model: "def", effort: "max", from: "default", asks: "ask", asksFrom: "" });
    store.setSettings("p1", { model: "own-m", effort: "low" });
    assert.equal(store.get("p1").log.at(-1)?.text, "You set the model this Space's agents run on: own-m at low effort. Its routines and an app's asks run on it where you chose none for them.");
    assert.deepEqual(store.runsOn("p1"), { model: "own-m", effort: "low", from: "space", asks: "ask", asksFrom: "" });
    store.setSettings("p1", { asks: "run" });
    assert.equal(store.get("p1").log.at(-1)?.text, "An app's ask in this Space: run it at once, on the Space's model.");
    const lines = store.get("p1").log.length;
    store.setSettings("p1", { asks: "run" });
    assert.equal(store.get("p1").log.length, lines, "the same again says nothing");
    store.setSettings("p1", { model: "" });
    assert.equal(store.get("p1").log.at(-1)?.text, "This Space's agents run on Settings › Space's model again: def at max effort.");
    assert.deepEqual(createSpaceStore({ dir, madeOnly: true }).settingsOf("p1"), { asks: "run" }, "read back from its file");
    assert.throws(() => store.setSettings("p1", { effort: "high" }), { status: 400, message: "an effort is its model's: choose the model first" });
  });

  test("a routine's model, the person's, with its effort; an effort that is none refused; read back from its file", () => {
    const dir = fresh("routine");
    const store = createSpaceStore({ dir });
    const r = store.routinePropose("p1", { title: "Brief", when: "weekdays 09:00", task: "Say what waits.", writes: false }, { chain: "c1", byName: "Release", model: "chat-m" });
    store.routineModel("p1", r.id, "pick-m", "xhigh");
    assert.deepEqual([store.get("p1").routines[0].model, store.get("p1").routines[0].effort, store.get("p1").log.at(-1)?.text], ["pick-m", "xhigh", "You chose the model “Brief” runs on: pick-m at xhigh effort."]);
    assert.equal(createSpaceStore({ dir }).get("p1").routines[0].effort, "xhigh");
    store.routineModel("p1", r.id, "", "high");
    assert.deepEqual([store.get("p1").routines[0].model, store.get("p1").routines[0].effort], ["", undefined], "the Space's model: no effort of its own");
    assert.throws(() => store.routineModel("p1", r.id, "pick-m", "turbo"), { status: 400 });
  });
});

describe("a routine's run on its Space's model", () => {
  /** A runner over a store in memory, its chats' makings kept. @param {{ problems?: Record<string, string> }} [o] */
  const worldOf = (o = {}) => {
    const store = createSpaceStore({ dir: null });
    /** @type {any[]} */
    const created = [];
    let n = 0;
    const routines = createRoutines({
      spaces: store,
      sessions: { create: (x) => (created.push(x), { id: `run${++n}` }), besideFacts: () => ({ busy: true, asking: false, last: null }) },
      mark: () => {},
      postTurn: async () => ({ status: 200, body: {} }),
      folderOf: () => "/work/app",
      problemOf: (m) => o.problems?.[m] || null,
      // Ids that spell their efforts: cursor/x's level is its name's.
      chatModel: (m, e) => (m.startsWith("cursor/") ? { name: `${m}-${e}`, effort: null } : { name: m, effort: e }),
    });
    const r = store.routinePropose("p1", { title: "Brief", when: "weekdays 09:00", task: "Say what waits.", writes: false }, { chain: "c1", byName: "Release", model: "chat-m" });
    store.routineOn("p1", r.id);
    return { store, routines, created, id: r.id };
  };

  test("no model of the person's: its Space's, at its effort beside the name; the run's row says what it ran on", async () => {
    const w = worldOf();
    w.store.setDefaults({ model: "def-m", effort: "high" });
    await w.routines.runNow("p1", w.id);
    assert.deepEqual(w.created[0], { cwd: "/work/app", model: "def-m", title: w.created[0].title, settings: { loop: { permissions: "read-only" }, model: { effort: "high" } } });
    assert.equal(w.store.get("p1").routines[0].last?.on, "def-m · high");
  });

  test("the person's pick for it wins; a model whose ids spell their efforts runs as its member at that level", async () => {
    const w = worldOf();
    w.store.setDefaults({ model: "def-m", effort: "high" });
    w.store.routineModel("p1", w.id, "cursor/grok", "low");
    await w.routines.runNow("p1", w.id);
    assert.deepEqual([w.created[0].model, w.created[0].settings], ["cursor/grok-low", { loop: { permissions: "read-only" } }]);
  });

  test("its own model cannot run now: its Space's runs it, said in What happened; with none to give way to, its failure says why", async () => {
    const w = worldOf({ problems: { "pick-m": "Claude Code's plan is used up" } });
    w.store.routineModel("p1", w.id, "pick-m");
    await assert.rejects(w.routines.runNow("p1", w.id), { status: 502, message: "“Brief” could not start: it runs on pick-m, which cannot run now: Claude Code's plan is used up" });
    assert.equal(w.created.length, 0, "no chat made for it");
    w.store.setSettings("p1", { model: "space-m", effort: "max" });
    await w.routines.runNow("p1", w.id);
    assert.deepEqual([w.created[0].model, w.created[0].settings.model], ["space-m", { effort: "max" }]);
    const last = w.store.get("p1").routines[0].last;
    assert.deepEqual([last?.on, last?.instead], ["space-m · max", "pick-m could not run (Claude Code's plan is used up)"]);
    assert.ok(w.store.get("p1").log.some((e) => e.text === "“Brief” runs on space-m · max instead, the model for this Space's agents: pick-m could not run (Claude Code's plan is used up)."));
    // Its row says so too, while it runs.
    assert.match(rowWords(w.store.get("p1").routines[0], { now: Date.now() }).last, /^now: running since .* · on space-m at max instead$/);
  });

  test("nothing names a model: its failure says where one is chosen", async () => {
    const w = worldOf();
    w.store.routineModel("p1", w.id, "");
    await assert.rejects(w.routines.runNow("p1", w.id), { status: 502, message: "“Brief” could not start: it has no model to run on: choose one on its sheet, or set a model for every Space in Settings › Space" });
  });
});

describe("an app's ask run here, in the background", () => {
  /**
   * A runner over a store in memory. `during`: what happens while its turn is posted — its turn letting go before the
   * answer comes, say. @param {{ status?: number, problems?: Record<string, string>, during?: (id: string, w: any) => void }} [o]
   */
  const asksOf = (o = {}) => {
    const store = createSpaceStore({ dir: null, madeOnly: true });
    store.make("p1");
    /** @type {any[]} */
    const created = [];
    /** @type {[string, any][]} */
    const posted = [];
    /** @type {string[]} */
    const removed = [];
    /** Each chat's facts, as the test sets them. @type {Map<string, any>} */
    const facts = new Map();
    const clock = { at: 1_000_000 };
    const asks = createSpaceAsks({
      spaces: store,
      now: () => clock.at,
      sessions: {
        create: (x) => (created.push(x), { id: `ask${created.length}` }),
        besideFacts: (id) => facts.get(id) || { busy: true, asking: false, last: null },
      },
      postTurn: async (id, b) => {
        posted.push([id, b]);
        o.during?.(id, { asks, facts });
        return { status: o.status ?? 200, body: o.status ? { error: "the upstream said no" } : {} };
      },
      folderOf: (p) => (p === "p1" ? "C:/Spaces/Northwind" : null),
      nameOf: () => "Northwind",
      problemOf: (m) => o.problems?.[m] || null,
      remove: async (id) => void removed.push(id),
    });
    return { store, asks, created, posted, removed, facts, clock };
  };

  test("its end, as its turn lets go: what it answered in What happened, once; a failure says why; one waiting for the person goes on", async () => {
    const w = asksOf();
    w.store.setSettings("p1", { model: "space-m" });
    const { chain } = await w.asks.run("p1", { words: "Summarize the day.", app: "Extra Life HQ" });
    w.asks.released(chain);
    assert.ok(!w.store.get("p1").log.some((e) => e.text.startsWith("Extra Life HQ's ask ran")), "still at work: nothing yet");
    w.facts.set(chain, { busy: false, asking: true, last: null });
    w.asks.released(chain);
    assert.ok(!w.store.get("p1").log.some((e) => e.text.startsWith("Extra Life HQ's ask ran")), "waiting for the person: it goes on");
    w.clock.at += 41_000;
    w.facts.set(chain, { busy: false, asking: false, last: { final: true, text: "## Saved: a quiet Tuesday — 12 commits\n\nThemes…", cut: false, failed: false, why: "", stopped: false } });
    w.asks.released(chain);
    assert.equal(w.store.get("p1").log.at(-1)?.text, "Extra Life HQ's ask ran (41 s): Saved: a quiet Tuesday — 12 commits");
    assert.deepEqual(w.store.get("p1").log.at(-1)?.by, { kind: "filament", chain });
    const lines = w.store.get("p1").log.length;
    w.asks.released(chain);
    assert.equal(w.store.get("p1").log.length, lines, "written once");
    const second = await w.asks.run("p1", { words: "Again.", app: "Extra Life HQ" });
    w.facts.set(second.chain, { busy: false, asking: false, last: { final: false, text: "", cut: false, failed: true, why: "the upstream refused the key", stopped: false } });
    w.asks.released(second.chain);
    assert.equal(w.store.get("p1").log.at(-1)?.text, "Extra Life HQ's ask failed: the upstream refused the key");
  });

  // (fails before: yes — found by the review of 11-04: a turn refused as it started let go first, its failure written
  // for a chat then removed; one that ended at once wrote its end before the line saying it was asked)
  test("a turn that lets go before its answer: its end waits for that answer — after the asked line where it began, none where it was refused", async () => {
    const quick = asksOf({ during: (id, x) => { x.facts.set(id, { busy: false, asking: false, last: { final: true, text: "Saved.", cut: false, failed: false, why: "", stopped: false } }); x.asks.released(id); } });
    quick.store.setSettings("p1", { model: "space-m" });
    await quick.asks.run("p1", { words: "Summarize the day.", app: "Pulse" });
    assert.deepEqual(quick.store.get("p1").log.slice(-2).map((e) => e.text), ["Pulse asked an agent: “Summarize the day.” — it runs in the background on space-m, reading only.", "Pulse's ask ran (under a second): Saved."]);
    const refused = asksOf({ status: 409, during: (id, x) => { x.facts.set(id, { busy: false, asking: false, last: null }); x.asks.released(id); } });
    refused.store.setSettings("p1", { model: "space-m" });
    const lines = refused.store.get("p1").log.length;
    await assert.rejects(refused.asks.run("p1", { words: "Do it.", app: "Pulse" }), { status: 502 });
    assert.equal(refused.store.get("p1").log.length, lines, "no line for a chat that went");
  });

  test("on the Space's model and effort, reading only, its first message what it is then the app's words; a line in What happened", async () => {
    const w = asksOf();
    w.store.setSettings("p1", { model: "space-m", effort: "high" });
    const got = await w.asks.run("p1", { words: "Summarize the team's work on 2026-11-03.\nSave it with write_db.", app: "Extra Life HQ" });
    assert.deepEqual(got, { chain: "ask1", on: "space-m · high" });
    assert.deepEqual(w.created, [{ cwd: "C:/Spaces/Northwind", model: "space-m", title: "Extra Life HQ: Summarize the team's work on 2026-11-03.", settings: { loop: { permissions: "read-only" }, model: { effort: "high" } } }]);
    assert.equal(w.posted[0][1].content[0].text, askRunWords({ app: "Extra Life HQ", space: "Northwind", words: "Summarize the team's work on 2026-11-03.\nSave it with write_db." }));
    assert.match(w.posted[0][1].content[0].text, /^This is an ask of Extra Life HQ, an app of Northwind's Space, run as the person pressed its button: .* You read only: change no file, and send nothing\./);
    assert.deepEqual(w.store.get("p1").log.at(-1), { id: w.store.get("p1").log.at(-1)?.id, at: w.store.get("p1").log.at(-1)?.at, by: { kind: "filament", chain: "ask1" }, text: "Extra Life HQ asked an agent: “Summarize the team's work on 2026-11-03.” — it runs in the background on space-m · high, reading only.", task: null });
  });

  test("the sheet's own model and effort over the Space's; refusals in words — no model, one that cannot run, no words; a turn that could not start takes its chat with it", async () => {
    const w = asksOf({ problems: { "walled-m": "its plan is used up" } });
    await assert.rejects(w.asks.run("p1", { words: "Do it" }), { status: 409, message: "This Space has no model for its agents yet: choose one for this ask, or set one in Settings › Space." });
    await assert.rejects(w.asks.run("p1", { words: "Do it", model: "walled-m" }), { status: 409, message: "walled-m cannot run now: its plan is used up" });
    await assert.rejects(w.asks.run("p1", { words: "  " }), { status: 400 });
    await assert.rejects(w.asks.run("p9", { words: "Do it", model: "m" }), { status: 404 });
    w.store.setDefaults({ model: "def-m", effort: "max" });
    await w.asks.run("p1", { words: "Do it", model: "pick-m", effort: "" });
    assert.deepEqual([w.created[0].model, w.created[0].settings], ["pick-m", { loop: { permissions: "read-only" } }], "the sheet's model at its own effort");
    const failing = asksOf({ status: 409 });
    failing.store.setDefaults({ model: "def-m" });
    await assert.rejects(failing.asks.run("p1", { words: "Do it" }), { status: 502, message: "its turn could not start: the upstream said no" });
    assert.deepEqual(failing.removed, ["ask1"]);
  });
});

describe("the admin routes", () => {
  /** @param {any[]} rows @param {string} method @param {string} path @param {any} [json] */
  async function call(rows, method, path, json) {
    const m = createRouter(rows)(method, path);
    assert.ok(m, `${method} ${path} matched a row`);
    const got = { status: 0, body: /** @type {any} */ (null) };
    const res = { headersSent: false, writableEnded: false, writeHead: (/** @type {number} */ s) => void (got.status = s), end: (/** @type {string} */ b) => void (got.body = JSON.parse(String(b))) };
    await m.handler({ res, url: new URL(`http://localhost/api${path}`), params: m.params, json: async () => json }, {});
    return got;
  }
  const routesOf = () => {
    const store = createSpaceStore({ dir: null, madeOnly: true });
    store.make("p1");
    const rows = spaceRoutes({
      config: { get: () => ({ agentLoop: { roots: [tmpdir()] }, server: {} }) },
      memory: { archive: { getProject: (/** @type {string} */ id) => (id === "p1" ? { id, name: "app", cwd: "/r" } : null) } },
      spaces: store,
      subagentModelProblem: (/** @type {string} */ m) => (m === "walled-m" ? "its plan is used up" : null),
    });
    return { rows, store };
  };

  test("Settings › Space read and changed; a model that cannot run now is kept, and the answer says why", async () => {
    const { rows } = routesOf();
    const first = await call(rows, "GET", "/spaces/settings");
    assert.deepEqual(first.body, { settings: {}, spaces: [], efforts: SPACE_EFFORTS, asks: SPACE_ASKS, pausedSince: null });
    const set = await call(rows, "PATCH", "/spaces/settings", { model: "walled-m", effort: "high", asks: "run" });
    assert.deepEqual([set.status, set.body], [200, { ok: true, settings: { model: "walled-m", effort: "high", asks: "run" }, problem: "its plan is used up" }]);
    const bad = await call(rows, "PATCH", "/spaces/settings", { effort: "turbo" });
    assert.deepEqual([bad.status, bad.body.error], [400, 'effort is one of low, medium, high, xhigh, max, or "" for the model\'s own']);
  });

  test("a Space's own: changed through its route, its page told what it runs on; Settings › Space lists it", async () => {
    const { rows } = routesOf();
    await call(rows, "PATCH", "/spaces/settings", { model: "def-m" });
    const got = await call(rows, "PATCH", "/space/p1/settings", { model: "own-m", effort: "low" });
    assert.equal(got.status, 200);
    assert.deepEqual([got.body.settings, got.body.space.settings, got.body.space.runsOn], [{ model: "own-m", effort: "low" }, { model: "own-m", effort: "low" }, { model: "own-m", effort: "low", from: "space", asks: "ask", asksFrom: "" }]);
    const listed = await call(rows, "GET", "/spaces/settings");
    assert.deepEqual(listed.body.spaces, [{ project: "p1", name: "app", own: false, settings: { model: "own-m", effort: "low" } }]);
    const none = await call(rows, "PATCH", "/space/p9/settings", { model: "m" });
    assert.equal(none.status, 404);
    assert.equal(existsSync(join(tmpdir(), "_space-settings.json")), false, "a store in memory writes no file");
  });
});
