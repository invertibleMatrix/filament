// @ts-check
// The crashes of 11-14: Filament's server ran out of memory twice in a day (its heap at about 3.3 GB), because a coding
// agent's turn that had ended stayed in memory with all it was sent — its chat whole, screenshots and all, about 107 MB
// a turn in a long chat — and each turn added another. What held each: the usage log's records, whose run-once
// observers kept the scope they were made in; the agent process's list of its calls, by their turn; a finished turn's
// hooks into the request that ran it, and the error its end was aborted with, whose stack kept the functions it was made
// under; the runs registry's stop and Force stop of an ended run, which the turn listened on; and a wait's listener on
// the turn's stop, which Node keeps while the signal (made with AbortSignal.any) may still abort. Each is let go of
// once its work is over, never before: what wakes a chat after its run ends — a background command's end, the idle
// check-in, a report — starts a turn of its own, and holds nothing of the old one.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { getEventListeners } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import v8 from "node:v8";
import vm from "node:vm";
import { LiveTurn, TurnBridge } from "../src/adapters/agents/turn-bridge.js";
import { RpcProcess } from "../src/adapters/agents/agent-process.js";
import { createAgentInbox } from "../src/app/agent-inbox.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createEventBus } from "../src/services/events.js";
import { UsageStore } from "../src/services/records.js";
import { createRunLog } from "../src/services/runs.js";
import { startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

// Garbage collection on demand, in this process: what is let go of can be seen gone.
v8.setFlagsFromString("--expose-gc");
const gc = /** @type {() => void} */ (vm.runInNewContext("gc"));
/** Collect until `ref` is gone, a few rounds at most: whether it went. @param {WeakRef<object>} ref */
const gone = async (ref) => {
  for (let i = 0; i < 6 && ref.deref(); i++) {
    await new Promise((r) => setTimeout(r, 20));
    gc();
  }
  return ref.deref() === undefined;
};
/** The heap in use once garbage is collected. */
const heapNow = async () => {
  for (let i = 0; i < 4; i++) {
    gc();
    await new Promise((r) => setTimeout(r, 50));
  }
  return process.memoryUsage().heapUsed;
};
const MB = 1024 * 1024;

// (fails before: yes — the request's stop, the page's asker, the switch's judge, the sink and the call lookups each held
// what they were made with, and the error the turn ended with held the functions it was made under)
test("a finished turn lets go of what it held of the request that ran it, and keeps what its chat's calls between turns read", async () => {
  /** @type {WeakRef<object>[]} */
  const refs = [];
  /** Something only one hook holds, as each held the request's whole scope. */
  const held = () => {
    const o = { chat: "x".repeat(1024) };
    refs.push(new WeakRef(o));
    return o;
  };
  const made = () => {
    const sink = held();
    const asked = held();
    const judged = held();
    const looked = held();
    const stopped = held();
    const turn = new LiveTurn({
      onEvent: () => void sink,
      asker: async () => (void asked, null),
      permits: /** @type {any} */ ({ mode: () => (void judged, "auto") }),
      toolsAt: /** @type {any} */ ({ chain: "c1", by: { id: "sa_1" }, dirs: ["/x"], callOf: async () => (void looked, null), callIsOwn: async () => (void looked, null) }),
    });
    turn.cancel = () => void stopped;
    // The turn ends under a function of the request's own, as the bridge's run ends it.
    const scope = held();
    const runEnds = () => {
      void scope;
      turn.finish({ stopReason: "end_turn" }, null);
    };
    runEnds();
    return turn;
  };
  const turn = made();
  assert.equal(turn.done, true);
  for (const [i, ref] of refs.entries()) assert.ok(await gone(ref), `hook ${i} of the request let go of`);
  // What the chat's calls between turns read stays (acp/bridge.js `#mcpAt`), and the end is still said to its calls.
  assert.deepEqual(turn.toolsAt, { chain: "c1", by: { id: "sa_1" }, dirs: ["/x"] });
  assert.equal(turn.over.signal.aborted, true);
  assert.match(String(turn.over.signal.reason?.message), /the agent's turn ended/);
  // Words said after its end wait for the chat's next request, as a detached turn's do.
  turn.emit({ type: "text", text: "late" });
  assert.deepEqual(turn.buffer, [{ type: "text", text: "late" }]);
});

// (fails before: no — it pins the review of this fix, 11-15: with the request let go of at the turn's end, a question
// still waiting then said its end into the turn's buffer, which the chat's next request took for one of its own)
test("a question still waiting as its turn ends says what came of it to the request it was asked in, not to the chat's next", async () => {
  /** @type {any[]} */
  const said = [];
  /** @type {(a: any) => void} */
  let answer = () => {};
  const turn = new LiveTurn({ onEvent: (ev) => void said.push(ev), asker: () => new Promise((r) => (answer = r)), asks: { n: 0 } });
  const form = /** @type {any} */ ({ kind: "question", from: "elicitation", agent: "Claude", title: "Which one?", detail: "", call: null, questions: [], plan: null, link: null, judged: null });
  const asked = new TurnBridge().askPerson(turn, form);
  await new Promise((r) => setTimeout(r, 10));
  turn.finish({ stopReason: "end_turn" }, null);
  answer({ outcome: "cancelled" });
  assert.equal((await asked).outcome, "cancelled");
  assert.deepEqual(said.map((e) => [e.type, e.id]), [["ask", "q1"], ["ask-end", "q1"]], "both said on the turn's own request");
  assert.deepEqual(turn.buffer, [], "nothing waits for the chat's next request");
});

// The review of 11-16 (Fable 5.2): a call of Filament's own tools that says something once it is done (a visual drawn, a
// letter sent) said it into the turn's buffer when the turn ended meanwhile, which the chat's next request took for its
// own, under "from the previous turn".
// (fails before: yes — the visual waited in the buffer)
test("a call of Filament's tools still running as its turn ends says what it made to the request it came in under", async () => {
  const { AcpBridge } = await import("../src/adapters/agents/acp/bridge.js");
  /** @type {any[]} */
  const said = [];
  const bridge = new AcpBridge();
  const turn = new LiveTurn({ onEvent: (ev) => void said.push(ev) });
  bridge.convs.set("k", /** @type {any} */ ({ mcpToken: "tok", sessionId: "s1", cwd: "." }));
  bridge.turns.set("s1", turn);
  const ctx = /** @type {any} */ (bridge.contextForMcpToken("tok"));
  turn.finish({ stopReason: "cancelled" }, null);
  ctx.emit({ type: "visual", id: "v1" });
  assert.deepEqual(said.map((e) => [e.type, e.id]), [["visual", "v1"]], "said on the request it came in under");
  assert.deepEqual(turn.buffer, [], "nothing waits for the chat's next request");
});

// (fails before: yes — the process kept its last 512 calls with their turns, each turn its chat)
test("the agent process names a call's turn by its id", () => {
  const proc = new RpcProcess({ command: process.execPath, cwd: tmpdir() });
  const turn = new LiveTurn({});
  proc.callBegan(turn, "call-1");
  assert.deepEqual(proc.calls.map((c) => [c.turn, c.id]), [[turn.id, "call-1"]]);
});

// (fails before: yes — the records kept their observers, the last 500 of them, each with the request it was made for)
test("a usage record lets go of its observers once they ran", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-freed-usage-"));
  try {
    const store = new UsageStore({ dataDir: dir, options: { broadcast: false } });
    const rec = store.start({ model: "m", format: "anthropic" });
    let first = 0;
    let finished = 0;
    rec._onFirstByte = [() => first++];
    rec._onFinish = [() => finished++];
    store.firstByte(rec);
    assert.equal(first, 1);
    assert.equal(rec._onFirstByte, undefined, "run once, gone");
    store.finish(rec, { status: "ok" });
    assert.equal(finished, 1);
    assert.equal(rec._onFinish, undefined, "run once, gone");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — an ended run kept its stop and Force stop, and so whatever listened on them)
test("an ended run lets go of whatever listened for its stop, its stop's state kept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-freed-runs-"));
  try {
    const runs = createRunLog({ events: createEventBus(), dataDir: dir, config: () => ({ observability: { runEvents: { persist: false } } }), ops: { record: () => {} } });
    /** @type {WeakRef<object>[]} */
    const refs = [];
    /** @param {string} id */
    const listen = (id) => {
      const turn = { chat: "x".repeat(1024) };
      refs.push(new WeakRef(turn));
      runs.startRun({ id, kind: "coding-agent" });
      const mb = runs.mailbox(id);
      mb.stopSignal.addEventListener("abort", () => void turn, { once: true });
      mb.forceSignal.addEventListener("abort", () => void turn, { once: true });
    };
    listen("r-done");
    listen("r-stopped");
    assert.equal(runs.steer("r-stopped", { kind: "stop", from: "harness" }).ok, true);
    runs.endRun("r-done", { status: "done" });
    runs.endRun("r-stopped", { status: "stopped" });
    for (const [i, ref] of refs.entries()) assert.ok(await gone(ref), `run ${i}'s turn let go of`);
    // Whoever reads them after the end reads the state they ended in.
    assert.equal(runs.mailbox("r-done").stopSignal.aborted, false);
    assert.equal(runs.mailbox("r-stopped").stopSignal.aborted, true);
    assert.equal(runs.mailbox("r-stopped").forceSignal.aborted, false);
    // And nothing stops an ended run.
    assert.equal(runs.steer("r-done", { kind: "stop", from: "harness" }).ok, false);
    assert.equal(runs.force("r-done").ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — each wait left its listener on the turn's stop, a signal Node keeps while it has one)
test("a wait lets go of its listener on the turn's stop, however it ended", async () => {
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    now: Date.now,
    context: /** @type {any} */ ({
      settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }] }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: tmpdir(), model: "m", projectId: "p1" }),
      view: async () => ({ text: "", turns: 0 }),
      brief: async () => null,
      modelProblem: () => null,
      mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
    }),
    call: async () => {
      throw new Error("no launch here");
    },
  });
  // Something the turn still owes, so the wait waits.
  const door = registry.openTurn({ chainId: "c-freed", runId: "turn-1", cwd: tmpdir(), mode: null, model: "m", thinking: null, fork: null, emit: () => {}, round: () => 1, owes: () => new Promise(() => {}) });
  const stop = new AbortController();
  const box = createAgentInbox({ door, emit: () => {}, note: () => {}, mailbox: () => null, reach: () => null, signal: stop.signal, reader: "the agent" });
  try {
    const said = await box.wait(1, 60_000, { who: "Filament's sub-agents" });
    assert.match(String(said?.said), /^Waited \d+ s and nothing arrived/);
    assert.equal(getEventListeners(stop.signal, "abort").length, 0, "the wait that ran out let go");
    const stopping = box.wait(30, 60_000, { who: "Filament's sub-agents" });
    stop.abort();
    assert.match(String((await stopping)?.said), /the turn is being stopped/);
    assert.equal(getEventListeners(stop.signal, "abort").length, 0, "the wait the stop ended let go");
  } finally {
    door.close();
  }
});

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");

// (fails before: yes — every turn's chat stayed, so the heap grew with the square of the turns: about 170 MB here)
describe("a coding agent's turns, end to end", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-freed-"));
  const projDir = join(root, "project");
  const promptLog = join(root, "prompts.jsonl");
  /** What the agent was prompted with, in order. @returns {string[]} */
  const prompts = () => (existsSync(promptLog) ? readFileSync(promptLog, "utf8").split("\n").filter(Boolean).map((l) => String(JSON.parse(l).text || "")) : []);
  before(async () => {
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: projDir, stdio: "ignore" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        // Claude's raw messages are kept off (`rawMessages: 0`): the newest of them stay on a chat on purpose, for the
        // agents page, and are no turn's.
        cfg.upstreams = [{ id: "claude", name: "claude", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_LOG: promptLog }, cwdDefault: projDir, permissions: "allow-all", hints: false, rawMessages: 0 } }];
        cfg.routes = [{ match: "claude/*", upstream: "claude", upstreamModel: "{1}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });

  test("a chat's turns that ended let go of what each was sent: the heap grows by the words, not by a copy of the chat a turn", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "claude/haiku", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    const TURNS = 12;
    const KB = 512;
    // One turn first, so what the app makes once (the agent's process, the archive's tables) is in the baseline.
    await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hello", stream: true, runEvents: true } })).text();
    const before = await heapNow();
    for (let i = 0; i < TURNS; i++) {
      const content = `turn ${i} ${Date.now()} ` + "x".repeat(KB * 1024);
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
      assert.equal(res.status, 200);
      await res.text();
    }
    // The end of each turn's work settles.
    await new Promise((r) => setTimeout(r, 500));
    const grew = ((await heapNow()) - before) / MB;
    // The words themselves are 6 MB. A turn holds the chat so far several times over (the archive's, the history rebuilt
    // for the agent, the request as one string), so turns that stayed would be about 170 MB here.
    assert.ok(grew < 30, `the heap grew ${grew.toFixed(1)} MB over ${TURNS} turns of ${KB} KB`);
  });

  // (fails before: no — it guards the owner's of 11-15: "in filament we have background commands that can wake the
  // agent up and removing listeners may end up breaking stuff")
  test("a background command that ends after its turn still wakes the chat: the wake is a turn of its own, nothing of the old one's", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "claude/haiku", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    const call = JSON.stringify({ command: `node -e "setTimeout(()=>console.log('built'),1500)"`, description: "a short build" });
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `~mcpcall background_command ${call}`, stream: true, runEvents: true } });
    assert.equal(res.status, 200);
    const said = await res.text();
    assert.match(said, /mcp:Started background command bg_[0-9a-z]+/, "the agent started it, and its turn ended");
    await new Promise((r) => setTimeout(r, 200));
    gc();
    // The command ends with no turn of the chat's running: Filament sends the chat a turn of its own with its end.
    const woken = await until(() => prompts().find((p) => /your background command bg_[0-9a-z]+ ended/.test(p)) || null, "the chat woken with the command's end", { timeoutMs: 30_000 });
    assert.match(String(woken), /exited with code 0/);
    assert.match(String(woken), /built/);
  });
});
