// @ts-check
// What a chat is owed a wake for survives a restart (sessions/owed-wakes.js; the nudge map of 11-10, a second opinion's
// too: "Nothing wakes a chat after a restart"). What waits untold for its agent, its come-back and its idle check-in are
// kept with the chat as each changes and given back as Filament starts, each by its id so nothing is told twice; a
// come-back whose time came while Filament was not running comes once, saying it came late; an idle check-in is armed
// again at its time, and tells the agent the restart ended the commands it was set for. The chats owed a wake are woken
// one after another a few seconds apart, never one the person stopped nor one whose account is out of quota.
// (fails before: yes — every piece here is new: the untold items, come-backs and idle timers lived in memory alone,
// and nothing woke a chat after a restart)
import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  cancelComeBack,
  comeBackKept,
  comeBackLater,
  comeBackOf,
  disposeBackgroundShells,
  keepComeBack,
  keepUntold,
  onShellWake,
  onUntoldChange,
  peekShellExits,
  takeShellExits,
  tellLater,
  untoldOf,
  wakeDue,
  wakeKindOf,
} from "../src/adapters/tools/hands.js";
import { createIdleWaker, idleGoneText, idleText } from "../src/app/sessions/idle-wake.js";
import { WAKE_LINE, wakeLineFor } from "../src/app/sessions/wake.js";
import { OWED_MAX_AGE_MS, OWED_STAGGER_MS, createOwedKeeper, restoreOwed, staleWords, wakeOwedAtStart } from "../src/app/sessions/owed-wakes.js";

const MIN = 60_000;
const T0 = 5_000_000_000;
const main = (/** @type {string} */ session) => ({ session, agent: null });

describe("what waits untold for a chat's agent, kept across a restart", () => {
  afterEach(async () => {
    await disposeBackgroundShells();
  });

  test("each change of a session's is heard, and what it holds is read as kept; the stop's clear is heard by nobody", async () => {
    /** @type {string[]} */
    const heard = [];
    const off = onUntoldChange((s) => void heard.push(s));
    try {
      tellLater(main("ow-1"), { id: "bg_a", command: "npm test", code: 0, text: "[Filament: bg_a ended.]" }, { wake: false });
      tellLater({ session: "ow-1", agent: "subagent:sa_1" }, { id: "bg_b", command: "npm run lint", code: 1, text: "[Filament: bg_b ended.]", kind: "lines" }, { wake: false });
      assert.deepEqual(heard, ["ow-1", "ow-1"]);
      assert.deepEqual(
        untoldOf("ow-1").map((x) => [x.id, x.agent, x.kind]),
        [
          ["bg_a", null, "exit"],
          ["bg_b", "subagent:sa_1", "lines"],
        ],
        "every agent's of the session, as kept",
      );
      assert.deepEqual(untoldOf("ow-other"), []);
      takeShellExits(main("ow-1"));
      assert.deepEqual(heard, ["ow-1", "ow-1", "ow-1"], "told: heard as it goes");
      heard.length = 0;
      await disposeBackgroundShells();
      assert.deepEqual(heard, [], "Filament's stop clears what it holds, and the chats keep it");
      assert.deepEqual(untoldOf("ow-1"), []);
    } finally {
      off();
    }
  });

  test("given back as Filament starts: to the session's main agent, ahead of what came since, each once by its id — and it wakes nothing by itself", () => {
    /** @type {string[]} */
    const woke = [];
    const off = onShellWake((s) => void woke.push(s));
    try {
      tellLater(main("ow-2"), { id: "stop_1", command: "", code: null, text: "[Filament: the restart's word.]" }, { wake: false });
      const kept = [
        { id: "bg_c", command: "npm test", code: 2, agent: "subagent:sa_2", kind: /** @type {const} */ ("exit") },
        { id: "wake_1", command: "", code: null, agent: null, kind: /** @type {const} */ ("wake"), text: "[Filament: the time you set has come.]" },
      ];
      keepUntold("ow-2", kept);
      keepUntold("ow-2", kept);
      assert.deepEqual(
        peekShellExits(main("ow-2")).map((x) => x.id),
        ["bg_c", "wake_1", "stop_1"],
        "each once, the kept first",
      );
      assert.match(peekShellExits(main("ow-2"))[0].text, /background shell bg_c \(npm test\), started by sub-agent sa_2, exited with code 2 — its output is no longer kept\./);
      assert.equal(wakeDue("ow-2"), true);
      assert.deepEqual(woke, [], "the start's sweep wakes it");
    } finally {
      off();
    }
  });
});

describe("a come-back across a restart", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 }));
  afterEach(async () => {
    mock.timers.reset();
    await disposeBackgroundShells();
  });

  test("kept with its id, its time, when it was set and its note; one still to come waits for its time again, and comes in its usual words", async () => {
    comeBackLater("cb-1", { seconds: 600, note: "check the deploy" });
    const kept = comeBackKept("cb-1");
    assert.ok(kept);
    assert.deepEqual([kept.at, kept.setAt, kept.note], [T0 + 10 * MIN, T0, "check the deploy"]);
    assert.match(kept.id, /^wake_/);
    await disposeBackgroundShells();
    assert.equal(comeBackOf("cb-1"), null, "the stop clears it");
    mock.timers.tick(4 * MIN);
    assert.equal(keepComeBack("cb-1", kept), "armed");
    assert.deepEqual(comeBackOf("cb-1"), { at: T0 + 10 * MIN, note: "check the deploy" }, "the page shows it again");
    mock.timers.tick(6 * MIN - 1);
    assert.deepEqual(peekShellExits(main("cb-1")), []);
    mock.timers.tick(1);
    const told = peekShellExits(main("cb-1"));
    assert.deepEqual(
      told.map((x) => [x.id, x.kind, x.text]),
      [[kept.id, "wake", "[Filament: the time you set has come — 10 min ago you asked to come back to this chat. Your note: check the deploy]"]],
    );
  });

  test("one whose time came while Filament was not running is told once as it starts, saying it came late — waking nothing by itself; kept again, it is not told twice", () => {
    /** @type {string[]} */
    const woke = [];
    const off = onShellWake((s) => void woke.push(s));
    try {
      const kept = { id: "wake_late", at: T0 - 47 * MIN, setAt: T0 - 60 * MIN, note: "look at CI" };
      assert.equal(keepComeBack("cb-2", kept), "due");
      assert.equal(comeBackOf("cb-2"), null, "nothing waits for a time any more");
      const told = peekShellExits(main("cb-2"));
      assert.deepEqual(
        told.map((x) => [x.id, x.kind, x.text]),
        [["wake_late", "wake", "[Filament: the time you set has come — 1 h ago you asked to come back to this chat. It was due 47 min ago, while Filament was not running, so it comes late. Your note: look at CI]"]],
      );
      assert.deepEqual(woke, [], "the start's sweep wakes it");
      assert.equal(keepComeBack("cb-2", kept), null, "told already, by its id");
      assert.equal(peekShellExits(main("cb-2")).length, 1);
      // One the agent set since is the chat's: the one kept from before is left.
      comeBackLater("cb-3", { seconds: 120, note: "newer" });
      assert.equal(keepComeBack("cb-3", { ...kept, id: "wake_old" }), null);
      assert.equal(comeBackOf("cb-3")?.note, "newer");
      cancelComeBack("cb-3");
    } finally {
      off();
    }
  });
});

describe("an idle check-in across a restart", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 }));
  afterEach(() => mock.timers.reset());

  /** @param {Record<string, any[]>} runs */
  const rig = (runs) => {
    /** @type {any[]} */
    const told = [];
    /** @type {any[]} */
    const asked = [];
    /** @type {[string, any][]} */
    const changes = [];
    const w = createIdleWaker({
      minutes: () => 5,
      running: (chat) => runs[chat] ?? [],
      blocked: (chat, o) => (asked.push([chat, o ?? {}]), false),
      tell: (chat, note) => void told.push({ chat, ...note }),
      changed: (chat, wake) => void changes.push([chat, wake]),
    });
    return { w, told, asked, changes };
  };
  const build = { id: "bg_9", command: "npm run build", startedAt: T0 - 2 * MIN };

  test("kept as it is armed: its id, time, wait, back-off and commands; armed again on a new waker at its time, the page told", () => {
    const before = rig({ c1: [build] });
    before.w.ended("c1");
    const kept = before.w.kept("c1");
    assert.deepEqual(kept && { ...kept, id: typeof kept.id }, { id: "number", at: T0 + 5 * MIN, since: T0, waitMin: 5, streak: 0, commands: [build] });
    before.w.dispose();
    assert.equal(before.w.kept("c1"), null);

    // The restart: a new waker, and nothing of the chat's runs.
    const after = rig({});
    assert.equal(after.w.restore("c1", /** @type {any} */ (kept)), true);
    assert.equal(after.w.restore("c1", /** @type {any} */ (kept)), false, "armed once");
    assert.deepEqual(after.changes, [["c1", { at: T0 + 5 * MIN, commands: [build] }]]);
    mock.timers.tick(5 * MIN - 1);
    assert.equal(after.told.length, 0, "not before its time");
    mock.timers.tick(1);
    assert.deepEqual(after.asked, [["c1", { restored: true }]], "asked whether it is held, as one armed again");
    assert.equal(after.told.length, 1);
    assert.deepEqual([after.told[0].chat, after.told[0].id, after.told[0].kind], ["c1", `idle-${kept?.id}`, "exit"], "its id kept; told as the commands' end");
    assert.equal(after.told[0].text, idleGoneText([build], { idleMin: 5 }));
    assert.equal(
      after.told[0].text,
      "[Filament: 5 min since your turn ended, and Filament restarted meanwhile: the background command you left running ran under the Filament that stopped, which ended it — `npm run build` (bg_9). Filament no longer follows it, and its result will not come. Say in a line where your work stands, then start again what you still need, or go on with your work.]",
    );
  });

  test("one whose time came while Filament was not running fires at once; a turn that begins first drops it", () => {
    const r = rig({});
    r.w.restore("c2", { id: 7, at: T0 - MIN, since: T0 - 45 * MIN, waitMin: 10, streak: 2, commands: [build, { ...build, id: "bg_10", command: "npm run dev" }] });
    // (fails before: yes — the review of 11-11: it fired a timer's turn later, which came after the start's sweep where
    // no cut turn went on first, so its chat was woken apart from the sweep's stagger)
    assert.equal(r.told.length, 1, "told before restore answers, while the start still gathers the chats it owes a wake");
    mock.timers.tick(0);
    assert.equal(r.told.length, 1, "and once");
    // (fails before: yes — the review of 11-11: it said its last wait, "10 min", whenever it came)
    assert.match(r.told[0].text, /^\[Filament: 45 min since your turn ended, and Filament restarted meanwhile: the 2 background commands you left running ran under the Filament that stopped, which ended them — `npm run build` \(bg_9\); `npm run dev` \(bg_10\)\. Filament no longer follows them, and their results will not come\./);
    // One kept before a chat kept when its turn ended: counted from its time less its wait.
    r.w.restore("c2b", /** @type {any} */ ({ id: 9, at: T0 - MIN, waitMin: 10, streak: 0, commands: [build] }));
    mock.timers.tick(0);
    assert.match(r.told[1].text, /^\[Filament: 11 min since your turn ended, and Filament restarted meanwhile/);
    r.told.length = 1;
    r.w.restore("c3", { id: 8, at: T0 + MIN, waitMin: 5, streak: 0, commands: [build] });
    r.w.began("c3");
    mock.timers.tick(2 * MIN);
    assert.equal(r.told.length, 1, "the turn took its place");
  });

  test("ids from the clock on: one kept from before a restart is never given again", () => {
    const r = rig({ c4: [build] });
    r.w.ended("c4");
    assert.ok(Number(r.w.kept("c4")?.id) > T0, `${r.w.kept("c4")?.id}`);
  });
});

/** An archive as the keeper reads and writes it: messages by hash, and each chain's meta. */
const fakeArchive = () => {
  /** @type {Map<string, any>} */
  const messages = new Map();
  /** @type {Map<string, Record<string, any>>} */
  const metas = new Map([["k1", {}], ["k2", {}]]);
  let writes = 0;
  return {
    messages,
    metas,
    writes: () => writes,
    putMessage: (/** @type {string} */ _role, /** @type {any} */ msg) => {
      const hash = `h${messages.size + 1}`;
      for (const [h, m] of messages) if (JSON.stringify(m) === JSON.stringify(msg)) return { hash: h };
      messages.set(hash, msg);
      return { hash };
    },
    getMessage: (/** @type {string} */ hash) => (messages.has(hash) ? { message: messages.get(hash) } : null),
    hasChain: (/** @type {string} */ id) => metas.has(id),
    mergeMeta: (/** @type {string} */ id, /** @type {Record<string, any>} */ patch) => {
      writes++;
      const m = metas.get(id) || {};
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete m[k];
      else m[k] = v;
      metas.set(id, m);
    },
    owedWakes: () =>
      [...metas]
        .filter(([, m]) => m.owedWakes || m.goalOwed || (m.subagentQueue || []).some((/** @type {any} */ e) => e.wakes))
        .map(([id, m]) => ({ id, owed: m.owedWakes ?? null, goal: !!m.goalOwed, queued: (m.subagentQueue || []).some((/** @type {any} */ e) => e.wakes) })),
  };
};

describe("the keeper", () => {
  const owed = () => ({
    untold: [{ id: "bg_1", command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz"', code: 0, agent: null, kind: /** @type {const} */ ("lines"), text: "[Filament: the lines: token sk-ant-abcdefghijklmnop]" }],
    comeBack: { id: "wake_1", at: T0 + MIN, setAt: T0, note: "check the deploy" },
    idle: { id: 3, at: T0 + 5 * MIN, waitMin: 5, streak: 1, commands: [{ id: "bg_2", command: "npm run dev -- --token=ghp_abcdefghijklmnopqrstuvwxyz", startedAt: T0 }] },
  });

  test("writes what a chat is owed where it changed: its words archived as messages, its commands' lines redacted; nothing owed clears it", () => {
    const a = fakeArchive();
    const k = createOwedKeeper({ archive: () => a });
    k.keep("k1", owed());
    const rec = a.metas.get("k1")?.owedWakes;
    assert.equal(rec.untold[0].command, 'curl -H "Authorization: Bearer [redacted]"', "redacted, as the running commands' record is");
    assert.equal(rec.untold[0].text, undefined, "its words are not in the meta");
    assert.equal(a.getMessage(rec.untold[0].textHash)?.message.content[0].text, "[Filament: the lines: token sk-ant-abcdefghijklmnop]", "but archived, as the waiting reports are");
    assert.equal(a.getMessage(rec.comeBack.noteHash)?.message.content[0].text, "check the deploy");
    assert.equal(rec.idle.commands[0].command, "npm run dev -- --token=ghp_…");
    assert.equal(a.writes(), 1);
    k.keep("k1", owed());
    assert.equal(a.writes(), 1, "the same again writes nothing");
    k.keep("k1", { untold: [], comeBack: null, idle: null });
    assert.equal(a.metas.get("k1")?.owedWakes, undefined, "nothing owed clears it");
    k.keep("gone", owed());
    assert.equal(a.metas.has("gone"), false, "a chat that is gone keeps nothing");
    k.stop();
    k.keep("k2", owed());
    assert.equal(a.metas.get("k2")?.owedWakes, undefined, "nothing once Filament stops");
  });

  test("reads back every chat's as Filament starts, its words restored; an item whose words are gone is left out; a goal's round and a waking report are said", () => {
    const a = fakeArchive();
    createOwedKeeper({ archive: () => a }).keep("k1", owed());
    a.metas.set("k3", { goalOwed: true });
    a.metas.set("k4", { subagentQueue: [{ hash: "x", wakes: true }] });
    a.metas.set("k5", { subagentQueue: [{ hash: "y" }] });
    const k = createOwedKeeper({ archive: () => a });
    const rows = k.kept();
    assert.deepEqual(
      rows.map((r) => [r.chainId, r.goal, r.queued]),
      [
        ["k1", false, false],
        ["k3", true, false],
        ["k4", false, true],
      ],
    );
    const back = rows[0].owed;
    assert.equal(back.untold[0].text, "[Filament: the lines: token sk-ant-abcdefghijklmnop]");
    assert.deepEqual(back.comeBack, owed().comeBack);
    assert.deepEqual([back.idle?.id, back.idle?.at, back.idle?.streak], [3, T0 + 5 * MIN, 1]);
    // What the start gives back is kept again by its own keep, which names what it could not give back — here nothing
    // —, even where it holds the same: the meta then says what is owed now.
    const w = a.writes();
    k.keep("k1", { untold: [], comeBack: null, idle: null }, []);
    assert.equal(a.writes(), w + 1);
    assert.equal(a.metas.get("k1")?.owedWakes, undefined);
    // A word that is gone from the archive.
    createOwedKeeper({ archive: () => a }).keep("k2", owed());
    a.messages.clear();
    const lost = createOwedKeeper({ archive: () => a }).kept().find((r) => r.chainId === "k2");
    assert.deepEqual([lost?.owed.untold.length, lost?.owed.comeBack, !!lost?.owed.idle], [0, null, true]);
  });
});

describe("given back as Filament starts", () => {
  test("each chat's: what waited untold, its come-back, its idle check-in, a goal's round; → the chats owed a wake now, each asked to keep itself again", () => {
    /** @type {any[]} */
    const calls = [];
    const none = { untold: [], comeBack: null, idle: null };
    const owed = restoreOwed(
      [
        { chainId: "a", owed: { ...none, untold: [{ id: "bg_1", command: "x", code: 0, agent: null }] }, goal: false, queued: false },
        { chainId: "b", owed: { ...none, untold: [{ id: "c_1", command: "", code: null, agent: null, kind: "cancel", text: "[cancelled]" }] }, goal: false, queued: false },
        { chainId: "c", owed: { ...none, comeBack: { id: "w1", at: 1, setAt: 0, note: "late" } }, goal: false, queued: false },
        { chainId: "d", owed: { ...none, comeBack: { id: "w2", at: 9, setAt: 0, note: "later" } }, goal: false, queued: false },
        { chainId: "e", owed: { ...none, idle: { id: 1, at: 5, waitMin: 5, streak: 0, commands: [] } }, goal: false, queued: false },
        { chainId: "f", owed: none, goal: true, queued: false },
        { chainId: "g", owed: none, goal: false, queued: true },
        { chainId: "h", owed: { ...none, comeBack: { id: "w3", at: 1, setAt: 0, note: "boom" } }, goal: false, queued: false },
        { chainId: "i", owed: none, goal: false, queued: true },
      ],
      {
        keepUntold: (c, items) => void calls.push(["untold", c, items.map((x) => x.id)]),
        keepComeBack: (c, cb) => {
          if (c === "h") throw new Error("boom");
          calls.push(["comeBack", c, cb.id]);
          return cb.note === "late" ? "due" : "armed";
        },
        restoreIdle: (c) => (calls.push(["idle", c]), true),
        oweGoal: (c) => void calls.push(["goal", c]),
        kept: (c) => void calls.push(["kept", c]),
        log: (level, msg) => void calls.push(["log", level, msg]),
      },
    );
    assert.deepEqual(owed, ["a", "c", "f", "g", "i"], "a waking item, a come-back come late, a goal's round, a waking report — not a Cancel's word alone, nor what waits for its time");
    assert.deepEqual(
      calls.filter((x) => x[0] !== "log" && x[0] !== "kept"),
      [
        ["untold", "a", ["bg_1"]],
        ["untold", "b", ["c_1"]],
        ["comeBack", "c", "w1"],
        ["comeBack", "d", "w2"],
        ["idle", "e"],
        ["goal", "f"],
      ],
    );
    assert.deepEqual(calls.filter((x) => x[0] === "kept").map((x) => x[1]), ["a", "b", "c", "d", "e", "f", "g", "h", "i"], "each kept again, the failed one too");
    assert.match(calls.find((x) => x[0] === "log")?.[2], /session h: what it was owed a wake for as Filament stopped could not be given back \(boom\)/);
  });

  // (fails before: yes — the review of 11-11: one try covered a chat's untold items, its come-back, its idle check-in and
  // its goal's round, so a come-back that could not be armed left the check-in and the round not given back and the chat
  // owed no wake, and the keep that followed wrote what memory held over all of it: the come-back went from the disk)
  test("a part that cannot be given back takes none of the others with it, and stays kept as it was: the next start reads it again, until one set since takes its place", () => {
    const a = fakeArchive();
    const kept = {
      untold: [{ id: "bg_1", command: "npm test", code: 0, agent: null, kind: /** @type {const} */ ("lines"), text: "[Filament: the lines.]" }],
      comeBack: { id: "wake_1", at: T0 + MIN, setAt: T0, note: "check the deploy" },
      idle: { id: 3, at: T0 + 5 * MIN, since: T0, waitMin: 5, streak: 1, commands: [{ id: "bg_2", command: "npm run dev", startedAt: T0 }] },
    };
    createOwedKeeper({ archive: () => a }).keep("k1", kept);
    /** @type {any} */ (a.metas.get("k1")).goalOwed = true;
    const before = structuredClone(a.metas.get("k1")?.owedWakes);
    const k = createOwedKeeper({ archive: () => a });
    /** What the start gave back, as the chat's keep reads it from memory. @type {import("../src/app/sessions/owed-wakes.js").Owed} */
    const mem = { untold: [], comeBack: null, idle: null };
    /** @type {any[]} */
    const calls = [];
    const owed = restoreOwed(k.kept(), {
      keepUntold: (_c, items) => void (mem.untold = items),
      keepComeBack: () => {
        throw new Error("boom");
      },
      restoreIdle: (_c, i) => ((mem.idle = i), true),
      oweGoal: (c) => void calls.push(["goal", c]),
      kept: (c, failed) => (calls.push(["kept", c, failed]), k.keep(c, mem, failed)),
      log: (level, msg) => void calls.push(["log", level, msg]),
    });
    assert.deepEqual(owed, ["k1"], "owed a wake for what was given back");
    assert.deepEqual([mem.untold.map((x) => x.id), mem.idle?.id], [["bg_1"], 3], "its untold item and its check-in given back");
    assert.deepEqual(calls.filter((x) => x[0] !== "log"), [["goal", "k1"], ["kept", "k1", ["comeBack"]]], "its goal's round too, and its keep told which part failed");
    assert.match(calls.find((x) => x[0] === "log")?.[2], /session k1: what it was owed a wake for as Filament stopped could not be given back \(boom\): its come-back, which stays kept for the next start$/);
    assert.deepEqual(a.metas.get("k1")?.owedWakes, before, "nothing written over the part that failed");
    // What memory holds moves on — the item told, the check-in spent —: the come-back stays kept as it was.
    mem.untold = [];
    mem.idle = null;
    k.keep("k1", mem);
    assert.deepEqual(a.metas.get("k1")?.owedWakes, { comeBack: before.comeBack });
    assert.deepEqual(createOwedKeeper({ archive: () => a }).kept().find((r) => r.chainId === "k1")?.owed.comeBack, kept.comeBack, "the next start reads it back");
    // One the agent set since is the chat's.
    k.keep("k1", { ...mem, comeBack: { id: "wake_2", at: T0 + 9 * MIN, setAt: T0 + MIN, note: "newer" } });
    assert.equal(a.metas.get("k1")?.owedWakes.comeBack.id, "wake_2");
    k.keep("k1", mem);
    assert.equal(a.metas.get("k1")?.owedWakes, undefined, "and once that one is gone, nothing is kept");
  });

  // (fails before: yes — the same: untold items that could not be given back were written over by the keep that followed)
  test("untold items that cannot be given back stay kept beside what came since, each once", () => {
    const a = fakeArchive();
    const item = (/** @type {string} */ id) => ({ id, command: "npm test", code: 0, agent: null });
    createOwedKeeper({ archive: () => a }).keep("k1", { untold: [item("bg_1"), item("bg_2")], comeBack: null, idle: { id: 4, at: T0 + MIN, since: T0, waitMin: 1, streak: 0, commands: [] } });
    const k = createOwedKeeper({ archive: () => a });
    /** @type {import("../src/app/sessions/owed-wakes.js").Owed} */
    const mem = { untold: [], comeBack: null, idle: null };
    const owed = restoreOwed(k.kept(), {
      keepUntold: () => {
        throw new Error("full");
      },
      keepComeBack: () => null,
      restoreIdle: (_c, i) => ((mem.idle = i), true),
      oweGoal: () => {},
      kept: (c, failed) => k.keep(c, mem, failed),
    });
    assert.deepEqual(owed, [], "nothing given back wakes it");
    assert.equal(mem.idle?.id, 4, "its check-in armed all the same");
    k.keep("k1", { ...mem, untold: [item("bg_2"), item("bg_3")] });
    assert.deepEqual(a.metas.get("k1")?.owedWakes.untold.map((/** @type {any} */ x) => x.id), ["bg_1", "bg_2", "bg_3"]);
  });

  // (fails before: yes — the same, as the server wires it: each part given back asks the chat's keep at once (hands.js
  // `onUntoldChange`, `onComeBackChange`, the idle waker's `changed`), and that keep wrote what memory held so far over
  // the parts not given back yet — the one that then failed among them, which the start's own keep no longer found)
  test("as the server wires it, each part given back keeps the chat at once: whichever part fails stays kept as it was, and nothing is written before the start's own keep", () => {
    const kept = {
      untold: [{ id: "bg_1", command: "npm test", code: 0, agent: null, kind: /** @type {const} */ ("lines"), text: "[Filament: the lines.]" }],
      comeBack: { id: "wake_1", at: T0 + MIN, setAt: T0, note: "check the deploy" },
      idle: { id: 3, at: T0 + 5 * MIN, since: T0, waitMin: 5, streak: 1, commands: [{ id: "bg_2", command: "npm run dev", startedAt: T0 }] },
    };
    for (const fails of /** @type {const} */ (["untold", "comeBack", "idle"])) {
      const a = fakeArchive();
      createOwedKeeper({ archive: () => a }).keep("k1", kept);
      const before = structuredClone(a.metas.get("k1")?.owedWakes);
      const k = createOwedKeeper({ archive: () => a });
      /** @type {import("../src/app/sessions/owed-wakes.js").Owed} */
      const mem = { untold: [], comeBack: null, idle: null };
      /** What the record on disk held at each keep a part given back asked for. @type {any[]} */
      const midway = [];
      /** A part given back, or not: memory holds it, and its change asks the chat's keep, as the server's hooks do. @param {"untold" | "comeBack" | "idle"} part @param {() => void} set */
      const given = (part, set) => {
        if (part === fails) throw new Error("boom");
        set();
        k.keep("k1", mem);
        midway.push(structuredClone(a.metas.get("k1")?.owedWakes));
      };
      restoreOwed(k.kept(), {
        keepUntold: (_c, items) => given("untold", () => (mem.untold = items)),
        keepComeBack: (_c, cb) => (given("comeBack", () => (mem.comeBack = cb)), "armed"),
        restoreIdle: (_c, i) => (given("idle", () => (mem.idle = i)), true),
        oweGoal: () => {},
        kept: (c, failed) => k.keep(c, mem, failed),
      });
      assert.deepEqual(midway, [before, before], `${fails} fails: the record stands as it was read until the start's own keep`);
      assert.deepEqual(a.metas.get("k1")?.owedWakes, before, `${fails} fails: nothing written over it`);
      assert.deepEqual(createOwedKeeper({ archive: () => a }).kept()[0].owed[fails], kept[fails], `${fails} fails: the next start reads it back`);
      // From the start's own keep on, the chat is kept as it changes.
      k.keep("k1", { untold: [], comeBack: null, idle: null });
      assert.deepEqual(Object.keys(a.metas.get("k1")?.owedWakes), [fails], `${fails} fails: what was given back and went is kept no more`);
    }
  });

  // (fails before: yes — FabeleHelper's of 11-10: `keepUntold` capped what it kept with no owner to count the rest for,
  // so more than 20 kept for one chat threw, the chat's come-back was never armed, and its keep let them go for good)
  test("more than 20 kept for one chat, its sub-agents' among them: the newest 20 given back, the rest counted for its agent; its come-back armed still", () => {
    const s = "owed-many";
    const items = Array.from({ length: 25 }, (_, i) => ({ id: `bg_m${i}`, command: "npm test", code: 0, agent: i < 15 ? null : "subagent:sa_9" }));
    /** @type {any[]} */
    const calls = [];
    const owed = restoreOwed([{ chainId: s, owed: { untold: items, comeBack: { id: "w9", at: 9, setAt: 0, note: "later" }, idle: null }, goal: false, queued: false }], {
      keepUntold,
      keepComeBack: (c, cb) => (calls.push(["comeBack", c, cb.id]), "armed"),
      restoreIdle: () => true,
      oweGoal: () => {},
      kept: () => {},
      log: (level, msg) => void calls.push(["log", level, msg]),
    });
    assert.deepEqual(calls, [["comeBack", s, "w9"]], "nothing failed, and the come-back is armed");
    assert.deepEqual(owed, [s]);
    const told = peekShellExits(main(s));
    assert.deepEqual(told.map((x) => x.id), items.slice(5).map((x) => x.id), "the newest 20");
    assert.match(told[0].text, /^\[Filament: 5 earlier background items — a command's end, a watch's lines, a come-back — went untold: more than 20 waited for you/);
    takeShellExits(main(s));
  });

  // (fails before: yes — FabeleHelper's of 11-10: `tellLater`'s wake: false kept no mark on the item, so a person's Stop
  // of a command, or a restart's word of what it ended, woke the chat at the next restart and counted as due for the waker)
  test("what was told never to wake its chat stays quiet: not due, kept quiet over a restart, and owed no wake as Filament starts; a goal's round its drive's time ran out on wakes nothing", () => {
    const s1 = "owed-quiet";
    tellLater(main(s1), { id: "bg_q", command: "npm run dev", code: null, text: "[Filament: you stopped it]" }, { wake: false });
    assert.equal(wakeDue(s1), false, "a Stop's word is not due");
    assert.equal(untoldOf(s1)[0]?.quiet, true);
    const a = fakeArchive();
    a.metas.set(s1, {});
    createOwedKeeper({ archive: () => a }).keep(s1, { untold: untoldOf(s1), comeBack: null, idle: null });
    const back = createOwedKeeper({ archive: () => a }).kept().find((r) => r.chainId === s1);
    assert.equal(back?.owed.untold[0]?.quiet, true, "kept quiet");
    takeShellExits(main(s1));
    /** @type {any[]} */
    const calls = [];
    const none = { untold: [], comeBack: null, idle: null };
    const owed = restoreOwed(
      [
        /** @type {any} */ (back),
        { chainId: "timeup", owed: none, goal: true, queued: false },
        { chainId: "goal", owed: none, goal: true, queued: false },
      ],
      { keepUntold: (c) => void calls.push(["untold", c]), keepComeBack: () => null, restoreIdle: () => true, oweGoal: (c) => c !== "timeup", kept: () => {} },
    );
    assert.deepEqual(owed, ["goal"], "given back, but owed no wake");
    assert.deepEqual(calls, [["untold", s1]]);
    assert.equal(wakeDue(s1), false);
    takeShellExits(main(s1));
  });

  // (fails before: yes — the review of 11-11: Filament's check-in told before the stop, which had not reached the agent,
  // came back as it was told: its words said the command still ran with no end, and its wake's line said so too, beside
  // the restart's own word that Filament no longer follows it)
  test("a check-in told before the stop that had not reached the agent comes back as what the restart made of it: owed a wake still, in an end's words", () => {
    const s = "owed-idle-told";
    const told = { id: "idle-77", command: "", code: null, agent: null, kind: /** @type {const} */ ("idle"), text: idleText([{ id: "bg_5", command: "npm run dev", startedAt: 0 }], { idleMin: 5, nextMin: 10, now: 5 * MIN }) };
    const owed = restoreOwed([{ chainId: s, owed: { untold: [told], comeBack: null, idle: null }, goal: false, queued: false }], { keepUntold, keepComeBack: () => null, restoreIdle: () => true, oweGoal: () => {}, kept: () => {} });
    assert.deepEqual(owed, [s], "the agent hears what became of what it left running");
    assert.deepEqual(
      peekShellExits(main(s)).map((x) => [x.id, x.kind, x.text]),
      [["idle-77", "exit", "[Filament: Filament restarted before its check-in on what you left running in the background reached you: it ran under the Filament that stopped, which ended it — Filament no longer follows it, and its results will not come. Say in a line where your work stands, then start again what you still need, or go on with your work.]"]],
    );
    assert.equal(wakeLineFor(wakeKindOf(s)), WAKE_LINE, "its wake says an end came, not that a command still runs");
    takeShellExits(main(s));
  });

  // (fails before: yes — 11-10: a chat left for days was woken at the first start to spend a turn on what came; FabeleHelper's:
  // measured from the person, not from Filament's own turns, at one place for every wake the start holds)
  test("the sweep's cutoff: a chat the person last wrote in over a day ago is left for their next message, unless a come-back it set came due within the day", () => {
    const NOW = T0 + 10 * 24 * 60 * MIN;
    const old = NOW - OWED_MAX_AGE_MS - 2 * 60 * MIN;
    assert.equal(staleWords({ personAt: NOW - 60 * MIN, now: NOW }), null);
    assert.equal(staleWords({ personAt: old, now: NOW }), "the person last wrote in it, and any come-back it set came due, over 24 h ago (26 h)");
    assert.equal(staleWords({ personAt: old, comeBackAt: NOW - 10 * MIN, now: NOW }), null, "a come-back the agent set for now");
    assert.equal(staleWords({ personAt: 0, now: NOW }), null, "nothing says when: woken");
  });

  // (fails before: yes — the review of 11-11: a chat that kept no moment of the person's was measured from its newest
  // turn, Filament's own included, in words that said the person last wrote then)
  test("a chat that kept no moment of the person's is measured from its newest turn that Filament did not start, and says so", () => {
    const NOW = T0 + 10 * 24 * 60 * MIN;
    const old = NOW - OWED_MAX_AGE_MS - 2 * 60 * MIN;
    assert.equal(staleWords({ personAt: 0, turnAt: old, now: NOW }), "its newest turn that Filament did not start by itself began, and any come-back it set came due, over 24 h ago (26 h)");
    assert.equal(staleWords({ personAt: 0, turnAt: NOW - 60 * MIN, now: NOW }), null);
    assert.equal(staleWords({ personAt: 0, turnAt: old, comeBackAt: NOW - 10 * MIN, now: NOW }), null, "a come-back the agent set for now");
    assert.equal(staleWords({ personAt: old, turnAt: NOW - 60 * MIN, now: NOW }), "the person last wrote in it, and any come-back it set came due, over 24 h ago (26 h)", "the person's own moment is the measure where one is kept");
  });

  // (fails before: yes — a chat with no turn of the person's, a routine's run or an ask's, gave the cutoff nothing to
  // measure from, and was woken however long ago it ran)
  test("a chat with no turn of the person's is measured from when it began, and says so; a turn of theirs, or their moment, is the measure where there is one", () => {
    const NOW = T0 + 10 * 24 * 60 * MIN;
    const old = NOW - OWED_MAX_AGE_MS - 2 * 60 * MIN;
    assert.equal(staleWords({ personAt: 0, turnAt: 0, beganAt: old, now: NOW }), "the chat began, with no turn of the person's in it, and any come-back it set came due, over 24 h ago (26 h)");
    assert.equal(staleWords({ personAt: 0, turnAt: 0, beganAt: NOW - 60 * MIN, now: NOW }), null, "begun within the day");
    assert.equal(staleWords({ personAt: 0, turnAt: 0, beganAt: old, comeBackAt: NOW - 10 * MIN, now: NOW }), null, "a come-back the agent set for now");
    assert.equal(staleWords({ personAt: 0, turnAt: NOW - 60 * MIN, beganAt: old, now: NOW }), null, "a turn of the person's since");
    assert.equal(staleWords({ personAt: NOW - 60 * MIN, beganAt: old, now: NOW }), null, "the person wrote since");
    assert.equal(staleWords({ personAt: 0, turnAt: old, beganAt: old - 60 * MIN, now: NOW }), "its newest turn that Filament did not start by itself began, and any come-back it set came due, over 24 h ago (26 h)");
  });
});

describe("the start's sweep", () => {
  test("wakes each chat once, in order, a few seconds apart; one the person stopped or whose account is out of quota is skipped and said — asked at its turn, so a wall an earlier wake ran into holds the rest", async () => {
    assert.equal(OWED_STAGGER_MS, 3000);
    /** @type {any[]} */
    const seen = [];
    let walled = false;
    const out = await wakeOwedAtStart({
      chats: ["a", "b", "a", "c", "d", "e"],
      skip: (c) => (c === "b" ? "the person stopped its newest turn" : walled && c !== "e" ? "its account is out of quota (spent)" : c === "e" ? (() => { throw new Error("unreadable"); })() : null),
      wake: (c) => {
        seen.push(["wake", c]);
        if (c === "a") walled = true;
      },
      sleep: async (ms) => void seen.push(["sleep", ms]),
      log: (level, msg) => void seen.push(["log", msg]),
    });
    assert.deepEqual(
      out.map((x) => [x.chainId, x.woke]),
      [
        ["a", true],
        ["b", false],
        ["c", false],
        ["d", false],
        ["e", false],
      ],
    );
    assert.deepEqual(seen.filter((x) => x[0] !== "log"), [["wake", "a"], ["sleep", 3000], ["sleep", 3000], ["sleep", 3000], ["sleep", 3000]], "one at once, then each a stagger later");
    assert.deepEqual(
      seen.filter((x) => x[0] === "log").map((x) => x[1]),
      [
        "sessions: b was owed a wake as Filament started, and is not woken: the person stopped its newest turn. Its next turn carries what came",
        "sessions: c was owed a wake as Filament started, and is not woken: its account is out of quota (spent). Its next turn carries what came",
        "sessions: d was owed a wake as Filament started, and is not woken: its account is out of quota (spent). Its next turn carries what came",
        "sessions: e was owed a wake as Filament started, and is not woken: what it stands on could not be read (unreadable). Its next turn carries what came",
      ],
    );
  });

  // (fails before: yes — the review of 11-11: a chat whose wake found nothing owed any more — a queue whose kept kinds
  // were dropped, a letter in a chat with no turn yet — was recorded as woken)
  test("a chat the wake finds nothing owed in is recorded as not woken, and why", async () => {
    /** @type {string[]} */
    const said = [];
    const out = await wakeOwedAtStart({ chats: ["a", "b"], skip: () => null, wake: (c) => c === "a", sleep: async () => {}, log: (_level, msg) => void said.push(msg) });
    assert.deepEqual(out, [
      { chainId: "a", woke: true },
      { chainId: "b", woke: false, why: "nothing that wakes it waits for it any more" },
    ]);
    assert.deepEqual(said, ["sessions: b was owed a wake as Filament started, and nothing that wakes it waits for it any more: no turn sent"]);
  });

  // (fails before: yes — the review of 11-11: a wake that threw was logged "could not be sent" and recorded as woken)
  test("a chat whose wake could not be sent is recorded as not woken, and why; the rest go on", async () => {
    /** @type {string[]} */
    const said = [];
    const out = await wakeOwedAtStart({
      chats: ["a", "b"],
      skip: () => null,
      wake: (c) => {
        if (c === "a") throw new Error("no waker");
      },
      sleep: async () => {},
      log: (level, msg) => void said.push(`${level}: ${msg}`),
    });
    assert.deepEqual(out, [
      { chainId: "a", woke: false, why: "its wake could not be sent (no waker)" },
      { chainId: "b", woke: true },
    ]);
    assert.deepEqual(said, ["warn: sessions: a was owed a wake as Filament started, and its wake could not be sent (no waker). Its next turn carries what came"]);
  });

  test("Filament stopping ends it", async () => {
    let stopping = false;
    /** @type {string[]} */
    const woke = [];
    const out = await wakeOwedAtStart({ chats: ["a", "b"], skip: () => null, wake: (c) => void woke.push(c), sleep: async () => void (stopping = true), stop: () => stopping });
    assert.deepEqual(woke, ["a"]);
    assert.equal(out.length, 1);
  });
});
