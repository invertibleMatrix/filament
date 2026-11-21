// @ts-check
// The Cursor SDK's own tools on Filament's hands, as a chat without a client's tools gets them (clientBridge "full"):
// its Edit is the loop's edit hand, and its Bash lets go of its timer with the command (fable51's list).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CursorSdkBridge } from "../src/adapters/agents/cursor-sdk.js";
import { openTaskWorktree, releaseTaskWorktree } from "../src/adapters/git/worktree.js";
import { FIXTURES } from "./helpers/app.js";
import { copyMeta } from "./helpers/copies.js";

const SDK = () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href);
/** @type {string} */ let dir;
/** @type {CursorSdkBridge} */ let bridge;
/** The tools the bridge handed the agent. @type {Record<string, { execute: (a: any) => Promise<any> }>} */ let tools;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "filament-cursor-tools-"));
  bridge = new CursorSdkBridge(/** @type {any} */ ({ log: () => {}, loader: SDK }));
  const upstream = { id: "cur-tools", name: "cur-tools", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir, permissions: "allow-all", clientBridge: "full" } };
  const body = { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hello" }] };
  await bridge.run({ upstream, modelId: "grok-4.6", format: "anthropic", body, conversationId: "chat", onEvent: () => {} });
  const [[, chat]] = [...bridge.convs];
  tools = /** @type {any} */ (bridge.agents.get(chat.agentId))._customTools;
});
after(() => {
  bridge.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — the Edit read and wrote the raw text: an old_string with LF lines missed a CRLF file, and a file
// that is not UTF-8 had every byte the edit did not touch rewritten)
test("Edit is the loop's edit: a CRLF file with a BOM takes LF lines and keeps both; one not UTF-8 is refused untouched", async () => {
  const win = join(dir, "bom-crlf.txt");
  writeFileSync(win, "\uFEFFone\r\ntwo\r\nthree\r\n");
  assert.equal(await tools.Edit.execute({ path: "bom-crlf.txt", old_string: "one\ntwo", new_string: "ONE\nTWO" }), `Successfully replaced 1 block in ${win}`);
  assert.equal(readFileSync(win, "utf8"), "\uFEFFONE\r\nTWO\r\nthree\r\n");
  const latin1 = join(dir, "latin1.txt");
  const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a, 0x6f, 0x6e, 0x65, 0x0a]); // café, one: the é one Latin-1 byte
  writeFileSync(latin1, bytes);
  const refused = await tools.Edit.execute({ path: latin1, old_string: "one", new_string: "two" });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /^Error: .*latin1\.txt is not UTF-8 text/);
  assert.deepEqual(readFileSync(latin1), bytes, "its bytes as they were");
  // (fails before: no — a guard the mutation pass asked for: replace_all was not handed to the edit)
  writeFileSync(join(dir, "twice.txt"), "beta\nbeta\n");
  assert.equal(await tools.Edit.execute({ path: "twice.txt", old_string: "beta", new_string: "B", replace_all: true }), `Successfully replaced 2 blocks in ${join(dir, "twice.txt")}`);
  assert.equal(readFileSync(join(dir, "twice.txt"), "utf8"), "B\nB\n");
});

/** Whether a process of this id still runs. @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** @param {() => boolean} ok @param {string} what */
const until = async (ok, what) => {
  for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(ok(), what);
};

// (fails before: yes — HarnessV4_Tasks B13, seen live on 2026-10-11: a stop cancelled Cursor's run and left the
// command Filament's own hands ran for it going — 90 s of it, to its end, the turn long over)
test("Bash: a stop of the turn ends the command Filament's hands run for it, and a call after the stop starts nothing", async () => {
  const log = join(dir, "sdk-log.jsonl");
  const pidFile = join(dir, "pid.txt");
  process.env.FAKE_SDK_LOG = log;
  const upstream = { id: "cur-stop", name: "cur-stop", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir, permissions: "allow-all", clientBridge: "full" } };
  const stop = new AbortController();
  try {
    // The command writes its process's id, then waits a minute: nothing but the stop ends it sooner.
    const command = `node -e "require('fs').writeFileSync('pid.txt',String(process.pid));setTimeout(()=>{},60000)"`;
    const body = { model: "m", max_tokens: 100, messages: [{ role: "user", content: `~bash:${command}~ then say so` }] };
    const turn = bridge.run({ upstream, modelId: "grok-4.6", format: "anthropic", body, conversationId: "stop-chat", signal: stop.signal, onEvent: () => {} });
    await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").length > 0, "the command started");
    const pid = Number(readFileSync(pidFile, "utf8"));
    assert.ok(alive(pid), "and runs");
    const at = Date.now();
    stop.abort();
    const out = await turn;
    assert.equal(out.stopReason, "cancelled");
    await until(() => !alive(pid), "the command's process ended with the turn");
    assert.ok(Date.now() - at < 10_000, `ended by the stop, not by its own minute (${Date.now() - at} ms)`);
    // What the tool answered Cursor's run, which no longer listens: the output so far, and why it ended.
    const said = () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.event === "bash");
    await until(() => !!said(), "the tool answered");
    assert.match(said().result, /^\(no output\)\n\(Filament: the command was ended with the turn, which was stopped\)/);
    // A call that comes after the stop — the person was being asked, say — starts nothing.
    const chat = /** @type {any} */ ([...bridge.convs.values()].at(-1));
    const late = await /** @type {any} */ (bridge.agents.get(chat.agentId))._customTools.Bash.execute({ command: "node -e \"require('fs').writeFileSync('late.txt','x')\"" });
    assert.deepEqual([late.isError, late.content[0].text], [true, "Error: the turn was stopped before the command started"]);
    assert.equal(existsSync(join(dir, "late.txt")), false);
  } finally {
    delete process.env.FAKE_SDK_LOG;
  }
});

/**
 * A turn that hangs until it is steered or stopped, with the way into it as its session handed it over.
 * @param {string} id @param {string} words
 */
const hangingTurn = async (id, words) => {
  const upstream = { id: "cur-steer", name: "cur-steer", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir, permissions: "allow-all", clientBridge: "prompts" } };
  /** @type {any} */
  let steer;
  /** @type {string[]} */
  const said = [];
  const stop = new AbortController();
  const body = { model: "m", max_tokens: 100, messages: [{ role: "user", content: words }] };
  const turn = bridge.run({ upstream, modelId: "grok-4.6", format: "anthropic", body, conversationId: id, signal: stop.signal, onEvent: (/** @type {any} */ ev) => void (ev.type === "session" ? (steer = ev.steer) : ev.type === "text" && said.push(ev.text)) });
  await until(() => !!steer, "the session to open");
  return { turn, steer, said, stop };
};

// (fails before: yes — HarnessV4_Tasks B14: the bridge handed over no way into Cursor's running turn, so words sent
// while it worked always waited for its end; the SDK takes them itself, `Run.steer`)
test("words sent while Cursor works go into its running turn through the SDK's own steer, and the session has them", async () => {
  const { turn, steer, said } = await hangingTurn("steer-chat", "~hang on this");
  assert.equal(steer.at, "live");
  // Sent before the run exists or after, the words reach it: the way in waits for the run.
  assert.equal(await steer.send("[the developer adds] also the tests", "also the tests"), true);
  const out = await turn;
  assert.equal(out.stopReason, "end_turn");
  assert.ok(said.join("").includes("heard:[the developer adds] also the tests"), said.join(""));
  const conv = /** @type {any} */ ([...bridge.convs.values()].at(-1));
  assert.deepEqual(conv.within?.texts, ["also the tests"], "the person's own words, taken within the turn");
});

// (fails before: yes — no way in was handed over at all)
test("words Cursor's run hands back, or an SDK with no steer cannot take, are not taken: they go as the next message", async () => {
  const back = await hangingTurn("steer-back", "~hang on this");
  assert.equal(await back.steer.send("~nosteer later"), false, "the SDK said to send it as a follow-up");
  // (fails before: no — a guard, the nudge map of 11-10, c-cursor: words handed back are the follow-up's to count)
  assert.equal(/** @type {any} */ ([...bridge.convs.values()].at(-1)).within, undefined, "the session took nothing within the turn");
  back.stop.abort();
  assert.equal((await back.turn).stopReason, "cancelled");
  assert.equal(await back.steer.send("too late"), false, "a run that is over takes nothing");
  process.env.FAKE_SDK_NO_STEER = "1";
  try {
    const old = await hangingTurn("steer-old", "~hang on this");
    assert.equal(await old.steer.send("anything"), false);
    old.stop.abort();
    await old.turn;
  } finally {
    delete process.env.FAKE_SDK_NO_STEER;
  }
});

// (fails before: yes — the timer raced against the command was never cleared: each call held it for two minutes)
test("Bash: a command that finishes does not leave its timeout timer running", async () => {
  const hands = bridge.hands;
  bridge.hands = /** @type {any} */ ({
    runTerminal: (/** @type {any} */ _a, /** @type {any} */ term) => {
      term.output = "done\n";
      term.exit = { exitCode: 0 };
      return Promise.resolve();
    },
    kill: () => {},
  });
  try {
    const timers = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
    const before = timers();
    assert.equal(await tools.Bash.execute({ command: "quick" }), "done");
    assert.ok(timers() <= before, `no timer survives the finished command: ${before} before, ${timers()} after`);
  } finally {
    bridge.hands = hands;
  }
});

// (fails before: yes — the bug hunt of 10-30, AGT-5: Read on Filament's hands read for Cursor under any policy, while
// its Write, Edit, Bash and Delete were judged)
test("Read on Filament's hands goes by the upstream's policy, as Write does: under reject it reads nothing", async () => {
  writeFileSync(join(dir, "kept.txt"), "kept\n");
  const was = bridge.latestAcp.get("cur-tools");
  bridge.latestAcp.set("cur-tools", { ...was, permissions: "reject" });
  try {
    const refused = await tools.Read.execute({ path: "kept.txt" });
    assert.equal(refused.isError, true);
    assert.equal(refused.content[0].text, "Error: refused by Filament's permission policy (reject)");
  } finally {
    bridge.latestAcp.set("cur-tools", was);
  }
  assert.equal(await tools.Read.execute({ path: "kept.txt" }), "kept\n");
});

// (fails before: yes — the review of 4dfe2433c: the Cursor SDK's file tools on Filament's hands never brought a sparse
// copy's folder in: a read outside its cone found no file, and a write landed beside files the copy does not hold)
test("Read, Write and Edit on Filament's hands bring a sparse copy's folder in and say so; one the policy refuses brings none", async () => {
  const repo = join(dir, "sparse-repo");
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: repo, env, windowsHide: true });
  for (const [p, s] of Object.entries({ "pkg/a/index.js": "a\n", "lib/c/x.js": "x\n", "docs/d/guide.md": "g\n", "docs/d/more.md": "more\n", "tools/e/run.js": "run\n" })) {
    mkdirSync(join(repo, p, ".."), { recursive: true });
    writeFileSync(join(repo, p), s);
  }
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  git("add", "-A");
  git("commit", "-qm", "init");
  const o = await openTaskWorktree(join(repo, "pkg", "a"), { id: "sa_cursorsparse", kind: "sparse" });
  assert.ok(o.ok, !o.ok ? o.error : "");
  const { wt } = o;
  try {
    const guide = join(wt.dest, "docs", "d", "guide.md");
    const was = bridge.latestAcp.get("cur-tools");
    bridge.latestAcp.set("cur-tools", { ...was, permissions: "reject" });
    try {
      for (const refused of [await tools.Read.execute({ path: guide }), await tools.Write.execute({ path: guide, content: "G\n" })])
        assert.deepEqual([refused.isError, refused.content[0].text], [true, "Error: refused by Filament's permission policy (reject)"]);
    } finally {
      bridge.latestAcp.set("cur-tools", was);
    }
    assert.deepEqual(copyMeta(wt.dest)?.cone, ["pkg/a"]);
    assert.ok(!existsSync(join(wt.dest, "docs")), "nothing of its folder on disk");
    assert.equal(await tools.Read.execute({ path: join(wt.dest, "lib", "c", "x.js") }), "x\n\n\n[Filament: lib/c/x.js lies outside the folders your sparse copy held: it holds lib/c/ now too.]");
    assert.equal(await tools.Write.execute({ path: guide, content: "G\n" }), `Wrote ${guide}\n\n[Filament: docs/d/guide.md lies outside the folders your sparse copy held: it holds docs/d/ now too.]`);
    assert.deepEqual([readFileSync(guide, "utf8"), readFileSync(join(wt.dest, "docs", "d", "more.md"), "utf8")], ["G\n", "more\n"], "its folder came in before the write");
    const run = join(wt.dest, "tools", "e", "run.js");
    assert.match(await tools.Edit.execute({ path: run, old_string: "run", new_string: "RUN" }), /\n\n\[Filament: tools\/e\/run\.js lies outside the folders your sparse copy held: it holds tools\/e\/ now too\.\]$/);
    assert.equal(readFileSync(run, "utf8"), "RUN\n");
    assert.deepEqual(copyMeta(wt.dest)?.cone, ["docs/d", "lib/c", "pkg/a", "tools/e"]);
  } finally {
    await releaseTaskWorktree(wt, "parked");
  }
});

// (fails before: yes — Filament's own tools in a Cursor turn stood in the turn's session and not in whose turn it was:
// one for a caller that reaches its own project's sessions alone called memory's tools as any other)
test("Filament's own tools, called in a Cursor turn for a caller that reaches its own project's sessions alone, are called as confined; in the next turn, for another, not", async () => {
  /** @type {any[]} */
  const seen = [];
  const was = bridge.agentTools;
  bridge.agentTools = /** @type {any} */ ({
    list: () => [{ name: "filament_memory_load", description: "load a session", inputSchema: { type: "object", properties: {} } }],
    has: (/** @type {string} */ name) => name === "filament_memory_load",
    call: async (/** @type {string} */ _name, /** @type {any} */ _args, /** @type {any} */ ctx) => (seen.push(ctx), { text: "ok" }),
  });
  try {
    const upstream = { id: "cur-confined", name: "cur-confined", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir, permissions: "allow-all", clientBridge: "full" } };
    const body = { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hello" }] };
    /** @param {any} toolsAt */
    const turn = (toolsAt) => bridge.run({ upstream, modelId: "grok-4.6", format: "anthropic", body, conversationId: "confined-chat", toolsAt, onEvent: () => {} });
    await turn({ chain: "c1", turn: "t1", graph: false, confined: true });
    const chat = /** @type {any} */ ([...bridge.convs.values()].at(-1));
    const own = /** @type {any} */ (bridge.agents.get(chat.agentId))._customTools;
    assert.equal(await own.filament_memory_load.execute({ session: "s1" }), "ok");
    await turn({ chain: "c1", turn: "t2", graph: false });
    assert.equal(await own.filament_memory_load.execute({ session: "s1" }), "ok");
    assert.deepEqual(seen.map((c) => c.confined === true), [true, false]);
  } finally {
    bridge.agentTools = was;
  }
});

// (fails before: yes — the review of b0ecfd5ee: a call once the session's turns were forgotten stood where the turn that
// made the agent's tools did, a caller that reaches every session, and was called unconfined)
test("Filament's own tools, called once the agent's session holds no turn, are called as confined, whoever's turn gave them", async () => {
  /** @type {any[]} */
  const seen = [];
  const was = bridge.agentTools;
  bridge.agentTools = /** @type {any} */ ({
    list: () => [{ name: "filament_memory_load", description: "load a session", inputSchema: { type: "object", properties: {} } }],
    has: (/** @type {string} */ name) => name === "filament_memory_load",
    call: async (/** @type {string} */ _name, /** @type {any} */ _args, /** @type {any} */ ctx) => (seen.push(ctx), { text: "ok" }),
  });
  try {
    const upstream = { id: "cur-forgotten", name: "cur-forgotten", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir, permissions: "allow-all", clientBridge: "full" } };
    const body = { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hello" }] };
    /** @param {any} toolsAt */
    const turn = (toolsAt) => bridge.run({ upstream, modelId: "grok-4.6", format: "anthropic", body, conversationId: "forgotten-chat", toolsAt, onEvent: () => {} });
    // A turn for a caller that reaches every session makes the agent, with its tools; one for a confined caller follows.
    await turn({ chain: "c1", turn: "t1", graph: false });
    const chat = /** @type {any} */ ([...bridge.convs.values()].at(-1));
    const own = /** @type {any} */ (bridge.agents.get(chat.agentId))._customTools;
    await turn({ chain: "c1", turn: "t2", graph: false, confined: true });
    // Turns that ended long ago are forgotten; the agent keeps its tools.
    bridge.sweepTurns(Date.now() + 31 * 60_000);
    assert.equal(await own.filament_memory_load.execute({ session: "s1" }), "ok");
    assert.deepEqual(seen.map((c) => c.confined === true), [true]);
  } finally {
    bridge.agentTools = was;
  }
});
