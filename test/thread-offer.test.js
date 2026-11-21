// @ts-check
// Where the main agent's thread tool is offered (app/agent/thread-tool.js; the owner's of 11-09 and 11-11, task th3):
// to a harness chat's own agent on every engine, held by name as the team tool is — never in a team's own chat, to a
// sub-agent, in a chat of another machine's agents (Full control or not), nor while the chat's `loop.tools.thread`
// switch is off. A coding agent's session opens again when that switch flips, as it does for the team tool; and a call
// of the loop's agent starts a linked chat whose first turn is its brief.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_ACP_AGENT, FIXTURES, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { startTwoMachines } from "./helpers/two-machines.js";
import { pinnedFetch } from "../src/services/machines/pinned.js";
import { removeDirs, until } from "./helpers/wait.js";
import { BRIEF_HEAD } from "../src/core/threads.js";

const JSON_TYPE = { "content-type": "application/json" };

/** A message's words, its text blocks alone. @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (Array.isArray(m?.content) ? m.content : []).map((/** @type {any} */ b) => (b?.type === "text" ? b.text : "")).join(""));
/** The tool results a message hands back. @param {any} m */
const resultsOf = (m) =>
  (Array.isArray(m?.content) ? m.content : [])
    .filter((/** @type {any} */ b) => b?.type === "tool_result")
    .map((/** @type {any} */ b) => (typeof b.content === "string" ? b.content : (b.content || []).map((/** @type {any} */ x) => x?.text ?? "").join("")));

/**
 * Each call the model behind the chats took: its first message's words, its newest's, the tools it was offered by
 * name, and the results it was handed.
 * @typedef {{ first: string, last: string, tools: string[], results: string[] }} Call
 */
/**
 * A model on its calls: `HELPER CHECK` in a first message is a sub-agent's, answered at once; `LAUNCH A HELPER` launches
 * one and waits for its report; `START A THREAD` calls the thread tool with a brief — `IN <folder>` there, `ON <model> IN
 * <folder>` on that model, `A NOTIFYING THREAD SAYING <<brief>>` with notify, `THAT STARTS ONE` with a brief that asks
 * its thread to start one —; woken for a letter it opens what waits sealed; a thread's own agent does what its brief
 * says (`FIRST WRITE <file>`, `ANSWER AT LENGTH`, `then say <word>.`); anything else is answered in words.
 * @param {Call[]} calls
 */
const brainOn = (calls) => async (/** @type {any} */ call) => {
  if (call.kind !== "anthropic") return undefined;
  if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
  const msgs = call.body.messages || [];
  const c = { first: textOf(msgs[0]), last: textOf(msgs.at(-1)), tools: call.body.tools.map((/** @type {any} */ t) => String(t.name)), results: resultsOf(msgs.at(-1)) };
  calls.push(c);
  /** @param {string} name @param {any} input */
  const use = (name, input) => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: `tu_${calls.length}`, name, input }] });
  if (c.first.includes("HELPER CHECK")) return anthropicReply("hi", { model: "m-1" });
  if (c.last.includes("LAUNCH A HELPER")) return use("agent", { description: "Say hi", prompt: "HELPER CHECK: say hi.", run_in_background: false });
  if (c.last.includes("a letter from another chat has come for you")) return use("envelope", { all: true });
  const on = /START A THREAD ON (\S+) IN (\S+)/.exec(c.last);
  if (on) return use("thread", { title: "Site builder", brief: "Build the site in its own folder.", model: on[1], folder: on[2] });
  const notifying = /START A NOTIFYING THREAD SAYING <<([\s\S]+?)>>/.exec(c.last)?.[1];
  if (notifying) return use("thread", { title: "Advisor", brief: notifying, notify: true });
  if (c.last.includes("START A THREAD THAT STARTS ONE")) return use("thread", { title: "Nested", brief: "START A THREAD of your own." });
  const elsewhere = /START A THREAD IN (\S+)/.exec(c.last)?.[1];
  if (elsewhere) return use("thread", { title: "Site builder", brief: "Build the site in its own folder.", folder: elsewhere });
  if (c.last.includes("START A THREAD")) return use("thread", { title: "Advisor", brief: "Review each diff I send you, and remember every review." });
  const writes = /FIRST WRITE (\S+)/.exec(c.last)?.[1];
  if (writes) return use("write", { path: writes, content: "x" });
  if (c.first.includes(BRIEF_HEAD) && c.first.includes("ANSWER AT LENGTH")) return anthropicReply("many words ".repeat(3000), { model: "m-1" });
  const says = c.first.includes(BRIEF_HEAD) ? /then say (\S+?)\./.exec(c.first)?.[1] : null;
  if (says) return anthropicReply(says, { model: "m-1" });
  return anthropicReply("Done.", { model: "m-1" });
};
/** The opens (new, load, resume) a fake coding agent was sent, in order. @param {string} file */
const opensIn = (file) =>
  (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []).filter((c) => ["session/new", "session/load", "session/resume"].includes(c.method));

describe("the thread tool in a running Filament: the loop's agent", () => {
  /** @type {Call[]} */
  const calls = [];
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-thread-offer-"));
  const S = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** A harness chat of the person's. @param {any} [settings] */
  const chat = async (settings) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain", ...(settings ? { settings } : {}) } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** A turn of the person's, ended. @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`${S(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  /** The tools the newest call whose newest message says `words` was offered. @param {string} words */
  const offered = (words) => {
    const c = calls.findLast((x) => x.last.includes(words));
    assert.ok(c, `a call for ${words}`);
    return c.tools;
  };
  before(async () => {
    up = await fakeUpstream(brainOn(calls));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"] }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(root);
  });

  // (fails before: yes — the loop offered no thread tool to any chat's agent)
  test("a harness chat's own agent is offered thread, beside the team tool", async () => {
    const id = await chat();
    await turn(id, "OFFER plain");
    const tools = offered("OFFER plain");
    assert.ok(tools.includes("thread"), tools.join(", "));
    assert.ok(tools.includes("team"), "where the team tool is offered");
  });

  // (fails before: no — a guard: no chat had the tool; it fails once the switch is not read)
  test("with the chat's loop.tools.thread switch off it is not offered, and the rest stay", async () => {
    const id = await chat({ loop: { tools: { thread: false } } });
    await turn(id, "OFFER switched off");
    const tools = offered("OFFER switched off");
    assert.ok(!tools.includes("thread"), tools.join(", "));
    assert.ok(tools.includes("team"), tools.join(", "));
  });

  // (fails before: no — a guard: the tool is new, so a team's chat could not have it; it fails once the gate leaves the kind out)
  test("a team's own chat is not offered it", async () => {
    const main = await chat();
    const team = /** @type {any} */ (shim.app).sessions.create({ cwd: root, model: "m-1", kind: "team", beside: main, title: "BugHunters: a hunt" });
    await turn(String(team.id), "OFFER team chat");
    assert.ok(!offered("OFFER team chat").includes("thread"));
  });

  // (fails before: no — a guard, as above: a sub-agent's set must leave it out)
  test("a sub-agent is not offered it", async () => {
    const id = await chat();
    await turn(id, "LAUNCH A HELPER");
    const helper = calls.findLast((x) => x.first.includes("HELPER CHECK"));
    assert.ok(helper, "the helper ran");
    assert.ok(!helper.tools.includes("thread"), helper.tools.join(", "));
    assert.ok(offered("LAUNCH A HELPER").includes("thread"), "its main agent is");
  });

  // (fails before: no — a guard, as above: another machine's agents' chat must go without it)
  test("a chat of another machine's agents is not offered it", async () => {
    const id = await chat();
    /** @type {any} */ (shim.app).memory.archive.mergeMeta(id, { agentDevice: "dev-elsewhere" });
    await turn(id, "OFFER theirs");
    assert.ok(!offered("OFFER theirs").includes("thread"));
  });

  // (fails before: yes — the loop answered a call of thread as a tool it does not have)
  test("its call starts a linked chat: the starter lists it, and its first turn is the starter's brief", async () => {
    const id = await chat();
    await turn(id, "START A THREAD");
    const result = calls.findLast((x) => x.results.some((r) => r.includes("Started the thread")));
    assert.ok(result, JSON.stringify(calls.at(-1)?.results));
    const archive = /** @type {any} */ (shim.app).memory.archive;
    const started = archive.threadsOf(id).started;
    assert.equal(started.length, 1, JSON.stringify(started));
    const thread = String(started[0]);
    assert.equal(archive.threadsOf(thread).from, id);
    const first = await until(async () => {
      const t = await (await shim.api(`${S(thread)}/transcript`)).json();
      return t.turns?.[0]?.final ? t.turns[0] : null;
    }, "the thread's first turn");
    assert.deepEqual(first.brief, { from: id });
    assert.ok(calls.some((x) => x.first.includes(BRIEF_HEAD) && x.first.includes("Review each diff I send you")), "its model read the brief");
  });

  // (fails before: yes — the loop's call handed no way to ask, so a thread in a new project folder was refused as "no turn
  // of this chat runs now to ask it", in a turn that ran)
  test("a thread in a folder no project holds asks the person as a write there does: a yes starts it and makes the folder; read-only refuses", async () => {
    const archive = /** @type {any} */ (shim.app).memory.archive;
    const app = join(root, "app");
    mkdirSync(app, { recursive: true });
    /** A chat of the person's in `app`, its mode as given. @param {string} [mode] */
    const chatIn = async (mode) => {
      const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: app, model: "m-1", preset: "plain", ...(mode ? { settings: { loop: { permissions: mode } } } : {}) } });
      assert.equal(r.status, 200, await r.clone().text());
      return String((await r.json()).id);
    };
    const site = join(root, "site-new");
    const id = await chatIn();
    const asked = await turn(id, `START A THREAD IN ${site}`);
    assert.match(textOf(asked), /May I start the thread “Site builder” in .*site-new\? No project holds that folder yet/);
    assert.deepEqual(archive.threadsOf(id).started, [], "nothing starts before the person's yes");
    assert.equal(existsSync(site), false, "nor is the folder made");
    const r = await shim.api(`${S(id)}/turns`, { method: "POST", body: { content: "yes", stream: false, allow: true } });
    assert.equal(r.status, 200, await r.clone().text());
    await r.json();
    const started = archive.threadsOf(id).started;
    assert.equal(started.length, 1, "the yes started it");
    assert.equal(existsSync(site), true, "in the folder made for it");
    assert.ok(calls.some((x) => x.results.some((t) => /^Started the thread "Site builder" \(\w+\) on \S+ in .*site-new, a new project the person allowed:/.test(t))), JSON.stringify(calls.at(-1)?.results));

    const ro = await chatIn("read-only");
    const shut = join(root, "site-shut");
    await turn(ro, `START A THREAD IN ${shut}`);
    assert.deepEqual(archive.threadsOf(ro).started, [], "read-only starts none");
    assert.equal(existsSync(shut), false);
  });

  /** A chat of the person's in a folder under the root, made where it is not there. @param {string} name @param {string} [mode] */
  const chatAt = async (name, mode) => {
    mkdirSync(join(root, name), { recursive: true });
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: join(root, name), model: "m-1", preset: "plain", ...(mode ? { settings: { loop: { permissions: mode } } } : {}) } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** The person's yes to the call the chat waits on, its turn ended. @param {string} id */
  const yes = async (id) => {
    const r = await shim.api(`${S(id)}/turns`, { method: "POST", body: { content: "yes", stream: false, allow: true } });
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  /** Whether the thread tool handed some call an answer that `re` matches. @param {RegExp} re */
  const answered = (re) => calls.some((x) => x.results.some((t) => re.test(t)));

  // (fails before: yes — the folder was judged as a write there: Edit runs one inside the chat's folder unasked, so the
  // thread started with nobody asked, and its answer said "a new project the person allowed")
  test("a new folder inside the chat's own folder is asked for all the same; Full access starts it unasked, and the answer says which happened", async () => {
    const archive = /** @type {any} */ (shim.app).memory.archive;
    const id = await chatAt("inside");
    const fresh = join(root, "inside", "fresh");
    const asked = await turn(id, `START A THREAD IN ${fresh}`);
    assert.match(textOf(asked), /May I start the thread “Site builder” in .*fresh\? No project holds that folder yet/);
    assert.deepEqual(archive.threadsOf(id).started, [], "nothing starts before the person's yes");
    assert.equal(existsSync(fresh), false);
    await yes(id);
    assert.equal(archive.threadsOf(id).started.length, 1, "the yes started it");
    assert.ok(answered(/^Started the thread "Site builder" \(\w+\) on \S+ in .*fresh, a new project the person allowed:/), JSON.stringify(calls.at(-1)?.results));

    const free = await chatAt("inside", "auto");
    const unasked = join(root, "inside", "unasked");
    const went = await turn(free, `START A THREAD IN ${unasked}`);
    assert.doesNotMatch(textOf(went), /May I start/);
    assert.equal(archive.threadsOf(free).started.length, 1, "Full access starts it");
    assert.ok(answered(/^Started the thread "Site builder" \(\w+\) on \S+ in .*unasked, a new project made unasked as this chat's mode lets it:/), JSON.stringify(calls.at(-1)?.results));
  });

  // (fails before: yes — only a folder no project holds was asked for: a thread started in another project's folder
  // with nobody asked, where a write there asks)
  test("a thread in another project's folder asks first, as a write there would, in the thread's own words", async () => {
    const archive = /** @type {any} */ (shim.app).memory.archive;
    await turn(await chatAt("theirs"), "OFFER a project of its own");
    const id = await chatAt("mine");
    const theirs = join(root, "theirs");
    const asked = await turn(id, `START A THREAD IN ${theirs}`);
    assert.match(textOf(asked), /May I start the thread “Site builder” in .*theirs\? It is not this chat's own folder/);
    assert.deepEqual(archive.threadsOf(id).started, [], "nothing starts before the person's yes");
    await yes(id);
    const started = archive.threadsOf(id).started;
    assert.equal(started.length, 1, "the yes started it");
    assert.equal(/** @type {any} */ (shim.app).sessions.launchInfo(String(started[0])).cwd, theirs);
    assert.ok(answered(/^Started the thread "Site builder" \(\w+\) on \S+ in .*theirs, which the person allowed:/), JSON.stringify(calls.at(-1)?.results));
  });

  // (fails before: yes — the loop asked for the folder before the start was weighed: the person said yes to a thread
  // whose model could not run, and only then was it refused)
  test("a start refused whatever the answer asks nobody: a model that cannot run is said at once, the folder never asked for", async () => {
    const archive = /** @type {any} */ (shim.app).memory.archive;
    const id = await chatAt("refused");
    const site = join(root, "site-nope");
    const said = await turn(id, `START A THREAD ON nope-9 IN ${site}`);
    assert.doesNotMatch(textOf(said), /May I start/, "nobody is asked");
    assert.ok(answered(/Not started: nope-9 cannot run now/), JSON.stringify(calls.at(-1)?.results));
    assert.deepEqual(archive.threadsOf(id).started, []);
    assert.equal(existsSync(site), false);
  });
});

describe("threads at work in a running Filament", () => {
  /** @type {Call[]} */
  const calls = [];
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-thread-work-"));
  const work = join(root, "work");
  const S = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  const app = () => /** @type {any} */ (shim.app);
  /** A harness chat of the person's in the work folder. */
  const chat = () => String(app().sessions.create({ cwd: work, model: "agent/m-1", title: "Worker", preset: "plain" }).id);
  /** A turn of the person's, ended. @param {string} id @param {string} content @param {any} [more] */
  const turn = async (id, content, more = {}) => {
    const r = await shim.api(`${S(id)}/turns`, { method: "POST", body: { content, stream: false, ...more } });
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  /** The threads a chat started. @param {string} id @returns {string[]} */
  const threadsOf = (id) => app().memory.archive.threadsOf(id).started.map(String);
  /** The answers the tools handed the agents that say `words`. @param {string} words */
  const handed = (words) => calls.flatMap((c) => c.results).filter((r) => r.includes(words));
  /** How many letters a chat sent since its person last wrote. @param {string} id */
  const lettersFrom = (id) => Number(app().memory.archive.metaOf(id, ["letters"])?.letters?.alone) || 0;
  before(async () => {
    mkdirSync(work);
    up = await fakeUpstream(brainOn(calls));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"] }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(root);
  });

  // (fails before: yes — a thread's agent started threads of its own from its brief's turn, each counting its five from
  // none, with nobody's word between them; and a routine's run did)
  test("a thread starts none of its own until its person writes in it; a routine's run starts none", async () => {
    const id = chat();
    await turn(id, "START A THREAD THAT STARTS ONE");
    const [t] = threadsOf(id);
    assert.ok(t, "the chat's own thread started");
    await until(() => { const f = app().sessions.besideFacts(t); return !f.busy && !!f.last?.text; }, "the thread's first turn");
    assert.deepEqual(threadsOf(t), [], "its brief's turn started none");
    const why = handed("a thread starts none of its own until its person writes in it");
    assert.equal(why.length, 1, JSON.stringify(calls.map((c) => c.results)));
    assert.ok(why[0].includes(`or ask your starter for it in a letter (Filament's envelope tool, to: "${id}")`), why[0]);
    await turn(t, "START A THREAD");
    assert.equal(threadsOf(t).length, 1, "its person's word in it lets it start one");

    const run = chat();
    app().memory.archive.mergeMeta(run, { routine: { id: "r1", name: "Nightly" } });
    await turn(run, "START A THREAD");
    assert.deepEqual(threadsOf(run), [], "a routine's run starts none");
    assert.equal(handed("a routine's run starts no thread: say in your reply which thread you would start and why").length, 1);
  });

  // (fails before: yes — the first reply was read as the brief's turn first let go of the chat: at a question for the
  // person, the question went to the starter as the thread's first reply)
  test("notify waits out a question of the thread's first turn: its first reply reaches the starter as the turn that answers it lets go", async () => {
    const id = chat();
    const out = join(root, "outside-notes.txt");
    await turn(id, `START A NOTIFYING THREAD SAYING <<FIRST WRITE ${out} then say WROTE-IT-7.>>`);
    const [t] = threadsOf(id);
    assert.ok(t, "the thread started");
    assert.equal(handed("Its first finished reply comes back to you as a letter.").length, 1);
    await until(() => app().sessions.besideFacts(t).asking === true, "the thread's first turn asking the person");
    // Its turn let go of the chat to ask: Filament hears each release at once, so a letter would have gone by now.
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(lettersFrom(t), 0, "a question is no reply: nothing went to the starter");
    assert.equal(existsSync(out), false);
    await turn(t, "yes", { allow: true });
    assert.equal(existsSync(out), true, "the person's yes ran the call");
    const letter = String(await until(() => handed("WROTE-IT-7")[0] || null, "the starter's agent, woken, reading the thread's first reply", { timeoutMs: 20_000 }));
    assert.doesNotMatch(letter, /May I|Allow/, "the reply, not the question");
    assert.equal(app().memory.archive.metaOf(t, ["threadStart"])?.threadStart, undefined, "the start is settled");
  });

  // (fails before: yes — a reply longer than a letter holds was refused by the letter's own limit, and the starter
  // heard nothing at all)
  test("a first reply longer than a letter holds comes clipped, saying where the rest is", async () => {
    const id = chat();
    await turn(id, "START A NOTIFYING THREAD SAYING <<ANSWER AT LENGTH, please.>>");
    const [t] = threadsOf(id);
    const letter = String(await until(() => handed("more than a letter holds")[0] || null, "the long first reply's letter", { timeoutMs: 20_000 }));
    assert.ok(letter.includes("many words many words"), "how it begins");
    assert.ok(letter.includes(`[Filament: its reply is 32,999 characters, more than a letter holds: this is how it begins, and the rest is in its chat (${t}).]`), letter.slice(-400));
  });
});

describe("threads across a restart", () => {
  // (fails before: yes — the reply owed was kept in the running Filament alone, so a restart forgot it; and a chat made
  // for a thread whose brief was never posted stood linked and empty for good)
  test("a start a stop left unsettled: a thread that never got its brief is taken back, and a first reply still owed is sent", async () => {
    /** @type {Call[]} */
    const calls = [];
    const root = mkdtempSync(join(tmpdir(), "filament-thread-restart-"));
    const work = join(root, "work");
    mkdirSync(work);
    const up = await fakeUpstream(brainOn(calls));
    const configure = (/** @type {any} */ cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"] }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.memory.autopilot = { enabled: false };
      cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
    };
    const S = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
    let shim = await startApp({ memory: true, keep: true, configure });
    const dataDir = shim.dataDir;
    try {
      const app = () => /** @type {any} */ (shim.app);
      const id = String(app().sessions.create({ cwd: work, model: "agent/m-1", title: "Worker", preset: "plain" }).id);
      const out = join(root, "outside-notes.txt");
      const r = await shim.api(`${S(id)}/turns`, { method: "POST", body: { content: `START A NOTIFYING THREAD SAYING <<FIRST WRITE ${out} then say BACK-AFTER-RESTART.>>`, stream: false } });
      assert.equal(r.status, 200, await r.clone().text());
      const t = String(app().memory.archive.threadsOf(id).started[0]);
      await until(() => app().sessions.besideFacts(t).asking === true, "the thread's first turn asking the person");
      assert.deepEqual(app().memory.archive.metaOf(t, ["threadStart"])?.threadStart, { starter: id, title: "Advisor", notify: true }, "the reply owed is kept on the thread's chat");
      // A chat made for a thread and marked as `start` marks one before it posts the brief: where a stop leaves it.
      const empty = String(app().sessions.create({ cwd: work, model: "agent/m-1", title: "Never briefed", preset: "plain", thread: id }).id);
      app().memory.archive.mergeMeta(empty, { threadStart: { starter: id, title: "Never briefed", notify: false } });
      await shim.stop();
      shim = await startApp({ memory: true, dataDir, configure });
      await until(() => !app().memory.archive.getChain(empty), "the thread that never got its brief, taken back as Filament starts");
      assert.deepEqual(app().memory.archive.threadsOf(id).started.map(String), [t], "the thread that got its brief stands");
      const yes = await shim.api(`${S(t)}/turns`, { method: "POST", body: { content: "yes", stream: false, allow: true } });
      assert.equal(yes.status, 200, await yes.clone().text());
      await until(() => calls.some((c) => c.results.some((x) => x.includes("BACK-AFTER-RESTART"))), "the starter's agent, woken, reading the first reply owed since before the restart", { timeoutMs: 20_000 });
      assert.equal(app().memory.archive.metaOf(t, ["threadStart"])?.threadStart, undefined, "settled once sent");
    } finally {
      await shim.stop();
      await up.close();
      await removeDirs(root, dataDir);
    }
  });
});

describe("the thread tool in a running Filament: a coding agent's session", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-thread-offer-acp-"));
  const project = join(root, "project");
  /** The session methods the fake agent is sent. */
  const sentTo = join(root, "acp-calls.jsonl");
  const S = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  before(async () => {
    mkdirSync(project);
    up = await fakeUpstream(() => undefined);
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
          { id: "coder", name: "coder", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: sentTo, FAKE_ACP_ALLOW_LOAD: "1", FAKE_ACP_SESSION_CAPS: "resume", FAKE_ACP_MCP_CAPS: "http" }, cwdDefault: project, permissions: "allow-all", hints: false } },
          { id: "cx", name: "Codex", type: "codex", acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], env: { FAKE_CODEX_CALLS: join(root, "cx.jsonl") }, cwdDefault: project, permissions: "allow-all" } },
        ];
        cfg.routes = [
          { match: "coder/*", upstream: "coder", upstreamModel: "{1}", enabled: true },
          { match: "cx/*", upstream: "cx", upstreamModel: "{1}", enabled: true },
        ];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(root, shim?.dataDir);
  });
  /** A harness chat on a coding agent. @param {string} [model] */
  const chat = async (model = "coder/fake-a") => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: project, model, preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** A chat's transcript. @param {string} id */
  const read = async (id) => /** @type {any} */ (await (await shim.api(`${S(id)}/transcript`)).json());
  /** The first turn of a thread, once it ended. @param {string} id */
  const firstTurn = (id) => until(async () => ((await read(id)).turns?.[0]?.final ? (await read(id)).turns[0] : null), "the thread's first turn", { timeoutMs: 20_000 });
  /** The threads a chat started. @param {string} id @returns {string[]} */
  const threadsOf = (id) => /** @type {any} */ (shim.app).memory.archive.threadsOf(id).started.map(String);
  /** A turn, sent as it is where what the chat gives the agent changed. @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`${S(id)}/turns`, { method: "POST", body: { content, stream: false, sendAsIs: true } });
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  /** The opens (new, load, resume) the fake agent was sent. */
  const opens = () => opensIn(sentTo);

  // (fails before: yes — the session's toolsAt carried no thread, so its list never had it; and the switch flipped
  // nothing the bridge weighed, so the session went on with the list it opened with)
  test("a harness chat's own agent lists thread, held by name; the switch off opens its session again without it", async () => {
    const id = await chat();
    await turn(id, "hello");
    const opened = opens().at(-1);
    assert.equal(opened?.method, "session/new");
    const names = await listedAt(String(opened.mcpUrl));
    assert.ok(names.includes("thread"), names.join(", "));
    assert.ok(names.includes("team"), "as the team tool is");
    const r = await shim.api(`${S(id)}/settings`, { method: "PATCH", body: { patch: { loop: { tools: { thread: false } } } } });
    assert.equal(r.status, 200, await r.clone().text());
    const before = opens().length;
    await turn(id, "again");
    assert.equal(opens().length, before + 1, "opened again");
    const reopened = opens().at(-1);
    assert.match(String(reopened?.method), /^session\/(resume|load)$/);
    assert.notEqual(reopened.mcpUrl, opened.mcpUrl, "at a new address, with its tools as they are now");
    const now = await listedAt(String(reopened.mcpUrl));
    assert.ok(!now.includes("thread"), now.join(", "));
    assert.ok(now.includes("team"), now.join(", "));
  });

  // (fails before: yes — no test started a thread from a coding agent's session; and a thread's agent started threads of
  // its own from its brief's turn)
  test("a coding agent's call over Filament's MCP server starts a linked chat, its first turn the brief; that thread starts none until its person writes in it", async () => {
    const id = await chat();
    const nested = `~mcpcall thread ${JSON.stringify({ title: "Deeper", brief: "Review the reviews." })}`;
    const said = await turn(id, `~mcpcall thread ${JSON.stringify({ title: "Advisor", brief: `Review each diff I send you. ${nested}` })}`);
    assert.match(textOf(said), /mcp:Started the thread "Advisor" \(\w+\) on \S+ in \S+: it reads your brief now\./);
    const [t] = threadsOf(id);
    assert.ok(t, "linked to its starter");
    const first = await firstTurn(t);
    assert.deepEqual(first.brief, { from: id }, "its first turn is the starter's brief");
    assert.equal(first.user.content.filter((/** @type {any} */ b) => b?.type === "text" && String(b.text).includes("Review each diff I send you.")).length, 1, "one block, the words after its head");
    assert.match(textOf(first.final), /mcp:error:Not started: a thread starts none of its own until its person writes in it/, "its own call from the brief's turn is refused in words");
    assert.deepEqual(threadsOf(t), []);
    const mine = await turn(t, nested);
    assert.match(textOf(mine), /mcp:Started the thread "Deeper"/, "its person's word in it lets it start one");
    assert.equal(threadsOf(t).length, 1);
  });

  // (fails before: yes — a coding agent's call was judged as a write in the folder: Edit runs one inside the chat's
  // folder unasked, so the thread started in a new folder with nobody asked, and said the person allowed it)
  test("a coding agent's thread in a folder no project holds asks the person on its turn's card; a yes starts it", async () => {
    const id = await chat();
    const fresh = join(project, "fresh-acp");
    const going = shim.api(`${S(id)}/turns`, { method: "POST", body: { content: `~mcpcall thread ${JSON.stringify({ title: "Site", brief: "Build it.", folder: fresh })}`, stream: false, sendAsIs: true } });
    const asks = async () => /** @type {any[]} */ ((await (await shim.api(`${S(id)}/asks`)).json()).asks || []);
    const ask = await until(async () => (await asks())[0] || null, "the thread's question on the turn's card", { timeoutMs: 20_000 });
    assert.match(JSON.stringify(ask), /May I start the thread “Site” in .*fresh-acp\? No project holds that folder yet/);
    assert.deepEqual(threadsOf(id), [], "nothing starts before the person's yes");
    assert.equal(existsSync(fresh), false);
    const yes = await shim.api(`${S(id)}/asks/${encodeURIComponent(String(ask.id))}/answer`, { method: "POST", body: { allow: true } });
    assert.equal(yes.status, 200, await yes.clone().text());
    const r = await going;
    assert.equal(r.status, 200, await r.clone().text());
    assert.match(textOf(await r.json()), /mcp:Started the thread "Site" \(\w+\) on \S+ in .*fresh-acp, a new project the person allowed:/);
    assert.equal(threadsOf(id).length, 1);
    assert.equal(existsSync(fresh), true);
  });

  // (fails before: no — a guard: Codex reaches the tool over the same MCP server; no test started a thread from it)
  test("Codex's call starts a linked chat too, its first turn the brief", async () => {
    const id = await chat("cx/gpt-5.5");
    const said = await turn(id, `~mcpcall thread ${JSON.stringify({ title: "Advisor", brief: "Review each diff I send you." })}`);
    assert.match(textOf(said), /mcp:Started the thread "Advisor" \(\w+\) on \S+ in \S+: it reads your brief now\./);
    const [t] = threadsOf(id);
    assert.ok(t, "linked to its starter");
    assert.deepEqual((await firstTurn(t)).brief, { from: id });
  });
});

/** The names Filament's MCP server lists at an address a coding agent's session was given. @param {string} url */
const listedAt = async (url) => {
  const r = await fetch(url, { method: "POST", headers: { ...JSON_TYPE, accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
  const j = await r.json();
  return /** @type {any[]} */ (j.result?.tools || []).map((t) => String(t.name));
};

describe("the thread tool under Full control: another machine's agents' chat", () => {
  /** @type {Call[]} */
  const calls = [];
  const base = mkdtempSync(join(tmpdir(), "filament-thread-full-"));
  const project = join(base, "project");
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startTwoMachines>>} */
  let two;
  /** @type {import("./helpers/two-machines.js").Machine} */
  let there;
  let deviceId = "";
  let token = "";
  /** The session methods the fake coding agent there is sent. */
  const sentTo = join(base, "acp-calls.jsonl");
  /** A chat of the agents' own there, on a model, and its turn, ended. @param {string} model @param {string} content */
  const theirTurn = async (model, content) => {
    const r = await agents("/api/sessions", { method: "POST", body: { cwd: project, model, preset: "plain" } });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    const t = await agents(`/api/sessions/${encodeURIComponent(String(j.id))}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
  };
  /** Requests to `there` as another machine's Filament sends them, pinned, its agents' token their Bearer. @param {string} path @param {{ method?: string, body?: unknown }} [o] */
  const agents = (path, { method = "GET", body } = {}) =>
    pinnedFetch(there.lan.fingerprint)(`${there.far}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : JSON_TYPE) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  /** Grants set by there's own computer. @param {Record<string, boolean>} set */
  const grants = async (set) => {
    const r = await there.api(`/api/remote/devices/${encodeURIComponent(deviceId)}`, { method: "PATCH", body: { grants: set } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  before(async () => {
    mkdirSync(project, { recursive: true });
    up = await fakeUpstream(brainOn(calls));
    two = await startTwoMachines({
      there: {
        configure: (cfg) => {
          cfg.upstreams = [
            { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
            { id: "coder", name: "coder", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: sentTo, FAKE_ACP_MCP_CAPS: "http" }, cwdDefault: project, permissions: "allow-all", hints: false } },
          ];
          cfg.routes = [
            { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
            { match: "coder/*", upstream: "coder", upstreamModel: "{1}", enabled: true },
          ];
          cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [base], readerModel: "" };
        },
      },
    });
    there = two.there;
    const minted = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" })).json();
    deviceId = String(minted.device.id);
    token = String(minted.token);
    await grants({ agents: true, full: true });
  });
  after(async () => {
    await two?.stop();
    await up?.close();
    await removeDirs(base);
  });

  // (fails before: no — a guard: the tool is new; it fails once its gate reads Full control's lifted fence as the person's chat)
  test("their chat on Filament's own agent, running as the person's own here, is offered the team tool and never thread", async () => {
    await theirTurn("agent/m-1", "OFFER full control");
    const c = calls.findLast((x) => x.last.includes("OFFER full control"));
    assert.ok(c, "a call for their turn");
    assert.ok(c.tools.includes("team"), `Full control lifts the fence the team tool keeps to: ${c.tools.join(", ")}`);
    assert.ok(!c.tools.includes("thread"), c.tools.join(", "));
  });

  // (fails before: no — a guard, as above, for a coding agent's session there)
  test("their chat on a coding agent lists the team tool and never thread", async () => {
    await theirTurn("coder/fake-a", "hello");
    const opened = opensIn(sentTo).at(-1);
    assert.equal(opened?.method, "session/new");
    const names = await listedAt(String(opened.mcpUrl));
    assert.ok(names.includes("team"), names.join(", "));
    assert.ok(!names.includes("thread"), names.join(", "));
  });
});
