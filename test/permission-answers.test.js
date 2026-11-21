// @ts-check
// A permission is answered by the person's press, never by their words (the owner's rule: no behaviour behind what the
// person types). The card's Allow and Always allow send `allow: true` with the message; Deny sends `allow: false` with
// its words, which never run the call, and any other message typed while a call waits is a refusal the agent reads in
// those words. The /allow command alone allows — a client that draws no card has no other way. Before, `answerAllows` read the words: Deny with "Okay, use pnpm" opened with a yes-word and
// ran the call the person had just denied.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { permissionBlock } from "../src/ui/harness/conversation/interaction.js";
import { answerControls, questionChoices, questionOf } from "../src/ui/harness/conversation/decisions.js";
import { askWords } from "../src/ui/harness/lib/team.js";
import { queueState, queueAdd, queuedAnswer } from "../src/ui/harness/composer/queue.js";
import { keptQueues } from "../src/ui/harness/composer/kept-queue.js";

const text = (/** @type {any[]} */ blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
const results = (/** @type {any[]} */ msgs) => {
  const m = msgs.at(-1);
  return Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ c) => c?.type === "tool_result") : [];
};
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the card's answers are presses", () => {
  const rows = (/** @type {any} */ el) => buttonsOf(el).filter((b) => String(b.attrs.class || "").split(/\s+/).includes("ix-option"));

  // (fails before: yes — Deny sent its feedback as the answer's words, and "Okay, use pnpm" read as a yes)
  test("the permission block: Allow and Always allow say allow; Deny says no, whatever its words are", () => {
    /** @type {any[]} */
    const sent = [];
    /** @type {any[]} */
    const always = [];
    const offer = { itemId: 7, tool: "bash", shape: "npm test" };
    const el = /** @type {any} */ (permissionBlock({ paused: { kind: "permission", tool: "bash", question: "Run it?", offer } }, { onAnswer: (a) => sent.push(a), onAlways: (o) => always.push(o) }, { h: fakeH }));
    el.dispatch("keydown", { key: "Enter", target: null });
    assert.deepEqual(sent.at(-1), { allow: true, words: "" }, "Allow");
    rows(el)[1].dispatch("dblclick");
    assert.deepEqual([always.at(-1), sent.at(-1)], [offer, { allow: true, words: "" }], "Always allow");
    const feedback = el.querySelector(".ix-feedback");
    for (const words of ["Okay, use pnpm", "Go with yarn", "yes", "allow"]) {
      rows(el)[2].dispatch("click");
      feedback.value = ` ${words} `;
      buttonsOf(el).at(-1).dispatch("click");
      assert.deepEqual(sent.at(-1), { allow: false, words }, `Deny with "${words}"`);
    }
    feedback.value = "";
    buttonsOf(el).at(-1).dispatch("click");
    assert.deepEqual(sent.at(-1), { allow: false, words: "" }, "Deny with no words");
  });

  // (fails before: yes — an agent's always was put as Allow "only this time", the project's always-allow beside it)
  test("the permission block for an agent that offers only to always allow it: Allow always, why, and nothing of the project's", () => {
    /** @type {any[]} */
    const sent = [];
    const offer = { itemId: 7, tool: "bash", shape: "make" };
    const el = /** @type {any} */ (permissionBlock({ paused: { kind: "permission", tool: "coder · bash", command: "make", question: "May I run this command?", offer, always: true } }, { onAnswer: (a) => sent.push(a) }, { h: fakeH }));
    assert.deepEqual(rows(el).map((r) => textOf(r)), ["Allow always|it runs calls like it without asking again this session", "Deny|reject it for now"]);
    assert.match(textOf(el), /The agent offers only to always allow this: once allowed, it runs calls like it without asking again for the rest of its session/);
    el.dispatch("keydown", { key: "Enter", target: null });
    assert.deepEqual(sent.at(-1), { allow: true, words: "" });
  });

  // (fails before: yes — a worker's Allow sent the word "yes", and Deny's why rode behind "No: " so an ok in it was no yes)
  test("a worker's answers: Allow says allow, Deny says no with its why as it was typed", async () => {
    /** @type {any[]} */
    const sent = [];
    const o = {
      id: "w1",
      who: "the builder",
      offer: null,
      answer: (/** @type {string} */ id, /** @type {any} */ a) => { sent.push([id, a]); return Promise.resolve(false); },
      always: () => Promise.resolve(true),
      place: (/** @type {any} */ p, /** @type {any[]} */ k) => p.replaceChildren(...k),
    };
    const c = answerControls(fakeH, o);
    const btn = (/** @type {string} */ label) => /** @type {any} */ (buttonsOf(c.el).find((b) => textOf(b) === label));
    btn("Allow").dispatch("click");
    await settle();
    assert.deepEqual(sent.at(-1), ["w1", { allow: true, words: "" }]);
    btn("Deny").dispatch("click");
    const why = /** @type {any} */ (c.el).querySelector(".ask-why");
    why.value = "ok, go ahead with yarn";
    why.dispatch("keydown", { key: "Enter" });
    await settle();
    assert.deepEqual(sent.at(-1), ["w1", { allow: false, words: "ok, go ahead with yarn" }]);
  });

  // (fails before: yes — a question its chat on another machine asks drew Allow and Deny, and Allow sent "yes" there as
  // its answer; its words read "wants to use ask")
  test("a question another machine's chat asks: its choices answer it by their number, Other… by words; no Allow or Deny", async () => {
    /** @type {any[]} */
    const sent = [];
    const asking = { kind: "question", tool: "ask", args: "", question: "On Workstation, it asks: Which colour?", options: ["red", "blue"], machine: "Workstation", n: 1 };
    const o = {
      id: "sa_1",
      who: "Helper",
      n: asking.n,
      offer: null,
      answer: (/** @type {string} */ id, /** @type {any} */ a) => { sent.push([id, a]); return Promise.resolve(false); },
      always: () => Promise.resolve(true),
      place: (/** @type {any} */ p, /** @type {any[]} */ k) => p.replaceChildren(...k),
      choices: questionChoices(asking),
    };
    const c = answerControls(fakeH, o);
    const labels = () => buttonsOf(c.el).map((b) => textOf(b));
    const btn = (/** @type {string} */ label) => /** @type {any} */ (buttonsOf(c.el).find((b) => textOf(b) === label));
    assert.deepEqual(labels(), ["red", "blue", "Other…"]);
    btn("blue").dispatch("click");
    await settle();
    assert.deepEqual(sent.at(-1), ["sa_1", { allow: false, words: "blue", choice: "2", ask: 1 }]);
    btn("Other…").dispatch("click");
    const why = /** @type {any} */ (c.el).querySelector(".ask-why");
    why.value = "  ";
    why.dispatch("keydown", { key: "Enter" });
    await settle();
    assert.equal(sent.length, 1, "no words, nothing sent");
    why.value = " green, if it has one ";
    btn("Send").dispatch("click");
    await settle();
    assert.deepEqual(sent.at(-1), ["sa_1", { allow: false, words: "green, if it has one", ask: 1 }]);
    // Its words are its question's; a permission's choices are none, and its answers Allow and Deny.
    assert.deepEqual(askWords(/** @type {any} */ (asking)), { verb: "On Workstation, it asks: Which colour?", what: "", whole: "" });
    assert.equal(questionChoices({ kind: "permission", tool: "bash" }), null);
    assert.deepEqual(questionChoices({ kind: "question", question: "Why?" }), []);
    const plain = answerControls(fakeH, { ...o, choices: questionChoices({ tool: "bash", args: "ls" }) });
    assert.deepEqual(buttonsOf(plain.el).map((b) => textOf(b)), ["Deny", "Allow"]);
  });

  // (fails before: yes — the review of the s-asks hunt's fix: Cancel on a question's Other… sent the focus to a Deny
  // that is not drawn, Enter that ended a composition sent the words half typed, and Other… stood where the question
  // takes its choices alone)
  test("a question's Other…: Cancel and Escape give the focus back to it, Enter mid-composition sends nothing; none where words answer it not", async () => {
    /** @type {any[]} */
    const sent = [];
    const asking = { kind: "question", question: "Which colour?", options: ["red", "blue"], n: 3 };
    const o = {
      id: "sa_1",
      who: "Helper",
      n: asking.n,
      offer: null,
      answer: (/** @type {string} */ id, /** @type {any} */ a) => { sent.push([id, a]); return Promise.resolve(false); },
      always: () => Promise.resolve(true),
      place: (/** @type {any} */ p, /** @type {any[]} */ k) => p.replaceChildren(...k),
    };
    const c = answerControls(fakeH, { ...o, ...questionOf(asking) });
    const btn = (/** @type {string} */ label) => /** @type {any} */ (buttonsOf(c.el).find((b) => textOf(b) === label));
    const other = btn("Other…");
    for (const leave of [() => btn("Cancel").dispatch("click"), () => c.el.querySelector(".ask-why").dispatch("keydown", { key: "Escape" })]) {
      other.focused = false;
      other.dispatch("click");
      const why = /** @type {any} */ (c.el).querySelector(".ask-why");
      why.value = "gre";
      why.dispatch("keydown", { key: "Enter", isComposing: true });
      why.dispatch("keydown", { key: "Enter", keyCode: 229 });
      await settle();
      assert.deepEqual(sent, [], "a composition's Enter sends nothing");
      leave();
      assert.deepEqual([other.focused, buttonsOf(c.el).map((b) => textOf(b))], [true, ["red", "blue", "Other…"]]);
    }
    other.dispatch("click");
    const why = /** @type {any} */ (c.el).querySelector(".ask-why");
    why.dispatch("keydown", { key: "Enter" });
    await settle();
    assert.deepEqual(sent.at(-1), ["sa_1", { allow: false, words: "gre", ask: 3 }], "Enter, the composition done, sends");
    // A question that takes its choices alone has no Other….
    assert.deepEqual(questionOf({ ...asking, words: false }), { choices: ["red", "blue"], words: false });
    assert.deepEqual(questionOf({ kind: "permission", tool: "bash" }), {});
    const alone = answerControls(fakeH, { ...o, ...questionOf({ ...asking, words: false }) });
    assert.deepEqual(buttonsOf(alone.el).map((b) => textOf(b)), ["red", "blue"]);
  });

  // (fails before: yes — a press that waited in the queue, or across a reload, went as its words alone: Allow's "yes"
  // answered the call Not run, and Deny's words lost their no)
  test("a press that waits in the queue keeps it, across a reload too; Deny's no is kept as a no", () => {
    for (const allow of [true, false]) {
      const st = queueState();
      queueAdd(st, [{ text: allow ? "yes" : "/allow", files: [], ...queuedAnswer({ ours: true, allow }) }]);
      assert.deepEqual(queuedAnswer(st.items[0]), { allow }, "queued with its press");
      const store = new Map();
      const kept = keptQueues({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) });
      kept.keep("c1", st.items);
      assert.deepEqual(queuedAnswer(kept.take("c1").items[0]), { allow }, "kept across a reload");
    }
    assert.deepEqual(queuedAnswer({ text: "hi", files: [] }), {}, "a message with no press carries none");
  });
});

describe("the loop runs a waiting call on the press alone", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-permission-answers-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true });
  });
  const create = async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return (await r.json()).id;
  };
  const turn = async (/** @type {string} */ id, /** @type {any} */ body) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { stream: false, ...body } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return await r.json();
  };
  /**
   * A model that asks to write a file with a command, then says what came back. → what the second round read.
   * @param {string} file
   */
  const asking = (file) => {
    const seen = { result: "" };
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("c1", "bash", { command: `node -e "require('fs').writeFileSync('${file}','1')"` })], "tool_use");
      seen.result = String(results(call.body.messages)[0]?.content ?? "");
      return reply([{ type: "text", text: "Done." }]);
    };
    return seen;
  };

  // (fails before: yes — "Okay, use pnpm" opened with a yes-word and carried no qualifier: the denied call ran)
  test("Deny's words, a bare yes, or any message typed while a call waits: the call is not run, and the agent reads the words", async () => {
    for (const [file, words] of [["deny-pnpm.txt", "Okay, use pnpm"], ["deny-yarn.txt", "Go with yarn"], ["typed-yes.txt", "yes"]]) {
      const id = await create();
      const seen = asking(file);
      up.reset();
      const r1 = await turn(id, { content: "write the file" });
      assert.match(text(r1.content), /May I run this command\?/);
      await turn(id, { content: words });
      assert.equal(existsSync(join(root, file)), false, `"${words}" ran nothing`);
      assert.match(seen.result, /^Not run: the developer declined/, `"${words}"`);
      assert.ok(seen.result.includes(words), "the agent reads their words");
    }
  });

  test("the press runs it: allow with the message", async () => {
    const id = await create();
    const seen = asking("allowed.txt");
    up.reset();
    await turn(id, { content: "write the file" });
    await turn(id, { content: "yes", allow: true });
    assert.equal(existsSync(join(root, "allowed.txt")), true);
    assert.doesNotMatch(seen.result, /Not run/);
  });

  // (fails before: yes — Deny's words went as a message with no press, and "/allow" typed in its box ran the call)
  test("Deny's press runs nothing whatever its words: /allow among them; typed alone, /allow runs it", async () => {
    let id = await create();
    let seen = asking("denied-allow.txt");
    up.reset();
    await turn(id, { content: "write the file" });
    await turn(id, { content: "/allow", allow: false });
    assert.equal(existsSync(join(root, "denied-allow.txt")), false, "Deny with /allow ran nothing");
    assert.match(seen.result, /^Not run: the developer declined/);
    id = await create();
    seen = asking("typed-allow.txt");
    up.reset();
    await turn(id, { content: "write the file" });
    await turn(id, { content: "/allow" });
    assert.equal(existsSync(join(root, "typed-allow.txt")), true, "the command typed alone runs it");
  });

  // (fails before: yes — a client that draws no card answered in words, and "ok" ran the call)
  test("a client that draws no card: /allow runs the call, any other words refuse it", async () => {
    const H = { "x-filament-cwd": root, "x-session-id": `s-${Math.random().toString(36).slice(2, 8)}` };
    const ask = (/** @type {any[]} */ messages) => shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, stream: false, messages }, H);
    let seen = asking("client-ok.txt");
    up.reset();
    const j1 = await (await ask([{ role: "user", content: "write it" }])).json();
    assert.match(text(j1.content), /\/allow/, "the question says how to allow it");
    await (await ask([{ role: "user", content: "write it" }, { role: "assistant", content: j1.content }, { role: "user", content: "ok" }])).json();
    assert.equal(existsSync(join(root, "client-ok.txt")), false);
    assert.match(seen.result, /^Not run: the developer declined/);
    H["x-session-id"] = `s-${Math.random().toString(36).slice(2, 8)}`;
    seen = asking("client-allow.txt");
    up.reset();
    const j2 = await (await ask([{ role: "user", content: "write it" }])).json();
    await (await ask([{ role: "user", content: "write it" }, { role: "assistant", content: j2.content }, { role: "user", content: " /allow " }])).json();
    assert.equal(existsSync(join(root, "client-allow.txt")), true);
  });

  test("a client cannot send the press: the allow header is the house's alone", async () => {
    const { HOUSE_ONLY_HEADERS } = await import("../src/services/house.js");
    assert.ok(HOUSE_ONLY_HEADERS.includes("x-filament-allow"));
  });
});
