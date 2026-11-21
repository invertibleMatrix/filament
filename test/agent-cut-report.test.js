// @ts-check
// The server's half of an agent's thread drawn as the main transcript (the transcript audit of 2026-10-23): an agent
// whose run ended before it reported — its loop threw, its provider failed before its last round said anything, a
// restart or a crash cut it — keeps what its run's log shows it had written and called, said as such, and its follow-up
// goes on from it; an edit card in its thread reads its call's change from its conversation; your words to an agent
// you launched yourself tell nobody else; and a reply of several rounds keeps a paragraph between their words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { cutReportOfRun } from "../src/core/run-work.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createMemoryToolStream, mergeJsonRounds } from "../src/memory-tools.js";
import { until } from "./helpers/wait.js";

const root = tmpdir();
/** @param {any[]} content @param {string | null} [id] */
const reply = (content, id = null) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id, upstream: "m", retryAfter: null, shouldRetry: null });
/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));
const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

/** A run's log that said something, called twice and was cut in its second round. */
const CUT = [
  { n: 1, type: "run-start" },
  { n: 2, type: "round-start", round: 1 },
  { n: 3, type: "round-text", round: 1, text: "The keys go stale in cache.js." },
  { n: 4, type: "tool-start", round: 1, id: "c1", name: "read", args: "src/cache.js", card: { kind: "read", subject: "src/cache.js" } },
  { n: 5, type: "tool-end", round: 1, id: "c1", ok: true },
  { n: 6, type: "round-start", round: 2 },
  { n: 7, type: "tool-start", round: 2, id: "c2", name: "bash", args: "npm test", card: { kind: "shell", subject: "npm test" } },
  { n: 8, type: "tool-end", round: 2, id: "c2", ok: false, exitCode: 1 },
  { n: 9, type: "tool-start", round: 2, id: "c3", name: "edit", args: "src/cache.js", card: { kind: "edit", subject: "src/cache.js" } },
];
const CUT_WORDS = "The keys go stale in cache.js.\n\nIts calls:\n- read src/cache.js: done\n- bash npm test: failed (exit 1)\n- edit src/cache.js: still running when its run ended";
const LOGGED = "(It ended before it sent a report. From its run's log, what it had written and the calls it made:)";

/**
 * A registry whose host is scripted, with a run log it reads: each launch is served as turn.js serves one — attach,
 * then finish before the reply — by `serve`, and its run's events are what `logs` holds under its run's id.
 * @param {(o: { id: string, runId: string, body: any, n: number }) => Promise<{ status?: string, report: string, error?: string | null, convo?: any[] | null }>} serve
 */
function logged(serve) {
  /** @type {Map<string, any[]>} */
  const logs = new Map();
  /** @type {any[]} */
  const posts = [];
  /** @type {any[]} */
  const steers = [];
  let n = 0;
  const runs = {
    /** @param {string} id @param {{ since?: number, limit?: number }} [o] */
    events: (id, { since = 0, limit = 1000 } = {}) => ({ events: (logs.get(id) || []).filter((e) => e.n > since).slice(0, limit) }),
    /** @param {string} runId @param {any} m */
    steer: (runId, m) => (steers.push({ runId, ...m }), { ok: true, id: `m${steers.length}` }),
    subscribe: () => () => {},
  };
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: /** @type {any} */ (runs),
    now: Date.now,
    context: {
      settings: () => ({ subagents: { pool: [{ model: "", seats: 2 }] }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: root, model: "m", projectId: "p1" }),
      view: async () => ({ text: "User: fix the cache\nAssistant: On it.", turns: 1 }),
      brief: async () => null,
      modelProblem: () => null,
      mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
    },
    call: async ({ body, headers = {} }) => {
      posts.push({ body, headers });
      const id = headers["x-filament-subagent"];
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      const r = await serve({ id, runId, body, n });
      registry.finish(id, { status: r.status || "done", error: r.error ?? null, report: r.report, convo: r.convo === undefined ? [...body.messages, { role: "assistant", content: [{ type: "text", text: r.report }] }] : r.convo, rounds: 1, toolCalls: 0, tokensIn: 10, tokensOut: 5, spentUsd: 0, roundIds: [runId] });
      return reply([{ type: "text", text: r.report }], runId);
    },
  });
  return { registry, logs, posts, steers };
}

// (fails before: yes — nothing read a cut run's log for its report: what it had done was lost with it)
test("a run's log as a report: its words, then its newest calls by name, target and how each ended; long words keep their end", () => {
  assert.equal(cutReportOfRun(CUT), CUT_WORDS);
  assert.equal(cutReportOfRun([{ n: 1, type: "run-start" }, { n: 2, type: "round-start", round: 1 }]), "", "a log that shows nothing is no report");
  assert.equal(cutReportOfRun([{ n: 1, type: "round-text", round: 1, text: `${"a".repeat(50)}END` }], { chars: 10 }), "…aaaaaaaEND");
  const many = Array.from({ length: 25 }, (_, i) => ({ n: i + 2, type: "tool-start", round: 1, id: `k${i}`, name: "read", args: `f${i}.js` }));
  assert.match(cutReportOfRun(many), /^Its newest 20 calls, of 25:\n- read f5\.js: still running when its run ended\n/);
});

// (fails before: yes — its loop threw and the host reported nothing: the report read "(no report)" and the follow-up
// started from the task alone)
test("an agent whose loop threw: its run's log stands for its report, said as such, and its follow-up goes on from it", async () => {
  const { registry, logs, posts } = logged(async ({ runId, n }) => {
    if (n > 1) return { report: "GOT IT" };
    logs.set(runId, CUT);
    return { status: "failed", error: "agent loop failed: boom", report: "", convo: null };
  });
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "audit the cache" });
  assert.ok(r.ok);
  const id = r.ok ? r.id : "";
  const o = /** @type {any} */ (await (r.ok ? r.done : null));
  assert.deepEqual([o.status, o.fromLog, o.report], ["failed", true, CUT_WORDS]);
  const ex = /** @type {any} */ (registry.get(id)?.exchanges[0]);
  assert.deepEqual([ex.fromLog, ex.report], [true, CUT_WORDS], "its thread knows the report is its log's");
  const f = registry.followUp(id, { prompt: "go on", chainId: "c1" });
  await (f.ok ? f.done : null);
  const second = posts[1].body.messages;
  assert.deepEqual(second.map((/** @type {any} */ m) => m.role), ["user", "assistant", "user"]);
  assert.equal(textOf(second[1]), CUT_WORDS, "what it had done is in its context");
  assert.equal(textOf(second[2]), "go on");
});

// (fails before: yes — the main agent read "(no report)")
test("the main agent reads such an end as its log's, not as a report", async () => {
  const { registry, logs } = logged(async ({ runId }) => {
    logs.set(runId, CUT);
    return { status: "failed", error: "agent loop failed: boom", report: "", convo: null };
  });
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: root, mode: "edit", model: "m", thinking: null, fork: null });
  const res = await /** @type {any} */ (door).subagents.run({ id: "toolu_1", input: { run_in_background: false, description: "Cache audit", prompt: "audit the cache" }, emit: () => {}, signal: null });
  assert.ok(String(res.text).startsWith(`[Filament: the sub-agent failed — agent loop failed: boom; what it reported is below]\n${LOGGED}\n\n${CUT_WORDS}`), res.text);
  door.close();
});

// (fails before: yes — the restart's notice said what it had not reported was lost, whatever its log held)
test("a run a crash left open: the session's notice carries what its log shows", () => {
  const { registry, logs } = logged(async () => ({ report: "x" }));
  logs.set("r9", CUT);
  const brief = { agentId: "sa_0badf0a1", exchange: 0, description: "Cache audit", task: "audit the cache", by: "agent", deliver: true };
  assert.equal(registry.orphaned({ runId: "r9", chainId: "c1", brief, rounds: 2 }), true);
  const [q] = registry.peekQueued("c1");
  assert.equal(q.text, `[Filament: sub-agent sa_0badf0a1 ("Cache audit") was cut by a Filament restart before it finished, after 2 rounds. What its run's log shows of its work is below; the rest is lost; launch it anew if its task is still needed. Its task:\naudit the cache\n\nBefore the cut:\n${LOGGED}\n\n${CUT_WORDS}]`);
  assert.equal(registry.orphaned({ runId: "r10", chainId: "c1", brief: { ...brief, agentId: "sa_0badf0a2" } }), true);
  assert.match(registry.peekQueued("c1")[1].text, /What it had not reported is lost; launch it anew/, "a log that shows nothing: as before");
});

// (fails before: yes — an edit card in an agent's thread had no call to ask: its run keeps no snapshot)
test("an edit card in an agent's thread reads its call's change from its conversation: its loop's while it runs, the one it keeps once it ended", async () => {
  const gate = deferred();
  const started = deferred();
  const { registry } = logged(async ({ id, body }) => {
    const live = [...body.messages];
    registry.runConvo(id, live);
    live.push({ role: "assistant", content: [
      { type: "tool_use", id: "toolu_e1", name: "edit", input: { path: "src/a.js", edits: [{ oldText: "one\n", newText: "two\n" }] } },
      { type: "tool_use", id: "toolu_e0", name: "Edit", input: { file_path: "src/b.js" } },
    ] });
    started.resolve();
    await gate.promise;
    return { report: "EDITED", convo: [...live, { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_e1", content: "ok" }, { type: "tool_result", tool_use_id: "toolu_e0", content: "ok" }] }, { role: "assistant", content: [{ type: "text", text: "EDITED" }] }] };
  });
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "edit a.js" });
  const id = r.ok ? r.id : "";
  await started.promise;
  const now = /** @type {any} */ (registry.callChange(id, "c1", "toolu_e1"));
  assert.deepEqual([now.ok, now.change.file, now.change.added, now.change.removed, now.change.wrote], [true, "src/a.js", 1, 1, false], "from its loop's conversation, while it runs");
  assert.match(now.change.patch, /-one\n\+two/);
  assert.deepEqual(registry.callChange(id, "c1", "toolu_x"), { ok: false, error: "its conversation does not hold this call", why: "later" }, "one its loop has not written yet");
  assert.deepEqual(registry.callChange(id, "c1", "toolu_e0"), { ok: false, error: "this call's record holds no change", why: "none" }, "one that named its file alone");
  assert.equal(registry.callChange(id, "c2", "toolu_e1").ok, false, "another session's agent");
  gate.resolve();
  await (r.ok ? r.done : null);
  assert.equal(registry.callChange(id, "c1", "toolu_e1").ok, true, "from the conversation it keeps, once it ended");
  assert.deepEqual(registry.callChange(id, "c1", "toolu_x"), { ok: false, error: "its conversation does not hold this call", why: "absent" });
});

// (fails before: yes — the main agent was told "the developer wrote to your sub-agent" of one it never launched)
test("your words to an agent at work that you launched yourself reach its run and tell nobody else", async () => {
  const gate = deferred();
  const { registry, steers } = logged(async () => {
    await gate.promise;
    return { report: "OK" };
  });
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "work on it" });
  const id = r.ok ? r.id : "";
  await until(() => registry.get(id)?.exchanges[0]?.runId, "its run");
  assert.deepEqual(registry.developerMessage(id, { chainId: "c1", text: "Use v2." }), { ok: true, asking: null, ask: null, lead: false, told: null });
  assert.deepEqual(steers.map((s) => [s.kind, s.text, s.from]), [["note", "Use v2.", "harness"]], "into its run, as yours");
  assert.equal(registry.peekQueued("c1").length, 0, "nobody else is told");
  gate.resolve();
  await (r.ok ? r.done : null);
});

// (fails before: yes — an OpenAI-format client read "Let me check.Two sessions match." as one line glued)
test("a reply of several rounds keeps a paragraph between their words, sent whole or streamed", () => {
  const o1 = { id: "a", choices: [{ index: 0, message: { role: "assistant", content: "Let me check.", tool_calls: [{ id: "c1", type: "function", function: { name: "filament_memory_search", arguments: "{}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } };
  const o2 = { id: "b", choices: [{ index: 0, message: { role: "assistant", content: "Two sessions match." }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 } };
  assert.equal(mergeJsonRounds("openai", [o1, o2]).choices[0].message.content, "Let me check.\n\nTwo sessions match.");

  const sse = (/** @type {any} */ obj) => `data: ${JSON.stringify(obj)}\n\n`;
  const chunk = (/** @type {any} */ delta, /** @type {string | null} */ finish = null) => sse({ id: "c1", object: "chat.completion.chunk", model: "gpt", choices: [{ index: 0, delta, finish_reason: finish }] });
  const contents = (/** @type {string} */ out) => out.split("\n\n").filter((b) => b.startsWith("data: {")).map((b) => JSON.parse(b.slice(6))).map((e) => e.choices?.[0]?.delta?.content).filter((c) => typeof c === "string" && c);
  const s = createMemoryToolStream("openai");
  let out = "";
  out += s.push(chunk({ role: "assistant", content: "Let me check." }));
  out += s.push(chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "filament_memory_search", arguments: "{\"query\":\"x\"}" } }] }));
  out += s.push(chunk({}, "tool_calls"));
  out += s.push("data: [DONE]\n\n");
  out += s.endResponse().forwarded;
  s.nextResponse();
  out += s.push(chunk({ role: "assistant", content: "" }));
  out += s.push(chunk({ content: "Two sessions" }));
  out += s.push(chunk({ content: " match." }));
  out += s.push(chunk({}, "stop"));
  out += s.push("data: [DONE]\n\n");
  out += s.endResponse().forwarded;
  assert.deepEqual(contents(out), ["Let me check.", "\n\nTwo sessions", " match."], "the later round's first words open a paragraph, once");
});
