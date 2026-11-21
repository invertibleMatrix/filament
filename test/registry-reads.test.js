// @ts-check
// The sub-agent registry's reads, made cheap without changing an answer: what it asks of the chat it serves at every
// tool round of the main agent (its inbox), at every poll of the chat's agents (their seats, their rows), at every
// exchange's end (the prune) and at every change of an agent (its thread kept).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { redactSecrets } from "../src/core/redact.js";
import { cut } from "../src/core/text.js";
import { removeDirs, until } from "./helpers/wait.js";

const root = mkdtempSync(join(tmpdir(), "filament-registry-reads-"));
after(() => removeDirs(root));
/** @param {any[]} content @param {string | null} [id] */
const reply = (content, id = null) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id, upstream: "m", retryAfter: null, shouldRetry: null });

/**
 * A registry whose host is scripted, served as turn.js serves one — attach, the run's events relayed, finish before the
 * reply — with what `serve` gives; every read of the chat it serves counted in `reads`.
 * @param {(o: { id: string, relay: (e: any) => void }) => Promise<{ report: string }> | { report: string }} serve
 * @param {Partial<import("../src/app/agent/subagents.js").SubagentContext>} [context]
 */
function scripted(serve, context = {}) {
  const reads = { settings: 0, session: 0, saveThread: 0, holds: 0 };
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    now: Date.now,
    context: {
      settings: () => (reads.settings++, { subagents: { pool: [{ model: "", seats: 4 }] }, loop: { permissions: "edit" } }),
      session: () => (reads.session++, { cwd: root, model: "m", projectId: "p1" }),
      view: async () => ({ text: "User: fix the cache", turns: 1 }),
      brief: async () => null,
      modelProblem: () => null,
      mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
      saveThread: () => void reads.saveThread++,
      ...context,
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      const r = await serve({ id, relay: (e) => registry.relay(id, e) });
      registry.finish(id, { status: "done", error: null, report: r.report, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: r.report }] }], rounds: 1, toolCalls: 0, tokensIn: 10, tokensOut: 5, spentUsd: 0, roundIds: [runId] });
      return reply([{ type: "text", text: r.report }], runId);
    },
  });
  return { registry, reads };
}
/** @param {ReturnType<typeof scripted>["registry"]} registry */
const openDoor = (registry) => registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: root, mode: "edit", model: "m", thinking: null, fork: null });
/** A developer's launch in chat c1. @param {string} prompt @returns {any} */
const LAUNCH = (prompt) => ({ origin: "owner", chainId: "c1", prompt, description: "Look", background: true });

// (fails before: yes — every take read the chat's settings for whether to seal, with nothing to seal or open)
test("a tool round's take with nothing come and nothing sealed reads no settings; one with a report reads them and seals it", async () => {
  const { registry, reads } = scripted(() => ({ report: "Subject: Found it\n\nIn cache.js." }));
  const door = openDoor(registry);
  reads.settings = 0;
  for (let i = 0; i < 5; i++) assert.deepEqual(door.inbox.take({ seal: true }), []);
  assert.equal(reads.settings, 0, "nothing came and nothing waits sealed: the session's word on sealing is not read");
  const r = await door.subagents.run({ id: "toolu_1", input: { description: "Look", prompt: "look at the cache", run_in_background: true }, emit: () => {}, signal: null });
  const id = String(/sa_[0-9a-f]{8}/.exec(String(r.text))?.[0]);
  await until(() => registry.get(id)?.status === "done", "the sub-agent to report");
  reads.settings = 0;
  const taken = door.inbox.take({ seal: true });
  assert.deepEqual(taken.map((t) => [t.kind, t.from]), [["envelope", id]], "a report that came is sealed, as ever");
  assert.equal(reads.settings, 1);
  door.close();
});

// (fails before: yes — a ceiling read the chat's settings twice, and a poll of the chat's agents read them four times
// and its session three: its limit, its number and its next seat each read their own)
test("a ceiling reads the chat's settings once; a poll's seats read them once, and its session once, for the same answer", () => {
  const { registry, reads } = scripted(() => ({ report: "Done." }));
  const before = { limit: registry.limit("c1"), nextSeat: registry.nextSeat("c1") };
  reads.settings = 0;
  reads.session = 0;
  registry.limit("c1");
  assert.deepEqual([reads.settings, reads.session], [1, 1], "a ceiling: one reading of the chat");
  reads.settings = 0;
  reads.session = 0;
  const seats = registry.seatsNow("c1");
  assert.deepEqual(seats, before, "the poll's answer: the two as each says it");
  // (the owner's word of 11-05: no number of the chat's own, and no limit set on its model — none)
  assert.deepEqual(seats, { limit: { max: Infinity, running: 0 }, nextSeat: { model: "m", own: true } });
  assert.deepEqual([reads.settings, reads.session], [1, 1], "the poll: one reading of the chat");
});

// (fails before: yes — the thread was kept twice for each picture an agent drew and each artifact it published: once by
// `changed`, once again right after)
test("a picture an agent draws keeps its thread once", async () => {
  /** @type {number[]} */
  const kept = [];
  const { registry, reads } = scripted(({ relay }) => {
    const was = reads.saveThread;
    relay({ type: "visual", id: "v1", title: "flow", bytes: 10, turn: 1 });
    kept.push(reads.saveThread - was);
    const then = reads.saveThread;
    relay({ type: "artifact", name: "report", title: "Report", v: 1, address: "/a/report" });
    kept.push(reads.saveThread - then);
    return { report: "Drew it." };
  });
  const r = registry.launch(LAUNCH("draw the flow"));
  assert.ok(r.ok, JSON.stringify(r));
  await /** @type {any} */ (r).done;
  assert.deepEqual(kept, [1, 1], "the picture, then the artifact: each kept once");
  const sa = /** @type {any} */ (registry.detail(/** @type {any} */ (r).id));
  assert.deepEqual([sa?.exchanges[0].drew?.map((/** @type {any} */ d) => d.id), sa?.exchanges[0].made?.map((/** @type {any} */ m) => m.name)], [["v1"], ["report"]], "both are on the exchange, as ever");
});

// (fails before: yes — a prune asked the chat's graph once for each sub-agent it might let go, reading the graph each time)
test("a prune reads each chat's graph once, however many of its agents it weighs", async () => {
  /** @type {Set<string>} */
  const held = new Set();
  const { registry, reads } = scripted(() => ({ report: "Reported." }), {
    holds: () => {
      reads.holds++;
      return (/** @type {string} */ id) => held.has(id);
    },
  });
  /** @type {string[]} */
  const ids = [];
  for (let i = 1; i <= 101; i++) {
    if (i === 101) reads.holds = 0;
    const r = /** @type {any} */ (registry.launch(LAUNCH(`look ${i}`)));
    assert.ok(r.ok, JSON.stringify(r));
    ids.push(r.id);
    if (i <= 5) held.add(r.id);
    await r.done;
  }
  assert.equal(reads.holds, 1, "the prune at the 101st end: the graph read once for its five held and the one let go");
  assert.deepEqual([...ids.slice(0, 5).map((id) => registry.get(id)?.status), registry.get(ids[5])], ["done", "done", "done", "done", "done", null], "the five the graph holds stay; the next oldest goes");
});

// (fails before: yes — the threads the chat kept were all read and decoded, then those the registry held were passed over)
test("a recall says which threads the registry holds already, so they are not read", async () => {
  /** @type {any} */
  let asked = null;
  const { registry } = scripted(() => ({ report: "Done." }), {
    loadThreads: (/** @type {string} */ _chain, /** @type {any} */ held) => ((asked = held), []),
  });
  const r = /** @type {any} */ (registry.launch(LAUNCH("look")));
  await r.done;
  registry.list("c1");
  assert.equal(typeof asked, "function");
  assert.deepEqual([asked(r.id), asked("sa_0badc0de")], [true, false]);
});

// (fails before: yes — every poll of the chat's agents read each file an apply left marked, whole)
test("a file an apply left marked is read again only once it changed: the row says it still is, then that it is not", () => {
  const repo = mkdtempSync(join(root, "repo-"));
  const file = join(repo, "a.txt");
  writeFileSync(file, "one\n<<<<<<< yours\nmine\n=======\nits\n>>>>>>> its\n");
  const thread = { id: "sa_0000abcd", origin: "owner", may: "edit", asked: false, card: { tag: "helper", name: "Helper", thinks: "", may: "edit" }, team: null, model: "m", seat: null, list: "side", description: "Fix", cwd: repo, mode: null, view: "none", running: false, changes: null, start: null, seen: null, memory: false, deliver: false, aside: false, status: "done", startedAt: 1, shares: null, cut: false, thinking: null, opening: [], exchanges: [{ prompt: "fix", description: "Fix", by: "owner", runId: null, status: "done", startedAt: 1, endedAt: 2, delivery: "held", outcome: { report: "Fixed.", error: null, ms: 1, rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, wrote: true, stoppedBy: null } }], work: { repo, base: "b".repeat(40), head: "h".repeat(40), files: [], applied: [{ at: 5, files: 1, by: "you", came: { markers: ["a.txt"] } }] } };
  const { registry } = scripted(() => ({ report: "" }), { loadThreads: () => [/** @type {any} */ (thread)] });
  const real = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = /** @type {any} */ ((/** @type {any} */ p, /** @type {any[]} */ ...rest) => (String(p) === file && reads++, /** @type {any} */ (real)(p, ...rest)));
  syncBuiltinESMExports();
  try {
    const marked = () => registry.list("c1").find((s) => s.id === thread.id)?.work?.lastApplied?.marked || [];
    assert.deepEqual(marked(), ["a.txt"]);
    assert.equal(reads, 1);
    for (let i = 0; i < 3; i++) assert.deepEqual(marked(), ["a.txt"]);
    assert.equal(reads, 1, "unchanged: read once for every poll");
    writeFileSync(file, "one\nmine and its\n");
    assert.deepEqual(marked(), [], "its markers gone: read again, and said");
    assert.equal(reads, 2);
  } finally {
    fs.readFileSync = real;
    syncBuiltinESMExports();
  }
});

// (fails before: no — a guard: a card's prompt is kept with its exchange, and must stay what redacting the whole prompt,
// then cutting it, says — a secret across the cut included, whose redaction moves where the cut falls)
test("a card's prompt is its prompt redacted, then cut to the card, poll after poll", async () => {
  const key = `sk-ant-${"a".repeat(40)}`;
  const long = `${"x".repeat(3990)} ${key} and more ${"y".repeat(200)}`;
  const { registry } = scripted(() => ({ report: "Done." }));
  const r = /** @type {any} */ (registry.launch(LAUNCH(long)));
  await r.done;
  const card = () => registry.list("c1").find((s) => s.id === r.id)?.exchanges[0].prompt;
  assert.equal(card(), cut(redactSecrets(long), 4000));
  assert.ok(!String(card()).includes(key));
  assert.equal(card(), card());
  assert.equal(registry.detail(r.id)?.exchanges[0].prompt, redactSecrets(long), "the whole form: redacted, never cut");
});
