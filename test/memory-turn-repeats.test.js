// @ts-check
// A turn block says nothing the session has in view already (the memory plan's e2): what its briefing showed, and what an
// earlier turn block, reminder or memory call of the chat showed on a message it still sends. A compaction that took
// that message takes it out of view, and it may be said again. A chat's first message a briefing was built on has the
// turn block's own room: the briefing recalls on the same words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { world } from "./fixtures/memory-world.mjs";
import { idsInView, messageHash, reattachBlocks } from "../src/services/memory/brain.js";
import { MemoryTrace, withTrace } from "../src/services/memory/trace.js";

const PORT = "The api server listens on port 8080 in development.";
/** The text of a request's newest message, memory's blocks with it. @param {any} out */
const newest = (out) => {
  const c = out.r.body.messages.at(-1).content;
  return typeof c === "string" ? c : JSON.stringify(c);
};

// (fails before: yes — the turn block left out only what the briefing showed, so a claim rode every turn that named it)
test("a claim an earlier turn block showed is not said again while that block is in view; once a compaction took its message, it is", () =>
  world({}, async (w) => {
    const other = await w.session("before").send("hello");
    const port = (await w.svc.brain.fileLearned({ projectId: other.prep.project, chainId: other.prep.chain, kind: "fact", text: PORT, importance: 0.7 })).id;
    await w.settle();
    const s = w.session("s1");
    await s.send("hello");
    const asked = await s.send("which port does the api server listen on in development?");
    assert.ok(newest(asked).includes(`[i${port} `), newest(asked));
    // Turn 2's block rides turn 3's request on its message: the claim is in view, and turn 3's block leaves it out.
    const again = await s.send("start the api server on its development port");
    assert.ok(again.seen.includes(`[i${port} `), "turn 2's block is in the history turn 3 sends");
    assert.ok(!newest(again).includes(`[i${port} `), newest(again));
    // A compaction took those turns: the same chat sends its newest message with none of them before it, and the claim
    // is out of view.
    const compacted = w.session("s1");
    const after = await compacted.send("start the api server on its development port, as we said");
    assert.equal(after.prep.chain, asked.prep.chain, "the same chat");
    assert.ok(newest(after).includes(`[i${port} `), newest(after));
  }));

// (fails before: yes — the results a mixed reply left were placed on the person's message after what is in view was read,
// so the turn block beside them said the claim again)
test("a memory call's results that ride the person's message are in view for the turn block beside them", () =>
  world({}, async (w) => {
    const other = await w.session("before").send("hello");
    const port = (await w.svc.brain.fileLearned({ projectId: other.prep.project, chainId: other.prep.chain, kind: "fact", text: PORT, importance: 0.7 })).id;
    await w.settle();
    const s = w.session("s1");
    const first = await s.send("hello");
    const results = JSON.stringify({ results: [{ id: `i${port}`, kind: "fact", text: PORT }] });
    w.svc.brain.setDeferred(first.prep.chain, `Result of filament_memory_search({"query":"api port"}):\n${results}`);
    const asked = await s.send("which port does the api server listen on in development?");
    const text = newest(asked);
    assert.ok(text.includes(`"id":"i${port}"`) || text.includes(`\\"id\\":\\"i${port}\\"`), "the results ride the message");
    assert.ok(!text.includes(`[i${port} `), text);
  }));

// (fails before: yes — idsInView took every "[i<n>" of every block: an erratum's replacement, a claim citing another, a
// loaded session's words; and none of past words, a reminder at the moment of action or a memory call's results)
test("in view: what a line shows at its head and what a memory call's results give, never an id a line only names", () => {
  const turn = [
    "Memory correction: [i10] \"deploy with npm\" no longer holds — now [i11] \"How to deploy: 1. pnpm build …\" (the user, 2026-11-06).",
    "Related memory for this message (Filament; …):",
    "- [i12 fact · inferred · 2026-11-01] The api server listens on 8080; see [i4204] for the proxy.",
    "Words from past sessions (quotes, not checked facts):",
    "- [s:k3f9ab:7 · 2026-10-30] \"start it on 8080\"",
  ].join("\n");
  const rule = ["Memory on the tool call the model just made (Filament):", "- [memory i88 · user said] Never run the migrations on prod.", "Rules from memory that apply to the tool call the model just made (Filament):", "- Ask before a force push."].join("\n");
  const tool = `Result of filament_memory_search({"query":"port"}):\n${JSON.stringify({ results: [{ id: "i45", kind: "fact", text: "…" }, { id: "s:k3f9ab:9", kind: "session", text: "…" }] })}`;
  const load = "- [i5 fact · inferred] a reply's words, quoted in a loaded session";
  const got = idsInView([
    { text: turn, kind: "turn" },
    { text: rule, kind: "rule" },
    { text: tool, kind: "tool" },
    { text: load, kind: "load" },
    { text: "- [i6 fact · inferred] a recall tool's answer in a chat memory leaves out", kind: "recall" },
  ]);
  assert.deepEqual([...got].sort(), ["i12", "i45", "i88", "s:k3f9ab:7", "s:k3f9ab:9"]);
});

// (fails before: yes — reattachBlocks told nothing of what it placed again)
test("reattachBlocks tells what it placed again, a message's results slot too, and nothing a kind it does not place", () => {
  const msgs = [{ role: "user", content: "which port?" }, { role: "assistant", content: "8080" }, { role: "user", content: "start it" }];
  const h = messageHash(msgs[0]);
  const results = JSON.stringify({ results: [{ id: "i45", kind: "fact", text: "…" }] });
  const blocks = { [h]: { text: "- [i12 fact · inferred] 8080", kind: "turn" }, [`${h}#tool`]: { text: results, kind: "tool" } };
  /** @type {{ text: string, kind: string }[]} */
  const placed = [];
  assert.equal(reattachBlocks("anthropic", { messages: structuredClone(msgs) }, blocks, null, null, placed), 2);
  assert.deepEqual(placed.map((b) => b.kind), ["turn", "tool"]);
  assert.deepEqual([...idsInView(placed)].sort(), ["i12", "i45"]);
  /** @type {{ text: string, kind: string }[]} */
  const recallOnly = [];
  reattachBlocks("anthropic", { messages: structuredClone(msgs) }, blocks, null, new Set(["recall"]), recallOnly);
  assert.deepEqual(recallOnly, [], "a kind not placed again is not in view");
});

// (fails before: yes — a chat's first message had half again the turn block's room, beside the briefing's recall on it)
test("a first message a briefing was built on has the turn block's own room; with none built on it, or after a compaction, half again", () =>
  world({}, async (w) => {
    const auto = { turnTokens: 300 };
    const brain = w.svc.brain;
    assert.deepEqual(
      ["first", "afterCompaction", "plain", "toolLeg"].map((position) => brain.turnBudget({ position }, auto, true)),
      [300, 450, 300, 0],
    );
    assert.equal(brain.turnBudget({ position: "first" }, auto, false), 450, "the briefing off, let go, or built before: no recall on these words");
  }));

// (fails before: yes — the turn block's room on a first message did not ask whether a briefing recalled on it)
test("a session with the briefing off: its first message's turn block has half again", () =>
  world({}, async (w) => {
    const settings = { memory: { enabled: true, briefing: false, turnBlock: true, tools: true, learn: true, index: true }, privacy: { learn: true, index: true } };
    const budgetOf = async (/** @type {any} */ s, /** @type {string} */ text, /** @type {any} */ o = {}) => {
      const trace = new MemoryTrace();
      await withTrace(trace, () => s.send(text, o));
      return trace.steps.find((/** @type {any} */ x) => x.name === "turn budget");
    };
    const off = await budgetOf(w.session("off"), "which port does the api server listen on in development?", { settings });
    assert.equal(off?.tokens, 450);
    assert.match(off?.why, /a first message no briefing recalled on: ×1\.5/);
    // The briefing on, built on the same words: the turn block's own room.
    const on = await budgetOf(w.session("on"), "which port does the api server listen on in development?");
    assert.equal(on?.tokens, 300);
    assert.doesNotMatch(on?.why, /×1\.5/);
  }));
