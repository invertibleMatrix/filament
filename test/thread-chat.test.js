// @ts-check
// A thread (core/threads.js; the owner's of 11-09 and 11-11): a chat a chat's agent starts, linked to it — an advisor
// it writes for reviews, a worker it hands a part to. The link both ways in the archive; the two write each other
// letters without a tag, and a thread's letters count from none again when the person writes in its starter; its first
// message is the starter's agent's brief, drawn as theirs, never the person's words nor a command of theirs.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LETTERS_ALONE, createLetters } from "../src/app/letters.js";
import { BRIEF_HEAD, briefBlock, briefFrom, briefProblem, briefWords, isThreadBrief, THREAD_LIMITS } from "../src/core/threads.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";

/**
 * Memory's archive as letters reads it, its threads among the chats' links: `threads` maps a thread to its starter.
 * @param {Record<string, string>} chats @param {Record<string, string>} threads
 */
function archiveOf(chats, threads) {
  /** @type {Map<string, any>} */
  const meta = new Map();
  return {
    meta,
    getChain: (/** @type {string} */ id) => (id in chats ? { title: chats[id] } : null),
    newestTurnN: () => 2,
    metaOf: (/** @type {string} */ id, /** @type {string[]} */ keys) => (id in chats ? Object.fromEntries(keys.filter((k) => meta.get(id)?.[k] !== undefined).map((k) => [k, structuredClone(meta.get(id)[k])])) : null),
    updateMeta: (/** @type {string} */ id, /** @type {(m: any) => void} */ fn) => {
      const m = structuredClone(meta.get(id) || {});
      fn(m);
      meta.set(id, m);
      return m;
    },
    threadsOf: (/** @type {string} */ id) => ({ from: threads[id] ?? null, started: Object.keys(threads).filter((t) => threads[t] === id) }),
  };
}
/** Letters on a stand-in archive; what the registry was handed. @param {Record<string, string>} threads */
function lettersOn(threads) {
  const archive = archiveOf({ a: "Worker", t: "Advisor", u: "Second thread", c: "Elsewhere" }, threads);
  /** @type {{ to: string, d: any }[]} */
  const handed = [];
  let n = 0;
  const letters = createLetters({
    archive: () => archive,
    registry: () => ({ letter: (/** @type {string} */ to, /** @type {any} */ d) => (handed.push({ to, d }), { ok: true, at: "sealed" }) }),
    newId: () => `lt_${String(++n).padStart(8, "0")}`,
  });
  return { letters, archive, handed };
}

describe("a thread's brief, as core/threads.js words it", () => {
  // (fails before: yes — threads are new)
  test("its block names the starter by title and id, says the two are linked and that the person's word comes first; read back, its starter and its words", () => {
    const b = briefBlock({ from: "abc123", title: 'Fix "the" login\nbug', brief: "Review each diff I send you." });
    assert.ok(b.text.startsWith(`${BRIEF_HEAD} "Fix 'the' login bug" (abc123).`), b.text);
    assert.match(b.text, /not the person's words/);
    assert.match(b.text, /envelope tool \(to: "abc123"\), no tag needed/);
    assert.match(b.text, /their word comes before the brief's\.\]\n\nReview each diff I send you\.$/);
    const message = { content: [b] };
    assert.equal(isThreadBrief(message), true);
    assert.equal(briefFrom(message), "abc123");
    assert.equal(briefWords(message), "Review each diff I send you.");
    assert.equal(isThreadBrief({ content: [{ type: "text", text: "Review each diff." }] }), false, "the person's words are no brief");
    assert.equal(briefFrom({ content: "hello" }), null);
    assert.equal(briefProblem("  "), "say what the thread is to do: its brief is its first message");
    assert.match(String(briefProblem("x".repeat(THREAD_LIMITS.brief + 1))), /20000 characters at most/);
    assert.equal(briefProblem("Review."), null);
  });
});

describe("letters between a thread and its starter", () => {
  // (fails before: yes — a thread's starter could not write it without the person's tag, nor it the starter)
  test("each writes the other with no tag; a chat not linked is refused as before; a thread writes no sibling thread", () => {
    const { letters, handed } = lettersOn({ t: "a", u: "a" });
    assert.equal(letters.send("a", { to: "t", subject: "A note", text: "Review this diff, please." }).ok, true, "starter → thread");
    assert.equal(letters.send("t", { to: "a", subject: "A note", text: "Looks right: one nit." }).ok, true, "thread → starter");
    assert.deepEqual(handed.map((h) => h.to), ["t", "a"]);
    const stranger = letters.send("a", { to: "c", subject: "A note", text: "Hello." });
    assert.equal(stranger.ok, false);
    assert.match(stranger.text, /a thread linked to it, and the chat "Elsewhere" \(c\) is none of them/);
    assert.equal(letters.send("t", { to: "u", subject: "A note", text: "Hello, sibling." }).ok, false, "threads of one starter are not linked to each other");
  });

  // (fails before: yes — a thread's letters counted on with nobody's word, its person being its starter's)
  test(`a thread sends at most ${LETTERS_ALONE} letters while nobody writes; the person's message in its starter counts it from none`, () => {
    const { letters } = lettersOn({ t: "a" });
    for (let i = 0; i < LETTERS_ALONE; i++) assert.equal(letters.send("t", { to: "a", subject: "A note", text: `Note ${i}.` }).ok, true);
    const over = letters.send("t", { to: "a", subject: "A note", text: "One more." });
    assert.equal(over.ok, false);
    assert.match(over.text, /20 letters since the developer last wrote in it/);
    letters.heard("a", "Carry on.");
    assert.equal(letters.send("t", { to: "a", subject: "A note", text: "Thanks." }).ok, true, "counted from none");
  });
});

describe("a thread in a running Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-thread-"));
  const S = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** @param {string} path @param {any} [body] @param {string} [method] */
  const call = async (path, body, method = body === undefined ? "GET" : "POST") => {
    const r = await shim.api(path, { method, ...(body === undefined ? {} : { body }) });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: r.status, json, text };
  };
  before(async () => {
    up = await fakeUpstream(async () => anthropicReply("ON IT", { model: "brain-model" }));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // (fails before: yes — a chat could not be made as another's thread, nor linked to it)
  test("made as a thread: an interactive chat linked to its starter both ways; one of a chat that is not there, or a team's, is refused", async () => {
    const sessions = /** @type {any} */ (shim.app).sessions;
    const archive = /** @type {any} */ (shim.app).memory.archive;
    const starter = sessions.create({ cwd: root, model: "agent/brain-model", title: "Worker", preset: "plain" });
    const t = sessions.create({ cwd: root, model: "agent/brain-model", title: "Advisor", preset: "plain", thread: starter.id });
    assert.equal(t.kind, "interactive");
    assert.deepEqual(archive.threadsOf(t.id), { from: starter.id, started: [] });
    assert.deepEqual(archive.threadsOf(starter.id), { from: null, started: [t.id] });
    const second = sessions.create({ cwd: root, model: "agent/brain-model", title: "Reviewer", preset: "plain", thread: t.id });
    assert.deepEqual(archive.threadsOf(second.id).from, t.id, "a thread's thread is linked to its own starter");
    assert.deepEqual(archive.threadsOf(starter.id).started, [t.id], "and not to the first starter");
    assert.throws(() => sessions.create({ cwd: root, model: "agent/brain-model", preset: "plain", thread: "nope00000000" }), { status: 400 });
    assert.throws(() => sessions.create({ cwd: root, model: "agent/brain-model", preset: "plain", kind: "fork", thread: starter.id }), { status: 400 });
    assert.equal((await call(`/api/memory/sessions/${encodeURIComponent(second.id)}/delete`, {})).status, 200);
    assert.deepEqual(archive.threadsOf(t.id).started, [], "a thread deleted takes its link with it");
  });

  // (fails before: yes — a brief went as the person's message: its tags opened chats to letters, and a /set in it ran)
  test("its brief is its first message, drawn as the starter's: never the person's words, a command, nor a second brief", async () => {
    const sessions = /** @type {any} */ (shim.app).sessions;
    const starter = sessions.create({ cwd: root, model: "agent/brain-model", title: "Worker", preset: "plain" });
    const t = sessions.create({ cwd: root, model: "agent/brain-model", title: "Advisor", preset: "plain", thread: starter.id });
    /** The brief as Filament posts it: one block, the words after its head. @param {string} words */
    const briefOf = (words) => [briefBlock({ from: starter.id, title: "Worker", brief: words })];
    const notBrief = await call(`${S(t.id)}/turns`, { content: "Review my work.", thread: true, stream: false });
    assert.deepEqual([notBrief.status, notBrief.json?.error], [400, "a thread's brief turn carries a thread's brief"]);
    const command = await call(`${S(t.id)}/turns`, { content: [briefOf("x")[0], { type: "text", text: "/set loop.permissions auto" }], thread: true, stream: false });
    assert.equal(command.status, 400, command.text);
    assert.match(String(command.json?.error), /one block of Filament's/);
    const other = sessions.create({ cwd: root, model: "agent/brain-model", title: "Elsewhere", preset: "plain" });
    const brief = await call(`${S(t.id)}/turns`, { content: briefOf(`Review each diff I send you. See [Elsewhere](chat:${other.id}).`), thread: true, stream: false });
    assert.equal(brief.status, 200, brief.text);
    const turns = (await call(`${S(t.id)}/transcript`)).json.turns;
    assert.equal(turns.length, 1);
    assert.deepEqual(turns[0].brief, { from: starter.id }, "drawn as the starter's brief");
    const meta = /** @type {any} */ (shim.app).memory.archive.metaOf(t.id, ["letters"]);
    assert.deepEqual(meta?.letters?.tagged || [], [], "a tag in a brief opens no chat to letters: it is not the person's");
    const again = await call(`${S(t.id)}/turns`, { content: briefOf("And another thing."), thread: true, stream: false });
    assert.equal(again.status, 409, again.text);
    assert.match(String(again.json?.error), /its first message, and this chat has turns: write it a letter instead/);
  });
});
