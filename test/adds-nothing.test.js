// @ts-check
// A coding agent Filament launched asks Filament's door to add nothing (proxy-twice, FabeleHelper's of 11-11): where the
// person's own settings send its model calls through Filament, its turn here has Filament's memory, context and tools
// already, and a second pass added them again — a reminder said twice, memory's tools offered twice. Its calls that go
// to Filament's door carry `x-filament-adds: none`, and no other does (Claude Code's ANTHROPIC_CUSTOM_HEADERS, after the
// person's own, where its ANTHROPIC_BASE_URL is Filament's; Codex's headers of each provider of its config whose address
// is Filament's door) — Anthropic and the person's own gateway never see it — and the door adds nothing:
// no memory, no tools, no chat command answered — routed and recorded all the same, and refused in words where the
// model it names is itself a coding agent's.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startApp, fakeUpstream, FAKE_ACP_AGENT, FIXTURES } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { AcpBridge } from "../src/acp.js";
import { CodexBridge } from "../src/adapters/agents/codex/bridge.js";
import { SessionMap } from "../src/adapters/agents/acp/sessions.js";
import { claudeAtDoor, claudeLaunchEnv, claudeSessionHeaders, claudeSettingsHeaders, filamentsDoor, withAddsNothing, withSettingsHeaders, CLAUDE_BASE_VAR, CLAUDE_HEADERS_VAR } from "../src/adapters/agents/acp/toolset.js";
import { addsNothing } from "../src/core/conversation.js";

/**
 * Where a Filament is reached, as its server says it (server.js `ownPlaces`): its own port and a door's, this machine's
 * name and address on the network, and its address on the tailnet.
 */
const PLACES = () => ({ ports: [20399, 20500], names: ["desk.lan", "192.168.1.20"], origins: ["https://desk.tail1234.ts.net"] });
/** A file reader over `files`, by their paths with forward slashes: any other is not there. @param {Record<string, string>} files */
const reader = (files) => (/** @type {string} */ f) => {
  const k = f.replace(/\\/g, "/");
  if (!(k in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  return files[k];
};
/** The variables of this process a test sets or takes out, put back as they were after `run`. @param {Record<string, string | undefined>} vars @param {() => Promise<void>} run */
async function withVars(vars, run) {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  /** @param {Record<string, string | undefined>} to */
  const set = (to) => {
    for (const [k, v] of Object.entries(to)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  };
  set(vars);
  try {
    await run();
  } finally {
    set(before);
  }
}

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
const PROJECT = mkdtempSync(join(tmpdir(), "filament-adds-"));
before(async () => {
  // A provider that is overloaded for `fails-*`, as one is before a route fails over.
  up = await fakeUpstream((call) => (call.body?.model === "fails-1" ? { status: 529, json: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } } : undefined));
  shim = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.upstreams = [
        { id: "u", name: "u", type: "anthropic-compatible", baseUrl: up.url, apiKey: "s" },
        { id: "agent", name: "agent", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], permissions: "allow-all", hints: false } },
      ];
      cfg.routes = [
        { match: "claude-*", upstream: "u", upstreamModel: "{model}" },
        { match: "inner-*", upstream: "agent" },
        { match: "agentfirst-*", upstream: "agent", fallbacks: [{ upstream: "u", upstreamModel: "{model}" }] },
        { match: "fails-*", upstream: "u", upstreamModel: "{model}", fallbacks: [{ upstream: "agent" }] },
      ];
      cfg.rules.resilience = { ...(cfg.rules.resilience || {}), failover: true };
      cfg.memory.autopilot = { enabled: true };
      cfg.agentLoop = { ...(cfg.agentLoop || {}), enabled: true, roots: [PROJECT] };
    },
  });
});
after(async () => {
  await shim?.stop();
  await up?.close();
  await removeDirs(PROJECT);
});

const SYSTEM = "You are Claude Code.\nWorking directory: C:\\demo\\adds";
/** A Claude Code request, its session's id its own. @param {string} text @param {string} sid @param {Record<string, string>} [headers] */
const send = async (text, sid, headers = {}, model = "claude-x") => {
  const r = await shim.post("/v1/messages", { model, max_tokens: 64, system: SYSTEM, messages: [{ role: "user", content: text }] }, { "user-agent": "claude-cli/2.1.0 (external, sdk-ts)", "x-claude-code-session-id": sid, ...headers });
  return { status: r.status, body: await r.json(), id: String(r.headers.get("x-filament-request-id")) };
};

// (fails before: yes — proxy-twice: the door had no word for "add nothing", so a launched Claude Code's call got memory's
// work a second time, and an `@mem` it typed was answered by Filament instead of its model)
test("a marked call goes to its model as sent — no memory, no tools, no command answered — and is recorded, said so; unmarked it is a client's", async () => {
  up.reset();
  const marked = await send("@mem status", "cc-marked", { "x-filament-adds": "none" });
  assert.equal(marked.status, 200, JSON.stringify(marked.body));
  assert.equal(up.received.length, 1, "its model answered the command's words: Filament did not");
  const sent = up.received[0].body;
  // Routing's own shaping stays (the cache marker it adds where the client sent none): the words are the client's.
  assert.deepEqual(sent.messages.map((/** @type {any} */ m) => [m.role, m.content.map((/** @type {any} */ b) => b.text).join("")]), [["user", "@mem status"]], "nothing written into it");
  assert.equal(sent.system, SYSTEM, "no briefing");
  assert.ok(!(sent.tools || []).some((/** @type {any} */ t) => /^filament_/.test(t.name)), "no tool of Filament's");
  const rec = await shim.record(marked.id);
  assert.ok((rec.changes || []).some((/** @type {string} */ c) => c.startsWith("context: the client asked Filament to add nothing (x-filament-adds: none)")), JSON.stringify(rec.changes));
  assert.equal(rec.memory?.chain ?? null, null, "memory kept no turn of it");

  // Unmarked, the same call is a client's: memory's briefing rides it — what a launched agent's turn had already.
  up.reset();
  assert.equal((await send("hello", "cc-plain")).status, 200);
  assert.match(String(up.received[0].body.system), /<filament-memory kind="briefing">/);
  up.reset();
  assert.equal((await send("@mem status", "cc-plain")).status, 200);
  assert.equal(up.received.length, 0, "and Filament answers its command");

  // A command of Filament's that needs no memory (`/goal`): the marked call's model reads it, a client's is answered.
  up.reset();
  assert.equal((await send("/goal", "cc-marked", { "x-filament-adds": "none" })).status, 200);
  assert.equal(up.received.length, 1, "its model answered /goal");
  up.reset();
  assert.equal((await send("/goal", "cc-plain")).status, 200);
  assert.equal(up.received.length, 0, "Filament answers a client's /goal");
});

test("a marked call whose model is a coding agent's is refused in words: no agent inside another's model call", async () => {
  const r = await send("hello", "cc-inner", { "x-filament-adds": "none" }, "inner-1");
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.match(JSON.stringify(r.body), /agent is a coding agent, and this call is a coding agent's that Filament launched: one does not run inside another's model call/);
});

// (fails before: yes — the review of c04dd3507, sa_d91a7b37: the refusal fired inside the failover loop, so a route whose
// first is a coding agent refused though a provider backed it, and a provider's own error turned into the refusal)
test("a marked call's route goes to no coding agent, first or a backup: its providers answer, and their own error stands", async () => {
  up.reset();
  const first = await send("hello", "cc-routes", { "x-filament-adds": "none" }, "agentfirst-1");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(up.received.length, 1, "the provider behind the agent answered");
  const rec = await shim.record(first.id);
  assert.ok((rec.changes || []).includes("routing: a coding agent's call goes to no coding agent: agent left off its route"), JSON.stringify(rec.changes));
  const failed = await send("hello", "cc-routes", { "x-filament-adds": "none" }, "fails-1");
  assert.notEqual(failed.status, 403, JSON.stringify(failed.body));
  assert.match(JSON.stringify(failed.body), /Overloaded|overloaded/, "the provider's own words");
});

// (fails before: yes — the review of c04dd3507, sa_d91a7b37: a chat's own turn carrying the header was left out of
// memory bare, never kept, and the chat's next turn went without it)
test("a chat's own turn is Filament's: the header counts at the front door alone, and the turn is kept", async () => {
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: PROJECT, model: "claude-x", preset: "plain" } });
  assert.equal(r.status, 200, await r.clone().text());
  const id = String((await r.json()).id);
  const turn = async (/** @type {string} */ content, /** @type {Record<string, string>} */ headers = {}) => {
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false }, headers });
    assert.equal(res.status, 200, await res.clone().text());
    await res.json();
  };
  await turn("the first words", { "x-filament-adds": "none" });
  up.reset();
  await turn("the second words");
  const sent = JSON.stringify(up.received.at(-1)?.body?.messages || []);
  assert.ok(sent.includes("the first words"), sent.slice(0, 600));
});

// (fails before: yes — the review of 11-11: every Claude Code Filament launched carried the ask, so Anthropic and the
// person's own gateway saw it on every call; it rides only where its calls go to Filament's door)
test("the header: Claude Code's variable carries it after the person's own headers, once, only where its model calls go to Filament's door; their settings' own headers are read local over project over theirs", () => {
  assert.equal(addsNothing({ "x-filament-adds": " NONE" }), true);
  assert.equal(addsNothing({ "x-filament-adds": "memory" }), false);
  assert.equal(addsNothing({}), false);
  assert.equal(withAddsNothing(undefined), "x-filament-adds: none");
  assert.equal(withAddsNothing("X-Team: a\n"), "X-Team: a\nx-filament-adds: none", "theirs kept, ours after");
  assert.equal(withAddsNothing("X-Filament-Adds: none\nX-Team: a"), "X-Filament-Adds: none\nX-Team: a", "once");
  const none = reader({});
  const DOOR = { [CLAUDE_BASE_VAR]: "http://127.0.0.1:20399" };
  const ELSEWHERE = { [CLAUDE_BASE_VAR]: "https://gateway.example.com" };
  const base = { [CLAUDE_HEADERS_VAR]: "X-Mine: 1" };
  const door = filamentsDoor(PLACES);
  // No address set anywhere, its calls go to Anthropic; set to a gateway of the person's, there: its variables are its
  // launch's as they are, and what it inherits is theirs alone.
  assert.deepEqual(claudeLaunchEnv({ A: "1" }, { base, door, read: none }), { A: "1" }, "to Anthropic: nothing of Filament's");
  assert.deepEqual(claudeLaunchEnv({ ...ELSEWHERE, [CLAUDE_HEADERS_VAR]: "X-Up: 2" }, { base, door, read: none }), { ...ELSEWHERE, [CLAUDE_HEADERS_VAR]: "X-Up: 2" }, "to their gateway: their headers as they are");
  // Where Filament is reached: at the places its server says (server.js `ownPlaces`), else at the address a turn was
  // given its server at, else nowhere known.
  assert.deepEqual(
    ["http://127.0.0.1:20399", "http://localhost:20500/v1", "http://192.168.1.20:20500", "http://desk.lan:20399/", "https://desk.tail1234.ts.net/v1", "http://desk.lan:9999", "https://api.anthropic.com", "not an address"].map((url) => door?.(url)),
    [true, true, true, true, true, false, false, false],
  );
  const byTurn = filamentsDoor(null, "http://127.0.0.1:20399");
  assert.deepEqual(["http://localhost:20399/v1", "http://desk.lan:20399", "http://127.0.0.1:20500"].map((url) => byTurn?.(url)), [true, false, false], "the turn's address alone");
  assert.deepEqual([filamentsDoor(null, null), filamentsDoor(undefined, "no address")], [null, null]);
  assert.deepEqual(claudeLaunchEnv({ ...DOOR }, { base: {}, door: null, read: none }), DOOR, "Filament's address not known: nothing is asked");
  // At Filament's door, by its launch's variable, the one it inherits, or its account's own settings over both.
  assert.deepEqual(claudeLaunchEnv({ A: "1", ...DOOR }, { base: {}, door, read: none }), { A: "1", ...DOOR, [CLAUDE_HEADERS_VAR]: "x-filament-adds: none" });
  assert.equal(claudeLaunchEnv({ ...DOOR }, { base, door, read: none })[CLAUDE_HEADERS_VAR], "X-Mine: 1\nx-filament-adds: none", "Filament's own environment's, which the process inherits");
  assert.equal(claudeLaunchEnv({ ...DOOR, [CLAUDE_HEADERS_VAR]: "X-Up: 2" }, { base, door, read: none })[CLAUDE_HEADERS_VAR], "X-Up: 2\nx-filament-adds: none", "the launch's over it");
  assert.equal(claudeLaunchEnv({}, { base: { ...base, ...DOOR }, door, read: none })[CLAUDE_HEADERS_VAR], "X-Mine: 1\nx-filament-adds: none", "an address it inherits");
  assert.deepEqual(claudeLaunchEnv({}, { base: { ...base, ...DOOR }, remove: [CLAUDE_BASE_VAR], door, read: none }), {}, "an address taken out is none");
  assert.equal(claudeLaunchEnv({ ...ELSEWHERE }, { base: { ...base, ...DOOR }, door, read: none })[CLAUDE_HEADERS_VAR], undefined, "the launch's address over the inherited one");
  assert.equal(claudeLaunchEnv({}, { base: { Anthropic_Base_Url: DOOR[CLAUDE_BASE_VAR] }, door, read: none, win: true })[CLAUDE_HEADERS_VAR], "x-filament-adds: none", "a name in any case on Windows");
  assert.deepEqual(claudeLaunchEnv({}, { base: { Anthropic_Base_Url: DOOR[CLAUDE_BASE_VAR] }, door, read: none, win: false }), {}, "elsewhere a name is its case");
  const account = (/** @type {string} */ at) => reader({ "/acct/settings.json": JSON.stringify({ env: { [CLAUDE_BASE_VAR]: at } }) });
  assert.equal(claudeLaunchEnv({ CLAUDE_CONFIG_DIR: "/acct", ...ELSEWHERE }, { base: {}, door, read: account("http://desk.lan:20500/") })[CLAUDE_HEADERS_VAR], "x-filament-adds: none", "its account's settings over its variable");
  assert.equal(claudeLaunchEnv({ CLAUDE_CONFIG_DIR: "/acct", ...DOOR }, { base: {}, door, read: account("https://gateway.example.com") })[CLAUDE_HEADERS_VAR], undefined, "and to a gateway over Filament's door");
  // (fails before: yes — the review of c04dd3507, sa_d91a7b37: an inherited variable the upstream's envRemove took out
  // came back with the ask, and a launch's own name for it in another case stood beside the new one)
  assert.equal(claudeLaunchEnv({ ...DOOR }, { base, remove: [CLAUDE_HEADERS_VAR], door, read: none })[CLAUDE_HEADERS_VAR], "x-filament-adds: none", "taken out: theirs stays out");
  assert.equal(claudeLaunchEnv({ ...DOOR }, { base, remove: ["anthropic_custom_headers"], win: true, door, read: none })[CLAUDE_HEADERS_VAR], "x-filament-adds: none", "in any case on Windows");
  assert.equal(claudeLaunchEnv({ ...DOOR }, { base, remove: ["anthropic_custom_headers"], win: false, door, read: none })[CLAUDE_HEADERS_VAR], "X-Mine: 1\nx-filament-adds: none", "elsewhere a name is its case");
  assert.deepEqual(claudeLaunchEnv({ Anthropic_Custom_Headers: "X-Up: 2", B: "2", ...DOOR }, { base: {}, win: true, door, read: none }), { B: "2", ...DOOR, [CLAUDE_HEADERS_VAR]: "X-Up: 2\nx-filament-adds: none" }, "one variable, not two names Windows reads as one");
  // A session's settings as its record keeps them: without the person's headers, given again as they stand — the ask
  // after them where the session's calls go to Filament's door, theirs alone elsewhere.
  const meta = { _meta: { claudeCode: { options: { settings: { attribution: { commit: "" }, env: { [CLAUDE_HEADERS_VAR]: "X-Old: o\nx-filament-adds: none" } } } } } };
  assert.deepEqual(withSettingsHeaders(meta, null)._meta.claudeCode.options.settings, { attribution: { commit: "" } });
  assert.deepEqual(withSettingsHeaders(meta, "X-New: n", true)._meta.claudeCode.options.settings.env, { [CLAUDE_HEADERS_VAR]: "X-New: n\nx-filament-adds: none" });
  assert.deepEqual(withSettingsHeaders(meta, "X-New: n")._meta.claudeCode.options.settings.env, { [CLAUDE_HEADERS_VAR]: "X-New: n" }, "elsewhere: nothing of Filament's added");
  assert.deepEqual(withSettingsHeaders({ _meta: { claudeCode: { options: {} } } }, "X-New: n", true), { _meta: { claudeCode: { options: {} } } }, "a session that takes no settings takes none");
  const env = { CLAUDE_CONFIG_DIR: "/home/me/.claude" };
  const user = { "/home/me/.claude/settings.json": JSON.stringify({ env: { [CLAUDE_HEADERS_VAR]: "X-User: u" } }) };
  assert.equal(claudeSettingsHeaders({ cwd: "/p", env, read: reader({}) }), null, "none sets them");
  assert.equal(claudeSettingsHeaders({ cwd: "/p", env, read: reader(user) }), "X-User: u");
  assert.equal(claudeSettingsHeaders({ cwd: "/p", env, read: reader({ ...user, "/p/.claude/settings.json": JSON.stringify({ env: { [CLAUDE_HEADERS_VAR]: "X-Proj: p" } }) }) }), "X-Proj: p");
  assert.equal(claudeSettingsHeaders({ cwd: "/p", env, read: reader({ ...user, "/p/.claude/settings.local.json": JSON.stringify({ env: { [CLAUDE_HEADERS_VAR]: "X-Local: l" } }), "/p/.claude/settings.json": "{ not json" }) }), "X-Local: l");
});

// (fails before: yes — the review of 11-11: a session's folder's own settings can send Claude Code's calls another way
// than its process's variable does, as Settings › Connect says to write them, and the ask followed neither)
test("a session's settings say Claude Code's headers so the ask rides where that session's calls go to Filament's door, and nowhere else", () => {
  const door = filamentsDoor(PLACES);
  /** @param {Record<string, Record<string, string>>} set  a settings file's `env`, by its path */
  const files = (set) => reader(Object.fromEntries(Object.entries(set).map(([f, env]) => [f, JSON.stringify({ env })])));
  const user = "/home/me/.claude/settings.json";
  const project = "/p/.claude/settings.json";
  const local = "/p/.claude/settings.local.json";
  const home = { CLAUDE_CONFIG_DIR: "/home/me/.claude" };
  const DOOR = "http://localhost:20399";
  const ELSEWHERE = "https://gateway.example.com";
  // Where its calls go: its settings' address — local over project over the person's own — over its process's variable.
  /** @param {Record<string, Record<string, string>>} set @param {Record<string, string>} [env] @param {boolean} [win] */
  const at = (set, env = {}, win = false) => claudeAtDoor({ cwd: "/p", env: { ...home, ...env }, read: files(set), door, win });
  assert.deepEqual([at({}), at({}, { [CLAUDE_BASE_VAR]: DOOR }), at({}, { [CLAUDE_BASE_VAR]: ELSEWHERE })], [false, true, false], "its process's variable, to Anthropic with none");
  assert.deepEqual([at({ [user]: { [CLAUDE_BASE_VAR]: DOOR } }, { [CLAUDE_BASE_VAR]: ELSEWHERE }), at({ [user]: { [CLAUDE_BASE_VAR]: ELSEWHERE } }, { [CLAUDE_BASE_VAR]: DOOR })], [true, false], "the person's own settings over it");
  assert.deepEqual([at({ [user]: { [CLAUDE_BASE_VAR]: ELSEWHERE }, [project]: { [CLAUDE_BASE_VAR]: DOOR } }), at({ [user]: { [CLAUDE_BASE_VAR]: DOOR }, [project]: { [CLAUDE_BASE_VAR]: ELSEWHERE } })], [true, false], "the project's over theirs");
  assert.deepEqual([at({ [project]: { [CLAUDE_BASE_VAR]: ELSEWHERE }, [local]: { [CLAUDE_BASE_VAR]: DOOR } }), at({ [project]: { [CLAUDE_BASE_VAR]: DOOR }, [local]: { [CLAUDE_BASE_VAR]: ELSEWHERE } })], [true, false], "its local settings over the project's");
  assert.deepEqual([at({}, { anthropic_base_url: DOOR }, true), at({}, { anthropic_base_url: DOOR }, false)], [true, false], "a variable's name in any case on Windows");
  assert.equal(claudeAtDoor({ cwd: "/p", env: { ...home, [CLAUDE_BASE_VAR]: DOOR }, read: files({}), door: null }), false, "Filament's address not known");
  // What the session's settings say of its headers, null for nothing. `asked`: its process started with the ask in its
  // variable.
  const META = { _meta: { claudeCode: { options: { settings: {} } } } };
  /** @param {Record<string, Record<string, string>>} set @param {Record<string, string>} env @param {boolean} asked */
  const said = (set, env, asked) => {
    const s = claudeSessionHeaders({ cwd: "/p", env: { ...home, ...env }, read: files(set), door, started: asked ? { [CLAUDE_HEADERS_VAR]: withAddsNothing(env[CLAUDE_HEADERS_VAR]) } : env, win: false });
    return { atDoor: s.atDoor, headers: withSettingsHeaders(META, s.ownHeaders, s.atDoor)._meta.claudeCode.options.settings.env?.[CLAUDE_HEADERS_VAR] ?? null };
  };
  const mine = { [CLAUDE_HEADERS_VAR]: "X-Mine: 1" };
  // At the door by its process's variable: the variable carries the ask, and the settings say nothing — unless the
  // person's own settings set headers, which stand over the variable: the ask after theirs.
  assert.deepEqual(said({}, { [CLAUDE_BASE_VAR]: DOOR, ...mine }, true), { atDoor: true, headers: null });
  assert.deepEqual(said({ [user]: { [CLAUDE_HEADERS_VAR]: "X-User: u" } }, { [CLAUDE_BASE_VAR]: DOOR, ...mine }, true), { atDoor: true, headers: "X-User: u\nx-filament-adds: none" });
  // At the door by this folder's settings alone, its process started without the ask: after its process's own headers.
  assert.deepEqual(said({ [project]: { [CLAUDE_BASE_VAR]: DOOR } }, mine, false), { atDoor: true, headers: "X-Mine: 1\nx-filament-adds: none" });
  assert.deepEqual(said({ [project]: { [CLAUDE_BASE_VAR]: DOOR } }, {}, false), { atDoor: true, headers: "x-filament-adds: none" });
  assert.deepEqual(said({ [project]: { [CLAUDE_BASE_VAR]: DOOR, [CLAUDE_HEADERS_VAR]: "X-Proj: p" } }, mine, false), { atDoor: true, headers: "X-Proj: p\nx-filament-adds: none" });
  // Elsewhere: the person's headers stand as they are — and where its process started with the ask, this folder's
  // settings sending its calls away from the door, its process's own headers are said again without it.
  assert.deepEqual(said({}, { [CLAUDE_BASE_VAR]: ELSEWHERE, ...mine }, false), { atDoor: false, headers: null });
  assert.deepEqual(said({ [user]: { [CLAUDE_HEADERS_VAR]: "X-User: u" } }, mine, false), { atDoor: false, headers: null }, "to Anthropic: theirs alone");
  assert.deepEqual(said({ [project]: { [CLAUDE_BASE_VAR]: ELSEWHERE } }, { [CLAUDE_BASE_VAR]: DOOR, ...mine }, true), { atDoor: false, headers: "X-Mine: 1" });
  assert.deepEqual(said({ [project]: { [CLAUDE_BASE_VAR]: ELSEWHERE } }, { [CLAUDE_BASE_VAR]: DOOR }, true), { atDoor: false, headers: "" }, "none of theirs: an empty variable over the ask");
  assert.deepEqual(said({ [project]: { [CLAUDE_BASE_VAR]: ELSEWHERE, [CLAUDE_HEADERS_VAR]: "X-Proj: p" } }, { [CLAUDE_BASE_VAR]: DOOR, ...mine }, true), { atDoor: false, headers: null }, "their settings' headers stand over the variable by themselves");
});

/**
 * A program named as Claude Code's adapter is, so Filament takes it for Claude Code (catalogues.js `agentKey`): on
 * Windows an npm-style shim named by its path, naming its script beside it — never the adapter npm installed — elsewhere
 * a script. → its command. @param {string} dir  the folder it is written in
 */
function fakeClaude(dir) {
  const win = process.platform === "win32";
  if (win) {
    copyFileSync(FAKE_ACP_AGENT, join(dir, "fake-acp-agent.mjs"));
    copyFileSync(join(dirname(FAKE_ACP_AGENT), "person-words.mjs"), join(dir, "person-words.mjs"));
    writeFileSync(join(dir, "claude-agent-acp.cmd"), `@"%~dp0\\node.exe" "%dp0%\\fake-acp-agent.mjs" %*\r\n`);
  } else {
    writeFileSync(join(dir, "claude-agent-acp"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_ACP_AGENT}" "$@"\n`);
    chmodSync(join(dir, "claude-agent-acp"), 0o755);
  }
  return join(dir, win ? "claude-agent-acp.cmd" : "claude-agent-acp");
}
/** A file's lines, each read as JSON; none where it is not there. @param {string} file */
const jsonLines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
/**
 * One turn of a Claude Code in a folder of its own, by a bridge that knows Filament's places — or, told none (`alone`),
 * only the address the turn is given Filament's server at (`mcpBase`): its launch's variables (`env`) and those taken
 * out (`remove`), its account's own settings and its folder's (`account`, `project`: each file's `env`). → the headers
 * its process started with, a start each, and the `env` of the settings its session opened with.
 * @param {{ env?: Record<string, string>, remove?: string[], account?: Record<string, string>, project?: Record<string, string> | null, alone?: boolean, mcpBase?: string | null }} o
 */
async function claudeTurn({ env = {}, remove = [], account = {}, project = null, alone = false, mcpBase = null }) {
  const dir = mkdtempSync(join(tmpdir(), "filament-adds-claude-"));
  const home = join(dir, "account");
  mkdirSync(home);
  writeFileSync(join(home, "settings.json"), JSON.stringify({ env: account }));
  if (project) {
    mkdirSync(join(dir, ".claude"));
    writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify({ env: project }));
  }
  const log = join(dir, "headers.jsonl");
  const calls = join(dir, "calls.jsonl");
  const upstream = { id: "cc", name: "cc", type: "acp", acp: { command: fakeClaude(dir), args: [], env: { FAKE_ACP_HEADERS: log, FAKE_ACP_CALLS: calls, FAKE_ACP_CLAUDE: "1", CLAUDE_CONFIG_DIR: home, ...env }, envRemove: remove, modelSelection: "none", cwdDefault: dir, permissions: "allow-all" } };
  const bridge = new AcpBridge({ log: () => {} });
  if (!alone) bridge.ownPlaces = PLACES;
  try {
    const out = await bridge.run({ upstream, modelId: "auto", format: "anthropic", body: { model: "m", max_tokens: 50, messages: [{ role: "user", content: "hi" }] }, conversationId: "adds", onEvent: () => {}, mcpBase });
    assert.equal(out.stopReason, "end_turn");
    const opened = jsonLines(calls).find((c) => c.method === "session/new");
    return { starts: jsonLines(log), said: opened?.settings?.env ?? null };
  } finally {
    bridge.shutdown();
    await removeDirs(dir);
  }
}

// (fails before: yes — the review of 11-11: Claude Code's process started with the ask whatever address its model calls
// went to, and its session's settings carried it after the person's own headers wherever those were set)
// (fails before: yes — the review of c04dd3507, sa_d91a7b37: an added account's own folder (CLAUDE_CONFIG_DIR) was never
// read for the headers its settings set — the person's ~/.claude was — and an inherited variable the upstream's
// envRemove took out came back with the ask)
test("Claude Code's process starts with the ask only where its calls go to Filament's door, none taken out come back; elsewhere the person's headers are theirs alone, in its process and in its session's settings", async () => {
  const ASK = "x-filament-adds: none";
  const DOOR = "http://desk.lan:20500";
  await withVars({ [CLAUDE_HEADERS_VAR]: "X-Inherited: i", [CLAUDE_BASE_VAR]: undefined }, async () => {
    // No address anywhere: its calls go to Anthropic. Its account's settings set headers, which Claude Code lays over
    // its process's by itself: Filament says none of them.
    assert.deepEqual(await claudeTurn({ account: { [CLAUDE_HEADERS_VAR]: "X-Account: a" } }), { starts: ["X-Inherited: i"], said: null }, "to Anthropic");
    assert.deepEqual(await claudeTurn({ remove: [CLAUDE_HEADERS_VAR] }), { starts: [null], said: null }, "taken out: theirs stays out, and nothing stands in for it");
    // To the person's own gateway, by its launch's variable or its account's settings.
    assert.deepEqual(await claudeTurn({ env: { [CLAUDE_BASE_VAR]: "https://gateway.example.com" } }), { starts: ["X-Inherited: i"], said: null }, "to their gateway");
    assert.deepEqual(await claudeTurn({ account: { [CLAUDE_BASE_VAR]: "https://gateway.example.com", [CLAUDE_HEADERS_VAR]: "X-Account: a" } }), { starts: ["X-Inherited: i"], said: null }, "by its account's settings");
    // To Filament's door, at this machine's name on the network and a door's port: the ask after the inherited headers,
    // alone where they are taken out; its account's own headers, which stand over the variable, with the ask after them
    // in the session's settings.
    assert.deepEqual(await claudeTurn({ env: { [CLAUDE_BASE_VAR]: DOOR } }), { starts: [`X-Inherited: i\n${ASK}`], said: null }, "to Filament's door");
    assert.deepEqual(await claudeTurn({ env: { [CLAUDE_BASE_VAR]: DOOR }, remove: [CLAUDE_HEADERS_VAR], account: { [CLAUDE_HEADERS_VAR]: "X-Account: a" } }), { starts: [ASK], said: { [CLAUDE_HEADERS_VAR]: `X-Account: a\n${ASK}` } }, "the ask alone: the inherited headers stay out");
    assert.deepEqual(await claudeTurn({ account: { [CLAUDE_BASE_VAR]: DOOR } }), { starts: [`X-Inherited: i\n${ASK}`], said: null }, "by its account's settings");
    // Its folder's own settings send this session's calls another way than its process's variable does: the session's
    // settings say its headers for that way.
    assert.deepEqual(await claudeTurn({ project: { [CLAUDE_BASE_VAR]: DOOR } }), { starts: ["X-Inherited: i"], said: { [CLAUDE_HEADERS_VAR]: `X-Inherited: i\n${ASK}` } }, "the folder's settings to Filament's door");
    assert.deepEqual(await claudeTurn({ env: { [CLAUDE_BASE_VAR]: DOOR }, project: { [CLAUDE_BASE_VAR]: "https://gateway.example.com" } }), { starts: [`X-Inherited: i\n${ASK}`], said: { [CLAUDE_HEADERS_VAR]: "X-Inherited: i" } }, "the folder's settings away from it");
    // A bridge no server told Filament's places knows the door by the address a turn is given Filament's server at: its
    // process, started before any turn's address, carries no ask, and the session's settings say it.
    const local = { [CLAUDE_BASE_VAR]: "http://localhost:20399" };
    assert.deepEqual(await claudeTurn({ env: local, alone: true, mcpBase: "http://127.0.0.1:20399" }), { starts: ["X-Inherited: i"], said: { [CLAUDE_HEADERS_VAR]: `X-Inherited: i\n${ASK}` } }, "by the turn's own address");
    assert.deepEqual(await claudeTurn({ env: local, alone: true }), { starts: ["X-Inherited: i"], said: null }, "nothing known: nothing is asked");
  });
});

// (fails before: yes — proxy-twice for Codex: a Codex Filament launched, whose own config sends its model calls through
// Filament's door as Settings › Connect sets it up, asked the door nothing, and its turn got Filament's additions again)
test("Codex's thread asks Filament's door to add nothing through the providers of its config that point there, no other; one naming the header keeps its own", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-adds-codex-"));
  const home = join(dir, "codex-home");
  mkdirSync(home);
  writeFileSync(
    join(home, "config.toml"),
    [
      'model_provider = "filament"',
      "",
      "[model_providers.filament]",
      'name = "filament"',
      'base_url = "http://localhost:20399/v1"',
      'env_key = "FILAMENT_KEY"',
      'wire_api = "responses"',
      "",
      "[model_providers.ollama]",
      'name = "ollama"',
      'base_url = "http://localhost:11434/v1"',
      "",
      "[model_providers.remote]",
      'name = "remote"',
      'base_url = "https://api.example.com/v1"',
      "",
      "[model_providers.theirs]",
      'name = "theirs"',
      'base_url = "http://127.0.0.1:20399/v1"',
      'http_headers = { "X-Filament-Adds" = "memory" }',
      "",
    ].join("\n"),
  );
  const calls = join(dir, "calls.jsonl");
  const upstream = { id: "cx", name: "cx", type: "codex", acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], env: { FAKE_CODEX_CALLS: calls, CODEX_HOME: home }, cwdDefault: dir, permissions: "allow-all" } };
  /** @param {string} method */
  const opens = (method) => readFileSync(calls, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.method === method);
  const ASK = "model_providers.filament.http_headers.x-filament-adds";
  const stateFile = join(dir, "codex-sessions.json");
  const first = new CodexBridge({ log: () => {}, stateFile });
  /** @type {CodexBridge | null} */
  let second = null;
  try {
    /** @param {string} conversationId @param {string | null} mcpBase @param {any} [toolsAt] */
    const run = (conversationId, mcpBase, toolsAt) => first.run({ upstream, modelId: "gpt-6-astra", format: "anthropic", body: { model: "m", max_tokens: 50, messages: [{ role: "user", content: "hi" }] }, conversationId, onEvent: () => {}, mcpBase, toolsAt });
    const out = await run("adds", "http://127.0.0.1:20399");
    assert.equal(out.stopReason, "end_turn");
    assert.deepEqual(opens("thread/start").at(-1)?.params?.config, { [ASK]: "none" }, "Filament's door alone, by another name of this machine; the person's own word kept");
    assert.ok(out.notes.includes("codex: its model calls to Filament's door (its provider filament) ask Filament to add nothing (x-filament-adds: none): the thread has Filament's additions already"), out.notes.join("\n"));
    // Filament's address not known (a turn outside the server): nothing is asked of anyone.
    await run("unknown", null);
    assert.equal(opens("thread/start").at(-1)?.params?.config, undefined);
    // Threads given Filament's own server, opened again after a restart outside a turn (Codex's own compaction): asked as
    // the person's config holds its providers then — none once the provider points elsewhere.
    await run("kept", "http://127.0.0.1:20399", { graph: true });
    await run("moved", "http://127.0.0.1:20399", { graph: true });
    assert.equal(opens("thread/start").at(-1)?.params?.config?.[ASK], "none");
    first.shutdown();
    second = new CodexBridge({ log: () => {}, stateFile });
    await second.compactOwn({ upstream, conversationId: "kept", base: 0, keep: "", fork: true, record: () => 5 });
    assert.equal(opens("thread/resume").at(-1)?.params?.config?.[ASK], "none", "still Filament's door");
    writeFileSync(join(home, "config.toml"), readFileSync(join(home, "config.toml"), "utf8").replace('base_url = "http://localhost:20399/v1"', 'base_url = "https://gateway.example.com/v1"'));
    await second.compactOwn({ upstream, conversationId: "moved", base: 0, keep: "", fork: true, record: () => 6 });
    const resumed = opens("thread/resume").at(-1)?.params?.config || {};
    assert.equal(resumed[ASK], undefined, JSON.stringify(resumed));
    assert.ok(resumed["mcp_servers.filament"]?.url, "Filament's own server given again");
  } finally {
    first.shutdown();
    second?.shutdown();
    await removeDirs(dir);
  }
});

// (fails before: yes — the review of c04dd3507, sa_d91a7b37: the headers the person's settings set rode the session's
// record to disk whole, a gateway's token among them as a rule; opened again, the session reads them as they stand)
test("a session's record on disk keeps none of the person's headers its settings carried, the rest of its settings kept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-adds-kept-"));
  const stateFile = join(dir, "acp-sessions.json");
  try {
    const map = new SessionMap({ stateFile, log: () => {} });
    const settings = { attribution: { commit: "" }, env: { [CLAUDE_HEADERS_VAR]: "Helicone-Auth: Bearer sk-secret\nx-filament-adds: none" } };
    map.set("one", /** @type {any} */ ({ sessionId: "s-one", upstreamId: "cc", cwd: dir, turns: 1, lastUsed: Date.now(), opened: { modelId: "m", mcpServers: [], sessionMeta: { _meta: { claudeCode: { options: { settings } } } } } }));
    map.flush();
    const text = readFileSync(stateFile, "utf8");
    assert.ok(!text.includes("sk-secret"), text);
    const again = new SessionMap({ stateFile, log: () => {} });
    again.load();
    assert.deepEqual(/** @type {any} */ (again.get("one")).opened.sessionMeta._meta.claudeCode.options.settings, { attribution: { commit: "" } });
  } finally {
    await removeDirs(dir);
  }
});

/**
 * Codex's fake app-server as an upstream of a folder of its own, its config the text given (none: no file), its launch's
 * variables `env` beside. → the upstream, its config's file, and the messages of a kind it heard.
 * @param {string} dir @param {string} id @param {string | null} config @param {Record<string, string>} [env]
 */
function fakeCodex(dir, id, config, env = {}) {
  const home = join(dir, `${id}-home`);
  mkdirSync(home);
  const file = join(home, "config.toml");
  if (config != null) writeFileSync(file, config);
  const calls = join(dir, `${id}-calls.jsonl`);
  const upstream = { id, name: id, type: "codex", acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], env: { FAKE_CODEX_CALLS: calls, CODEX_HOME: home, ...env }, cwdDefault: dir, permissions: "allow-all" } };
  return { upstream, file, opens: (/** @type {string} */ method) => jsonLines(calls).filter((m) => m.method === method) };
}
/** The providers a thread's config asks Filament's door to add nothing through, by name. @param {any} config */
const askedOf = (config) => Object.keys(config || {}).filter((k) => k.startsWith("model_providers.") && k.endsWith(".http_headers.x-filament-adds")).map((k) => k.split(".")[1]).sort();
/** One turn of a chat on a Codex upstream. @param {CodexBridge} bridge @param {any} upstream @param {string} conversationId @param {string | null} mcpBase */
const codexTurn = (bridge, upstream, conversationId, mcpBase) => bridge.run({ upstream, modelId: "gpt-6-astra", format: "anthropic", body: { model: "m", max_tokens: 50, messages: [{ role: "user", content: "hi" }] }, conversationId, onEvent: () => {}, mcpBase });

// (fails before: yes — the review of 11-11: Filament's door was known by the address a turn was given its server at
// alone, so a provider at this machine's address on the network, at its tailnet name or at another door's port — as
// Settings › Connect writes one, from the page's own address — was asked nothing; nor was any in a turn given no address)
test("Codex's providers at any place Filament is reached are asked — the network's address, the tailnet's, another door's port — in a turn given no address of Filament's too, and in a thread opened again that had none", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-adds-codex-"));
  const config = [
    ["lan", "http://192.168.1.20:20500/v1"],
    ["tailnet", "https://desk.tail1234.ts.net/v1"],
    ["named", "http://desk.lan:20399/v1"],
    ["door", "http://localhost:20500/v1"],
    ["ollama", "http://localhost:11434/v1"],
    ["remote", "https://desk.example.com:20399/v1"],
  ]
    .map(([name, at]) => `[model_providers.${name}]\nname = "${name}"\nbase_url = "${at}"\n`)
    .join("\n");
  const { upstream, opens } = fakeCodex(dir, "cx", config);
  const stateFile = join(dir, "codex-sessions.json");
  const first = new CodexBridge({ log: () => {}, stateFile });
  first.ownPlaces = PLACES;
  /** @type {CodexBridge | null} */
  let second = null;
  const AT_DOOR = ["door", "lan", "named", "tailnet"];
  try {
    await withVars({ OPENAI_BASE_URL: undefined }, async () => {
      const out = await codexTurn(first, upstream, "places", "http://127.0.0.1:20399");
      assert.equal(out.stopReason, "end_turn");
      assert.deepEqual(askedOf(opens("thread/start").at(-1)?.params?.config), AT_DOOR, "every place Filament is reached at, and no other");
      assert.ok(out.notes.includes("codex: its model calls to Filament's door (its providers lan, tailnet, named, door) ask Filament to add nothing (x-filament-adds: none): the thread has Filament's additions already"), out.notes.join("\n"));
      // A turn given no address of Filament's (no tool of its own is offered): its places are known all the same.
      await codexTurn(first, upstream, "nobase", null);
      assert.deepEqual(askedOf(opens("thread/start").at(-1)?.params?.config), AT_DOOR, "with no address given the turn");
      // That thread was given no server of Filament's: opened again after a restart, outside a turn, it is asked too.
      first.shutdown();
      second = new CodexBridge({ log: () => {}, stateFile });
      second.ownPlaces = PLACES;
      await second.compactOwn({ upstream, conversationId: "nobase", base: 0, keep: "", fork: true, record: () => 5 });
      assert.deepEqual(askedOf(opens("thread/resume").at(-1)?.params?.config), AT_DOOR, "opened again");
    });
  } finally {
    first.shutdown();
    /** @type {CodexBridge | null} */ (second)?.shutdown();
    await removeDirs(dir);
  }
});

// (fails before: yes — the review of 11-11: a config Filament's small reader of TOML could not read left every provider
// unasked, and nothing said so)
test("a Codex config that is there and cannot be read is said on the turn's record; one that is not there is not, nor one nobody could weigh", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-adds-codex-"));
  const broken = fakeCodex(dir, "broken", 'model_provider = "filament"\n\n[model_providers.filament\nbase_url = "http://localhost:20399/v1"\n');
  const gone = fakeCodex(dir, "gone", null);
  const bridge = new CodexBridge({ log: () => {} });
  const alone = new CodexBridge({ log: () => {} });
  bridge.ownPlaces = PLACES;
  /** @param {string[]} notes */
  const unread = (notes) => notes.filter((n) => n.includes("could not be read"));
  try {
    await withVars({ OPENAI_BASE_URL: undefined }, async () => {
      const out = await codexTurn(bridge, broken.upstream, "unread", null);
      assert.equal(out.stopReason, "end_turn");
      assert.equal(broken.opens("thread/start").at(-1)?.params?.config, undefined, "nothing is asked of anyone");
      assert.deepEqual(
        unread(out.notes),
        [`codex: its config (${broken.file}) could not be read (line 3: a table's name is not closed): Filament cannot tell whether a provider of it points at Filament's door, so none carries its ask to add nothing (x-filament-adds: none), and model calls that go there get Filament's additions again`],
        out.notes.join("\n"),
      );
      assert.deepEqual(unread((await codexTurn(bridge, gone.upstream, "gone", null)).notes), [], "no file: nothing to say");
      // Filament's address not known (a bridge by itself, a turn given none): nothing is weighed, and nothing said.
      assert.deepEqual(unread((await codexTurn(alone, broken.upstream, "alone", null)).notes), []);
    });
  } finally {
    bridge.shutdown();
    alone.shutdown();
    await removeDirs(dir);
  }
});

// (fails before: yes — the review of 11-11: a provider built into Codex, pointed at Filament's door by a variable or by
// a key at the top of its config, has no entry among its config's providers to ask through, and nothing said so)
test("a provider built into Codex pointed at Filament's door carries no ask, and the record says which setting points it there", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-adds-codex-"));
  const byVariable = fakeCodex(dir, "by-variable", null, { OPENAI_BASE_URL: "http://desk.lan:20500/v1" });
  const byKey = fakeCodex(dir, "by-key", 'openai_base_url = "http://localhost:20399/v1"\nmodel = "gpt-6-astra"\n');
  const elsewhere = fakeCodex(dir, "elsewhere", 'openai_base_url = "https://api.openai.com/v1"\n', { OPENAI_BASE_URL: "https://gateway.example.com/v1" });
  const bridge = new CodexBridge({ log: () => {} });
  bridge.ownPlaces = PLACES;
  /** @param {string[]} notes */
  const builtIn = (notes) => notes.filter((n) => n.includes("a provider built into Codex"));
  const REST = "is Filament's door, and Filament knows no key of a thread's config that gives a provider built into Codex a header: model calls that go there by it do not ask Filament to add nothing (x-filament-adds: none), and get Filament's additions again";
  try {
    await withVars({ OPENAI_BASE_URL: undefined }, async () => {
      const a = await codexTurn(bridge, byVariable.upstream, "a", null);
      assert.deepEqual(builtIn(a.notes), [`codex: OPENAI_BASE_URL in its environment ${REST}`], a.notes.join("\n"));
      assert.equal(byVariable.opens("thread/start").at(-1)?.params?.config, undefined, "no key Filament cannot stand behind is sent");
      const b = await codexTurn(bridge, byKey.upstream, "b", null);
      assert.deepEqual(builtIn(b.notes), [`codex: openai_base_url in its config (${byKey.file}) ${REST}`], b.notes.join("\n"));
      assert.equal(byKey.opens("thread/start").at(-1)?.params?.config, undefined);
      assert.deepEqual(builtIn((await codexTurn(bridge, elsewhere.upstream, "c", null)).notes), [], "pointed elsewhere: nothing to say");
    });
    // The variable as Filament's own environment has it, which Codex inherits unless its upstream takes it out.
    await withVars({ OPENAI_BASE_URL: "http://127.0.0.1:20399/v1" }, async () => {
      const inherits = fakeCodex(dir, "inherits", null);
      assert.equal(builtIn((await codexTurn(bridge, inherits.upstream, "d", null)).notes).length, 1, "inherited");
      const takenOut = fakeCodex(dir, "taken-out", null);
      takenOut.upstream.acp = /** @type {any} */ ({ ...takenOut.upstream.acp, envRemove: ["OPENAI_BASE_URL"] });
      assert.deepEqual(builtIn((await codexTurn(bridge, takenOut.upstream, "e", null)).notes), [], "taken out");
    });
  } finally {
    bridge.shutdown();
    await removeDirs(dir);
  }
});

// (fails before: yes — the review of 11-11: the bridges knew Filament's door by a turn's own address alone, so a name
// this machine is served as — what Settings › Connect writes where its page was opened by that name — was not Filament's)
test("the server tells its agents' bridges where Filament is reached: a name it is served as is its door to Claude Code and to Codex, and another site is not", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-adds-places-"));
  const command = fakeClaude(dir);
  /** A Claude Code upstream with an account's folder of its own, where its settings are written once the port is known. @param {string} id */
  const claude = (id) => {
    mkdirSync(join(dir, id));
    return { id, name: id, type: "acp", acp: { command, args: [], env: { FAKE_ACP_HEADERS: join(dir, `${id}.jsonl`), FAKE_ACP_CLAUDE: "1", CLAUDE_CONFIG_DIR: join(dir, id) }, envRemove: [CLAUDE_HEADERS_VAR, CLAUDE_BASE_VAR], modelSelection: "none", cwdDefault: dir, permissions: "allow-all", hints: false } };
  };
  const codex = fakeCodex(dir, "cx", "");
  const app = await startApp({
    configure: (cfg) => {
      cfg.server.allowedHosts = ["desk.lan"];
      cfg.upstreams = [claude("here"), claude("away"), { ...codex.upstream, acp: { ...codex.upstream.acp, envRemove: ["OPENAI_BASE_URL"] } }];
      cfg.routes = [
        { match: "here-*", upstream: "here" },
        { match: "away-*", upstream: "away" },
        { match: "codex/*", upstream: "cx", upstreamModel: "{1}", enabled: true },
      ];
    },
  });
  try {
    const at = `http://desk.lan:${app.port}`;
    writeFileSync(join(dir, "here", "settings.json"), JSON.stringify({ env: { [CLAUDE_BASE_VAR]: at } }));
    writeFileSync(join(dir, "away", "settings.json"), JSON.stringify({ env: { [CLAUDE_BASE_VAR]: `http://desk.example.com:${app.port}` } }));
    writeFileSync(codex.file, `[model_providers.filament]\nname = "filament"\nbase_url = "${at}/v1"\n\n[model_providers.away]\nname = "away"\nbase_url = "http://desk.example.com:${app.port}/v1"\n`);
    /** @param {string} model @param {string} sid */
    const turn = async (model, sid) => {
      const r = await app.post("/v1/messages", { model, max_tokens: 64, messages: [{ role: "user", content: "hi" }] }, { "x-session-id": sid });
      assert.equal(r.status, 200, await r.clone().text());
      await r.text();
    };
    await turn("here-1", "adds-here");
    assert.deepEqual(jsonLines(join(dir, "here.jsonl")), ["x-filament-adds: none"], "Claude Code, its account's settings naming this machine as Filament is served");
    await turn("away-1", "adds-away");
    assert.deepEqual(jsonLines(join(dir, "away.jsonl")), [null], "and another site at the same port");
    await turn("codex/gpt-6-astra", "adds-cx");
    assert.deepEqual(askedOf(codex.opens("thread/start").at(-1)?.params?.config), ["filament"], "Codex's provider at that name, no other");
  } finally {
    await app.stop();
    await removeDirs(dir);
  }
});
