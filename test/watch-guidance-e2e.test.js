// @ts-check
// A watcher's guidance on a real Filament (the plan of 11-11, its w6, part B; the module's own rules are held in
// watch-guidance.test.js). A chat on Filament's loop reads it at its next step under the watcher's heading, or takes
// it as a turn of Filament's own — flagged in its transcript, never the person's: nothing of theirs is reset, the plan
// its agent offered still waits —; over a question it waits and goes once the question is over, after the person's
// Stop it goes into their next turn; three go for each message of the person's, the fourth is held in Needs you and
// goes by Send it; a guidance turn's end wakes no watcher of the chat, the person's next does, and each turn reviewed
// is kept. Each coding agent that takes words while it works reads the same block — Claude's queue, Codex's
// turn/steer, Cursor's SDK's steer —, and one that takes none gets it as a turn once its own has ended.
// (fails before: yes — nothing delivered a watcher's guidance: `guides` was a word on its row)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GUIDES_PER_MESSAGE, GUIDE_HEAD, WAKE_HEAD, guideBlock } from "../src/core/watchers.js";
import { routineFields } from "../src/core/routines.js";
import { needWords } from "../src/core/space.js";
import { STEERING_HEAD } from "../src/app/agent/loop.js";
import { PLAN_OFFER_WAITS } from "../src/app/sessions/service.js";
import { transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { FAKE_ACP_AGENT, FIXTURES, startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { gate, removeDirs, scaledMs, until } from "./helpers/wait.js";

const DRIFT = "You drifted: the parser, not the lexer.";
const BLOCK = guideBlock("Supervisor", [DRIFT]);
/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : Array.isArray(m?.content) ? m.content.map((/** @type {any} */ b) => b?.text || "").join("\n") : "");
/** JSON lines of a file, oldest first. @param {string} file @returns {any[]} */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

describe("a watcher's guidance on a real Filament: a chat on Filament's loop", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let project = "";
  let lead = "";
  /** What the model was sent: each call's newest message, its words. @type {string[]} */
  const calls = [];
  /** The wakes the watchers' chat was sent. @type {string[]} */
  const wakes = [];
  /** The calls held at the model until the test lets each go, by the name its message says (`HOLD:<name>`). @type {Map<string, ReturnType<typeof gate>>} */
  const gates = new Map();
  /** @type {Set<string>} */
  const arrived = new Set();
  /** @param {string} name */
  const gateOf = (name) => gates.get(name) || /** @type {ReturnType<typeof gate>} */ (gates.set(name, gate()).get(name));
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-guide-loop-"));
    writeFileSync(join(root, "README.md"), "app\n");
    up = await fakeUpstream(async (/** @type {any} */ call) => {
      const model = String(call.body?.model || "");
      const msgs = call.body?.messages || [];
      const last = msgs.at(-1);
      const words = textOf(last);
      const answered = Array.isArray(last?.content) && last.content.some((/** @type {any} */ c) => c?.type === "tool_result");
      calls.push(words);
      const hold = answered ? null : /HOLD:(\w+)/.exec(words);
      if (hold) {
        arrived.add(hold[1]);
        await gateOf(hold[1]).promise;
      }
      if (words.includes(WAKE_HEAD)) {
        wakes.push(words);
        return anthropicReply("Looked: on track.", { model });
      }
      if (hold) return anthropicReply("Working on it.", { model });
      if (words.includes(BLOCK.split(" (")[0])) return anthropicReply("Heard the watcher.", { model });
      if (words.includes("ASK-FIRST") && !answered)
        return anthropicReply("", { model, stop: "tool_use", blocks: [{ type: "tool_use", id: "b1", name: "bash", input: { command: `node -e "console.log('checked')"` } }], usage: { input_tokens: 30, output_tokens: 7 } });
      if (words.includes("OFFER-PLAN") && !answered)
        return anthropicReply("", { model, stop: "tool_use", blocks: [{ type: "tool_use", id: "o1", name: "tasks", input: { action: "offer", depth: "deep" } }], usage: { input_tokens: 30, output_tokens: 7 } });
      if (answered) return anthropicReply("Done.", { model });
      if (words.includes(GUIDE_HEAD)) return anthropicReply("Guided: understood.", { model });
      return anthropicReply("Okay.", { model });
    });
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        const price = { input: 1, output: 1, contextTokens: 200000 };
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": price } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
    lead = await chat();
    project = String(archive().getChain(lead)?.project_id || "");
    assert.ok(project, "the chat is of a project");
    shim.app.spaces.make(project);
  });
  after(async () => {
    for (const g of gates.values()) g.open();
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  const archive = () => /** @type {any} */ (shim.app.memory.archive);
  const guidance = () => /** @type {NonNullable<typeof shim.app.guidance>} */ (shim.app.guidance);
  const at = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** A chat of the project, on Filament's loop. */
  async function chat() {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  }
  /** A turn of the person's, to its end. @param {string} id @param {string} content */
  const say = async (id, content) => {
    const r = await shim.api(`${at(id)}/turns`, { method: "POST", body: { stream: false, content } });
    assert.equal(r.status, 200, await r.clone().text());
    return (((await r.json()).content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text)).join("");
  };
  /** @param {string} id */
  const transcript = async (id) => /** @type {any} */ (await (await shim.api(`${at(id)}/transcript`)).json());
  /** The chat is at rest, and no guidance turn is on its way to it or at work in it. @param {string} id */
  const rested = (id) => until(() => (!shim.app.sessions.besideFacts(id).busy && !guidance().hosting(id)) || null, `${id} at rest`, { timeoutMs: 30_000 });
  /**
   * A watcher the lead proposed, of `x`, which may guide it, switched on. It listens for a command of x's agent that
   * fails — none does here —, so nothing wakes it unless a test's trigger says otherwise.
   * @param {string} x @param {any} [o]
   */
  const watcher = (x, o = {}) => {
    const f = routineFields({ title: "Supervisor", text: "Read its turn.", model: "agent/brain-model", wakes: "chat", guides: true, trigger: { kind: "shell", chat: x }, ...o }, { create: true });
    assert.ok(f.ok, JSON.stringify(f));
    const w = shim.app.spaces.routinePropose(project, f.fields, { chain: lead, byName: "Lead", model: "agent/brain-model", nameOf: () => "Lead" });
    shim.app.spaces.routineOn(project, w.id);
    return w.id;
  };
  /** The lead's agent guides, as its tool will. @param {string} id @param {string} text */
  const guide = (id, text) => guidance().send({ project, from: lead, id, text });
  /** The Space's guidance for a chat, each as [words, state, how]. @param {string} x */
  const kept = (x) => shim.app.spaces.guidance(project).filter((g) => g.to === x).map((g) => [g.text, g.state, g.how ?? null]);
  /** The chat's count of guidance since its person last wrote. @param {string} x */
  const count = (x) => /** @type {any} */ (shim.app).letters.guidesAlone(x);

  test("at work: its agent reads the note at its next step under the watcher's heading, never the developer's; a chat that is no watcher's guides none", async () => {
    const x = await chat();
    const w = watcher(x);
    const turn = say(x, "HOLD:a Build the lexer.");
    await until(() => arrived.has("a") || null, "the turn at its model");
    const sent = await guide(w, DRIFT);
    assert.deepEqual([sent.ok, sent.how, sent.to], [true, "note", x], sent.text);
    assert.match(sent.text, /^Sent to .+ as a note into its running turn: its agent reads it at its next step\.$/);
    gateOf("a").open();
    assert.equal(await turn, "Working on it.Heard the watcher.", "its reply before the note, then its answer to it");
    const read = calls.filter((c) => c.includes(BLOCK));
    assert.equal(read.length, 1, calls.join("\n----\n"));
    assert.ok(!read[0].includes(STEERING_HEAD), read[0]);
    await until(() => kept(x)[0]?.[1] === "read" || null, "the note read");
    assert.deepEqual(kept(x), [[DRIFT, "read", "note"]]);
    // The turn is the person's own: the transcript flags nothing.
    const tr = await transcript(x);
    assert.deepEqual(tr.turns.map((/** @type {any} */ t) => [!!t.guided, t.by ?? null]), [[false, null]]);
    assert.equal(count(x), 1);
    // The watched chat is no watcher's: it guides nobody, itself least of all.
    const back = await guidance().send({ project, from: x, text: DRIFT });
    assert.deepEqual([back.ok, back.how], [false, "refused"]);
    assert.match(back.text, /^Not sent: this chat is no watcher's/);
  });

  test("at rest: a turn of Filament's own that opens with its head, flagged in the transcript; never the person's — nothing of theirs is reset, and the plan its agent offered still waits", async () => {
    const x = await chat();
    const w = watcher(x);
    assert.equal(await say(x, "OFFER-PLAN: Add OAuth to the login"), "Done.");
    assert.equal((await transcript(x)).turns[0].planOffer?.depth, "deep");
    archive().mergeMeta(x, { letters: { alone: 2, threads: 1 } });
    const was = shim.app.sessions.personLast(x);
    const sent = await guide(w, DRIFT);
    assert.deepEqual([sent.ok, sent.how], [true, "turn"], sent.text);
    await rested(x);
    const tr = await transcript(x);
    assert.deepEqual(tr.turns.map((/** @type {any} */ t) => [!!t.guided, t.by ?? null]), [[false, null], [true, "guide"]]);
    const told = (tr.turns[1].user?.content || []).map((/** @type {any} */ b) => String(b?.text || ""));
    assert.equal(told[0], PLAN_OFFER_WAITS, "the agent is told the offer still waits");
    assert.ok(told[1].startsWith(`${GUIDE_HEAD} “Supervisor” (${w}) of `) && told[1].endsWith(`]\n\n${DRIFT}`), told[1]);
    assert.match(told[1], /It was written by .+'s agent, never by the person\./);
    assert.equal(textOf(tr.turns[1].final), "Guided: understood.");
    // Not the person's: when they last wrote, what their message started counting, the offer on its card.
    assert.deepEqual(shim.app.sessions.personLast(x).personAt, was.personAt);
    const letters = archive().metaOf(x, ["letters"])?.letters || {};
    assert.deepEqual([letters.alone, letters.threads, letters.guides], [2, 1, 1]);
    assert.equal(tr.turns[0].planOffer?.depth, "deep");
    // The page reads the flag: Filament's turn, its words what the agent read.
    const drawn = transcriptTurns(tr);
    assert.deepEqual([drawn[0].guided, drawn[1].guided, String(drawn[1].guideText).includes(DRIFT)], [undefined, true, true]);
    assert.deepEqual(kept(x), [[DRIFT, "read", "turn"]]);
  });

  test("a question waits for the person: the guidance waits; with its watcher paused it stays as the question ends, and the person's Resume sends it — a turn of its own", async () => {
    const x = await chat();
    const w = watcher(x);
    await say(x, "Hello.");
    void shim.api(`${at(x)}/turns`, { method: "POST", body: { stream: false, content: "ASK-FIRST: run the check." } }).catch(() => {});
    await until(async () => (await transcript(x)).paused?.kind === "permission" || null, "its turn paused on a permission", { timeoutMs: 30_000 });
    const sent = await guide(w, DRIFT);
    assert.deepEqual([sent.ok, sent.how], [true, "waits"], sent.text);
    assert.match(sent.text, /^Not sent yet: a question of .+'s waits for the person\. Filament keeps it: it goes as that chat next lets go, or into its next turn where that begins first\.$/);
    assert.deepEqual([kept(x), count(x)], [[[DRIFT, "waiting", null]], 0]);
    const routine = `/api/space/${encodeURIComponent(project)}/routines/${encodeURIComponent(w)}`;
    const paused = await shim.api(`${routine}/pause`, { method: "POST", body: { paused: true } });
    assert.equal(paused.status, 200, await paused.clone().text());
    // The person rewinds past the question: the chat lets go, and the paused watcher's guidance stays.
    const tr = await transcript(x);
    const r = await shim.api(`${at(x)}/rewind`, { method: "POST", body: { turn: tr.turns.at(-1).n, what: "conversation" } });
    assert.equal(r.status, 200, await r.clone().text());
    await new Promise((done) => setTimeout(done, scaledMs(900)));
    assert.deepEqual([kept(x), (await transcript(x)).turns.some((/** @type {any} */ t) => t.guided)], [[[DRIFT, "waiting", null]], false]);
    const resumed = await shim.api(`${routine}/pause`, { method: "POST", body: { paused: false } });
    assert.equal(resumed.status, 200, await resumed.clone().text());
    await until(() => kept(x)[0]?.[1] === "read" || null, "the guidance sent, its turn ended", { timeoutMs: 30_000 });
    const after = await transcript(x);
    assert.deepEqual([after.turns.at(-1).guided, after.turns.at(-1).by, kept(x), count(x)], [true, "guide", [[DRIFT, "read", "turn"]], 1]);
  });

  test("the person stopped the chat: no turn of Filament's starts there; their next message takes the guidance as a note, read under the watcher's heading", async () => {
    const x = await chat();
    const w = watcher(x);
    await say(x, "Hello.");
    archive().mergeMeta(x, { lastStop: { turn: archive().newestTurnN(x), at: Date.now() } });
    const sent = await guide(w, DRIFT);
    assert.deepEqual([sent.ok, sent.how], [true, "waits"], sent.text);
    assert.match(sent.text, /^Not sent yet: the person stopped .+, and Filament starts no turn there until they write in it again\./);
    await new Promise((done) => setTimeout(done, scaledMs(600)));
    assert.deepEqual([(await transcript(x)).turns.length, kept(x)], [1, [[DRIFT, "waiting", null]]]);
    const before = calls.length;
    const turn = say(x, "HOLD:d Go on.");
    await until(() => (arrived.has("d") && kept(x)[0]?.[1] === "sent") || null, "the guidance in the person's turn");
    gateOf("d").open();
    assert.equal(await turn, "Working on it.Heard the watcher.", "its reply before the note, then its answer to it");
    assert.equal(calls.slice(before).filter((c) => c.includes(BLOCK)).length, 1);
    await until(() => kept(x)[0]?.[1] === "read" || null, "the note read");
    const tr = await transcript(x);
    assert.deepEqual([tr.turns.length, tr.turns.some((/** @type {any} */ t) => t.guided), kept(x)], [2, false, [[DRIFT, "read", "note"]]]);
  });

  test(`the cap: ${GUIDES_PER_MESSAGE} go for each message of the person's; the next is held in Needs you, its words whole; the person's message starts the count again, a note nobody typed does not; Send it sends the one held`, async () => {
    const x = await chat();
    const w = watcher(x);
    await say(x, "Hello.");
    for (const words of ["One.", "Two.", "Three."]) {
      assert.equal((await guide(w, words)).how, "turn", words);
      await rested(x);
    }
    assert.equal(count(x), GUIDES_PER_MESSAGE);
    const HELD = `Four: ${DRIFT}\nAnd its second line.`;
    const fourth = await guide(w, HELD);
    assert.deepEqual([fourth.ok, fourth.how], [true, "held"], fourth.text);
    assert.match(fourth.text, /^Not sent: 3 went to .+ since the person last wrote there, the most Filament sends by itself\. It is held for the person in Needs you, who may send it\.$/);
    assert.equal((await transcript(x)).turns.length, 4, "nothing more was sent");
    const row = shim.app.spaces.get(project).needs.find((n) => n.kind === "routine" && n.routine?.guide?.to === x);
    assert.ok(row, "its row in Needs you");
    assert.match(row.text, new RegExp(`^“Supervisor” would guide .+ again: “Four: ${DRIFT}”$`));
    assert.deepEqual([row.state, row.why, row.title, row.routine?.guide?.text], ["open", "3 sent since you last wrote there, the most Filament sends by itself", "Supervisor", HELD]);
    // An agent of the project reads the row as what it is: a reviewer's words, quoted, and no instruction.
    assert.ok(needWords(row, { nameOf: () => "a chat", apart: () => false }).text.endsWith(JSON.stringify(HELD)));
    // The person writes in the chat: the count starts again.
    await say(x, "Thanks, go on.");
    assert.equal(count(x), 0);
    // Send it: the one held goes now, and counts against nothing.
    const press = await shim.api(`/api/space/${encodeURIComponent(project)}/needs/${encodeURIComponent(row.id)}/guide`, { method: "POST", body: {} });
    const pressed = await press.json();
    assert.deepEqual([press.status, pressed.ok, pressed.how, pressed.to], [200, true, "turn", x], JSON.stringify(pressed).slice(0, 400));
    assert.equal(pressed.space?.needs?.find((/** @type {any} */ n) => n.id === row.id)?.state, "done", "its answer carries the Space, the row done");
    await rested(x);
    const tr = await transcript(x);
    assert.deepEqual([tr.turns.at(-1).guided, textOf(tr.turns.at(-1).user).endsWith(HELD), count(x)], [true, true, 0]);
    const again = await shim.api(`/api/space/${encodeURIComponent(project)}/needs/${encodeURIComponent(row.id)}/guide`, { method: "POST", body: {} });
    assert.equal(again.status, 409, await again.clone().text());
    const none = await shim.api(`/api/space/${encodeURIComponent(project)}/needs/n-none/guide`, { method: "POST", body: {} });
    assert.equal(none.status, 404, await none.clone().text());
    // A note into the chat's turn that nobody typed — Filament's own word — starts no count again; the person's does.
    const res = await shim.api(`${at(x)}/turns`, { method: "POST", body: { stream: true, runEvents: true, content: "HOLD:e Next." } });
    const run = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(() => arrived.has("e") || null, "the turn at its model");
    assert.equal((await guide(w, "Five.")).how, "note");
    assert.equal(count(x), 1);
    const steer = (/** @type {any} */ b) => shim.api(`/api/runs/${encodeURIComponent(run)}/steer`, { method: "POST", body: b });
    const own = await steer({ kind: "note", text: "[Filament: the Space synced]", from: "filament" });
    assert.equal(own.status, 200, await own.clone().text());
    assert.equal(count(x), 1, "Filament's own word is not the person's");
    const typed = await steer({ kind: "note", text: "and the docs", from: "harness" });
    assert.equal(typed.status, 200, await typed.clone().text());
    assert.equal(count(x), 0, "the person's typed note is their message");
    gateOf("e").open();
    await body;
    await rested(x);
  });

  test("a guidance turn's end wakes no watcher of the chat; the person's next turn does; each turn the watcher reviewed is kept, with whether it guided", async () => {
    const x = await chat();
    // Its wake waits at the model (HOLD:f) until the test lets it go: the watcher's run is under way meanwhile.
    const w = watcher(x, { text: "Read its turn. HOLD:f", trigger: { kind: "turn", chat: x, turns: "all" } });
    const of = () => shim.app.spaces.get(project).routines.find((r) => r.id === w);
    const before = wakes.length;
    await say(x, "Build the lexer.");
    await until(() => arrived.has("f") || null, "the watcher woken by the person's turn", { timeoutMs: 30_000 });
    // The woken chat's agent guides the chat it reviewed: a turn there, which ends while the watcher's run still runs.
    assert.equal((await guide(w, DRIFT)).how, "turn");
    await until(() => kept(x)[0]?.[1] === "read" || null, "the guidance turn ended", { timeoutMs: 30_000 });
    gateOf("f").open();
    await until(() => of()?.last?.state === "done" || null, "the watcher's run ended", { timeoutMs: 30_000 });
    await new Promise((done) => setTimeout(done, scaledMs(900)));
    assert.deepEqual([wakes.length - before, of()?.pending ?? null, (await transcript(x)).turns.map((/** @type {any} */ t) => !!t.guided)], [1, null, [false, true]], "the guidance turn's end woke nothing");
    assert.deepEqual(shim.app.spaces.reviewsOf(project, x).map((v) => [v.turn, v.watcher, v.title, v.guided]), [[1, w, "Supervisor", true]]);
    // The person's next turn is reviewed again; this time the watcher wrote nothing.
    await say(x, "Again.");
    await until(() => (wakes.length - before === 2 && of()?.last?.state === "done" && shim.app.spaces.reviewsOf(project, x).length === 2) || null, "the second review", { timeoutMs: 30_000 });
    assert.deepEqual(shim.app.spaces.reviewsOf(project, x).map((v) => [v.turn, v.guided]), [[1, true], [3, false]]);
    assert.deepEqual(Object.keys(shim.app.spaces.reviewsOf(project, x)[1]).sort(), ["at", "chain", "guided", "title", "turn", "watcher"]);
  });

  test("letters: the watcher's chat writes the chat its watcher may guide with no tag; not where it may not guide; a chat tag in a routine's words gives its run no letter", async () => {
    const letters = /** @type {any} */ (shim.app).letters;
    const x = await chat();
    await say(x, "Hello.");
    const w = watcher(x);
    const sent = letters.send(lead, { to: x, subject: "Your last turn", text: "A longer note than a guidance holds." });
    assert.equal(sent.ok, true, sent.text);
    assert.match(sent.text, /^Sent: letter lt_/);
    await rested(x);
    // A watcher that may not guide gives its chat no such way; the refusal names the case.
    const y = await chat();
    await say(y, "Hello.");
    watcher(y, { title: "Reader", guides: false });
    const refused = letters.send(lead, { to: y, subject: "Your last turn", text: "A note." });
    assert.equal(refused.ok, false);
    assert.match(refused.text, /^Not sent: you write only to a chat the developer tagged in this chat, one that wrote to you, the chat your watcher may guide while it is switched on, or a thread linked to it, and .+ is none of them\. Ask the developer to tag it here with @\.$/);
    // Paused, the watcher's chat writes it no more.
    shim.app.spaces.routinePause(project, w, true);
    assert.equal(letters.send(lead, { to: x, subject: "Again", text: "A note." }).ok, false);
    shim.app.spaces.routinePause(project, w, false);
    // A routine whose words tag a chat: its run's chat was tagged by nobody, and writes that chat no letter.
    const f = routineFields({ title: "Brief", when: "weekdays 09:00", text: `Read [the lexer chat](chat:${x}) and write it what you think.`, model: "agent/brain-model" }, { create: true });
    assert.ok(f.ok, JSON.stringify(f));
    const brief = shim.app.spaces.routinePropose(project, f.fields, { chain: lead, byName: "Lead", model: "agent/brain-model", nameOf: () => "Lead" }).id;
    shim.app.spaces.routineOn(project, brief);
    const ran = await shim.api(`/api/space/${encodeURIComponent(project)}/routines/${encodeURIComponent(brief)}/run`, { method: "POST", body: {} });
    const run = String((await ran.json()).chain || "");
    assert.ok(ran.status === 200 && run, "its run's chat");
    await until(() => shim.app.spaces.get(project).routines.find((r) => r.id === brief)?.last?.state === "done" || null, "its run ended", { timeoutMs: 30_000 });
    assert.match(textOf((await transcript(run)).turns[0].user), new RegExp(`\\(chat:${x}\\)`));
    const fromRun = letters.send(run, { to: x, subject: "What I think", text: "A note." });
    assert.equal(fromRun.ok, false, fromRun.text);
    assert.match(fromRun.text, /^Not sent: you write only to a chat the developer tagged in this chat/);
  });
});

describe("a watcher's guidance on a real Filament: each coding agent", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  let project = "";
  let lead = "";
  const logs = { claude: "", plain: "", codex: "", sdk: "" };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-guide-agents-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    mkdirSync(join(root, "hold"));
    writeFileSync(join(projDir, "notes.txt"), "hello\n");
    Object.assign(logs, { claude: join(root, "claude-calls.jsonl"), plain: join(root, "plain-prompts.jsonl"), codex: join(root, "codex-calls.jsonl"), sdk: join(root, "sdk.jsonl") });
    process.env.FAKE_SDK_LOG = logs.sdk;
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [
          // Claude's adapter: words sent while it works are queued at it, and go in at its next step.
          { id: "claude", name: "claude", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_STEERING: "1", FAKE_ACP_CALLS: logs.claude }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          // A plain ACP agent takes no words while its turn runs; its `~drip` turn runs until the gate's file is there.
          { id: "plainacp", name: "plainacp", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_HOLD_GATE: join(root, "hold"), FAKE_ACP_LOG: logs.plain }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "codex", name: "Codex", type: "codex", acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], env: { FAKE_CODEX_CALLS: logs.codex }, cwdDefault: projDir, permissions: "allow-all" } },
          { id: "sdk", name: "Cursor SDK", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: projDir, permissions: "allow-all", hints: false } },
        ];
        cfg.routes = ["claude", "plainacp", "codex", "sdk"].map((u) => ({ match: `${u}/*`, upstream: u, upstreamModel: "{1}", enabled: true }));
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
      },
      overrides: { cursorSdkLoader: () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href) },
    });
    lead = await session("plainacp/fake");
    project = String(/** @type {any} */ (shim.app.memory.archive).getChain(lead)?.project_id || "");
    assert.ok(project, "the chat is of a project");
    shim.app.spaces.make(project);
  });
  after(async () => {
    await shim.stop();
    delete process.env.FAKE_SDK_LOG;
    await removeDirs(root);
  });
  const guidance = () => /** @type {NonNullable<typeof shim.app.guidance>} */ (shim.app.guidance);
  /** A chat on a model. @param {string} model */
  async function session(model) {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  }
  /** A turn, as the page sends one: its run, and its body once it ends. @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
    // Its body is read only where it was refused: a turn taken streams until it ends.
    if (res.status !== 200) assert.fail(`${res.status}: ${await res.text()}`);
    return { run: String(res.headers.get("x-filament-request-id")), body: res.text() };
  };
  /** @param {string} run @returns {Promise<any[]>} */
  const runEvents = async (run) => (await (await shim.api(`/api/runs/${encodeURIComponent(run)}/events?since=0&limit=5000`)).json()).events;
  /** The run's first round has begun: its agent is working. @param {string} run */
  const working = (run) => until(async () => (await runEvents(run)).some((e) => e.type === "round-start" && e.round === 1), "its agent at work", { timeoutMs: 30_000 });
  /** @param {string} id */
  const transcript = async (id) => /** @type {any} */ (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?work=1`)).json());
  /** A watcher the lead proposed, of `x`, which may guide it, switched on. @param {string} x */
  const watcher = (x) => {
    const f = routineFields({ title: "Supervisor", text: "Read its turn.", model: "plainacp/fake", wakes: "chat", guides: true, trigger: { kind: "shell", chat: x } }, { create: true });
    assert.ok(f.ok, JSON.stringify(f));
    const w = shim.app.spaces.routinePropose(project, f.fields, { chain: lead, byName: "Lead", model: "plainacp/fake", nameOf: () => "Lead" });
    shim.app.spaces.routineOn(project, w.id);
    return w.id;
  };
  /** The Space's guidance for a chat, each as [state, how]. @param {string} x */
  const kept = (x) => shim.app.spaces.guidance(project).filter((g) => g.to === x).map((g) => [g.state, g.how ?? null]);
  /**
   * A chat on `model` whose agent is at work on `words`, guided meanwhile: what the guidance's sender was told, and the
   * turn once it ended. @param {string} model @param {string} words
   */
  const guidedAtWork = async (model, words) => {
    const x = await session(model);
    const w = watcher(x);
    const t = await turn(x, words);
    await working(t.run);
    const sent = await guidance().send({ project, from: lead, id: w, text: DRIFT });
    return { x, sent, run: t.run, body: t.body };
  };

  test("Claude over ACP: the note is queued at it as the watcher's block, at once, and read once Claude took it", async () => {
    const g = await guidedAtWork("claude/haiku", "~steerable");
    assert.deepEqual([g.sent.ok, g.sent.how], [true, "note"], g.sent.text);
    await g.body;
    assert.deepEqual(lines(logs.claude).filter((c) => c.method === "queued prompt" || c.method === "_session/steering").map((c) => [c.method, c.words]), [["queued prompt", BLOCK]]);
    const evs = await runEvents(g.run);
    const steer = evs.find((e) => e.type === "steer");
    assert.deepEqual([steer.kind, steer.from, steer.title, steer.text], ["note", "watcher", "Supervisor", DRIFT], "the run says whose it is, by its title");
    assert.ok(evs.some((e) => e.type === "steer-read" && e.ids.includes(steer.id)), "Claude took it");
    await until(() => kept(g.x)[0]?.[0] === "read" || null, "the note read");
    // Claude's own conversation keeps the block where it took it — never as the person's bare words.
    const t = (await transcript(g.x)).turns.at(-1);
    assert.ok(t.work.some((/** @type {any} */ m) => m.role === "user" && textOf(m) === BLOCK), JSON.stringify(t.work));
    assert.equal(t.guided, undefined, "the turn is the person's");
  });

  test("Codex: the note goes into its running turn (turn/steer) as the watcher's block", async () => {
    const g = await guidedAtWork("codex/gpt-6-astra", "~steer");
    assert.deepEqual([g.sent.ok, g.sent.how], [true, "note"], g.sent.text);
    await g.body;
    const steered = lines(logs.codex).filter((c) => c.method === "turn/steer").map((c) => (c.params?.input || []).filter((/** @type {any} */ i) => i.type === "text").map((/** @type {any} */ i) => i.text).join("\n"));
    assert.deepEqual(steered, [BLOCK]);
    await until(() => kept(g.x)[0]?.[0] === "read" || null, "the note read");
  });

  test("Cursor's SDK: the note is steered into its run as the watcher's block", async () => {
    const g = await guidedAtWork("sdk/composer-2.5", "~hang");
    assert.deepEqual([g.sent.ok, g.sent.how], [true, "note"], g.sent.text);
    await g.body;
    assert.deepEqual(lines(logs.sdk).filter((e) => e.event === "steer").map((e) => [String(e.text), e.takes]), [[BLOCK, true]]);
    await until(() => kept(g.x)[0]?.[0] === "read" || null, "the note read");
  });

  test("an agent that takes no words while it works: the guidance waits, said so, and goes as a turn of Filament's own once its turn has ended", async () => {
    const g = await guidedAtWork("plainacp/fake", "~drip");
    assert.deepEqual([g.sent.ok, g.sent.how], [true, "waits"], g.sent.text);
    assert.match(g.sent.text, /^Not sent yet: .+'s agent takes no words while it works, so it goes as its turn ends\. Filament keeps it/);
    assert.deepEqual(kept(g.x), [["waiting", null]]);
    writeFileSync(join(root, "hold", "drip"), "");
    await g.body;
    await until(() => kept(g.x)[0]?.[0] === "read" || null, "the guidance sent as a turn, and that turn ended", { timeoutMs: 30_000 });
    assert.deepEqual(kept(g.x), [["read", "turn"]]);
    const tr = await transcript(g.x);
    assert.deepEqual(tr.turns.map((/** @type {any} */ t) => [!!t.guided, t.by ?? null]), [[false, null], [true, "guide"]]);
    const prompt = String(lines(logs.plain).at(-1)?.text ?? lines(logs.plain).at(-1)?.prompt ?? "");
    assert.ok(prompt.startsWith(`${GUIDE_HEAD} “Supervisor” (`) && prompt.includes(DRIFT), prompt);
  });
});
