// @ts-check
// What is still open in a chat as a summary takes the place of its turns (the owner's plan of 11-02, Phase 4): the
// lines — the commands running, oldest first, the sub-agents working and those whose work waits, the come-back —, the
// block they ride last in, and how a chat stands now for its main agent and for a sub-agent. The loop's fold is
// agent-loop.test.js's, a summary of the chat's compactor.test.js's.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/services/memory/archive.js";
import { OPEN_MOST, stillOpenLines, stillOpenOf } from "../src/app/agent/still-open.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { until } from "./helpers/wait.js";
import { blockPlan, reattachBlock } from "../src/app/sessions/reattach.js";
import { cancelComeBack, comeBackLater, disposeBackgroundShells, disposeSpills, startCommandShell, stopShell } from "../src/adapters/tools/hands.js";

after(async () => {
  await disposeBackgroundShells();
  disposeSpills();
});

const NOW = 1_800_000_000_000;
/** What the block's lead asks of the agent where something is open (the owner's of 11-09). */
const THROUGH = "Go through what was open now: apply a change that waits or leave it, follow up a sub-agent or leave it, and dismiss a line that no longer holds with Filament's envelope tool (dismiss: the ids in brackets), which Filament then stops saying.";
/** A running command, as the shells' registry says it. @param {string} id @param {string | null} agent @param {number} minutes @param {string} [command] */
const shell = (id, agent, minutes, command = "npm run dev") => ({ id, command, cwd: "/p", startedAt: NOW - minutes * 60_000, agent, out: "", produced: 0, logPath: null });

// (fails before: yes — nothing said what was still open)
test("the lines: the main agent's every command, oldest first, another agent's named; a sub-agent's own alone; agents working, then waiting", () => {
  const shells = [shell("bg_b", null, 3, "npm test -- --watch"), shell("bg_a", "subagent:sa_00000001", 12)];
  const agents = [
    { id: "sa_1", description: "find the\nparser", running: true, files: 0 },
    { id: "sa_2", description: "", running: false, files: 1 },
    { id: "sa_3", description: "add export", running: false, files: 3 },
    { id: "sa_4", description: "nothing waits", running: false, files: 0 },
  ];
  assert.deepEqual(stillOpenLines({ shells, agent: null, agents, now: NOW }), [
    "- background command bg_a: `npm run dev` in /p, started by sub-agent sa_00000001, running for 12 min [command:bg_a]",
    "- background command bg_b: `npm test -- --watch` in /p, running for 3 min [command:bg_b]",
    '- sub-agent sa_1 ("find the parser"): still working; its report comes to you [agent:sa_1:working]',
    "- sub-agent sa_2: 1 file of its work waits to be applied [agent:sa_2:waits]",
    '- sub-agent sa_3 ("add export"): 3 files of its work wait to be applied [agent:sa_3:waits]',
  ]);
  assert.deepEqual(stillOpenLines({ shells, agent: "subagent:sa_00000001", now: NOW }), ["- background command bg_a: `npm run dev` in /p, running for 12 min [command:bg_a]"], "a sub-agent's own, not the chat's");
  assert.deepEqual(stillOpenLines({ shells: [], agent: null, now: NOW }), []);
  const many = stillOpenLines({ shells: Array.from({ length: OPEN_MOST + 2 }, (_, i) => shell(`bg_${i}`, null, 1)), agent: null, now: NOW });
  assert.equal(many.length, OPEN_MOST + 1);
  // (fails before: yes — the hunt of 11-02 on Phase 4: past OPEN_MOST the line said how many, and no tool of Filament's
  // loop lists its commands, so the ids it left out were gone)
  assert.equal(many.at(-1), `- and 2 more background commands: bg_${OPEN_MOST}, bg_${OPEN_MOST + 1}`);
  // (fails before: yes — the hunt of 11-02 on Phase 4: a command's secret went into the lines as it was typed, where the
  // session sets no redaction of its own)
  const keyed = stillOpenLines({ shells: [shell("bg_k", null, 2, "OPENAI_API_KEY=sk-abcd1234567890abcdef npm run deploy -- --header 'Authorization: Bearer abcdefghijklmnop1234'")], agent: null, now: NOW });
  assert.deepEqual(keyed, ["- background command bg_k: `OPENAI_API_KEY=sk-abcd… npm run deploy -- --header 'Authorization: Bearer [redacted]'` in /p, running for 2 min [command:bg_k]"]);
});

// (fails before: yes — the block had no part for it)
test("the block: what was open last, said in its lead and outside the room; a plan before it still reads as the block's; nothing open adds nothing", () => {
  const open = ["- background command bg_a: `npm run dev` in /p, running for 12 min"];
  const base = { root: "", rules: [], redact: null, window: 200_000 };
  const b = reattachBlock({ ...base, files: [], plan: [{ text: "ship it", status: "in_progress" }], graph: "t1 parse [running]", room: 0, open });
  assert.equal(b.open, 1);
  assert.equal(
    b.text,
    `[Filament brought these back after the summary: the plan as it stood, the task graph as it stood, and what was still open as the summary was written. What was open still is unless a later message says it ended: read a command's output or stop it by its id rather than starting it again. ${THROUGH}]\n\n<plan>\n- [in_progress] ship it\n</plan>\n\n<tasks>\nt1 parse [running]\n</tasks>\n\n<open>\n${open[0]}\n</open>`,
  );
  assert.deepEqual(blockPlan(b.text), [{ status: "in_progress", text: "ship it" }]);
  assert.match(reattachBlock({ ...base, files: [], plan: null, open }).text, /^\[Filament brought these back after the summary: what was still open as the summary was written\. /);
  assert.deepEqual(reattachBlock({ ...base, files: [], plan: null, open: [] }), { text: "", files: [], plan: false, graph: false, open: 0, tokens: 0 });
  // (fails before: yes — the review of 11-02: the lines skipped the session's redaction, which the files go through)
  const red = reattachBlock({ ...base, redact: (/** @type {string} */ t) => t.replace(/hunter2/g, "[redacted]"), files: [], plan: null, open: ["- background command bg_a: `PASS=hunter2 ./deploy` in /p, running for 1 min"] });
  assert.match(red.text, /PASS=\[redacted\] \.\/deploy/);
  assert.doesNotMatch(red.text, /hunter2/);
});

// (fails before: yes — the owner's "Teams, improved and kept", 11-03: a team's lead after Filament's fold heard its workers
// running and those whose change waits, never those that ended)
test("a team's lead's workers that ended ride last, under the same redaction, its lead saying so; the main agent's block, which has none, is as it was", () => {
  const base = { root: "", rules: [], redact: (/** @type {string} */ t) => t.replace(/hunter2/g, "[redacted]"), window: 200_000, files: [], plan: null };
  const open = ["- sub-agent sa_1 (\"tests\"): still working; its report comes to you"];
  const ended = ['- scout sa_2 ("Map it"): reported — "PASS=hunter2 found"', "To read more of what one of them found, follow it up: worker with its agent_id and prompt."];
  const b = reattachBlock({ ...base, open, ended });
  assert.equal(
    b.text,
    `[Filament brought these back after the summary: what was still open as the summary was written, and your workers of this turn that had ended. What was open still is unless a later message says it ended: read a command's output or stop it by its id rather than starting it again. ${THROUGH}]\n\n<open>\n${open[0]}\n</open>\n\n<ended>\n- scout sa_2 ("Map it"): reported — "PASS=[redacted] found"\n${ended[1]}\n</ended>`,
  );
  assert.match(reattachBlock({ ...base, ended }).text, /^\[Filament brought these back after the summary: your workers of this turn that had ended\.\]\n\n<ended>\n/);
  assert.equal(reattachBlock({ ...base, open, ended: [] }).text, reattachBlock({ ...base, open }).text, "none ended: the block as the main agent's");
});

// (fails before: yes — nothing kept a chat's running commands past Filament's stop)
test("the archive keeps the chats whose commands ran, each with its record, until the record goes", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-shells-running-"));
  const a = new Archive({ file: join(dir, "a.db") });
  try {
    const c = a.chainForKey("k1", { cwd: "H:\\p", client: "harness" });
    a.chainForKey("k2", { cwd: "H:\\p", client: "harness" });
    assert.deepEqual(a.shellsRunning(), []);
    const rows = [{ id: "bg_1", command: "npm run dev", startedAt: 5, agent: null }];
    a.mergeMeta(c.id, { shellsRunning: rows });
    assert.deepEqual(a.shellsRunning(), [{ id: c.id, shells: rows }]);
    a.mergeMeta(c.id, { shellsRunning: undefined });
    assert.deepEqual(a.shellsRunning(), []);
    // (fails before: yes — the review of 11-02: a record that was a bare string threw out of Filament's start)
    a.mergeMeta(c.id, { shellsRunning: "bg_1" });
    assert.deepEqual(a.shellsRunning(), [{ id: c.id, shells: ["bg_1"] }]);
  } finally {
    a.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the review of 11-02: an agent the person asked, whose report stays with them, was said to report
// to the main agent, and a graph task's work, which its runner applies, was offered as waiting for it)
test("the registry's open work: the agents whose reports come to the main agent, and the work that waits for it — not the person's own, a graph task's, or one that starts by itself", async () => {
  /** @type {(() => void)[]} */
  const gates = [];
  /** A kept thread, as a session saves it. @param {number} i @param {Record<string, any>} over @returns {any} */
  const thread = (i, over) => ({
    id: `sa_0000000${i}`, origin: "agent", may: "edit", asked: false, card: { tag: "helper", name: "Helper", kind: "worker", may: "edit", thinks: "" },
    team: null, model: "m", description: `Kept ${i}`, cwd: tmpdir(), mode: null, view: "none", running: false, changes: null, start: null, seen: null,
    memory: false, deliver: true, aside: false, status: "done", startedAt: 1000 + i, shares: null, cut: false, thinking: null, opening: [],
    work: { repo: join(tmpdir(), "no-such-repo"), base: `b${i}`, head: `h${i}`, files: [{ path: "a.txt", added: 1, removed: 0 }, { path: "b.txt", added: 1, removed: 0 }], applied: [] },
    exchanges: [{ prompt: `do ${i}`, description: `Kept ${i}`, by: "agent", runId: `run-k${i}`, status: "done", startedAt: 1000 + i, endedAt: 2000 + i, delivery: "delivered", outcome: { report: "", error: null, ms: 5, rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, wrote: true } }],
    ...over,
  });
  const kept = [thread(1, {}), thread(2, { origin: "owner", deliver: false, aside: true }), thread(3, { task: "t1" }), thread(4, { origin: "self" })];
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }] }, loop: { permissions: "read-only" } }),
      session: () => ({ cwd: tmpdir(), model: "m", projectId: null }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      loadThreads: () => structuredClone(kept),
    },
    call: async ({ headers = {} }) => {
      const id = headers["x-filament-subagent"];
      registry.attach(id, `run-${id}`);
      await new Promise((r) => gates.push(() => r(undefined)));
      registry.finish(id, { status: "done", error: null, report: "done", convo: null, rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "done" }] }, id: `run-${id}`, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  const told = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "look", description: "Told", may: "read" }));
  const aside = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "look too", description: "Aside", may: "read", deliver: false }));
  assert.ok(told.ok && aside.ok, String(told.error || aside.error || ""));
  try {
    await until(() => gates.length === 2, "both to run");
    assert.deepEqual(registry.openWork("c1"), [
      { id: "sa_00000001", description: "Kept 1", running: false, files: 2 },
      { id: told.id, description: "Told", running: true, files: 0 },
    ]);
  } finally {
    for (const go of gates) go();
    await Promise.all([told.done, aside.done]);
  }
});

// (fails before: yes — nothing read how a chat stands)
// (the review of 11-02: a come-back is said no more — the person's Stop and a restart drop one without a word)
test("how it stands: the chat's running command by its id and its registry's agents for the main agent, no come-back; a sub-agent reaches its own commands only", async () => {
  const owner = { session: "c-open", agent: null };
  const s = startCommandShell(`node -e "setTimeout(()=>{},30000)"`, tmpdir(), owner, { onEnd: () => {} });
  comeBackLater("c-open", { seconds: 600, note: "look at the build" });
  try {
    const registry = { openWork: (/** @type {string} */ c) => (c === "c-open" ? [{ id: "sa_9", description: "tests", running: true, files: 0 }] : []) };
    const lines = stillOpenOf({ session: "c-open", agent: null, registry });
    assert.equal(lines.length, 2, lines.join("\n"));
    assert.match(lines[0], new RegExp(`^- background command ${s.id}: \`node -e .+\` in .+, running for \\d+ s \\[command:${s.id}\\]$`));
    assert.equal(lines[1], '- sub-agent sa_9 ("tests"): still working; its report comes to you [agent:sa_9:working]');
    assert.deepEqual(stillOpenOf({ session: "c-open", agent: "subagent:sa_9", registry }), [], "none of its own runs");
    assert.deepEqual(stillOpenOf({ session: "c-other", agent: null, registry }), [], "another chat's are not this one's");
  } finally {
    cancelComeBack("c-open");
    await stopShell(s.id, owner);
  }
});
