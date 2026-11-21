// @ts-check
// The observation bus and the pitfall miner (HarnessV3-Memory M5-4, MD-22): what agents' tool calls did, read off the
// request path; a command that failed and then worked set up another way is a pitfall seen, filed inferred, and armed
// when another session sees it too. Driven here on a proxied client's tool-result legs; the harness loop's own
// producer in agent-pitfalls.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ObservationBus, BUS_LIMIT, PitfallMiner, fixOf, errorLine, commandMissing, carriesSecret } from "../src/services/memory/observe.js";
import { world } from "./fixtures/memory-world.mjs";

/** The person's rule of MD-14, as the agent keeps it or their @mem rule files it (the memory plan's d3). */
const MD14 = "don't run npm test directly inside Claude Code; run it as env -u CLAUDECODE npm test";

test("the bus: a producer never waits; observers hear every event in order, a failing one is logged, a full bus drops the oldest", async () => {
  assert.equal(BUS_LIMIT, 1000);
  /** @type {string[][]} */
  const logs = [];
  const bus = new ObservationBus({ log: (level, msg) => logs.push([level, msg]), limit: 3 });
  /** @type {number[]} */
  const heard = [];
  bus.on(async (e) => {
    await new Promise((r) => setTimeout(r, 2));
    heard.push(e.n);
  });
  bus.on((e) => {
    if (e.n === 7) throw new Error("boom");
  });
  for (let n = 1; n <= 5; n++) bus.push({ type: "x", n });
  assert.deepEqual(heard, [], "nothing runs on the producer's path");
  await bus.settled();
  assert.deepEqual(heard, [3, 4, 5], "full: the oldest went");
  assert.equal(bus.dropped, 2);
  assert.deepEqual(logs, [["warn", "memory: the observation bus is full (3 events); the oldest are dropped (1 so far)"]], "said once, not per event");
  bus.push({ type: "x", n: 7 });
  bus.push({ type: "x", n: 8 });
  await bus.settled();
  assert.deepEqual(heard, [3, 4, 5, 7, 8], "an observer's failure stops no other, nor the next event");
  assert.deepEqual(logs.at(-1), ["warn", "memory: an observer failed on a x event (boom)"]);
  bus.stop();
  bus.push({ type: "x", n: 9 });
  await bus.settled();
  assert.deepEqual(heard, [3, 4, 5, 7, 8], "stopped: nobody hears");
});

test("what a call that worked did that the failed one did not: setup before the command, never an addition after it", () => {
  const fix = (/** @type {string} */ a, /** @type {string} */ b, missing = false) => {
    const f = fixOf(a, b, { missing });
    return f && [f.shape, f.args, f.unless, f.failed, f.worked];
  };
  assert.deepEqual(fix("npm test", "env -u CLAUDECODE npm test"), ["npm test", "", "env -u CLAUDECODE", "npm test", "env -u CLAUDECODE npm test"]);
  assert.deepEqual(fix("  NPM   test ", "CI=1  npm test"), ["npm test", "", "CI=1", "NPM test", "CI=1 npm test"], "case and spacing aside");
  assert.deepEqual(fix("npm run lint && npm test", "npm run lint && CI=1 npm test"), ["npm test", "", "CI=1", "npm test", "CI=1 npm test"], "one simple command of several");
  assert.deepEqual(fix("apt install x", "sudo apt install x"), ["apt install", "", "sudo", "apt install x", "sudo apt install x"]);
  assert.deepEqual(fix("pytest -q", "source .venv/bin/activate && pytest -q"), ["pytest", "", "source .venv/bin/activate", "pytest -q", "source .venv/bin/activate && pytest -q"], "a command first that only sets up");
  assert.deepEqual(fix("node build.js", "$env:NODE_ENV='production'; node build.js"), ["node build.js", "", "$env:NODE_ENV='production'", "node build.js", "$env:NODE_ENV='production'; node build.js"]);
  assert.deepEqual(fix("jest", "npx jest", true), ["jest", "", "npx", "jest", "npx jest"], "a runner, when the command was not there");
  // What a runner runs is what the command is (M5-D31): the failure of one script is not every script's.
  assert.deepEqual(fix("npm run test:unit -- --ci", "CI=1 npm run test:unit -- --ci"), ["npm run", "test:unit", "CI=1", "npm run test:unit -- --ci", "CI=1 npm run test:unit -- --ci"]);
  assert.deepEqual(fix("python -m pytest tests", "PYTHONPATH=. python -m pytest tests"), ["python", "-m pytest", "PYTHONPATH=.", "python -m pytest tests", "PYTHONPATH=. python -m pytest tests"]);
  assert.deepEqual(fix("git push origin main", "GIT_SSH_COMMAND='ssh -i k' git push origin main"), ["git push", "", "GIT_SSH_COMMAND='ssh -i k'", "git push origin main", "GIT_SSH_COMMAND='ssh -i k' git push origin main"], "a quoted value is one word");
  for (const [a, b] of [
    ["npm test", "npm test"],
    ["npm test", "npm test -- --runInBand"],
    ["git push", "git push --force"],
    ["jest", "npx jest"],
    ["test", "npm test"],
    ["latest", "npm test"],
    ["npm test", "cd web && npm test"],
    ["npm run build", "npm install && npm run build"],
    ["npm run lint && npm test", "CI=1 npm run lint && CI=1 npm test"],
    ["npm test", "env -u CLAUDECODE npm test && npm run lint"],
    ["", "npm test"],
  ])
    assert.equal(fix(a, b), null, `${a} → ${b}`);
  assert.equal(fix("tsc --noEmit", "vue-tsc --noEmit", true), null, "a runner is a word of its own, not the head of a longer one");
  assert.equal(commandMissing({ exitCode: 127, error: "" }), true);
  assert.equal(commandMissing({ exitCode: 9009, error: "" }), true, "Windows' cmd");
  assert.equal(commandMissing({ exitCode: 1, error: "bash: jest: command not found" }), true);
  assert.equal(commandMissing({ exitCode: 1, error: "'jest' is not recognized as an internal or external command," }), true);
  assert.equal(commandMissing({ exitCode: 1, error: "3 tests failed" }), false);
  assert.equal(errorLine("Error: > pkg@1.0.0 test\n> node --test\n\nnot ok 1 - x\nError: CLAUDECODE is set\n\nCommand exited with code 1"), "Error: CLAUDECODE is set");
  assert.equal(errorLine("Error: > pkg@1.0.0 test\n> node --test\nsomething odd\n\nCommand exited with code 1"), "something odd", "no telling line: the first that is no script's echo");
  assert.equal(errorLine("Exit code 1\n"), "");
  assert.equal(errorLine("Error: (no output)\n\nCommand exited with code 3"), "", "the shell hand's word for silence is no error");
  assert.equal(errorLine("Error: [Showing lines 5-9 of 9; the rest did not fit]\nFull output (first 8 MB, kept 30 minutes): x.log\nCommand timed out after 120 seconds"), "Command timed out after 120 seconds");
  assert.deepEqual(
    ["API_KEY=abc npm test", "env GH_TOKEN=x gh pr list", "OPENAI=sk-abcdABCDEFGHIJKLMN npm test", "env -u CLAUDECODE npm test", "NODE_OPTIONS=--max-old-space-size=4096 npm test"].map(carriesSecret),
    [true, true, true, false, false],
  );
});

/**
 * A miner over a brain that only records what it is asked to file.
 * @param {{ mayLearn?: (chain: string) => boolean }} [o]
 */
function stubMiner({ mayLearn } = {}) {
  /** @type {any[]} */
  const filed = [];
  /** @type {string[]} */
  const queued = [];
  const brain = { fileSeen: async (/** @type {any} */ s) => (filed.push(s), { id: filed.length, filed: "added" }) };
  const miner = new PitfallMiner({ brain: () => brain, mayLearn, onFiled: (p) => queued.push(p) });
  let n = 0;
  /** @param {string} command @param {boolean} ok @param {any} [o] */
  const call = (command, ok, o = {}) => miner.observe({ type: "tool.result", project: "p", chain: "c", turn: 1, id: `t${++n}`, tool: "Bash", input: { command }, ok, exitCode: ok ? 0 : 1, error: ok ? null : "Error: it broke", ...o });
  return { miner, filed, queued, call };
}

test("the miner files what it saw once, and nothing a command that worked unchanged, another turn or a secret could teach", async () => {
  {
    const { filed, queued, call } = stubMiner();
    await call("npm test", false);
    await call("env -u CLAUDECODE npm test", true);
    assert.deepEqual(filed, [{ projectId: "p", chainId: "c", turnId: 1, text: "`npm test` failed here (exit 1: it broke); `env -u CLAUDECODE npm test` worked.", trigger: { tool: "bash", shape: "npm test", args: "", unless: "env -u CLAUDECODE" } }]);
    assert.deepEqual(queued, ["p"], "a claim added queues the curator's pass");
    await call("env -u CLAUDECODE npm test", true);
    assert.equal(filed.length, 1, "the failure was spent");
  }
  {
    // (fails before: yes — the review of 2e9d58b0c: a command its timeout sent to the background answered ok, and was
    // filed as the one that worked, whatever its end)
    const { filed, call } = stubMiner();
    await call("npm test", false);
    await call("CI=1 npm test", true, { exitCode: null, background: true });
    assert.deepEqual(filed, [], "a command in the background has not ended: it worked nothing yet");
    await call("CI=1 npm test", true);
    assert.equal(filed.length, 1, "and the failure still waits for the call that works");
  }
  {
    const { filed, call } = stubMiner();
    await call("npm test", false);
    await call("npm test", true);
    await call("CI=1 npm test", true);
    assert.deepEqual(filed, [], "it worked as it was: the failure was the code's, since fixed");
  }
  {
    const { filed, call } = stubMiner();
    await call("npm test", false);
    await call("CI=1 npm test", true, { turn: 2 });
    await call("CI=1 npm test", true, { chain: "d" });
    await call("API_KEY=abc npm test", true);
    assert.deepEqual(filed, [], "another turn, another session, a secret");
  }
  {
    const { filed, call } = stubMiner();
    await call("npm test", false, { id: "x1" });
    await call("npm test", false, { id: "x1" });
    await call("CI=1 npm test", true, { id: "x2" });
    await call("npm test", false, { id: "x1" });
    await call("CI=1 npm test", true, { id: "x2" });
    assert.equal(filed.length, 1, "a call read once, however often a client resends it");
  }
  {
    const { filed, call } = stubMiner({ mayLearn: (chain) => chain !== "c" });
    await call("npm test", false);
    await call("CI=1 npm test", true);
    assert.deepEqual(filed, [], "a session that does not learn");
  }
  {
    const { filed, call } = stubMiner();
    for (const project of ["none", null]) {
      await call("npm test", false, { project });
      await call("CI=1 npm test", true, { project });
    }
    await call("npm test", false, { tool: "Read" });
    await call("CI=1 npm test", true, { tool: "Read" });
    assert.deepEqual(filed, [], "no project to file it in, no shell");
  }
  {
    const { filed, call } = stubMiner();
    await call("jest", false, { exitCode: 127, error: "bash: jest: command not found" });
    await call("npm run lint", false);
    await call("npx jest", true);
    assert.deepEqual(filed.map((f) => [f.text, f.trigger.unless]), [["`jest` failed here (exit 127: bash: jest: command not found); `npx jest` worked.", "npx"]], "the failure it fixes, past a newer one it does not");
  }
});

/** Claude Code's shell calls in one session, on the world's tool loop. @param {any} w @param {string} session */
function claudeCode(w, session) {
  const loop = w.claudeCode(session);
  return { start: loop.start, ran: (/** @type {string} */ command, /** @type {{ error?: string }} */ o = {}) => loop.ran("Bash", { command }, o) };
}

test("on a proxy client's legs: a failure worked around is a pitfall seen, inferred and quiet, until another session sees it too", async () => {
  await world({}, async (w) => {
    const a = claudeCode(w, "seen-a");
    const { sit } = await a.start();
    const projectId = sit.project.id;
    const fire = (/** @type {string} */ chainId, /** @type {string} */ command) => w.svc.brain.pitfallsFor({ projectId, chainId, tool: "Bash", input: { command } });
    await a.ran("npm run build", { error: "Exit code 127\nsh: tsc: command not found" });
    await a.ran("npm run build:ci");
    await a.ran("npm test", { error: "Exit code 1\n> pkg test\nnot ok 1\nError: CLAUDECODE is set, refusing to run" });
    await a.ran("env -u CLAUDECODE npm test");
    const [claim, ...more] = w.svc.archive.triggers.matching(projectId, "bash", ["npm test"]);
    assert.equal(more.length, 0);
    assert.deepEqual(
      [claim.kind, claim.status, claim.origin, claim.text],
      ["fact", "inferred", "learner", "`npm test` failed here (exit 1: Error: CLAUDECODE is set, refusing to run); `env -u CLAUDECODE npm test` worked."],
    );
    assert.deepEqual(w.svc.archive.triggers.of(claim.id).map((/** @type {any} */ t) => [t.tool, t.shape, t.unless, t.source]), [["bash", "npm test", "env -u CLAUDECODE", "seen"]]);
    assert.deepEqual(w.svc.archive.triggers.matching(projectId, "bash", ["npm run"]), [], "another argument is no fix");
    assert.deepEqual(fire("x", "npm test"), [], "unarmed: one session saw it (M5-D2)");
    // The same session seeing it again is no evidence; another session's sighting arms it.
    await a.ran("npm test", { error: "Exit code 1\nError: CLAUDECODE is set" });
    await a.ran("env -u CLAUDECODE npm test");
    const evidence = () => w.svc.archive.items.events(claim.id).filter((/** @type {any} */ e) => e.action === "evidence").map((/** @type {any} */ e) => e.detail.chain);
    assert.deepEqual(evidence(), []);
    const b = claudeCode(w, "seen-b");
    const { prep: bPrep } = await b.start();
    const walked = await b.ran("npm test", { error: "Exit code 1\nError: CLAUDECODE is set" });
    assert.equal(walked.p.pitfalls, undefined, "not yet armed when b walked into it");
    await b.ran("env -u CLAUDECODE npm test");
    assert.deepEqual(evidence(), [bPrep.chain]);
    assert.equal(w.svc.archive.triggers.matching(projectId, "bash", ["npm test"]).length, 1, "one claim, said twice");
    const [hit] = fire("x", "npm test -- --grep slow");
    assert.equal(hit?.line, `[memory i${claim.id} · inferred] ${claim.text}`);
    assert.deepEqual(fire("y", "env -u CLAUDECODE npm test"), [], "the right way");
    // A third session walks into it on its first call: the line rides on the result.
    const c = claudeCode(w, "seen-c");
    await c.start();
    const { p, body } = await c.ran("npm test", { error: "Exit code 1\nError: CLAUDECODE is set" });
    assert.equal(p.pitfalls, 1, p.notes.join(" | "));
    assert.match(JSON.stringify(body.body.messages.at(-1)), new RegExp(`Memory on the tool call the model just made \\(Filament\\):\\\\n- \\[memory i${claim.id} · inferred\\] `));
  });
});

test("on an OpenAI client's legs a tool message counts only when its words open with the exit code", async () => {
  await world({}, async (w) => {
    const H = { "user-agent": "codex_cli_rs/0.40.0", "x-session-id": "oa-seen" };
    /** @type {any[]} */
    const messages = [{ role: "user", content: "run the tests" }];
    const leg = () => ({ format: "openai", body: { model: "gpt-x", messages: [{ role: "system", content: "You are Codex.\nWorking directory: C:\\evals" }, ...structuredClone(messages)] }, headers: H, model: "gpt-x" });
    const first = w.svc.situate(leg());
    await w.svc.prepare(first, { requestId: "oa-seen-0" });
    const projectId = first.project.id;
    let k = 0;
    const ran = async (/** @type {string} */ command, /** @type {string} */ out) => {
      const id = `c${++k}`;
      messages.push({ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "shell", arguments: JSON.stringify({ command: ["bash", "-lc", command] }) } }] });
      messages.push({ role: "tool", tool_call_id: id, content: out });
      await w.svc.prepare(w.svc.situate(leg()), { requestId: `oa-seen-${k}` });
      await w.svc.observations.settled();
    };
    const seen = () => w.svc.archive.triggers.matching(projectId, "bash", ["make", "npm test"]).map((/** @type {any} */ r) => r.text);
    await ran("make", "make: *** No rule to make target 'all'.  Stop.");
    await ran("source env.sh && make", "Exit code 0\nbuilt");
    assert.deepEqual(seen(), [], "words that do not say how the call ended are no failure");
    await ran("npm test", "Exit code 1\nError: CLAUDECODE is set, refusing to run");
    await ran("env -u CLAUDECODE npm test", "Exit code 0\n12 passing");
    assert.deepEqual(seen(), ["`npm test` failed here (exit 1: Error: CLAUDECODE is set, refusing to run); `env -u CLAUDECODE npm test` worked."]);
  });
});

test("a sighting a learned claim already says, with no trigger, is evidence for it, and gives it the trigger seen", async () => {
  await world({}, async (w) => {
    const { sit } = await w.session("a").send("hello");
    const projectId = sit.project.id;
    const text = "`npm run e2e` failed here (exit 1); `CI=1 npm run e2e` worked.";
    const said = await w.svc.brain.fileLearned({ projectId, chainId: "s1", kind: "fact", text, importance: 0.5 });
    assert.deepEqual(w.svc.archive.triggers.of(said.id), [], "said in words alone");
    const seen = await w.svc.brain.fileSeen({ projectId, chainId: "s2", text, trigger: { tool: "bash", shape: "npm run", args: "e2e", unless: "CI=1" } });
    assert.deepEqual(seen, { id: said.id, filed: "evidence" });
    assert.deepEqual(w.svc.archive.triggers.of(said.id).map((/** @type {any} */ t) => [t.shape, t.args, t.unless, t.source]), [["npm run", "e2e", "CI=1", "seen"]]);
  });
});

test("a sighting the user already said is evidence for their claim; a session that does not learn teaches nothing", async () => {
  await world({}, async (w) => {
    const { sit } = await w.session("a").remember(MD14, { kind: "rule" });
    const projectId = sit.project.id;
    const said = w.svc.archive.items.standing(projectId).find((/** @type {any} */ it) => it.text === MD14);
    const seen = { projectId, chainId: "s1", text: "`npm test` failed here (exit 1); `env -u CLAUDECODE npm test` worked.", trigger: { tool: "bash", shape: "npm test", unless: "ENV  -u claudecode" } };
    assert.deepEqual(await w.svc.brain.fileSeen(seen), { id: said.id, filed: "evidence" }, "the same right way, case and spacing aside");
    assert.deepEqual(await w.svc.brain.fileSeen(seen), { id: said.id, filed: "known" }, "once a session");
    const other = await w.svc.brain.fileSeen({ ...seen, chainId: "s2", text: "`npm test` failed here (exit 1); `CI=1 npm test` worked.", trigger: { tool: "bash", shape: "npm test", unless: "CI=1" } });
    assert.equal(other.filed, "added", "another right way is another claim");
    const unit = { projectId, chainId: "s3", text: "`npm run test:unit` failed here (exit 1); `CI=1 npm run test:unit` worked.", trigger: { tool: "bash", shape: "npm run", args: "test:unit", unless: "CI=1" } };
    assert.equal((await w.svc.brain.fileSeen(unit)).filed, "added");
    const build = await w.svc.brain.fileSeen({ ...unit, text: "`npm run build` failed here (exit 1); `CI=1 npm run build` worked.", trigger: { ...unit.trigger, args: "build" } });
    assert.equal(build.filed, "added", "another script is another pitfall (M5-D31)");
    assert.equal((await w.svc.brain.fileSeen({ ...unit, chainId: "s4", trigger: { ...unit.trigger, args: "TEST:UNIT" } })).filed, "evidence", "the same, case aside");
    const before = w.svc.archive.items.standing(projectId).length;
    const q = claudeCode(w, "quiet-learn");
    const { prep } = await q.start();
    w.svc.archive.mergeMeta(prep.chain, { noLearn: true });
    await q.ran("make", { error: "Exit code 2\nmake: *** No rule to make target" });
    await q.ran("source env.sh && make");
    assert.equal(w.svc.archive.items.standing(projectId).length, before, "the session opted out of learning");
  });
});
