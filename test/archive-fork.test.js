// The save-state fork (WP-J.1): a new chain that is the source through one turn, sharing the message bodies. The
// archive half at its own level, then the façade + the admin row against a real app with memory on. (Untyped like
// its sibling archive tests: the Archive class itself is on the untyped list until its JSDoc lands.)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/services/memory/archive.js";
import { chainKeyForConversationId, messageHash, reattachBlocks } from "../src/services/memory/brain.js";
import { startApp, fakeUpstream } from "./helpers/app.js";

const dir = mkdtempSync(join(tmpdir(), "filament-fork-"));
let seq = 0;
/** @type {Archive[]} */
const opened = [];
let clock = 1_758_000_000_000;
const now = () => (clock += 1000);
const open = () => {
  const a = new Archive({ file: join(dir, `f${++seq}.db`), now, blockKeyOf: messageHash });
  opened.push(a);
  return a;
};
after(() => {
  for (const a of opened) a.close();
  rmSync(dir, { recursive: true, force: true });
});

const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
const final = (text) => ({ role: "assistant", content: [{ type: "text", text }] });
const call = (id, cmd) => ({
  role: "assistant",
  content: [{ type: "text", text: "Let me look." }, { type: "tool_use", id, name: "bash", input: { cmd } }],
});
const result = (id, out) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: out }] });
/** A finished turn with one tool leg. */
function turn(a, chainId, text, answer) {
  const req = `r${++seq}`;
  const { turnId } = a.beginTurn(chainId, { requestId: req, model: "m", upstream: "u", userMessage: user(text) });
  a.addWork(turnId, [call("t" + turnId, "ls " + text), result("t" + turnId, "out " + text)]);
  a.finishTurn(turnId, { finalMessage: final(answer), requestId: req + "c" });
  return turnId;
}
/** Memory's key of a turn's person message, which its blocks are kept under. @param {Archive} a @param {any} t */
const keyOf = (a, t) => messageHash(a.getMessage(t.user_hash)?.message);
/** A source chain with four finished turns, blocks on every user message, two compactions and a rich meta. */
function source(a) {
  const c = a.chainForKey("h:source", { cwd: "C:\\src\\proj", client: "test", model: "m" });
  // Blocks with the kinds and occurrence counts the live path writes, each as its turn goes out (before the next one
  // begins), under memory's key of its message (its `messageHash`), a session loaded onto turn 2's beside its own: the
  // fork must re-attach exactly these bytes.
  const ids = [];
  for (const n of [1, 2, 3, 4]) {
    ids.push(turn(a, c.id, `question ${n}`, `answer ${n}`));
    const t = a.getTurns(c.id).find((x) => x.n === n);
    a.setBlock(c.id, keyOf(a, t), `memory block for turn ${n}`, n === 2 ? 2 : 1, n === 1 ? "rule" : "turn");
    if (n === 2) a.setBlock(c.id, `${keyOf(a, t)}#load`, "a session loaded onto turn 2", 1, "load");
  }
  a.addCompaction(c.id, { fromTurn: 1, toTurn: 2, summaryText: "turns one and two, summarised", method: "summary" });
  a.addCompaction(c.id, { fromTurn: 1, toTurn: 4, summaryText: "the whole session, summarised", method: "summary" });
  a.addCompaction(c.id, { fromTurn: null, toTurn: null, summaryText: "an import-style whole-chain summary", kind: "client", method: "summary" });
  a.setBriefing(c.id, "BRIEFING: stable since the start");
  a.setState(c.id, { status: "open", summary: "learned from all four turns", open: ["x"] });
  a.setTitle(c.id, "the source");
  // Step 1: the view/trim choices live in the session's settings layer; the meta keeps its facts.
  a.setChainSettings(c.id, {
    context: {
      strategy: "fold",
      trim: { sequential: false },
    },
  });
  a.setMeta(c.id, {
    muted: false,
    briefingIds: ["i1", "i2"],
    learnedThrough: 4,
    learnedAt: 1,
    lastLearn: { calls: 2 },
  });
  return { chain: a.getChain(c.id), turnIds: ids };
}

describe("archive fork", () => {
  // (fails before: yes — blocks are kept under memory's key of a message, and the fork matched them against the
  // archive's own hash of its body: it copied none, and the fork's first request went out without the blocks its
  // history carried — a cache miss, and the memory gone)
  test("a fork at turn 2 shares the message bodies, copies exactly the turns, blocks and compactions inside the cut, and links `forked`", () => {
    const a = open();
    const { chain: src } = source(a);
    const before = a.counts();
    const f = a.forkChain(src.id, { atTurn: 2, key: "h:fork-2" });
    assert.ok(!f.error, f.error);
    assert.equal(f.forkedFrom, src.id);
    assert.equal(f.atTurn, 2);
    assert.deepEqual(f.copied, { turns: 2, blocks: 3, compactions: 1 });
    const after_ = a.counts();
    assert.equal(after_.messages, before.messages, "no message body was duplicated");
    assert.equal(after_.chains, before.chains + 1);
    assert.equal(after_.turns, before.turns + 2);
    const fork = a.getChain(f.id);
    assert.equal(fork.key, "h:fork-2");
    assert.equal(fork.project_id, src.project_id);
    assert.equal(fork.turns, 2, "the finished-turn counter reflects the kept turns");
    assert.equal(fork.title, "the source (fork at turn 2)");
    assert.equal(fork.briefing, src.briefing, "the briefing is inherited byte for byte");
    assert.equal(fork.parent_id, null, "no parent_id: the source must not become an ancestor");
    const st = a.getTurns(src.id, { to: 2 });
    const ft = a.getTurns(f.id);
    assert.deepEqual(
      ft.map((t) => [t.n, t.user_hash, t.final_hash, t.work]),
      st.map((t) => [t.n, t.user_hash, t.final_hash, t.work]),
      "turn rows point at the same hashes",
    );
    assert.ok(ft.every((t) => t.chain_id === f.id));
    const fb = a.blocksFor(f.id);
    const [k1, k2] = st.map((t) => keyOf(a, t));
    assert.deepEqual(Object.keys(fb).sort(), [k1, k2, `${k2}#load`].sort(), "blocks for the kept turns only, the load beside its message's");
    assert.deepEqual(fb[k1], { text: "memory block for turn 1", nth: 1, kind: "rule" }, "a block keeps its kind");
    assert.deepEqual(fb[k2], { text: "memory block for turn 2", nth: 2, kind: "turn" }, "and its occurrence count");
    assert.deepEqual(fb[`${k2}#load`], { text: "a session loaded onto turn 2", nth: 1, kind: "load" });
    // What the fork's first request re-attaches is what the source's would: the same bytes on the same messages.
    const history = () => [user("question 1"), final("answer 1"), user("question 2"), final("answer 2"), user("question 3")];
    const viaSource = { messages: history() };
    const viaFork = { messages: history() };
    reattachBlocks("anthropic", viaSource, Object.fromEntries(Object.entries(a.blocksFor(src.id)).filter(([k]) => k.startsWith(k1) || k.startsWith(k2))));
    reattachBlocks("anthropic", viaFork, fb);
    assert.deepEqual(viaFork, viaSource);
    assert.match(JSON.stringify(viaFork.messages[0]), /memory block for turn 1/);
    assert.match(JSON.stringify(viaFork.messages[2]), /a session loaded onto turn 2/, "turn 2's own block counts its second copy, the load its first");
    assert.deepEqual(
      a.getCompactions(f.id).map((c) => [c.from_turn, c.to_turn]),
      [[1, 2]],
      "only the compaction that ends inside the cut",
    );
    assert.deepEqual(
      a.linksFor(f.id).map((l) => [l.src, l.dst, l.type]),
      [[f.id, src.id, "forked"]],
    );
    assert.ok(!a.linksFor(f.id).some((l) => l.type === "continues"));
  });

  // (fails before: yes — the review of 1cb2824c9: a block row was copied wherever its message's key matched a kept
  // message's, whichever copy it was placed on: a later repeat's recall and load went with the fork, onto the next time
  // the person typed those words there)
  test("a fork copies the blocks as the source held them at the cut: a later repeat's recall and load stay behind", () => {
    const a = open();
    const c = a.chainForKey("h:repeat", { cwd: "C:\\src\\proj", client: "test", model: "m" });
    turn(a, c.id, "run the tests", "ran them");
    turn(a, c.id, "now the lint", "linted");
    const two = a.getTurns(c.id).find((x) => x.n === 2);
    a.setBlock(c.id, keyOf(a, two), "recall for the lint", 1, "turn");
    turn(a, c.id, "run the tests", "ran them again");
    const three = a.getTurns(c.id).find((x) => x.n === 3);
    a.setBlock(c.id, keyOf(a, three), "recall for the second run", 2, "turn");
    a.setBlock(c.id, `${keyOf(a, three)}#load2`, "a session loaded onto the second run", 2, "load");
    const f = a.forkChain(c.id, { atTurn: 2, key: "h:repeat-fork" });
    assert.ok(!f.error, f.error);
    assert.deepEqual(Object.keys(a.blocksFor(f.id)), [keyOf(a, two)], "turn 2's block alone");
    assert.equal(f.copied.blocks, 1);
    // The person types the words again in the fork: nothing of the source's later turn goes onto them.
    const body = { messages: [user("run the tests"), final("ran them"), user("now the lint"), final("linted"), user("run the tests")] };
    reattachBlocks("anthropic", body, a.blocksFor(f.id));
    assert.doesNotMatch(JSON.stringify(body.messages), /second run/);
    assert.match(JSON.stringify(body.messages[2]), /recall for the lint/);
  });

  // (fails before: yes — the review of 85590ee39: a fork's copied rows were stamped with the fork's time, so a fork of
  // that fork took every inherited row for one written after its turns, and copied none)
  test("a fork of a fork carries the blocks its source would at the same cut", () => {
    const a = open();
    const { chain: src } = source(a);
    const once = a.forkChain(src.id, { atTurn: 4, key: "h:once" });
    assert.ok(!once.error, once.error);
    const twice = a.forkChain(once.id, { atTurn: 2, key: "h:twice" });
    const direct = a.forkChain(src.id, { atTurn: 2, key: "h:direct" });
    assert.equal(twice.copied.blocks, 3);
    assert.deepEqual(a.blocksFor(twice.id), a.blocksFor(direct.id));
  });

  // (fails before: yes — the review of cfdde0248: a person message's block is written once memory's awaits are done, and
  // a side turn that opened meanwhile made it read as one written after the fork's turns: the fork left behind a block
  // the source sent)
  test("a block on a copied turn's message comes with the fork when written before that turn ended, a side turn opened meanwhile", () => {
    const a = open();
    const c = a.chainForKey("h:late-block", { cwd: "C:\\src\\proj", client: "test", model: "m" });
    turn(a, c.id, "first", "one");
    // The second turn opens; while memory's awaits run, a side turn opens beside it; then its block is written, and it ends
    const { turnId } = a.beginTurn(c.id, { requestId: "r-two", model: "m", upstream: "u", userMessage: user("second") });
    const side = a.beginTurn(c.id, { requestId: "r-side", model: "m", upstream: "u", userMessage: user("a side question"), alongside: true });
    const two = a.getTurns(c.id).find((x) => x.n === 2);
    a.setBlock(c.id, keyOf(a, two), "a recall on the second turn", 1, "turn");
    a.finishTurn(turnId, { finalMessage: final("two"), requestId: "r-two-c" });
    a.finishTurn(side.turnId, { finalMessage: final("side"), requestId: "r-side-c" });
    // A later repeat of the second turn's words, its own block written as it ran: never the fork's
    turn(a, c.id, "second", "two again");
    a.setBlock(c.id, `${keyOf(a, two)}#later`, "a block of a later turn", 1, "turn");
    const f = a.forkChain(c.id, { atTurn: 2, key: "h:late-block-fork" });
    assert.ok(!f.error, f.error);
    assert.deepEqual(a.blocksFor(f.id), { [keyOf(a, two)]: { text: "a recall on the second turn", nth: 1, kind: "turn" } });
  });

  // (fails before: yes — the review of 85590ee39: a block a turn's tool step wrote after a side turn had begun beside it
  // was taken for a later turn's and left behind, though a leg is its own turn's alone)
  test("a block on a copied turn's leg comes with the fork whenever it was written", () => {
    const a = open();
    const c = a.chainForKey("h:legs", { cwd: "C:\\src\\proj", client: "test", model: "m" });
    turn(a, c.id, "first", "one");
    turn(a, c.id, "second", "two");
    // A side turn begins beside the second while its tool step is still to write its reminder.
    turn(a, c.id, "a side question", "three");
    const two = a.getTurns(c.id).find((x) => x.n === 2);
    const leg = messageHash(a.getMessage(two.work[1]).message);
    a.setBlock(c.id, leg, "a reminder on the second turn's tool result", 1, "rule");
    const f = a.forkChain(c.id, { atTurn: 2, key: "h:legs-fork" });
    assert.ok(!f.error, f.error);
    assert.deepEqual(a.blocksFor(f.id), { [leg]: { text: "a reminder on the second turn's tool result", nth: 1, kind: "rule" } });
  });

  // (fails before: yes — the review of 1cb2824c9: the live line's block on a repeat of the rewound line's message went
  // with the line's fork, onto the copy that line sent clean: bytes it never sent, another line's memory)
  test("a rewound line's fork carries no block the live line wrote after it", () => {
    const a = open();
    const c = a.chainForKey("h:lines", { cwd: "C:\\src\\proj", client: "test", model: "m" });
    turn(a, c.id, "the same words", "first");
    turn(a, c.id, "other words", "second");
    turn(a, c.id, "the same words", "third, on the line");
    const three = a.getTurns(c.id).find((x) => x.n === 3);
    a.mergeTurnMeta(three.id, { rewound: { line: "L1", by: "test", at: now() } });
    // The live history after the rewind is turns 1, 2 and 4: turn 4's words are their second copy there.
    turn(a, c.id, "the same words", "fourth, live");
    const four = a.getTurns(c.id).find((x) => x.n === 4);
    a.setBlock(c.id, keyOf(a, four), "recall on the live line", 2, "turn");
    const f = a.forkLine(c.id, "L1");
    assert.ok(!f.error, f.error);
    assert.deepEqual(a.getTurns(f.id).map((x) => x.n), [1, 2, 3]);
    assert.deepEqual(a.blocksFor(f.id), {});
  });

  test("meta: the settings layer comes along, the meta keeps its facts, and tree.snapshotRef is reserved", () => {
    const a = open();
    const { chain: src } = source(a);
    const f2 = a.getChain(a.forkChain(src.id, { atTurn: 2, key: "h:f2" }).id);
    const f2ctx = a.chainSettings(f2.id)?.context || {};
    assert.deepEqual(f2ctx.trim, { sequential: false }, "the /trim choice travels in the settings layer");
    assert.equal(f2ctx.strategy, "fold", "and the view strategy with it");
    assert.equal(f2.meta.muted, false);
    assert.deepEqual(f2.meta.briefingIds, ["i1", "i2"]);
    assert.ok(!(("view" in f2.meta) || ("trim" in f2.meta)), "the policies left the meta (Step 1: one store)");
    assert.equal(f2.meta.learnedThrough, 2, "the learner's cursor is clamped to the cut");
    assert.equal(f2.state, null, "a state learned through turn 4 is not inherited by a fork at turn 2");
    assert.equal(f2.meta.learnedAt, undefined);
    assert.equal(f2.meta.lastLearn, undefined);
    assert.deepEqual(f2.meta.tree, { snapshotRef: null });
    assert.equal(f2.meta.fork.from, src.id);
    assert.equal(f2.meta.fork.atTurn, 2);
    const f4 = a.getChain(a.forkChain(src.id, { atTurn: 4, key: "h:f4" }).id);
    assert.equal(f4.meta.learnedThrough, 4);
    assert.equal(f4.state.summary, "learned from all four turns", "a state learned within the cut is inherited");
    assert.deepEqual(
      a.getCompactions(f4.id).map((c) => [c.from_turn, c.to_turn]),
      [[1, 2], [1, 4], [null, null]],
      "a fork at the last turn is the whole chain, so a whole-chain summary comes along too",
    );
    const f3 = a.getChain(a.forkChain(src.id, { atTurn: 3, key: "h:f3" }).id);
    assert.deepEqual(a.getCompactions(f3.id).map((c) => [c.from_turn, c.to_turn]), [[1, 2]], "a mid-chain fork leaves the whole-chain summary behind");
  });

  test("the fork renders as a session on its own — its views stop at the cut — and is searchable", () => {
    const a = open();
    const { chain: src } = source(a);
    const f = a.forkChain(src.id, { atTurn: 2, key: "h:f-render" });
    const chat = a.render(f.id, { view: "chat", budgetTokens: 8000 });
    assert.equal(chat.turns, 2);
    assert.ok(chat.text.includes("question 2") && chat.text.includes("answer 2"));
    assert.ok(!chat.text.includes("question 3"), "turn 3 is the future the fork rewound away from");
    const full = a.render(f.id, { view: "full", budgetTokens: 80000 });
    assert.equal(full.messages.length, 2 * 4, "user, tool call, tool result, final — twice");
    const hits = a.searchInputs("question 2");
    assert.deepEqual(new Set(hits.map((h) => h.chainId)), new Set([src.id, f.id]), "the Sessions search finds both sessions");
    const key = (h) => `${h.role}:${h.hash}`;
    assert.ok(hits.every((h) => h.hash), "each hit names the message it stands for");
    assert.ok(new Set(hits.map(key)).size < hits.length, "without distinct, a shared turn is a hit under each chain");
    const distinct = a.searchInputs("question 2", { distinct: true });
    assert.equal(new Set(distinct.map(key)).size, distinct.length, "recall sees each message once, whichever chains hold it");
  });

  test("continuing the fork archives new turns on the fork only; the source is untouched", () => {
    const a = open();
    const { chain: src } = source(a);
    const f = a.forkChain(src.id, { atTurn: 2, key: "h:f-cont" });
    turn(a, f.id, "question 3 again, differently", "a different answer 3");
    assert.equal(a.getChain(f.id).turns, 3);
    assert.deepEqual(a.getTurns(f.id).map((t) => t.n), [1, 2, 3]);
    const srcTurns = a.getTurns(src.id);
    assert.equal(a.getChain(src.id).turns, 4);
    assert.equal(srcTurns.length, 4);
    assert.ok(!srcTurns.some((t) => t.work.length !== 2), "the source's turns are as they were");
    // The fork's turn 3 and the source's turn 3 are different turns with different messages.
    assert.notEqual(a.getTurns(f.id)[2].user_hash, srcTurns[2].user_hash);
  });

  test("refusals: a bad turn, a turn past the end, an unknown session, a taken key, a session without turns", () => {
    const a = open();
    const { chain: src } = source(a);
    assert.match(a.forkChain(src.id, { atTurn: 0, key: "k0" }).error, /1 or more/);
    assert.match(a.forkChain(src.id, { atTurn: 2.5, key: "k0" }).error, /1 or more/);
    assert.match(a.forkChain(src.id, { atTurn: 9, key: "k9" }).error, /has 4 turn\(s\); cannot fork at turn 9/);
    assert.match(a.forkChain("nope", { atTurn: 1, key: "kx" }).error, /no such session/);
    assert.match(a.forkChain(src.id, { atTurn: 1, key: "h:source" }).error, /that key exists/);
    assert.match(a.forkChain(src.id, { atTurn: 1 }).error, /key/);
    const empty = a.chainForKey("h:empty", { cwd: "C:\\x" });
    assert.match(a.forkChain(empty.id, { atTurn: 1, key: "ke" }).error, /no turns/);
    // An open turn at the cut is refused: nothing would ever close the fork's copy of it.
    const openChain = a.chainForKey("h:open", { cwd: "C:\\x" });
    turn(a, openChain.id, "done question", "done answer");
    a.beginTurn(openChain.id, { requestId: "rq-open", userMessage: user("still being answered") });
    assert.match(a.forkChain(openChain.id, { atTurn: 2, key: "ko" }).error, /still open/);
    assert.ok(!a.forkChain(openChain.id, { atTurn: 1, key: "ko1" }).error, "the finished turn before it forks fine");
    assert.equal(a.counts().chains, 4, "a refused fork leaves nothing behind");
  });
});

describe("fork through the façade and the admin row", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const headers = (conversation) => ({ "x-filament-conversation": conversation });
  const ask = (conversation, text) =>
    shim.post(
      "/v1/messages",
      { model: "fork-model", max_tokens: 64, system: "cwd: C:\\proj\\alpha", messages: [{ role: "user", content: text }] },
      headers(conversation),
    );
  /** Poll the session until it has `turns` finished turns (archiving completes after the reply is on the wire). */
  async function sessionWithTurns(id, turns) {
    for (let i = 0; i < 50; i++) {
      const d = await (await shim.api(`/api/memory/sessions/${id}?view=chat`)).json();
      if ((d?.turns || []).filter((t) => t.endedAt).length >= turns) return d;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`session ${id} never reached ${turns} finished turn(s)`);
  }
  // sessions() does not expose the chain key, so the e2e finds the source through the memory service directly.
  const memoryOf = () => /** @type {any} */ (shim.app).memory;

  // (fails before: yes — the owner's rule of 10-31: no session is shared with a client, yet the memory route's fork
  // minted a conversation id a client continued the fork by; the sessions route's fork, the harness's own chat, is the
  // one door)
  test("a fork is made by the sessions route alone, as the harness's own chat; the source's client goes on in the source", async () => {
    up = await fakeUpstream();
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "ant", name: "ant", type: "anthropic", baseUrl: up.url, apiKey: "x" }];
        cfg.routes = [{ match: "fork-*", upstream: "ant", upstreamModel: "{model}", enabled: true }];
      },
    });
    try {
      for (const t of ["first question", "second question", "third question"]) {
        const r = await ask("convo-source", t);
        assert.equal(r.status, 200);
      }
      const archive = memoryOf().archive;
      const srcId = archive.chainIdForKey(chainKeyForConversationId("convo-source"));
      assert.ok(srcId, "the three requests made one chain under the conversation header");
      await sessionWithTurns(srcId, 3);

      const gone = await shim.api(`/api/memory/sessions/${srcId}/fork`, { method: "POST", body: { atTurn: 2 } });
      assert.equal(gone.status, 404, "no fork through the memory route");
      const past = await shim.api(`/api/sessions/${srcId}/fork`, { method: "POST", body: { atTurn: 7 } });
      assert.equal(past.status, 400);
      const missing = await shim.api(`/api/sessions/zzzz/fork`, { method: "POST", body: { atTurn: 1 } });
      assert.equal(missing.status, 404);

      const res = await shim.api(`/api/sessions/${srcId}/fork`, { method: "POST", body: { atTurn: 2 } });
      const fork = await res.json();
      assert.equal(res.status, 200, JSON.stringify(fork));
      assert.ok(fork.chainId);
      assert.equal("conversationId" in fork, false, "no id a client continues it by");
      assert.deepEqual([archive.getChain(fork.chainId).key, !!archive.getChain(fork.chainId).meta.native], [`n:${fork.chainId}`, true], "the harness's own chat");
      assert.equal(fork.forkedFrom, srcId);
      assert.equal(fork.atTurn, 2);
      assert.deepEqual(fork.copied, { turns: 2, blocks: 0, compactions: 0 });

      // The fork is a session: its detail renders the two kept turns and its meta reserves the tree ref.
      const detail = await (await shim.api(`/api/memory/sessions/${fork.chainId}?view=chat`)).json();
      assert.equal(detail.turns.length, 2);
      assert.equal(detail.chain.turns, 2);
      assert.equal(archive.getChain(fork.chainId).meta.tree?.snapshotRef, null);

      // The lineage graph shows both, joined by a `forked` edge that names the turn.
      const lin = await (await shim.api(`/api/memory/sessions/${fork.chainId}/lineage`)).json();
      assert.deepEqual(new Set(lin.nodes.map((n) => n.id)), new Set([fork.chainId, srcId]));
      assert.deepEqual(lin.edges, [{ src: fork.chainId, dst: srcId, type: "forked", atTurn: 2 }]);
      const linSrc = await (await shim.api(`/api/memory/sessions/${srcId}/lineage`)).json();
      assert.ok(linSrc.nodes.some((n) => n.id === fork.chainId), "seen from the source, the fork is a descendant");
      assert.deepEqual(linSrc.edges, [{ src: fork.chainId, dst: srcId, type: "forked", atTurn: 2 }]);

      // The source's client goes on in the source; the fork keeps its two turns.
      const r = await ask("convo-source", "a fourth question");
      assert.equal(r.status, 200);
      await sessionWithTurns(srcId, 4);
      assert.deepEqual(archive.getTurns(fork.chainId).map((t) => t.n), [1, 2], "the fork did not grow");

      // The operation log has the fork as ids and counts, not text.
      const ops = await (await shim.api("/api/ops?kinds=archive&limit=50")).json();
      const op = ops.ops.find((o) => o.sub === "fork");
      assert.ok(op, "a fork op was recorded");
      assert.ok(!JSON.stringify(op).includes("question"), "no conversation text in the op");
    } finally {
      await shim.stop();
      await up.close();
    }
  });
});
