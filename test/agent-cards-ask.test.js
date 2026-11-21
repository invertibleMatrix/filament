// @ts-check
// HarnessV4_Tasks E15 step 2, through the app: a question to saved agents by their tags. Several tags are one request
// that starts all of them or none (AG-3, AG-23), each blind to the others; the session keeps the question, the answer
// whole and its figures as its own marks, whether a turn runs or not (AG-19, AG-26), and the main agent hears nothing
// of either (L-63). The message's pictures go with the question, a provider's refusal of them is the answer's failure
// in its words with the way on, and Filament remembers it for that model until one goes through (L-23, L-48, AG-20).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";
import { until } from "./helpers/wait.js";

/** A 1×1 PNG. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
/** Who a request answers as: a saved agent's name, from its instructions; null for the main agent's. @param {any} c */
const asWhom = (c) => (/You answer as ([^.]+)\./.exec(JSON.stringify(c.body?.system ?? "")) || [])[1] || null;
/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));
/** The calls a request's newest message answers. @param {any} c */
const answersTo = (c) => (Array.isArray(c.body?.messages?.at(-1)?.content) ? c.body.messages.at(-1).content : []).filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id);
const picturesIn = (/** @type {any} */ c) => (c.body?.messages || []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : [])).filter((/** @type {any} */ b) => b?.type === "image");
const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

/** @type {string} */ let folder;
/** @type {any} */ let up;
/** @type {any} */ let shim;
/** An agent asked to "hold" answers once the test lets it; so does the main agent's second round. */
let gate = deferred();
/** Whether the model that reads no pictures takes them now. */
let blindReads = false;

before(async () => {
  folder = mkdtempSync(join(tmpdir(), "filament-ask-"));
  writeFileSync(join(folder, "notes.txt"), "hello\n");
  up = await fakeUpstream(async (call) => {
    const messages = call.body?.messages || [];
    const lastText = textOf(messages.at(-1));
    const model = String(call.body?.model || "");
    const blocks = (/** @type {any[]} */ b, stop = "end_turn") => anthropicReply("", { model, stop, blocks: b, usage: { input_tokens: 50, output_tokens: 7 } });
    const who = asWhom(call);
    if (who) {
      if (model === "m-blind" && !blindReads && picturesIn(call).length) return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "this model does not support image input" } } };
      if (/hold this thought/.test(lastText)) await gate.promise;
      return blocks([{ type: "text", text: `Fail, and name the limit.\n\n${who} SAYS a fifth launch must not wait unseen.` }]);
    }
    if (answersTo(call).includes("toolu_r1")) {
      await gate.promise;
      return blocks([{ type: "text", text: "MAIN DONE" }]);
    }
    if (/work then hold/.test(lastText)) return blocks([{ type: "text", text: "Looking at the notes." }, { type: "tool_use", id: "toolu_r1", name: "read", input: { path: "notes.txt" } }], "tool_use");
    // A command the session's permissions ask about: the turn stops there for the developer's answer.
    if (/publish it/.test(lastText)) return blocks([{ type: "text", text: "The notes say green. Publishing the build." }, { type: "tool_use", id: "toolu_p1", name: "bash", input: { command: "node publish.js --to production" } }], "tool_use");
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
  for (const [tag, name, model] of [["eyes", "Eyes", "m-blind"], ["seer", "Seer", "m-sees"]]) {
    const r = await shim.api("/api/agents", { method: "POST", body: { tag, name, goodFor: "Reading a picture", thinks: "You look closely before you speak.", model } });
    assert.equal(r.status, 200, await r.clone().text());
  }
  // What an asked agent is shown of its session is read here through Product and Reviewer, set in place to see it: a lead
  // as it ships sees nothing of it (the owner's words of 10-19; the Builder's test below).
  for (const tag of ["product", "reviewer"]) {
    const r = await shim.api(`/api/agents/${tag}`, { method: "PUT", body: { sees: { view: "folded", running: true } } });
    assert.equal(r.status, 200, await r.clone().text());
  }
});

// (fails before: yes — the owner's words of 10-19: a lead saw the session, so "second opinion would actually be the
// same as of the main agent")
test("a lead as it ships is shown nothing of the session: its question alone, the turns before it and the one running now left out", async () => {
  gate = deferred();
  const id = await newSession();
  const first = await shim.api(at(id, "/turns"), { method: "POST", body: { content: "say hello", stream: false } });
  assert.equal(first.status, 200, await first.clone().text());
  const mark = up.received.length;
  const turn = shim.api(at(id, "/turns"), { method: "POST", body: { content: "work then hold", stream: false } });
  try {
    await until(() => up.received.slice(mark).some((/** @type {any} */ c) => !asWhom(c) && answersTo(c).includes("toolu_r1")), "the turn's second round to be in flight");
    const r = await ask(id, { prompt: QUESTION, as: ["builder"] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const sa = await ended(id, r.json.subagents[0].id);
    assert.deepEqual([sa.view, sa.running, sa.opening.filter((/** @type {any} */ b) => b.kind !== "brief")], ["none", false, []]);
    const shown = JSON.stringify(up.received.slice(mark).find(asWhom).body.messages);
    assert.ok(!/say hello|work then hold/.test(shown), shown);
  } finally {
    gate.resolve();
  }
  assert.equal((await turn).status, 200);
});
after(async () => {
  gate.resolve();
  await shim.stop();
  await up.close();
  for (const dir of [shim.dataDir, folder]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

const at = (/** @type {string} */ id, rest = "") => `/api/sessions/${encodeURIComponent(id)}${rest}`;
const newSession = async () => {
  const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain" } });
  assert.equal(s.status, 200, await s.clone().text());
  return String((await s.json()).id);
};
/** @param {string} id @param {any} body @returns {Promise<{ status: number, json: any }>} */
const ask = async (id, body) => {
  const r = await shim.api(at(id, "/subagents"), { method: "POST", body });
  return { status: r.status, json: await r.json() };
};
/** @param {string} id @returns {Promise<any>} */
const listOf = async (id) => (await shim.api(at(id, "/subagents"))).json();
/** A sub-agent once it is no longer running, whole. @param {string} id @param {string} sid @returns {Promise<any>} */
const ended = (id, sid) =>
  until(async () => {
    const { subagent } = await (await shim.api(at(id, `/subagents/${sid}`))).json();
    return subagent && subagent.status !== "running" ? subagent : null;
  }, `agent ${sid} to answer`);
/** The session's marks of its saved agents, oldest first. @param {string} id @returns {Promise<any[]>} */
const marksOf = async (id) => ((await (await shim.api(at(id, "/transcript"))).json()).boundaries || []).filter((/** @type {any} */ b) => b.type === "subagent" && b.card);
const QUESTION = "should a fifth launch queue or fail?";

// (fails before: yes — `as` took one tag; a list was refused as no JSON object the route knew)
test("several tags are one request: each agent starts, blind to the others, and the session keeps each question and answer whole", async () => {
  const id = await newSession();
  const mark = up.received.length;
  const r = await ask(id, { prompt: QUESTION, as: ["product", "@Builder", "product"] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.subagents.map((/** @type {any} */ s) => s.card.tag), ["product", "builder"], "each tag once, in the order asked");
  assert.deepEqual(r.json.refused, []);
  for (const s of r.json.subagents) await ended(id, s.id);
  const calls = up.received.slice(mark).filter(asWhom);
  assert.deepEqual(calls.map(asWhom).sort(), ["Builder", "Product"]);
  for (const c of calls) {
    const sent = JSON.stringify(c.body.messages);
    assert.ok(sent.includes(QUESTION), "the question is its message");
    assert.ok(!sent.includes("SAYS"), "no agent is shown another's answer");
  }
  const marks = await marksOf(id);
  assert.deepEqual(marks.map((m) => `${m.event}:${m.card.tag}`).sort(), ["arrival:builder", "arrival:product", "dispatch:builder", "dispatch:product"]);
  const back = marks.find((m) => m.event === "arrival" && m.card.tag === "product");
  assert.equal(back.question, QUESTION);
  assert.equal(back.answer, "Fail, and name the limit.\n\nProduct SAYS a fifth launch must not wait unseen.", "the answer whole, not a clipped line");
  assert.deepEqual([back.status, back.model, back.tokensIn, back.tokensOut, back.delivery, typeof back.ms], ["done", "m-1", 50, 7, "held", "number"]);
  const list = await listOf(id);
  assert.deepEqual(list.limit, { max: null, running: 0 }, "the list says how many run, and no limit: none is set on its model");
  assert.deepEqual(list.refusedPictures, []);
});

// (fails before: yes — a list was not read at all)
test("a tag that names no agent, or no tag at all, starts none", async () => {
  const id = await newSession();
  const mark = up.received.length;
  const unknown = await ask(id, { prompt: QUESTION, as: ["product", "nobody", "@ghost"] });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.error, "there is no agent `@nobody`, `@ghost` — Library › Agents and teams lists them");
  const none = await ask(id, { prompt: QUESTION, as: ["", " @ "] });
  assert.equal(none.status, 400);
  assert.equal(none.json.error, "`as` names no agent: a tag, or a list of tags");
  assert.equal((await listOf(id)).subagents.length, 0, "Product did not start beside the unknown ones");
  assert.equal(up.received.slice(mark).filter(asWhom).length, 0);
});

// (fails before: yes — AG-241: one saved agent was asked on one model; `models` was not read)
test("one saved agent asked on several models at once: one launch per model, each blind to the others; a taken seat or a model that cannot run, and none starts", async () => {
  gate = deferred();
  const id = await newSession();
  const pool = [{ model: "m-a" }, { model: "m-b" }, { model: "" }];
  assert.equal((await shim.api(at(id, "/settings"), { method: "PATCH", body: { patch: { subagents: { pool } } } })).status, 200);
  // One at once on m-a across your chats, as its row says (the owner's word of 11-05: the only limit).
  assert.equal((await shim.api("/api/subagents/slots", { method: "PUT", body: { name: "m-a", n: 1 } })).status, 200);
  const mark = up.received.length;
  const r = await ask(id, { prompt: QUESTION, as: ["product"], models: ["m-a", "agent/m-b", "m-a"] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.subagents.map((/** @type {any} */ s) => [s.card.tag, s.model, s.asked]), r.json.refused], [[["product", "m-a", true], ["product", "m-b", true]], []]);
  for (const s of r.json.subagents) await ended(id, s.id);
  const sent = up.received.slice(mark).filter(asWhom);
  assert.deepEqual(sent.map((/** @type {any} */ c) => [asWhom(c), String(c.body.model)]).sort(), [["Product", "m-a"], ["Product", "m-b"]]);
  for (const c of sent) assert.ok(!JSON.stringify(c.body.messages).includes("SAYS a fifth launch"), "each blind to the other's answer");
  // The refusals: more than one agent named, fewer than two models, an agent that does not exist.
  const refusals = [
    [{ as: ["product", "builder"], models: ["m-a", "m-b"] }, 400, "`models` asks one saved agent on several models: `as` names its tag"],
    [{ as: "product", models: ["m-a", "agent/m-a"] }, 400, "`models` names fewer than two models: one model is `model`"],
    [{ as: "ghost", models: ["m-a", "m-b"] }, 400, "there is no agent `@ghost` — Library › Agents and teams lists them"],
  ];
  for (const [body, status, error] of refusals) {
    const no = await ask(id, { prompt: QUESTION, .../** @type {any} */ (body) });
    assert.deepEqual([no.status, no.json.error], [status, error]);
  }
  // A seat taken on one of the models: none starts, and the refusal names the model.
  const start = up.received.length;
  const held = await ask(id, { prompt: "hold this thought", as: "product", model: "m-a" });
  assert.equal(held.status, 200, JSON.stringify(held.json));
  try {
    await until(() => up.received.slice(start).some((/** @type {any} */ c) => asWhom(c) === "Product"), "Product's request to be in flight");
    const before = up.received.length;
    const full = await ask(id, { prompt: QUESTION, as: "product", models: ["m-b", "m-a"] });
    assert.deepEqual([full.status, full.json.error], [409, "none was started — m-a: its slots across Filament are busy (1 of 1 busy; set on its row under its provider in Settings). Wait for one to finish."]);
    // A model that cannot run an agent: none starts either.
    const gone = await ask(id, { prompt: QUESTION, as: "product", models: ["m-b", "nowhere-9"] });
    assert.equal(gone.status, 409);
    assert.match(gone.json.error, /^none was started — the sub-agent cannot run on "nowhere-9": .+/);
    assert.equal((await listOf(id)).subagents.filter((/** @type {any} */ s) => s.status === "running").length, 1, "the held one alone");
    assert.equal(up.received.slice(before).filter(asWhom).length, 0);
    // (More than the models have room for, the count's refusal: the test of more tags than that, below.)
  } finally {
    gate.resolve();
  }
  await ended(id, held.json.subagent.id);
});

// (fails before: yes — the review of 10-29: the all-or-none count lent the models it launched on nothing, so five models
// outside the chat's list met the four of the list's one model; the owner's word of 11-05: and no chat has a number)
test("one saved agent on several models the chat's list does not hold: each lends its own room, none set on any", async () => {
  const id = await newSession();
  const r = await ask(id, { prompt: QUESTION, as: "product", models: ["m-v", "m-w", "m-x", "m-y", "m-z"] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.subagents.map((/** @type {any} */ s) => s.model), ["m-v", "m-w", "m-x", "m-y", "m-z"]);
  for (const s of r.json.subagents) await ended(id, s.id);
});

// (fails before: yes — with no list there was no all-or-none: a second and third launch each met the limit alone)
test("more tags than the chat's models have room for: none starts, and the refusal says the count", async () => {
  gate = deferred();
  const id = await newSession();
  /** The main agent's model's agents at once, on its row (the owner's word of 11-05: the only limit). @param {number | null} n */
  const limit = async (n) => assert.equal((await shim.api("/api/subagents/slots", { method: "PUT", body: { upstream: "m", model: "m-1", n } })).status, 200);
  await limit(2);
  const start = up.received.length;
  const first = await ask(id, { prompt: "hold this thought", as: ["product"] });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  try {
    await until(() => up.received.slice(start).some((/** @type {any} */ c) => asWhom(c) === "Product"), "Product's request to be in flight");
    assert.equal((await listOf(id)).limit.running, 1);
    const mark = up.received.length;
    const r = await ask(id, { prompt: QUESTION, as: ["builder", "enduser"] });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "1 of 2 agents are running on this chat's models, so 2 more do not fit: none was started — wait for one to finish, or ask fewer");
    assert.deepEqual(r.json.limit, { max: 2, running: 1 });
    assert.equal((await listOf(id)).subagents.length, 1, "Builder did not start in the one free seat");
    assert.equal(up.received.slice(mark).filter(asWhom).length, 0);
    // More than the session ever runs at once: waiting would not help, and the refusal does not say to.
    const many = await ask(id, { prompt: QUESTION, as: ["builder", "enduser", "reviewer"] });
    assert.equal(many.status, 409);
    assert.equal(many.json.error, "this chat's models run 2 agents at once, so 3 do not fit: none was started — ask fewer");
    assert.deepEqual(many.json.limit, { max: 2, running: 1 });
    assert.equal(up.received.slice(mark).filter(asWhom).length, 0);
    // (fails before: yes — found by E15 step 2's live drive: "2 of 2 agents are running …, so 1 more do not fit")
    // One agent asked while every seat is taken: the refusal speaks of one, and offers no "ask fewer".
    await limit(1);
    const full = await ask(id, { prompt: QUESTION, as: ["builder"] });
    assert.equal(full.status, 409);
    assert.equal(full.json.error, "1 of 1 agent is running on this chat's models, so one more does not fit: it was not started — wait for one to finish");
    await limit(2);
    const one = await ask(id, { prompt: QUESTION, as: ["builder"] });
    assert.equal(one.status, 200, "one more fits");
    await ended(id, one.json.subagents[0].id);
  } finally {
    gate.resolve();
    await limit(null);
  }
  await ended(id, first.json.subagents[0].id);
});

// (fails before: yes — found by E15 step 2's live drive: the command's answer began "sub-agent sa_… — finished", and
// whoever read it was never told whose view it was; a tag that names no agent read "The sub-agent was not launched")
test("`/subagent as=product` typed in a session: Product's answer is the command's own, and says it is Product's", async () => {
  const id = await newSession();
  const mark = up.received.length;
  const t = await shim.api(at(id, "/turns"), { method: "POST", body: { content: `/subagent as=product ${QUESTION}`, stream: false } });
  assert.equal(t.status, 200, await t.clone().text());
  const said = textOf(await t.json());
  const sid = String(/\((sa_[0-9a-f]{8}), on m-1\)/.exec(said)?.[1]);
  assert.equal(
    said,
    // (OA1: Product edits in its own copy — here, a folder with no git, in the session's folder, which its answer says)
    `(Filament: Product, one of your saved agents (${sid}, on m-1) — answered after 1 round; ask it again with /subagent ask ${sid} <more>, or pass the answer to the agent with /subagent send ${sid})\n\nFail, and name the limit.\n\nProduct SAYS a fifth launch must not wait unseen.\n\n(Filament: It worked in this session's folder (no worktree: not a git repository (no snapshot without one)).)`,
  );
  assert.deepEqual(up.received.slice(mark).map(asWhom), ["Product"], "one request, Product's: the main agent ran no turn");
  const none = await shim.api(at(id, "/turns"), { method: "POST", body: { content: `/subagent as=pn ${QUESTION}`, stream: false } });
  assert.equal(textOf(await none.json()), "`@pn` was not asked: there is no agent `@pn` — Library › Agents and teams lists them.");
});

// (fails before: yes — found by E15 step 2's live drive: the line over the composer waited 27 s for its sizes in a
// project with 126 changed files, and asked again every 20 s: the route built each file's patch to size a change the
// line never shows)
test("the sizes the composer's line reads come without the folder's change being read: `?changes=0`", async () => {
  const id = await newSession();
  const t = await shim.api(at(id, "/turns"), { method: "POST", body: { content: "first question", stream: false } });
  assert.equal(t.status, 200, await t.clone().text());
  const lean = await (await shim.api(at(id, "/subagents/views?changes=0"))).json();
  assert.equal(lean.changes, null, "no patch was read, and none is sized");
  assert.ok(lean.tokens.folded > 0 && lean.running === null && lean.starts.length === 4, "the rest is as any reader gets it");
  const whole = await (await shim.api(at(id, "/subagents/views"))).json();
  assert.deepEqual(Object.keys(whole.changes), ["turn", "uncommitted"]);
  assert.deepEqual(whole.tokens, lean.tokens);
});

// (fails before: yes — a launch carried text only)
test("the message's pictures go with the question; a provider's refusal is said with the way on and remembered for that model until one goes through", async () => {
  blindReads = false;
  const id = await newSession();
  const picture = { name: "shot.png", mediaType: "image/png", data: PNG };
  const bad = await ask(id, { prompt: "does this read well?", as: ["seer"], images: [{ name: "notes.txt", mediaType: "text/plain", data: "aGk=" }] });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /image 1 is no picture/);

  let mark = up.received.length;
  const seen = await ask(id, { prompt: "does this read well?", as: ["seer"], images: [picture] });
  assert.equal(seen.status, 200, JSON.stringify(seen.json));
  const seer = await ended(id, seen.json.subagents[0].id);
  assert.equal(seer.status, "done");
  assert.deepEqual(seer.exchanges[0].pictures, ["shot.png"]);
  const call = up.received.slice(mark).find(asWhom);
  const last = call.body.messages.at(-1).content;
  assert.deepEqual(last.slice(-2).map((/** @type {any} */ b) => b.type), ["text", "image"], "the picture follows the question's words");
  assert.equal(last.at(-2).text, "does this read well?");
  assert.deepEqual(last.at(-1).source, { type: "base64", media_type: "image/png", data: PNG });

  mark = up.received.length;
  const refused = await ask(id, { prompt: "does this read well?", as: ["eyes"], images: [picture] });
  assert.equal(refused.status, 200, JSON.stringify(refused.json));
  const eyes = await ended(id, refused.json.subagents[0].id);
  assert.equal(eyes.status, "failed");
  assert.equal(eyes.exchanges[0].error, 'm-blind\'s provider refused the request with the picture: "this model does not support image input" — put a model that reads pictures on Eyes\'s card, or ask without it');
  assert.equal(up.received.slice(mark).filter(asWhom).length, 1, "the refused request is not sent again without the picture");
  assert.deepEqual((await listOf(id)).refusedPictures, [{ model: "m-blind", said: "this model does not support image input" }]);
  const back = (await marksOf(id)).find((m) => m.event === "arrival" && m.card.tag === "eyes");
  assert.deepEqual([back.status, back.pictures, back.error], ["failed", ["shot.png"], eyes.exchanges[0].error], "the card's mark says the same, whole");

  // Words alone to the same model are no evidence either way.
  const words = await ask(id, { prompt: "and without it?", as: ["eyes"] });
  assert.equal((await ended(id, words.json.subagents[0].id)).status, "done");
  assert.equal((await listOf(id)).refusedPictures.length, 1);
  // The model takes a picture: it is no longer named.
  blindReads = true;
  const now = await ask(id, { prompt: "does this read well?", as: ["eyes"], images: [picture] });
  assert.equal((await ended(id, now.json.subagents[0].id)).status, "done");
  assert.deepEqual((await listOf(id)).refusedPictures, []);
});

// (fails before: yes — a developer's launch during a turn drew its marks as that turn's events, inside its work)
test("asked while a turn runs: the marks are the session's, after that turn, and the main agent hears nothing of the question or the answer", async () => {
  gate = deferred();
  const id = await newSession();
  const mark = up.received.length;
  const turn = shim.api(at(id, "/turns"), { method: "POST", body: { content: "work then hold", stream: false } });
  try {
    await until(() => up.received.slice(mark).some((/** @type {any} */ c) => !asWhom(c) && answersTo(c).includes("toolu_r1")), "the turn's second round to be in flight");
    const r = await ask(id, { prompt: "is the cache bounded?", as: ["product"] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    await ended(id, r.json.subagents[0].id);
    const marks = await marksOf(id);
    assert.deepEqual(marks.map((m) => [m.event, m.afterTurn]), [["dispatch", 1], ["arrival", 1]], "both stand after the turn that ran when asked");
    const shown = up.received.slice(mark).find(asWhom);
    assert.match(JSON.stringify(shown.body.messages), /work then hold/, "Product is shown the turn running now, as its card says");
  } finally {
    gate.resolve();
  }
  assert.equal((await turn).status, 200);
  const next = await shim.api(at(id, "/turns"), { method: "POST", body: { content: "and now?", stream: false } });
  assert.equal(next.status, 200, await next.clone().text());
  const main = up.received.slice(mark).filter((/** @type {any} */ c) => !asWhom(c));
  assert.ok(main.length >= 3, "the main agent's rounds");
  for (const c of main) assert.ok(!/is the cache bounded|Product SAYS/.test(JSON.stringify(c.body)), "nothing of the question or the answer is in a request of the main agent's");
});

// (fails before: yes — found by hand in the browser: Product's answer reached the main agent as "the report of sub-agent
// sa_… which ran on the side", with nothing of whose view it was)
test("an answer sent on reaches the main agent once, with whose it is and what was asked", async () => {
  const id = await newSession();
  const r = await ask(id, { prompt: QUESTION, as: ["product"] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const sid = r.json.subagents[0].id;
  await ended(id, sid);
  const sent = await shim.api(at(id, `/subagents/${sid}/send`), { method: "POST", body: { exchange: 0 } });
  assert.equal(sent.status, 200, await sent.clone().text());
  const mark = up.received.length;
  const turn = await shim.api(at(id, "/turns"), { method: "POST", body: { content: "go on", stream: false } });
  assert.equal(turn.status, 200, await turn.clone().text());
  const main = up.received.slice(mark).filter((/** @type {any} */ c) => !asWhom(c));
  const said = JSON.stringify(main[0].body.messages);
  assert.match(said, new RegExp(`\\[Filament: the developer asked Product, one of their saved agents, and is passing you its answer \\(${sid}; it finished\\)\\. They asked it:\\\\n${QUESTION.replace("?", "\\?")}\\\\n\\\\nProduct's answer:\\\\nFail, and name the limit\\.`));
  assert.ok(said.includes("Product SAYS a fifth launch must not wait unseen.") && said.includes("Weigh it against your own work and don't redo what it covered."));
  assert.ok(!said.includes("the report of sub-agent"), "not in a plain sub-agent's words");
  assert.equal((await ended(id, sid)).exchanges[0].delivery, "sent");
  const again = await shim.api(at(id, `/subagents/${sid}/send`), { method: "POST", body: { exchange: 0 } });
  assert.notEqual(again.status, 200, "once");
});

/** The text blocks of a message, one by one. @param {any} m */
const blocksOf = (m) => (Array.isArray(m?.content) ? m.content : []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text));
const WAITS = "The main agent's turn has not ended: it stopped to ask the developer, and nothing runs until they answer.";
const ASKS = /\nIn the round that asked, it said:\nThe notes say green\. Publishing the build\.\n\nIt asks:\nMay I run this command\? `node publish\.js --to production` — [^\n]+ Answer \/allow to run it, or say what to do instead\.\n<\//;

// (fails before: yes — the E15 plan's case 31: the turn that waited stood among the "completed turns" with its
// question alone; nothing said it had not ended, and what the round that asked had said was nowhere)
test("asked while the main agent waits for a permission, an agent is told the turn waits, what it said and what it asks — once", async () => {
  const id = await newSession();
  const turn = await shim.api(at(id, "/turns"), { method: "POST", body: { content: "publish it", stream: false } });
  assert.equal(turn.status, 200, await turn.clone().text());
  assert.equal((await (await shim.api(at(id, "/transcript"))).json()).paused?.kind, "permission", "the turn waits");
  const mark = up.received.length;
  const r = await ask(id, { prompt: "is it safe to say yes?", as: ["reviewer"] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const sid = r.json.subagents[0].id;
  const sa = await ended(id, sid);
  const opening = blocksOf(up.received.slice(mark).filter(asWhom)[0].body.messages[0]);
  assert.equal(opening.length, 3, JSON.stringify(opening));
  assert.match(opening[0], /^<conversation view="folded" turns="1">/);
  assert.ok(opening[0].includes("User: publish it") && opening[0].includes("Assistant: May I run this command? `node publish.js --to production`"), opening[0]);
  assert.ok(opening[1].startsWith(`<waiting kind="permission">\n${WAITS} Background only — your task follows.\n`) && opening[1].endsWith("\n</waiting>"), opening[1]);
  assert.match(opening[1], ASKS);
  assert.equal(opening[2], "is it safe to say yes?", "the question comes last, whole");
  assert.deepEqual(sa.opening.map((/** @type {any} */ b) => [b.kind, b.count]), [["view", 1], ["waiting", 1]], "its conversation shows what it was handed");
  // Asked again while the same question waits: it is not said twice.
  const again = await shim.api(at(id, `/subagents/${sid}/follow-up`), { method: "POST", body: { prompt: "and if they say no?" } });
  assert.equal(again.status, 200, await again.clone().text());
  await ended(id, sid);
  assert.deepEqual(blocksOf(up.received.slice(mark).filter(asWhom).at(-1).body.messages.at(-1)), ["and if they say no?"]);
});

// (fails before: yes — a later question to an agent carried the turn as finished, and no word that it waited)
test("an agent asked before the turn stopped to ask is told, at its next question, that the turn waits now", async () => {
  const id = await newSession();
  const first = await shim.api(at(id, "/turns"), { method: "POST", body: { content: "say hello", stream: false } });
  assert.equal(first.status, 200, await first.clone().text());
  const mark = up.received.length;
  const r = await ask(id, { prompt: QUESTION, as: ["product"] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const sid = r.json.subagents[0].id;
  assert.deepEqual((await ended(id, sid)).opening.map((/** @type {any} */ b) => b.kind), ["view"], "nothing waited then");
  const turn = await shim.api(at(id, "/turns"), { method: "POST", body: { content: "publish it", stream: false } });
  assert.equal(turn.status, 200, await turn.clone().text());
  const again = await shim.api(at(id, `/subagents/${sid}/follow-up`), { method: "POST", body: { prompt: "should they say yes?" } });
  assert.equal(again.status, 200, await again.clone().text());
  await ended(id, sid);
  const last = blocksOf(up.received.slice(mark).filter(asWhom).at(-1).body.messages.at(-1));
  assert.equal(last.length, 2, JSON.stringify(last));
  assert.match(last[0], /^<since-your-last-look turns="1">\n/);
  assert.ok(last[0].includes("User: publish it") && last[0].includes(`\n\n${WAITS}\nIn the round that asked, it said:`) && last[0].endsWith("\n</since-your-last-look>"), last[0]);
  assert.match(last[0], ASKS);
  assert.equal(last[1], "should they say yes?");
});

// (fails before: no — the E15 plan's case 25, shown: a saved agent asked in a session a team runs is no worker of the
// team and no lead of it)
test("in a session a team runs, a tag asks the agent you name: it answers as itself, with no worker to send and no team to lead", async () => {
  const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain", settings: { engine: { mode: "team", team: "architect" } } } });
  assert.equal(s.status, 200, await s.clone().text());
  const id = String((await s.json()).id);
  const mark = up.received.length;
  const r = await ask(id, { prompt: QUESTION, as: ["product"] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const sa = await ended(id, r.json.subagents[0].id);
  assert.deepEqual([sa.card.tag, sa.team, sa.may, sa.status], ["product", null, "edit", "done"], "at its card's level (OA1)");
  const calls = up.received.slice(mark);
  assert.deepEqual(calls.map(asWhom), ["Product"], "one request, Product's: the team's lead was not woken");
  const tools = (calls[0].body.tools || []).map((/** @type {any} */ t) => t.name);
  // It reads only by its mode: a call that writes is refused when made (subagents.test.js). What it is not handed
  // at all is every tool that sends, launches or asks.
  for (const name of ["worker", "agent", "wait", "tasks", "plan", "ask"]) assert.ok(!tools.includes(name), `${name} — among: ${tools.join(", ")}`);
  assert.ok(tools.includes("read"), tools.join(", "));
  assert.ok(!JSON.stringify(calls[0].body.system).includes("Architect"), "nothing of the team's words in its instructions");
});
