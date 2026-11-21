// @ts-check
// HarnessV3-ACP AC2-4 on the page: a coding agent's question drawn in the dock and answered on its run — questions one
// at a time on the number keys, the person's words (a whole number checked, a secret masked), a plan accepted or
// rejected with words, Claude's plan answered with one of its own ways on (AC3-3), a link opened or declined, and a
// permission the session's switch asks about as the loop's card (AC3-2) — and the run's questions aligned onto the
// turn: those that wait, the card that keeps the answer, the live words and the turn's line.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { agentAskBlock } from "../src/ui/harness/conversation/agent-ask.js";
import { createDecisions } from "../src/ui/harness/conversation/decisions.js";
import { alignEvents, askWaitWords, callWords, liveWords, planBody } from "../src/ui/harness/lib/labels.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { fromAgentPlan, fromCodexQuestion, fromCursorPlan, fromCursorQuestion, fromElicitation, fromJudged } from "../src/adapters/agents/asks.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { stubDocument } from "./helpers/dom-stub.js";

/** The run's `ask` event for a form. @param {any} form @param {string} [id] */
const askOf = (form, id = "q1") => ({ type: "ask", round: 1, id, runId: "run_1", kind: form.kind === "plan" ? "proposal" : form.kind, waits: true, form });
/** Claude's ways on from its plan, as claude-agent-acp 0.76 offers them with bypassPermissions its own elevated mode. */
const CLAUDE_PLAN = [
  { optionId: "exit-plan-clear-bypass", name: "Yes, clear context (12% used) and bypass permissions", kind: "allow_always" },
  { optionId: "exit-plan-bypass", name: "Yes, and bypass permissions", kind: "allow_always" },
  { optionId: "exit-plan-default", name: "Yes, manually approve edits", kind: "allow_once" },
  { optionId: "reject", name: "No, keep planning", kind: "reject_once" },
];
/**
 * A block over a recording run: what it was sent, the plans answered with a way on, and the links it opened.
 * @param {any} form @param {string[]} [refusals]  what the run says to each answer in turn ("" takes it)
 * @param {string} [mode]  the session's permission switch
 */
function block(form, refusals = [], mode = "ask") {
  /** @type {any[]} */
  const sent = [];
  /** @type {any[]} */
  const planned = [];
  /** @type {string[]} */
  const opened = [];
  const el = agentAskBlock(fakeH, askOf(form), {
    answer: async (a) => (sent.push(a), refusals.shift() ?? ""),
    plan: async (x) => (planned.push(x), refusals.shift() ?? ""),
    open: (u) => void opened.push(u),
    mode,
  });
  return { el, sent, planned, opened };
}
/** The button that says these words. @param {any} el @param {string} words */
const button = (el, words) => /** @type {any} */ (buttonsOf(el).find((b) => textOf(b) === words));
/** The choices on show. @param {any} el */
const rows = (el) => buttonsOf(el).filter((b) => String(b.attrs.class).split(" ").includes("ix-option"));
/** Whether every control waits. @param {any} el */
const down = (el) => buttonsOf(el).every((b) => "disabled" in b.attrs);
const settled = () => new Promise((r) => setImmediate(r));
/** @param {any} parent @param {any[]} wanted */
const place = (parent, wanted) => parent.replaceChildren(...wanted);

describe("a coding agent's question in the dock (AC2-4)", () => {
  test("questions one at a time: which of how many, the number keys, several as boxes, Back; Send sends them all", async () => {
    const form = fromCursorQuestion({
      title: "Setup",
      questions: [
        { id: "db", prompt: "Which database?", options: [{ id: "pg", label: "Postgres" }, { id: "lite", label: "SQLite" }] },
        { id: "extras", prompt: "Which extras?", options: [{ id: "auth", label: "Auth" }, { id: "jobs", label: "Jobs" }], allowMultiple: true },
      ],
    }, { agent: "Cursor" });
    const b = block(form);
    assert.match(textOf(b.el), /^Cursor asks\|1 of 2\|Setup\|Which database\?\|1\|Postgres\|2\|SQLite\|1–2 to choose · Enter to go on\|/);
    b.el.dispatch("keydown", { key: "2" });
    assert.match(textOf(b.el), /2 of 2\|Setup\|Which extras\?/, "a single choice on its key moves on");
    b.el.dispatch("keydown", { key: "1" });
    b.el.dispatch("keydown", { key: "2" });
    assert.deepEqual(rows(b.el).map((r) => [r.attrs.role, r.classList.contains("on")]), [["checkbox", true], ["checkbox", true]], "several, each a box");
    button(b.el, "Back").dispatch("click");
    assert.deepEqual(rows(b.el).map((r) => [textOf(r), r.classList.contains("on")]), [["1|Postgres", false], ["2|SQLite", true]], "the choice kept");
    b.el.dispatch("keydown", { key: "Enter" });
    button(b.el, "Send").dispatch("click");
    await settled();
    assert.deepEqual(b.sent, [{ outcome: "answered", answers: { db: { chosen: ["lite"] }, extras: { chosen: ["auth", "jobs"] } } }]);
    assert.ok(down(b.el), "taken: its controls stay down until it leaves the dock");
  });

  test("the person's words where a question takes them: a whole number checked, a new line in a box; Skip answers none", async () => {
    const deploy = fromElicitation({
      mode: "form",
      message: "Set up the deploy",
      requestedSchema: { type: "object", required: ["replicas"], properties: { replicas: { type: "integer", title: "Replicas", description: "How many?" }, note: { type: "string", title: "Note" } } },
    }, { agent: "Claude" });
    const b = block(deploy);
    const field = () => /** @type {any} */ (b.el.querySelector(".ax-words"));
    assert.deepEqual([field().tag, field().attrs.inputmode, field().attrs.type], ["input", "numeric", "text"]);
    b.el.dispatch("keydown", { key: "Enter" });
    assert.match(textOf(b.el), /This one needs an answer\./);
    field().value = "2.5";
    b.el.dispatch("keydown", { key: "Enter" });
    assert.match(textOf(b.el), /This one takes a whole number\./);
    field().value = "3";
    b.el.dispatch("keydown", { key: "Enter" });
    assert.match(textOf(b.el), /2 of 2/);
    assert.equal(field().tag, "textarea");
    b.el.dispatch("keydown", { key: "Enter", target: { tagName: "TEXTAREA" } });
    assert.equal(b.sent.length, 0, "Enter is a new line in its box");
    b.el.dispatch("keydown", { key: "Enter", ctrlKey: true, target: { tagName: "TEXTAREA" } });
    await settled();
    assert.deepEqual(b.sent, [{ outcome: "answered", answers: { replicas: { chosen: [], words: "3" } } }]);
    const token = block(fromCodexQuestion({ questions: [{ id: "token", header: "Token", question: "Your API token?", isSecret: true }] }, { agent: "Codex" }));
    assert.equal(/** @type {any} */ (token.el.querySelector(".ax-words")).attrs.type, "password", "a secret, masked");
    button(token.el, "Skip").dispatch("click");
    await settled();
    assert.deepEqual(token.sent, [{ outcome: "skipped" }]);
  });

  test("a plan, whole: its name, overview, plan and to-dos; accepted, or rejected with the person's words", async () => {
    const form = fromCursorPlan({
      name: "Add auth",
      overview: "Sessions, then a login page",
      plan: "# Auth\n1. Sessions",
      todos: [{ id: "t1", content: "Sessions", status: "completed" }, { id: "t2", content: "A login page", status: "pending" }],
    }, { agent: "Cursor" });
    const b = block(form);
    const text = textOf(b.el);
    for (const words of ["Cursor proposes a plan", "Add auth", "Sessions, then a login page", "A login page", "Cursor waits for your decision"]) assert.ok(text.includes(words), words);
    assert.match(String(/** @type {any} */ (b.el.querySelector(".ax-plan-text")).innerHTML), /Auth/);
    assert.ok(/** @type {any} */ (b.el.querySelector(".ax-todo")).classList.contains("is-done"));
    button(b.el, "Reject").dispatch("click");
    const why = /** @type {any} */ (b.el.querySelector(".ax-words"));
    assert.equal(why.classList.contains("hidden"), false, "Reject opens a line for why");
    assert.deepEqual(buttonsOf(b.el).map(textOf), ["Cancel", "Reject"]);
    why.value = "Smaller steps first";
    button(b.el, "Reject").dispatch("click");
    await settled();
    assert.deepEqual(b.sent, [{ outcome: "rejected", reason: "Smaller steps first" }]);
    const yes = block(form);
    button(yes.el, "Accept").dispatch("click");
    await settled();
    assert.deepEqual(yes.sent, [{ outcome: "accepted" }]);
  });

  test("a plan's first heading that only says its name isn't drawn twice; its to-dos stand under their caption", () => {
    const form = fromCursorPlan({ name: "Add auth", plan: "## add AUTH\n\n1. Sessions", todos: [{ id: "t1", content: "Sessions", status: "pending" }] }, { agent: "Cursor" });
    const b = block(form);
    const html = String(/** @type {any} */ (b.el.querySelector(".ax-plan-text")).innerHTML);
    assert.doesNotMatch(html, /auth/i, "the name stands once, over the plan");
    assert.match(html, /Sessions/);
    assert.equal(textOf(b.el.querySelector(".ax-todos-head")), "To-dos · 1");
    const bare = block(fromCursorPlan({ name: "Add auth", plan: "# Add auth" }, { agent: "Cursor" }));
    assert.ok(!bare.el.querySelector(".ax-plan"), "a plan that is only its heading draws no empty well");
  });

  test("planBody: a plan's first heading goes only where it says the plan's name", () => {
    assert.equal(planBody({ name: "Add auth", text: "# Add auth\n\n1. Sessions" }), "1. Sessions");
    assert.equal(planBody({ name: "Add auth", text: "# Auth\n1. Sessions" }), "# Auth\n1. Sessions", "another heading stays");
    assert.equal(planBody({ name: "Add auth", text: "Intro\n# Add auth" }), "Intro\n# Add auth", "only the first line");
    assert.equal(planBody({ name: "", text: "# Add auth" }), "# Add auth", "no name, nothing repeated");
    assert.equal(planBody({ name: "Add auth", text: "# Add auth" }), "");
    assert.equal(planBody(null), "");
  });

  test("a link: its address whole before anything opens; Open opens it in a new tab, Decline goes on without it", async () => {
    const url = "https://auth.example.com/login?next=%2Fdocs";
    const form = fromElicitation({ mode: "url", sessionId: "s1", message: "Sign in to the docs server", url, elicitationId: "el_1" }, { agent: "Claude" });
    const b = block(form);
    assert.equal(textOf(b.el.querySelector(".ax-url")), url);
    assert.match(textOf(b.el), /Claude asks you to open a link\|Sign in to the docs server\|.*Opens auth\.example\.com in a new tab/);
    button(b.el, "Open").dispatch("click");
    await settled();
    assert.deepEqual([b.opened, b.sent], [[url], [{ outcome: "accepted" }]]);
    const no = block(form);
    button(no.el, "Decline").dispatch("click");
    await settled();
    assert.deepEqual([no.opened, no.sent], [[], [{ outcome: "declined" }]]);
  });

  test("Claude's plan: the plan whole, then its ways on — its plain yes chosen, the keys choose, the button says it; keep planning takes words", async () => {
    const form = fromAgentPlan({ title: "Ready to code?", plan: "# Plan\n1. Clean the build", call: "ce1", agent: "Claude", options: CLAUDE_PLAN });
    const b = block(form);
    assert.match(textOf(b.el), /^Claude proposes a plan\|Ready to code\?\|1\|Yes, build it\|Claude leaves plan mode and starts on it\|2\|Yes, in a fresh context\|Claude starts on it with only the plan in its context — 12% of it is used now\|3\|No, keep planning\|Claude stays in plan mode: say what to change\|/);
    assert.ok(b.el.querySelector(".ax-plan-text"), "the plan whole, over its ways on");
    assert.deepEqual(rows(b.el).map((r) => r.classList.contains("on")), [true, false, false], "its plain yes chosen first");
    assert.ok(button(b.el, "Yes, build it"), "the answer says the choice");
    const words = /** @type {any} */ (b.el.querySelector(".ax-words"));
    assert.equal(words.classList.contains("hidden"), true, "a yes takes no words");
    b.el.dispatch("keydown", { key: "3" });
    assert.deepEqual([words.classList.contains("hidden"), !!button(b.el, "No, keep planning")], [false, true], "keep planning takes words");
    assert.match(textOf(b.el), /↑↓ or 1–3 to choose · Ctrl\+Enter to answer/);
    words.value = " Use SQLite ";
    words.dispatch("keydown", { key: "Enter", ctrlKey: true });
    await settled();
    assert.deepEqual([b.planned, b.sent], [[{ choice: "reject", words: "Use SQLite" }], []]);
    assert.ok(down(b.el), "held once the run took it");
    const fresh = block(form);
    // (fails before: no — a guard the mutation pass asked for: no words were typed before a yes was chosen)
    fresh.el.dispatch("keydown", { key: "3" });
    /** @type {any} */ (fresh.el.querySelector(".ax-words")).value = "Use SQLite";
    fresh.el.dispatch("keydown", { key: "ArrowUp" });
    fresh.el.dispatch("keydown", { key: "Enter" });
    await settled();
    assert.deepEqual(fresh.planned, [{ choice: "exit-plan-clear-bypass", words: "" }], "a yes sends no words, though the box held some");
  });

  test("under Read-only a yes to the plan says the switch moves to Ask before changes; keeping it planning moves nothing", () => {
    const form = fromAgentPlan({ title: "Ready to code?", plan: "# Plan", agent: "Claude", options: CLAUDE_PLAN });
    const ro = block(form, [], "read-only");
    const lift = /** @type {any} */ (ro.el.querySelector(".ax-detail"));
    assert.deepEqual([textOf(lift), lift.classList.contains("hidden")], ["Read-only would refuse its edits: a yes moves the switch to Ask before changes.", false]);
    ro.el.dispatch("keydown", { key: "3" });
    assert.equal(lift.classList.contains("hidden"), true);
    assert.equal(/** @type {any} */ (block(form).el.querySelector(".ax-detail")).classList.contains("hidden"), true, "under Ask, nothing moves");
  });

  test("an answer the run refuses gives the block back with the run's words; one it takes holds it", async () => {
    const form = fromCursorQuestion({ questions: [{ id: "db", prompt: "Which database?", options: [{ id: "pg", label: "Postgres" }, { id: "lite", label: "SQLite" }] }] }, { agent: "Cursor" });
    const b = block(form, ["that question is no longer waiting for an answer"]);
    b.el.dispatch("keydown", { key: "1" });
    assert.equal(b.sent.length, 0, "the last question's key chooses, and never sends");
    b.el.dispatch("keydown", { key: "Enter" });
    await settled();
    assert.equal(textOf(b.el.querySelector(".ax-err")), "that question is no longer waiting for an answer");
    assert.ok(buttonsOf(b.el).every((x) => !("disabled" in x.attrs)), "given back");
    b.el.dispatch("keydown", { key: "Enter" });
    await settled();
    assert.deepEqual([b.sent.length, textOf(b.el.querySelector(".ax-err")), down(b.el)], [2, "", true]);
  });

  // (fails before: no — a guard the mutation pass asked for: no form drew a default, a lone question with the form's
  // own words, a choice changed or taken back, the first of several questions' buttons, or words to send by Ctrl+Enter)
  test("a form's default chosen; one choice replaces another, a box unticks; Next and no Back first; Ctrl+Enter for words", () => {
    const space = fromElicitation({ mode: "form", message: "Which space?", requestedSchema: { properties: { space: { type: "string", enum: ["eng", "ops"], default: "ops" } } } }, { agent: "Claude" });
    const b = block(space);
    assert.equal(textOf(b.el).split("Which space?").length, 2, "the lone question's words, once");
    assert.deepEqual(rows(b.el).map((r) => r.classList.contains("on")), [false, true], "its default chosen");
    b.el.dispatch("keydown", { key: "1" });
    assert.deepEqual(rows(b.el).map((r) => r.classList.contains("on")), [true, false], "one choice replaces the other");
    const extras = block(fromCursorQuestion({ questions: [{ id: "x", prompt: "Which extras?", options: [{ id: "auth", label: "Auth" }], allowMultiple: true }] }, { agent: "Cursor" }));
    extras.el.dispatch("keydown", { key: "1" });
    extras.el.dispatch("keydown", { key: "1" });
    assert.deepEqual(rows(extras.el).map((r) => r.classList.contains("on")), [false], "a box ticked again unticks");
    const two = block(fromCursorQuestion({
      questions: [
        { id: "db", prompt: "Which database?", options: [{ id: "pg", label: "Postgres" }] },
        { id: "ci", prompt: "Which CI?", options: [{ id: "gh", label: "GitHub" }] },
      ],
    }, { agent: "Cursor" }));
    assert.ok(button(two.el, "Next") && button(two.el, "Back").classList.contains("hidden"), "the first of two: Next, no Back");
    const why = block(fromCodexQuestion({ itemId: "i", questions: [{ id: "why", header: "Why", question: "Why now?" }] }, { agent: "Codex" }));
    assert.match(textOf(why.el), /Ctrl\+Enter to /);
  });

  // (fails before: no — a guard the mutation pass asked for: no rejection's words were sent by Ctrl+Enter, or left by
  // Escape)
  test("a plan's rejection: Ctrl+Enter in its words rejects; Escape goes back to the answers", async () => {
    const form = fromCursorPlan({ name: "Add auth", overview: "Sessions" }, { agent: "Cursor" });
    const b = block(form);
    button(b.el, "Reject").dispatch("click");
    const why = /** @type {any} */ (b.el.querySelector(".ax-words"));
    why.value = "Smaller steps first";
    why.dispatch("keydown", { key: "Enter", ctrlKey: true });
    await settled();
    assert.deepEqual(b.sent, [{ outcome: "rejected", reason: "Smaller steps first" }]);
    const back = block(form);
    button(back.el, "Reject").dispatch("click");
    /** @type {any} */ (back.el.querySelector(".ax-words")).dispatch("keydown", { key: "Escape" });
    assert.deepEqual(buttonsOf(back.el).filter((x) => !x.classList.contains("hidden")).map(textOf), ["Reject", "Accept"]);
  });

  // (fails before: no — a guard the mutation pass asked for: Send was never pressed again while an answer was on its way)
  test("an answer on its way is sent once, however often Send is pressed", async () => {
    const question = block(fromCursorQuestion({ questions: [{ id: "db", prompt: "Which database?", options: [{ id: "pg", label: "Postgres" }] }] }, { agent: "Cursor" }), [""]);
    question.el.dispatch("keydown", { key: "1" });
    const plan = block(fromAgentPlan({ title: "Ready to code?", plan: "", agent: "Claude", options: CLAUDE_PLAN }), [""]);
    for (const b of [question, plan]) {
      b.el.dispatch("keydown", { key: "Enter" });
      b.el.dispatch("keydown", { key: "Enter" });
    }
    await settled();
    assert.deepEqual([question.sent.length, plan.planned.length], [1, 1]);
  });

  test("the dock draws each question waiting on the run, keeps its block while it waits, and lets it go once settled", async () => {
    /** @type {any[]} */
    const answered = [];
    const dock = createDecisions({
      answer: () => {},
      always: () => {},
      workerAnswer: async () => true,
      workerAlways: async () => true,
      reveal: () => {},
      agentAnswer: async (chat, ask, a) => (answered.push([chat.id, ask.id, a]), ""),
      agentPlan: async () => "",
      permit: () => {},
      agentPermission: () => {},
      open: () => {},
    }, { h: fakeH, place, later: () => {} });
    const chat = { id: "c1", turns: [{ waiting: [askOf(fromCursorPlan({ name: "Add auth" }, { agent: "Cursor" }))] }] };
    const paint = () => dock.paint({ chat, rows: [], view: "chat", team: null });
    paint();
    const first = dock.el.kids[0];
    assert.deepEqual([dock.el.classList.contains("is-empty"), textOf(first).startsWith("Cursor proposes a plan")], [false, true]);
    paint();
    assert.equal(dock.el.kids[0], first, "kept while it waits, with what was typed in it");
    button(first, "Accept").dispatch("click");
    await settled();
    assert.deepEqual(answered, [["c1", "q1", { outcome: "accepted" }]]);
    dock.focus();
    assert.equal(first.focused, true, "the turn's line brings the person to it, whole");
    chat.turns[0].waiting = [];
    paint();
    assert.deepEqual([dock.el.kids.length, dock.el.classList.contains("is-empty")], [0, true]);
  });

  test("a request the session's switch asks about is the loop's card: the agent and the call, Allow, the always-allow, Deny with words", () => {
    /** @type {any[]} */
    const permitted = [];
    /** @type {any[]} */
    const always = [];
    const dock = createDecisions({
      answer: () => {},
      always: (chat, itemId) => void always.push([chat.id, itemId]),
      workerAnswer: async () => true,
      workerAlways: async () => true,
      reveal: () => {},
      agentAnswer: async () => "",
      agentPlan: async () => "",
      permit: () => {},
      agentPermission: (chat, ask, x) => void permitted.push([chat.id, ask.id, x]),
      open: () => {},
    }, { h: fakeH, place, later: () => {} });
    const command = "rm -rf build &&\nrm -rf dist";
    const form = fromJudged({ agent: "Claude", call: "cb1", tool: "bash", words: "May I run this command? `rm -rf build` — answer /allow to run it, or say what to do instead.", command, reason: "It can't tell whether `rm` only reads.", offer: { itemId: 7, tool: "bash", shape: "rm" } });
    dock.paint({ chat: { id: "c1", turns: [{ waiting: [askOf(form)] }] }, rows: [], view: "chat", team: null });
    const card = dock.el.kids[0];
    assert.deepEqual([textOf(card.querySelector(".ix-origin")), textOf(card.querySelector(".ix-preview"))], ["Claude · bash", command], "the command whole");
    assert.deepEqual(rows(card).map((x) => textOf(x)), ["Allow|only this time", "Always allow in this project|don't ask again to run rm", "Deny|reject it for now"]);
    card.dispatch("keydown", { key: "Enter", target: null });
    card.dispatch("keydown", { key: "ArrowUp", target: null });
    /** @type {any} */ (card.querySelector(".ix-feedback")).value = " keep the dist folder ";
    buttonsOf(card).at(-1).dispatch("click");
    rows(card)[1].dispatch("dblclick");
    assert.deepEqual(permitted, [
      ["c1", "q1", { allow: true, words: "" }],
      ["c1", "q1", { allow: false, words: "keep the dist folder" }],
      ["c1", "q1", { allow: true, words: "" }],
    ]);
    assert.deepEqual(always, [["c1", { itemId: 7, tool: "bash", shape: "rm" }]], "the always-allow is Filament's, made before the yes");
    // (fails before: no — a guard the mutation pass asked for: no command was longer than a card's words)
    const long = `echo ${"x".repeat(4000)}`;
    assert.equal(fromJudged({ agent: "Claude", tool: "bash", words: "May I run this command?", command: long }).judged?.command, long, "the command whole, past what a card's words keep");
  });

  test("a plan with its agent's own ways on is answered through the dock's plan answer, and drawn anew as the switch moves", async () => {
    /** @type {any[]} */
    const planned = [];
    const dock = createDecisions({
      answer: () => {},
      always: () => {},
      workerAnswer: async () => true,
      workerAlways: async () => true,
      reveal: () => {},
      agentAnswer: async () => "",
      agentPlan: async (chat, ask, x) => (planned.push([chat.id, ask.id, x]), ""),
      permit: () => {},
      agentPermission: () => {},
      open: () => {},
    }, { h: fakeH, place, later: () => {} });
    const form = fromAgentPlan({ title: "Ready to code?", plan: "# Plan", agent: "Claude", options: CLAUDE_PLAN });
    const chat = { id: "c1", view: { settings: { effective: { loop: { permissions: "read-only" } } } }, turns: [{ waiting: [askOf(form)] }] };
    const paint = () => dock.paint({ chat, rows: [], view: "chat", team: null });
    paint();
    const first = dock.el.kids[0];
    assert.equal(first.querySelector(".ax-detail").classList.contains("hidden"), false, "Read-only: a yes moves the switch");
    paint();
    assert.equal(dock.el.kids[0], first, "kept while the switch stays");
    chat.view.settings.effective.loop.permissions = "ask";
    paint();
    const second = dock.el.kids[0];
    assert.notEqual(second, first, "drawn anew as the switch moves");
    assert.equal(second.querySelector(".ax-detail").classList.contains("hidden"), true);
    second.dispatch("keydown", { key: "Enter" });
    await settled();
    assert.deepEqual(planned, [["c1", "q1", { choice: "exit-plan-default", words: "" }]]);
  });
});

describe("a coding agent's questions on its run (AC2-4)", () => {
  const plan = fromCursorPlan({ toolCallId: "c_plan", name: "Add auth", overview: "Sessions first", plan: "# Auth", todos: [{ id: "t1", content: "Sessions", status: "completed" }] }, { agent: "Cursor" });
  const link = fromElicitation({ mode: "url", url: "https://example.com/login", message: "Sign in" }, { agent: "Claude" });
  const asked = [
    { type: "round-start", round: 1 },
    { type: "tool-start", round: 1, id: "c_plan", name: "createPlan", card: cardOf("createPlan", { name: "Add auth" }) },
    { type: "ask", round: 1, id: "q1", kind: "proposal", call: "c_plan", waits: true, form: plan },
    { type: "tool-start", round: 1, id: "ask:q2", name: "ask", args: "Sign in", card: { kind: "ask", title: "Open a link", subject: "Sign in" } },
    { type: "ask", round: 1, id: "q2", kind: "link", waits: true, form: link },
    { type: "ask", round: 1, id: "q3", kind: "link", waits: false, form: link },
    { type: "ask", round: 1, kind: "question", tool: "ask", question: "Which one?" },
  ];

  test("those not settled wait; the card that asked keeps the form, then the answer; the loop's own pause stays apart", () => {
    const al = alignEvents(asked);
    assert.deepEqual(al.waiting.map((/** @type {any} */ a) => a.id), ["q1", "q2"], "one an outside client answers waits for none of the page");
    assert.deepEqual(al.byRound.get(1).asks.map((/** @type {any} */ a) => a.question), ["Which one?"], "the loop's own question still pauses the turn");
    assert.equal(al.byRound.get(1).tools.get("c_plan").form, plan);
    assert.equal(liveWords(al), "waiting for your answer");
    assert.equal(askWaitWords(al.waiting), "A plan waits for your decision and 1 more, below");
    const later = alignEvents([...asked, { type: "ask-end", round: 1, id: "q2", outcome: "accepted", words: ["Opened"] }, { type: "tool-end", round: 1, id: "ask:q2", name: "ask", ok: true, preview: "Opened" }]);
    assert.deepEqual(later.waiting.map((/** @type {any} */ a) => a.id), ["q1"]);
    assert.equal(later.byRound.get(1).tools.get("ask:q2").answer, "Opened");
    assert.deepEqual([askWaitWords(later.waiting), askWaitWords([{ kind: "permission" }]), askWaitWords([{ kind: "question" }])], [
      "A plan waits for your decision, below",
      "Waiting for your permission, below",
      "Waiting for your answer, below",
    ]);
    assert.equal(callWords({ name: "createPlan", card: cardOf("createPlan", { name: "Add auth" }) }), "proposing a plan");
  });

  describe("drawn in the transcript", () => {
    /** @type {ReturnType<typeof stubDocument>} */
    let doc;
    before(() => {
      doc = stubDocument();
    });
    after(() => doc.restore());
    /** What a row's summary says: its kind, its subject, the rest. @param {any} row */
    const parts = (row) => ["tool-kind", "tool-primary", "tool-secondary"].map((c) => row.querySelector(`.${c}`)?.textContent ?? null);

    test("a proposed plan's card: its name; opened, its overview, the plan and its to-dos, then the answer", () => {
      const al = alignEvents([...asked.slice(0, 3), { type: "ask-end", round: 1, id: "q1", call: "c_plan", outcome: "rejected", words: ["Rejected: smaller steps"] }, { type: "tool-end", round: 1, id: "c_plan", ok: true }]);
      const row = roundRows(al.byRound.get(1))[0];
      assert.deepEqual(parts(row), ["Propose a plan", "Add auth", "Rejected: smaller steps"]);
      assert.match(row.textContent, /Sessions first/);
      assert.ok(row.querySelector(".plan-item.done"), "its to-dos, marked");
    });

    test("Claude's plan on the card of its own call: the plan, then the answer; one sent back has no chip saying denied", () => {
      const plan = "# Plan\n1. Clean the build";
      const form = fromAgentPlan({ title: "Ready to code?", plan, call: "ce1", agent: "Claude", options: CLAUDE_PLAN });
      /** @param {string} said @param {any} end */
      const rowOf = (said, end) => roundRows(alignEvents([
        { type: "round-start", round: 1 },
        { type: "tool-start", round: 1, id: "ce1", name: "ExitPlanMode", card: cardOf("ExitPlanMode", { plan }) },
        { type: "ask", round: 1, id: "q1", kind: "proposal", call: "ce1", waits: true, form },
        { type: "ask-end", round: 1, id: "q1", call: "ce1", outcome: "answered", words: [said] },
        { type: "tool-end", round: 1, id: "ce1", ...end },
      ]).byRound.get(1))[0];
      const back = rowOf("No, keep planning", { ok: false, declined: true });
      assert.deepEqual(parts(back), ["Propose a plan", "Plan", "No, keep planning"]);
      assert.match(back.querySelector(".sub-report")?.innerHTML || "", /Clean the build/, "the plan whole, opened");
      assert.doesNotMatch(back.textContent, /Denied/, "its answer says it");
      assert.deepEqual(parts(rowOf("Yes, build it", { ok: true })), ["Propose a plan", "Plan", "Yes, build it"]);
    });

    test("a question's own card says it waits, then keeps the person's answer", () => {
      const own = [...asked.slice(0, 1), ...asked.slice(3, 5)];
      const waiting = roundRows(alignEvents(own).byRound.get(1))[0];
      assert.equal(waiting.querySelector(".ask-a")?.textContent, "Waiting for your answer");
      const done = alignEvents([...own, { type: "ask-end", round: 1, id: "q2", outcome: "accepted", words: ["Opened"] }, { type: "tool-end", round: 1, id: "ask:q2", name: "ask", ok: true, ms: 900, chars: 6, preview: "Opened" }]);
      assert.equal(roundRows(done.byRound.get(1))[0].querySelector(".ask-a")?.textContent, "Opened");
    });

    test("a question's card draws its inline marks, in its row and opened", () => {
      const title = "Claude wants to run `npm test`";
      const perm = fromJudged({ agent: "Claude", tool: "bash", words: title });
      const row = roundRows(alignEvents([
        { type: "round-start", round: 1 },
        { type: "tool-start", round: 1, id: "ask:q1", name: "ask", args: title, card: { kind: "ask", title: "Permission", subject: title } },
        { type: "ask", round: 1, id: "q1", kind: "permission", waits: true, form: perm },
      ]).byRound.get(1))[0];
      assert.equal(row.querySelector(".tool-secondary")?.textContent, "Claude wants to run npm test");
      assert.equal(row.querySelector(".tool-secondary")?.querySelector("code")?.textContent, "npm test");
      assert.equal(row.querySelector(".ask-q")?.querySelector("code")?.textContent, "npm test");
    });
  });
});
