// @ts-check
// HarnessV4_Tasks E15 step 5 (E12 step 3): a coding agent's own agents on the page. Each is read out of its turn's run
// (lib/guest-thread.js): who it is, how it stands, and its work as the rounds a thread draws. Its row in the Sub Agents
// tab, tagged as its coding agent's own, and the words of it (lib/side.js); the tab listing and opening it; its thread drawn on a stub
// document — read-only: no box, no Apply, no Stop, no Send (subagent-viewer.js `guestConversation`); Open on its card in
// the chat; the Team tab counting it at work. The rows themselves are the server's (agent-guests.test.js).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { guestId, guestOf, guestOwner, guestThread, guestWhy } from "../src/ui/harness/lib/guest-thread.js";
import { guestRow, needsYou, rowIcon, sideBadge, sideGroups, whoTag } from "../src/ui/harness/lib/side.js";
import { teamBadge } from "../src/ui/harness/lib/team.js";
import { alignEvents, formatWorkedFor } from "../src/ui/harness/lib/labels.js";
import { applyWords } from "../src/ui/harness/lib/stream.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { chipActions } from "../src/ui/harness/conversation/tools/layout.js";
import { guestConversation } from "../src/ui/harness/subagent-viewer.js";
import { createSideView } from "../src/ui/harness/views/side.js";
import { createTeamView } from "../src/ui/harness/views/team.js";
import { h } from "../src/ui/lib/dom.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { fakeH, fakeDrawIn, textOf } from "./helpers/fake-dom.js";
import { agentRow, guestRowOf, menuRow, menuRows, NOW, sideIO, sideSeams } from "./helpers/side-view.js";
import { teamIO } from "./helpers/team-view.js";

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** @param {any} n @param {string} cls */
const byClass = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls));
/** @param {any} n @param {string} cls @returns {any} */
const one = (n, cls) => byClass(n, cls)[0];

/** The run's events of one agent `S`, as the coding agent's turn publishes them. */
const S = "toolu_1";
/** @param {string} type @param {number} ts @param {Record<string, any>} [more] */
const ev = (type, ts, more = {}) => ({ ts, type, round: 3, parent: S, ...more });
const STARTED = ev("subagent-start", 1000, { description: "Map the parser", agent: "Explore", prompt: "Find where tokens are read" });

describe("a coding agent's own agent, read out of its turn's run", () => {
  // (fails before: yes — nothing named such a thread: only an agent Filament holds had one)
  test("its thread's id is its turn's run and its card there; an agent of Filament's own has no such id", () => {
    assert.equal(guestId("req_9", "toolu_1"), "req_9~toolu_1");
    assert.deepEqual(guestOf("req_9~sa:task_1"), { run: "req_9", stub: "sa:task_1" });
    assert.deepEqual([guestOf("sa_1a2b3c4d"), guestOf(""), guestOf("~x"), guestOf("x~")], [null, null, null, null]);
  });

  // (fails before: yes)
  test("who it is and how it stands, as the run tells it: its start, its calls counted, its end", () => {
    const t = guestThread(S);
    assert.equal(t.facts().known, false);
    t.run({ id: "req_9", kind: "coding-agent", status: "running", endedAt: null, meta: { agent: "Claude Code" } });
    assert.deepEqual(t.take(STARTED), []);
    t.take(ev("subagent-tool-start", 1100, { id: "c1", name: "Grep", args: "token" }));
    t.take(ev("subagent-tool-start", 1200, { id: "c2", name: "Read", args: "lex.js" }));
    assert.deepEqual(t.facts(), { known: true, of: "Claude Code", description: "Map the parser", agent: "Explore", model: "", prompt: "Find where tokens are read", status: "running", startedAt: 1000, endedAt: null, ms: null, toolCalls: 2, tokens: null, report: "", error: "" });
    // (fails before: yes — what it holds was read from the page's copy of Claude's task list, which a turn begun in
    // the harness never hears while it runs)
    assert.deepEqual([t.take(ev("subagent-held", 1250, { tokens: 13_400 })), t.facts().tokens], [[], 13_400], "what it holds is the run's to say: nothing to draw, a fact of its head");
    t.take(ev("subagent-end", 5200, { status: "done", ok: true, ms: 4200, toolCalls: 2, model: "haiku", report: "Tokens are read in lex.js." }));
    assert.deepEqual([t.facts().status, t.facts().endedAt, t.facts().ms, t.facts().model, t.facts().report], ["done", 5200, 4200, "haiku", "Tokens are read in lex.js."]);
  });

  // (fails before: yes — its words reached the page at its end alone, and nothing drew its work as a thread's rounds)
  test("its work as a thread's rounds: a message's thinking and words as they stream, whole once a call follows; the calls under them; another message begins the next", () => {
    const t = guestThread(S);
    t.take(STARTED);
    /** @type {any[]} */
    const got = [];
    /** @type {any} */
    let reply = null;
    /** @param {any} e */
    const feed = (e) => {
      for (const it of t.take(e)) {
        if ("words" in it) reply = applyWords(reply, it.words);
        else got.push(it.event);
      }
    };
    feed(ev("subagent-words", 1100, { msg: "m1", thinking: true, text: "Where is " }));
    feed(ev("subagent-words", 1200, { msg: "m1", thinking: true, text: "the lexer?" }));
    feed(ev("subagent-words", 1300, { msg: "m1", text: "Looking " }));
    feed(ev("subagent-words", 1400, { msg: "m1", text: "in lex.js." }));
    assert.deepEqual(got, [{ type: "round-start", round: 1, blocksBefore: 0 }], "one round, its words still streaming");
    assert.deepEqual(reply.blocks, [{ type: "thinking", text: "Where is the lexer?" }, { type: "text", text: "Looking in lex.js." }]);

    feed(ev("subagent-tool-start", 1500, { id: "c1", name: "Read", args: "lex.js", card: { kind: "read", title: "Read", subject: "lex.js" } }));
    assert.deepEqual(got.slice(1).map((e) => [e.type, e.round, e.thinking ?? e.text ?? e.id]), [["round-thinking", 1, "Where is the lexer?"], ["round-text", 1, "Looking in lex.js."], ["tool-start", 1, "c1"]], "a call follows: the round's words are whole, as a run's log has them");
    assert.deepEqual([got[3].name, got[3].card], ["Read", { kind: "read", title: "Read", subject: "lex.js" }], "the call as its card draws it");

    feed(ev("subagent-plan", 1550, { items: [{ text: "Read lex.js", status: "doing" }] }));
    feed(ev("subagent-words", 1600, { msg: "m2", text: "Found it." }));
    feed(ev("subagent-tool-end", 1700, { id: "c1", ok: true, ms: 200 }));
    assert.deepEqual(got.slice(4).map((e) => [e.type, e.round]), [["plan", 1], ["round-start", 2], ["tool-end", 1]], "its plan in the round it came in; the next message is the next round; a call ends in the round it began in");
    assert.equal(got[5].blocksBefore, 2, "the next round's words begin after the first's two blocks");
    assert.deepEqual(reply.blocks[2], { type: "text", text: "Found it." });

    feed(ev("subagent-end", 1800, { status: "done", ok: true, ms: 800, report: "Found it." }));
    assert.deepEqual(got.slice(7), [{ type: "round-text", round: 2, text: "Found it." }], "its end closes the words still open");
    assert.deepEqual(t.take(ev("subagent-tool-end", 1900, { id: "never-began" })), []);
  });

  // (fails before: yes)
  test("an agent that names no message: words after a call are the next round, and thinking after words is too", () => {
    const t = guestThread(S);
    t.take(STARTED);
    /** @param {any} e */
    const types = (e) => t.take(e).map((it) => ("words" in it ? `words:${it.words.piece.block}:${it.words.piece.type}` : `${it.event.type}:${it.event.round}`));
    assert.deepEqual(types(ev("subagent-tool-start", 1100, { id: "c1", name: "Grep" })), ["round-start:1", "tool-start:1"], "a call before any word opens the first round");
    assert.deepEqual(types(ev("subagent-words", 1200, { msg: "", text: "First." })), ["round-start:2", "words:0:text"]);
    assert.deepEqual(types(ev("subagent-words", 1300, { msg: "", text: " More." })), ["words:0:text"], "the same message goes on");
    assert.deepEqual(types(ev("subagent-words", 1400, { msg: "", thinking: true, text: "Hm." })), ["round-text:2", "round-start:3", "words:1:thinking"]);
    assert.deepEqual(types(ev("subagent-words", 1500, { msg: "", text: "" })), [], "an empty piece draws nothing");
  });

  // (fails before: yes)
  test("only its own events: the main agent's, another agent's and Filament's own draw nothing here", () => {
    const t = guestThread(S);
    t.take(STARTED);
    for (const other of [
      { type: "round-text", round: 3, text: "the main agent's words" },
      { type: "tool-start", round: 3, id: S, name: "Agent" },
      ev("subagent-words", 1100, { parent: "toolu_2", text: "another's" }),
      ev("subagent-start", 1200, { parent: "toolu_2", description: "Another" }),
      ev("subagent-start", 1300, { description: "Said twice" }),
    ]) assert.deepEqual(t.take(other), []);
    assert.deepEqual([t.facts().description, t.facts().toolCalls], ["Map the parser", 0]);
  });

  // (fails before: yes — a turn that ended, or was cut, left its agent's card at "running" for good)
  test("its turn's end with no word of its own end cuts it off, when the turn ended; a paused turn leaves it running", () => {
    const cut = guestThread(S);
    cut.take(STARTED);
    cut.take(ev("subagent-words", 1100, { msg: "m1", text: "Half a sen" }));
    cut.take({ type: "run-end", ts: 4000, status: "stopped" });
    assert.deepEqual(cut.over("stopped").map((it) => ("event" in it ? [it.event.type, it.event.text] : [])), [["round-text", "Half a sen"]], "what it had written stands whole");
    assert.deepEqual([cut.facts().status, cut.facts().endedAt, cut.facts().ms], ["aborted", 4000, 3000]);
    assert.deepEqual(cut.over("stopped"), [], "once");

    const old = guestThread(S);
    old.run({ id: "req_9", status: "error", endedAt: 7000, meta: { agent: "Codex" } });
    old.take(STARTED);
    old.over("error");
    assert.deepEqual([old.facts().status, old.facts().endedAt, old.facts().of], ["aborted", 7000, "Codex"], "a turn that had ended before it was opened: its end is the run's own");

    const paused = guestThread(S);
    paused.take(STARTED);
    assert.deepEqual([paused.over("paused"), paused.facts().status], [[], "running"]);
    const ended = guestThread(S);
    ended.take(STARTED);
    ended.take(ev("subagent-end", 2000, { status: "failed", ok: false, error: "it crashed" }));
    ended.over("done");
    assert.deepEqual([ended.facts().status, ended.facts().error, ended.facts().ms], ["failed", "it crashed", 1000], "one that ended keeps its own end");
    assert.deepEqual(guestThread(S).over("done"), [], "a run that told of no such agent");
  });

  // (fails before: yes — AG-153, AG-155: nothing said whose thread it is, or why it takes no words)
  test("why it has no box: whose it is, who continues it and what stops it; once it ended, who can ask it more", () => {
    assert.equal(guestWhy("Claude Code", true), "Claude Code's own agent: Claude Code continues it, and it stops with the main agent's turn. To change what it does, tell the main agent.");
    assert.equal(guestWhy("Claude Code", false), "Claude Code's own agent: only Claude Code can ask it more. To go on with its work, tell the main agent.");
    assert.equal(guestWhy("", true), "The coding agent's own agent: The coding agent continues it, and it stops with the main agent's turn. To change what it does, tell the main agent.");
    assert.deepEqual([guestOwner("Codex"), guestOwner("")], ["Codex", "The coding agent"]);
  });
});

describe("the Sub Agents tab's rows of them", () => {
  const working = guestRowOf("g2", { status: "running", startedAt: NOW - 61_000, endedAt: null, ms: null, toolCalls: 6, description: "Map the parser" });
  const done = guestRowOf("g1", { agent: "", description: "Write the migration" });

  // (fails before: yes — the heading said "The agent's own" whatever the session ran, and a row of one threw: it has no
  // exchanges; HarnessV4_Tasks U12-D3: they stood in a group of their own, apart from how they stood)
  test("they stand among the session's agents by how they stand, each tagged with whose it is (AG-158); running first, then the newest; never waiting for you", () => {
    assert.deepEqual(sideGroups([], [done, working]).map((g) => [g.id, g.title, g.rows.map((r) => r.id)]), [["works", "Working", ["run_1~g2"]], ["done", "Done", ["run_1~g1"]]]);
    assert.deepEqual(sideGroups([agentRow("s1")], [done]).map((g) => [g.id, g.rows.map((r) => r.id)]), [["done", ["s1", "run_1~g1"]]], "yours and theirs in one group, newest first");
    assert.deepEqual([working, guestRowOf("g3", { of: "Codex" }), guestRowOf("g4", { of: "" })].map(whoTag), ["Claude Code's own", "Codex's own", "the coding agent's own"], "two coding agents in one session; a run that names none");
    assert.deepEqual([rowIcon(working), needsYou(working), needsYou(/** @type {any} */ ({ ...done, work: { pending: 2 } }))], ["bot", false, false], "its questions and its changes are its coding agent's");
  });

  // (fails before: yes — AG-157)
  test("a row: the kind its agent gives it, what it was told, how it stands; on the right its calls and time, with what it holds where its agent says it", () => {
    assert.deepEqual(guestRow(working, NOW), { name: "Explore", task: "Map the parser", fact: "working", tone: "works", right: "6 calls · 1m 1s" });
    assert.equal(guestRow({ ...working, tokens: 12_400 }, NOW).right, "12k tokens · 6 calls · 1m 1s", "as its turn's run says it");
    assert.deepEqual(guestRow(done, NOW), { name: "Agent", task: "Write the migration", fact: "done", tone: "ok", right: "14 calls · 3m" }, "Filament prices none of it");
    assert.equal(guestRow({ ...done, tokens: 50_000 }, NOW).right, "50k tokens · 14 calls · 3m", "and one that ended keeps what it held");
    assert.deepEqual(["failed", "aborted", "stopped"].map((status) => { const w = guestRow(guestRowOf("x", { status, toolCalls: 1, ms: null }), NOW); return [w.fact, w.tone, w.right]; }),
      [["failed", "error", "1 call"], ["cut off", "error", "1 call"], ["stopped", "warn", "1 call"]]);
    assert.equal(formatWorkedFor(61_000), "1m 1s");
  });

  // (fails before: yes — AG-156 counted them on the Team tab; the owner's words of 10-18 took them off it: "when i
  // run a side agent it also shows up as a team … Not sure if the side agents should show up in team")
  test("the Sub Agents tab's badge stays about the agents you called, and the Team tab's is the team's work: a coding agent's own light neither", () => {
    const watch = { live: new Set(), opened: new Set() };
    assert.equal(sideBadge([], watch), null, "a coding agent's own at work lights nothing here: the badge reads Filament's rows alone");
    assert.equal(teamBadge({ live: true, paused: false, rows: [], leads: false }), null, "nor on the Team tab: they are read in the Sub Agents tab");
    assert.equal(teamBadge({ live: true, paused: false, rows: [agentRow("s2", { status: "running" })], leads: false }), null, "nor an agent you asked on the side");
    assert.deepEqual([working, done].map((g) => guestRow(g, NOW).fact), ["working", "done"], "the Sub Agents tab's rows say them");
  });
});

describe("the Sub Agents view with a coding agent's own agents", () => {
  /** @param {Record<string, any>} [over] */
  function viewOf(over = {}) {
    const io = sideIO(over);
    const s = sideSeams();
    const view = createSideView(/** @type {any} */ (io), { h: fakeH, place: (p, k) => p.replaceChildren(...k), ...s.seams });
    return { io, view, chat: /** @type {any} */ ({ id: "chat-1", chainId: "c1", turns: [] }), ...s, el: view.el };
  }
  const own = [guestRowOf("g2", { status: "running", startedAt: NOW - 61_000, endedAt: null, ms: null, toolCalls: 6, description: "Map the parser" }), guestRowOf("g1", { description: "Write the migration" })];

  // (fails before: yes — the list held Filament's agents alone; HarnessV4_Tasks U12-D2: whose they were was a group's title)
  test("they are listed by how they stand among yours and the main agent's, tagged as Claude Code's own; a row opens a thread with no box of its own", () => {
    const rows = [agentRow("s1"), agentRow("s3", { origin: "agent", card: { tag: "pm", name: "PM", kind: "lead" } })];
    const { view, chat, el, threads } = viewOf({ rows: () => rows, own: () => [{ ...own[0], tokens: 8000 }, ...own.slice(1)] });
    view.paint(chat);
    assert.deepEqual(byClass(el, "sd-group").map((g) => textOf(g)), ["Working|1", "Done|3"]);
    assert.deepEqual(byClass(el, "sd-row").map((r) => r.attrs["data-id"]), ["run_1~g2", "s1", "s3", "run_1~g1"]);
    const theirs = byClass(el, "sd-row").filter((r) => r.attrs["data-id"].startsWith("run_1~"));
    assert.deepEqual(theirs.map((r) => [r.attrs["data-id"], one(r, "sd-av").attrs.class, textOf(one(r, "sd-row-name")), textOf(one(r, "sd-row-who")), textOf(one(r, "sd-row-task")), textOf(one(r, "sd-row-fact")), textOf(one(r, "sd-row-right")), one(r, "sd-dot").attrs.class]), [
      ["run_1~g2", "sd-av is-own", "Explore", "Claude Code's own", "Map the parser", "working", "8.0k tokens · 6 calls · 1m 1s", "sd-dot is-works"],
      ["run_1~g1", "sd-av is-own", "Explore", "Claude Code's own", "Write the migration", "done", "14 calls · 3m", "sd-dot is-ok"],
    ]);

    theirs[0].dispatch("click");
    assert.deepEqual([chat.side.open, threads.length, threads[0].guest, threads[0].o.id, threads[0].mounted, Object.keys(threads[0].o).sort()], ["run_1~g2", 1, true, "run_1~g2", 1, ["id", "toast"]], "its thread is read from its turn's run: no session's routes, no main agent's door, no held words");
    assert.deepEqual([textOf(one(one(el, "sd-conv"), "sav-head")), textOf(one(one(el, "sd-conv"), "sav-foot-box")), textOf(one(el, "sd-threads-words"))], ["own head run_1~g2", "own foot run_1~g2", "Explore"], "its head and foot are the thread's own; narrow, the list's menu names it");
    assert.equal(byClass(el, "ask-strip").length, 0, "it never asks you: its questions are its coding agent's");
    view.paint(chat);
    assert.equal(threads.length, 1, "a pulse draws the rows again, never the thread");

    view.open("run_1~g1", { followUp: true });
    assert.deepEqual([threads.length, threads[0].closed, threads[1].o.id, threads[1].guest], [2, true, "run_1~g1", true], "asked to take the keys, it has no box: nothing throws");
    view.open("s1", { followUp: true });
    assert.deepEqual([threads[2].guest, threads[2].o.id, threads[2].focused], [undefined, "s1", true], "an agent of Filament's own is the conversation Filament holds");
  });

  // (fails before: yes)
  test("narrow, the list's menu has them too, tagged; one opened from its card in the chat shows though the list holds it no longer", () => {
    const { view, chat, el, menus, threads } = viewOf({ own: () => own });
    view.paint(chat);
    one(el, "sd-threads").dispatch("click");
    assert.deepEqual(menuRows(menus[0]), [["item", "Start…"], ["label", "Working"], ["radio", "Explore: Map the parser", false], ["label", "Done"], ["radio", "Explore: Write the migration", false]]);
    assert.deepEqual([menuRow(menus[0], "Explore: Map the parser").desc, menuRow(menus[0], "Explore: Map the parser").icon], ["Claude Code's own · working · 6 calls · 1m 1s", "bot"]);
    view.open("run_0~old");
    assert.deepEqual([threads[0].guest, threads[0].o.id, textOf(one(el, "sd-threads-words"))], [true, "run_0~old", "Agent"], "an older turn's: its run tells its thread, whatever the newest thirty are");
  });
});

describe("the Team view leaves them to the Sub Agents tab", () => {
  /** @param {any} n @param {string} cls */
  const every = (n, cls) => byClass(n, cls);
  const chat = { chainId: "c1", turns: [], live: null, view: { settings: { engine: { mode: "model", team: null, teams: [] }, effective: {}, flat: {} } } };

  // (fails before: yes — E12's case 15 put a line of them under the heading; the owner's words of 10-18 took the Team
  // view to the team's work alone)
  test("no line of them and no section: nor of an agent you asked on the side, nor of one your agent called of itself", () => {
    const io = teamIO({ rows: () => [agentRow("s1", { status: "running" }), agentRow("s2", { origin: "agent", status: "running" })] });
    const view = createTeamView(io, { h: fakeH, place: (p, k) => p.replaceChildren(...k), drawIn: fakeDrawIn, later: () => {} });
    view.paint(chat);
    assert.deepEqual([every(view.el, "tv-h").length, every(view.el, "tv-grid").length, every(view.el, "tv-empty").length], [0, 0, 0], "their threads are in the Sub Agents tab");
    // (proposal_ux §4.6, Phase 5: "Your agent" card retired — with no team, the tab has no leader's card to wait on them)
    assert.equal(one(view.el, "ld-card"), undefined, "no team leads: no leader's card");
  });
});

describe("its thread, drawn", () => {
  const g = /** @type {any} */ (globalThis);
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
    g.requestAnimationFrame = (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0);
    g.cancelAnimationFrame = (/** @type {any} */ id) => clearTimeout(id);
  });
  after(() => {
    doc.restore();
    delete g.requestAnimationFrame;
    delete g.cancelAnimationFrame;
  });
  /** The frames due are drawn. */
  const drawn = () => new Promise((r) => setTimeout(r, 15));

  /** A stand-in for a run's stream: the test says what the run says, and when it is over. */
  const stream = () => {
    /** @type {{ runId: string, on: any, stopped: boolean, end: (status?: string) => void }} */
    const s = { runId: "", on: null, stopped: false, end: () => {} };
    /** @param {string} runId @param {any} on */
    const follow = (runId, on) => {
      s.runId = runId;
      s.on = on;
      /** @type {() => void} */
      let done = () => {};
      const promise = new Promise((r) => { done = () => r(undefined); });
      s.end = (status) => {
        if (status) on.onRunEnd?.(status);
        done();
      };
      return { promise, stop: () => { s.stopped = true; } };
    };
    return { s, follow: /** @type {any} */ (follow) };
  };
  /** Its parts in a page, as a host mounts them. @param {ReturnType<typeof stream>} st @param {string} [id] */
  const mounted = (st, id = `run_1~${S}`) => {
    /** @type {[string, string][]} */
    const toasts = [];
    const conv = guestConversation({ id, toast: (msg, kind) => { toasts.push([msg, kind || ""]); }, follow: st.follow });
    const scroll = h("div", { class: "scroll" }, conv.body);
    doc.document.body.append(h("div", { class: "host" }, conv.head, scroll, conv.foot));
    conv.mount(scroll);
    return { conv, toasts, head: /** @type {any} */ (conv.head), body: /** @type {any} */ (conv.body), foot: /** @type {any} */ (conv.foot) };
  };
  /** @param {any} el @param {string} sel */
  const texts = (el, sel) => el.querySelectorAll(sel).map((/** @type {any} */ n) => n.textContent);

  // (fails before: yes — AG-153: a coding agent's own agent had a card in the chat and no thread)
  test("what it was told, its thinking, words and calls as its turn's run tells them, and its end: a thread to read, with no box, no Apply, no Stop and no Send", async () => {
    const st = stream();
    const { conv, head, body, foot } = mounted(st);
    assert.deepEqual([st.s.runId, body.textContent, foot.classList.contains("hidden")], ["run_1", "Loading", true], "it follows its turn's run; until that tells of it, nothing is claimed");
    st.s.on.onRun({ id: "run_1", kind: "coding-agent", status: "running", endedAt: null, meta: { agent: "Claude Code" } });
    st.s.on.onEvent({ n: 1, type: "round-text", round: 3, text: "The main agent's own words." });
    st.s.on.onEvent({ n: 2, ...ev("subagent-start", Date.now() - 5000, { description: "Map the parser", agent: "Explore", prompt: "Find where tokens are read" }) });
    assert.equal(head.querySelector(".sav-title").textContent, "Map the parser");
    assert.deepEqual(texts(head, ".sav-meta span"), ["Claude Code's own", "Explore"]);
    assert.match(head.querySelector(".sav-status").textContent, /^Running\d+s$/);
    assert.equal(head.querySelectorAll("button").length, 0, "no Stop, no Apply, no Detach: none of it is Filament's to do (AG-155)");
    assert.deepEqual([foot.classList.contains("hidden"), foot.textContent], [false, "Claude Code's own agent: Claude Code continues it, and it stops with the main agent's turn. To change what it does, tell the main agent."]);
    assert.deepEqual([foot.querySelectorAll("textarea").length, foot.querySelectorAll("button").length], [0, 0], "no box and no way to ask it yourself");
    assert.match(body.querySelector(".sav-label").textContent, /^Claude Code asked/);
    assert.equal(body.querySelector(".sav-bubble").textContent, "Find where tokens are read");

    st.s.on.onEvent({ n: 3, ...ev("subagent-words", 1100, { msg: "m1", thinking: true, text: "Where is the lexer?" }) });
    st.s.on.onEvent({ n: 4, ...ev("subagent-words", 1200, { msg: "m1", text: "Looking in lex.js." }) });
    await drawn();
    assert.match(body.querySelector(".sav-text").innerHTML, /Looking in lex\.js\./, "its words while it writes them (AG-154)");
    assert.match(body.textContent, /Where is the lexer\?/, "and its thinking");
    assert.doesNotMatch(body.textContent, /The main agent's own words/, "never the main agent's");

    st.s.on.onEvent({ n: 5, ...ev("subagent-tool-start", 1300, { id: "c1", name: "Grep", args: "token", card: { kind: "search", title: "Grep", subject: "token" } }) });
    st.s.on.onEvent({ n: 6, ...ev("subagent-tool-end", 1400, { id: "c1", name: "Grep", ok: true, ms: 100, card: { kind: "search", title: "Grep", subject: "token" }, chars: 9, preview: "lex.js:12" }) });
    st.s.on.onEvent({ n: 7, ...ev("subagent-words", 1500, { msg: "m2", text: "Tokens are read in lex.js." }) });
    await drawn();
    assert.equal(body.querySelectorAll(".sav-round").length, 2, "a message and its calls, then the next");
    assert.match(body.querySelectorAll(".sav-round")[0].querySelector(".sav-tools").textContent, /token/, "its call, drawn as the chat draws one");
    assert.deepEqual(texts(head, ".sav-meta span"), ["Claude Code's own", "Explore", "1 call"]);
    st.s.on.onEvent({ n: 8, ...ev("subagent-held", 1600, { tokens: 13_400 }) });
    await drawn();
    assert.deepEqual(texts(head, ".sav-meta span"), ["Claude Code's own", "Explore", "13k tokens", "1 call"], "what it holds, where its agent says it");

    st.s.on.onEvent({ n: 9, ...ev("subagent-end", 5200, { status: "done", ok: true, ms: 4200, toolCalls: 1, model: "haiku", report: "Tokens are read in lex.js." }) });
    st.s.end("done");
    await drawn();
    assert.deepEqual(texts(head, ".sav-meta span"), ["Claude Code's own", "Explore", "haiku", "13k tokens", "1 call"]);
    assert.equal(head.querySelector(".sav-status").textContent, `Finished${formatWorkedFor(4200)}`);
    assert.equal(foot.textContent, "Claude Code's own agent: only Claude Code can ask it more. To go on with its work, tell the main agent.");
    assert.match(body.querySelector(".sav-outcome").textContent, /^Finished.*1 tool call/);
    assert.equal(body.querySelectorAll(".sav-end .sav-text").length, 0, "its report is its last message, which its last round already says");
    const acts = body.querySelector(".sav-acts");
    assert.deepEqual([acts.querySelector(".sav-acts-note").textContent, texts(acts, "button")], ["It answered the main agent's call", ["Copy"]], "Copy stays; nothing sends it on: its answer went to the call that began it");
    assert.equal(body.querySelectorAll(".sav-work").length, 0, "no changes to apply: it works in its coding agent's folder");
    conv.close();
    assert.equal(st.s.stopped, true, "let go, it follows the run no longer");
  });

  // (fails before: yes — cases 14 and 17)
  test("a turn that ended and left it open cuts it off; a turn whose record is gone, and one that tells of no such agent, say so", async () => {
    const cut = stream();
    const a = mounted(cut);
    cut.s.on.onRun({ id: "run_1", kind: "coding-agent", status: "stopped", endedAt: 9000, meta: { agent: "Codex" } });
    cut.s.on.onEvent({ n: 1, ...ev("subagent-start", 1000, { description: "Write the tests", prompt: "" }) });
    cut.s.on.onEvent({ n: 2, ...ev("subagent-words", 1100, { msg: "", text: "Half a sen" }) });
    cut.s.end("stopped");
    await drawn();
    assert.equal(a.head.querySelector(".sav-status").textContent, `Cut off${formatWorkedFor(8000)}`);
    assert.equal(a.body.querySelector(".sav-bubble").textContent, "Write the tests", "told nothing more than its name: that is what it was asked");
    assert.match(a.body.querySelector(".sav-text").innerHTML, /Half a sen/, "what it had written stands");
    assert.match(a.foot.textContent, /^Codex's own agent: only Codex can ask it more\./);
    a.conv.close();

    const gone = stream();
    const b = mounted(gone, "run_0~old");
    gone.s.on.onMissing();
    gone.s.end();
    await drawn();
    assert.deepEqual([b.body.textContent, b.foot.classList.contains("hidden")], ["The record of the turn this agent worked in is kept no longer, and its thread went with it.", true]);
    b.conv.close();

    const none = stream();
    const c = mounted(none, "run_1~nobody");
    none.s.on.onEvent({ n: 1, ...ev("subagent-start", 1000, { description: "Somebody else" }) });
    none.s.end("done");
    await drawn();
    assert.equal(c.body.textContent, "The turn's record says nothing of this agent.");
    c.conv.close();
  });

  // (fails before: yes — case 20: Open stood on the card of Filament's own agent alone)
  test("Open on its card in the chat opens the same thread: the turn's run and the card", () => {
    /** @type {string[]} */
    const opened = [];
    const had = chipActions.openSubagent;
    chipActions.openSubagent = (id) => void opened.push(id);
    try {
      const events = [
        { type: "round-start", round: 1, blocksBefore: 0 },
        { type: "tool-start", round: 1, id: "sa:task_1", name: "agent", args: "Explore", card: { kind: "subagent", title: "Agent", subject: "Explore" } },
        { type: "subagent-start", round: 1, parent: "sa:task_1", description: "Explore", prompt: "Look around" },
        { type: "tool-start", round: 1, id: "call_9", name: "agent", args: "Review", card: { kind: "subagent", title: "Agent", subject: "Review" } },
        { type: "subagent-start", round: 1, parent: "call_9", agentId: "sa_1a2b3c4d", description: "Review", prompt: "Review it", card: { tag: "reviewer", name: "Reviewer" } },
      ];
      const cell = alignEvents(events).byRound.get(1);
      const [own, filaments] = roundRows(cell, { runId: "req_9" }).map((row) => /** @type {any} */ (row).querySelector(".subagent-open"));
      assert.deepEqual([own.textContent, own.getAttribute("title")], ["Open conversation", "Its thread in the Agents tab: what it was told, its calls and its words"]);
      own.dispatch("click", { stopPropagation() {} });
      filaments.dispatch("click", { stopPropagation() {} });
      assert.deepEqual(opened, ["req_9~sa:task_1", "sa_1a2b3c4d"]);
      assert.equal(/** @type {any} */ (roundRows(cell)[0]).querySelector(".subagent-open"), null, "a card drawn with no run to read it from offers none");
    } finally {
      chipActions.openSubagent = had;
    }
  });
});

describe("the page's wiring", () => {
  const src = (/** @type {string} */ p) => readFileSync(new URL(`../src/ui/harness/${p}`, import.meta.url), "utf8");

  // (fails before: yes — the store kept Filament's rows alone, and nothing read the list again when a coding agent's
  // own agent began or ended)
  test("the store keeps them from the list's answer and looks again while one works; the running turn's run says when one began or ended", () => {
    const store = src("lib/subagents.js");
    assert.match(store, /own = Array\.isArray\(r\?\.own\) \? r\.own : \[\];/);
    assert.match(store, /const busy = rows\.some\(\(r\) => r\.status === "running"\) \|\| own\.some\(\(g\) => g\.status === "running"\) \|\| marked;/);
    assert.match(store, /resyncTimer = busy \? setTimeout\(load, RESYNC_MS\) :/);
    // (fails before: yes — the Designer's of 10-28: a file resolved in the editor left its row waiting until the next message)
    assert.match(store, /const marked = rows\.some\(\(r\) => !!r\.work\?\.lastApplied\?\.marked\?\.length\);/, "and while a file an apply left with markers still has them");
    assert.match(store, /      rows = \[\];\n      own = \[\];\n      known = false;/, "another session never shows this one's");
    const app = src("app.js");
    assert.match(app, /const OWN_AGENT_MOVES = new Set\(\["subagent-start", "subagent-tool-start", "subagent-held", "subagent-end"\]\);/, "its row moves with its calls and what it holds, not at its two ends alone");
    assert.match(app, /if \(OWN_AGENT_MOVES\.has\(e\?\.type\) && !e\.agentId && chat\?\.chainId === subagentStore\.chainId\(\)\) subagentStore\.soon\(\);/);
    assert.equal(app.split("ownAgentMoved(chat, e);").length - 1, 2, "the page's own turn and a turn it follows both say so");
    assert.match(app, /own: \(\) => subagentStore\.own\(\),\n    chainId: \(\) => subagentStore\.chainId\(\),/);
    assert.match(src("views/host.js"), /teamBadge\(\{ live: !!chat\.live, paused: asksYou\(ownLast\(chat\.turns\)\), rows: o\.team\.rows\(\), leads: !!leadingTeam\(chat\.view\?\.settings\?\.engine\) \}\)/);
  });
});
