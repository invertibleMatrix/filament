// @ts-check
// x20: a sub-agent that only reads runs the check of the graph task it looks at — the task a hunt is fired from, the
// one it explores, the one a coding agent's helper is launched for — with run_check, which Filament runs as it runs a
// check: in a copy of the folder as it stands, its uncommitted work in it, so nothing the check writes reaches the
// folder. Its shell runs no check: read-only still refuses `node --test`. Two hunts of 11-23 could not run their
// task's check, and every finding was by reading alone.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolSetFor } from "../src/app/agent/tools.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { RUN_CHECK, RUN_CHECK_OFF, runCheckAnswer } from "../src/app/agent/run-check.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});

describe("run_check's answer", () => {
  // (fails before: yes — there was no such tool)
  test("each command with how it ended and the end of its output; a red one's first run beside its second; why none ran", () => {
    const r = runCheckAnswer({ ran: true, commands: ["npm test", "npm run lint"], runs: [{ command: "npm test", exit: 0, ms: 1200, output: "ok 3 tests\n", stopped: false }, { command: "npm run lint", exit: 1, ms: 300, output: "a.js: no-unused-vars", stopped: false, first: { exit: 1, ms: 310, output: "a.js: no-unused-vars" } }], bounces: 0, stopped: false });
    assert.equal(r.ok, true);
    const text = /** @type {any} */ (r).text;
    assert.match(text, /^Filament ran the check in a copy of the folder as it stands:\n\n\$ npm test\npassed \(exit 0, [^)]+\) — the end of its output:\nok 3 tests\n\n\$ npm run lint\nIts first run failed \(exit 1, [^)]+\) — the end of its output:\na\.js: no-unused-vars\nIts second run:\nfailed \(exit 1, [^)]+\) — the end of its output:\na\.js: no-unused-vars$/);
    const cut = runCheckAnswer({ ran: true, commands: ["a", "b"], runs: [{ command: "a", exit: null, ms: 50, output: "", stopped: true }], bounces: 0, stopped: true });
    assert.match(/** @type {any} */ (cut).text, /^Filament's run of the check was stopped:\n\n\$ a\ndid not finish \(after [^)]+\) — no output\n\n\$ b\nnot run$/);
    assert.deepEqual(runCheckAnswer({ ran: false, words: "the session is read-only, so Filament runs no check in it" }), { ok: false, error: "Not run: the session is read-only, so Filament runs no check in it." });
  });
});

describe("the loop under read-only (a sub-agent that only reads)", () => {
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
  const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };

  // (fails before: yes — read-only refused `node --test`, and nothing else ran a check)
  test("run_check is offered where it holds a check and runs it; its shell still runs none", async () => {
    assert.ok(toolSetFor({ delegateRead: false, runCheck: true }).some((t) => t.name === RUN_CHECK));
    assert.ok(!toolSetFor({ delegateRead: false }).some((t) => t.name === RUN_CHECK), "none without a check");
    assert.ok(!toolSetFor({ delegateRead: false, runCheck: true, disabled: [RUN_CHECK] }).some((t) => t.name === RUN_CHECK), "the session's switch takes it out");
    /** @type {string[]} */
    const ran = [];
    /** @type {any[]} */
    const results = [];
    let checks = 0;
    let n = 0;
    const out = await runAgentTurn(
      /** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
        model: "m",
        messages: [{ role: "user", content: "go" }],
        system: "s",
        tools: toolSetFor({ delegateRead: false, runCheck: true }),
        modeNow: () => "read-only",
        root: tmpdir(),
        readerModel: "",
        maxTokens: 100,
        call: async (/** @type {any} */ req) => {
          if (++n === 1) return reply([toolUse("c1", RUN_CHECK, {}), toolUse("c2", "bash", { command: "node --test test/x.test.js" })]);
          results.push(...(req?.body?.messages ?? req?.messages ?? []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content.filter((/** @type {any} */ b) => b.type === "tool_result") : [])));
          return reply([{ type: "text", text: "Done." }]);
        },
        costOf: () => 0,
        runHand: async (/** @type {string} */ _name, /** @type {any} */ input) => (ran.push(input.command), "ok"),
        delegateRead: null,
        mailbox: { read: () => [] },
        permissions: null,
        tree: null,
        onEvent: () => {},
        previewChars: 0,
        sink,
        signal: null,
        resume: null,
        runCheck: async () => (checks++, { ok: true, text: "Filament ran the check in a copy of the folder as it stands:\n\n$ node --test test/x.test.js\npassed" }),
      }),
    );
    assert.equal(out.status, "done");
    assert.equal(checks, 1, "run_check ran its check");
    assert.deepEqual(ran, [], "the shell ran nothing: read-only refuses the command");
    const said = JSON.stringify(results);
    assert.match(said, /Filament ran the check in a copy of the folder/);
    assert.match(said, /"tool_use_id":"c2","is_error":true,"content":"Not run: this session is read-only/);
  });
});

describe("a coding agent's sub-agent (Filament's tools over its MCP server)", () => {
  // (fails before: yes — a coding agent's reviewer had its check refused by the session's read-only mode)
  test("run_check is listed for a sub-agent that holds a check, and runs it through the registry by its id", async () => {
    /** @type {string[]} */
    const asked = [];
    const registry = {
      offer: () => /** @type {any} */ (null),
      asks: () => [],
      checksOf: (/** @type {string} */ id) => (id === "sa_look" ? ["npm test"] : []),
      runCheck: async (/** @type {string} */ id) => (asked.push(id), { ok: /** @type {const} */ (true), text: "ran it" }),
    };
    const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => registry, membersOf: () => null });
    const at = (/** @type {any} */ ctx) => tools.list({ cwd: tmpdir(), upstream: "u", turn: null, graph: false, chain: "c1", ...ctx }).find((t) => t.name === RUN_CHECK) || null;
    assert.equal(at({ by: { id: "sa_look", exchange: 1 } })?.upfront, true, "a sub-agent holding a check: loaded whole");
    assert.equal(at({ by: { id: "sa_other", exchange: 1 } }), null, "one with none");
    assert.equal(at({ launch: true }), null, "the chat's own agent");
    assert.ok(tools.has(RUN_CHECK));
    assert.deepEqual(await tools.call(RUN_CHECK, {}, /** @type {any} */ ({ cwd: tmpdir(), upstream: "u", turn: null, graph: false, chain: "c1", by: { id: "sa_look", exchange: 1 } })), { text: "ran it" });
    assert.deepEqual(asked, ["sa_look"]);
    assert.deepEqual(await tools.call(RUN_CHECK, {}, /** @type {any} */ ({ cwd: tmpdir(), upstream: "u", turn: null, graph: false, chain: "c1", by: { id: "sa_other", exchange: 1 } })), { text: RUN_CHECK_OFF, isError: true });
  });
});

describe("the registry", () => {
  /** @param {string} cwd @param {string[]} args */
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
  /** A repository whose check writes a file and prints a file left uncommitted. */
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-x20-"));
    made.push(dir);
    git(dir, "init", "-q");
    git(dir, "config", "core.autocrlf", "false");
    writeFileSync(join(dir, "check.cjs"), "const fs = require('fs');\nfs.writeFileSync('made.txt', 'x');\nconsole.log('saw ' + fs.readFileSync('extra.txt', 'utf8'));\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");
    writeFileSync(join(dir, "extra.txt"), "uncommitted work");
    return dir;
  };
  const CHECK = "node check.cjs";

  /**
   * A registry whose graph (started at `graph`) holds t1 (its check `check`) and t2 (none); `perm` is the session's
   * mode, `turn` the one the chat's running turn fixed. @param {string} cwd
   */
  function scripted(cwd) {
    const cards = createAgentCardStore({ dataDir: null });
    const s = { perm: "edit", n: 0, graph: 1, check: [CHECK], turn: /** @type {"read-only" | null} */ (null) };
    /** @type {ReturnType<typeof createSubagentRegistry>} */
    const registry = createSubagentRegistry({
      config: () => ({ agentLoop: {} }),
      log: () => {},
      events: { publish: () => {} },
      runs: null,
      context: {
        card: (tag) => cards.find(tag),
        settings: () => ({ subagents: { pool: [{ model: "m-sub", seats: 4 }], view: "none" }, loop: { permissions: s.perm } }),
        session: () => ({ cwd, model: "m", projectId: "p1" }),
        view: async () => ({ text: "", turns: 0 }),
        brief: async () => null,
        modelProblem: () => null,
        mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
        huntedTask: (_c, id) => (id === "t1" || id === "t2" ? { name: id, graph: 1 } : { error: "no such task" }),
        taskCheck: (_c, id) => (id === "t1" ? { check: s.check, graph: s.graph } : null),
        turnMode: () => s.turn,
      },
      call: async ({ body, headers = {} }) => {
        const id = headers["x-filament-subagent"];
        const runId = `run-${++s.n}`;
        registry.attach(id, runId);
        registry.finish(id, { status: "done", error: null, report: "Subject: none", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Subject: none" }] }], rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
        return { ok: true, status: 200, json: { content: [{ type: "text", text: "Subject: none" }], usage: { input_tokens: 1, output_tokens: 1 } }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
      },
    });
    return { registry, s };
  }
  const HUNT = { origin: /** @type {const} */ ("owner"), chainId: "c1", prompt: "Hunt for bugs.", description: "Bug hunt: t1", as: "reviewer", deliver: true, hunts: "t1" };

  // (fails before: yes — a hunt held no check, and nothing ran one for it)
  test("a hunt runs its task's check in a copy of the folder: its uncommitted work there, what it writes never in the folder; not in a read-only session", async () => {
    const cwd = repo();
    const { registry, s } = scripted(cwd);
    const r = registry.launch(HUNT);
    assert.equal(r.ok, true, String(/** @type {any} */ (r).error || ""));
    await /** @type {any} */ (r).done;
    const id = /** @type {any} */ (r).id;
    assert.deepEqual(registry.checksOf(id), [CHECK]);
    const ran = await registry.runCheck(id);
    assert.equal(ran.ok, true, String(/** @type {any} */ (ran).error || ""));
    assert.match(/** @type {any} */ (ran).text, /^Filament ran the check in a copy of the folder as it stands:\n\n\$ node check\.cjs\npassed \(exit 0, [^)]+\) — the end of its output:\nsaw uncommitted work$/);
    assert.equal(existsSync(join(cwd, "made.txt")), false, "what the check wrote stayed in the copy");
    assert.equal(git(cwd, "status", "--porcelain"), "?? extra.txt", "the folder as it was");
    s.perm = "read-only";
    assert.deepEqual(await registry.runCheck(id), { ok: false, error: "Not run: the session is read-only, so Filament runs no check in it." }, "the session's mode, read at the call");
    s.perm = "edit";
    const other = registry.launch({ ...HUNT, hunts: "t2", description: "Bug hunt: t2" });
    await /** @type {any} */ (other).done;
    assert.deepEqual(registry.checksOf(/** @type {any} */ (other).id), []);
    assert.deepEqual(await registry.runCheck(/** @type {any} */ (other).id), { ok: false, error: RUN_CHECK_OFF });
  });

  // (fails before: yes — the review of x20: a helper's mode as its launch fixed it stood for the session's)
  test("a coding agent's reviewer helper on a task holds that task's check; read-only now or at its launch refuses its run", async () => {
    const cwd = repo();
    const { registry, s } = scripted(cwd);
    const helper = registry.launch({ origin: "agent", chainId: "c1", prompt: "Look at t1's change.", description: "t1 look", worker: "reviewer", looksAt: "t1", parentModel: "m", mode: "edit" });
    assert.equal(helper.ok, true, String(/** @type {any} */ (helper).error || ""));
    await /** @type {any} */ (helper).done;
    const id = /** @type {any} */ (helper).id;
    assert.deepEqual(registry.checksOf(id), [CHECK]);
    s.perm = "read-only";
    assert.equal((await registry.runCheck(id)).ok, false, "switched to read-only since its launch");
    s.perm = "edit";
    const held = registry.launch({ origin: "agent", chainId: "c1", prompt: "Look again.", description: "t1 look 2", worker: "reviewer", looksAt: "t1", parentModel: "m", mode: "read-only" });
    await /** @type {any} */ (held).done;
    assert.deepEqual(await registry.runCheck(/** @type {any} */ (held).id), { ok: false, error: "Not run: the session is read-only, so Filament runs no check in it." }, "launched from a read-only turn");
    // The chat's running turn under read-only its request fixed, the settings saying Edit: as Filament's own checks.
    s.turn = "read-only";
    assert.equal((await registry.runCheck(id)).ok, false, "the running turn's mode");
  });

  // (fails before: yes — the second review of x20: the check was a copy taken at the launch)
  test("the check as the task names it at each run; none once its graph is gone", async () => {
    const cwd = repo();
    const { registry, s } = scripted(cwd);
    const r = registry.launch(HUNT);
    await /** @type {any} */ (r).done;
    const id = /** @type {any} */ (r).id;
    s.check = ["node -e 0"];
    assert.deepEqual(registry.checksOf(id), ["node -e 0"]);
    assert.match(/** @type {any} */ (await registry.runCheck(id)).text, /\n\$ node -e 0\npassed \(exit 0/);
    s.graph = 2;
    assert.deepEqual(registry.checksOf(id), [], "another graph holds a t1 now");
    assert.deepEqual(await registry.runCheck(id), { ok: false, error: RUN_CHECK_OFF });
  });

  // (fails before: yes — the second review of x20: nothing held how many ran at once)
  test("one reviewer's check runs at a time: another waits for it to end", async () => {
    const cwd = repo();
    const marks = join(cwd, "..", `${cwd.split(/[\\/]/).pop()}-marks.txt`);
    made.push(marks);
    writeFileSync(join(cwd, "slow.cjs"), `const fs = require('fs');\nfs.appendFileSync(${JSON.stringify(marks)}, 'start\\n');\nsetTimeout(() => fs.appendFileSync(${JSON.stringify(marks)}, 'end\\n'), 400);\n`);
    const { registry, s } = scripted(cwd);
    s.check = ["node slow.cjs"];
    const a = registry.launch(HUNT);
    const b = registry.launch({ ...HUNT, description: "Bug hunt: t1 again" });
    await Promise.all([/** @type {any} */ (a).done, /** @type {any} */ (b).done]);
    const both = await Promise.all([registry.runCheck(/** @type {any} */ (a).id), registry.runCheck(/** @type {any} */ (b).id)]);
    assert.deepEqual(both.map((x) => x.ok), [true, true]);
    assert.equal(readFileSync(marks, "utf8"), "start\nend\nstart\nend\n", "never two at once");
    // A run stopped while it waits leaves the line.
    const stop = new AbortController();
    const first = registry.runCheck(/** @type {any} */ (a).id);
    const second = registry.runCheck(/** @type {any} */ (b).id, { signal: stop.signal });
    stop.abort();
    assert.deepEqual(await second, { ok: false, error: "Not run: it was stopped while it waited for another reviewer's check to end." });
    assert.equal((await first).ok, true);
  });
});
