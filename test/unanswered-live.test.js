// @ts-check
// A loop's question left unanswered — the person went on with a coding agent — is said once, on the footer of the turn
// that asked ("question left unanswered"). The page that stayed open said it only after a reload: the end of the
// agent's turn read the transcript's rows for that turn alone. The decision of 11-02: the open page says it as the
// agent's turn that left it ends, from the read that end already makes. The real timeline is drawn here, on the stub
// document.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {any} */
let tl;
/** @type {any} */
let host;
const g = /** @type {any} */ (globalThis);
const ADDED = ["requestAnimationFrame", "cancelAnimationFrame", "IntersectionObserver", "ResizeObserver", "getComputedStyle", "localStorage", "sessionStorage"].filter((k) => !(k in g));
const fetchWas = g.fetch;

/** The transcript's newest rows as the agent's turn ends: the turn that asked, marked; the agent's turn after it. */
const TAIL = {
  turns: [
    { n: 1, requestIds: ["rq1"], unanswered: { by: "Claude Code" } },
    { n: 2, requestIds: ["rq2"], facts: { model: "claude/haiku" } },
  ],
  boundaries: [],
};

before(async () => {
  dom = stubDocument();
  g.requestAnimationFrame ||= () => 0;
  g.cancelAnimationFrame ||= () => {};
  g.IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.getComputedStyle ||= () => ({});
  g.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
  g.sessionStorage ||= g.localStorage;
  Object.assign(g.window, { setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, getSelection: () => ({ toString: () => "", removeAllRanges() {}, rangeCount: 0 }) });
  const d = /** @type {any} */ (dom.document);
  d.addEventListener ||= () => {};
  d.removeEventListener ||= () => {};
  g.fetch = async (/** @type {string} */ url) => {
    const body = url.includes("/transcript") ? TAIL : url.includes("/requests/") ? { id: "rq2", status: "ok" } : {};
    return { ok: true, status: 200, json: async () => body };
  };
  const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
  host = document.createElement("div");
  tl = createTimeline(host, /** @type {any} */ ({ onPauseChange() {} }));
});
after(() => {
  g.fetch = fetchWas;
  for (const k of ADDED) delete g[k];
  dom.restore();
});

// (fails before: yes — the asking turn's footer said nothing at the agent's turn's end: its flags [], the mark only
// on the next reload)
test("the agent's turn that left the loop's question unanswered ends: the turn that asked says so at once", async () => {
  const asked = /** @type {any} */ ({ n: 1, history: true, past: true, status: "done", requestId: "rq1", userText: "run the check", blocks: [{ type: "text", text: "May I run this command?" }], steers: [], segments: [] });
  const agentTurn = /** @type {any} */ ({ n: 2, status: "streaming", past: false, requestId: "rq2", userText: "do it your way", blocks: [], steers: [], segments: [], startedAt: Date.now() });
  const live = /** @type {any} */ ({ turn: agentTurn, reply: { blocks: [{ type: "text", text: "Done my way." }], tailClosed: false }, blockHandles: [] });
  const chat = { chainId: "c1", turns: [asked, agentTurn], live };
  live.chat = chat;
  tl.render(chat);
  tl.startLive(live);
  const footOf = () => [...host.querySelectorAll(".a-flag")].map((/** @type {any} */ f) => f.textContent);
  assert.deepEqual(footOf().filter((/** @type {string} */ t) => t === "question left unanswered"), [], "not yet");
  await tl.finish(live, "done");
  assert.deepEqual(asked.unanswered, { by: "Claude Code" }, "the turn that asked holds the mark");
  assert.deepEqual(footOf().filter((/** @type {string} */ t) => t === "question left unanswered"), ["question left unanswered"], "its footer says it, once");
});

// (fails before: yes — a read of the chat kept the page's own copy of the turn that asked without the server's mark:
// unanswered undefined, until a reload drew the server's copy)
test("a read of the chat gives the page's own copy of the turn that asked the server's mark: left in another tab too", async () => {
  const { mergedTurns } = await import("../src/ui/harness/conversation/history.js");
  const mine = { n: 1, status: "done", requestId: "rq1", boundaries: [], boundariesAfter: [] };
  const server = { n: 1, past: true, history: true, status: "done", requestId: "rq1", requestIds: ["rq1"], unanswered: { by: "Claude Code" }, boundaries: [], boundariesAfter: [] };
  const [kept] = mergedTurns([mine], [server]);
  assert.equal(kept, mine, "the page keeps its own copy");
  assert.deepEqual(/** @type {any} */ (kept).unanswered, { by: "Claude Code" });
});
