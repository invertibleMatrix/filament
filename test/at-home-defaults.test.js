// @ts-check
// HarnessV3-AtHome P1 — the fresh-install defaults, proved decision by decision.
// AH-D5/D6: the loop's three rails (a round cap, the no-progress stop, the turn's clock) and the session's fallback model
// are gone. No knob and no config field holds them, and a turn that would have met any of them runs to its end — a
// turn ends when the model ends it, when it is stopped, or when a call fails.
// AH-D1 and AH-C3: memory is on in a config built from nothing; a config that saved it off keeps it off.
// AH-D8: the defaults are memory on; a chat that takes its own choices back is back on them.
// AH-D11: a config built from nothing, and a session made from it, have every at-home default at once.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, fakeUpstream, anthropicReply, TEST_ENVIRONMENT } from "./helpers/app.js";
import { createApp } from "../src/server.js";
import { chooseWriter } from "../src/app/sessions/compactor.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import * as S from "../src/services/session-settings.js";
import { normalizeConfig, loadConfig, saveConfig } from "../src/services/config/store.js";
import { defaultConfig } from "../src/config.js";
import { createLearnedPermissions } from "../src/services/memory/permissions.js";
import { mirrorLearnedRule } from "../src/app/agent/rules.js";
import { createModeSwitch as createModeSwitchTyped, ruleWords } from "../src/ui/harness/composer/mode.js";
import { viewSettingsOf } from "../src/ui/harness/view-settings.js";
import { knobRow } from "../src/ui/lib/settings/editor.js";
import { placeSettings } from "../src/ui/harness/lib/place-settings.js";

/** The module, untyped: a test names what P1 adds before it exists, and fails on its own line, not on the import. */
const SS = /** @type {any} */ (S);
/** Untyped for the same reason: the switch's rules and its injected DOM are what P1 adds. */
const createModeSwitch = /** @type {any} */ (createModeSwitchTyped);

const dir = mkdtempSync(join(tmpdir(), "filament-at-home-"));
after(() => {
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {}
  }
});

describe("AH-D5/D6: the rails and the session fallback", () => {
  // (fails before: yes — the four were knobs, and the config carried the three loop fields with their defaults)
  test("no knob and no config field: the four are not knobs, and a fresh config has none of the three loop fields", () => {
    for (const p of ["loop.maxRounds", "loop.noProgressRounds", "loop.deadlineMinutes", "model.fallback"]) assert.equal(S.KNOBS[p], undefined, p);
    const fresh = /** @type {any} */ (defaultConfig()).agentLoop;
    for (const k of ["maxRounds", "noProgressRounds", "turnDeadlineMinutes"]) assert.equal(Object.hasOwn(fresh, k), false, k);
  });
});

describe("AH-D6: a turn runs until the model ends it", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(dir, "root-"));
    mkdirSync(join(root, "notes"), { recursive: true });
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
  const text = (/** @type {any[]} */ blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
  const ask = (/** @type {string} */ content) =>
    shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, stream: false, messages: [{ role: "user", content }] }, { "x-filament-cwd": root, "x-session-id": `s-${Math.random().toString(36).slice(2, 8)}` });
  /** A turn that reads the same missing file `n` times, the same way, saying nothing, then answers. @param {number} n */
  const spiral = (n) => {
    let calls = 0;
    brain = () => (++calls <= n ? reply([toolUse(`t${calls}`, "read", { path: "notes/missing.txt" })], "tool_use") : reply([{ type: "text", text: "done at last" }]));
    return () => calls;
  };
  /** The turn's reply and its record. @param {string} content */
  const turn = async (content) => {
    const r = await ask(content);
    assert.equal(r.status, 200, await r.clone().text());
    const j = await r.json();
    return { j, rec: await shim.record(String(r.headers.get("x-filament-request-id"))) };
  };

  // (fails before: yes — five rounds that repeated the same call with nothing said stopped the turn, budget-stopped)
  test("seven rounds of the same call, the same way, saying nothing: the turn goes on until the model answers", async () => {
    const calls = spiral(7);
    const { j, rec } = await turn("read that missing file until you give up");
    assert.equal(calls(), 8, "seven tool rounds and the answer");
    assert.equal(text(j.content), "done at last");
    assert.equal(rec.agent.status, "done");
  });

});

describe("AH-D1 and AH-C3: memory is on by default, and a saved off stays off", () => {
  // (fails before: yes — the schema's default was off, and the first start saved it so)
  test("a config built from nothing has memory on, and so does the one the first start saves", () => {
    assert.equal(/** @type {any} */ (defaultConfig()).memory.enabled, true);
    const data = join(dir, "first-start");
    const first = loadConfig(data);
    assert.equal(first.created, true);
    assert.equal(/** @type {any} */ (first.config).memory.enabled, true);
    assert.equal(Object.hasOwn(JSON.parse(readFileSync(join(data, "config.json"), "utf8")), "memory"), false, "the default is the code's, not the file's (AH-C3)");
    assert.equal(/** @type {any} */ (loadConfig(data).config).memory.enabled, true, "and the next start reads it from the code");
  });

  // (fails before: yes — a config with no word on memory took the old default, off)
  test("a hand-written config that never mentions memory has it on", () => {
    assert.equal(/** @type {any} */ (normalizeConfig({ server: { port: 20300 } })).memory.enabled, true);
  });

  // (fails before: no — a saved value was always kept; this pins AH-C3 for memory: someone who turned memory off meant
  // it, and the default never turns it on behind them)
  test("a config that saved memory off keeps it off, and a restart saves it off again", () => {
    const data = join(dir, "saved-off");
    const old = /** @type {any} */ (defaultConfig());
    old.memory.enabled = false;
    saveConfig(data, old);
    const loaded = loadConfig(data);
    assert.equal(loaded.created, false);
    assert.equal(/** @type {any} */ (loaded.config).memory.enabled, false);
    saveConfig(data, loaded.config);
    assert.equal(JSON.parse(readFileSync(join(data, "config.json"), "utf8")).memory.enabled, false);
  });

});

describe("AH-D9 d: an outside client's own compaction stays the client's", () => {
  // (fails before: yes — the owner's rules of 10-31: interception was a rule and a session knob, off by default, that a
  // method chosen for the session turned on; an outside client gets a plain proxy plus memory, and nothing answers it)
  test("no rule and no session knob answers a client's compaction request", () => {
    const cfg = /** @type {any} */ (defaultConfig());
    assert.equal(Object.hasOwn(cfg.rules.trim, "intercept"), false, "no rule");
    assert.deepEqual(Object.keys(S.KNOBS).filter((k) => k.startsWith("context.trim.")), [], "no session knob");
    assert.equal(SS.trimConfigOfDoc, undefined, "nothing reads whether Filament answers");
  });
});

describe("AH-D9 d, end to end: a client's compaction on a fresh config", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  before(async () => {
    up = await fakeUpstream();
    shim = await startApp({
      memory: true,
      summarizer: "cheap-1",
      configure: (cfg) => {
        cfg.upstreams = [{ id: "u", name: "u", type: "anthropic-compatible", baseUrl: up.url, apiKey: "x", enabled: true }];
        cfg.routes = [{ match: "*", upstream: "u", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });
  const COMPACT = "Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.";
  /** Finished turns of a client's chat, each a read and its report. @param {string} tag */
  const chat = (tag) =>
    [1, 2, 3, 4, 5].flatMap((i) => [
      { role: "user", content: `ask ${i} ${tag}: read file${i}.js` },
      { role: "assistant", content: [{ type: "text", text: `Reading file${i}.js.` }, { type: "tool_use", id: `t${i}`, name: "read", input: { path: `file${i}.js` } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: `contents of file${i}.js ` + "const x = 1;\n".repeat(200) }] },
      { role: "assistant", content: `Done with file${i}.js (${tag}).` },
    ]);
  /** A request from the client's chat. @param {string} sid @param {any[]} messages */
  const ask = (sid, messages) => shim.post("/v1/messages", { model: "big-1", max_tokens: 256, messages }, { "x-session-id": sid });
  /** The chat as the client plays it, each request ending on the person's message. @param {string} sid @param {any[]} messages */
  const play = async (sid, messages) => {
    for (let i = 0; i < messages.length; i++) if (messages[i].role === "user" && typeof messages[i].content === "string") await ask(sid, messages.slice(0, i + 1));
  };
  /** What a typed command answered. @param {string} sid @param {any[]} messages @param {string} line */
  const say = async (sid, messages, line) => (await (await ask(sid, [...messages, { role: "user", content: line }])).json()).content[0].text;
  /** The newest record's session. */
  const newestChain = async () => (await shim.records()).find((/** @type {any} */ x) => x.memory?.chain)?.memory?.chain;

  // (fails before: yes — /trim answered it with memory's cheap model, and the client's own model never saw its request)
  // (and the owner's rules of 10-31: the record said /trim stayed out "by default", and the settings said who compacts)
  test("goes to the client's own model with its own prompt, archived as its compaction", async () => {
    const messages = chat("plain");
    await play("ahd9d-plain", messages);
    const before = up.received.length;
    const r = await ask("ahd9d-plain", [...messages, { role: "user", content: COMPACT }]);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).content[0].text, "MODEL ANSWER", "the client's model answered");
    const calls = up.received.slice(before);
    assert.ok(calls.some((c) => c.body?.model === "big-1" && JSON.stringify(c.body.messages).includes("Your task is to create a detailed summary")), "its own request, its own prompt");
    assert.ok(!calls.some((c) => c.body?.model === "cheap-1"), "memory's cheap model wrote nothing");
    const rec = (await shim.records()).find((/** @type {any} */ x) => (x.priorChanges || []).some((/** @type {string} */ c) => c.startsWith("memory: this is the client's compaction request")));
    assert.ok(rec, "the record says it is the client's compaction request");
    assert.ok(!(rec.priorChanges || []).some((/** @type {string} */ c) => /\/trim|intercept/.test(c)), rec.priorChanges.join(" | "));
    const settings = viewSettingsOf(await (await shim.api(`/api/sessions/${rec.memory.chain}/settings`)).json());
    assert.equal(/** @type {any} */ (settings).intercept, undefined, "no word on who answers: the client's model does");
  });
});

describe("AH-D11: the fresh install, end to end", () => {
  // (fails before: no — written after AH-D1, D2, D5, D6, D8 and D9 built each part; it pins them together as a
  // stranger's first start meets them, and the mutation pass proves it bites)
  test("a config built from nothing, and a session made from it: memory on, its engine set to install itself; plain with results kept; a summary at 85%, asked for before a message past it is sent, by the session's model; no preset, no rails, no fallback, no digests", async () => {
    const data = join(dir, "fresh-install");
    const first = loadConfig(data);
    assert.equal(first.created, true, "the config was built from nothing");
    // The one change a test makes: any free port, never the 20300 a fresh config names (a port override of 0 is no override).
    saveConfig(data, { .../** @type {any} */ (first.config), server: { .../** @type {any} */ (first.config).server, port: 0, loopbackTrust: "legacy" } });
    // No stand-in engine (an earlier test's may still be named): a stranger's machine before its engine is installed.
    const hook = process.env.FILAMENT_MEMORY_SIDECAR;
    delete process.env.FILAMENT_MEMORY_SIDECAR;
    const app = /** @type {any} */ (createApp(/** @type {any} */ ({ dataDir: data, overrides: { environment: TEST_ENVIRONMENT } })));
    try {
      const started = await app.start();
      const cfg = app.config;
      assert.equal(cfg.memory.enabled, true);
      assert.equal(cfg.memory.engine.autoInstall, true, "the CLI's start installs memory's engine by itself");
      // (`why` comes too where this checkout holds no engine bundle: what it holds is no part of this test)
      assert.deepEqual([started.engine.state, started.engine.error], ["missing", null], "an app a test makes is never armed: nothing installs");
      for (const k of ["maxRounds", "noProgressRounds", "turnDeadlineMinutes"]) assert.equal(Object.hasOwn(cfg.agentLoop, k), false, k);
      assert.equal(Object.hasOwn(cfg.rules.trim, "intercept"), false, "a client's own compaction stays the client's: nothing answers it");

      const key = cfg.server.inboundKeys[0];
      const H = { "content-type": "application/json", "x-api-key": key, authorization: `Bearer ${key}` };
      const url = `http://127.0.0.1:${started.port}`;
      const folder = mkdtempSync(join(dir, "fresh-proj-"));
      const born = await fetch(`${url}/api/sessions`, { method: "POST", headers: H, body: JSON.stringify({ cwd: folder, model: "any-model" }) });
      assert.equal(born.status, 200, await born.clone().text());
      const id = String((await born.json()).id);
      const read = await fetch(`${url}/api/sessions/${encodeURIComponent(id)}/settings`, { headers: H });
      assert.equal(read.status, 200, await read.clone().text());
      const s = await read.json();
      const e = s.effective;

      assert.equal(e.memory.enabled, true, "memory on for the session");
      assert.notEqual(app.memory.archive.getChain(id)?.meta?.muted, true, "and the session is not muted");
      assert.equal("strategy" in e.context, false, "no choice of how earlier turns go: every turn whole until a compaction");
      assert.equal(e.context.results, "keep", "results kept");
      const c = e.context.compaction;
      assert.deepEqual(
        { at: c.thresholdPercent, mode: c.mode, method: c.method, writer: c.writer, model: c.model },
        { at: 85, mode: "ask", method: "summary", writer: null, model: null },
        "a message past the line asks first (HarnessV4_Tasks C26); a running turn makes room by itself",
      );
      assert.equal(c.resumeQuestion, true, "and so does one sent into a cold cache");
      const writer = chooseWriter({ cfg, doc: e, sessionModel: "any-model", cheapModel: "memory-cheap", cache: null, transcriptTokens: 50_000, outTokens: 2000 });
      assert.equal(writer.chosen?.model, "any-model", "the session's own model writes the summary, a cheap model at hand or not");
      assert.equal(writer.chosen?.why, "the session's model");
      for (const k of ["maxRounds", "noProgressRounds", "deadlineMinutes"]) assert.equal(Object.hasOwn(e.loop, k), false, `no rail: loop.${k}`);
      assert.equal(Object.hasOwn(e.model, "fallback"), false, "no fallback");
      assert.equal(e.context.digest, undefined, "no digests");
      assert.equal(s.intercept, undefined, "no word on interception: nothing answers a client's compaction");
    } finally {
      await app.stop();
      if (hook === undefined) delete process.env.FILAMENT_MEMORY_SIDECAR;
      else process.env.FILAMENT_MEMORY_SIDECAR = hook;
    }
  });
});

describe("the session API at home (AH-D3, AH-D5, AH-D7, AH-D8)", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let folder;
  before(async () => {
    shim = await startApp({ memory: true });
    folder = mkdtempSync(join(dir, "proj-"));
  });
  after(async () => {
    await shim.stop();
  });
  /** A plain session in the test's project folder (or another); its id. */
  const create = async (cwd = folder) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd, model: "any-model", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** @param {string} id */
  const settingsOf = async (id) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json();
  /** @param {string} id @param {any} rule */
  const forget = (id, rule) => shim.api(`/api/sessions/${encodeURIComponent(id)}/rules/forget`, { method: "POST", body: rule });

  // (fails before: yes — AH-D3: POST /sessions/draft-settings answered the Customize this start dialog's whole document)
  test("the dialog's endpoint went with the dialog: draft-settings is no route", async () => {
    const r = await shim.api("/api/sessions/draft-settings", { method: "POST", body: { cwd: folder } });
    assert.equal(r.status, 404);
  });

  // (fails before: yes — AH-D8: applying the shipped plain preset muted the session's memory; there are no presets
  // now, and taking the chat's own choices back is the way to the defaults)
  test("a chat's own choices taken back bring it back to the at-home behaviour: the history as sent with results kept, memory on", async () => {
    const id = await create();
    const a = shim.app.memory.archive;
    assert.ok(a, "memory's archive is open");
    const drift = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { context: { results: "status" }, memory: { enabled: false } } } });
    assert.equal(drift.status, 200, await drift.clone().text());
    assert.equal(a.getChain(id)?.meta?.muted, true, "the drift muted the session");
    const back = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { unset: ["context.results", "memory.enabled"] } });
    assert.equal(back.status, 200, await back.clone().text());
    const s = await settingsOf(id);
    assert.equal(s.effective.context.results, "keep");
    assert.equal(s.sources["context.results"], "default", "the session's own choice went");
    assert.equal(s.effective.memory.enabled, true);
    assert.equal(a.getChain(id)?.meta?.muted, false, "memory on: the session is muted no more");
  });

  // (fails before: yes — AH-D7: no answer listed the rules in force, and only the Memory page or a hand-edited list
  // could withdraw one)
  test("the rules in force ride the session's settings, and Forget withdraws one: a remembered permission is dismissed and kept, a written rule leaves its layer", async () => {
    const id = await create();
    const a = shim.app.memory.archive;
    assert.ok(a, "memory's archive is open");
    const { projectId } = await settingsOf(id);
    // What Always allow does: the learner's inferred item, confirmed by the owner's word (which mirrors the rule).
    const added = a.items.add({ projectId, kind: "permission", text: "bash: npm test", status: "inferred", importance: 0.8, origin: "learner" });
    assert.equal((await shim.api(`/api/memory/items/${added.id}`, { method: "POST", body: { status: "confirmed" } })).status, 200);
    assert.deepEqual((await settingsOf(id)).rulesInForce, [{ tool: "bash", pattern: "npm test", verdict: "allow", from: "learned" }], "the project's mirror and its item are one rule");
    // A rule written on the session: its list is the one in force, and the remembered permission still lets its shape through.
    const w = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { loop: { rules: [{ tool: "bash", pattern: "rm *", verdict: "deny" }] } } } });
    assert.equal(w.status, 200, await w.clone().text());
    assert.deepEqual((await settingsOf(id)).rulesInForce, [
      { tool: "bash", pattern: "rm *", verdict: "deny", from: "session" },
      { tool: "bash", pattern: "npm test", verdict: "allow", from: "learned" },
    ]);
    // Forget the remembered one: dismissed, kept with its history, its mirror off the project's list; the gate asks again.
    let f = await forget(id, { tool: "bash", pattern: "npm test" });
    assert.equal(f.status, 200, await f.clone().text());
    assert.deepEqual((await f.json()).rulesInForce, [{ tool: "bash", pattern: "rm *", verdict: "deny", from: "session" }]);
    assert.equal(a.items.get(added.id).status, "dismissed", "kept, never deleted");
    assert.deepEqual(a.projectSettings(projectId)?.loop?.rules || [], [], "the mirror went with it");
    assert.equal(createLearnedPermissions({ archive: a }).allowedBy({ projectId, tool: "bash", input: { command: "npm test" } }), null, "the gate asks again");
    // Forget the written one: the session's own list is unset, not left empty, so the layers below speak again.
    f = await forget(id, { tool: "bash", pattern: "rm *" });
    assert.equal(f.status, 200, await f.clone().text());
    const s = await settingsOf(id);
    assert.deepEqual(s.rulesInForce, []);
    assert.equal(s.sources["loop.rules"], "default");
    // A rule that is not in force is said so.
    f = await forget(id, { tool: "bash", pattern: "rm *" });
    assert.equal(f.status, 404);
    assert.match((await f.json()).error, /no rule bash\(rm \*\) is in force for this session/);
  });

  // (fails before: yes — HarnessV4_Tasks E3, decision 8: Always allow was offered only once five yeses had made a memory
  // item of it, and only such an item could be confirmed; nothing made the rule at a call's first ask)
  test("Always allow at a call's first ask: the session's route makes the rule for its shape, the gate lets it through, Forget takes it back", async () => {
    const id = await create(mkdtempSync(join(dir, "proj-")));
    const a = shim.app.memory.archive;
    assert.ok(a, "memory's archive is open");
    const { projectId } = await settingsOf(id);
    const learned = createLearnedPermissions({ archive: a });
    assert.deepEqual(learned.offeredFor({ projectId, tool: "bash", input: { command: "npm test -- --watch" } }), { itemId: null, tool: "bash", shape: "npm test" }, "offered at the first ask, with no item yet");
    const always = (/** @type {any} */ body) => shim.api(`/api/sessions/${encodeURIComponent(id)}/rules/always`, { method: "POST", body });
    const r = await always({ tool: "bash", shape: "npm test" });
    assert.equal(r.status, 200, await r.clone().text());
    const said = await r.json();
    assert.deepEqual(said.rulesInForce, [{ tool: "bash", pattern: "npm test", verdict: "allow", from: "learned" }], "the answer is the session's settings, the rule in force");
    const item = a.items.get(said.itemId);
    assert.deepEqual([item.kind, item.text, item.status, item.origin], ["permission", "bash: npm test", "confirmed", "owner"]);
    assert.ok(learned.allowedBy({ projectId, tool: "bash", input: { command: "npm test" } }), "the gate lets it through");
    assert.equal(learned.offeredFor({ projectId, tool: "bash", input: { command: "npm test" } }), null, "always allowed: nothing more to offer");
    assert.deepEqual(a.projectSettings(projectId).loop.rules, [{ tool: "bash", pattern: "npm test", verdict: "allow", learned: true }], "its mirror on the project's list");
    const again = await always({ tool: "bash", shape: "npm test" });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).itemId, said.itemId, "chosen again: the one rule, no second item");
    // An offer waiting since a yes brought it to the threshold is confirmed, not made twice — a kind of file, here.
    const waiting = a.items.add({ projectId, kind: "permission", text: "write: *.md", status: "inferred", importance: 0.8, origin: "learner" });
    assert.deepEqual(learned.offeredFor({ projectId, tool: "write", input: { path: "docs/A.md" } }), { itemId: waiting.id, tool: "write", shape: "*.md" });
    const md = await always({ tool: "write", shape: "*.md" });
    assert.equal(md.status, 200, await md.clone().text());
    assert.equal((await md.json()).itemId, waiting.id);
    assert.equal(a.items.get(waiting.id).status, "confirmed");
    // Forget takes it back, kept with its history; dismissed, it is not offered again.
    assert.equal((await forget(id, { tool: "bash", pattern: "npm test" })).status, 200);
    assert.equal(a.items.get(said.itemId).status, "dismissed");
    assert.equal(learned.offeredFor({ projectId, tool: "bash", input: { command: "npm test" } }), null, "dismissed: not offered again");
    // What is no call's shape is refused in words.
    for (const bad of [{ tool: "bash", shape: "npm test && rm -rf ." }, { tool: "read", shape: "x" }, { tool: "write", shape: "src/a.md" }, { tool: "bash", shape: "" }]) {
      const b = await always(bad);
      assert.equal(b.status, 400, JSON.stringify(bad));
      assert.match((await b.json()).error, /the always-allow a call's question offers/);
    }
  });

  // (fails before: yes — the project's writer rebuilt the whole stored layer from dotted paths, so the learner's count
  // for `write: *.md` came back as `write: *` → `md` after any project write, and the next approval counted from one)
  test("a rule written for the project leaves the project's layer, the row the switch names only, and the learner's counts stay as they were", async () => {
    const id = await create(mkdtempSync(join(dir, "proj-")));
    const a = shim.app.memory.archive;
    assert.ok(a, "memory's archive is open");
    const { projectId } = await settingsOf(id);
    const counts = { "write: *.md": { count: 3, lastAt: 1 }, "bash: npm test": { count: 2, lastAt: 2 } };
    a.setProjectSettings(projectId, { permissionApprovals: counts });
    const rules = [{ tool: "write", pattern: "*.md", verdict: "ask" }, { tool: "write", pattern: "*.md", verdict: "deny" }, { tool: "bash", pattern: "git push*", verdict: "deny" }];
    const w = await shim.api(`/api/projects/${encodeURIComponent(projectId)}/settings`, { method: "POST", body: { patch: { loop: { rules } } } });
    assert.equal(w.status, 200, await w.clone().text());
    assert.deepEqual(a.projectSettings(projectId).permissionApprovals, counts, "a project write keeps what it did not name");
    assert.deepEqual((await settingsOf(id)).rulesInForce, rules.map((r) => ({ ...r, from: "project" })));
    // The page sends the row as listed: its verdict and its layer narrow the forgetting to it.
    const f = await forget(id, { tool: "write", pattern: "*.md", verdict: "ask", from: "project" });
    assert.equal(f.status, 200, await f.clone().text());
    assert.deepEqual((await f.json()).rulesInForce, rules.slice(1).map((r) => ({ ...r, from: "project" })));
    assert.deepEqual(a.projectSettings(projectId).loop.rules, rules.slice(1));
    assert.deepEqual(a.projectSettings(projectId).permissionApprovals, counts);
    // A body that names no rule, or a layer no rule comes from, is refused in words.
    assert.equal((await forget(id, { tool: "write" })).status, 400);
    const odd = await forget(id, { tool: "write", pattern: "*.md", from: "dashboard" });
    assert.equal(odd.status, 400);
    assert.match((await odd.json()).error, /from is session, project or learned/);
  });

  // (fails before: yes — HC-82: Settings › Permissions had no way to forget a project's rule without a chat open there)
  test("a project's own Forget: a remembered permission is taken back and kept, a written rule leaves the project's list, and an emptied list is unset", async () => {
    const id = await create(mkdtempSync(join(dir, "proj-")));
    const a = shim.app.memory.archive;
    assert.ok(a, "memory's archive is open");
    const { projectId } = await settingsOf(id);
    const added = a.items.add({ projectId, kind: "permission", text: "bash: npm test", status: "inferred", importance: 0.8, origin: "learner" });
    assert.equal((await shim.api(`/api/memory/items/${added.id}`, { method: "POST", body: { status: "confirmed" } })).status, 200);
    const w = await shim.api(`/api/projects/${encodeURIComponent(projectId)}/settings`, { method: "POST", body: { patch: { loop: { rules: [...a.projectSettings(projectId).loop.rules, { tool: "bash", pattern: "git push*", verdict: "deny" }] } } } });
    assert.equal(w.status, 200, await w.clone().text());
    const forgetHere = (/** @type {any} */ rule) => shim.api(`/api/projects/${encodeURIComponent(projectId)}/rules/forget`, { method: "POST", body: rule });
    let f = await forgetHere({ tool: "bash", pattern: "npm test" });
    assert.equal(f.status, 200, await f.clone().text());
    const said = await f.json();
    assert.deepEqual(said.forgot, [{ tool: "bash", pattern: "npm test", verdict: "allow", learned: true }]);
    assert.deepEqual(said.layer.loop.rules, [{ tool: "bash", pattern: "git push*", verdict: "deny" }], "the answer is the project's settings as they stand");
    assert.equal(a.items.get(added.id).status, "dismissed", "kept, never deleted");
    assert.equal(createLearnedPermissions({ archive: a }).allowedBy({ projectId, tool: "bash", input: { command: "npm test" } }), null, "the gate asks again");
    f = await forgetHere({ tool: "bash", pattern: "git push*", verdict: "deny" });
    assert.equal(f.status, 200, await f.clone().text());
    assert.equal(a.projectSettings(projectId)?.loop?.rules, undefined, "an emptied list is unset: the rules for all chats speak there again");
    f = await forgetHere({ tool: "bash", pattern: "git push*" });
    assert.equal(f.status, 404);
    assert.match((await f.json()).error, /no rule bash\(git push\*\) is in this project's list/);
    assert.equal((await shim.api("/api/projects/no-such/rules/forget", { method: "POST", body: { tool: "bash", pattern: "x" } })).status, 404);
    assert.equal((await forgetHere({ tool: "bash" })).status, 400);
  });

  // (fails before: yes — HS-D39, HS-D40: the pages in New chats had no reader over a place; Settings › Permissions and
  // Instructions read and write through this one, so it is driven here over the real routes)
  test("a place's settings over the real routes: all chats and a project, each value's source in words, the folders that add up, a refusal, and Forget", async () => {
    const call = async (/** @type {string} */ path, /** @type {any} */ o = {}) => {
      const r = await shim.api(`/api${path}`, o);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || String(r.status));
      return j;
    };
    const id = await create(mkdtempSync(join(dir, "proj-")));
    const { projectId } = await settingsOf(id);
    const wide = mkdtempSync(join(dir, "wide-"));
    const narrow = mkdtempSync(join(dir, "narrow-"));
    const all = placeSettings("all", { api: call });
    await all.read();
    const before = all.from("loop.permissions");
    assert.ok(["Filament's default", "From the console's rules"].includes(before), before);
    assert.equal(all.holds("loop.permissions"), true);
    let w = await all.write({ patch: { "loop.permissions": "auto", "loop.addedFolders": [wide] } });
    assert.equal(w.ok, true, w.words);
    assert.match(w.words, /^Your default changed: .*Permissions: Full access/);
    assert.match(w.words, /Folders it may also read: 1 folder/);
    assert.deepEqual([all.value("loop.permissions"), all.own("loop.permissions"), all.from("loop.permissions")], ["auto", true, "Set for all chats"]);
    const proj = placeSettings(`project:${projectId}`, { api: call });
    await proj.read();
    assert.deepEqual([proj.holds("loop.permissions"), proj.holds("loop.addedFolders")], [false, true], "a project holds a repo's knobs only");
    assert.deepEqual(proj.under("loop.addedFolders"), [wide]);
    assert.equal(proj.from("loop.addedFolders"), "From all chats");
    w = await proj.write({ patch: { "loop.addedFolders": [narrow] } });
    assert.equal(w.ok, true, w.words);
    assert.match(w.words, / — its chats that have not chosen their own take it from their next request$/);
    assert.deepEqual(proj.value("loop.addedFolders"), [wide, narrow], "the project's add to all chats'");
    assert.deepEqual(proj.ownValue("loop.addedFolders"), [narrow]);
    assert.equal(proj.from("loop.addedFolders"), "Set for this project");
    w = await proj.write({ patch: { "loop.addedFolders": ["relative/notes"] } });
    assert.equal(w.ok, false);
    assert.match(w.words, /must be a whole path \(relative\/notes is relative\)/);
    assert.deepEqual(proj.ownValue("loop.addedFolders"), [narrow], "a refusal writes nothing, and the place is read again");
    const rm = { tool: "bash", pattern: "rm *", verdict: "deny" };
    const push = { tool: "bash", pattern: "git push*", verdict: "deny" };
    assert.equal((await proj.write({ patch: { "loop.rules": [rm] } })).ok, true);
    assert.deepEqual(await proj.forgetRule(rm), { ok: true, words: `Forgotten in ${proj.name()}: the next such call asks` });
    assert.notEqual(proj.from("loop.rules"), "Set for this project", "an emptied list is unset");
    assert.equal((await all.write({ patch: { "loop.rules": [rm, push] } })).ok, true);
    assert.equal((await all.forgetRule(rm)).ok, true);
    assert.deepEqual(all.value("loop.rules"), [push]);
    assert.equal((await all.forgetRule(push)).ok, true);
    assert.equal(all.from("loop.rules"), "Filament's default", "the last one forgotten takes yours away");
    assert.equal((await all.write({ unset: ["loop.permissions", "loop.addedFolders"] })).ok, true);
    assert.equal(all.from("loop.permissions"), before, "Reset hands the knob back to what was under yours");
  });

  // (fails before: no — added once Forget was built, to reach its other branches: the item with no mirror, the mirror
  // with no item, the session's own learned line, and memory not started)
  test("Forget reaches every place a remembered permission stands — an item with no mirror, a mirror with no item, a learned line on the session's own list — and waits for memory only when an item must be dismissed", async () => {
    const id = await create(mkdtempSync(join(dir, "proj-")));
    const a = shim.app.memory.archive;
    assert.ok(a, "memory's archive is open");
    const m = /** @type {any} */ (shim.app.memory);
    const { projectId } = await settingsOf(id);
    const learned = (/** @type {string} */ tool, /** @type {string} */ pattern) => ({ tool, pattern, verdict: "allow", from: "learned" });
    // A file with no extension has no glob, so no mirror: the item alone lets it through, and the list says so.
    const plain = a.items.add({ projectId, kind: "permission", text: "edit: (no extension)", status: "inferred", importance: 0.8, origin: "learner" });
    assert.equal((await shim.api(`/api/memory/items/${plain.id}`, { method: "POST", body: { status: "confirmed" } })).status, 200);
    assert.deepEqual((await settingsOf(id)).rulesInForce, [learned("edit", "(no extension)")]);
    // A mirror whose item is gone (a path that withdrew it and left the mirror): in force, so listed where the gate reads it.
    a.setProjectSettings(projectId, { loop: { rules: [{ tool: "write", pattern: "*.md", verdict: "allow", learned: true }] } });
    assert.deepEqual((await settingsOf(id)).rulesInForce, [learned("write", "*.md"), learned("edit", "(no extension)")]);
    // Memory not started: an item cannot be dismissed, so nothing moves — said in words.
    m.isOpen = () => false;
    try {
      const wait = await forget(id, { tool: "edit", pattern: "(no extension)" });
      assert.equal(wait.status, 503);
      assert.match((await wait.json()).error, /memory has not started/);
      assert.equal(a.items.get(plain.id).status, "confirmed");
      // A mirror with no item needs no memory: it leaves the project's layer, and the layers below speak again.
      const stale = await forget(id, { tool: "write", pattern: "*.md" });
      assert.equal(stale.status, 200, await stale.clone().text());
      assert.equal((await stale.json()).sources["loop.rules"], "default");
      assert.equal(a.projectSettings(projectId).loop, undefined);
    } finally {
      delete m.isOpen;
    }
    const f = await forget(id, { tool: "edit", pattern: "(no extension)" });
    assert.equal(f.status, 200, await f.clone().text());
    assert.deepEqual((await f.json()).rulesInForce, []);
    assert.equal(a.items.get(plain.id).status, "dismissed");
    // A learned line written on the session's own list (the old rule editor read `· learned`): forgotten off that list.
    const w = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { loop: { rules: [{ tool: "bash", pattern: "npm run lint", verdict: "allow", learned: true }] } } } });
    assert.equal(w.status, 200, await w.clone().text());
    assert.deepEqual((await settingsOf(id)).rulesInForce, [learned("bash", "npm run lint")]);
    const g = await forget(id, { tool: "bash", pattern: "npm run lint", from: "learned" });
    assert.equal(g.status, 200, await g.clone().text());
    const after = await g.json();
    assert.deepEqual([after.rulesInForce, after.sources["loop.rules"]], [[], "default"]);
  });

  // (fails before: no — added for the mutants that ignored the row's layer, took the rule off every layer that writes it,
  // and let any verdict be named) the row the switch names is the one forgotten
  test("Forget takes the row it names: a written rule leaves its own layer only, a remembered one with the same words stays, and a verdict that is none is refused", async () => {
    const id = await create(mkdtempSync(join(dir, "proj-")));
    const a = shim.app.memory.archive;
    assert.ok(a, "memory's archive is open");
    const { projectId } = await settingsOf(id);
    const push = { tool: "bash", pattern: "git push*", verdict: "deny" };
    a.setProjectSettings(projectId, { loop: { rules: [push] } });
    const item = a.items.add({ projectId, kind: "permission", text: "bash: npm test", status: "inferred", importance: 0.8, origin: "learner" });
    assert.equal((await shim.api(`/api/memory/items/${item.id}`, { method: "POST", body: { status: "confirmed" } })).status, 200);
    const npm = { tool: "bash", pattern: "npm test", verdict: "allow" };
    const w = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { loop: { rules: [push, npm] } } } });
    assert.equal(w.status, 200, await w.clone().text());
    assert.deepEqual((await settingsOf(id)).rulesInForce, [{ ...push, from: "session" }, { ...npm, from: "session" }, { ...npm, from: "learned" }]);
    const bad = await forget(id, { ...npm, verdict: "maybe" });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /^verdict is allow, ask, deny, review, not "maybe"$/);
    // The session's written allow: the remembered permission with the same words stands.
    const f = await forget(id, { ...npm, from: "session" });
    assert.equal(f.status, 200, await f.clone().text());
    assert.deepEqual((await f.json()).rulesInForce, [{ ...push, from: "session" }, { ...npm, from: "learned" }]);
    assert.equal(a.items.get(item.id).status, "confirmed");
    // The session's written deny: it leaves the session's list, and the project's own copy speaks again.
    const g = await forget(id, { ...push, from: "session" });
    assert.equal(g.status, 200, await g.clone().text());
    assert.deepEqual((await g.json()).rulesInForce, [{ ...push, from: "project" }, { ...npm, from: "learned" }]);
    assert.deepEqual(a.projectSettings(projectId).loop.rules.filter((/** @type {any} */ r) => !r.learned), [push]);
  });
});

describe("AH-D7: the rules in words", () => {
  // (fails before: no — added once the words were written, to pin every hand's words, not only the four the switch shows)
  test("each hand's rule in words: commands, files by class, the web, any tool; a hand the words do not know is named as the rule names it", () => {
    const say = (/** @type {string} */ tool, /** @type {string} */ pattern, /** @type {string} */ verdict) => ruleWords({ tool, pattern, verdict });
    assert.deepEqual(
      [
        say("powershell", "git push*", "ask"),
        say("bash_background", "npm run dev", "allow"),
        say("edit", "(no extension)", "allow"),
        say("read", "*.env", "deny"),
        say("write", "*", "ask"),
        say("write", "src/*", "allow"),
        say("web_fetch", "*", "ask"),
        say("web_fetch", "https://example.com/*", "deny"),
        say("web_search", "*", "allow"),
        say("web_search", "filament", "ask"),
        say("*", "*", "deny"),
        say("*", "*.env", "ask"),
        say("grep", "TODO", "deny"),
      ],
      [
        "Asks before running `git push*`",
        "Runs `npm run dev` without asking",
        "Edits files with no extension without asking",
        "Never reads *.env files",
        "Asks before writing any file",
        "Writes src/* without asking",
        "Asks before fetching any web page",
        "Never fetches https://example.com/*",
        "Searches the web for anything without asking",
        "Asks before searching the web for filament",
        "Never runs any tool",
        "Asks before running *(*.env)",
        "Never runs grep(TODO)",
      ],
    );
  });
});

describe("AH-D7: what Always allow remembers", () => {
  // (fails before: yes — withdrawing the last mirror left `loop.rules: []` on the project's layer: a list nobody wrote,
  // read as set for the project, over the default)
  test("withdrawing the last learned mirror leaves no list behind on the project's layer; a written rule beside it stays", () => {
    const mirror = { tool: "bash", pattern: "npm test", verdict: "allow", learned: true };
    /** @type {Map<string, any>} */
    const layers = new Map([
      ["alone", { loop: { rules: [mirror] }, privacy: { bashDeny: ["rm *"] } }],
      ["beside", { loop: { rules: [{ tool: "bash", pattern: "rm *", verdict: "deny" }, mirror] } }],
    ]);
    // As the archive's writer merges: top-level keys replaced, and one set to undefined is gone from the stored JSON.
    const archive = {
      projectSettings: (/** @type {string} */ p) => layers.get(p),
      setProjectSettings: (/** @type {string} */ p, /** @type {any} */ patch) => layers.set(p, JSON.parse(JSON.stringify({ ...layers.get(p), ...patch }))),
    };
    const withdrawn = (/** @type {string} */ project) => ({ kind: "permission", text: "bash: npm test", status: "dismissed", project });
    assert.equal(mirrorLearnedRule(archive, withdrawn("alone")), null);
    assert.deepEqual(layers.get("alone"), { privacy: { bashDeny: ["rm *"] } });
    assert.equal(mirrorLearnedRule(archive, withdrawn("beside")), null);
    assert.deepEqual(layers.get("beside"), { loop: { rules: [{ tool: "bash", pattern: "rm *", verdict: "deny" }] } });
  });
});

describe("the harness at home (AH-D4, AH-D7)", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

  // (fails before: yes — AH-D4: the Session inspector had a Model tab repeating the composer's model controls;
  // proposal_ux R1: the inspector's tabs became Overview's setup sheets, and none holds the model either)
  test("no setup sheet holds the model: the composer owns the model", async () => {
    const { SETUP_SHEETS, OLD_TABS } = await import("../src/ui/harness/setup-sheet.js");
    assert.deepEqual(Object.values(SETUP_SHEETS).flatMap((s) => s.sections).filter((id) => id === "model"), []);
    assert.deepEqual(Object.keys(OLD_TABS), ["map", "behavior", "memory", "teamwork", "rules", "fork", "history"], "every old tab's address still lands somewhere");
  });

  // (fails before: yes — AH-D7: the switch offered the four modes and Use the default; the rules lived in a textarea)
  test("the permission switch lists the rules in force in words, each with its own Forget", () => {
    /** @type {any[][]} */
    const menus = [];
    /** @type {any[]} */
    const forgot = [];
    const sw = createModeSwitch({ onForget: (r) => forgot.push(r) }, { h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn, menu: /** @type {any} */ ((/** @type {any[]} */ items) => { menus.push(items); return { el: fakeH("div"), close() {} }; }) });
    const rules = [
      { tool: "bash", pattern: "npm test", verdict: "allow", from: "learned" },
      { tool: "bash", pattern: "rm *", verdict: "deny", from: "session" },
      { tool: "write", pattern: "*.md", verdict: "ask", from: "project" },
      { tool: "mcp__notes__write_note", pattern: "*", verdict: "allow", from: "project" },
    ];
    sw.setRules(rules);
    /** @type {any} */ (sw.el).dispatch("click");
    const items = menus.at(-1) || [];
    const at = items.findIndex((i) => i.type === "label" && i.label === "Remembered rules");
    assert.ok(at > 0, JSON.stringify(items.map((i) => i.label)));
    const rows = items.slice(at + 1).map((i) => i.node);
    assert.deepEqual(rows.map((n) => textOf(n)), [
      "Runs |npm test| without asking|From Always allow in this project|Forget",
      "Never runs |rm *|Set for this session|Forget",
      "Asks before writing *.md files|Set for this project|Forget",
      "Runs mcp__notes__write_note(*) without asking|Set for this project|Forget",
    ]);
    // (fails before: yes — HarnessV3-Launch L5, LD-D20: tour8's menu showed "Runs `npm test` without asking", its
    // backticks drawn) a command is set in mono, and no backtick reaches the screen
    /** @param {any} n @param {any[]} [out] @returns {any[]} */
    const codes = (n, out = []) => {
      for (const k of n?.kids || []) if (k && typeof k === "object") { if (k.tag === "code") out.push(k); codes(k, out); }
      return out;
    };
    assert.deepEqual(rows.map((n) => codes(n).map((c) => [c.attrs.class, textOf(c)])), [[["mode-rule-code", "npm test"]], [["mode-rule-code", "rm *"]], [], []]);
    assert.equal(rows.some((n) => textOf(n).includes("`")), false, "the backticks are markup, not words");
    buttonsOf(rows[1]).find((b) => textOf(b) === "Forget").dispatch("click");
    assert.deepEqual(forgot, [rules[1]]);
    sw.setRules([]);
    /** @type {any} */ (sw.el).dispatch("click");
    assert.equal((menus.at(-1) || []).some((i) => i.type === "label" && i.label === "Remembered rules"), false, "no rules, no section");
  });

  // (fails before: yes — AH-D7: the row drew a textarea of hand-written lines with an apply button, through the page's
  // own `h` alone)
  test("the settings editor shows the rules as the server describes them, read-only: nothing to type, the reset kept", () => {
    /** @type {any[]} */
    const changes = [];
    const k = /** @type {any} */ ({ ...S.KNOBS["loop.rules"], live: true });
    const rules = [{ tool: "bash", pattern: "rm *", verdict: "deny" }, { tool: "write", pattern: "*.md", verdict: "allow", learned: true }];
    const view = (/** @type {any[]} */ list, /** @type {string} */ from) => ({ mode: /** @type {const} */ ("session"), flat: { "loop.rules": list }, sources: { "loop.rules": from }, own: "session", filamentRuns: true });
    const row = knobRow("loop.rules", k, {}, { change: (c) => changes.push(c) }, view(rules, "session"), /** @type {any} */ (fakeH));
    /** @type {string[]} */
    const tags = [];
    const walk = (/** @type {any} */ n) => { if (!n || typeof n !== "object") return; tags.push(n.tag); for (const c of n.kids || []) walk(c); };
    walk(row);
    assert.equal(tags.includes("textarea"), false, "nothing to type a rule into");
    assert.match(textOf(row), /\|bash\(rm \*\) deny\|write\(\*\.md\) allow · learned\|Listed in words on the harness's permission switch, each with Forget\|/);
    assert.deepEqual(buttonsOf(row).map((b) => textOf(b)), ["↺"], "the reset is the one button: a layer's own list can still be dropped whole");
    buttonsOf(row)[0].dispatch("click");
    assert.deepEqual(changes, [{ unset: ["loop.rules"] }]);
    assert.match(textOf(knobRow("loop.rules", k, {}, { change() {} }, view([], "default"), /** @type {any} */ (fakeH))), /\|none\|Listed in words/);
  });

  // (fails before: yes — AH-D7: the view's whitelist had no place for the rules in force)
  test("the session view keeps the rules in force", () => {
    const rules = [{ tool: "bash", pattern: "npm test", verdict: "allow", from: "learned" }];
    assert.deepEqual(viewSettingsOf({ rulesInForce: rules }).rulesInForce, rules);
    assert.deepEqual(viewSettingsOf({}).rulesInForce, []);
  });
});
