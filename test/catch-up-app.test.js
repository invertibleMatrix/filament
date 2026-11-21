// @ts-check
// HarnessV4_Tasks E15 step 7, through the app: Catch me up (design cases 9, 33) — a start that brings its own question,
// answered by Reviewer as its card in the chat, over the session since your last message, from the page's route and
// from `/subagent start=catchup`. The agents that started by themselves went on the owner's word of 11-05.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";
import { until } from "./helpers/wait.js";
import { CATCH_UP_TASK, SUBAGENT_STARTS } from "../src/services/subagent-starts.js";
import { chosen, draftOn, launchBody } from "../src/ui/harness/lib/side.js";

/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));
/** The calls a request's newest message answers. @param {any} c */
const answersTo = (c) => (Array.isArray(c.body?.messages?.at(-1)?.content) ? c.body.messages.at(-1).content : []).filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id);
/** Words of the developer's own in place of Catch me up's question. */
const MINE = "What failed since then?";
/** A session's first words that have the fake provider say its requests were read from its cache. */
const WARM = "WARM:";

/** @type {string} */ let folder;
/** @type {any} */ let up;
/** @type {any} */ let shim;

before(async () => {
  folder = mkdtempSync(join(tmpdir(), "filament-self-app-"));
  writeFileSync(join(folder, "notes.txt"), "hello\n");
  up = await fakeUpstream(async (call) => {
    const lastText = textOf((call.body?.messages || []).at(-1));
    const model = String(call.body?.model || "");
    // A session whose first message says WARM is read from the provider's cache: its replies say so.
    const warm = JSON.stringify(call.body?.messages?.[0]?.content ?? "").includes(WARM);
    const blocks = (/** @type {any[]} */ b, stop = "end_turn") => anthropicReply("", { model, stop, blocks: b, usage: { input_tokens: 50, output_tokens: 7, ...(warm ? { cache_read_input_tokens: 2000 } : {}) } });
    if (lastText.includes(CATCH_UP_TASK)) return blocks([{ type: "text", text: "CAUGHT UP: the notes were read; nothing waits for you." }]);
    if (lastText.includes(MINE)) return blocks([{ type: "text", text: "NOTHING FAILED." }]);
    if (answersTo(call).includes("toolu_w1")) return blocks([{ type: "text", text: "MAIN DONE: the notes say hello." }]);
    if (answersTo(call).includes("toolu_c1")) return blocks([{ type: "text", text: "CHECK DONE: it printed checked." }]);
    if (answersTo(call).includes("toolu_r1")) return blocks([{ type: "text", text: "Running the check." }, { type: "tool_use", id: "toolu_c1", name: "bash", input: { command: `node -e "console.log('checked')"` } }], "tool_use");
    if (/run the check/.test(lastText)) return blocks([{ type: "text", text: "Reading the notes first." }, { type: "tool_use", id: "toolu_r1", name: "read", input: { path: "notes.txt" } }], "tool_use");
    if (/do work/.test(lastText)) return blocks([{ type: "text", text: "Reading the notes." }, { type: "tool_use", id: "toolu_w1", name: "read", input: { path: "notes.txt" } }], "tool_use");
    return blocks([{ type: "text", text: `ANSWER TO ${lastText}` }]);
  });
  shim = await startApp({
    memory: true,
    keep: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
      cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  for (const dir of [shim.dataDir, folder]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

const at = (/** @type {string} */ id, rest = "") => `/api/sessions/${encodeURIComponent(id)}${rest}`;
/** @param {object} [settings] */
const newSession = async (settings) => {
  const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain", ...(settings ? { settings } : {}) } });
  assert.equal(s.status, 200, await s.clone().text());
  return String((await s.json()).id);
};
/** @param {string} id @param {string} content */
const say = async (id, content) => {
  const t = await shim.api(at(id, "/turns"), { method: "POST", body: { content, stream: false } });
  assert.equal(t.status, 200, await t.clone().text());
  return t.json();
};
/** The session's marks of its saved agents, oldest first. @param {string} id @returns {Promise<any[]>} */
const marksOf = async (id) => ((await (await shim.api(at(id, "/transcript"))).json()).boundaries || []).filter((/** @type {any} */ b) => b.type === "subagent" && b.card);
/** The requests the model got since `mark` whose newest message holds `words`. @param {number} mark @param {string} words */
const sentSince = (mark, words) => up.received.slice(mark).filter((/** @type {any} */ c) => textOf((c.body?.messages || []).at(-1)).includes(words));

// (fails before: yes — step 7, AG-206: no start brought a question of its own, and none read the session from a turn on)
test("Catch me up: Reviewer is asked what happened since your last message and answers as its card, from the page's route and from the command (cases 9, 33)", async () => {
  const id = await newSession();
  await say(id, "first question");
  await say(id, "do work on the notes");
  const mark = up.received.length;
  const r = await shim.api(at(id, "/subagents"), { method: "POST", body: { start: "catchup", prompt: "" } });
  assert.equal(r.status, 200, await r.clone().text());
  const made = (await r.json()).subagent;
  assert.deepEqual([made.card.tag, made.asked, made.origin, made.may, made.aside, made.description], ["reviewer", true, "owner", "read", true, "Catch me up"]);
  await until(async () => (await (await shim.api(at(id, `/subagents/${made.id}`))).json()).subagent?.status === "done", "Reviewer's five lines");
  const sent = sentSince(mark, CATCH_UP_TASK);
  assert.equal(sent.length, 1);
  const shown = textOf(sent[0].body.messages.at(-1));
  assert.ok(shown.includes("do work on the notes") && shown.includes("MAIN DONE: the notes say hello."), "it reads the turn your last message opened");
  assert.ok(!shown.includes("first question"), "and nothing before it");
  const marks = await marksOf(id);
  assert.deepEqual(marks.map((m) => [m.event, m.card.tag, m.asked, m.self ?? false, m.question]), [
    ["dispatch", "reviewer", true, false, CATCH_UP_TASK],
    ["arrival", "reviewer", true, false, CATCH_UP_TASK],
  ]);
  assert.equal(marks[1].answer, "CAUGHT UP: the notes were read; nothing waits for you.");
  // A session with one turn: "since your last message" is that turn (case 33).
  const one = await newSession();
  await say(one, "do work on the notes");
  const again = await shim.api(at(one, "/subagents"), { method: "POST", body: { start: "catchup", prompt: "" } });
  assert.equal(again.status, 200, await again.clone().text());
  // The command, for any client; another start still needs a task.
  const cmd = await say(id, "/subagent start=catchup");
  assert.match(JSON.stringify(cmd), /Catch me up/);
  const none = await say(id, "/subagent start=ask");
  assert.match(JSON.stringify(none), /needs a task|a task/i);
  // A start that brings no task is still refused without one, at the route.
  const bare = await shim.api(at(id, "/subagents"), { method: "POST", body: { start: "ask", prompt: "" } });
  assert.equal(bare.status, 400);
});

// (fails before: yes — the owner's of 11-05: "if cache is warm then simply use that fork behind the scene and the models
// and efforts should exactly match the main agent's": Catch me up read the session folded, on Reviewer's model)
test("Catch me up while the main agent's cache is warm: a live copy of its newest request asks the question — its model, system prompt and tools, every message as sent", async () => {
  const id = await newSession();
  await say(id, `${WARM} do work on the notes`);
  const ofTurn = up.received.filter((/** @type {any} */ c) => JSON.stringify(c.body?.messages?.[0]?.content ?? "").includes(WARM));
  const newest = ofTurn.at(-1).body;
  const mark = up.received.length;
  const r = await shim.api(at(id, "/subagents"), { method: "POST", body: { start: "catchup", prompt: "" } });
  assert.equal(r.status, 200, await r.clone().text());
  const made = (await r.json()).subagent;
  assert.deepEqual([made.card.tag, made.view, made.asked], ["reviewer", "fork", true]);
  await until(async () => (await (await shim.api(at(id, `/subagents/${made.id}`))).json()).subagent?.status === "done", "the live copy's five lines");
  const sent = sentSince(mark, CATCH_UP_TASK);
  assert.equal(sent.length, 1);
  const b = sent[0].body;
  /** A request's parts less the cache's marks, which move to its newest message. @param {any} v @returns {any} */
  const bare = (v) => JSON.parse(JSON.stringify(v ?? null, (k, x) => (k === "cache_control" ? undefined : x)));
  assert.deepEqual([b.model, bare(b.system), bare(b.tools), b.thinking ?? null], [newest.model, bare(newest.system), bare(newest.tools), newest.thinking ?? null], "the main agent's model, prompt, tools and thinking");
  assert.deepEqual(bare(b.messages.slice(0, newest.messages.length)), bare(newest.messages), "every message of its newest request, then its reply and the question");
  assert.equal((await marksOf(id)).at(-1)?.answer, "CAUGHT UP: the notes were read; nothing waits for you.", "its answer stands in the chat as Reviewer's");
});

// (fails before: no — the route took a start that asks beside its card's tag already. It pins the launch the Sub Agents
// tab's Send makes since the owner's word of 10-18, that a press never starts an agent: the tile puts the question in
// the box, and Send launches it with the tab's choices and the start named beside them, built by the page's own code)
test("Catch me up sent from the Sub Agents tab: Reviewer is asked over the session since your last message, and words of your own in its place name the thread and see as much", async () => {
  const id = await newSession();
  await say(id, "first question");
  await say(id, "do work on the notes");
  const reviewer = (await (await shim.api("/api/agents")).json()).shipped.find((/** @type {any} */ c) => c.tag === "reviewer");
  const start = SUBAGENT_STARTS.catchup;
  const facts = /** @type {any} */ ({ sessionMemory: true, defaultModel: "m-1", defaultEffort: "max", mainModel: "m-1", turnRuns: false, forkable: false });
  const c = chosen(draftOn(start.id, reviewer.tag), reviewer, start, facts);
  assert.deepEqual([c.start, c.since, c.view, c.level], ["catchup", true, "folded", "read"]);
  for (const [prompt, name] of [[CATCH_UP_TASK, "Catch me up"], [MINE, ""]]) {
    const mark = up.received.length;
    const r = await shim.api(at(id, "/subagents"), { method: "POST", body: launchBody(c, prompt) });
    assert.equal(r.status, 200, await r.clone().text());
    const made = (await r.json()).subagent;
    assert.deepEqual([made.card.tag, made.asked, made.may, made.view, made.description === "Catch me up"], ["reviewer", true, "read", "folded", !!name], prompt);
    await until(async () => (await (await shim.api(at(id, `/subagents/${made.id}`))).json()).subagent?.status === "done", "Reviewer's answer");
    const sent = sentSince(mark, prompt);
    assert.equal(sent.length, 1, prompt);
    const shown = textOf(sent[0].body.messages.at(-1));
    assert.ok(shown.includes("do work on the notes") && !shown.includes("first question"), `${prompt}: it reads the turn your last message opened, and nothing before it`);
  }
});
