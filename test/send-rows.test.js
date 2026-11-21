// @ts-check
// The ⌄ menu beside Send while a turn runs (the owner's of 11-09, option B): the same three rows on every agent that
// takes a message mid-turn — Send at its next step, Interrupt and send where the agent can be interrupted and Stop and
// send everywhere else, Send when it's done —, and a turn that takes none its two; More ways… opens in place with what
// is left (Stop and send on Claude; Veto this round and Weigh aside first on Filament's loop). Stop and compact left the
// menu for the Context popover, which shows it whenever a turn runs. A note Filament's loop never read before its turn
// ended goes as the next message, as a coding agent's does. And the row a message went by — by the send key or a click —
// is said on the run's steer event and on the turn a queued or stopped-and-sent message starts. The hint and the box's
// own words name the same rows; the queue panel's send on a row says its own, a reload and a held message keep theirs,
// and a note sent again says it is one, with no press (the owner's follow-up of 11-09).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stubDocument } from "./helpers/dom-stub.js";
import { createComposer } from "../src/ui/harness/composer/composer.js";
import { prefs } from "../src/ui/harness/prefs.js";
import { contextWidget } from "../src/ui/harness/widgets/context.js";
import { steerWords } from "../src/ui/harness/lib/labels.js";
import { postTurn, viaHeader } from "../src/ui/harness/lib/api.js";
import { queuedVia } from "../src/ui/harness/composer/queue.js";
import * as queueRules from "../src/ui/harness/composer/queue.js";
import { keptQueues } from "../src/ui/harness/composer/kept-queue.js";
import { createEventBus } from "../src/services/events.js";
import { createRunLog } from "../src/services/runs.js";
import { runRoutes } from "../src/http/admin/runs.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { lift, APP_SRC } from "./helpers/app-lift.js";

const g = /** @type {any} */ (globalThis);
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

/** The rows' words, as the owner chose them on 11-09. */
const NEXT = "It reads this once its current step is done; nothing is cut short.";
const INTERRUPT = "Cuts short what it's doing and gives it this now, in the same turn.";
const STOP_SEND = "Stops the turn, then sends this as a new turn.";
const WHEN = "Waits for the turn to end, then goes as your next message.";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
beforeEach(() => {
  doc = stubDocument();
  const kept = new Map();
  g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => kept.set(k, v), removeItem: (/** @type {string} */ k) => kept.delete(k) };
});
afterEach(() => {
  delete g.localStorage;
  doc.restore();
});

/** The menu open now, its rows as a person reads them. */
const rows = () => /** @type {any[]} */ (doc.document.body.querySelector(".zc-menu")?.querySelectorAll(".zc-menu-item") || []);
/** @param {any} row */
const labelOf = (row) => (row.querySelector(".zc-menu-label-line") || row.querySelector(".zc-menu-text")).textContent;
/** @param {any} row */
const descOf = (row) => row.querySelector(".zc-menu-desc")?.textContent || "";
/** @param {any} row */
const kbdOf = (row) => row.querySelector(".zc-menu-kbd")?.textContent || "";
/** The row named so, in the menu open now. @param {string} label */
const rowNamed = (label) => rows().find((r) => labelOf(r) === label);

/**
 * The composer on the stub document, with what reached its send and its stop recorded. It is handed a Stop and compact
 * too, as the page handed it before the owner's of 11-09: the menu offers it no longer.
 */
function box() {
  const host = /** @type {any} */ (doc.document.createElement("div"));
  /** @type {{ text: string, modifier: string, o: any }[]} */
  const sent = [];
  const did = { stops: 0, compacts: 0 };
  const c = createComposer(host, {
    onSend: (text, _files, modifier, o) => { sent.push({ text, modifier, o: o || {} }); return true; },
    onStop: () => void did.stops++,
    getChat: () => ({ chainId: "c1", turns: [] }),
    .../** @type {any} */ ({ onStopAndCompact: () => void did.compacts++ }),
  });
  const ta = host.querySelector(".composer-input");
  const mod = host.querySelector(".send-mod");
  /** The ⌄ menu opened, its rows. */
  const open = () => {
    mod.onclick({ stopPropagation() {} });
    return rows();
  };
  /** The menu closed again, as a second press on its button closes it. */
  const shut = () => {
    if (rows().length) mod.onclick({ stopPropagation() {} });
  };
  /** Type the words, then press Enter (Ctrl+Enter with `ctrl`). @param {string} text @param {boolean} [ctrl] */
  const press = (text, ctrl = false) => {
    ta.value = text;
    ta.dispatch("keydown", { key: "Enter", shiftKey: false, ctrlKey: ctrl, metaKey: false, isComposing: false, keyCode: 13, preventDefault() {} });
  };
  /** The queue panel's button named so, on its first row. @param {string} label */
  const rowButton = (label) => (host.querySelectorAll(".queue-row")[0]?.querySelectorAll("button") || []).find((/** @type {any} */ x) => x.getAttribute("aria-label") === label);
  return { c, host, ta, sent, did, open, shut, press, rowButton, hint: () => host.querySelector(".composer-hint").textContent, sendBtn: host.querySelector(".send") };
}

/** Claude Code's run, as its start says it: notes queue at the agent, and a note can interrupt it. */
const CLAUDE = { kind: "coding-agent", steer: "queued", interrupts: true };

// (fails before: yes — four names for one row (Steer, At its next step, Queue at the agent, Steer current run), Send now
// and Add to queue under names of their own, Interrupt and send claiming what Claude's adapter does, and Stop and compact
// at the foot of every face)
describe("the ⌄ menu while a turn runs, by agent (the owner's of 11-09)", () => {
  test("Claude: Send at its next step, Interrupt and send, Send when it's done — and More ways… opens Stop and send in place", () => {
    const b = box();
    b.c.setLive(true, CLAUDE);
    const shown = b.open();
    assert.deepEqual(shown.map(labelOf), ["Send at its next step", "Interrupt and send", "Send when it's done", "More ways…"]);
    assert.deepEqual(shown.slice(0, 3).map(descOf), [NEXT, INTERRUPT, WHEN]);
    assert.deepEqual(shown.map(kbdOf), ["Enter", "", "", ""], "the send key on the row it does");
    // More ways… opens in place: the menu stands where it stood, its rows and Stop and send under them.
    rowNamed("More ways…").dispatch("click");
    assert.deepEqual(rows().map(labelOf), ["Send at its next step", "Interrupt and send", "Send when it's done", "Stop and send"]);
    assert.equal(descOf(rowNamed("Stop and send")), STOP_SEND);
    b.ta.value = "use b instead";
    rowNamed("Stop and send").dispatch("click");
    assert.deepEqual([b.did.stops, b.ta.value, rows().length], [1, "", 0], "the turn stops, the box is the queue's, the menu closed");
    // Interrupt and send goes into the running turn, cutting it short.
    b.ta.value = "stop that";
    b.open();
    rowNamed("Interrupt and send").dispatch("click");
    assert.deepEqual(b.sent.map((s) => [s.text, s.modifier]), [["stop that", "interrupt"]]);
  });

  test("Codex and Cursor CLI: Send at its next step, Stop and send, Send when it's done — no More ways…, nothing being left", () => {
    for (const steer of ["live", "next"]) {
      const b = box();
      b.c.setLive(true, { kind: "coding-agent", steer });
      const shown = b.open();
      assert.deepEqual(shown.map(labelOf), ["Send at its next step", "Stop and send", "Send when it's done"], steer);
      assert.deepEqual(shown.map(descOf), [NEXT, STOP_SEND, WHEN], steer);
      assert.deepEqual(shown.map(kbdOf), ["Enter", "", ""], steer);
      b.shut();
    }
  });

  test("Filament's loop: the three rows, and More ways… opens Veto this round (its key kept) and Weigh aside first; Ctrl+Enter still vetoes", () => {
    const b = box();
    b.c.setLive(true, { kind: "agent-turn" });
    const shown = b.open();
    assert.deepEqual(shown.map(labelOf), ["Send at its next step", "Stop and send", "Send when it's done", "More ways…"]);
    assert.deepEqual(shown.slice(0, 3).map(descOf), [NEXT, STOP_SEND, WHEN]);
    rowNamed("More ways…").dispatch("click");
    const more = rows();
    assert.deepEqual(more.map(labelOf), ["Send at its next step", "Stop and send", "Send when it's done", "Veto this round", "Weigh aside first"]);
    assert.equal(kbdOf(rowNamed("Veto this round")), "Ctrl+Enter");
    b.ta.value = "weigh this";
    rowNamed("Weigh aside first").dispatch("click");
    b.press("not that file", true);
    assert.deepEqual(b.sent.map((s) => [s.text, s.modifier]), [["weigh this", "fork"], ["not that file", "veto"]]);
  });

  test("an agent that takes no message mid-turn: Send when it's done on the send key, and Stop and send", () => {
    const b = box();
    b.c.setLive(true, { kind: "coding-agent", steer: null });
    const shown = b.open();
    assert.deepEqual(shown.map(labelOf), ["Send when it's done", "Stop and send"]);
    assert.deepEqual(shown.map(descOf), [`${WHEN} This agent takes no message mid-turn.`, STOP_SEND]);
    assert.deepEqual(shown.map(kbdOf), ["Enter", ""]);
    assert.equal(b.sendBtn.title, "Send when it's done");
  });

  test("a run not known yet: Send at its next step says it is held until the agent is up, or the turn's run starts", () => {
    const b = box();
    b.c.setModels([{ id: "claude-code", codingAgent: true }]);
    b.c.setModel("claude-code");
    b.c.setLive(true, null);
    assert.equal(descOf(b.open()[0]), "Held until the agent is up, then it reads this once its current step is done — or after this turn, where it takes no message mid-turn. Nothing is cut short.");
    assert.equal(b.sendBtn.title, "Send at its next step — held until the agent is up");
    b.shut();
    const loop = box();
    loop.c.setLive(true, null);
    assert.equal(descOf(loop.open()[0]), "Held until the turn's run starts, then it reads this once its current step is done. Nothing is cut short.");
  });

  test("Wait for the turn's end: the send key is Send when it's done's, on every face", () => {
    prefs.set("whileWorking", "wait");
    for (const run of [CLAUDE, { kind: "coding-agent", steer: "live" }, { kind: "agent-turn" }]) {
      const b = box();
      b.c.setLive(true, run);
      const shown = b.open();
      assert.deepEqual(shown.slice(0, 3).map(kbdOf), ["", "", "Enter"], JSON.stringify(run));
      assert.equal(b.sendBtn.title, "Send when it's done");
      b.shut();
    }
  });

  test("Stop and compact is in no face of the menu", () => {
    for (const run of [CLAUDE, { kind: "coding-agent", steer: "live" }, { kind: "coding-agent", steer: null }, { kind: "agent-turn" }]) {
      const b = box();
      b.c.setLive(true, run);
      b.open();
      if (rowNamed("More ways…")) rowNamed("More ways…").dispatch("click");
      assert.ok(!rows().some((r) => labelOf(r) === "Stop and compact"), JSON.stringify(run));
      b.shut();
    }
  });
});

describe("the words under and in the box name the same rows (the owner's of 11-09)", () => {
  /** The rows' names before the owner's of 11-09, and the verbs that stood for them. */
  const OLD = /\bSteer\b|\bsteers\b|\bqueues\b|Queue at|Add to queue|Send now|At its next step/;

  // (fails before: yes — the hint said "Enter steers", "Enter queues it at the agent, for its next step" or "Enter
  // queues", and the box "Steer the run" or "Steer the agent": names the ⌄ menu no longer has)
  test("the hint and the placeholder say Send at its next step or Send when it's done, on every face", () => {
    prefs.set("whileWorking", "steer");
    const AGENT = ["Enter sends at its next step · the Stop button stops", "The agent is working — what you send now is read at its next step"];
    /** @type {[any, string[]][]} */
    const faces = [
      [{ kind: "agent-turn" }, ["Enter sends at its next step · Ctrl+Enter vetoes · the Stop button stops", "A turn is running — what you send now is read at its next step"]],
      [CLAUDE, AGENT],
      [{ kind: "coding-agent", steer: "live" }, AGENT],
      [{ kind: "coding-agent", steer: "next" }, AGENT],
      [{ kind: "coding-agent", steer: null }, ["Enter sends when it's done · the Stop button stops", "A coding agent is working — what you send now goes out when it ends"]],
    ];
    for (const [run, words] of faces) {
      const b = box();
      b.c.setLive(true, run);
      assert.deepEqual([b.hint(), b.ta.placeholder], words, JSON.stringify(run));
      assert.ok(![b.hint(), b.ta.placeholder, b.sendBtn.title].some((w) => OLD.test(w)), JSON.stringify(run));
    }
    const held = box();
    held.c.setModels([{ id: "claude-code", codingAgent: true }]);
    held.c.setModel("claude-code");
    held.c.setLive(true, null);
    assert.equal(held.hint(), "Enter sends at its next step, held until the agent is up · the Stop button stops");
    prefs.set("whileWorking", "wait");
    const waits = box();
    waits.c.setLive(true, { kind: "agent-turn" });
    assert.equal(waits.hint(), "Enter sends when it's done · Ctrl+Enter vetoes · the Stop button stops");
    assert.ok(!OLD.test(waits.hint()));
  });

  // (fails before: yes — the queue panel's send on a row was named Steer, and told the turn nothing of how it went)
  test("the queue panel's send on a row: Send at its next step while a turn runs, its own row by a click; between turns, a send of its own", async () => {
    const b = box();
    b.c.setLive(true, { kind: "agent-turn" });
    b.ta.value = "after this";
    b.open();
    rowNamed("Send when it's done").dispatch("click");
    assert.ok(!b.rowButton("Steer"));
    b.rowButton("Send at its next step").dispatch("click");
    await settle();
    assert.deepEqual(b.sent.map((s) => [s.text, s.o.via]), [["after this", { row: "queue-next-step", by: "click" }]]);
    // A stopped turn's queue waits, paused: its row's send starts a turn, no mid-turn send.
    b.ta.value = "then this";
    b.open();
    rowNamed("Send when it's done").dispatch("click");
    b.c.setLive(false, null, "stopped");
    await settle();
    assert.ok(!b.rowButton("Send at its next step"));
    b.rowButton("Send").dispatch("click");
    await settle();
    assert.deepEqual(b.sent.slice(1).map((s) => [s.text, s.o.via ?? null]), [["then this", null]]);
  });
});

describe("the row a message went by (via)", () => {
  // (fails before: yes — nothing said which row of the menu, or which key, sent a message)
  test("the send key, a row, a queued and a stopped-and-sent message each carry the row and how it was pressed", async () => {
    const b = box();
    b.c.setLive(true, CLAUDE);
    b.press("look at f");
    b.ta.value = "and g";
    b.open();
    rowNamed("Interrupt and send").dispatch("click");
    assert.deepEqual(b.sent.map((s) => s.o.via), [{ row: "next-step", by: "key" }, { row: "interrupt", by: "click" }]);
    b.ta.value = "after this";
    b.open();
    rowNamed("Send when it's done").dispatch("click");
    b.ta.value = "instead";
    b.open();
    rowNamed("More ways…").dispatch("click");
    rowNamed("Stop and send").dispatch("click");
    // The stop ends the turn: Stop and send's message goes first, the queued one at the end of the turn it starts.
    b.c.setLive(false, null, "stopped");
    await settle();
    b.c.setLive(true, CLAUDE);
    b.c.setLive(false, null, "done");
    await settle();
    assert.deepEqual(b.sent.slice(2).map((s) => [s.text, s.o.queued, s.o.via]), [
      ["instead", true, { row: "stop-and-send", by: "click" }],
      ["after this", true, { row: "when-done", by: "click" }],
    ]);
    // The loop's veto by its key and its weighing aside by a row; Wait for the turn's end queues on the send key.
    const loop = box();
    loop.c.setLive(true, { kind: "agent-turn" });
    loop.press("no", true);
    loop.ta.value = "weigh";
    loop.open();
    rowNamed("More ways…").dispatch("click");
    rowNamed("Weigh aside first").dispatch("click");
    prefs.set("whileWorking", "wait");
    loop.press("later");
    loop.c.setLive(false, null, "done");
    await settle();
    assert.deepEqual(loop.sent.map((s) => s.o.via), [{ row: "veto", by: "key" }, { row: "aside", by: "click" }, { row: "when-done", by: "key" }]);
  });

  test("the steer carries it to the run, whose steer event records it; a via of another shape is left out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-send-rows-"));
    const runs = createRunLog({ events: createEventBus(), dataDir: dir, config: () => ({ observability: { runEvents: { persist: false } } }), ops: { record: () => {} } });
    try {
      runs.startRun({ id: "a1", kind: "agent-turn" });
      assert.equal(runs.steer("a1", { kind: "note", text: "look at f", from: "harness", via: { row: "next-step", by: "key" } }).ok, true);
      assert.equal(runs.steer("a1", { kind: "note", text: "odd", from: "harness", via: /** @type {any} */ ({ row: "Next Step!", by: "mouse" }) }).ok, true);
      // A note sent again, which nobody pressed for.
      assert.equal(runs.steer("a1", { kind: "note", text: "again", from: "harness", via: { row: "unread-note", by: "auto" } }).ok, true);
      // Through the route, as the page posts it.
      const [, , steer] = /** @type {any} */ (runRoutes({ runs, sseClients: new Set() }).find((row) => row[0] === "POST" && row[1] === "/runs/:id/steer"));
      /** @type {any[]} */
      const answered = [];
      const res = { writableEnded: false, destroyed: false, writeHead: (/** @type {number} */ s) => answered.push(s), end: () => {} };
      await steer({ params: { id: "a1" }, req: { headers: {} }, res, json: async () => ({ kind: "veto", text: "not that", from: "harness", via: { row: "veto", by: "click" } }) });
      assert.deepEqual(answered, [200]);
      const said = runs.events("a1")?.events.filter((e) => e.type === "steer") || [];
      assert.deepEqual(said.map((e) => /** @type {any} */ (e).via ?? null), [{ row: "next-step", by: "key" }, null, { row: "unread-note", by: "auto" }, { row: "veto", by: "click" }]);
    } finally {
      runs.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the page's steer posts it, and the turn a queued message starts names it in its request's head", async () => {
    /** @type {any[]} */
    const bodies = [];
    // The page's steerPost, as app.js has it: an arrow over two lines, to the blank line after it.
    const at = APP_SRC.indexOf("const steerPost = ");
    const steerPost = new Function("api", "overrulesSent", `${APP_SRC.slice(at, APP_SRC.indexOf("\n\n", at))}\nreturn steerPost;`)(
      async (/** @type {string} */ _p, /** @type {any} */ o) => void bodies.push(o.body),
      (/** @type {any} */ x) => x,
    );
    await steerPost("r1", { kind: "note", text: "look at f", via: { row: "next-step", by: "key" } });
    assert.deepEqual(bodies[0].via, { row: "next-step", by: "key" });
    const had = g.fetch;
    /** @type {any[]} */
    const heads = [];
    g.fetch = async (/** @type {string} */ _url, /** @type {any} */ init) => {
      heads.push(init.headers);
      return new Response(JSON.stringify({ content: [] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      await postTurn({ chainId: "c1", content: [{ type: "text", text: "after this" }], via: { row: "when-done", by: "click" }, signal: new AbortController().signal, onEvent: () => {} });
      await postTurn({ chainId: "c1", content: [{ type: "text", text: "a new message" }], signal: new AbortController().signal, onEvent: () => {} });
      assert.deepEqual(heads.map((h) => h["x-filament-via"] ?? null), ["row=when-done; by=click", null]);
      // (fails before: yes — a row of another shape, from a kept copy say, went into the head as it was)
      await postTurn({ chainId: "c1", content: [{ type: "text", text: "odd" }], via: { row: "when-done\nx-other: 1", by: "key" }, signal: new AbortController().signal, onEvent: () => {} });
      assert.equal(heads[2]["x-filament-via"], undefined, "no head for anything not of its form");
    } finally {
      g.fetch = had;
    }
    // The head's form, as the turn's record reads it: the unread note's no press too.
    assert.deepEqual(viaHeader({ row: "unread-note", by: "auto" }), { "x-filament-via": "row=unread-note; by=auto" });
    assert.deepEqual([viaHeader(null), viaHeader({ row: "Next Step", by: "key" }), viaHeader({ row: "next-step", by: "mouse" })], [{}, {}, {}]);
  });

  // (fails before: yes — Ctrl+Enter on a coding agent was said to be a veto, which its turn takes as a note at its next step)
  test("the veto key on an agent's turn says the row its message goes by: Send at its next step, by the key", () => {
    for (const run of [CLAUDE, { kind: "coding-agent", steer: "live" }]) {
      const b = box();
      b.c.setLive(true, run);
      b.press("not that", true);
      assert.deepEqual(b.sent.map((s) => s.o.via), [{ row: "next-step", by: "key" }], JSON.stringify(run));
    }
  });

  // (fails before: yes — a reload kept a queued message's words, files and answers, and dropped the row it was sent by)
  test("a queued message keeps its row across a reload, a storage too full for its files too; one of another shape is left out", () => {
    /** A tab's storage that takes up to `room` characters a copy. @param {number} room */
    const tab = (room) => {
      const m = new Map();
      return { getItem: (/** @type {string} */ k) => m.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => { if (v.length > room) throw new Error("full"); m.set(k, v); }, removeItem: (/** @type {string} */ k) => void m.delete(k) };
    };
    const after = { text: "after this", files: [], via: { row: "when-done", by: /** @type {const} */ ("key") } };
    const shot = { text: "look", files: [{ kind: "image", name: "a.png", type: "image/png", data: "A".repeat(400) }], via: { row: "unread-note", by: /** @type {const} */ ("auto") } };
    const whole = keptQueues(tab(1e6));
    whole.keep("c1", [after, shot, /** @type {any} */ ({ text: "odd", files: [], via: { row: "when-done", by: "mouse" } })]);
    assert.deepEqual(whole.take("c1").items, [after, shot, { text: "odd", files: [] }]);
    const tight = keptQueues(tab(300));
    tight.keep("c1", [after, shot]);
    assert.deepEqual(tight.take("c1"), { items: [after, { text: "look", files: [], via: { row: "unread-note", by: "auto" } }], lost: ["a.png"] });
  });

  // (fails before: yes — a message held for a run that never came went as the next message without the row it was sent
  // by, which no run had heard)
  test("a message held for a run that never came goes as the next message with the row it was sent by", () => {
    const chat = { chainId: "c1" };
    /** @type {any[]} */
    const queued = [];
    const { requeueHeld } = lift(["requeueHeld", "queueNext"], {
      chatOf: () => chat,
      state: { currentId: "c1" },
      transcript: { markSteers: () => {} },
      composer: { enqueue: (/** @type {any[]} */ list) => void queued.push(...list) },
      toast: () => {},
      queuedVia,
    });
    const live = { turn: { steers: [{ id: "h1" }, { id: "h2" }] } };
    requeueHeld(chat, live, [{ id: "h1", text: "look at f", via: { row: "next-step", by: "key" } }, { id: "h2", text: "plain" }]);
    assert.deepEqual(queued, [{ text: "look at f", files: [], via: { row: "next-step", by: "key" } }, "plain"]);
    assert.deepEqual(live.turn.steers, [], "off the turn");
  });
});

// (fails before: yes — the owner's of 11-09: a note Filament's loop never read before a stop was only marked unread, while
// a coding agent's went out as the next message)
describe("a note the loop never read goes as the next message", () => {
  /**
   * The page's `agentUnheard`, lifted over a chat shown in this tab: what it queued, said and marked.
   * @param {{ chainId: string | null, you: boolean }} writing
   */
  const page = (writing) => {
    const chat = { chainId: "c1" };
    /** @type {any[]} */
    const queued = [];
    /** @type {string[]} */
    const said = [];
    const { agentUnheard } = lift(["agentUnheard", "queueNext", "unheardNext?", "steerFiles"], {
      writing,
      chatOf: () => chat,
      state: { currentId: "c1" },
      transcript: { markSteers: () => {} },
      composer: { enqueue: (/** @type {any[]} */ list) => void queued.push(...list), enqueueUnheard: (/** @type {any[]} */ list) => void queued.push(...list) },
      toast: (/** @type {string} */ w) => void said.push(w),
    });
    return { chat, queued, said, agentUnheard };
  };
  const steers = () => [
    { id: "s1", kind: "note", text: "first" },
    { id: "s2", kind: "veto", text: "not that" },
    { id: "s3", kind: "compact", text: "" },
    { id: "s4", kind: "note", text: "second", files: ["shot.png"], shots: [{ src: "data:image/png;base64,AAAA" }] },
  ];

  test("its notes go, in order, pictures with them, their bubbles saying so; a veto or a compact left unread does not", async () => {
    const p = page({ chainId: "c1", you: true });
    const live = { runKind: "agent-turn", turn: { steers: steers() } };
    p.agentUnheard(p.chat, live, { type: "steer-unread", ids: ["s1", "s2", "s3", "s4"] });
    await settle();
    // (fails before: yes — the owner's follow-up of 11-09: the turn each started said nothing of how it came to go)
    const via = { row: "unread-note", by: "auto" };
    assert.deepEqual(p.queued, [{ text: "first", files: [], via }, { text: "second", files: [{ kind: "image", name: "shot.png", type: "image/png", data: "AAAA", size: 3 }], via }]);
    assert.deepEqual(live.turn.steers.map((/** @type {any} */ s) => !!s.next), [true, false, false, true]);
    assert.equal(steerWords({ ...live.turn.steers[0], unread: true }).state, "The turn ended before the agent took this — queued as your next message");
    assert.deepEqual(p.said, ["The turn ended before the agent took 2 messages — they go out next, in order"]);
    // Heard again (the log read once more): sent once.
    p.agentUnheard(p.chat, live, { type: "steer-unread", ids: ["s1"] });
    await settle();
    assert.equal(p.queued.length, 2);
  });

  test("the tab that writes the session sends them; one that follows it leaves them to that tab", async () => {
    const p = page({ chainId: "c1", you: false });
    p.agentUnheard(p.chat, { runKind: "agent-turn", turn: { steers: steers() } }, { type: "steer-unread", ids: ["s1"] });
    await settle();
    assert.deepEqual(p.queued, []);
  });

  // (fails before: yes — the plan of 11-11, its w6: every unread note was queued as the person's next message, a
  // watcher's guidance and Filament's own word too, though they typed neither)
  test("a note the person did not type — a watcher's guidance, Filament's own word — never goes out as their next message", async () => {
    const p = page({ chainId: "c1", you: true });
    const live = { runKind: "agent-turn", turn: { steers: [
      { id: "s1", kind: "note", text: "You drifted: the parser, not the lexer.", from: "watcher", title: "Supervisor" },
      { id: "s2", kind: "note", text: "[Filament: the Space synced]", from: "filament" },
      { id: "s3", kind: "note", text: "and the docs" },
    ] } };
    p.agentUnheard(p.chat, live, { type: "steer-unread", ids: ["s1", "s2", "s3"] });
    await settle();
    assert.deepEqual(p.queued.map((/** @type {any} */ q) => q.text), ["and the docs"]);
    assert.deepEqual(live.turn.steers.map((/** @type {any} */ s) => !!s.next), [false, false, true]);
    assert.deepEqual(p.said, ["The turn ended before the agent took your message — it goes out as the next one"]);
    // Its bubble says who sends it on.
    assert.equal(steerWords({ ...live.turn.steers[0], unread: true }).state, "The turn ended before the agent read this — Filament sends it on as a turn of its own");
    // The watcher's alone left unread: nothing is queued, and nothing is said.
    const q = page({ chainId: "c1", you: true });
    q.agentUnheard(q.chat, { runKind: "coding-agent", turn: { steers: [live.turn.steers[0]] } }, { type: "steer-unread", ids: ["s1"] });
    await settle();
    assert.deepEqual([q.queued, q.said], [[], []]);
  });


  // (fails before: yes — the hunt of 11-09: a stop paused the queue, so the note its turn never read waited there for
  // Continue while its toast said it went out as the next one; and one the run said after the turn's end went at once
  // with nothing queued, but waited with something queued)
  test("after a stop it goes as the next message, ahead of what waits for the turn's end and behind Stop and send's, whether the run says so before the turn's end or after", async () => {
    const unread = { row: "unread-note", by: "auto" };
    /** `late`: the run says it after the turn's end. `stopAndSend`: Stop and send stopped the turn. */
    for (const { late, stopAndSend } of [{ late: false, stopAndSend: false }, { late: true, stopAndSend: false }, { late: false, stopAndSend: true }]) {
      prefs.set("whileWorking", "steer");
      const b = box();
      b.c.setLive(true, { kind: "agent-turn" });
      b.ta.value = "after this";
      b.open();
      rowNamed("Send when it's done").dispatch("click");
      if (stopAndSend) {
        b.ta.value = "instead";
        b.open();
        rowNamed("Stop and send").dispatch("click");
      }
      const chat = { chainId: "c1" };
      /** @type {string[]} */
      const said = [];
      const { agentUnheard } = lift(["agentUnheard", "queueNext", "unheardNext?", "steerFiles"], {
        writing: { chainId: "c1", you: true },
        chatOf: () => chat,
        state: { currentId: "c1" },
        transcript: { markSteers: () => {} },
        composer: b.c,
        toast: (/** @type {string} */ w) => void said.push(w),
      });
      const live = { runKind: "agent-turn", turn: { steers: [{ id: "s1", kind: "note", text: "look at f" }] } };
      if (!late) agentUnheard(chat, live, { type: "steer-unread", ids: ["s1"] });
      b.c.setLive(false, null, "stopped");
      if (late) agentUnheard(chat, live, { type: "steer-unread", ids: ["s1"] });
      await settle();
      const how = JSON.stringify({ late, stopAndSend });
      assert.deepEqual(b.sent.map((s) => [s.text, s.o.queued, s.o.via]), [stopAndSend ? ["instead", true, { row: "stop-and-send", by: "click" }] : ["look at f", true, unread]], how);
      assert.deepEqual(said, ["The turn ended before the agent took your message — it goes out as the next one"], how);
      assert.ok(!/paused/.test(b.host.querySelector(".queue-pill").textContent), how);
      // Each turn it starts ends done: the rest go, one per turn's end, what waited for the stopped turn's end last.
      for (let i = 0; i < 2; i++) {
        b.c.setLive(true, { kind: "agent-turn" });
        b.c.setLive(false, null, "done");
        await settle();
      }
      assert.deepEqual(b.sent.map((s) => s.text), [...(stopAndSend ? ["instead"] : []), "look at f", "after this"], how);
    }
  });

  // (fails before: yes — the same in a chat not shown: its own queue paused at the stopped turn's end, the note in it)
  test("in a chat not shown it goes as that chat's next message: as its stopped turn ends, or at once where that turn has ended", async () => {
    for (const late of [false, true]) {
      const chat = { chainId: "c1", live: /** @type {any} */ ({}), queue: queueRules.queueState() };
      queueRules.queueAdd(chat.queue, [{ text: "after this", files: [], via: { row: "when-done", by: "click" } }]);
      /** @type {any[]} */
      const sent = [];
      const scope = {
        ...queueRules,
        writing: { chainId: "c1", you: true },
        chatOf: (/** @type {string} */ id) => (id === "c1" ? chat : { chainId: "c0" }),
        state: { currentId: "c0" },
        transcript: { markSteers: () => {} },
        queueOf: (/** @type {any} */ c) => c.queue,
        drainElsewhere: async (/** @type {any} */ c) => void sent.push(queueRules.awayNext(c.queue)),
        toast: () => assert.fail("a toast over the chat shown"),
      };
      const { agentUnheard, endedElsewhere } = lift(["agentUnheard", "queueNext", "unheardNext?", "steerFiles", "endedElsewhere"], scope);
      const live = { runKind: "agent-turn", turn: { steers: [{ id: "s1", kind: "note", text: "look at f" }] } };
      if (!late) agentUnheard(chat, live, { type: "steer-unread", ids: ["s1"] });
      chat.live = null;
      endedElsewhere(chat, "stopped");
      if (late) agentUnheard(chat, live, { type: "steer-unread", ids: ["s1"] });
      await settle();
      assert.deepEqual(sent, [{ text: "look at f", files: [], via: { row: "unread-note", by: "auto" } }], `late: ${late}`);
      assert.deepEqual([chat.queue.items, chat.queue.paused], [[{ text: "after this", files: [], via: { row: "when-done", by: "click" } }], false], `late: ${late}`);
    }
  });
});

// (fails before: yes — the hunt of 11-09: while a loop turn starts, its run not known yet, the button and the ⌄ menu said
// Send at its next step, held for its run, and Ctrl+Enter vetoed, but the hint said only "the Stop button stops")
describe("the hint while a turn of the loop starts, its run not known yet", () => {
  test("it says what Enter and the veto key do, as the button and the ⌄ menu do; an agent's or an unfollowed turn's own words stay", () => {
    prefs.set("whileWorking", "steer");
    const b = box();
    b.c.setLive(true, null);
    assert.equal(b.sendBtn.title, "Send at its next step");
    assert.equal(b.hint(), "Enter sends at its next step, held until its run starts · Ctrl+Enter vetoes · the Stop button stops");
    b.press("not that", true);
    assert.deepEqual(b.sent.map((s) => [s.text, s.modifier]), [["not that", "veto"]], "the veto key vetoes");
    const unfollowed = box();
    unfollowed.c.setLive(true, { kind: "", unfollowed: true });
    assert.equal(unfollowed.hint(), "Enter sends when it's done · the Stop button stops");
    const agent = box();
    agent.c.setModels([{ id: "claude-code", codingAgent: true }]);
    agent.c.setModel("claude-code");
    agent.c.setLive(true, null);
    assert.equal(agent.hint(), "Enter sends at its next step, held until the agent is up · the Stop button stops");
    prefs.set("whileWorking", "wait");
    const waits = box();
    waits.c.setLive(true, null);
    assert.equal(waits.hint(), "Enter sends when it's done · Ctrl+Enter vetoes · the Stop button stops");
    prefs.set("whileWorking", "steer");
  });
});

describe("Stop and compact in the Context popover", () => {
  /** The popover over a session of the loop's or an agent's, its turn running or not. @param {{ agent?: boolean, streaming?: boolean }} o */
  const popover = (o) => {
    /** @type {string[]} */
    const did = [];
    const view = { settings: { window: { tokens: 200_000, source: "operator", model: "opus" }, flat: { "context.compaction.thresholdPercent": 85, "context.compaction.mode": "auto" } }, facts: null, windows: [] };
    const held = 64_000;
    const facts = o.agent ? { held, context: { held, window: 200_000, source: "agent", usable: null, verdict: null } } : { held, context: { window: 200_000, usable: 170_000, verdict: "fits", source: "operator" } };
    const live = { rec: null, usage: null, facts, liveOut: 0, estimate: 0, streaming: !!o.streaming, agent: !!o.agent };
    const ctx = {
      view: () => view, hasSession: () => true, live: () => live, turns: () => [], write: () => {}, openPane: () => {}, summon: () => did.push("summon"),
      openHow: () => {}, stopAndCompact: () => did.push("stop and compact"), dryRun: () => {}, preview: async () => null, scrollToTurn: () => true, toast: () => {},
      accounts: { session: () => null }, models: () => [],
    };
    const spec = contextWidget(/** @type {any} */ (ctx), { h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn });
    return { body: /** @type {any} */ (spec.panel?.(fakeH, () => did.push("closed"), () => {})), did };
  };

  // (fails before: yes — the popover offered it only past a line a coding agent can't act on mid-turn, and the ⌄ menu
  // held it on every face)
  test("whenever a turn runs — the loop's or an agent's, short of the line — it stands beside Compact now…, in its words; between turns it is not offered", () => {
    for (const agent of [false, true]) {
      const p = popover({ agent, streaming: true });
      const stop = buttonsOf(p.body).find((b) => textOf(b) === "Stop and compact");
      assert.ok(stop, `offered while a turn runs (${agent ? "an agent's" : "the loop's"})`);
      assert.equal(stop.attrs.title, "Stop the turn, then compact this session once it has ended");
      assert.ok(buttonsOf(p.body).some((b) => textOf(b) === "Compact now…"), "Compact now… stays");
      stop.dispatch("click");
      assert.deepEqual(p.did, ["closed", "stop and compact"]);
      assert.ok(!buttonsOf(popover({ agent, streaming: false }).body).some((b) => textOf(b) === "Stop and compact"), "between turns, Compact now… alone");
    }
  });
});
