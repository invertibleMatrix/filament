// @ts-check
// HarnessV4_SpacesPlugins_Plan B3, PL-D3: a plugin's hooks, written for Claude Code, run in Filament's own loop once
// switched on where the plugin is on. Its command hooks on Claude's four events join the chat's hooks (app/plugins.js
// `into`), their paths and values filled; each reads Claude's JSON and is read as Claude reads it (core/plugin-hooks.js):
// its matcher picks a tool by either name, exit 2 blocks with stderr as the reason, `updatedInput` rewrites a call in
// Claude's fields, a Stop block sends the turn back, a PostToolUse block's reason goes to the model beside the result;
// a hook that fails otherwise, cannot start or does not finish blocks nothing. It runs with its plugin's environment.
// (fails before: yes — a plugin's hooks never ran: the switch was kept, and nothing read it)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeCall, claudeMatches, claudeNames, claudeStdin, claudeVerdict, filamentArgs } from "../src/core/plugin-hooks.js";
import { hooksFor, runHook } from "../src/app/agent/hooks.js";
import { hookProblem } from "../src/services/session-settings.js";
import { createPlugins } from "../src/app/plugins.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/claude-hook.mjs", import.meta.url));
/** A path as a plugin's hook command names it, for the bash it runs in. @param {string} p */
const slashed = (p) => (process.platform === "win32" ? p.replace(/\\/g, "/") : p);
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-plugin-hooks-${tag}-`));
  made.push(d);
  return d;
};
/** @param {string} path @param {unknown} body */
const put = (path, body) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body, null, 2));
};
/** @param {string} file */
const linesOf = (file) => readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));

/**
 * A plugin, "guard": the Claude hook of the fixtures on PreToolUse for Write and Edit (a value it needs on its command
 * line), PostToolUse for Read and Stop, a command on UserPromptSubmit; and a hook Filament does not run — a prompt hook.
 * @param {string} dir
 */
function guardAt(dir) {
  put(join(dir, ".claude-plugin", "plugin.json"), { name: "guard", version: "1.0.0", description: "Guards writes", userConfig: { flag: { type: "string", title: "Flag", required: true } } });
  copyFileSync(FIXTURE, join(dir, "hook.mjs"));
  const run = 'node "${CLAUDE_PLUGIN_ROOT}/hook.mjs"';
  put(join(dir, "hooks", "hooks.json"), {
    hooks: {
      PreToolUse: [{ matcher: "Write|Edit", hooks: [{ type: "command", command: `${run} --flag=\${user_config.flag}`, timeout: 20 }] }],
      PostToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: run }] }],
      Stop: [{ hooks: [{ type: "command", command: run }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo later" }] }],
      SessionStart: [{ hooks: [{ type: "prompt", prompt: "Say hi" }] }],
    },
  });
}

describe("Claude's dialect (core)", () => {
  test("a matcher picks a call by Filament's name or Claude's — edit is Edit and MultiEdit, a plugin's own server's tool its Claude name too", () => {
    const aliases = { "guard-notes": "plugin_guard_notes" };
    assert.deepEqual(claudeNames("bash"), ["bash", "Bash"]);
    assert.deepEqual(claudeNames("edit"), ["edit", "Edit", "MultiEdit"]);
    assert.deepEqual(claudeNames("mcp__guard-notes__add", aliases), ["mcp__guard-notes__add", "mcp__plugin_guard_notes__add"]);
    assert.deepEqual(claudeNames("mcp__mine__add", aliases), ["mcp__mine__add"]);
    assert.equal(claudeMatches("", claudeNames("read")), true);
    assert.equal(claudeMatches("*", claudeNames("read")), true);
    assert.equal(claudeMatches("Write|Edit", claudeNames("edit")), true);
    assert.equal(claudeMatches("Edit", claudeNames("write")), false);
    assert.equal(claudeMatches("Bash", claudeNames("bash_background")), true);
    assert.equal(claudeMatches("Ba", claudeNames("bash")), false, "a name matches whole");
    assert.equal(claudeMatches("mcp__plugin_guard_notes__.*", claudeNames("mcp__guard-notes__add", aliases)), true);
    assert.equal(claudeMatches("Notebook.*", claudeNames("read")), false);
    assert.equal(claudeMatches("(", ["("]), false, "a matcher that is no expression matches none");
  });

  test("a call in Claude's fields and back", () => {
    /** @type {[string, any, { name: string, input: any }][]} */
    const cases = [
      ["read", { path: "a.txt", offset: 3, limit: 10 }, { name: "Read", input: { file_path: "a.txt", offset: 3, limit: 10 } }],
      ["write", { path: "a.txt", content: "x" }, { name: "Write", input: { file_path: "a.txt", content: "x" } }],
      ["edit", { path: "a.txt", edits: [{ oldText: "x", newText: "y" }] }, { name: "Edit", input: { file_path: "a.txt", old_string: "x", new_string: "y" } }],
      ["edit", { path: "a.txt", edits: [{ oldText: "x", newText: "y", replaceAll: true }, { oldText: "p", newText: "q" }] }, { name: "MultiEdit", input: { file_path: "a.txt", edits: [{ old_string: "x", new_string: "y", replace_all: true }, { old_string: "p", new_string: "q" }] } }],
      ["bash", { command: "ls", timeout: 30 }, { name: "Bash", input: { command: "ls", timeout: 30000 } }],
      ["bash_background", { command: "npm run dev" }, { name: "Bash", input: { command: "npm run dev", run_in_background: true } }],
      ["grep", { pattern: "a", output: "files", ignoreCase: true, context: 2, limit: 5 }, { name: "Grep", input: { pattern: "a", output_mode: "files_with_matches", "-C": 2, "-i": true, head_limit: 5 } }],
      ["glob", { pattern: "*.md" }, { name: "Glob", input: { pattern: "*.md" } }],
      ["mcp__s__t", { a: 1 }, { name: "mcp__s__t", input: { a: 1 } }],
    ];
    for (const [tool, input, claude] of cases) {
      assert.deepEqual(claudeCall(tool, input), claude, tool);
      assert.deepEqual(filamentArgs(tool, claude.input), input, `${tool} back`);
    }
    assert.equal(claudeCall("grep", { pattern: "a.b(", literal: true }).input.pattern, "a\\.b\\(", "a literal search, as an expression");
  });

  test("what the hook reads on stdin, at each moment", () => {
    const head = { session_id: "c1", transcript_path: "", cwd: "/w", permission_mode: "default" };
    assert.deepEqual(claudeStdin({ event: "pre-tool", tool: "write", input: { path: "a", content: "x" }, session: "c1", cwd: "/w" }), { ...head, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "a", content: "x" } });
    assert.deepEqual(claudeStdin({ event: "post-tool", tool: "read", input: { path: "a" }, result: "text", session: "c1", cwd: "/w" }), { ...head, hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "a" }, tool_response: "text" });
    assert.deepEqual(claudeStdin({ event: "turn-end", session: "c1", cwd: "/w" }), { ...head, hook_event_name: "Stop", stop_hook_active: false });
    assert.deepEqual(claudeStdin({ event: "session-start", session: "c1", cwd: "/w" }), { ...head, hook_event_name: "SessionStart", source: "startup" });
    // (fails before: yes — Filament had no moment for Claude's UserPromptSubmit, PreCompact or SubagentStop, 10-27)
    assert.deepEqual(claudeStdin({ event: "prompt-submit", prompt: "fix it", session: "c1", cwd: "/w" }), { ...head, hook_event_name: "UserPromptSubmit", prompt: "fix it" });
    assert.deepEqual(claudeStdin({ event: "pre-compact", trigger: "manual", session: "c1", cwd: "/w" }), { ...head, hook_event_name: "PreCompact", trigger: "manual", custom_instructions: "" });
    assert.deepEqual(claudeStdin({ event: "subagent-end", session: "c1", cwd: "/w" }), { ...head, hook_event_name: "SubagentStop", stop_hook_active: false });
  });

  // (fails before: yes — the bug hunt of 10-30: a plugin's hook read permission_mode "default" whatever the chat's mode)
  test("the chat's permission mode, as Claude names its own: read-only plans, ask is Claude's default, edit accepts edits, auto bypasses", () => {
    const named = (/** @type {any} */ mode) => claudeStdin({ event: "pre-tool", tool: "bash", input: { command: "ls" }, session: "c1", cwd: "/w", mode }).permission_mode;
    assert.deepEqual(["read-only", "ask", "edit", "auto"].map(named), ["plan", "default", "acceptEdits", "bypassPermissions"]);
    assert.equal(named(undefined), "default", "no mode said: Claude's own default");
  });

  // (fails before: yes — Filament had no moment for them, 10-27)
  test("what it said at Claude's other moments: the person's message refused or added to, a compaction told, a sub-agent sent back", () => {
    const v = (/** @type {any} */ on, /** @type {number | null} */ code, /** @type {any} */ parsed, out = "", err = "") => claudeVerdict(on, code, parsed, out, err);
    const allow = (note = "") => ({ verdict: "allow", note, args: null });
    const block = (/** @type {string} */ note) => ({ verdict: "block", note, args: null });
    // UserPromptSubmit: exit 2 or a block refuses the message, in its words; plain output and additionalContext ride it.
    assert.deepEqual(v("prompt-submit", 2, null, "", "not that"), block("not that"));
    assert.deepEqual(v("prompt-submit", 0, { decision: "block", reason: "ask the lead" }), block("ask the lead"));
    assert.deepEqual(v("prompt-submit", 0, { continue: false, stopReason: "closed today" }), block("closed today"));
    assert.deepEqual(v("prompt-submit", 0, null, "the branch is main\n"), allow("the branch is main"));
    assert.deepEqual(v("prompt-submit", 0, { hookSpecificOutput: { additionalContext: "ctx" } }), allow("ctx"));
    assert.deepEqual(v("prompt-submit", 1, null, "", "crashed"), allow());
    // PreCompact: told, never a block.
    assert.deepEqual(v("pre-compact", 2, null, "", "no"), allow());
    assert.deepEqual(v("pre-compact", 0, { decision: "block", reason: "no" }), allow());
    // SubagentStop: as Stop, for the sub-agent.
    assert.deepEqual(v("subagent-end", 0, { decision: "block", reason: "once more" }), block("once more"));
    assert.deepEqual(v("subagent-end", 2, null, "", "again"), block("again"));
    assert.deepEqual(v("subagent-end", 0, { continue: false }), allow());
    // A compaction's hooks by their trigger.
    const doc = { hooks: [{ on: "pre-compact", matcher: "manual", command: "m", plugin: "a@m", dialect: "claude" }, { on: "pre-compact", command: "any", plugin: "a@m", dialect: "claude" }, { on: "prompt-submit", command: "mine" }] };
    assert.deepEqual(hooksFor(doc, "pre-compact", { trigger: "manual" }).map((h) => h.command), ["m", "any"]);
    assert.deepEqual(hooksFor(doc, "pre-compact", { trigger: "auto" }).map((h) => h.command), ["any"]);
    assert.deepEqual(hooksFor(doc, "prompt-submit").map((h) => h.command), ["mine"]);
    assert.equal(hookProblem({ on: "prompt-submit", command: "x" }), null);
    assert.equal(hookProblem({ on: "pre-compact", tool: "bash", command: "x" }), "tool applies to pre-tool and post-tool hooks only");
  });

  test("what it said, as Claude reads it at each moment", () => {
    const v = (/** @type {any} */ on, /** @type {number | null} */ code, /** @type {any} */ parsed, out = "", err = "") => claudeVerdict(on, code, parsed, out, err);
    const allow = (note = "", args = null) => ({ verdict: "allow", note, args });
    const block = (/** @type {string} */ note) => ({ verdict: "block", note, args: null });
    // Exit 2: a block before a tool and at a turn's end; after a tool, its reason beside the result; at the start, nothing.
    assert.deepEqual(v("pre-tool", 2, null, "", "not that"), block("not that"));
    assert.deepEqual(v("turn-end", 2, null, "", "again"), block("again"));
    assert.deepEqual(v("post-tool", 2, null, "", "look at it"), allow("look at it"));
    assert.deepEqual(v("session-start", 2, null, "", "x"), allow());
    // Another exit: no block, as in Claude.
    assert.deepEqual(v("pre-tool", 1, null, "", "it crashed"), allow());
    // Before a tool: deny, the older block, a rewrite with its context, an ask the rules judge as ever.
    assert.deepEqual(v("pre-tool", 0, { hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "not here" } }), block("not here"));
    assert.deepEqual(v("pre-tool", 0, { decision: "block", reason: "frozen" }), block("frozen"));
    assert.deepEqual(v("pre-tool", 0, { hookSpecificOutput: { permissionDecision: "allow", updatedInput: { file_path: "b" }, additionalContext: "renamed" } }), allow("renamed", /** @type {any} */ ({ file_path: "b" })));
    assert.deepEqual(v("pre-tool", 0, { hookSpecificOutput: { permissionDecision: "ask" } }), allow());
    // continue: false stops a call; at a turn's end the turn is ending already.
    assert.deepEqual(v("post-tool", 0, { continue: false, stopReason: "halt" }), block("halt"));
    assert.deepEqual(v("turn-end", 0, { continue: false }), allow());
    assert.deepEqual(v("turn-end", 0, { decision: "block", reason: "run the tests" }), block("run the tests"));
    assert.deepEqual(v("post-tool", 0, { decision: "block", reason: "check it" }), allow("check it"));
    // At a chat's start, plain output is its context; elsewhere it is for the person alone.
    assert.deepEqual(v("session-start", 0, null, "hello\n"), allow("hello"));
    assert.deepEqual(v("pre-tool", 0, null, "chatter"), allow());
    assert.deepEqual(v("session-start", 0, { hookSpecificOutput: { additionalContext: "ctx" } }), allow("ctx"));
  });
});

describe("a plugin's hook in the loop's hooks", () => {
  test("picked by its matcher at each moment, with Claude's minute where it names no time; yours as before", () => {
    const doc = {
      hooks: [
        { on: "pre-tool", tool: "write", command: "mine" },
        { on: "pre-tool", matcher: "Write|Edit", command: "p1", plugin: "a@m", dialect: "claude", env: { X: "1" } },
        { on: "pre-tool", matcher: "Bash", command: "p2", plugin: "a@m", dialect: "claude", timeoutMs: 5000 },
        { on: "post-tool", matcher: "mcp__plugin_a_notes__.*", command: "p3", plugin: "a@m", dialect: "claude", aliases: { "a-notes": "plugin_a_notes" } },
        { on: "session-start", matcher: "resume", command: "p4", plugin: "a@m", dialect: "claude" },
        { on: "session-start", matcher: "startup|clear", command: "p5", plugin: "a@m", dialect: "claude" },
        { on: "turn-end", command: "p6", plugin: "a@m", dialect: "claude" },
      ],
    };
    const names = (/** @type {any} */ on, /** @type {string | null} */ tool = null) => hooksFor(doc, on, { tool }).map((h) => h.command);
    assert.deepEqual(names("pre-tool", "write"), ["mine", "p1"]);
    assert.deepEqual(names("pre-tool", "edit"), ["p1"]);
    assert.deepEqual(names("pre-tool", "bash"), ["p2"]);
    assert.deepEqual(names("pre-tool", "read"), []);
    assert.deepEqual(names("post-tool", "mcp__a-notes__add"), ["p3"]);
    assert.deepEqual(names("session-start"), ["p5"]);
    assert.deepEqual(names("turn-end"), ["p6"]);
    assert.deepEqual(hooksFor(doc, "pre-tool", { tool: "write" })[1], { on: "pre-tool", tool: null, command: "p1", timeoutMs: 60_000, plugin: "a@m", dialect: "claude", matcher: "Write|Edit", env: { X: "1" } });
    assert.equal(hooksFor(doc, "pre-tool", { tool: "bash" })[0].timeoutMs, 5000);
  });

  test("run: Claude's stdin with its plugin's environment; exit 2 blocks with stderr; updatedInput rewrites; one that fails or hangs blocks nothing", async () => {
    const data = fresh("run-data");
    const cwd = fresh("run-cwd");
    // A real folder: Git Bash turns a value that looks like a POSIX path into a Windows one; a plugin's root never is one.
    const root = fresh("run-root");
    /** @type {import("../src/app/agent/hooks.js").Hook} */
    const hook = { on: "pre-tool", tool: null, command: `node "${slashed(FIXTURE)}"`, plugin: "a@m", dialect: "claude", matcher: "", env: { CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: data, CLAUDE_PLUGIN_OPTION_FLAG: "on" }, timeoutMs: 30_000 };
    let o = await runHook(hook, { event: "pre-tool", tool: "write", input: { path: "leak.txt", content: "a secret" }, cwd, session: "c1" });
    assert.deepEqual([o.verdict, o.note, o.exit, o.plugin], ["block", "No secrets in this project's files.", 2, "a@m"]);
    o = await runHook(hook, { event: "pre-tool", tool: "write", input: { path: "notes/draft.txt", content: "x" }, cwd, session: "c1" });
    assert.deepEqual([o.verdict, o.args], ["allow", { path: "notes/final.txt", content: "x" }]);
    o = await runHook({ ...hook, on: "post-tool" }, { event: "post-tool", tool: "read", input: { path: "a" }, result: "text", ok: true, cwd, session: "c1" });
    assert.deepEqual([o.verdict, o.note], ["allow", "Check what Read gave."]);
    const seen = linesOf(join(data, "seen.jsonl"));
    assert.deepEqual(seen.map((s) => [s.hook_event_name, s.tool_name, s.session_id]), [["PreToolUse", "Write", "c1"], ["PreToolUse", "Write", "c1"], ["PostToolUse", "Read", "c1"]]);
    assert.deepEqual(seen[0].tool_input, { file_path: "leak.txt", content: "a secret" });
    assert.equal(seen[2].tool_response, "text");
    assert.deepEqual(seen[0].env, { root, data, project: resolve(cwd), flag: "on" }, "its plugin's environment, the chat's folder its project's");
    o = await runHook({ ...hook, command: "filament-no-such-program-here" }, { event: "pre-tool", tool: "bash", input: { command: "ls" }, cwd });
    assert.equal(o.verdict, "allow", `a hook that fails blocks nothing: ${o.note}`);
    o = await runHook({ ...hook, command: `node -e "setTimeout(() => {}, 20000)"`, timeoutMs: 400 }, { event: "pre-tool", tool: "bash", input: { command: "ls" }, cwd });
    assert.deepEqual([o.verdict, o.timedOut], ["allow", true], o.note);
    assert.match(o.note, /^the hook did not finish within 400 ms/);
  });
});

describe("what a plugin on brings: its hooks (app)", () => {
  test("only where its hooks are switched on; each command hook on Claude's events Filament has a moment for, filled in; the rest not joined; a needed value waits", async () => {
    const dataDir = fresh("data");
    const folder = fresh("src");
    guardAt(folder);
    const sources = { entry: (/** @type {string} */ _id, /** @type {string} */ name) => ({ market: { id: "claude/acme", name: "acme", title: "Acme" }, entry: { name, title: name, description: "", version: "", category: "", author: "", homepage: "", source: { kind: /** @type {const} */ ("path"), path: folder } } }) };
    const p = createPlugins({ dataDir, sources });
    const v = await p.install({ from: "claude/acme", name: "guard" });
    const mine = { on: "pre-tool", tool: "bash", command: "mine" };
    const doc = (/** @type {boolean} */ hooks) => ({ plugins: { on: [{ id: "guard@acme", hooks }] }, hooks: [mine] });
    // Its hooks off here: none of them.
    assert.deepEqual(p.into(doc(false), { project: "p1" }).hooks, [mine]);
    // On, its value missing: they wait, said.
    let got = p.into(doc(true), { project: "p1", cwd: "/w/app" });
    assert.deepEqual(got.hooks, [mine]);
    assert.deepEqual(got.plugins.notes, ["guard's hooks wait for Flag: set it on its sheet in Library › Plugins & Connectors"]);
    p.setValues("guard@acme", "all", { flag: "on" });
    got = p.into(doc(true), { project: "p1", cwd: "/w/app" });
    assert.deepEqual(got.plugins.notes, []);
    const env = { CLAUDE_PLUGIN_ROOT: v.root, CLAUDE_PLUGIN_DATA: v.data, PLUGIN_ROOT: v.root, PLUGIN_DATA: v.data, CLAUDE_PROJECT_DIR: "/w/app", CLAUDE_PLUGIN_OPTION_FLAG: "on" };
    const run = `node "${slashed(v.root)}/hook.mjs"`;
    assert.deepEqual(got.hooks, [
      mine,
      { on: "pre-tool", event: "PreToolUse", matcher: "Write|Edit", command: `${run} --flag=on`, timeoutMs: 20_000, env, plugin: "guard@acme", dialect: "claude" },
      { on: "post-tool", event: "PostToolUse", matcher: "Read", command: run, env, plugin: "guard@acme", dialect: "claude" },
      { on: "turn-end", event: "Stop", matcher: "", command: run, env, plugin: "guard@acme", dialect: "claude" },
      { on: "prompt-submit", event: "UserPromptSubmit", matcher: "", command: "echo later", env, plugin: "guard@acme", dialect: "claude" },
    ]);
  });
});

describe("through a turn", () => {
  test("a plugin's hooks on for a chat: a write renamed, a secret refused in its words, a read's result with its reason, the turn sent back once", async (t) => {
    const home = fresh("home");
    const market = join(home, ".claude", "plugins", "marketplaces", "acme");
    put(join(home, ".claude", "plugins", "known_marketplaces.json"), { acme: { source: { source: "github", repo: "acme/plugins" }, installLocation: market } });
    put(join(market, ".claude-plugin", "marketplace.json"), { name: "acme", plugins: [{ name: "guard", source: "./plugins/guard" }] });
    guardAt(join(market, "plugins", "guard"));
    const root = fresh("work");
    writeFileSync(join(root, "seed.txt"), "seed\n");
    const was = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    t.after(() => {
      for (const [k, v] of Object.entries(was)) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
    /** @type {any[]} */
    const seen = [];
    const up = await fakeUpstream(async (/** @type {any} */ call) => {
      if (!(call.body?.tools || []).length) return anthropicReply("A title", { model: "brain-model" });
      seen.push(call.body);
      if (seen.length === 1)
        return anthropicReply("", {
          model: "brain-model",
          stop: "tool_use",
          blocks: [
            { type: "tool_use", id: "w1", name: "write", input: { path: "draft.txt", content: "x\n" } },
            { type: "tool_use", id: "w2", name: "write", input: { path: "leak.txt", content: "a secret\n" } },
            { type: "tool_use", id: "r1", name: "read", input: { path: "seed.txt" } },
          ],
        });
      return anthropicReply(seen.length === 2 ? "Done." : "Done, and the tests ran.", { model: "brain-model" });
    });
    t.after(() => up.close());
    const shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
    t.after(() => shim.stop());
    const ins = await shim.api("/api/plugins/install", { method: "POST", body: { from: "claude/acme", name: "guard" } });
    assert.equal(ins.status, 200, await ins.clone().text());
    const plugin = (await ins.json()).plugin;
    assert.equal((await shim.api(`/api/plugins/installed/${encodeURIComponent("guard@acme")}/values`, { method: "POST", body: { place: "all", values: { flag: "on" } } })).status, 200);
    const created = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { plugins: { on: [{ id: "guard@acme", hooks: true }] } } } })).json();
    const r = await shim.api(`/api/sessions/${encodeURIComponent(created.id)}/turns`, { method: "POST", body: { content: "write the draft", stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    // The draft was written as the hook renamed it; the secret was not.
    assert.deepEqual([existsSync(join(root, "final.txt")), existsSync(join(root, "draft.txt")), existsSync(join(root, "leak.txt"))], [true, false, false]);
    const results = seen[1].messages.at(-1).content.filter((/** @type {any} */ c) => c.type === "tool_result");
    const text = (/** @type {any} */ c) => (typeof c.content === "string" ? c.content : c.content.map((/** @type {any} */ x) => x.text).join(""));
    const by = Object.fromEntries(results.map((/** @type {any} */ c) => [c.tool_use_id, text(c)]));
    assert.match(by.w2, /^Not run: the pre-tool hook of the plugin guard@acme blocked write — No secrets in this project's files\./);
    assert.match(by.r1, /\[hook of the plugin guard@acme: Check what Read gave\.\]$/);
    // Its Stop hook sent the turn back once, in its words.
    const back = seen[2].messages.at(-1).content.map((/** @type {any} */ c) => c.text || "").join("");
    assert.equal(back, "[Filament turn-end hook of the plugin guard@acme → block, exit 0]\nSay that the tests ran.");
    assert.equal(seen.length, 3);
    // What it read, as Claude's hooks read it.
    const lines = linesOf(join(plugin.data, "seen.jsonl"));
    // The turn goes back once (the loop's own bound): its Stop hook ran once.
    assert.deepEqual(lines.map((l) => [l.hook_event_name, l.tool_name ?? null]), [["PreToolUse", "Write"], ["PreToolUse", "Write"], ["PostToolUse", "Read"], ["Stop", null]]);
    assert.deepEqual([lines[0].tool_input, lines[0].cwd, lines[0].session_id, lines[0].env.flag], [{ file_path: "draft.txt", content: "x\n" }, resolve(root), created.id, "on"]);
    // (fails before: yes — the bug hunt of 10-30: each read "default", in a chat in Edit)
    assert.deepEqual(lines.map((l) => l.permission_mode), ["acceptEdits", "acceptEdits", "acceptEdits", "acceptEdits"], "the chat's mode, as Claude names it");
    // On the turn's record, each with its plugin.
    const rec = await shim.record(String(r.headers.get("x-filament-request-id")));
    // Its UserPromptSubmit command ran first, on the message (10-27).
    assert.deepEqual((rec.hooks || []).map((/** @type {any} */ h) => [h.on, h.verdict, h.plugin]), [["prompt-submit", "allow", "guard@acme"], ["pre-tool", "allow", "guard@acme"], ["pre-tool", "block", "guard@acme"], ["post-tool", "allow", "guard@acme"], ["turn-end", "block", "guard@acme"]]);
  });
});

// (fails before: yes — a plugin's UserPromptSubmit hook never ran, and what its SessionStart hook said never reached the
// model: Claude adds both to the context, which plugins such as superpowers count on, 10-27)
describe("Claude's other moments through turns", () => {
  test("a plugin's session-start words stay in the chat's system prompt; its prompt-submit hook adds to each message, and refuses one in its words", async (t) => {
    const home = fresh("home2");
    const market = join(home, ".claude", "plugins", "marketplaces", "acme");
    put(join(home, ".claude", "plugins", "known_marketplaces.json"), { acme: { source: { source: "github", repo: "acme/plugins" }, installLocation: market } });
    put(join(market, ".claude-plugin", "marketplace.json"), { name: "acme", plugins: [{ name: "nudge", source: "./plugins/nudge" }] });
    const dir = join(market, "plugins", "nudge");
    put(join(dir, ".claude-plugin", "plugin.json"), { name: "nudge", version: "1.0.0", description: "Context at the start and on each message" });
    copyFileSync(FIXTURE, join(dir, "hook.mjs"));
    const run = 'node "${CLAUDE_PLUGIN_ROOT}/hook.mjs"';
    put(join(dir, "hooks", "hooks.json"), {
      hooks: {
        SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: run }] }],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: run }] }],
      },
    });
    const root = fresh("work2");
    const was = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    t.after(() => {
      for (const [k, v] of Object.entries(was)) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
    /** @type {any[]} */
    const seen = [];
    const up = await fakeUpstream(async (/** @type {any} */ call) => {
      if (!(call.body?.tools || []).length) return anthropicReply("A title", { model: "brain-model" });
      seen.push(call.body);
      return anthropicReply("Noted.", { model: "brain-model" });
    });
    t.after(() => up.close());
    const shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
    t.after(() => shim.stop());
    const ins = await shim.api("/api/plugins/install", { method: "POST", body: { from: "claude/acme", name: "nudge" } });
    assert.equal(ins.status, 200, await ins.clone().text());
    const plugin = (await ins.json()).plugin;
    const created = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { plugins: { on: [{ id: "nudge@acme", hooks: true }] } } } })).json();
    const turn = (/** @type {string} */ content) => shim.api(`/api/sessions/${encodeURIComponent(created.id)}/turns`, { method: "POST", body: { content, stream: false } });
    const sys = (/** @type {any} */ b) => (Array.isArray(b.system) ? b.system.map((/** @type {any} */ x) => x.text).join("") : String(b.system || ""));
    const last = (/** @type {any} */ b) => { const m = b.messages.at(-1); return typeof m.content === "string" ? m.content : m.content.map((/** @type {any} */ c) => c.text || "").join("\n"); };
    const r1 = await turn("hello there");
    assert.equal(r1.status, 200, await r1.clone().text());
    const startWords = "# Said by the plugins' hooks at this chat's start\n[session-start hook of the plugin nudge@acme]\nThe plugin says hello.";
    assert.ok(sys(seen[0]).includes(startWords), sys(seen[0]).slice(-400));
    assert.match(last(seen[0]), /^hello there\n\[prompt-submit hook of the plugin nudge@acme\]\nToday is the 27th\.$/);
    // The next turn: its start's words are still the agent's; the message added to anew.
    const r2 = await turn("and again");
    assert.equal(r2.status, 200);
    assert.ok(sys(seen[1]).includes(startWords), "kept for the whole chat");
    assert.match(last(seen[1]), /^and again\n\[prompt-submit hook of the plugin nudge@acme\]\nToday is the 27th\.$/);
    // A message it refuses never reaches the model, and says why.
    const r3 = await turn("do the forbidden thing");
    assert.equal(seen.length, 2, "the model was not asked");
    const said = await r3.text();
    assert.match(said, /The prompt-submit hook of the plugin nudge@acme refused this message: Not in this project\. Nothing ran\./);
    // What it read, as Claude's hooks read it: the chat's start once, each message.
    const lines = linesOf(join(plugin.data, "seen.jsonl"));
    assert.deepEqual(lines.map((l) => [l.hook_event_name, l.prompt ?? null]), [["SessionStart", null], ["UserPromptSubmit", "hello there"], ["UserPromptSubmit", "and again"], ["UserPromptSubmit", "do the forbidden thing"]]);
    const rec = await shim.record(String(r3.headers.get("x-filament-request-id")));
    assert.ok(rec.changes.includes("agent: refused — a prompt-submit hook refused the message"), rec.changes.join("\n"));
  });
});
