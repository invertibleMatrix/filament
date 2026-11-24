import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { viaRegistry } from "../src/core/catalogues.js";
import { KNOWN_AGENTS, CURSOR_SDK, detectAgents, seededOn, agentUpstream, agentRoute, installCommand, resolveMode, readSessionOffer, modelLabels, listedModels, matchOffered, planVariant, commandLine, loginLaunch } from "../src/acp.js";
import { defaultConfig, validateConfig, normalizeConfig, loadConfig } from "../src/config.js";
import { TEMPLATES } from "../src/templates.js";
import { SessionMap, newConversation, resumedConversation } from "../src/adapters/agents/acp/sessions.js";
import { ownCommands } from "../src/adapters/agents/acp/bridge.js";
import { applySessionSettings } from "../src/adapters/agents/acp/configure.js";
import { createApp } from "../src/server.js";

test("known agents catalog: every entry is complete and produces valid upstream + route", () => {
  assert.ok(KNOWN_AGENTS.length >= 5);
  // An agent installed from ACP's registry names its modes itself once signed in (Antigravity): no aliases of Filament's.
  for (const a of KNOWN_AGENTS) { assert.ok(a.id && a.prefix && a.command && Array.isArray(a.args) && a.mode && a.install && ((a.type || "acp") !== "acp" || a.modeAliases || viaRegistry(a)), a.id); }
  // It is on no PATH either: Settings → Coding agents downloads and connects it, so detection and the seed leave it out.
  const onPath = KNOWN_AGENTS.filter((a) => !viaRegistry(a));
  const det = detectAgents(); assert.equal(det.length, onPath.length); assert.ok(det.every((a) => typeof a.installed === "boolean"));
  const cfg = defaultConfig({ withAgents: true });
  assert.equal(cfg.upstreams.length, onPath.length); assert.equal(cfg.routes.length, onPath.length);
  const v = validateConfig(normalizeConfig(cfg)); assert.ok(v.ok, v.errors.join("; "));
  for (const a of det) { const u = cfg.upstreams.find((x) => x.id === a.id); assert.equal(u.enabled, seededOn(a)); assert.equal(u.type, a.type || "acp"); const rt = cfg.routes.find((r) => r.upstream === a.id); assert.equal(rt.match, `${a.prefix}/*`); assert.notEqual(rt.enabled, false, `${a.id}: its route is on, so a name of it says the agent is off`); }
  assert.equal(defaultConfig().upstreams.length, 0, "plain defaultConfig stays empty for tests and templates");
});

// (fails before: yes — a fresh install turned on every coding agent whose program it found, Gemini CLI and Qoder too)
test("a fresh install turns on Claude Code, Codex and Cursor's CLI where they are found, and adds the others off", () => {
  assert.deepEqual(KNOWN_AGENTS.filter((a) => a.onByDefault).map((a) => a.id).sort(), ["claude-code", "codex", "cursor"]);
  for (const a of KNOWN_AGENTS) {
    assert.equal(seededOn({ ...a, installed: true }), ["claude-code", "codex", "cursor"].includes(a.id), `${a.id} found`);
    assert.equal(seededOn({ ...a, installed: false }), false, `${a.id} not found`);
  }
  const seed = KNOWN_AGENTS.map((a) => ({ ...a, installed: true })).map((a) => ({ upstream: agentUpstream(a, { enabled: seededOn(a) }), route: agentRoute(a, { enabled: true }) }));
  const cfg = defaultConfig({ withAgents: false });
  const all = normalizeConfig({ ...cfg, upstreams: seed.map((s) => s.upstream), routes: seed.map((s) => s.route) });
  assert.deepEqual(all.upstreams.filter((u) => u.enabled).map((u) => u.id).sort(), ["claude-code", "codex", "cursor"]);
  const fresh = defaultConfig({ withAgents: true });
  assert.deepEqual(
    fresh.upstreams.filter((u) => u.enabled).map((u) => u.id).sort(),
    detectAgents().filter((a) => a.installed && ["claude-code", "codex", "cursor"].includes(a.id)).map((a) => a.id).sort(),
    "the seed this machine gets",
  );
});

test("one template per agent, generated from the catalog", () => {
  for (const a of KNOWN_AGENTS.filter((x) => !viaRegistry(x))) { const t = TEMPLATES.find((x) => x.id === (a.type === "codex" ? a.id : `${a.id}-via-acp`)); assert.ok(t, a.id); assert.equal(t.patch.upstreams[0].id, a.id); assert.equal(t.patch.upstreams[0].enabled, true); assert.equal(t.patch.routes[0].match, `${a.prefix}/*`); assert.ok(t.effects.some((e) => e.includes(installCommand(a, process.platform).line))); }
});

test("resolveMode maps the common words onto each agent's own mode ids", () => {
  const qoder = ["default", "acceptEdits", "auto", "dontAsk", "yolo"]; const cursor = ["agent", "plan", "ask"];
  const q = KNOWN_AGENTS.find((a) => a.id === "qoder").modeAliases, c = KNOWN_AGENTS.find((a) => a.id === "cursor").modeAliases;
  assert.equal(resolveMode("agent", qoder, q), "yolo"); assert.equal(resolveMode("ask", qoder, q), "dontAsk"); assert.equal(resolveMode("acceptEdits", qoder, q), "acceptEdits");
  assert.equal(resolveMode("agent", cursor, c), "agent"); assert.equal(resolveMode("YOLO", cursor, c), null); assert.equal(resolveMode("plan", [], c), "plan");
});

// (fails before: yes — agy 1.5.14 names its modes default, accept-edits and plan, read live, and auto where the account
// offers it: `agent` matched none, so every turn noted it not offered and the session stayed in default)
test("Antigravity's modes, an upstream with no aliases of its own: agent is auto where offered, else accept-edits; plan is plan; ask is default", async () => {
  const { MODE_ALIASES, modeAsks } = await import("../src/adapters/agents/acp/configure.js");
  const agy = ["default", "accept-edits", "plan"];
  assert.deepEqual(["agent", "plan", "ask"].map((m) => resolveMode(m, agy, MODE_ALIASES)), ["accept-edits", "plan", "default"]);
  assert.equal(resolveMode("agent", [...agy, "auto"], MODE_ALIASES), "auto");
  assert.deepEqual([modeAsks("accept-edits"), modeAsks("default"), modeAsks("plan")], [false, true, true]);
});

test("an agent's own words for its models: a session's model option, the classic availableModels, a list's entries (HarnessV3-ACP AF2)", () => {
  // Claude Code's adapter as it answered on the owner's machine (0.76.0).
  const claude = { configOptions: [{ id: "model", name: "Model", currentValue: "opus", options: [
    { value: "default", name: "Default (recommended)", description: "Opus (1M context)" },
    { value: "opus", name: "Opus", description: "Opus 5 · Best for everyday, complex tasks" },
    { value: "haiku", name: "Haiku 4.5", description: "Haiku 4.5 · Fastest for quick answers · $1/$5 per Mtok" },
  ] }] };
  assert.deepEqual(readSessionOffer(claude).modelLabels, {
    default: { label: "Default (recommended)", note: "Opus (1M context)" },
    opus: { note: "Opus 5 · Best for everyday, complex tasks" },
    haiku: { label: "Haiku 4.5", note: "Haiku 4.5 · Fastest for quick answers · $1/$5 per Mtok" },
  }, "\"Opus\" only spells `opus`: its description says which Opus");
  const classic = { models: { currentModelId: "auto", availableModels: [{ modelId: "gemini-2.5-pro", name: "Gemini 2.5 Pro", description: "" }, { modelId: "auto", name: "Auto" }] } };
  assert.deepEqual(readSessionOffer(classic).modelLabels, { "gemini-2.5-pro": { label: "Gemini 2.5 Pro" } }, "a name that only spells its id says nothing");
  assert.deepEqual(readSessionOffer({}).modelLabels, {});
  assert.deepEqual(modelLabels([
    { id: "gpt-6-astra", displayName: "GPT-6-Astra", description: "Latest frontier agentic coding model." },
    { id: "grok-4.6", displayName: "Grok 4.6" },
    { id: "codex-internal", displayName: "Hidden", hidden: true },
    { id: "bare" }, { displayName: "No id" }, null,
  ]), { "gpt-6-astra": { note: "Latest frontier agentic coding model." }, "grok-4.6": { label: "Grok 4.6" } });
});

test("Cursor's printed list: its ids and names, colours gone, the CLI's own (current) and (default) marks left out (HarnessV3-ACP AF2)", () => {
  const text = "Available models\r\n\r\n\x1b[1mauto - Auto (default)\x1b[0m\r\ngpt-5.3-codex - Codex 5.3\r\n" +
    "claude-fable-5-1-high - Claude Fable 5.1 1M (NO ZDR)\r\ncomposer-2.5 - Composer 2.5 (current)\r\n\r\n" +
    "Tip: use --model <id> (or /model <id> in interactive mode) to switch.\r\n";
  assert.deepEqual(listedModels(text), {
    names: ["auto", "gpt-5.3-codex", "claude-fable-5-1-high", "composer-2.5"],
    labels: { "gpt-5.3-codex": { label: "Codex 5.3" }, "claude-fable-5-1-high": { label: "Claude Fable 5.1 1M (NO ZDR)" }, "composer-2.5": { label: "Composer 2.5" } },
  });
  assert.deepEqual(listedModels(""), { names: [], labels: {} });
});

// (fails before: yes — a name that carries a version took a model of another: claude-opus-5-5 took opus[1m], which the
// agent's own words call Opus 5, and gpt-5-5 took gpt-5 with its 5 left over)
test("the offered model a name means is of its version, by the model's id or the agent's own words for it (the bug report's O1)", () => {
  const offered = ["default", "opus[1m]", "sonnet", "claude-haiku-4-5"];
  const labels = modelLabels([
    { value: "default", name: "Default (recommended)", description: "Opus (1M context)" },
    { value: "opus[1m]", name: "Opus (1M context)", description: "Opus 5 with 1M context · Best for everyday, complex tasks" },
    { value: "sonnet", name: "Sonnet 5", description: "Sonnet 5 · Efficient for routine tasks" },
  ]);
  assert.equal(matchOffered("opus", offered, labels), "opus[1m]", "a name with no version: the nearest");
  assert.equal(matchOffered("claude-opus-5", offered, labels), "opus[1m]", "Opus 5, in the agent's words");
  assert.equal(matchOffered("claude-opus-5-5", offered, labels), null, "the agent's opus is Opus 5");
  assert.equal(matchOffered("claude-sonnet-5", offered, labels), "sonnet");
  assert.equal(matchOffered("haiku-4-5", offered, labels), "claude-haiku-4-5", "its version in its id");
  assert.equal(matchOffered("haiku-4", offered, labels), null, "4 is not 4.5");
  assert.equal(matchOffered("claude-opus-5", ["opus"]), null, "an alias nothing says the version of");
  // A flat name taken apart: a base of its version only; an alias's version, spelled after it, its own.
  const models = ["gpt-5", "sonnet"];
  const params = [{ id: "effort", values: ["low", "high"] }];
  assert.equal(planVariant("gpt-5-5", null, { models, params }), null, "gpt-5-5 is not gpt-5 with a 5 left over");
  assert.deepEqual(planVariant("gpt-5-high", null, { models, params }), { base: "gpt-5", set: [["effort", "high"]], unknown: [], effortParam: "effort" });
  assert.deepEqual(planVariant("sonnet-5-high", null, { models, params, labels }), { base: "sonnet", set: [["effort", "high"]], unknown: [], effortParam: "effort" });
  assert.equal(planVariant("sonnet-4-high", null, { models, params, labels }), null);
});

// (fails before: yes — `cursor/auto` sent no model, so a session Cursor opened on the model last switched to ran that
// one, as a drive of 10-30 saw: the auto chat ran on gpt-5.4-nano)
test("`auto` is the agent's own model where it offers one by that name, whatever model its session opened on", async () => {
  /**
   * The model step over a recording agent shaped as Cursor's parameterized picker answered on 10-30.
   * @param {string[]} models @param {string} current
   */
  const apply = async (models, current) => {
    /** @type {any[]} */
    const asked = [];
    /** @type {string[]} */
    const notes = [];
    const proc = {
      request: async (/** @type {string} */ method, /** @type {any} */ params) => {
        asked.push([method, params.configId, params.value]);
        return { configOptions: [{ id: "model", category: "model", currentValue: params.value, options: models.map((value) => ({ value })) }, { id: "optimize_for", category: "model_config", currentValue: "balanced", options: [{ value: "intelligence" }, { value: "balanced" }, { value: "cost" }] }] };
      },
    };
    const conv = { sessionId: "s1", availableModels: models, modelId: current, modelConfig: true, modelConfigId: "model", paramOptions: [{ id: "reasoning", name: "reasoning", category: "thought_level", current: "medium", values: ["low", "medium", "high"] }], modelLabels: {} };
    await applySessionSettings({ proc, conv, acp: {}, modelId: "auto", effort: null, mode: "", modeOverride: null, notes, structured: [] });
    return { asked, notes: notes.filter((n) => n.startsWith("acp: model")), conv };
  };
  const cursor = await apply(["auto-smart", "grok-4.6", "gpt-5.4-nano"], "gpt-5.4-nano");
  assert.deepEqual(cursor.asked, [["session/set_config_option", "model", "auto-smart"]]);
  assert.equal(cursor.conv.modelId, "auto-smart");
  assert.ok(cursor.notes.includes("acp: model auto-smart"), cursor.notes.join("\n"));
  const there = await apply(["auto-smart", "grok-4.6"], "auto-smart");
  assert.deepEqual(there.asked, [], "on it already: nothing to switch");
  const none = await apply(["opus[1m]", "sonnet"], "sonnet");
  assert.deepEqual([none.asked, none.conv.modelId, none.notes], [[], "sonnet", ["acp: model auto"]], "no model of that name: the session's as it is");
  // (fails before: yes — an offered `auto` was never switched to, and `auto` took any model whose name held the word)
  const named = await apply(["auto", "gemini-2.5-pro"], "gemini-2.5-pro");
  assert.deepEqual([named.asked, named.conv.modelId], [[["session/set_config_option", "model", "auto"]], "auto"], "a model named `auto` is switched to as Cursor's is");
  const word = await apply(["gpt-5-auto-review", "sonnet"], "sonnet");
  assert.deepEqual([word.asked, word.conv.modelId, word.notes], [[], "sonnet", ["acp: model auto"]], "a model whose name holds the word is no agent's auto");
});

// (fails before: no — a guard the mutation pass asked for: every model's words said its version in its description
// too, and no alias's version was two numbers)
test("a model's version in its name alone, as a printed list gives one; an alias's version of two numbers, spelled with a dash", () => {
  assert.equal(matchOffered("claude-sonnet-5", ["sonnet"], listedModels("sonnet - Sonnet 5\n").labels), "sonnet");
  const params = [{ id: "effort", values: ["low", "high"] }];
  assert.deepEqual(planVariant("opus-4-5-high", null, { models: ["opus"], params, labels: { opus: { label: "Opus 4.5" } } }), { base: "opus", set: [["effort", "high"]], unknown: [], effortParam: "effort" });
});

// (fails before: no — a guard the mutation pass asked for: no session was resumed by its id, and no agent sent an
// update of its model option)
test("the agent's words for its models ride with its session: resumed by its id, and past an update that names its ids alone", () => {
  const offer = readSessionOffer({ configOptions: [{ id: "model", type: "select", currentValue: "default", options: [{ value: "default" }, { value: "sonnet", name: "Sonnet 5" }] }] });
  const words = { sonnet: { label: "Sonnet 5" } };
  const at = { proc: { key: "p" }, upstream: { id: "u" }, acp: {}, cwd: "x", offer };
  assert.deepEqual(resumedConversation({ ...at, found: { sessionId: "s2" } }).modelLabels, words);
  const map = new SessionMap();
  map.set("chat", newConversation({ ...at, res: { sessionId: "s1" }, modelId: "", lastText: "" }));
  map.absorbUpdate("s1", { sessionUpdate: "config_option_update", configOptions: [{ id: "model", type: "select", currentValue: "sonnet", options: [{ value: "default" }, { value: "sonnet" }] }] });
  assert.deepEqual([map.get("chat")?.modelId, map.get("chat")?.modelLabels], ["sonnet", words]);
});

// (fails before: yes — commands an agent published ahead of its session's record were dropped: the update comes in with
// the open's answer at times, and the session then had none for as long as it lived)
test("commands a session published before its conversation was kept are the conversation's; its own later word replaces them", () => {
  const offer = readSessionOffer({});
  const at = { proc: { key: "p" }, upstream: { id: "u" }, acp: {}, cwd: "x", offer, modelId: "", lastText: "" };
  /** @param {string[]} names */
  const published = (...names) => ({ sessionUpdate: "available_commands_update", availableCommands: names.map((name) => ({ name, description: `${name}s`, input: { hint: "[x]" } })) });
  /** @param {string} name */
  const kept = (name) => ({ name, description: `${name}s`, hint: "[x]" });
  const map = new SessionMap();
  map.absorbUpdate("s1", published("compact", "autocompact"));
  map.absorbUpdate("s2", published("review"));
  map.set("chat", newConversation({ ...at, res: { sessionId: "s1" } }));
  assert.deepEqual(map.get("chat")?.commands, [kept("compact"), kept("autocompact")], "its own, not another session's");
  map.absorbUpdate("s1", published("compact"));
  assert.deepEqual(map.get("chat")?.commands, [kept("compact")], "its later word");
  // Taken once: a record kept again for the session has what it brings, no more.
  map.set("again", newConversation({ ...at, res: { sessionId: "s1" } }));
  assert.equal(map.get("again")?.commands, undefined, "the early word was taken by the first record");
  map.set("known", { ...newConversation({ ...at, res: { sessionId: "s2" } }), commands: [kept("commit")] });
  assert.deepEqual(map.get("known")?.commands, [kept("commit")], "a record that has its commands keeps them");
  // Only the newest few sessions' are kept while nobody holds them.
  for (let i = 0; i < 40; i++) map.absorbUpdate(`t${i}`, published(`c${i}`));
  map.set("old", newConversation({ ...at, res: { sessionId: "t0" } }));
  map.set("new", newConversation({ ...at, res: { sessionId: "t39" } }));
  assert.deepEqual([map.get("old")?.commands, map.get("new")?.commands], [undefined, [kept("c39")]]);
});

test("/api/acp/detect adds missing agents to an existing config without disabling anything", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-detect-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.loopbackTrust = "legacy"; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.upstreams = [{ id: "cursor", name: "my cursor", type: "acp", enabled: false, acp: { command: "agent", args: ["acp"] } }];
  cfg.routes = [{ match: "cursor/*", upstream: "cursor", upstreamModel: "{1}", enabled: false }, { match: "*", upstream: "cursor", upstreamModel: "{model}" }];
  writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
  const app = createApp({ dataDir: dir, overrides: { port: 0 } }); const port = (await app.start()).port;
  try {
    // status=0: the listing with logins asks each installed agent's own CLI who is signed in — the developer's real
    // `claude auth status` and `codex login status`, which no test starts (HarnessV4_Tasks C1: seen when the suite ran
    // with CLAUDE_CONFIG_DIR set, and Claude Code wrote its config into that folder).
    const before = await (await fetch(`http://127.0.0.1:${port}/api/acp/agents?status=0`)).json();
    assert.ok(before.agents.find((a) => a.id === "cursor").configured); assert.ok(!before.agents.find((a) => a.id === "qoder").configured);
    const d = await (await fetch(`http://127.0.0.1:${port}/api/acp/detect`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    assert.equal(d.ok, true); assert.ok(d.added.includes("qoder") && d.added.includes("qoder-cn") && !d.added.includes("cursor"));
    assert.equal(d.added.includes("antigravity-acp"), false, "a program ACP's registry installs is no PATH's to find");
    const saved = loadConfig(dir).config;
    assert.equal(saved.upstreams.find((u) => u.id === "cursor").name, "my cursor", "existing entries untouched");
    assert.ok(saved.upstreams.find((u) => u.id === "qoder")); assert.ok(saved.routes.some((r) => r.match === "qoder/*"));
    assert.equal(saved.routes.at(-1).match, "*", "catch-all stays last");
    // Qoder is added off, found or not, its route on; Cursor's CLI, on by default, is switched on where it is found.
    const q = saved.upstreams.find((u) => u.id === "qoder"); assert.equal(q.enabled, false);
    assert.notEqual(saved.routes.find((r) => r.match === "qoder/*").enabled, false);
    assert.equal(saved.upstreams.find((u) => u.id === "cursor").enabled, d.agents.find((a) => a.id === "cursor").installed);
    assert.equal(d.enabled.includes("qoder") || d.enabled.includes("qoder-cn"), false);
    // (fails before: yes — Detect switched Cursor on and left its route off: its names went to the catch-all, and its
    // Connect, finding it connected, never turned the route on)
    assert.equal(saved.routes.find((r) => r.match === "cursor/*").enabled !== false, d.enabled.includes("cursor"), "an agent switched on has its own route on");
  } finally { await app.stop(); rmSync(dir, { recursive: true, force: true }); }
});

// (fails before: yes — Log in typed the catalogue's words for a person into cmd as a command: Qoder CN's "log in inside
// the Qoder CN desktop app (qoder.cn), or run: …", and its site was never set)
test("Log in opens the agent's own sign-in command with its variables: Qoder CN's site in the window's environment, or in the line", () => {
  const cn = KNOWN_AGENTS.find((a) => a.id === "qoder-cn");
  const win = loginLaunch(cn, "win32");
  assert.deepEqual([win?.program, win?.args.slice(-3), win?.vars], ["cmd.exe", ["cmd", "/k", "qodercli login"], { QODERCLI_SITE: "cn" }]);
  assert.equal(win?.line, commandLine(["qodercli", "login"], { QODERCLI_SITE: "cn" }, "win32"));
  const mac = loginLaunch(cn, "darwin");
  assert.deepEqual([mac?.program, mac?.vars], ["osascript", {}], "Terminal starts a shell of its own: the site goes in the line");
  assert.match(String(mac?.args[1]), /do script \("QODERCLI_SITE=cn qodercli login"\)$/);
  assert.deepEqual(loginLaunch(cn, "linux"), { program: "", args: [], vars: { QODERCLI_SITE: "cn" }, line: "QODERCLI_SITE=cn qodercli login" });
  const claude = loginLaunch(KNOWN_AGENTS.find((a) => a.id === "claude-code"), "win32");
  assert.deepEqual([claude?.args.at(-1), claude?.vars, claude?.line], ["claude auth login", {}, "claude auth login"]);
  assert.equal(loginLaunch(CURSOR_SDK, "win32"), null, "Cursor's SDK signs in with its key");
});

test("validation refuses cwdAllowlist entries that are not folder paths", () => {
  const cfg = normalizeConfig(defaultConfig());
  cfg.upstreams.push({ id: "agentx", name: "x", type: "acp", enabled: true, acp: { command: "agent", args: ["acp"], cwdAllowlist: ["allow-all"] } });
  const v = validateConfig(normalizeConfig(cfg));
  assert.ok(!v.ok); assert.ok(v.errors.some((e) => /agentx|upstreams\[\d+\]\.acp\.cwdAllowlist\[0\] "allow-all" is not a folder path/.test(e)), v.errors.join("; "));
  cfg.upstreams.at(-1).acp.cwdAllowlist = [process.platform === "win32" ? "C:\\Projects" : "/srv/projects", ""];
  assert.ok(validateConfig(normalizeConfig(cfg)).ok || validateConfig(normalizeConfig(cfg)).errors.every((e) => !/cwdAllowlist\[0\]/.test(e)));
});


// (fails before: yes — a `/word` sent before the agent said its commands went into its running turn as words; one to an
// agent that never says them waited for the prompt's end: HarnessV3-FailurePoints, the early-command race)
test("the agent's own commands as its session says them: a / note waits for its commands or its first answer, a replay's none; words never wait", async () => {
  const tick = () => new Promise((r) => setImmediate(r));
  const map = new SessionMap();
  /** @type {any} */
  const quiet = { sessionId: "s1" };
  map.set("quiet", quiet);
  const own = ownCommands(quiet);
  assert.equal(own.unsure("plain words"), null, "words never wait");
  assert.equal(own.holds("/review it"), null, "no commands said: none is one");
  const waits = own.unsure("/review it");
  assert.ok(waits instanceof Promise);
  assert.equal(own.unsure("/commit"), waits, "one word for all that wait");
  let said = false;
  void waits?.then(() => (said = true));
  map.absorbUpdate("s1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "earlier words" } }, { replay: true });
  map.absorbUpdate("s2", { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "another session's" } });
  await tick();
  assert.equal(said, false, "a loaded session's history, and another session's answer, are no answer of its own now");
  map.absorbUpdate("s1", { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read" });
  await tick();
  assert.equal(said, true, "it answered without commands: it has none to say yet");
  assert.equal(own.unsure("/review it"), null, "from then on a / note is words at once");
  /** @type {any} */
  const saying = { sessionId: "s3" };
  map.set("saying", saying);
  const own3 = ownCommands(saying);
  let told = false;
  void own3.unsure("/review it")?.then(() => (told = true));
  map.absorbUpdate("s3", { sessionUpdate: "available_commands_update", availableCommands: [{ name: "review", description: "Review" }] });
  await tick();
  assert.equal(told, true, "its commands said");
  assert.equal(own3.holds("/review it"), "/review");
  assert.deepEqual([own3.holds("/other x"), own3.unsure("/other x")], [null, null], "a / note it has no command for is words at once");
});
