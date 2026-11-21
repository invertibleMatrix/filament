// @ts-check
// What a turn's start adds to the model's copy of the person's message — where the agent stands on its task graph, the
// files it read that changed since, the shells that ended, what is still open, the envelopes still sealed, a hook's or a
// change's note — goes out with that message, and with it again in every later turn: the bytes the provider cached for
// the turn stay the bytes the next turn sends. Before, the archive kept the message as the person sent it and the next
// turn replayed it bare, so a chat with an open task graph wrote its whole history to the cache again every turn (the
// owner's of 11-06: "am i sensing a smoking gun").
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { putSaidBack, turnsOf } from "../src/app/agent/turn-said.js";
import { pinHashOf } from "../src/core/fold.js";

describe("putting what a turn's start said back on its message", () => {
  const go = { role: "user", content: "go on" };
  const plan = { role: "user", content: "plan it" };
  const next = { role: "user", content: "next" };
  const result = { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "r" }] };
  /** @param {string} t */
  const a = (t) => ({ role: "assistant", content: [{ type: "text", text: t }] });
  /** @param {number} n */
  const said = (n) => ({ head: [`exits ${n}`], tail: [`where ${n}`] });
  // Turns 1 (plan it), 2 (go on) and 3 (go on again), and the request's own turn (next).
  const turns = [{ n: 1, key: pinHashOf(plan) }, { n: 2, key: pinHashOf(go) }, { n: 3, key: pinHashOf(go) }];

  // (fails before: yes — the lines were found by the message's words and which copy, so once a summary took turn 2's
  // message, turn 2's lines went on turn 3's)
  test("each message is its own turn's: the same words twice are two turns, ahead and after as said", () => {
    const msgs = [plan, a("a"), result, a("b"), go, a("c"), { ...go }, a("d"), next];
    assert.deepEqual([...turnsOf(msgs, turns)], [[6, 3], [4, 2], [0, 1]], "a tool result is no person's message; the newest is the request's own turn's");
    const back = putSaidBack(msgs, new Map([[2, said(2)], [3, said(3)]]), turns);
    assert.equal(back.put, 2);
    assert.equal(back.messages[0], msgs[0], "a turn that said nothing stays as it went out");
    assert.deepEqual(back.messages[4].content, [{ type: "text", text: "exits 2" }, { type: "text", text: "go on" }, { type: "text", text: "where 2" }]);
    assert.deepEqual(back.messages[6].content, [{ type: "text", text: "exits 3" }, { type: "text", text: "go on" }, { type: "text", text: "where 3" }]);
    assert.equal(back.messages[8], next, "the request's own message is its turn's to say on");
    const marked = msgs.map((m, i) => (i === 6 ? { role: "user", content: [{ type: "text", text: "go on", cache_control: { type: "ephemeral" } }] } : m));
    assert.deepEqual([...turnsOf(marked, turns)], [[6, 3], [4, 2], [0, 1]], "a cache mark aside");
    assert.equal(putSaidBack(msgs, new Map(), turns).messages, msgs);
  });

  // (fails before: yes — the cache audit's sa_95101a98: memory's block, put back on an earlier message before the turn's
  // lines are, made its words another pin than the bare message its turn was pinned by, so with memory on no turn's
  // lines ever went back and the turn before was written to the cache again every turn)
  test("a message memory's block rides on is still its own turn's", () => {
    const block = '<filament-memory kind="turn">\n- [i1 fact] the parser is in src/parse.js\n</filament-memory>';
    const withString = { role: "user", content: `go on\n\n${block}` };
    const withBlocks = { role: "user", content: [{ type: "text", text: "plan it" }, { type: "text", text: block }] };
    const msgs = [withBlocks, a("a"), withString, a("c"), next];
    assert.deepEqual([...turnsOf(msgs, turns.slice(0, 2))], [[2, 2], [0, 1]]);
    const back = putSaidBack(msgs, new Map([[1, said(1)], [2, said(2)]]), turns.slice(0, 2));
    assert.equal(back.put, 2);
    assert.deepEqual(back.messages[2].content, [{ type: "text", text: "exits 2" }, { type: "text", text: `go on\n\n${block}` }, { type: "text", text: "where 2" }], "after memory's block, as it went out");
  });

  test("a turn a summary took, or a rewind: its lines go on no other message with its words", () => {
    // A summary took turns 1 and 2: its lead is no turn's, and the "go on" left is turn 3's.
    const summed = [{ role: "user", content: "The chat so far, summarized" }, a("s"), { ...go }, a("d"), next];
    assert.deepEqual([...turnsOf(summed, turns)], [[2, 3]]);
    assert.equal(putSaidBack(summed, new Map([[2, said(2)]]), turns).put, 0, "turn 2's lines never land on turn 3's message");
    // Turn 2 rewound away (the archive's turnPinsOf leaves it out) and its words sent again as turn 3.
    const again = [plan, a("a"), { ...go }, a("d"), next];
    const standing = turns.filter((t) => t.n !== 2);
    assert.deepEqual([...turnsOf(again, standing)], [[2, 3], [0, 1]]);
    assert.equal(putSaidBack(again, new Map([[3, said(3)]]), standing).messages[2].content[0].text, "exits 3");
  });
});

// (fails before: yes — the cache audit's sa_95101a98: with memory's recall on the message, the next turn sent it with
// memory's block and without where the agent stood, and wrote the turn before to the cache again)
describe("with memory's recall on the messages, the lines a turn's start adds still ride them", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @param {any[]} blocks @param {string} [stop] */
  const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks });
  const answering = (/** @type {any} */ body) => (body?.messages?.at(-1)?.content || []).some?.((/** @type {any} */ x) => x?.type === "tool_result");
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-turn-lines-mem-"));
    up = await fakeUpstream(async (c) => {
      if (c.kind !== "anthropic") return undefined;
      const body = c.body || {};
      if (!(body.tools || []).length) return anthropicReply("A title", { model: "brain-model" });
      if (answering(body)) return reply([{ type: "text", text: "Done." }]);
      if (JSON.stringify(body.messages.at(-1)).includes("Plan the parser")) return reply([{ type: "tool_use", id: "add", name: "tasks", input: { action: "add", goal: "A parser", tasks: [{ id: "lexer", name: "Lexer" }] } }], "tool_use");
      return reply([{ type: "text", text: "ok" }]);
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: true, mode: "conservative", briefingTokens: 1200, turnTokens: 300, minScore: 0.2, tools: true };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(shim?.dataDir, root);
  });

  test("where the agent stands rides the message beside memory's recall, in the next turn too", async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(created.status, 200, await created.clone().text());
    const path = `/api/sessions/${encodeURIComponent(String((await created.json()).id))}`;
    for (const content of ["Plan the parser", "Second, the parser grammar", "Third, the parser lexer"]) {
      const r = await shim.api(`${path}/turns`, { method: "POST", body: { stream: false, content } });
      assert.equal(r.status, 200, await r.clone().text());
      // Learned after the briefing was built, so the next turn's recall brings it.
      if (content === "Plan the parser") await /** @type {any} */ (shim.app).memory.store.remember({ content: "The parser grammar lives in grammar.peg and its lexer in lexer.js.", source: "fact", importance: 0.9, metadata: { kind: "fact" } });
    }
    /** @param {string} words */
    const first = (words) => up.received.find((x) => (x.body?.tools || []).length && !answering(x.body) && JSON.stringify(x.body.messages.at(-1)).includes(words))?.body;
    const two = first("Second, the parser grammar");
    const three = first("Third, the parser lexer");
    const said = JSON.stringify(two.messages.at(-1));
    assert.ok(said.includes("<filament-memory"), "memory's recall rides the second turn's message");
    assert.ok(said.includes("[Filament: where you are"), "and where the agent stands");
    const bare = (/** @type {any} */ x) => JSON.parse(JSON.stringify(x, (k, v) => (k === "cache_control" ? undefined : v)));
    assert.deepEqual(bare(three.messages.slice(0, two.messages.length)), bare(two.messages), "the third turn repeats the second's messages byte for byte");
  });
});

describe("the lines a turn's start adds ride its message in every later turn", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** The newest user message's text blocks. @param {any} body @returns {string[]} */
  const lastTexts = (body) => {
    const last = [...(body?.messages || [])].reverse().find((/** @type {any} */ m) => m.role === "user");
    return Array.isArray(last?.content) ? last.content.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text)) : [String(last?.content ?? "")];
  };
  /** Whether a request's newest message is a tool result. @param {any} body */
  const answering = (body) => (body?.messages?.at(-1)?.content || []).some?.((/** @type {any} */ x) => x?.type === "tool_result");
  /** @param {any[]} blocks @param {string} [stop] */
  const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks });
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-turn-lines-"));
    writeFileSync(join(root, "notes.txt"), "one\n");
    up = await fakeUpstream(async (c) => {
      if (c.kind !== "anthropic") return undefined;
      const body = c.body || {};
      if (!(body.tools || []).length) return anthropicReply("A title", { model: "brain-model" });
      if (answering(body)) return reply([{ type: "text", text: "Done." }]);
      const texts = lastTexts(body);
      if (texts.some((t) => t.includes("Plan the parser"))) return reply([{ type: "tool_use", id: "add", name: "tasks", input: { action: "add", goal: "A parser", tasks: [{ id: "lexer", name: "Lexer" }, { id: "grammar", name: "Grammar", needs: ["lexer"] }] } }], "tool_use");
      if (texts.some((t) => t.includes("Read the notes"))) return reply([{ type: "tool_use", id: "read", name: "read", input: { path: "notes.txt" } }], "tool_use");
      return reply([{ type: "text", text: "ok" }]);
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(shim?.dataDir, root);
  });
  const chat = async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(created.status, 200, await created.clone().text());
    return `/api/sessions/${encodeURIComponent(String((await created.json()).id))}`;
  };
  /** @param {string} path @param {string} content */
  const send = async (path, content) => {
    const r = await shim.api(`${path}/turns`, { method: "POST", body: { stream: false, content } });
    assert.equal(r.status, 200, await r.clone().text());
    return r;
  };
  /** A turn's first request: the one whose newest message is the person's, saying the words. @param {string} words @returns {any} */
  const first = (words) => {
    const c = up.received.find((x) => (x.body?.tools || []).length && !answering(x.body) && JSON.stringify(x.body.messages.at(-1)).includes(words));
    assert.ok(c, words);
    return c.body;
  };
  /** What a request holds, its cache's marks aside. @param {any} x */
  const bare = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === "cache_control" ? undefined : v)));
  /** @param {string} path */
  const transcript = async (path) => /** @type {any[]} */ ((await (await shim.api(`${path}/transcript`)).json()).turns || []);

  // (fails before: yes — the second turn's message went out with where the agent stands, and the third turn sent it bare)
  test("where the agent stands on its open graph: the next turn sends the message as it went out", async () => {
    const path = await chat();
    await send(path, "Plan the parser");
    await send(path, "Second, then");
    await send(path, "Third, now");
    const two = first("Second, then");
    const three = first("Third, now");
    assert.ok(lastTexts(two).some((t) => t.startsWith("[Filament: where you are")), "the second turn heard where it stands");
    assert.deepEqual(bare(three.messages.slice(0, two.messages.length)), bare(two.messages), "the third turn repeats the second's messages byte for byte");
    // The transcript keeps the person's words alone.
    const row = (await transcript(path)).find((t) => JSON.stringify(t.user ?? null).includes("Second, then"));
    assert.ok(row, "the second turn's row");
    assert.deepEqual(lastTexts({ messages: [row.user] }), ["Second, then"]);
  });

  // (fails before: yes — a file read, then changed on disk: the next turn heard of it, and the one after sent it bare)
  test("a file it read that changed since: the next turn sends the message as it went out", async () => {
    const path = await chat();
    await send(path, "Read the notes");
    writeFileSync(join(root, "notes.txt"), "two\n");
    await send(path, "Fourth, then");
    await send(path, "Fifth, now");
    const four = first("Fourth, then");
    const five = first("Fifth, now");
    assert.ok(lastTexts(four).some((t) => t.includes("notes.txt")), "the fourth turn heard the file changed");
    assert.deepEqual(bare(five.messages.slice(0, four.messages.length)), bare(four.messages), "the fifth turn repeats the fourth's messages byte for byte");
  });

  /** Every turn's first request saying the words, oldest first. @param {string} words @returns {any[]} */
  const firsts = (words) => up.received.filter((x) => (x.body?.tools || []).length && !answering(x.body) && JSON.stringify(x.body.messages.at(-1)).includes(words)).map((x) => x.body);

  // (fails before: no — the old match by the whole message and its copy found the words sent again by their own note,
  // which said the rewind and came later; this holds the match by turn)
  test("a turn rewound and its words sent again: the next turn sends the new message as it went out", async () => {
    const path = await chat();
    await send(path, "Read the notes");
    writeFileSync(join(root, "notes.txt"), "three\n");
    await send(path, "Go on, A");
    const back = await shim.api(`${path}/rewind`, { method: "POST", body: { turn: 2, what: "conversation" } });
    assert.equal(back.status, 200, await back.clone().text());
    await send(path, "Go on, A");
    await send(path, "Sixth, now");
    const [gone, again] = firsts("Go on, A");
    const six = first("Sixth, now");
    assert.ok(lastTexts(gone).some((t) => t.includes("notes.txt")), "the rewound turn heard the file changed");
    assert.deepEqual(bare(six.messages.slice(0, again.messages.length)), bare(again.messages), "the sixth turn repeats the words sent again as they went out");
  });

  // (fails before: no — the old match by the whole message missed the words sent again only because the history after
  // a summary holds them in another shape; this holds the match by turn)
  test("words a summary took, sent again after it: the next turn sends them as they went out", async () => {
    const path = await chat();
    await send(path, `Read the notes ${"and the words around them ".repeat(400)}`);
    writeFileSync(join(root, "notes.txt"), "four\n");
    await send(path, "Go on, B");
    const made = await shim.api(`${path}/compact`, { method: "POST", body: { method: "summary" } });
    assert.equal(made.status, 200, await made.clone().text());
    await send(path, "Go on, B");
    await send(path, "Seventh, now");
    const [heard, second] = firsts("Go on, B");
    const seven = first("Seventh, now");
    assert.ok(lastTexts(heard).some((t) => t.includes("notes.txt")), "the first copy heard the file changed");
    const sent = seven.messages.filter((/** @type {any} */ m) => m.role === "user" && JSON.stringify(m).includes("Go on, B"));
    assert.equal(sent.length, 1, "the summary took the first copy");
    assert.deepEqual(bare(sent[0]), bare(second.messages.at(-1)), "the words sent again as they went out");
  });
});
