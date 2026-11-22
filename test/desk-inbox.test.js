// @ts-check
// The desk's inbox (src/ui/harness/desk-inbox.js, the remote desk of 11-22): another machine's waiting asks are read
// through the app's bridge for each of its chats in Now's Needs you, read field by field as that machine's words, drawn
// as cards under its row, and answered there — never the window sent to that machine. A chat's asks are read again as
// its machine says one opened or settled; an answered card goes at once; a refused one says that machine's words.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { AGAIN_MS, ANSWERED_MS, READS_MOST, RETRY_MS, STILL_LISTED, createDeskInbox, readAsks } from "../src/ui/harness/desk-inbox.js";
import { createNow } from "../src/ui/harness/now-list.js";
import { deskGroups, readDesk } from "../src/ui/harness/lib/desk.js";

const mk = /** @type {any} */ (fakeH);

/** Every node under `el` carrying class `c`. @param {any} el @param {string} c @returns {any[]} */
const every = (el, c) => {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    for (const k of n?.kids || []) {
      if (!k || typeof k !== "object") continue;
      if (String(k.attrs?.class || "").split(/\s+/).includes(c)) out.push(k);
      walk(k);
    }
  };
  walk(el);
  return out;
};

/** A machine as the desk names it. @param {Record<string, any>} [o] */
const machine = (o = {}) => ({ id: "m-studio", name: "Studio", color: "teal", icon: "server", status: "online", refused: false, ...o });
/** Another machine's row in Needs you. @param {Record<string, any>} [o] */
const row = (o = {}) => {
  const m = o.machine || machine();
  const chain = o.chain || "s1";
  const thread = o.thread || null;
  return /** @type {any} */ ({ key: `m:${m.id}/${thread ? `thread:${thread}` : `chat:${chain}`}`, chain: `m:${m.id}/chat:${chain}`, thread: null, group: "needs", title: "A chat", project: "shop", fact: "asks", tone: "asks", icon: "messageSquare", tile: "needs", model: "", at: 1, under: [], team: "", step: "", machine: m, there: { chain, thread } });
};

const PERMIT = { id: "run1", kind: "permission", from: "chat", runId: "run1", tool: "bash", question: "May I run this command?", command: "npm test", options: [{ id: "allow", label: "Allow" }, { id: "deny", label: "Deny" }], words: true, at: 5 };
const WORKER = { id: "sa_1.2", kind: "question", from: "sa_1", runId: "r9", tool: "ask_lead", question: "Which branch?", options: [{ id: "1", label: "main" }, { id: "2", label: "dev" }], words: true, at: 6 };

/**
 * The app's bridge, scripted: each chat's asks by `machine/chat`, an answer's reply, every call kept, and its events
 * told by `tell`.
 * @param {{ asks?: Record<string, any[]>, answer?: (p: any) => any }} [o]
 */
const bridgeOf = (o = {}) => {
  /** @type {any[]} */
  const calls = [];
  /** @type {((f: any) => void)[]} */
  const hear = [];
  const asks = { ...(o.asks || {}) };
  return {
    calls,
    asks,
    tell: (/** @type {any} */ f) => { for (const fn of hear) fn(f); },
    bridge: {
      call: async (/** @type {any} */ p) => {
        calls.push(p);
        if (p.op === "asks") {
          const list = asks[`${p.machine}/${p.chat}`];
          return list ? { ok: true, status: 200, json: { chainId: p.chat, asks: list } } : { ok: false, status: 404, words: "no such chat" };
        }
        if (p.op === "answer") return o.answer ? o.answer(p) : { ok: true, status: 200, json: { ok: true } };
        return { ok: false, status: 400, words: "no" };
      },
      onEvent: (/** @type {(f: any) => void} */ fn) => {
        hear.push(fn);
        return () => hear.splice(hear.indexOf(fn), 1);
      },
    },
  };
};

/** Until the bridge's promises have settled. */
const settled = () => new Promise((r) => setTimeout(r, 0));

/** An inbox over a scripted bridge, its timers kept. @param {Parameters<typeof bridgeOf>[0]} [o] */
const inboxOver = (o) => {
  const b = bridgeOf(o);
  /** @type {{ fn: () => void, ms: number }[]} */
  const timers = [];
  let changes = 0;
  const inbox = createDeskInbox({ bridge: b.bridge, onChange: () => void changes++, later: (fn, ms) => void timers.push({ fn, ms }) });
  return { ...b, inbox, timers, changes: () => changes };
};

/** A row's cards, drawn. @param {any} inbox @param {any} r @param {any[]} [opened] @param {string} [away] */
const cards = (inbox, r, opened = [], away = "") => inbox.cardsOf(r, mk, { away, onOpen: () => void opened.push(r.key) });

describe("an ask, read as another machine's words (readAsks)", () => {
  // (fails before: yes — s1g: there was no inbox)
  test("ids by the pattern the desk sends, words clipped, kinds known; an answer is any words but control characters — a coding agent's are its labels; none for what is no list", () => {
    const got = readAsks({
      asks: [
        PERMIT,
        { ...WORKER, question: "a\u0007b\nc".padEnd(5000, "z"), options: [{ id: "Use Postgres", label: "Use Postgres" }, { id: "1", label: 7 }, ...Array.from({ length: 10 }, (_, i) => ({ id: `o${i}`, label: `o${i}` }))] },
        { id: "../../remote/devices", kind: "question" },
        { id: "run1", kind: "question", question: "the same id again" },
        { id: "c.q1", kind: "evil", from: "<b>", question: 5, words: "yes", at: "soon" },
        null,
        "ask",
      ],
    });
    assert.deepEqual(got.map((a) => a.id), ["run1", "sa_1.2", "c.q1"]);
    assert.deepEqual(got[0], { id: "run1", kind: "permission", from: "chat", question: "May I run this command?", command: "npm test", options: [{ id: "allow", label: "Allow" }, { id: "deny", label: "Deny" }], words: false, at: 5, apart: "" }, "a permission is answered by its press alone here");
    assert.equal(got[1].question.length, 2000);
    assert.ok(got[1].question.startsWith("a b\nc"), "control characters gone, its lines kept");
    assert.deepEqual(got[1].options.slice(0, 2), [{ id: "Use Postgres", label: "Use Postgres" }, { id: "1", label: "1" }], "a label is an answer's id; one with no words says its id");
    assert.equal(got[1].options.length, 12);
    assert.deepEqual(got[2], { id: "c.q1", kind: "other", from: "chat", question: "", command: "", options: [], words: false, at: 0, apart: "Answer it in its chat" }, "a kind this page does not know is answered in its chat");
    for (const j of [null, {}, { asks: "x" }, "asks", []]) assert.deepEqual(readAsks(j), []);
    assert.equal(readAsks({ asks: Array.from({ length: 50 }, (_, i) => ({ id: `a${i}` })) }).length, 20);
  });

  // (fails before: yes — the review of s1g: a card showed a part of what Allow answered, or some of its answers)
  test("what a card would show a part of is answered in its chat alone: a plan, a link, a secret, a command too long, an answer the desk could not send", () => {
    const [plan, proposal, link, secret, long, odd, fits] = readAsks({
      asks: [
        { id: "sa_1.3", kind: "plan", from: "sa_1", question: "1. Read the parser…", options: [{ id: "go", label: "Go: let it start" }], words: true },
        { id: "r3.p1", kind: "proposal", from: "coding-agent", question: "Refactor the parser", options: [{ id: "exit-plan-accept", label: "Accept" }], words: false },
        { id: "r3.l1", kind: "link", from: "coding-agent", question: "Sign in", options: [{ id: "opened", label: "Opened it" }], words: false },
        { id: "r3.s1", kind: "question", from: "coding-agent", question: "Your API key?", options: [], words: true, form: { questions: [{ id: "k", words: "secret" }] } },
        { ...PERMIT, id: "run9", command: `rm -rf build && ${"x".repeat(20001)}` },
        { ...WORKER, id: "sa_1.4", options: [{ id: "1", label: "main" }, { id: "line\nbreak", label: "dev" }] },
        { ...PERMIT, id: "run8", command: "x".repeat(20000) },
      ],
    });
    for (const [a, why] of /** @type {[any, string][]} */ ([[plan, "Its plan is read whole in its chat"], [proposal, "Its plan is read whole in its chat"], [link, "Answer it in its chat"], [secret, "It asks for a secret: answer it in its chat"], [long, "Its command is too long to show here"], [odd, "Answer it in its chat"]])) {
      assert.deepEqual([a.apart, a.options, a.words], [why, [], false], a.id);
    }
    assert.equal(long.command.length, 20000);
    assert.deepEqual([fits.apart, fits.options.length, fits.command.length], ["", 2, 20000], "a command its machine shows whole is answered here");
    // (fails before: yes — the hunt on s1g: a command its machine cut came within the cap, its mark and all, and Allow showed)
    const [cut, short, said] = readAsks({
      asks: [
        { ...PERMIT, id: "run6", command: `${"x".repeat(19978)}…[truncated 32 chars]` },
        { ...PERMIT, id: "run5", command: "cat big.log…[truncated 9 chars]" },
        { ...PERMIT, id: "run4", command: "echo '…[truncated 9 chars]' && ls" },
      ],
    });
    for (const a of [cut, short]) assert.deepEqual([a.apart, a.options], ["Its command is too long to show here", []], a.id);
    assert.deepEqual([said.apart, said.options.length], ["", 2], "the mark within its words, not at its end: its own words");
    // An edit's permission — its diff its chat's alone —, a tool's with no command, a coding agent's that changes files;
    // and a question of more answers than a card holds.
    const [edit, judgedEdit, left, many] = readAsks({
      asks: [
        { ...PERMIT, id: "run7", tool: "write", question: "May it write src/x.js?", command: undefined },
        { ...PERMIT, id: "r4.j1", from: "coding-agent", command: "apply_patch", form: { kind: "permission", judged: { command: "apply_patch", changes: [{ path: "src/x.js" }] } } },
        { ...PERMIT, id: "r4.j2", from: "coding-agent", command: "apply_patch", form: { judged: { changes: [], changesLeft: 3 } } },
        { ...WORKER, id: "sa_1.5", options: Array.from({ length: 13 }, (_, i) => ({ id: `o${i}`, label: `o${i}` })) },
      ],
    });
    for (const a of [edit, judgedEdit, left]) assert.deepEqual([a.apart, a.options], ["Its changes are shown in its chat", []], a.id);
    assert.deepEqual([many.apart, many.options, many.words], ["Answer it in its chat", [], false], "never twelve of its thirteen as if they were all");
  });
});

describe("the inbox (createDeskInbox)", () => {
  test("each other machine's chat in Needs you has its asks read; a thread's row takes its sub-agent's, the chat's row the rest; a chat no row names is let go", async () => {
    const { inbox, calls, asks } = inboxOver({ asks: { "m-studio/s1": [PERMIT, WORKER] } });
    const chatRow = row();
    const threadRow = row({ thread: "sa_1" });
    inbox.sync([chatRow, threadRow], () => []);
    await settled();
    assert.deepEqual(calls.map((c) => [c.op, c.machine, c.chat]), [["asks", "m-studio", "s1"]], "its chat read once, whatever rows of its threads stand beside its own");
    assert.deepEqual(cards(inbox, chatRow).map((c) => c.attrs["data-key"]), ["ask:m-studio/s1/run1"]);
    assert.deepEqual(cards(inbox, threadRow).map((c) => c.attrs["data-key"]), ["ask:m-studio/s1/sa_1.2"]);
    // Its thread's row gone, the chat's row takes its asks too. Asked again while it reads, it reads once more after.
    inbox.sync([chatRow], () => []);
    inbox.heard({ machine: "m-studio", type: "ask", chain: "s1", ask: "run1", open: true });
    await settled();
    await settled();
    assert.equal(calls.length, 3, "one read at a time: the one asked meanwhile goes after it");
    assert.deepEqual(cards(inbox, chatRow).map((c) => c.attrs["data-key"]), ["ask:m-studio/s1/run1", "ask:m-studio/s1/sa_1.2"]);
    asks["m-studio/s1"] = [];
    inbox.sync([], () => []);
    assert.deepEqual(cards(inbox, chatRow), [], "a chat no row names is let go");
    assert.deepEqual(cards(inbox, row({ chain: "s9" })), [], "one never read draws none");
  });

  test("a card says its question and its command; a press of one of its answers sends it there as that machine's chat's answer, the card held meanwhile, gone once taken, its chat read again", async () => {
    /** @type {(v: any) => void} */
    let release = () => {};
    const { inbox, calls, timers } = inboxOver({ asks: { "m-studio/s1": [PERMIT] }, answer: () => new Promise((r) => (release = r)) });
    const r = row();
    inbox.sync([r], () => ["ask-events"]);
    await settled();
    const [card] = cards(inbox, r);
    assert.match(textOf(card), /May I run this command\?\|npm test\|Allow\|Deny\|Open/);
    assert.equal(every(card, "desk-ask-words").length, 0, "a permission takes no words here");
    const [allow] = buttonsOf(card);
    assert.match(String(allow.attrs.class), /is-go/);
    allow.dispatch("click");
    const held = cards(inbox, r)[0];
    assert.match(String(held.attrs.class), /is-busy/);
    assert.equal(held.attrs["aria-busy"], "true");
    assert.ok(buttonsOf(held).slice(0, 2).every((b) => b.attrs["aria-disabled"] === "true" && !("disabled" in b.attrs)), "its answers held while it goes, keeping the focus they have");
    buttonsOf(held)[0].dispatch("click");
    assert.deepEqual(calls.filter((c) => c.op === "answer"), [{ op: "answer", machine: "m-studio", chat: "s1", ask: "run1", choice: "allow" }], "sent once, by its answer's id");
    release({ ok: true, status: 200, json: {} });
    await settled();
    assert.deepEqual(cards(inbox, r), [], "answered: gone at once, though its machine has not said it yet");
    assert.deepEqual(timers.map((t) => t.ms), [AGAIN_MS]);
    timers[0].fn();
    await settled();
    assert.equal(calls.filter((c) => c.op === "asks").length, 2, "its chat read again a moment later");
  });

  // (fails before: yes — the review of s1g: an answered card took the focus with it)
  test("an answered card's focus goes to its row; one that held none moves none", async () => {
    let focus = /** @type {string | null} */ ("ask:m-studio/s1/run1");
    /** @type {string[]} */
    const focused = [];
    const b = bridgeOf({ asks: { "m-studio/s1": [PERMIT, { ...PERMIT, id: "run2" }] } });
    const inbox = createDeskInbox({ bridge: b.bridge, onChange: () => {}, later: () => {}, focusIn: () => focus, focusRow: (r) => void focused.push(r.key) });
    const r = row();
    inbox.sync([r], () => []);
    await settled();
    buttonsOf(cards(inbox, r)[0])[0].dispatch("click");
    await settled();
    assert.deepEqual(focused, ["m:m-studio/chat:s1"]);
    focus = null;
    buttonsOf(cards(inbox, r)[0])[0].dispatch("click");
    await settled();
    assert.deepEqual(focused, ["m:m-studio/chat:s1"]);
  });

  test("a refused answer keeps its card and says that machine's words, its chat read again — one settled there meanwhile goes; one that did not go says to open the chat", async () => {
    let reply = /** @type {any} */ ({ ok: false, status: 403, press: true, words: "Studio refused it: a view device's press counts for nothing. Pair this machine again as Full with Add a machine, and it works from here." });
    const { inbox, timers, asks } = inboxOver({ asks: { "m-studio/s1": [PERMIT] }, answer: () => reply });
    const r = row();
    inbox.sync([r], () => []);
    await settled();
    buttonsOf(cards(inbox, r)[0])[1].dispatch("click");
    await settled();
    const [card] = cards(inbox, r);
    assert.equal(textOf(every(card, "desk-ask-said")[0]), reply.words);
    assert.equal(every(card, "desk-ask-said")[0].attrs.role, "status");
    reply = null;
    buttonsOf(card)[0].dispatch("click");
    await settled();
    assert.equal(textOf(every(cards(inbox, r)[0], "desk-ask-said")[0]), "Studio did not take the answer: open the chat to answer it there.");
    // It was answered there meanwhile: its machine lists it no more, and its card and its words go.
    asks["m-studio/s1"] = [];
    assert.deepEqual(timers.map((t) => t.ms), [AGAIN_MS, AGAIN_MS]);
    timers[1].fn();
    await settled();
    assert.deepEqual(cards(inbox, r), []);
  });

  // (fails before: yes — the hunt on s1g: a chat let go kept its cards' answers, words and drafts for the page's life)
  test("a chat that leaves Needs you takes what its cards kept with it: its refusal's words, an answer half typed", async () => {
    const { inbox } = inboxOver({ asks: { "m-studio/s1": [{ ...WORKER, from: "chat" }] }, answer: () => ({ ok: false, status: 409, words: "Studio says it was answered already." }) });
    const r = row();
    inbox.sync([r], () => []);
    await settled();
    const [card] = cards(inbox, r);
    buttonsOf(card)[0].dispatch("click");
    every(card, "desk-ask-words")[0].dispatch("input", { target: { value: "use the dev branch" } });
    await settled();
    const [kept] = cards(inbox, r);
    assert.equal(textOf(every(kept, "desk-ask-said")[0]), "Studio says it was answered already.");
    assert.equal(every(kept, "desk-ask-words")[0].attrs.value, "use the dev branch");
    inbox.sync([], () => []);
    // Back in Needs you, its ask still listed: a card as new.
    inbox.sync([r], () => []);
    await settled();
    const [fresh] = cards(inbox, r);
    assert.deepEqual(every(fresh, "desk-ask-said"), []);
    assert.equal(every(fresh, "desk-ask-words")[0].attrs.value, "");
  });

  // (fails before: yes — the hunt on s1g: past two minutes an answered ask came back as a fresh card, Allow and all)
  test("an answered ask its machine still lists long after: its card shows again, answered in its chat alone", async () => {
    let t = 1_000_000;
    const b = bridgeOf({ asks: { "m-studio/s1": [PERMIT] } });
    const inbox = createDeskInbox({ bridge: b.bridge, onChange: () => {}, later: () => {}, now: () => t });
    const r = row();
    inbox.sync([r], () => []);
    await settled();
    buttonsOf(cards(inbox, r)[0])[0].dispatch("click");
    await settled();
    assert.deepEqual(cards(inbox, r), [], "answered: hidden while its machine settles it");
    t += ANSWERED_MS - 1;
    assert.deepEqual(cards(inbox, r), []);
    t += 2;
    const [card] = cards(inbox, r);
    assert.match(textOf(card), new RegExp(STILL_LISTED));
    assert.deepEqual(buttonsOf(card).map((x) => textOf(x)), ["Open"], "no Allow again: its answer was taken");
  });

  // (fails before: yes — the review of s1g: a first read refused, by the desk's cap or a dropped link, was never read again)
  test("a machine's reads go three at a time, the rest after; a first read that failed goes again a few times, and a chat never read is read at the desk's next word", async () => {
    /** @type {((v: any) => void)[]} */
    const open = [];
    let fail = true;
    const b = bridgeOf();
    const call = b.bridge.call;
    b.bridge.call = (/** @type {any} */ p) => (p.op === "asks" ? new Promise((r) => open.push(() => r(fail ? { ok: false, status: 429, words: "Studio has 8 calls from here under way" } : { ok: true, status: 200, json: { asks: [PERMIT] } }))) : call(p));
    /** @type {{ fn: () => void, ms: number }[]} */
    const timers = [];
    let changes = 0;
    const inbox = createDeskInbox({ bridge: b.bridge, onChange: () => void changes++, later: (fn, ms) => void timers.push({ fn, ms }) });
    const rows = ["s1", "s2", "s3", "s4", "s5"].map((chain) => row({ chain }));
    inbox.sync(rows, () => ["ask-events"]);
    await settled();
    assert.equal(open.length, READS_MOST, "three under way, two waiting");
    for (const go of open.splice(0)) go(undefined);
    await settled();
    await settled();
    assert.equal(open.length, 2, "the two that waited go as the first come back");
    for (const go of open.splice(0)) go(undefined);
    await settled();
    assert.deepEqual(timers.map((t) => t.ms), Array(5).fill(RETRY_MS), "each failed first read goes again");
    assert.equal(changes, 0, "nothing read, nothing drawn again");
    fail = false;
    for (const t of timers.splice(0, 1)) t.fn();
    await settled();
    for (const go of open.splice(0)) go(undefined);
    await settled();
    assert.equal(cards(inbox, rows[0]).length, 1);
    assert.equal(changes, 1, "its first answer drawn");
    // The rest never read: the desk's next word reads them, though their machine says ask-events.
    inbox.sync(rows, () => ["ask-events"]);
    await settled();
    assert.equal(open.length, READS_MOST);
  });

  // (fails before: yes — the review of s1g: every read drew Now again)
  test("a read that finds what was read draws nothing again", async () => {
    const { inbox, changes } = inboxOver({ asks: { "m-studio/s1": [PERMIT] } });
    const r = row();
    inbox.sync([r], () => []);
    await settled();
    assert.equal(changes(), 1);
    inbox.sync([r], () => []);
    await settled();
    assert.equal(changes(), 1);
  });

  test("words answer a question: Enter sends what was typed, kept through a draw; Open opens its chat there; a machine away holds its answers", async () => {
    const { inbox, calls } = inboxOver({ asks: { "m-studio/s1": [{ ...WORKER, from: "chat", id: "run2" }, { id: "r3.q1", kind: "question", from: "coding-agent", question: "Fill in the form", options: [], words: false }] } });
    const r = row();
    inbox.sync([r], () => []);
    await settled();
    /** @type {any[]} */
    const opened = [];
    const [q, form] = cards(inbox, r, opened);
    const box = every(q, "desk-ask-words")[0];
    assert.equal(box.attrs.placeholder, "Or answer in words, Enter sends");
    box.dispatch("input", { target: { value: "release/2.0" } });
    assert.equal(every(cards(inbox, r)[0], "desk-ask-words")[0].attrs.value, "release/2.0", "its draft drawn again");
    box.dispatch("keydown", { key: "Enter", isComposing: true, target: { value: "release/2.0" } });
    box.dispatch("keydown", { key: "Enter", target: { value: "  " } });
    assert.equal(calls.filter((c) => c.op === "answer").length, 0, "nothing while composing, nothing for no words");
    box.dispatch("keydown", { key: "Enter", target: { value: " release/2.0 " } });
    await settled();
    assert.deepEqual(calls.filter((c) => c.op === "answer"), [{ op: "answer", machine: "m-studio", chat: "s1", ask: "run2", words: "release/2.0" }]);
    // A form of several questions: its words and Open alone.
    assert.match(textOf(form), /Fill in the form\|Answer it in its chat\|Open/);
    const open = buttonsOf(form).at(-1);
    open.dispatch("click");
    assert.deepEqual(opened, [r.key]);
    const away = row({ machine: machine({ status: "offline" }) });
    const [still] = cards(inbox, away, [], "Studio is offline: its chats as they last stood");
    assert.ok(buttonsOf(still).slice(0, -1).every((b) => "disabled" in b.attrs && b.attrs.title === "Studio is offline: its chats as they last stood"), "its answers held, saying why");
    assert.ok(!("disabled" in buttonsOf(still).at(-1).attrs), "Open still opens it");
  });

  test("read again as its machine says: an ask or a turn of that chat, every chat of a machine whose stream joined again; a machine that says no ask-events at each look, one that does not", async () => {
    const { inbox, calls, tell } = inboxOver({ asks: { "m-studio/s1": [PERMIT], "m-studio/s2": [], "m-lab/l1": [] } });
    const lab = machine({ id: "m-lab", name: "Lab" });
    const rows = [row(), row({ chain: "s2" }), row({ machine: lab, chain: "l1" })];
    const flags = (/** @type {string} */ id) => (id === "m-studio" ? ["remote-key", "ask-events"] : []);
    inbox.sync(rows, flags);
    await settled();
    const reads = () => calls.filter((c) => c.op === "asks").map((c) => `${c.machine}/${c.chat}`);
    assert.deepEqual(reads(), ["m-studio/s1", "m-studio/s2", "m-lab/l1"]);
    inbox.sync(rows, flags);
    await settled();
    assert.deepEqual(reads().slice(3), ["m-lab/l1"], "a look reads again only the machine that says no ask-events");
    tell({ machine: "m-studio", type: "ask", chain: "s1", ask: "run1", open: false });
    tell({ machine: "m-studio", type: "writer", chain: "s2", mine: false });
    tell({ machine: "m-other", type: "hello" });
    tell({ machine: "m-studio", type: "ask", chain: "s9", ask: "x", open: true });
    await settled();
    assert.deepEqual(reads().slice(4), ["m-studio/s1"], "its ask's chat alone");
    tell({ machine: "m-studio", type: "turn", chain: "s2", busy: false });
    await settled();
    tell({ machine: "m-studio", type: "hello" });
    await settled();
    assert.deepEqual(reads().slice(5), ["m-studio/s2", "m-studio/s1", "m-studio/s2"]);
    inbox.close();
    tell({ machine: "m-studio", type: "hello" });
    await settled();
    assert.equal(reads().length, 8, "closed, it hears nothing");
  });

  test("a read that fails keeps what was read; no bridge, no cards", async () => {
    const { inbox, asks } = inboxOver({ asks: { "m-studio/s1": [PERMIT] } });
    const r = row();
    inbox.sync([r], () => []);
    await settled();
    delete asks["m-studio/s1"];
    inbox.sync([r], () => []);
    await settled();
    assert.equal(cards(inbox, r).length, 1, "a dropped link takes no card away");
    const none = createDeskInbox({ bridge: null, onChange: () => {} });
    none.sync([r], () => []);
    assert.deepEqual(none.cardsOf(r, mk, { away: "", onOpen: () => {} }), []);
  });
});

describe("Now draws them under their row (now-list.js askCards)", () => {
  test("another machine's row in Needs you and its cards are one, keyed by its row; a row with none is as it was", async () => {
    const d = readDesk({
      here: { id: "m-here", name: "Desk" },
      machines: [{ id: "m-studio", name: "Studio", color: "teal", icon: "server", status: "online", flags: ["ask-events"], rows: { needs: [{ key: "chat:s1", chain: "s1", group: "needs", title: "Deploy", fact: "asks: May I run this command?", tone: "asks", tile: "needs", at: Date.now() - 1000, under: [] }, { key: "chat:s2", chain: "s2", group: "needs", title: "Docs", fact: "stopped", tone: "error", tile: "needs", at: Date.now() - 2000, under: [] }], works: [], done: [] }, recent: [] }],
    });
    const { inbox } = inboxOver({ asks: { "m-studio/s1": [PERMIT], "m-studio/s2": [] } });
    const more = deskGroups(d);
    inbox.sync(more.needs, () => ["ask-events"]);
    await settled();
    /** @type {any[]} */
    const openedThere = [];
    const now = createNow({
      h: mk, drawIn: fakeDrawIn, call: /** @type {any} */ (async () => ({ events: [] })),
      chats: () => null, unread: () => new Set(), holders: () => new Map(), onOpen: () => {}, onSeen: () => {},
      more: () => more, onOpenMore: (r) => void openedThere.push(r.there.chain),
      askCards: (r, h, w) => inbox.cardsOf(r, h, w), asksKey: () => inbox.key(),
    });
    await now.update(/** @type {any} */ ([]));
    const crews = every(now.el, "now-asks");
    assert.equal(crews.length, 1);
    assert.equal(crews[0].attrs["data-key"], "crew:m:m-studio/chat:s1");
    assert.deepEqual(crews[0].kids.map((/** @type {any} */ k) => String(k.attrs.class).split(" ")[0]), ["now-row", "desk-ask"]);
    assert.deepEqual(every(now.el, "now-row").map((r) => r.attrs["data-key"]), ["m:m-studio/chat:s1", "m:m-studio/chat:s2"]);
    buttonsOf(crews[0]).at(-1).dispatch("click");
    assert.deepEqual(openedThere, ["s1"], "Open opens it there, as a press on its row does");
  });
});
