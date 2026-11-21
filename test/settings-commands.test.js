// HarnessV3 Step 2, Phase 2B: /set, /unset and /settings — the words, the writes, and the commands through
// the real pipeline: Filament's in a harness chat, an outside client's going to its model as typed — over a real
// Filament with fake upstreams.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";
import { MemoryService } from "../src/memory-service.js";
import { flatten } from "../src/services/session-settings.js";
import { parseSettingsCommand } from "../src/app/commands/parse.js";
import { settingsSetReply, settingsListReply } from "../src/app/commands/settings.js";
import { parseKnobText, formatKnobText, knobByName } from "../src/services/session-settings.js";
import { startApp, fakeUpstream } from "./helpers/app.js";

describe("Phase 2B: the value grammar and name matching (D10/D9)", () => {
  test("parseKnobText for every type and edge case; formatKnobText round-trips", () => {
    for (const [path, text, value] of [
      ["loop.treeSnapshots", "off", false],
      ["memory.enabled", "YES", true],
      ["context.view.stubChars", "200", 200],
      ["loop.resultCapChars", "60k", 60000],
      ["loop.resultCapChars", "60_000", 60000],
      ["memory.minScore", "0.35", 0.35],
      ["loop.permissions", "READ-ONLY", "read-only"],
      ["display.title", '"a name with spaces"', "a name with spaces"],
      ["context.compaction.model", "none", null],
      ["instructions.files", '["AGENTS.md","docs/RULES.md"]', ["AGENTS.md", "docs/RULES.md"]],
      ["loop.tools", "{}", {}],
    ]) {
      const r = parseKnobText(path, text);
      assert.deepEqual("value" in r ? r.value : r, value, `${path} <- ${text}`);
      if (value !== null && typeof value !== "object")
        assert.deepEqual(parseKnobText(path, formatKnobText(path, value)).value, value, `${path} round-trips`);
    }
    const bad = parseKnobText("context.view.stubChars", "abc");
    assert.match(bad.error, /^context\.view\.stubChars takes a whole number from 60 to 600 \(you typed "abc"\)\. For example: \/set context\.view\.stubChars 160\.$/);
    assert.match(parseKnobText("loop.permissions", "sideways").error, /takes one of read-only, edit, ask, auto/);
    assert.match(parseKnobText("instructions.files", "AGENTS.md").error, /takes a JSON list/);
    assert.match(parseKnobText("context.results", "none").error, /cannot be null/);
  });

  test("knobByName: the exact name, a unique ending, an ambiguous ending, an unknown name", () => {
    assert.deepEqual(knobByName("context.view.stubChars"), { path: "context.view.stubChars" });
    assert.deepEqual(knobByName("stubChars"), { path: "context.view.stubChars" });
    assert.deepEqual(knobByName("STUBCHARS"), { path: "context.view.stubChars" }, "matching is case-insensitive both ways");
    assert.deepEqual(knobByName("Compaction.Model"), { path: "context.compaction.model" });
    assert.deepEqual(knobByName("model"), { path: "context.compaction.model" });
    assert.deepEqual(knobByName("mode"), { candidates: ["context.compaction.mode", "engine.mode"] });
    const near = knobByName("stubcharss");
    assert.ok(Array.isArray(near.suggestions) && near.suggestions.includes("context.view.stubChars"));
    assert.deepEqual(knobByName(""), { candidates: [] });
  });

  test("the parsers: /set takes the rest of the line; the verbs are fixed words", () => {
    assert.deepEqual(parseSettingsCommand("/set stubChars 200"), { verb: "set", name: "stubChars", valueText: "200", arg: "stubChars 200" });
    assert.deepEqual(parseSettingsCommand("/set display.title two words here"), { verb: "set", name: "display.title", valueText: "two words here", arg: "display.title two words here" });
    assert.deepEqual(parseSettingsCommand("/unset stubChars"), { verb: "unset", name: "stubChars", valueText: "", arg: "stubChars" });
    assert.deepEqual(parseSettingsCommand("/settings context.trim"), { verb: "settings", name: "", valueText: "", arg: "context.trim" });
    assert.equal(parseSettingsCommand("/settingsing"), null);
    assert.equal(parseSettingsCommand("set without slash"), null);
  });
});

// ---- the words and the writes, over a real memory service ----
describe("Phase 2B: the command replies", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-2b-"));
  let svc;
  const sitOf = (key) => ({ key, headers: {}, quiet: false, project: { id: "none", cwd: "" }, client: "opencode", model: "gpt-x", trace: null, composed: false });
  /** The session a chat's commands act on, made by the creator as a chat's first command makes it. @param {string} key */
  const chainOf = (key) => svc.chainFor(sitOf(key)).id;
  before(() => {
    svc = new MemoryService({
      getConfig: () => ({ experimental: { teams: true }, memory: { enabled: true, folder: join(dir, "mem"), privacy: { encryptArchive: false }, autopilot: { turnTokens: 300 } } }),
      dataDir: dir,
      log: () => {},
    });
    svc.start();
  });
  // Windows holds the SQLite file open briefly after shutdown; the cleanup retries so a green run stays green.
  after(async () => {
    await svc.shutdown();
    for (let i = 0; i < 10; i++) {
      try { rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 150)); }
    }
  });

  test("/set writes the session's layer through the one writer, and its reply names the old value and its source", () => {
    const chain = chainOf("h:cmd-1");
    const r = settingsSetReply(svc, chain, { verb: "set", name: "turnTokens", valueText: "400", raw: "" });
    assert.match(r.text, /^`memory\.turnTokens` is 400 for this session \(it was 300, from your global settings\)\. The next request uses it\.$/);
    assert.equal(flatten(svc.archive.chainSettings(r.chainId))["memory.turnTokens"], 400);
    const again = settingsSetReply(svc, chain, { verb: "set", name: "turnTokens", valueText: "500", raw: "" });
    assert.match(again.text, /it was 400, from this session/);
  });

  // (fails before: yes — /set on an engine knob said the value was set and no more, while the turns went on to the model)
  test("/set on an engine knob says when the engine the session now names cannot run, and why; nothing when it can, or from any other knob", () => {
    const teams = { find: (/** @type {unknown} */ t) => (t === "architect" ? { key: "architect", name: "Architect" } : null) };
    const named = { model: "m-1", agent: { model: "m-1" } };
    const harness = chainOf("h:cmd-engine");
    const set = (/** @type {string} */ text) => {
      const [name, ...value] = text.split(" ");
      return settingsSetReply(svc, harness, { verb: "set", name, valueText: value.join(" "), raw: text }, { teams, named }).text;
    };
    // (fails before: yes — the words were the loop's off switch's, which the loop no longer has, the owner's of 11-09:
    // a team no team store holds stands for an engine that cannot run)
    const cannot = "This session's engine cannot run yet: engine.team names `nobody`, which is no team (/team lists them) — until it can, its turns go to the session's model.";
    assert.doesNotMatch(set("engine.team nobody"), /cannot run yet/, "no team mode yet");
    const mode = set("engine.mode team");
    assert.match(mode, /^`engine\.mode` is /);
    assert.ok(mode.includes(cannot), mode);
    assert.doesNotMatch(set("context.compaction.keepWhole 2"), /cannot run yet/, "another knob's write says nothing of the engine");
    assert.doesNotMatch(set("engine.mode model"), /cannot run yet/);
    set("engine.team architect");
    assert.doesNotMatch(set("engine.mode team"), /cannot run yet/, "with a team that is one, it can");
    // A lead launches its workers with the agent tool: switching it off says the team cannot lead.
    const off = set('loop.tools {"agent": false}');
    assert.ok(off.includes("This session's engine cannot run yet: engine.mode is team but this session switched the agent tool off (loop.tools.agent) — a team's lead launches its workers with it — until it can, its turns go to the session's model."), off);
  });

  test("/set: its usage, a value the session holds already, a bad value, an unknown or ambiguous name", () => {
    const chain = chainOf("h:cmd-2");
    const bare = settingsSetReply(svc, chain, { verb: "set", name: "", valueText: "", raw: "" });
    assert.match(bare.text, /^Usage: \/set <setting> <value> — \/settings lists what is in force\.$/);
    assert.match(settingsSetReply(svc, chain, { verb: "unset", name: "", valueText: "", raw: "" }).text, /^Usage: \/unset <setting> — it returns the setting to the layers below/);
    // Setting the same value the session's own layer already holds writes nothing, and the reply says so (the value
    // is pinned either way; /unset right after would return it to the layers below).
    settingsSetReply(svc, chain, { verb: "set", name: "turnTokens", valueText: "400", raw: "" });
    const noop = settingsSetReply(svc, chain, { verb: "set", name: "turnTokens", valueText: "400", raw: "" });
    assert.match(noop.text, /^`memory\.turnTokens` is already 400 \(this session\); nothing was written\.$/);
    const bad = settingsSetReply(svc, chain, { verb: "set", name: "turnTokens", valueText: "abc", raw: "" });
    assert.match(bad.text, /^memory\.turnTokens takes a whole number/);
    const unknown = settingsSetReply(svc, chain, { verb: "set", name: "foo", valueText: "1", raw: "" });
    assert.match(unknown.text, /There is no setting called `foo`\./);
    const ambiguous = settingsSetReply(svc, chain, { verb: "set", name: "mode", valueText: "x", raw: "" });
    assert.match(ambiguous.text, /matches more than one setting/);
  });

  test("/unset returns to the layer below; when nothing is set there is no write and the reply says what it follows", () => {
    const chain = chainOf("h:cmd-3");
    const bare = settingsSetReply(svc, chain, { verb: "unset", name: "turnTokens", valueText: "", raw: "" });
    assert.match(bare.text, /This session doesn't set `memory\.turnTokens`; it already follows your global settings: 300\./);
    const layer = svc.archive.chainSettings(bare.chainId);
    assert.equal(flatten(layer)["memory.turnTokens"], undefined, "no write happened");
    settingsSetReply(svc, chain, { verb: "set", name: "turnTokens", valueText: "400", raw: "" });
    const unset = settingsSetReply(svc, chain, { verb: "unset", name: "turnTokens", valueText: "", raw: "" });
    assert.match(unset.text, /^`memory\.turnTokens` follows your global settings again: 300\.$/);
  });

  test("/settings: the default, section and exact-name forms", () => {
    const chain = chainOf("h:cmd-4");
    settingsSetReply(svc, chain, { verb: "set", name: "turnTokens", valueText: "400", raw: "" });
    settingsSetReply(svc, chain, { verb: "set", name: "keepWhole", valueText: "9", raw: "" });
    const def = settingsListReply(svc, chain, { arg: "" });
    assert.match(def.text, /\*\*\/settings — this session \(\w+\)\*\*/);
    assert.match(def.text, /`memory\.turnTokens` = 400 · this session/);
    assert.match(def.text, /^`context\.compaction\.keepWhole` = 9 · this session$/m);
    assert.ok(!def.text.includes("`memory.briefing`"), "default form leaves the built-in defaults out");
    const section = settingsListReply(svc, chain, { arg: "memory." });
    assert.match(section.text, /`memory\.turnTokens` = 400 · this session/);
    assert.ok(!section.text.includes("context.compaction.keepWhole"));
    const one = settingsListReply(svc, chain, { arg: "turnTokens" });
    assert.match(one.text, /`memory\.turnTokens` — Base token budget of the per-turn block/);
    assert.match(one.text, /- form: a whole number of at least 0/);
    assert.match(one.text, /- in force: 400 · from this session/);
    assert.match(one.text, /- layers: session 400 · project — · global 300 · default 300/);
    assert.match(one.text, /- reach: every client obeys it, a direct-to-model chat included/);
    assert.match(one.text, /- change it: `\/set memory\.turnTokens <value>`/);
    const all = settingsListReply(svc, chain, { arg: "all" });
    assert.match(all.text, /`memory\.briefing` = on · the built-in default/);
    const usage = settingsListReply(svc, chain, { arg: "help" });
    assert.match(usage.text, /\*\*\/settings\*\* — what is in force and where each value came from\./);
    // The chat commands say setting, not knob (HarnessV3-Launch L5, LD-D10's last exception).
    assert.match(usage.text, /- `\/settings <exact name>` — one setting explained/);
    assert.ok(!usage.text.includes("**context**"), "help is a usage reply, not the full listing");
    const fresh = settingsListReply(svc, chainOf("h:cmd-5"), { arg: "" });
    assert.match(fresh.text, /memory\.turnTokens. = 300 · your global settings/, "the global layer's knobs show");
    assert.ok(!fresh.text.includes("memory.briefing"), "a knob at its built-in default stays out of the default form");
  });
});

// ---- through the real pipeline ----
describe("Phase 2B: the commands through the real pipeline", () => {
  let up, app, port, dataDir, bodies = [];
  const SYS = (cwd) => ({ role: "system", content: `You help.\nWorking directory: ${cwd}` });
  before(async () => {
    up = http.createServer((req, res) => {
      let buf = "";
      req.on("data", (d) => (buf += d));
      req.on("end", () => {
        const body = JSON.parse(buf || "{}");
        bodies.push(body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "c", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }));
      });
    });
    await new Promise((r) => up.listen(0, "127.0.0.1", r));
    const upPort = up.address().port;
    dataDir = mkdtempSync(join(tmpdir(), "filament-2b-app-"));
    const cfg = defaultConfig();
    cfg.server.port = 0;
    cfg.server.inboundKeys = ["k"];
    cfg.observability.logFile = "";
    cfg.upstreams = [{ id: "oai", name: "oai", type: "openai-compatible", baseUrl: `http://127.0.0.1:${upPort}`, apiKey: "s" }];
    cfg.routes = [{ match: "gpt-*", upstream: "oai", upstreamModel: "{model}" }];
    cfg.memory = { enabled: true, folder: join(dataDir, "mem"), privacy: { encryptArchive: false }, commands: { enabled: true, prefix: "@mem" } };
    writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
    app = createApp({ dataDir });
    port = (await app.start()).port;
  });
  after(async () => {
    await app.stop();
    up.close();
    for (let i = 0; i < 10; i++) {
      try { rmSync(dataDir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 150)); }
    }
  });
  const chat = (messages, extra = {}) =>
    fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer k", ...extra },
      body: JSON.stringify({ model: "gpt-x", messages }),
    }).then((r) => r.json());

  // (fails before: yes, on 1c8b72028 — the owner's rules of 10-31: an outside client's chat answered /set, /unset,
  // /settings, /preset, /team, /subagent and /btw as Filament's, /set and /preset writing the session's settings, and
  // `@mem set …` and its like were their aliases)
  test("an outside client's chat is a plain proxy with memory: /set, /unset, /settings, /preset, /team, /subagent and /btw go to its model as typed and write nothing; @mem set is no command", async () => {
    const cwd = "C:\\set2b";
    const sid = "conv-set";
    await chat([SYS(cwd), { role: "user", content: "one" }], { "x-session-id": sid });
    const chainId = app.memory.archive.chainIdForKey((await import("../src/services/memory/brain.js")).chainKeyForConversationId(sid));
    for (const words of ["/set stubChars 200", "/unset stubChars", "/settings", "/preset balanced", "/team", "/subagent list", "/btw why so slow?"]) {
      const asked = bodies.length;
      const reply = await chat([SYS(cwd), { role: "user", content: "one" }, { role: "assistant", content: "ok" }, { role: "user", content: words }], { "x-session-id": sid });
      assert.equal(reply.choices[0].message.content, "ok", `${words}: the model's answer`);
      assert.equal(bodies.length, asked + 1, `${words}: the model was called`);
      assert.ok(JSON.stringify(bodies.at(-1).messages.at(-1)).includes(words), `${words}: as typed`);
    }
    const flat = flatten(app.memory.archive.chainSettings(chainId));
    assert.equal(flat["context.view.stubChars"], undefined, "nothing set");
    const asked = bodies.length;
    const alias = await chat([SYS(cwd), { role: "user", content: "@mem set stubChars 420" }], { "x-session-id": sid });
    assert.match(alias.choices[0].message.content, /\*\*Memory commands\*\*/, "memory's prefix answers with its help");
    assert.equal(bodies.length, asked, "Filament's answer: the model is not called");
    assert.equal(flatten(app.memory.archive.chainSettings(chainId))["context.view.stubChars"], undefined, "and writes nothing");
  });
});

/**
 * A harness session on a throwaway Filament, its turns the loop's (always on, the owner's of 11-09), and a fake model.
 * `leftOut`: its model excluded in Memory settings, so memory situates none of its turns; `leaveOut()` excludes it from
 * then on.
 * @param {{ leftOut?: boolean }} o
 */
async function harnessChat({ leftOut = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "filament-2b-harness-"));
  const up = await fakeUpstream();
  const shim = await startApp({
    memory: leftOut,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      if (leftOut) cfg.memory.capture = { ...cfg.memory.capture, excludeModels: ["brain-*"] };
    },
  });
  const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model" } });
  assert.equal(made.status, 200, await made.clone().text());
  const id = String((await made.json()).id);
  const turn = async (/** @type {string} */ content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, `${content}: ${await r.clone().text()}`);
    return ((await r.json()).content || []).map((/** @type {any} */ b) => b.text || "").join("");
  };
  const leaveOut = async () => {
    const st = await (await shim.api("/api/state")).json();
    const memory = { ...st.config.memory, capture: { ...st.config.memory.capture, excludeModels: ["brain-*"] } };
    const r = await shim.api("/api/config", { method: "PUT", body: { ...st.config, memory } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  const close = async () => {
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true });
  };
  return { up, shim, id, turn, leaveOut, close };
}

describe("Phase 2B: the commands in a harness chat, through the real pipeline", () => {
  // (fails before: no — a guard: a harness chat's /status and /set are Filament's, the status in its lines)
  test("/status says where the name goes; /set writes the session's own layer", async () => {
    const { up, shim, id, turn, close } = await harnessChat();
    try {
      up.reset();
      const status = await turn("/status");
      assert.match(status, /^\*\*Filament status for this chat\*\*/);
      // The loop's turn: its route is the loop's own, to the model's upstream (the loop is always on, the owner's of 11-09).
      assert.match(status, /- model name: `brain-model` → route `agent:brain-model` → \*\*m\*\* \(anthropic\) receives `brain-model`/);
      assert.match(status, /- what Filament changes on this request: /);
      assert.match(status, /- upstream health: ok · failover off · no backups on this route/, "off until switched on (the owner's of 11-09)");
      assert.match(await turn("/set context.compaction.keepWhole 7"), /context\.compaction\.keepWhole/);
      assert.equal(flatten(shim.app.memory.archive.chainSettings(id))["context.compaction.keepWhole"], 7, "/set wrote the session's own layer");
      assert.equal(up.received.length, 0, "no command reached the model");
    } finally {
      await close();
    }
  });

  // (fails before: no — a guard: without the stage's `pre.api` clause, a harness turn memory leaves out, with no loop
  // under it, was taken for an outside client's, and its commands went to the model)
  test("in a chat memory leaves out, /status and /help are Filament's all the same: the stage knows a harness turn by its API", async () => {
    const { up, turn, close } = await harnessChat({ leftOut: true });
    try {
      up.reset();
      assert.match(await turn("/status"), /^\*\*Filament status for this chat\*\*/);
      assert.match(await turn("/help"), /^\*\*Commands you can type in this chat\*\*/);
      assert.equal(up.received.length, 0, "no command reached the model");
    } finally {
      await close();
    }
  });

  // (fails before: yes — the commands asked memory's situation for the chat's session, and memory had made none: /set,
  // /settings, /preset, /team and /graph answered "No archive" (there is no /preset since the owner's of 11-07), /subagent that Filament could not identify the chat,
  // /autofit that its session was none of Filament's, and nothing was written, though the turn's header named the session)
  test("in a chat memory leaves out, the commands reach the chat's session: /set writes its own layer, and /settings, /subagent, /team, /graph and /autofit answer for it", async () => {
    const { up, shim, id, turn, close } = await harnessChat({ leftOut: true });
    try {
      up.reset();
      assert.match(await turn("/set stubChars 200"), /^`context\.view\.stubChars` is 200 for this session \(it was 160, from the built-in default\)\./);
      assert.equal(flatten(shim.app.memory.archive.chainSettings(id))["context.view.stubChars"], 200, "/set wrote the session's own layer");
      assert.match(await turn("/settings stubChars"), /^- in force: 200 · from this session$/m);
      assert.match(await turn("/subagent list"), /^No sub-agents in this session yet\./);
      assert.match(await turn("/team"), /^\*\*Teams\*\* — this chat's turns go to your agent\./);
      assert.match(await turn("/graph"), /^\*\*Task graph\*\* — the agent has the tasks tool/);
      assert.match(await turn("/autofit status"), /^\/autofit already inside the margin: [\d,]+ \(its prompt and tools ≈[\d,]+, the history ≈\d+\) of a 200,000-token window/, "the session's own numbers, the loop's part said apart");
      assert.equal(up.received.length, 0, "no command reached the model");
      // The chat keeps its own turns (the decision of 11-02): each command answered on its session is a command turn of
      // its transcript, and none of them reaches a model's history.
      const turns = shim.app.memory.archive.getTurns(id);
      assert.equal(turns.length, 6, "each command's turn");
      assert.ok(turns.every((/** @type {any} */ t) => t.meta?.command === true), "each a command's");
    } finally {
      await close();
    }
  });

  // (fails before: yes — /goal asked memory's situation for the chat's session, found none, and said the chat had no
  // session yet and to send a normal message first, which changed nothing)
  test("in a chat memory leaves out, /goal says a goal rides on memory's work, and sets none", async () => {
    const { up, shim, id, turn, close } = await harnessChat({ leftOut: true });
    try {
      up.reset();
      assert.equal(await turn("/goal ship the parser"), 'Memory leaves this chat out (model "brain-model" is excluded in Memory settings), and a goal rides on memory\'s work: no goal is set here.');
      assert.ok(!shim.app.memory.goalFor(id), "no goal");
      assert.equal(up.received.length, 0, "nothing reached the model");
    } finally {
      await close();
    }
  });

  // (fails before: yes — the review of b28b47713: a client's chat memory leaves out was told it had no session yet, to
  // send a normal message first; and a goal the session got before memory left the chat out could be neither read nor
  // closed there)
  test("in a chat memory leaves out, a client's /goal says so too, and the session's goal from before is read and closed", async () => {
    const { up, shim, id, turn, close } = await harnessChat({ leftOut: true });
    try {
      up.reset();
      const r = await shim.api("/v1/messages", { method: "POST", headers: { "x-session-id": "goal-client" }, body: { model: "brain-client", max_tokens: 50, messages: [{ role: "user", content: "/goal ship the parser" }] } });
      assert.equal(r.status, 200, await r.clone().text());
      assert.equal(((await r.json()).content || []).map((/** @type {any} */ b) => b.text || "").join(""), 'Memory leaves this chat out (model "brain-client" is excluded in Memory settings), and a goal rides on memory\'s work: no goal is set here.');
      const { newGoal } = await import("../src/services/memory/goal.js");
      shim.app.memory.setGoal(id, { ...newGoal("ship the parser", { now: Date.now() }), status: "active", slice: "the parser ships" });
      assert.match(await turn("/goal status"), /- goal: “ship the parser”\n- status: \*\*active\*\*/);
      assert.match(await turn("/goal another one"), /^Memory leaves this chat out \(model "brain-model" is excluded in Memory settings\), and a goal rides on memory's work: no goal is set here — the one its session has is read and closed here/);
      assert.match(await turn("/goal done"), /^Goal done: “the parser ships”/);
      assert.equal(shim.app.memory.goalFor(id)?.status, "done");
      assert.equal(up.received.length, 0, "nothing reached the model");
    } finally {
      await close();
    }
  });

  describe("the session's goal in a chat memory leaves out", () => {
    /** @type {Awaited<ReturnType<typeof harnessChat>>} */
    let chat;
    before(async () => {
      chat = await harnessChat({ leftOut: true });
    });
    after(async () => {
      await chat.close();
    });
    const out = 'Memory leaves this chat out (model "brain-model" is excluded in Memory settings)';
    /** A turn's words and the record it was answered on. @param {string} content */
    const said = async (content) => {
      const r = await chat.shim.api(`/api/sessions/${encodeURIComponent(chat.id)}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(r.status, 200, await r.clone().text());
      const text = ((await r.json()).content || []).map((/** @type {any} */ b) => b.text || "").join("");
      return { text, rec: await chat.shim.record(String(r.headers.get("x-filament-request-id"))) };
    };
    /** The session's goal, sized and proposed — or `status` as given. @param {"proposed" | "active"} [status] */
    const goal = async (status = "proposed") => {
      const { newGoal } = await import("../src/services/memory/goal.js");
      const now = Date.now();
      const g = { ...newGoal("ship the parser", { now }), status, slice: "the parser ships", acceptedAt: status === "active" ? now : null, estimate: { sizeClass: /** @type {const} */ ("days"), achievableSlice: "the parser ships", assumptions: [], firstStep: "read it", at: now, model: "m", requestId: null } };
      chat.shim.app.memory.setGoal(chat.id, g);
      return g;
    };

    // (fails before: yes — the review of b7fbcdb6a: there, a proposed goal's words offered `/goal accept` and `/goal
    // slice`, both refused there; an active one's said its slice rides every request of the session, though memory
    // places it on none there and books none to it; and done offered `/goal <text>`, refused there too. And the review
    // of fe31ea548: "rides no request here" was false where a model is why — a sub-agent on another model carries it)
    test("its words say it rides none of the requests memory leaves out, and offer only closing it", async () => {
      await goal("proposed");
      const p = await said("/goal status");
      assert.ok(p.text.endsWith(`\n\n${out}, so the goal cannot be accepted here. \`/goal abandon\` drops it.`), p.text);
      assert.doesNotMatch(p.text, /\/goal accept|\/goal slice/, "nothing refused here is offered");
      await goal("active");
      const a = await said("/goal");
      assert.ok(a.text.endsWith(`\n\n${out}: the slice rides none of the requests it leaves out. \`/goal done\` or \`/goal abandon\` closes it.`), a.text);
      assert.equal((await said("/goal done")).text, "Goal done: “the parser ships”, sized days. The goal stays on the session's record.");
    });

    // (fails before: yes — the review of b7fbcdb6a: a proposed goal's card there offered Accept, which is refused there)
    test("its card offers only closing it: Abandon for a proposed goal, Done and Abandon for an active one", async () => {
      await goal("proposed");
      assert.deepEqual((await said("/goal status")).rec.card?.actions, [{ label: "Abandon", command: "/goal abandon" }]);
      await goal("active");
      assert.deepEqual((await said("/goal status")).rec.card?.actions, [{ label: "Done", command: "/goal done" }, { label: "Abandon", command: "/goal abandon" }]);
    });

    // (fails before: yes — the review of b7fbcdb6a: a /goal command's record there named no session, where /team's and
    // /set's name theirs)
    test("its command's record names the session, whose transcript keeps the command's turn, and nothing is booked on it", async () => {
      const g = await goal("active");
      chat.up.reset();
      const before = chat.shim.app.memory.archive.getTurns(chat.id).length;
      assert.equal((await said("/goal status")).rec.memory?.chain, chat.id, "the record names the session");
      assert.equal((await said("/goal abandon")).rec.memory?.chain, chat.id);
      // The chat keeps its own turns (the decision of 11-02): each command a turn of its transcript.
      assert.equal(chat.shim.app.memory.archive.getTurns(chat.id).length, before + 2, "the two commands' turns");
      assert.equal(chat.shim.app.memory.archive.getChain(chat.id).meta?.spend, undefined, "nothing booked on the session");
      assert.deepEqual(chat.shim.app.memory.goalFor(chat.id)?.totals, g.totals, "nor on its goal");
      assert.equal(chat.up.received.length, 0, "nothing reached the model");
    });
  });

  // (fails before: yes — the lead of 11-01's engine fix: a /goal whose turn memory could not read (its situate failed)
  // said memory leaves the chat out, as though the chat were one it keeps out)
  test("a /goal whose turn memory could not read says so, and to send it again; the chat is memory's still", async () => {
    const { up, shim, id, turn, close } = await harnessChat();
    try {
      up.reset();
      // Memory's situate of this message alone throws, as a busy file would.
      const brain = shim.app.memory.brain;
      const situate = brain.situate;
      brain.situate = function () {
        brain.situate = situate;
        throw new Error("the situate broke");
      };
      assert.equal(await turn("/goal ship the parser"), "Memory could not read this chat for this message, and a goal rides on memory's work: no goal is set — send it again.");
      assert.ok(!shim.app.memory.goalFor(id), "no goal");
      assert.match(await turn("/goal ship the parser"), /ship the parser/, "sent again: memory reads the chat");
    } finally {
      await close();
    }
  });

  // (fails before: yes — the review of b7fbcdb6a: /goal blamed Memory settings wherever memory left the chat out, the
  // console Assistant's own call among them, which memory leaves out as Filament's own whatever the settings say)
  test("the console Assistant's /goal: memory leaves Filament's own call out, and no Memory setting is blamed", async () => {
    const { up, shim, close } = await harnessChat();
    try {
      up.reset();
      const r = await shim.house("/v1/messages", { model: "brain-model", max_tokens: 50, messages: [{ role: "user", content: "/goal ship the parser" }] }, { "user-agent": "filament-assistant/0.1", "x-session-id": "assistant-brain-model" });
      assert.equal(r.status, 200, await r.clone().text());
      assert.equal(((await r.json()).content || []).map((/** @type {any} */ b) => b.text || "").join(""), "Memory leaves this chat out, and a goal rides on memory's work: no goal is set here.");
      assert.equal(up.received.length, 0, "nothing reached the model");
    } finally {
      await close();
    }
  });

  // (fails before: yes — /compact asked memory's situation whether Filament composes the chat, found none, and the
  // words went to the model; /help left it out)
  test("in a chat memory leaves out, /compact is Filament's: the chat's session is compacted its own way, and /help lists it", async () => {
    const { up, shim, id, turn, leaveOut, close } = await harnessChat();
    try {
      // Turns long enough that a summary leaves the chat smaller, recorded while memory captured the chat.
      await turn(`one: ${"a long account of the parser ".repeat(60)}`);
      await turn(`two: ${"and of its tests ".repeat(60)}`);
      await leaveOut();
      up.reset();
      assert.match(await turn("/compact"), /^\/compact — /);
      assert.equal(shim.app.memory.archive.getCompactions(id).length, 1, "the session was compacted");
      assert.match(await turn("/help"), /^- `\/compact` — compact this session now/m);
      // The session's way is one summary: its model was called for it, and never with the command.
      assert.equal(up.received.length, 1, "the summary's call");
      assert.ok(!JSON.stringify(up.received[0].body).includes("/compact"), "the command never reached the model");
      // The chat keeps its own turns (the decision of 11-02): /compact and /help are command turns of it, after its two.
      assert.deepEqual(shim.app.memory.archive.getTurns(id).map((/** @type {any} */ t) => !!t.meta?.command), [false, false, true, true], "the chat's two turns and the commands' two");
    } finally {
      await close();
    }
  });
});
