// An outside client's answer (its question tool's result) picks an option by the option's exact label alone, in the
// client's machine format — Claude Code's `"<question>"="<answer>"` pairs, a JSON object of question to answer, or the
// result whole where it is the label. Words are never looked into for a label or a yes or a no: "Don't allow this"
// picks nothing, and where the question takes the person's words, they go to the agent as words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ClientToolset } from "../src/adapters/agents/client-bridge.js";
import {
  answerFromText,
  clientQuestions,
  fromAgentPlan,
  fromCursorPlan,
  fromCursorQuestion,
  fromElicitation,
  fromJudged,
  toCursorPlan,
  toElicitation,
  toPermission,
} from "../src/adapters/agents/asks.js";

/** Claude Code's result for its question tool. @param {[string, string][]} pairs */
const claudeSaid = (pairs) => `User has answered your questions: ${pairs.map(([q, a]) => `"${q}"="${a}"`).join(", ")}. You can now continue with the user's answers in mind.`;

const OPTIONS = [
  { optionId: "allow", name: "Allow", kind: "allow_once" },
  { optionId: "reject", name: "Reject", kind: "reject_once" },
];
const QUESTION = "Gemini wants to run `npm test`. Allow it?";
const CC = ClientToolset.from("openai", { tools: [{ type: "function", function: { name: "AskUserQuestion", parameters: { type: "object", properties: { questions: {} } } } }] });
/** @param {string} text */
const permission = (text) => ClientToolset.parseAskAnswer(text, OPTIONS, QUESTION, CC.askShown(OPTIONS));

// (fails before: yes — "Don't allow this" named "allow", a word of yes, and allowed the call; "yes" and "The user chose:
// Reject" picked by a word list; and a JSON result that echoed the tool's input picked its first option, whatever the
// answer said)
test("a permission's answer: only an option's exact label in the client's format picks it", () => {
  assert.equal(permission(claudeSaid([[QUESTION, "Allow"]])), "allow");
  assert.equal(permission(claudeSaid([[QUESTION, "Reject"]])), "reject");
  assert.equal(permission("Reject"), "reject", "a result that is the label whole");
  assert.equal(permission(JSON.stringify({ answers: { [QUESTION]: "Reject" } })), "reject");
  const echoed = CC.buildAsk({ question: QUESTION, options: OPTIONS });
  assert.equal(permission(JSON.stringify({ questions: echoed?.input.questions, answers: { [QUESTION]: "Reject" } })), "reject", "the tool's own input echoed beside the answer names no option");
  for (const words of ["Don't allow this", "Don't accept", "yes", "allow", "no", "The user chose: Reject", "Allow, but not on main"]) {
    assert.equal(permission(claudeSaid([[QUESTION, words]])), null, `"${words}" in Claude Code's pair`);
    assert.equal(permission(words), null, `"${words}" whole`);
  }
  assert.equal(permission(JSON.stringify({ answers: { [QUESTION]: "Don't allow this" } })), null);
});

// (fails before: yes — the words were searched for a label: "Don't accept" accepted the plan, "Don't allow this" allowed
// the switch's permission, "Don't open it" opened the link, "Not React Native" chose React Native)
test("a form's answer: words that hold a label pick nothing, and go to the agent as its words where the question takes them", () => {
  const plan = fromCursorPlan({ name: "Add auth", overview: "" });
  const planAsked = clientQuestions(plan)[0].prompt;
  for (const said of ["Don't accept", claudeSaid([[planAsked, "Don't accept"]])]) {
    const a = answerFromText(plan, said);
    assert.deepEqual(a, { outcome: "rejected", reason: "Don't accept" });
    assert.deepEqual(toCursorPlan(a), { outcome: { outcome: "rejected", reason: "Don't accept" } }, "the agent hears them as the reason");
  }
  assert.deepEqual(answerFromText(plan, claudeSaid([[planAsked, "Accept"]])), { outcome: "accepted" });

  const judged = fromJudged({ agent: "Gemini", tool: "bash", words: QUESTION, command: "npm test" });
  for (const said of ["Don't allow this", claudeSaid([[QUESTION, "Don't allow this"]])]) {
    const a = answerFromText(judged, said);
    assert.deepEqual(a, { outcome: "answered", answers: { permission: { chosen: [], words: "Don't allow this" } } });
    assert.deepEqual(toPermission(a), { outcome: { outcome: "cancelled" } }, "no option chosen");
  }
  assert.deepEqual(answerFromText(judged, claudeSaid([[QUESTION, "Allow"]])), { outcome: "answered", answers: { permission: { chosen: ["allow"] } } });

  const way = fromAgentPlan({ title: "Ready to code?", plan: "# Plan", options: [{ optionId: "exit-plan-default", name: "Yes" }, { optionId: "reject", name: "No", kind: "reject_once" }] });
  assert.deepEqual(answerFromText(way, claudeSaid([["Ready to code?", "Yes, build it please"]])), { outcome: "skipped" });
  assert.deepEqual(answerFromText(way, "Yes, build it please"), { outcome: "skipped" });
  assert.deepEqual(answerFromText(way, "Yes, build it"), { outcome: "answered", answers: { permission: { chosen: ["exit-plan-default"] } } });

  const link = fromElicitation({ mode: "url", url: "https://example.com/a", message: "Sign in" });
  assert.deepEqual(answerFromText(link, "Don't open it"), { outcome: "declined" });
  assert.deepEqual(answerFromText(link, "Open it"), { outcome: "accepted" });

  const framework = fromCursorQuestion({ questions: [{ id: "q1", prompt: "Which framework?", options: [{ id: "a", label: "React" }, { id: "b", label: "React Native" }] }] });
  assert.deepEqual(answerFromText(framework, claudeSaid([["Which framework?", "Not React Native"]])), { outcome: "skipped" });
  assert.deepEqual(answerFromText(framework, "react native"), { outcome: "skipped" }, "a label is the label as it was shown");
  assert.deepEqual(answerFromText(framework, claudeSaid([["Which framework?", "React Native"]])), { outcome: "answered", answers: { q1: { chosen: ["b"] } } });

  const db = fromElicitation({
    mode: "form",
    message: "Which database?",
    requestedSchema: {
      properties: {
        question_0: { type: "string", title: "Database", oneOf: [{ const: "Postgres", title: "Postgres" }, { const: "SQLite", title: "SQLite" }] },
        question_0_custom: { type: "string", title: "Other" },
      },
    },
  });
  const a = answerFromText(db, claudeSaid([["Which database?", "Not SQLite"]]));
  assert.deepEqual(a, { outcome: "answered", answers: { question_0: { chosen: [], words: "Not SQLite" } } });
  assert.deepEqual(toElicitation(db, a), { action: "accept", content: { question_0_custom: "Not SQLite" } }, "the agent hears them in the field for its words");
});

// (fails before: no — a guard on the pairs as the new reader splits them: each question's answer runs to the next pair,
// and words beside a list's labels choose nothing)
test("Claude Code's pairs: each question's answer is its own pair, a list of several its labels joined", () => {
  const f = fromCursorQuestion({
    questions: [
      { id: "db", prompt: "Which database?", options: [{ id: "pg", label: "Postgres" }, { id: "lite", label: "SQLite" }] },
      { id: "extras", prompt: "Which extras?", options: [{ id: "auth", label: "Auth" }, { id: "jobs", label: "Jobs" }], allowMultiple: true },
    ],
  });
  assert.deepEqual(answerFromText(f, claudeSaid([["Which database?", "SQLite"], ["Which extras?", "Auth, Jobs"]])), {
    outcome: "answered",
    answers: { db: { chosen: ["lite"] }, extras: { chosen: ["auth", "jobs"] } },
  });
  assert.deepEqual(answerFromText(f, claudeSaid([["Which database?", "Don't use SQLite"], ["Which extras?", "Auth, not Jobs"]])), {
    outcome: "answered",
    answers: { extras: { chosen: ["auth"] } },
  });
  assert.deepEqual(answerFromText(f, "SQLite, Auth"), { outcome: "skipped" }, "two questions answered in words name neither");
});
