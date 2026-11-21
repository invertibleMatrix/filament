// @ts-check
// HarnessV4_SpaceDoor_Plan (E39): the space tool's door. Every request of a chat in a project carries the tool, so its
// words are a door — the everyday five whole, each guided action named in a few words — and `guide` gives the rest
// when asked: its index, each topic whole, a topic said loosely; a guided action's fields in `with` (an object or JSON
// text of one) or beside `action`; a refusal of its fields teaches the call; the chat's card and the trail's line read
// it; a coding agent's call the same; and end to end, a chat's agent reads the guide and proposes a routine through
// `with` in a real Filament.
// (fails before: yes — the tool carried every action's fields and words in every request, ≈1,810 tokens)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSpaceStore } from "../src/services/spaces.js";
import { SPACE_ACTIONS, SPACE_GUIDED, SPACE_SWITCHED_OFF, SPACE_TOOL, SPACE_TOPICS, spaceCall, spaceGuide } from "../src/app/agent/space.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { argSummary } from "../src/app/agent/tools.js";
import { estimateTokens } from "../src/core/tokens.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));

const T = Date.UTC(2026, 9, 26, 8, 0);
/** @param {Partial<import("../src/app/agent/space.js").SpaceAt>} [o] */
const atOf = (o = {}) => ({ store: createSpaceStore({ dir: null, now: () => T }), project: "p1", chain: "c1", name: null, nameOf: (/** @type {string} */ c) => (c === "c1" ? "Release" : c), modelOf: () => "agent/brain-model", ...o });
const ROUTINE = { title: "Morning brief", when: "weekdays 09:00", text: "Read the open PRs and CI; say what needs the person." };
/** @param {any} r */
const words = (r) => (r.ok ? r.text : r.error);

describe("the door every request carries (cases 1, 15, 16)", () => {
  test("the everyday five with their fields each, every guided action named, and how to reach the guide; measured", () => {
    const d = SPACE_TOOL.description;
    // Since the tool plan each everyday action is said with the fields it takes, not an example call.
    for (const said of ["read: the board and the logbook's newest lines.", "add: a task (title, line).", "take: a task, yours in Doing (id).", "move: a task, with where it stands (id, to, line).", "log: what you did, found or decided", "not every step (text, task).", "guide, with topic for one, explains the guided actions"])
      assert.ok(d.includes(said), said);
    const guided = /, whose fields go in with: ([\w, ]+); board covers read, add, take, move and log in full\. routine: work an agent does by itself at a time, or as a watcher when something happens \(in a chat, in the project's files or its repository, in a connection, or where a program posts or prints\)\.$/.exec(d);
    assert.deepEqual(guided?.[1].split(", "), [...SPACE_GUIDED], "every guided action named, and where its fields go");
    // A constrained decoder can send only what is listed (SD-D4): every action in the enum, `with` a listed object.
    assert.deepEqual(SPACE_TOOL.input_schema.properties.action.enum, [...SPACE_ACTIONS]);
    assert.deepEqual(SPACE_TOOL.input_schema.properties.topic.enum, [...SPACE_TOPICS]);
    assert.equal(SPACE_TOOL.input_schema.properties.with.type, "object");
    // The guided actions' fields are not in the schema: a new Space feature is a topic, never a field (case 16).
    assert.deepEqual(Object.keys(SPACE_TOOL.input_schema.properties), ["action", "id", "title", "line", "to", "parked", "text", "task", "since", "topic", "with"]);
    // Measured: ≈1,810 tokens after S7, 2,218 characters ≈822 tokens after E39, 2,389 ≈881 with the dashboards and lanes (E42),
    // 2,445 ≈902 with the apps (10-29), 1,883 ≈662 after the tool plan, 2,047 ≈711 with what a routine is, a watcher
    // too, 2,094 ≈725 with the places a watcher may watch; pinned, so a feature cannot grow it unseen.
    const whole = JSON.stringify(SPACE_TOOL);
    assert.ok(whole.length < 2500, String(whole.length));
    assert.ok(estimateTokens(whole) < 925, String(estimateTokens(whole)));
  });
});

describe("the guide (cases 2–5)", () => {
  test("its index: a line per topic, and how a guided action takes its fields", () => {
    const r = spaceCall({ action: "guide" }, atOf());
    assert.equal(r.ok, true);
    const text = words(r);
    for (const t of SPACE_TOPICS) assert.match(text, new RegExp(`\\n- ${t}: `), t);
    assert.match(text, /take their fields in "with"/);
  });

  test("each topic whole: nothing the old description and fields said is lost", () => {
    const all = words(spaceGuide("board, draft, routine, repro"));
    // Every field the tool took before E39, by its name, and each example.
    for (const f of ["since", "to", "parked", "line", "task", "title", "connection", "tool", "args", "words", "where", "answers", "from", "when", "writes", "text", "reproduced", "test", "run", "said", "steps", "tried", "questions", "id"])
      assert.match(all, new RegExp(`"${f}"|(^|[\\s(])${f}: `, "m"), f);
    for (const ex of ["Fix the login redirect", "merged in 4f2c1a", "The API now returns 404", "Reply to Sara", "Morning brief", "PLAY-91 Safari loops", "{words}", "every 15 min at least", "An agent cannot delete a task"])
      assert.ok(all.includes(ex), ex);
    // In the guide's order, each once.
    assert.deepEqual([...all.matchAll(/^## (\w+)/gm)].map((m) => m[1]), ["board", "draft", "routine", "repro"]);
  });

  test("a topic said loosely is read as meant; several, each in turn; one it has not, refused naming them", () => {
    const heads = (/** @type {any} */ r) => [...words(r).matchAll(/^## (\w+)/gm)].map((m) => m[1]);
    assert.deepEqual(heads(spaceCall({ action: "guide", topic: "Routines" }, atOf())), ["routine"]);
    assert.deepEqual(heads(spaceCall({ action: "guide", topics: ["repro", "board"] }, atOf())), ["board", "repro"]);
    assert.deepEqual(heads(spaceCall({ action: "guide", topic: "since" }, atOf())), ["board"], "an everyday word: the board");
    assert.deepEqual(heads(spaceCall({ action: "guide", topic: "drafts; reproduce" }, atOf())), ["draft", "repro"]);
    assert.deepEqual(heads(spaceCall({ action: "guide", topic: "buttons" }, atOf())), ["dashboard"], "a button is the dashboard's");
    assert.deepEqual(spaceCall({ action: "guide", topic: "calendar" }, atOf()), { ok: false, error: 'the guide\'s topics are board, needs, dashboard, app, lanes, draft, routine, repro; "calendar" is none of them. {"action":"guide"} says what each covers.' });
  });

  test("it reads nothing of the Space and changes nothing; switched off, refused as every call (cases 11, SD-D6)", () => {
    const at = atOf();
    const before = JSON.stringify(at.store.get("p1"));
    spaceCall({ action: "guide", topic: "board" }, at);
    assert.equal(JSON.stringify(at.store.get("p1")), before);
    assert.deepEqual(spaceCall({ action: "guide" }, atOf({ on: () => false })), { ok: false, error: SPACE_SWITCHED_OFF });
  });
});

describe("a guided action's fields (cases 6–9)", () => {
  test("in `with` or beside `action`: the same answer; `with` wins where both say", () => {
    const viaWith = spaceCall({ action: "routine", with: ROUTINE }, atOf(), T);
    const flat = spaceCall({ action: "routine", ...ROUTINE }, atOf(), T);
    assert.equal(viaWith.ok, true, words(viaWith));
    assert.equal(words(viaWith), words(flat));
    const at = atOf();
    spaceCall({ action: "routine", title: "Beside", with: ROUTINE }, at, T);
    assert.equal(at.store.get("p1").routines[0].title, "Morning brief");
    // `action` inside `with` alone is read too.
    assert.equal(spaceCall({ with: { action: "routine", ...ROUTINE } }, atOf(), T).ok, true);
  });

  test("`with` as JSON text is read; text that holds no object is refused with the call", () => {
    assert.equal(spaceCall({ action: "routine", with: JSON.stringify(ROUTINE) }, atOf(), T).ok, true);
    const r = spaceCall({ action: "routine", with: "title: Morning brief" }, atOf(), T);
    assert.equal(r.ok, false);
    assert.equal(words(r), 'Not run: "with" holds the fields as a JSON object, not text. The call: {"action":"routine","with":{"title":"Morning brief","when":"weekdays 09:00","text":"Read the open PRs and CI; say what needs the person."}} — {"action":"guide","topic":"routine"} gives every field.');
    assert.equal(words(spaceCall({ action: "add", with: "[1]" }, atOf(), T)), 'Not run: "with" holds the fields as a JSON object, not text.', "an everyday action has no call to teach");
  });

  test("a refusal of its fields carries its call whole; a draft's `to` in `with` is where it goes", () => {
    const at = atOf({ connection: () => ({ ok: /** @type {const} */ (true), account: "" }) });
    const r = words(spaceCall({ action: "draft", with: { title: "Reply" } }, at, T));
    assert.match(r, /^Not written: a draft names the connection that would send it and its tool: .* The call: \{"action":"draft","with":\{"title":"Reply to Sara","connection":"slack"/);
    assert.match(r, /\{"action":"guide","topic":"draft"\} gives every field\.$/);
    const ok = spaceCall({ action: "draft", with: { title: "Reply to Sara", connection: "slack", tool: "post_message", args: { text: "{words}" }, words: "Not today.", to: "#releases" } }, at, T);
    assert.equal(ok.ok, true, words(ok));
    assert.equal(at.store.get("p1").needs[0].draft?.to, "#releases");
    // Beside `action`, "to" names a column, as before: a draft's "to" there is not where it goes.
    spaceCall({ action: "draft", title: "Ping", connection: "slack", tool: "post_message", args: { text: "{words}" }, words: "x", to: "done" }, at, T);
    assert.equal(at.store.get("p1").needs[1].draft?.to, "");
  });

  test("a repro through `with`, the answer as before", () => {
    const at = atOf({ cwdOf: () => "/r" });
    const r = spaceCall({ action: "repro", with: { title: "PLAY-91 Safari loops", reproduced: true, test: "tests/safari.spec.ts", run: "npx playwright test safari" } }, at, T);
    assert.ok(r.ok && words(r).includes("Fix it… there starts a chat in this lane's folder"), words(r));
  });
});

describe("the chat's card and the trail (case 12)", () => {
  test("the guide by its topic; a guided action by its title, from `with` or beside `action`", () => {
    assert.deepEqual(cardOf("space", { action: "guide", topic: "routine" }), { kind: "space", title: "Read the Space guide", subject: "routine" });
    assert.deepEqual(cardOf("space", { action: "guide" }), { kind: "space", title: "Read the Space guide", subject: "" });
    assert.deepEqual(cardOf("space", { action: "routine", with: ROUTINE }), { kind: "space", title: "Propose a routine", subject: "Morning brief" });
    assert.deepEqual(cardOf("space", { action: "draft", title: "Reply to Sara" }), { kind: "space", title: "Write a draft", subject: "Reply to Sara" });
    assert.deepEqual(cardOf("space", { action: "repro", with: { title: "PLAY-91" } }), { kind: "space", title: "Report a reproduction", subject: "PLAY-91" });
    assert.deepEqual(cardOf("space", { action: "move", id: "t3", to: "done" }), { kind: "space", title: "Move a task", subject: "t3 → done" }, "the everyday ones as before");
    // The trail's line, as the agent's rounds and the log name a call.
    assert.equal(argSummary("space", { action: "guide", topic: "repro" }), "guide repro");
    assert.equal(argSummary("space", { action: "routine", with: ROUTINE }), "routine Morning brief");
    assert.equal(argSummary("space", { action: "draft", with: { title: "Reply", to: "#releases" } }), "draft Reply → #releases");
    assert.equal(argSummary("space", { action: "log", text: "a line" }), "log a line");
  });

  // (fails before: yes — every call of the routine action was titled "Propose a routine": a watcher proposed, a
  // guidance sent — with none of its words —, a pause and a Run now alike)
  test("the routine action's card says what the call does: a watcher proposed, guidance sent with its words, one paused or run now, Pause all", () => {
    /** @param {Record<string, any>} w */
    const card = (w) => cardOf("space", { action: "routine", with: w });
    assert.deepEqual(card({ title: "Supervisor", trigger: { kind: "turn", chat: "this" }, wakes: "new", guides: true, text: "Read the turn." }), { kind: "space", title: "Propose a watcher", subject: "Supervisor" });
    assert.deepEqual(card({ guidance: "The turn says the tests pass,\nand test/login.test.js is skipped." }), { kind: "space", title: "Send guidance", subject: "The turn says the tests pass, and test/login.test.js is skipped." });
    assert.deepEqual(card({ id: "r4", guidance: "Run the skipped test." }), { kind: "space", title: "Send guidance", subject: "Run the skipped test." });
    assert.deepEqual(card({ id: "r4", pause: "CI is red on main" }), { kind: "space", title: "Pause a routine", subject: "r4: CI is red on main" });
    assert.deepEqual(card({ id: "r4", run: true }), { kind: "space", title: "Run a routine now", subject: "r4" });
    assert.deepEqual(card({ pauseAll: "the deploy key leaked" }), { kind: "space", title: "Pause all", subject: "the deploy key leaked" });
    // A change of one by its id, and one at times, stay a proposal.
    assert.deepEqual(card({ id: "r4", text: "Read CI too." }), { kind: "space", title: "Propose a routine", subject: "r4" });
    assert.equal(argSummary("space", { action: "routine", with: { guidance: "Run the skipped test." } }), "routine guidance Run the skipped test.");
  });

  test("they read a call as the tool runs it: `with` as JSON text, the action in `with` alone or in capitals; a draft by where it goes", () => {
    // (fails before: yes — each was titled "Space" or named nothing, and the trail said "? Morning brief" or "routine")
    for (const c of [{ action: "routine", with: JSON.stringify(ROUTINE) }, { with: { action: "routine", ...ROUTINE } }, { action: "ROUTINE", with: ROUTINE }]) {
      assert.equal(spaceCall(c, atOf(), T).ok, true, `the tool runs ${JSON.stringify(c)}`);
      assert.deepEqual(cardOf("space", c), { kind: "space", title: "Propose a routine", subject: "Morning brief" }, JSON.stringify(c));
      assert.equal(argSummary("space", c), "routine Morning brief", JSON.stringify(c));
    }
    // Text in `with` that holds no object: the tool refuses it; the card and the trail name the action alone.
    assert.deepEqual(cardOf("space", { action: "routine", with: "title: x" }), { kind: "space", title: "Propose a routine", subject: "" });
    assert.equal(argSummary("space", { action: "routine", with: "title: x" }), "routine");
    // The draft as the guide teaches it: `where` is where it goes, on the card and in the trail as in the draft.
    // (fails before: yes — the card named no place, the trail "draft Reply to Sara")
    const at = atOf({ connection: () => ({ ok: /** @type {const} */ (true), account: "" }) });
    const draft = { action: "draft", with: { title: "Reply to Sara", connection: "slack", tool: "post_message", args: { text: "{words}" }, words: "Not today.", where: "#releases" } };
    assert.equal(spaceCall(draft, at, T).ok, true);
    assert.equal(at.store.get("p1").needs[0].draft?.to, "#releases");
    assert.deepEqual(cardOf("space", draft), { kind: "space", title: "Write a draft", subject: "Reply to Sara → #releases" });
    assert.equal(argSummary("space", draft), "draft Reply to Sara → #releases");
    // A column word in "to" is no place a draft goes: the draft drops it, and so do its card and trail.
    const column = { action: "draft", title: "Ping", connection: "slack", tool: "post_message", args: { text: "{words}" }, words: "x", to: "done" };
    spaceCall(column, at, T);
    assert.equal(at.store.get("p1").needs[1].draft?.to, "");
    assert.deepEqual(cardOf("space", column).subject, "Ping");
    assert.equal(argSummary("space", column), "draft Ping");
    // A move's "to" is its column, as before.
    assert.equal(argSummary("space", { action: "Move", id: "t3", to: "done" }), "move t3 → done");
  });
});

describe("a coding agent's call (case 13)", () => {
  test("the same door over MCP; the guide and a routine through `with` answer the same", async () => {
    const store = createSpaceStore({ dir: null, now: () => T });
    const tools = createAgentTools({
      memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null,
      space: { store, projectOf: (c) => (c === "c1" ? "p1" : null), nameOf: () => "Release", on: () => true, modelOf: () => "agent/brain-model" },
    });
    const ctx = /** @type {any} */ ({ cwd: "/r", chain: "c1" });
    const listed = tools.list(ctx).find((t) => t.name === "space");
    assert.deepEqual(listed?.inputSchema, SPACE_TOOL.input_schema);
    const guide = /** @type {any} */ (await tools.call("space", { action: "guide", topic: "routine" }, ctx));
    assert.match(guide.text, /^## routine — work an agent does by itself/);
    const r = /** @type {any} */ (await tools.call("space", { action: "routine", with: ROUTINE }, ctx));
    assert.match(r.text, /^Routine r1 "Morning brief" \(weekdays at 09:00, reading only\) waits for the person's Switch on, on the card under this call and in the Space's Routines: nothing runs until they press it\./);
  });
});

describe("end to end: a chat's agent reads the guide, then proposes a routine through `with` (SD4)", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {any[]} */
  const seen = [];
  /** @type {any[]} the tool results each request carried */
  const said = [];
  const root = mkdtempSync(join(tmpdir(), "filament-space-door-"));
  made.push(root);
  before(async () => {
    up = await fakeUpstream(async (call) => {
      const body = call.body || {};
      if (!body.tools?.length) return anthropicReply("A title", { model: "brain-model" });
      seen.push(body.tools.find((/** @type {any} */ t) => t.name === "space"));
      const results = (body.messages || []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : [])).filter((/** @type {any} */ p) => p?.type === "tool_result");
      said.push(results);
      if (results.length === 0) return anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "g1", name: "space", input: { action: "guide", topic: "routine" } }] });
      if (results.length === 1) return anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "r1", name: "space", input: { action: "routine", with: ROUTINE } }] });
      return anthropicReply("Proposed: Morning brief waits for your Switch on.", { model: "brain-model" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    made.push(shim.dataDir);
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });

  test("the request carries the door; the guide's words reach the model; the routine waits in the Space", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", title: "Release", settings: { loop: { permissions: "auto" } } } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    const { projectId } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json();
    assert.equal((await shim.api(`/api/space/${encodeURIComponent(projectId)}`, { method: "POST" })).status, 200, "its Space made from its menu (10-29)");
    const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "propose a morning brief", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    const space = async () => (await shim.api(`/api/space/${encodeURIComponent(projectId)}`)).json();
    await until(async () => (await space()).runs?.routines?.length === 1, "the routine");
    const r = (await space()).runs.routines[0];
    assert.deepEqual([r.title, r.words.when, r.state], ["Morning brief", "weekdays at 09:00", "proposed"]);
    assert.ok(seen.length >= 3, "the guide's answer went back to the model, then the routine's");
    assert.match(JSON.stringify(said[1]), /## routine — work an agent does by itself/, "the guide's words, as the model read them");
    assert.deepEqual(seen[0]?.input_schema, SPACE_TOOL.input_schema, "the door, as the model was sent it");
    assert.equal(seen[0]?.description, SPACE_TOOL.description);
  });
});
