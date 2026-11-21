// @ts-check
// An agent's thread drawn as the main transcript draws a turn (the transcript audit of 2026-10-23, the owner's words:
// "i just want the same experience over there as i have here in the main transcript with you"): its rounds' cards
// through the chat's own `cardsEl` — its plan, a compaction in words and the line while one runs, an edit's change
// read from its own thread — Filament's note on how it ended apart from its words, what its agent told you beside them,
// the waits the chat's live line says, a call that waits for you answered in its foot, and your words into its run at
// its next step whoever launched it.
import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { agentRow, NOW } from "./helpers/side-view.js";
import { until } from "./helpers/wait.js";
import { runSocketFromRoutes } from "./helpers/run-socket.js";

const g = /** @type {any} */ (globalThis);
/** The paths the page asked the server for, in order. @type {string[]} */
const asked = [];
/** What the stand-in server answers, by the whole address; null leaves the request unanswered. @type {(url: string, init?: any) => Response | null} */
let serve = () => null;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
  asked.push(String(url).split("?")[0]);
  return serve(String(url), init) ?? new Promise(() => {});
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { subagentConversation } = await import("../src/ui/harness/subagent-viewer.js");
const { h } = await import("../src/ui/lib/dom.js");

/** @param {any} body @param {number} [status] */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A run's stream the test writes to, as the server's events stream sends it (and its run socket, the same frames). */
const runStream = () => {
  /** @type {ReadableStreamDefaultController<Uint8Array>} */
  let ctl;
  const body = new ReadableStream({ start: (c) => { ctl = c; } });
  const enc = new TextEncoder();
  let n = 0;
  return {
    response: () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    /** @param {...any} events */
    say: (...events) => { for (const e of events) ctl.enqueue(enc.encode(`data: ${JSON.stringify({ n: ++n, at: NOW, ...e })}\n\n`)); },
    end: () => {
      ctl.enqueue(enc.encode(`data: ${JSON.stringify({ type: "ended", status: "done" })}\n\n`));
      ctl.close();
    },
  };
};
const MAIN = { state: () => /** @type {const} */ ("idle"), outside: () => null, start: () => {}, write: () => {} };
/** The events streams the page opened: the bus's one, shared by every thread. @type {any[]} */
const streams = [];
/** A message on the events feed, as the server's fan-out sends it. @param {any} msg */
const busSays = (msg) => streams.at(-1).onmessage({ data: JSON.stringify(msg) });
const running = (/** @type {string} */ id, /** @type {Record<string, any>} */ over = {}) =>
  agentRow(id, { status: "running", origin: "owner", asked: false, card: { tag: "scout", name: "Scout" }, exchanges: [{ prompt: "Fix the parser.", description: "Fix the parser.", by: "owner", runId: `run_${id}`, status: "running", startedAt: NOW - 5_000, endedAt: null, delivery: null }], ...over });

describe("an agent's thread, as the main transcript draws a turn", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
    MutationObserver: class { observe() {} disconnect() {} },
    // The page's one events stream (lib/bus.js), kept so a test can say a message on it (`busSays`).
    EventSource: class { constructor() { streams.push(this); } close() {} },
    // The thread follows its run on the page's run socket, answered from the same stand-in routes.
    WebSocket: runSocketFromRoutes((path) => serve(path)),
    location: { protocol: "http:", host: "stand-in" },
    addEventListener: () => {},
  };
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
  });
  after(() => {
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
    g.fetch = realFetch;
  });
  beforeEach(() => {
    asked.length = 0;
  });
  /** The threads a test mounted: let go after it, passed or failed, so no clock of theirs holds the run open. @type {{ close: () => void }[]} */
  const open = [];
  afterEach(() => {
    for (const c of open.splice(0)) c.close();
  });

  /** Its parts in a page, as a host mounts them. @param {any} row @param {Record<string, any>} [o] */
  const mounted = (row, o = {}) => {
    const conv = subagentConversation({ chainId: "c1", id: row.id, toast: () => {}, main: MAIN, ...o });
    open.push(conv);
    const scroll = h("div", { class: "scroll" }, conv.body);
    const host = h("div", { class: "host" }, conv.head, scroll, conv.foot);
    doc.document.body.append(host);
    conv.mount(scroll);
    return { conv, body: /** @type {any} */ (conv.body), foot: /** @type {any} */ (conv.foot) };
  };
  /** @param {any} el */
  const workingOf = (el) => {
    const w = el.querySelector(".sav-working");
    return !w || w.classList.contains("hidden") ? "" : w.textContent;
  };

  // (fails before: yes — the thread drew its calls alone: no plan, a compaction read "rounds undefined–undefined" and
  // none showed while it ran, Filament's note and what its agent told you were dropped, a retry or a wait read "Thinking")
  test("its plan, its compactions, Filament's note on how it ended, what its agent told you, and the waits the chat's live line says", async () => {
    const run = runStream();
    const row = running("sa_p1");
    serve = (url) => (url.startsWith("/api/sessions/c1/subagents/sa_p1") ? json({ subagent: row }) : url.startsWith("/api/runs/run_sa_p1/events") ? run.response() : null);
    const { conv, body } = mounted(row);
    run.say({ type: "round-start", round: 1, blocksBefore: 0 }, { type: "turn-state", to: "waiting", why: "trying again in 30s: the provider is overloaded", retry: { status: 529, waitMs: 30_000, next: 2, of: 5 } });
    await until(() => workingOf(body) === "Trying again in 30s: the provider is overloaded", "the retry, as the chat's live line says it");
    run.say({ type: "turn-state", to: "planning", why: "", tokens: 2400 });
    await until(() => workingOf(body) === "Thinking · about 2,400 tokens", "its thinking, counted");

    run.say({ type: "plan", round: 1, items: [{ text: "Read the failing test", status: "done" }, { text: "Fix the off-by-one", status: "doing" }] });
    await until(() => body.querySelectorAll(".plan-card-body").length === 1, "its plan, as the chat's card");
    assert.match(body.querySelector(".plan-card-body").textContent, /Read the failing testFix the off-by-one/);

    run.say({ type: "compacting", round: 1 });
    await until(() => /Compacting: the older rounds are being summarized into one/.test(body.textContent), "the line while it compacts");
    run.say({ type: "compaction", round: 1, fromRound: 1, toRound: 3, tokensBefore: 90_000, tokensAfter: 12_000 });
    await until(() => !/being summarized/.test(body.textContent), "the line goes once it is done");
    const note = body.querySelector(".compaction-note");
    assert.ok(note, "the compaction stands in its round, in the chat's words");
    assert.doesNotMatch(body.textContent, /undefined/, "never rounds undefined–undefined");

    run.say({ type: "agent-notice", severity: "warning", title: "Fast mode turned off" });
    await until(() => body.querySelectorAll(".agent-notice").length === 1, "what its agent told you, on a line of its own");
    assert.match(body.querySelector(".agent-notice").textContent, /Fast mode turned off/);

    run.say({ type: "turn-state", to: "waiting", why: "the developer's answer — may it run bash `npm test`?" });
    await until(() => workingOf(body) === "Waiting for your answer: may it run bash `npm test`?", "a call that waits for you");

    run.say({ type: "round-text", round: 1, text: "The parser is fixed." }, { type: "notice", kind: "stop", text: "Stopped: you stopped it." });
    await until(() => body.querySelectorAll(".shim-note").length === 1, "Filament's note, as the chat's");
    assert.match(body.querySelector(".shim-note").textContent, /^FilamentStopped: you stopped it\.$/);
    assert.doesNotMatch(body.querySelector(".sav-text").innerHTML, /Stopped: you stopped it/, "never among its words");
    run.end();
    conv.close();
  });

  // (fails before: yes — each round whose plan changed kept its own Todo card, so the thread showed one per update)
  test("its plan is one card, at its newest list: the round that had it before draws none", async () => {
    const run = runStream();
    const row = running("sa_p3");
    serve = (url) => (url.startsWith("/api/sessions/c1/subagents/sa_p3") ? json({ subagent: row }) : url.startsWith("/api/runs/run_sa_p3/events") ? run.response() : null);
    const { conv, body } = mounted(row);
    run.say({ type: "round-start", round: 1, blocksBefore: 0 }, { type: "plan", round: 1, items: [{ text: "Map it", status: "doing" }, { text: "Fix it", status: "pending" }] });
    await until(() => body.querySelectorAll(".plan-card-body").length === 1, "its first list");
    run.say({ type: "round-start", round: 2, blocksBefore: 0 }, { type: "plan", round: 2, items: [{ text: "Map it", status: "done" }, { text: "Fix it", status: "doing" }] });
    await until(() => /1\/2/.test(body.querySelector(".plan-card-body")?.closest("details")?.textContent || ""), "its newest list");
    assert.equal(body.querySelectorAll(".plan-card-body").length, 1, "one card, not one per update");
    run.end();
    conv.close();
  });

  // (fails before: yes — its edit cards drew no change: its run keeps no snapshot, and they had no call to ask)
  test("an edit card reads its call's own change from the agent's thread", async () => {
    const run = runStream();
    const row = running("sa_p2");
    serve = (url) =>
      url.startsWith("/api/sessions/c1/subagents/sa_p2/calls/toolu_e1/change")
        ? json({ id: "toolu_e1", file: "src/a.js", patch: "--- src/a.js\n+++ src/a.js\n@@ -1,1 +1,1 @@\n-one\n+two\n", added: 1, removed: 1, wrote: false, every: false, omitted: 0 })
        : url.startsWith("/api/sessions/c1/subagents/sa_p2")
          ? json({ subagent: row })
          : url.startsWith("/api/runs/run_sa_p2/events")
            ? run.response()
            : url.startsWith("/api/runs/run_sa_p2/changes")
              ? json({ error: "no snapshots" }, 404)
              : null;
    const { conv, body } = mounted(row);
    run.say(
      { type: "round-start", round: 1, blocksBefore: 0 },
      { type: "tool-start", round: 1, id: "toolu_e1", name: "edit", args: "src/a.js", card: { kind: "edit", title: "Edit", subject: "src/a.js" } },
      { type: "tool-end", round: 1, id: "toolu_e1", name: "edit", ok: true, ms: 3, card: { kind: "edit", title: "Edit", subject: "src/a.js" } },
    );
    await until(() => asked.includes("/api/sessions/c1/subagents/sa_p2/calls/toolu_e1/change"), "its call's change, from its thread");
    await until(() => /\+1/.test(body.querySelector(".edit-counts")?.textContent || ""), "its counts under the chip");
    run.end();
    conv.close();
  });

  // (fails before: yes — the thread beside the chat drew no way to answer its call: it read "Thinking")
  test("a call that waits for you is answered in its foot where the host gives the way; the Agents tab draws its own", async () => {
    const asking = { tool: "bash", args: "npm test", question: "May it run bash `npm test`?", command: "npm test", n: 1 };
    const row = running("sa_p3", { progress: { round: 1, tool: null, context: { tokens: 12_000, window: 200_000, usable: 170_000 }, compactions: [], words: "", spent: null, asking } });
    serve = (url) => (url.startsWith("/api/sessions/c1/subagents/sa_p3") ? json({ subagent: row }) : null);
    /** @type {[string, string][]} */
    const answers = [];
    const { conv, foot } = mounted(row, { answer: async (/** @type {string} */ id, /** @type {any} */ words) => (answers.push([id, words]), true), always: async () => true });
    await until(() => foot.querySelectorAll(".ask-strip").length === 1, "its ask in its foot");
    const strip = foot.querySelector(".ask-strip");
    assert.match(strip.textContent, /ScoutWants to run|Scoutwants to run/);
    assert.equal(strip.querySelector(".ask-cmd").textContent, "npm test");
    const allow = strip.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Allow");
    allow.dispatch("click");
    await until(() => answers.length === 1, "the answer sent");
    assert.deepEqual(answers, [["sa_p3", { allow: true, words: "", ask: 1 }]]);
    // The owner's of 11-12: its count, the share of its window, and where it compacts.
    // (fails before: yes — its head said "12k of 200k tokens in context": never the share it holds, never its line)
    const gauge = /** @type {any} */ (conv.head).querySelector(".sav-ctx");
    /** Its gauge as drawn: its class, the share, and the count with where it compacts. */
    const drawn = () => [gauge.className, gauge.querySelector(".sav-ctx-share")?.textContent, gauge.querySelector(".sav-ctx-more")?.textContent];
    assert.deepEqual(drawn(), ["sav-ctx", "6%", "12k of 200k · compacts at 85%"], "what it holds now and where it compacts, beside its state");
    assert.equal(gauge.getAttribute("title"), "Its context holds 12,000 tokens of its 200,000-token window (6%). It compacts at 170,000 tokens, 85% of the window: 158,000 to go.");
    assert.match(gauge.querySelector(".sav-ctx-ring").innerHTML, /class="inst-notch"/, "its ring marks the line");
    // (fails before: yes — its head read its progress only when the agent was read whole again, so the figure stood
    // still while it worked: the feed's progress never reached its thread)
    const was = asked.length;
    busSays({ type: "subagent-progress", chainId: "c1", id: "sa_other", progress: { ...row.progress, context: { tokens: 199_000, window: 200_000, usable: 170_000 } } });
    assert.equal(drawn()[1], "6%", "another agent's progress is not its own");
    busSays({ type: "subagent-progress", chainId: "c1", id: "sa_p3", progress: { ...row.progress, context: { tokens: 150_000, window: 200_000, usable: 170_000 } } });
    assert.deepEqual(drawn(), ["sav-ctx is-warn", "75%", "150k of 200k · compacts at 85%"], "its count moves as the feed says it, nearing its line");
    assert.equal(asked.length, was, "and the agent is not read again for it");
    conv.close();

    const plain = mounted(row);
    await until(() => /** @type {any} */ (plain.conv.head).querySelector(".sav-title")?.textContent === "Job sa_p3", "the other host's thread");
    assert.equal(plain.foot.querySelectorAll(".ask-strip").length, 0, "a host with its own strip gets none here");
    plain.conv.close();
  });

  // (fails before: yes — an agent at work that was no team's worker held your words until it answered)
  test("your words reach any agent at work at its next step; one you launched yourself tells nobody else", async () => {
    const row = running("sa_p4");
    /** @type {any[]} */
    const sent = [];
    serve = (url, init) => {
      if (url.startsWith("/api/sessions/c1/subagents/sa_p4/message")) {
        sent.push(JSON.parse(String(init?.body || "{}")));
        return json({ ok: true, told: null, asking: null });
      }
      return url.startsWith("/api/sessions/c1/subagents/sa_p4") ? json({ subagent: row }) : null;
    };
    /** @type {string[]} */
    const toasts = [];
    const conv = subagentConversation({ chainId: "c1", id: row.id, toast: (m) => void toasts.push(m), main: MAIN });
    open.push(conv);
    const scroll = h("div", { class: "scroll" }, conv.body);
    const host = h("div", { class: "host" }, conv.head, scroll, conv.foot);
    doc.document.body.append(host);
    conv.mount(scroll);
    const input = /** @type {any} */ (conv.foot).querySelector(".sav-input");
    await until(() => input.placeholder === "Working: what you write reaches it at its next step", "its box takes words now");
    input.value = "Use the v2 API.";
    /** @type {any} */ (conv.foot).querySelector(".sav-send").dispatch("click");
    await until(() => sent.length === 1, "into its run");
    assert.deepEqual(sent, [{ text: "Use the v2 API." }]);
    await until(() => toasts.length === 1, "its toast");
    assert.equal(toasts[0], "Sent to Scout sa_p4: it reads it at its next step");
    conv.close();
  });

  // (fails before: yes — the bug hunt of 10-30, UIC-5: the thread's box sent on the Enter that ends an input method's
  // word where the browser says it by keyCode 229 alone, as Windows' IMEs do — the chat's own box never sends on it)
  test("the Enter that ends an input method's word never sends the thread's words; the next Enter does", async () => {
    const row = running("sa_p5");
    /** @type {any[]} */
    const sent = [];
    serve = (url, init) => {
      if (url.startsWith("/api/sessions/c1/subagents/sa_p5/message")) {
        sent.push(JSON.parse(String(init?.body || "{}")));
        return json({ ok: true, told: null, asking: null });
      }
      return url.startsWith("/api/sessions/c1/subagents/sa_p5") ? json({ subagent: row }) : null;
    };
    const { foot } = mounted(row);
    const input = foot.querySelector(".sav-input");
    await until(() => input.placeholder === "Working: what you write reaches it at its next step", "its box takes words now");
    input.value = "日本語で";
    input.dispatch("keydown", { key: "Enter", shiftKey: false, isComposing: false, keyCode: 229 });
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(sent, [], "the word ended; nothing sent");
    input.dispatch("keydown", { key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 });
    await until(() => sent.length === 1, "into its run");
    assert.deepEqual(sent, [{ text: "日本語で" }]);
  });

  test("the viewer draws a round's cards with the chat's own part, pinned in its source", () => {
    const src = readFileSync(new URL("../src/ui/harness/subagent-viewer.js", import.meta.url), "utf8");
    assert.match(src, /placeChildren\(v\.tools, cell \? cardsEl\(cell, \{ live, runId: current\.runId \|\| undefined, turnAt: at, drawn: kept, asksApart: false, steers: false, ownChat: false \}\) : \[\]\);/);
    assert.match(src, /keepOutputs\(outputs, roundsBox\);/, "each command's output keeps its place");
  });
});
