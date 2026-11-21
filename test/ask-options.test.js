// @ts-check
// HarnessV3-Tools TL-D11: the loop's `ask` offers choices. One reading of the call (`askOf`) serves the loop, the
// reply every client reads (`askText`) and the transcript a reloaded page reads; the harness draws them as the
// question block's rows, with "Other…" for an answer in the developer's own words. The loop's own run (its ask event,
// its reply, the answer as the tool's result) is in agent-loop.test.js.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ASK_TOOL, askOf, askText } from "../src/app/agent/tools.js";
import { inputBlock, permissionBlock } from "../src/ui/harness/conversation/interaction.js";
import { alignEvents, offerWords, pauseOf } from "../src/ui/harness/lib/labels.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";

describe("the call, read one way", () => {
  // (fails before: yes — there were no options to read)
  test("the schema offers 2–4 choices, each a label and what it means", () => {
    const o = /** @type {any} */ (ASK_TOOL.input_schema.properties).options;
    assert.equal(o.type, "array");
    assert.equal(o.minItems, 2);
    assert.equal(o.maxItems, 4);
    assert.deepEqual(o.items.required, ["label"]);
    assert.ok(o.items.properties.label && o.items.properties.description);
    assert.deepEqual(ASK_TOOL.input_schema.required, ["question"], "the question alone is still a question");
  });

  test("askOf: labels trimmed and unique, at most four, strings taken as labels — and one choice is no choice", () => {
    assert.deepEqual(askOf({ question: "  Which?  " }), { question: "Which?", options: [] });
    assert.deepEqual(askOf({}), { question: "(the model asked a question without text)", options: [] });
    assert.deepEqual(
      askOf({ question: "Q", options: [{ label: " a ", description: " first \n one " }, "b", { label: "A" }, { label: "" }, null, { description: "no label" }] }).options,
      [{ label: "a", description: "first one" }, { label: "b", description: "" }],
      "whitespace squashed; a repeated label (case-blind), an empty one and a broken entry dropped",
    );
    assert.equal(askOf({ question: "Q", options: ["a", "b", "c", "d", "e"] }).options.length, 4);
    assert.deepEqual(askOf({ question: "Q", options: [{ label: "only" }] }).options, [], "a single choice is not offered as one");
    assert.deepEqual(askOf({ question: "Q", options: "a, b" }).options, []);
    assert.ok(askOf({ question: "Q", options: ["x".repeat(500), "y"] }).options[0].label.length <= 80, "a label stays a label");
  });

  test("askText: the question alone, or the question and its numbered choices for any client", () => {
    assert.equal(askText({ question: "Which?", options: [] }), "Which?");
    assert.equal(
      askText({ question: "Which?", options: [{ label: "a", description: "the first" }, { label: "b", description: "" }] }),
      "Which?\n\n1. a — the first\n2. b\n\nAnswer with one of these, or in your own words.",
    );
  });
});

describe("the question block", () => {
  const OPTS = [{ label: "notes.md (recommended)", description: "matches the other files" }, { label: "NOTES.txt", description: "" }];
  const turn = (/** @type {any} */ paused) => ({ paused });
  /** The rows the block offers, in order. @param {any} el */
  const rows = (el) => buttonsOf(el).filter((b) => String(b.attrs.class || "").split(/\s+/).includes("ix-option"));

  // (fails before: yes — the block was a text box only; the choices were not drawn)
  test("its choices are rows, the recommendation chosen first; Enter or the button sends the chosen label", () => {
    /** @type {string[]} */
    const sent = [];
    const el = /** @type {any} */ (inputBlock(turn({ kind: "ask", question: "Which name?", options: OPTS }), { onAnswer: (t) => sent.push(t) }, { h: fakeH }));
    assert.match(textOf(el), /Which name\?/);
    const r = rows(el);
    assert.deepEqual(r.map((x) => textOf(x)), ["notes.md (recommended)|matches the other files", "NOTES.txt", "Other…|answer in your own words"]);
    assert.equal(r[0].attrs["aria-selected"], "true");
    el.dispatch("keydown", { key: "Enter", target: null });
    assert.deepEqual(sent, ["notes.md (recommended)"]);
    el.dispatch("keydown", { key: "ArrowDown", target: null });
    assert.equal(r[1].attrs["aria-selected"], "true");
    const confirm = buttonsOf(el).at(-1);
    assert.equal(confirm.textContent, "NOTES.txt", "the button names what it sends");
    confirm.dispatch("click");
    assert.deepEqual(sent, ["notes.md (recommended)", "NOTES.txt"]);
    r[0].dispatch("dblclick");
    assert.equal(sent.at(-1), "notes.md (recommended)", "a double-click sends that row");
  });

  test("Other… opens the text box; its words are the answer, and an empty one sends nothing", () => {
    /** @type {string[]} */
    const sent = [];
    const el = /** @type {any} */ (inputBlock(turn({ kind: "ask", question: "Which name?", options: OPTS }), { onAnswer: (t) => sent.push(t) }, { h: fakeH }));
    const box = el.querySelector(".ix-feedback");
    assert.ok(box.classList.contains("hidden"), "hidden while a choice is chosen");
    rows(el)[2].dispatch("click");
    assert.ok(!box.classList.contains("hidden"));
    box.value = "   ";
    buttonsOf(el).at(-1).dispatch("click");
    assert.deepEqual(sent, [], "nothing typed, nothing sent");
    box.value = "  call it README  ";
    el.dispatch("keydown", { key: "Enter", target: box });
    assert.deepEqual(sent, [], "Enter in the box is a new line");
    el.dispatch("keydown", { key: "Enter", target: box, ctrlKey: true });
    assert.deepEqual(sent, ["call it README"]);
  });

  test("without choices: the text box, Submit and Dismiss, as before", () => {
    /** @type {string[]} */
    const sent = [];
    const el = /** @type {any} */ (inputBlock(turn({ kind: "ask", question: "Anything else?" }), { onAnswer: (t) => sent.push(t) }, { h: fakeH }));
    assert.equal(rows(el).length, 0);
    const box = el.querySelector(".ix-feedback");
    assert.ok(!box.classList.contains("hidden"));
    box.value = " no ";
    const [dismiss, submit] = buttonsOf(el);
    submit.dispatch("click");
    dismiss.dispatch("click");
    assert.deepEqual(sent, ["no", ""]);
  });

  // (fails before: yes — HarnessV3-Views V3's drive: a permission's question showed Filament's backticks as typed —
  // "May I run this command? `node --version` —" — where the conversation draws code as code)
  test("a question's inline marks are drawn: the permission's and the input block's, as the conversation draws them", () => {
    const drawn = (/** @type {any} */ el) => el.querySelector(".ix-reason").kids.map((/** @type {any} */ k) => (typeof k === "string" ? k : `${k.tag}:${textOf(k)}`));
    const perm = /** @type {any} */ (permissionBlock({ paused: { kind: "permission", tool: "bash", question: "May I run `node --version`? **It** reads only." } }, { onAnswer: () => {} }, { h: fakeH }));
    assert.deepEqual(drawn(perm), ["May I run ", "code:node --version", "? ", "b:It", " reads only."]);
    const ask = /** @type {any} */ (inputBlock(turn({ kind: "ask", question: "Which file: `calc.js` or `ops.js`?" }), { onAnswer: () => {} }, { h: fakeH }));
    assert.deepEqual(drawn(ask), ["Which file: ", "code:calc.js", " or ", "code:ops.js", "?"]);
  });

  // (fails before: yes — the block read the turn's newest permission-offer event, whatever shape it named, and said
  // "the same command"; the ask's own offer is the one for this call)
  test("the permission block keeps its choices on the shared list: Allow first, Deny with its words, Always allow when the ask carries an offer", () => {
    /** @type {any[]} */
    const sent = [];
    /** @type {any[]} */
    const always = [];
    const el = /** @type {any} */ (permissionBlock({ paused: { kind: "permission", tool: "bash", question: "Run it?", offer: { itemId: 7, tool: "bash", shape: "npm test" } } }, { onAnswer: (t) => sent.push(t), onAlways: (id) => always.push(id) }, { h: fakeH }));
    assert.deepEqual(rows(el).map((x) => textOf(x)), ["Allow|only this time", "Always allow in this project|don't ask again to run npm test", "Deny|reject it for now"]);
    const feedback = el.querySelector(".ix-feedback");
    feedback.value = "";
    el.dispatch("keydown", { key: "Enter", target: null });
    assert.deepEqual(sent, [{ allow: true, words: "" }]);
    el.dispatch("keydown", { key: "ArrowUp", target: null });
    assert.ok(!feedback.classList.contains("hidden"), "Deny shows its words");
    feedback.value = " use the other folder ";
    buttonsOf(el).at(-1).dispatch("click");
    assert.deepEqual(sent, [{ allow: true, words: "" }, { allow: false, words: "use the other folder" }]);
    rows(el)[1].dispatch("dblclick");
    assert.deepEqual(always, [{ itemId: 7, tool: "bash", shape: "npm test" }], "the offer goes whole: its item, or its shape where none waits");
    assert.deepEqual(sent.at(-1), { allow: true, words: "" });
    const plain = /** @type {any} */ (permissionBlock({ paused: { kind: "permission", tool: "bash", question: "Run it?" } }, { onAnswer: () => {} }, { h: fakeH }));
    assert.deepEqual(rows(plain).map((x) => textOf(x)), ["Allow|only this time", "Deny|reject it for now"], "no offer: no Always allow");
    // (fails before: yes — HarnessV4_Tasks E3: Always allow showed only where a memory item waited, after five yeses)
    /** @type {any[]} */
    const made = [];
    const first = /** @type {any} */ (permissionBlock({ paused: { kind: "permission", tool: "bash", question: "Run it?", offer: { itemId: null, tool: "bash", shape: "npm test" } } }, { onAnswer: (t) => sent.push(t), onAlways: (o) => made.push(o) }, { h: fakeH }));
    assert.deepEqual(rows(first).map((x) => textOf(x)), ["Allow|only this time", "Always allow in this project|don't ask again to run npm test", "Deny|reject it for now"], "offered at the first ask");
    rows(first)[1].dispatch("dblclick");
    assert.deepEqual(made, [{ itemId: null, tool: "bash", shape: "npm test" }]);
  });

  // (fails before: yes — there were no words for what an always-allow covers)
  test("an offer's words name what it covers: the command, or the kind of file written or edited", () => {
    assert.equal(offerWords({ tool: "bash", shape: "git status" }), "don't ask again to run git status");
    assert.equal(offerWords({ tool: "edit", shape: "*.md" }), "don't ask again to edit *.md files");
    assert.equal(offerWords({ tool: "write", shape: "*.ts" }), "don't ask again to write *.ts files");
    assert.equal(offerWords({ tool: "edit", shape: "(no extension)" }), "don't ask again to edit files without an extension");
  });
});

describe("the page carries the choices to the block", () => {
  const read = (/** @type {string} */ f) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", f), "utf8");

  test("the run's ask keeps its choices through the alignment the timeline reads", () => {
    const al = alignEvents([{ type: "round-start", round: 1 }, { type: "ask", round: 1, kind: "question", tool: "ask", question: "Which?", options: [{ label: "a", description: "" }, { label: "b", description: "" }] }]);
    const ask = [...al.byRound.values()].flatMap((c) => c.asks).at(-1);
    assert.deepEqual(ask.options, [{ label: "a", description: "" }, { label: "b", description: "" }]);
  });

  // (fails before: yes — the live ask and the reloaded pause both reached the block without them)
  test("the live ask and the reloaded pause hand them to the block, each as the turn's pause (pinned in the page's source)", () => {
    assert.match(read("src/ui/harness/conversation/timeline.js"), /api_\.setPaused\(turn, pauseOf\(lastAsk\)\)/);
    assert.match(read("src/ui/harness/app.js"), /last\.paused = pauseOf\(chat\.paused\)/);
  });

  // (fails before: yes — the block took the turn's newest permission-offer event instead, and a reload had none; and,
  // HarnessV3-Views V6-9, the pause each path made kept neither the command whole nor the reason the card shows)
  test("the turn's pause keeps what the block draws: the choices, the offer, a command whole and its reason", () => {
    const offer = { itemId: 7, tool: "bash", shape: "npm test" };
    const question = "May I run this command? `npm test --silent` — answer /allow to run it, or say what to do instead.";
    assert.deepEqual(pauseOf({ type: "ask", round: 2, kind: "permission", tool: "bash", question, command: "npm test \\\n  --silent", reason: "r.", offer, waits: true }),
      { kind: "permission", question, tool: "bash", offer, command: "npm test \\\n  --silent", reason: "r." });
    assert.deepEqual(pauseOf({ kind: "ask", question: "Which?", options: [{ label: "a", description: "" }] }), { kind: "ask", question: "Which?", tool: null, options: [{ label: "a", description: "" }] });
    assert.deepEqual(pauseOf({ kind: "proposal", question: "q", orders: [], requestId: "r1", expires: 9 }), { kind: "proposal", question: "q", tool: null }, "no team's orders ride a pause");
    assert.deepEqual(pauseOf({ question: "Go on?", options: [] }), { kind: "question", question: "Go on?", tool: null });
  });
});

describe("a paused question survives a reload", () => {
  let shim, up;
  before(async () => {
    up = await fakeUpstream(async (call) => {
      const last = (call.body?.messages || []).at(-1);
      const answered = Array.isArray(last?.content) && last.content.some((/** @type {any} */ b) => b?.type === "tool_result");
      return anthropicReply("", {
        model: "m-1",
        stop: answered ? "end_turn" : "tool_use",
        blocks: answered
          ? [{ type: "text", text: "done." }]
          : [{ type: "tool_use", id: "q1", name: "ask", input: { question: "Which name?", options: [{ label: "a", description: "the first" }, { label: "b" }] } }],
        usage: { input_tokens: 5, output_tokens: 3 },
      });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => { await shim.stop(); await up.close(); });

  // (fails before: yes — the transcript said a question waited, but not which, so a reloaded page drew an empty box)
  test("the transcript names the waiting question and its choices; the label sent next is the tool's result", async () => {
    const { id } = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model: "m-1" } })).json();
    const one = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "start" } });
    assert.equal(one.status, 200, await one.text());
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.equal(tr.paused?.kind, "ask", JSON.stringify(tr.paused));
    assert.equal(tr.paused.question, "Which name?");
    assert.deepEqual(tr.paused.options, [{ label: "a", description: "the first" }, { label: "b", description: "" }]);
    const two = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "b" } });
    assert.match(await two.text(), /done\./);
    const result = up.received.at(-1)?.body?.messages?.at(-1)?.content?.find((/** @type {any} */ b) => b?.type === "tool_result");
    assert.equal(result?.content, "b");
    const after = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.equal(after.paused, null, "answered, nothing waits");
  });
});
