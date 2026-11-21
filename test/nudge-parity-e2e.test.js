// @ts-check
// Every nudge reaches the coding agents as it reaches Filament's loop, end to end (the owner's of 11-10): each way a
// coding agent takes words while it works — Claude's queue (fixtures/fake-acp-agent.mjs under FAKE_ACP_CLAUDE),
// Codex's turn/steer (fixtures/fake-codex-app-server.mjs) and Cursor's CLI, which takes them only once a step ended
// (the fake behind a program named as Cursor's, checkpoint.js `next`) — hears a turn's start, what comes back after its
// own compaction, a tick of its plan and the unplanned line, each in the blocks' order (checkpoint.js `compose`), and
// each its own way in: queued at its next step, steered into its turn, or at the end of Filament's next tool answer to
// it (tool-tail.js). And each line a call's events are read for — the unplanned line, a command that failed again, a
// file changed outside every open task's writes, memory's pitfall and its open thread — reaches each of the four, Cursor's
// SDK too (fixtures/fake-cursor-sdk.mjs, steered live), from calls streamed as that agent streams them (the review of
// 11-11: Claude's adapter announces a call bare and says its input after; Cursor's SDK writes one out as its model does).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { RECALL_AFTER, WAITS_LONG_MS } from "../src/app/agent/still-open.js";
import { CODER_UNPLANNED_LINE } from "../src/app/agent/tools.js";
import { failingLine, outsideLine } from "../src/core/drift.js";
import { projectIdOf } from "../src/core/project-id.js";
import { disposeBackgroundShells, disposeSpills, startCommandShell, stopShell } from "../src/adapters/tools/hands.js";
import { SHELL } from "../src/adapters/tools/shell.js";
import { FAKE_ACP_AGENT, FIXTURES, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

/** A command that runs until it is stopped. */
const LONG = SHELL.kind === "cmd" ? `node -e "setInterval(()=>{},1000)"` : "sleep 120";
/** The words a change that went says, with nothing else open. */
const CHANGED_ALONE = "[Filament: A sub-agent's change you were told waits for you to apply it was applied or dropped since. Nothing else is still open now.]";
const JUST_NOW = "You compacted your context just now";
/** The head of the list a long wait says (still-open.js `openWords`, "long"). */
const LONG_WAIT = "[Filament: A sub-agent's change still waits for you to apply it, and nothing said so for 20 min.";
const WHERE = "[Filament: where you are — ";
const LEXER = { action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer" }] };
const SHOW = `~mcpcall tasks ${JSON.stringify({ action: "show" })}`;

/** JSON lines of a file, oldest first. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/**
 * Cursor's CLI as the catalogue knows it, by its program's name (`cursor-agent`), under `root`: the fake beside a shim of
 * npm's kind on Windows, whose script Filament runs with its own Node; elsewhere a script (acp-steer.test.js).
 * @param {string} root
 */
const cursorProgram = (root) => {
  const dir = join(root, "cursor");
  mkdirSync(dir);
  if (process.platform === "win32") {
    copyFileSync(FAKE_ACP_AGENT, join(dir, "fake-acp-agent.mjs"));
    copyFileSync(join(FIXTURES, "person-words.mjs"), join(dir, "person-words.mjs"));
    writeFileSync(join(dir, "cursor-agent.cmd"), `@"%~dp0\\node.exe" "%dp0%\\fake-acp-agent.mjs" %*\r\n`);
    return join(dir, "cursor-agent.cmd");
  }
  writeFileSync(join(dir, "cursor-agent"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_ACP_AGENT}" "$@"\n`);
  chmodSync(join(dir, "cursor-agent"), 0o755);
  return join(dir, "cursor-agent");
};

after(async () => {
  await disposeBackgroundShells();
  disposeSpills();
});

describe("each coding agent hears the loop's blocks, its own way in", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  /** How far the Still open list's clock runs ahead of the machine's (`stillOpenNow`): a turn past a long wait at once. */
  let shift = 0;
  /** The prompts a fake-acp agent was sent. @param {"own" | "cli"} who */
  const prompts = (who) => lines(join(root, `${who}-prompts.jsonl`)).map((p) => String(p.text ?? p.prompt ?? ""));
  /** What Claude was sent while a turn of its ran: the prompts queued at it. */
  const queued = () => lines(join(root, "own-calls.jsonl")).filter((c) => c.method === "queued prompt").map((c) => String(c.words));
  /** Codex's calls of `method`, each its words. @param {"turn/start" | "turn/steer"} method */
  const codex = (method) => lines(join(root, "cx.jsonl")).filter((c) => c.method === method).map((c) => (c.params?.input || []).filter((/** @type {any} */ i) => i.type === "text").map((/** @type {any} */ i) => i.text).join("\n"));
  /** Claude's queue: its steps wait at their gates until `open`. */
  const gates = {
    shut: () => ["q1", "q2", "end"].forEach((f) => rmSync(join(root, "qgate", f), { force: true })),
    open: () => ["q1", "q2", "end"].forEach((f) => writeFileSync(join(root, "qgate", f), "")),
  };
  /** Codex's next call comes as soon as its turn reaches it. */
  const tick = () => writeFileSync(join(root, "cxticks", "tick"), "");
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-nudge-parity-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    mkdirSync(join(root, "qgate"));
    mkdirSync(join(root, "cxticks"));
    writeFileSync(join(projDir, "a.txt"), "a\n");
    writeFileSync(join(projDir, "b.txt"), "a\n");
    up = await fakeUpstream(() => anthropicReply("ok", { model: "m-1", usage: { input_tokens: 10, output_tokens: 5 } }));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "own", name: "own", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, "own-calls.jsonl"), FAKE_ACP_LOG: join(root, "own-prompts.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_QUEUE_GATE: join(root, "qgate") }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "cli", name: "Cursor", type: "acp", acp: { command: cursorProgram(root), args: [], env: { FAKE_ACP_CALLS: join(root, "cli-calls.jsonl"), FAKE_ACP_LOG: join(root, "cli-prompts.jsonl"), FAKE_ACP_MCP_GATE: join(root, "mcpgate") }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "cx", name: "Codex", type: "codex", acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], env: { FAKE_CODEX_CALLS: join(root, "cx.jsonl"), FAKE_CODEX_TICK_DIR: join(root, "cxticks") }, cwdDefault: projDir, permissions: "allow-all" } },
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } },
        ];
        cfg.routes = [
          { match: "own/*", upstream: "own", upstreamModel: "{1}", enabled: true },
          { match: "cli/*", upstream: "cli", upstreamModel: "{1}", enabled: true },
          { match: "cx/*", upstream: "cx", upstreamModel: "{1}", enabled: true },
          { match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
      overrides: { stillOpenNow: () => Date.now() + shift },
    });
  });
  after(async () => {
    await disposeBackgroundShells();
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  /** @param {string} path @param {any} [init] */
  const json = async (path, init) => (await shim.api(path, init)).json();
  /** A chat on `model`. @param {string} model */
  const open = async (model) => String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain", settings: { context: { compaction: { model: "m-1", mode: "auto" } } } } })).id);
  /** A turn sent: its reply's words and its record's notes, once it ends. @param {string} id @param {string} content */
  const send = async (id, content) => {
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    const status = res.status;
    const body = await res.json();
    const rec = await shim.record(String(res.headers.get("x-filament-request-id")));
    const text = (body.content || []).filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join("");
    return { status, text, notes: [...(rec.changes || []), ...(rec.priorChanges || [])].map(String) };
  };
  /** A turn that must end well. @param {string} id @param {string} content */
  const say = async (id, content) => {
    const r = await send(id, content);
    assert.equal(r.status, 200, r.text);
    return r;
  };
  /** A command of the chat's main agent's, running until it is stopped. @param {string} id */
  const command = (id) => startCommandShell(LONG, projDir, { session: id, agent: null }, { onEnd: () => {} });
  /** The chat's task graph, put in place as its tasks tool puts it. @param {string} id @param {any} input */
  const plan = (id, input) => assert.ok(/** @type {any} */ (shim.app).graphs.apply(id, input, { crew: "agent" }).ok);
  /** What the chat keeps of what its main agent heard. @param {string} id */
  const heard = (id) => /** @type {any} */ (shim.app.memory).archive.metaOf(id, ["openHeard"])?.openHeard;
  /** The chat keeps that its agent was told a sub-agent's change waits — one no longer there. @param {string} id */
  const toldOfAChange = (id) => /** @type {any} */ (shim.app.memory).archive.mergeMeta(id, { openHeard: { keys: ["agent:sa_gone:waits"] } });
  /**
   * What comes back after a compaction with a graph and a command open: one block, the graph then what is open, then
   * recall's list of the turns. @param {string} words @param {string} run  the command's id @param {string} who
   */
  const holdsBack = (words, run, who) => {
    const at = words.indexOf(`[Filament: ${JUST_NOW}`);
    assert.ok(at >= 0, `${who}: ${words}`);
    const back = words.slice(at);
    assert.ok(back.startsWith(`[Filament: ${JUST_NOW}, and its summary may have left out what stands: here are the task graph as it stands, and what is still open.`), `${who}: ${back}`);
    assert.match(back, /\n\n<tasks>\n[^]*Ship the lexer[^]*\[Filament: where you are — [^]*\n<\/tasks>\n\n<open>\n- background command /, who);
    assert.ok(back.includes(`- background command ${run}: \``) && back.includes(`</open>\n${RECALL_AFTER}`), `${who}: ${back}`);
    assert.equal(back.split(JUST_NOW).length, 2, `${who}: one block`);
  };

  // (fails before: no — FabeleHelper's D of 11-10 held Claude's turn start to the loop's order; Codex's and Cursor's
  // CLI's first prompts are composed by the same code, held here)
  test("a turn's start: what is still open, then where it stands — Claude's, Cursor's CLI's and Codex's first prompt alike", async () => {
    const firsts = { own: () => prompts("own").at(-1), cli: () => prompts("cli").at(-1), cx: () => codex("turn/start").at(-1) };
    for (const [who, model] of /** @type {const} */ ([["own", "own/fake-a"], ["cli", "cli/fake-a"], ["cx", "cx/gpt-5.5"]])) {
      const id = await open(model);
      await say(id, "one");
      plan(id, LEXER);
      toldOfAChange(id);
      await say(id, "two");
      const first = String(firsts[who]());
      const said = first.indexOf(CHANGED_ALONE);
      const where = first.indexOf(WHERE);
      assert.ok(first.startsWith("two") && said > 0 && where > said, `${who}: ${first}`);
      await say(id, "three");
      assert.ok(!String(firsts[who]()).includes(CHANGED_ALONE), `${who}: said once`);
    }
  });

  // (fails before: no — still-open-retold.test.js holds Claude's and Codex's steer; Cursor's CLI, which takes words only
  // once a step ended, had no test of its own through the app)
  test("its own compaction mid-turn: the graph and what is still open in one block — queued at Claude's next step, steered into Codex's turn, at the end of Filament's next tool answer to Cursor's CLI", async () => {
    const own = await open("own/fake-a");
    await say(own, "one");
    plan(own, LEXER);
    const ownRun = command(own);
    gates.shut();
    const from = queued().length;
    const turn = send(own, "~queue ~compactfirst");
    await until(() => queued().slice(from).some((w) => w.includes(JUST_NOW)) || null, "what comes back, queued at Claude");
    gates.open();
    const ownEnd = await turn;
    assert.equal(ownEnd.status, 200, ownEnd.text);
    const ownBack = queued().slice(from).filter((w) => w.includes(JUST_NOW));
    assert.equal(ownBack.length, 1, ownBack.join("\n----\n"));
    holdsBack(ownBack[0], ownRun.id, "own");
    assert.ok(ownEnd.notes.includes("acp: what comes back after own's compaction went into its turn, its task graph with it"), ownEnd.notes.join("\n"));
    await stopShell(ownRun.id, { session: own, agent: null });

    const cx = await open("cx/gpt-5.5");
    await say(cx, "one");
    plan(cx, LEXER);
    const cxRun = command(cx);
    const steers = codex("turn/steer").length;
    tick();
    const cxEnd = await say(cx, "~steer ~compactfirst");
    const steered = codex("turn/steer").slice(steers);
    assert.equal(steered.length, 1, steered.join("\n----\n"));
    holdsBack(steered[0], cxRun.id, "cx");
    assert.ok(cxEnd.text.includes(`heard:[Filament: ${JUST_NOW}`), cxEnd.text);
    assert.ok(cxEnd.notes.includes("acp: what comes back after Codex's compaction went into its turn, its task graph with it"), cxEnd.notes.join("\n"));
    await stopShell(cxRun.id, { session: cx, agent: null });

    const cli = await open("cli/fake-a");
    await say(cli, "one");
    plan(cli, LEXER);
    const cliRun = command(cli);
    // Twice before the call: one block all the same.
    const cliEnd = await say(cli, `~compactthen2 ~mcplate ${SHOW}`);
    const answer = cliEnd.text.indexOf("mcp:");
    assert.ok(answer >= 0 && cliEnd.text.indexOf(JUST_NOW) > answer, cliEnd.text);
    holdsBack(cliEnd.text, cliRun.id, "cli");
    assert.ok(cliEnd.notes.includes("acp: what comes back after Cursor's compaction rode the end of Filament's next tool answer to it, its task graph with it"), cliEnd.notes.join("\n"));
    assert.deepEqual(heard(cli), { keys: [`command:${cliRun.id}`] });
    // No call of Filament's after it: the block waits for its next turn's start, never a prompt of its own.
    const asked = prompts("cli").length;
    const quiet = await say(cli, "~compact");
    assert.equal(prompts("cli").length, asked + 1, "the turn's own prompt alone");
    assert.ok(quiet.notes.includes("acp: Cursor compacted its context and took no step Filament could send words in at: its next turn's first prompt says what the compaction may have lost"), quiet.notes.join("\n"));
    await say(cli, "two");
    const two = String(prompts("cli").at(-1));
    assert.ok(two.startsWith("two\n\n[Filament: You compacted your context before this message") && two.includes(`- background command ${cliRun.id}: \``), two);
    // Steps of its own after it, but no call of Filament's: what its steps owed goes with the turn, and the block waits
    // for its next turn's start.
    const kept = await say(cli, "~compactthen ~twoedits");
    assert.ok(!kept.text.includes(JUST_NOW), kept.text);
    assert.ok(kept.notes.includes("acp: Cursor compacted its context and took no step Filament could send words in at: its next turn's first prompt says what the compaction may have lost"), kept.notes.join("\n"));
    assert.deepEqual(heard(cli), { lost: true });
    await say(cli, "three");
    const three = String(prompts("cli").at(-1));
    assert.ok(three.startsWith("three\n\n[Filament: You compacted your context before this message") && three.includes("<tasks>") && three.includes(`- background command ${cliRun.id}: \``), three);
    await stopShell(cliRun.id, { session: cli, agent: null });
  });

  // (fails before: no — a tick is the tasks tool's own answer, which reaches every agent over Filament's MCP server)
  test("a tick of its plan: Filament's tasks tool answers Claude, Cursor's CLI and Codex alike — what moved, then how the work stands", async () => {
    /** @type {string[]} */
    const answers = [];
    for (const model of ["own/fake-a", "cli/fake-a", "cx/gpt-5.5"]) {
      const id = await open(model);
      assert.match((await say(id, `~mcpcall tasks ${JSON.stringify(LEXER)}`)).text, /mcp:Added t1\./);
      const { text } = await say(id, `~mcpcall tasks ${JSON.stringify({ action: "start", ids: ["t1"] })}`);
      // The answer as the agent said it back, without the fake's echo of its prompt after it.
      answers.push(text.slice(text.indexOf("mcp:")).replace(/ echo\(\d+\):[^]*$/, "").trim());
    }
    assert.match(answers[0], /^mcp:Started t1: yours, so you do it now\. 0 of 1 done · running: t1\./, answers[0]);
    assert.deepEqual(answers, [answers[0], answers[0], answers[0]]);
  });

  // (fails before: no — coder-nudges.test.js holds Claude's; Codex's steer and Cursor's CLI's tool answer had none)
  test("a second file changed with no plan kept: the unplanned line, once — queued at Claude's next step, steered into Codex's turn, at the end of Filament's next tool answer to Cursor's CLI", async () => {
    const own = await open("own/fake-a");
    await say(own, "one");
    gates.shut();
    const from = queued().length;
    const turn = send(own, "~queue ~twoedits");
    await until(() => queued().slice(from).includes(CODER_UNPLANNED_LINE) || null, "the line, queued at Claude");
    gates.open();
    const ownEnd = await turn;
    assert.equal(ownEnd.status, 200, ownEnd.text);
    assert.deepEqual(queued().slice(from), [CODER_UNPLANNED_LINE]);
    assert.ok(ownEnd.notes.includes("acp: own changed a second file with neither a checklist nor a task graph — Filament asked it to plan its steps, at its next step"), ownEnd.notes.join("\n"));

    const cx = await open("cx/gpt-5.5");
    await say(cx, "one");
    const steers = codex("turn/steer").length;
    tick();
    const cxEnd = await say(cx, "~steer ~twoedits");
    assert.deepEqual(codex("turn/steer").slice(steers), [CODER_UNPLANNED_LINE]);
    assert.ok(cxEnd.text.includes(`heard:${CODER_UNPLANNED_LINE}`), cxEnd.text);
    assert.ok(cxEnd.notes.includes("acp: Codex changed a second file with neither a checklist nor a task graph — Filament asked it to plan its steps, at its next step"), cxEnd.notes.join("\n"));

    const cli = await open("cli/fake-a");
    await say(cli, "one");
    const cliEnd = await say(cli, `~twoedits ~mcplate ${SHOW}`);
    assert.ok(cliEnd.text.includes(`\n\n${CODER_UNPLANNED_LINE}`) && cliEnd.text.split(CODER_UNPLANNED_LINE).length === 2, cliEnd.text);
    assert.ok(cliEnd.notes.includes("acp: Cursor changed a second file with neither a checklist nor a task graph — Filament asked it to plan its steps, with Filament's next tool answer to it"), cliEnd.notes.join("\n"));
    // The call that takes the line is the one that plans: judged as its answer goes, the line does not ride it.
    const planning = await open("cli/fake-a");
    await say(planning, "one");
    const added = await say(planning, `~twoedits ~mcplate ~mcpcall tasks ${JSON.stringify(LEXER)}`);
    assert.match(added.text, /mcp:Added t1\./, added.text);
    assert.ok(!added.text.includes(CODER_UNPLANNED_LINE), added.text);
    assert.ok(!added.notes.some((n) => n.includes("changed a second file")), added.notes.join("\n"));
    // No call of Filament's after the edits: the line goes with the turn — stale by the next one — and never comes later.
    const stale = await open("cli/fake-a");
    await say(stale, "~twoedits");
    const next = await say(stale, `~mcplate ${SHOW}`);
    assert.ok(!next.text.includes(CODER_UNPLANNED_LINE), next.text);
    assert.ok(![...next.notes].some((n) => n.includes("changed a second file")), next.notes.join("\n"));
  });

  // (fails before: yes — the gap of 11-11: a change that waited a long while inside one turn was named at no step of it;
  // Claude's queue holds it in still-open-retold.test.js, Cursor's CLI's tool answer here)
  test("a change that waits a long while in one turn: the list, once, at the end of Filament's next tool answer to Cursor's CLI", async () => {
    const cli = await open("cli/fake-a");
    await say(cli, "one");
    // The registry says a sub-agent's change waits for the chat's agent, its exchange ended an hour ago.
    const reg = /** @type {any} */ (shim.app).subagents;
    const { openWork, get } = reg;
    reg.openWork = (/** @type {string} */ chain, /** @type {any} */ o) => (chain === cli ? [{ id: "sa_long", description: "add export", running: false, files: 2 }] : openWork(chain, o));
    reg.get = (/** @type {string} */ sa) => (sa === "sa_long" ? { chainId: cli, status: "done", endedAt: Date.now() - 3_600_000, work: { pending: 2, sig: "b1:h1" } } : get(sa));
    const gate = join(root, "mcpgate");
    rmSync(gate, { force: true });
    try {
      const asked = prompts("cli").length;
      const turn = send(cli, `~mcpgate ${SHOW}`);
      // Its prompt went out once the turn began: its clock then runs a long wait ahead, before its call.
      await until(() => prompts("cli").length > asked || null, "the turn's prompt, at Cursor's CLI");
      shift = WAITS_LONG_MS;
      writeFileSync(gate, "");
      const { status, text, notes } = await turn;
      assert.equal(status, 200, text);
      const answer = text.indexOf("mcp:");
      assert.ok(answer >= 0 && text.indexOf(LONG_WAIT) > answer, text);
      assert.equal(text.split(LONG_WAIT).length, 2, "once");
      assert.ok(text.includes('- sub-agent sa_long ("add export"): 2 files of its work wait to be applied'), text);
      assert.ok(notes.includes("acp: what is still open, said to Cursor with Filament's next tool answer to it — a sub-agent's change waited long in its turn with nothing said of it"), notes.join("\n"));
      assert.deepEqual(heard(cli), { keys: ["agent:sa_long:waits"] });
    } finally {
      Object.assign(reg, { openWork, get });
      shift = 0;
      writeFileSync(gate, "");
    }
  });

  // (fails before: yes — the review of 11-11: Codex's call ends say no kind, so a patch between two failed runs was no
  // change, and its third run was said to fail "with nothing changed between")
  test("Codex's same command fails a third time in a row: the line is steered into its turn — but not where it patched a file between the runs", async () => {
    const id = await open("cx/gpt-5.5");
    await say(id, "one");
    // An open task: its patches ask for no plan.
    plan(id, LEXER);
    const line = failingLine("npm test", "coding");
    const steers = codex("turn/steer").length;
    tick();
    const failing = await say(id, "~steer ~threefails");
    assert.deepEqual(codex("turn/steer").slice(steers), [line]);
    assert.ok(failing.notes.includes("acp: Codex's `npm test` failed a third time in a row, and nothing Filament saw changed between them — Filament said so, at its next step"), failing.notes.join("\n"));
    // A patch between each run: its next call carries nothing of it, and the person's words that wait for that call end
    // its turn.
    const quiet = codex("turn/steer").length;
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "~steer ~threefails ~editbetween", stream: true, runEvents: true } });
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await json(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).events.some((/** @type {any} */ e) => e.type === "tool-end" && e.id === "fails_3") || null, "its third run's end");
    const note = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text: "then stop", from: "harness" } });
    assert.equal(note.status, 200, await note.clone().text());
    tick();
    await body;
    rmSync(join(root, "cxticks", "tick"), { force: true });
    assert.deepEqual(codex("turn/steer").slice(quiet), ["then stop"]);
  });
});

describe("each coding agent hears each line a call's events are read for, as it streams its calls", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  /** The folder most chats work in; one whose memory holds pitfalls; one whose memory holds an open thread on b.txt. */
  let projDir = "";
  let pitDir = "";
  let threadDir = "";
  /** What Claude was sent while a turn of its ran: the prompts queued at it. */
  const queued = () => lines(join(root, "own-calls.jsonl")).filter((c) => c.method === "queued prompt").map((c) => String(c.words));
  /** What was steered into Codex's turns, each its words. */
  const codexSteers = () => lines(join(root, "cx.jsonl")).filter((c) => c.method === "turn/steer").map((c) => (c.params?.input || []).filter((/** @type {any} */ i) => i.type === "text").map((/** @type {any} */ i) => i.text).join("\n"));
  /** What was steered into the runs of Cursor's SDK, each its words and whether the run took them. */
  const sdkSteers = () => lines(join(root, "sdk.jsonl")).filter((e) => e.event === "steer").map((e) => [String(e.text), e.takes]);
  const gates = {
    shut: () => ["q1", "q2", "end"].forEach((f) => rmSync(join(root, "qgate", f), { force: true })),
    open: () => ["q1", "q2", "end"].forEach((f) => writeFileSync(join(root, "qgate", f), "")),
  };
  /** Codex's next call comes as soon as its turn reaches it. */
  const tick = () => writeFileSync(join(root, "cxticks", "tick"), "");
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-nudge-lines-"));
    for (const dir of ["project", "pitfalls", "threads"]) {
      mkdirSync(join(root, dir));
      writeFileSync(join(root, dir, "a.txt"), "a\n");
      writeFileSync(join(root, dir, "b.txt"), "a\n");
    }
    [projDir, pitDir, threadDir] = ["project", "pitfalls", "threads"].map((dir) => join(root, dir));
    mkdirSync(join(root, "qgate"));
    mkdirSync(join(root, "cxticks"));
    process.env.FAKE_SDK_LOG = join(root, "sdk.jsonl");
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.memory.autopilot = { enabled: true }; // memory speaks into the turn (M6-7): off, the turn is silent
        cfg.upstreams = [
          { id: "own", name: "own", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, "own-calls.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_QUEUE_GATE: join(root, "qgate") }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "cli", name: "Cursor", type: "acp", acp: { command: cursorProgram(root), args: [], env: {}, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "cx", name: "Codex", type: "codex", acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], env: { FAKE_CODEX_CALLS: join(root, "cx.jsonl"), FAKE_CODEX_TICK_DIR: join(root, "cxticks") }, cwdDefault: projDir, permissions: "allow-all" } },
          { id: "sdk", name: "Cursor SDK", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: projDir, permissions: "allow-all", hints: false } },
        ];
        cfg.routes = ["own", "cli", "cx", "sdk"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true }));
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
      overrides: { cursorSdkLoader: () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href) },
    });
  });
  after(async () => {
    await shim.stop();
    delete process.env.FAKE_SDK_LOG;
    await removeDirs(root);
  });
  const MODELS = /** @type {const} */ ({ own: "own/fake-a", cx: "cx/gpt-5.5", cli: "cli/fake-a", sdk: "sdk/composer-2.5" });
  /** A chat of `who` in `cwd`, its first turn over. @param {keyof typeof MODELS} who @param {string} [cwd] */
  const open = async (who, cwd = projDir) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd, model: MODELS[who], preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    await say(id, "one");
    return id;
  };
  /** A turn's record's notes. @param {string} runId */
  const notesOf = async (runId) => {
    const rec = await until(async () => {
      const x = await shim.record(runId);
      return x?.acp?.run ? x : null;
    }, "the turn's record");
    return [...(rec.changes || []), ...(rec.priorChanges || [])].map(String);
  };
  /** A turn sent: its reply's words and its record's notes, once it ends. @param {string} id @param {string} content */
  const say = async (id, content) => {
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    const text = (body.content || []).filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join("");
    return { text, notes: await notesOf(String(res.headers.get("x-filament-request-id"))) };
  };
  /** The chat's task graph, put in place as its tasks tool puts it. @param {string} id @param {any} input */
  const plan = (id, input) => assert.ok(/** @type {any} */ (shim.app).graphs.apply(id, input, { crew: "agent" }).ok);
  /**
   * What each agent heard of `line` in a turn that makes `calls` (a fake's steps) and then one call more, each its own
   * way in, and its record's notes: Claude queued at its next step (`~queue`), Codex steered into its turn at its next
   * call (a tick), Cursor's CLI at the end of Filament's next tool answer to it (its words back), Cursor's SDK steered
   * into its run at its next call (`~shell`). `last`: the line comes at the calls' own last event, so no call more.
   * @param {keyof typeof MODELS} who @param {string} id @param {string} calls @param {string} line @param {{ last?: boolean }} [o]
   * @returns {Promise<{ heard: string[], notes: string[] }>}
   */
  const hears = async (who, id, calls, line, { last = false } = {}) => {
    if (who === "own") {
      gates.shut();
      const from = queued().length;
      const turn = say(id, `~queue ${calls}`);
      try {
        await until(() => queued().slice(from).includes(line) || null, "the line, queued at Claude as its next step began");
      } finally {
        gates.open();
      }
      return { heard: queued().slice(from), notes: (await turn).notes };
    }
    if (who === "cx") {
      const from = codexSteers().length;
      // Its turn ends at the first words steered into it; a line of its calls' own comes without a call more.
      if (!last) tick();
      const { notes } = await say(id, `~steer ${calls}`);
      rmSync(join(root, "cxticks", "tick"), { force: true });
      return { heard: codexSteers().slice(from), notes };
    }
    if (who === "cli") {
      const { text, notes } = await say(id, `${calls} ~mcplate ~mcpcall tasks ${JSON.stringify({ action: "show" })}`);
      const answer = text.indexOf("mcp:");
      assert.ok(answer >= 0, text);
      // The line as often as it rode the end of the tool's answer, a paragraph of its own after the tool's words.
      return { heard: text.slice(answer).split(`\n\n${line}`).slice(1).map(() => line), notes };
    }
    const from = sdkSteers().length;
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `${calls}${last ? "" : " ~shell"} ~hang`, stream: true, runEvents: true } });
    const body = res.text();
    try {
      await until(() => sdkSteers().length > from || null, "words steered into Cursor's run");
    } finally {
      // A run no steer reached waits until it is stopped.
      if (sdkSteers().length === from) await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
      await body;
    }
    return { heard: sdkSteers().slice(from).map(([text]) => String(text)), notes: await notesOf(String(res.headers.get("x-filament-request-id"))) };
  };
  /** How the record says a line went in, by agent. */
  const HOW = { own: "at its next step", cx: "at its next step", cli: "with Filament's next tool answer to it", sdk: "at its next step" };
  /** Each agent as its record names it. */
  const NAMED = { own: "own", cx: "Codex", cli: "Cursor", sdk: "Cursor SDK" };
  const WHO = /** @type {(keyof typeof MODELS)[]} */ (["own", "cx", "cli", "sdk"]);

  // (fails before: yes — the review of 11-11: Cursor's SDK named no file on its calls, so an edit of its changed none the
  // turn knew; coder-nudges.test.js holds Claude's, the suite above Codex's and Cursor's CLI's)
  test("a second file changed with no plan kept: Cursor's SDK hears the unplanned line, steered into its run at its next call", async () => {
    const id = await open("sdk");
    const { heard, notes } = await hears("sdk", id, "~twoedits", CODER_UNPLANNED_LINE);
    assert.deepEqual(heard, [CODER_UNPLANNED_LINE]);
    assert.ok(notes.includes("acp: Cursor SDK changed a second file with neither a checklist nor a task graph — Filament asked it to plan its steps, at its next step"), notes.join("\n"));
  });

  // (fails before: yes — the review of 11-11: Claude's edits, announced bare, were never judged, and Cursor's SDK's named
  // no file; Codex's and Cursor's CLI's held)
  test("a file changed outside every open task's writes, while a task of its own that named writes runs: each agent hears the line, once", async () => {
    const line = outsideLine({ path: "b.txt", tasks: [{ id: "t1", name: "Write the lexer", writes: ["a.txt"] }] }, "coding");
    for (const who of WHO) {
      const id = await open(who);
      plan(id, { action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer", writes: ["a.txt"] }] });
      plan(id, { action: "start", ids: ["t1"] });
      const { heard, notes } = await hears(who, id, "~twoedits", line);
      assert.deepEqual(heard, [line], `${who}: once, and a.txt, within its writes, not at all`);
      assert.ok(notes.includes(`acp: ${NAMED[who]} changed b.txt outside every open task's writes while on t1 — Filament said so, ${HOW[who]}`), `${who}: ${notes.join("\n")}`);
    }
  });

  // (fails before: no — each agent's failed runs were counted; Cursor's CLI, which names no tool, and Cursor's SDK had no
  // test of theirs through the app, and Claude's fake now streams its runs as Claude does)
  test("the same command fails a third time in a row with nothing changed between: each agent hears the line, once", async () => {
    const line = failingLine("npm test", "coding");
    for (const who of WHO) {
      const id = await open(who);
      const { heard, notes } = await hears(who, id, "~threefails", line);
      assert.deepEqual(heard, [line], who);
      assert.ok(notes.some((n) => n === `acp: ${NAMED[who]}'s \`npm test\` failed a third time in a row, and nothing Filament saw changed between them — Filament said so, ${HOW[who]}`), `${who}: ${notes.join("\n")}`);
    }
  });

  // (fails before: yes — the review of 11-11, d-fails: Codex names the folder of each command, and the count went by the
  // command's words alone)
  test("Codex's same command fails once in each of three folders: nothing is said", async () => {
    const id = await open("cx");
    const from = codexSteers().length;
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "~steer ~threefolders", stream: true, runEvents: true } });
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events.some((/** @type {any} */ e) => e.type === "tool-end" && e.id === "folder_c") || null, "its third run's end");
    // The person's words that wait for its next call end its turn: that call carries nothing of a failed command.
    const note = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text: "then stop", from: "harness" } });
    assert.equal(note.status, 200, await note.clone().text());
    tick();
    await body;
    rmSync(join(root, "cxticks", "tick"), { force: true });
    assert.deepEqual(codexSteers().slice(from), ["then stop"]);
  });

  // (fails before: yes — the review of 11-11: memory was asked at a call's announcement alone, which Claude's adapter
  // sends bare, and by the tool's name, which Cursor's CLI does not say — its call is titled with its command — and
  // Cursor's SDK did not either)
  test("a pitfall the agent's command walks into: each agent hears memory's line, once", async () => {
    const seeded = await open("own", pitDir);
    assert.ok(seeded);
    /** @param {string} text */
    const rule = async (text) => {
      const said = await shim.api("/api/memory/remember", { method: "POST", body: { text, kind: "rule", project: projectIdOf(pitDir) } });
      assert.equal(said.status, 200, await said.clone().text());
      return { id: String((await said.json()).id), line: "" };
    };
    // Claude's fake runs `q1` at its first step; the others run `npm test`.
    const q1 = await rule("Never run `q1` bare in this repo; run it as `env FILAMENT_Q=1 q1`.");
    q1.line = `[memory ${q1.id} · user said] Never run \`q1\` bare in this repo; run it as \`env FILAMENT_Q=1 q1\`.`;
    const npm = await rule("Never run `npm test` bare in this repo; run it as `env CI=1 npm test`.");
    npm.line = `[memory ${npm.id} · user said] Never run \`npm test\` bare in this repo; run it as \`env CI=1 npm test\`.`;
    /** The tool each agent's call is named by on the record: its own name for it, or its title where it names none. */
    const tool = { own: "Bash", cx: "bash", cli: "npm test", sdk: "bash" };
    for (const who of WHO) {
      const id = await open(who, pitDir);
      const at = who === "own" ? q1 : npm;
      // The call that walks into it is the one memory speaks at: Claude's `~queue` step, the others' one run.
      const { heard, notes } = await hears(who, id, who === "own" ? "" : who === "sdk" ? "~shell" : "~onerun", at.line, { last: who !== "own" && who !== "cli" });
      assert.deepEqual(heard, [at.line], who);
      assert.ok(notes.includes(`acp: memory reminded ${NAMED[who]}'s ${tool[who]} call of ${at.id}, ${HOW[who]}`), `${who}: ${notes.join("\n")}`);
    }
  });

  // (fails before: yes — the review of 11-11: Claude's edit names its file on the update after its announcement, and
  // Cursor's SDK's named none, so memory was asked of no file)
  test("an open thread on a file the agent edits: each agent hears memory's line, once", async () => {
    const seeded = await open("own", threadDir);
    assert.ok(seeded);
    const said = await shim.api("/api/memory/remember", { method: "POST", body: { text: "b.txt still needs a header line.", kind: "thread", project: projectIdOf(threadDir) } });
    assert.equal(said.status, 200, await said.clone().text());
    const { id: thread } = await said.json();
    const line = `[memory ${thread} · user said · open thread on b.txt] b.txt still needs a header line.`;
    const tool = { own: "Edit", cx: "edit", cli: "Edit b.txt", sdk: "Edit b.txt" };
    for (const who of WHO) {
      const id = await open(who, threadDir);
      // An open task: its edits ask for no plan.
      plan(id, { action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer" }] });
      const { heard, notes } = await hears(who, id, "~twoedits", line, { last: who !== "own" && who !== "cli" });
      assert.deepEqual(heard, [line], who);
      assert.ok(notes.includes(`acp: memory reminded ${NAMED[who]}'s ${tool[who]} call of ${thread}, ${HOW[who]}`), `${who}: ${notes.join("\n")}`);
    }
  });
});
