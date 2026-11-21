// An agent's question in one shape (HarnessV3-ACP AC2-4): each agent's request read into a form, the person's answer
// checked against it and written back in the agent's own terms, and an outside client's answer read back.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fromElicitation,
  fromCursorQuestion,
  fromCursorPlan,
  fromCodexQuestion,
  fromAgentPlan,
  checkAnswer,
  nobodyAnswer,
  answerWords,
  toElicitation,
  toCursorQuestion,
  toCursorPlan,
  toCodexQuestion,
  toPermission,
  clientQuestions,
  answerFromText,
  askedOf,
  endedBy,
} from "../src/adapters/agents/asks.js";

/**
 * Claude's adapter's form for AskUserQuestion, as `askUserQuestionsToCreateRequest` builds it. `marked`: its Other field
 * carries the marker — since 0.93.0 the adapter gives it only to a JetBrains AIR client, and Filament's form has none.
 */
const claudeForm = (questions, { marked = true } = {}) => {
  const single = questions.length === 1;
  const properties = {};
  questions.forEach((q, i) => {
    const options = q.options.map((o) => ({ const: o.label, title: o.label, ...(o.description ? { description: o.description } : {}) }));
    properties[`question_${i}`] = q.multiSelect
      ? { type: "array", title: q.header, description: single ? undefined : q.question, items: { anyOf: options } }
      : { type: "string", title: q.header, description: single ? undefined : q.question, oneOf: options };
    properties[`question_${i}_custom`] = {
      type: "string",
      title: "Other",
      description: "Type your own answer instead of choosing an option above (optional).",
      ...(marked ? { _meta: { _askUserQuestionCustomAnswer: { questionId: `question_${i}`, isCustomAnswer: true } } } : {}),
    };
  });
  return { mode: "form", sessionId: "s1", toolCallId: "toolu_1", message: single ? questions[0].question : "Please answer the following questions.", requestedSchema: { type: "object", properties } };
};

// (fails before: yes — the owner's of 10-30: "when a question is asked and answered and we press Next, it asks about the
// input now". Claude's adapter 0.93.0 marks its Other field only for JetBrains AIR, so the field was a step of its own
// after Next, where its words belong under the choices)
test("Claude's question whose Other field comes unmarked: the field beside its question's choices joins it all the same", () => {
  const one = fromElicitation(claudeForm([{ question: "Which database?", header: "Database", options: [{ label: "Postgres" }, { label: "SQLite" }] }], { marked: false }), { agent: "Claude" });
  assert.equal(one.questions.length, 1, "no step of its own");
  assert.deepEqual([one.questions[0].prompt, one.questions[0].words, one.questions[0].other], ["Which database?", "text", "question_0_custom"], "the question's own words, and a box for the person's beside its choices");
  assert.deepEqual(toElicitation(one, { outcome: "answered", answers: { question_0: { chosen: [], words: "DuckDB" } } }), { action: "accept", content: { question_0_custom: "DuckDB" } });
  const two = fromElicitation(claudeForm([
    { question: "Which database?", header: "Database", options: [{ label: "Postgres" }, { label: "SQLite" }] },
    { question: "Which features?", header: "Features", multiSelect: true, options: [{ label: "Auth" }, { label: "Billing" }] },
  ], { marked: false }));
  assert.deepEqual(two.questions.map((q) => [q.id, q.other]), [["question_0", "question_0_custom"], ["question_1", "question_1_custom"]]);
  // Words beside nothing to choose from, or beside no field, are a question of their own, as any form's.
  const lone = fromElicitation({ mode: "form", message: "Deploy", requestedSchema: { type: "object", properties: { name: { type: "string", title: "Name" }, name_custom: { type: "string", title: "Other" }, region_custom: { type: "string", title: "Other" } } } });
  assert.deepEqual(lone.questions.map((q) => q.id), ["name", "name_custom", "region_custom"]);
});

test("Claude's question: its choices, and the words beside them in the field that takes them", () => {
  const f = fromElicitation(claudeForm([{ question: "Which database?", header: "Database", options: [{ label: "Postgres", description: "the usual" }, { label: "SQLite" }] }]), { agent: "Claude" });
  assert.equal(typeof f, "object");
  assert.equal(f.kind, "question");
  assert.equal(f.call, "toolu_1");
  assert.equal(f.title, "Which database?");
  assert.equal(f.questions.length, 1, "the Other field joins its question");
  const q = f.questions[0];
  assert.deepEqual([q.id, q.header, q.prompt, q.several, q.words, q.other], ["question_0", "Database", "Which database?", false, "text", "question_0_custom"]);
  assert.deepEqual(q.choices, [{ id: "Postgres", label: "Postgres", description: "the usual" }, { id: "SQLite", label: "SQLite", description: "" }]);
  assert.deepEqual(toElicitation(f, { outcome: "answered", answers: { question_0: { chosen: ["SQLite"] } } }), { action: "accept", content: { question_0: "SQLite" } });
  assert.deepEqual(toElicitation(f, { outcome: "answered", answers: { question_0: { chosen: [], words: "DuckDB" } } }), { action: "accept", content: { question_0_custom: "DuckDB" } });
  assert.deepEqual(toElicitation(f, { outcome: "skipped" }), { action: "decline" });
  assert.deepEqual(toElicitation(f, { outcome: "cancelled" }), { action: "cancel" });
});

test("Claude's several questions: each its own words, several choices as a list", () => {
  const f = fromElicitation(claudeForm([
    { question: "Which database?", header: "Database", options: [{ label: "Postgres" }, { label: "SQLite" }] },
    { question: "Which features?", header: "Features", multiSelect: true, options: [{ label: "Auth" }, { label: "Billing" }, { label: "Search" }] },
  ]));
  assert.equal(f.title, "Please answer the following questions.");
  assert.deepEqual(f.questions.map((q) => [q.id, q.prompt, q.several, q.wants]), [["question_0", "Which database?", false, "string"], ["question_1", "Which features?", true, "array"]]);
  const a = { outcome: "answered", answers: { question_0: { chosen: ["Postgres"] }, question_1: { chosen: ["Auth", "Search"] } } };
  assert.equal(checkAnswer(f, a), "");
  assert.deepEqual(toElicitation(f, a).content, { question_0: "Postgres", question_1: ["Auth", "Search"] });
  assert.deepEqual(answerWords(f, a), ["Database: Postgres", "Features: Auth, Search"]);
});

test("an MCP form: a yes or no, a number, words, a list; a field the card can't draw declines the form", () => {
  const f = fromElicitation({
    mode: "form",
    message: "Set up the deploy",
    requestedSchema: {
      type: "object",
      required: ["replicas"],
      properties: {
        confirm: { type: "boolean", title: "Go ahead?", default: true },
        replicas: { type: "integer", title: "Replicas" },
        ratio: { type: "number", title: "Ratio" },
        region: { type: "string", title: "Region", enum: ["eu", "us"], enumNames: ["Europe", "America"], default: "eu" },
        note: { type: "string", title: "Note", default: "none" },
      },
    },
  });
  assert.deepEqual(f.questions.map((q) => [q.id, q.words, q.wants, q.required, q.preset, q.presetWords]), [
    ["confirm", "", "boolean", false, ["true"], ""],
    ["replicas", "integer", "integer", true, [], ""],
    ["ratio", "number", "number", false, [], ""],
    ["region", "", "string", false, ["eu"], ""],
    ["note", "text", "string", false, [], "none"],
  ]);
  assert.deepEqual(f.questions[3].choices.map((c) => c.label), ["Europe", "America"]);
  assert.match(checkAnswer(f, { outcome: "answered", answers: {} }), /needs an answer/);
  assert.match(checkAnswer(f, { outcome: "answered", answers: { replicas: { chosen: [], words: "1.5" } } }), /whole number/);
  const a = { outcome: "answered", answers: { confirm: { chosen: ["false"] }, replicas: { chosen: [], words: "3" }, ratio: { chosen: [], words: "0.5" }, region: { chosen: ["us"] }, note: { chosen: [], words: "ship it" } } };
  assert.equal(checkAnswer(f, a), "");
  assert.deepEqual(toElicitation(f, a).content, { confirm: false, replicas: 3, ratio: 0.5, region: "us", note: "ship it" });
  assert.match(String(fromElicitation({ mode: "form", requestedSchema: { properties: { x: { type: "object" } } } })), /field “x” is of a kind the card doesn't draw \(object\)/);
  assert.match(String(fromElicitation({ mode: "_vendor" })), /doesn't draw \(_vendor\)/);
  assert.match(String(fromElicitation({ mode: "form", requestedSchema: { properties: {} } })), /asks nothing/);
});

// (fails before: no — a guard the mutation pass asked for: no form titled a choice without its value, gave a number
// a default, offered a list nothing, or gave a list a default it does not offer)
test("an MCP form's odd fields: a titled choice with no value left out, a number's default, a list's offered defaults", () => {
  const properties = {
    tier: { type: "string", title: "Tier", oneOf: [{ const: "a", title: "Alpha" }, { title: "No value" }] },
    count: { type: "number", title: "Count", default: 5 },
    tags: { type: "array", title: "Tags", items: { enum: ["x", "y"] }, default: ["x", "z"] },
  };
  const f = /** @type {any} */ (fromElicitation({ mode: "form", message: "Tune it", requestedSchema: { type: "object", properties } }));
  assert.deepEqual(f.questions[0].choices.map((/** @type {any} */ c) => c.label), ["Alpha"]);
  assert.deepEqual([f.questions[1].presetWords, f.questions[2].preset], ["5", ["x"]]);
  const none = fromElicitation({ mode: "form", requestedSchema: { properties: { tags: { type: "array", items: { enum: [] } } } } });
  assert.equal(none, "its field “tags” is a list with nothing to choose from");
});

test("a link: its address, opened or declined; one that isn't the web's isn't drawn", () => {
  const f = fromElicitation({ mode: "url", sessionId: "s1", message: "Sign in to the server", url: "https://auth.example.com/login?x=1", elicitationId: "e7" });
  assert.equal(f.kind, "link");
  assert.deepEqual(f.link, { url: "https://auth.example.com/login?x=1", id: "e7" });
  assert.deepEqual(toElicitation(f, { outcome: "accepted" }), { action: "accept" });
  assert.deepEqual(toElicitation(f, { outcome: "declined" }), { action: "decline" });
  assert.deepEqual(answerWords(f, { outcome: "accepted" }), ["Opened"]);
  assert.match(String(fromElicitation({ mode: "url", url: "file:///etc/passwd" })), /isn't a web address/);
});

test("Cursor's questions: the choices' ids back, only the questions answered; nothing chosen is a skip", () => {
  const f = fromCursorQuestion({
    toolCallId: "c_q",
    title: "Before I start",
    questions: [
      { id: "q1", prompt: "Which framework?", options: [{ id: "a", label: "React" }, { id: "b", label: "Vue" }], allowMultiple: false },
      { id: "q2", prompt: "Which tests?", options: [{ id: "u", label: "Unit" }, { id: "e", label: "End to end" }], allowMultiple: true },
      { id: "q3", prompt: "Nothing to choose", options: [] },
    ],
  });
  assert.equal(f.call, "c_q");
  assert.deepEqual(f.questions.map((q) => [q.id, q.several, q.words]), [["q1", false, ""], ["q2", true, ""]]);
  assert.match(checkAnswer(f, { outcome: "answered", answers: { q1: { chosen: ["a"], words: "x" } } }), /takes no words/);
  assert.match(checkAnswer(f, { outcome: "answered", answers: { q1: { chosen: ["a", "b"] } } }), /takes one choice/);
  assert.match(checkAnswer(f, { outcome: "answered", answers: { q1: { chosen: ["z"] } } }), /isn't one of the choices/);
  assert.deepEqual(toCursorQuestion(f, { outcome: "answered", answers: { q2: { chosen: ["u", "e"] } } }), { outcome: { outcome: "answered", answers: [{ questionId: "q2", selectedOptionIds: ["u", "e"] }] } });
  assert.deepEqual(toCursorQuestion(f, { outcome: "answered", answers: {} }), { outcome: { outcome: "skipped", reason: "The person skipped the questions" } });
  assert.deepEqual(toCursorQuestion(f, nobodyAnswer(f)), { outcome: { outcome: "skipped", reason: "nobody could be asked here" } });
  assert.deepEqual(toCursorQuestion(f, { outcome: "cancelled" }), { outcome: { outcome: "cancelled" } });
  assert.match(String(fromCursorQuestion({ questions: [{ id: "q", prompt: "?", options: [] }] })), /nothing to choose/);
  assert.deepEqual(
    answerWords(f, { outcome: "answered", answers: { q1: { chosen: ["a"] }, q2: { chosen: ["u", "e"] } } }),
    ["Which framework? React", "Which tests? Unit, End to end"],
    "a question that ends in its own mark takes its answer after a space",
  );
});

test("Cursor's plan: its name, overview, plan and to-dos (a phase's too); accepted, or rejected with words", () => {
  const f = fromCursorPlan({
    toolCallId: "c_p",
    name: "Add dark mode",
    overview: "Theme tokens, then the toggle",
    plan: "# Dark mode\n1. tokens\n2. toggle",
    todos: [{ id: "t1", content: "Add tokens", status: "pending" }],
    phases: [{ name: "Later", todos: [{ id: "t2", content: "Ship it", status: "in_progress" }] }],
  });
  assert.equal(f.kind, "plan");
  assert.deepEqual(f.plan, { name: "Add dark mode", overview: "Theme tokens, then the toggle", text: "# Dark mode\n1. tokens\n2. toggle", todos: [{ text: "Add tokens", status: "pending" }, { text: "Ship it", status: "in_progress" }] });
  assert.equal(checkAnswer(f, { outcome: "accepted" }), "");
  assert.match(checkAnswer(f, { outcome: "answered" }), /accepted or rejected/);
  assert.deepEqual(toCursorPlan({ outcome: "accepted" }), { outcome: { outcome: "accepted" } });
  assert.deepEqual(toCursorPlan({ outcome: "rejected", reason: " keep the old toggle " }), { outcome: { outcome: "rejected", reason: "keep the old toggle" } });
  assert.deepEqual(toCursorPlan({ outcome: "cancelled" }), { outcome: { outcome: "cancelled" } });
  assert.deepEqual(nobodyAnswer(f), { outcome: "accepted" }, "Cursor accepts its own plan when its client can't ask");
  assert.deepEqual(answerWords(f, { outcome: "rejected", reason: "too big" }), ["Rejected: too big"]);
});

test("Codex's questions: the labels and the person's words back by id; a secret is never said", () => {
  const f = fromCodexQuestion({
    threadId: "th",
    turnId: "tu",
    itemId: "item_1",
    isBlocking: true,
    questions: [
      { id: "env", header: "Target", question: "Deploy where?", options: [{ label: "staging", description: "safe" }, { label: "prod", description: "live" }], isOther: true },
      { id: "token", header: "Token", question: "Your API token?", isSecret: true },
      { id: "why", header: "Why", question: "Why now?" },
    ],
  });
  assert.equal(f.call, "item_1");
  assert.deepEqual(f.questions.map((q) => [q.id, q.words, q.choices.map((c) => c.id)]), [["env", "text", ["staging", "prod"]], ["token", "secret", []], ["why", "text", []]]);
  const a = { outcome: "answered", answers: { env: { chosen: ["prod"] }, token: { chosen: [], words: "sk-123" } } };
  assert.deepEqual(toCodexQuestion(f, a), { answers: { env: { answers: ["prod"] }, token: { answers: ["sk-123"] } } });
  assert.deepEqual(answerWords(f, a), ["Target: prod", "Token: (hidden)", "Why: skipped"]);
  assert.deepEqual(toCodexQuestion(f, { outcome: "skipped" }), { answers: {} });
});

/** Claude's ways on from its plan, as claude-agent-acp 0.76 offers them with bypassPermissions its own elevated mode. */
const CLAUDE_PLAN = [
  { optionId: "exit-plan-clear-bypass", name: "Yes, clear context (12% used) and bypass permissions", kind: "allow_always" },
  { optionId: "exit-plan-bypass", name: "Yes, and bypass permissions", kind: "allow_always" },
  { optionId: "exit-plan-default", name: "Yes, manually approve edits", kind: "allow_once" },
  { optionId: "reject", name: "No, keep planning", kind: "reject_once" },
];

test("Claude's plan: the plan whole, its ways on in the card's words, its yeses that decide by themselves left out; one chosen", () => {
  const plan = "# Plan\n1. Clean the build";
  const f = fromAgentPlan({ title: "Ready to code?", plan, call: "ce1", agent: "Claude", options: CLAUDE_PLAN });
  assert.deepEqual([f.kind, f.from, f.title, f.call, f.plan?.text, f.plan?.name], ["plan", "agent-plan", "Ready to code?", "ce1", plan, ""]);
  assert.deepEqual(f.questions[0].choices.map((c) => [c.id, c.label, c.description]), [
    ["exit-plan-default", "Yes, build it", "Claude leaves plan mode and starts on it"],
    ["exit-plan-clear-bypass", "Yes, in a fresh context", "Claude starts on it with only the plan in its context — 12% of it is used now"],
    ["reject", "No, keep planning", "Claude stays in plan mode: say what to change"],
  ]);
  assert.equal(checkAnswer(f, { outcome: "accepted" }), "the answer to a plan is answered; this was accepted");
  assert.match(checkAnswer(f, { outcome: "answered", answers: {} }), /needs an answer/);
  assert.match(checkAnswer(f, { outcome: "answered", answers: { permission: { chosen: ["exit-plan-bypass"] } } }), /isn't one of the choices/);
  const a = { outcome: "answered", answers: { permission: { chosen: ["exit-plan-clear-bypass"] } } };
  assert.equal(checkAnswer(f, a), "");
  assert.deepEqual(toPermission(a), { outcome: { outcome: "selected", optionId: "exit-plan-clear-bypass" } });
  assert.deepEqual(toPermission(null), { outcome: { outcome: "cancelled" } });
  assert.deepEqual(answerWords(f, a), ["Yes, in a fresh context"]);
  assert.deepEqual(answerWords(f, { outcome: "cancelled" }), ["Cancelled"]);
  assert.equal(nobodyAnswer(f), null, "nobody to ask: the agent hears it cancelled");
  assert.equal(askedOf(f), "Ready to code?");
  assert.deepEqual(clientQuestions(f), f.questions, "an outside client's question tool is asked its ways on");
  assert.deepEqual(answerFromText(f, 'User has answered your questions: "Ready to code?"="Yes, build it".'), { outcome: "answered", answers: { permission: { chosen: ["exit-plan-default"] } } });
  const fresh = fromAgentPlan({ title: "Ready to code?", plan, options: [{ optionId: "exit-plan-clear-auto", name: "Yes, clear context and use auto mode", kind: "allow_always" }] });
  assert.deepEqual(fresh.questions[0].choices.map((c) => [c.label, c.description]), [["Yes, in a fresh context", "The agent starts on it with only the plan in its context"]], "no share of its context said where its adapter says none");
});

test("an outside client's answer, read back per question: Claude Code's pairs, its Other, a plan, a link, an error", () => {
  const f = fromCursorQuestion({
    questions: [
      { id: "q1", prompt: "Which framework?", options: [{ id: "a", label: "React" }, { id: "b", label: "React Native" }] },
      { id: "q2", prompt: "Which tests?", options: [{ id: "u", label: "Unit" }, { id: "e", label: "End to end" }], allowMultiple: true },
    ],
  });
  const said = 'User has answered your questions: "Which framework?"="React Native", "Which tests?"="Unit, End to end". You can now continue with the user\'s answers in mind.';
  assert.deepEqual(answerFromText(f, said), { outcome: "answered", answers: { q1: { chosen: ["b"] }, q2: { chosen: ["u", "e"] } } });
  assert.deepEqual(answerFromText(f, "", true), { outcome: "skipped" });
  const claude = fromElicitation(claudeForm([{ question: "Which database?", header: "Database", options: [{ label: "Postgres" }, { label: "SQLite" }] }]));
  assert.deepEqual(answerFromText(claude, 'User has answered your questions: "Which database?"="DuckDB, please".'), { outcome: "answered", answers: { question_0: { chosen: [], words: "DuckDB, please" } } });
  assert.deepEqual(answerFromText(claude, "SQLite"), { outcome: "answered", answers: { question_0: { chosen: ["SQLite"] } } });
  const plan = fromCursorPlan({ name: "No-op cleanup", overview: "" });
  assert.deepEqual(clientQuestions(plan).map((q) => q.choices.map((c) => c.label)), [["Accept", "Reject"]]);
  assert.deepEqual(answerFromText(plan, 'User has answered your questions: "Accept the plan “No-op cleanup”?"="Accept".'), { outcome: "accepted" });
  assert.deepEqual(answerFromText(plan, 'User has answered your questions: "Accept the plan “No-op cleanup”?"="smaller steps first".'), { outcome: "rejected", reason: "smaller steps first" });
  const link = fromElicitation({ mode: "url", url: "https://example.com/a", message: "Sign in" });
  assert.deepEqual(answerFromText(link, 'User has answered your questions: "Sign in Open https://example.com/a?"="Open it".'), { outcome: "accepted" });
  assert.deepEqual(answerFromText(link, "Decline"), { outcome: "declined" });
});

// (fails before: no — a guard the mutation pass asked for: no form came in OpenAI's modes, no Codex label had capitals,
// no reason was other than words, and no answer named a question the form doesn't ask)
test("OpenAI's form modes drawn; a Codex choice's id its label whole; a reason only words; no answer to a question not asked", () => {
  for (const mode of ["openai/form", "openaiForm"])
    assert.equal(/** @type {any} */ (fromElicitation({ mode, requestedSchema: { properties: { n: { type: "number", title: "N" } } } })).kind, "question", mode);
  const f = /** @type {any} */ (fromCodexQuestion({ itemId: "i", questions: [{ id: "db", header: "DB", question: "Which?", options: [{ label: "Use Postgres", description: "" }] }] }));
  assert.deepEqual(f.questions[0].choices.map((/** @type {any} */ c) => c.id), ["Use Postgres"]);
  assert.equal(checkAnswer(f, { outcome: "answered", answers: { nope: { chosen: ["x"] } } }), "the form asks no question “nope”");
  assert.equal(checkAnswer(fromCursorPlan({ name: "P" }), { outcome: "rejected", reason: /** @type {any} */ (5) }), "a reason is words");
});

// (fails before: no — a guard the mutation pass asked for: no label held a comma or another label, no answer left a
// question's words out, and no error's text named a choice)
test("an outside client's answer: a label with a comma whole, the longest label, a question it doesn't name unanswered", () => {
  const several = fromCursorQuestion({ questions: [{ id: "t", prompt: "Which tests?", options: [{ id: "uf", label: "Unit, fast" }, { id: "e", label: "End to end" }], allowMultiple: true }] });
  assert.deepEqual(answerFromText(several, 'User has answered your questions: "Which tests?"="Unit, fast".'), { outcome: "answered", answers: { t: { chosen: ["uf"] } } });
  const one = fromCursorQuestion({ questions: [{ id: "q1", prompt: "Which framework?", options: [{ id: "a", label: "React" }, { id: "b", label: "React Native" }] }] });
  assert.deepEqual(answerFromText(one, "React Native"), { outcome: "answered", answers: { q1: { chosen: ["b"] } } });
  const two = fromCursorQuestion({
    questions: [
      { id: "q1", prompt: "Which framework?", options: [{ id: "a", label: "React" }] },
      { id: "q2", prompt: "Which tests?", options: [{ id: "u", label: "Unit" }] },
    ],
  });
  assert.deepEqual(answerFromText(two, 'User has answered your questions: "Which framework?"="React". You can now continue with the user\'s answers in mind.'), { outcome: "answered", answers: { q1: { chosen: ["a"] } } });
  // Words are never searched for a label (a3): free text that names both answers neither.
  assert.deepEqual(answerFromText(two, "Which framework? React. Unit tests can wait."), { outcome: "skipped" });
  assert.deepEqual(answerFromText(two, "Unit first. Which framework? React."), { outcome: "skipped" });
  assert.deepEqual(answerFromText(two, 'User has answered your questions: "Which framework?"="React".', true), { outcome: "skipped" });
});

test("what a form asks, in a few words: its title, else its first question, its plan's name or its link", () => {
  const options = [{ id: "a", label: "React" }];
  assert.equal(askedOf(fromCursorQuestion({ title: "Before I start", questions: [{ id: "q1", prompt: "Which framework?", options }] })), "Before I start");
  assert.equal(askedOf(fromCursorQuestion({ questions: [{ id: "q1", prompt: "Which framework?", options }] })), "Which framework?");
  assert.equal(askedOf(fromCursorPlan({ name: "Add dark mode" })), "Add dark mode");
  assert.equal(askedOf(fromElicitation({ mode: "url", url: "https://example.com/a" })), "https://example.com/a");
  assert.equal(askedOf(fromCursorPlan({})), "a question");
});

test("a question nobody answered ends as its signal says: a link the agent saw completed is accepted, else cancelled", () => {
  const completed = new AbortController();
  const asked = AbortSignal.any([new AbortController().signal, completed.signal]);
  completed.abort({ outcome: "accepted" });
  assert.deepEqual(endedBy(asked), { outcome: "accepted" }, "the link's own signal, joined to the request's");
  const stopped = new AbortController();
  stopped.abort();
  assert.deepEqual(endedBy(stopped.signal), { outcome: "cancelled" });
  assert.deepEqual(endedBy(new AbortController().signal), { outcome: "cancelled" });
  assert.deepEqual(endedBy(null), { outcome: "cancelled" });
});

test("a proposed plan keeps 60 000 characters of its text, 100 to-dos and 300 characters of each", () => {
  const f = fromCursorPlan({
    name: "Big",
    plan: "x".repeat(70_000),
    todos: [{ id: "t", content: "" }, ...Array.from({ length: 120 }, (_, i) => ({ id: `t${i}`, content: `${i} ${"y".repeat(400)}` }))],
  });
  assert.equal(f.plan.text.length, 60_000);
  assert.deepEqual([f.plan.todos.length, f.plan.todos[0].text, f.plan.todos[1].text.length], [100, "t", 300], "a to-do with no words is its id");
  assert.equal(f.plan.todos[99].text.slice(0, 3), "98 ");
  assert.equal(fromAgentPlan({ title: "Ready to code?", plan: "x".repeat(70_000), options: [] }).plan?.text.length, 60_000, "Claude's too");
});

test("another agent's plan: its ways on in their own words, else their kind's, in its order, a way to keep planning last", () => {
  const f = fromAgentPlan({
    title: "Gemini wants to leave plan mode",
    plan: "",
    agent: "Gemini",
    options: [
      { optionId: "no", name: "Keep planning", kind: "reject_once" },
      { optionId: "proceed_always", name: "Yes, always", kind: "allow_always", description: "and switch modes without asking" },
      { optionId: "proceed_once", kind: "allow_once" },
      { optionId: "exit-plan-bypass", name: "Yes, and bypass permissions", kind: "allow_always" },
      { optionId: "other" },
    ],
  });
  assert.deepEqual(f.questions[0].choices.map((c) => [c.id, c.label, c.description]), [
    ["proceed_always", "Yes, always", "and switch modes without asking"],
    ["proceed_once", "proceed_once", "only this time"],
    ["exit-plan-bypass", "Yes, and bypass permissions", "from now on"],
    ["other", "other", ""],
    ["no", "Keep planning", "refuse it this time"],
  ], "a yes into a mode that decides by itself stays where the plain yes isn't offered");
  assert.equal(f.questions[0].required, true);
  assert.deepEqual(answerWords(f, { outcome: "answered", answers: { permission: { chosen: ["no"] } } }), ["Keep planning"]);
});
