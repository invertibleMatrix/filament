// HarnessV3 Step 3, Phase 3C (D9, D11): a client's own history lined up with its session's archive. The request goes
// upstream as the client sent it; a rewind or a regenerate marks a line instead of forking the session, and the line
// stays openable; a front trim, an ambiguous history, a re-serialized message and the same text asked twice mark
// nothing; a leg of the client's turn archives whatever turn is newer on the chain.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { Archive } from "../src/archive.js";
import { chainKeyForConversationId } from "../src/services/memory/brain.js";

const SYS = { role: "system", content: "You help." };
const person = (text) => ({ role: "user", content: [{ type: "text", text }] });
const replyText = (m) =>
  Array.isArray(m?.content) ? m.content.filter((b) => b?.type === "text").map((b) => b.text).join("") : String(m?.content ?? "");

describe("a client's own history against its session (D9, D11)", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {any[]} */
  let upstreamCalls = [];
  /** @type {((call: any) => any)[]} */
  let script = [];
  const setScript = (...fns) => {
    script = fns;
    upstreamCalls = [];
  };
  const nextReply = (call) => {
    const fn = script[Math.min(Math.max(upstreamCalls.length - 1, 0), script.length - 1)];
    return fn ? fn(call) : anthropicReply("ok", { model: "m-1" });
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-shared-"));
    up = await fakeUpstream(async (call) => {
      upstreamCalls.push(call);
      return nextReply(call);
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
  const openArchive = () => new Archive({ file: join(shim.dataDir, "mem", "archive.db"), now: () => 0 });
  const chainOf = (sid) => /** @type {any} */ (shim.app.memory).archive.chainIdForKey(chainKeyForConversationId(sid));
  const apiJson = async (path, opts) => {
    const r = await shim.api(path, opts);
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r.json();
  };
  /** One plain proxied turn (no tools): the person's message, the scripted reply. */
  const zcTurn = async (sid, text, reply) => {
    setScript(() => anthropicReply(reply, { model: "m-1" }));
    const r = await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person(text)] }, { "x-session-id": sid, "x-filament-cwd": root });
    assert.equal(r.status, 200);
  };

  // (fails before: no — a guard: a client's chat carries no plan of Filament's; its own model compacts it)
  test("a client's session has no compaction plan of Filament's", async () => {
    const sid = "rt-6p";
    await zcTurn(sid, "one", "a one");
    const chainId = chainOf(sid);
    const alone = await apiJson(`/api/sessions/${encodeURIComponent(chainId)}/compose?dry=1&compaction=1`);
    assert.equal(alone.compaction, undefined, "its own model compacts it, no plan of Filament's");
  });

  test("a client that trims the front of its own history marks no rewind, and neither does an ambiguous history", async () => {
    const sid = "rt-7";
    await zcTurn(sid, "one", "a one");
    await zcTurn(sid, "two", "a two");
    await zcTurn(sid, "three", "a three");
    setScript(() => anthropicReply("a four", { model: "m-1" }));
    // The client kept only turns two and three (it cut turn one off its own front)
    await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("two"), { role: "assistant", content: "a two" }, person("three"), { role: "assistant", content: "a three" }, person("four now")] }, { "x-session-id": sid, "x-filament-cwd": root });
    const a = openArchive();
    try {
      const turns = a.getTurns(chainOf(sid));
      assert.ok(!turns.some((t) => t.meta?.rewound), "a front trim is not a rewind");
      // A trim whose first kept message REPEATS an earlier turn's text ("continue") is ambiguity, not a rewind:
      // the turn the client still holds must not be marked (D9's no-guess rule).
      const sid2 = "rt-7b";
      await zcTurn(sid2, "continue", "a one");
      await zcTurn(sid2, "do the thing", "a two");
      // Asking the same text again with the full history (as a real client resends it): not a rewind
      setScript(() => anthropicReply("a three", { model: "m-1" }));
      await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("continue"), { role: "assistant", content: "a one" }, person("do the thing"), { role: "assistant", content: "a two" }, person("continue")] }, { "x-session-id": sid2, "x-filament-cwd": root });
      setScript(() => anthropicReply("a four", { model: "m-1" }));
      await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("continue"), person("four now")] }, { "x-session-id": sid2, "x-filament-cwd": root });
      const turns2 = a.getTurns(chainOf(sid2));
      assert.ok(!turns2.some((t) => t.meta?.rewound), "the turn the client still holds was not marked");
      assert.equal(turns2.length, 4, "the new turn still opened");
    } finally {
      a.close();
    }
  });

  test("one-window sessions compose byte-identically to before (parity)", async () => {
    const sid = "rt-8";
    await zcTurn(sid, "one", "a one");
    await zcTurn(sid, "two", "a two");
    setScript(() => anthropicReply("a three", { model: "m-1" }));
    const first = await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("one"), { role: "assistant", content: "a one" }, person("two"), { role: "assistant", content: "a two" }, person("three now")] }, { "x-session-id": sid, "x-filament-cwd": root });
    assert.equal(first.status, 200);
    const body = upstreamCalls.at(-1).body;
    assert.deepEqual(body.messages.map((m) => replyText(m)), ["You help.", "one", "a one", "two", "a two", "three now"], "the body is exactly the client's own");
  });

  // (fails before: yes — the edited message landed as turn n+1 and the archive told a false story)
  test("a rewind marks a line; the session keeps its id; the composer leaves the line out", async () => {
    const sid = "rt-9";
    await zcTurn(sid, "one", "a one");
    await zcTurn(sid, "two", "a two");
    await zcTurn(sid, "three", "a three");
    await zcTurn(sid, "four", "a four");
    const chainId = chainOf(sid);
    // The client rewinds to turn 2: its history holds turns 1–2, and it asks something new
    setScript(() => anthropicReply("a five", { model: "m-1" }));
    await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("one"), { role: "assistant", content: "a one" }, person("two"), { role: "assistant", content: "a two" }, person("two again, edited")] }, { "x-session-id": sid, "x-filament-cwd": root });
    const a = openArchive();
    try {
      const turns = a.getTurns(chainId);
      assert.equal(turns.length, 5, "the new turn continues the same session");
      const marked = turns.filter((t) => t.meta?.rewound);
      assert.deepEqual(marked.map((t) => t.n), [3, 4], "turns three and four are one rewound line");
      assert.equal(new Set(marked.map((t) => t.meta.rewound.line)).size, 1, "one line id");
      assert.equal(marked[0].meta.rewound.by, chainKeyForConversationId(sid), "the line says which window rewound");
      // the composer leaves the line out, and so does every archive view (D11)
      const preview = await apiJson(`/api/sessions/${encodeURIComponent(chainId)}/compose?prompt=1&text=next`);
      const json = JSON.stringify(preview.current.prompt.messages);
      assert.ok(!json.includes("a three") && !json.includes("a four"), "the rewound line is out of what the model sees");
      assert.ok(!JSON.stringify(a.render(chainId)).includes("a three"), "the rewound line is out of the archive's views too");
      // the line stays openable as a fork: the live turns before it plus the line, the line live in the fork
      const line = marked[0].meta.rewound.line;
      const fork = a.forkLine(chainId, line);
      assert.ok(fork.id, "the fork is made");
      const forkTurns = a.getTurns(fork.id).map((t) => [t.n, !!t.meta?.rewound]);
      assert.deepEqual(forkTurns, [[1, false], [2, false], [3, false], [4, false]], "turns one and two plus the line, the line live");
      // a second rewind drops the new turn as its own line; forking the FIRST line leaves that gap
      setScript(() => anthropicReply("a six", { model: "m-1" }));
      await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("one"), { role: "assistant", content: "a one" }, person("two"), { role: "assistant", content: "a two" }, person("two again, re-edited")] }, { "x-session-id": sid, "x-filament-cwd": root });
      const turns2 = a.getTurns(chainId);
      const marked2 = turns2.filter((t) => t.meta?.rewound);
      assert.deepEqual(marked2.map((t) => t.n), [3, 4, 5], "the second rewind marked the first edited turn (the older line keeps its id)");
      const forkB = a.forkLine(chainId, marked2.find((t) => t.n === 5).meta.rewound.line);
      const forkBTurns = a.getTurns(forkB.id).map((t) => t.n);
      assert.deepEqual(forkBTurns, [1, 2, 5], "the second line's fork keeps the gap where the first line was");
      // a normal fork copies rewound turns WITH their marks (only a line fork unmarks its own line)
      const plain = a.forkChain(chainId, { atTurn: 5, key: "z:forkcopy" });
      const plainTurns = a.getTurns(plain.id);
      assert.ok(plainTurns.find((t) => t.n === 3)?.meta?.rewound, "a normal fork copies the rewound turn with its mark");
      assert.equal(a.chainIdForKey(chainKeyForConversationId(sid)), chainId, "the session id never changed");
    } finally {
      a.close();
    }
  });

  // (fails before: yes — a regenerate landed as turn n+1 after the turn it replaced)
  test("a regenerate marks the last turn", async () => {
    const sid = "rt-10";
    await zcTurn(sid, "one", "a one");
    await zcTurn(sid, "two", "a two");
    setScript(() => anthropicReply("a two, again", { model: "m-1" }));
    // The history holds the question without its reply, and the newest message asks again
    await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("one"), { role: "assistant", content: "a one" }, person("two")] }, { "x-session-id": sid, "x-filament-cwd": root });
    const a = openArchive();
    try {
      const marked = a.getTurns(chainOf(sid)).filter((t) => t.meta?.rewound);
      assert.deepEqual(marked.map((t) => t.n), [2], "the regenerated turn is marked");
    } finally {
      a.close();
    }
  });

  test("re-serialization, moved cache_control and asking the same text twice never rewind", async () => {
    const sid = "rt-11";
    await zcTurn(sid, "one", "a one");
    await zcTurn(sid, "continue", "a two");
    // Ask "continue" again on purpose: the history still holds the first with its reply
    setScript(() => anthropicReply("a three", { model: "m-1" }));
    await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("one", ), { role: "assistant", content: "a one" }, person("continue"), { role: "assistant", content: "a two" }, { role: "user", content: [{ type: "text", text: "continue", cache_control: { type: "ephemeral" } }] }] }, { "x-session-id": sid, "x-filament-cwd": root });
    const a = openArchive();
    try {
      const turns = a.getTurns(chainOf(sid));
      assert.ok(!turns.some((t) => t.meta?.rewound), "asking again on purpose is not a rewind");
      assert.equal(turns.length, 3, "it opens the next turn");
    } finally {
      a.close();
    }
  });

});

describe("a leg of a client's turn (the Phase 3C review)", () => {
  // Same fixture as above: one anthropic upstream, one app, a temp root.
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root;
  /** @type {any[]} */
  let upstreamCalls = [];
  /** @type {((call: any) => any)[]} */
  let script = [];
  const setScript = (...fns) => {
    script = fns;
    upstreamCalls = [];
  };
  const nextReply = (call) => {
    const fn = script[Math.min(Math.max(upstreamCalls.length - 1, 0), script.length - 1)];
    return fn ? fn(call) : anthropicReply("ok", { model: "m-1" });
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-shared2-"));
    up = await fakeUpstream(async (call) => {
      upstreamCalls.push(call);
      return nextReply(call);
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
  const openArchive = () => new Archive({ file: join(shim.dataDir, "mem", "archive.db"), now: () => 0 });
  const chainOf = (sid) => /** @type {any} */ (shim.app.memory).archive.chainIdForKey(chainKeyForConversationId(sid));

  test("a leg of OpenCode's turn still archives when another window's turn is newer on the chain", async () => {
    const sid = "rv-3";
    // A turn of another window newer than the loop's own, closed turn — what a second window on the session left in an
    // older archive (a chat attached to it, or the harness typing into it) — is built through the archive.
    setScript(() => anthropicReply("a one", { model: "m-1" }));
    const r0 = await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("zero")] }, { "x-session-id": sid, "x-filament-cwd": root });
    assert.equal(r0.status, 200);
    const chainId = chainOf(sid);
    // Turn 2's reply is a tool call: Filament closes the turn with it, and leg 2 reopens it
    setScript(() =>
      anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: "t1", name: "Read", input: { path: "x" } }] }),
    );
    const r1 = await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("zero"), { role: "assistant", content: "a one" }, person("one")] }, { "x-session-id": sid, "x-filament-cwd": root });
    assert.equal(r1.status, 200);
    // The other window's turn lands after the loop's own turn
    const a0 = openArchive();
    try {
      const turn = a0.beginTurn(chainId, { requestId: "fake", model: "m-1", upstream: "m", client: "harness", window: "harness", format: "anthropic", userMessage: person("two (harness)") });
      a0.finishTurn(turn.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: "a two (harness)" }] } });
    } finally {
      a0.close();
    }
    // Leg 2: the loop tail belongs to OpenCode's own already-closed turn
    setScript(() => anthropicReply("a one, concluded", { model: "m-1" }));
    const r2 = await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [
      SYS,
      person("zero"),
      { role: "assistant", content: "a one" },
      person("one"),
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: { path: "x" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "data" }] },
    ] }, { "x-session-id": sid, "x-filament-cwd": root });
    assert.equal(r2.status, 200);
    const a = openArchive();
    try {
      const turns = a.getTurns(chainId);
      const mine = turns.find((t) => (t.meta?.window || a.getChain(chainId).key) !== "harness" && t.n === 2);
      assert.ok(mine, "the tool turn is on the chain");
      const t2 = a.getTurn(mine.id);
      assert.ok(t2.work.length >= 1, "the leg's work is archived");
    } finally {
      a.close();
    }
  });

});
