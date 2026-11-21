// @ts-check
// x-sec decision 1, the runs no call asks for: in a chat another machine's agents started, whose device may not run
// without asking here (its grant `unasked` off), Filament runs nothing of theirs on its own — no command task, no
// graph task's check, no folder check, no worker's check as its exchange ends — and a worker's brief grants lift no
// ask. Each is said in words; with the grant on, they run as in the person's own chats.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENTS_ASK, createSubagentRegistry } from "../src/app/agent/subagents.js";
import { TASK_NOT_CHECKED, TASK_NOT_RUN } from "../src/app/agent/check.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { createAgentPermits } from "../src/app/agent-permits.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
/** @param {string} name */
const folder = (name) => {
  const dir = mkdtempSync(join(tmpdir(), `filament-unasked-${name}-`));
  made.push(dir);
  return dir;
};

/**
 * A registry over `dir` whose context says the chat is an agents' chat that must ask while `asks.on` is true.
 * @param {string} dir @param {{ on: boolean }} asks
 */
const registryOver = (dir, asks) =>
  createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: /** @type {any} */ ({
      settings: () => ({ subagents: { pool: [{ model: "", seats: 8 }] }, loop: { permissions: "auto", rules: [] } }),
      session: () => ({ cwd: dir, model: "m-session", projectId: null, client: "harness" }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
      exchangeEnded: () => {},
      agentsChat: () => true,
      agentsAsk: () => asks.on,
    }),
    call: async () => ({ ok: false, status: 500, json: null, id: "x", upstream: "m", retryAfter: null, shouldRetry: null }),
  });

// (fails before: yes — the command task went on to its snapshot, and the planner was told nothing)
test("an agents' chat whose device may not run without asking: no command task runs, and its planner is told why", async () => {
  const dir = folder("cmd");
  const asks = { on: true };
  const r = /** @type {any} */ (registryOver(dir, asks));
  const sig = new AbortController().signal;
  assert.deepEqual(await r.runCommands("c1", [{ item: "a", steps: [{ command: "node try.js a", invert: false }] }], { id: "cmd-x", lanes: 1, signal: sig }), { ran: false, words: TASK_NOT_RUN.agents });
  assert.equal(r.runProblem("c1", ["npm test"]), `${AGENTS_ASK}, and a command task cannot ask: leave the command task out, and run its commands with bash, which asks`);
  asks.on = false;
  assert.equal(r.runProblem("c1", ["npm test"]), null, "with the grant on, a command task is planned as in the person's own chats");
  const ran = await r.runCommands("c1", [{ item: "a", steps: [{ command: "node try.js a", invert: false }] }], { id: "cmd-x", lanes: 1, signal: sig });
  assert.notEqual(ran.words, TASK_NOT_RUN.agents, "and run (this folder is no repository, so it ends there)");
});

// (fails before: yes — a check was kept and run unasked)
test("an agents' chat whose device may not run without asking: no check is kept or run, said; with the grant on, as before", async () => {
  const dir = folder("check");
  const asks = { on: true };
  const r = /** @type {any} */ (registryOver(dir, asks));
  assert.equal(r.checkProblem("c1", ["npm test"]), `${AGENTS_ASK}, and a check cannot ask: leave check out`);
  assert.deepEqual(await r.checkFolder("c1", ["npm test"], { id: "t1", signal: new AbortController().signal }), { ran: false, words: TASK_NOT_CHECKED.agents });
  asks.on = false;
  assert.equal(r.checkProblem("c1", ["npm test"]), null);
  const ran = await r.checkFolder("c1", ["npm test"], { id: "t1", signal: new AbortController().signal });
  assert.notEqual(ran.words, TASK_NOT_CHECKED.agents);
});

/**
 * A worker's loop in its own worktree whose brief grants `npm test`, its grants holding as `holds` says at each call;
 * `ran` is told each command that ran.
 * @param {() => boolean} holds @param {(command: string) => void} [onRan]
 */
const workerLoop = async (holds, onRan = () => {}) => {
  const project = folder("proj");
  const worktree = join(project, ".git", "filament-worktrees", "sa_1");
  mkdirSync(worktree, { recursive: true });
  /** @type {string[]} */
  const asked = [];
  /** @type {string[]} */
  const ran = [];
  const commands = ["npm test", "npm test -- --grep b"];
  let n = 0;
  await runAgentTurn(
    /** @type {any} */ ({
      model: "m",
      messages: [{ role: "user", content: "fix it" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false }),
      modeNow: () => "edit",
      root: worktree,
      readerModel: "",
      maxTokens: 100,
      unattended: "worker",
      asker: async (/** @type {any} */ q) => {
        asked.push(String(q.args));
        return { text: "no" };
      },
      call: async () => {
        const c = commands[n++];
        const content = c != null ? [{ type: "tool_use", id: `b${n}`, name: "bash", input: { command: c } }] : [{ type: "text", text: "Done." }];
        return { ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null };
      },
      costOf: () => 0,
      runHand: async (/** @type {string} */ _name, /** @type {any} */ input) => {
        ran.push(String(input.command));
        onRan(String(input.command));
        return "ok";
      },
      delegateRead: null,
      mailbox: null,
      permissions: null,
      rules: [],
      grants: { list: { check: ["npm test"], mayRun: [] }, folder: project, holds },
      fence: { folder: project },
      tree: null,
      onEvent: () => {},
      previewChars: 0,
      sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
      signal: null,
      resume: null,
    }),
  );
  return { asked, ran };
};

// (fails before: yes — the grant ran both commands unasked)
test("a worker's brief grants lift no ask while its agents' device may not run without asking, read at each call", async () => {
  const off = await workerLoop(() => false);
  assert.deepEqual([off.ran, off.asked.length], [[], 2], "both granted commands asked");
  const on = await workerLoop(() => true);
  assert.deepEqual([on.ran, on.asked], [["npm test", "npm test -- --grep b"], []]);
  const grant = { on: true };
  const mid = await workerLoop(
    () => grant.on,
    () => {
      grant.on = false;
    },
  );
  assert.deepEqual([mid.ran, mid.asked.length], [["npm test"], 1], "a switch off between two calls reaches the second");
});

// (fails before: yes — a coding agent's worker ran the command its brief grants after its agents' device's switch went
// off: the coding agent's switch (agent-permits.js) read its grants with no word of the device)
test("a coding agent's worker: its brief grants lift no ask while its agents' device may not run without asking, read at each judgement; a person's chat's worker runs them", () => {
  const project = folder("acp-project");
  const worktree = folder("acp-worktree");
  const grant = { on: false };
  /** @param {(() => boolean) | null} grantsHold */
  const permits = (grantsHold) => createAgentPermits({ rules: [], modeNow: () => "edit", learned: null, confine: worktree, folder: project, grants: /** @type {any} */ ({ check: ["npm test"], mayRun: [] }), agentsDevice: grantsHold !== null, grantsHold });
  const theirs = permits(() => grant.on);
  const run = [{ name: "bash", input: { command: "npm test" } }];
  assert.equal(theirs.judge(run, worktree).verdict, "ask", "off: the grant lifts no ask");
  grant.on = true;
  assert.equal(theirs.judge(run, worktree).verdict, "run", "on: the grant runs it");
  grant.on = false;
  assert.equal(theirs.judge(run, worktree).verdict, "ask", "switched off between two calls: the second asks");
  assert.equal(permits(null).judge(run, worktree).verdict, "run", "a worker of the person's own chat");
});
