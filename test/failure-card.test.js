// @ts-check
// HarnessV4_Tasks U1 — one failure card everywhere (HarnessV3-FailurePoints §5.2, §14.2, §14.3). Before it the page
// drew a failure five ways: a banner in the chat, an "Error" paragraph in a sub-agent's tool card, a red line in its
// own view, a clamped red report line on its Team card and a paragraph in the Plan view's detail — each the failure's
// one long line whole, and none with what a coding agent said under it once the page was reloaded. Now a failure made
// in the one shape carries its words in two parts (the cause; what it had done and what is kept), every door that
// carries the shape carries them, and one card draws them on all five surfaces.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { failureLine, failureParts, keptRounds, worded } from "../src/core/failure.js";
import { foldTurnFacts } from "../src/core/turn-facts.js";
import { createAgentReply } from "../src/app/acp-wire.js";
import { failureCard, failureWords, saidUnder } from "../src/ui/harness/lib/failure.js";
import { createAnthropicAccumulator } from "../src/ui/harness/lib/stream.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { turnsRead } from "./helpers/held-transcript.js";
import { errorBanner } from "../src/ui/harness/conversation/interaction.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {import("../src/core/failure.js").Failure} */
const CUT = { what: "round 2's model call", where: "glm-5.3-flash at zai", said: "the connection was reset", code: "ECONNRESET", status: null, tries: null, began: 0, at: 600_000, streamed: { thinking: 44_000, text: 0 }, kept: keptRounds(2), next: null };
const HEAD = "round 2's model call to glm-5.3-flash at zai failed after 10 min: the connection was reset (ECONNRESET).";
const MORE = "It had streamed about 11,000 tokens of thinking. 1 finished round is kept.";
/** The first element carrying a class, or undefined. @param {any} el @param {string} cls */
const one = (el, cls) => el.querySelector(`.${cls}`) || undefined;

describe("the server says a failure's words in two parts", () => {
  // (fails before: yes — a failure had its one line and its fields: a page that wanted the cause apart from the rest
  // had to compose the line again, or cut it)
  test("failureParts: the cause in one line, then what it had done and what comes of it; the line is the two; `worded` puts them on the shape", () => {
    assert.deepEqual(failureParts(CUT), { head: HEAD, more: MORE });
    assert.equal(failureLine(CUT), `${HEAD} ${MORE}`);
    const quick = { ...CUT, said: "HTTP 502", code: null, status: 502, began: null, streamed: null, kept: null };
    assert.deepEqual(failureParts(quick), { head: "round 2's model call to glm-5.3-flash at zai failed: HTTP 502.", more: "" });
    assert.equal(failureLine(quick), "round 2's model call to glm-5.3-flash at zai failed: HTTP 502.", "nothing more: no trailing space");
    assert.deepEqual(failureParts({ ...quick, next: "retrying in 20 s" }).more, "Retrying in 20 s.");
    assert.deepEqual(worded(CUT), { ...CUT, head: HEAD, more: MORE });
    const loop = readFileSync("src/app/agent/loop.js", "utf8");
    assert.equal(loop.split("const failure = worded({").length - 1, 2, "both places a turn's failure is made");
    assert.doesNotMatch(loop, /const failure = \{ what:/);
  });

  // (fails before: yes — a failed turn's reply said its message alone, in a stream's error event and in a 502's body)
  test("a failed turn's reply carries the two parts beside its message, and a sub-agent's end event its failure's", () => {
    /** @param {"anthropic" | "openai"} format */
    const ended = (format) => {
      /** @type {(() => void)[]} the writer's own clean-up (its heartbeat), run at the end as a response's close does */
      const closers = [];
      const res = { body: "", writableEnded: false, headersSent: false, setHeader() {}, writeHead() {}, flushHeaders() {}, write(/** @type {string} */ s) { res.body += s; return true; }, end(/** @type {string} */ s) { if (s) res.body += s; res.writableEnded = true; for (const f of closers) f(); }, on(/** @type {string} */ ev, /** @type {() => void} */ f) { if (ev === "close") closers.push(f); } };
      const wire = createAgentReply({ res: /** @type {any} */ (res), format, model: "m", requestId: "r1", upstreamId: "u", stream: true, heartbeatMs: 60_000, pacingMs: 0, onFirstByte: () => {}, idPrefix: "agent" });
      wire.endWithError(`${HEAD} ${MORE}`, null, { head: HEAD, more: MORE });
      const data = res.body.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]").map((l) => JSON.parse(l.slice(6)));
      return data.find((j) => j.error)?.error;
    };
    assert.deepEqual(ended("anthropic"), { type: "api_error", message: `${HEAD} ${MORE}`, failure: { head: HEAD, more: MORE } });
    assert.deepEqual(ended("openai"), { message: `${HEAD} ${MORE}`, type: "server_error", failure: { head: HEAD, more: MORE } });
    const turn = readFileSync("src/app/agent/turn.js", "utf8");
    assert.match(turn, /return failWith\(out\.error \|\| "agent loop failed", "error", \{ input: t\.firstIn, output: t\.totalOut \}, out\.failure \?\? null\);/);
    assert.match(turn, /const parts = failure\?\.head \? \{ head: failure\.head, more: failure\.more \|\| "" \} : null;\n\s*if \(!res\.writableEnded\) \{\n\s*if \(reply\.headersSent\) reply\.endWithError\(message, null, parts\);\n\s*else \{\n\s*const body = errorBody\(format, status, message\);\n\s*sendJson\(res, status, parts \? \{ \.\.\.body, error: \{ \.\.\.body\.error, failure: parts \} \} : body,/);
    assert.match(readFileSync("src/app/agent/subagents.js", "utf8"), /type: "subagent-end", agentId: sa\.id,[^\n]*\.\.\.\(o\.failure\?\.head \? \{ failure: \{ head: o\.failure\.head, more: o\.failure\.more \|\| "" \} \} : \{\}\) \}\);/);
  });

  // (fails before: yes — a coding agent's own error rode the failed reply alone: a reloaded turn had its headline and
  // nothing under it)
  test("a turn's facts keep what its newest failure said under its words, cut; a request that ends well clears it", () => {
    /** @param {Record<string, any>} o */
    const rec = (o) => ({ id: `r${o.start}`, ts: new Date(o.start).toISOString(), totalMs: 100, status: "ok", stopReason: "end_turn", model: "m", upstream: "claude-code", tokens: { input: 10, output: 1 }, ...o });
    let f = foldTurnFacts(null, rec({ start: 1000, status: "error", error: "Claude's adapter exited (code 1) while opening its session", errorDetail: `Error: ENOENT\n${"x".repeat(5000)}` }), { own: true });
    assert.deepEqual([f.error, f.errorDetail.length, f.errorDetail.slice(0, 14)], ["Claude's adapter exited (code 1) while opening its session", 4000, "Error: ENOENT\n"]);
    assert.equal(foldTurnFacts(null, rec({ start: 1000, status: "error", error: "HTTP 502" }), { own: true }).errorDetail, null, "nothing was said under it");
    f = foldTurnFacts(f, rec({ start: 3000 }), { own: true });
    assert.deepEqual([f.error, f.errorDetail], [null, null]);
  });
});

describe("the page's failure card", () => {
  test("failureWords: the shape's two parts where the server sent them, else the line whole — the cause on one line either way", () => {
    assert.deepEqual(failureWords({ error: `${HEAD} ${MORE}`, failure: { head: HEAD, more: MORE }, detail: "stderr…", repeat: "t6 failed the same way 3 times in a row" }), { head: HEAD, more: MORE, repeat: "t6 failed the same way 3 times in a row", detail: "stderr…" });
    assert.deepEqual(failureWords({ error: "its review still asked for changes:\n  take a lone comma" }), { head: "its review still asked for changes: take a lone comma", more: "", repeat: "", detail: "" });
    assert.deepEqual(failureWords({ error: "the line", failure: { more: "parts with no cause are no parts" } }), { head: "the line", more: "", repeat: "", detail: "" });
    assert.deepEqual(failureWords({ error: null, failure: null, detail: null, repeat: null }), { head: "", more: "", repeat: "", detail: "" });
  });

  test("saidUnder: a failed reply's parts and the agent's own error, off its body, in either wire's shape", () => {
    assert.deepEqual(saidUnder({ type: "error", error: { type: "api_error", message: "m", failure: { head: HEAD, more: MORE }, detail: "Error: ENOENT" } }), { failure: { head: HEAD, more: MORE }, detail: "Error: ENOENT" });
    assert.deepEqual(saidUnder({ error: { message: "m", failure: { head: HEAD } } }), { failure: { head: HEAD, more: "" }, detail: "" });
    assert.deepEqual(saidUnder({ error: "a bare string" }), { failure: null, detail: "" });
    assert.deepEqual(saidUnder(null), { failure: null, detail: "" });
  });

  test("the card: the cause, what it had done under it, the repeat called out; the fold only where something was said under it; the surface's ways on after the card's own", () => {
    /** @type {string[]} */
    const copied = [];
    let sent = 0;
    const card = failureCard(fakeH, failureWords({ error: "x", failure: { head: HEAD, more: MORE }, detail: "Error: ENOENT", repeat: "t6 failed the same way 3 times in a row" }), {
      acts: [fakeH("button", { class: "tg-act", onclick: () => { sent++; } }, "Send back")],
      onCopy: (text) => copied.push(text),
    });
    assert.equal(card.attrs.class, "ix-error");
    assert.deepEqual(["ix-error-msg", "ix-error-more", "ix-error-repeat"].map((c) => textOf(one(card, c))), [HEAD, MORE, "t6 failed the same way 3 times in a row"]);
    assert.deepEqual(card.kids.map((/** @type {any} */ k) => k.attrs.class), ["ix-error-main", "ix-error-acts", "ix-detail hidden"], "the words, the buttons, the fold");
    assert.deepEqual(buttonsOf(card).map(textOf), ["Show details", "Copy", "Send back"]);
    const [toggle, copy, back] = buttonsOf(card);
    const detail = one(card, "ix-detail");
    assert.equal(textOf(detail), "Error: ENOENT");
    toggle.dispatch("click");
    assert.deepEqual([detail.classList.contains("hidden"), textOf(toggle)], [false, "Hide details"]);
    toggle.dispatch("click");
    assert.deepEqual([detail.classList.contains("hidden"), textOf(toggle)], [true, "Show details"]);
    copy.dispatch("click");
    assert.deepEqual(copied, [`${HEAD}\n\n${MORE}\n\nt6 failed the same way 3 times in a row\n\nError: ENOENT`]);
    back.dispatch("click");
    assert.equal(sent, 1);
    // Bare: a cause and nothing else — no buttons row, no fold; inset, at the size of the card it sits in.
    const bare = failureCard(fakeH, failureWords({ error: "it hit its window" }), { inset: true });
    assert.deepEqual([bare.attrs.class, bare.kids.map((/** @type {any} */ k) => k.attrs.class), textOf(bare)], ["ix-error is-inset", ["ix-error-main"], "it hit its window"]);
  });
});

describe("the card on its surfaces", () => {
  // (fails before: yes — a stream's error kept the event as JSON for the fold, the agent's own error an escaped string
  // inside it, and no word of the failure's parts)
  test("a reply that fails keeps its failure's parts, and under them the agent's own error where one came, else the event", () => {
    const shaped = createAnthropicAccumulator();
    shaped.push({ type: "error", error: { type: "api_error", message: `${HEAD} ${MORE}`, failure: { head: HEAD, more: MORE } } });
    assert.deepEqual([shaped.reply.error, shaped.reply.failure], [`${HEAD} ${MORE}`, { head: HEAD, more: MORE }]);
    assert.match(String(shaped.reply.errorDetail), /^\{\n {2}"type": "error"/, "no agent's error: the event as it came");
    const agent = createAnthropicAccumulator();
    agent.push({ type: "error", error: { type: "api_error", message: "Claude's adapter exited (code 1) during the turn", detail: "Error: ENOENT\n    at spawn" } });
    assert.deepEqual([agent.reply.error, agent.reply.failure, agent.reply.errorDetail], ["Claude's adapter exited (code 1) during the turn", null, "Error: ENOENT\n    at spawn"]);
    const api = readFileSync("src/ui/harness/lib/api.js", "utf8");
    assert.match(api, /const under = saidUnder\(j\);\n\s*acc\.reply\.error = [^\n]*\n\s*acc\.reply\.failure = under\.failure;\n[^\n]*\n\s*acc\.reply\.errorDetail = under\.detail \? under\.detail\.slice\(0, 4000\) : `HTTP \$\{res\.status\}/, "a 502's body, read the same way");
  });

  test("the chat's banner is the card: the cause apart from the rest, the fold where something was said under it, its ways on", () => {
    const doc = stubDocument();
    try {
      /** @type {any} */
      const el = errorBanner(`${HEAD} ${MORE}`, { failure: { head: HEAD, more: MORE }, detail: "the body", onRetry: () => {}, onDismiss: () => {} });
      assert.deepEqual([el.className, el.querySelector(".ix-error-msg").textContent, el.querySelector(".ix-error-more").textContent, el.querySelector(".ix-detail").textContent], ["ix-error", HEAD, MORE, "the body"]);
      assert.deepEqual(el.querySelectorAll("button").map((/** @type {any} */ b) => b.textContent), ["Show details", "Copy", "Retry", "Dismiss"]);
      /** @type {any} */
      const plain = errorBanner("the provider refused the request", { onRetry: () => {} });
      assert.deepEqual([plain.querySelector(".ix-error-msg").textContent, plain.querySelector(".ix-error-more"), plain.querySelector(".ix-detail")], ["the provider refused the request", null, null]);
    } finally {
      doc.restore();
    }
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.equal(timeline.split("errorBanner(w.message, { detail: w.detail, failure: w.failure,").length - 1, 2, "the live turn's banner and a redrawn one's");
    assert.match(timeline, /: \{ message: turn\.error, detail, failure: turn\.reply\?\.failure \|\| turn\.failure \|\| null \};/);
    assert.match(timeline, /\? \{ \.\.\.signedOutBanner\([^\n]*\), failure: null \}/, "a signed-out turn's words are a person's: no parts of the agent's line");
    assert.match(timeline, /const w = bannerWords\(turn, turn\.errorDetail \|\| ""\);/, "a redrawn turn's fold: what its facts kept");
  });

  // (fails before: yes — a reloaded failed turn had its one line: no parts, nothing under it, and the words its
  // failing round had said were gone from the page)
  test("a reloaded turn that failed: its parts, what was said under it, and the words its failing round had said, as its last", () => {
    const user = { role: "user", content: [{ type: "text", text: "fix it" }] };
    const work = [{ role: "assistant", content: [{ type: "text", text: "Reading the parser." }, { type: "tool_use", id: "t1", name: "read", input: { path: "a.js" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "…" }] }];
    const row = (/** @type {Record<string, any>} */ o) => ({ n: 4, turnId: 4, requestIds: ["r4"], user, work, final: null, open: true, ...o });
    const [t] = turnsRead({ turns: [row({ facts: { error: `${HEAD} ${MORE}`, errorDetail: "Error: ENOENT" }, failed: { at: 1, cause: `${HEAD} ${MORE}`, text: "The comma is taken in", failure: { ...CUT, head: HEAD, more: MORE } } })] });
    assert.deepEqual([t.status, t.error, t.failure, t.errorDetail], ["error", `${HEAD} ${MORE}`, { head: HEAD, more: MORE }, "Error: ENOENT"]);
    assert.deepEqual(t.blocks.filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text), ["Reading the parser.", "The comma is taken in"]);
    const [bare] = turnsRead({ turns: [row({ facts: { error: "HTTP 502" } })] });
    assert.deepEqual([bare.status, bare.failure, bare.errorDetail, bare.blocks.filter((/** @type {any} */ b) => b.type === "text").length], ["error", undefined, undefined, 1]);
    const [open] = turnsRead({ turns: [row({ failed: { at: 1, cause: "x", text: "words", failure: { head: HEAD, more: MORE } } })] });
    assert.deepEqual([open.status, open.failure], ["open", undefined], "a turn the facts do not call failed is not drawn failed");
  });

  // (fails before: yes — a sub-agent's failure in its call's card was an "Error" paragraph, its line whole)
  test("a sub-agent's tool card and its own view draw the card, with the parts its end event or the session's list gave", () => {
    const doc = stubDocument();
    try {
      const events = [
        { type: "tool-start", round: 1, id: "a1", name: "agent", args: "Map the parser" },
        { type: "subagent-start", round: 1, parent: "a1", agentId: "sa_1", description: "Map the parser", agent: "scout", card: { tag: "scout", name: "Scout" }, model: "glm-5.3", exchange: 0 },
        { type: "subagent-end", round: 1, parent: "a1", agentId: "sa_1", status: "failed", ok: false, ms: 600_000, rounds: 2, tokensIn: 10, tokensOut: 5, error: `${HEAD} ${MORE}`, failure: { head: HEAD, more: MORE } },
        { type: "tool-end", round: 1, id: "a1", ok: false },
      ];
      const al = alignEvents(events);
      assert.deepEqual(al.byRound.get(1)?.tools.get("a1").sub.failure, { head: HEAD, more: MORE });
      /** @type {any} */
      const el = roundRows(al.byRound.get(1))[0];
      const card = el.querySelector(".sub-card .ix-error");
      assert.deepEqual([card.className, card.querySelector(".ix-error-msg").textContent, card.querySelector(".ix-error-more").textContent, card.querySelectorAll("button").length], ["ix-error is-inset", HEAD, MORE, 0]);
      assert.equal(el.querySelectorAll(".sub-label").some((/** @type {any} */ l) => l.textContent === "Error"), false, "the card is its own label");
      /** @type {any} */
      const plain = roundRows(alignEvents(events.map((e) => (e.type === "subagent-end" ? { ...e, failure: undefined } : e))).byRound.get(1))[0];
      assert.deepEqual([plain.querySelector(".ix-error-msg").textContent, plain.querySelector(".ix-error-more")], [`${HEAD} ${MORE}`, null], "an end with no parts: its line whole, as the cause");
    } finally {
      doc.restore();
    }
    assert.match(readFileSync("src/ui/harness/subagent-viewer.js", "utf8"), /current\.error \? failureCard\(h, failureWords\(\{ error: current\.error, failure: current\.failure \}\), \{ inset: true \}\) : null\]\);/);
  });
});
