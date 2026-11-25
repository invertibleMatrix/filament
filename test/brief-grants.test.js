// @ts-check
// HarnessV3-TaskGraph-v2 TG2-D44 (§13): a team's brief grants what its task needs. Its `check` — the commands that
// prove the task done — and its `may_run` — the others it needs — let a worker in its own worktree run a command they
// cover without anyone's answer: the yes is said once, with the brief, where the task is decided. A grant covers its
// command as written or followed by more words; never an install, a step that cannot be undone, a redirect or a
// substitution, nor a command that reaches the developer's folder; and a deny rule, an ask rule, read-only and the
// fence still win over it. A worker that shares the developer's folder has none, and its launch says so. Cases 10 to
// 15 of §13.7.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { checkBrief, inputRefusal, briefText } from "../src/app/agent/team-tools.js";
import { grantFor } from "../src/app/agent/grants.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor, TEAM_AGENT_TOOL } from "../src/app/agent/tools.js";
import { climbsOut, createAgentPermits, namesOutside } from "../src/app/agent-permits.js";
import { readOnlyCommand } from "../src/adapters/tools/read-only-commands.js";
import { SHELL } from "../src/adapters/tools/shell.js";
import { safeEnv } from "../src/adapters/tools/hands.js";
import { BRIEF, leadOf } from "./helpers/team.js";
import { MEMBERS } from "./helpers/roster.js";
import { until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** A path as a bash command says it. @param {string} p */
const fwd = (p) => p.split(sep).join("/");
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
/** A repository with one committed file. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-grants-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "parse.js"), "export const parse = (s) => s.split(',');\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** A folder that is no repository. */
const plainFolder = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-grants-plain-"));
  made.push(dir);
  return dir;
};
/** The developer's folder and a worker's worktree in it, as Filament places one. */
const places = () => {
  const folder = mkdtempSync(join(tmpdir(), "filament-grants-proj-"));
  made.push(folder);
  const worktree = join(folder, ".git", "filament-worktrees", "sa_1");
  mkdirSync(worktree, { recursive: true });
  return { folder, worktree };
};

/**
 * A team's registry over `dir`, whose host serves each worker's run at once — what it was sent and what `hostOf` gave
 * it are kept — and finishes it with "Done.", and whose check of a worker's report passes (worker-check.test.js runs
 * it). `worktree`: the session's `subagents.worktree`; `rules`: its `loop.rules`; `threads`: where the session keeps
 * its sub-agents' threads, which a registry made again over the same store — a restart — gives back.
 * @param {string} dir @param {{ worktree?: boolean, rules?: any[], threads?: Map<string, any[]> | null }} [o]
 */
const teamOn = (dir, { worktree = true, rules = [], threads = null } = {}) => {
  /** @type {{ body: any, host: any }[]} */
  const posts = [];
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    runCheck: async () => ({ exit: 0, output: "", stopped: false }),
    context: {
      settings: () => ({ subagents: { pool: [{ model: "", seats: 8 }], ...(worktree ? {} : { worktree: false }) }, loop: { permissions: "edit", ...(rules.length ? { rules } : {}) } }),
      session: () => ({ cwd: dir, model: "m-session", projectId: null, client: "harness" }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
      ...(threads
        ? {
            saveThread: (/** @type {string} */ c, /** @type {any} */ t) => threads.set(c, [...(threads.get(c) || []).filter((x) => x.id !== t.id), structuredClone(t)]),
            loadThreads: (/** @type {string} */ c) => structuredClone(threads.get(c) || []),
          }
        : {}),
    },
    call: async ({ body, headers = {} }) => {
      const id = String(headers["x-filament-subagent"]);
      posts.push({ body, host: registry.hostOf(id) });
      const runId = `run-${posts.length}`;
      registry.attach(id, runId);
      registry.finish(id, { status: "done", error: null, report: "Done.", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Done." }] }], rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "Done." }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return { registry, posts, lead: leadOf(registry, dir) };
};
/** The texts of a worker's first message. @param {any} body @returns {string[]} */
const opened = (body) => body.messages[0].content.map((/** @type {any} */ b) => String(b.text));
/**
 * How long a wait on a worker in its own worktree is given: the worktree is made for it before its run and read after
 * its report, git processes a full suite's load spreads over many times the second they take alone.
 */
const WORK = { timeoutMs: 60_000 };

const GRANTED = { ...BRIEF, check: ["npm test"], may_run: ["npx tsc --noEmit"] };

// ---- case 10: the fields' refusals at launch ----------------------------------------------------------------------

// (fails before: yes — a brief had no check and no may_run: the fields were unknown and nothing was refused)
test("the brief's check and may_run are refused in words at launch: more than five checks, an install, a step that cannot be undone, a bare program name, a redirect, a part that hides a failure, two commands in one grant", () => {
  const no = (/** @type {any} */ fields, role = "builder") => checkBrief({ ...BRIEF, role, ...fields }, MEMBERS);
  assert.equal(no({ check: ["a 1", "a 2", "a 3", "a 4", "a 5", "a 6"] }), "check must be one to five commands, the ones that prove the task done");
  assert.equal(no({ check: "npm test" }), "check must be one to five commands, the ones that prove the task done");
  assert.equal(no({ check: ["npm test", " "] }), "check must be one to five commands, the ones that prove the task done");
  assert.equal(no({ may_run: "npx tsc" }), "may_run must be a list of non-empty strings");
  assert.equal(no({ read_first: [""] }), "read_first must be a list of non-empty strings");
  assert.equal(no({ check: ["npm install"] }), "check's `npm install` installs packages, and a worker's worktree uses your folder's installed ones: leave it out — what the task needs installed, the developer installs");
  for (const install of ["npm i left-pad", "npm --prefix sub ci", "pnpm add zod", "yarn", "yarn add zod", "pip install -r requirements.txt", "python -m pip install requests", "uv sync", "poetry add httpx", "cargo add serde", "go get example.com/x", "bundle", "composer require x/y", "sudo apt-get install jq", "brew install jq"])
    assert.match(String(no({ may_run: [install] })), /installs packages, and a worker's worktree uses your folder's installed ones/, install);
  assert.equal(no({ may_run: ["git push"] }), "may_run's `git push` is a step that cannot be undone (a push): leave it out — such a step never runs without a yes");
  assert.equal(no({ check: ["rm -rf dist && npm test"] }), "check's `rm -rf dist && npm test` is a step that cannot be undone (a recursive delete): leave it out — such a step never runs without a yes");
  assert.equal(no({ may_run: ["node"] }), "may_run's `node` is a bare program name, which would let the worker run anything with it: name the command and its first words, as `npm test` or `node --test`");
  assert.equal(no({ may_run: ["npm test > out.txt"] }), "may_run's `npm test > out.txt` redirects or substitutes, which no grant covers: name the command alone");
  assert.equal(no({ check: ["node --test $(ls test)"] }), "check's `node --test $(ls test)` redirects or substitutes, which no grant covers: name the command alone");
  assert.equal(no({ check: ["npm test | tail -20"] }), "check's `npm test | tail -20` joins its parts with |, where a part can fail and the check still pass: join parts with && alone, or give each command its own entry — Filament shows the end of a check's output itself");
  assert.match(String(no({ check: ["npm test || true"] })), /^check's `npm test \|\| true` joins its parts with \|\|, /);
  assert.match(String(no({ check: ["npm run build; npm test"] })), /^check's `npm run build; npm test` joins its parts with ;, /);
  assert.equal(no({ may_run: ["npm test && npm run lint"] }), "may_run's `npm test && npm run lint` is more than one command: give each its own entry");
  // What is fine: a check of one word, parts joined by &&, harmless redirects, and an empty list, which is none.
  assert.equal(no({ check: ["pytest"], may_run: ["npx tsc", "npm run lint 2>&1"] }), null);
  assert.equal(no({ check: ["cd packages/api && npm test 2>&1"] }), null);
  assert.equal(no({ check: [], may_run: [] }), null);
  assert.equal(no({ read_first: ["src/parse.js", "test/"] }), null);
});

// (fails before: yes — the Phase 1 drive's lead wrote may_run entries as words about commands, `node --test (its own
// test file)` and `git diff, git status, git log`: launched, they covered nothing its workers typed, and those asked)
test("an entry that is no command as a shell reads it — words in parentheses, a list of commands — is refused, in words that say how to write it", () => {
  const no = (/** @type {any} */ fields) => checkBrief({ ...BRIEF, role: "builder", ...fields }, MEMBERS);
  assert.equal(no({ may_run: ["node --test (its own test file)"] }), "may_run's `node --test (its own test file)` is no command as a shell runs it — a parenthesis there starts a subshell: write the command itself, as the worker types it (`npm test`, `node --test test/parse.test.js`)");
  assert.match(String(no({ check: ["npm test && node check.js (the slow one)"] })), /^check's `npm test && node check\.js \(the slow one\)` is no command as a shell runs it — /);
  assert.equal(no({ may_run: ["git diff, git status, git log"] }), "may_run's `git diff, git status, git log` is a list of commands: give each its own entry, as the worker types it");
  // Quoted or escaped, a parenthesis or a comma is the command's own; a comma with no blank after it joins one word.
  assert.equal(no({ may_run: ['node -e "console.log(1, 2)"', "git log --format='%h, %s'", "echo \\(x\\)", "node --test a.test.js,b.test.js"] }), null);
});

// (fails before: yes — the fields were unknown, so any member took them)
test("check and may_run are refused for a member that only reads, and check for one whose work is not kept — which may_run alone suits", () => {
  const SANDBOX = [...MEMBERS, { ...MEMBERS[1], tag: "sandbox", name: "Sandbox", may: /** @type {const} */ ("copy"), place: null }];
  assert.equal(checkBrief({ ...BRIEF, role: "scout", may_run: ["npm test"] }, MEMBERS), "check and may_run are for a worker that runs commands in its own worktree, and scout changes nothing");
  assert.equal(checkBrief({ ...BRIEF, role: "reviewer", check: ["npm test"] }, MEMBERS), "check and may_run are for a worker that runs commands in its own worktree, and reviewer changes nothing");
  assert.equal(checkBrief({ ...BRIEF, role: "sandbox", check: ["npm test"] }, SANDBOX), "check is for a worker whose change is kept, and sandbox works in its own copy, where nothing it changes is kept: give its commands in may_run");
  assert.equal(checkBrief({ ...BRIEF, role: "sandbox", may_run: ["npm test"] }, SANDBOX), null);
  assert.equal(checkBrief({ ...BRIEF, role: "scout", check: [], may_run: [] }, MEMBERS), null, "empty lists grant nothing, so they ask nothing of the member");
  // The lead reads the refusal as a launch that did not happen.
  assert.deepEqual(inputRefusal("agent", { ...BRIEF, role: "scout", may_run: ["npm test"] }, { members: MEMBERS })?.text, "Not launched: check and may_run are for a worker that runs commands in its own worktree, and scout changes nothing.");
});

// (fails before: yes — nothing read a grant against the session's folder or its rules)
test("at launch, a grant that names your folder is refused, and so is one a deny rule refuses or an ask rule asks about: a brief lifts no rule", async () => {
  const dir = plainFolder();
  const rules = [
    { tool: "bash", pattern: "npm run deploy*", verdict: "deny" },
    { tool: "bash", pattern: "npm run e2e*", verdict: "ask" },
  ];
  const { lead } = teamOn(dir, { worktree: false, rules });
  const named = await lead.tools.agent(lead.call({ ...BRIEF, check: [`node ${fwd(dir)}/check.js`] }));
  assert.equal(named.ok, false);
  assert.equal(named.text, `Not launched: check's \`node ${fwd(dir)}/check.js\` names your folder (${dir}): the worker runs it in its own worktree, where the same files are at the same paths — use paths relative to the folder.`);
  const denied = await lead.tools.agent(lead.call({ ...BRIEF, may_run: ["npm run deploy -- --prod"] }));
  assert.equal(denied.text, "Not launched: may_run's `npm run deploy -- --prod` is refused by this session's rule bash(npm run deploy*) deny: leave it out.");
  const asks = await lead.tools.agent(lead.call({ ...BRIEF, check: ["npm run e2e"] }));
  assert.equal(asks.text, "Not launched: check's `npm run e2e` asks first by this session's rule bash(npm run e2e*) ask, which a brief does not lift: leave it out.");
  // A path inside a folder that only begins the same is another folder's, and a relative path is the worktree's.
  const fine = await lead.tools.agent(lead.call({ ...BRIEF, check: ["node test/check.js"], may_run: [`node ${fwd(dir)}-other/x.js`] }));
  assert.equal(fine.ok, true, fine.text);
});

// ---- case 11: what a grant covers ---------------------------------------------------------------------------------

// (fails before: yes — there were no grants)
test("a grant covers its command as written or followed by more words; parts each a grant's or only reading, a cd into its own folder and harmless redirects pass — never an install, a step that cannot be undone, a redirect, a substitution, or your folder", () => {
  const { folder: F, worktree: W } = places();
  const place = {
    at: { root: W, shell: SHELL.kind },
    readsOnly: (/** @type {string} */ s) => readOnlyCommand(s, { root: W, shell: SHELL, env: safeEnv() }),
    outside: (/** @type {string} */ c) => namesOutside(c, F, W) || climbsOut(c, F, W, W),
  };
  const grants = { check: ["npm test"], mayRun: ["npx tsc"] };
  const g = (/** @type {string} */ c, gs = grants) => grantFor(gs, c, "bash", place);
  assert.deepEqual(g("npm test"), ["npm test"]);
  assert.deepEqual(g("npm test -- --grep x"), ["npm test"]);
  assert.deepEqual(g(`cd "${fwd(W)}" && npm test 2>&1 | tail -20`), ["npm test"]);
  assert.deepEqual(g("npx tsc --noEmit && npm test"), ["npx tsc", "npm test"]);
  assert.deepEqual(g("npm  test   --  --grep  x"), ["npm test"], "blanks are one blank");
  assert.deepEqual(g("NPM Test"), ["npm test"], "as the rules read a command: case aside");
  assert.deepEqual(g("npm test 2>/dev/null"), ["npm test"]);
  assert.deepEqual(g("npm test >/dev/null 2>&1"), ["npm test"]);
  assert.deepEqual(g("npm test &>/dev/null"), ["npm test"]);
  // The exit code said after it, as the Phase 1 drive's builder ran its check: `$?` reads as its digits.
  assert.deepEqual(g(`cd "${fwd(W)}" && npm test; echo "exit: $?"`), ["npm test"]);
  assert.equal(g('npm test; echo "$HOME"'), null);
  for (const c of [
    "npm testify",
    "npm tes",
    "npm test; rm -rf x",
    "npm test > out.txt",
    "npm test 2>&1 > out.txt",
    "npm test < in.txt",
    "npm test $(echo x)",
    "npm test `echo x`",
    "npm test && npm install left-pad",
    "npm test && sort -o out.txt a.txt",
    `npm test --prefix "${fwd(F)}"`,
    "cd ../../.. && npm test",
    `cd "${fwd(F)}" && npm test`,
    "cd sub && npm test",
    "CI=1 npm test",
    "ls",
    "npm run lint",
  ])
    assert.equal(g(c), null, c);
  // What no grant covers, whatever it says.
  assert.equal(g("git push origin main", { check: [], mayRun: ["git push"] }), null);
  assert.equal(g("npm --prefix sub install left-pad", { check: [], mayRun: ["npm --prefix sub"] }), null);
  assert.equal(g("npm test && git push", { check: ["npm test"], mayRun: ["git push"] }), null);
  // A check of one word covers only itself; a may_run entry always its words followed by more.
  assert.deepEqual(g("pytest", { check: ["pytest"], mayRun: [] }), ["pytest"]);
  assert.equal(g("pytest -k money", { check: ["pytest"], mayRun: [] }), null);
  assert.deepEqual(g("cd packages/api && npm test -- --grep x", { check: ["cd packages/api && npm test"], mayRun: [] }), ["cd packages/api", "npm test"]);
  assert.equal(g("cd packages/api/../../.. && npm test", { check: ["cd packages/api && npm test"], mayRun: [] }), null);
  assert.equal(g("npm test", { check: [], mayRun: [] }), null, "no grants, nothing covered");
  // A second line is a second command to its shell, and a grant read a line break as a blank: `npm test` then covered
  // "npm test node evil.js", its words followed by more (found by d-allow's builder, 11-12: fails before with
  // ['npm test']). A command of more than one line is covered by no grant: it asks.
  for (const c of ["npm test\nnode evil.js", "npm test\r\nnode evil.js", "npm test -- --grep x\nrm -rf src", "npx tsc\nnpm test"]) assert.equal(g(c), null, JSON.stringify(c));
  assert.deepEqual(g("npm test\n"), ["npm test"], "a line break at its end is no second line");
  // PowerShell's own spelling of a cd that stays put, its parts and a harmless redirect.
  assert.deepEqual(grantFor(grants, `Set-Location '${W}'; npm test 2>$null`, "powershell", { ...place, readsOnly: () => ({ ok: false, why: "" }) }), ["npm test"]);
});

// ---- case 12: a loop worker in its worktree -----------------------------------------------------------------------

/**
 * A worker's loop in its worktree, as turn.js hosts one: it calls bash once per command, in order, and then ends; a
 * call that asks is answered "no" and kept. `grants`: its brief's, with the developer's folder; `rules`: the
 * session's; `mode`: the mode in force. A command may be written from the two folders.
 * @param {(string | ((folder: string, worktree: string) => string))[]} commands @param {{ grants?: any, rules?: any[], mode?: string }} [o]
 */
const workerLoop = async (commands, { grants, rules = [], mode = "edit" } = {}) => {
  const { folder, worktree } = places();
  /** @type {string[]} */
  const asked = [];
  /** @type {string[]} */
  const ran = [];
  let n = 0;
  const out = await runAgentTurn(
    /** @type {any} */ ({
      model: "m",
      messages: [{ role: "user", content: "fix it" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false }),
      modeNow: () => mode,
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
        const content = c != null ? [{ type: "tool_use", id: `b${n}`, name: "bash", input: { command: typeof c === "function" ? c(folder, worktree) : c } }] : [{ type: "text", text: "Done." }];
        return { ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null };
      },
      costOf: () => 0,
      runHand: async (/** @type {string} */ _name, /** @type {any} */ input) => {
        ran.push(String(input.command));
        return "12 passing";
      },
      delegateRead: null,
      mailbox: null,
      permissions: null,
      rules,
      grants: grants === undefined ? { list: { check: ["npm test"], mayRun: ["npx tsc"] }, folder } : grants,
      fence: { folder },
      tree: null,
      onEvent: () => {},
      previewChars: 0,
      sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
      signal: null,
      resume: null,
    }),
  );
  return { out, asked, ran, folder };
};

// (fails before: yes — every command a worker ran in Edit mode asked, a test run included)
test("a loop worker in its worktree: a granted command runs without asking and the record names the grant; an ungranted one asks", async () => {
  const w = await workerLoop(["npm test -- --grep money", "npx tsc --noEmit && npm test", "npm run lint"]);
  assert.equal(w.out.status, "done", w.out.notes.join("\n"));
  assert.deepEqual(w.ran, ["npm test -- --grep money", "npx tsc --noEmit && npm test"]);
  assert.deepEqual(w.asked, ["npm run lint"]);
  assert.ok(w.out.notes.includes("agent: bash ran on its brief's grant `npm test`"), w.out.notes.join("\n"));
  assert.ok(w.out.notes.includes("agent: bash ran on its brief's grants `npx tsc` and `npm test`"), w.out.notes.join("\n"));
});

// (fails before: yes — AG-267: the record called every grant its brief's, and a card granted nothing)
test("a loop agent whose card grants a command: it runs without asking, and the record names its card's grant", async () => {
  const w = await workerLoop(["npm test -- --grep money", "npx tsc --noEmit"], { grants: { list: { check: [], mayRun: [], card: ["npm test"] }, folder: plainFolder() } });
  assert.equal(w.out.status, "done", w.out.notes.join("\n"));
  assert.deepEqual([w.ran, w.asked], [["npm test -- --grep money"], ["npx tsc --noEmit"]]);
  assert.ok(w.out.notes.includes("agent: bash ran on its card's grant `npm test`"), w.out.notes.join("\n"));
});

// (fails before: no — a guard: what wins over a grant still wins; a command that reaches your folder asked before
// TG2-D55's drive, and Filament's fence refuses it now, as a coding agent's worker's)
test("over a grant, a deny rule refuses, an ask rule asks, read-only refuses, the fence refuses what reaches your folder, and with no grants it asks; Full access runs it as before", async () => {
  const denied = await workerLoop(["npm test"], { rules: [{ tool: "bash", pattern: "npm test*", verdict: "deny" }] });
  assert.deepEqual([denied.ran, denied.asked], [[], []]);
  assert.ok(denied.out.notes.includes("agent: bash refused by the rule bash(npm test*) deny"), denied.out.notes.join("\n"));
  const ruled = await workerLoop(["npm test"], { rules: [{ tool: "bash", pattern: "npm test*", verdict: "ask" }] });
  assert.deepEqual([ruled.ran, ruled.asked], [[], ["npm test"]]);
  const readOnly = await workerLoop(["npm test"], { mode: "read-only" });
  assert.deepEqual([readOnly.ran, readOnly.asked], [[], []]);
  assert.ok(readOnly.out.notes.includes("agent: bash refused (read-only mode)"), readOnly.out.notes.join("\n"));
  const outside = await workerLoop([(/** @type {string} */ folder) => `npm test --prefix "${fwd(folder)}"`]);
  assert.deepEqual([outside.ran, outside.asked], [[], []]);
  assert.ok(outside.out.notes.some((n) => n.startsWith(`agent: bash refused — its command reaches the developer's folder (${outside.folder})`)), outside.out.notes.join("\n"));
  const none = await workerLoop(["npm test"], { grants: null });
  assert.deepEqual([none.ran, none.asked], [[], ["npm test"]]);
  const full = await workerLoop(["npm test"], { mode: "auto" });
  assert.deepEqual(full.ran, ["npm test"]);
  assert.equal(full.out.notes.some((n) => n.includes("grant")), false, "the mode ran it: no grant was needed");
});

// ---- case 13: a coding agent's worker, by the session's switch ----------------------------------------------------

// (fails before: yes — the switch asked about every command a worker's agent ran)
test("a coding agent's worker: the switch runs a granted command and says so; the fence still refuses one that reaches your folder, and the rules and read-only still win", () => {
  const { folder: F, worktree: W } = places();
  const held = (/** @type {string} */ mode, /** @type {{ rules?: any[], confine?: string | null }} */ { rules = [], confine = W } = {}) =>
    createAgentPermits({ rules, modeNow: () => /** @type {any} */ (mode), learned: null, confine, folder: confine ? F : null, grants: { check: ["npm test"], mayRun: [] } });
  const bash = (/** @type {string} */ command) => [{ name: "bash", input: { command } }];
  assert.deepEqual(held("edit").judge(bash("npm test -- --grep money"), W), { verdict: "run", mode: "edit", notes: [], how: "ran on its brief's grant `npm test`" });
  assert.equal(held("edit").judge(bash("npm run lint"), W).verdict, "ask");
  assert.equal(held("edit").judge(bash(`npm test --prefix "${fwd(F)}"`), W).verdict, "refuse", "the fence, before any grant");
  assert.equal(held("edit").judge(bash("cd ../../.. && npm test"), W).verdict, "refuse");
  assert.deepEqual(held("edit", { rules: [{ tool: "bash", pattern: "npm test*", verdict: "deny" }] }).judge(bash("npm test"), W).how, "refused by the rule bash(npm test*) deny");
  assert.equal(held("edit", { rules: [{ tool: "bash", pattern: "npm test*", verdict: "ask" }] }).judge(bash("npm test"), W).verdict, "ask");
  assert.equal(held("auto", { rules: [{ tool: "bash", pattern: "npm test*", verdict: "ask" }] }).judge(bash("npm test"), W).how, "asked: the rule bash(npm test*) ask asks first", "where only the rule asks");
  assert.equal(held("read-only").judge(bash("npm test"), W).verdict, "refuse");
  // A worker held to no worktree has no grant: the turn passes none, and the switch reads none without one.
  assert.equal(held("edit", { confine: null }).judge(bash("npm test"), W).verdict, "ask");
});

// ---- cases 14 and 15: who gets grants, and what the worker reads --------------------------------------------------

// (fails before: yes — the launch said nothing of grants, and the worker read nothing of them)
test("a worker in its own worktree: the launch names what it may run and its check, the worker reads Filament's note and a brief with Read first and Check, and its host carries the grants", async () => {
  const dir = repo();
  const { registry, posts, lead } = teamOn(dir);
  const r = await lead.tools.agent(lead.call({ ...GRANTED, read_first: ["parse.js"], dont_touch: ["README.md"] }));
  assert.equal(r.ok, true, r.text);
  assert.match(r.text, /^Launched builder sa_[0-9a-f]{8} \("Fix the parser"\) in the background\. It may run without asking, in its worktree: `npm test`, `npx tsc --noEmit`; Filament runs its check — `npm test` — once it reports\. Keep working: /);
  await until(() => posts.length >= 1, "the worker's run", WORK);
  const texts = opened(posts[0].body);
  assert.ok(
    texts.includes("[Filament: your lead's brief lets you run these commands in your worktree without waiting for anyone's answer — each as written, or followed by more words: `npm test`, `npx tsc --noEmit`. Anything else follows the session's mode and the developer's rules, as it would without these. When you report, Filament runs your check — `npm test` — in your worktree before your lead hears of it; if it fails, its output comes back to you.]"),
    texts.join("\n---\n"),
  );
  assert.equal(texts.at(-1), "Your task: Fix the parser\n\nGoal: parse() accepts an empty file\n\nRead first, before you plan:\n- parse.js\n\nSteps:\n1. Return [] for an empty input\n\nAcceptance check: the parser's tests pass\n\nCheck:\n- npm test\n\nDo not touch:\n- README.md");
  assert.ok(texts.indexOf(texts.find((t) => t.startsWith("[Filament: your lead's brief")) || "") > texts.indexOf(texts.find((t) => t.startsWith("[Filament: you work in your own git worktree")) || ""), "after the worktree's note");
  assert.deepEqual(posts[0].host.grants, { check: ["npm test"], mayRun: ["npx tsc --noEmit"] });
  assert.ok(posts[0].host.workdir);
  await until(() => registry.get(String(r.agentId))?.status === "done", "its report", WORK);
});

// (fails before: yes — the launch claimed nothing, and nothing kept a worker in your folder from what a grant would let it run)
test("a worker that shares your folder has no grants: its launch says so, it reads no grant, and its host carries none — in a folder that is no repository, the worker reads none either", async () => {
  const shared = teamOn(plainFolder(), { worktree: false });
  const r = await shared.lead.tools.agent(shared.lead.call(GRANTED));
  assert.equal(r.ok, true, r.text);
  assert.match(r.text, /in the background\. Its brief's check and may_run do nothing here: it works in your folder, not a worktree of its own, so its commands ask as any do, and Filament runs no check\. Keep working: /);
  await until(() => shared.posts.length >= 1, "the worker's run");
  assert.equal(opened(shared.posts[0].body).some((t) => t.includes("your lead's brief lets you run")), false);
  assert.equal(shared.posts[0].host.grants, null);
  const onlyMayRun = await shared.lead.tools.agent(shared.lead.call({ ...BRIEF, may_run: ["npx tsc"] }));
  assert.match(onlyMayRun.text, /in the background\. Its brief's may_run does nothing here: it works in your folder, not a worktree of its own, so its commands ask as any do\. Keep working: /);
  // Worktrees on, but there is no repository to make one of: the worker shares the folder after all.
  const none = teamOn(plainFolder());
  const n = await none.lead.tools.agent(none.lead.call(GRANTED));
  assert.equal(n.ok, true, n.text);
  await until(() => none.posts.length >= 1, "the worker's run");
  assert.equal(none.posts[0].host.workdir, null);
  assert.equal(none.posts[0].host.grants, null);
  assert.equal(opened(none.posts[0].body).some((t) => t.includes("your lead's brief lets you run")), false);
});

// (fails before: yes — a worker's thread kept nothing of its grants)
test("a worker's grants are kept with its thread: given back after a restart, its next message in its worktree reads them again, and its host carries them", async () => {
  const dir = repo();
  /** @type {Map<string, any[]>} */
  const threads = new Map();
  const before = teamOn(dir, { threads });
  const r = await before.lead.tools.agent(before.lead.call(GRANTED));
  const id = String(r.agentId);
  await until(() => before.registry.get(id)?.status === "done", "its report", WORK);
  assert.deepEqual(threads.get("c1")?.find((t) => t.id === id)?.grants, { check: ["npm test"], mayRun: ["npx tsc --noEmit"] });
  // Filament restarts: the same session's record, a registry made again.
  const after = teamOn(dir, { threads });
  const again = after.registry.followUp(id, { prompt: "Also accept a file of blanks", chainId: "c1", by: "owner" });
  assert.equal(again.ok, true, again.ok ? "" : again.error);
  await until(() => after.posts.length >= 1, "its next run", WORK);
  assert.ok(opened(after.posts[0].body).some((t) => t.startsWith("[Filament: your lead's brief lets you run these commands in your worktree")), opened(after.posts[0].body).join("\n---\n"));
  assert.deepEqual(after.posts[0].host.grants, { check: ["npm test"], mayRun: ["npx tsc --noEmit"] });
  await until(() => after.registry.get(id)?.status === "done", "its second report", WORK);
});

// (fails before: yes — the brief had neither part)
test("the brief: Read first after the goal, Check after the acceptance check, each left out when the brief gives none", () => {
  assert.equal(briefText(BRIEF), "Your task: Fix the parser\n\nGoal: parse() accepts an empty file\n\nSteps:\n1. Return [] for an empty input\n\nAcceptance check: the parser's tests pass");
  assert.equal(
    briefText({ ...BRIEF, read_first: ["src/money.js", "test/money.test.js"], files: ["src/parse.js"], check: ["npm run build", "npm test"], may_run: ["npx tsc"] }),
    "Your task: Fix the parser\n\nGoal: parse() accepts an empty file\n\nRead first, before you plan:\n- src/money.js\n- test/money.test.js\n\nFiles:\n- src/parse.js\n\nSteps:\n1. Return [] for an empty input\n\nAcceptance check: the parser's tests pass\n\nCheck:\n- npm run build\n- npm test",
  );
});

// (fails before: yes — the agent tool had no such fields)
test("the lead's agent tool has read_first, check and may_run, in the words §13.5 gives", () => {
  const p = /** @type {any} */ (TEAM_AGENT_TOOL.input_schema.properties);
  // plan_review since TG2-D50 (test/plan-review.test.js), attempts since TG2-D53 (test/attempts.test.js), the worker's
  // model, provider, effort and list_models since HarnessV4_Tasks E23-D9 (test/subagent-lists.test.js).
  assert.deepEqual(Object.keys(p), ["role", "description", "model", "provider", "effort", "goal", "read_first", "files", "steps", "acceptance", "check", "may_run", "dont_touch", "context", "plan_review", "attempts", "review", "list_models"]);
  assert.equal(p.read_first.description, "The files or folders the worker reads before it plans, relative to the working folder: the code to imitate, the interfaces to keep.");
  assert.equal(p.check.description, "One to five commands that prove the task done, as they run in the worker's folder (npm test, node test/money.test.js). The worker may run them without asking, and Filament runs them itself once it reports: a failing check goes back to the worker, twice at most, before you hear.");
  assert.deepEqual([p.check.minItems, p.check.maxItems], [1, 5]);
  assert.equal(p.may_run.description, "Other commands the worker may run in its own worktree without anyone's answer, each a command and its first words at least (npm run lint, npm run typecheck): the same followed by more words runs too. Never an install, nor a step that cannot be undone.");
});
