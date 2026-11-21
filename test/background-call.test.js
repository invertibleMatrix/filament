// @ts-check
// HarnessV4_Four_Plan E21 — a running command sent to the background. The developer's Background on a foreground
// command's card answers the call at once: the same process goes on as a background shell, with what it printed so
// far, and the agent is told of its end. A chat whose turn has ended by then goes on by itself: Filament sends it a
// turn of its own, whose message is Filament's line, and the page draws Filament's capsule with the exits it carried.
// Since §4.5 (FO-D49, FO-D50) a shell the agent started with bash_background does the same, never after a turn the
// person stopped.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHand, disposeBackgroundShells, peekShellExits, attendShells, onShellWake, wakeDue, shellsAttended, runningShellsOf } from "../src/adapters/tools/hands.js";
import { createWaker, isWakeMessage, WAKE_LINE } from "../src/app/sessions/wake.js";
import { createRunLog } from "../src/services/runs.js";
import { createEventBus } from "../src/services/events.js";
import { alignEvents, WOKE_WORDS } from "../src/ui/harness/lib/labels.js";
import { archivedStubs, movedResult } from "../src/ui/harness/conversation/tools/render.js";
import { transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until } from "./helpers/wait.js";

after(() => disposeBackgroundShells());
const cwd = tmpdir();
/** A node one-liner, as the shell runs it. @param {string} js */
const node = (js) => `node -e "${js}"`;
/** Every session a shell's end woke, in order. @type {string[]} */
const woke = [];
const unhear = onShellWake((s) => woke.push(s));
after(() => unhear());

/**
 * A foreground command started as the loop starts one, with the way to the background caught: its answer (a promise),
 * the move, and whether the way was taken back. @param {string} js @param {any} owner
 */
const foreground = (js, owner) => {
  /** @type {{ move: (() => { id: string } | null) | null, takenBack: boolean, output: string }} */
  const got = { move: null, takenBack: false, output: "" };
  const answer = runHand("bash", { command: node(js) }, {
    root: cwd,
    owner,
    onOutput: (t) => (got.output += t),
    movable: (move) => {
      got.move = move;
      return () => (got.takenBack = true);
    },
  });
  return { got, answer };
};

describe("the hands: a foreground command moves", () => {
  // (fails before: yes — there was no way to move a running command; the call held the agent until it exited)
  test("the call answers at once, naming the shell and the output so far; the same process runs on and its end is told", async () => {
    const owner = { session: "BG1", agent: null };
    const { got, answer } = foreground("console.log('first');setTimeout(()=>{console.log('second');process.exit(5)},1500)", owner);
    await until(() => got.move && got.output.includes("first"), "the command's first line");
    const moved = /** @type {any} */ (got.move)();
    assert.match(String(moved?.id), /^bg_[0-9a-z]+$/);
    const words = String(await answer);
    assert.match(words, new RegExp(`^The developer sent this command to the background after \\d+ seconds?\\. It is still running, as background shell ${moved.id}: it keeps running across turns`));
    assert.match(words, /Output so far:\nfirst\n/);
    assert.match(words, new RegExp(`bash_output\\(\\{ id: "${moved.id}", wait: 10 \\}\\); stop it with bash_kill`));
    assert.equal(movedResult(words), moved.id, "the page reads the shell off the answer after a reload");
    assert.equal(got.takenBack, true, "the way to the background is taken back as the call answers");
    assert.equal(/** @type {any} */ (got.move)(), null, "a second press moves nothing");
    assert.deepEqual(runningShellsOf("BG1").map((s) => s.id), [moved.id], "it is one of the session's running shells");
    const [x] = /** @type {any} */ (await until(() => (peekShellExits(owner).length ? peekShellExits(owner) : null), "the moved command's exit", { timeoutMs: 15_000 }));
    assert.deepEqual([x.id, x.code], [moved.id, 5]);
    assert.match(String(await runHand("bash_output", { id: moved.id }, { root: cwd, owner })), /second/, "what it printed after the move is read as a shell's");
    assert.equal(wakeDue("BG1"), false, "a read showed the exit: nothing waits untold");
    assert.ok(woke.includes("BG1"), "its end, with no turn there to hear it, woke the chat");
  });

  // (fails before: yes)
  test("a turn that runs hears the end itself; the chat wakes only as that turn lets go with the end still untold", async () => {
    const owner = { session: "BG2", agent: null };
    const leave = attendShells(owner);
    assert.equal(shellsAttended("BG2"), true);
    const { got, answer } = foreground("setTimeout(()=>process.exit(0),700)", owner);
    await until(() => got.move, "the command to start");
    /** @type {any} */ (got.move)();
    await answer;
    await until(() => peekShellExits(owner).length, "the exit", { timeoutMs: 15_000 });
    assert.equal(wakeDue("BG2"), true);
    assert.ok(!woke.includes("BG2"), "the running turn hears it at its next step");
    leave();
    assert.equal(shellsAttended("BG2"), false);
    assert.ok(woke.includes("BG2"), "the turn ended without taking it: the chat wakes");
  });

  // (fails before: yes — FO-D15 kept a bash_background shell's end for the next message, and its start said nothing)
  test("a shell the agent started with bash_background wakes the chat as it ends with no turn there; its start says so (FO-D49, FO-D51)", async () => {
    const owner = { session: "BG3", agent: null };
    const start = String(await runHand("bash_background", { command: node("setTimeout(()=>process.exit(0),300)"), grace: 0.1 }, { root: cwd, owner }));
    assert.match(start, /\(and stops when Filament exits\)\. When it exits you are told: at your next step, or, once your turn has ended, in a turn Filament starts by itself\.\n/);
    await until(() => woke.includes("BG3"), "the wake", { timeoutMs: 15_000 });
    assert.equal(wakeDue("BG3"), true, "the end waits untold for the turn the wake sends");
  });

  // (fails before: yes)
  test("a helper's shell: its start says the session's agent hears the end once its run is over, and that end wakes the chat (FOC-80)", async () => {
    const helper = { session: "BG5", agent: "subagent:h1" };
    const leave = attendShells(helper);
    const start = String(await runHand("bash_background", { command: node("setTimeout(()=>process.exit(3),600)"), grace: 0.1 }, { root: cwd, owner: helper }));
    assert.match(start, /When it exits you are told at your next step; once your run is over, the session's agent is told instead\./);
    leave();
    await until(() => woke.includes("BG5"), "the wake", { timeoutMs: 15_000 });
    assert.equal(peekShellExits({ session: "BG5", agent: null })[0]?.code, 3, "the session's agent is the one told");
  });

  // (fails before: no for the kill; yes for Filament's own stop — its shells' exits woke their chats once every shell
  // could wake one)
  test("a shell the agent stopped wakes nothing, and neither do the shells Filament's own stop ends (FOC-77, FOC-85)", async () => {
    const owner = { session: "BG6", agent: null };
    const start = String(await runHand("bash_background", { command: node("setTimeout(()=>{},30000)"), grace: 0.1 }, { root: cwd, owner }));
    const id = /Background shell (bg_[0-9a-z]+) started/.exec(start)?.[1];
    assert.match(String(await runHand("bash_kill", { id }, { root: cwd, owner })), /stopped/);
    const other = { session: "BG7", agent: null };
    await runHand("bash_background", { command: node("setTimeout(()=>{},30000)"), grace: 0.1 }, { root: cwd, owner: other });
    await disposeBackgroundShells();
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual([woke.includes("BG6"), woke.includes("BG7")], [false, false]);
    assert.deepEqual([wakeDue("BG6"), wakeDue("BG7")], [false, false]);
  });

  // (fails before: yes)
  test("a command that ends on its own is not movable after: the way is taken back with its answer", async () => {
    const { got, answer } = foreground("console.log('quick')", { session: "BG4", agent: null });
    assert.match(String(await answer), /quick/);
    assert.equal(got.takenBack, true);
    assert.equal(/** @type {any} */ (got.move)(), null);
  });
});

describe("the run log's Background", () => {
  // (fails before: yes — no `background`, no `movable` on the mailbox)
  test("it reaches the command under its call; one that ran out, or a run that ended, says why", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "filament-bg-runs-"));
    try {
      const runs = createRunLog({ events: createEventBus(), dataDir, config: () => ({ observability: { runEvents: { persist: true, retentionDays: 7, maxPerRun: 5000, keepRuns: 50, toolPreviewChars: 2000 } } }) });
      runs.startRun({ id: "r1", kind: "agent-turn" });
      const box = runs.mailbox("r1");
      let pressed = 0;
      const giveBack = box.movable("c1", () => (++pressed === 1 ? { id: "bg_x" } : null));
      assert.deepEqual(runs.background("r1", "c1"), { ok: true, shell: "bg_x" });
      assert.match(/** @type {any} */ (runs.background("r1", "c1")).error, /already ended/);
      giveBack();
      assert.match(/** @type {any} */ (runs.background("r1", "c1")).error, /not a command running in the foreground/);
      assert.match(/** @type {any} */ (runs.background("nope", "c1")).error, /no loop is running/);
      runs.endRun("r1", { status: "done" });
      assert.match(/** @type {any} */ (runs.background("r1", "c1")).error, /the run has ended/);
      runs.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("the waker", () => {
  // (fails before: yes)
  test("it asks once nothing else will tell; a holding turn is waited for; two ends make one turn; a refusal is final", async () => {
    let due = true;
    let attended = false;
    /** @type {{ status: number, body: any }[]} */
    const answers = [{ status: 409, body: { wake: "held" } }, { status: 200, body: null }];
    /** @type {string[]} */
    const posted = [];
    const waker = createWaker({ post: async (s) => (posted.push(s), /** @type {any} */ (answers.shift())), due: () => due, attended: () => attended, settleMs: 1, retryMs: 1 });
    waker.wake("A");
    waker.wake("A");
    await until(() => waker.pending() === 0, "the wake to go");
    assert.deepEqual(posted, ["A", "A"], "held once, then sent: one wake for two ends");
    attended = true;
    waker.wake("B");
    await until(() => waker.pending() === 0, "the wake to stand down");
    assert.deepEqual(posted, ["A", "A"], "a turn of its agent runs: it hears the end itself");
    attended = false;
    due = false;
    waker.wake("C");
    await until(() => waker.pending() === 0, "the wake to stand down");
    assert.deepEqual(posted, ["A", "A"], "nothing waits untold");
    due = true;
    answers.push({ status: 409, body: { error: "past the line", needsCompaction: true } });
    waker.wake("D");
    await until(() => waker.pending() === 0, "the wake to stop");
    assert.deepEqual(posted, ["A", "A", "D"], "the compaction card's refusal is final");
  });

  // (fails before: yes — flakes3: a wake on its way outlived app.stop() and went on posting
  // to the stopped Filament's old port, which another test file's upstream may hold by then)
  test("stopped: a wake on its way posts no more, and none starts", async () => {
    /** @type {string[]} */
    const posted = [];
    /** @type {string[]} */
    const idle = [];
    const waker = createWaker({ post: async (s) => (posted.push(s), { status: 409, body: { wake: "held" } }), due: () => true, attended: () => false, idle: (s) => void idle.push(s), settleMs: 1, retryMs: 200, tries: 5 });
    waker.wake("A");
    await until(() => posted.length === 1 || null, "its first post");
    waker.stop();
    await until(() => waker.pending() === 0 || null, "the wake to end");
    waker.wake("B");
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(posted, ["A"], "no post after the stop");
    assert.equal(waker.pending(), 0, "none started");
    assert.deepEqual(idle, [], "nothing of a stopped app's is checked after it");
  });
});

describe("a chat on the loop: Background, then the chat goes on by itself", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** @type {string} */ let sid;
  /** @type {any} */ let turnDone;
  const answered = (/** @type {any} */ body) => new Set((body?.messages || []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : []))
    .filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id));
  const said = (/** @type {any} */ body) => JSON.stringify(body?.messages || []);
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-bg-call-"));
    up = await fakeUpstream((call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      if (said(call.body).includes(WAKE_LINE.slice(0, 60))) return anthropicReply("The build finished: all good.", { model: "m-1" });
      if (!answered(call.body).has("b1"))
        return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: "b1", name: "bash", input: { command: node("console.log('building');setTimeout(()=>{console.log('built');process.exit(0)},2500)") } }] });
      return anthropicReply("It runs in the background; I will look when it ends.", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    sid = String((await made.json()).id);
    turnDone = shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: "build it", stream: false } });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // (fails before: yes — no route, no button's mark, no wake)
  test("the press answers the call, the turn ends, the command's end starts a turn of Filament's, drawn as Filament's", async () => {
    const run = /** @type {any} */ (await until(async () => {
      const list = (await (await shim.api("/api/runs?kind=agent-turn")).json()).runs || [];
      return list.find((/** @type {any} */ r) => r.meta?.chain === sid && r.endedAt == null) || null;
    }, "the turn's run"));
    const eventsOf = async () => (await (await shim.api(`/api/runs/${run.id}/events`)).json()).events || [];
    await until(async () => (await eventsOf()).find((/** @type {any} */ e) => e.type === "tool-output" && /building/.test(e.text)), "the command's first line");
    const start = (await eventsOf()).find((/** @type {any} */ e) => e.type === "tool-start" && e.id === "b1");
    assert.equal(start.movable, true, "the card may offer Background");
    const pressed = await shim.api(`/api/runs/${run.id}/calls/b1/background`, { method: "POST", body: {} });
    const out = await pressed.json();
    assert.equal(pressed.status, 200, JSON.stringify(out));
    assert.match(out.shell, /^bg_/);
    const again = await shim.api(`/api/runs/${run.id}/calls/b1/background`, { method: "POST", body: {} });
    assert.equal(again.status, 409, "the call has answered: nothing is left to move");
    const done = await turnDone;
    assert.equal(done.status, 200, await done.clone().text());
    const end = (await eventsOf()).find((/** @type {any} */ e) => e.type === "tool-end" && e.id === "b1");
    assert.deepEqual([end.ok, end.background, end.exitCode], [true, out.shell, undefined], "done, in the background, with no exit of its own");
    const stub = alignEvents(await eventsOf()).byRound.get(1)?.tools.get("b1");
    assert.deepEqual([stub?.movable, stub?.background], [true, out.shell], "the page's stub knows both");
    // The command exits about 2.5 s in: Filament's own turn goes, and the model hears the end.
    const tr = /** @type {any} */ (await until(async () => {
      const t = await (await shim.api(`/api/sessions/${sid}/transcript`)).json();
      return (t.turns || []).length >= 2 && t.turns[1].final ? t : null;
    }, "the chat's second turn", { timeoutMs: 20_000 }));
    const second = tr.turns[1];
    assert.equal(second.woke, true);
    assert.ok(isWakeMessage(second.user), "its message is Filament's line");
    assert.equal(second.shellExits, 1);
    const page = transcriptTurns(tr);
    assert.equal(page[1].woke, true);
    assert.match(String(page[1].wakeExits?.[0]), new RegExp(`^\\[Filament: background shell ${out.shell} \\(node -e .*\\) exited with code 0`));
    const first = archivedStubs(tr.turns[0].tools || []).find((s) => s.id === "b1");
    assert.equal(/** @type {any} */ (first)?.background, out.shell, "after a reload too");
    assert.equal(WOKE_WORDS, "Filament went on by itself — a background command ended");
  });

  // (fails before: yes)
  test("a wake with nothing untold, and one on a chat that is no chat, are refused in words", async () => {
    const r = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { wake: true, stream: false } });
    const body = await r.json();
    assert.deepEqual([r.status, body.wake], [409, "told"]);
    const gone = await shim.api(`/api/runs/nope/calls/b1/background`, { method: "POST", body: {} });
    assert.equal(gone.status, 409);
  });
});

// (fails before: yes — the review of 2e9d58b0c: a command its timeout sent to the background ended its card "Ran · exit
// 0", ok, while it still ran, and memory could file it as the command that worked)
describe("a chat on the loop: a command past its timeout goes on in the background", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  const answered = (/** @type {any} */ body) => new Set((body?.messages || []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : []))
    .filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id));
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-bg-timeout-"));
    up = await fakeUpstream((call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      if (!answered(call.body).has("t1"))
        return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: "t1", name: "bash", input: { command: node("const fs=require('fs');setInterval(()=>fs.existsSync('built.flag')&&process.exit(0),50)"), timeout: 1 } }] });
      return anthropicReply("It goes on in the background.", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    writeFileSync(join(root, "built.flag"), "");
    await shim?.stop();
    await up?.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  test("its card says it runs on, moved by its timeout, with no exit of its own — after a reload too", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    const sid = String((await made.json()).id);
    const done = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: "build it", stream: false } });
    assert.equal(done.status, 200, await done.clone().text());
    const run = ((await (await shim.api("/api/runs?kind=agent-turn")).json()).runs || []).find((/** @type {any} */ r) => r.meta?.chain === sid);
    const events = (await (await shim.api(`/api/runs/${run.id}/events`)).json()).events || [];
    const end = events.find((/** @type {any} */ e) => e.type === "tool-end" && e.id === "t1");
    assert.match(String(end?.background), /^bg_/, JSON.stringify(end));
    assert.deepEqual([end.ok, end.exitCode, end.movedBy], [true, undefined, "timeout"], "in the background by its timeout, with no exit");
    const stub = alignEvents(events).byRound.get(1)?.tools.get("t1");
    assert.deepEqual([stub?.background, stub?.movedBy], [end.background, "timeout"], "the page's stub knows who moved it");
    const tr = await (await shim.api(`/api/sessions/${sid}/transcript`)).json();
    const archived = /** @type {any} */ (archivedStubs(tr.turns[0].tools || []).find((s) => s.id === "t1"));
    assert.deepEqual([archived?.background, archived?.movedBy], [end.background, "timeout"], "and after a reload");
  });
});

describe("a chat on the loop: the agent's own background command (FO-D49, FO-D50)", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** The reply the stopped turn's model call waits on, let go at the end. @type {() => void} */
  let release = () => {};
  const held = new Promise((r) => (release = () => r(undefined)));
  let holding = false;
  const answered = (/** @type {any} */ body) => new Set((body?.messages || []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : []))
    .filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id));
  const said = (/** @type {any} */ body) => JSON.stringify(body?.messages || []);
  /** @param {string} id @param {string} js */
  const background = (id, js) => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id, name: "bash_background", input: { command: node(js), grace: 0.1 } }] });
  /** @param {string} content @param {boolean} [stream] */
  const chat = async (content, stream = false) => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    const id = String((await made.json()).id);
    return { id, turn: shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content, stream } }) };
  };
  /** @param {string} id */
  const transcript = async (id) => /** @type {any} */ (await (await shim.api(`/api/sessions/${id}/transcript`)).json());
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-bg-own-"));
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      const all = said(call.body);
      if (all.includes(WAKE_LINE.slice(0, 60))) return anthropicReply("The tests ended: 3 passed.", { model: "m-1" });
      if (all.includes("anything new?")) return anthropicReply("Yes: the build ended.", { model: "m-1" });
      if (all.includes("run the tests")) {
        if (!answered(call.body).has("t1")) return background("t1", "setTimeout(()=>{console.log('3 passed');process.exit(0)},1500)");
        return anthropicReply("The tests run in the background; I will look when they end.", { model: "m-1" });
      }
      if (!answered(call.body).has("s1")) return background("s1", "setTimeout(()=>process.exit(0),2500)");
      holding = true;
      await held;
      return anthropicReply("late", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    release();
    await shim?.stop();
    await up?.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // (fails before: yes — the end waited for the person's next message)
  test("the agent starts the tests in the background and ends its turn; their end starts Filament's turn (FOC-75)", async () => {
    const { id, turn } = await chat("run the tests");
    const done = await turn;
    assert.equal(done.status, 200, await done.clone().text());
    const tr = await until(async () => {
      const t = await transcript(id);
      return (t.turns || []).length >= 2 && t.turns[1].final ? t : null;
    }, "the chat's second turn", { timeoutMs: 20_000 });
    assert.equal(tr.turns[1].woke, true);
    assert.equal(tr.turns[1].shellExits, 1);
    const page = transcriptTurns(tr);
    assert.match(String(page[1].wakeExits?.[0]), /^\[Filament: background shell bg_[0-9a-z]+ \(node -e .*\) exited with code 0/);
    assert.ok(up.received.some((/** @type {any} */ c) => said(c.body).includes("in a turn Filament starts by itself")), "the agent was told it would hear the end");
  });

  // (fails before: yes — nothing held a wake back after a stop)
  test("after the person pressed Stop, a command's end starts nothing; their next message carries it (FOC-81)", async () => {
    const { id, turn } = await chat("build it, then wait", true);
    await until(() => holding, "the turn's model call after the start");
    const stop = await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200, await stop.clone().text());
    await (await turn).text();
    const stopped = await until(async () => {
      const t = await transcript(id);
      return t.turns?.[0]?.stopped ? t : null;
    }, "the stopped turn's mark");
    assert.equal(stopped.turns.length, 1);
    await until(() => woke.includes(id), "the build's end", { timeoutMs: 20_000 });
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal((await transcript(id)).turns.length, 1, "no turn of Filament's");
    assert.equal(wakeDue(id), true, "the end waits untold");
    const next = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "anything new?", stream: false } });
    assert.equal(next.status, 200, await next.clone().text());
    const tr = await transcript(id);
    assert.equal(tr.turns.length, 2);
    assert.deepEqual([tr.turns[1].woke ?? false, tr.turns[1].shellExits], [false, 1], "the person's turn carries the end");
  });
});

// (fails before: yes)
// The offer stands on the folded row since 10-28 (test/command-card-calm.test.js).
test("the source: the row offers Run in background on a running command, through the helper's own run for a helper's", () => {
  const render = readFileSync(new URL("../src/ui/harness/conversation/tools/render.js", import.meta.url), "utf8");
  assert.match(render, /const moveRun = o\.moveRun !== undefined \? o\.moveRun : o\.runId \|\| null;/);
  assert.match(render, /moveRun: s\.run \? String\(s\.run\) : null/);
  assert.match(render, /movable \? offerWhenLong\(backgroundButton\(String\(moveRun\), String\(t\.id\)\), t\) : null/);
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /\/calls\/\$\{encodeURIComponent\(callId\)\}\/background`/);
});

// (fails before: yes — h() has no `ref`: the callback became an attribute, and a running command's output stayed at
// its first lines)
test("the source: a command's output is scrolled to its newest lines once it is in the page", () => {
  const render = readFileSync(new URL("../src/ui/harness/conversation/tools/render.js", import.meta.url), "utf8");
  assert.doesNotMatch(render, /\bref: \(/, "no attribute h() does not know");
  assert.match(render, /termOut\("term-out live", t\.live\)/);
  // In the frame it is drawn, held weakly till then, or as the row closed around it opens (shown-again.test.js runs it;
  // drawn-blocks-let-go.test.js shows the frame keeps no drawing).
  assert.match(render, /nextFrame\(el, outputToEnd\);/);
  assert.match(render, /if \(!shut\) return void \(el\.scrollTop = el\.scrollHeight\);/);
});
