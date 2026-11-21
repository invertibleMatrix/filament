// @ts-check
// What a turn Filament starts by itself carries is not lost when that turn fails (the owner's of 11-11: "delivery is at
// least once"). A turn's message carries what waited untold for the chat's agent — the queued reports and notices, the
// background commands' ends, a come-back's note, the letters its start takes as told — and each was marked told before
// the model was asked. A turn that failed before its model did any work leaves the model's history (shapes.js
// `modelTurnsOf`), so what it carried was told to no one: it goes back to where it waited, untold, for the chat's next
// turn and for a restart's sweep, and the waker wakes the chat again after 1, 5 and 15 minutes — three tries, no more.
// A turn that did work and then failed stays in the history: nothing of it goes back, and nothing is told twice. A turn
// the person stopped is not tried again. On Filament's loop and on a coding agent.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply, FAKE_ACP_AGENT, TEST_ENVIRONMENT } from "./helpers/app.js";
import { gate, removeDirs, until } from "./helpers/wait.js";
import * as hands from "../src/adapters/tools/hands.js";
import * as wakes from "../src/app/sessions/wake.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";

const { createWaker, isWakeMessage } = wakes;
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

describe("the waker tries a failed wake again", () => {
  /**
   * A waker whose posts are taken (200) unless `answer` says otherwise, with what it posted and when, what it said and
   * which chats it let go of. @param {{ againMs?: number[], answer?: (session: string) => Promise<{ status: number, body: any }> | { status: number, body: any }, words?: any }} [o]
   */
  const made = (o = {}) => {
    /** @type {{ session: string, at: number }[]} */
    const posts = [];
    /** @type {string[]} */
    const said = [];
    /** @type {[string, boolean | undefined][]} */
    const idle = [];
    const state = { due: true };
    const waker = createWaker(/** @type {any} */ ({
      post: async (/** @type {string} */ s) => {
        posts.push({ session: s, at: Date.now() });
        return o.answer ? o.answer(s) : { status: 200, body: null };
      },
      due: () => state.due,
      attended: () => false,
      idle: (/** @type {string} */ s, /** @type {boolean | undefined} */ gaveUp) => void idle.push([s, gaveUp]),
      log: (/** @type {string} */ _level, /** @type {string} */ msg) => void said.push(msg),
      settleMs: 1,
      retryMs: 1,
      tries: 3,
      againMs: o.againMs || [60, 120, 180],
      ...(o.words ? { words: o.words } : {}),
    }));
    return { waker: /** @type {any} */ (waker), posts, said, idle, state };
  };
  /** Until the waker posted `n` times. @param {{ posts: unknown[] }} m @param {number} n */
  const posted = (m, n) => until(() => (m.posts.length >= n ? true : null), `post ${n}`, { timeoutMs: 5000 });

  // (fails before: yes — a wake whose turn failed was never sent again: the waker knew only that its post was taken)
  test("the constants: three tries, after 1, 5 and 15 minutes", () => {
    assert.deepEqual([.../** @type {any} */ (wakes).WAKE_AGAIN_MS], [60_000, 5 * 60_000, 15 * 60_000]);
  });

  // (fails before: yes — the same)
  test("a turn that failed before any work is tried again at its time, each wait longer, and no more past the bound", async () => {
    const m = made();
    m.waker.wake("A");
    await posted(m, 1);
    for (const [i, wait] of [60, 120, 180].entries()) {
      m.waker.ended("A", false);
      assert.equal(m.waker.coming("A"), true, "a wake is on its way while it waits");
      await posted(m, i + 2);
      const gap = m.posts[i + 1].at - m.posts[i].at;
      assert.ok(gap >= wait - 5, `try ${i + 1} waits ${wait} ms: ${gap}`);
    }
    assert.equal(m.said.filter((s) => /wakes the chat again in/.test(s)).length, 3, m.said.join("\n"));
    assert.match(m.said.find((s) => /try 1 of 3/.test(s)) || "", /failed before its model did any work; what it carried waits untold again, and Filament wakes the chat again in /);
    // The third try failed too: the bound.
    m.waker.ended("A", false);
    await sleep(400);
    assert.equal(m.posts.length, 4, "the first wake and three tries: no fifth");
    assert.equal(m.waker.coming("A"), false);
    assert.match(m.said.at(-1) || "", /what it carried waits untold for the chat's next turn/, "the log says what is owed waits");
    // Something new that comes still wakes the chat once; its failure starts no tries again.
    m.waker.wake("A");
    await posted(m, 5);
    m.waker.ended("A", false);
    await sleep(400);
    assert.equal(m.posts.length, 5);
    // A turn the history keeps ends the row of failures: the next failure is tried again from the first wait.
    m.waker.ended("A", true);
    m.waker.wake("A");
    await posted(m, 6);
    m.waker.ended("A", false);
    await posted(m, 7);
    assert.ok(m.posts[6].at - m.posts[5].at >= 55, "from the first wait again");
    m.waker.stop();
  });

  // (fails before: yes — the same)
  test("what comes meanwhile does not go ahead of the wait; a kept turn ends the wait at once; nothing owed, no try", async () => {
    const m = made({ againMs: [300] });
    m.waker.wake("A");
    await posted(m, 1);
    m.waker.ended("A", false);
    m.waker.wake("A");
    await sleep(100);
    m.waker.wake("A");
    assert.equal(m.posts.length, 1, "the chat is not woken before its wait is over, whatever came");
    await posted(m, 2);
    assert.ok(m.posts[1].at - m.posts[0].at >= 295, `after the wait: ${m.posts[1].at - m.posts[0].at}`);
    // The person's message carried what waited, and its turn is kept: the wait ends, and nothing is sent.
    const k = made({ againMs: [60_000] });
    k.waker.wake("B");
    await posted(k, 1);
    k.waker.ended("B", false);
    assert.equal(k.waker.coming("B"), true);
    k.state.due = false;
    k.waker.ended("B", true);
    await until(() => (k.waker.pending() === 0 ? true : null), "the wait to end");
    assert.equal(k.posts.length, 1, "nothing waits untold: no wake");
    assert.deepEqual(k.idle, [["B", false]], "the chat is let go of, nothing given up");
    // Nothing that wakes the chat went back: there is no wake to try again.
    const n = made({ againMs: [20] });
    n.state.due = false;
    n.waker.ended("C", false);
    await sleep(120);
    assert.deepEqual([n.posts.length, n.waker.coming("C")], [0, false]);
    for (const x of [m, k, n]) x.waker.stop();
  });

  // (fails before: yes — the turn's failure reached the waker as its post's answer, a 502, and was final)
  test("a failure heard while the wake's post is still on its way (a 502 at the head) is tried again after its wait all the same", async () => {
    const held = gate();
    let n = 0;
    const m = made({ againMs: [80], answer: async () => (++n === 1 ? (await held.promise, { status: 502, body: { error: "agent loop failed: not now" } }) : { status: 200, body: null }) });
    m.waker.wake("A");
    await posted(m, 1);
    m.waker.ended("A", false);
    held.open();
    await posted(m, 2);
    assert.ok(m.posts[1].at - m.posts[0].at >= 75, `after the wait: ${m.posts[1].at - m.posts[0].at}`);
    assert.deepEqual(m.idle, [], "the chat is not let go of between the failure and its try");
    assert.match(m.said.find((s) => /did not go on/.test(s)) || "", /the chat did not go on \(agent loop failed: not now\), and its next turn carries the end$/);
    m.waker.stop();
  });

  // (fails before: yes — the chat it let go of was told nothing of why: a round owed stayed owed when the waker gave up)
  test("the chat it lets go of hears whether the wake was given up: a refusal that is final, a post that threw, a turn that held it throughout — not nothing owed, nor room being made", async () => {
    /** @param {(s: string) => any} answer @param {boolean} [due] */
    const let_go = async (answer, due = true) => {
      const m = made({ answer });
      m.state.due = due;
      m.waker.wake("A");
      await until(() => (m.waker.pending() === 0 ? true : null), "the wake to end");
      m.waker.stop();
      return { idle: m.idle, said: m.said };
    };
    assert.deepEqual((await let_go(() => ({ status: 409, body: { error: "a question waits", wake: "asking" } }))).idle, [["A", true]], "a final refusal");
    assert.deepEqual((await let_go(() => { throw new Error("the door is shut"); })).idle, [["A", true]], "the post threw");
    assert.deepEqual((await let_go(() => ({ status: 409, body: { wake: "held" } }))).idle, [["A", true]], "held throughout");
    assert.deepEqual((await let_go(() => ({ status: 200, body: null }), false)).idle, [["A", false]], "nothing owed");
    const room = await let_go(() => ({ status: 409, body: { error: wakes.WAKE_ROOM, wake: "room" } }));
    assert.deepEqual(room.idle, [["A", false]], "room is being made: its end asks again, nothing is given up");
    assert.ok(!room.said.some((s) => /next turn carries the end/.test(s)), `the room's refusal says only itself: ${room.said.join("\n")}`);
  });

  // (fails before: yes — a goal's round was logged as "what the agent waited on came … its next turn carries the end")
  test("its log lines say what is so: a turn sent is a turn begun, and a waker of another kind says its own", async () => {
    const m = made();
    m.waker.wake("A");
    await posted(m, 1);
    await until(() => (m.said.length ? true : null), "its line");
    assert.equal(m.said[0], "sessions: what the agent waited on came in A; Filament sent the chat its turn");
    const g = made({ words: { came: (/** @type {string} */ s) => `a goal's next round is owed to ${s}`, waits: "the end of its next turn decides the round again" }, answer: () => ({ status: 409, body: { error: "lost the race", wake: undefined } }) });
    g.waker.wake("B");
    await until(() => (g.waker.pending() === 0 ? true : null), "the wake to end");
    assert.equal(g.said[0], "sessions: a goal's next round is owed to B; the chat did not go on (lost the race), and the end of its next turn decides the round again");
    for (const x of [m, g]) x.waker.stop();
  });
});

describe("what a turn told goes back untold", () => {
  const h = /** @type {any} */ (hands);
  // (fails before: yes — an end told with a turn was gone for good, whatever became of the turn)
  test("the shells' ends, a come-back's note: back ahead of what came since, each once, with what the cap had let go", () => {
    const owner = { session: `carried-${Math.random().toString(36).slice(2, 8)}`, agent: null };
    /** @type {string[]} */
    const heard = [];
    const stop = hands.onUntoldChange((s) => void heard.push(s));
    try {
      hands.tellLater(owner, { id: "e1", command: "npm test", code: 1, text: "[end one]" }, { wake: false });
      hands.tellLater(owner, { id: "w1", command: "", code: null, text: "[the note]", kind: "wake" }, { wake: false });
      const due = hands.peekShellExits(owner);
      const told = hands.tellShellExits(owner, due.map((x) => x.id));
      assert.deepEqual(hands.untoldOf(owner.session), [], "told");
      assert.deepEqual(/** @type {any} */ (told)?.items.map((/** @type {any} */ x) => [x.id, x.kind]), [["e1", "exit"], ["w1", "wake"]], "what it took, as it waited");
      hands.tellLater(owner, { id: "e2", command: "npm run build", code: 0, text: "[end two]" }, { wake: false });
      heard.length = 0;
      h.untellShellExits(owner, told);
      assert.deepEqual(hands.peekShellExits(owner).map((x) => x.text), ["[end one]", "[the note]", "[end two]"], "ahead of what came since");
      assert.deepEqual(heard, [owner.session], "the chat's keeper hears it: a restart knows it owed");
      h.untellShellExits(owner, told);
      assert.equal(hands.untoldOf(owner.session).length, 3, "each once");
      // What the cap had let go, said ahead of the first: said again.
      const many = { session: `${owner.session}-many`, agent: null };
      for (let i = 0; i < 22; i++) hands.tellLater(many, { id: `m${i}`, command: "c", code: 0, text: `[m${i}]` }, { wake: false });
      const first = hands.peekShellExits(many);
      assert.match(first[0].text, /^\[Filament: 2 earlier background items/);
      const all = hands.tellShellExits(many, first.map((x) => x.id));
      assert.equal(/** @type {any} */ (all)?.lost, 2);
      h.untellShellExits(many, all);
      assert.match(hands.peekShellExits(many)[0].text, /^\[Filament: 2 earlier background items/, "what went untold is said again");
      hands.tellShellExits(many, hands.peekShellExits(many).map((x) => x.id));
    } finally {
      stop();
      hands.tellShellExits(owner, hands.peekShellExits(owner).map((x) => x.id));
    }
  });

  /** A registry with no launches (as test/wake-says-what-came.test.js makes one). @param {{ saved?: any[] }} [o] */
  const registryOf = (o = {}) => {
    /** @type {string[]} */
    const woken = [];
    /** @type {{ saved: any[] }} */
    const kept = { saved: o.saved || [] };
    const registry = createSubagentRegistry(/** @type {any} */ ({
      config: () => ({ agentLoop: {} }),
      log: () => {},
      events: { publish: () => {} },
      runs: null,
      now: Date.now,
      context: {
        settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }] }, loop: { permissions: "edit" } }),
        session: () => ({ cwd: tmpdir(), model: "m", projectId: "p1" }),
        view: async () => ({ text: "", turns: 0 }),
        brief: async () => null,
        modelProblem: () => null,
        mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
        reportWaits: (/** @type {string} */ chain) => void woken.push(chain),
        saveQueue: (/** @type {string} */ _c, /** @type {any[]} */ q) => void (kept.saved = q),
        loadQueue: () => kept.saved,
      },
      call: async () => {
        throw new Error("no launch here");
      },
    }));
    return { registry: /** @type {any} */ (registry), woken, kept };
  };
  const word = (/** @type {string} */ text, /** @type {any} */ about = null) => ({ text, from: "", description: "the task graph", spends: [], wrote: false, wakes: true, ...(about ? { about } : {}) });

  // (fails before: yes — a message its turn took left the queue for good)
  test("the queued messages: back ahead of what came since, with the wake each owed, kept for a restart; a worker's question is not asked again", () => {
    const { registry, woken, kept } = registryOf();
    registry.tell("c", word("[Filament: t1's check failed]", "check"));
    registry.tell("c", word("[Filament: t2 is done]"));
    const sent = registry.peekQueued("c");
    registry.ackQueued("c", sent);
    assert.deepEqual([registry.queued("c"), registry.reportsDue("c"), kept.saved.length], [0, false, 0], "told");
    registry.tell("c", word("[Filament: t3 merged]", "merge"));
    woken.length = 0;
    registry.backQueued("c", [...sent, { text: "which way?", from: "sa_1", description: "Worker", kind: "ask", ask: 1, spends: [], wrote: false }]);
    assert.deepEqual(registry.peekQueued("c").map((/** @type {any} */ d) => d.text), ["[Filament: t1's check failed]", "[Filament: t2 is done]", "[Filament: t3 merged]"], "ahead of what came since; the question went with its turn");
    assert.deepEqual([registry.reportsDue("c"), registry.dueKinds("c")], [true, ["check", "report", "merge"]], "each wakes the chat as it did");
    assert.deepEqual(kept.saved.map((d) => [d.wakes, d.about]), [[true, "check"], [true, undefined], [true, "merge"]], "kept for a restart");
    assert.deepEqual(woken, [], "it wakes nothing by itself: the waker tries again at its time");
    registry.backQueued("c", sent);
    assert.equal(registry.queued("c"), 3, "each once");
  });

  // (fails before: yes — a letter's wake went as its turn began, whatever became of the turn)
  test("a letter the turn's start took as told: it wakes the chat again, and is told as new again", () => {
    const { registry } = registryOf();
    assert.deepEqual(registry.letter("c", { text: "The letter.", from: "chat-b", description: "Chat B", sender: 'the chat "B"', subject: "A question" }), { ok: true, at: "sealed" });
    assert.equal(registry.lettersDue("c"), true);
    const owed = registry.lettersOwed("c");
    assert.deepEqual(owed, [{ n: 1, wakes: true, fresh: true }]);
    const door = registry.openTurn({ chainId: "c", runId: "turn-1", cwd: tmpdir(), mode: "edit", model: "m", thinking: null, fork: null });
    assert.equal(door.inbox.fresh([1]).length, 1, "the turn's start lists it");
    door.close();
    assert.deepEqual([registry.lettersDue("c"), registry.lettersOwed("c")], [false, []], "told, and it wakes nothing more");
    registry.backQueued("c", [], owed);
    assert.deepEqual([registry.lettersDue("c"), registry.lettersOwed("c")], [true, owed], "owed its wake and its telling again");
    assert.deepEqual(registry.envelopes("c").map((/** @type {any} */ e) => e.n), [1], "still sealed, in its place");
  });
});

const NOT_NOW = { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "not now" } } };
const said = (/** @type {string} */ t) => anthropicReply("", { model: "brain-model", stop: "end_turn", blocks: [{ type: "text", text: t }], usage: { input_tokens: 30, output_tokens: 7 } });
const lastOf = (/** @type {any} */ call) => call.body?.messages?.at(-1);
const wordsOf = (/** @type {any} */ m) => JSON.stringify(m ?? "");

/**
 * A Filament whose chats run its loop on a fake model the test scripts (`brain`), with what waits for a chat and how it
 * stands. `againMs`: the waker's waits, the app's own (1, 5 and 15 minutes) where none is given.
 * @param {{ againMs?: number[] }} [o]
 */
const loopApp = async ({ againMs } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "filament-wake-back-"));
  writeFileSync(join(root, "note.txt"), "a note\n");
  const state = {
    /** The model, as the test at hand scripts it. @type {(call: any) => any} */
    brain: (_call) => said("HI"),
    /** The agent's requests whose newest message is a wake's, when each came. @type {{ at: number, words: string }[]} */
    wakes: /** @type {{ at: number, words: string }[]} */ ([]),
    /** This machine as the loop reads it when a chat's first turn starts, which the test at hand may hold. @type {(root: string) => Promise<any>} */
    environment: TEST_ENVIRONMENT,
  };
  const up = await fakeUpstream(async (call) => {
    if (call.kind !== "anthropic") return undefined;
    if (!call.body?.tools?.length) return said("A title");
    if (isWakeMessage(lastOf(call))) state.wakes.push({ at: Date.now(), words: wordsOf(lastOf(call)) });
    return state.brain(call);
  });
  const shim = await startApp({
    memory: true,
    environment: (root) => state.environment(root),
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.memory.autopilot = { enabled: false };
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
    },
    ...(againMs ? { overrides: { wakeAgainMs: againMs } } : {}),
  });
  const at = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  return {
    state,
    up,
    shim,
    root,
    create: async () => {
      const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { subagents: { worktree: false } } } });
      if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
      return String((await r.json()).id);
    },
    /** @param {string} id @param {string} content */
    send: (id, content) => shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: false } }),
    /** @param {string} id */
    transcript: async (id) => /** @type {any} */ (await (await shim.api(`${at(id)}/transcript`)).json()),
    /** How many messages wait for the chat's next turn. @param {string} id */
    queued: async (id) => Number((await (await shim.api(`${at(id)}/subagents`)).json()).queued),
    /** A graph's word told the chat's agent while no turn runs, as the graph runner tells it: it wakes the chat. @param {string} id @param {string} text */
    report: (id, text) => /** @type {any} */ (shim.app).subagents.tell(id, { text, from: "", description: "the task graph", spends: [], wrote: false, wakes: true }),
    /** Until no turn of the chat runs. @param {string} id */
    rests: (id) => until(() => (/** @type {any} */ (shim.app).sessions.running().includes(id) ? null : true), "the chat's turn to end", { timeoutMs: 20_000 }),
    /** The wakes whose message says `mark`. @param {string} mark */
    wakesOf: (mark) => state.wakes.filter((w) => w.words.includes(mark)),
    stop: async () => {
      await shim.stop();
      await up.close();
      await removeDirs(shim.dataDir, root);
    },
  };
};

describe("a chat on Filament's loop: a wake's turn that fails", () => {
  /** @type {Awaited<ReturnType<typeof loopApp>>} */
  let app;
  before(async () => {
    app = await loopApp();
  });
  after(() => app.stop());

  // (fails before: yes — the review of 11-11: the report left the queue before the model was asked, the failed turn left
  // the model's history, and no later turn carried it: the agent never read it)
  test("its first model request fails: the report waits again, untold, kept for a restart, and the chat's next message holds it — once", async () => {
    const id = await app.create();
    assert.equal((await app.send(id, "hello")).status, 200);
    let fails = 1;
    app.state.brain = (call) => (isWakeMessage(lastOf(call)) && fails-- > 0 ? NOT_NOW : said(wordsOf(lastOf(call)).includes("REPORT-ONE") ? "READ IT" : "HI"));
    app.report(id, "[Filament: t1 is done: REPORT-ONE]");
    await until(() => (app.wakesOf("REPORT-ONE").length === 1 ? true : null), "the wake's request", { timeoutMs: 20_000 });
    await app.rests(id);
    assert.equal(await app.queued(id), 1, "the report waits again for the chat's next turn");
    const kept = /** @type {any} */ (app.shim.app).sessions.loadSubagentQueue(id);
    assert.deepEqual(kept.map((/** @type {any} */ d) => [d.text.includes("REPORT-ONE"), d.wakes]), [[true, true]], "kept with the chat, its wake owed: a restart's sweep knows it");
    const r = await app.send(id, "what came?");
    assert.equal(r.status, 200, await r.clone().text());
    assert.match(wordsOf(await r.json()), /READ IT/);
    const turn = (await app.transcript(id)).turns.at(-1);
    const user = wordsOf(turn.user);
    assert.ok(user.includes("REPORT-ONE") && user.indexOf("REPORT-ONE") < user.indexOf("what came?"), `the next turn's message holds the report, ahead of the person's words: ${user}`);
    assert.equal(await app.queued(id), 0, "told now");
    const heard = app.up.received.filter((c) => c.kind === "anthropic" && c.body?.tools?.length && wordsOf(lastOf(c)).includes("what came?")).at(-1);
    assert.equal(wordsOf(heard?.body.messages).split("REPORT-ONE").length - 1, 1, "the model reads it once");
    await sleep(1200);
    assert.equal(app.wakesOf("REPORT-ONE").length, 1, "the person's message carried it: the chat is not woken for it again");
  });

  // (fails before: no — a turn the person stops stays in the history, Filament's line its reply, and what it carried
  // with it; this pins that nothing of such a turn goes back, and that the chat is not woken again after their Stop)
  test("the person stops the wake's turn before its model answers: the history keeps the turn and what it carried — nothing goes back, the chat is not woken again, and their next message's request holds the report once", async () => {
    const id = await app.create();
    assert.equal((await app.send(id, "hello")).status, 200);
    const reached = gate();
    const go = gate();
    app.state.brain = async (call) => {
      if (!isWakeMessage(lastOf(call))) return said("HI");
      reached.open();
      await go.promise;
      return said("TOO LATE");
    };
    hands.tellLater({ session: id, agent: null }, { id: `cb_${id}`, command: "", code: null, kind: "wake", text: "[Filament: the time you set has come. Your note: NOTE-TWO]" });
    app.report(id, "[Filament: t1 is done: REPORT-TWO]");
    await reached.promise;
    const stop = await app.shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200, await stop.clone().text());
    await app.rests(id);
    go.open();
    const stopped = (await app.transcript(id)).turns.at(-1);
    assert.deepEqual([stopped.woke, !!stopped.stopped, !!stopped.final], [true, true, true], "the stopped turn is kept, Filament's line its reply");
    assert.equal(await app.queued(id), 0, "the history holds the report: nothing goes back");
    assert.deepEqual(hands.untoldOf(id), [], "nor the come-back's note");
    app.state.brain = () => said("HI");
    await sleep(1500);
    assert.equal(app.wakesOf("REPORT-TWO").length, 1, "a turn the person stopped is not tried again");
    const r = await app.send(id, "go on");
    assert.equal(r.status, 200, await r.clone().text());
    const heard = app.up.received.filter((c) => c.kind === "anthropic" && c.body?.tools?.length && wordsOf(lastOf(c)).includes("go on")).at(-1);
    assert.deepEqual(["REPORT-TWO", "NOTE-TWO"].map((w) => wordsOf(heard?.body.messages).split(w).length - 1), [1, 1], "their next message's request holds each once, in the stopped turn's message");
  });
});

describe("a chat on Filament's loop: the wake is tried again", () => {
  const AGAIN = [400, 800, 1200];
  /** @type {Awaited<ReturnType<typeof loopApp>>} */
  let app;
  before(async () => {
    app = await loopApp({ againMs: AGAIN });
  });
  after(() => app.stop());

  // (fails before: yes — a wake whose turn failed was sent once, and the chat sat until the person wrote)
  test("each try at its time, the waits growing; past the third the chat is woken no more, and its next message holds the report", async () => {
    const id = await app.create();
    assert.equal((await app.send(id, "hello")).status, 200);
    app.state.brain = (call) => (isWakeMessage(lastOf(call)) ? NOT_NOW : said(wordsOf(lastOf(call)).includes("REPORT-3") ? "READ IT" : "HI"));
    app.report(id, "[Filament: t1 is done: REPORT-3]");
    await until(() => (app.wakesOf("REPORT-3").length === 4 ? true : null), "the wake and its three tries", { timeoutMs: 30_000 });
    const at = app.wakesOf("REPORT-3").map((w) => w.at);
    const gaps = [at[1] - at[0], at[2] - at[1], at[3] - at[2]];
    for (const [i, wait] of AGAIN.entries()) assert.ok(gaps[i] >= wait - 20, `try ${i + 1} comes ${wait} ms after the failure before it, not sooner: ${gaps.join(", ")}`);
    await app.rests(id);
    await sleep(AGAIN[2] + 1200);
    assert.equal(app.wakesOf("REPORT-3").length, 4, "the bound: no fourth try");
    assert.equal(await app.queued(id), 1, "what is owed waits for the chat's next turn");
    const r = await app.send(id, "what came?");
    assert.equal(r.status, 200, await r.clone().text());
    const user = wordsOf((await app.transcript(id)).turns.at(-1).user);
    assert.ok(user.includes("REPORT-3"), user);
    assert.equal(await app.queued(id), 0);
  });

  // (fails before: yes — the same)
  test("a try that goes through carries the report: the agent reads it once, and nothing waits", async () => {
    const id = await app.create();
    assert.equal((await app.send(id, "hello")).status, 200);
    let fails = 1;
    app.state.brain = (call) => (isWakeMessage(lastOf(call)) && wordsOf(lastOf(call)).includes("REPORT-4") && fails-- > 0 ? NOT_NOW : said(wordsOf(lastOf(call)).includes("REPORT-4") ? "WEIGHED" : "HI"));
    app.report(id, "[Filament: t1 is done: REPORT-4]");
    const tr = await until(async () => {
      const t = await app.transcript(id);
      const woke = (t.turns || []).filter((/** @type {any} */ x) => x.woke && x.final);
      return woke.length ? t : null;
    }, "the try's turn to answer", { timeoutMs: 30_000 });
    assert.equal(app.wakesOf("REPORT-4").length, 2, "the wake that failed, and one try");
    const carried = tr.turns.filter((/** @type {any} */ t) => wordsOf(t.user).includes("REPORT-4") && t.final);
    assert.deepEqual(carried.map((/** @type {any} */ t) => [t.woke, /WEIGHED/.test(wordsOf(t.final))]), [[true, true]], "one answered turn of the chat holds it, Filament's own, and the agent read it");
    assert.equal(await app.queued(id), 0, "nothing waits any more");
    const heard = app.up.received.filter((c) => c.kind === "anthropic" && c.body?.tools?.length && wordsOf(lastOf(c)).includes("REPORT-4")).at(-1);
    assert.equal(wordsOf(heard?.body.messages).split("REPORT-4").length - 1, 1, "the model reads it once");
  });

  // (fails before: no — a turn that failed after doing work kept its message, and nothing of it came back; this pins
  // that what went back for a turn that did none does not go back for one that did)
  test("a wake's turn that did work and then failed keeps the report in the history: it does not go back, the chat is not woken again, and no later request holds it twice", async () => {
    const id = await app.create();
    assert.equal((await app.send(id, "hello")).status, 200);
    app.state.brain = (call) => {
      const last = wordsOf(lastOf(call));
      if (isWakeMessage(lastOf(call))) return anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "r1", name: "read", input: { path: "note.txt" } }], usage: { input_tokens: 30, output_tokens: 7 } });
      if (last.includes("tool_result")) return NOT_NOW;
      return said("HI");
    };
    app.report(id, "[Filament: t1 is done: REPORT-5]");
    await until(() => (app.up.received.some((c) => wordsOf(lastOf(c)).includes("tool_result") && wordsOf(c.body.messages).includes("REPORT-5")) ? true : null), "the request that fails after the turn's call", { timeoutMs: 20_000 });
    await app.rests(id);
    const failed = (await app.transcript(id)).turns.at(-1);
    assert.ok(failed.woke && failed.failed && failed.work.length > 0, `the turn failed after doing work: ${wordsOf(failed).slice(0, 400)}`);
    assert.equal(await app.queued(id), 0, "the history keeps the turn, and its report with it: nothing goes back");
    await sleep(AGAIN[0] + 1000);
    assert.equal(app.wakesOf("REPORT-5").length, 1, "and the chat is not woken again for it");
    app.state.brain = () => said("HI");
    const r = await app.send(id, "and now?");
    assert.equal(r.status, 200, await r.clone().text());
    const heard = app.up.received.filter((c) => c.kind === "anthropic" && c.body?.tools?.length && wordsOf(lastOf(c)).includes("and now?")).at(-1);
    assert.equal(wordsOf(heard?.body.messages).split("REPORT-5").length - 1, 1, "the report is in the history once: no second copy rides the next message");
  });

  // (fails before: yes — a Stop that comes before the loop's run began cancels the turn, and nothing of it is kept: the
  // report was gone with it)
  test("their Stop cancels the wake's turn before its agent's run began: nothing of the turn is kept, so the report waits for their next message — the come-back's note goes with their Stop —, and the chat is not woken again", async () => {
    const id = await app.create();
    const reached = gate();
    const go = gate();
    let held = false;
    hands.tellLater({ session: id, agent: null }, { id: `cb_${id}`, command: "", code: null, kind: "wake", text: "[Filament: the time you set has come. Your note: NOTE-SIX]" });
    app.report(id, "[Filament: t1 is done: REPORT-SIX]");
    // The loop reads this machine as the chat's first turn starts: after the turn took what waited, before its run is
    // there for a Stop to reach.
    app.state.environment = async (root) => {
      if (!held && /** @type {any} */ (app.shim.app).subagents.queued(id) === 0) {
        held = true;
        reached.open();
        await go.promise;
      }
      return TEST_ENVIRONMENT(root);
    };
    try {
      await reached.promise;
      const stop = await app.shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
      assert.equal(stop.status, 200, await stop.clone().text());
      assert.equal((await stop.json()).stopped, "cancelled", "no run yet: the session's stop cancels the turn");
      go.open();
      await app.rests(id);
      assert.equal(((await app.transcript(id)).turns || []).filter((/** @type {any} */ t) => t.final).length, 0, "nothing of the turn is kept");
      assert.equal(await app.queued(id), 1, "the report waits for their next message");
      assert.deepEqual(hands.untoldOf(id), [], "their Stop dropped the come-back: its note does not come back");
      await sleep(AGAIN[0] + 1000);
      assert.deepEqual([app.wakesOf("REPORT-SIX").length, await app.queued(id)], [0, 1], "the model was asked nothing, and a turn the person stopped is not tried again");
    } finally {
      go.open();
      app.state.environment = TEST_ENVIRONMENT;
    }
    app.state.brain = () => said("HI");
    const r = await app.send(id, "go on");
    assert.equal(r.status, 200, await r.clone().text());
    const user = wordsOf((await app.transcript(id)).turns.at(-1).user);
    assert.ok(user.includes("REPORT-SIX") && !user.includes("NOTE-SIX"), `their next message carries the report, not the come-back's note: ${user}`);
    assert.equal(await app.queued(id), 0, "told now");
  });
});

// What the loop itself takes as it builds a turn's first request (agent/turn.js `shellNews`, `fileNews`): the ends that
// came for its agent since the sessions service told its own, and the files it read that changed since. A first request
// no reply comes to — a usage wall, a sign-in, a 4xx — told the model nothing: the ends wait again, and no sighting moved.
describe("a chat on Filament's loop: what the loop took for a first request that fails", () => {
  /** @type {Awaited<ReturnType<typeof loopApp>>} */
  let app;
  before(async () => {
    app = await loopApp();
  });
  after(() => app.stop());
  /** The agent's requests whose newest message says `mark`. @param {string} mark */
  const requestsOf = (mark) => app.up.received.filter((c) => c.kind === "anthropic" && c.body?.tools?.length && wordsOf(lastOf(c)).includes(mark));

  // (fails before: yes — the loop took the end as told while it built the request, the request was refused, the failed
  // turn left the model's history, and no later turn carried the end: the agent never heard its command ended)
  test("a command's end that came between the service's telling and the loop's first request waits again, untold, and the next message carries it — once", async () => {
    const id = await app.create();
    const owner = { session: id, agent: null };
    let came = false;
    // The loop reads this machine as the chat's first turn starts: after the service told what waited, before the loop
    // builds its first request.
    app.state.environment = async (root) => {
      if (!came) {
        came = true;
        hands.tellLater(owner, { id: `bg_${id}`, command: "npm run build", code: 0, text: "[Filament: background shell END-IN-THE-GAP exited with code 0]" }, { wake: false });
      }
      return TEST_ENVIRONMENT(root);
    };
    try {
      app.state.brain = () => NOT_NOW;
      const failed = await app.send(id, "first message");
      assert.ok(failed.status >= 400, `the turn failed: HTTP ${failed.status}`);
      await app.rests(id);
      assert.equal(came, true);
      assert.equal(requestsOf("first message").length, 1, "one request, refused");
      assert.ok(wordsOf(lastOf(requestsOf("first message")[0])).includes("END-IN-THE-GAP"), "the refused request carried the end");
      assert.deepEqual(hands.untoldOf(id).map((x) => x.id), [`bg_${id}`], "no reply came to it: the end waits again, untold");
    } finally {
      app.state.environment = TEST_ENVIRONMENT;
    }
    app.state.brain = () => said("HI");
    const r = await app.send(id, "second message");
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(wordsOf(lastOf(requestsOf("second message")[0])).split("END-IN-THE-GAP").length - 1, 1, "the next message's request carries it once");
    assert.deepEqual(hands.untoldOf(id), [], "told now");
    // A reply came to that request: the end is told, and nothing brings it back.
    const again = await app.send(id, "third message");
    assert.equal(again.status, 200, await again.clone().text());
    assert.equal(wordsOf(requestsOf("third message")[0].body.messages).split("END-IN-THE-GAP").length - 1, 1, "once in the history, never a second time");
    assert.deepEqual(hands.untoldOf(id), []);
  });

  // (fails before: yes — the same: the end the loop took was gone with a turn the person stopped before its model answered,
  // whose kept message holds only what the service put on it)
  test("the person stops the turn before its model answers: the end the loop took waits again for their next message; a come-back's note it took goes with their Stop", async () => {
    const id = await app.create();
    const owner = { session: id, agent: null };
    const reached = gate();
    const go = gate();
    let came = false;
    app.state.environment = async (root) => {
      if (!came) {
        came = true;
        hands.tellLater(owner, { id: `bg_${id}`, command: "npm test", code: 1, text: "[Filament: background shell END-BEFORE-STOP exited with code 1]" }, { wake: false });
        hands.tellLater(owner, { id: `cb_${id}`, command: "", code: null, kind: "wake", text: "[Filament: the time you set has come. Your note: NOTE-BEFORE-STOP]" }, { wake: false });
      }
      return TEST_ENVIRONMENT(root);
    };
    try {
      app.state.brain = async () => {
        reached.open();
        await go.promise;
        return said("TOO LATE");
      };
      const sent = app.send(id, "seventh message").then((r) => r.text()).catch(() => "");
      await reached.promise;
      assert.ok(wordsOf(lastOf(requestsOf("seventh message")[0])).includes("END-BEFORE-STOP"), "the request carried the end");
      const stop = await app.shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
      assert.equal(stop.status, 200, await stop.clone().text());
      await app.rests(id);
      go.open();
      await sent;
      assert.deepEqual(hands.untoldOf(id).map((x) => x.id), [`bg_${id}`], "the end waits again; the come-back's note went with their Stop");
    } finally {
      go.open();
      app.state.environment = TEST_ENVIRONMENT;
    }
    app.state.brain = () => said("HI");
    const r = await app.send(id, "eighth message");
    assert.equal(r.status, 200, await r.clone().text());
    const heard = wordsOf(requestsOf("eighth message")[0].body.messages);
    assert.deepEqual(["END-BEFORE-STOP", "NOTE-BEFORE-STOP"].map((w) => heard.split(w).length - 1), [1, 0], "their next message's request holds the end once, and no note");
    assert.deepEqual(hands.untoldOf(id), [], "told now");
  });

  // (fails before: yes — the loop moved the file's sighting as it built the request: the refused request was the only
  // one that named the change, and the agent's next write of the file went over the person's edit unasked)
  test("a file the agent read that changed since: a first request that fails moves no sighting, and the next turn's request says the change", async () => {
    const id = await app.create();
    app.state.brain = (call) =>
      wordsOf(lastOf(call)).includes("tool_result") ? said("READ") : anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "r1", name: "read", input: { path: "note.txt" } }], usage: { input_tokens: 30, output_tokens: 7 } });
    const read = await app.send(id, "read the note");
    assert.equal(read.status, 200, await read.clone().text());
    writeFileSync(join(app.root, "note.txt"), "a note, CHANGED-BY-HAND\n");
    try {
      app.state.brain = () => NOT_NOW;
      const failed = await app.send(id, "fourth message");
      assert.ok(failed.status >= 400, `the turn failed: HTTP ${failed.status}`);
      await app.rests(id);
      assert.ok(wordsOf(lastOf(requestsOf("fourth message")[0])).includes("CHANGED-BY-HAND"), "the refused request named the change");
      app.state.brain = () => said("HI");
      const r = await app.send(id, "fifth message");
      assert.equal(r.status, 200, await r.clone().text());
      const heard = wordsOf(lastOf(requestsOf("fifth message")[0]));
      assert.ok(heard.includes("you read changed since") && heard.includes("CHANGED-BY-HAND"), `the next turn's request says the change: ${heard}`);
      // A reply came to that one: the change is told, and the turn after says none.
      const after = await app.send(id, "sixth message");
      assert.equal(after.status, 200, await after.clone().text());
      assert.equal(wordsOf(lastOf(requestsOf("sixth message")[0])).includes("you read changed since"), false, "told once");
    } finally {
      writeFileSync(join(app.root, "note.txt"), "a note\n");
    }
  });
});

describe("a chat on a coding agent: a wake's turn that fails", () => {
  const AGAIN = [400, 800, 1200];
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-wake-back-agent-"));
  const projDir = join(root, "project");
  /** The session methods the slow agent is sent, and the prompts, a line each. */
  const slowCalls = join(root, "slow-calls.jsonl");
  const slowPrompts = join(root, "slow-prompts.jsonl");
  const linesOf = (/** @type {string} */ file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  before(async () => {
    mkdirSync(projDir);
    /** @param {Record<string, string>} env */
    const acp = (env) => ({ command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", ...env }, cwdDefault: projDir, permissions: "allow-all", hints: false });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "claude", name: "claude", type: "acp", acp: acp({}) },
          // An agent that takes a while to open a session, so a Stop can come before any prompt of the turn.
          { id: "slow", name: "slow", type: "acp", acp: acp({ FAKE_ACP_LOG: slowPrompts, FAKE_ACP_CALLS: slowCalls, FAKE_ACP_SLOW_NEW_MS: "1500" }) },
        ];
        cfg.routes = [
          { match: "claude/*", upstream: "claude", upstreamModel: "{1}", enabled: true },
          { match: "slow/*", upstream: "slow", upstreamModel: "{1}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
      },
      overrides: { wakeAgainMs: AGAIN },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });
  const at = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** @param {string} id */
  const transcript = async (id) => /** @type {any} */ (await (await shim.api(`${at(id)}/transcript`)).json());

  // (fails before: yes — the coding agents' turns take the same path: the report left the queue before the agent was
  // prompted, its failed prompt left Filament's copy of the chat, and nothing carried it again)
  test("the agent fails the wake's prompt before it does anything: the report waits again, and the try that follows carries it — one turn of the chat, read once", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "claude/haiku", preset: "plain" } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    // `~failsecond`: the agent's session fails its next prompt, overloaded, before any output (fixtures/fake-acp-agent.mjs).
    const first = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "~failsecond hello", stream: false } });
    assert.equal(first.status, 200, await first.clone().text());
    const app = /** @type {any} */ (shim.app);
    app.subagents.tell(id, { text: "[Filament: t1 is done: REPORT-ACP]", from: "", description: "the task graph", spends: [], wrote: false, wakes: true });
    // The failed prompt's turn: the chat's second, open, with no work — out of the history.
    const failed = await until(async () => {
      const t = await transcript(id);
      return (t.turns || []).length >= 2 && !app.sessions.running().includes(id) ? t.turns.at(-1) : null;
    }, "the wake's turn to fail", { timeoutMs: 30_000 });
    assert.deepEqual([failed.woke, !!failed.final, (failed.work || []).length], [true, false, 0], "the agent did nothing in it");
    assert.equal(app.subagents.queued(id), 1, "the report waits again, untold");
    const tr = await until(async () => {
      const t = await transcript(id);
      return (t.turns || []).some((/** @type {any} */ x) => x.woke && x.final) ? t : null;
    }, "the try's turn to answer", { timeoutMs: 30_000 });
    const carried = tr.turns.filter((/** @type {any} */ t) => JSON.stringify(t.user).includes("REPORT-ACP") && t.final);
    assert.deepEqual(carried.map((/** @type {any} */ t) => t.woke), [true], "one answered turn of the chat holds the report, Filament's own");
    assert.equal(app.subagents.queued(id), 0, "nothing waits any more");
  });

  // (fails before: no — as on the loop: a turn the person stops stays in the history with what it carried)
  test("the person stops the wake's turn while the agent works on it: the history keeps the turn and what it carried, nothing goes back, and the chat is not woken again", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "claude/haiku", preset: "plain" } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    const first = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    assert.equal(first.status, 200, await first.clone().text());
    const app = /** @type {any} */ (shim.app);
    hands.tellLater({ session: id, agent: null }, { id: `cb_${id}`, command: "", code: null, kind: "wake", text: "[Filament: the time you set has come. Your note: NOTE-STOP]" });
    // `~waitfor <file>`: the agent's prompt waits for a file that never comes, until it is cancelled.
    app.subagents.tell(id, { text: `[Filament: t1 is done: REPORT-STOP ~waitfor ${join(root, "never")}]`, from: "", description: "the task graph", spends: [], wrote: false, wakes: true });
    await until(() => (app.sessions.running().includes(id) ? true : null), "the wake's turn", { timeoutMs: 20_000 });
    await sleep(500);
    const stop = await shim.api(`${at(id)}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200, await stop.clone().text());
    await until(() => (app.sessions.running().includes(id) ? null : true), "the turn to end", { timeoutMs: 20_000 });
    const turns = (await transcript(id)).turns;
    const stopped = turns.at(-1);
    assert.deepEqual([turns.length, stopped.woke, !!stopped.stopped, !!stopped.final], [2, true, true, true], "the stopped turn is kept, Filament's line its reply");
    assert.ok(["REPORT-STOP", "NOTE-STOP"].every((w) => JSON.stringify(stopped.user).includes(w)), "with what it carried");
    assert.deepEqual([app.subagents.queued(id), hands.untoldOf(id)], [0, []], "nothing goes back");
    await sleep(AGAIN[0] + 1000);
    assert.equal((await transcript(id)).turns.length, 2, "a turn the person stopped is not tried again");
  });

  // (fails before: no — a Stop that comes before the agent was prompted keeps the turn too, Filament's line its reply:
  // the agent never read what it carried, and this pins that its next prompt brings it)
  test("their Stop comes while the agent's session is still being readied: the history keeps the turn and what it carried, the chat is not woken again, and the agent reads the report with their next message — once", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "slow/haiku", preset: "plain" } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    const app = /** @type {any} */ (shim.app);
    hands.tellLater({ session: id, agent: null }, { id: `cb_${id}`, command: "", code: null, kind: "wake", text: "[Filament: the time you set has come. Your note: NOTE-EARLY]" });
    app.subagents.tell(id, { text: "[Filament: t1 is done: REPORT-EARLY]", from: "", description: "the task graph", spends: [], wrote: false, wakes: true });
    await until(() => (linesOf(slowCalls).some((c) => c.method === "session/new") ? true : null), "the agent to be readying the session", { timeoutMs: 20_000 });
    const stop = await shim.api(`${at(id)}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200, await stop.clone().text());
    assert.equal((await stop.json()).stopped, "cancelled", "no run yet: the session's stop cancels the turn");
    await until(() => (app.sessions.running().includes(id) ? null : true), "the turn to end", { timeoutMs: 20_000 });
    const stopped = (await transcript(id)).turns.at(-1);
    assert.deepEqual([stopped.woke, !!stopped.final, JSON.stringify(stopped.user).includes("REPORT-EARLY")], [true, true, true], "the stopped turn is kept, Filament's line its reply, with what it carried");
    assert.deepEqual([app.subagents.queued(id), hands.untoldOf(id)], [0, []], "nothing goes back");
    await sleep(AGAIN[0] + 1000);
    assert.deepEqual([(await transcript(id)).turns.length, linesOf(slowPrompts).length], [1, 0], "a turn the person stopped is not tried again: the agent was sent no prompt");
    const next = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "go on", stream: false } });
    assert.equal(next.status, 200, await next.clone().text());
    const sent = linesOf(slowPrompts).map((p) => String(p.text));
    assert.deepEqual([sent.length, sent.join("\n").split("REPORT-EARLY").length - 1], [1, 1], `the agent's one prompt holds the report once: ${sent.join("\n---\n")}`);
  });
});
