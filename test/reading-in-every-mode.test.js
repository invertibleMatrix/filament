// @ts-check
// HarnessV3-AtHome AH-F2 (2026-10-04): a command that only reads ran without asking in Edit mode alone (LD-D11). The
// owner's spin ran under Ask: its turn asked about commands the reader passes, its sub-agents were refused them
// ("nobody can answer inside a sub-agent"), and read-only — the mode for looking — could not look with bash at all.
// Now the gate runs such a command in every mode, and what it refuses or asks about says the reader's reason: an
// outside folder, a write, a program it does not know.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { gate, handsIn, outsideRoot, readOnlyRefusal, ruled, toolSetFor } from "../src/app/agent/tools.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import { SHELL } from "../src/adapters/tools/shell.js";
import { MODES } from "../src/ui/harness/composer/mode.js";

const WHY = "output into a file: only /dev/null reads nothing back";
const OUT = "../x.txt is outside the working folder";
const reads = () => /** @type {const} */ ({ ok: true });
const writes = () => /** @type {const} */ ({ ok: false, why: WHY });
const outside = () => /** @type {const} */ ({ ok: false, why: OUT });

describe("the gate reads a bash command in every mode", () => {
  // (fails before: yes — read-only refused it and Ask asked)
  test("a command the reader passes runs in read-only, Ask and Edit, said as readOnly; Full access runs it unread", () => {
    for (const mode of /** @type {const} */ (["read-only", "ask", "edit"])) assert.deepEqual(gate(mode, "bash", { command: "ls -la" }, null, undefined, reads), { verdict: "run", readOnly: true }, mode);
    let asked = 0;
    assert.deepEqual(gate("auto", "bash", { command: "ls -la" }, null, undefined, () => (asked++, { ok: true })), { verdict: "run" });
    assert.equal(asked, 0, "Full access never asks the reader");
  });

  // (fails before: yes — the refusal and the question said nothing of why)
  test("one it does not pass: read-only refuses it and Ask and Edit ask, each in the reader's words; Full access runs it", () => {
    const c = { command: "echo x > f.txt" };
    assert.deepEqual(gate("read-only", "bash", c, null, undefined, writes), {
      verdict: "refuse",
      text: `Not run: this session is read-only, and Filament cannot tell that this command only reads inside the working folder: ${WHY}. Say precisely what you would run and why instead.`,
      why: WHY,
    });
    for (const mode of /** @type {const} */ (["ask", "edit"]))
      assert.deepEqual(gate(mode, "bash", c, null, undefined, writes), {
        verdict: "ask",
        question: `May I run this command? \`echo x > f.txt\` — Filament cannot tell that it only reads inside the working folder: ${WHY}. Answer /allow to run it, or say what to do instead.`,
        why: WHY,
      }, mode);
    assert.deepEqual(gate("auto", "bash", c, null, undefined, writes), { verdict: "run" });
  });

  // (fails before: yes — read-only refused it as any command, and Ask and Edit asked without saying where it reads)
  test("reading outside the working folder: refused in read-only, asked in Ask and Edit with where it reads, run in Full access", () => {
    const c = { command: "cat ../x.txt" };
    assert.match(String(/** @type {any} */ (gate("read-only", "bash", c, null, undefined, outside)).text), /^Not run: this session is read-only, and Filament cannot tell that this command only reads inside the working folder: \.\.\/x\.txt is outside the working folder\./);
    for (const mode of /** @type {const} */ (["ask", "edit"])) assert.match(String(/** @type {any} */ (gate(mode, "bash", c, null, undefined, outside)).question), /— Filament cannot tell that it only reads inside the working folder: \.\.\/x\.txt is outside the working folder\. Answer \/allow/, mode);
    assert.deepEqual(gate("auto", "bash", c, null, undefined, outside), { verdict: "run" });
  });

  // (fails before: yes — the owner's agent_loop_test of 11-02: the reason came in parentheses of its own, "(a `~` (a
  // home folder))")
  test("the reason follows a colon: one that holds parentheses of its own is never wrapped in more", () => {
    const home = () => ({ ok: /** @type {const} */ (false), why: "a `~` (a home folder)" });
    assert.equal(/** @type {any} */ (gate("edit", "bash", { command: "ls ~" }, null, undefined, home)).question, "May I run this command? `ls ~` — Filament cannot tell that it only reads inside the working folder: a `~` (a home folder). Answer /allow to run it, or say what to do instead.");
    assert.equal(/** @type {any} */ (gate("read-only", "bash", { command: "ls ~" }, null, undefined, home)).text, "Not run: this session is read-only, and Filament cannot tell that this command only reads inside the working folder: a `~` (a home folder). Say precisely what you would run and why instead.");
  });

  // (fails before: yes — a yes under read-only said no reason; the rest guards the other hands' words and a learned permission's place)
  test("the other hands are read as before; a yes under read-only says the reason too; a learned permission still runs a command the reader turns down", () => {
    assert.equal(/** @type {any} */ (gate("read-only", "write", { path: "a.txt", content: "" })).text, "Not run: this session is read-only, so write is not available. Say precisely what you would change and why instead.");
    let asked = 0;
    assert.equal(gate("ask", "bash_background", { command: "ls" }, null, undefined, () => (asked++, { ok: true })).verdict, "ask");
    assert.equal(gate("read-only", "bash_background", { command: "ls" }, null, undefined, () => (asked++, { ok: true })).verdict, "refuse");
    assert.equal(asked, 0, "a command in the background is not read: only a foreground one is");
    // HarnessV4_Tasks C10: the powershell hand's script is read as bash's command is, and one its reader turns down
    // is refused with the reason.
    assert.deepEqual(gate("read-only", "powershell", { command: "Get-Location" }, null, undefined, () => ({ ok: true })), { verdict: "run", readOnly: true });
    assert.equal(/** @type {any} */ (gate("read-only", "powershell", { command: "Remove-Item x" }, null, undefined, writes)).text, readOnlyRefusal("powershell", { why: WHY }));
    assert.equal(readOnlyRefusal("bash", { yes: true, why: WHY }), `Not run: the developer said yes, but this session is read-only now, and Filament cannot tell that this command only reads inside the working folder: ${WHY}. Say precisely what you would run and why instead.`);
    assert.deepEqual(gate("edit", "bash", { command: "npm test" }, () => true, undefined, writes), { verdict: "run", learned: true });
    assert.equal(gate("read-only", "bash", { command: "npm test" }, () => true, undefined, writes).verdict, "refuse", "never over read-only");
  });

  // (fails before: yes — read-only's hands left bash out, so an explorer's brief named none of its pitfalls)
  test("handsIn keeps bash in every mode: a command that only reads runs in each", () => {
    for (const mode of /** @type {const} */ (["read-only", "ask", "edit", "auto"])) assert.ok(handsIn(mode).includes("bash"), mode);
    assert.deepEqual(handsIn("read-only").filter((n) => ["write", "edit", "bash_background"].includes(n)), [], "read-only's changing hands stay out");
    // HarnessV4_Tasks C10: a PowerShell script that only reads runs in each mode too, on a machine with the hand.
    assert.equal(handsIn("read-only").includes("powershell"), handsIn("auto").includes("powershell"));
  });

  // (fails before: yes — read-only said every command is refused, and Ask that every command asks)
  test("the switch's words say a command that only reads runs in every mode", () => {
    const desc = Object.fromEntries(MODES.map((m) => [m.id, m.desc]));
    assert.match(desc["read-only"], /commands that only read/);
    assert.match(desc.ask, /commands that only read/);
    assert.match(desc.edit, /commands that only read/);
  });
});

test("a write into a repository's .git asks in Edit mode and in Full access, and is never learned (fails before: yes — Edit ran it, and a clean filter planted in .git/config ran at the next snapshot's git add)", () => {
  for (const mode of /** @type {const} */ (["edit", "auto"]))
    for (const [name, input] of /** @type {[string, any][]} */ ([["write", { path: ".git/config", content: "[filter \"x\"]\n\tclean = calc" }], ["edit", { path: "sub\\.GIT\\hooks\\pre-commit", edits: [] }], ["write", { path: ".git", content: "gitdir: elsewhere" }], ["write", { path: ".git./config", content: "x" }], ["write", { path: "GIT~1\\config", content: "x" }], ["write", { path: ".git::$INDEX_ALLOCATION/config", content: "x" }]])) {
      const g = /** @type {any} */ (gate(mode, name, input, () => true));
      assert.equal(g.verdict, "ask", `${mode}: ${name} ${input.path}`);
      assert.match(g.question, /the repository's \.git folder/);
    }
  for (const mode of /** @type {const} */ (["edit", "auto"])) {
    assert.deepEqual(gate(mode, "write", { path: "src/.gitignore", content: "x" }), { verdict: "run" });
    assert.deepEqual(gate(mode, "write", { path: "docs/git/notes.md", content: "x" }), { verdict: "run" });
    assert.deepEqual(gate(mode, "write", { path: ".github/workflows/ci.yml", content: "x" }), { verdict: "run" });
  }
  // (fails before: yes — HarnessV4_Git_Plan GW-D11: Full access ran it, and git runs what a hook or a filter there
  // names in every place Filament now snapshots, a sibling worktree or another repository the agent wrote in)
  assert.deepEqual(gate("auto", "bash", { command: "rm -rf .git" }), { verdict: "run" }, "a command is not read for .git: Full access runs it");
  assert.equal(gate("read-only", "write", { path: ".git/config", content: "x" }).verdict, "refuse");
});

// (fails before: yes — HarnessV4_SpacesPlugins_Plan A2b, SP-D5: the gate let it run in Edit and the fence refused it
// flatly, so the only way to write outside was Full access)
test("a write outside the chat's folder asks in Edit and Ask, runs in Full access, is refused in Read only, and is never learned", () => {
  const root = join(tmpdir(), "work");
  for (const input of [{ path: "../notes/a.md", content: "x" }, { path: join(tmpdir(), "elsewhere", "a.md"), content: "x" }, { file_path: "..\\b.md", edits: [] }]) {
    const name = "file_path" in input ? "edit" : "write";
    for (const mode of /** @type {const} */ (["edit", "ask"])) {
      const g = /** @type {any} */ (gate(mode, name, input, () => true, undefined, null, root));
      assert.deepEqual([g.verdict, g.outside], ["ask", true], `${mode} ${JSON.stringify(input)}`);
      assert.match(g.question, new RegExp(`It is outside this chat's folder \\(${root.replace(/[\\.]/g, "\\$&")}\\)`));
    }
    assert.deepEqual(gate("auto", name, input, null, undefined, null, root), { verdict: "run" });
    assert.equal(gate("read-only", name, input, null, undefined, null, root).verdict, "refuse");
  }
  assert.deepEqual(gate("edit", "write", { path: "sub/a.md", content: "x" }, null, undefined, null, root), { verdict: "run" });
  assert.deepEqual(gate("edit", "write", { path: join(root, "a.md"), content: "x" }, null, undefined, null, root), { verdict: "run" });
  assert.deepEqual(gate("ask", "write", { path: "a.md", content: "x" }, () => true, undefined, null, root), { verdict: "run", learned: true });
  assert.equal(outsideRoot({ path: "../x" }, ""), false, "with no folder known nothing is outside");
});

// (fails before: yes — a sub-agent in its own worktree, which sits in its repository's .git (filament-worktrees), was
// asked before every write it named by its whole path, as one into git's own folder: a coding agent names them all so)
test("a write is read for .git below the folder it works in: a worktree's own files are no git's, while its .git file, a nested repository's .git and a path that climbs out into git's folder still ask", () => {
  const repo = join(tmpdir(), "repo");
  const wt = join(repo, ".git", "filament-worktrees", "sa_1");
  assert.deepEqual(gate("edit", "write", { path: join(wt, "src", "out.txt"), content: "x" }, null, undefined, null, wt), { verdict: "run" });
  assert.deepEqual(gate("edit", "edit", { file_path: "src/out.txt", edits: [] }, null, undefined, null, wt), { verdict: "run" });
  for (const path of [join(wt, ".git"), "../../hooks/pre-commit", join(repo, ".git", "config"), join(wt, "sub", ".git", "config"), wt]) {
    const g = /** @type {any} */ (gate("edit", "write", { path, content: "x" }, () => true, undefined, null, wt));
    assert.equal(g.verdict, "ask", path);
    assert.match(g.question, /the repository's \.git folder/, path);
  }
  // A rule that asks first says it in the same words.
  const asks = { verdict: /** @type {const} */ ("ask"), rule: { tool: "write", pattern: "*", verdict: "ask" }, subject: "out.txt" };
  const own = /** @type {any} */ (ruled({ verdict: "run" }, /** @type {any} */ (asks), "write", { path: join(wt, "out.txt"), content: "x" }, wt));
  assert.equal(own.question, `May I write ${join(wt, "out.txt")}? Answer /allow to write it, or say what to do instead.`);
});

// (fails before: no — a guard the mutation pass asked for: the loop's gate read no folder, so a worker in its worktree
// was asked before a write it named by its whole path, and passed every test)
test("the loop reads a write for .git below the folder it works in: a worker in its worktree writes by the whole path in Edit mode, unasked", async () => {
  const wt = join(tmpdir(), "repo", ".git", "filament-worktrees", "sa_1");
  const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
  const answer = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
  /** @type {string[]} */
  const ran = [];
  let n = 0;
  const out = await runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
    model: "m",
    messages: [{ role: "user", content: "write it" }],
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "edit",
    root: wt,
    readerModel: "",
    maxTokens: 100,
    call: async () => answer(++n === 1 ? [{ type: "tool_use", id: "w1", name: "write", input: { path: join(wt, "out.txt"), content: "x" } }] : [{ type: "text", text: "Done." }]),
    costOf: () => 0,
    runHand: async (/** @type {string} */ name, /** @type {any} */ input) => (ran.push(`${name} ${input.path}`), "Wrote it."),
    delegateRead: null,
    mailbox: { read: () => [] },
    permissions: null,
    tree: null,
    onEvent: () => {},
    previewChars: 0,
    sink,
    signal: null,
    resume: null,
  }));
  assert.equal(out.status, "done");
  assert.deepEqual(ran, [`write ${join(wt, "out.txt")}`]);
});

describe("reading commands end to end", { skip: SHELL.kind === "cmd" ? "cmd.exe is not a bash: no command is read" : false }, () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
  const said = (/** @type {string} */ t) => reply([{ type: "text", text: t }]);
  const textOf = (/** @type {any[]} */ blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
  const lastResults = (/** @type {any[]} */ msgs) => {
    const m = msgs.at(-1);
    return Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ c) => c?.type === "tool_result") : [];
  };
  const isSub = (/** @type {any} */ call) => JSON.stringify(call.body?.system ?? "").includes(PROMPT.subagentRole);
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-reading-modes-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.txt"), "alpha\n");
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
  /** @param {any} settings */
  const create = async (settings) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return { text: textOf((await r.json()).content), rec: await shim.record(r.headers.get("x-filament-request-id")) };
  };

  for (const mode of ["read-only", "ask"]) {
    // (fails before: yes — read-only refused `cat src/a.txt`, and Ask paused the turn on it)
    test(`a ${mode} session runs a command that only reads, without asking`, async () => {
      const id = await create({ loop: { permissions: mode } });
      /** @type {any[]} */
      let results = [];
      let round = 0;
      brain = (call) => {
        round++;
        if (round === 1) return reply([toolUse("b1", "bash", { command: "cat src/a.txt" })], "tool_use");
        results = lastResults(call.body.messages);
        return said("Read it.");
      };
      up.reset();
      const r = await turn(id, "read src/a.txt");
      assert.equal(r.text, "Read it.");
      assert.equal(r.rec.agent.status, "done");
      assert.match(String(results[0]?.content), /alpha/);
      assert.ok(r.rec.changes.includes("agent: bash ran without asking — it only reads"), r.rec.changes.join("\n"));
    });
  }

  // (fails before: yes — the refusal said only that bash is not available)
  test("a read-only session refuses a command that writes, in the reader's words, and nothing is written", async () => {
    const id = await create({ loop: { permissions: "read-only" } });
    /** @type {any[]} */
    let results = [];
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("b1", "bash", { command: "echo x > made.txt" })], "tool_use");
      results = lastResults(call.body.messages);
      return said("Refused.");
    };
    up.reset();
    const r = await turn(id, "write made.txt");
    assert.equal(r.text, "Refused.");
    assert.ok(!existsSync(join(root, "made.txt")));
    assert.equal(results[0].is_error, true);
    assert.match(String(results[0].content), /^Not run: this session is read-only, and Filament cannot tell that this command only reads inside the working folder: output into a file: only \/dev\/null reads nothing back\./);
  });

  // (fails before: yes — the sub-agent was refused it: "nobody can answer inside a sub-agent")
  test("a sub-agent of an Ask session runs a command that only reads; one that writes is refused with the reason", async () => {
    const id = await create({ loop: { permissions: "ask" }, subagents: { worktree: false } });
    /** @type {any[]} */
    let subResults = [];
    brain = (call) => {
      const answered = lastResults(call.body.messages).length > 0;
      if (isSub(call)) {
        if (!answered) return reply([toolUse("s1", "bash", { command: "cat src/a.txt" }), toolUse("s2", "bash", { command: "echo x > sub.txt" })], "tool_use");
        subResults = lastResults(call.body.messages);
        return said("SUB DONE");
      }
      if (!answered) return reply([toolUse("a1", "agent", { run_in_background: false, description: "Reader", prompt: "Read src/a.txt.", subagent_type: "builder" })], "tool_use");
      return said("MAIN DONE");
    };
    up.reset();
    const r = await turn(id, "have a sub-agent read src/a.txt");
    assert.equal(r.text, "MAIN DONE");
    assert.equal(subResults.length, 2);
    assert.notEqual(subResults[0].is_error, true, String(subResults[0].content));
    assert.match(String(subResults[0].content), /alpha/);
    assert.equal(subResults[1].is_error, true);
    assert.match(String(subResults[1].content), /^Not run: Filament cannot tell that this command only reads inside the working folder: output into a file: only \/dev\/null reads nothing back\. It needs the developer's approval in this session, and a sub-agent cannot ask for it\./);
    assert.ok(!existsSync(join(root, "sub.txt")));
  });
});
