// @ts-check
// The card for sub-agents that change files (the owner's of 11-14): while Parallelize tasks is off, a launch of one waits
// on a card in the chat for the person's yes. The card names each launch, its model and where it would work; it counts
// down to the server's own answer from the time left the server said (another machine's clock may differ), says why an
// unanswered card keeps the work with the agent — only where no model is known; wherever a launch would work, its clock
// starts it — and answers once: Accept, Always accept in this chat (the chat's own Parallelize tasks on, its gear
// taking it back), or One at a time (Keep it with the agent, for one). An answer from elsewhere
// stands; a refusal because it was answered already is said once, and the chat's cards read again.
// (fails before: yes — there was no card: a writing launch started at once, whatever the switch said)
import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { ALWAYS_LINE, heldActions, heldRound, heldAnsweredWords, heldClockWords, heldGone, heldLaunchRow, heldLaunchSub, heldTitle, clockWords } from "../src/ui/harness/conversation/held-launch.js";
import { CHAT_PARALLEL, chatParallelRow } from "../src/ui/harness/widgets/may-ask.js";
import { h } from "../src/ui/lib/dom.js";
import { placeBoundary } from "../src/ui/harness/conversation/history.js";
import { prettyModel } from "../src/ui/harness/lib/families.js";
import { stubDocument } from "./helpers/dom-stub.js";

const T0 = Date.UTC(2026, 10, 14, 9, 0);
/** @param {Partial<import("../src/ui/harness/conversation/held-launch.js").HoldView>} [o] @returns {import("../src/ui/harness/conversation/held-launch.js").HoldView} */
const view = (o = {}) => ({
  id: "hl_1", chainId: "c1", at: T0, until: T0 + 60_000, left: 60_000, turn: 3, onTimeout: "accept", why: "",
  launches: [
    { n: 1, description: "Fix the parser", kind: "builder", model: "claude-opus-5-5", where: "copy", declines: "" },
    { n: 2, description: "Fix the printer", kind: "builder", model: "claude-opus-5-5", where: "copy", declines: "" },
  ],
  state: "waiting", by: null, answeredAt: null, started: [], failed: [], ...o,
});
const ONE = { launches: [{ n: 1, description: "Fix the parser", kind: "builder", model: "", where: /** @type {const} */ ("folder"), declines: "no model is named for it" }], onTimeout: /** @type {const} */ ("decline"), why: "no model is named for it" };

describe("the card's words", () => {
  test("its head, a launch's line, and the clock", () => {
    assert.equal(heldTitle(view()), "Your agent asks to run two sub-agents in parallel");
    assert.equal(heldTitle(view(ONE)), "Your agent asks to hand this to a sub-agent");
    assert.equal(heldLaunchSub(view().launches[0]), `on ${prettyModel("claude-opus-5-5")} · in its own copy of the folder`);
    assert.equal(heldLaunchSub({ ...view().launches[0], where: "machine", machine: "DESKTOP-1", model: "", agent: "sa_1" }), "no model named · on DESKTOP-1 · started as sa_1");
    assert.deepEqual([clockWords(60_000), clockWords(41_200), clockWords(0)], ["1:00", "0:42", "0:00"]);
    assert.equal(heldClockWords(view(), 42_000), "They start by themselves in 0:42: each works in its own copy, and nothing reaches your folder until it is applied.");
    assert.equal(heldClockWords(view(ONE), 9_000), "With no answer in 0:09, the work stays with your agent: no model is named for it.");
    // One in the person's folder itself starts by itself too: the clock no longer says each works in a copy.
    const inFolder = view({ launches: [view().launches[0], { ...view().launches[1], where: "folder" }] });
    assert.equal(heldClockWords(inFolder, 42_000), "They start by themselves in 0:42, each where its line says.");
    assert.equal(heldClockWords(view({ launches: [{ ...view().launches[0], where: "machine", machine: "DESKTOP-1" }] }), 42_000), "It starts by itself in 0:42, where its line says.");
    assert.equal(heldClockWords(view(), 0), "Starting them…");
    assert.equal(heldClockWords(view({ launches: view().launches.slice(0, 1) }), -5), "Starting it…");
  });

  test("what an answered card says", () => {
    assert.equal(heldAnsweredWords(view({ state: "accepted", by: "person", started: ["sa_1", "sa_2"] })), "Accepted: started both; each report comes to your agent.");
    assert.equal(heldAnsweredWords(view({ state: "accepted", by: "timeout", started: ["sa_1"], failed: ["“Fix the printer” (no room)"] })), "No answer in time, so Filament started 1 of 2; its report comes to your agent. Not started: “Fix the printer” (no room).");
    assert.equal(heldAnsweredWords(view({ state: "declined", by: "person" })), "One at a time: your agent does the work itself, and starts no sub-agent that changes files for the rest of this turn.");
    assert.equal(heldAnsweredWords(view({ ...ONE, state: "declined", by: "timeout" })), "No answer in time, and no model is named for it: the work stayed with your agent.");
    assert.equal(heldAnsweredWords(view({ state: "declined", by: "stop" })), "The turn ended before an answer: nothing started.");
    // Its clock started those with a model, and kept the rest with the agent.
    const some = view({ onTimeout: "some", why: "no model is named for it", launches: [view().launches[0], { ...view().launches[1], model: "", declines: "no model is named for it" }] });
    assert.equal(heldClockWords(some, 30_000), "With no answer in 0:30, those with a model start by themselves, and the rest stay with your agent: no model is named for it.");
    assert.equal(heldClockWords(some, 0), "Starting those with a model…");
    const after = { ...some, state: /** @type {const} */ ("accepted"), by: /** @type {const} */ ("timeout"), started: ["sa_1"], launches: [{ ...some.launches[0], agent: "sa_1" }, { ...some.launches[1], kept: true }] };
    assert.equal(heldAnsweredWords(after), "No answer in time, so Filament started 1 of 2; its report comes to your agent. One stayed with your agent: no model is named for it.");
    assert.equal(heldLaunchSub(after.launches[1]), "no model named · in its own copy of the folder · stayed with your agent");
    // A graph's task with no free slot: accepted, it starts once one frees.
    const slot = view({ state: "accepted", by: "person", started: ["sa_2"], launches: [{ ...view().launches[0], queued: true }, { ...view().launches[1], agent: "sa_2" }] });
    assert.equal(heldAnsweredWords(slot), "Accepted: started 1 of 2; its report comes to your agent. One more starts once a slot is free.");
    assert.equal(heldAnsweredWords(view({ state: "accepted", by: "timeout", started: [], launches: [{ ...view().launches[0], queued: true }, { ...view().launches[1], queued: true }] })), "No answer in time: they start once a slot is free and your agent's turn runs, each report coming to your agent.");
    assert.equal(heldLaunchSub(slot.launches[0]), `on ${prettyModel("claude-opus-5-5")} · in its own copy of the folder · waits to start`);
  });

  // (fails before: yes — the review of this change: a card the feed brought while the read was under way was taken
  // for one the server had forgotten, and stood answered with no presses while its clock ran on)
  test("a read of the chat's cards retires only a waiting card heard before it was asked, and the server no longer has", () => {
    const heard = new Map([
      ["c1\nhl_1", { hold: view({ id: "hl_1" }), heard: 100 }],
      ["c1\nhl_2", { hold: view({ id: "hl_2" }), heard: 300 }],
      ["c1\nhl_3", { hold: view({ id: "hl_3", state: "accepted", by: "person" }), heard: 100 }],
      ["c1\nhl_4", { hold: view({ id: "hl_4" }), heard: 100 }],
      ["c2\nhl_5", { hold: view({ id: "hl_5", chainId: "c2" }), heard: 100 }],
    ]);
    const gone = heldGone(heard, "c1", new Set(["hl_4"]), 200, 500);
    assert.deepEqual(gone.map(([k, w]) => [k, w.hold.state, w.hold.by, w.hold.answeredAt, w.heard]), [["c1\nhl_1", "declined", "stop", 500, 500]]);
    assert.equal(heldAnsweredWords(gone[0][1].hold), "The turn ended before an answer: nothing started.");
  });

  // (fails before: yes — the owner's of 11-16: the cards "stuck at the end of the chat pushing the work above": a card
  // stood ahead of the next turn, out of reach of the turn that asked)
  test("its row is the turn's that asked, once: the feed's and the read's are one", () => {
    const turns = [{ n: 3, boundaries: [], boundariesAfter: [] }, { n: 4, boundaries: [], boundariesAfter: [] }];
    const mark = { ...view(), type: "held", afterTurn: 3 };
    assert.equal(placeBoundary(turns, mark), turns[0]);
    assert.equal(placeBoundary(turns, { ...mark, state: "accepted" }), null);
    assert.deepEqual([turns[0].boundariesAfter.length, turns[1].boundaries.length], [1, 0]);
    // A card whose turn the archive did not number: after the newest turn on record.
    const alone = [{ n: 1, boundaries: [], boundariesAfter: [] }];
    assert.equal(placeBoundary(alone, { ...mark, id: "hl_2", afterTurn: Infinity }), alone[0]);
    assert.equal(alone[0].boundariesAfter.length, 1);
  });
});

// (fails before: yes — an answered card had no round of its own: it stood under its turn)
test("a card's round: the newest whose calls began by the time it was asked; none where no call carries a time", () => {
  const cell = (/** @type {number[]} */ ...ats) => ({ tools: new Map(ats.map((at, i) => [`t${i}`, at ? { at } : {}])) });
  const byRound = new Map([[0, cell(100)], [1, cell(200, 210)], [2, cell(300)], [3, cell()]]);
  assert.deepEqual([heldRound(byRound, 250), heldRound(byRound, 200), heldRound(byRound, 999), heldRound(byRound, 50)], [1, 1, 2, null]);
  assert.equal(heldRound(new Map([[0, cell(0)]]), 500), null, "no time: it stays under the turn");
});

describe("the card", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => {
    Object.assign(heldActions, { view: null, watch: null, answer: null, said: null, refresh: null });
    doc.restore();
  });
  const settle = () => new Promise((r) => setImmediate(r));
  /** @param {any} el @param {string} words */
  const press = (el, words) => el.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === words);
  /** The page's word of each card, and the cards drawn that hear it. */
  const page = () => {
    /** @type {Map<string, { hold: any, heard: number }>} */
    const heard = new Map();
    /** @type {Set<() => void>} */
    const watchers = new Set();
    return {
      heard,
      /** @param {any} hold */
      say: (hold) => {
        heard.set(hold.id, { hold, heard: Date.now() });
        for (const fn of [...watchers]) fn();
      },
      actions: {
        view: (/** @type {string} */ _c, /** @type {string} */ id) => heard.get(id) || null,
        watch: (/** @type {() => void} */ fn) => (watchers.add(fn), () => watchers.delete(fn)),
      },
    };
  };

  test("its launches and clock; Accept answers once, and what the server says then stands", async () => {
    const p = page();
    /** @type {any[]} */
    const did = [];
    Object.assign(heldActions, {
      ...p.actions,
      answer: async (/** @type {string} */ c, /** @type {string} */ id, /** @type {string} */ said) => {
        did.push([c, id, said]);
        const hold = view({ state: "accepted", by: "person", started: ["sa_1", "sa_2"], launches: view().launches.map((l, i) => ({ ...l, agent: `sa_${i + 1}` })) });
        p.say(hold);
        return { ok: true, hold };
      },
      said: (/** @type {string} */ w) => void did.push(["said", w]),
    });
    const row = /** @type {any} */ (heldLaunchRow({ ...view(), type: "held", afterTurn: 3 }, "c1"));
    const text = row.textContent;
    for (const words of ["Your agent asks to run two sub-agents in parallel", "Fix the parser", `on ${prettyModel("claude-opus-5-5")} · in its own copy of the folder`, "They start by themselves in 1:00"])
      assert.ok(text.includes(words), `${words} in ${text}`);
    assert.ok(press(row, "One at a time"), "two: One at a time");
    press(row, "Accept").dispatch("click");
    await settle();
    assert.deepEqual(did, [["c1", "hl_1", "accept"]]);
    assert.ok(row.textContent.includes("Accepted: started both; each report comes to your agent."), row.textContent);
    assert.ok(row.textContent.includes("Fix the parser (sa_1) · Fix the printer (sa_2) — Accepted"), row.textContent);
    assert.equal(row.querySelectorAll("button").length, 0, "answered: no press left");
    assert.ok(row.classList.contains("is-answered"));
  });

  // (fails before: yes — the owner's of 11-16: "there should be third button, Always accept for this chat which would
  // be just like Auto Approval without asking for the card")
  test("Always accept in this chat answers always, and the answered card says where it is turned off", async () => {
    const p = page();
    /** @type {any[]} */
    const did = [];
    Object.assign(heldActions, {
      ...p.actions,
      answer: async (/** @type {string} */ c, /** @type {string} */ id, /** @type {string} */ said) => {
        did.push([c, id, said]);
        const hold = view({ state: "accepted", by: "person", always: true, started: ["sa_1", "sa_2"] });
        p.say(hold);
        return { ok: true, hold };
      },
      said: () => {},
    });
    const row = /** @type {any} */ (heldLaunchRow({ ...view(), type: "held", afterTurn: 3 }, "c1"));
    assert.deepEqual(row.querySelectorAll("button").map((/** @type {any} */ b) => b.textContent), ["Accept", "Always accept in this chat", "One at a time"]);
    press(row, "Always accept in this chat").dispatch("click");
    await settle();
    assert.deepEqual(did, [["c1", "hl_1", "always"]]);
    assert.equal(heldAnsweredWords(view({ state: "accepted", by: "person", always: true, started: ["sa_1", "sa_2"] })), `Always accepted in this chat: started both; each report comes to your agent. ${ALWAYS_LINE}`);
    assert.ok(row.textContent.includes(ALWAYS_LINE), row.textContent);
    assert.equal(row.querySelectorAll("button").length, 0, "answered: no press left");
  });

  test("the gear's row while the chat's own switch is on, and its way back", () => {
    let off = 0;
    const el = /** @type {any} */ (chatParallelRow(h, { off: () => void off++ }));
    assert.ok(el.textContent.includes(CHAT_PARALLEL.label) && el.textContent.includes(CHAT_PARALLEL.sub), el.textContent);
    press(el, CHAT_PARALLEL.back).dispatch("click");
    assert.equal(off, 1);
  });

  test("one launch: Keep it with the agent, and why an unanswered card keeps it; a card answered elsewhere says so once", async () => {
    const p = page();
    /** @type {any[]} */
    const did = [];
    let refusal = /** @type {any} */ (Object.assign(new Error("HTTP 409"), { status: 409, body: { error: "the card was answered already (accepted)" } }));
    Object.assign(heldActions, {
      ...p.actions,
      answer: async (/** @type {string} */ c, /** @type {string} */ id, /** @type {string} */ said) => {
        did.push([c, id, said]);
        throw refusal;
      },
      said: (/** @type {string} */ w) => void did.push(["said", w]),
      refresh: async (/** @type {string} */ c) => void did.push(["refresh", c]),
    });
    const row = /** @type {any} */ (heldLaunchRow({ ...view({ ...ONE, id: "hl_9" }), type: "held", afterTurn: 3 }, "c1"));
    assert.ok(row.textContent.includes("With no answer in 1:00, the work stays with your agent: no model is named for it."), row.textContent);
    assert.ok(row.textContent.includes("in your folder itself"));
    press(row, "Keep it with the agent").dispatch("click");
    await settle();
    // (fails before: yes — the review of fc944b32: a card the server no longer had stood waiting on the page)
    assert.deepEqual(did, [["c1", "hl_9", "decline"], ["said", "the card was answered already (accepted)"], ["refresh", "c1"]], "refused: the chat's cards read again");
    refusal = Object.assign(new Error("Filament is not reachable"), { status: 0 });
    press(row, "Keep it with the agent").dispatch("click");
    await settle();
    assert.ok(row.textContent.includes("Not answered: Filament is not reachable"));
    // Its own clock answered on the server: the feed's word stands, and a stale read never takes it back.
    p.say(view({ ...ONE, id: "hl_9", state: "declined", by: "timeout" }));
    assert.ok(row.textContent.includes("No answer in time, and no model is named for it: the work stayed with your agent."), row.textContent);
  });

  test("the clock counts from the time left the server said, by the page's own clock, moving only its line", async () => {
    mock.timers.enable({ apis: ["setInterval", "Date"], now: T0 + 999_000 });
    try {
      const p = page();
      /** @type {string[]} */
      const asked = [];
      Object.assign(heldActions, { ...p.actions, answer: async () => ({}), said: () => {}, refresh: async (/** @type {string} */ c) => void asked.push(c) });
      // The server said 30 s were left; the page's clock is far from the server's.
      p.say(view({ left: 30_000 }));
      const row = /** @type {any} */ (heldLaunchRow({ ...view(), type: "held", afterTurn: 3 }, "c1"));
      doc.document.body.append(row);
      const accept = press(row, "Accept");
      assert.ok(row.textContent.includes("in 0:30"), row.textContent);
      mock.timers.tick(12_000);
      assert.ok(row.textContent.includes("in 0:18"), row.textContent);
      assert.equal(press(row, "Accept"), accept, "the presses stay as they were");
      mock.timers.tick(20_000);
      assert.ok(row.textContent.includes("Starting them…"), row.textContent);
      // (fails before: yes — the review of fc944b32: no word of its answer came — the feed missed it, or a restart forgot
      // the card — and it said "Starting them…" for good) Past its deadline by 5 s, the cards are read again, every 5 s.
      assert.equal(asked.length, 0);
      mock.timers.tick(5_000);
      assert.deepEqual(asked, ["c1"]);
      mock.timers.tick(4_000);
      assert.deepEqual(asked, ["c1"], "not before 5 s more");
      mock.timers.tick(1_000);
      assert.deepEqual(asked, ["c1", "c1"]);
      p.say(view({ state: "accepted", by: "timeout", started: ["sa_1", "sa_2"] }));
      assert.ok(row.textContent.includes("No answer in time, so Filament started both"), row.textContent);
      row.remove();
    } finally {
      mock.timers.reset();
    }
  });
});
