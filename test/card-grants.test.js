// @ts-check
// HarnessV4_Tasks decision 21, AG-267: a saved agent's card may carry commands it runs without asking where it works in
// its own copy — a team's brief's may_run on the card, whoever calls it: the developer, the main agent, or itself. The
// card's field is checked as a brief's entries are (never an install, a step that cannot be undone, a bare program
// name); a card that only reads has none; at a launch they hold only in its own copy, beside a team's brief's; the
// record and the agent's note say whose grant a command ran on. What wins over a brief's grant wins over a card's too
// (test/brief-grants.test.js).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { cardRunsProblem, grantFor, grantedBy, grantsNote, withCardRuns } from "../src/app/agent/grants.js";
import { createAgentPermits } from "../src/app/agent-permits.js";
import { createAgentCardStore, AGENT_CARDS_FILE } from "../src/services/agent-cards.js";
import { SHELL } from "../src/adapters/tools/shell.js";
import { until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** @param {string} prefix */
const temp = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
};
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
/** A repository with one committed file. */
const repo = () => {
  const dir = temp("filament-cardgrants-");
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "parse.js"), "export const parse = (s) => s.split(',');\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** @param {() => unknown} fn @param {number} status @param {RegExp} re */
const refuses = (fn, status, re) =>
  assert.throws(fn, (/** @type {any} */ e) => {
    assert.equal(e.status, status, e.message);
    assert.match(e.message, re);
    return true;
  });

/**
 * How long a wait on a launched worker is given: its own copy is a git worktree made for it, which a full suite's load
 * spreads over many times the second it takes alone.
 */
const WORK = { timeoutMs: 60_000 };

const TESTER = { tag: "mytester", name: "My Tester", goodFor: "Runs the tests", thinks: "You run the tests.", may: "edit" };

// ---- the card's field --------------------------------------------------------------------------------------------

// (fails before: yes — a card had no commands of its own: mayRun was an unknown field)
test("a worker's card keeps the commands it runs without asking: saved, read back, carried by a copy, cleared by an edit", () => {
  const dir = temp("filament-cardgrants-store-");
  const store = createAgentCardStore({ dataDir: dir, runsProblem: cardRunsProblem });
  const mine = store.create({ ...TESTER, mayRun: [" npm test ", "node --test test/money.test.js", "npm test", ""] });
  assert.deepEqual(mine.mayRun, ["npm test", "node --test test/money.test.js"], "trimmed, blanks and repeats left out");
  assert.deepEqual(JSON.parse(readFileSync(join(dir, AGENT_CARDS_FILE), "utf8")).agents.mytester.mayRun, ["npm test", "node --test test/money.test.js"]);
  assert.deepEqual(createAgentCardStore({ dataDir: dir, runsProblem: cardRunsProblem }).find("mytester")?.mayRun, ["npm test", "node --test test/money.test.js"], "read back by a new store");
  assert.deepEqual(store.create({ from: "mytester", tag: "tester2" }).mayRun, ["npm test", "node --test test/money.test.js"], "a copy carries them");
  assert.deepEqual(store.update("mytester", { mayRun: [] }).mayRun, []);
  assert.deepEqual(store.find("builder")?.mayRun, [], "a shipped card has none");
  assert.deepEqual(store.find("product")?.mayRun, []);
});

// (fails before: yes — nothing checked a card's commands)
test("what a card's commands may not be, in words: an install, a step that cannot be undone, a bare program, two commands in one; and one that only reads has none", () => {
  const store = createAgentCardStore({ dataDir: null, runsProblem: cardRunsProblem });
  refuses(() => store.create({ ...TESTER, mayRun: ["npm install left-pad"] }), 400, /^`npm install left-pad` installs packages, and a worker's worktree uses your folder's installed ones: leave it out/);
  refuses(() => store.create({ ...TESTER, mayRun: ["git push origin main"] }), 400, /^`git push origin main` is a step that cannot be undone \(/);
  refuses(() => store.create({ ...TESTER, mayRun: ["rm -rf node_modules"] }), 400, /^`rm -rf node_modules` is a step that cannot be undone \(/);
  refuses(() => store.create({ ...TESTER, mayRun: ["npm"] }), 400, /^`npm` is a bare program name, which would let the worker run anything with it/);
  refuses(() => store.create({ ...TESTER, mayRun: ["npm test && npm run lint"] }), 400, /^`npm test && npm run lint` is more than one command: give each its own entry\.$/);
  refuses(() => store.create({ ...TESTER, mayRun: "npm test" }), 400, /^mayRun must be a list of commands, each as the agent types it/);
  refuses(() => store.create({ ...TESTER, mayRun: ["npm test\nnpm run lint"] }), 400, /^Each command the agent runs without asking is one line\.$/);
  refuses(() => store.create({ ...TESTER, may: "read", mayRun: ["npm test"] }), 400, /^My Tester only reads, so it runs no commands of its own: they run in its own copy of the project\. Let it run in its own copy, or leave its commands out\.$/);
  store.create({ ...TESTER, mayRun: ["npm test"] });
  refuses(() => store.update("mytester", { may: "read" }), 400, /only reads, so it runs no commands of its own/);
  assert.equal(store.update("mytester", { may: "read", mayRun: [] }).may, "read", "with its commands left out, it may only read");
  assert.equal(store.create({ ...TESTER, tag: "copier", may: "copy", mayRun: ["npm test"] }).may, "copy", "a card in a copy that keeps nothing runs them too");
});

// ---- whose grant ---------------------------------------------------------------------------------------------------

// (fails before: yes — only a brief granted, and the words named the brief alone)
test("a card's commands grant as a brief's may_run does, beside it; the record and the note say whose each is", () => {
  assert.equal(withCardRuns([], null), null);
  assert.equal(withCardRuns(undefined, null), null);
  const brief = { check: ["npm run build"], mayRun: ["npx tsc"] };
  assert.equal(withCardRuns([" "], brief), brief, "no commands of its own: the brief's alone");
  assert.deepEqual(withCardRuns(["npm test"], null), { check: [], mayRun: [], card: ["npm test"] });
  const both = withCardRuns(["npm test"], brief);
  assert.deepEqual(both, { check: ["npm run build"], mayRun: ["npx tsc"], card: ["npm test"] }, "a team's brief adds its grants to its worker's card's");
  const place = { at: { root: tmpdir(), shell: SHELL.kind }, readsOnly: () => ({ ok: false }), outside: () => false };
  const used = grantFor(/** @type {any} */ (both), "npx tsc --noEmit && npm test -- --grep money", "bash", place);
  assert.deepEqual(used, ["npx tsc", "npm test"]);
  assert.equal(grantedBy(/** @type {any} */ (both), /** @type {string[]} */ (used)), "its card's grant `npm test` and its brief's grant `npx tsc`");
  assert.equal(grantedBy({ check: [], mayRun: [], card: ["npm test", "npx tsc"] }, ["npm test", "npx tsc"]), "its card's grants `npm test` and `npx tsc`");
  assert.equal(grantedBy(brief, ["npx tsc"]), "its brief's grant `npx tsc`");
  assert.equal(grantFor({ check: [], mayRun: [], card: ["npm test"] }, "npm install x", "bash", place), null, "never an install, whoever grants");
  // (fails before: yes — AG-268: it said anything else asks as usual, and nobody is asked for a card the main agent
  // called or that started by itself: the drive of 10-14 saw one refused, as it should be, under those words)
  assert.equal(
    grantsNote({ check: [], mayRun: [], card: ["npm test"] }),
    "[Filament: your card lets you run these commands in your worktree without waiting for anyone's answer — each as written, or followed by more words: `npm test`. Anything else follows the session's mode and the developer's rules, as it would without these.]",
  );
  assert.equal(
    grantsNote(/** @type {any} */ (both)),
    "[Filament: your card and your lead's brief let you run these commands in your worktree without waiting for anyone's answer — each as written, or followed by more words: `npm run build`, `npx tsc`, `npm test`. Anything else follows the session's mode and the developer's rules, as it would without these. When you report, Filament runs your check — `npm run build` — in your worktree before your lead hears of it; if it fails, its output comes back to you.]",
  );
});

// (fails before: yes — the switch's record said "its brief's" of every grant)
test("a coding agent in its own copy: the switch runs a card's command and says it ran on its card's grant", () => {
  const F = temp("filament-cardgrants-proj-");
  const W = join(F, ".git", "filament-worktrees", "sa_1");
  const permits = createAgentPermits({ rules: [], modeNow: () => /** @type {any} */ ("edit"), learned: null, confine: W, folder: F, grants: { check: [], mayRun: [], card: ["npm test"] } });
  assert.deepEqual(permits.judge([{ name: "bash", input: { command: "npm test -- --grep money" } }], W), { verdict: "run", mode: "edit", notes: [], how: "ran on its card's grant `npm test`" });
  assert.equal(permits.judge([{ name: "bash", input: { command: "npm run lint" } }], W).verdict, "ask");
});

// ---- the launch ----------------------------------------------------------------------------------------------------

/**
 * A registry over `dir` and a card store, whose host serves each run at once — what it was sent and what `hostOf`
 * gave it are kept — and finishes it with "Done.". `threads`: where the session keeps its sub-agents' threads.
 * @param {string} dir @param {ReturnType<typeof createAgentCardStore>} cards @param {{ threads?: Map<string, any[]> | null }} [o]
 */
const registryOn = (dir, cards, { threads = null } = {}) => {
  /** @type {{ body: any, host: any }[]} */
  const posts = [];
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (/** @type {string} */ tag) => cards.find(tag),
      settings: () => ({ subagents: { pool: [{ model: "", seats: 8 }] }, loop: { permissions: "edit" } }),
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
  return { registry, posts };
};
/** The texts of a run's first message. @param {any} body @returns {string[]} */
const opened = (body) => body.messages[0].content.map((/** @type {any} */ b) => String(b.text));
const CARD_NOTE = "[Filament: your card lets you run these commands in your worktree";

// (fails before: yes — a card launched in its own copy ran every command under the session's mode alone)
test("a card launched in its own copy reads what its card lets it run, and its host carries the grant; lowered to read, or in a folder that is no repository, it has none", async () => {
  const cards = createAgentCardStore({ dataDir: null, runsProblem: cardRunsProblem });
  cards.create({ ...TESTER, mayRun: ["npm test"] });
  const dir = repo();
  const { registry, posts } = registryOn(dir, cards);
  const r = registry.launch({ origin: "owner", chainId: "c1", prompt: "run the parser's tests", as: "mytester" });
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  await until(() => posts.length >= 1, "its run", WORK);
  assert.ok(opened(posts[0].body).includes(`${CARD_NOTE} without waiting for anyone's answer — each as written, or followed by more words: \`npm test\`. Anything else follows the session's mode and the developer's rules, as it would without these.]`), opened(posts[0].body).join("\n---\n"));
  assert.ok(posts[0].host.workdir, "its own copy");
  assert.deepEqual(posts[0].host.grants, { check: [], mayRun: [], card: ["npm test"] });
  await until(() => registry.get(/** @type {any} */ (r).id)?.status === "done", "its report", WORK);
  // The same card, called to only read: no copy, so nothing of its card's runs without asking.
  const low = registry.launch({ origin: "owner", chainId: "c1", prompt: "read the parser", as: "mytester", may: "read" });
  assert.equal(low.ok, true, low.ok ? "" : low.error);
  await until(() => posts.length >= 2, "its run", WORK);
  assert.equal(opened(posts[1].body).some((t) => t.startsWith(CARD_NOTE)), false);
  assert.equal(posts[1].host.grants, null);
  // A folder that is no repository has no copy to give: the session's mode alone.
  const plain = registryOn(temp("filament-cardgrants-plain-"), cards);
  const p = plain.registry.launch({ origin: "owner", chainId: "c1", prompt: "run the tests", as: "mytester" });
  assert.equal(p.ok, true, p.ok ? "" : p.error);
  await until(() => plain.posts.length >= 1, "its run", WORK);
  assert.equal(opened(plain.posts[0].body).some((t) => t.startsWith(CARD_NOTE)), false);
  assert.equal(plain.posts[0].host.grants, null);
});

// (fails before: yes — a thread kept a brief's grants alone)
test("a card's grant is kept with its thread: after a restart its next message in its own copy reads it again", async () => {
  const cards = createAgentCardStore({ dataDir: null, runsProblem: cardRunsProblem });
  cards.create({ ...TESTER, mayRun: ["npm test"] });
  const dir = repo();
  /** @type {Map<string, any[]>} */
  const threads = new Map();
  const before = registryOn(dir, cards, { threads });
  const r = before.registry.launch({ origin: "owner", chainId: "c1", prompt: "run the parser's tests", as: "mytester" });
  const id = String(/** @type {any} */ (r).id);
  await until(() => before.registry.get(id)?.status === "done", "its report", WORK);
  assert.deepEqual(threads.get("c1")?.find((t) => t.id === id)?.grants, { check: [], mayRun: [], card: ["npm test"] });
  const again = registryOn(dir, cards, { threads });
  const f = again.registry.followUp(id, { prompt: "and the money tests", chainId: "c1", by: "owner" });
  assert.equal(f.ok, true, f.ok ? "" : f.error);
  await until(() => again.posts.length >= 1, "its next run", WORK);
  assert.ok(opened(again.posts[0].body).some((t) => t.startsWith(CARD_NOTE)), opened(again.posts[0].body).join("\n---\n"));
  assert.deepEqual(again.posts[0].host.grants, { check: [], mayRun: [], card: ["npm test"] });
  await until(() => again.registry.get(id)?.status === "done", "its second report", WORK);
});
