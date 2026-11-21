// @ts-check
// Envelopes, the registry's part (HarnessV4_Envelopes_Plan EN1): another agent's result that reaches a loop at work is
// taken sealed — one line in its sender's words, its report kept with the session until the loop opens it, oldest
// first — and a loop that waits gets what it left sealed opened first, then what arrived. Never sealed: the developer's
// own Send, a paused launch's report, the graph's and Filament's own words; a session set to whole gets everything whole.
// The sealed ones are kept through a restart, numbered on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { createSubagentRegistry, subjectOf, sealedListText, SUBJECT_CHARS } from "../src/app/agent/subagents.js";
import { PROMPT, PROMPT_VERSION } from "../src/app/agent/prompt.js";
import { until } from "./helpers/wait.js";

const root = tmpdir();
/** @param {any[]} content @param {string | null} [id] */
const reply = (content, id = null) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id, upstream: "m", retryAfter: null, shouldRetry: null });

/**
 * A registry whose host is scripted: each launch is served as turn.js serves one — attach, then finish before the
 * reply — with the report `serve` gives. `store`: what the session keeps of its messages, shared by registries made on
 * it, as a restart's next process reads them; `envelopes`: the session's `subagents.envelopes`.
 * @param {(o: { body: any, n: number }) => Promise<{ report: string, spentUsd?: number }> | { report: string, spentUsd?: number }} serve
 * @param {{ store?: Map<string, any[]>, envelopes?: string }} [o]
 */
function scripted(serve, { store = new Map(), envelopes } = {}) {
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    now: Date.now,
    context: {
      settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }], ...(envelopes ? { envelopes } : {}) }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: root, model: "m", projectId: "p1" }),
      view: async () => ({ text: "User: fix the cache\nAssistant: On it.", turns: 1 }),
      brief: async () => null,
      modelProblem: () => null,
      mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
      saveQueue: (/** @type {string} */ chain, /** @type {any[]} */ list) => void store.set(chain, JSON.parse(JSON.stringify(list))),
      loadQueue: (/** @type {string} */ chain) => store.get(chain) || [],
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      const r = await serve({ body, n });
      registry.finish(id, { status: "done", error: null, report: r.report, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: r.report }] }], rounds: 1, toolCalls: 2, tokensIn: 10, tokensOut: 5, spentUsd: r.spentUsd ?? 0, roundIds: [runId] });
      return reply([{ type: "text", text: r.report }], runId);
    },
  });
  return { registry, store };
}
/** @param {ReturnType<typeof scripted>["registry"]} registry @param {string} [runId] */
const openDoor = (registry, runId = "turn-1") => registry.openTurn({ chainId: "c1", runId, cwd: root, mode: "edit", model: "m", thinking: null, fork: null });
/**
 * The loop's agent call, in the background, and its sub-agent's end. → its id.
 * @param {ReturnType<typeof scripted>["registry"]} registry @param {any} door @param {string} description
 */
const background = async (registry, door, description) => {
  const r = await door.subagents.run({ id: `toolu_${description}`, input: { description, prompt: `do ${description}`, run_in_background: true }, emit: () => {}, signal: null });
  const id = String(/sa_[0-9a-f]{8}/.exec(String(r.text))?.[0]);
  await until(() => registry.get(id)?.status === "done", `${description} to report`);
  return id;
};
const REPORTS = /** @type {Record<string, string>} */ ({ First: "Subject: Two stale keys in cache.js\n\nThe keys at lines 4 and 9 never expire.", Second: "**Subject:** The tests pass\n\nnpm test: 12 passing." });
const byPrompt = ({ body }) => {
  const asked = JSON.stringify(body.messages);
  const name = Object.keys(REPORTS).find((k) => asked.includes(`do ${k}`));
  return { report: name ? REPORTS[name] : "Found it.", spentUsd: name === "First" ? 0.5 : 0 };
};

// (fails before: yes — a report had no subject to say, and the agents were never asked for one)
test("a report's subject is its first line's, bold or not; none is none; and every agent that reports is asked for one (version 43)", () => {
  assert.equal(subjectOf("Subject: Two stale keys in cache.js\n\nmore"), "Two stale keys in cache.js");
  assert.equal(subjectOf("\n\n**Subject:** The tests pass\nnpm test"), "The tests pass");
  assert.equal(subjectOf("subject:   lower case works"), "lower case works");
  // EN-D22 (the drive of 10-24): a team's result is its lead's whole turn — its earlier steps' words, then the final
  // message that starts with its subject. Where the first line is none, the last subject line is the lead's own.
  // (fails before: yes — both Bug Hunter leads of the drive wrote one after a step's words, and Filament's stood in)
  assert.equal(subjectOf("Confirmed — the report is sound. Compiling the final result.\n\nSubject: Two calc.js bugs\n\nBody."), "Two calc.js bugs");
  assert.equal(subjectOf("Hunter A said:\nSubject: its own words\n\nMy result.\n**Subject:** The lead's\nFindings:"), "The lead's", "the last one, where the first line is none");
  assert.equal(subjectOf("Subject: The lead's\nIt quoted:\nSubject: a hunter's"), "The lead's", "the first line wins over a quote further down");
  assert.equal(subjectOf("Found two bugs.\nNo subject here."), "");
  assert.equal(subjectOf(""), "");
  const long = subjectOf(`Subject: ${"x".repeat(300)}`);
  assert.deepEqual([long.length, long.endsWith("…")], [SUBJECT_CHARS, true]);
  assert.ok(PROMPT_VERSION >= 43, "the subject lines came in version 43");
  for (const k of /** @type {const} */ (["subagentReport", "workerReport"])) assert.match(PROMPT[k], /Start it with one line, "Subject: " and what you found or did in under 20 words/, k);
  assert.match(PROMPT.cardAnswer, /its first line "Subject: " and your verdict or your result in under 20 words/);
});

// (fails before: yes — every result reached the loop whole, whatever it was doing)
test("a loop at work takes its background sub-agents' reports sealed: a line each in its sender's words, the reports kept until it opens them, oldest first", async () => {
  const { registry } = scripted(byPrompt);
  const door = openDoor(registry);
  const one = await background(registry, door, "First");
  const two = await background(registry, door, "Second");
  const taken = door.inbox.take({ seal: true });
  assert.deepEqual(taken.map((t) => [t.kind, t.from, t.envelope]), [["envelope", one, 1], ["envelope", two, 2]]);
  assert.equal(taken[0].text, `[Filament: envelope 1, sealed — from your background sub-agent ${one} ("First"): Two stale keys in cache.js. Finish what you are doing first, then open it with Filament's envelope tool when you reach a stopping point. Envelopes open oldest first; 2 are sealed now.]`);
  assert.match(taken[1].text, /^\[Filament: envelope 2, sealed — from your background sub-agent sa_[0-9a-f]{8} \("Second"\): The tests pass\. /);
  assert.equal(taken[0].spentUsd, 0.5, "its spend counts on the turn that took it, as it is taken");
  assert.deepEqual(door.inbox.sealed().map((e) => [e.n, e.from, e.subject]), [[1, one, "Two stale keys in cache.js"], [2, two, "The tests pass"]]);
  assert.deepEqual(registry.envelopes("c1"), door.inbox.sealed());
  const [first] = door.inbox.open();
  assert.deepEqual([first.kind, first.opened, first.envelope, first.spentUsd], ["report", true, 1, 0], "opened whole; its spend was counted at its sealing");
  assert.match(first.text, /Its report:\nSubject: Two stale keys in cache\.js\n\nThe keys at lines 4 and 9 never expire\./);
  assert.deepEqual(door.inbox.open({ all: true }).map((t) => t.envelope), [2]);
  assert.deepEqual([door.inbox.open().length, door.inbox.sealed().length], [0, 0]);
  door.close();
});

test("the list of the sealed ones, a line each, for a turn's start and after a compaction", () => {
  assert.equal(sealedListText([]), "");
  assert.equal(
    sealedListText([
      { n: 2, from: "sa_1", description: "First", sender: 'your background sub-agent sa_1 ("First")', subject: "Two stale keys" },
      { n: 3, from: "sa_2", description: "Second", sender: 'your background sub-agent sa_2 ("Second")', subject: "The tests pass." },
    ]),
    '[Filament: 2 envelopes are still sealed, oldest first:\n- envelope 2, from your background sub-agent sa_1 ("First"): Two stale keys.\n- envelope 3, from your background sub-agent sa_2 ("Second"): The tests pass.\nOpen them with Filament\'s envelope tool when you reach a stopping point.]',
  );
});

// (fails before: yes — nothing was ever sealed, so nothing opened)
test("a loop that waits gets what it left sealed opened first, oldest first, then what arrived", async () => {
  const { registry } = scripted(byPrompt);
  const door = openDoor(registry);
  const one = await background(registry, door, "First");
  assert.equal(door.inbox.take({ seal: true })[0].kind, "envelope");
  const two = await background(registry, door, "Second");
  const waited = door.inbox.take();
  assert.deepEqual(waited.map((t) => [t.from, t.kind, !!t.opened]), [[one, "report", true], [two, "report", false]]);
  assert.deepEqual(door.inbox.sealed(), []);
  door.close();
});

// (fails before: no — a guard: these were whole before and stay whole)
test("never sealed: the developer's own Send, a paused launch's report, the graph's and Filament's own words", async () => {
  const { registry } = scripted(() => ({ report: "Subject: mine\n\nbody" }));
  const aside = await registry.launch({ origin: "owner", chainId: "c1", prompt: "look aside", deliver: false });
  await (aside.ok && aside.done);
  const door = openDoor(registry);
  assert.deepEqual(registry.send(aside.ok ? aside.id : "", "c1"), { ok: true, into: "turn" });
  const paused = await registry.launch({ origin: "owner", chainId: "c1", prompt: "hold me", pause: true });
  await (paused.ok && paused.done);
  registry.tell("c1", { text: "[Filament: t1 is done]", from: "", description: "the task graph", spends: [], wrote: false });
  registry.notice("c1", { text: "[Filament: the flow started]", description: "the flow" });
  const taken = door.inbox.take({ seal: true });
  assert.deepEqual(taken.map((t) => [t.kind, !!t.sent]), [["report", true], ["report", false], ["task", false], ["notice", false]]);
  assert.match(taken[1].text, /paused your work/);
  assert.deepEqual(door.inbox.sealed(), []);
  door.close();
});

// (fails before: yes — the developer's launch alongside reached the loop whole)
test("the developer's launch alongside the working loop is sealed too, and says so; one with no subject line gets Filament's", async () => {
  const { registry } = scripted(() => ({ report: "Found it." }));
  const door = openDoor(registry);
  const r = await registry.launch({ origin: "owner", chainId: "c1", prompt: "look around", description: "Look" });
  await (r.ok && r.done);
  const [t] = door.inbox.take({ seal: true });
  assert.equal(t.text, `[Filament: envelope 1, sealed — from the developer's sub-agent ${r.ok ? r.id : ""} ("Look"), which ran alongside you: it wrote no subject line; it finished. Finish what you are doing first, then open it with Filament's envelope tool when you reach a stopping point. Envelopes open oldest first; this is the one sealed now.]`);
  door.close();
});

// (fails before: no — a guard: the switch's other side is how it was)
test("a session set to whole takes every result whole, as before", async () => {
  const { registry } = scripted(byPrompt, { envelopes: "whole" });
  const door = openDoor(registry);
  await background(registry, door, "First");
  const [t] = door.inbox.take({ seal: true });
  assert.deepEqual([t.kind, door.inbox.sealed().length], ["report", 0]);
  assert.match(t.text, /Two stale keys in cache\.js/);
  door.close();
});

// (fails before: yes — nothing was sealed to keep)
test("the sealed ones are kept through a restart, in their order, and numbering goes on from them", async () => {
  const store = new Map();
  const before = scripted(byPrompt, { store });
  const door = openDoor(before.registry);
  await background(before.registry, door, "First");
  await background(before.registry, door, "Second");
  door.inbox.take({ seal: true });
  door.close();
  const after = scripted(() => ({ report: "Subject: third\n\nbody" }), { store });
  assert.deepEqual(after.registry.envelopes("c1").map((e) => [e.n, e.subject]), [[1, "Two stale keys in cache.js"], [2, "The tests pass"]]);
  const next = openDoor(after.registry, "turn-2");
  const r = await after.registry.launch({ origin: "owner", chainId: "c1", prompt: "a third", description: "Third" });
  await (r.ok && r.done);
  assert.deepEqual(next.inbox.take({ seal: true }).map((t) => [t.kind, t.envelope]), [["envelope", 3]]);
  assert.match(next.inbox.open()[0].text, /Two stale keys in cache\.js/, "the oldest opens first, across the restart");
  next.close();
});

// (fails before: yes — a coding agent's unheard take had no envelopes to keep)
test("a take its agent never heard: an envelope's line leaves it sealed where it is, one opened goes back to the front", async () => {
  const { registry } = scripted(byPrompt);
  const door = openDoor(registry);
  await background(registry, door, "First");
  await background(registry, door, "Second");
  const lines = door.inbox.take({ seal: true });
  door.inbox.back(lines);
  assert.deepEqual([door.inbox.sealed().map((e) => e.n), door.inbox.take({ seal: true }).length], [[1, 2], 0], "nothing back in the inbox: the line is said again with the list");
  const opened = door.inbox.open();
  door.inbox.back(opened);
  assert.deepEqual(door.inbox.sealed().map((e) => e.n), [1, 2], "sealed again, in its place");
  door.close();
});

// (fails before: yes — a restart's notice of a cut agent reached the loop whole)
test("a restart's notice of an agent it cut is a result too: sealed, in Filament's subject", () => {
  const { registry } = scripted(() => ({ report: "x" }));
  const brief = { agentId: "sa_0badf0a1", exchange: 0, description: "Cache audit", task: "audit the cache", by: "agent", deliver: true };
  assert.equal(registry.orphaned({ runId: "r9", chainId: "c1", brief, rounds: 2 }), true);
  const door = openDoor(registry);
  const [t] = door.inbox.take({ seal: true });
  assert.equal(t.text, '[Filament: envelope 1, sealed — from sub-agent sa_0badf0a1 ("Cache audit"): it was cut by a Filament restart before it finished. Finish what you are doing first, then open it with Filament\'s envelope tool when you reach a stopping point. Envelopes open oldest first; this is the one sealed now.]');
  assert.equal(registry.orphaned({ runId: "r9", chainId: "c1", brief, rounds: 2 }), false, "told once, sealed or not");
  door.close();
});
