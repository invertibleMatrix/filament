// HarnessV3 Step 3, Phase 3D (D12, D14): one turn at a time in a chat of the harness's own. The lock itself against a
// fake clock; the harness queue's DOM-free logic; an outside client's requests, which take no lock — what one comes
// beside, memory tells alone (`alongside`, `joinsRunning`); the sessions settings without the gate's knobs.
import { test, describe, before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionTurns } from "../src/services/session-turns.js";
import { queueText, createWaitingQueue, waitingStore, waitingOwes } from "../src/ui/harness/waiting.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { gate, until, upstreamControls } from "./helpers/wait.js";
import { chainKeyForConversationId } from "../src/services/memory/brain.js";
import { MemoryService } from "../src/memory-service.js";
import { createFinish } from "../src/app/finish.js";
import { CONFIG_SCHEMA } from "../src/core/schema.js";
import { normalizeConfig } from "../src/services/config/store.js";

const SYS = { role: "system", content: "You help." };
const person = (text) => ({ role: "user", content: [{ type: "text", text }] });
const replyText = (m) =>
  Array.isArray(m?.content) ? m.content.filter((b) => b?.type === "text").map((b) => b.text).join("") : String(m?.content ?? "");
/** The lock's holder while a chat moves to another folder, as app/sessions/move.js takes it. */
const MOVE = Object.freeze({ window: "move", client: "the move to another folder", label: "the move to another folder", since: 0, idleMs: 0 });

describe("the lock itself (D12, fake clock)", () => {
  // (fails before: yes — the same window's second take was handed the hold (`overOwn`) unless the turn was taken
  // `lease: false`: an outside window's request went on under its own turn's hold)
  test("acquire, holder, renew, release; subscribers hear each change; a second take is refused whoever asks", async () => {
    let t = 1000;
    const turns = new SessionTurns({ now: () => t });
    const seen = [];
    const un = turns.onChange("n:k", (h) => seen.push(h ? h.window : null));
    await until(() => seen.length > 0, "the immediate emit");
    assert.deepEqual(seen, [null], "a fresh chat holds nobody");
    const a = await turns.acquire("n:k", { window: "harness", client: "harness" });
    assert.ok(a.ok && a.token);
    // `label` (Facade D13) is null in this suite: the lock is built without `labelOf` here.
    assert.deepEqual(turns.holder("n:k"), { window: "harness", client: "harness", label: null, since: 1000, idleMs: 0, requestId: null, phase: null, own: null });
    t = 60_000;
    assert.equal(turns.holder("n:k")?.idleMs, 59_000, "idle is time since the last renewal");
    turns.renew("n:k", a.token, { requestId: "r1" });
    assert.deepEqual([turns.holder("n:k")?.requestId, turns.holder("n:k")?.idleMs], ["r1", 0]);
    const again = await turns.acquire("n:k", { window: "harness", client: "harness" });
    assert.deepEqual([again.ok, again.busy?.window, again.token ?? null], [false, "harness", null], "a second harness send is not handed the running turn's lock");
    const move = await turns.acquire("n:k", { window: MOVE.window, client: MOVE.client });
    assert.deepEqual([move.ok, move.busy?.requestId], [false, "r1"], "nor is a move: it learns whose turn holds the chat");
    assert.equal(turns.release("n:k", "not-the-token"), false, "a stale token releases nothing");
    assert.equal(turns.release("n:k", a.token), true);
    assert.equal(turns.holder("n:k"), null);
    assert.deepEqual(seen, [null, "harness", null], "the take and the release, each heard once");
    un();
  });

  // (fails before: yes — a hold taken without `lease: false` lapsed after `turnLeaseMinutes` of silence, and its
  // subscribers heard it gone; only the server's own turns were held whatever their silence, HarnessV4_Tasks A1)
  test("silence never drops a holder: it stays the holder, counted and listed, until its release", async () => {
    let t = 1000;
    const turns = new SessionTurns({ now: () => t });
    const seen = [];
    turns.onHolder = (key, h) => seen.push(h ? h.window : null);
    const a = await turns.acquire("n:s", { window: "harness", client: "harness" });
    t += 10 * 60 * 60_000; // ten hours with no request and no chunk
    assert.equal(turns.holder("n:s")?.window, "harness", "still the holder");
    assert.equal(turns.holder("n:s")?.idleMs, 10 * 60 * 60_000, "its silence is still said");
    assert.equal(turns.count, 1, "and still counted");
    assert.deepEqual(turns.holders().map((h) => h.key), ["n:s"], "the sidebar's resync keeps it");
    assert.deepEqual(seen, ["harness"], "nobody ever heard it gone: the take alone");
    assert.equal(turns.release("n:s", a.token), true, "its end is what frees the chat");
    assert.deepEqual([turns.holder("n:s"), turns.count, seen], [null, 0, ["harness", null]]);
  });

  // (fails before: there was no phase — a turn compacting at its line held the lock in silence for minutes;
  // HarnessV3-CodebasePass decision 1)
  test("setPhase: the holder says what the turn does before its request, every listener hears it, a stale token changes nothing", async () => {
    let t = 5000;
    const turns = new SessionTurns({ now: () => t });
    const heard = [];
    const published = [];
    turns.onHolder = (key, h) => published.push([key, h?.phase?.kind ?? null]);
    const a = await turns.acquire("h:p", { window: "harness", client: "harness" });
    turns.onChange("h:p", (h) => heard.push(h?.phase ?? null));
    await until(() => heard.length > 0, "the immediate emit");
    t = 9000;
    assert.equal(turns.setPhase("h:p", a.token ?? null, { kind: "compacting", method: "fold", since: 8500 }), true);
    assert.deepEqual(turns.holder("h:p")?.phase, { kind: "compacting", method: "fold", since: 8500 });
    assert.equal(turns.holder("h:p")?.idleMs, 0, "a phase is the holder at work: it renews");
    assert.deepEqual(heard.at(-1), { kind: "compacting", method: "fold", since: 8500 }, "subscribers hear it");
    assert.deepEqual(published.at(-1), ["h:p", "compacting"], "and so does the app's feed");
    assert.equal(turns.holders()[0].phase?.kind, "compacting", "the sidebar's resync carries it");
    assert.equal(turns.setPhase("h:p", "not-the-token", null), false, "a stale token changes nothing");
    assert.equal(turns.holder("h:p")?.phase?.kind, "compacting");
    assert.equal(turns.setPhase("h:p", a.token ?? null, null), true);
    assert.equal(turns.holder("h:p")?.phase, null, "null clears it");
    assert.equal(heard.at(-1), null);
    turns.release("h:p", a.token ?? null);
    assert.equal(turns.setPhase("h:p", a.token ?? null, { kind: "compacting", method: null, since: 1 }), false, "nobody holds it: nothing to say");
  });
});

describe("the harness queue's logic (D14, DOM-free)", () => {
  test("the line names the holder with its minutes and idle", () => {
    // The words are the server's (Facade D13): the holder snapshot carries `label`, the page maps no ids.
    assert.equal(queueText({ window: "harness", client: "harness", label: "Claude Code", own: { agent: "Claude Code" }, since: 0, idleMs: 40_000 }, () => 120_000), "Waiting — Claude Code is working on its own · 2 min · idle 40 s");
    assert.equal(queueText({ window: "harness", client: "harness", label: "the harness", since: 0, idleMs: 0 }, () => 61_000), "Waiting — the harness is working · 1 min · idle 0 s");
    assert.equal(queueText(null), "Waiting — the turn is ending");
  });

  // The queue's own timer runs on node:test's mock timers: each `step` moves time by one tick and lets the tick's
  // promises settle, so "it has not sent yet" is a fact about the ticks that ran, not about a pause being long enough.
  const step = async (/** @type {number} */ ms) => {
    mock.timers.tick(ms);
    await new Promise((r) => setImmediate(r));
  };

  test("it sends itself when the move is done; cancel keeps it unsent; a busy re-answer waits again", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      /** @type {any} */
      let held = { ...MOVE };
      const sent = [];
      const ticks = [];
      const q = createWaitingQueue({
        content: "go ahead",
        holder: held,
        free: async () => held,
        send: async (c) => {
          sent.push(c);
          return null;
        },
        onTick: (t) => ticks.push(t),
        pollMs: 5,
      });
      await step(5);
      await step(5);
      assert.deepEqual(sent, [], "it waits while the chat moves");
      assert.equal(ticks.length, 2, "the line updates on every tick");
      held = null; // the move is done
      await step(5);
      assert.deepEqual(sent, ["go ahead"], "it sends itself when the move is done");
      q.cancel();
      // cancel: nothing more sends
      /** @type {any} */
      let free2 = { ...MOVE }; // held until cancelled
      const q2 = createWaitingQueue({
        content: "x",
        holder: { ...MOVE },
        free: async () => free2,
        send: async () => {
          sent.push("nope");
          return null;
        },
        pollMs: 5,
      });
      await step(5);
      q2.cancel();
      free2 = null;
      await step(50); // ten ticks' worth of time
      assert.ok(!sent.includes("nope"), "a cancelled queue never sends");
    } finally {
      mock.timers.reset();
    }
  });

  test("a racing send that loses the lock re-arms instead of dropping the message", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      let races = 0;
      const sent = [];
      const q = createWaitingQueue({
        content: "go",
        holder: { ...MOVE },
        free: async () => null, // the move is done...
        send: async (c) => {
          sent.push(c);
          if (races++ === 0) return { window: "harness", client: "harness", since: Date.now(), idleMs: 0 }; // lost the race: another tab's turn won
          return null;
        },
        pollMs: 5,
      });
      await step(5);
      assert.equal(sent.length, 1, "it sent itself, and another tab won the lock first");
      await step(5);
      assert.equal(sent.length, 2, "it sent itself again once the second holder freed");
      await step(50);
      assert.equal(sent.length, 2, "and only once more");
      q.cancel();
    } finally {
      mock.timers.reset();
    }
  });

  // (fails before: yes — the queue sent the moment the turn ended, through the composer path into whatever chat was on screen)
  test("a queue whose chat is not on screen holds; it sends once its chat is shown again, never into another", async () => {
    let onScreen = false;
    let looked = 0;
    let asked = 0;
    const sent = [];
    const ticks = [];
    const q = createWaitingQueue({
      content: "after the move",
      holder: { ...MOVE },
      free: async () => {
        asked++;
        return null; // the move is already done
      },
      send: async (c) => {
        sent.push(c);
        return null;
      },
      onTick: (t) => ticks.push(t),
      pollMs: 1,
      shown: () => {
        looked++;
        return onScreen;
      },
    });
    await until(() => looked >= 5, "five ticks with another chat on screen");
    assert.equal(asked, 0, "it doesn't even ask while its chat is hidden");
    assert.deepEqual(sent, [], "and it never sends into the chat on screen");
    assert.deepEqual(ticks, [], "nor touches the line or the composer");
    onScreen = true;
    await until(() => sent.length === 1, "the send once the chat is shown");
    assert.deepEqual(sent, ["after the move"]);
    q.cancel();
    // The chat is left while `free` is answering: the queue holds instead of sending
    /** @type {(v: null) => void} */
    let answer = () => {};
    let asking = false;
    let shownNow = true;
    let looks = 0;
    const sent2 = [];
    const q2 = createWaitingQueue({
      content: "x",
      holder: { ...MOVE },
      free: () => {
        asking = true;
        return new Promise((r) => (answer = r));
      },
      send: async (c) => {
        sent2.push(c);
        return null;
      },
      pollMs: 1,
      shown: () => {
        looks++;
        return shownNow;
      },
    });
    await until(() => asking, "the queue to ask whether the move is done");
    shownNow = false;
    const before = looks;
    answer(null); // the move is done — but its chat is no longer on screen
    await until(() => looks >= before + 2, "the queue to look again after the answer");
    assert.deepEqual(sent2, [], "the answer came back after the chat was left: nothing sent");
    q2.cancel();
  });

  test("the waiting store survives a reload and says what it owes (D14)", () => {
    const backing = new Map();
    const store = waitingStore(
      /** @type {any} */ ({
        getItem: (k) => backing.get(k) ?? null,
        setItem: (k, v) => backing.set(k, v),
        removeItem: (k) => backing.delete(k),
      }),
    );
    assert.equal(waitingOwes(store.read("c1"), null), null, "nothing saved owes nothing");
    store.save("c1", { text: "queued before the reload", attachments: [], holder: { ...MOVE, since: 1 } });
    const owes = waitingOwes(store.read("c1"), { window: MOVE.window, client: MOVE.client, startedAt: 1 });
    assert.ok(owes?.payload?.text === "queued before the reload" && owes?.holder?.window === MOVE.window, "the saved send and the live holder come back together");
    assert.ok(waitingOwes(store.read("c1"), null)?.payload, "even with the move already done, the send is still owed");
    store.clear("c1");
    assert.equal(waitingOwes(store.read("c1"), null), null, "cleared is cleared");
  });
});

describe("an outside client's requests take no lock; a harness turn holds its chat (D12)", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root;
  /** @type {any[]} */
  let upstreamCalls = [];
  const setScript = (...fns) => {
    upstreamCalls = [];
    script = fns;
  };
  /** @type {((call: any) => any)[]} */
  let script = [];
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-st-"));
    up = await fakeUpstream(async (call) => {
      upstreamCalls.push(call);
      const fn = script[Math.min(Math.max(upstreamCalls.length - 1, 0), script.length - 1)];
      return fn ? fn(call) : anthropicReply("ok", { model: "m-1" });
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
  const chainOf = (/** @type {string} */ sid) => /** @type {any} */ (shim.app.memory).archive.chainIdForKey(chainKeyForConversationId(sid));
  const { hold, letGo } = upstreamControls();
  afterEach(letGo);
  /** Nobody holds the session's turn, as the page reads it (the transcript's `live`). @param {string} chainId */
  const lockFree = (chainId) =>
    until(async () => !(await (await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/transcript?limit=1&work=0`)).json()).live, "the session's turn to come free");
  const zcPost = (messages, sid = "st-1") =>
    shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages }, { "x-session-id": sid, "x-filament-cwd": root, "user-agent": "opencode/1.0" });
  /** A session of the harness's own: its id. */
  const harnessSession = async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    assert.equal(created.status, 200);
    return String((await created.json()).id);
  };
  /** Who holds the session's turn, as the server keeps it. @param {string} chainId */
  const heldBy = (chainId) => {
    const memory = /** @type {any} */ (shim.app.memory);
    return /** @type {any} */ (shim.app.sessionTurns).holder(memory.archive.getChain(chainId)?.key);
  };
  /** Claude Code's requests in the root folder: it names no conversation, so they are keyed by folder and first message. */
  const claudeCode = () => {
    const system = `You are Claude Code.\n<env>\nWorking directory: ${root}\n</env>`;
    const headers = { "user-agent": "claude-cli/2.1.258 (external, cli)", "x-app": "cli" };
    return {
      post: (/** @type {any[]} */ messages) => shim.post("/v1/messages", { model: "m-1", max_tokens: 100, system, messages }, headers),
    };
  };
  const SUGGESTION = "[SUGGESTION MODE: suggest what the user might type next]";

  // (fails before: yes — the turn gate took the chat's lock for OpenCode's turn: the lock named OpenCode's window while its
  // requests were at the upstream. The second came alongside the first, never busy, then as now: one client's chat has
  // one window, and the gate's busy reply was another window's)
  test("two requests of one client chat run side by side: neither waits nor is answered busy, and neither holds the chat's lock", async () => {
    const sid = "st-two";
    setScript(() => anthropicReply("a one", { model: "m-1" }));
    assert.equal((await zcPost([SYS, person("one")], sid)).status, 200);
    const memory = /** @type {any} */ (shim.app.memory);
    const key = memory.archive.getChain(chainOf(sid)).key;
    const turns = /** @type {any} */ (shim.app.sessionTurns);
    const first = hold(anthropicReply("the first answer", { model: "m-1" }));
    const second = hold(anthropicReply("the second answer", { model: "m-1" }));
    setScript(first.script, second.script);
    const a = zcPost([SYS, person("one"), { role: "assistant", content: "a one" }, person("two")], sid);
    await first.arrived;
    assert.equal(turns.holder(key), null, "the first request is at the upstream: nobody holds the chat");
    const b = zcPost([SYS, person("one"), { role: "assistant", content: "a one" }, person("a side question")], sid);
    await second.arrived;
    assert.equal(turns.holder(key), null, "nor while both are");
    second.release();
    first.release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.deepEqual([ra.status, rb.status], [200, 200]);
    assert.match(replyText({ content: (await ra.json()).content }), /the first answer/);
    assert.match(replyText({ content: (await rb.json()).content }), /the second answer/, "the model answered both: no busy line");
    assert.deepEqual([turns.holder(key), turns.count], [null, 0]);
  });

  // (fails before: on its record line only — the turn gate said it in its own words; the turns as the archive keeps
  // them are the same. The bug hunt of 10-30: Claude Code's fork of its own conversation, sent while that
  // conversation's turn ran, was the turn's own)
  test("a request the window sends while its own turn runs comes alongside it: answered by the model, a turn of its own, which the conversation's next message leaves on a rewound line", async () => {
    const cc = claudeCode();
    const memory = /** @type {any} */ (shim.app.memory);
    const said = (/** @type {any} */ t) => {
      const text = JSON.stringify(memory.archive.getMessage(t.user_hash)?.message?.content ?? "");
      return /a side question/.test(text) ? "side" : (/cc (one|two|three)/.exec(text)?.[0] ?? text);
    };
    setScript(() => anthropicReply("a one", { model: "m-1" }));
    assert.equal((await cc.post([person("cc one")])).status, 200);
    const chainId = (await shim.record((await shim.records(1))[0].id)).memory?.chain;
    assert.ok(chainId, "the conversation is a session");
    // The conversation's turn and the fork that comes while it runs are both held at the upstream: the turn's reply is
    // a tool call, the fork's an answer
    const toolCall = anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: "t1", name: "Read", input: { path: "x" } }] });
    const heldTurn = hold(toolCall);
    const heldSide = hold(anthropicReply("a side answer", { model: "m-1" }));
    setScript(heldTurn.script, heldSide.script);
    const turn = cc.post([person("cc one"), { role: "assistant", content: "a one" }, person("cc two")]);
    await heldTurn.arrived;
    const side = cc.post([person("cc one"), { role: "assistant", content: "a one" }, person("a side question")]);
    await heldSide.arrived;
    // The turn's reply comes first, a tool call: its loop waits on its tools while the fork still runs
    heldTurn.release();
    assert.equal((await turn).status, 200);
    heldSide.release();
    const sideRes = await side;
    assert.equal(sideRes.status, 200, "the fork is answered, never refused");
    assert.match(replyText({ content: (await sideRes.json()).content }), /a side answer/, "by the model, not a busy line");
    const sideId = (await shim.records(1))[0].id;
    // The turn's leg comes and ends it
    setScript(() => anthropicReply("an answer", { model: "m-1" }));
    const leg = await cc.post([person("cc one"), { role: "assistant", content: "a one" }, person("cc two"), { role: "assistant", content: toolCall.json.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "data" }] }]);
    assert.equal(leg.status, 200);
    setScript(() => anthropicReply("a three", { model: "m-1" }));
    assert.equal((await cc.post([person("cc one"), { role: "assistant", content: "a one" }, person("cc two"), { role: "assistant", content: toolCall.json.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "data" }] }, { role: "assistant", content: "an answer" }, person("cc three")])).status, 200);
    const turns = memory.archive.getTurns(chainId);
    assert.deepEqual(turns.filter((/** @type {any} */ t) => !t.meta?.rewound).map(said), ["cc one", "cc two", "cc three"], "the session's line is the conversation's, its turn never rewound");
    assert.deepEqual(turns.filter((/** @type {any} */ t) => t.meta?.rewound).map(said), ["side"], "the fork's turn is on a rewound line once the next message leaves it out");
    assert.equal(turns.find((/** @type {any} */ t) => said(t) === "side")?.meta?.alongside, true, "a turn of its own, beside the running one");
    const two = turns.find((/** @type {any} */ t) => said(t) === "cc two");
    assert.match(JSON.stringify(memory.archive.getMessage(two?.final_hash)?.message?.content ?? ""), /an answer/, "the turn's leg kept its answer as the turn's own, the fork's turn newer than it");
    const sideRec = await shim.record(sideId);
    assert.ok((sideRec.changes || []).some((/** @type {string} */ c) => /came while this window's own turn was at work — a turn of its own beside that one/.test(c)), "its record says it came beside the turn");
  });

  // (fails before: no — a guard: the bug hunt of 10-30, its second pass, found the person's message that came while the
  // window's background fork ran lost, or rewound with the fork's turn; memory tells it alongside now as the gate did)
  test("the person's message that comes while the window's fork runs is a turn of the session, never lost nor rewound", async () => {
    const cc = claudeCode();
    const memory = /** @type {any} */ (shim.app.memory);
    const said = (/** @type {any} */ t) => {
      const text = JSON.stringify(memory.archive.getMessage(t.user_hash)?.message?.content ?? "");
      return /SUGGESTION MODE/.test(text) ? "fork" : (/pp (one|two|three)/.exec(text)?.[0] ?? text);
    };
    setScript(() => anthropicReply("p one", { model: "m-1" }));
    assert.equal((await cc.post([person("pp one")])).status, 200);
    const chainId = (await shim.record((await shim.records(1))[0].id)).memory?.chain;
    assert.ok(chainId, "the conversation is a session");
    // The turn has ended; the client's fork of the conversation (its prompt suggestion) is held at the upstream
    const held = hold(anthropicReply("p answer", { model: "m-1" }));
    setScript(held.script);
    const fork = cc.post([person("pp one"), { role: "assistant", content: "p one" }, person(SUGGESTION)]);
    await held.arrived;
    // The person's next message comes while the fork runs
    assert.equal((await cc.post([person("pp one"), { role: "assistant", content: "p one" }, person("pp two")])).status, 200);
    held.release();
    assert.equal((await fork).status, 200);
    setScript(() => anthropicReply("p three", { model: "m-1" }));
    assert.equal((await cc.post([person("pp one"), { role: "assistant", content: "p one" }, person("pp two"), { role: "assistant", content: "p answer" }, person("pp three")])).status, 200);
    const turns = memory.archive.getTurns(chainId);
    assert.deepEqual(turns.filter((/** @type {any} */ t) => !t.meta?.rewound).map(said), ["pp one", "pp two", "pp three"], "the person's messages are the session's line");
    assert.deepEqual(turns.filter((/** @type {any} */ t) => t.meta?.rewound).map(said), ["fork"], "the fork's turn is on a rewound line");
    assert.equal(turns.find((/** @type {any} */ t) => said(t) === "pp two")?.meta?.alongside, true, "the person's message came beside the running fork");
  });

  // (fails before: no — a guard: the bug hunt of 10-30, its fourth pass, found Claude Code's /btw sent while its turn
  // waited on a tool taking the turn over; memory tells the fork alongside the waiting loop now as the gate did)
  test("a fork that comes while the turn waits on its tools is a turn of its own beside it, and the turn's leg goes on with the turn", async () => {
    const cc = claudeCode();
    const memory = /** @type {any} */ (shim.app.memory);
    const said = (/** @type {any} */ t) => {
      const text = JSON.stringify(memory.archive.getMessage(t.user_hash)?.message?.content ?? "");
      return /a side question/.test(text) ? "side" : (/wt (one|two)/.exec(text)?.[0] ?? text);
    };
    setScript(() => anthropicReply("w one", { model: "m-1" }));
    assert.equal((await cc.post([person("wt one")])).status, 200);
    const chainId = (await shim.record((await shim.records(1))[0].id)).memory?.chain;
    assert.ok(chainId, "the conversation is a session");
    // The turn's reply calls a tool: its loop waits while the tool runs
    const toolCall = anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: "w1", name: "Read", input: { path: "x" } }] });
    setScript(() => toolCall);
    const loop = [person("wt one"), { role: "assistant", content: "w one" }, person("wt two")];
    assert.equal((await cc.post(loop)).status, 200);
    // The /btw: the loop's last request, and the question
    setScript(() => anthropicReply("a side answer", { model: "m-1" }));
    const side = await cc.post([...loop, person("a side question")]);
    assert.match(replyText({ content: (await side.json()).content }), /a side answer/, "the model answers the fork");
    // The loop's leg comes back with the tool's result and goes to the model; its answer ends the turn
    setScript(() => anthropicReply("the leg's answer", { model: "m-1" }));
    const leg = await cc.post([...loop, { role: "assistant", content: toolCall.json.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: "w1", content: "data" }] }]);
    assert.match(replyText({ content: (await leg.json()).content }), /the leg's answer/, "the loop's leg goes to the model");
    const turns = memory.archive.getTurns(chainId);
    assert.deepEqual(turns.map(said), ["wt one", "wt two", "side"]);
    assert.equal(turns.find((/** @type {any} */ t) => said(t) === "side")?.meta?.alongside, true, "the fork is a turn of its own beside the waiting loop");
    const two = turns.find((/** @type {any} */ t) => said(t) === "wt two");
    assert.match(JSON.stringify(memory.archive.getMessage(two?.final_hash)?.message?.content ?? ""), /the leg's answer/, "the leg went on with the turn that waited");
  });

  // (passes before too: the way a fork after the turn's final answer is read did not change)
  test("a fork that comes after the turn's final answer is a turn of the session's; the next message rewinds it and keeps itself", async () => {
    const cc = claudeCode();
    const memory = /** @type {any} */ (shim.app.memory);
    const said = (/** @type {any} */ t) => {
      const text = replyText(memory.archive.getMessage(t.user_hash)?.message);
      return /SUGGESTION MODE/.test(text) ? "fork" : text;
    };
    setScript(() => anthropicReply("f one", { model: "m-1" }));
    assert.equal((await cc.post([person("ff one")])).status, 200);
    const chainId = (await shim.record((await shim.records(1))[0].id)).memory?.chain;
    const opened = [person("ff one"), { role: "assistant", content: "f one" }];
    setScript(() => anthropicReply("a suggestion", { model: "m-1" }));
    assert.equal((await cc.post([...opened, person(SUGGESTION)])).status, 200);
    setScript(() => anthropicReply("f two", { model: "m-1" }));
    assert.equal((await cc.post([...opened, person("ff two")])).status, 200);
    const turns = memory.archive.getTurns(chainId);
    assert.deepEqual(turns.filter((/** @type {any} */ t) => !t.meta?.rewound).map(said), ["ff one", "ff two"]);
    assert.deepEqual(turns.filter((/** @type {any} */ t) => t.meta?.rewound).map(said), ["fork"]);
  });

  test("the harness's own second send still gets 409 with the steer info", async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    assert.equal(created.status, 200);
    const { id } = await created.json();
    const held = hold(anthropicReply("slow harness answer", { model: "m-1" }));
    setScript(held.script);
    const first = shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "one", stream: false } });
    await held.arrived;
    const second = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "two", stream: false } });
    assert.equal(second.status, 409, "a second send while the harness's own turn runs");
    const body = await second.json();
    assert.match(String(body.error?.message || body.error || ""), /steer it through its run/, "today's words");
    // (fails before: yes — the refusal named no holder, and the page drew a hard error over its own running turn)
    assert.deepEqual([body.holder?.window, body.holder?.own ?? null, body.holder?.requestId], ["harness", null, body.requestId], "it names its holder, the harness's own turn: the page follows that turn again");
    held.release();
    assert.equal((await first).status, 200);
    await lockFree(id);
  });

  // (fails before: yes — on the commit before HarnessV4_Tasks A1, a harness turn silent past the lease held nothing:
  // OpenCode's message went to the model beside it, and Stop found no turn)
  test("a harness turn silent for hours keeps its chat, and Stop ends it", async () => {
    const chainId = await harnessSession();
    const held = hold(anthropicReply("never read", { model: "m-1" }));
    setScript(held.script);
    const harness = shim.api(`/api/sessions/${encodeURIComponent(chainId)}/turns`, { method: "POST", body: { content: "a long job", stream: false } });
    await held.arrived;
    // The lock's clock moves ten hours on while the harness turn waits on its model, in silence
    const turns = /** @type {any} */ (shim.app.sessionTurns);
    const realNow = turns.now;
    turns.now = () => realNow() + 10 * 60 * 60_000;
    try {
      assert.equal(heldBy(chainId)?.window, "harness", "no silence drops a turn the server owns");
      // No clock ends this wait, so Stop must (HarnessV3-RunawayTurns' rule)
      const stop = await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/stop`, { method: "POST", body: {} });
      const said = await stop.json();
      assert.equal(said.holder?.window, "harness", "Stop finds the turn by its lock");
      assert.ok(["steered", "cancelled"].includes(said.stopped), `and reaches it (${said.stopped})`);
      await harness;
      await lockFree(chainId);
    } finally {
      turns.now = realNow;
    }
  });

  // (fails before: yes — the failed close was swallowed by an empty catch, and nothing said it happened)
  test("a stage that throws still closes its record; a close that fails too is logged, never swallowed", async () => {
    const sid = "st-throw";
    setScript(() => anthropicReply("a one", { model: "m-1" }));
    assert.equal((await zcPost([SYS, person("one")], sid)).status, 200);
    const memory = /** @type {any} */ (shim.app.memory);
    const usage = /** @type {any} */ (shim.app.usage);
    const close = usage.finish;
    memory.prepare = () => {
      throw new Error("stage boom");
    };
    // The record closes (nothing is left pending for shutdown to wait on), then the close reports a failure
    usage.finish = (...args) => {
      close.apply(usage, args);
      throw new Error("close boom");
    };
    try {
      const res = await zcPost([SYS, person("one"), { role: "assistant", content: "a one" }, person("two")], sid);
      assert.ok(res.status >= 500, `the stage's own throw is what surfaces (${res.status})`);
    } finally {
      delete memory.prepare;
      usage.finish = close;
    }
    const [rec] = await shim.records(1);
    assert.equal(rec.status, "error", "the record was closed, not left pending");
    assert.match(String(rec.error), /stage boom/, "with the stage's own error");
    const ops = await (await shim.api("/api/ops?kinds=log&limit=50")).json();
    assert.ok(
      ops.ops.some((/** @type {any} */ o) => /after a stage threw failed: close boom/.test(o.title)),
      "the failed close is said in the log",
    );
  });

  test("closing the harness tab mid-turn releases nothing: the turn keeps its chat until it ends", async () => {
    const own = await harnessSession();
    const held = hold(anthropicReply("slow harness", { model: "m-1" }));
    setScript(held.script);
    const tabAbort = new AbortController();
    const tab = fetch(`http://127.0.0.1:${shim.port}/api/sessions/${encodeURIComponent(own)}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": shim.key },
      body: JSON.stringify({ content: "harness turn the tab abandons", stream: true }),
      signal: tabAbort.signal,
    }).catch(() => null);
    await held.arrived;
    tabAbort.abort(); // the tab closes
    await tab;
    // Read over 300 ms, where a lock the hang-up released would show
    for (let i = 0; i < 6; i++) {
      assert.equal(heldBy(own)?.window, "harness", "the harness turn outlives its tab");
      await new Promise((r) => setTimeout(r, 50));
    }
    held.release();
    await lockFree(own);
  });

  // (review 3D: a refused harness turn once leaked the lock, and the second refusal came back "a turn is running". A
  // turn's own settings patch refused, and a turn with no content, are the refusals before the lock.)
  test("a refused harness turn holds nothing: the same refusal twice, then a send goes", async () => {
    const id = await harnessSession();
    setScript(() => anthropicReply("a one", { model: "m-1" }));
    assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "one", stream: false } })).status, 200);
    await lockFree(id); // the turn is over: what refuses next is the turn's own input, never a lock left behind
    const send = (/** @type {any} */ body) => shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { stream: false, ...body } });
    for (const why of ["the first", "the second"]) {
      const patched = await send({ content: "with an unknown setting", settingsPatch: { context: { nope: 1 } } });
      assert.equal(patched.status, 400, `${why} refusal is the patch's, not a lock's 409`);
      assert.match((await patched.json()).error, /unknown setting "context\.nope"/);
      const empty = await send({ content: "" });
      assert.equal(empty.status, 400, `${why} empty send is refused for its content, not a lock's 409`);
      assert.match((await empty.json()).error, /content is required/);
    }
    setScript(() => anthropicReply("after the refusals", { model: "m-1" }));
    const after = await send({ content: "now it goes" });
    assert.equal(after.status, 200, await after.text(), "nothing held the lock");
    await lockFree(id);
  });
});

// (fails before: yes — `sessions.busyWaitSeconds` and `sessions.turnLeaseMinutes` were the turn gate's settings)
test("the sessions settings hold no busy wait and no lease; an old config naming them loads as the defaults", () => {
  assert.deepEqual(Object.keys(CONFIG_SCHEMA.sessions).filter((k) => k !== "_doc").sort(), ["commitTrailer", "defaults", "idleWakeMinutes", "resumeAfterRestart"]);
  const cfg = normalizeConfig({ sessions: { busyWaitSeconds: 9, turnLeaseMinutes: 2, resumeAfterRestart: false } });
  assert.deepEqual(cfg.sessions, { defaults: {}, idleWakeMinutes: 5, resumeAfterRestart: false, commitTrailer: true }, "the old keys are dropped, the rest kept");
});

describe("turnIntent: one answer for prepare and alignHistory (D12)", () => {
  test("turn / leg / compaction / quiet agree between turnIntent and what prepare does", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-ti-"));
    const svc = new MemoryService({
      getConfig: () => ({ memory: { enabled: true, folder: join(dir, "mem"), privacy: { encryptArchive: false } } }),
      dataDir: dir,
      log: () => {},
    });
    svc.start();
    try {
      const base = {
        key: "h:ti",
        format: "openai",
        headers: {},
        quiet: false,
        project: { id: "none", cwd: "C:\\ti" },
        client: "opencode",
        model: "m",
        trace: null,
        responsesBody: null,
        scan: null,
        userTexts: ["hello"],
      };
      const mk = (messages, newestIndex, extra = {}) => ({
        ...base,
        newestIndex,
        newest: newestIndex >= 0 ? "hello" : "",
        ...extra,
        body: { messages },
      });
      // A new turn: the newest message is the person
      const turn = mk([{ role: "user", content: "hello" }], 0);
      assert.equal(svc.turnIntent(turn), "turn");
      const p1 = await svc.prepare(turn, { requestId: "ti-1", upstream: "m" });
      assert.equal(p1.newTurn, true, "prepare opened a turn");
      assert.ok(p1.turnN >= 1);
      // A leg: the tail is a tool result, no person message at the end (OpenAI shape — a tool role, not a person)
      const leg = mk(
        [
          { role: "user", content: "hello" },
          { role: "assistant", content: null, tool_calls: [{ id: "t", type: "function", function: { name: "read", arguments: "{}" } }] },
          { role: "tool", tool_call_id: "t", content: "data" },
        ],
        -1,
      );
      assert.equal(svc.turnIntent(leg), "leg");
      const p2 = await svc.prepare(leg, { requestId: "ti-2", upstream: "m" });
      assert.equal(p2.newTurn, false, "prepare continued the turn (no new one)");
      assert.ok((p2.legWork || []).length >= 1, "the loop so far joins the turn's work");
      // A compaction request
      const compact = mk([{ role: "user", content: "summarize the conversation so far" }], 0, { newest: "summarize the conversation so far" });
      assert.equal(svc.turnIntent(compact), "compaction");
      const p3 = await svc.prepare(compact, { requestId: "ti-3", upstream: "m" });
      assert.equal(p3.position, "compaction", "prepare took the compaction branch");
      assert.ok(!p3.turn, "no turn opened for a compaction request");
      // A quiet request: memory off
      const quiet = mk([{ role: "user", content: "hello" }], 0, { quiet: true });
      assert.equal(svc.turnIntent(quiet), "none");
      const p4 = await svc.prepare(quiet, { requestId: "ti-4", upstream: "m" });
      assert.equal(p4?.quiet ?? p4?.muted ?? true, true, "a quiet request opens nothing");
    } finally {
      await svc.shutdown();
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
});

describe("what a request comes beside, as memory tells it (D12)", () => {
  /** @type {any} */
  let svc;
  let dir = "";
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-beside-"));
    svc = new MemoryService({
      getConfig: () => ({ memory: { enabled: true, folder: join(dir, "mem"), privacy: { encryptArchive: false } } }),
      dataDir: dir,
      log: () => {},
    });
    svc.start();
  });
  after(async () => {
    await svc.shutdown();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });
  const answer = (/** @type {string} */ text) => ({ role: "assistant", content: `a ${text}` });
  const CALL = { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: { path: "x" } }] };
  /**
   * An OpenCode conversation as memory reads it: each request situated and prepared as the pipeline prepares it, its
   * reply archived, and its record closed as `finish` closes it. @param {string} sid
   */
  const conversation = (sid) => {
    let n = 0;
    /** A request of the conversation, prepared: its record's id, its situation, what prepare did. @param {any[]} messages */
    const send = async (messages) => {
      const id = `${sid}-r${++n}`;
      const sit = svc.situate({ format: "anthropic", body: { model: "m-1", max_tokens: 10, messages }, headers: { "x-session-id": sid, "user-agent": "opencode/1.0" }, model: "m-1" });
      const prep = await svc.prepare(sit, { requestId: id, upstream: "m" });
      return { id, sit, prep };
    };
    /** Its reply landed, and its record closed. @param {{ id: string, prep: any }} r @param {any} [finalMessage] */
    const done = (r, finalMessage = null) => {
      if (finalMessage) svc.archive.finishTurn(r.prep.turn, { finalMessage, requestId: r.id });
      svc.turnStopped({ id: r.id, memory: { turnId: r.prep.turn } });
    };
    const turns = () => svc.archive.getTurns(svc.archive.chainIdForKey(chainKeyForConversationId(sid)));
    const textOf = (/** @type {any} */ t) => replyText(svc.archive.getMessage(t.user_hash)?.message);
    return {
      send,
      done,
      turnOf: (/** @type {{ prep: any }} */ r) => turns().find((/** @type {any} */ t) => t.id === r.prep.turn) || null,
      line: () => turns().filter((/** @type {any} */ t) => !t.meta?.rewound).map(textOf),
      rewound: () => turns().filter((/** @type {any} */ t) => t.meta?.rewound).map(textOf),
    };
  };

  // (fails before: yes — memory alone knew no request at work: the turn gate told it `alongside`, and a side request
  // memory lined up by itself rewound the turns its history lacked, the running turn among them)
  test("a side request while the window's turn runs rewinds nothing: a turn of its own beside that one; once the turn's request has closed, the same history is an edit, and rewinds", async () => {
    const c = conversation("beside-1");
    const one = await c.send([person("one")]);
    c.done(one, answer("one"));
    const two = await c.send([person("one"), answer("one"), person("two")]);
    c.done(two, answer("two"));
    // The person's next message runs: its request is at the upstream
    const three = await c.send([person("one"), answer("one"), person("two"), answer("two"), person("three")]);
    // A side request of the conversation, made of a history that lacks turn two
    const side = await c.send([person("one"), answer("one"), person("SIDE")]);
    assert.deepEqual([side.sit.alongside, side.sit.joinsRunning], [true, false]);
    assert.deepEqual(c.rewound(), [], "nothing rewound: its history need not hold what the running turn is built on");
    assert.equal(c.turnOf(side)?.meta?.alongside, true, "a turn of its own, beside the running one");
    assert.ok((side.prep.notes || []).some((/** @type {string} */ n) => /a turn of its own beside that one/.test(n)), "the record says so");
    c.done(three, answer("three"));
    c.done(side, answer("SIDE"));
    // Nothing runs now: the same history is an edit of the conversation, and its line goes back to it
    const again = await c.send([person("one"), answer("one"), person("SIDE again")]);
    assert.equal(again.sit.alongside, false);
    assert.deepEqual(c.rewound(), ["two", "three", "SIDE"]);
    c.done(again, answer("SIDE again"));
  });

  // (fails before: yes — a request counted as running its turn only once memory's whole prepare had resolved: a side
  // request that came while the running request still waited on memory came beside nothing, and rewound turn two and
  // the running turn three)
  test("a side request while the running request still waits on memory rewinds nothing: its turn runs from the moment it opens", async () => {
    const c = conversation("beside-5");
    const one = await c.send([person("one")]);
    c.done(one, answer("one"));
    const two = await c.send([person("one"), answer("one"), person("two")]);
    c.done(two, answer("two"));
    // The person's next message: its turn opens, and its prepare waits on memory's lookup of related memory
    const lookup = svc.brain.buildTurnBlock;
    const held = gate();
    let lookups = 0;
    svc.brain.buildTurnBlock = async (/** @type {any[]} */ ...a) => {
      if (!lookups++) await held.promise;
      return lookup.apply(svc.brain, a);
    };
    try {
      const running = c.send([person("one"), answer("one"), person("two"), answer("two"), person("three")]);
      await until(() => lookups > 0 || null, "the running request's prepare to wait on memory");
      // A side request of the conversation, made of a history that lacks turn two, while that prepare waits
      const side = await c.send([person("one"), answer("one"), person("SIDE")]);
      assert.deepEqual([side.sit.alongside, side.sit.joinsRunning], [true, false], "it comes beside the running turn");
      assert.deepEqual(c.rewound(), [], "nothing rewound: neither turn two nor the running turn three");
      assert.equal(c.turnOf(side)?.meta?.alongside, true, "a turn of its own, beside the running one");
      held.open();
      const three = await running;
      assert.deepEqual([three.sit.alongside, three.prep.newTurn, c.turnOf(three)?.meta?.rewound], [false, true, undefined], "the running turn, on the line");
      c.done(three, answer("three"));
      c.done(side, answer("SIDE"));
      assert.deepEqual(c.line(), ["one", "two", "three", "SIDE"]);
    } finally {
      held.open();
      svc.brain.buildTurnBlock = lookup;
    }
  });

  // (fails before: yes — `joinsRunning` was the turn gate's word: memory alone opened a second turn of the same words)
  test("a client's second send of the running turn's message is filed in that turn, whatever turn opened beside it since", async () => {
    const c = conversation("beside-2");
    const one = await c.send([person("one")]);
    c.done(one, answer("one"));
    const asked = await c.send([person("one"), answer("one"), person("M")]);
    const side = await c.send([person("one"), answer("one"), person("S")]);
    assert.equal(side.sit.alongside, true, "a side request beside the running turn");
    const retry = await c.send([person("one"), answer("one"), person("M")]);
    assert.deepEqual([retry.sit.alongside, retry.sit.joinsRunning], [true, true]);
    assert.deepEqual([retry.prep.turnN, retry.prep.newTurn], [asked.prep.turnN, false], "the running turn, not a second one");
    for (const r of [asked, side, retry]) c.done(r, answer("x"));
    // Its first send closed: the same words again are a turn of their own
    const later = await c.send([person("one"), answer("one"), person("M"), answer("x"), person("one more")]);
    assert.deepEqual([later.sit.alongside, later.sit.joinsRunning], [false, false]);
    c.done(later, answer("one more"));
  });

  // (fails before: yes — memory knew no loop that waits on its tools: the turn gate kept those, and told a fork of one)
  test("a fork of a loop that waits on its tools comes alongside it; a request that holds the loop's reply goes on from it, and leaves the loop behind", async () => {
    const c = conversation("beside-3");
    const one = await c.send([person("one")]);
    c.done(one, answer("one"));
    // The loop's reply calls a tool, and its request closes: the loop waits on the tool
    const loop = await c.send([person("one"), answer("one"), person("M")]);
    c.done(loop, CALL);
    // The fork: the loop's last request, and a question of its own (Claude Code's /btw while a tool runs)
    const fork = await c.send([person("one"), answer("one"), person("M"), person("F")]);
    assert.equal(fork.sit.alongside, true, "the fork comes alongside the waiting loop");
    assert.equal(c.turnOf(fork)?.meta?.alongside, true);
    c.done(fork, answer("F"));
    // A second fork while the loop still waits: alongside it too, and the first fork's turn, which it lacks, stays
    const fork2 = await c.send([person("one"), answer("one"), person("M"), person("F2")]);
    assert.equal(fork2.sit.alongside, true);
    assert.deepEqual(c.rewound(), [], "a fork rewinds nothing");
    c.done(fork2, answer("F2"));
    // The person's words once the call was cut short, its reply kept bare: they hold the loop's reply, and go on from it
    const words = await c.send([person("one"), answer("one"), person("M"), { role: "assistant", content: "a bare reply" }, person("N")]);
    assert.equal(words.sit.alongside, false, "it holds more of the loop than the loop's last request did");
    c.done(words, answer("N"));
    // The conversation went on past the loop: a request made of its message again is an edit, no fork
    const edit = await c.send([person("one"), answer("one"), person("M"), person("X")]);
    assert.equal(edit.sit.alongside, false, "the loop was left behind");
    assert.ok(c.rewound().includes("N"), "and the edit rewinds what its history no longer holds");
    c.done(edit, answer("X"));
  });

  // (fails before: yes — the record's close told memory its turn stopped only inside the ledgers' transaction: one that
  // could not begin left the request running its turn for good, its turn read as running, and every later request of
  // the window came beside it)
  test("a request whose close could not write its ledgers runs its turn no more: the window's next request comes beside nothing", async () => {
    const c = conversation("beside-6");
    const one = await c.send([person("one")]);
    svc.archive.finishTurn(one.prep.turn, { finalMessage: answer("one"), requestId: one.id });
    /** @type {string[]} */
    const logged = [];
    const finish = createFinish({
      config: { get: () => ({ upstreams: [] }) },
      usage: { finish() {}, byId: new Map() },
      health: { recordSuccess() {}, recordFailure() {}, recordMeta() {} },
      liveAborts: new Map(),
      pushAlert() {},
      log: (/** @type {string} */ _l, /** @type {string} */ m) => logged.push(m),
      memory: svc,
    });
    // Its record closes while the archive cannot begin the ledgers' transaction (a busy file)
    const db = svc.archive.db;
    const exec = db.exec;
    let refused = 0;
    db.exec = (/** @type {string} */ sql) => {
      if (sql === "BEGIN IMMEDIATE" && !refused) {
        refused++;
        throw new Error("database is locked");
      }
      return exec.call(db, sql);
    };
    try {
      finish({ id: one.id, upstream: "m", memory: { chain: one.prep.chain, turn: one.prep.turnN, turnId: one.prep.turn }, tokens: { input: 1, output: 1 } }, { status: "ok", stopReason: "end_turn" });
    } finally {
      delete db.exec;
    }
    assert.equal(refused, 1, "the ledgers' transaction could not begin");
    assert.ok(logged.some((m) => /bookings were not written \(database is locked\)/.test(m)), logged.join("\n"));
    assert.equal(c.turnOf(one)?.meta?.running, undefined, "its turn reads as running no more");
    const two = await c.send([person("one"), answer("one"), person("two")]);
    assert.deepEqual([two.sit.alongside, two.sit.joinsRunning], [false, false], "the window's next request comes beside nothing");
    assert.equal(c.turnOf(two)?.meta?.alongside, undefined);
    c.done(two, answer("two"));
  });

  // (fails before: yes — memory said nothing as a client's turn ended: no lock holds a client's chat, and nothing else
  // told the server a turn of one ended)
  test("a client's chat ends its turn as the last request running a turn of it closes, its loop ended: a reply that calls a tool, the harness's request and Filament's own end none", async () => {
    /** @type {string[]} */
    const ended = [];
    svc.onClientTurnEnded = (/** @type {string} */ chainId) => ended.push(chainId);
    /** Its record closed as `finish` closes it. @param {{ id: string, prep: any }} r @param {any} [rec] */
    const close = (r, rec = {}) => svc.turnStopped({ id: r.id, status: "ok", stopReason: "end_turn", memory: { turnId: r.prep.turn }, ...rec });
    try {
      const c = conversation("beside-7");
      const one = await c.send([person("one")]);
      const chain = one.prep.chain;
      close(one, { stopReason: "tool_use" });
      assert.deepEqual(ended, [], "a reply that calls a tool: its loop waits on it");
      const two = await c.send([person("one"), answer("one"), person("two")]);
      const side = await c.send([person("one"), answer("one"), person("SIDE")]);
      assert.equal(side.sit.alongside, true, "a side request, beside the running turn");
      close(two);
      assert.deepEqual(ended, [], "the side request still runs a turn of the chat");
      close(side);
      assert.deepEqual(ended, [chain], "the last of them closed: the chat's turn ended, once");
      // The harness's own request, one through the Responses API, a loop's tick, a sub-agent's call: none ends a client's turn
      for (const rec of [{ api: "session" }, { api: "responses" }, { agentOf: "q0" }, { subagentOf: "q0" }])
        close(await c.send([person("one"), answer("one"), person("two"), answer("two"), person(`more ${Object.keys(rec)[0]}`)]), rec);
      assert.equal(ended.length, 1, ended.join(", "));
      // A request that failed, or whose client went, ends its loop whatever it was doing
      close(await c.send([person("one"), answer("one"), person("two"), answer("two"), person("it fails")]), { status: "error", stopReason: "tool_use", error: "upstream error" });
      assert.equal(ended.length, 2, "a failure ends the turn too");
    } finally {
      svc.onClientTurnEnded = null;
    }
  });

  // (fails before: yes — the review of c67ee7e08: a side request that came alongside a loop waiting on its client's tool
  // said the chat's turn ended as it closed, mid-turn, and the loop's leg said it again)
  test("a side request beside a loop that waits on its tools ends no turn: the loop's leg that ends it does, once", async () => {
    /** @type {string[]} */
    const ended = [];
    /** Its reply landed, and its record closed as `finish` closes it. @param {{ id: string, prep: any }} r @param {any} final @param {string} stopReason */
    const close = (r, final, stopReason) => {
      svc.archive.finishTurn(r.prep.turn, { finalMessage: final, requestId: r.id });
      svc.turnStopped({ id: r.id, status: "ok", stopReason, memory: { turnId: r.prep.turn } });
    };
    const c = conversation("beside-8");
    const one = await c.send([person("one")]);
    c.done(one, answer("one"));
    svc.onClientTurnEnded = (/** @type {string} */ chainId) => ended.push(chainId);
    try {
      const loop = await c.send([person("one"), answer("one"), person("M")]);
      close(loop, CALL, "tool_use");
      // Claude Code's /btw while the tool runs: the loop's last request, and a question of its own
      const btw = await c.send([person("one"), answer("one"), person("M"), person("BTW")]);
      assert.equal(btw.sit.alongside, true, "it comes alongside the waiting loop");
      close(btw, answer("BTW"), "end_turn");
      assert.deepEqual(ended, [], "the loop still waits on its tool");
      // The tool's result: the loop goes on, and its leg ends the turn
      const leg = await c.send([person("one"), answer("one"), person("M"), CALL, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] }]);
      close(leg, answer("M"), "end_turn");
      assert.deepEqual(ended, [loop.prep.chain], "once, as the loop ends");
    } finally {
      svc.onClientTurnEnded = null;
    }
  });

  // (fails before: yes — the review of 321965296: its read of the window's waiting loop sat outside the guard the close
  // keeps its archive reads in, and a failing read threw out of the record's close)
  test("a side request's close whose read of the waiting loop fails throws nothing, and says no end", async () => {
    /** @type {string[]} */
    const ended = [];
    const c = conversation("beside-9");
    const one = await c.send([person("one")]);
    c.done(one, answer("one"));
    const loop = await c.send([person("one"), answer("one"), person("M")]);
    svc.archive.finishTurn(loop.prep.turn, { finalMessage: CALL, requestId: loop.id });
    svc.turnStopped({ id: loop.id, status: "ok", stopReason: "tool_use", memory: { turnId: loop.prep.turn } });
    const btw = await c.send([person("one"), answer("one"), person("M"), person("BTW")]);
    assert.equal(btw.sit.alongside, true);
    const reads = svc.archive.loopWaits;
    svc.archive.loopWaits = () => {
      throw new Error("database is locked");
    };
    svc.onClientTurnEnded = (/** @type {string} */ chainId) => ended.push(chainId);
    try {
      assert.doesNotThrow(() => svc.turnStopped({ id: btw.id, status: "ok", stopReason: "end_turn", memory: { turnId: btw.prep.turn } }));
      assert.deepEqual(ended, [], "nothing said on a read that failed");
    } finally {
      svc.archive.loopWaits = reads;
      svc.onClientTurnEnded = null;
    }
  });

  // (fails before: no — a guard: memory's record of the requests running a turn lets go of one as its record closes,
  // whatever the close — a client gone mid-turn among them)
  test("a crashed client's turn that never ended: the next request of the window opens the next turn, beside nothing", async () => {
    const c = conversation("beside-4");
    const one = await c.send([person("one")]);
    c.done(one, answer("one"));
    const cut = await c.send([person("one"), answer("one"), person("M")]);
    c.done(cut); // its client hung up: the record closed with no reply
    const next = await c.send([person("one"), answer("one"), person("N")]);
    assert.ok(!next.sit.alongside && !next.sit.joinsRunning, "beside nothing");
    assert.deepEqual([next.prep.newTurn, next.prep.turnN], [true, cut.prep.turnN + 1], "the next turn, of its own");
    assert.equal(c.turnOf(next)?.meta?.alongside, undefined);
    assert.deepEqual(c.line(), ["one", "M", "N"], "the cut turn rewound nothing and was rewound by nothing");
    c.done(next, answer("N"));
  });
});

describe("the stop's bookkeeping (D16)", () => {
  // (fails before: yes — on b4ee117a2 markStopped also said `stopped` through `onSessionEvent`, which the server put on
  // the session's live topic for the drawing of another window's turn)
  test("markStopped stamps the request's turn, stamps nothing for a request that ran none, and says nothing through `onSessionEvent`", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-stop-"));
    const svc = new MemoryService({
      getConfig: () => ({ memory: { enabled: true, folder: join(dir, "mem"), privacy: { encryptArchive: false } } }),
      dataDir: dir,
      log: () => {},
    });
    svc.start();
    /** @type {any[]} */
    const said = [];
    svc.onSessionEvent = (chainId, e) => said.push({ chainId, ...e });
    try {
      const ch = svc.archive.chainForKey("h:stop", { cwd: "C:\\stop", client: "harness" });
      svc.archive.beginTurn(ch.id, { requestId: "rq-1", model: "m", upstream: "u", userMessage: { role: "user", content: [{ type: "text", text: "go" }] } });
      svc.markStopped(ch.id, { requestId: "rq-1", by: "harness", forced: true });
      const stamp = svc.archive.getTurns(ch.id)[0].meta?.stopped;
      assert.deepEqual([stamp?.by, typeof stamp?.at, stamp?.forced], ["harness", "number", true], "the request's turn is stamped, a Force stop said");
      svc.markStopped(ch.id, { requestId: "rq-elsewhere", by: "harness" });
      assert.equal(svc.archive.getTurns(ch.id)[0].meta?.stopped?.forced, true, "a request that ran no turn here stamps nothing: the turn keeps its own stamp");
      assert.deepEqual(said, [], "the harness's run draws its own stop: `onSessionEvent` hears nothing of it");
    } finally {
      await svc.shutdown();
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
});

describe("a turn alongside its window's running turn, in the archive", () => {
  // (fails before: yes — the bug hunt of 10-30, its last pass: the archive looked at the chain's newest turn alone for
  // the turn a message goes on with, so a second send of the running turn's message, made once a side request of its
  // window had opened a turn of its own, opened a second turn of it; its fourth pass: a newer turn that came alongside
  // nothing still hid it)
  test("a second send of the running turn's message is that turn, whatever turns opened since", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-alongside-"));
    const svc = new MemoryService({
      getConfig: () => ({ memory: { enabled: true, folder: join(dir, "mem"), privacy: { encryptArchive: false } } }),
      dataDir: dir,
      log: () => {},
    });
    svc.start();
    try {
      const a = svc.archive;
      const ch = a.chainForKey("h:again", { cwd: "C:\\again", client: "claude-code" });
      const turn = a.beginTurn(ch.id, { requestId: "r1", window: "h:w", userMessage: person("the running turn"), running: true });
      a.beginTurn(ch.id, { requestId: "r2", window: "h:w", userMessage: person("a side question"), alongside: true, running: true });
      a.beginTurn(ch.id, { requestId: "r4", window: "h:w", userMessage: person("the person's own"), running: true });
      const again = a.beginTurn(ch.id, { requestId: "r3", window: "h:w", userMessage: person("the running turn"), alongside: true, running: true, joinsRunning: true });
      assert.deepEqual([again.turnId, again.n, again.isNew], [turn.turnId, turn.n, false], "the running turn, not a second one");
      assert.equal(a.getTurns(ch.id).length, 3);
      // Another window's turn with the same words is never this window's to join
      assert.equal(a.beginTurn(ch.id, { requestId: "r5", window: "h:x", userMessage: person("the running turn"), running: true, joinsRunning: true }).isNew, true);
      // A turn no request runs is an older one: a look-alike text never reopens it
      const other = a.chainForKey("h:again-2", { cwd: "C:\\again", client: "claude-code" });
      a.beginTurn(other.id, { requestId: "s1", window: "h:v", userMessage: person("continue") });
      a.beginTurn(other.id, { requestId: "s2", window: "h:v", userMessage: person("something else") });
      assert.equal(a.beginTurn(other.id, { requestId: "s3", window: "h:v", userMessage: person("continue") }).isNew, true);
    } finally {
      await svc.shutdown();
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });

  // (fails before: yes — the review of the bug hunt's last pass: any turn still marked `meta.running` with the message's
  // words took it, so a turn a restart cut off, which keeps its mark, swallowed the next message with its words)
  test("a turn a restart cut off keeps its mark, and a new message with its words is a turn of its own", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-alongside-"));
    const svc = new MemoryService({
      getConfig: () => ({ memory: { enabled: true, folder: join(dir, "mem"), privacy: { encryptArchive: false } } }),
      dataDir: dir,
      log: () => {},
    });
    svc.start();
    try {
      const a = svc.archive;
      const ch = a.chainForKey("h:cut", { cwd: "C:\\cut", client: "claude-code" });
      const cut = a.beginTurn(ch.id, { requestId: "c1", window: "harness", userMessage: person("continue"), running: true });
      for (const [i, text] of ["six", "seven", "eight"].entries()) {
        const t = a.beginTurn(ch.id, { requestId: `c${i + 2}`, window: "harness", userMessage: person(text), running: true });
        a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: `ok ${text}` } });
      }
      assert.equal(typeof a.getTurns(ch.id).find((/** @type {any} */ t) => t.id === cut.turnId)?.meta.running, "number", "the cut turn keeps its mark");
      const next = a.beginTurn(ch.id, { requestId: "c9", window: "harness", userMessage: person("continue"), running: true });
      assert.deepEqual([next.isNew, next.n], [true, 5], "a turn of its own, at the end of the chat");
      // A second send of a running request's message whose turn went on a rewound line opens one
      const asked = a.beginTurn(ch.id, { requestId: "c10", window: "harness", userMessage: person("asked once"), running: true });
      a.beginTurn(ch.id, { requestId: "c11", window: "harness", userMessage: person("ten"), running: true });
      a.mergeTurnMeta(asked.turnId, { rewound: { line: "l1", by: "harness", at: 1 } });
      assert.equal(a.beginTurn(ch.id, { requestId: "c12", window: "harness", userMessage: person("asked once"), running: true, joinsRunning: true }).n, 8);
    } finally {
      await svc.shutdown();
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
});

describe("the session's line, with a window's turns beside each other (D11)", () => {
  /** @type {any} */
  let svc;
  let dir = "";
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-line-"));
    svc = new MemoryService({
      getConfig: () => ({ memory: { enabled: true, folder: join(dir, "mem"), privacy: { encryptArchive: false } } }),
      dataDir: dir,
      log: () => {},
    });
    svc.start();
  });
  after(async () => {
    await svc.shutdown();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });
  /**
   * An OpenCode conversation as memory reads it: its requests, situated, and its turns, archived as its requests would
   * archive them. @param {string} sid
   */
  const conversation = (sid) => {
    const zc = (/** @type {any[]} */ messages) => svc.situate({ format: "anthropic", body: { model: "m-1", max_tokens: 10, messages }, headers: { "x-session-id": sid, "user-agent": "opencode/1.0" }, model: "m-1" });
    const first = zc([person("one")]);
    const ch = svc.archive.chainForKey(first.key, { cwd: `C:\\${sid}`, client: "opencode" });
    /** @param {string} text @param {{ finished?: boolean, alongside?: boolean, running?: boolean }} [o] */
    const said = (text, { finished = true, alongside = false, running = false } = {}) => {
      const t = svc.archive.beginTurn(ch.id, { requestId: `r:${text}`, window: first.window, client: "opencode", format: "anthropic", userMessage: person(text), alongside, running });
      if (finished) svc.archive.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: `a ${text}` }] } });
      return t;
    };
    const textOf = (/** @type {any} */ t) => replyText(svc.archive.getMessage(t.user_hash)?.message);
    return {
      zc,
      said,
      ch,
      window: first.window,
      line: () => svc.archive.getTurns(ch.id).filter((/** @type {any} */ t) => !t.meta?.rewound).map(textOf),
      rewound: () => svc.archive.getTurns(ch.id).filter((/** @type {any} */ t) => t.meta?.rewound).map(textOf),
    };
  };
  const answer = (/** @type {string} */ text) => ({ role: "assistant", content: `a ${text}` });

  // (fails before: yes — the bug hunt of 10-30, its fourth pass: a fork's turn the history left out rewound the line from
  // it, and the person's next turn, which came after the fork and which the history holds, went with it)
  test("a rewind drops the turns the history no longer holds and keeps those it holds past them; a regenerate still drops its turn", () => {
    const c = conversation("line-1a");
    c.said("one");
    c.said("M");
    c.said("F", { alongside: true });
    c.said("Q");
    svc.alignHistory(c.zc([person("one"), answer("one"), person("M"), answer("M"), person("Q"), answer("Q"), person("R")]));
    assert.deepEqual(c.rewound(), ["F"], "the fork's turn, which the history left out");
    assert.deepEqual(c.line(), ["one", "M", "Q"], "the person's turn after it stays on the line");
    // Asked again: the newest message is the turn's own, with no reply after it — that turn goes
    svc.alignHistory(c.zc([person("one"), answer("one"), person("M"), answer("M"), person("Q")]));
    assert.deepEqual(c.rewound(), ["F", "Q"]);
  });

  // (fails before: yes — the bug hunt of 10-30, its fourth pass: the person's own turn, still at work, went with a rewind
  // from a fork's turn before it, though the history holds it)
  test("a turn still at work that the history holds stays on the line through a rewind from a turn before it", () => {
    const c = conversation("line-1b");
    c.said("one");
    c.said("F1");
    c.said("P", { finished: false, alongside: true, running: true });
    // The person's own words once P's tool call was cut short, sent with the call answered as interrupted
    const cut = { role: "user", content: [{ type: "tool_result", tool_use_id: "p1", content: "interrupted", is_error: true }, { type: "text", text: "N" }] };
    svc.alignHistory(c.zc([person("one"), answer("one"), person("P"), { role: "assistant", content: [{ type: "tool_use", id: "p1", name: "Read", input: {} }] }, cut]));
    assert.deepEqual(c.rewound(), ["F1"]);
    assert.deepEqual(c.line(), ["one", "P"]);
  });

  // (fails before: yes — the bug hunt of 10-30, its fourth pass: a leg of the window's turn found no turn once a newer
  // turn of the window had opened that came alongside nothing, and its work went unarchived)
  test("a leg finds the window's turn whose loop is at work, whatever turns of the window opened since; one that answered never reopens", () => {
    const c = conversation("line-leg");
    c.said("one");
    const p = c.said("P", { finished: false, alongside: true });
    c.said("S");
    assert.equal(svc.archive.turnForUser(c.ch.id, person("P"), { window: c.window })?.n, p.n, "its loop has no answer yet");
    // A loop whose reply called a tool is at work too
    const q = c.said("Q", { finished: false });
    svc.archive.finishTurn(q.turnId, { finalMessage: { role: "assistant", content: [{ type: "tool_use", id: "q1", name: "Read", input: {} }] } });
    c.said("T");
    assert.equal(svc.archive.turnForUser(c.ch.id, person("Q"), { window: c.window })?.n, q.n);
    // A look-alike of a turn that answered, with a newer turn of the window, reopens nothing
    assert.equal(svc.archive.turnForUser(c.ch.id, person("one"), { window: c.window }), null);
    // The window's newest turn is its own leg's whatever its answer, as ever
    const again = c.said("continue");
    assert.equal(svc.archive.turnForUser(c.ch.id, person("continue"), { window: c.window })?.n, again.n);
  });
});
