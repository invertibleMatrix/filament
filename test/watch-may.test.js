// @ts-check
// What a watcher may do, by whom it wakes (the plan of 11-11, its w6a). One that wakes a new chat each time runs as a
// routine's run does. One that wakes the chat that proposed it takes a turn there: held to reading by Filament whatever
// that chat's own permissions — the road a /plan's turn takes —, its question's answer too; or, where it writes,
// working as that chat works. One that tells only the person runs nothing. A watcher whose trigger names a chat may be
// let guide it (`guides`). Each is said in its own words wherever Filament says what a watcher may do, and the fields
// that cannot stand together are refused in words, on a change as on a new one. A wake's turn that a restart cut off
// is gone on with by Filament itself: held as it began.
// (fails before: yes — every watcher was said to read only in a new chat on a model of its own, whatever it woke; a
// wake's turn ran in its chat's own mode; `writes` and `acts` were taken for all three and read for one)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GUIDES_PER_MESSAGE, WAKE_HEAD } from "../src/core/watchers.js";
import { mayWords, routineClash, routineFields, routinesWords, rowWords, wakeWords } from "../src/core/routines.js";
import { entryWords } from "../src/core/space.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { startApp, fakeUpstream, anthropicReply, FAKE_ACP_AGENT } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-watch-may-${tag}-`));
  made.push(d);
  return d;
};

/** A moment of Monday 26 October 2026, local. @param {number} h @param {number} [m] */
const at = (h, m = 0) => new Date(2026, 9, 26, h, m).getTime();
const NAMES = /** @type {Record<string, string>} */ ({ c1: "Lead", c2: "Build the login flow" });
/** @param {string} c */
const nameOf = (c) => NAMES[c] || "an untitled chat";
const TURNS = "after each turn of Build the login flow that changes files or marks tasks done";
const WATCH = { title: "Supervisor", text: "Read its turn; if it drifted from the person's ask, say how.", trigger: { kind: "turn", chat: "c2" } };
/** A watcher's fields, as core checks them. @param {any} [o] */
const fieldsOf = (o = {}) => {
  const f = routineFields({ ...WATCH, ...o }, { create: true });
  assert.ok(f.ok, JSON.stringify(f));
  return f.fields;
};
/** Why core refuses a write, in its words. @param {any} input @param {boolean} [create] */
const refused = (input, create = true) => {
  const f = routineFields(input, { create });
  assert.equal(f.ok, false, JSON.stringify(input));
  return f.ok ? "" : f.error;
};
const BY = { chain: "c1", byName: "Lead", model: "m", nameOf };
/** @param {() => unknown} fn */
const refusal = (fn) => {
  try {
    fn();
  } catch (/** @type {any} */ e) {
    return [e.status, e.message];
  }
  return null;
};
/** A watcher on, as its Space keeps it. @param {any} [o] @returns {import("../src/core/routines.js").Routine} */
const watcher = (o = {}) => ({
  id: "r1", title: "Supervisor", when: "", task: "x", writes: false, trigger: { kind: "turn", chat: "c2", turns: "changed", every: 1 }, wakes: "new", state: "on", paused: false,
  madeIn: "c1", madeBy: "Lead", model: "m", at: at(9), onAt: at(9), upTo: null, last: null, skipped: null, seen: { from: at(9), at: null, ids: [] }, pending: null, ...o,
});

// What each sentence says, once: the sheet's.
const READS = "Reads only: it changes no file and sends nothing; it may write drafts and lines in What happened";
const HELD = "A turn in Lead, held to reading: it changes no file and runs no command that changes one, whatever that chat's own permissions";
const LIMIT = ". Filament holds it by refusing what that chat's agent asks to do: a coding agent that asks nothing before it acts cannot be held, and where Filament knows that of the chat's agent, the watcher fails rather than wake it";
const WORKS = "A turn in Lead, working as that chat works: in its folder, with its own permissions and model";
const TOLD = "Runs nothing: what it hears is told to you, in Needs you";
const GUIDE = "; it may guide Build the login flow: guidance that chat reads at its next step, or as a turn of its own where it is at rest — 3 at most for each message of yours there, the next held in Needs you for your Send it —, or a sealed letter";
const ACTS_CHAT = 'acts belong to a run in a chat of its own (wakes: "new"): a watcher that wakes its chat reads only, or with writes: true works as that chat does';
const NO_CHAT = "guides needs a trigger that names a chat — a turn, task, ask, shell or subagent trigger with its chat —: that chat is the one this watcher may guide";
const TIMED = "guides is a watcher's: a routine at times watches no chat it could guide";
/** @param {string} what */
const ONLY_YOU = (what) => `a watcher that tells only the person (wakes: "you") runs nothing: it takes no ${what}`;

describe("what a watcher may do, in words (core)", () => {
  test("the sheet's sentence is each kind's own: a run in a chat of its own, a turn in its chat held to reading or working as it works, or nothing run; a guide's clause where it may guide", () => {
    assert.equal(GUIDES_PER_MESSAGE, 3, "the most guidance a watched chat is sent for each message of the person's there");
    // A new chat each time: as a routine's run.
    assert.equal(mayWords(watcher(), { nameOf }), READS);
    assert.equal(mayWords(watcher({ guides: true }), { nameOf }), `${READS}${GUIDE}`);
    assert.equal(mayWords(watcher({ writes: true, guides: true }), { nameOf }), `Writes in a lane of its own, a worktree made for each run: what it changed waits there for you, like any lane's${GUIDE}`);
    // The chat that proposed it: a turn there, never a run — held to reading, and how; or as that chat works.
    assert.equal(mayWords(watcher({ wakes: "chat" }), { nameOf }), `${HELD}${LIMIT}`);
    assert.equal(mayWords(watcher({ wakes: "chat", guides: true }), { nameOf }), `${HELD}${GUIDE}${LIMIT}`);
    assert.equal(mayWords(watcher({ wakes: "chat", writes: true }), { nameOf }), WORKS);
    assert.equal(mayWords(watcher({ wakes: "chat", writes: true, guides: true }), { nameOf }), `${WORKS}${GUIDE}`);
    // Only the person: nothing runs.
    assert.equal(mayWords(watcher({ wakes: "you" }), { nameOf }), TOLD);
    // A routine at times, as it was.
    assert.equal(mayWords({ writes: false }), READS);
  });

  test("its row: whom it wakes and what that turn may do, never a run's words for a turn; paused, a watcher listens again", () => {
    const now = at(10);
    /** @param {any} o */
    const row = (o) => rowWords(watcher(o), { now, nameOf });
    assert.deepEqual([row({}).may, row({}).allowed], ["reads only · wakes a new chat each time", READS]);
    assert.equal(row({ guides: true }).may, "reads only · wakes a new chat each time · may guide Build the login flow");
    assert.deepEqual([row({ wakes: "chat" }).may, row({ wakes: "chat" }).allowed], ["wakes Lead · its turn held to reading", `${HELD}${LIMIT}`]);
    assert.deepEqual([row({ wakes: "chat", writes: true, guides: true }).may, row({ wakes: "chat", writes: true, guides: true }).allowed],
      ["wakes Lead · its turn works as that chat does · may guide Build the login flow", `${WORKS}${GUIDE}`]);
    assert.deepEqual([row({ wakes: "you" }).may, row({ wakes: "you" }).allowed], ["tells only you, in Needs you · runs nothing", TOLD]);
    // Paused: a watcher has no time to run at.
    assert.equal(row({ paused: true }).next, "paused: it listens again once you resume it");
    assert.equal(row({ paused: true, pausedWhy: "the chat it wakes (Lead) is gone" }).next, "paused by Filament: the chat it wakes (Lead) is gone — it listens again once you resume it");
    assert.equal(row({ paused: true, pausedBy: { chain: "c2", byName: "Docs", line: "CI is red" } }).next, "paused by Docs: CI is red — it listens again once you resume it");
    // A routine at times runs when resumed, as it did.
    assert.equal(rowWords({ ...watcher({ paused: true, when: "daily 09:00" }), trigger: undefined, wakes: undefined }, { now, nameOf }).next, "paused: it runs when you resume it");
  });

  test("the agents' read: a turn in the chat that proposed it — to that chat, \"you\" —, never a run that \"reads only\"; one that tells only the person runs nothing", () => {
    const now = at(10);
    /** @param {any} o @param {string} self */
    const read = (o, self) => routinesWords([watcher(o)], { nameOf, now, self }).split("\n").at(-1);
    assert.equal(read({}, "c2"), `- r1 "Supervisor" (by Lead), ${TURNS}, wakes a new chat each time, reads only: on`);
    assert.equal(read({ guides: true }, "c2"), `- r1 "Supervisor" (by Lead), ${TURNS}, wakes a new chat each time, reads only, may guide you: on`);
    assert.equal(read({ wakes: "chat" }, "c2"), `- r1 "Supervisor" (by Lead), ${TURNS}, wakes Lead in a turn held to reading: on`);
    assert.equal(read({ wakes: "chat", guides: true }, "c1"), `- r1 "Supervisor" (yours), ${TURNS}, wakes you in a turn held to reading, may guide Build the login flow: on`);
    assert.equal(read({ wakes: "chat", writes: true }, "c1"), `- r1 "Supervisor" (yours), ${TURNS}, wakes you in a turn that works as this chat does: on`);
    assert.equal(read({ wakes: "chat", writes: true }, "c2"), `- r1 "Supervisor" (by Lead), ${TURNS}, wakes Lead in a turn that works as that chat does: on`);
    assert.equal(read({ wakes: "you" }, "c2"), `- r1 "Supervisor" (by Lead), ${TURNS}, tells only the person, in Needs you, and runs nothing: on`);
  });

  test("the woken chat is told what its turn may do, in Filament's block", () => {
    const o = { project: "app", when: "after each turn", heard: null, by: /** @type {const} */ ("you") };
    const reads = wakeWords({ id: "r3", title: "Supervisor", task: "Say how it drifted.", writes: false }, o);
    assert.ok(reads.startsWith(WAKE_HEAD), reads);
    assert.match(reads.split("\n\n")[0], /never the person's\. This turn reads only: Filament refuses what would change a file; the person's word comes before the watcher's\.\]$/);
    const works = wakeWords({ id: "r3", title: "Supervisor", task: "Say how it drifted.", writes: true }, o);
    assert.match(works.split("\n\n")[0], /never the person's\. This turn works as this chat works; the person's word comes before the watcher's\.\]$/);
    assert.ok(!works.includes("reads only"), works);
  });

  test("guides: true or false, a watcher's whose trigger names a chat it does not only tell the person of; the fields that cannot stand together are refused in words", () => {
    assert.deepEqual(routineFields({ ...WATCH, guides: true }, { create: true }), { ok: true, fields: { title: "Supervisor", task: WATCH.text, writes: false, trigger: { kind: "turn", chat: "c2", turns: "changed", every: 1 }, wakes: "new", guides: true } });
    assert.deepEqual(routineFields({ guides: false }, { create: false }), { ok: true, fields: { guides: false } }, "a change may take it back");
    assert.equal(refused({ ...WATCH, guides: "yes" }), "guides is true or false: true lets a watcher write to the chat its trigger names");
    assert.equal(refused({ title: "Brief", when: "daily 09:00", text: "x", guides: true }), TIMED);
    assert.equal(refused({ ...WATCH, wakes: "you", guides: true }), ONLY_YOU("guides: true"));
    assert.equal(refused({ ...WATCH, trigger: { kind: "commit", branch: "main" }, guides: true }), NO_CHAT);
    assert.equal(refused({ ...WATCH, trigger: { kind: "task" }, guides: true }), NO_CHAT, "a task trigger of any chat names none");
    assert.ok(routineFields({ ...WATCH, trigger: { kind: "task", chat: "c2" }, wakes: "chat", guides: true }, { create: true }).ok);
    // What a wake's turn never reads is no field of it.
    assert.equal(refused({ ...WATCH, wakes: "chat", acts: ["mcp__gmail__archive"] }), ACTS_CHAT);
    assert.ok(routineFields({ ...WATCH, wakes: "chat", acts: [] }, { create: true }).ok, "none named is none");
    assert.equal(refused({ ...WATCH, wakes: "you", writes: true }), ONLY_YOU("writes: true"));
    assert.equal(refused({ ...WATCH, wakes: "you", acts: ["mcp__gmail__archive"] }), ONLY_YOU("acts"));
    // One rule, the store's too: a record whole.
    assert.equal(routineClash({ trigger: { kind: "turn", chat: "c2", turns: "changed", every: 1 }, wakes: "chat", writes: true, guides: true }), null);
    assert.equal(routineClash({ trigger: { kind: "turn", chat: "c2", turns: "changed", every: 1 }, wakes: "chat", acts: ["mcp__gmail__archive"] }), ACTS_CHAT);
    assert.equal(routineClash({ writes: true, acts: ["mcp__gmail__archive"] }), null, "a routine at times, as it was");
    // The refusals that list a routine's fields name a watcher's too.
    assert.equal(refused(null), "a routine is a JSON object: { title, when, text, writes?, acts? }, or a watcher's: { title, trigger, text, wakes?, writes?, acts?, guides? }");
    assert.equal(refused({}, false), "say what changes: title, when or trigger, text, writes, acts, wakes or guides");
  });
});

describe("the store keeps what a watcher may do, and says it", () => {
  test("guides is kept across a restart; a change of it switches a watcher that is on off; taken back, it leaves no word", () => {
    const clock = { at: at(9) };
    const dir = fresh("guides");
    const store = createSpaceStore({ dir, now: () => clock.at });
    const r = store.routinePropose("p1", fieldsOf({ wakes: "chat", guides: true }), BY);
    assert.equal(r.guides, true);
    assert.equal(createSpaceStore({ dir, now: () => clock.at }).get("p1").routines[0].guides, true, "kept in its file");
    store.routineOn("p1", "r1");
    clock.at = at(9, 5);
    const off = store.routinePropose("p1", { guides: false }, BY, "r1");
    assert.deepEqual([off.state, off.onAt, "guides" in off], ["proposed", null, false], "as any change: off until the person switches it on again");
    assert.equal("guides" in createSpaceStore({ dir, now: () => clock.at }).get("p1").routines[0], false);
    // One that never said it has no word of it.
    assert.equal("guides" in store.routinePropose("p1", fieldsOf(), BY), false);
    // A file that says it of one that may not guide — it tells only the person, its trigger names no chat, it runs at
    // times — is read without it; any word but true is none.
    const file = join(dir, "p1.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const w = doc.routines[0];
    doc.routines = [{ ...w, id: "r5", guides: true }, { ...w, id: "r6", guides: true, wakes: "you" }, { ...w, id: "r7", guides: true, trigger: { kind: "commit", branch: "main" } },
      { ...w, id: "r8", guides: true, trigger: undefined, when: "daily 09:00" }, { ...w, id: "r9", guides: "yes" }];
    writeFileSync(file, JSON.stringify(doc));
    assert.deepEqual(createSpaceStore({ dir, now: () => clock.at }).get("p1").routines.map((x) => [x.id, x.guides ?? null]), [["r5", true], ["r6", null], ["r7", null], ["r8", null], ["r9", null]]);
  });

  test("a change is checked on the record it makes: guides where it tells only the person or names no chat, acts where it wakes its chat, writes where nothing runs — refused, and nothing changed", () => {
    const store = createSpaceStore({ dir: null, now: () => at(9) });
    store.routinePropose("p1", fieldsOf({ wakes: "chat", guides: true }), BY);
    const was = JSON.stringify(store.get("p1").routines[0]);
    assert.deepEqual(refusal(() => store.routinePropose("p1", { wakes: "you" }, BY, "r1")), [409, `“Supervisor”: ${ONLY_YOU("guides: true")}.`]);
    assert.deepEqual(refusal(() => store.routinePropose("p1", { trigger: { kind: "commit", branch: "main" } }, BY, "r1")), [409, `“Supervisor”: ${NO_CHAT}.`]);
    assert.deepEqual(refusal(() => store.routinePropose("p1", { acts: ["mcp__gmail__archive"] }, BY, "r1")), [409, `“Supervisor”: ${ACTS_CHAT}.`]);
    assert.equal(JSON.stringify(store.get("p1").routines[0]), was, "refused whole: nothing of it changed");
    // The same change with what clashed taken back goes.
    assert.equal(store.routinePropose("p1", { wakes: "you", guides: false }, BY, "r1").wakes, "you");
    assert.deepEqual(refusal(() => store.routinePropose("p1", { writes: true }, BY, "r1")), [409, `“Supervisor”: ${ONLY_YOU("writes: true")}.`]);
    assert.deepEqual(refusal(() => store.routinePropose("p1", { guides: true }, BY, "r1")), [409, `“Supervisor”: ${ONLY_YOU("guides: true")}.`]);
    // A new one handed past core's check is held to the same rule; a routine at times guides no chat.
    assert.deepEqual(refusal(() => store.routinePropose("p1", { title: "Other", task: "x", writes: false, trigger: { kind: "commit", branch: "main" }, wakes: "new", guides: true }, BY)), [409, `“Other”: ${NO_CHAT}.`]);
    const brief = store.routinePropose("p1", { title: "Brief", when: "daily 09:00", task: "x", writes: false }, BY);
    assert.deepEqual(refusal(() => store.routinePropose("p1", { guides: true }, BY, brief.id)), [409, `“Brief”: ${TIMED}.`]);
    assert.equal(store.get("p1").routines.length, 2, "none made of a refusal");
  });

  test("What happened says what each may do as it is proposed and switched on, the chats it names kept apart", () => {
    /** @param {any} o */
    const lines = (o) => {
      const store = createSpaceStore({ dir: null, now: () => at(9) });
      store.routinePropose("p1", fieldsOf(o), BY);
      const proposed = store.get("p1").log.at(-1);
      store.routineOn("p1", "r1", null, { nameOf });
      return { proposed, on: store.get("p1").log.at(-1) };
    };
    const P = `Proposed a watcher: “Supervisor”, ${TURNS}, `;
    // In Watchers: the page of their own they are listed on (the plan of 11-11, its w8).
    const END = ". It listens only once you switch it on, in Watchers.";
    const ON = "You switched on the watcher “Supervisor”: it listens from now and ";
    const fresh1 = lines({});
    assert.deepEqual([fresh1.proposed?.text, fresh1.on?.text], [`${P}wakes a new chat each time, reading only${END}`, `${ON}wakes a new chat each time, reading only.`]);
    const held = lines({ wakes: "chat", guides: true });
    assert.deepEqual([held.proposed?.text, held.on?.text],
      [`${P}wakes Lead in a turn held to reading, and may guide Build the login flow${END}`, `${ON}wakes Lead in a turn held to reading, and may guide Build the login flow.`]);
    const works = lines({ wakes: "chat", writes: true });
    assert.deepEqual([works.proposed?.text, works.on?.text], [`${P}wakes Lead in a turn that works as that chat works${END}`, `${ON}wakes Lead in a turn that works as that chat works.`]);
    const told = lines({ wakes: "you" });
    assert.deepEqual([told.proposed?.text, told.on?.text], [`${P}tells only you, in Needs you: nothing runs${END}`, `${ON}tells only you, in Needs you: nothing runs.`]);
    const lane = lines({ writes: true, guides: true });
    assert.equal(lane.proposed?.text, `${P}wakes a new chat each time, writing in a lane of its own, and may guide Build the login flow${END}`);
    // A chat whose words are its own alone is never named to another chat's agent: the chat it wakes, the one it guides.
    for (const e of [held.proposed, held.on]) {
      assert.ok(e, "its line");
      const said = entryWords(e, () => "an untitled chat", (c) => c === "c1" || c === "c2");
      assert.ok(!said.includes("Lead") && !said.includes("Build the login flow"), said);
      assert.match(said, /wakes an untitled chat in a turn held to reading, and may guide an untitled chat/);
    }
  });

  test("a watcher that starts no chat of its own runs on no model of its own: none is chosen for it", () => {
    const store = createSpaceStore({ dir: null, now: () => at(9) });
    store.routinePropose("p1", fieldsOf({ wakes: "chat" }), BY);
    store.routinePropose("p1", fieldsOf({ wakes: "you" }), BY);
    store.routinePropose("p1", fieldsOf(), BY);
    assert.deepEqual(refusal(() => store.routineModel("p1", "r1", "glm-5.3")), [409, "“Supervisor” takes a turn in the chat that proposed it, on that chat's own model: none is chosen for it."]);
    assert.deepEqual(refusal(() => store.routineModel("p1", "r2", "glm-5.3")), [409, "“Supervisor” tells only you, and runs nothing: no model is chosen for it."]);
    assert.equal(store.routineModel("p1", "r3", "glm-5.3").model, "glm-5.3", "one that wakes a new chat runs on one, as a routine does");
  });
});

/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : Array.isArray(m?.content) ? m.content.map((/** @type {any} */ b) => b?.text || "").join("\n") : "");
/** A request's newest tool result's text, by its call's id. @param {any} body @param {string} id */
const resultOf = (body, id) => {
  const b = (body?.messages?.at(-1)?.content || []).find?.((/** @type {any} */ x) => x?.type === "tool_result" && x.tool_use_id === id);
  if (!b) return null;
  return typeof b.content === "string" ? b.content : (b.content || []).map((/** @type {any} */ x) => x.text || "").join("");
};
/** A project as the person has one: a git repository. @param {string} root */
const repo = (root) => {
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", ["-c", "user.email=ada@example.com", "-c", "user.name=Ada Lovelace", ...args], { cwd: root, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(root, "README.md"), "app\n");
  git("add", ".");
  git("commit", "-q", "-m", "First");
};

describe("a watcher's turn in the chat that proposed it, on a real Filament: Filament's own agent", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let project = "";
  before(async () => {
    root = fresh("loop");
    repo(root);
    // What the model does with a wake is its watcher's own words: one writes, is answered, asks, and writes again.
    up = await fakeUpstream(async (/** @type {any} */ call) => {
      const body = call.body || {};
      const model = String(body.model || "");
      if (!(body.tools || []).length) return anthropicReply("A title", { model });
      /** @param {string} id @param {string} name @param {any} input */
      const use = (id, name, input) => anthropicReply("", { model, stop: "tool_use", blocks: [{ type: "tool_use", id, name, input }], usage: { input_tokens: 30, output_tokens: 7 } });
      if (resultOf(body, "ww2") !== null || resultOf(body, "wk1") !== null || resultOf(body, "wp1") !== null) return anthropicReply("Looked.", { model });
      if (resultOf(body, "wa1") !== null) return use("ww2", "write", { path: "after.txt", content: "x" });
      if (resultOf(body, "ww1") !== null) return use("wa1", "ask", { question: "Go on?" });
      const said = textOf([...(body.messages || [])].reverse().find((/** @type {any} */ m) => m.role === "user" && textOf(m).trim()));
      if (said.includes(WAKE_HEAD) && said.includes("WRITE-THEN-ASK")) return use("ww1", "write", { path: "woken.txt", content: "x" });
      if (said.includes(WAKE_HEAD) && said.includes("WORK-AS-CHAT")) return use("wk1", "write", { path: "worked.txt", content: "x" });
      if (said.includes("PERSON-WRITES")) return use("wp1", "write", { path: "mine.txt", content: "x" });
      return anthropicReply("Okay.", { model });
    });
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });
  /** A chat of the project whose own switch is Auto, and a watcher it proposed, on. @param {string} text @param {any} [o] */
  const woken = async (text, o = {}) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(r.status, 200, await r.clone().text());
    const chat = String((await r.json()).id);
    project = String(shim.app.memory.archive?.getChain(chat)?.project_id || "");
    assert.ok(project, "the chat is of a project");
    const spaces = shim.app.spaces;
    spaces.make(project);
    const f = routineFields({ title: "Supervisor", text, wakes: "chat", trigger: { kind: "turn", chat: "c-none", turns: "all" }, ...o }, { create: true });
    assert.ok(f.ok, JSON.stringify(f));
    const id = spaces.routinePropose(project, f.fields, { chain: chat, byName: "Lead", model: "agent/brain-model", nameOf: () => "Lead" }).id;
    spaces.routineOn(project, id);
    return { chat, id, of: () => spaces.get(project).routines.find((x) => x.id === id), at: `/api/sessions/${encodeURIComponent(chat)}` };
  };
  /** Run now, the person's press, as the page sends it. @param {{ id: string }} w */
  const runNow = async (w) => {
    const r = await shim.api(`/api/space/${encodeURIComponent(project)}/routines/${encodeURIComponent(w.id)}/run`, { method: "POST", body: {} });
    return { status: r.status, .../** @type {{ chain?: string, error?: string }} */ (await r.json()) };
  };
  /** What a call of the model's was answered with. @param {string} id */
  const answered = (id) => up.received.map((c) => resultOf(c.body, id)).find((x) => x !== null);
  /** The wake the model read, by a word of its watcher's. @param {string} word */
  const wakeSaid = (word) => up.received.map((c) => textOf([...(c.body?.messages || [])].reverse().find((/** @type {any} */ m) => m.role === "user" && textOf(m).trim()))).find((t) => t.includes(WAKE_HEAD) && t.includes(word)) || "";

  // (fails before: yes — the wake's turn ran in the chat's own mode: in Auto it wrote woken.txt, and after.txt in its
  // question's answer)
  test("held to reading whatever the chat's own switch: its write is refused, and so is the write of its question's answer; the person's next message is the chat's own again", async () => {
    const w = await woken("WRITE-THEN-ASK: note what you saw.");
    const ran = await runNow(w);
    assert.deepEqual([ran.status, ran.chain], [200, w.chat], JSON.stringify(ran));
    await until(async () => (await (await shim.api(`${w.at}/transcript`)).json()).paused?.kind === "ask" || null, "its turn paused on its question", { timeoutMs: 30_000 });
    assert.match(String(answered("ww1")), /read-only/i, "the write was refused");
    assert.equal(existsSync(join(root, "woken.txt")), false);
    assert.match(wakeSaid("WRITE-THEN-ASK").split("\n\n")[0], /This turn reads only: Filament refuses what would change a file; the person's word comes before the watcher's\.\]$/);
    // The person's answer goes on in the watcher's turn, which stays held.
    const yes = await shim.api(`${w.at}/turns`, { method: "POST", body: { stream: false, content: "Yes, go on." } });
    assert.equal(yes.status, 200, await yes.clone().text());
    assert.match(String(answered("ww2")), /read-only/i, "the answer's write was refused");
    assert.equal(existsSync(join(root, "after.txt")), false);
    await until(() => w.of()?.last?.state === "done" || null, "its run ended with its turn", { timeoutMs: 30_000 });
    // Their own message is theirs: the chat's own switch, Auto, as before.
    const mine = await shim.api(`${w.at}/turns`, { method: "POST", body: { stream: false, content: "PERSON-WRITES: make the file." } });
    assert.equal(mine.status, 200, await mine.clone().text());
    assert.equal(existsSync(join(root, "mine.txt")), true, "the chat's own mode returns with the person's message");
  });

  test("a watcher that writes works as that chat works: in its folder, with its own permissions; its wake says so", async () => {
    const w = await woken("WORK-AS-CHAT: fix what you find.", { writes: true });
    const ran = await runNow(w);
    assert.deepEqual([ran.status, ran.chain], [200, w.chat], JSON.stringify(ran));
    await until(() => w.of()?.last?.state === "done" || null, "its run ended with its turn", { timeoutMs: 30_000 });
    assert.match(wakeSaid("WORK-AS-CHAT").split("\n\n")[0], /This turn works as this chat works; the person's word comes before the watcher's\.\]$/);
    assert.equal(existsSync(join(root, "worked.txt")), true, "the chat's Auto let it write");
  });

  // (fails before: yes — every watcher's row carried the model "it runs on", its sheet's words were a run's, and a
  // model could be chosen for one that starts no chat)
  test("the Space says each as it is: a model it runs on only for one that wakes a new chat; none is chosen for the others; Switch on's line names the chat it wakes", async () => {
    const w = await woken("Read its turn.");
    const spaces = shim.app.spaces;
    /** @param {any} o */
    const propose = (o) => {
      const f = routineFields({ text: "Read its turn.", trigger: { kind: "turn", chat: w.chat, turns: "all" }, ...o }, { create: true });
      assert.ok(f.ok, JSON.stringify(f));
      return spaces.routinePropose(project, f.fields, { chain: w.chat, byName: "Lead", model: "agent/brain-model", nameOf: () => "Lead" }).id;
    };
    const told = propose({ title: "Told", wakes: "you" });
    const fresh1 = propose({ title: "Fresh" });
    const guide = propose({ title: "Guide", wakes: "chat", guides: true });
    const at = `/api/space/${encodeURIComponent(project)}`;
    const space = await (await shim.api(at)).json();
    /** @param {string} id */
    const row = (id) => space.runs.routines.find((/** @type {any} */ x) => x.id === id);
    assert.deepEqual([w.id, told, guide].map((id) => ["runsOn" in row(id), "spaceOn" in row(id)]), [[false, false], [false, false], [false, false]], "no model of its own: none said");
    assert.equal(row(fresh1).runsOn?.model, "agent/brain-model", "a new chat each time runs on one, as a routine");
    const name = row(guide).madeName;
    assert.deepEqual([row(guide).words.may, row(told).words.may], [`wakes ${name} · its turn held to reading · may guide ${name}`, "tells only you, in Needs you · runs nothing"]);
    assert.ok(row(guide).words.allowed.startsWith(`A turn in ${name}, held to reading: `), row(guide).words.allowed);
    // None chosen for one that starts no chat.
    const no = await shim.api(`${at}/routines/${encodeURIComponent(guide)}/model`, { method: "POST", body: { model: "" } });
    assert.deepEqual([no.status, (await no.json()).error], [409, "“Guide” takes a turn in the chat that proposed it, on that chat's own model: none is chosen for it."]);
    // Switch on, the person's press: its line says what the watcher may do, the chat it guides by its name.
    const on = await shim.api(`${at}/routines/${encodeURIComponent(guide)}/on`, { method: "POST", body: { at: row(guide).at } });
    assert.equal(on.status, 200, await on.clone().text());
    assert.equal(spaces.get(project).log.at(-1)?.text, `You switched on the watcher “Guide”: it listens from now and wakes Lead in a turn held to reading, and may guide ${name}.`);
  });
});

describe("a watcher's turn in the chat that proposed it, on a real Filament: a coding agent", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let project = "";
  before(async () => {
    root = fresh("agent");
    repo(root);
    /** @param {Record<string, string>} [env] */
    const acp = (env = {}) => ({ command: process.execPath, args: [FAKE_ACP_AGENT], env, cwdDefault: root, permissions: "allow-all", hints: false });
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "coder", name: "coder", type: "acp", acp: acp() }, { id: "claudeish", name: "claudeish", type: "acp", acp: acp({ FAKE_ACP_CONFIG: "1" }) }];
        cfg.routes = ["coder", "claudeish"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true }));
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
  });
  /** A chat on a coding agent whose own switch is Auto, and a watcher it proposed, on. @param {string} model @param {string} text @param {any} [o] */
  const woken = async (model, text, o = {}) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(r.status, 200, await r.clone().text());
    const chat = String((await r.json()).id);
    project = String(shim.app.memory.archive?.getChain(chat)?.project_id || "");
    assert.ok(project, "the chat is of a project");
    const spaces = shim.app.spaces;
    spaces.make(project);
    const f = routineFields({ title: "Supervisor", text, wakes: "chat", trigger: { kind: "turn", chat: "c-none", turns: "all" }, ...o }, { create: true });
    assert.ok(f.ok, JSON.stringify(f));
    const id = spaces.routinePropose(project, f.fields, { chain: chat, byName: "Lead", model, nameOf: () => "Lead" }).id;
    spaces.routineOn(project, id);
    return { chat, id, of: () => spaces.get(project).routines.find((x) => x.id === id) };
  };
  /** @param {{ id: string }} w */
  const runNow = async (w) => {
    const r = await shim.api(`/api/space/${encodeURIComponent(project)}/routines/${encodeURIComponent(w.id)}/run`, { method: "POST", body: {} });
    return { status: r.status, .../** @type {{ chain?: string, error?: string }} */ (await r.json()) };
  };

  // (fails before: yes — the chat's Auto answered the agent: "permbash: allow-once")
  test("what the agent asks to run is refused by the turn's switch, read-only, whatever the chat's own; a watcher that writes is answered as that chat answers", async () => {
    const reads = await woken("coder/fake-a", "~permbash");
    const ran = await runNow(reads);
    assert.deepEqual([ran.status, ran.chain], [200, reads.chat], JSON.stringify(ran));
    await until(() => (reads.of()?.last?.state !== "running" && reads.of()?.last) || null, "its run ended with its turn", { timeoutMs: 30_000 });
    assert.deepEqual([reads.of()?.last?.state, reads.of()?.last?.said], ["done", "permbash: reject"], JSON.stringify(reads.of()?.last));
    const works = await woken("coder/fake-a", "~permbash", { writes: true });
    await runNow(works);
    await until(() => (works.of()?.last?.state !== "running" && works.of()?.last) || null, "its run ended with its turn", { timeoutMs: 30_000 });
    assert.deepEqual([works.of()?.last?.state, works.of()?.last?.said], ["done", "permbash: allow-once"], JSON.stringify(works.of()?.last));
  });

  // (fails before: yes — the wake went: the agent ran in the mode its model's name set, asking Filament nothing)
  test("a chat whose model's name sets a mode in which its agent asks nothing cannot be held: the watcher's failure in words, what it heard kept; one that writes wakes it", async () => {
    const w = await woken("claudeish/default@bypassPermissions", "Read its turn.");
    assert.equal(shim.app.spaces.watchHeard(project, w.id, [{ id: "turn:c-none:1", kind: "turn", at: Date.now(), chain: "c-none", summary: "Turn 1 of a chat ended: nothing changed" }]), 1);
    const ran = await runNow(w);
    const WHY = "cannot be held to reading: its agent asks Filament nothing before it acts, in the mode its model's name sets (bypassPermissions)";
    assert.deepEqual([ran.status, String(ran.error).endsWith(WHY)], [502, true], JSON.stringify(ran));
    assert.deepEqual([w.of()?.last?.state, String(w.of()?.last?.why).endsWith(WHY)], ["failed", true], JSON.stringify(w.of()?.last));
    assert.equal(w.of()?.pending?.events.length, 1, "what it heard waits");
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(w.chat)}/transcript`)).json();
    assert.equal((tr.turns || []).length, 0, "no turn began in that chat");
    // One that works as that chat works is that chat's own doing: it wakes it.
    const works = await woken("claudeish/default@bypassPermissions", "Read its turn.", { writes: true });
    const went = await runNow(works);
    assert.deepEqual([went.status, went.chain], [200, works.chat], JSON.stringify(went));
    await until(() => (works.of()?.last?.state !== "running" && works.of()?.last) || null, "its run ended with its turn", { timeoutMs: 30_000 });
    assert.equal(works.of()?.last?.state, "done", JSON.stringify(works.of()?.last));
  });
});

describe("a watcher's turn a restart cut off, on a real Filament", () => {
  /** A run's events as a process that died leaves them: two rounds in, cut in its second. @param {any} start @param {string} runId */
  const cutLog = (start, runId) =>
    [
      { ...start, runId },
      ...[{ type: "round-start", round: 1 }, { type: "tool-start", round: 1, id: "c1", name: "read", args: "README.md" }, { type: "tool-end", round: 1, id: "c1", name: "read", ok: true, preview: "app" },
        { type: "round-text", round: 1, text: "Reading it.", block: 0 }, { type: "round-start", round: 2 }].map((e, i) => ({ ...e, n: i + 2, seq: 0, ts: start.ts + i + 1, runId })),
    ].map((e) => `${JSON.stringify(e)}\n`).join("");

  // (fails before: yes — with the wake's hold read only from a row that says how it ran, the turn Filament went on
  // with ran in the chat's own mode: in Auto it wrote woken.txt)
  test("Filament goes on with it held to reading, as it began; a turn of the person's cut the same way goes on in the chat's own mode", async () => {
    const root = fresh("cut");
    const up = await fakeUpstream((/** @type {any} */ call) => {
      if (call.kind !== "anthropic") return undefined;
      const body = call.body || {};
      const model = String(body.model || "");
      const history = (body.messages || []).map(textOf).join(" ");
      // Only a turn Filament goes on with does anything: it writes a file, the wake's chat one and the person's another.
      if (!(body.tools || []).length || !history.includes("Filament restarted while your last turn was running")) return anthropicReply("Okay.", { model });
      if (resultOf(body, "cw1") !== null || resultOf(body, "cp1") !== null) return anthropicReply("Went on.", { model });
      const wake = history.includes(WAKE_HEAD);
      return anthropicReply("", { model, stop: "tool_use", blocks: [{ type: "tool_use", id: wake ? "cw1" : "cp1", name: "write", input: { path: wake ? "woken.txt" : "mine.txt", content: "x" } }], usage: { input_tokens: 30, output_tokens: 7 } });
    });
    const configure = (/** @type {any} */ cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
    };
    let shim = await startApp({ memory: true, keep: true, configure });
    const dataDir = shim.dataDir;
    made.push(dataDir);
    try {
      /** @type {any} */
      const archive = shim.app.memory.archive;
      // Two chats in Auto, each with a turn that ended, then what a crash leaves of its next: a row still running, which
      // says nothing yet of how it ran, and its run's log.
      /** @param {string} runId @param {string} second */
      const cut = async (runId, second) => {
        const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } })).json()).id);
        const one = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "turn 1: hello", stream: false } });
        assert.equal(one.status, 200, await one.clone().text());
        const start = JSON.parse(readFileSync(join(dataDir, "runs", `${one.headers.get("x-filament-request-id")}.jsonl`), "utf8").split(/\r?\n/)[0]);
        archive.beginTurn(id, { requestId: runId, model: "m-1", upstream: "m", client: "harness", window: "harness", running: true, userMessage: { role: "user", content: [{ type: "text", text: second }] } });
        return { id, log: cutLog(start, runId) };
      };
      const woken = await cut("cut-wake", wakeWords({ id: "r1", title: "Supervisor", task: "Read its turn.", writes: false }, { project: "app", when: "after each turn", heard: null, by: "event" }));
      const mine = await cut("cut-mine", "turn 2: make the file");
      await shim.stop();
      writeFileSync(join(dataDir, "runs", "cut-wake.jsonl"), woken.log);
      writeFileSync(join(dataDir, "runs", "cut-mine.jsonl"), mine.log);
      up.reset();
      shim = await startApp({ memory: true, keep: true, dataDir, configure });
      const out = await shim.app.resumedAtStart;
      assert.deepEqual(out.map((/** @type {any} */ o) => [o.chainId, o.went]).sort(), [[woken.id, true], [mine.id, true]].sort());
      for (const id of [woken.id, mine.id])
        await until(async () => {
          const tr = await (await shim.api(`/api/sessions/${id}/transcript`)).json();
          return tr.turns.length === 3 && !tr.turns[2].open;
        }, "the turn Filament sent ended", { timeoutMs: 30_000 });
      /** What a call of the model's was answered with. @param {string} id */
      const answered = (id) => up.received.map((c) => resultOf(c.body, id)).find((x) => x !== null);
      assert.match(String(answered("cw1")), /read-only/i, "the wake's turn, gone on with, is still held to reading");
      assert.equal(existsSync(join(root, "woken.txt")), false);
      assert.equal(existsSync(join(root, "mine.txt")), true, "the person's own turn goes on in the chat's own mode");
    } finally {
      await shim.stop().catch(() => {});
      await up.close();
    }
  });
});
