// @ts-check
// Your defaults for sessions (HarnessV4_Tasks U3-8, UX-13): the global layer's own document, written in the session
// settings' words by Settings › Context, over the config's mirror and under a session's own choice.
// (fails before: yes — there was no `sessions.defaults` and no /api/defaults/settings: the global layer was only the
// config's mirror, which names a handful of knobs, so the line, the method and an agent's way had no default to set)
import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startApp } from "./helpers/app.js";
import { globalLayer, harnessGlobalLayer, ownDefaults, resolveChainSettings } from "../src/services/session-settings.js";

describe("your defaults, through the app", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let projDir;
  const json = async (/** @type {string} */ path, /** @type {any} */ o = {}) => (await shim.api(path, o)).json();
  const boot = async () => {
    if (shim) return;
    shim = await startApp({
      configure: (/** @type {any} */ cfg) => {
        // The dashboard's own rule, mirrored into the global layer: the per-turn recall block's budget is 400 tokens.
        cfg.memory.autopilot = { ...(cfg.memory.autopilot || {}), turnTokens: 400 };
      },
    });
    projDir = join(shim.dataDir, "project");
    mkdirSync(projDir, { recursive: true });
  };
  after(async () => { await shim?.stop?.(); });
  const open = async (/** @type {any} */ settings = undefined) => String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model: "m-1", ...(settings ? { settings } : {}) } })).id);
  const settingsOf = (/** @type {string} */ id) => json(`/api/sessions/${encodeURIComponent(id)}/settings`);

  test("the document as it stands: every knob a layer may hold, each with where it comes from — built in, the dashboard, or yours", async () => {
    await boot();
    const d = await json("/api/defaults/settings");
    assert.deepEqual(d.layer, {});
    assert.equal(d.flat["context.compaction.thresholdPercent"], 85);
    assert.equal(d.sources["context.compaction.thresholdPercent"], "default");
    assert.equal(d.flat["memory.turnTokens"], 400);
    assert.equal(d.sources["memory.turnTokens"], "dashboard", "the config's rule, mirrored");
    assert.equal(d.effective.context.carry, "words");
    assert.ok(typeof d.hash === "string" && d.hash.length > 0);
    assert.ok(!("preset" in d), "there are no presets: a new chat starts from these alone");
    assert.ok(!("model.name" in d.flat), "a session's own state is no default");
  });

  test("a change is written to the config, applies to a session that has not chosen, and leaves one that has", async () => {
    await boot();
    const chose = await open({ context: { compaction: { thresholdPercent: 60 } } });
    const plain = await open();
    assert.equal((await settingsOf(plain)).flat["context.compaction.thresholdPercent"], 85);
    const res = await shim.api("/api/defaults/settings", { method: "PATCH", body: { patch: { memory: { turnTokens: 200 }, context: { carry: "fold", compaction: { thresholdPercent: 70, method: "fold", agent: "ours" } } } } });
    assert.equal(res.status, 200, await res.clone().text());
    const r = await res.json();
    assert.deepEqual(r.changes.map((/** @type {any} */ c) => c.path).sort(), ["context.carry", "context.compaction.agent", "context.compaction.method", "context.compaction.thresholdPercent", "memory.turnTokens"]);
    assert.deepEqual(r.layer, { memory: { turnTokens: 200 }, context: { carry: "fold", compaction: { thresholdPercent: 70, method: "fold", agent: "ours" } } });
    for (const p of ["memory.turnTokens", "context.carry", "context.compaction.thresholdPercent", "context.compaction.method", "context.compaction.agent"]) assert.equal(r.sources[p], "yours", p);
    assert.equal(r.flat["memory.turnTokens"], 200, "yours, over the dashboard's rule");
    // Kept: the config on disk holds it, and the next read gives it back.
    const saved = JSON.parse(readFileSync(join(shim.dataDir, "config.json"), "utf8"));
    assert.deepEqual(saved.sessions.defaults, r.layer);
    assert.deepEqual((await json("/api/defaults/settings")).layer, r.layer);
    // Sessions: the one that has not chosen takes it (its source: the global layer); the one that chose keeps its own.
    const a = await settingsOf(plain);
    assert.equal(a.flat["context.compaction.thresholdPercent"], 70);
    assert.equal(a.sources["context.compaction.thresholdPercent"], "global");
    assert.equal(a.flat["memory.turnTokens"], 200);
    assert.equal(a.flat["context.carry"], "fold");
    const b = await settingsOf(chose);
    assert.equal(b.flat["context.compaction.thresholdPercent"], 60);
    assert.equal(b.sources["context.compaction.thresholdPercent"], "session");
    assert.equal(b.flat["context.compaction.method"], "fold", "and inherits the rest");
  });

  test("a default taken back falls to the dashboard's rule, else to the built-in; nothing changed says so", async () => {
    await boot();
    const r = await json("/api/defaults/settings", { method: "PATCH", body: { unset: ["context.compaction.thresholdPercent", "memory.turnTokens"] } });
    assert.deepEqual(r.changes.map((/** @type {any} */ c) => c.path).sort(), ["context.compaction.thresholdPercent", "memory.turnTokens"]);
    assert.equal(r.flat["context.compaction.thresholdPercent"], 85);
    assert.equal(r.sources["context.compaction.thresholdPercent"], "default");
    assert.equal(r.flat["memory.turnTokens"], 400);
    assert.equal(r.sources["memory.turnTokens"], "dashboard");
    assert.equal(r.sources["context.carry"], "yours", "the others stay");
    const again = await json("/api/defaults/settings", { method: "PATCH", body: { unset: ["memory.turnTokens"] } });
    assert.deepEqual(again.changes, []);
  });

  test("what no default may hold is refused in words: a session's own state, a value out of range, a knob that is none", async () => {
    await boot();
    const before = (await json("/api/defaults/settings")).layer;
    const refused = async (/** @type {any} */ body, /** @type {RegExp} */ words) => {
      const res = await shim.api("/api/defaults/settings", { method: "PATCH", body });
      assert.equal(res.status, 400, await res.clone().text());
      assert.match(String((await res.json()).error), words);
    };
    await refused({ patch: { model: { name: "m-1" } } }, /your global settings never carry a single session's own state/);
    await refused({ patch: { context: { compaction: { thresholdPercent: 500 } } } }, /thresholdPercent/);
    await refused({ patch: { context: { nope: 1 } } }, /nope/);
    await refused("not json", /invalid JSON/);
    await refused([1], /a JSON object is required/);
    assert.deepEqual((await json("/api/defaults/settings")).layer, before, "a refused change writes nothing");
  });

  // (fails before: yes — the owner's of 11-07: there are no presets. A client written before asks with "none" or "plain",
  // which start from your defaults as they did; one that names a preset is refused in words, never started on full tools
  // where it asked for Review's read-only)
  test("there are no presets: their routes are gone, a chat named none or plain starts from these, and one naming a preset is refused in words", async () => {
    await boot();
    assert.equal((await shim.api("/api/presets/default", { method: "POST", body: { name: "review" } })).status, 404);
    assert.equal((await shim.api("/api/presets")).status, 404);
    for (const preset of ["none", "Plain", null]) {
      const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "m-1", preset } });
      assert.equal(r.status, 200, `${preset}: ${await r.clone().text()}`);
      const s = await settingsOf(String((await r.json()).id));
      assert.equal(s.flat["loop.permissions"], (await json("/api/defaults/settings")).flat["loop.permissions"], `${preset}: your defaults`);
      assert.ok(!("preset" in s), "no preset is said of it");
    }
    const review = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "m-1", preset: "review" } });
    assert.equal(review.status, 400);
    assert.match(String((await review.json()).error), /there are no presets: a new chat starts from your defaults[\s\S]*"review" names none/);
  });
});

test("the harness's global layer: the config's mirror, with your defaults over it; a default that is no knob, or out of range, is not read", () => {
  const cfg = { memory: { autopilot: { turnTokens: 400 } }, sessions: { defaults: { memory: { turnTokens: 200 }, context: { compaction: { thresholdPercent: 70, mode: "nope" } }, zzz: 1 } } };
  const g = harnessGlobalLayer(cfg);
  assert.equal(g["memory.turnTokens"], 200);
  assert.equal(g["context.compaction.thresholdPercent"], 70);
  assert.ok(!("context.compaction.mode" in g) && !("zzz" in g));
  assert.deepEqual(ownDefaults(cfg), { "memory.turnTokens": 200, "context.compaction.thresholdPercent": 70 });
  assert.equal(globalLayer({ memory: { autopilot: { turnTokens: 400 } } })["memory.turnTokens"], 400);
  assert.deepEqual(ownDefaults({}), {});
});

// (fails before: yes — found while writing U3-9's docs: your defaults sat in the one global layer every session
// resolves over, so a default set on the harness's Settings › Context page also reshaped an outside client's requests
// (OpenCode's chat folded because the harness's chats were told to fold) — against V4-D105, which keeps a client's
// requests on the dashboard's rules)
test("your defaults reach the sessions the harness holds, never an outside client's: its chat stays on the dashboard's rules", () => {
  const cfg = { memory: { autopilot: { turnTokens: 400 } }, sessions: { defaults: { memory: { turnTokens: 200 }, context: { carry: "fold", compaction: { thresholdPercent: 70, method: "fold" } } } } };
  // The config's mirror is the dashboard's rules alone.
  const mirror = globalLayer(cfg);
  assert.equal(mirror["memory.turnTokens"], 400);
  assert.ok(!("context.compaction.thresholdPercent" in mirror) && !("context.carry" in mirror));
  /** @type {Record<string, any>} */
  const chains = {
    loop: { id: "loop", model: "m-1", project_id: null, native: true },
    opencode: { id: "opencode", model: "m-1", project_id: null, native: false },
    // A client's chat the harness has typed into is still the client's.
    shared: { id: "shared", model: "m-1", project_id: null, native: false },
    chose: { id: "chose", model: "m-1", project_id: null, native: true },
  };
  const archive = {
    chainHead: (/** @type {string} */ id) => chains[id] || null,
    projectSettings: () => ({}),
    chainSettings: (/** @type {string} */ id) => (id === "chose" ? { "context.compaction.thresholdPercent": 60 } : {}),
  };
  const of = (/** @type {string} */ id) => /** @type {NonNullable<ReturnType<typeof resolveChainSettings>>} */ (resolveChainSettings(archive, cfg, id));
  const loop = of("loop");
  assert.deepEqual([loop.flat["memory.turnTokens"], loop.flat["context.compaction.thresholdPercent"], loop.flat["context.compaction.method"], loop.flat["context.carry"]], [200, 70, "fold", "fold"]);
  assert.equal(loop.sources["context.compaction.thresholdPercent"], "global");
  for (const id of ["opencode", "shared"]) {
    const c = of(id);
    assert.deepEqual([c.flat["memory.turnTokens"], c.flat["context.compaction.thresholdPercent"], c.flat["context.compaction.method"], c.flat["context.carry"]], [400, 85, "summary", "words"], id);
    assert.equal(c.sources["context.compaction.thresholdPercent"], "default", id);
  }
  assert.equal(of("chose").flat["context.compaction.thresholdPercent"], 60, "a session's own choice stands over yours");
  assert.equal(of("chose").flat["memory.turnTokens"], 200);
  assert.equal(resolveChainSettings(archive, cfg, "nobody"), null);
  // (fails before: yes — the swarm's review of 11-10: a briefing built while Full control was on kept riding their turns
  // once it went off, memory's recall and tools alone off) Another machine's agents' chat, fenced: its briefing off too.
  const fenced = /** @type {NonNullable<ReturnType<typeof resolveChainSettings>>} */ (resolveChainSettings({ ...archive, fenced: () => true }, cfg, "loop"));
  assert.deepEqual([fenced.flat["memory.enabled"], fenced.flat["memory.tools"], fenced.flat["memory.briefing"]], [false, false, false]);
});
