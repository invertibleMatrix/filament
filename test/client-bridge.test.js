import { test } from "node:test";
import assert from "node:assert/strict";
import { ClientToolset, extractToolResults, newestUserText, isActionId, newActionId } from "../src/client-bridge.js";
import { shellQuote } from "../src/adapters/tools/shell.js";
import { fromCodexQuestion, fromCursorPlan, fromCursorQuestion } from "../src/adapters/agents/asks.js";

const OAI = { tools: [{ type: "function", function: { name: "Read", parameters: { type: "object", properties: { file_path: {}, offset: {}, limit: {} } } } }, { type: "function", function: { name: "Bash", parameters: { type: "object", properties: { command: {}, timeout: {}, description: {} } } } }, { type: "function", function: { name: "AskUserQuestion", parameters: { type: "object", properties: { questions: {} } } } }, { type: "function", function: { name: "TodoWrite", parameters: { type: "object", properties: { todos: {} } } } }] };

test("ClientToolset recognises roles in both wire formats and builds calls that fit the client's schema", () => {
  const t = ClientToolset.from("openai", OAI);
  assert.deepEqual(t.summary(), ["ask", "todo", "read", "bash"]); assert.equal(t.has("write"), false);
  assert.deepEqual(t.buildRead({ path: "H:/x/a.js", line: 10, limit: 5 }), { name: "Read", input: { file_path: "H:/x/a.js", offset: 10, limit: 5 } });
  const b = t.buildBash({ command: "npm", args: ["test", "--", "--grep", "a b"], cwd: "C:\\proj", timeoutMs: 5000 });
  assert.equal(b.input.command, "cd C:/proj && npm test -- --grep 'a b'"); assert.equal(b.input.timeout, 5000);
  const a = t.buildAsk({ question: "Allow?", options: [{ optionId: "y", name: "Allow", kind: "allow_once" }, { optionId: "n", name: "Reject", kind: "reject_once" }] });
  assert.equal(a.name, "AskUserQuestion"); assert.deepEqual(a.input.questions[0].options.map((o) => o.label), ["Allow", "Reject"]);
  const todo = t.buildTodo([{ content: "x", status: "in_progress", priority: "high" }]); assert.equal(todo.input.todos[0].activeForm, "x");
  const anth = ClientToolset.from("anthropic", { tools: [{ name: "Write", input_schema: { type: "object", properties: { file_path: {}, content: {} } } }] });
  assert.deepEqual(anth.buildWrite({ path: "a.txt", content: "hi" }), { name: "Write", input: { file_path: "a.txt", content: "hi" } });
  assert.equal(ClientToolset.from("openai", {}).size, 0);
});

test("results from the client are read in their machine format, a choice by its exact label alone (a3)", () => {
  const opts = [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "always", name: "Allow always", kind: "allow_always" }, { optionId: "no", name: "Reject", kind: "reject_once" }];
  assert.equal(ClientToolset.parseAskAnswer('{"answers":{"Allow?":"Allow always"}}', opts), "always");
  assert.equal(ClientToolset.parseAskAnswer("Reject", opts), "no");
  assert.equal(ClientToolset.parseAskAnswer("User selected: Reject", opts), null);
  assert.equal(ClientToolset.parseAskAnswer("yes go ahead", opts), null);
  assert.equal(ClientToolset.parseAskAnswer("", opts), null);
  assert.equal(ClientToolset.parseReadResult("     1\tfoo\n     2\tbar\n"), "foo\nbar\n");
  assert.equal(ClientToolset.parseReadResult("plain text\nno numbers"), "plain text\nno numbers");
  assert.deepEqual(ClientToolset.parseBashResult("boom\nExit code: 2"), { output: "boom\nExit code: 2", exitCode: 2 });
  assert.equal(ClientToolset.parseBashResult("fine").exitCode, 0); assert.equal(ClientToolset.parseBashResult("Error: nope", true).exitCode, 1);
});

test("a permission's answer is read in its own part, never in the question it repeats (fails before: yes — the question's \"Allow it?\" made every answer an Allow)", () => {
  const opts = [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "reject", name: "Reject", kind: "reject_once" }];
  const question = "Claude Code wants to edit a.js. Allow it?";
  const said = (/** @type {string} */ a) => `User has answered your questions: "${question}"="${a}". You can now continue with the user's answers in mind.`;
  assert.equal(ClientToolset.parseAskAnswer(said("Reject"), opts, question), "reject");
  assert.equal(ClientToolset.parseAskAnswer(said("Allow"), opts, question), "allow");
  // Without the question's words, the one pair is the one question's answer: its words name both sides, its pair one.
  assert.equal(ClientToolset.parseAskAnswer(said("Reject"), opts), "reject");
  // The longest label it names is the answer, and words that allow and refuse at once are none.
  const always = [{ optionId: "always", name: "Allow always", kind: "allow_always" }, ...opts];
  assert.equal(ClientToolset.parseAskAnswer(said("Allow always"), always, question), "always");
  assert.equal(ClientToolset.parseAskAnswer("yes, no", opts), null);
});

test("a permission's answer is read against the options its question showed: Claude Code's first four, another client's every one (fails before: yes — the bug hunt of 10-30: four shown, every one matched by its name)", () => {
  const five = [
    { optionId: "once", name: "Allow", kind: "allow_once" },
    { optionId: "always", name: "Allow always", kind: "allow_always" },
    { optionId: "no", name: "Reject", kind: "reject_once" },
    { optionId: "never", name: "Reject always", kind: "reject_always" },
    { optionId: "server", name: "Trust this server", kind: "allow_always" },
  ];
  const question = "Gemini wants to run x. Allow it?";
  const said = (/** @type {string} */ a) => `User has answered your questions: "${question}"="${a}". You can now continue with the user's answers in mind.`;
  const cc = ClientToolset.from("openai", OAI);
  const shown = cc.askShown(five);
  assert.deepEqual(shown.map((o) => o.optionId), ["once", "always", "no", "never"]);
  assert.deepEqual(cc.buildAsk({ question, options: five }).input.questions[0].options.map((/** @type {any} */ o) => o.label), shown.map((o) => o.name), "the question shows those");
  // The fifth, never shown, is never picked by its name: typed as Other, or sent back by its id.
  assert.equal(ClientToolset.parseAskAnswer(said("Trust this server"), five, question, shown), null);
  assert.equal(ClientToolset.parseAskAnswer('{"answers":{"q":"server"}}', five, question, shown), null);
  // Those it showed answer as they did; plain words pick nothing, by kind or otherwise (a3).
  assert.equal(ClientToolset.parseAskAnswer(said("Allow always"), five, question, shown), "always");
  assert.equal(ClientToolset.parseAskAnswer(said("Reject"), five, question, shown), "no");
  assert.equal(ClientToolset.parseAskAnswer(said("yes"), five, question, shown), null);
  // Another client's one question shows every option, and any of them answers.
  const other = ClientToolset.from("anthropic", { tools: [{ name: "AskUserQuestion", input_schema: { type: "object", properties: { question: {}, options: {} } } }] });
  assert.equal(other.askShown(five).length, 5);
  assert.deepEqual(other.buildAsk({ question, options: five }).input.options, five.map((o) => o.name));
  assert.equal(ClientToolset.parseAskAnswer(said("Trust this server"), five, question, other.askShown(five)), "server");
});

test("tool results and fresh text are told apart in both formats", () => {
  const id = newActionId(); assert.ok(isActionId(id) && !isActionId("toolu_123"));
  const o = { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: null, tool_calls: [{ id }] }, { role: "tool", tool_call_id: id, content: "Allow" }] };
  assert.deepEqual(extractToolResults("openai", o), [{ id, text: "Allow", isError: false }]); assert.equal(newestUserText("openai", o), "");
  const a = { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "tool_use", id, name: "Read", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: "1\tx" }], is_error: true }] }] };
  assert.deepEqual(extractToolResults("anthropic", a), [{ id, text: "1\tx", isError: true }]);
  assert.equal(newestUserText("anthropic", { messages: [{ role: "user", content: [{ type: "text", text: "next" }] }] }), "next");
  assert.equal(shellQuote("it's"), "'it'\\''s'"); assert.equal(shellQuote("plain-ok_1"), "plain-ok_1");
});

test("an agent's questions go to the client's question tool in one call, where they fit its shape (AC2-4)", () => {
  const claude = ClientToolset.from("openai", OAI);
  const framework = { id: "q1", prompt: "Which framework?", options: [{ id: "a", label: "React" }, { id: "b", label: "Vue" }] };
  const tests = { id: "q2", prompt: "Which tests?", options: [{ id: "u", label: "Unit" }, { id: "e", label: "End to end" }], allowMultiple: true };
  const two = fromCursorQuestion({ questions: [framework, tests] }, { agent: "Cursor Agent CLI" });
  assert.deepEqual(
    claude.buildQuestions(two),
    {
      name: "AskUserQuestion",
      input: {
        questions: [
          { question: "Which framework?", header: "Cursor Agent", options: [{ label: "React", description: "" }, { label: "Vue", description: "" }], multiSelect: false },
          { question: "Which tests?", header: "Cursor Agent", options: [{ label: "Unit", description: "" }, { label: "End to end", description: "" }], multiSelect: true },
        ],
      },
    },
    "Claude Code's takes them all at once, each headed by the agent's name in its twelve characters",
  );
  const plan = claude.buildQuestions(fromCursorPlan({ name: "Add auth" }));
  assert.deepEqual(plan?.input.questions.map((q) => [q.question, q.header, q.options.map((o) => o.label)]), [["Accept the plan “Add auth”?", "Plan", ["Accept", "Reject"]]]);
  const one = fromCursorQuestion({ questions: [{ id: "q", prompt: "Go on?", options: [{ id: "y", label: "Yes" }] }] });
  assert.equal(claude.buildQuestions(one), null, "one choice doesn't fit its two to four");
  const five = fromCursorQuestion({ questions: [1, 2, 3, 4, 5].map((n) => ({ ...framework, id: `q${n}` })) });
  assert.equal(claude.buildQuestions(five), null, "nor do five questions its four");
  assert.equal(claude.buildQuestions(fromCodexQuestion({ questions: [{ id: "token", question: "Your token?", isSecret: true }] })), null, "a secret stays out of the chat's words");
  const askUser = ClientToolset.from("openai", { tools: [{ type: "function", function: { name: "ask_user", parameters: { type: "object", properties: { question: {}, options: {} } } } }] });
  assert.deepEqual(askUser.buildQuestions(fromCursorQuestion({ questions: [framework] })), { name: "ask_user", input: { question: "Which framework?", options: ["React", "Vue"] } });
  assert.equal(askUser.buildQuestions(two), null, "another client's takes one question");
  assert.equal(ClientToolset.from("openai", {}).buildQuestions(two), null, "a client with no question tool");
});
