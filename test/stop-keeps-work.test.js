// @ts-check
// The bug report's loss block in the loop (vault HarnessV3-BugReport §2, 2026-10-09): what ends a turn — a stop, a Force
// stop, a pause, a hang-up — keeps what the turn did. A Force stop keeps the sub-agents that finished beside one still
// running and the calls answered before a pause (H6), and the words its model call had streamed (L3); it ends a wait on
// the sub-agents, and no stop runs the turn-end hooks (L4). A stop that lands while a call's pre-tool hooks run comes
// before the call (L5). A pause keeps what the turn wrote (H7). A hang-up answers every call of its reply (P5).
// Scripted turns, no app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { archivedStubs } from "../src/ui/harness/conversation/tools/render.js";
import { until } from "./helpers/wait.js";

const NOT_RUN = "Not run: the developer stopped the turn before it ran.";
const FORCE_CUT = "Stopped: the developer force-stopped the turn while this call ran; its result was not kept.";
const GONE = "Not run: the client disconnected before it ran.";
const use = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
/** The results the turn's newest message gives, by call id, in their order. @param {any} out */
const answers = (out) =>
  out.work.at(-1).content.filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => [b.tool_use_id, String(b.content)]);
/** Turn-end hooks that run nothing: each turn end is logged with what it heard of the turn's writes. @param {boolean[]} ends @param {{ pre?: () => Promise<any[]>, readBack?: boolean }} [o] */
const hooksLogging = (ends, { pre = async () => [], readBack = false } = {}) => ({
  pre,
  post: async () => [],
  turnEnd: async (/** @type {number} */ _round, /** @type {boolean} */ wrote) => (ends.push(wrote), []),
  sessionStart: async () => [],
  readBackBeforeDone: readBack,
});

/** The run's mailbox as the run log keeps it: a stop is queued and cuts at once; a Force stop is a stop first, then the force. */
const desk = () => {
  const stop = new AbortController();
  const force = new AbortController();
  /** @type {any[]} */
  let queue = [];
  /** @type {Set<() => void>} */
  const waiters = new Set();
  const wake = () => {
    for (const w of [...waiters]) w();
  };
  const queueStop = () => {
    if (!queue.some((m) => m.kind === "stop")) queue.push({ kind: "stop", text: "", from: "harness" });
  };
  return {
    mailbox: {
      /** @param {(m: any) => boolean} [pick] */
      read: (pick) => {
        const got = pick ? queue.filter(pick) : queue.slice();
        queue = queue.filter((m) => !got.includes(m));
        return got;
      },
      next: () =>
        new Promise((resolve) => {
          const w = () => {
            waiters.delete(w);
            resolve(undefined);
          };
          waiters.add(w);
        }),
      stopSignal: stop.signal,
      forceSignal: force.signal,
    },
    stop: () => {
      queueStop();
      stop.abort();
      wake();
    },
    force: () => {
      queueStop();
      stop.abort();
      force.abort();
      wake();
    },
  };
};

/** @param {Partial<import("../src/app/agent/loop.js").LoopArgs>} over */
const args = (over) =>
  /** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
    model: "m",
    messages: [{ role: "user", content: "go" }],
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "auto",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async () => reply([{ type: "text", text: "Done." }]),
    costOf: () => 0,
    runHand: async (/** @type {string} */ name) => `${name} ran`,
    delegateRead: null,
    mailbox: { read: () => [] },
    permissions: null,
    tree: null,
    onEvent: () => {},
    previewChars: 0,
    sink: { text() {}, thinking() {}, signThinking() {}, endBlock() {}, count: () => 0 },
    signal: null,
    resume: null,
    ...over,
  });

// (fails before: yes — a sub-agent's result joined the round only when the slowest of its batch came back, so a Force
// stop archived the one that had finished "Not run", its report lost)
test("a Force stop keeps the sub-agents that finished while another of their batch still ran", async () => {
  const d = desk();
  /** @type {any[]} */
  const events = [];
  const out = runAgentTurn(args({
    call: async () => reply([{ type: "text", text: "Two sub-agents, side by side." }, use("a1", "agent", { description: "Map it", prompt: "map the parser" }), use("a2", "agent", { description: "Test it", prompt: "run the tests" })]),
    subagents: /** @type {any} */ ({
      run: async (/** @type {any} */ o) => (o.id === "a1" ? { ok: true, text: "The parser has two callers.", note: "agent: a1", wrote: false, spentUsd: 0, toolCalls: 3, roundIds: [] } : new Promise(() => {})),
    }),
    mailbox: d.mailbox,
    onEvent: (e) => events.push(e),
  }));
  await until(() => events.some((e) => e.type === "tool-end" && e.id === "a1"), "the first sub-agent's end");
  d.force();
  const ended = await out;
  assert.deepEqual([ended.status, ended.forced], ["stopped", true]);
  assert.deepEqual(answers(ended), [["a1", "The parser has two callers."], ["a2", FORCE_CUT]]);
  assert.equal(events.filter((e) => e.id === "a1" && e.notRun).length, 0, "the one that finished is not drawn Not run over its report");
  // The reply's words are in its round, with its calls: the forced end's own reply is its note alone.
  assert.deepEqual(ended.work.at(-2).content[0], { type: "text", text: "Two sub-agents, side by side." });
  assert.deepEqual(ended.final.map((/** @type {any} */ b) => b.text), ["(Filament: the developer force-stopped this turn after 5 tool calls; what was finished is above.)"]);
});

// (fails before: yes — a resumed turn's round held none of the results from before its pause, so a Force stop while the
// answered call ran archived the call that had run before the pause "Not run")
test("a Force stop while a resumed turn's answered call runs keeps the calls that ran before the pause", async () => {
  const asked = await runAgentTurn(args({
    modeNow: () => "edit",
    call: async () => reply([use("r1", "read", { path: "a.txt" }), use("b1", "bash", { command: "make build" }), use("r3", "read", { path: "b.txt" })]),
  }));
  assert.equal(asked.pause?.pending?.id, "b1", "the command asks");
  const d = desk();
  /** @type {any[]} */
  const events = [];
  const out = runAgentTurn(args({
    modeNow: () => "edit",
    runHand: async (/** @type {string} */ name) => (name === "bash" ? new Promise(() => {}) : `${name} ran`),
    mailbox: d.mailbox,
    onEvent: (e) => events.push(e),
    resume: { paused: /** @type {any} */ (asked.pause), answer: "yes", allow: true },
  }));
  await until(() => events.some((e) => e.type === "tool-start" && e.id === "b1"), "the answered command to start");
  d.force();
  assert.deepEqual(answers(await out), [["r1", "read ran"], ["b1", FORCE_CUT], ["r3", NOT_RUN]]);
});

// (fails before: yes — the forced end's reply held only its note: the words the page had shown were lost to the archive
// and the next turn, though the note said what was finished is above)
test("a Force stop during a model call keeps the words it had streamed as the reply, ahead of the note", async () => {
  const d = desk();
  /** @type {() => void} */
  let streamed = () => {};
  const began = new Promise((resolve) => {
    streamed = () => resolve(undefined);
  });
  const out = runAgentTurn(args({
    call: /** @type {any} */ (async (/** @type {any} */ { onDelta }) => {
      onDelta({ kind: "text", text: "Half of the answer" });
      streamed();
      return new Promise(() => {});
    }),
    mailbox: d.mailbox,
  }));
  await began;
  d.force();
  const ended = await out;
  assert.deepEqual(ended.final.map((/** @type {any} */ b) => b.text), ["Half of the answer", "(Filament: the developer force-stopped this turn after 0 tool calls; what was finished is above.)"]);
});

// (fails before: no — a guard the mutation pass asked for: a call that came back is no longer the one in flight, so a
// Force stop while its tools run does not take its words a second time)
test("a Force stop while a reply's tools run keeps the reply's words once: in its round, not again as the forced end's reply", async () => {
  const d = desk();
  /** @type {any[]} */
  const events = [];
  const out = runAgentTurn(args({
    call: /** @type {any} */ (async (/** @type {any} */ { onDelta }) => {
      onDelta({ kind: "text", text: "Reading the parser first." });
      return reply([{ type: "text", text: "Reading the parser first." }, use("r1", "read", { path: "parser.js" })]);
    }),
    runHand: async () => new Promise(() => {}),
    mailbox: d.mailbox,
    onEvent: (e) => events.push(e),
  }));
  await until(() => events.some((e) => e.type === "tool-start" && e.id === "r1"), "the read to start");
  d.force();
  const ended = await out;
  assert.deepEqual(ended.work.at(-2).content[0], { type: "text", text: "Reading the parser first." });
  assert.deepEqual(ended.final.map((/** @type {any} */ b) => b.text), ["(Filament: the developer force-stopped this turn after 1 tool call; what was finished is above.)"]);
});

// (fails before: yes — the forced end took the stop's message, and the wait ended only on reading one: the muted loop
// waited on, and once the sub-agents settled took their reports and ran the turn-end hooks)
test("a Force stop while the turn waits on its sub-agents ends the wait: nothing after it takes their reports or runs the turn-end hooks", async () => {
  const d = desk();
  /** @type {any[]} */
  const events = [];
  /** @type {() => void} */
  let settle = () => {};
  const owed = new Promise((resolve) => {
    settle = () => resolve(undefined);
  });
  let taken = 0;
  /** @type {boolean[]} */
  const ends = [];
  const out = runAgentTurn(args({
    inbox: /** @type {any} */ ({ take: () => (taken++, []), hold: () => null, owed: () => owed, arrival: () => new Promise(() => {}) }),
    hooks: /** @type {any} */ (hooksLogging(ends)),
    mailbox: d.mailbox,
    onEvent: (e) => events.push(e),
  }));
  await until(() => events.some((e) => e.type === "waiting"), "the wait on the sub-agents");
  const before = taken;
  d.force();
  assert.equal((await out).forced, true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  settle();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(taken, before, "the forced turn took no report");
  assert.deepEqual(ends, [], "and ran no turn-end hook");
});

// (fails before: yes — the turn-end hooks ran under it, and the turn ended done)
test("a stop that lands as the turn's last reply comes back comes before the turn-end hooks: the turn ends stopped, the hooks not run", async () => {
  const d = desk();
  /** @type {boolean[]} */
  const ends = [];
  const out = await runAgentTurn(args({
    call: async () => {
      d.stop();
      return reply([{ type: "text", text: "All done." }]);
    },
    hooks: /** @type {any} */ (hooksLogging(ends)),
    mailbox: d.mailbox,
  }));
  assert.equal(out.status, "stopped");
  assert.deepEqual(ends, []);
  assert.deepEqual(out.final.map((/** @type {any} */ b) => b.text), ["All done.", "(Filament: the developer stopped this turn after 0 tool calls; what was finished is above.)"]);
});

// (fails before: yes — the call went on to act once its hooks returned: the write landed after the stop)
test("a stop that lands while a call's pre-tool hooks run comes before the call: it never acts, and is answered Not run", async () => {
  const d = desk();
  /** @type {string[]} */
  const acted = [];
  /** @type {any[]} */
  const events = [];
  const out = await runAgentTurn(args({
    call: async () => reply([use("w1", "write", { path: "a.txt", content: "x" })]),
    runHand: async (/** @type {string} */ name) => (acted.push(name), `${name} ran`),
    hooks: /** @type {any} */ (hooksLogging([], { pre: async () => (d.stop(), []) })),
    mailbox: d.mailbox,
    onEvent: (e) => events.push(e),
  }));
  assert.equal(out.status, "stopped");
  assert.deepEqual(acted, [], "the write never ran");
  assert.deepEqual(answers(out), [["w1", NOT_RUN]]);
  const end = events.find((e) => e.type === "tool-end" && e.id === "w1");
  assert.deepEqual([end?.stopped, end?.notRun], [true, true], "drawn as a call the stop came before");
});

/** A turn's tree whose snapshot before a write runs `before`, and whose round's snapshot takes nothing. @param {() => Promise<void>} before */
const treeWith = (before) => ({ before, take: async () => ({ rows: [], snapshots: [], errors: [] }) });

// (fails before: yes — the bug hunt of 10-30, LOOP-1: with no hooks nothing asked for the stop between the snapshot a
// write waits on and the write: the stop that landed while git took it let the write land after it)
test("a stop that lands while a write waits on the snapshot before it comes before the write: it never acts, and is answered Not run", async () => {
  const d = desk();
  /** @type {string[]} */
  const acted = [];
  /** @type {any[]} */
  const events = [];
  const out = await runAgentTurn(args({
    call: async () => reply([use("w1", "write", { path: "a.txt", content: "x" })]),
    runHand: async (/** @type {string} */ name) => (acted.push(name), `${name} ran`),
    tree: /** @type {any} */ (treeWith(async () => d.stop())),
    mailbox: d.mailbox,
    onEvent: (e) => events.push(e),
  }));
  assert.equal(out.status, "stopped");
  assert.deepEqual(acted, [], "the write never ran");
  assert.deepEqual(answers(out), [["w1", NOT_RUN]]);
  const end = events.find((e) => e.type === "tool-end" && e.id === "w1");
  assert.deepEqual([end?.stopped, end?.notRun], [true, true], "drawn as a call the stop came before");
});

// (fails before: yes — the bug hunt of 10-30, LOOP-1: the Force stop ended the turn with the write answered as cut, and
// once the snapshot came back the muted loop wrote the file all the same, a write no record holds)
test("a Force stop while a write waits on the snapshot before it ends the turn at once, and the write does not land once the snapshot is in", async () => {
  const d = desk();
  /** @type {string[]} */
  const acted = [];
  /** @type {any[]} */
  const events = [];
  /** @type {() => void} */
  let snapped = () => {};
  const held = new Promise((resolve) => {
    snapped = () => resolve(undefined);
  });
  const out = runAgentTurn(args({
    call: async () => reply([use("w1", "write", { path: "a.txt", content: "x" })]),
    runHand: async (/** @type {string} */ name) => (acted.push(name), `${name} ran`),
    tree: /** @type {any} */ (treeWith(() => /** @type {Promise<void>} */ (held))),
    mailbox: d.mailbox,
    onEvent: (e) => events.push(e),
  }));
  await until(() => events.some((e) => e.type === "tool-start" && e.id === "w1"), "the write to wait on its snapshot");
  d.force();
  const ended = await out;
  assert.deepEqual([ended.status, ended.forced], ["stopped", true]);
  assert.deepEqual(answers(ended), [["w1", FORCE_CUT]]);
  snapped();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(acted, [], "the write never ran after the turn ended");
});

// (fails before: yes — the bug hunt of 10-30, LOOP-1: the same before an agent call, whose helper may write in the folder:
// a stop that landed while its snapshot was taken still sent the sub-agent off)
test("a stop that lands while an agent call waits on the snapshot before it comes before the launch: no sub-agent starts", async () => {
  const d = desk();
  /** @type {string[]} */
  const launched = [];
  const out = await runAgentTurn(args({
    call: async () => reply([use("a1", "agent", { description: "Map it", prompt: "map the parser", background: true })]),
    subagents: /** @type {any} */ ({
      run: async (/** @type {any} */ o) => (launched.push(o.id), { ok: true, text: "Launched in the background.", note: "agent: a1", wrote: false, spentUsd: 0, toolCalls: 0, roundIds: [] }),
    }),
    tree: /** @type {any} */ (treeWith(async () => d.stop())),
    mailbox: d.mailbox,
  }));
  assert.equal(out.status, "stopped");
  assert.deepEqual(launched, [], "the sub-agent was never sent off");
  assert.deepEqual(answers(out), [["a1", NOT_RUN]]);
});

// (fails before: yes — the resumed turn started with none of the writes before its pause: its read-back asked for
// nothing, and its turn-end hooks heard it wrote nothing)
test("a pause keeps what the turn wrote: the resumed turn's end still asks for the file read back, and its hooks hear it wrote", async () => {
  /** @type {boolean[]} */
  const ends = [];
  const hooks = /** @type {any} */ (hooksLogging(ends, { readBack: true }));
  const asked = await runAgentTurn(args({
    call: async () => reply([use("w1", "write", { path: "notes.txt", content: "x" }), use("q1", "ask", { question: "Tabs or spaces?" })]),
    hooks,
  }));
  assert.equal(asked.pause?.pending?.id, "q1", "the question pauses the turn");
  /** @type {any[]} */
  const bodies = [];
  const out = await runAgentTurn(args({
    call: async ({ body }) => (bodies.push(structuredClone(body)), reply([{ type: "text", text: "Done." }])),
    hooks,
    resume: { paused: /** @type {any} */ (asked.pause), answer: "Tabs." },
  }));
  assert.equal(out.status, "done");
  assert.deepEqual(ends, [true], "the turn-end hooks hear the turn wrote");
  assert.equal(bodies.length, 2, "the turn went back once, for the read-back");
  assert.match(JSON.stringify(bodies[1].messages.at(-1)), /Read these files back before you finish and confirm they are as intended: notes\.txt/);
});

// (fails before: no — a guard the mutation pass asked for: what the turn wrote before its pause counts as written before
// the resumed turn's first call, so a read of it then clears the debt)
test("a file written before the pause and read back after it is not asked for again", async () => {
  /** @type {boolean[]} */
  const ends = [];
  const hooks = /** @type {any} */ (hooksLogging(ends, { readBack: true }));
  const asked = await runAgentTurn(args({
    call: async () => reply([use("w1", "write", { path: "notes.txt", content: "x" }), use("q1", "ask", { question: "Tabs or spaces?" })]),
    hooks,
  }));
  let n = 0;
  const out = await runAgentTurn(args({
    call: async () => reply(n++ === 0 ? [use("r1", "read", { path: "notes.txt" })] : [{ type: "text", text: "Done." }]),
    hooks,
    resume: { paused: /** @type {any} */ (asked.pause), answer: "Tabs." },
  }));
  assert.equal(out.status, "done");
  assert.equal(n, 2, "the read, then the end: no round more for a read-back");
  assert.deepEqual(ends, [true]);
});

// (fails before: yes — the hang-up ended the turn on its reply's open calls: a sub-agent's follow-up carried them, and
// its provider refused the request)
test("a hang-up while a reply's tools run answers every call of it: the conversation holds no open call", async () => {
  const gone = new AbortController();
  const out = await runAgentTurn(args({
    // The call after the hang-up is a write: reads next to each other run together (loop.js `onlyReads`).
    call: async () => reply([use("r1", "read", { path: "a.txt" }), use("r2", "write", { path: "b.txt", content: "x" })]),
    runHand: async (/** @type {string} */ name, /** @type {any} */ input) => {
      if (input.path === "a.txt") gone.abort();
      return `${name} ran`;
    },
    signal: gone.signal,
  }));
  assert.equal(out.status, "aborted");
  assert.deepEqual(answers(out), [["r1", "read ran"], ["r2", GONE]]);
  // After a reload the page draws the call as it drew it live: a Stopped stub, not run.
  assert.deepEqual(archivedStubs([{ id: "r2", name: "write", isError: true, result: GONE }]).map((x) => [x.state, x.notRun]), [["stopped", true]]);
});

// (fails before: yes — the same after a pause: the resumed turn's hang-up left the parked reply's later calls open)
test("a hang-up while a resumed turn's calls run answers every call of the parked reply", async () => {
  const asked = await runAgentTurn(args({
    modeNow: () => "edit",
    call: async () => reply([use("b1", "bash", { command: "make build" }), use("r2", "read", { path: "b.txt" })]),
  }));
  const gone = new AbortController();
  const out = await runAgentTurn(args({
    modeNow: () => "edit",
    runHand: async (/** @type {string} */ name) => {
      if (name === "bash") gone.abort();
      return `${name} ran`;
    },
    signal: gone.signal,
    resume: { paused: /** @type {any} */ (asked.pause), answer: "yes", allow: true },
  }));
  assert.equal(out.status, "aborted");
  assert.deepEqual(answers(out), [["b1", "bash ran"], ["r2", GONE]]);
});
