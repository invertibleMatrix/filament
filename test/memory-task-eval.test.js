// @ts-check
// The task eval (scripts/memory-task-eval.mjs, docs/memory-evals.md): the driver run end to end on a scripted model —
// three arms of a two-task fixture, each task in a fresh chat of a Filament of its own, corrected where its checks fail,
// scored — and the ledger fixture's checks, each shown to pass on the work it asks for and to fail on work that misses
// it. The live run, on real models, is the script's; the suite stays on scripted ones.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeUpstream, anthropicReply, FAKE_SIDECAR, TEST_ENVIRONMENT } from "./helpers/app.js";
import { LEARN_PROMPT } from "../src/services/memory/learn.js";
import { bootFilament, checkContext, correctionFor, judge, loadFixture, normalizedGain, parseArgs, prepareRepo, providersFor, recallsOf, renderMarkdown, runEval, snapshot, summarize, taskScore, writeReport, NOTES_FILE, NOTES_TEXT, DEFAULT_FIXTURE } from "../scripts/memory-task-eval.mjs";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
const temp = (/** @type {string} */ prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
};

// ---------------------------------------------------------------------------------------------------------------------
// The driver, on a scripted model.
// ---------------------------------------------------------------------------------------------------------------------

/** A fixture of two tasks and one preference — every file the agent writes ends with `-- eval` — corrected in the first. */
const MINI = `const signed = (file) => ({ id: "signed", kind: "pref", pref: "signed", check: (ctx) => /-- eval\\n?$/.test(ctx.read(file) || "") || file + " is not signed", correction: "Every file you write ends with the line \`-- eval\`." });
const word = (file, w) => ({ id: "word", kind: "task", check: (ctx) => (ctx.read(file) || "").startsWith(w) || file + " does not start with " + w, correction: "Put the word " + w + " in " + file + "." });
export const name = "mini";
export const tasks = [
  { id: "m1", title: "alpha", prompt: "Write the word alpha into a.txt.", checks: [word("a.txt", "alpha"), signed("a.txt")] },
  { id: "m2", title: "beta", prompt: "Write the word beta into b.txt.", checks: [word("b.txt", "beta"), signed("b.txt")] },
];
`;
const RULE = "-- eval";

/** A content block list's text, tool results' too. @param {any} c */
const textOf = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b?.type === "text" ? b.text : b?.type === "tool_result" ? JSON.stringify(b.content) : "")).join("\n") : "");
/** The system prompt's text. @param {any} b */
const systemOf = (b) => (Array.isArray(b.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b.system || ""));
const isAgent = (/** @type {any} */ b) => (b.tools || []).some((/** @type {any} */ t) => t.name === "write");
const hasMemoryTools = (/** @type {any} */ b) => (b.tools || []).some((/** @type {any} */ t) => /^filament_memory_/.test(String(t.name)));

/**
 * The scripted agent: it writes the word the task names into its file, signed where the rule is anywhere in what it
 * reads — this chat's correction, the notes file in its instructions, or what memory placed in its request. In a folder
 * with the notes file, a correction is noted there: the file read, then written with the rule. The scripted learner
 * files the rule where the session it reads holds it.
 * @param {any} call
 */
function scripted(call) {
  const b = call.body || {};
  const model = String(b.model || "");
  const sys = systemOf(b);
  const msgs = b.messages || [];
  const all = [sys, ...msgs.map((/** @type {any} */ m) => textOf(m.content))].join("\n");
  const usage = { input_tokens: 100, output_tokens: 10 };
  if (!isAgent(b)) {
    const reply = sys.startsWith(LEARN_PROMPT.slice(0, 60))
      ? JSON.stringify({ title: "a task", state: { summary: "done", done: [], open: [], next: [], closed: [], still: [] }, turns: [], items: all.includes(RULE) ? [{ kind: "rule", text: `Every file written ends with the line \`${RULE}\`.`, importance: 0.9, turn: 2 }] : [] })
      : "{}";
    return anthropicReply(reply, { model, usage: { input_tokens: 200, output_tokens: 20 } });
  }
  const said = msgs.findLastIndex((/** @type {any} */ m) => m.role === "user" && !(Array.isArray(m.content) && m.content.some((/** @type {any} */ x) => x?.type === "tool_result")));
  const since = msgs.slice(said + 1).flatMap((/** @type {any} */ m) => (m.role === "assistant" && Array.isArray(m.content) ? m.content.filter((/** @type {any} */ x) => x?.type === "tool_use") : []));
  const notes = sys.includes(NOTES_TEXT.slice(0, 60));
  const correction = said > 0 && textOf(msgs[said].content).includes(RULE);
  const call_ = (/** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id: `toolu_${call.n}_${name}`, name, input });
  if (since.length) {
    const read = since.some((/** @type {any} */ u) => u.name === "read");
    const noted = since.some((/** @type {any} */ u) => u.name === "write" && u.input?.path === NOTES_FILE);
    if (notes && correction && read && !noted) return anthropicReply("", { model, usage, stop: "tool_use", blocks: [call_("write", { path: NOTES_FILE, content: `${NOTES_TEXT}\n- Every file I write ends with the line \`${RULE}\`.\n` })] });
    return anthropicReply("Done.", { model, usage });
  }
  const m = /the word (\w+) into (\S+)\./.exec(textOf(msgs.find((/** @type {any} */ x) => x.role === "user")?.content));
  const blocks = [call_("write", { path: m?.[2] || "x.txt", content: `${m?.[1] || "?"}\n${all.includes(RULE) ? `${RULE}\n` : ""}` })];
  if (notes && correction) blocks.push(call_("read", { path: NOTES_FILE }));
  return anthropicReply("", { model, usage, stop: "tool_use", blocks });
}

test("the driver: each task in a fresh chat per arm, corrected where its checks fail, scored; memory and notes carry the correction to the next task, off does not", async () => {
  const dir = temp("filament-task-eval-mini-");
  mkdirSync(join(dir, "repo"));
  writeFileSync(join(dir, "repo", "README.md"), "# mini\n");
  writeFileSync(join(dir, "tasks.mjs"), MINI);
  const fixture = await loadFixture(dir);
  const up = await fakeUpstream(scripted);
  /** @type {string[]} */
  const said = [];
  try {
    const report = await runEval({
      fixture,
      models: ["brain-a"],
      learner: "brain-learner",
      label: "scripted",
      log: (s) => said.push(s),
      boot: () => ({ dataDir, roots, memory }) =>
        bootFilament({
          dataDir,
          roots,
          upstreams: [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }],
          routes: [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }],
          memory: memory ? { learner: "brain-learner", engine: { command: process.execPath, args: [FAKE_SIDECAR], env: { FAKE_SIDECAR_STATE: join(dataDir, "fake-engine.json") } } } : null,
          environment: TEST_ENVIRONMENT,
        }),
    });
    const cell = (/** @type {string} */ arm) => report.cells.find((c) => c.arm === arm);
    assert.deepEqual(report.cells.map((c) => [c.model, c.arm, c.error ?? null]), [["brain-a", "on", null], ["brain-a", "off", null], ["brain-a", "notes", null]], said.join("\n"));

    // Fresh chats: six tasks, six chats, and each chat's first request carries its task's message alone.
    const chats = report.cells.flatMap((c) => c.tasks.map((/** @type {any} */ t) => t.chat));
    assert.equal(new Set(chats).size, 6);
    const agent = up.received.filter((c) => c.body && isAgent(c.body));
    const firsts = agent.filter((c) => c.body.messages.length === 1).map((c) => textOf(c.body.messages[0].content));
    assert.equal(firsts.filter((t) => t.includes("Write the word alpha into a.txt.")).length, 3);
    assert.equal(firsts.filter((t) => t.includes("Write the word beta into b.txt.")).length, 3);

    // The arms: memory on offers its tools, off and notes none; the notes file rides the notes arm's instructions alone.
    assert.ok(agent.some((c) => hasMemoryTools(c.body)), "memory on: the agent has memory's tools");
    assert.ok(agent.filter((c) => systemOf(c.body).includes(NOTES_TEXT.slice(0, 60))).every((c) => !hasMemoryTools(c.body)), "the notes arm runs with memory off");
    assert.equal(agent.length, report.summary.reduce((/** @type {number} */ a, /** @type {any} */ s) => a + s.rounds, 0), "every agent call is one round of one task");

    // Off: the rule is corrected in both tasks. Notes: noted after the first, kept in the second. On: learned after the
    // first (the session's end), served in the second.
    const t = (/** @type {string} */ arm, /** @type {string} */ id) => cell(arm).tasks.find((/** @type {any} */ x) => x.task === id);
    for (const arm of ["on", "off", "notes"]) {
      assert.deepEqual([t(arm, "m1").firstTry, t(arm, "m1").success, t(arm, "m1").corrections, t(arm, "m1").turns[1].said], [false, true, 1, "Every file you write ends with the line `-- eval`."], arm);
      assert.deepEqual(t(arm, "m1").prefs, [{ id: "signed", pref: "signed", firstTry: false, recall: false, ok: true }], arm);
    }
    assert.deepEqual([t("off", "m2").firstTry, t("off", "m2").corrections, t("off", "m2").prefs[0].recall], [false, 1, true]);
    assert.deepEqual([t("notes", "m2").firstTry, t("notes", "m2").corrections], [true, 0]);
    assert.deepEqual([t("on", "m2").firstTry, t("on", "m2").corrections], [true, 0]);
    assert.ok(readFileSync(join(dir, "repo", "README.md"), "utf8") === "# mini\n", "the fixture itself is left as it is");
    assert.equal(t("on", "m1").between.learned.items, 1, "the session's end: memory learned the correction");
    assert.ok(cell("on").memory.claims.some((/** @type {any} */ c) => c.text.includes(RULE)), JSON.stringify(cell("on").memory.claims));
    assert.ok(cell("on").memory.calls.learn >= 2, JSON.stringify(cell("on").memory.calls));
    for (const arm of ["off", "notes"]) assert.equal(cell(arm).memory, null);

    // Rounds and tokens: each round 100 in and 10 out; memory's own calls 200 and 20 each, the cell's alone.
    const row = (/** @type {string} */ arm) => report.summary.find((/** @type {any} */ s) => s.arm === arm);
    assert.deepEqual(row("off"), { model: "brain-a", arm: "off", tasks: 2, success: 2, firstTry: 0, corrections: 2, rounds: 8, agentTokens: 880, memoryTokens: 0, score: 0.5, recallScore: 0.5, prefRecall: "0/1", gain: null, recallGain: null });
    // The notes arm's correction takes a round more: the file read, then written.
    assert.deepEqual(row("notes"), { model: "brain-a", arm: "notes", tasks: 2, success: 2, firstTry: 1, corrections: 1, rounds: 7, agentTokens: 770, memoryTokens: 0, score: 0.75, recallScore: 1, prefRecall: "1/1", gain: 0.5, recallGain: 1 });
    const on = /** @type {any} */ (row("on"));
    assert.deepEqual({ ...on, memoryTokens: 0 }, { model: "brain-a", arm: "on", tasks: 2, success: 2, firstTry: 1, corrections: 1, rounds: 6, agentTokens: 660, memoryTokens: 0, score: 0.75, recallScore: 1, prefRecall: "1/1", gain: 0.5, recallGain: 1 });
    const memCalls = Object.values(cell("on").memory.calls).reduce((a, b) => a + b, 0);
    assert.equal(on.memoryTokens, memCalls * 220, "memory's own calls, counted apart from the agent's");

    // The report: both files, the page's table.
    const out = writeReport(report, temp("filament-task-eval-out-"), "scripted");
    assert.deepEqual(JSON.parse(readFileSync(out.json, "utf8")).summary, report.summary);
    const md = readFileSync(out.md, "utf8");
    assert.ok(md.includes("| brain-a | notes | 2/2 | 1/2 | 1 | 7 | 770 | 0 | 0.75 | 0.5 | 1 | 1 | 1/1 |"), md);
    assert.ok(md.includes("| m2 | yes | no | 1 | 4 | 440 | ✗ signed |"), md);
  } finally {
    await up.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// The ledger fixture: its checks against its reference work.
// ---------------------------------------------------------------------------------------------------------------------

const REFERENCE = join(DEFAULT_FIXTURE, "reference");
/** Every file of an overlay copied over the folder. @param {string} from @param {string} to */
const overlay = (from, to) => {
  const walk = (/** @type {string} */ at) => {
    for (const name of readdirSync(at)) {
      const p = join(at, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const dest = join(to, relative(from, p));
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(p, dest);
      }
    }
  };
  walk(from);
};

test("the ledger fixture: each check fails before its task, passes on the reference work; naive work does the task and misses every preference", async () => {
  const fixture = await loadFixture(DEFAULT_FIXTURE);
  assert.deepEqual(fixture.tasks.map((t) => t.id), ["t1", "t2", "t3", "t4", "t5", "t6"]);
  const repo = join(temp("filament-task-eval-ledger-"), "repo");
  prepareRepo(fixture.repo, repo, "off");
  for (const task of fixture.tasks) {
    const before = snapshot(repo);
    // Before the work: each task check fails, the tests of a release aside (they pass on a release not yet cut).
    for (const v of await judge(task, checkContext(repo, before)))
      if (v.kind === "task" && !(v.id === "tests" && /^t[46]$/.test(task.id))) assert.equal(v.ok, false, `${task.id} ${v.id} passes before the task`);
    // Naive work, on a copy: the task done, and each of its preferences missed.
    const naive = join(temp("filament-task-eval-naive-"), "repo");
    cpSync(repo, naive, { recursive: true });
    overlay(join(REFERENCE, task.id, "naive"), naive);
    for (const v of await judge(task, checkContext(naive, before))) assert.equal(v.ok, v.kind === "task", `${task.id} naive: ${v.id} ${v.ok ? "passes" : `fails: ${v.why}`}`);
    // The reference work: every check passes.
    overlay(join(REFERENCE, task.id, "good"), repo);
    for (const v of await judge(task, checkContext(repo, before))) assert.ok(v.ok, `${task.id} ${v.id}: ${v.why}`);
  }
  // A test that fails is a failed task.
  writeFileSync(join(repo, "test", "broken.test.js"), 'import { test } from "node:test";\ntest("broken", () => { throw new Error("no"); });\n');
  const last = /** @type {any} */ (fixture.tasks.at(-1));
  assert.deepEqual((await judge(last, checkContext(repo, snapshot(repo)))).find((v) => v.id === "tests")?.ok, false);
});

test("the ledger fixture: each task's prompt and correction words; what a later task recalls", async () => {
  const fixture = await loadFixture(DEFAULT_FIXTURE);
  const recalls = recallsOf(fixture.tasks);
  assert.deepEqual(Object.fromEntries([...recalls].map(([k, v]) => [k, [...v].sort()])), {
    t1: [],
    t2: ["changelog", "jsdoc"],
    t3: ["changelog", "jsdoc"],
    t4: [],
    t5: ["changelog", "error-prefix", "jsdoc", "vendor"],
    t6: ["release-changelog", "release-notes", "release-version"],
  });
  // The repository as it starts says none of it: memory, or the agent's notes, is how a later task knows.
  const repo = snapshot(fixture.repo);
  assert.ok(![...repo.values()].some((t) => /@param|@returns/.test(t)), "no JSDoc to copy");
  assert.ok(![...repo.keys()].some((p) => p.startsWith("release-notes/")), "no release notes to copy");
  assert.ok(!existsSync(join(fixture.repo, NOTES_FILE)), "the notes file is the notes arm's alone");
  for (const t of fixture.tasks) for (const c of t.checks) assert.ok(c.correction.length > 20 && !c.correction.includes("undefined"), `${t.id} ${c.id}`);
});

// ---------------------------------------------------------------------------------------------------------------------
// The scores and the providers.
// ---------------------------------------------------------------------------------------------------------------------

test("scores: a task's score, the normalized gain, the summary of a cell", () => {
  assert.deepEqual([taskScore(true, 0), taskScore(true, 1), taskScore(true, 3), taskScore(false, 0)], [1, 0.5, 0.25, 0]);
  assert.equal(normalizedGain(0.75, 0.5), 0.5);
  assert.equal(normalizedGain(0.25, 0.5), -0.5);
  assert.equal(normalizedGain(1, 0.2), 1);
  assert.equal(normalizedGain(0.9, 1), null, "no room above the baseline");
  assert.equal(normalizedGain(null, 0.5), null);
  const task = (/** @type {string} */ id, /** @type {number} */ score, /** @type {boolean[]} */ recalled) => ({ task: id, success: score > 0, firstTry: score === 1, corrections: score === 1 ? 0 : 1, rounds: 3, score, tokens: { input: 10, output: 1, cacheRead: 5, cacheWrite: 0 }, prefs: recalled.map((ok, i) => ({ id: `p${i}`, pref: `p${i}`, firstTry: ok, recall: true, ok: true })) });
  const rows = summarize([
    { model: "m", arm: "off", tasks: [task("a", 0.5, []), task("b", 0.5, [false])], memory: null },
    { model: "m", arm: "on", tasks: [task("a", 0.5, []), task("b", 1, [true])], memory: { tokens: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0 } } },
  ]);
  assert.deepEqual(rows.map((r) => [r.arm, r.score, r.recallScore, r.prefRecall, r.gain, r.recallGain, r.agentTokens, r.memoryTokens]), [
    ["off", 0.5, 0.5, "0/1", null, null, 32, 0],
    ["on", 0.75, 1, "1/1", 0.5, 1, 32, 10],
  ]);
  assert.ok(renderMarkdown({ label: "x", at: "now", fixture: "f", commit: "c", learner: "l", maxCorrections: 2, summary: rows, cells: [] }).includes("| m | on | 2/2 | 1/2 | 1 | 6 | 32 | 10 | 0.75 | 0.5 | 1 | 1 | 1/1 |"));
});

test("a correction: the failed check's words alone, or each as an item", () => {
  const task = { id: "t", title: "t", prompt: "p", checks: [{ id: "a", kind: "task", check: () => true, correction: "Do a." }, { id: "b", kind: "pref", pref: "b", check: () => true, correction: "Do b." }] };
  assert.equal(correctionFor(/** @type {any} */ (task), [{ id: "a", ok: true }, { id: "b", ok: false }]), "Do b.");
  assert.equal(correctionFor(/** @type {any} */ (task), [{ id: "b", ok: false }, { id: "a", ok: false }]), "- Do a.\n- Do b.");
});

test("providers: the routes that answer the names, in the config's order, without backups, and their upstreams alone", () => {
  const cfg = {
    upstreams: ["a", "z", "x", "o", "b"].map((id) => ({ id, name: id, type: "openai", baseUrl: `https://${id}.example`, apiKey: `key-${id}`, enabled: true })),
    routes: [
      { match: "claude-*", upstream: "a", upstreamModel: "{model}", enabled: true },
      { match: "grok-*", upstream: "x", upstreamModel: "{model}", enabled: false },
      { match: "zai/*", upstream: "z", upstreamModel: "{1}", enabled: true, fallbacks: [{ upstream: "b", model: "b-1" }] },
      { match: "grok-*", upstream: "x", upstreamModel: "{model}", enabled: true },
    ],
  };
  const p = providersFor(cfg, ["zai/glm-5.3", "grok-4.6", "zai/glm-5.3-flash"]);
  assert.deepEqual(p.routes, [
    { match: "zai/*", upstream: "z", upstreamModel: "{1}", enabled: true, fallbacks: [] },
    { match: "grok-*", upstream: "x", upstreamModel: "{model}", enabled: true, fallbacks: [] },
  ]);
  assert.deepEqual(p.upstreams.map((u) => [u.id, u.apiKey]), [["z", "key-z"], ["x", "key-x"]]);
  assert.throws(() => providersFor(cfg, ["gpt-9"]), /no route answers gpt-9/);
});

test("the command line's words", () => {
  assert.deepEqual(parseArgs(["--models", "a,b", "--keep", "--corrections", "1", "loose"]), { models: "a,b", keep: true, corrections: "1" });
});
