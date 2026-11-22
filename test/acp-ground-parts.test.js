// @ts-check
// HarnessV3-ACP AC0's parts on their own: an agent's profile read from its `initialize` answer and said in the page's
// words (AC0-1), ACP's schema pinned from the SDK the agents carry (AC0-2), and a failure's kind (AC0-3). Through the
// app and a fake agent, in acp-ground.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore, authenticateMethod, readProfile, takesHttpMcp } from "../src/adapters/agents/acp/profile.js";
import { ACP_SCHEMA } from "../src/adapters/agents/acp/schema-pin.js";
import { missingFields, missingNote } from "../src/adapters/agents/acp/schema.js";
import { classifyFailure, overflowSaid } from "../src/adapters/agents/acp/failures.js";
import { supportsRows } from "../src/ui/lib/agent-profile.js";
import { confirmedOf } from "../src/core/catalogues.js";
import { versionFrom } from "../src/core/util.js";
import { planToolset } from "../src/adapters/agents/acp/toolset.js";
import { failureWords } from "../src/ui/components/requests-table.js";
import { pinOf, sdkFolder } from "../scripts/acp-schema.mjs";

// The answer claude-agent-acp 0.76.0 gives `initialize` (its dist/acp-agent.js), as far as the profile reads it.
const CLAUDE_INIT = {
  protocolVersion: 1,
  agentCapabilities: {
    _meta: { claudeCode: { promptQueueing: true }, authStatus: {} },
    promptCapabilities: { image: true, embeddedContext: true },
    mcpCapabilities: { http: true, sse: true },
    auth: { logout: {} },
    providers: {},
    loadSession: true,
    sessionCapabilities: { additionalDirectories: {}, close: {}, delete: {}, fork: {}, list: {}, resume: {}, subagents: {} },
  },
  agentInfo: { name: "@agentclientprotocol/claude-agent-acp", title: "Claude Agent", version: "0.76.0" },
  authMethods: [{ id: "claude-login" }, { id: "console-login" }],
  _meta: { steering: { supported: true } },
};
const LITTLE_INIT = { protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } };

describe("an agent's profile (AC0-1)", () => {
  // (fails before: yes — there was no profile: Filament read five of an agent's capabilities for its cheat sheet and
  // kept none, and never read the session methods, live steering or prompt queueing)
  test("is what its initialize answer declares: Claude's adapter, an agent that declares little, and none", () => {
    assert.deepEqual(readProfile(CLAUDE_INIT), {
      protocol: 1,
      agent: { name: "@agentclientprotocol/claude-agent-acp", title: "Claude Agent", version: "0.76.0" },
      prompt: { image: true, audio: false, embeddedContext: true },
      mcp: { http: true, sse: true, declared: true },
      sessions: { load: true, list: true, resume: true, fork: true, close: true, delete: true, additionalDirectories: true, subagents: true },
      steering: true,
      promptSteers: false,
      googleQuota: false,
      cancelKeepsWork: false,
      cachedInInput: false,
      promptQueueing: true,
      rawMessages: true,
      systemPrompt: true,
      systemPromptAt: "claudeCode",
      reportsCompaction: true,
      thinkingDisplay: false,
      compactWindow: false,
      sessionEnv: false,
      account: true,
      logout: true,
      auth: ["claude-login", "console-login"],
      signIns: [],
      ways: [
        { kind: "agent", id: "claude-login", name: "claude-login", description: "" },
        { kind: "agent", id: "console-login", name: "console-login", description: "" },
      ],
    });
    const little = readProfile(LITTLE_INIT);
    assert.deepEqual(
      [little.sessions, little.steering, little.promptQueueing, little.agent, little.prompt, little.systemPrompt],
      [
        { load: true, list: false, resume: false, fork: false, close: false, delete: false, additionalDirectories: false, subagents: false },
        false,
        false,
        null,
        { image: true, audio: false, embeddedContext: false },
        false,
      ],
    );
    assert.deepEqual([readProfile(null).protocol, readProfile(null).sessions.close, readProfile(null).auth], [null, false, []], "no answer declares nothing");
    // (fails before: yes — the bug round of 10-23: a coding agent that takes no MCP server over HTTP was told it had
    // Filament's agent and team tools) Whether it takes Filament's MCP server, as toolset.js decides it.
    assert.equal(takesHttpMcp(readProfile(CLAUDE_INIT)), true);
    assert.equal(takesHttpMcp(readProfile({ agentCapabilities: { mcpCapabilities: { http: false, sse: true } } })), false, "it says it takes none over HTTP");
    assert.equal(takesHttpMcp(readProfile({ agentCapabilities: {} })), true, "one that declares no MCP capabilities predates the field, and takes it");
    assert.equal(takesHttpMcp(null), true, "not started yet: not known, and taken");
    assert.equal(takesHttpMcp(/** @type {any} */ ({ mcp: { http: false, sse: false } })), true, "a profile kept before the field: not known");
    // (fails before: no — a guard the mutation pass asked for: nothing checked that a method set to false is not
    // declared)
    const unset = readProfile({ agentCapabilities: { sessionCapabilities: { close: null, fork: false } } }).sessions;
    assert.deepEqual([unset.close, unset.fork], [false, false], "a method set to null or false is not declared");
    // (fails before: yes — the trial of 11-11: Antigravity 1.4.5's system channel, under its own name, was read as none)
    const agy = readProfile({ agentCapabilities: { _meta: { antigravity: { tier: true, systemPrompt: { append: true } } } } });
    assert.deepEqual([agy.systemPrompt, agy.systemPromptAt, agy.rawMessages, agy.reportsCompaction], [true, "antigravity", false, false]);
    assert.deepEqual([readProfile({ agentCapabilities: { _meta: { antigravity: { tier: true } } } }).systemPrompt, readProfile(null).systemPromptAt], [false, null]);
  });

  test("its terminal sign-ins (AC3-7): the ways a client runs in a terminal, with their arguments and variables; `authenticate` takes another", () => {
    const init = {
      ...CLAUDE_INIT,
      authMethods: [
        { id: "claude-ai-login", name: "Claude Subscription", description: "Use Claude subscription ", type: "terminal", args: ["--cli", "auth", "login", "--claudeai"], env: { A: "1", B: 2 } },
        { id: "console-login", type: "terminal", args: ["--cli", "auth", "login", "--console", 3] },
        { id: "gateway", name: "Gateway", type: "env_var" },
      ],
    };
    assert.deepEqual(readProfile(init).signIns, [
      { id: "claude-ai-login", name: "Claude Subscription", description: "Use Claude subscription", args: ["--cli", "auth", "login", "--claudeai"], env: { A: "1" } },
      { id: "console-login", name: "console-login", description: "", args: ["--cli", "auth", "login", "--console"], env: {} },
    ]);
    assert.equal(authenticateMethod(init), "gateway", "a terminal sign-in is never passed to `authenticate`");
    assert.equal(authenticateMethod({ authMethods: init.authMethods.slice(0, 2) }), null);
    assert.equal(authenticateMethod(CLAUDE_INIT), "claude-login");
  });

  // (fails before: yes — the review of 11-10: only an agent's terminal sign-ins were read, so an agent of ACP's registry
  // that names a way it carries out itself, or a key it reads from a variable, could not be signed in from Filament)
  test("its ways to sign in, each of its kind: a terminal's — ACP's, or Zed's older `_meta[\"terminal-auth\"]` —, one the agent carries out itself, a key it reads from one variable", () => {
    const init = {
      authMethods: [
        { id: "claude-ai-login", name: "Claude Subscription", type: "terminal", args: ["--cli"], _meta: { "terminal-auth": { command: "node", args: ["x"] } } },
        { id: "oauth-personal", name: "Log in with Google", description: "Log in with your Google account" },
        { id: "gemini-api-key", name: "Gemini API key", description: "Use an API key with Gemini Developer API", _meta: { "api-key": { provider: "google" } } },
        { id: "browser", name: "Browser", type: "agent" },
        { id: "old-login", name: "Old login", description: "Run it in a terminal ", _meta: { "terminal-auth": { command: "C:\\agents\\old.exe", args: ["login", 2], env: { A: "1", B: 2 }, label: "Old Login" } } },
        { type: "env_var", id: "api-key", name: "API key", description: "Your key", link: "https://example.test/keys", vars: [{ name: "FAKE_API_KEY", label: "Your Fake key" }, { name: "FAKE_BASE_URL", optional: true }] },
        { type: "env_var", id: "plain", name: "Plain key", vars: [{ name: "PLAIN_TOKEN" }] },
        { type: "env_var", id: "two", name: "Two", vars: [{ name: "A_KEY" }, { name: "B_KEY" }] },
        { type: "env_var", id: "none", name: "None", vars: [] },
        { type: "env_var", id: "bad", name: "Bad", vars: [{ name: "not a name" }] },
        { type: "_custom", id: "custom", name: "Custom" },
        { name: "No id" },
      ],
    };
    assert.deepEqual(readProfile(init).ways, [
      { kind: "terminal", id: "claude-ai-login", name: "Claude Subscription", description: "", args: ["--cli"], env: {} },
      { kind: "agent", id: "oauth-personal", name: "Log in with Google", description: "Log in with your Google account" },
      { kind: "agent", id: "gemini-api-key", name: "Gemini API key", description: "Use an API key with Gemini Developer API" },
      { kind: "agent", id: "browser", name: "Browser", description: "" },
      { kind: "terminal", id: "old-login", name: "Old login", description: "Run it in a terminal", command: "C:\\agents\\old.exe", args: ["login"], env: { A: "1" } },
      { kind: "key", id: "api-key", name: "API key", description: "Your key", variable: "FAKE_API_KEY", label: "Your Fake key" },
      { kind: "key", id: "plain", name: "Plain key", description: "", variable: "PLAIN_TOKEN", label: "Plain key" },
    ]);
    assert.deepEqual(readProfile(init).signIns.map((w) => w.id), ["claude-ai-login"], "its terminal sign-ins as before");
    assert.deepEqual(readProfile(null).ways, [], "no answer names none");
  });

  // (fails before: yes — the page had no words for a profile)
  test("reads on the page as what each capability means in Filament, for the agent that has it and the one that lacks it", () => {
    const rows = supportsRows(readProfile(CLAUDE_INIT));
    assert.deepEqual(rows.map((r) => [r.key, r.has]), [
      ["reopen", true],
      ["list", true],
      ["close", true],
      ["steering", true],
      ["queueing", true],
      ["raw", true],
      ["account", true],
      ["compaction", true],
      ["fork", true],
      ["delete", true],
      ["folders", true],
      ["subagents", true],
      ["images", true],
      ["audio", false],
      ["files", true],
      ["tools", true],
    ]);
    const little = supportsRows(readProfile(LITTLE_INIT));
    assert.deepEqual(little.filter((r) => r.has).map((r) => r.key), ["reopen", "images"]);
    const means = (/** @type {typeof rows} */ rs, /** @type {string} */ key) => rs.find((r) => r.key === key)?.means;
    assert.match(String(means(rows, "reopen")), /without sending its history again/);
    assert.match(String(means(little, "reopen")), /sending its history again/);
    assert.doesNotMatch(String(means(little, "reopen")), /without/);
    assert.match(String(means(rows, "close")), /the agent closes it at once/);
    assert.match(String(means(little, "close")), /stays open in the agent until its process ends/);
    assert.match(String(means(rows, "folders")), /Filament does not hand it any yet/, "a capability Filament does not use yet says so");
    assert.match(String(means(rows, "compaction")), /listed in the session's compactions with Undo/);
    assert.match(String(means(little, "compaction")), /a fresh session starts from it/);
    assert.match(String(means(rows, "fork")), /keeps the session from before its own compaction, for Undo/);
    assert.match(String(means(little, "fork")), /Undo of its own compaction starts a fresh session/);
    // (fails before: yes — the page said Filament sends no message mid-turn, after steering was built: AC3-1)
    assert.match(String(means(rows, "steering")), /goes into its running turn/);
    assert.match(String(means(little, "steering")), /waits for the turn's end/);
    assert.match(String(means(rows, "account")), /Account instrument and Home → Health/);
    assert.match(String(means(little, "account")), /doesn't say which account/);
    // (fails before: yes — the review of 11-10: an agent with no HTTP MCP is reached through the relay)
    assert.match(String(means(little, "tools")), /reach it over stdio, through Filament's relay/);
    const none = supportsRows(readProfile(null));
    assert.match(String(means(none, "reopen")), /a new agent session starts, seeded with the earlier messages/);
    assert.ok(rows.every((r) => r.word && r.means), "every row has its word and its meaning");
  });

  // (fails before: no — a guard the mutation pass asked for: Claude's adapter declares all of it and the little agent
  // almost none, so a chip that read another capability than its own went unnoticed)
  test("beside what an agent declares, what a drive saw: Cursor's CLI keeps a turn it cancels, so a message goes in at its next step (AC-D6)", () => {
    /** @type {[any, boolean][]} */
    const cases = [
      [{ type: "acp", acp: { command: "agent" } }, true],
      [{ type: "acp", acp: { command: "C:\\Users\\me\\AppData\\Local\\cursor-agent\\cursor-agent.cmd" } }, true],
      [{ acp: { command: "/usr/local/bin/cursor-agent" } }, true],
      [{ type: "acp", acp: { command: "claude-agent-acp" } }, false],
      [{ type: "acp", acp: { command: "gemini" } }, false],
      [{ type: "cursor-sdk" }, false],
      [{ type: "codex", acp: { command: "codex" } }, false],
    ];
    assert.deepEqual(cases.map(([u]) => confirmedOf(u).cancelKeepsWork), cases.map(([, keeps]) => keeps), "Cursor's CLI over ACP, by its command; not Cursor's SDK route");
    const cursor = readProfile(LITTLE_INIT, confirmedOf({ acp: { command: "agent" } }));
    assert.deepEqual([cursor.steering, cursor.cancelKeepsWork], [false, true], "what it declares stays its own");
    const at = supportsRows(cursor).find((r) => r.key === "steering");
    assert.equal(at?.has, true);
    assert.match(String(at?.means), /^It takes a message at its next step: once its current call is done, Filament stops the turn there/);
    const both = supportsRows(readProfile(CLAUDE_INIT, { cancelKeepsWork: true })).find((r) => r.key === "steering");
    assert.match(String(both?.means), /goes into its running turn/, "live steering first, where the agent declares it");
  });

  // (fails before: yes — read live on agy 1.5.14: a prompt sent while its turn runs takes the turn over, which nothing
  // said, so what was typed while it worked waited for the turn's end)
  test("Antigravity's agy takes a prompt sent while its turn runs, from 1.5.0, as a drive saw: its card says it takes a message mid-turn", () => {
    const agy = { id: "antigravity-acp", acp: { command: "agy" } };
    const init = (/** @type {string} */ version) => ({ agentInfo: { name: "Antigravity ACP Server", version }, agentCapabilities: { _meta: { antigravity: { tier: true, systemPrompt: { append: true } } } } });
    assert.equal(confirmedOf(agy).promptSteersFrom, "1.5.0");
    assert.equal(confirmedOf({ acp: { command: "agy_acp_server" } }).promptSteersFrom, null, "the older server it ran until its card's Update: never seen taking a turn over");
    assert.deepEqual(["1.5.14", "1.5.0", "1.4.5", ""].map((v) => readProfile(init(v), confirmedOf(agy)).promptSteers), [true, true, false, false]);
    assert.equal(readProfile(init("1.5.14")).promptSteers, false, "nothing seen of it: not taken");
    assert.equal(readProfile(init("1.5.14"), confirmedOf({ acp: { command: "gemini" } })).promptSteers, false);
    // Its plan's quota is Google's to read with its sign-in from the same version; never the older server's.
    assert.deepEqual(["1.5.14", "1.4.5"].map((v) => readProfile(init(v), confirmedOf(agy)).googleQuota), [true, false]);
    assert.equal(readProfile(init("1.5.14"), confirmedOf({ acp: { command: "agy_acp_server" } })).googleQuota, false);
    const at = supportsRows(readProfile(init("1.5.14"), confirmedOf(agy))).find((r) => r.key === "steering");
    assert.deepEqual([at?.has, at?.means], [true, "It takes a message in the middle of a turn: what is typed while it works goes into its running turn."]);
  });

  test("Claude Code is asked to show its thinking, summarized, from the adapter version seen taking the option (AC-R2)", () => {
    const claude = { id: "claude-code", acp: { command: "claude-agent-acp" } };
    /** The Claude options a session this turn opens is given. @param {any} init @param {any} upstream @param {any} [acp] */
    const meta = (init, upstream, acp = {}) =>
      planToolset({ acp, upstream, proc: { initResult: init }, profile: readProfile(init, confirmedOf(upstream)), turn: { bridge: "prompts" }, fullBridge: false, cwd: "/w", mcpBase: null, memoryWanted: false, existingToken: null, notes: [] }).sessionMeta._meta?.claudeCode;
    assert.equal(readProfile(CLAUDE_INIT, confirmedOf(claude)).thinkingDisplay, true);
    assert.deepEqual(meta(CLAUDE_INIT, claude)?.options, { extraArgs: { "thinking-display": "summarized" } });
    assert.ok(meta(CLAUDE_INIT, claude)?.emitRawSDKMessages, "beside its raw messages");
    assert.equal(meta(CLAUDE_INIT, claude, { thoughts: "hide" })?.options, undefined, "not where the upstream hides its thoughts");
    const older = { ...CLAUDE_INIT, agentInfo: { ...CLAUDE_INIT.agentInfo, version: "0.75.9" } };
    assert.equal(meta(older, claude)?.options, undefined, "nor of an adapter older than the one seen taking it: its Claude Code may refuse the option");
    assert.equal(meta(CLAUDE_INIT, { id: "mine", acp: { command: "my-claude-wrapper" } })?.options, undefined, "nor of a program the catalogue doesn't know");
    assert.equal(meta(LITTLE_INIT, claude), undefined, "and an agent that isn't Claude's adapter is given no Claude options at all");
    assert.deepEqual(
      ["0.76.0", "0.76.1", "0.100.0", "1.0", "0.76.0-beta.1", "0.75.9", "", null].map((v) => versionFrom(v, "0.76.0")),
      [true, true, true, true, false, false, false, false],
    );
  });

  test("each chip reads its own capability: an agent that declares one thing has that one chip", () => {
    /** @type {[string, any, string[]?][]} */
    const one = [
      ["reopen", { agentCapabilities: { sessionCapabilities: { resume: {} } } }],
      ["list", { agentCapabilities: { sessionCapabilities: { list: {} } } }],
      ["close", { agentCapabilities: { sessionCapabilities: { close: {} } } }],
      ["steering", { _meta: { steering: { supported: true } } }],
      ["queueing", { agentCapabilities: { _meta: { claudeCode: { promptQueueing: true } } } }, ["raw", "compaction"]],
      ["raw", { agentCapabilities: { _meta: { claudeCode: {} } } }, ["compaction"]],
      ["account", { agentCapabilities: { _meta: { authStatus: {} } } }],
      ["fork", { agentCapabilities: { sessionCapabilities: { fork: {} } } }],
      ["delete", { agentCapabilities: { sessionCapabilities: { delete: {} } } }],
      ["folders", { agentCapabilities: { sessionCapabilities: { additionalDirectories: {} } } }],
      ["subagents", { agentCapabilities: { sessionCapabilities: { subagents: {} } } }],
      ["images", { agentCapabilities: { promptCapabilities: { image: true } } }],
      ["audio", { agentCapabilities: { promptCapabilities: { audio: true } } }],
      ["files", { agentCapabilities: { promptCapabilities: { embeddedContext: true } } }],
      ["tools", { agentCapabilities: { mcpCapabilities: { http: true } } }],
    ];
    // Declaring prompt queueing declares Claude's adapter, whose raw messages and its compaction's report come with it.
    for (const [key, init, also = []] of one) assert.deepEqual(supportsRows(readProfile(init)).filter((r) => r.has).map((r) => r.key), [key, ...also], key);
    const sseOnly = supportsRows(readProfile({ agentCapabilities: { mcpCapabilities: { sse: true } } }));
    assert.deepEqual(sseOnly.filter((r) => r.has).map((r) => r.key), [], "Filament's tools reach an agent over HTTP only");
  });

  // (fails before: no — a guard the mutation pass asked for: an upstream still configured but no longer an agent, the
  // log's word on the letting go, and a config save with nothing to let go of were never looked at)
  test("as kept, goes with an upstream removed or no longer an agent, and the log says so; with nothing to let go of, nothing is written or said", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-acp-profiles-"));
    try {
      const file = join(dir, "acp-profiles.json");
      /** @type {string[]} */
      const said = [];
      const store = new ProfileStore({ file, log: (level, msg) => said.push(`${level} ${msg}`) });
      for (const id of ["kept", "removed", "now-an-api"]) store.put(id, readProfile(LITTLE_INIT));
      store.retain([{ id: "kept", type: "acp" }, { id: "now-an-api", type: "openai" }]);
      assert.deepEqual([Object.keys(store.all()), Object.keys(JSON.parse(readFileSync(file, "utf8")).profiles)], [["kept"], ["kept"]]);
      assert.deepEqual(said, ["info [acp] let go of what removed, now-an-api declared: no longer configured"]);
      rmSync(file);
      store.retain([{ id: "kept", type: "acp" }]);
      assert.deepEqual([existsSync(file), said.length], [false, 1], "nothing to let go of: nothing written, nothing said");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ACP's schema, pinned (AC0-2)", () => {
  // (fails before: yes — there was no pin to read an update against)
  test("a field is missing when it is absent, or of a type the schema does not allow; a kind outside the schema has none", () => {
    assert.deepEqual(missingFields({ sessionUpdate: "usage_update", used: "12", size: 100 }), ["used"]);
    assert.deepEqual(missingFields({ sessionUpdate: "usage_update", used: 12, size: 100 }), []);
    assert.deepEqual(missingFields({ sessionUpdate: "usage_update", used: 12 }), ["size"]);
    assert.deepEqual(missingFields({ sessionUpdate: "plan", entries: {} }), ["entries"], "an object is not an array");
    assert.deepEqual(missingFields({ sessionUpdate: "plan", entries: [] }), []);
    assert.deepEqual(missingFields({ sessionUpdate: "tool_call", toolCallId: "t", title: null }), ["title"], "null is not a string");
    // (fails before: no — a guard the mutation pass asked for: null was only ever checked where a string is required)
    assert.deepEqual(missingFields({ sessionUpdate: "agent_message_chunk", content: null }), ["content"], "null is not an object");
    assert.deepEqual(missingFields({ sessionUpdate: "session_info_update" }), [], "a kind that requires nothing");
    assert.deepEqual(missingFields({ sessionUpdate: "something_new" }), []);
    assert.deepEqual(missingFields({ sessionUpdate: "x", a: 1 }, { sdk: "0", updates: { x: { a: "string|number" } }, unstable: [], agentCapabilities: [], sessionCapabilities: [] }), [], "one of the types a union allows");
    // (fails before: no — a guard the mutation pass asked for: no field of the pin is typed "any" today, so neither of
    // the check's clauses for one ever ran)
    const anyPin = { sdk: "0", updates: { x: { a: "any" } }, unstable: [], agentCapabilities: [], sessionCapabilities: [] };
    assert.deepEqual([missingFields({ sessionUpdate: "x" }, anyPin), missingFields({ sessionUpdate: "x", a: [1] }, anyPin)], [["a"], []], "a field of any type: missing when absent, and any value fits");
  });

  // (fails before: no — a guard the mutation pass asked for: no note named more than one field)
  test("a note names the missing fields in words", () => {
    const pin = { sdk: "9.9.9", updates: {}, unstable: [], agentCapabilities: [], sessionCapabilities: [] };
    assert.equal(missingNote("usage_update", ["used", "size"], pin), "acp: the agent sent usage_update without used and size, which ACP schema 9.9.9 requires; read as far as it goes");
    assert.match(missingNote("x", ["a", "b", "c"], pin), / without a, b and c, /);
  });

  // (fails before: yes — there was no pin)
  test("the pin is read from the schema as written: a variant's fields through allOf and $ref, their types, and the kinds it marks unstable", () => {
    const schema = {
      $defs: {
        Id: { type: "string" },
        Block: { type: "object", properties: { text: { type: "string" } } },
        Chunk: { type: "object", properties: { content: { allOf: [{ $ref: "#/$defs/Block" }] }, n: { type: ["integer", "null"] } }, required: ["content", "n"] },
        Thing: { properties: { thingId: { description: "its id", allOf: [{ $ref: "#/$defs/Id" }] }, either: { anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }] } }, required: ["thingId", "either"] },
        SessionUpdate: {
          oneOf: [
            { type: "object", properties: { sessionUpdate: { const: "chunk" } }, required: ["sessionUpdate"], allOf: [{ $ref: "#/$defs/Chunk" }] },
            { description: "**UNSTABLE**\n\nNot part of the spec yet.", type: "object", properties: { sessionUpdate: { const: "thing" } }, required: ["sessionUpdate"], allOf: [{ $ref: "#/$defs/Thing" }] },
          ],
        },
        AgentCapabilities: { properties: { loadSession: {}, _meta: {} } },
        SessionCapabilities: { properties: { close: {}, _meta: {} } },
      },
    };
    assert.deepEqual(pinOf(schema, "9.9.9"), {
      sdk: "9.9.9",
      updates: { chunk: { content: "object", n: "number" }, thing: { thingId: "string", either: "string|number" } },
      unstable: ["thing"],
      agentCapabilities: ["loadSession"],
      sessionCapabilities: ["close"],
    });
  });

  // (fails before: yes — there was no pin to go stale)
  test("the pin is the schema this machine's agents carry: one that brings a newer schema asks for the pin to be regenerated", (t) => {
    /** @type {string | null} */
    let dir = null;
    try {
      dir = sdkFolder([]);
    } catch {}
    const file = dir ? join(dir, "schema", "schema.json") : "";
    if (!dir || !existsSync(file)) return void t.skip("no claude-agent-acp on this machine: nothing to compare the pin with");
    const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
    assert.deepEqual(
      pinOf(JSON.parse(readFileSync(file, "utf8")), version),
      ACP_SCHEMA,
      `the pin is ACP schema ${ACP_SCHEMA.sdk}; this machine's claude-agent-acp carries ${version}: run npm run acp-schema`,
    );
  });
});

describe("a failure's kind (AC0-3)", () => {
  // (fails before: yes — every failure was one kind: a 502 that cooled the agent down)
  test("is read from the Agent SDK's error kind, then the JSON-RPC code, then the words; a too-long prompt, or an account without credit, first of all", () => {
    const rpc = (/** @type {number} */ code, /** @type {any} */ data, message = "Internal error") => Object.assign(new Error(message), { code, data });
    /** @type {[Error, string][]} */
    const cases = [
      [rpc(-32603, { errorKind: "authentication_failed" }), "auth"],
      [rpc(-32603, { errorKind: "billing_error" }), "auth"],
      [rpc(-32000, undefined, "Authentication required"), "auth"],
      [Object.assign(new Error("Claude is not logged in on this machine. Log in once with its own CLI."), { code: "ACP_AUTH" }), "auth"],
      [rpc(-32603, { details: "Credit balance is too low" }), "auth"],
      [rpc(-32603, { errorKind: "invalid_request", details: "Your credit balance is too low to access the Anthropic API" }), "auth"],
      [rpc(-32603, { errorKind: "rate_limit" }), "limit"],
      [rpc(-32603, { errorKind: "overloaded", details: "Overloaded" }), "limit"],
      [new Error("You've hit your usage limit · resets 3pm"), "limit"],
      [rpc(-32603, { errorKind: "invalid_request", details: "the request was refused as sent" }), "refusal"],
      [rpc(-32603, { errorKind: "model_not_found" }), "refusal"],
      [rpc(-32602, undefined, "Invalid params"), "refusal"],
      [rpc(-32603, { errorKind: "invalid_request", details: "Prompt is too long: 212000 tokens > 200000 maximum" }), "overflow"],
      [rpc(-32603, { details: "Prompt is too long: 212000 tokens > 200000 maximum" }), "overflow"],
      [rpc(-32603, { errorKind: "max_output_tokens" }), "overflow"],
      [new Error("ACP session/prompt timed out after 5000 ms"), "timeout"],
      [rpc(-32603, { errorKind: "transport_lost" }), "transport"],
      [rpc(-32603, { errorKind: "server_error", details: "API Error: 500" }), "transport"],
      // (fails before: no — guards the mutation pass asked for: the kind an agent names wins over words that say
      // another; ACP's login code needs no words; refusal has words of its own)
      [rpc(-32603, { errorKind: "transport_lost", details: "the connection timed out" }), "transport"],
      [rpc(-32000, undefined, "Login required"), "auth"],
      [new Error("Invalid request: the content filter blocked this prompt"), "refusal"],
      [new Error("agent process exited (code 3)"), "transport"],
    ];
    for (const [e, kind] of cases) assert.equal(classifyFailure(e).kind, kind, `${e.message} ${JSON.stringify(/** @type {any} */ (e).data || {})}`);
  });

  // (fails before: yes — HarnessV4_Tasks B5: nothing read what an overflow says of the agent's context)
  test("an overflow's own numbers: the most the agent's context takes and what it counted, each where it says it", () => {
    const rpc = (/** @type {string} */ details) => Object.assign(new Error("Internal error"), { code: -32603, data: { details } });
    assert.deepEqual(overflowSaid(rpc("Prompt is too long: 212000 tokens > 200000 maximum")), { max: 200000, counted: 212000 });
    assert.deepEqual(overflowSaid(new Error("Internal error: Prompt is too long: 212,345 tokens > 200,000 maximum")), { max: 200000, counted: 212345 });
    assert.deepEqual(overflowSaid(new Error("This model's maximum context length is 128000 tokens. However, you requested 150000 tokens (149000 in the messages).")), { max: 128000, counted: 150000 });
    assert.deepEqual(overflowSaid(new Error("the context window is 1_000_000 tokens")), { max: 1000000, counted: null });
    assert.deepEqual(overflowSaid(rpc("Prompt is too long")), { max: null, counted: null });
    assert.deepEqual(overflowSaid(null), { max: null, counted: null });
  });

  // (fails before: yes — every failure cooled the agent down, and none told the client what to do)
  test("says whether to try again as sent, and whether the agent cools down", () => {
    const rpc = (/** @type {any} */ data) => Object.assign(new Error("Internal error"), { code: -32603, data });
    assert.deepEqual(classifyFailure(rpc({ errorKind: "invalid_request" })), { kind: "refusal", retryable: false, cools: false });
    assert.deepEqual(classifyFailure(rpc({ details: "Prompt is too long" })), { kind: "overflow", retryable: false, cools: false });
    assert.deepEqual(classifyFailure(rpc({ errorKind: "rate_limit" })), { kind: "limit", retryable: true, cools: true });
    assert.deepEqual(classifyFailure(rpc({ errorKind: "authentication_failed" })), { kind: "auth", retryable: false, cools: true });
    assert.deepEqual(classifyFailure(new Error("ACP session/prompt timed out after 5000 ms")), { kind: "timeout", retryable: true, cools: true });
    assert.deepEqual(classifyFailure(new Error("agent process exited (code 3)")), { kind: "transport", retryable: true, cools: true });
  });

  // (fails before: yes — a failed row said only its status)
  test("is said on the request's row, with what it means for the agent's health", () => {
    assert.equal(failureWords(null), null);
    assert.equal(failureWords({}), null);
    // (fails before: no — a guard the mutation pass asked for: no record named a kind the pill has no words for)
    assert.equal(failureWords({ kind: "bogus" }), null, "a kind without words adds nothing to the pill");
    const refusal = failureWords({ kind: "refusal", retryable: false });
    assert.equal(refusal?.word, "refusal");
    assert.match(String(refusal?.title), /refused the request as sent/);
    assert.match(String(refusal?.title), /No cooldown/);
    assert.match(String(failureWords({ kind: "limit", retryable: true })?.title), /cools down/);
    for (const kind of ["auth", "limit", "refusal", "overflow", "timeout", "transport"]) assert.equal(failureWords({ kind })?.word, kind);
  });
});
