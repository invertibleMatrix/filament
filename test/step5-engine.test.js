// @ts-check
// HarnessV3 Step 5 (the engine, end to end): which engine answers a harness session's turns (engine.mode) — an outside
// client's go to the model it names — digests for every session, and the widgets that show them. The pure half runs the owners; the live
// half runs the app against a scripted provider, the way an outside client's chat reaches it; the widget half runs without a
// DOM.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { engineFor, engineProblem, filamentRuns } from "../src/app/engine.js";
import { MemoryService } from "../src/services/memory/index.js";
import { ENGINE_MODES, KNOBS, flatten } from "../src/services/session-settings.js";
import { replyTextOf } from "../src/ui/harness/lib/labels.js";
import { fakeUpstream, startApp } from "./helpers/app.js";
import { chainKeyForConversationId } from "../src/services/memory/brain.js";

/** @param {any} content */
const textOfContent = (content) => (typeof content === "string" ? content : (content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));

// ---------------------------------------------------------------------------------------------------
// The owners, pure
// ---------------------------------------------------------------------------------------------------

describe("Step 5: the owners", () => {
  // (fails before: yes — the owner's rule of 10-31: engine.mode had an `agent` mode, which sent an outside client's turns
  // to the loop, and the engine's knobs reached every client)
  test("engineFor: the model mode says nothing; filamentRuns: the harness composes, or the name is the loop's — never an outside client's engine (D1)", () => {
    assert.deepEqual(engineFor({ mode: "model" }, { agentLoop: { enabled: true } }, { model: "m-1", agent: null }), { note: null });
    assert.deepEqual(ENGINE_MODES, ["model", "team"]);
    // The chat commands ask the same question: a setting of reach Filament is read when Filament runs the turn.
    assert.equal(filamentRuns({ composed: false, settings: { engine: { mode: "team", team: "architect" } } }, { agent: null }), false, "an outside client's session: its engine is never read");
    assert.equal(filamentRuns({ composed: false, settings: {} }, { agent: { model: "m-1" } }), true, "a call of Filament's own that names the loop");
    assert.equal(filamentRuns({ composed: true, settings: {} }, { agent: null }), true, "the harness composes: Filament runs it");
    for (const k of ["engine.mode", "engine.team", "subagents.pool"]) assert.equal(KNOBS[k].reach, "filament", k);
  });

  // (fails before: yes — the reasons an engine cannot run lived inside engineFor's record notes; /set engine.* could not say them)
  test("engineProblem: why the engine a session names cannot run — no team by that name — and nothing when it can (D1)", () => {
    const teams = { find: (/** @type {unknown} */ t) => (t === "architect" ? { key: "architect", name: "Architect" } : null) };
    const team = { mode: "team", team: "architect" };
    assert.equal(engineProblem({ mode: "model" }, {}), null);
    const on = { experimental: { teams: true } };
    assert.equal(engineProblem(team, on, teams), null);
    // (fails before: yes — a stored `agentLoop.enabled: false` said the loop was off; it has no switch now, the owner's
    // of 11-09, so an old config that holds one leads all the same)
    assert.equal(engineProblem(team, { ...on, agentLoop: { enabled: false } }, teams), null);
    assert.match(String(engineProblem({ mode: "team", team: "nobody" }, on, teams)), /^engine\.team names `nobody`, which is no team/);
  });

  test("sessionChainOf: a loop's tick and what hangs under it book on the session that started the work; a broken or looping ancestry books nowhere (D6)", () => {
    const byId = new Map(
      /** @type {[string, any][]} */ ([
        ["root", { id: "root", memory: { chain: "c-session" } }],
        ["tick", { id: "tick", agentOf: "root", memory: { chain: "c-tick-internal" } }],
        ["a", { id: "a", agentOf: "b" }],
        ["b", { id: "b", agentOf: "a" }],
      ]),
    );
    const svc = /** @type {any} */ ({ records: { byId } });
    const chainOf = (/** @type {any} */ rec) => MemoryService.prototype.sessionChainOf.call(svc, rec);
    assert.equal(chainOf(byId.get("root")), "c-session", "a client's own request: its chain");
    assert.equal(chainOf(byId.get("tick")), "c-session", "a loop's tick: the session, not the internal chain it rode");
    assert.equal(chainOf({ id: "deep", agentOf: "tick" }), "c-session", "two steps down: the walk goes on to the root");
    assert.equal(chainOf({ id: "orphan", agentOf: "gone" }), null, "the parent is gone: nowhere");
    assert.equal(chainOf(byId.get("a")), null, "a loop in the ancestry: nowhere");
    assert.equal(chainOf({ id: "slice", parentRequest: "root", memory: { chain: "c-memory" } }), "c-memory", "parentRequest is not followed (a compaction's slice is compaction, which booksOnSession declines)");
  });
});

// ---------------------------------------------------------------------------------------------------
// The live app: an outside client's chat and the harness, against a scripted provider
// ---------------------------------------------------------------------------------------------------

describe("Step 5 on the live app: an outside client's session", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** A test's own answers, ahead of the defaults. @type {(call: any) => any} */
  let script = () => undefined;
  const SYS = "You help with code.";
  const person = (/** @type {string} */ text) => ({ role: "user", content: [{ type: "text", text }] });
  const said = (/** @type {string} */ text) => ({ role: "assistant", content: [{ type: "text", text }] });
  /**
   * An outside client's request of session `sid`.
   * @param {string} sid @param {any[]} messages @param {any} [extra]  body fields @param {Record<string, string>} [headers]  on top of the chat's own
   */
  const zc = async (sid, messages, extra = {}, headers = {}) => {
    const r = await shim.post("/v1/messages", { model: "m-1", max_tokens: 300, system: SYS, messages, ...extra }, { "x-session-id": sid, "x-filament-cwd": root, "user-agent": "opencode/1.2", ...headers });
    const raw = await r.text();
    /** @type {any} */
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {}
    return { status: r.status, raw, json, text: textOfContent(json?.content), id: String(r.headers.get("x-filament-request-id")), headers: r.headers };
  };
  /** @param {string} sid */
  const chainOf = (sid) => /** @type {any} */ (shim.app.memory.archive).chainIdForKey(chainKeyForConversationId(sid));
  /** @param {string} sid @param {{ patch?: any, unset?: string[] }} change */
  const setFor = async (sid, change) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(chainOf(sid))}/settings`, { method: "PATCH", body: change });
    assert.equal(r.status, 200, await r.clone().text());
    const j = await r.json();
    assert.deepEqual(j.errors || [], [], "the write was accepted");
    return j;
  };
  /** @param {string} chainId */
  const settingsOf = async (chainId) => (await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/settings`)).json();
  /** @param {string} id */
  const recordOf = async (id) => (await shim.api(`/api/requests/${encodeURIComponent(id)}`)).json();
  const since = (/** @type {number} */ mark) => up.received.slice(mark).filter((c) => c.kind === "anthropic");

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-s5-"));
    up = await fakeUpstream(async (call) => script(call));
    shim = await startApp({
      memory: true,
      summarizer: "sum-1",
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"], pricing: { "m-": { input: 100, output: 100 } } }];
        cfg.routes = ["m-*", "sum-*"].map((match) => ({ match, upstream: "m", upstreamModel: "{model}", enabled: true }));
        cfg.agentLoop = { permissions: "edit", roots: [root], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  // (fails before: yes — the owner's rule of 10-31, an outside client gets a plain proxy plus memory: a team its session
  // named answered its turns, its lead on the agent loop)
  test("an outside client's session goes to the model it names: a team its session names leads nothing", async () => {
    const sid = "s5-engine";
    const history = [person("warm up"), said("MODEL ANSWER")];
    assert.equal((await zc(sid, [person("warm up")])).text, "MODEL ANSWER", "the default: the model the client names");
    await setFor(sid, { patch: { engine: { mode: "team", team: "builders" } } });
    const mark = up.received.length;
    const turn = await zc(sid, [...history, person("read the notes")]);
    assert.equal(turn.status, 200, turn.raw);
    assert.equal(turn.text, "MODEL ANSWER");
    const rec = await recordOf(turn.id);
    assert.equal(rec.upstream, "m", "the model the client names");
    assert.equal(rec.agent ?? null, null);
    assert.ok(!(rec.changes || []).some((/** @type {string} */ c) => c.startsWith("engine:")), rec.changes.join("\n"));
    assert.ok(since(mark).every((c) => !(c.body?.tools || []).some((/** @type {any} */ t) => t.name === "read")), "no loop's hands");
  });

  // (fails before: yes — the owner's rule of 10-31: a client's `agent/m-1` drove the agent loop, with hands on this
  // machine's folders, and /v1/models offered the name)
  test("`agent/<model>` is Filament's own name: an outside client's is no model", async () => {
    const named = await zc("s5-agent-name", [person("read the notes")], { model: "agent/m-1" });
    assert.equal(named.status, 404, named.raw);
  });

  // (fails before: yes — the same rule: /v1/models offered every API model again as `agent/<model>`)
  test("/v1/models offers an outside client no `agent/` name", async () => {
    const listed = await (await shim.api("/v1/models")).json();
    const ids = (listed.data || []).map((/** @type {any} */ m) => String(m.id));
    assert.ok(ids.includes("m-1"), JSON.stringify(listed).slice(0, 300));
    assert.deepEqual(ids.filter((id) => id.startsWith("agent/")), []);
  });

  // (fails before: yes — the dashboard's list offered every API model again as `agent/<model>`, which the Lab sent from
  // the browser as a client and a picker could name)
  test("/api/models, the dashboard's, offers no `agent/` name either: the loop's name is Filament's own", async () => {
    const listed = await (await shim.api("/api/models")).json();
    const ids = (listed.models || []).map((/** @type {any} */ m) => String(m.id));
    assert.ok(ids.includes("m-1"), JSON.stringify(listed).slice(0, 300));
    assert.deepEqual(ids.filter((id) => id.startsWith("agent/")), []);
  });

  // (fails before: yes — the settings answer had no engine; the widget would have read the config. The owner's rule of
  // 10-31: an outside client's session runs no engine, whatever it names)
  test("the settings answer's engine: the mode, whether it runs — never for an outside client's session — and why not (D9)", async () => {
    const sid = "s5-answer";
    await zc(sid, [person("warm up")]);
    const chainId = chainOf(sid);
    const engine = async () => {
      const e = (await settingsOf(chainId)).engine;
      return { mode: e.mode, active: e.active, problem: e.problem };
    };
    assert.deepEqual(await engine(), { mode: "model", active: false, problem: null });
    await setFor(sid, { patch: { engine: { mode: "team", team: "builders" } } });
    assert.deepEqual(await engine(), { mode: "team", active: false, problem: null }, "a team that could lead, in a session whose turns go to the model its client names");
    await setFor(sid, { patch: { engine: { team: "nobody" } } });
    assert.match(String((await engine()).problem), /^engine\.team names `nobody`, which is no team/, "one that cannot, and why");
    // (fails before: yes — the answer said whether the loop was on, and a stored off ran nothing; the owner's of 11-09)
    assert.ok(!("agentLoop" in (await settingsOf(chainId)).engine), "the loop is always on: no word of it");
  });

  // (fails before: yes — the write's answer left the price card out, and the page's view read null after every write)
  test("the price card rides the full read and every write's answer, so Spend's split and Cache's price line survive a settings change", async () => {
    const sid = "s5-price";
    await zc(sid, [person("warm up")]);
    const full = await settingsOf(chainOf(sid));
    assert.equal(full.price?.input, 100, "the model's own card, through its route");
    const written = await setFor(sid, { patch: { context: { compaction: { thresholdPercent: 70 } } } });
    assert.deepEqual(written.price, full.price, "the write answers with the same card a read does");
  });

  // (fails before: n/a — pins a premise: the session's layer is the only one that holds the engine, so unsetting it there
  // hands the turns back to the model the client names)
  test("the engine is the session's alone: a project's layer refuses the engine knob (D2)", async () => {
    const sid = "s5-off-layers";
    await zc(sid, [person("warm up")]);
    const projectId = /** @type {any} */ (shim.app.memory.archive).getChain(chainOf(sid)).project_id;
    const refused = await shim.api(`/api/projects/${encodeURIComponent(projectId)}/settings`, { method: "POST", body: { patch: { engine: { mode: "team" } } } });
    assert.equal(refused.status, 400);
    assert.match(await refused.text(), /\\"engine\.mode\\" is a mode setting: the project layer holds repo facts only/);
  });

  // (fails before: yes — the owner's rules of 10-31: an outside client's chat is a plain proxy with memory, but its
  // `/set` was answered by Filament, writing the session's setting)
  test("/set in an outside client's chat, whatever engine its session names, goes to its model as typed (D1)", async () => {
    const sid = "s5-set";
    await zc(sid, [person("warm up")]);
    const set = (/** @type {string} */ text) => zc(sid, [person("warm up"), said("MODEL ANSWER"), person(text)]);
    const mark = up.received.length;
    assert.equal((await set("/set context.compaction.keepWhole 3")).text, "MODEL ANSWER");
    await setFor(sid, { patch: { engine: { mode: "team", team: "builders" } } });
    assert.equal((await set("/set context.compaction.keepWhole 2")).text, "MODEL ANSWER", "a team its session names leads nothing here");
    assert.deepEqual(since(mark).map((c) => JSON.stringify(c.body.messages.at(-1)).includes("/set context.compaction.keepWhole")), [true, true], "each went to the model as typed");
    assert.equal(flatten(/** @type {any} */ (shim.app.memory.archive).chainSettings(chainOf(sid)))["context.compaction.keepWhole"], undefined, "and wrote nothing");
  });
});

// ---------------------------------------------------------------------------------------------------
// The widgets, without a DOM (D5, D8, D9)
// ---------------------------------------------------------------------------------------------------

describe("Step 5: the widgets", () => {
  test("replyTextOf: a reply's words are its text blocks joined — thinking and empty blocks left out", () => {
    const blocks = [{ type: "thinking", thinking: "x" }, { type: "text", text: "Both parts" }, { type: "text", text: "" }, { type: "text", text: "are done." }];
    assert.equal(replyTextOf(blocks), "Both parts\nare done.");
    assert.equal(replyTextOf(blocks, " "), "Both parts are done.");
    assert.equal(replyTextOf(null), "");
  });
});
