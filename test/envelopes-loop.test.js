// @ts-check
// Envelopes in Filament's loop (HarnessV4_Envelopes_Plan EN2): another agent's result that lands while the loop works
// reaches the model as one line, its report kept with the session; the agent opens it with its envelope tool, oldest
// first. What lands while it waits — its wait, its turn's end for its own agents — comes opened, the older sealed ones
// first. A turn that would end with some still sealed is told once; the next turn and a compaction list them again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { openedText, sealedListText, sealedReminder } from "../src/app/agent/envelopes.js";
import { ENVELOPE, FORK_REFUSALS, SUBAGENT_OFF, leadToolSetFor, toolSetFor } from "../src/app/agent/tools.js";
import { PROMPT_VERSION, TOOL_TEXT } from "../src/app/agent/prompt.js";
import { reattachBlock } from "../src/app/sessions/reattach.js";
import { SKILL_TOOL } from "../src/app/agent/skills.js";
import { until } from "./helpers/wait.js";

const root = tmpdir();
const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
/** @param {any[]} content @param {string | null} [id] */
const reply = (content, id = null) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id, upstream: "m", retryAfter: null, shouldRetry: null });
const sink = () => ({ blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } });
/** The text blocks of a message, in order. @param {any} m @returns {string[]} */
const textsOf = (m) => (typeof m?.content === "string" ? [m.content] : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text));
/** A tool result's words in a message. @param {any} m @param {string} id */
const resultOf = (m, id) => String((m?.content || []).find((/** @type {any} */ b) => b?.type === "tool_result" && b.tool_use_id === id)?.content ?? "");
const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

const REPORTS = /** @type {Record<string, string>} */ ({
  First: "Subject: Two stale keys in cache.js\n\nThe keys at lines 4 and 9 never expire.",
  Second: "**Subject:** The tests pass\n\nnpm test: 12 passing.",
});
/**
 * A registry whose sub-agents report when their gate opens: First and Second, by their prompt.
 * @param {{ envelopes?: string, store?: Map<string, any[]> }} [o]
 */
function scripted({ envelopes, store = new Map() } = {}) {
  const gates = { First: deferred(), Second: deferred() };
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
      const asked = JSON.stringify(body.messages);
      const name = /** @type {"First" | "Second"} */ (Object.keys(REPORTS).find((k) => asked.includes(`do ${k}`)));
      await gates[name].promise;
      const report = REPORTS[name];
      registry.finish(id, { status: "done", error: null, report, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: report }] }], rounds: 1, toolCalls: 2, tokensIn: 10, tokensOut: 5, spentUsd: name === "First" ? 0.5 : 0, roundIds: [runId] });
      return reply([{ type: "text", text: report }], runId);
    },
  });
  /** The sub-agent of that description, done. @param {"First" | "Second"} name */
  const report = async (name) => {
    gates[name].resolve();
    await until(() => registry.list("c1").find((s) => s.description === name)?.status === "done", `${name} to report`);
  };
  return { registry, report, store };
}
/** The loop's background launch of First, of Second, or both. @param {...string} names */
const launch = (...names) => names.map((n, i) => toolUse(`a${i + 1}`, "agent", { description: n, prompt: `do ${n}`, run_in_background: true }));

/**
 * One turn of the session's loop over the registry's door, its replies scripted by `script(n, body)`.
 * @param {ReturnType<typeof scripted>["registry"]} registry @param {(n: number, body: any) => Promise<any[]> | any[]} script
 * @param {{ runId?: string, messages?: any[], over?: Record<string, any> }} [o]
 */
async function turn(registry, script, { runId = "turn-1", messages = [{ role: "user", content: "fix the cache" }], over = {} } = {}) {
  const door = registry.openTurn({ chainId: "c1", runId, cwd: root, mode: "edit", model: "m", thinking: null, fork: null });
  /** @type {any[]} */
  const calls = [];
  /** @type {any[]} */
  const events = [];
  const out = await runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
    model: "m",
    root,
    readerModel: "",
    maxTokens: 100,
    thinking: null,
    costOf: () => 0,
    runHand: async (/** @type {string} */ name) => `${name} ran`,
    delegateRead: null,
    permissions: null,
    rules: [],
    hooks: null,
    mcpReadOnly: new Set(),
    previewChars: 200,
    messages,
    system: "launcher",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "edit",
    subagents: door.subagents,
    inbox: door.inbox,
    mailbox: null,
    tree: null,
    onEvent: (/** @type {any} */ e) => events.push(e),
    sink: sink(),
    signal: null,
    resume: null,
    call: async (/** @type {any} */ { body }) => {
      calls.push(structuredClone(body));
      return reply(await script(calls.length, body));
    },
    ...over,
  }));
  door.close();
  return { out, calls, events };
}

// (fails before: yes — the report reached the working loop whole, and there was no envelope tool)
test("a report that lands while the loop works comes as one line; the envelope tool opens it whole, and its spend is the turn's", async () => {
  const s = scripted();
  const { out, calls, events } = await turn(s.registry, async (n) => {
    if (n === 1) return launch("First");
    if (n === 2) {
      await s.report("First");
      return [toolUse("r1", "read", { path: "cache.js" })];
    }
    if (n === 3) return [toolUse("e1", ENVELOPE, {})];
    return [{ type: "text", text: "Done." }];
  });
  assert.equal(out.status, "done", JSON.stringify(out.notes));
  const atWork = calls[2].messages.at(-1);
  assert.equal(resultOf(atWork, "r1"), "read ran");
  const [line] = textsOf(atWork);
  assert.match(line, /^\[Filament: envelope 1, sealed — from your background sub-agent sa_[0-9a-f]{8} \("First"\): Two stale keys in cache\.js\. Finish what you are doing first/);
  assert.doesNotMatch(JSON.stringify(calls[2].messages), /never expire/, "the report stays out of the conversation until it is opened");
  const opened = resultOf(calls[3].messages.at(-1), "e1");
  assert.match(opened, /^\[Filament: envelope 1, opened — from your background sub-agent sa_[0-9a-f]{8} \("First"\)\]\n\[Filament: your background sub-agent sa_[0-9a-f]{8} \("First"\) finished\./);
  assert.match(opened, /The keys at lines 4 and 9 never expire\./);
  assert.match(opened, /\[Filament: one envelope opened\. None is sealed now\.\]$/);
  assert.equal(out.totals.spentUsd, 0.5, "counted as it was sealed, once");
  const sealed = events.find((e) => e.type === "envelope-sealed");
  // Its number rides `envelope`: the run log numbers each event `n` (test/envelopes-coder.test.js reads it there).
  assert.deepEqual([sealed?.envelope, sealed?.round, sealed?.subject, sealed?.description], [1, 2, "Two stale keys in cache.js", "First"]);
  assert.ok(!events.some((e) => e.type === "subagent-report" && e.round === 2), "no report reached the conversation at its sealing");
  const open = events.find((e) => e.type === "envelope-opened");
  assert.deepEqual([open?.envelope, open?.by, open?.id, open?.round], [1, "tool", "e1", 3]);
  assert.ok(events.some((e) => e.type === "subagent-report" && e.round === 3 && e.envelope === 1), "it reached the conversation as it was opened");
  assert.deepEqual(s.registry.envelopes("c1"), []);
  assert.ok(!events.some((e) => e.type === "envelope-reminder"), "nothing was left sealed to remind of");
});

// (fails before: yes — nothing was sealed, so a wait had nothing older to open first)
test("a wait opens what is sealed, oldest first, then the report that ended it; the wait says they follow", async () => {
  const s = scripted();
  const { out, calls, events } = await turn(s.registry, async (n) => {
    if (n === 1) return launch("First", "Second");
    if (n === 2) {
      await s.report("First");
      return [toolUse("r1", "read", { path: "cache.js" })];
    }
    if (n === 3) {
      setTimeout(() => void s.report("Second"), 50);
      return [toolUse("w1", "wait", { seconds: 30 })];
    }
    return [{ type: "text", text: "Both read." }];
  });
  assert.equal(out.status, "done", JSON.stringify(out.notes));
  assert.match(textsOf(calls[2].messages.at(-1))[0], /^\[Filament: envelope 1, sealed/);
  const after = calls[3].messages.at(-1);
  assert.match(resultOf(after, "w1"), /^Waited \d+ s: a sub-agent reported\. Its report follows as a message\. The envelope still sealed follows, opened, oldest first\.$/);
  const [first, second] = textsOf(after);
  assert.match(first, /^\[Filament: envelope 1, opened — from your background sub-agent sa_[0-9a-f]{8} \("First"\)\]\n[\s\S]*never expire/);
  assert.match(second, /^\[Filament: your background sub-agent sa_[0-9a-f]{8} \("Second"\) finished\.[\s\S]*12 passing/, "the report that ended the wait comes whole, after it");
  assert.deepEqual(events.filter((e) => e.type === "envelope-opened").map((e) => [e.envelope, e.by]), [[1, "wait"]]);
});

// (fails before: yes — the same: a report at the turn's end came whole, and nothing older was sealed)
test("at the turn's end the loop waits for its own agents: what is sealed opens first, then what came, and no reminder is owed", async () => {
  const s = scripted();
  const { out, calls, events } = await turn(s.registry, async (n) => {
    if (n === 1) return launch("First", "Second");
    if (n === 2) {
      await s.report("First");
      return [toolUse("r1", "read", { path: "cache.js" })];
    }
    if (n === 3) {
      setTimeout(() => void s.report("Second"), 50);
      return [{ type: "text", text: "I'll wait for the second." }];
    }
    return [{ type: "text", text: "Both read." }];
  });
  assert.equal(out.status, "done");
  assert.equal(calls.length, 4);
  const texts = textsOf(calls[3].messages.at(-1));
  assert.deepEqual([texts.length, /envelope 1, opened/.test(texts[0]), /\("Second"\) finished/.test(texts[1])], [2, true, true]);
  assert.ok(!events.some((e) => e.type === "envelope-reminder"));
  assert.deepEqual(s.registry.envelopes("c1"), []);
});

// (fails before: yes — the bug hunt of 11-04 on letters: a letter that ended the agent's wait was said as "a sub-agent
// reported. Its report follows", whether it waited when the wait began or came during it)
test("a letter that ends a wait is said as a letter, one waiting as the wait begins or one that comes during it", async () => {
  const s = scripted();
  const letter = (/** @type {string} */ subject) => s.registry.letter("c1", { text: "Please confirm: is 7 prime?", from: "a", description: "Cheap model", sender: 'the chat "Cheap model" (a)', subject });
  const { out, calls } = await turn(s.registry, async (n) => {
    if (n === 1) return launch("First");
    if (n === 2) {
      letter("Waiting already");
      return [toolUse("w1", "wait", { seconds: 30 })];
    }
    if (n === 3) {
      setTimeout(() => letter("Came meanwhile"), 50);
      return [toolUse("w2", "wait", { seconds: 30 })];
    }
    if (n === 4) await s.report("First");
    return [{ type: "text", text: "Done." }];
  });
  assert.equal(out.status, "done", JSON.stringify(out.notes));
  for (const [i, id, subject] of /** @type {const} */ ([[2, "w1", "Waiting already"], [3, "w2", "Came meanwhile"]])) {
    const after = calls[i].messages.at(-1);
    assert.match(resultOf(after, id), /^Waited \d+ s: a letter came\. It follows as a message\.$/, id);
    assert.match(textsOf(after)[0], new RegExp(`^\\[Filament: envelope ${i - 1}, sealed — from the chat "Cheap model" \\(a\\): ${subject}\\.`), "its envelope's line");
  }
});

// (fails before: yes — the first version of EN2 sealed a report that landed as the last reply was written, and reminded
// the agent of it — the agent that had just said it was waiting for it: subagents.test.js, lead-asked.test.js)
test("a result that lands as the turn would end, with nothing left to wait for, comes opened, the sealed ones ahead of it", async () => {
  const s = scripted();
  const { out, calls, events } = await turn(s.registry, async (n) => {
    if (n === 1) return launch("First", "Second");
    if (n === 2) {
      await s.report("First");
      return [toolUse("r1", "read", { path: "cache.js" })];
    }
    if (n === 3) {
      await s.report("Second");
      return [{ type: "text", text: "That is all for now." }];
    }
    return [{ type: "text", text: "Both read." }];
  });
  assert.equal(out.status, "done");
  const texts = textsOf(calls[3].messages.at(-1));
  assert.equal(texts.length, 2, texts.join("\n---\n"));
  assert.match(texts[0], /^\[Filament: envelope 1, opened/);
  assert.match(texts[1], /^\[Filament: your background sub-agent sa_[0-9a-f]{8} \("Second"\) finished\.[\s\S]*12 passing/);
  assert.ok(!events.some((e) => e.type === "envelope-reminder"));
});

// (fails before: yes — nothing was sealed to say)
test("a turn that would end with one still sealed is told once, then ends; the next turn opens with the developer's words, then the list", async () => {
  const s = scripted();
  const first = await turn(s.registry, async (n) => {
    if (n === 1) return launch("First");
    if (n === 2) {
      await s.report("First");
      return [toolUse("r1", "read", { path: "cache.js" })];
    }
    return [{ type: "text", text: n === 3 ? "All done." : "It can wait." }];
  });
  assert.equal(first.out.status, "done");
  assert.equal(first.calls.length, 4, "one more round for the reminder, and no second");
  const list = s.registry.envelopes("c1");
  assert.deepEqual(list.map((e) => e.n), [1], "still sealed, with the session");
  assert.deepEqual(textsOf(first.calls[3].messages.at(-1)), [sealedReminder(list)]);
  assert.match(sealedReminder(list), /^\[Filament: one envelope is still sealed \(envelope 1, from your background sub-agent sa_[0-9a-f]{8} \("First"\): Two stale keys in cache\.js\): open it now with Filament's envelope tool, or end your turn and it waits for your next one\.\]$/);
  assert.deepEqual(first.events.filter((e) => e.type === "envelope-reminder").map((e) => e.envelopes), [[1]]);
  const next = await turn(s.registry, () => [{ type: "text", text: "On the next task." }], { runId: "turn-2", messages: [{ role: "user", content: "now the parser" }] });
  assert.deepEqual(textsOf(next.calls[0].messages.at(-1)), ["now the parser", sealedListText(list)]);
  assert.deepEqual(next.events.filter((e) => e.type === "envelope-list").map((e) => [e.envelopes, e.at]), [[[1], "start"]]);
  assert.deepEqual(s.registry.envelopes("c1").map((e) => e.n), [1], "none opened for it");
});

// (fails before: yes — the fold took the line, and nothing said it again)
test("after a compaction the sealed ones are listed again, after the summary", async () => {
  const s = scripted();
  let n = 0;
  let asked = false;
  const { out, calls, events } = await turn(
    s.registry,
    async (k) => {
      n = k;
      if (k === 1) return launch("First");
      if (k === 2) {
        await s.report("First");
        return [toolUse("r1", "read", { path: "cache.js" })];
      }
      if (k === 3) return [toolUse("r2", "read", { path: "keys.js" })];
      if (k === 4) return [toolUse("e1", ENVELOPE, { all: true })];
      return [{ type: "text", text: "Done." }];
    },
    {
      over: {
        compact: { usable: 1e9, target: 0, window: 1e9, source: null, fixed: 0, summarize: async () => ({ text: "SUMMARY OF ROUNDS 1-2", by: "m" }), reattach: (/** @type {any} */ o) => reattachBlock({ ...o, root: "", rules: [], redact: null, window: 200_000 }) },
        mailbox: { read: () => (n === 3 && !asked ? ((asked = true), [{ kind: "compact", text: "", from: "harness" }]) : []) },
      },
    },
  );
  assert.equal(out.status, "done", JSON.stringify(out.notes));
  const head = calls[3].messages.find((/** @type {any} */ m) => m.role === "user" && /^\[Filament compacted round/.test(String(m.content?.[0]?.text || "")));
  assert.ok(head, "the fold's head");
  const said = String(head.content.at(-1)?.text || "");
  assert.match(said, /^\[Filament: one envelope is still sealed, oldest first:\n- envelope 1, from your background sub-agent sa_[0-9a-f]{8} \("First"\): Two stale keys in cache\.js\.\nOpen it with Filament's envelope tool/);
  assert.deepEqual(events.find((e) => e.type === "compaction")?.attached?.envelopes, [1]);
  assert.match(resultOf(calls[4].messages.at(-1), "e1"), /never expire/, "and it opens after the fold");
});

// (fails before: yes — the review of 11-09: the fold named the files, the plan and what was open, never a letter the
// folded rounds opened that asked no reply, which the summary could lose)
test("a letter the folded rounds opened is handed to the block after the fold, by its id, sender and subject", async () => {
  const s = scripted();
  const sender = 'the chat "Ops" (c_ops)';
  const opened = openedText(/** @type {any} */ ({ envelope: 3, sender, from: "", description: "", text: `the deploy is green\n\n[Filament: letter lt_aa11, from ${sender}. It asks for no reply.]` }));
  let n = 0;
  let asked = false;
  /** @type {any[]} */
  const handed = [];
  const { out, calls } = await turn(
    s.registry,
    async (k) => {
      n = k;
      if (k === 1) return [toolUse("r1", "read", { path: "mail" })];
      if (k === 2) return [toolUse("r2", "read", { path: "cache.js" })];
      if (k === 3) return [toolUse("r3", "read", { path: "keys.js" })];
      return [{ type: "text", text: "Done." }];
    },
    {
      over: {
        runHand: async (/** @type {string} */ name, /** @type {any} */ input) => (input?.path === "mail" ? opened : `${name} ran`),
        compact: {
          usable: 1e9, target: 0, window: 1e9, source: null, fixed: 0,
          summarize: async () => ({ text: "SUMMARY OF ROUNDS 1-2", by: "m" }),
          reattach: (/** @type {any} */ o) => {
            handed.push(o.letters);
            return reattachBlock({ ...o, letters: (o.letters || []).map((/** @type {any} */ l) => ({ ...l, turn: 7 })), root: "", rules: [], redact: null, window: 200_000 });
          },
        },
        mailbox: { read: () => (n === 3 && !asked ? ((asked = true), [{ kind: "compact", text: "", from: "harness" }]) : []) },
      },
    },
  );
  assert.equal(out.status, "done", JSON.stringify(out.notes));
  assert.deepEqual(handed, [[{ id: "lt_aa11", from: sender, subject: "" }]]);
  const head = calls[3].messages.find((/** @type {any} */ m) => m.role === "user" && /^\[Filament compacted round/.test(String(m.content?.[0]?.text || "")));
  assert.match(String(head?.content.at(-1)?.text || ""), /\n\n<letters>\n- letter lt_aa11, from the chat "Ops" \(c_ops\), opened in turn 7 — it asked no reply/);
});

// (fails before: yes — c-compact's of 11-10: the fold handed back no skill the folded rounds loaded, whose text went with
// them, so the agent followed one it could no longer read; a summary of the turns names them, the fold did not)
test("a skill the folded rounds loaded is handed to the block after the fold by its name, once; one the kept rounds loaded again is not", async () => {
  const s = scripted();
  let n = 0;
  let asked = false;
  /** @type {any[]} */
  const handed = [];
  const { out, calls } = await turn(
    s.registry,
    async (k) => {
      n = k;
      if (k === 1) return [toolUse("s1", "skill", { name: "pdf" }), toolUse("s2", "skill", { name: "Deploy" })];
      if (k === 2) return [toolUse("s3", "skill", { name: "pdf", action: "list" }), toolUse("s4", "skill", { name: "deploy" })];
      if (k === 3) return [toolUse("r3", "read", { path: "keys.js" }), toolUse("s5", "skill", { name: "Deploy" })];
      return [{ type: "text", text: "Done." }];
    },
    {
      over: {
        // The skill tool, offered as turn.js offers it where skills are listed; its loads answered by the hands.
        tools: [...toolSetFor({ delegateRead: false }), SKILL_TOOL],
        runHand: async (/** @type {string} */ name, /** @type {any} */ input) => (name === "skill" ? `[skill ${input?.name} loaded]` : `${name} ran`),
        compact: {
          usable: 1e9, target: 0, window: 1e9, source: null, fixed: 0,
          summarize: async () => ({ text: "SUMMARY OF ROUNDS 1-2", by: "m" }),
          reattach: (/** @type {any} */ o) => {
            handed.push(o.skills);
            return reattachBlock({ ...o, skills: (o.skills || []).map((/** @type {string} */ name) => ({ name, turn: 7 })), root: "", rules: [], redact: null, window: 200_000 });
          },
        },
        mailbox: { read: () => (n === 3 && !asked ? ((asked = true), [{ kind: "compact", text: "", from: "harness" }]) : []) },
      },
    },
  );
  assert.equal(out.status, "done", JSON.stringify(out.notes));
  assert.deepEqual(handed, [["pdf"]], "deploy was loaded again in the kept round; a look in pdf's folder loads nothing");
  const head = calls[3].messages.find((/** @type {any} */ m) => m.role === "user" && /^\[Filament compacted round/.test(String(m.content?.[0]?.text || "")));
  assert.match(String(head?.content.at(-1)?.text || ""), /\n\n<skills>\n- pdf \(turn 7\)\n<\/skills>/);
});

// (fails before: yes — the re-review of 11-11, finding 4: a fold at the overflow door handed back no skill, so the agent
// went on following one whose text went with the folded rounds; and the block gave a skill no line without a turn)
test("a fold after a size refusal hands back the skill the folded rounds loaded; one handed back with no turn is named alone", async () => {
  const s = scripted();
  /** @type {any[]} */
  const handed = [];
  /** @type {any[]} */
  const sent = [];
  let refused = false;
  const { out } = await turn(s.registry, async () => [], {
    over: {
      tools: [...toolSetFor({ delegateRead: false }), SKILL_TOOL],
      runHand: async (/** @type {string} */ name, /** @type {any} */ input) => (name === "skill" ? `[skill ${input?.name} loaded]` : `${name} ran`),
      compact: {
        usable: 1e9, target: 0, window: 1e9, source: null, fixed: 0,
        summarize: async () => ({ text: "SUMMARY OF ROUND 1", by: "m" }),
        reattach: (/** @type {any} */ o) => {
          handed.push(o.skills);
          return reattachBlock({ ...o, skills: (o.skills || []).map((/** @type {string} */ name) => ({ name })), root: "", rules: [], redact: null, window: 200_000 });
        },
      },
      // Four rounds of work, the first loading a skill; the fifth request is refused for size, once.
      call: async (/** @type {any} */ { body }) => {
        sent.push(structuredClone(body));
        const n = sent.length;
        if (n === 1) return reply([toolUse("s1", "skill", { name: "pdf" })]);
        if (n <= 4) return reply([toolUse(`r${n}`, "read", { path: `f${n}.js` })]);
        if (!refused) {
          refused = true;
          return { ok: false, status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 250000 tokens > 200000 maximum" } }, id: null, upstream: "m", retryAfter: null, shouldRetry: null };
        }
        return reply([{ type: "text", text: "Done." }]);
      },
    },
  });
  assert.equal(out.status, "done", JSON.stringify(out.notes));
  assert.deepEqual(handed, [["pdf"]], "the round that loaded it was folded");
  const head = sent.at(-1).messages.find((/** @type {any} */ m) => m.role === "user" && /^\[Filament compacted round/.test(String(m.content?.[0]?.text || "")));
  assert.match(String(head?.content.at(-1)?.text || ""), /\n\n<skills>\n- pdf\n<\/skills>/);
});

// The owner's of 11-09 (d1): an envelope that lands right before Filament compacts the chat between turns — its summary,
// or its fold of the turns — is never forgotten: it stays sealed with the session, and the next turn's first request
// lists it, whatever the compaction left of the turns that heard its line.
for (const [kind, messages] of /** @type {[string, any[]][]} */ ([
  ["Filament's summary", [{ role: "user", content: "SUMMARY OF TURNS 1-3\n\n<open>\n- sub-agent sa_1 (\"First\"): 2 files of its work wait to be applied [agent:sa_1:waits]\n</open>" }, { role: "assistant", content: "Understood." }, { role: "user", content: "now the parser" }]],
  ["Filament's fold of the turns", [{ role: "user", content: "[Filament folded turns 1-3: their words come back with filament_recall]" }, { role: "assistant", content: "Noted." }, { role: "user", content: "now the parser" }]],
])) {
  // (fails before: no — pinned: the list is the registry's, said at each turn's start, which no compaction rewrites)
  test(`an envelope still sealed as ${kind} compacts the chat is listed with the next turn's first request`, async () => {
    const s = scripted();
    await turn(s.registry, async (n) => {
      if (n === 1) return launch("First");
      if (n === 2) {
        await s.report("First");
        return [toolUse("r1", "read", { path: "cache.js" })];
      }
      return [{ type: "text", text: "It can wait." }];
    });
    const list = s.registry.envelopes("c1");
    assert.deepEqual(list.map((e) => e.n), [1]);
    const next = await turn(s.registry, () => [{ type: "text", text: "On it." }], { runId: "turn-2", messages: structuredClone(messages) });
    assert.deepEqual(textsOf(next.calls[0].messages.at(-1)), ["now the parser", sealedListText(list)]);
  });
}

// (fails before: yes — the envelope took no dismiss)
test("the main agent's envelope dismisses lines of what is still open by their ids, in a call of its own; a sub-agent's loop has no list to dismiss from", async () => {
  const s = scripted();
  /** @type {unknown[][]} */
  const asked = [];
  const dismiss = (/** @type {readonly unknown[]} */ ids) => (asked.push([...ids]), { dismissed: ["copies:/r"], unknown: [] });
  const { out, calls } = await turn(
    s.registry,
    async (n) => {
      if (n === 1) return [toolUse("d1", ENVELOPE, { dismiss: ["[copies:/r]"] })];
      if (n === 2) return [toolUse("d2", ENVELOPE, { dismiss: ["copies:/r"], all: true })];
      return [{ type: "text", text: "Done." }];
    },
    { over: { dismiss } },
  );
  assert.equal(out.status, "done");
  assert.deepEqual(asked, [["[copies:/r]"], ["copies:/r"]]);
  assert.equal(resultOf(calls[1].messages.at(-1), "d1"), "Dismissed copies:/r: Filament leaves it out of what is still open until what it names changes.");
  assert.match(resultOf(calls[2].messages.at(-1), "d2"), /The rest of the call was not run: dismiss goes in a call of its own\.$/);
  assert.ok(out.notes.includes("agent: dismissed from what is still open — copies:/r"), JSON.stringify(out.notes));
  const none = await turn(s.registry, async (n) => (n === 1 ? [toolUse("d3", ENVELOPE, { dismiss: ["copies:/r"] })] : [{ type: "text", text: "Done." }]), { runId: "turn-2" });
  assert.match(resultOf(none.calls[1].messages.at(-1), "d3"), /only the chat's main agent has one/);
});

// (fails before: yes — the tool did not exist)
// (fails before: yes for its sub-agent's part — the owner's of 11-04: a sub-agent had no envelope tool, so it wrote the
// agent that launched it no letter, and a fork's was refused)
test("the envelope tool: after wait for a session's agent and a lead; a sub-agent and a fork keep it to write their lead; nothing sealed says so", async () => {
  assert.equal(PROMPT_VERSION, 129);
  assert.match(TOOL_TEXT.envelope, /^Your mailbox: open the results other agents sent you, and write letters\. Unless the chat takes results whole, one that lands while you work shows as one line/);
  const names = toolSetFor({ delegateRead: false }).map((t) => t.name);
  assert.equal(names.indexOf(ENVELOPE), names.indexOf("wait") + 1);
  const lead = leadToolSetFor({ delegateRead: false }).map((t) => t.name);
  assert.equal(lead.indexOf(ENVELOPE), lead.indexOf("wait") + 1);
  assert.ok(toolSetFor({ delegateRead: false, disabled: SUBAGENT_OFF }).some((t) => t.name === ENVELOPE), "a sub-agent writes the agent that launched it");
  assert.equal(/** @type {Record<string, string>} */ (FORK_REFUSALS).envelope, undefined, "and so does a fork");
  const s = scripted();
  const { calls } = await turn(s.registry, (n) => (n === 1 ? [toolUse("e1", ENVELOPE, { count: 2 })] : [{ type: "text", text: "Nothing then." }]));
  assert.equal(resultOf(calls[1].messages.at(-1), "e1"), "No envelope is sealed.");
});

// (fails before: no — a guard: the switch's other side is how it was)
test("a chat set to Whole hears the report whole while it works, as before", async () => {
  const s = scripted({ envelopes: "whole" });
  const { calls, events } = await turn(s.registry, async (n) => {
    if (n === 1) return launch("First");
    if (n === 2) {
      await s.report("First");
      return [toolUse("r1", "read", { path: "cache.js" })];
    }
    return [{ type: "text", text: "Done." }];
  });
  assert.match(textsOf(calls[2].messages.at(-1))[0], /^\[Filament: your background sub-agent sa_[0-9a-f]{8} \("First"\) finished\.[\s\S]*never expire/);
  assert.ok(!events.some((e) => e.type.startsWith("envelope-")));
});
