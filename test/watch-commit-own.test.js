// @ts-check
// Whose a commit is, engine by engine (app/watchers/commits.js): a watcher of a branch leaves out the commits of the
// chat it would wake, made while a command of that chat that could have made one ran — so what each engine says of its
// calls is what the commit watch goes by. Filament's loop on a real repository, with a real watcher and the server's
// own wiring; a coding agent's by each bridge — ACP in Claude's shape and in none, Codex's app-server, Cursor's SDK —
// through the fake agents (test/fixtures), its run's events heard on the app's own bus by a keeper of each chat's own
// times (app/watchers/own-times.js), as the server's hears them.
// (fails before: yes, each — the loop's: the person's commit made while the chat's model call was out was never heard,
// and its background command's commit, made after its turn, was; a coding agent's: no call's start said `command`,
// and the commit watch heard no run; the hooks' test is a pin of what is kept — it fails with the run's `hooks` unsaid;
// the loop's file hands': no call's start said `edits`, and nothing kept a chat's file-writing calls)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { routineFields } from "../src/core/routines.js";
import { createOwnTimes } from "../src/app/watchers/own-times.js";
import { runningShellsOf } from "../src/adapters/tools/hands.js";
import { startApp, fakeUpstream, anthropicReply, FIXTURES, FAKE_ACP_AGENT } from "./helpers/app.js";
import { gate, removeDirs, until } from "./helpers/wait.js";

const FAKE_CODEX = join(FIXTURES, "fake-codex-app-server.mjs");
const FAKE_SDK = pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href;
const AS = ["-c", "user.email=t@t", "-c", "user.name=t"];

/** A repository on main with one commit: its git, its tip, and a commit of the person's. @param {string} dir */
const repoIn = (dir) => {
  mkdirSync(dir, { recursive: true });
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", [...AS, ...args], { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "hello\n");
  writeFileSync(join(dir, "notes.txt"), "hello\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  const head = () => git("rev-parse", "HEAD");
  return {
    dir,
    git,
    head,
    /** @param {string} subject */
    commit: (subject) => {
      git("commit", "-q", "--allow-empty", "-m", subject);
      return head();
    },
  };
};

describe("whose a commit is, by Filament's loop: a real Filament, a real repository, the server's own watcher", () => {
  const base = mkdtempSync(join(tmpdir(), "filament-commit-own-loop-"));
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** Every conversation the model was sent, as text. @type {string[]} */
  const sent = [];
  /** The first model call of the turn that reads then commits: held until the test lets it go. */
  const thinking = { arrived: gate(), go: gate() };
  const OWN = `git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "The chat's own"`;
  // It commits seconds after the turn that started it let go, and runs on for seconds more: no turn of the chat is near its commit.
  const LATER = `sleep 5 && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "From the background" && sleep 4`;

  before(async () => {
    up = await fakeUpstream(async (/** @type {any} */ call) => {
      if (call.kind !== "anthropic") return undefined;
      const msgs = Array.isArray(call.body?.messages) ? call.body.messages : [];
      sent.push(JSON.stringify(msgs));
      const last = msgs.at(-1);
      /** @type {any[]} */
      const blocks = Array.isArray(last?.content) ? last.content : [];
      const words = typeof last?.content === "string" ? last.content : blocks.map((b) => b?.text || "").join("\n");
      const answers = String(blocks.find((b) => b?.type === "tool_result")?.tool_use_id || "");
      /** @param {string} id @param {string} name @param {any} input */
      const calls = (id, name, input) => anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id, name, input }], usage: { input_tokens: 30, output_tokens: 7 } });
      // The loop's own model calls offer its tools: its run has started by then. Any other call is answered in words.
      const loop = Array.isArray(call.body?.tools) && call.body.tools.length > 0;
      if (loop && words.includes("Read, then commit.")) {
        thinking.arrived.open();
        await thinking.go.promise;
        return calls("a1", "bash", { command: "git log -1 --format=%s" });
      }
      if (loop && answers === "a1") return calls("a2", "bash", { command: OWN });
      if (loop && words.includes("Commit later.")) return calls("b1", "bash_background", { command: LATER });
      if (loop && words.includes("Write, then edit.")) return calls("w1", "write", { path: "made.txt", content: "one\n" });
      if (loop && answers === "w1") return calls("w2", "edit", { path: "./made.txt", edits: [{ oldText: "one", newText: "two" }] });
      if (loop && answers === "w2") return calls("w3", "read", { path: "made.txt" });
      return anthropicReply("Done.", { model: "brain-model" });
    });
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [base], readerModel: "" };
      },
    });
  });
  after(async () => {
    thinking.go.open();
    await shim?.stop();
    await up?.close();
    await removeDirs(base);
  });

  /**
   * A chat in a repository of its own, and a watcher of its main branch that wakes that chat, switched on as the
   * person switches one on: its first look kept.
   * @param {string} name @param {any} [settings]  the chat's own settings, where it has some
   */
  const watched = async (name, settings) => {
    const r = repoIn(join(base, name));
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: r.dir, model: "agent/brain-model", preset: "plain", ...(settings ? { settings } : {}) } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const app = /** @type {any} */ (shim.app);
    const project = String(app.memory.archive?.getChain(id)?.project_id || "");
    assert.ok(project, "the chat is of a project");
    const spaces = app.spaces;
    spaces.make(project);
    const f = routineFields({ title: "Commits", text: "Review what landed.", trigger: { kind: "commit", branch: "main" }, wakes: "chat" }, { create: true });
    assert.ok(f.ok, JSON.stringify(f));
    const w = spaces.routinePropose(project, f.fields, { chain: id, byName: "Lead", model: "agent/brain-model", nameOf: () => "Lead" });
    const on = await shim.api(`/api/space/${encodeURIComponent(project)}/routines/${encodeURIComponent(w.id)}/on`, { method: "POST", body: {} });
    assert.equal(on.status, 200, await on.clone().text());
    const watcher = () => spaces.get(project).routines.find((/** @type {any} */ x) => x.id === w.id);
    const first = r.head();
    await until(() => watcher()?.seen?.head === first, "its first look kept", { timeoutMs: 30_000 });
    // The chat's turns, counted as its lock is taken.
    const turns = { n: 0, held: false };
    app.events.subscribe("turns", (/** @type {any} */ p) => {
      if (p?.type !== "turn" || p.chainId !== id) return;
      if (p.holder && !turns.held) turns.n++;
      turns.held = !!p.holder;
    });
    return {
      ...r,
      id,
      watcher,
      /** How many turns the chat has begun. */
      turns: () => turns.n,
      /** What waits for its turn in the chat: each event's words. @returns {string[]} */
      waiting: () => (watcher()?.pending?.events || []).map((/** @type {any} */ e) => String(e.summary)),
      /** Whether a turn holds the chat. */
      busy: () => !!app.sessionTurns.holder(app.memory.archive.getChain(id).key),
      /** A turn of the chat, as the page sends one. @param {string} content */
      turn: (content) => shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } }),
    };
  };
  /** @param {string} runId @returns {Promise<any[]>} */
  const runEvents = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events;

  test("the person's commit made while the chat's model call is out is heard; the chat's own, made by its command, is not — its git log said as no command, its git commit as one", async () => {
    const c = await watched("thinks");
    const turn = c.turn("Read, then commit.");
    // Its model call is out: the turn is at work, and no command of it runs.
    await thinking.arrived.promise;
    const theirs = c.commit("The person's, as it thinks");
    await until(() => c.waiting().includes(`1 new commit on main: ${theirs.slice(0, 7)} The person's, as it thinks`), "the person's commit heard while the chat's turn is at work", { timeoutMs: 30_000 });
    thinking.go.open();
    const res = await turn;
    assert.equal(res.status, 200, await res.clone().text());
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    assert.equal(c.git("log", "-1", "--format=%s"), "The chat's own", "its command made its commit");
    const own = c.head();
    await until(() => c.watcher()?.seen?.head === own, "the chat's own commit looked at", { timeoutMs: 30_000 });
    assert.ok(!c.waiting().some((s) => s.includes(own.slice(0, 7))) && !sent.some((t) => t.includes(own.slice(0, 7))), "made while its command ran: no news to the watcher that wakes it");
    assert.deepEqual((await runEvents(runId)).filter((e) => e.type === "tool-start").map((e) => [e.id, e.command === true]), [["a1", false], ["a2", true]], "git log is read as only reading, so no command; git commit is one");
    // The watcher's turn in the chat, once its own let go, carries the person's commit — never the chat's own.
    await until(() => sent.some((t) => t.includes(theirs.slice(0, 7))), "the watcher's turn in the chat, with the person's commit", { timeoutMs: 30_000 });
    await until(() => !c.busy() && !c.waiting().length, "the watcher's turn over", { timeoutMs: 30_000 });
    assert.ok(!sent.some((t) => t.includes(own.slice(0, 7))), "the chat was never told of its own commit");
  });

  test("a background command the chat started commits after its turn ended: its own, not heard (the shells, as the server wires them)", async () => {
    const c = await watched("later");
    const res = await c.turn("Commit later.");
    assert.equal(res.status, 200, await res.clone().text());
    await res.text();
    const sha = String(await until(() => (c.git("log", "-1", "--format=%s") === "From the background" ? c.head() : null), "the background command's commit", { timeoutMs: 30_000 }));
    await until(() => c.watcher()?.seen?.head === sha, "its commit looked at", { timeoutMs: 30_000 });
    // Its command runs on for seconds: a turn the watcher woke the chat with has asked its model by its end. That end
    // wakes the chat, and that turn runs out before Filament stops.
    await until(() => !runningShellsOf(c.id).length, "its command's end", { timeoutMs: 30_000 });
    await until(() => c.turns() >= 2 && !c.busy(), "the turn its command's end woke the chat with, over", { timeoutMs: 30_000 });
    assert.deepEqual(c.waiting(), [], "made by its background command, its turn seconds over: its own");
    assert.ok(!sent.some((t) => t.includes(sha.slice(0, 7))), "and the chat was never told of it");
  });

  test("a chat with session hooks keeps the turn rule, as its run says: the commit its hook makes, by a command no call says, is its own", async () => {
    const c = await watched("hooks", { hooks: [{ on: "session-start", command: `git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "By its hook"` }] });
    const res = await c.turn("Hello.");
    assert.equal(res.status, 200, await res.clone().text());
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    assert.equal(c.git("log", "-1", "--format=%s"), "By its hook", "its session-start hook made its commit");
    const sha = c.head();
    await until(() => c.watcher()?.seen?.head === sha, "its hook's commit looked at", { timeoutMs: 30_000 });
    // A turn the watcher woke the chat with would have begun by now.
    await new Promise((ok) => setTimeout(ok, 1500));
    assert.deepEqual([c.turns(), c.waiting()], [1, []], "made in a turn of a chat with hooks: its own, and no turn of the watcher's");
    assert.ok(!sent.some((t) => t.includes(sha.slice(0, 7))), "and the chat was never told of it");
    assert.equal((await runEvents(runId)).find((e) => e.type === "run-start")?.meta?.hooks, true, "its run says its hooks run commands");
  });

  test("a write and an edit of the chat's say the file each writes, and a keeper hearing the bus keeps them as its writes: no time of a command's; a read says none", async () => {
    const c = await watched("writes");
    // A keeper as the server makes one, hearing the app's own bus as the server's does.
    const own = createOwnTimes();
    const off = own.listen(/** @type {any} */ (shim.app).events);
    try {
      const t0 = Date.now();
      const res = await c.turn("Write, then edit.");
      assert.equal(res.status, 200, await res.clone().text());
      const runId = String(res.headers.get("x-filament-request-id"));
      await res.text();
      const file = join(c.dir, "made.txt");
      assert.equal(readFileSync(file, "utf8"), "two\n", "both its hands ran");
      assert.deepEqual((await runEvents(runId)).filter((e) => e.type === "tool-start").map((e) => [e.id, e.edits, e.command === true]), [["w1", [file], false], ["w2", [file], false], ["w3", undefined, false]]);
      const writes = own.writesOf(c.id);
      assert.deepEqual(writes.map((w) => w.paths), [[file], [file]], "each kept with its file");
      assert.ok(writes.every((w) => w.to != null && w.from >= t0 && w.from <= w.to) && writes[0].from <= writes[1].from, JSON.stringify(writes));
      assert.deepEqual(own.timesOf(c.id), [], "a file's write is no time a commit could be the chat's own in");
    } finally {
      off();
      own.stop();
    }
  });
});

describe("whose a commit is, by a coding agent's run: what each bridge's real events give the keeper the commit watch asks", () => {
  const base = mkdtempSync(join(tmpdir(), "filament-commit-own-agents-"));
  const projDir = join(base, "project");
  // Claude's `~slowtool` runs until this file is there: the test holds it open, so how long it ran is the test's.
  const toolGate = join(base, "slowtool.gate");
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {import("../src/app/watchers/own-times.js").OwnTimes} */
  let own;
  let off = () => {};

  before(async () => {
    repoIn(projDir);
    process.env.FAKE_SDK_LOG = join(base, "sdk.jsonl");
    /** @param {Record<string, string>} env */
    const acp = (env) => ({ command: process.execPath, args: [FAKE_ACP_AGENT], env, cwdDefault: projDir, permissions: "allow-all", hints: false });
    shim = await startApp({
      memory: true,
      overrides: { cursorSdkLoader: () => import(FAKE_SDK) },
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [
          // Claude's shape: its raw messages beside its updates, each call's tool named and its input whole.
          { id: "claude", name: "claude", type: "acp", acp: acp({ FAKE_ACP_CLAUDE: "1", FAKE_ACP_TOOL_GATE: toolGate }) },
          // An ACP agent with none of Claude's marks: a call is its kind and its title.
          { id: "plain", name: "plain", type: "acp", acp: acp({}) },
          { id: "codex", name: "Codex", type: "codex", acp: { command: process.execPath, args: [FAKE_CODEX], env: { FAKE_CODEX_CALLS: join(base, "codex.jsonl") }, cwdDefault: projDir, permissions: "allow-all" } },
          { id: "cursor", name: "cursor", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: projDir, permissions: "allow-all", hints: false } },
        ];
        cfg.routes = ["claude", "plain", "codex", "cursor"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true }));
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [base], readerModel: "" };
      },
    });
    // A keeper as the server makes one, hearing the app's own bus as the server's does.
    own = createOwnTimes();
    off = own.listen(/** @type {any} */ (shim.app).events);
  });
  after(async () => {
    off();
    own?.stop();
    await shim?.stop();
    delete process.env.FAKE_SDK_LOG;
    await removeDirs(base);
  });

  /**
   * A harness chat on `model` and one turn of it, run to its end: the calls its run said as commands, by id, and every
   * call it said; the times the keeper holds as the chat's own are read by its id.
   * @param {string} model @param {string} content
   */
  const ran = async (model, content) => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain" } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const t0 = Date.now();
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
    assert.equal(res.status, 200, await res.clone().text());
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    /** @type {any[]} */
    const evs = (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events;
    const starts = evs.filter((e) => e.type === "tool-start");
    await until(() => !(/** @type {any} */ (shim.app).sessionTurns.holder(/** @type {any} */ (shim.app).memory.archive.getChain(id).key)), "the turn's lock let go");
    return { id, t0, t1: Date.now(), calls: starts.map((e) => String(e.id)), commands: starts.filter((e) => e.command === true).map((e) => String(e.id)) };
  };
  /** One time of a chat's own, within the turn it was heard in. @param {{ from: number, to: number | null }[]} times @param {{ t0: number, t1: number }} turn */
  const oneWithin = (times, turn) => {
    assert.equal(times.length, 1, `one command's time, and no turn's: ${JSON.stringify(times)}`);
    const [{ from, to }] = times;
    assert.ok(to != null && from >= turn.t0 && from <= to && to <= turn.t1, `begun and ended in its turn: ${JSON.stringify({ from, to, turn })}`);
    return /** @type {number} */ (to) - from;
  };

  test("Claude Code (ACP): a command it runs is one from its own message to its end; git log, read as the gate reads it, is none — and its turn is judged by its commands alone", async () => {
    // Its command held open 300 ms from the moment its start is on the bus, which is when the keeper times it from: its
    // time is at least that, however late the start was read off the agent's pipe.
    const hold = /** @type {any} */ (shim.app).events.subscribe("*", (/** @type {any} */ p, /** @type {any} */ entry) => {
      if (String(entry?.topic || "").startsWith("run:") && p?.type === "tool-start" && p.id === "st_b1") setTimeout(() => writeFileSync(toolGate, ""), 300);
    });
    const runs = await ran("claude/haiku", "~slowtool please").finally(hold);
    assert.deepEqual([runs.calls, runs.commands], [["st_b1"], ["st_b1"]], "npm test: a command");
    assert.ok(oneWithin(own.timesOf(runs.id), runs) >= 300, "for as long as it ran");
    const reads = await ran("claude/haiku", "~early please");
    assert.deepEqual([reads.calls, reads.commands], [["e_b1"], []], "git log -1: read as only reading, no command");
    assert.deepEqual(own.timesOf(reads.id), [], "its turn's run was heard, so no time of the turn's: none of its own");
  });

  test("an ACP agent that names no tool: a call of kind execute is a command, its title unread", async () => {
    const runs = await ran("plain/model", "~terminal please");
    assert.ok(runs.commands.includes("x1"), `npm test, by its kind: ${JSON.stringify(runs)}`);
    assert.ok(own.timesOf(runs.id).length >= 1 && own.timesOf(runs.id).every((t) => t.to != null && t.from >= runs.t0 && t.to <= runs.t1), JSON.stringify(own.timesOf(runs.id)));
  });

  test("Codex: a command it runs is one from its item's start to its end; what Codex itself reads as a file read is a read's card, and none", async () => {
    const runs = await ran("codex/gpt-6-astra", "~work");
    assert.ok(runs.calls.includes("cmd_read") && runs.calls.includes("cmd_run"), JSON.stringify(runs.calls));
    assert.deepEqual(runs.commands, ["cmd_run"], "npm test: a command; cat notes.txt, a read by Codex's own reading: none");
    oneWithin(own.timesOf(runs.id), runs);
  });

  test("Cursor's SDK: its shell call is a command from its start to its end", async () => {
    const runs = await ran("cursor/composer-2.5", "~shell please");
    assert.deepEqual([runs.calls, runs.commands], [["c1"], ["c1"]], "npm test: a command");
    oneWithin(own.timesOf(runs.id), runs);
  });
});
