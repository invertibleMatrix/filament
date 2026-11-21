// @ts-check
// A thread in the page (core/threads.js; the plan of 11-11, its th4): the brief its starter's agent wrote stands as a card
// of its own under who wrote it, with the way to that chat — never the person's bubble; the sidebar draws each thread
// under the chat that started it, or with its byline where it stands apart; the header's pill names the linked chats and
// opens each; the thread call's row names the thread, its model and where it works, its link opening it.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stubDocument } from "./helpers/dom-stub.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { BRIEF_HEAD as CORE_BRIEF_HEAD, BRIEF_END as CORE_BRIEF_END, briefBlock, briefWords } from "../src/core/threads.js";
import { askLine } from "../src/core/messages.js";
import { argSummary } from "../src/app/agent/tools.js";
import { BRIEF_HEAD, BRIEF_END, transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { againOf, firstMessageName, threadOfWords, threadsLinked, threadsNested, wordsAgain } from "../src/ui/harness/lib/labels.js";
import { personTextAt } from "../src/services/memory/brain.js";
import { briefRow } from "../src/ui/harness/conversation/turn.js";
import { threadRow } from "../src/ui/harness/conversation/tools/render.js";

const ids = (/** @type {any[]} */ rows) => rows.map((r) => r.id);

describe("the sidebar's threads, as labels.js places them", () => {
  // (fails before: yes — labels.js had no threadsNested; a thread stood as any chat, by its time alone)
  test("each thread under the chat that started it, in the list's order; one whose starter the list lacks stands apart", () => {
    const rows = [
      { id: "readme" },
      { id: "tokens", threadOf: "login" },
      { id: "login" },
      { id: "advisor", threadOf: "login" },
      { id: "second", threadOf: "advisor" },
      { id: "far", threadOf: "elsewhere" },
    ];
    const { top, under } = threadsNested(rows);
    assert.deepEqual(ids(top), ["readme", "login", "far"], "a thread drawn before its starter by time goes under it all the same");
    assert.deepEqual(ids(under.get("login") || []), ["tokens", "advisor"]);
    assert.deepEqual(ids(under.get("advisor") || []), ["second"], "a thread's thread under the thread");
    assert.equal(under.has("elsewhere"), false);
  });

  // (fails before: yes — no nesting at all)
  test("a loop of links never hides its chats: each stands in the list", () => {
    const { top, under } = threadsNested([{ id: "a", threadOf: "b" }, { id: "b", threadOf: "a" }, { id: "c", threadOf: "c" }]);
    assert.deepEqual(ids(top), ["a", "b", "c"]);
    assert.equal(under.size, 0);
  });

  // (fails before: yes — labels.js had no threadOfWords)
  test("a thread apart says whose, named as the list names that chat; any other chat says nothing", () => {
    const sessions = [{ id: "login", title: "Build the login flow" }, { id: "untitled", title: null, preview: "Fix the tests" }];
    assert.equal(threadOfWords({ threadOf: "login" }, sessions), "Thread of Build the login flow");
    assert.equal(threadOfWords({ threadOf: "untitled" }, sessions), "Thread of Fix the tests");
    assert.equal(threadOfWords({ threadOf: "gone" }, sessions), "Thread of another chat");
    assert.deepEqual([threadOfWords({}, sessions), threadOfWords(null, sessions)], ["", ""]);
  });

  // (fails before: yes — sidebar.js drew every chat by its time, its threads among them)
  test("the bar nests a list's threads in each of its lists, and the row knows how deep it stands", () => {
    const bar = readFileSync(new URL("../src/ui/harness/sidebar.js", import.meta.url), "utf8");
    assert.match(bar, /nestThreads\(home\)\.flatMap\(\(s\) => rowsOf\(s\)\)/, "a project's chats at home");
    assert.match(bar, /nestThreads\(pinned\)/, "Pinned");
    assert.match(bar, /for \(const s of nestThreads\(rest\)\) \{/, "the list by time");
    assert.match(bar, /\.\.\.\(threadsUnder\.get\(String\(s\.id\)\) \|\| \[\]\)\.flatMap\(\(t\) => rowsOf\(t, o\)\)/, "a chat's rows end with its threads'");
    assert.match(bar, /const depth = threadDepth\.get\(String\(s\.id\)\) \|\| 0;/, "a row's patch keeps its depth");
    // (fails before: yes — the review of th4: a nested row's glyph had no name, and a deep thread's row ran off the bar)
    assert.match(bar, /class: "row-thread-ic", role: "img", "aria-label": "Thread"/);
    assert.match(readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8"), /\.sess-row\.is-thread \{ padding-left: calc\(10px \+ 14px \* min\(var\(--thread-depth, 1\), 3\)\); \}/);
  });
});

describe("the header's chip of linked chats", () => {
  // (fails before: yes — the review of th4: the chip read the sessions list alone, which holds the newest 100 chats that
  // a search or Show archived narrows, so a thread's starter beyond them read "another chat" and its threads none)
  test("from the transcript's threads, the list adding a thread started since and naming each as it is now", () => {
    const read = { from: { id: "login", title: "Build the login flow" }, started: [{ id: "old", title: "An old thread" }] };
    assert.deepEqual(threadsLinked("advisor", read, []), { from: { id: "login", title: "Build the login flow" }, started: [{ id: "old", title: "An old thread" }] }, "the list holds none of them");
    const sessions = [{ id: "new", threadOf: "advisor", title: "Started since" }, { id: "login", title: "Login, renamed" }, { id: "old", title: null, preview: "Its first words" }];
    assert.deepEqual(threadsLinked("advisor", read, sessions), {
      from: { id: "login", title: "Login, renamed" },
      started: [{ id: "new", title: "Started since" }, { id: "old", title: "Its first words" }],
    });
    assert.deepEqual(threadsLinked("t", null, [{ id: "t", threadOf: "s" }]), { from: { id: "s", title: "another chat" }, started: [] }, "no read yet: the list's word");
    assert.deepEqual(threadsLinked(null, read, sessions), { from: null, started: [] });
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /chat\.threads = tr\.threads \|\| null;/);
    assert.match(app, /headerModule\.setThreads\(threadsLinked\(chat\?\.chainId, chat\?\.threads, state\.sessions \|\| \[\]\)\);/);
  });

  // (fails before: yes — the review of th4: beside the views, whose box never gives up its width, the chip cut the title)
  test("its own item after the views, a menu button named by its words", () => {
    const header = readFileSync(new URL("../src/ui/harness/header.js", import.meta.url), "utf8");
    assert.match(header, /class: "c-thread hidden", type: "button", "aria-haspopup": "menu",/);
    assert.match(header, /threadEl\.setAttribute\("aria-label", said\);/);
  });
});

describe("a thread's brief in its chat", () => {
  const brief = "You review each diff I send.\n\n- correctness first\n- then tests";
  const turn = {
    n: 1,
    turnId: 1,
    user: { role: "user", content: [briefBlock({ from: "b1lct1fa", title: "Build the login flow", brief })] },
    by: "thread",
    brief: { from: "b1lct1fa" },
    final: { role: "assistant", content: [{ type: "text", text: "Ready." }] },
  };

  // (fails before: yes — the page drew the brief as the person's own message, Filament's block and all)
  test("the turn carries the brief: who sent it, that chat's title as the block named it, and the agent's words alone", () => {
    assert.equal(BRIEF_HEAD, CORE_BRIEF_HEAD, "the page reads the head the server writes");
    const [t] = transcriptTurns({ turns: [turn] });
    assert.deepEqual(t.brief, { from: "b1lct1fa", title: "Build the login flow", text: brief });
    assert.equal(firstMessageName([t], () => true), "", "a brief names no chat");
    // (fails before: yes — the review of th4, and the demo's card that said "Brief from untitled": the block names the
    // starter as it was when its agent wrote the brief)
    const now = transcriptTurns({ turns: [turn], threads: { from: { id: "b1lct1fa", title: "Login, renamed" }, started: [] } })[0];
    assert.equal(now.brief?.title, "Login, renamed", "named as it is now");
    const blank = { ...turn, user: { role: "user", content: [briefBlock({ from: "b1lct1fa", title: "", brief })] } };
    assert.equal(transcriptTurns({ turns: [blank] })[0].brief?.title, "", "never the block's 'untitled': the card says 'another chat'");
  });

  // (fails before: yes — turn.js had no briefRow)
  test("drawn as a card of its own: 'Brief from' the starter's link, the words read as a reply's, Copy and no Rewind", () => {
    const doc = stubDocument();
    try {
      let copied = 0;
      const [t] = transcriptTurns({ turns: [turn] });
      const row = /** @type {any} */ (briefRow(t, { onCopy: () => copied++ }));
      assert.equal(row.classList.contains("is-brief"), true);
      assert.equal(row.querySelector(".u-bubble"), null, "never the person's bubble");
      assert.equal(row.querySelector(".brief-who")?.textContent, "Brief from");
      const link = row.querySelector("a.ref-chip");
      assert.deepEqual([link?.getAttribute("data-chat"), link?.textContent], ["b1lct1fa", "Build the login flow"]);
      assert.match(String(row.querySelector(".brief-text")?.innerHTML), /<li>correctness first<\/li>/, "its list drawn as a list");
      assert.equal(row.querySelector(".u-rewind"), null);
      row.querySelector(".u-act")?.dispatch("click");
      assert.equal(copied, 1);
    } finally {
      doc.restore();
    }
  });

  // (fails before: yes — the timeline drew every message it did not know with userRow)
  test("the timeline draws the brief's row, and clamps a long one as a long message", () => {
    const tl = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
    assert.match(tl, /turn\.brief \? briefRow\(turn, /);
    assert.match(tl, /querySelector\?\.\("\.u-bubble, \.brief-text"\)/);
    // (fails before: yes — the review of th4: the rail's preview of the turn opened with Filament's block)
    assert.match(tl, /query: \(t\.brief \? String\(t\.brief\.text \|\| ""\) : t\.userText \|\| ""\)\.slice\(0, 160\)/);
  });

  // (fails before: yes — Retry sent the brief's words as the person's message: `wordsAgain` gave them, and the send
  // posted them as any message typed in the box)
  test("Retry sends the brief again as the brief it was — Filament's one block, no words of the person's — and only from its failure", () => {
    assert.equal(BRIEF_END, CORE_BRIEF_END, "the page reads the end the server writes");
    const sent = briefBlock({ from: "b1lct1fa", title: "Build the login flow", brief });
    assert.ok(sent.text.endsWith(`${CORE_BRIEF_END}\n\n${brief}`), "the words after the head's end, in its block");
    const [t] = transcriptTurns({ turns: [{ ...turn, final: null, open: true, facts: { error: "the model answered 400" } }] });
    assert.equal(t.status, "error");
    assert.equal(wordsAgain(t), "", "no words of the person's to send");
    assert.deepEqual(againOf(t), { text: "", attachments: [], brief: sent.text }, "the block as it was posted");
    assert.equal(personTextAt({ messages: [{ role: "user", content: [{ type: "text", text: String(againOf(t).brief) }] }] }, 0).trim(), "", "which memory reads none of as the person's");
    assert.equal(wordsAgain({ userText: "hello" }), "hello", "anyone else's turn as before");
    assert.deepEqual(againOf({ userText: "hello", sent: [] }), { text: "hello", attachments: [] });
    // A chat started before the words rode in the head's block: its brief goes again as one block all the same.
    const old = [{ type: "text", text: sent.text.slice(0, sent.text.indexOf(CORE_BRIEF_END) + CORE_BRIEF_END.length) }, { type: "text", text: brief }];
    const [o] = transcriptTurns({ turns: [{ ...turn, user: { role: "user", content: old } }] });
    assert.equal(againOf(o).brief, sent.text);
    // A brief whose head cannot be read goes again as nothing, never as words.
    assert.deepEqual(againOf({ brief: { from: null, title: "", text: "Review it." }, userText: "Review it." }), { text: "", attachments: [] });
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /if \(again\.brief\) return sendMessage\("", \[\], "normal", \{ \.\.\.o, replaces: turn, \.\.\.sendsIn\(chat\), brief: \{ block: again\.brief, view: turn\.brief \} \}\);/, "sent with no words for the page to read");
    assert.match(app, /if \(brief\) content\.push\(\{ type: "text", text: brief\.block \}\);/, "the block is the message");
    assert.match(app, /\n      thread: !!brief,\n/, "posted as a thread's brief");
    assert.match(app, /if \(brief && \(chat\.live \|\| chat\.waiting \|\| compactingBetween\(chat\)\)\) return refuse\(BRIEF_AGAIN_LATER, !away\);/, "no note into a turn, and in no queue");
    assert.match(app, /if \(again\.brief && chat\.live\) \{\n    refuse\(BRIEF_AGAIN_LATER, /, "nor queued by a card's answer");
    assert.match(app, /else if \(holder && !brief\) \{/, "nor left waiting on a row, which sends words");
    assert.match(readFileSync(new URL("../src/ui/harness/lib/api.js", import.meta.url), "utf8"), /\.\.\.\(thread \? \{ by: "thread" \} : \{\}\),/);
    // A brief that was answered has no Retry: the reply's row offers none.
    assert.match(readFileSync(new URL("../src/ui/harness/conversation/turn.js", import.meta.url), "utf8"), /turn\.own \|\| turn\.brief \|\| waiting \? null : act\("Retry /);
  });

  // (fails before: yes — a title's brackets stood in the head as written; they are written as others, so the head's
  // first "]" is its own end)
  test("a title holding brackets cuts none of the brief's words", () => {
    const odd = briefBlock({ from: "b1lct1fa", title: "Fix [the] login", brief: "Review it." });
    const [s] = transcriptTurns({ turns: [{ ...turn, user: { role: "user", content: [odd] } }] });
    assert.deepEqual([s.brief?.title, s.brief?.text], ["Fix (the) login", "Review it."]);
    assert.equal(briefWords({ content: [odd] }), "Review it.");
    // As a chat started before holds one: the title as written then, the words after the head's end.
    const was = `${odd.text.slice(0, odd.text.indexOf(CORE_BRIEF_END) + CORE_BRIEF_END.length).replace("Fix (the) login", "Fix [the] login")}\n\nReview it.`;
    const [w] = transcriptTurns({ turns: [{ ...turn, user: { role: "user", content: was } }] });
    assert.deepEqual([w.brief?.title, w.brief?.text], ["Fix [the] login", "Review it."]);
    assert.equal(briefWords({ content: was }), "Review it.");
  });
});

describe("the thread call's row", () => {
  // (fails before: yes — the call was drawn as any tool's, its subject empty)
  test("named by its thread, with the way to it, the model and where it works; a refusal says why", () => {
    assert.equal(argSummary("thread", { title: "Advisor", brief: "Review my diffs." }), "Advisor");
    assert.equal(argSummary("thread", { brief: "Review my diffs.\nEach one." }), "Review my diffs.");
    const doc = stubDocument();
    try {
      const base = { id: "c1", status: "done" };
      const said = 'Started the thread "Advisor: login reviews" (b1lcicap) on agent/brain-opus at high effort in C:\\work\\site: it reads your brief now. Write it with Filament\'s envelope tool, to: "b1lcicap". Nothing comes back by itself: it writes you when its brief says to. Go on with your work.';
      const row = /** @type {any} */ (threadRow({ name: "thread", state: "done", preview: said, args: "Advisor: login reviews" }, base, {}, ""));
      const text = String(row.textContent);
      assert.match(text, /Started a thread/);
      const link = row.querySelector("a.ref-chip");
      assert.deepEqual([link?.getAttribute("data-chat"), link?.textContent], ["b1lcicap", "Advisor: login reviews"]);
      assert.match(text, /agent\/brain-opus · high effort · in site/);
      const no = /** @type {any} */ (threadRow({ name: "thread", state: "failed", preview: "Not started: the model can't run here.", args: "Advisor" }, base, {}, ""));
      assert.match(String(no.textContent), /Thread not started/);
      assert.match(String(no.textContent), /the model can't run here/);
      assert.equal(no.querySelector("a.ref-chip"), null);
      // As the loop hands a refusal back: its "Error: " and the tool's "Not started: " said once, by the row.
      const looped = /** @type {any} */ (threadRow({ name: "thread", state: "failed", preview: "Error: Not started: brain-opus cannot run now.", args: "Advisor" }, base, {}, ""));
      assert.equal(looped.querySelector(".tool-secondary")?.textContent, "brain-opus cannot run now.");
      // A coding agent's call over Filament's MCP server, its input whole: the brief it gave behind the row.
      const mcp = /** @type {any} */ (threadRow({ name: "mcp__filament__thread", state: "done", preview: said, args: { title: "Advisor", brief: "Review my diffs." } }, base, { title: "Advisor", brief: "Review my diffs." }, ""));
      assert.match(String(mcp.textContent), /Its brief/);
      // (fails before: yes — the review of th4: a call still running, its args not yet a line, drew no name)
      const running = /** @type {any} */ (threadRow({ name: "thread", state: "running", preview: "", card: { kind: "thread", title: "Start a thread", subject: "Advisor" } }, base, {}, ""));
      assert.match(String(running.textContent), /Starting a thread[\s\S]*Advisor/);
    } finally {
      doc.restore();
    }
  });
});

describe("linked chats in a running Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-thread-ui-"));
  before(async () => {
    up = await fakeUpstream(async () => anthropicReply("ON IT", { model: "brain-model" }));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // (fails before: yes — the sessions list said nothing of a thread's starter)
  test("the sessions list names each thread's starter, which the bar and the header read", async () => {
    const sessions = /** @type {any} */ (shim.app).sessions;
    const starter = sessions.create({ cwd: root, model: "agent/brain-model", title: "Build the login flow", preset: "plain" });
    const t = sessions.create({ cwd: root, model: "agent/brain-model", title: "Advisor", preset: "plain", thread: starter.id });
    const second = sessions.create({ cwd: root, model: "agent/brain-model", title: "Reviewer", preset: "plain", thread: t.id });
    const r = await shim.api("/api/memory/sessions?limit=50");
    const rows = /** @type {any[]} */ ((await r.json()).sessions);
    const of = (/** @type {string} */ id) => rows.find((s) => s.id === id);
    assert.equal(of(t.id)?.threadOf, starter.id);
    assert.equal(of(second.id)?.threadOf, t.id);
    assert.equal("threadOf" in (of(starter.id) || {}), false, "a chat that is no thread has no key");
  });

  // (fails before: yes — the review of th4: the brief was read from the message's first block, which is the ask line
  // where a saved agent may be asked, so it was drawn as the person's; and any turn that opened as a brief would, in
  // any chat, was drawn as one, its starter whatever its words named)
  test("the transcript marks the first turn's brief alone, read past what rode ahead of it, naming its real starter; and names the linked chats", async () => {
    const sessions = /** @type {any} */ (shim.app).sessions;
    const archive = /** @type {any} */ (shim.app).memory.archive;
    const starter = sessions.create({ cwd: root, model: "agent/brain-model", title: "Build the login flow", preset: "plain" });
    const t = sessions.create({ cwd: root, model: "agent/brain-model", title: "Advisor", preset: "plain", thread: starter.id });
    const loose = sessions.create({ cwd: root, model: "agent/brain-model", title: "Loose", preset: "plain" });
    // The head alone, its words in a block after it: as a chat started before the words rode in the head's holds one.
    const head = briefBlock({ from: starter.id, title: "Build the login flow", brief: "" });
    /** @param {string} chain @param {any[]} content @param {any} [meta] */
    const said = (chain, content, meta) => {
      const { turnId } = archive.beginTurn(chain, { requestId: `r-${chain}-${Math.random()}`, model: "brain-model", userMessage: { role: "user", content } });
      if (meta) archive.mergeTurnMeta(turnId, meta);
      archive.finishTurn(turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: "Ready." }] } });
    };
    said(t.id, [{ type: "text", text: askLine(["pm"]) }, head, { type: "text", text: "Review each diff." }], { deliveries: 1, asking: 1 });
    said(t.id, [head, { type: "text", text: "My own words, pasted." }]);
    said(loose.id, [head, { type: "text", text: "Not a thread at all." }]);
    const read = async (/** @type {string} */ id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json());
    const tr = await read(t.id);
    assert.deepEqual(tr.turns.map((/** @type {any} */ x) => x.brief || null), [{ from: starter.id }, null], "the first turn's, past the ask line; a later one is the person's");
    assert.equal(transcriptTurns(tr)[0].brief?.text, "Review each diff.");
    // (fails before: yes — a brief was drawn only while a link named its starter: a fork of a thread, or a thread whose
    // starter was deleted, drew the same first turn as the person's bubble)
    assert.deepEqual((await read(loose.id)).turns[0].brief, { from: starter.id }, "a first turn that opens with a brief's block is one, whatever the links say: named as its block names it");
    assert.deepEqual(tr.threads, { from: { id: starter.id, title: "Build the login flow" }, started: [] });
    assert.deepEqual((await read(starter.id)).threads, { from: null, started: [{ id: t.id, title: "Advisor" }] });
    assert.equal("threads" in (await read(loose.id)), false);
  });
});
