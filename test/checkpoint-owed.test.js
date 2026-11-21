// @ts-check
// What a checkpoint owes an agent is kept until it reached it (the re-review of 11-11, on d4f622dd9 and the turn's
// start): the skills a coding agent had loaded as it compacted its own context are kept with the chat, by whose session
// compacted — across a restart, after a compaction outside a turn, beside a sub-agent's run that compacts too, through
// a second compaction before the first was said —; the block owed at a turn's start keeps that start when it carries
// the task graph; a prompt that failed before any word of the agent's, or a request the provider refused, keeps nothing
// of the start it carried;
// a compaction the agent gives no id for is one all the same; a block on its way as the agent compacts again leaves that
// compaction to be said; an agent that takes words only at Filament's next tool answer is owed one answer's tail while
// a block waits; and a session that begins from Filament's copy of the chat is told what is true of it, once.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { disposeBackgroundShells, disposeSpills, startCommandShell, stopShell } from "../src/adapters/tools/hands.js";
import { SHELL } from "../src/adapters/tools/shell.js";
import { RECALL_AFTER } from "../src/app/agent/still-open.js";
import { FAKE_ACP_AGENT, FIXTURES, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

after(async () => {
  await disposeBackgroundShells();
  disposeSpills();
});

/** A command that runs until it is stopped. */
const LONG = SHELL.kind === "cmd" ? `node -e "setInterval(()=>{},1000)"` : "sleep 120";
const JUST_NOW = "You compacted your context just now";
/** The head of the block owed at a turn's start. */
const OWED = "[Filament: You compacted your context before this message, and its summary may have left out what stands: here ";
const WHERE = "[Filament: where you are — ";
const IDLE = "t1 was left running as your last turn ended, with nothing at work on it";
const NEWS = "Note: a file you read changed since";
const SKILL_AGAIN = "A skill named was loaded before you compacted, and its text may have gone with it: load it again with Filament's `skill` tool before you follow it.";
/** The same of a session that begins from Filament's copy of the chat, which may hold a skill's text or not. */
const SEED_SKILL = "A skill named was loaded earlier in this chat, and its text may not have come with the copy: load it again with Filament's `skill` tool before you follow it.";
/** A turn that loads a skill with Filament's tool, as Claude's raw messages carry the call. @param {string} name */
const loads = (name) => `~rawmcp ~mcpcall skill ${JSON.stringify({ name })}`;
const SHOW = `~mcpcall tasks ${JSON.stringify({ action: "show" })}`;
const ADD = `~mcpcall tasks ${JSON.stringify({ action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "Write the parser" }] })}`;
const START = `~mcpcall tasks ${JSON.stringify({ action: "start", ids: ["t1"] })}`;
/** JSON lines of a file, oldest first. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

/**
 * A fake coding agent as Claude's adapter is, its prompts and calls logged under `root` by its id.
 * @param {string} root @param {string} projDir @param {string} id @param {Record<string, string>} [env]
 */
const claude = (root, projDir, id, env = {}) => ({
  id,
  name: id,
  type: "acp",
  acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, `${id}-calls.jsonl`), FAKE_ACP_LOG: join(root, `${id}-prompts.jsonl`), FAKE_ACP_CLAUDE: "1", ...env }, cwdDefault: projDir, permissions: "allow-all", hints: false },
});

/** What a running app's tests read and send, over `shim` and the folder its agents log under. @param {() => Awaited<ReturnType<typeof startApp>>} app @param {() => string} rootOf @param {() => string} projOf */
const driver = (app, rootOf, projOf) => {
  /** @param {string} path @param {any} [init] */
  const json = async (path, init) => (await app().api(path, init)).json();
  /** @param {string} id */
  const at = (id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** A turn sent: its reply's words and its record's notes, once it ends. @param {string} id @param {string} content */
  const send = async (id, content) => {
    const res = await app().api(`${at(id)}/turns`, { method: "POST", body: { content, stream: false } });
    const status = res.status;
    const body = await res.json();
    const rec = await app().record(String(res.headers.get("x-filament-request-id")));
    const text = (body.content || []).filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join("");
    return { status, text: text || JSON.stringify(body), notes: [...(rec.changes || []), ...(rec.priorChanges || [])].map(String) };
  };
  return {
    json,
    at,
    send,
    /** A chat on `model`, its compaction model Filament's. @param {string} model @param {Record<string, any>} [settings] */
    open: async (model, settings = {}) => String((await json("/api/sessions", { method: "POST", body: { cwd: projOf(), model, preset: "plain", settings: { context: { compaction: { model: "m-1", mode: "auto" } }, ...settings } } })).id),
    /** A turn that must end well. @param {string} id @param {string} content */
    say: async (id, content) => {
      const r = await send(id, content);
      assert.equal(r.status, 200, r.text);
      return r;
    },
    /** The prompts an agent was sent, each its words. @param {string} who */
    prompts: (who) => lines(join(rootOf(), `${who}-prompts.jsonl`)).map((p) => String(p.text ?? p.prompt ?? "")),
    /** What an agent was sent while a turn of its ran: the prompts queued at it. @param {string} who */
    queued: (who) => lines(join(rootOf(), `${who}-calls.jsonl`)).filter((c) => c.method === "queued prompt").map((c) => String(c.words)),
    /** What the chat keeps of what its main agent heard of what is still open. @param {string} id */
    heard: (id) => /** @type {any} */ (app().app.memory).archive.metaOf(id, ["openHeard"])?.openHeard,
    /** The chat's task t1, as its graph keeps it. @param {string} id */
    task: (id) => /** @type {any} */ (app().app).graphs.get(id)?.tasks.find((/** @type {any} */ t) => t.id === "t1"),
    /** A command of the chat's main agent's, running until it is stopped. @param {string} id */
    command: (id) => startCommandShell(LONG, projOf(), { session: id, agent: null }, { onEnd: () => {} }),
  };
};

describe("what a checkpoint owes, through the app", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  /** The loop's next request is refused, as a provider refuses one. */
  let refuseNext = false;
  const d = driver(() => shim, () => root, () => projDir);
  const { at, json, open, send, say, prompts, queued, heard, task, command } = d;
  /** What the model behind Filament's loop was sent: each request's body. */
  const sent = () => up.received.map((c) => c.body);
  /** A queue's steps wait at their gates until `open`. @param {string} dir */
  const gatesOf = (dir) => ({
    shut: () => ["q1", "q2", "end"].forEach((f) => rmSync(join(root, dir, f), { force: true })),
    open: (/** @type {string[]} */ ...only) => (only.length ? only : ["q1", "q2", "end"]).forEach((f) => writeFileSync(join(root, dir, f), "")),
  });
  const gates = gatesOf("qgate");
  const altGates = gatesOf("agate");
  /** What comes back after a compaction from here on: queued at the agent's step, or, where its turn ended first, a prompt after it. */
  const backSince = () => {
    const [q, p] = [queued("own").length, prompts("own").length];
    return () => [...new Set([...queued("own").slice(q), ...prompts("own").slice(p)])].filter((w) => w.includes("compacted your context"));
  };
  /**
   * Cursor's CLI as the catalogue knows it, by its program's name (`cursor-agent`): the fake beside a shim of npm's kind
   * on Windows, whose script Filament runs with its own Node; elsewhere a script (nudge-parity-e2e.test.js).
   */
  const cursorProgram = () => {
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
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-checkpoint-owed-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    mkdirSync(join(root, "qgate"));
    mkdirSync(join(root, "agate"));
    writeFileSync(join(projDir, "a.txt"), "a\n");
    writeFileSync(join(projDir, "b.txt"), "a\n");
    up = await fakeUpstream((call) => {
      const asked = JSON.stringify(call.body || {});
      const summary = asked.includes("compaction summaries") || /summar/i.test(JSON.stringify(call.body?.messages?.at(-1) || ""));
      if (!summary && refuseNext) {
        refuseNext = false;
        return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "the request was refused as sent" } } };
      }
      return anthropicReply(summary ? "SUMMARY: the turns so far." : "ok", { model: "m-1", usage: { input_tokens: 10, output_tokens: 5 } });
    });
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          claude(root, projDir, "own", { FAKE_ACP_OWN_COMPACT: "1", FAKE_ACP_SESSION_CAPS: "resume,close,fork,delete", FAKE_ACP_QUEUE_GATE: join(root, "qgate") }),
          // An agent that names no compaction of its own by an id.
          claude(root, projDir, "alt", { FAKE_ACP_COMPACT_NO_ID: "1", FAKE_ACP_QUEUE_GATE: join(root, "agate") }),
          // One whose plan's window is used up: its wall holds it, so no other test runs on it.
          claude(root, projDir, "wall"),
          { id: "cli", name: "Cursor", type: "acp", acp: { command: cursorProgram(), args: [], env: { FAKE_ACP_CALLS: join(root, "cli-calls.jsonl"), FAKE_ACP_LOG: join(root, "cli-prompts.jsonl") }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } },
        ];
        cfg.routes = [
          { match: "own/*", upstream: "own", upstreamModel: "{1}", enabled: true },
          { match: "alt/*", upstream: "alt", upstreamModel: "{1}", enabled: true },
          { match: "wall/*", upstream: "wall", upstreamModel: "{1}", enabled: true },
          { match: "cli/*", upstream: "cli", upstreamModel: "{1}", enabled: true },
          { match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await disposeBackgroundShells();
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });

  // (fails before: yes — finding 1: the skills owed lived in a map only a compaction in a turn filled, and the block
  // owed after Compact now named none; finding 7: the block said "since your last message", "the skill tool" and a turn)
  test("the agent's own compaction outside a turn: its next turn's first prompt names the skills it had loaded, in words true then, once", async () => {
    const id = await open("own/fake-a");
    await say(id, loads("filament-setup"));
    const own = await shim.api(`${at(id)}/compact`, { method: "POST", body: { way: "own" } });
    assert.equal(own.status, 200, await own.clone().text());
    assert.deepEqual(heard(id), { lost: true });
    await say(id, "two");
    const owed = prompts("own").at(-1) || "";
    assert.ok(owed.startsWith(`two\n\n${OWED}are the skills you had loaded. ${SKILL_AGAIN}]`), owed);
    assert.match(owed, /\n\n<skills>\n- filament-setup\n<\/skills>\n/, owed);
    await say(id, "three");
    assert.equal(prompts("own").at(-1), "three", "said once");
  });

  // (fails before: yes — finding 1: a sub-agent's run on a coding agent kept its skills under its chat: it was told the
  // chat's agent's skills as its own, and its compaction wrote over what the chat's agent was owed)
  test("a sub-agent's run that compacts: it hears none of the chat's agent's skills, and what the chat's agent is owed stays its own", async () => {
    const id = await open("own/fake-a");
    await say(id, loads("filament-setup"));
    /** A sub-agent of the chat's on the coding agent, run to its end. @param {string} prompt */
    const ran = async (prompt) => {
      const spawn = await shim.api(`${at(id)}/subagents`, { method: "POST", body: { prompt, description: "Side run", model: "own/fake-a", deliver: false } });
      assert.equal(spawn.status, 200, await spawn.clone().text());
      const sa = String((await spawn.json()).subagent.id);
      return until(async () => ((await json(`${at(id)}/subagents`)).subagents || []).find((/** @type {any} */ s) => s.id === sa && s.status !== "running") || null, "the sub-agent's run to end");
    };
    gates.open();
    // Its own compaction, then two steps: what comes back to it is its own.
    const [q, p] = [queued("own").length, prompts("own").length];
    const first = await ran("~queue ~compactfirst");
    assert.equal(first.status, "done", JSON.stringify(first));
    const toldIt = [...queued("own").slice(q), ...prompts("own").slice(p)].filter((w) => w.includes("filament-setup"));
    assert.deepEqual(toldIt, [], "the chat's agent loaded it, not the sub-agent");
    // The chat's agent compacts with no step after; a sub-agent's run compacts before its next turn.
    await say(id, "~compact");
    assert.deepEqual(heard(id), { lost: true });
    const second = await ran("~queue ~compactfirst");
    assert.equal(second.status, "done", JSON.stringify(second));
    await say(id, "three");
    const owed = prompts("own").at(-1) || "";
    assert.ok(owed.startsWith("three\n\n") && owed.includes(`${OWED}are the skills you had loaded.`), owed);
    assert.match(owed, /\n\n<skills>\n- filament-setup\n<\/skills>\n/, owed);
  });

  // (fails before: yes — finding 1: a second compaction before the first block went out wrote the skills over with what
  // the turn had loaded since the first: none)
  test("it compacts twice before its next step: the one block names the skill it loaded before the first", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    const since = backSince();
    await say(id, `~skillfirst filament-setup ~compactthen2 ${SHOW}`);
    const back = since();
    assert.equal(back.length, 1, back.join("\n----\n"));
    assert.ok(back[0].startsWith(`[Filament: ${JUST_NOW}, and its summary may have left out what stands: here are the skills you had loaded. ${SKILL_AGAIN}]`), back[0]);
    assert.match(back[0], /\n\n<skills>\n- filament-setup\n<\/skills>\n/, back[0]);
  });

  // (fails before: yes — finding 2: the owed block carried the graph in place of where it stands, and the turn's start
  // was never kept: the turn went uncounted, and the line of a task left idle was said again a turn later)
  test("the block owed at a turn's start carries the task graph: the start is kept — the turn counted on its running task, a task left idle said once", async () => {
    const id = await open("own/fake-a");
    assert.match((await say(id, ADD)).text, /Added t1\./);
    await say(id, START);
    assert.equal(task(id).idle, true, "left running as its turn ended, with nothing at work on it");
    const own = await shim.api(`${at(id)}/compact`, { method: "POST", body: { way: "own" } });
    assert.equal(own.status, 200, await own.clone().text());
    await say(id, "three");
    const owed = prompts("own").at(-1) || "";
    assert.ok(owed.startsWith("three\n\n[Filament: You compacted your context ") && owed.includes(", and its summary may have left out what stands: here is the task graph as it stands.]"), owed);
    assert.ok(owed.includes("<tasks>") && owed.includes(IDLE), owed);
    assert.equal(owed.split(WHERE).length, 2, "where it stands, once: in the block");
    assert.deepEqual([task(id).quiet, task(id).idle, task(id).idleTold], [1, undefined, true], "the turn's start was kept as the block went");
    await say(id, "four");
    assert.ok(!(prompts("own").at(-1) || "").includes(IDLE), "said once");
    await say(id, "five");
    assert.ok((prompts("own").at(-1) || "").includes("t1 has run 3 turns with no checkpoint"), prompts("own").at(-1));
  });

  // (fails before: yes — finding 3: the turn's start and the files' sightings were kept as the prompt was written to the
  // agent, so a prompt that failed with no word of its own took them, and its next prompt said neither)
  test("a prompt that failed once it was sent, before any word or call of the agent's, keeps nothing of the start it carried: its next prompt says it all again", async () => {
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const id = await open("own/fake-a");
    // It reads the readme and edits it: what it wrote is what it saw.
    await say(id, "~work");
    assert.match((await say(id, ADD)).text, /Added t1\./);
    await say(id, START);
    assert.equal(task(id).idle, true);
    writeFileSync(join(projDir, "README.md"), "hello agent\nedited by the person\nand again\n");
    // The model's server fails under the prompt: a call that says nothing, then the prompt's failure.
    const refused = await send(id, "~quietspend this");
    assert.notEqual(refused.status, 200, refused.text);
    const carried = prompts("own").at(-1) || "";
    assert.ok(carried.startsWith("~quietspend this\n\n") && carried.includes(NEWS) && carried.includes(IDLE), `the failed prompt carried them: ${carried}`);
    assert.deepEqual([task(id).quiet, task(id).idle], [undefined, true], "no word of the agent's came to it: nothing of its start is kept");
    await say(id, "after");
    const told = prompts("own").at(-1) || "";
    assert.ok(told.startsWith("after\n\n") && told.includes(NEWS) && told.includes("\n- README.md: ") && told.includes(IDLE), told);
    assert.deepEqual([task(id).quiet, task(id).idle], [1, undefined]);
    await say(id, "again");
    const once = prompts("own").at(-1) || "";
    assert.ok(!once.includes(NEWS) && !once.includes(IDLE), once);
  });

  // (fails before: yes — finding 3: a plan's window used up says so with a count of the plan before the prompt fails;
  // the start was kept at the prompt's `sent` step all the same)
  test("a prompt refused at the plan's wall, its window counted first: no word of the agent's, and nothing of the start is kept", async () => {
    const id = await open("wall/fake-a");
    assert.match((await say(id, ADD)).text, /Added t1\./);
    await say(id, START);
    assert.equal(task(id).idle, true);
    const walled = await send(id, "~spent");
    assert.notEqual(walled.status, 200, walled.text);
    assert.ok((prompts("wall").at(-1) || "").includes(IDLE), "the prompt carried it");
    assert.deepEqual([task(id).quiet, task(id).idle], [undefined, true]);
  });

  // (fails before: yes — finding 3: the loop counted the turn and marked its idle task told as its first request was
  // written, so a request the provider refused took both)
  test("Filament's loop: a first request the provider refused keeps nothing of the start it carried, and the next turn's says it again", async () => {
    const id = await open("m-1");
    await say(id, "one");
    const graphs = /** @type {any} */ (shim.app).graphs;
    assert.ok(graphs.apply(id, { action: "add", goal: "Ship the lexer", tasks: [{ id: "t1", name: "Write the lexer" }] }, { crew: "agent" }).ok);
    assert.ok(graphs.apply(id, { action: "start", ids: ["t1"] }, { crew: "agent" }).ok);
    await say(id, "two");
    assert.deepEqual([task(id).quiet, task(id).idle], [1, true]);
    refuseNext = true;
    const refused = await send(id, "three");
    assert.notEqual(refused.status, 200, refused.text);
    assert.ok(JSON.stringify(sent().at(-1)?.messages?.at(-1) || "").includes(IDLE), "the refused request carried it");
    assert.deepEqual([task(id).quiet, task(id).idle], [1, true], "no reply came: nothing of the turn's start is kept");
    const mark = sent().length;
    await say(id, "four");
    assert.ok(JSON.stringify(sent()[mark]?.messages?.at(-1) || "").includes(IDLE), JSON.stringify(sent()[mark]?.messages?.at(-1)));
    assert.deepEqual([task(id).quiet, task(id).idle, task(id).idleTold], [2, undefined, true]);
  });

  // (fails before: yes — finding 6: compactions were told apart by their ids, so an agent that sends none had its second
  // one of a turn taken for the first said again, and nothing came back after it)
  test("an agent that names no compaction by an id compacts twice in a turn: each brings its block back at the next step", async () => {
    const id = await open("alt/fake-a");
    await say(id, "one");
    const run = command(id);
    altGates.shut();
    const from = queued("alt").length;
    const blocks = () => queued("alt").slice(from).filter((w) => w.includes(JUST_NOW));
    const turn = send(id, "~queue ~compactfirst ~compactat q2");
    try {
      await until(() => blocks().length === 1, "what comes back after its first compaction, queued at its first step");
      altGates.open("q1");
      await until(() => blocks().length === 2, "what comes back after its second compaction, queued at its second step");
    } finally {
      altGates.open();
      await turn;
    }
    assert.equal((await turn).status, 200);
    assert.deepEqual(heard(id), { keys: [`command:${run.id}`] });
    await stopShell(run.id, { session: id, agent: null });
  });

  // (fails before: yes — finding 5: a block's `heard`, run once the agent took it in, cleared what a compaction that came
  // while the block was on its way had set: nothing said after that one, and its next turn said nothing either)
  test("it compacts again while a block is on its way to it: that block's hearing leaves the later compaction to be said, at its next turn's start", async () => {
    const id = await open("own/fake-a");
    await say(id, "one");
    const run = command(id);
    gates.shut();
    gates.open("q1");
    const from = queued("own").length;
    const turn = send(id, "~queue ~compactat q2 ~compactin q2");
    try {
      await until(() => queued("own").slice(from).some((w) => w.includes(JUST_NOW)), "what comes back after its first compaction, queued at its second step");
    } finally {
      gates.open();
    }
    const { status, text, notes } = await turn;
    assert.equal(status, 200, text);
    assert.deepEqual(heard(id), { lost: true }, "it compacted after the block was sent: nothing has said what is open since");
    assert.ok(notes.includes("acp: own compacted its context and took no step Filament could send words in at: its next turn's first prompt says what the compaction may have lost"), notes.join("\n"));
    await say(id, "two");
    const owed = prompts("own").at(-1) || "";
    assert.ok(owed.startsWith(`two\n\n${OWED}is what is still open.`) && owed.includes(`- background command ${run.id}: \``), owed);
    assert.deepEqual(heard(id), { keys: [`command:${run.id}`] });
    await stopShell(run.id, { session: id, agent: null });
  });

  // (fails before: yes — finding 8: every call of its own owed a tail of its own while the block waited, each made
  // again as Filament's next answer went)
  test("Cursor's CLI compacts and makes calls of its own before one of Filament's: one answer's tail is owed for the block, however many calls", async () => {
    const id = await open("cli/fake-a");
    await say(id, "one");
    const run = command(id);
    const tails = /** @type {any} */ (shim.app).toolTails;
    const owe = tails.owe;
    let owes = 0;
    tails.owe = (/** @type {string} */ chain, /** @type {any} */ o) => {
      if (chain === id) owes++;
      return owe(chain, o);
    };
    try {
      const { text, notes } = await say(id, `~compactthen ~twoedits ~mcplate ${SHOW}`);
      assert.ok(text.indexOf(JUST_NOW) > text.indexOf("mcp:"), text);
      assert.equal(text.split(JUST_NOW).length, 2, "one block");
      assert.ok(notes.includes("acp: what comes back after Cursor's compaction rode the end of Filament's next tool answer to it"), notes.join("\n"));
      // Its first edit owes the block's tail; its second adds none; Filament's call owes the unplanned line, which the
      // second edit earned.
      assert.equal(owes, 2, "the block's tail once, and what the call itself brought");
    } finally {
      tails.owe = owe;
      await stopShell(run.id, { session: id, agent: null });
    }
  });

  // (fails before: yes — finding 8: the reminder of a sealed envelope went as a prompt of its own without the block that
  // waited, which then waited for the next turn though a prompt went)
  test("it compacts with no step after, and its turn would end with an envelope sealed: the reminder's prompt carries what comes back", async () => {
    const id = await open("own/fake-a", { subagents: { pool: [{ model: "m-1", seats: 4 }] } });
    const launch = { description: "Map it", prompt: "List the files", run_in_background: true };
    const first = await say(id, `~mcpcall agent ${JSON.stringify(launch)} ~steerable`);
    assert.match(first.text, /heard:\[Filament: envelope 1, sealed — /, first.text);
    const run = command(id);
    const from = prompts("own").length;
    const { notes } = await say(id, "~compact");
    const mine = prompts("own").slice(from);
    // One prompt: what is open comes back, then the reminder, which says the envelopes — the block lists none itself.
    assert.ok(mine[1].startsWith(`[Filament: ${JUST_NOW}, and its summary may have left out what stands: here is what is still open.`) && mine[1].includes(`- background command ${run.id}: \``), mine[1]);
    assert.ok(mine[1].includes(`</open>\n${RECALL_AFTER}\n\n[Filament: one envelope is still sealed (envelope 1, `) && !mine[1].includes("still sealed, oldest first"), mine[1]);
    assert.equal(mine.length, 2, `its prompt, then the reminder with the block: ${mine.join("\n----\n")}`);
    assert.ok(notes.some((n) => n.startsWith("acp: what comes back after own's compaction went with the prompt that")), notes.join("\n"));
    assert.ok(heard(id) && !("lost" in heard(id)), `the block went: nothing is owed its next turn: ${JSON.stringify(heard(id))}`);
    await say(id, "three");
    assert.ok(!(prompts("own").at(-1) || "").includes("compacted your context"), prompts("own").at(-1));
    await stopShell(run.id, { session: id, agent: null });
  });
});

describe("what a checkpoint owes, across a restart", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  let own = "";
  let fresh = "";
  let bare = "";
  let plain = "";
  const d = driver(() => shim, () => root, () => projDir);
  const { at, open, say, prompts, heard } = d;
  /** The agent compacts its own context outside a turn, as Compact now asks it to. @param {string} id */
  const compacted = async (id) => {
    const res = await shim.api(`${at(id)}/compact`, { method: "POST", body: { way: "own" } });
    assert.equal(res.status, 200, await res.clone().text());
  };
  /** @param {any} cfg */
  const configure = (cfg) => {
    cfg.upstreams = [
      // One that opens its session again after a restart, and one that cannot: its chat goes on in a new session.
      claude(root, projDir, "own", { FAKE_ACP_SESSION_CAPS: "resume,close" }),
      claude(root, projDir, "fresh", { FAKE_ACP_NO_LOAD: "1", FAKE_ACP_OWN_COMPACT: "1" }),
      // And one that cannot either, whose compaction hands no summary over: Filament's copy keeps its turns as they were.
      claude(root, projDir, "bare", { FAKE_ACP_NO_LOAD: "1", FAKE_ACP_OWN_COMPACT: "1", FAKE_ACP_COMPACT_FORM: "tool" }),
      { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } },
    ];
    cfg.routes = [
      { match: "own/*", upstream: "own", upstreamModel: "{1}", enabled: true },
      { match: "fresh/*", upstream: "fresh", upstreamModel: "{1}", enabled: true },
      { match: "bare/*", upstream: "bare", upstreamModel: "{1}", enabled: true },
      { match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true },
    ];
    cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-checkpoint-owed-restart-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    up = await fakeUpstream(() => anthropicReply("ok", { model: "m-1", usage: { input_tokens: 10, output_tokens: 5 } }));
    shim = await startApp({ keep: true, configure });
    // Each compacts with nothing said after it, so its next turn's first prompt owes it what the compaction may have
    // lost: one in a turn, with no step after; two outside a turn, so that nothing their chats keep asks the session
    // that begins from them to compact again (the scripted agent reads a seed's words as words to it).
    own = await open("own/fake-a");
    await say(own, loads("filament-setup"));
    await say(own, "~compact");
    fresh = await open("fresh/fake-a");
    await say(fresh, "one");
    assert.ok(/** @type {any} */ (shim.app).graphs.apply(fresh, { action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "Write the parser" }] }, { crew: "agent" }).ok);
    await compacted(fresh);
    bare = await open("bare/fake-a");
    await say(bare, loads("filament-setup"));
    await compacted(bare);
    // And one whose compaction had nothing to take: no task graph, nothing open, no skill loaded.
    plain = await open("fresh/fake-a");
    await say(plain, "one");
    await compacted(plain);
    assert.deepEqual([heard(own), heard(fresh), heard(bare), heard(plain)], [{ lost: true }, { lost: true }, { lost: true }, { lost: true }]);
    await shim.stop();
    shim = await startApp({ dataDir: shim.dataDir, keep: true, configure });
  });
  after(async () => {
    await disposeBackgroundShells();
    await shim.stop();
    await up.close();
    await removeDirs(root, shim.dataDir);
  });

  // (fails before: yes — finding 1: the skills owed were kept in the process alone, and a restart lost them while the
  // chat still kept that nothing was said after the compaction)
  test("Filament restarts between its compaction and its next turn: the owed block still names the skills it had loaded", async () => {
    await say(own, "after");
    const owed = prompts("own").at(-1) || "";
    assert.ok(owed.startsWith(`after\n\n${OWED}are the skills you had loaded. ${SKILL_AGAIN}]`), owed);
    assert.match(owed, /\n\n<skills>\n- filament-setup\n<\/skills>\n/, owed);
    await say(own, "again");
    assert.equal(prompts("own").at(-1), "again", "said once");
  });

  // (fails before: yes — finding 7: a session that begins from Filament's copy of the chat was told it had compacted its
  // context, and handed the task graph twice: in the block kept with the copy's summary, and in the block owed)
  test("its chat goes on in a new session, begun from Filament's copy: nothing says it compacted, and the task graph comes once, in its seed", async () => {
    const { notes } = await say(fresh, "after");
    const seeded = prompts("fresh").at(-1) || "";
    assert.ok(seeded.includes("\nKept: one\n") && seeded.includes("Latest user message:\n\nafter"), seeded);
    assert.ok(!seeded.includes("You compacted your context"), seeded);
    assert.equal(seeded.split("<tasks>").length, 2, seeded);
    assert.equal(seeded.split(WHERE).length, 2, seeded);
    assert.ok(notes.includes("acp: fresh's new session begins from Filament's copy of the chat, which holds what its compaction left: nothing is said of the compaction beside it"), notes.join("\n"));
    assert.equal(heard(fresh), undefined, "its seed went: nothing is owed its next turn");
    await say(fresh, "again");
    const next = prompts("fresh").at(-1) || "";
    assert.ok(next.startsWith("again\n\n") && !next.includes("compacted"), next);
  });

  // (fails before: yes — findings 1 and 7: after a restart nothing named the skill, and the new session was told its
  // chat's context was compacted since its last message)
  test("its chat goes on in a new session after a compaction that handed no summary over: the skill it had loaded is named once, in words true of that session", async () => {
    await say(bare, "after");
    const seeded = prompts("bare").at(-1) || "";
    assert.ok(seeded.includes("Latest user message:\n\nafter"), seeded);
    assert.ok(!seeded.includes("You compacted your context") && !seeded.includes("This chat's context was compacted"), seeded);
    assert.ok(seeded.includes(`[Filament: Your session begins from Filament's copy of this chat: here are the skills you had loaded. ${SEED_SKILL}]\n\n<skills>\n- filament-setup\n</skills>`), seeded);
    assert.equal(seeded.split("\n- filament-setup\n").length, 2, "named once");
    assert.equal(heard(bare), undefined, "its seed went: nothing is owed its next turn");
    await say(bare, "again");
    assert.equal(prompts("bare").at(-1), "again", "said once");
  });

  // (fails before: yes — finding 7: with nothing to bring back, the new session was told "This chat's context was
  // compacted since your last message": a compaction it never saw, since a message it never sent)
  test("its chat goes on in a new session with nothing its compaction could have taken: its prompt says nothing of the compaction", async () => {
    const { notes } = await say(plain, "after");
    const seeded = prompts("fresh").at(-1) || "";
    assert.ok(seeded.includes("\nKept: one\n") && seeded.endsWith("Latest user message:\n\nafter"), seeded);
    assert.ok(notes.includes("acp: fresh's new session begins from Filament's copy of the chat, which holds what its compaction left: nothing is said of the compaction beside it"), notes.join("\n"));
    assert.equal(heard(plain), undefined, "its seed went: nothing is owed its next turn");
    await say(plain, "again");
    assert.equal(prompts("fresh").at(-1), "again");
  });
});
