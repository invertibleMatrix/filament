// @ts-check
// How a learning run reads a session (HarnessV3-Memory M7-5, M7-D28..D30): in passes, oldest first, each turn with the
// calls its work made, the cursor moved past each pass that lands and never past a turn no pass read; a pass the model
// cannot answer is split and a single turn it still cannot answer is passed over, named; a run that reaches its last
// pass leaves the rest noted for the session's next boundary; and a compaction's run that comes while one is going runs
// after it. A real MemoryLearner over a real Archive and brain, its model scripted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/services/memory/archive.js";
import { MemoryLearner, passesOf, PASS_TURNS, PASS_TOKENS, TURN_CHARS, MAX_PASSES } from "../src/services/memory/learn.js";
import { MemoryBrain } from "../src/services/memory/brain.js";
import { callLog } from "../src/core/messages.js";

const fakeStore = () => ({ async remember() { return { id: "m1" }; }, async recall() { return []; } });
/** The project's words: what a session's first pass says it was about. */
const SO_FAR = "Set up the release pipeline for the service.";

/**
 * A scratch archive and a learner whose model answers `answer(prompt, n)` (a string, or an object sent as JSON).
 * `model`: the learning model's name as memory says it (left out: the learner asks callModel alone); `dailyCap`: the
 * items a day.
 * @param {(user: string, n: number) => any} answer @param {{ model?: () => string, dailyCap?: number }} [o]
 */
function rig(answer, { model, dailyCap = 200 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "filament-passes-"));
  /** @type {any} */
  const a = new Archive(/** @type {any} */ ({ file: join(dir, "a.db") }));
  const brain = new MemoryBrain(/** @type {any} */ ({ archive: a, store: fakeStore() }));
  /** @type {string[]} */
  const prompts = [];
  /** Every call the learner made, as it made it. @type {any[]} */
  const asks = [];
  /** @type {any[]} */
  const ops = [];
  /** @type {any} */
  const learner = new MemoryLearner(
    /** @type {any} */ ({
      archive: a,
      brain,
      getConfig: () => ({ capture: { learn: true, idleMinutes: 30, dailyCap } }),
      ...(model ? { model } : {}),
      callModel: async (/** @type {any} */ c) => {
        asks.push(c);
        prompts.push(c.user);
        const r = await answer(c.user, prompts.length);
        return typeof r === "string" ? r : JSON.stringify(r);
      },
    }),
  );
  learner.onOp = (/** @type {string} */ title, /** @type {any} */ opts) => ops.push({ title, ...(opts || {}) });
  const close = () => {
    brain.stop();
    a.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { a, brain, learner, prompts, asks, ops, close };
}
/**
 * A session of `count` turns: turn n's person says `say(n)`, its answer is `reply(n)`; each finished unless `open`
 * names it. Returns the chain and its turns' row ids by number.
 * @param {any} a @param {number} count @param {{ key?: string, say?: (n: number) => string, reply?: (n: number) => string, open?: number[] }} [o]
 */
function session(a, count, { key = "k1", say = (n) => `step ${n}`, reply = (n) => `done with step ${n}`, open = [] } = {}) {
  const ch = a.chainForKey(key, { cwd: "C:\\filament", client: "claude-code", model: "m" });
  /** @type {Map<number, number>} */
  const ids = new Map();
  for (let n = 1; n <= count; n++) {
    const t = a.beginTurn(ch.id, { requestId: `${key}-r${n}`, userMessage: { role: "user", content: say(n) } });
    ids.set(n, t.turnId);
    if (!open.includes(n)) a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: reply(n) }, requestId: `${key}-r${n}` });
  }
  return { ch, ids };
}
/** The span a prompt reads, as its head says. @param {string} p */
const spanOf = (p) => /Session turns (\d+) to (\d+):/.exec(p)?.slice(1).map(Number) ?? null;

test("passesOf: in order, a turn never split; a pass ends at its token or its turn limit; a turn longer than a pass keeps both ends", () => {
  const t = (/** @type {number} */ n, /** @type {number} */ chars) => ({ n, text: `T${n}:` + "w".repeat(chars) });
  const small = Array.from({ length: PASS_TURNS + 3 }, (_, i) => t(i + 1, 40));
  assert.deepEqual(passesOf(small).map((p) => p.map((x) => x.n)), [Array.from({ length: PASS_TURNS }, (_, i) => i + 1), [PASS_TURNS + 1, PASS_TURNS + 2, PASS_TURNS + 3]], "the turn limit");
  const quarter = PASS_TOKENS; // a quarter of a pass's tokens, in characters
  assert.deepEqual(passesOf([t(1, quarter), t(2, quarter), t(3, quarter), t(4, quarter), t(5, quarter)]).map((p) => p.map((x) => x.n)), [[1, 2, 3], [4, 5]], "the token limit: three quarters and a bit, then the rest");
  const [[huge]] = passesOf([{ n: 1, text: `HEAD ${"m".repeat(TURN_CHARS * 3)} TAIL` }]);
  assert.ok(huge.text.startsWith("HEAD ") && huge.text.endsWith(" TAIL"), "both ends kept");
  assert.match(huge.text, /characters of the middle were left out/);
  assert.ok(huge.text.length < TURN_CHARS + 200, `kept to the turn's cap: ${huge.text.length}`);
  assert.deepEqual(passesOf([]), []);
});

test("a session longer than a pass is read in passes, oldest first: the cursor moves after each, the oldest turn's rule is filed on its turn, the second pass reads the session so far and the first pass's thread, and the title is the first pass's", async () => {
  const RULE = "Never push to main directly; open a pull request instead.";
  const r = rig((user) => {
    const [from] = spanOf(user) ?? [0];
    return from === 1
      ? { title: "Release pipeline", state: { summary: SO_FAR, done: [], open: ["wire the deploy step into ci.yml"], next: [] }, turns: [{ n: 1, summary: "the rule" }], items: [{ kind: "rule", text: RULE, importance: 0.9, turn: 1 }] }
      : { title: "Something else", state: { summary: "The pipeline runs; the deploy step is wired.", done: ["deploy step"], open: [], next: [] }, turns: [], items: [{ kind: "fact", text: "The deploy step runs after the tests pass in ci.yml.", importance: 0.6, turn: 20 }] };
  });
  try {
    const { ch, ids } = session(r.a, 20, { say: (n) => (n === 1 ? `Set up the release pipeline. ${RULE}` : `step ${n}`), reply: (n) => `done with step ${n}: ${"details ".repeat(250)}` });
    const learned = () => Number(r.a.getChain(ch.id)?.meta?.learnedThrough || 0);
    const at = [];
    r.learner.onOp = (title, opts) => {
      r.ops.push({ title, ...(opts || {}) });
      if (opts?.sub === "milestone") at.push(learned());
    };
    const out = await r.learner.learnChain(ch.id, { reason: "compaction", door: "line" });
    assert.deepEqual(r.prompts.map(spanOf), [[1, 16], [17, 20]], "two passes, oldest first");
    // (fails before: yes — each pass was capped at 3,000 tokens: HarnessV3-FailurePoints §13)
    assert.ok(r.asks.length === 2 && r.asks.every((c) => !("maxTokens" in c)), "no cap: each pass asks for all the model can write");
    assert.ok(r.prompts[0].includes("### Turn 1 (") && r.prompts[0].includes(RULE), "the oldest turn is read");
    assert.ok(!r.prompts[0].includes("### Turn 17 ("), "a pass reads its own turns");
    assert.ok(!r.prompts[0].includes("omitted"), "nothing of them left out");
    assert.deepEqual(at, [0, 16], "the cursor moved after the first pass landed, before the second was read");
    assert.equal(learned(), 20);
    // The second pass knows what the session established before it, and the thread the first one opened.
    assert.ok(r.prompts[1].startsWith(`Project: filament. The session so far, as learned from its earlier turns: ${SO_FAR} Session turns 17 to 20:`), r.prompts[1].slice(0, 300));
    assert.match(r.prompts[1], /\n- i\d+: wire the deploy step into ci\.yml/);
    assert.ok(!r.prompts[0].includes("The session so far"), "the first pass starts at turn 1");
    // The user's rule is filed as a rule, on the turn they said it.
    const items = r.a.items.list({ projectId: ch.project_id });
    const rule = items.find((/** @type {any} */ i) => i.text === RULE);
    assert.deepEqual([rule?.kind, rule?.turn_id], ["rule", ids.get(1)]);
    // The thread the first pass opened is filed on its last turn; the end state is the last pass's, the title the first's.
    assert.equal(items.find((/** @type {any} */ i) => i.kind === "thread")?.turn_id, ids.get(16));
    assert.equal(r.a.getChain(ch.id).title, "Release pipeline");
    assert.equal(r.a.getChain(ch.id).state.summary, "The pipeline runs; the deploy step is wired.");
    assert.deepEqual([out.passes, out.items, out.through], [2, 3, 20]);
    assert.equal(out.title, "Release pipeline");
  } finally {
    r.close();
  }
});

test("a turn still running is neither read nor marked; an older one that never ended is read as such", async () => {
  const r = rig(() => ({ items: [] }));
  try {
    const { ch, ids } = session(r.a, 4, { open: [2, 4] });
    await r.learner.learnChain(ch.id, { reason: "idle" });
    assert.deepEqual(r.prompts.map(spanOf), [[1, 3]]);
    assert.match(r.prompts[0], /### Turn 2 \([^)]*\)\nUser: step 2\nAssistant: \(no final answer recorded\)/, "turn 2 was cut short: its words are read");
    assert.ok(!r.prompts[0].includes("### Turn 4 ("), "turn 4 is still running");
    assert.equal(r.a.getChain(ch.id).meta.learnedThrough, 3);
    r.a.finishTurn(/** @type {number} */ (ids.get(4)), { finalMessage: { role: "assistant", content: "done with step 4" }, requestId: "k1-r4" });
    await r.learner.learnChain(ch.id, { reason: "idle" });
    assert.deepEqual(r.prompts.map(spanOf), [[1, 3], [4, 4]], "once it ended, the next run reads it alone");
    assert.equal(r.a.getChain(ch.id).meta.learnedThrough, 4);
    assert.equal((await r.learner.learnChain(ch.id, { reason: "idle" })).skipped, "nothing new");
  } finally {
    r.close();
  }
});

test("a turn's calls are read with it: a failed one marked, a secret redacted, every wire shape; the reading is redacted before it leaves", async () => {
  const r = rig(() => ({ items: [] }));
  try {
    const { ch, ids } = session(r.a, 3, { reply: (n) => (n === 3 ? "Deployed with the key sk-abcdefghijklmnopqrstuvwxyz0123." : `done with step ${n}`) });
    r.a.addWork(/** @type {number} */ (ids.get(1)), [
      { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "Bash", input: { command: "npm test" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", is_error: true, content: "Error: CLAUDECODE is set" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "c2", name: "Bash", input: { command: "env -u CLAUDECODE npm test" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c2", content: "ok" }] },
    ]);
    r.a.addWork(/** @type {number} */ (ids.get(2)), [
      { role: "assistant", content: null, tool_calls: [{ id: "o1", type: "function", function: { name: "shell", arguments: '{"cmd":"curl -H \\"Authorization: Bearer abcdefghijklmnopqrstuvwxyz\\" https://x"}' } }] },
      { role: "tool", tool_call_id: "o1", content: "200" },
      { type: "function_call", call_id: "f1", name: "read_file", arguments: '{"path":"ci.yml"}' },
    ]);
    await r.learner.learnChain(ch.id, { reason: "idle" });
    const [p] = r.prompts;
    assert.ok(p.includes('### Turn 1 (') && p.includes('User: step 1\nCalls, oldest first (2):\n- Bash {"command":"npm test"} (failed)\n- Bash {"command":"env -u CLAUDECODE npm test"}\nAssistant: done with step 1'), p);
    assert.ok(p.includes('User: step 2\nCalls, oldest first (2):\n- shell {"cmd":"curl -H \\"Authorization: Bearer [redacted]\\" https://x"}\n- read_file {"path":"ci.yml"}\nAssistant: done with step 2'), p);
    assert.ok(p.includes("User: step 3\nAssistant: Deployed with the key sk-abcd…"), "a turn with no calls has no calls line, and its words are redacted");
    assert.ok(!p.includes("abcdefghijklmnopqrstuvwxyz"), "no secret leaves");
    assert.match(p.split("\n\n")[0], /^Project: filament\. Session turns 1 to 3:$/);
  } finally {
    r.close();
  }
});

test("callLog: the newest of many calls, with the count; an OpenAI or Responses call reads as done, never failed", () => {
  const many = Array.from({ length: 45 }, (_, i) => ({ role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "Read", input: { path: `f${i}` } }] }));
  assert.equal(callLog(many).length, 45);
  assert.deepEqual(callLog([{ role: "assistant", tool_calls: [{ id: "x", function: { name: "f", arguments: "not json" } }] }, { role: "tool", tool_call_id: "x", content: "Error" }]), [{ tool: "f", input: '"not json"', ok: true }]);
});

test("a pass the model cannot answer is split, and a single turn it still cannot answer is passed over, named; a model that never answered stops the run and leaves the cursor", async () => {
  /** @type {"prose" | "poison"} */
  let mode = "prose";
  const r = rig((user) => (mode === "prose" || user.includes("POISON") ? "I could not do that, sorry." : { items: [] }));
  try {
    const clean = session(r.a, 2, { key: "clean" });
    const bad = session(r.a, 4, { key: "bad", say: (n) => (n === 3 ? "POISON step" : `step ${n}`) });
    // A model that has never answered JSON may be the fault: two calls, the run stops, nothing moves.
    const first = await r.learner.learnChain(clean.ch.id, { reason: "idle" });
    assert.equal(first.skipped, "bad json");
    assert.equal(r.prompts.length, 2, "asked once, then once more firmly");
    assert.equal(r.a.getChain(clean.ch.id).meta?.learnedThrough ?? 0, 0, "its turns wait for the next run");
    // Once it answers, a span it cannot answer is the span's fault: split down to the turn, which is passed over.
    mode = "poison";
    await r.learner.learnChain(clean.ch.id, { reason: "idle" });
    r.prompts.length = 0;
    r.ops.length = 0;
    const out = await r.learner.learnChain(bad.ch.id, { reason: "idle" });
    assert.deepEqual(r.prompts.map(spanOf), [[1, 4], [1, 4], [1, 2], [3, 4], [3, 4], [3, 3], [3, 3], [4, 4]], "the pass, its halves, the bad turn alone, the rest");
    assert.deepEqual(out.passedOver, [3]);
    assert.equal(out.passes, 2);
    assert.equal(r.a.getChain(bad.ch.id).meta.learnedThrough, 4, "the session never sticks on it");
    assert.deepEqual(r.a.getChain(bad.ch.id).meta.lastLearn.passedOver, [3]);
    const warn = r.ops.find((o) => o.level === "warn");
    assert.match(warn?.title ?? "", /: turn 3 passed over — the model answered it twice with no JSON$/);
    assert.deepEqual(r.ops.find((o) => o.sub === "done")?.detail.passedOver, [3]);
  } finally {
    r.close();
  }
});

test("a run reads at most its passes and leaves the rest noted for the session's next boundary; the cursor only moves forward, a forced run's failure included", async () => {
  let fail = 0;
  const r = rig((_user, n) => {
    if (fail && n === fail) throw new Error("the provider fell over");
    return { items: [] };
  });
  try {
    const total = MAX_PASSES * PASS_TURNS + 5;
    const { ch } = session(r.a, total);
    const out = await r.learner.learnChain(ch.id, { reason: "compaction", door: "manual" });
    assert.equal(r.prompts.length, MAX_PASSES);
    assert.deepEqual([out.passes, out.left, out.through], [MAX_PASSES, 5, MAX_PASSES * PASS_TURNS]);
    assert.equal(r.a.getChain(ch.id).meta.learnedThrough, MAX_PASSES * PASS_TURNS);
    assert.ok(r.learner.pending.has(ch.id), "noted: the next boundary reads the rest");
    assert.equal(r.ops.find((o) => o.sub === "start")?.detail.left, 5);
    assert.equal(r.ops.find((o) => o.sub === "done")?.detail.left, 5);
    const rest = await r.learner.learnChain(ch.id, { reason: "idle" });
    assert.deepEqual([rest.passes, rest.left, r.a.getChain(ch.id).meta.learnedThrough], [1, undefined, total]);
    // A forced run reads from turn 1; failing on its second pass, it leaves the cursor where it stood.
    fail = r.prompts.length + 2;
    const forced = await r.learner.learnChain(ch.id, { reason: "manual", force: true });
    assert.match(forced.error, /the provider fell over/);
    assert.equal(forced.passes, 1);
    assert.equal(r.a.getChain(ch.id).meta.learnedThrough, total, "never moved back");
    assert.equal(r.ops.at(-1)?.detail.advanced, false);
  } finally {
    r.close();
  }
});

test("a turn with more calls than a reading holds shows its newest 40, oldest first, and says how many of all (M7-D29)", async () => {
  const r = rig(() => ({ items: [] }));
  try {
    const ch = r.a.chainForKey("k-many", { cwd: "C:\\filament", client: "claude-code", model: "m" });
    const t = r.a.beginTurn(ch.id, { requestId: "many-1", userMessage: { role: "user", content: "read every file" } });
    const call = (/** @type {number} */ i) => [
      { role: "assistant", content: [{ type: "tool_use", id: `u${i}`, name: "read", input: { path: `f${i}.js` } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: `u${i}`, content: "ok" }] },
    ];
    r.a.addWork(t.turnId, Array.from({ length: 45 }, (_, i) => call(i + 1)).flat());
    r.a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: "Read them all." }, requestId: "many-1" });
    await r.learner.learnChain(ch.id, { reason: "idle" });
    assert.ok(r.prompts[0].includes('User: read every file\nCalls, oldest first (the newest 40 of 45):\n- read {"path":"f6.js"}\n'), r.prompts[0]);
    assert.ok(r.prompts[0].includes('- read {"path":"f45.js"}\nAssistant: Read them all.'), "the newest last, then the answer");
    assert.ok(!r.prompts[0].includes('"f5.js"'), "the oldest five are left out");
  } finally {
    r.close();
  }
});

test("callLog redacts a secret before it cuts the input: a token across the cut leaves no part of itself (M7-D29)", () => {
  // The token starts just before the 200th character: cut first, its first characters would stay, too few for the
  // reading's own redaction to know them.
  const input = { note: "x".repeat(170), auth: "Bearer ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" };
  assert.equal(JSON.stringify(input).indexOf("ABC"), 196, "the token straddles the cut: 199 characters are kept");
  const [c] = callLog([{ role: "assistant", content: [{ type: "tool_use", id: "s1", name: "fetch", input }] }]);
  assert.ok(!c.input.includes("ABC"), c.input);
});

test("a compaction's run that comes while one is going runs once that one ends, from where it left; any other is turned away (M7-D30)", async () => {
  /** @type {(v?: any) => void} */
  let release = () => {};
  const gate = new Promise((res) => (release = res));
  const r = rig(async (_user, n) => {
    if (n === 1) await gate;
    return { items: [] };
  });
  try {
    const { ch } = session(r.a, 3);
    const first = r.learner.learnChain(ch.id, { reason: "idle" });
    // The session goes on while the idle run reads: two more turns, then a compaction.
    const t4 = r.a.beginTurn(ch.id, { requestId: "k1-r4", userMessage: { role: "user", content: "step 4" } });
    r.a.finishTurn(t4.turnId, { finalMessage: { role: "assistant", content: "done with step 4" }, requestId: "k1-r4" });
    assert.deepEqual(await r.learner.learnChain(ch.id, { reason: "idle" }), { skipped: "running" }, "an idle run is turned away");
    assert.deepEqual(await r.learner.learnChain(ch.id, { reason: "compaction", door: "line" }), { skipped: "running", queued: true });
    release();
    await first;
    await r.learner.settled();
    assert.deepEqual(r.prompts.map(spanOf), [[1, 3], [4, 4]], "the queued run read what the first one had not");
    assert.equal(r.a.getChain(ch.id).meta.learnedThrough, 4);
    assert.deepEqual(r.learner.recent.map((x) => [x.reason, x.door ?? null]), [["compaction", "line"], ["idle", null]]);
  } finally {
    r.close();
  }
});

test("a turn passed over moves the cursor past it, even when the run then fails on the next turn (M7-D28)", async () => {
  const r = rig((user) => {
    if (user.includes("prime the model")) return { items: [] };
    if (spanOf(user)?.[0] === 2) throw new Error("the provider fell over");
    return "I would rather describe the session in prose.";
  });
  try {
    // The model has answered JSON before: a span it cannot answer is the span's fault.
    const prime = session(r.a, 1, { key: "k-prime", say: () => "prime the model" });
    await r.learner.learnChain(prime.ch.id, { reason: "idle" });
    const { ch } = session(r.a, 2, { key: "k-over" });
    const out = await r.learner.learnChain(ch.id, { reason: "idle" });
    assert.deepEqual(r.prompts.slice(1).map(spanOf), [[1, 2], [1, 2], [1, 1], [1, 1], [2, 2]]);
    assert.match(out.error, /the provider fell over/);
    assert.deepEqual(out.passedOver, [1]);
    assert.equal(r.a.getChain(ch.id).meta.learnedThrough, 1, "past the turn passed over: it is not read again");
  } finally {
    r.close();
  }
});

test("with no learning model, a run skips before it reads, and the turns wait for one", async () => {
  const r = rig(() => ({ items: [] }), { model: () => "" });
  try {
    const { ch } = session(r.a, 2);
    assert.deepEqual(await r.learner.learnChain(ch.id, { reason: "idle" }), { skipped: "no model" });
    assert.equal(r.prompts.length, 0, "the model is never asked");
    assert.equal(r.a.getChain(ch.id).meta.learnedThrough, undefined);
  } finally {
    r.close();
  }
});

test("a turn Filament answered itself is left out of the reading, and new turns that are all such move the cursor past them with nothing read (M7-D28)", async () => {
  const r = rig(() => ({ items: [] }));
  try {
    const ch = r.a.chainForKey("k-cmd", { cwd: "C:\\filament", client: "claude-code", model: "m" });
    const turn = (/** @type {number} */ n, command = false) => {
      const t = r.a.beginTurn(ch.id, { requestId: `cmd-${n}`, userMessage: { role: "user", content: command ? `/help ${n}` : `step ${n}` }, command });
      r.a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: `answer ${n}` }, requestId: `cmd-${n}` });
    };
    turn(1);
    turn(2, true);
    turn(3);
    await r.learner.learnChain(ch.id, { reason: "idle" });
    assert.deepEqual(r.prompts.map(spanOf), [[1, 3]]);
    assert.ok(!r.prompts[0].includes("### Turn 2 ("), "the command's turn is not read");
    assert.equal(r.a.getChain(ch.id).meta.learnedThrough, 3);
    turn(4, true);
    turn(5, true);
    assert.deepEqual(await r.learner.learnChain(ch.id, { reason: "idle" }), { skipped: "nothing new" });
    assert.equal(r.prompts.length, 1, "nothing to read: no call");
    assert.equal(r.a.getChain(ch.id).meta.learnedThrough, 5, "the cursor past them, so they are not looked at again");
  } finally {
    r.close();
  }
});

test("a pass the daily cap cuts ends the run there: the turns after it wait, and its own are read again next time (M7-D28)", async () => {
  const r = rig(() => ({ items: [{ kind: "fact", text: "The staging service listens on port 8080.", importance: 0.6, turn: 1 }, { kind: "fact", text: "Deploys go out from the release branch every Friday.", importance: 0.6, turn: 2 }] }), { dailyCap: 1 });
  try {
    const { ch } = session(r.a, PASS_TURNS + 4);
    const out = await r.learner.learnChain(ch.id, { reason: "idle" });
    assert.equal(out.capped, true);
    assert.deepEqual(r.prompts.map(spanOf), [[1, PASS_TURNS]], "the second pass is not read");
    assert.equal(r.a.getChain(ch.id).meta.learnedThrough, undefined, "the capped pass did not move the cursor");
  } finally {
    r.close();
  }
});

// (fails before: yes — a pass's reading carried no reply before its first turn, and `corrected` marked nothing)
test("a pass's verdict marks the reply each corrected turn answers: a turn it read, never one Filament began, once; the reply before its first turn rides its reading (the memory plan's d4)", async () => {
  /** @type {number[]} */
  let says = [];
  const r = rig(() => ({ title: "", turns: [], items: [], corrected: says }));
  try {
    const { ch, ids } = session(r.a, 20, { reply: (n) => `done with step ${n}${n === 16 ? `: ${"x".repeat(500)} Shall I wire the deploy step next?` : ""}` });
    // Turn 21 Filament began itself (a background task's notice); 22 answers it.
    const own = r.a.beginTurn(ch.id, { requestId: "k1-r21", userMessage: { role: "user", content: "A background task ended (completed): done." }, own: { agent: "Claude Code", tasks: [] } });
    r.a.finishTurn(own.turnId, { finalMessage: { role: "assistant", content: "noted" }, requestId: "k1-r21" });
    const last = r.a.beginTurn(ch.id, { requestId: "k1-r22", userMessage: { role: "user", content: "step 22" } });
    r.a.finishTurn(last.turnId, { finalMessage: { role: "assistant", content: "done with step 22" }, requestId: "k1-r22" });
    ids.set(21, own.turnId).set(22, last.turnId);
    for (const [n, turn] of ids) r.a.outcomes.add({ chain: ch.id, turn, request: `k1-r${n}`, kind: "turn", agent: null, model: "m", did: "edited", counts: {}, ended: "done", rounds: 1, calls: 1, tokensIn: 1, tokensOut: 1, usd: null, ms: 1 });
    const marked = () => r.a.outcomes.list({ since: 0 }).filter((/** @type {any} */ o) => o.corrected).map((/** @type {any} */ o) => [...ids].find(([, id]) => id === o.turn_id)?.[0]).sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
    says = [3, 17, 21, 22, 40];
    await r.learner.learnChain(ch.id, { reason: "idle" });
    assert.deepEqual(r.prompts.map(spanOf), [[1, 16], [17, 22]]);
    assert.ok(!r.prompts[0].includes("How the assistant's reply before"), "the session's first turn answers no reply");
    assert.ok(r.prompts[1].includes(`Session turns 17 to 22:\n\n(How the assistant's reply before turn 17 ended: "…${"x".repeat(400 - " Shall I wire the deploy step next?".length)} Shall I wire the deploy step next?")\n\n### Turn 17`), r.prompts[1].slice(0, 700));
    // 3 and 17 answer 2 and 16 (each pass marks its own turns: 3 in the first, 17 in the second); 21 Filament began, and
    // marks nothing; 22 answers 21's reply, the one the person read; 40 is no turn read.
    assert.deepEqual(marked(), [2, 16, 21], "the replies before 3, 17 and 22");
    says = [3, 17, 22];
    await r.learner.learnChain(ch.id, { reason: "manual", force: true });
    assert.deepEqual(marked(), [2, 16, 21], "once");
  } finally {
    r.close();
  }
});

// (fails before: yes — the reply of a turn kept apart was sent to memory's model, and its turn marked)
test("a turn kept apart is never read: no pass carries its reply as the one before, and a turn answering it marks nothing (the memory plan's d4)", async () => {
  const r = rig(() => ({ title: "", turns: [], items: [], corrected: [1, 2, 3] }));
  try {
    const { ch, ids } = session(r.a, 1);
    await r.learner.learnChain(ch.id, { reason: "idle" });
    // Turn 2 Memory settings kept apart, for good; turn 3 is read again.
    const apart = r.a.beginTurn(ch.id, { requestId: "k1-r2", userMessage: { role: "user", content: "the secret plan" }, apart: "Memory settings leave this chat out" });
    r.a.finishTurn(apart.turnId, { finalMessage: { role: "assistant", content: "SECRET REPLY of the apart turn" }, requestId: "k1-r2" });
    const next = r.a.beginTurn(ch.id, { requestId: "k1-r3", userMessage: { role: "user", content: "step 3" } });
    r.a.finishTurn(next.turnId, { finalMessage: { role: "assistant", content: "done with step 3" }, requestId: "k1-r3" });
    for (const [n, turn] of [[1, ids.get(1)], [2, apart.turnId], [3, next.turnId]]) r.a.outcomes.add({ chain: ch.id, turn, request: `k1-r${n}`, kind: "turn", agent: null, model: "m", did: "edited", counts: {}, ended: "done", rounds: 1, calls: 1, tokensIn: 1, tokensOut: 1, usd: null, ms: 1 });
    await r.learner.learnChain(ch.id, { reason: "idle" });
    const last = r.prompts.at(-1) ?? "";
    assert.equal(spanOf(last)?.join("-"), "3-3", last.slice(0, 200));
    assert.ok(!last.includes("SECRET") && !last.includes("How the assistant's reply before"), last.slice(0, 400));
    assert.deepEqual(r.a.outcomes.list({ since: 0 }).map((/** @type {any} */ o) => o.corrected), [null, null, null], "turn 3 answers the apart turn's reply, which the model never read");
  } finally {
    r.close();
  }
});

// (fails before: yes — every pass was given the claims the whole session was shown, the newest first)
test("each pass is given the claims its session was shown up to its own last turn, the most recently shown first (the memory plan's d4)", async () => {
  const r = rig(() => ({ title: "", turns: [], items: [] }));
  try {
    const { ch, ids } = session(r.a, 20);
    const early = r.a.items.add({ projectId: ch.project_id, kind: "fact", text: "The release job runs on tagged commits only.", status: "inferred" }).id;
    const late = r.a.items.add({ projectId: ch.project_id, kind: "fact", text: "The deploy step waits for the smoke tests.", status: "inferred" }).id;
    r.a.injections.add({ requestId: "k1-r2", chainId: ch.id, turnId: ids.get(2), kind: "turn", ids: [`i${early}`] });
    r.a.injections.add({ requestId: "k1-r18", chainId: ch.id, turnId: ids.get(18), kind: "turn", ids: [`i${late}`] });
    await r.learner.learnChain(ch.id, { reason: "idle" });
    const listed = (/** @type {string} */ p) => [...p.matchAll(/^- i(\d+) \(/gm)].map((m) => Number(m[1]));
    assert.deepEqual(r.prompts.map(spanOf), [[1, 16], [17, 20]]);
    assert.deepEqual(r.prompts.map(listed), [[early], [late, early]]);
  } finally {
    r.close();
  }
});
