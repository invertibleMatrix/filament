// @ts-check
// What memory costs each round of every agent and each turn, made cheap without changing an answer: a round reads its
// chain's meta as the keys it uses, never the meta whole (it grows with the chat); re-attaching a chain's blocks hashes
// the person messages only, where no block can live on a tool result; a proxied client's tool-loop leg hands on only
// what the archive does not hold; a turn's window stamp, its errata, its alignment and its anchored claims' files are
// read as narrowly; a list of ids is one statement however long (and no longer fails past SQLite's parameter limit);
// the learner's minute, a backup's checksum and the claims streams' pages cost what they need.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/services/memory/archive.js";
import { createConversationScan, reattachBlocks, messageHash, isBlockEligibleUser, isToolLeg, applyUserBlock } from "../src/services/memory/brain.js";
import { AnchorCheck, anchorsFor } from "../src/services/memory/anchors.js";
import { BackupManager } from "../src/services/memory/backup.js";
import { memoryRoutes } from "../src/http/admin/memory.js";
import { createRouter } from "../src/http/router.js";
import { world } from "./fixtures/memory-world.mjs";

const BIG = 300_000;
const CC_UA = { "user-agent": "claude-cli/2.1.258 (external, cli)" };
const settle = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

/** Whole parses of a string longer than BIG while `fn` runs: a meta made big parsed whole. @template T @param {() => Promise<T> | T} fn */
async function bigParses(fn) {
  const parse = JSON.parse;
  let n = 0;
  JSON.parse = /** @type {any} */ ((/** @type {any[]} */ ...args) => {
    if (String(args[0]).length > BIG) n++;
    return parse.apply(JSON, /** @type {any} */ (args));
  });
  try {
    const value = await fn();
    return { value, n };
  } finally {
    JSON.parse = parse;
  }
}

/**
 * Calls of `obj[name]` while `fn` runs, each with its arguments.
 * @template T @param {any} obj @param {string} name @param {() => Promise<T> | T} fn
 */
async function spied(obj, name, fn) {
  const real = obj[name];
  /** @type {any[][]} */
  const calls = [];
  obj[name] = (/** @type {any[]} */ ...args) => {
    calls.push(args);
    return real.apply(obj, args);
  };
  try {
    return { value: await fn(), calls };
  } finally {
    obj[name] = real;
  }
}

/**
 * Calls of `node:fs`'s `name` while `fn` runs, by the path each named: the modules' own named imports see the spy.
 * @template T @param {"statSync" | "readFileSync"} name @param {() => Promise<T> | T} fn
 */
async function fsCalls(name, fn) {
  const f = /** @type {any} */ (fs);
  const real = f[name];
  /** @type {string[]} */
  const calls = [];
  f[name] = (/** @type {any[]} */ ...args) => {
    calls.push(String(args[0]));
    return real.apply(fs, args);
  };
  syncBuiltinESMExports();
  try {
    return { value: await fn(), calls };
  } finally {
    f[name] = real;
    syncBuiltinESMExports();
  }
}

/** A fresh archive in a folder of its own. @param {(a: any, dir: string) => Promise<void> | void} fn */
async function withArchive(fn) {
  const dir = mkdtempSync(join(tmpdir(), "filament-round-"));
  const a = /** @type {any} */ (new Archive({ file: join(dir, "archive.db") }));
  try {
    await fn(a, dir);
  } finally {
    a.close();
    for (let i = 0; i < 10; i++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  }
}

// (fails before: yes — situate read the named chain whole, prepare parsed the meta the lookup returned, and the
// learner's opt-out and the places read the chain whole: a big meta was parsed several times a round)
test("a round reads of its chain's meta only the keys it uses — none parsed whole — and answers as before", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    const s = w.session("round-meta");
    const first = await s.send("set up the build for the parser module please");
    const chainId = first.prep.chain;
    const goal = { status: "active", text: "Ship the parser", slice: "the lexer and the parser, wired", estimate: { sizeClass: "M", firstStep: "write the lexer" } };
    svc.archive.mergeMeta(chainId, { big: "x".repeat(BIG + 10), places: ["C:\\elsewhere"], goal, environment: { os: "win32" } });
    svc.learner.pending.delete(chainId);
    const { value: second, n } = await bigParses(() => s.send("now wire the lexer into the parser and run the tests"));
    assert.equal(n, 0, "a whole person turn — situate, prepare, the reply, learning queued — parsed the big meta none of the times");
    // Set after the system prompt went out, the goal is said on the person's message (brain.js `applyGoal`).
    const said = JSON.stringify(second.r.body.messages.at(-1).content);
    assert.ok(said.includes("Goal for this session") && said.includes("the lexer and the parser, wired"), "the goal is said, from the goal key alone");
    assert.ok(second.prep.composition.goal > 0);
    assert.equal(second.prep.muted, false);
    assert.ok(svc.learner.pending.has(chainId), "its learning is queued: it did not opt out");
    // The chain named by Filament's own header: its head says its key.
    const head = svc.archive.chainHead(chainId);
    const named = await bigParses(() => svc.situate({ format: "anthropic", body: { model: "claude-x", max_tokens: 10, messages: [{ role: "user", content: "hello" }] }, headers: { ...CC_UA, "x-filament-chain": chainId }, model: "claude-x" }));
    assert.equal(named.n, 0);
    assert.deepEqual([named.value.key, named.value.chainRef, named.value.keySource], [head.key, chainId, "chain"]);
    const places = await bigParses(() => svc.placesOf(chainId));
    assert.deepEqual([places.value, places.n], [["C:\\elsewhere"], 0]);
    // Muted: the pass says so, memory stays out, and nothing is queued to learn.
    svc.archive.mergeMeta(chainId, { muted: true });
    svc.learner.pending.delete(chainId);
    const third = await bigParses(() => s.send("and then format the output of the parser as json for the cli"));
    assert.equal(third.n, 0);
    assert.equal(third.value.prep.muted, true);
    assert.equal(svc.learner.pending.has(chainId), false, "muted: not queued to learn");
  });
});

/** The re-attachment walk as it stood: every person message and every tool leg, hashed. @param {string} format @param {any} body @param {Record<string, any>} blocks */
function walkedAll(format, body, blocks) {
  let n = 0;
  const seen = new Map();
  for (let i = 0; i < body.messages.length; i++) {
    if (!(isBlockEligibleUser(body.messages[i], format) || isToolLeg(body.messages[i], format))) continue;
    const h = messageHash(body.messages[i]);
    seen.set(h, (seen.get(h) || 0) + 1);
    const e = blocks[h];
    if (e && seen.get(h) >= (e.nth || 1) && applyUserBlock(body, i, e.text, e.kind || "turn")) n++;
  }
  return n;
}

// (fails before: yes — every tool leg was stringified and hashed on every request, a block of its kind or not)
test("re-attaching blocks hashes the person messages alone when no block of the chain can live on a tool result", () => {
  const messages = [];
  for (let i = 0; i < 12; i++) {
    messages.push({ role: "user", content: i % 4 === 0 ? "go on" : `step ${i}: fix the parser` });
    messages.push({ role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "Read", input: { file_path: `f${i}.js` } }] });
    messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: `bytes ${i}` }] });
    messages.push({ role: "assistant", content: `done ${i}` });
  }
  const body = () => ({ model: "m", max_tokens: 10, messages: structuredClone(messages) });
  const persons = messages.filter((m) => isBlockEligibleUser(m, "anthropic")).length;
  const legs = messages.filter((m) => isToolLeg(m, "anthropic")).length;
  const dup = messageHash({ role: "user", content: "go on" });
  const turnOnly = { [dup]: { text: "recalled for the second go on", nth: 2, kind: "turn" }, [messageHash(messages[4])]: { text: "a loaded session", nth: 1, kind: "load" } };
  // The brain's helpers are untyped JavaScript: a scan is passed as any.
  const b1 = body();
  const scan = createConversationScan("anthropic", b1);
  const n1 = reattachBlocks("anthropic", b1, turnOnly, /** @type {any} */ (scan));
  assert.equal(scan.stats.hashes, persons, `one hash per person message (${persons}), none of the ${legs} legs`);
  const ref1 = body();
  assert.equal(n1, walkedAll("anthropic", ref1, turnOnly));
  assert.deepEqual(b1, ref1, "the same blocks on the same messages, byte for byte");
  const legacy = body();
  assert.equal(reattachBlocks("anthropic", legacy, turnOnly), n1, "the walk without a scan agrees");
  assert.deepEqual(legacy, ref1);
  // A block on a tool result (`rule`, `tool`): the legs are walked, as before.
  const onLeg = { ...turnOnly, [messageHash(messages[6])]: { text: "a rule on the call", nth: 1, kind: "rule" } };
  const b2 = body();
  const scan2 = createConversationScan("anthropic", b2);
  const n2 = reattachBlocks("anthropic", b2, onLeg, /** @type {any} */ (scan2));
  assert.equal(scan2.stats.hashes, persons + legs);
  const ref2 = body();
  assert.equal(n2, walkedAll("anthropic", ref2, onLeg));
  assert.deepEqual(b2, ref2);
  // `nth` of a person message, counted among the person messages, is its count among all.
  const s3 = createConversationScan("anthropic", body());
  const own = s3.eligibleIdx.map((i) => s3.nthOf(s3.hashAt(i), { legs: false }));
  assert.equal(s3.stats.hashes, persons, "counted without a leg hashed");
  assert.deepEqual(own, s3.eligibleIdx.map((i) => s3.nthOf(s3.hashAt(i))));
});

// (fails before: yes — each leg handed on, cloned and re-hashed the whole loop so far)
test("a tool-loop leg hands on only what the archive does not hold; the turn's work, final and tally are as before", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    const H = { ...CC_UA, "x-session-id": "legs-costs" };
    const U = { role: "user", content: "list the files in src and tell me the biggest" };
    const req = (/** @type {any[]} */ messages) => ({ format: "anthropic", body: { model: "claude-x", max_tokens: 100, system: "You are Claude Code.\n<env>\nWorking directory: C:\\legs\n</env>", messages: structuredClone(messages) }, headers: H, model: "claude-x" });
    const call = (/** @type {number} */ i) => ({ role: "assistant", content: [{ type: "tool_use", id: `u${i}`, name: "Bash", input: { command: `ls -S src/${i}` } }] });
    const result = (/** @type {number} */ i) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: `u${i}`, content: `a${i}.js 10k` }] });
    const p1 = await svc.prepare(svc.situate(req([U])), { requestId: "c-1" });
    svc.afterReply({ chainId: p1.chain, turnId: p1.turn, requestId: "c-1", finalMessage: call(1), replyText: "", outputChars: 0 });
    /** @type {any[]} */
    const loop = [];
    /** @type {number[]} */
    const written = [];
    for (let i = 1; i <= 8; i++) {
      loop.push(call(i), result(i));
      const p = await svc.prepare(svc.situate(req([U, ...loop])), { requestId: `c-${i + 1}` });
      assert.equal(p.turn, p1.turn);
      assert.deepEqual(p.legWork, i === 1 ? [call(1), result(1)] : [call(i), result(i)], `leg ${i + 1}: the reply the archive held as the final, and the new result`);
      assert.ok(p.notes.some((/** @type {string} */ n) => n.includes(`the loop so far (${loop.length} messages)`)), "the note counts the loop so far");
      const final = i === 8 ? { role: "assistant", content: [{ type: "text", text: "a1.js is the biggest." }] } : call(i + 1);
      const { calls } = await spied(svc.archive, "putMessage", () => svc.afterReply({ chainId: p1.chain, turnId: p.turn, requestId: `c-${i + 1}`, finalMessage: final, workMessages: p.legWork, replyText: "", outputChars: 0 }));
      written.push(calls.length);
    }
    assert.ok(written.every((n) => n <= 3), `each leg's write stores what is new and its final alone, not the loop again: ${written}`);
    const t = svc.archive.getTurn(p1.turn);
    assert.deepEqual(t.work.map((/** @type {string} */ h) => svc.archive.getMessage(h).message), loop, "the turn's work is the whole loop, in order");
    assert.deepEqual(t.meta.tally, { legs: 8, calls: 8 });
    assert.equal(svc.archive.getMessage(t.final_hash).message.content[0].text, "a1.js is the biggest.");
    // A replayed leg (a retry) adds nothing, and hands on nothing to add.
    const replay = await svc.prepare(svc.situate(req([U, ...loop])), { requestId: "c-replay" });
    assert.equal(replay.turn, p1.turn);
    assert.equal(replay.legWork, undefined);
    assert.ok(replay.notes.some((/** @type {string} */ n) => n.includes(`the loop so far (${loop.length} messages)`)));
    svc.afterReply({ chainId: p1.chain, turnId: replay.turn, requestId: "c-replay", finalMessage: { role: "assistant", content: [{ type: "text", text: "a1.js is the biggest." }] }, workMessages: replay.legWork, replyText: "", outputChars: 0 });
    assert.equal(svc.archive.getTurn(p1.turn).work.length, loop.length);
    assert.deepEqual(svc.archive.getTurn(p1.turn).meta.tally, { legs: 8, calls: 8 });
  });
});

// (fails before: yes — the tool calls were counted with one SQL parameter per work message, and SQLite refuses more
// than 32,766: the summary view of such a turn threw "too many SQL variables")
test("a turn's tool calls are counted past SQLite's parameter limit", async () => {
  await withArchive((a) => {
    const ch = a.chainForKey("big-loop", { project: null, client: "test", model: "m" });
    const t = a.beginTurn(ch.id, { requestId: "r", userMessage: { role: "user", content: "run every test, one by one" } });
    const work = [];
    for (let i = 0; i < 16_500; i++) {
      work.push({ role: "assistant", content: [{ type: "tool_use", id: `u${i}`, name: "Bash", input: { command: `t ${i}` } }] });
      work.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `u${i}`, content: "ok" }] });
    }
    a.addWork(t.turnId, work);
    a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: "all green" } });
    assert.ok(a.getTurn(t.turnId).work.length > 32_766);
    const view = a.render(ch.id, { view: "summary", budgetTokens: 100_000 });
    assert.match(view.text, /\(work: 16500 tool calls\)/);
  });
});

// (fails before: yes — an `IN (?, …)` made one prepared statement per length of list, each kept while the archive is open)
test("a list of ids is one prepared statement however long, and finds what it found", async () => {
  await withArchive((a) => {
    const ch = a.chainForKey("lists", { project: "p1", client: "test", model: "m" });
    /** @type {number[]} */
    const ids = [];
    for (let i = 0; i < 40; i++) {
      const id = a.items.add({ projectId: "p1", chainId: ch.id, kind: "fact", text: `fact number ${i} about the parser`, origin: "learner" }).id;
      ids.push(id);
      if (i % 3 === 0) a.items.note(id, "evidence", { by: "learner", detail: { chain: "other" } });
      if (i % 5 === 0) a.items.note(id, "fired", { by: "filament", detail: { chain: ch.id, shape: "s", args: "a" } });
    }
    const hashes = ids.map((i) => a.putMessage("user", { role: "user", content: `m${i}` }).hash);
    const real = a.db.prepare.bind(a.db);
    let prepares = 0;
    a.db.prepare = (/** @type {string} */ sql) => (prepares++, real(sql));
    try {
      for (let k = 1; k <= ids.length; k++) {
        const counts = a.items.eventCounts(ids.slice(0, k));
        assert.equal(counts.size, ids.slice(0, k).filter((_, i) => i % 3 === 0).length);
        const acts = a.items.actCounts(ids.slice(0, k));
        assert.equal(acts.size, ids.slice(0, k).filter((_, i) => i % 5 === 0).length);
        assert.equal(a.messageKinds(hashes.slice(0, k)).size, k);
        assert.equal(a.listChains({ ids: [ch.id, ...Array.from({ length: k }, (_, i) => `nope-${i}`)] }).length, 1);
      }
      assert.ok(prepares <= 4, `four statements at most for every length (${prepares})`);
    } finally {
      a.db.prepare = real;
    }
    assert.deepEqual(a.items.eventCounts([ids[0], ids[3], ids[1]]).get(ids[3]), { evidence: 1, suspected: 0, grounded: 0, lastSaid: a.items.eventCounts([ids[3]]).get(ids[3]).lastSaid });
    assert.deepEqual([...a.items.actCounts([ids[5]]).get(ids[5]).triggers], [["s\na", { fired: 1, followed: 0, kept: 0 }]]);
  });
});

// (fails before: yes — there was no turnMarks: alignHistory read every turn of the chat whole, on each of its turns)
test("a turn's marks read as its meta does, for every odd value a mark may hold", async () => {
  await withArchive((a) => {
    const ch = a.chainForKey("marks", { project: null, client: "opencode", model: "m" });
    const metas = [
      '{"window":"w1","key":"k1","client":"opencode"}',
      '{"window":"","command":0,"rewound":false,"key":123,"composed":"x"}',
      '{"window":null,"client":"harness","key":""}',
      '{"command":"yes","rewound":{"line":"r1"},"composed":0,"key":"k4"}',
      "not json",
      null,
      '{"window":5,"composed":[]}',
      '{"composed":{},"command":[]}',
      '{"composed":"","command":{},"rewound":"0"}',
      '{"composed":true,"rewound":0.0,"command":false}',
      '{"composed":1.5,"window":{"a":1}}',
      "[1,2]",
    ];
    metas.forEach((m, i) => {
      const t = a.beginTurn(ch.id, { requestId: `r${i}`, userMessage: { role: "user", content: `message ${i}` } });
      if (i % 2) a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: `answer ${i}` } });
      a.db.prepare("UPDATE turns SET meta_json = ? WHERE id = ?").run(m, t.turnId);
    });
    const chain = a.getChain(ch.id);
    const ref = a.getTurns(ch.id).map((/** @type {any} */ t) => ({ n: t.n, finished: !!t.final_hash, command: !!t.meta?.command, rewound: !!t.meta?.rewound, pin: a.pinOfTurn(t), window: t.meta?.window ?? Archive.turnWindow(t, chain) }));
    assert.deepEqual(a.turnMarks(ch.id), ref);
  });
});

// (fails before: yes — alignHistory read the chain whole and every turn whole, on every turn of a proxied chat)
test("lining a window's history up reads its chain's head and its turns' marks, and lines it up as before", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    const s = w.session("align-costs");
    await s.send("first: read the parser");
    await s.send("second: fix the lexer");
    const r = { format: "anthropic", body: { model: "claude-x", max_tokens: 10, system: "You are Claude Code.\n<env>\nWorking directory: C:\\evals\nIs a git repo: yes\n</env>", messages: [{ role: "user", content: "first: read the parser" }, { role: "assistant", content: "Done." }, { role: "user", content: "second: fix the lexer" }, { role: "assistant", content: "Done." }, { role: "user", content: "third: run it" }] }, headers: { ...CC_UA, "x-session-id": "align-costs" }, model: "claude-x" };
    const sit = svc.situate(r);
    const turns = await spied(svc.archive, "getTurns", () => spied(svc.archive, "getChain", () => svc.alignHistory(sit)));
    const align = turns.value.value;
    assert.deepEqual([turns.calls.length, turns.value.calls.length], [0, 0], "no turn read whole, nor the chain");
    assert.equal(align.intent, "turn");
    assert.deepEqual(align.matched.map((/** @type {any} */ m) => [m.n, m.index]), [[1, 0], [2, 2]]);
    assert.equal(align.rewind, null);
    // A history that dropped the second turn rewinds its line, as before.
    const edited = structuredClone(r);
    edited.body.messages = [{ role: "user", content: "first: read the parser" }, { role: "assistant", content: "Done." }, { role: "user", content: "second, said otherwise" }];
    const back = svc.alignHistory(svc.situate(edited));
    assert.deepEqual(back.rewind && [back.rewind.from, back.rewind.to], [2, 2]);
  });
});

// (fails before: yes — a turn's window stamp parsed the whole meta and wrote it back whole, and its autoTitle look did too)
test("a turn's window stamp writes its key in place, the rest of the meta byte for byte as before", async () => {
  await withArchive(async (a) => {
    const ch = a.chainForKey("stamp", { project: null, client: "opencode", model: "m" });
    a.beginTurn(ch.id, { requestId: "r0", window: "w1", client: "opencode", userMessage: { role: "user", content: "hello" } });
    a.mergeMeta(ch.id, { big: "x".repeat(BIG + 10), "7": { z: 1, "2": [0.1 + 0.2, 1e21, -0, 1e-7] }, odd: "\u2028 \ud800 \u0000 \"q\" 😀", tail: null });
    const before = a.db.prepare("SELECT meta_json FROM chains WHERE id = ?").get(ch.id).meta_json;
    const want = JSON.parse(before);
    want.windows.w2 = { client: "codex" };
    const { n } = await bigParses(() => a.beginTurn(ch.id, { requestId: "r1", window: "w2", client: "codex", userMessage: { role: "user", content: "a second window speaks" } }));
    assert.equal(n, 0, "the big meta was not parsed: not for the stamp, not for the autoTitle look");
    assert.equal(a.db.prepare("SELECT meta_json FROM chains WHERE id = ?").get(ch.id).meta_json, JSON.stringify(want));
    // A window the list names keeps its entry and is written not at all — a key of the entry's own stays —; one whose
    // client changes has it written again. (fails before: yes, on 41c8d5e9c — every turn wrote its window's entry
    // again, its lastSeen moved)
    want.windows.w1 = { ...want.windows.w1, kept: 1 };
    a.mergeMeta(ch.id, { windows: want.windows });
    a.beginTurn(ch.id, { requestId: "r2", window: "w1", userMessage: { role: "user", content: "the first again" } });
    assert.equal(a.db.prepare("SELECT meta_json FROM chains WHERE id = ?").get(ch.id).meta_json, JSON.stringify(want));
    want.windows.w1 = { client: "claude-code" };
    a.beginTurn(ch.id, { requestId: "r3", window: "w1", client: "claude-code", userMessage: { role: "user", content: "the first, from another app" } });
    assert.equal(a.db.prepare("SELECT meta_json FROM chains WHERE id = ?").get(ch.id).meta_json, JSON.stringify(want));
    // A chain asked to be named by its first message still is, and the ask goes.
    const named = a.chainForKey("named", { project: null, client: "harness", model: "m", meta: { autoTitle: true, big: "y".repeat(BIG + 10) } });
    a.beginTurn(named.id, { requestId: "n1", window: "harness", client: "harness", userMessage: { role: "user", content: "Fix the parser\nthen the lexer" } });
    assert.equal(a.getChain(named.id).title, "Fix the parser");
    assert.equal(a.metaOf(named.id, ["autoTitle"]).autoTitle, undefined);
  });
});

// (fails before: yes — the errata were read off the chain read whole, its meta parsed twice)
test("a session's errata are taken as their one key", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    const s = w.session("errata-costs");
    const { prep } = await s.send("check the parser");
    const entry = { ref: "i9", old: "the parser is in lib", at: svc.archive.now(), by: "the user" };
    svc.archive.appendMeta(prep.chain, "errata", entry, 10);
    const stale = { ref: "i8", old: "older", at: 1, by: "the user" };
    svc.archive.appendMeta(prep.chain, "errata", stale, 10);
    const taken = await spied(svc.archive, "getChain", () => svc.brain.takeErrata(prep.chain));
    assert.equal(taken.calls.length, 0);
    assert.deepEqual(taken.value, [entry], "the queue, the stale one dropped");
    assert.deepEqual(svc.brain.takeErrata(prep.chain), [], "taken: the queue is empty");
  });
});

// (fails before: yes — there was no firedIn: a matching call read the claim's whole history, which grows with each act)
test("a claim's reminder said in a conversation is one look at its acts there, as its history read it", async () => {
  await withArchive(async (a, dir) => {
    const root = join(dir, "proj");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "parser.js"), "export function parse() {}\n");
    const p = a.ensureProject(root);
    const text = "Finish the error recovery in src/parser.js before the release";
    const id = a.items.add({ projectId: p.id, kind: "thread", text, origin: "person" }).id;
    a.anchors.add(id, anchorsFor(text, root));
    const acts = [
      { conversation: "c1" },
      { chain: "c2", unless: "" },
      { conversation: null, chain: "c3", unless: "use the flag" },
      { conversation: "", chain: "c4" },
      { chain: "c5", unless: 0 },
      { chain: "c6", unless: false },
      { chain: "c6", unless: "x" },
      { conversation: 7 },
    ];
    for (const d of acts) a.items.note(id, "fired", { by: "filament", detail: d });
    a.db.prepare("INSERT INTO item_events (item_id, at, action, by, detail_json) VALUES (?, 1, 'fired', 'filament', NULL)").run(id);
    a.items.note(id, "followed", { by: "filament", detail: { conversation: "c9" } });
    const events = a.items.events(id);
    const ref = (/** @type {string} */ here, /** @type {boolean} */ bare) => events.some((/** @type {any} */ e) => e.action === "fired" && (e.detail?.conversation ?? e.detail?.chain) === here && (!bare || !e.detail?.unless));
    for (const here of ["c1", "c2", "c3", "c4", "", "c5", "c6", "7", "c9", "nobody"])
      for (const bare of [false, true]) assert.equal(a.items.firedIn(id, here, { bare }), ref(here, bare), `${JSON.stringify(here)} ${bare ? "bare" : "any"}`);
    // The open thread on the file a call reads: said once in a conversation, and its history never read for it.
    const { MemoryBrain } = await import("../src/services/memory/brain.js");
    const brain = new MemoryBrain(/** @type {any} */ ({ archive: a, getConfig: () => ({}) }));
    const call = { projectId: p.id, chainId: "chat-1", tool: "Read", input: { file_path: join(root, "src", "parser.js") } };
    const once = await spied(a.items, "events", () => [brain.threadsFor(call), brain.threadsFor(call)]);
    assert.equal(once.calls.length, 0);
    assert.deepEqual(once.value.map((r) => r.length), [1, 0], "said the first time, not again in the same conversation");
  });
});

// (fails before: yes — a check run had no way to take its stats ahead: each was taken on the loop as it was checked)
test("a check run takes its stats ahead, off the loop, and checks as a cold run does", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-warm-"));
  try {
    writeFileSync(join(dir, "a.js"), "export const parse = 1;\n");
    writeFileSync(join(dir, "b.js"), "export const lex = 2;\n");
    mkdirSync(join(dir, "lib"));
    const anchors = [
      ...anchorsFor("parse lives in a.js", dir),
      ...anchorsFor("lex lives in b.js and lib/", dir),
      { path: join(dir, "gone.js"), name: "gone.js", kind: /** @type {const} */ ("file"), hash: null, size: 1, mtime: 1, head: null, symbols: [], state: /** @type {const} */ ("ok") },
    ];
    writeFileSync(join(dir, "b.js"), "export const lexer = 3;\n");
    const checker = new AnchorCheck();
    const cold = checker.run();
    const want = anchors.map((x) => cold(x));
    const warm = checker.run();
    await warm.warm(anchors.map((x) => x.path));
    const got = await fsCalls("statSync", () => anchors.map((x) => warm(x)));
    assert.deepEqual(got.calls, [], "no stat on the loop: each was taken ahead");
    assert.deepEqual(got.value, want, "the same states");
    assert.deepEqual(want.map((s) => s.state), ["ok", "changed", "ok", "gone"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — every anchored claim a session was ever shown had its files stat'ed on the event loop, every turn)
test("a session's turn block checks the claims it was shown with their stats taken ahead, and tells a move as before", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    const s = w.session("warm-shown", { cwd: w.dir });
    const { prep } = await s.send("look at the zygote module layout first");
    const file = join(w.dir, "warm-anchor.js");
    writeFileSync(file, "export const anchorFn = 1;\n");
    // Another project's claim, shown to this session: no briefing or recall of this one reads it (and stats its file)
    // before its turn block checks it.
    const text = "The quarterly ledger export lives in warm-anchor.js";
    const id = svc.archive.items.add({ projectId: "p-elsewhere", chainId: prep.chain, kind: "fact", text, origin: "person" }).id;
    svc.archive.anchors.add(id, anchorsFor(text, w.dir));
    svc.archive.injections.add({ requestId: null, chainId: prep.chain, turnId: null, kind: "turn", ids: [`i${id}`], tokens: 5 });
    const brain = svc.brain;
    const real = brain.sayErrata;
    /** @type {string[]} */
    const inside = [];
    brain.sayErrata = (/** @type {any[]} */ ...args) => {
      const before = /** @type {any} */ (fs).statSync;
      /** @type {any} */ (fs).statSync = (/** @type {any[]} */ ...b) => (inside.push(String(b[0])), before.apply(fs, b));
      syncBuiltinESMExports();
      try {
        return real.apply(brain, args);
      } finally {
        /** @type {any} */ (fs).statSync = before;
        syncBuiltinESMExports();
      }
    };
    try {
      await s.send("now rename the zygote module helpers to match");
    } finally {
      brain.sayErrata = real;
    }
    assert.ok(!inside.includes(file), `the shown claim's file was stat'ed ahead, not as it was checked: ${inside.join(", ")}`);
    writeFileSync(file, "export const other = 2;\n");
    await s.send("and then document the zygote module helpers");
    const errata = svc.archive.metaOf(prep.chain, ["errata"]).errata;
    assert.equal(errata, undefined, "the move was said at the top of that turn's block and taken");
    assert.ok(svc.archive.items.events(id).some((/** @type {any} */ e) => e.action === "anchor" && e.detail.state === "changed"), "the change was seen and recorded");
  });
});

// (fails before: yes — an outside agent's session over MCP had the files of every claim it was shown stat'ed on the
// event loop, at each call)
test("an outside agent's errata over MCP check the claims it was shown with their stats taken ahead, and tell a move as before", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    const s = w.session("warm-mcp", { cwd: w.dir });
    const { prep } = await s.send("look at the zygote module layout first");
    const file = join(w.dir, "warm-mcp-anchor.js");
    writeFileSync(file, "export const anchorFn = 1;\n");
    const text = "The quarterly ledger import lives in warm-mcp-anchor.js";
    const id = svc.archive.items.add({ projectId: "p-elsewhere", chainId: prep.chain, kind: "fact", text, origin: "person" }).id;
    svc.archive.anchors.add(id, anchorsFor(text, w.dir));
    svc.archive.injections.add({ requestId: null, chainId: prep.chain, turnId: null, kind: "search", ids: [`i${id}`], tokens: 5 });
    const scope = svc.scope({ role: "agent", chain: prep.chain });
    const brain = svc.brain;
    const real = brain.sayErrata;
    /** @type {string[]} */
    const inside = [];
    brain.sayErrata = (/** @type {any[]} */ ...args) => {
      const before = /** @type {any} */ (fs).statSync;
      /** @type {any} */ (fs).statSync = (/** @type {any[]} */ ...b) => (inside.push(String(b[0])), before.apply(fs, b));
      syncBuiltinESMExports();
      try {
        return real.apply(brain, args);
      } finally {
        /** @type {any} */ (fs).statSync = before;
        syncBuiltinESMExports();
      }
    };
    try {
      assert.equal(await scope.errata(), "", "nothing moved yet");
      assert.ok(!inside.includes(file), `the shown claim's file was stat'ed ahead, not as it was checked: ${inside.join(", ")}`);
    } finally {
      brain.sayErrata = real;
    }
    writeFileSync(file, "export const other = 2;\n");
    assert.match(await scope.errata(), /warm-mcp-anchor\.js/, "the move is said at the top of its next answer");
    assert.equal(await scope.errata(), "", "and said once");
  });
});

// (fails before: yes — the learner's minute read each waiting chat whole)
test("the learner's minute reads when each waiting chat was last active, and waits as before", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    const s = w.session("learn-tick");
    const { prep } = await s.send("tidy the parser tests");
    const learner = svc.learner;
    learner.pending.add("gone-chain");
    learner.pending.add(prep.chain);
    const { calls } = await spied(svc.archive, "getChain", () => learner.tick());
    assert.equal(calls.length, 0);
    assert.equal(learner.pending.has("gone-chain"), false, "a chat that is gone stops waiting");
    assert.equal(learner.pending.has(prep.chain), true, "a chat active a moment ago waits");
  });
});

// (fails before: yes — each copy was read back whole and hashed in one go on the loop)
test("a backup hashes each copy as it writes it: the same digest, the file never read back", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-bk-costs-"));
  const folder = join(root, "memory");
  mkdirSync(folder, { recursive: true });
  // The archive and the backups are untyped JavaScript: their options read as their defaults, so both are held as any.
  const archive = /** @type {any} */ (new Archive({ file: join(folder, "archive.db") }));
  try {
    const ch = archive.chainForKey("k", { cwd: "C:\\x" });
    const t = archive.beginTurn(ch.id, { requestId: "r", userMessage: { role: "user", content: "hello backup ".repeat(5000) } });
    archive.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: "hi" } });
    const bk = new BackupManager(/** @type {any} */ ({ service: { folder, archive }, getConfig: () => ({ backups: { enabled: true, folder: join(root, "dest"), keep: 2 } }) }));
    const { value: m, calls } = await fsCalls("readFileSync", () => bk.run({ reason: "manual" }));
    const gz = join(m.dir, "archive.db.gz");
    assert.deepEqual(calls.filter((p) => p.endsWith(".gz")), [], "no copy read back whole");
    assert.equal(m.files["archive.db.gz"].sha256, createHash("sha256").update(readFileSync(gz)).digest("hex"));
    assert.equal(m.files["archive.db.gz"].bytes, fs.statSync(gz).size);
    assert.deepEqual(Object.keys(m.files["archive.db.gz"]), ["bytes", "sha256", "plainBytes"]);
    assert.equal((await bk.verify(m.dir)).ok, true);
  } finally {
    archive.close();
    rmSync(root, { recursive: true, force: true });
  }
});

/** The claims stream route opened on a scripted request and response. @param {any} memory */
async function openStream(memory) {
  const sseClients = new Set();
  const hit = createRouter(memoryRoutes({ memory, usage: {}, sseClients }))("GET", "/memory/claims/stream");
  assert.ok(hit);
  const req = Object.assign(new EventEmitter(), { headers: {} });
  /** @type {string[]} */
  const writes = [];
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false,
    destroyed: false,
    writableNeedDrain: false,
    writeHead() {},
    /** @param {string} c */
    write(c) {
      writes.push(c);
      return true;
    },
    /** @param {string} [c] */
    end(c) {
      if (c) writes.push(c);
      res.writableEnded = true;
    },
  });
  await hit.handler({ req, res, url: new URL("http://x/api/memory/claims/stream"), params: hit.params }, {});
  await settle();
  return { text: () => writes.join(""), leave: () => req.emit("close") };
}

// (fails before: yes — every open window's stream read the same page of the feed on its own)
test("the claims streams woken by one change read its page once, and each sends it whole", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    const ch = svc.archive.chainForKey("k-stream", { project: "p1" });
    const streams = [await openStream(svc), await openStream(svc), await openStream(svc)];
    let reads = 0;
    const read = svc.claimChanges;
    svc.claimChanges = (/** @type {any} */ o) => (reads++, read.call(svc, o));
    try {
      const id = svc.archive.items.add({ projectId: "p1", chainId: ch.id, kind: "fact", text: "The queue drains every minute.", origin: "learner" }).id;
      await settle();
      assert.equal(reads, 1, "one read for the three");
      const texts = streams.map((s) => s.text());
      assert.ok(texts[0].includes(`"claim":"i${id}"`));
      assert.equal(new Set(texts).size, 1, "the three sent the same");
      svc.archive.items.note(id, "evidence", { by: "learner", detail: { chain: "x" } });
      await settle();
      assert.equal(reads, 2, "a write since: read again");
      assert.ok(streams.every((s) => s.text().includes('"action":"evidence"')));
    } finally {
      svc.claimChanges = read;
      for (const s of streams) s.leave();
    }
  });
});

// (fails before: yes — a new chat looking for a sibling to borrow blocks from read the 50 newest chains whole)
test("a new chat borrows its sibling's blocks reading the newest chains' heads alone", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    const a = w.session("sib-a");
    const { prep } = await a.send("hello there friend, let us start");
    const first = { role: "user", content: "the shared opening of the rotated session" };
    svc.archive.setBlock(prep.chain, messageHash(first), "borrowed memory for the opening", 1, "turn");
    const r = { format: "anthropic", body: { model: "claude-x", max_tokens: 10, system: "You are Claude Code.\n<env>\nWorking directory: C:\\evals\nIs a git repo: yes\n</env>", messages: [first, { role: "assistant", content: "ok" }, { role: "user", content: "and go on from there" }] }, headers: { ...CC_UA, "x-session-id": "sib-b" }, model: "claude-x" };
    const { value: p, calls } = await spied(svc.archive, "recentChains", () => svc.prepare(svc.situate(r), { requestId: "sib-b-1" }));
    assert.equal(calls.length, 0);
    assert.notEqual(p.chain, prep.chain);
    assert.ok(r.body.messages[0].content.includes("borrowed memory for the opening"), "the sibling's block re-attached");
    assert.ok(p.notes.some((/** @type {string} */ n) => /re-attached 1 earlier block/.test(n)));
  });
});
