// @ts-check
// HarnessV3-Launch LD-D7 (F11, F24, RD1 b): the notes Filament writes for clients that draw no card — the question's
// copy, the stop note, the output-ceiling note — are drawn once by the harness. The loop says each one
// ahead of its words (a `notice` run event) and the turn keeps it (`notice` on the transcript row), so where the page
// draws the card for it (Input required, the fold's "Stopped after 3s") it leaves the copy out; the words the model
// wrote before a question still show while it waits, after a reload too; and a note never points at work above when
// there is none.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until, removeDirs } from "./helpers/wait.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { RUN_EVENT_TYPE_LIST } from "../src/services/runs.js";
import { askOf, askText, toolSetFor } from "../src/app/agent/tools.js";
import { alignEvents, noteSaidElsewhere, splitNote, segmentsShown, foldHeader, foldSplit, drawingStartsOver, roundCardAnchor, pauseOf } from "../src/ui/harness/lib/labels.js";
import { pageTurns } from "./helpers/held-transcript.js";

/** @param {any[]} blocks */
const text = (blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
/** @param {string} id @param {string} name @param {any} input */
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
/** @param {string} model @param {any[]} blocks */
const reply = (model, blocks, stop = "end_turn") => anthropicReply("", { model, stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** The tool results a call's last message carries. @param {any[]} msgs */
const lastResults = (msgs) => {
  const m = (msgs || []).at(-1);
  return Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ c) => c?.type === "tool_result") : [];
};
/** Settle within `ms` or fail saying what did not happen. @param {Promise<any>} p @param {number} ms @param {string} what */
const within = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} did not happen within ${ms} ms`)), ms).unref())]);
/** A promise and the hand that settles it. */
const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const read = (/** @type {string} */ f) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", f), "utf8");
/** A turn's blocks laid out as the timeline's render lays them: the note split off, one segment a block. @param {any} turn */
const laidOut = (turn) => ({ ...turn, segments: splitNote(turn.blocks, turn.note).map((/** @type {any} */ block) => ({ kind: "block", block })) });

describe("the loop's notes", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-notes-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  /** @param {any} body */
  const ask = (body) =>
    shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, stream: false, ...body }, { "x-filament-cwd": root, "x-session-id": `s-${Math.random().toString(36).slice(2, 8)}` });
  /** @param {any} r */
  const eventsOf = async (r) => (await (await shim.api(`/api/runs/${r.headers.get("x-filament-request-id")}/events?since=0&limit=5000`)).json()).events;
  /** @param {string} kind @param {string} words */
  const steerLive = async (kind, words) => {
    const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
    const live = runs.find((/** @type {any} */ x) => x.status === "running");
    assert.ok(live, "an agent turn is running");
    const s = await shim.api(`/api/runs/${live.id}/steer`, { method: "POST", body: { kind, text: words, from: "harness" } });
    assert.equal(s.status, 200, await s.text());
  };

  // (fails before: yes — the note said "what was finished is above" over nothing, and nothing said it was coming)
  test("a Stop before the model wrote anything says no reply had been written yet: the note is the whole reply, said on the run ahead of its words", async () => {
    brain = async () => {
      await steerLive("stop", "");
      return reply("brain-model", [toolUse("r1", "read", { path: "a.txt" })], "tool_use");
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "go" }] });
    assert.equal(r.status, 200);
    const NOTE = "(Filament: the developer stopped this turn after 0 tool calls; no reply had been written yet.)";
    assert.deepEqual((await r.json()).content, [{ type: "text", text: NOTE }]);
    const evts = await eventsOf(r);
    const at = evts.findIndex((/** @type {any} */ e) => e.type === "notice");
    assert.ok(at >= 0, evts.map((/** @type {any} */ e) => e.type).join(","));
    assert.deepEqual([evts[at].kind, evts[at].text, evts[at].quoted], ["stop", NOTE, undefined]);
    assert.ok(at < evts.findIndex((/** @type {any} */ e) => e.type === "run-end"), "said before the run ended");
    assert.deepEqual(alignEvents(evts).note, { kind: "stop", text: NOTE }, "the page reads it off the run");
    assert.ok(RUN_EVENT_TYPE_LIST.includes("notice"), "the run event is in the registry");
  });

  test("a Stop after the model wrote words points at them, quotes the developer, and its event says it quotes", async () => {
    let round = 0;
    // The stop cuts the call it lands in, so the words come from the round before it.
    brain = async () => {
      if (++round === 1) return reply("brain-model", [{ type: "text", text: "Looking at the notes." }, toolUse("r1", "read", { path: "a.txt" })], "tool_use");
      await steerLive("stop", "enough");
      return reply("brain-model", [{ type: "text", text: "never heard" }]);
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "go" }] });
    const NOTE = '(Filament: the developer stopped this turn after 1 tool call — "enough"; what was finished is above.)';
    assert.deepEqual((await r.json()).content.map((/** @type {any} */ b) => b.text), ["Looking at the notes.", NOTE], "the model's words, then the note: two blocks");
    const n = (await eventsOf(r)).find((/** @type {any} */ e) => e.type === "notice");
    assert.deepEqual([n.kind, n.text, n.quoted], ["stop", NOTE, true]);
  });

  // (fails before: yes — "the reply was cut at the 50-token output ceiling; what was finished is above" over nothing)
  // Since HarnessV3-TaskGraph-v2 TG2-D62 the first cut goes on; the turn ends at the second in a row, and its note
  // still points at nothing above when nothing was written.
  test("an output ceiling hit before any text was written says so", async () => {
    brain = () => reply("brain-model", [], "max_tokens");
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "talk" }], max_tokens: 50 });
    const NOTE =
      "(Filament: the reply was cut at the 50-token output ceiling twice in a row, before any of it came back both times, and nothing ran between: the model did not fit its next step in one reply. Send another message to continue; asking for the work in smaller steps helps.)";
    assert.deepEqual((await r.json()).content, [
      { type: "text", text: "(Filament: the reply was cut here at its output ceiling; Filament goes on.)" },
      { type: "text", text: NOTE },
    ]);
    const n = (await eventsOf(r)).find((/** @type {any} */ e) => e.type === "notice");
    assert.deepEqual([n.kind, n.text], ["output", NOTE]);
  });
});

describe("the loop knows whether it wrote anything", () => {
  const sink = () => ({ blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } });
  /** @param {any} over */
  const args = (over) =>
    /** @type {any} */ ({
      model: "m",
      messages: [{ role: "user", content: "go" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false }),
      modeNow: () => "auto",
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      costOf: () => 0,
      runHand: async (/** @type {string} */ name) => `${name} ran`,
      delegateRead: null,
      permissions: null,
      tree: null,
      onEvent: () => {},
      previewChars: 0,
      sink: sink(),
      signal: null,
      resume: null,
      ...over,
    });
  /** A mailbox the test fills. @param {AbortSignal} [stopSignal] */
  const mailbox = (stopSignal) => {
    /** @type {any[]} */
    const queue = [];
    return { queue, box: { read: (/** @type {any} */ pick) => (pick ? queue.splice(0).filter(pick) : queue.splice(0)), ...(stopSignal ? { stopSignal } : {}) } };
  };
  const ABOVE = "(Filament: the developer stopped this turn after 0 tool calls; what was finished is above.)";

  // (fails before: yes — the final was the note alone: the words the developer had read were gone from the archive,
  // and the next turn's model said it had written nothing — the drive's S4, F27)
  test("words a stop cut mid-stream were written: the reply keeps them, and the note points at them", async () => {
    const stopper = new AbortController();
    const m = mailbox(stopper.signal);
    const out = await runAgentTurn(args({
      call: async (/** @type {any} */ { onDelta }) => {
        onDelta?.({ kind: "text", text: "Looking at" });
        m.queue.push({ kind: "stop", text: "", from: "harness" });
        stopper.abort();
        throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
      },
      mailbox: m.box,
    }));
    assert.equal(out.status, "stopped");
    assert.deepEqual(out.final, [{ type: "text", text: "Looking at" }, { type: "text", text: ABOVE }]);
  });

  // (fails before: yes — F27, where the stop's cut ends the call with an answer instead of a throw)
  test("a call the stop cut that answered keeps the words it had streamed", async () => {
    const stopper = new AbortController();
    const m = mailbox(stopper.signal);
    const out = await runAgentTurn(args({
      call: async (/** @type {any} */ { onDelta }) => {
        onDelta?.({ kind: "text", text: "Half a" });
        m.queue.push({ kind: "stop", text: "", from: "harness" });
        stopper.abort();
        return { ok: false, status: 499, id: null, json: null };
      },
      mailbox: m.box,
    }));
    assert.equal(out.status, "stopped");
    assert.deepEqual(out.final, [{ type: "text", text: "Half a" }, { type: "text", text: ABOVE }]);
  });

  test("words a reply brought whole, with no deltas (an upstream that answered JSON), were written: the note points at them", async () => {
    const m = mailbox();
    const out = await runAgentTurn(args({
      call: async () => {
        m.queue.push({ kind: "stop", text: "", from: "harness" });
        return { ok: true, status: 200, id: null, json: { content: [{ type: "text", text: "Looking." }, toolUse("b1", "bash", { command: "echo hi" })], usage: { input_tokens: 10, output_tokens: 5 } } };
      },
      mailbox: m.box,
    }));
    assert.equal(out.status, "stopped");
    assert.deepEqual(out.final, [{ type: "text", text: ABOVE }]);
  });
});

describe("a session's waiting turn, after a reload", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {(call: any) => any} */
  let script = () => undefined;
  before(async () => {
    up = await fakeUpstream(async (call) => script(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });
  /** @param {string} model @param {any} [settings] */
  const session = async (model, settings) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model, ...(settings ? { settings } : {}) } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content */
  const send = (id, content, extra = {}) => shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false, ...extra } });
  /** @param {string} id @param {string} content */
  const turnOn = async (id, content, extra = {}) => {
    const r = await send(id, content, extra);
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  /** @param {string} id */
  const transcript = async (id) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
  /** The session's turns as the page reads them: the work held back, then each turn's read. @param {string} id */
  const pageTurnsOf = (id) => pageTurns((path) => shim.api(path), id);

  // (fails before: yes — the transcript kept the question but not the words the model wrote before it, so a reloaded
  // page drew the copy alone, under a card that said the same)
  // (and, HarnessV3-Views V3 drive 4 — fails before: yes — answered, the words moved to the resumed turn, drawn after
  // the work they came before, and the asking turn kept its question alone)
  test("while a question waits, the words before it are the turn's answer and the copy is the card's alone — answered, the words stay with the question, whose copy is drawn again", async () => {
    const WORDS = "Before I write the file, one decision is yours.";
    const Q = { question: "Which name?", options: [{ label: "notes.md", description: "matches the rest" }, { label: "NOTES.txt" }] };
    const COPY = askText(askOf(Q));
    script = (call) =>
      lastResults(call.body.messages).length
        ? reply("m-1", [{ type: "text", text: "done." }])
        : reply("m-1", [{ type: "text", text: WORDS }, toolUse("q1", "ask", Q)], "tool_use");
    const id = await session("m-1");
    const j = await turnOn(id, "start");
    assert.deepEqual(j.content.map((/** @type {any} */ b) => b.text), [WORDS, COPY], "a client that draws no card reads both");
    const tr = await transcript(id);
    assert.equal(tr.paused?.kind, "ask", JSON.stringify(tr.paused));
    assert.deepEqual(tr.paused.reply, { role: "assistant", content: [{ type: "text", text: WORDS }] }, "the reply the question came in");
    assert.deepEqual(tr.turns.at(-1).notice, { kind: "ask", text: COPY }, "the turn keeps its note");
    const waiting = /** @type {any} */ ((await pageTurnsOf(id)).at(-1));
    assert.deepEqual(waiting.blocks.map((/** @type {any} */ b) => b.text), [WORDS, COPY], "the words, then the copy — as the reply streamed");
    assert.deepEqual(waiting.note, { kind: "ask", text: COPY });
    // As the page holds it after a reload: paused (app.js's hydrate), its blocks laid out as render lays them.
    const page = laidOut({ ...waiting, paused: { kind: "ask", question: tr.paused.question } });
    assert.deepEqual(segmentsShown(page).map((/** @type {any} */ s) => s.block.text), [WORDS], "the card says the question; the reply says the words before it");
    assert.equal(/** @type {any} */ (foldSplit(segmentsShown(page), { live: true }).lastText)?.block?.text, WORDS);

    await turnOn(id, "notes.md");
    const answered = await transcript(id);
    assert.equal(answered.paused, null, "answered, nothing waits");
    const [asked, resumed] = (await pageTurnsOf(id)).slice(-2);
    assert.deepEqual(segmentsShown(laidOut(asked)).map((/** @type {any} */ s) => s.block.text), [WORDS, COPY], "the words it asked in, then the question asked — drawn again where it was");
    assert.deepEqual([resumed.blocks.map((/** @type {any} */ b) => b.text), resumed.toolCalls], [["done."], 1], "the resumed turn: the answered call, and its own words");
  });

  // (fails before: yes — HarnessV3-Views V3 drive 4: answered, a turn's words before its permission moved to the next
  // turn, merged there with that turn's own words after the command they came before)
  // (and, drive 5 — fails before: yes — reloaded, the resumed turn drew its words first and the command it ran before
  // them under them, both folded, and the question alone below)
  test("answered, each turn keeps the words it said before asking — a permission, then the resumed turn's own question — and each call goes with the turn that ran it, where it ran", async () => {
    const LEAD = "First I check the runtime.";
    const NEXT = "node runs. One question:";
    const Q = { question: "Where should it live?", options: [{ label: "calc.js" }, { label: "ops.js" }] };
    /** @param {any} call @param {string} id */
    const answered = (call, id) => call.body.messages.some((/** @type {any} */ m) => Array.isArray(m.content) && m.content.some((/** @type {any} */ c) => c?.type === "tool_result" && c.tool_use_id === id));
    script = (call) =>
      answered(call, "q1") ? reply("m-1", [{ type: "text", text: "Done where you chose." }])
      : answered(call, "b1") ? reply("m-1", [{ type: "text", text: NEXT }, toolUse("q1", "ask", Q)], "tool_use")
      : reply("m-1", [{ type: "text", text: LEAD }, toolUse("b1", "bash", { command: "node -p process.version" })], "tool_use");
    const id = await session("m-1", { loop: { permissions: "edit" } });
    const PERM = (await turnOn(id, "check the runtime, then ask me")).content.at(-1).text;
    assert.match(PERM, /^May I run this command\? `node -p process.version`/);
    await turnOn(id, "yes", { allow: true });
    const waiting = await transcript(id);
    assert.equal(waiting.paused?.kind, "ask", JSON.stringify(waiting.paused));
    assert.equal(waiting.turns.at(-1).resumes, "permission", "the resumed turn says which pause it answered");
    const ASK = askText(askOf(Q));
    /** @param {any} t */
    const said = (t) => [t.blocks.map((/** @type {any} */ b) => b.text), t.toolCalls, t.toolLegs];
    const [first, second] = (await pageTurnsOf(id)).slice(-2);
    assert.deepEqual(said(first), [[LEAD, PERM], 0, 0], "the words it asked in stay with it, before the permission it asked");
    assert.deepEqual(said(second), [[NEXT, ASK], 1, 1], "the command ran here; the words are this turn's own, before its question");

    await turnOn(id, "calc.js");
    const done = await transcript(id);
    assert.equal(done.turns.at(-1).resumes, "ask");
    const [a, b, c] = (await pageTurnsOf(id)).slice(-3);
    assert.deepEqual(said(a), [[LEAD, PERM], 0, 0]);
    assert.deepEqual(said(b), [[NEXT, ASK], 1, 1], "answered, its words stay with its question too");
    assert.deepEqual(said(c), [["Done where you chose."], 1, 1], "the question's call was answered here");
    // As a reload lays the resumed turn out: its blocks, the command its run ran first where it ran, then the split.
    const turn = laidOut(b);
    const { events } = await (await shim.api(`/api/runs/${done.turns.at(-2).requestIds[0]}/events?since=0&limit=500`)).json();
    const ran = /** @type {any} */ ({ kind: "cards" });
    turn.segments.splice(roundCardAnchor(turn.segments, alignEvents(events).byRound, 1), 0, ran);
    const split = /** @type {any} */ (foldSplit(segmentsShown(turn), { note: turn.note }));
    assert.deepEqual([split.fold, split.lastText?.block?.text, split.after, split.closing?.block?.text], [[ran], NEXT, [], ASK], "the command, its words, then the question, last");
  });

  // (fails before: no — a guard the mutation pass asked for: nothing checked that the thoughts of the reply that asked
  // stay with its words once the question is answered)
  test("answered, the thoughts of the reply that asked stay with its words on the asking turn", async () => {
    const THOUGHT = "Two names fit; the developer should pick.";
    const WORDS = "One decision is yours.";
    const Q = { question: "Which name?", options: [{ label: "a.md" }, { label: "b.md" }] };
    script = (call) =>
      lastResults(call.body.messages).length
        ? reply("m-1", [{ type: "text", text: "done." }])
        : reply("m-1", [{ type: "thinking", thinking: THOUGHT, signature: "sig" }, { type: "text", text: WORDS }, toolUse("q1", "ask", Q)], "tool_use");
    const id = await session("m-1");
    await turnOn(id, "start");
    await turnOn(id, "a.md");
    const [asked, resumed] = (await pageTurnsOf(id)).slice(-2);
    assert.deepEqual(asked.blocks.map((/** @type {any} */ b) => [b.type, b.text]), [["thinking", THOUGHT], ["text", WORDS], ["text", askText(askOf(Q))]]);
    assert.deepEqual(resumed.blocks.map((/** @type {any} */ b) => [b.type, b.text]), [["text", "done."]]);
  });

  // (fails before: no — a guard the mutation pass asked for: nothing checked that a resumed turn whose compaction
  // folded the reply that asked into its summary is no longer marked as opening with it)
  test("a resumed turn that compacted the reply that asked into its summary says nothing of it: the asking turn takes nothing of the summary", async () => {
    const hold = deferred();
    let held = false;
    let summarized = 0;
    script = async (call) => {
      const b = call.body || {};
      const system = Array.isArray(b.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b.system || "");
      if (system.includes("compaction summaries")) {
        summarized++;
        return reply("m-1", [{ type: "text", text: "<analysis>\nnotes\n</analysis>\n<summary>\nSUMMARY: node was checked.\n</summary>" }]);
      }
      const done = lastResults(b.messages).map((/** @type {any} */ r) => r.tool_use_id);
      if (!done.length) return reply("m-1", [{ type: "text", text: "First I check the runtime." }, toolUse("b1", "bash", { command: "node -p process.version" })], "tool_use");
      if (done.includes("b1")) return reply("m-1", [toolUse("r2", "read", { path: "a.txt" })], "tool_use");
      if (done.includes("r2")) {
        held = true;
        await hold.promise; // the developer presses Compact while round 3 is being decided
        return reply("m-1", [toolUse("r3", "read", { path: "b.txt" })], "tool_use");
      }
      return reply("m-1", [{ type: "text", text: "Done." }]);
    };
    try {
      const id = await session("m-1", { loop: { permissions: "edit" } });
      const PERM = (await turnOn(id, "check the runtime")).content.at(-1).text;
      const pending = send(id, "yes", { allow: true });
      await until(() => held, "round 3's model call");
      const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
      const live = runs.find((/** @type {any} */ r) => r.status === "running");
      assert.ok(live, "the resumed turn's run is live");
      const s = await shim.api(`/api/runs/${live.id}/steer`, { method: "POST", body: { kind: "compact", text: "", from: "harness" } });
      assert.equal(s.status, 200, await s.text());
      hold.resolve();
      const r = await within(pending, 10000, "the resumed turn's reply");
      assert.equal(r.status, 200, await r.clone().text());
      assert.equal(summarized, 1, "the resumed turn folded its older rounds, the reply that asked among them");
      const tr = await transcript(id);
      assert.equal("resumes" in tr.turns.at(-1), false, "its work opens with the summary now");
      assert.deepEqual((await pageTurnsOf(id)).at(-2)?.blocks.map((/** @type {any} */ b) => b.text), [PERM], "the asking turn keeps its own");
    } finally {
      hold.resolve();
    }
  });

  // (fails before: yes — a reloaded permission named neither its tool nor its words; and, HarnessV3-Views V3, nor the
  // always-allow waiting for its shape)
  test("a permission waiting names its tool, the words it asked in and the always-allow waiting for its shape; a reply that only asked brings no words", async () => {
    script = () => reply("m-1", [toolUse("w1", "write", { path: "x.txt", content: "x" })], "tool_use");
    const id = await session("m-1", { loop: { permissions: "ask" } });
    const { projectId } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json();
    const item = shim.app.memory.archive.items.add({ projectId, chainId: id, kind: "permission", text: "write: *.txt", status: "inferred", importance: 0.8 });
    const j = await turnOn(id, "write it");
    const asked = j.content.at(-1).text;
    assert.match(asked, /^May I write .*x\.txt.*\? Answer \/allow to write it, or say what to do instead\.$/);
    const tr = await transcript(id);
    assert.equal(tr.paused?.kind, "permission", JSON.stringify(tr.paused));
    assert.deepEqual([tr.paused.question, tr.paused.tool, tr.paused.offer], [asked, "write", { itemId: item.id, tool: "write", shape: "*.txt" }]);
    assert.equal("reply" in tr.paused, false);
    assert.deepEqual(tr.turns.at(-1).notice, { kind: "permission", text: asked });
    const page = laidOut({ ...(await pageTurnsOf(id)).at(-1), paused: { kind: "permission", question: tr.paused.question, tool: tr.paused.tool } });
    assert.deepEqual(segmentsShown(page), [], "the card says it all");
  });

  // (fails before: yes — the fold hid itself over no work, and the note said "what was finished is above" over nothing)
  test("an agent turn stopped before it wrote anything reloads as a bare Stopped: the fold's words, nothing to open, no copy", async () => {
    const hold = deferred();
    let asked = false;
    script = async () => {
      asked = true;
      await hold.promise;
      return reply("m-1", [{ type: "text", text: "late" }]);
    };
    try {
      const id = await session("m-1");
      const pending = send(id, "go");
      await until(() => asked, "the model call");
      const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
      const live = runs.find((/** @type {any} */ r) => r.status === "running");
      assert.ok(live, "the turn's run is live");
      const s = await shim.api(`/api/runs/${live.id}/steer`, { method: "POST", body: { kind: "stop", text: "", from: "harness" } });
      assert.equal(s.status, 200, await s.text());
      const r = await within(pending, 5000, "the stopped turn's reply");
      const NOTE = "(Filament: the developer stopped this turn after 0 tool calls; no reply had been written yet.)";
      assert.equal(text((await r.json()).content), NOTE);
      const tr = await transcript(id);
      assert.equal(tr.turns.at(-1).stopped?.by, "harness");
      const turn = laidOut((await pageTurnsOf(id)).at(-1));
      assert.deepEqual(segmentsShown(turn), [], "the copy is left out");
      assert.deepEqual(foldHeader(turn, 0), { hidden: false, bare: true }, "…and the fold says Stopped, though there is no work to fold");
    } finally {
      hold.resolve();
    }
  });
});

describe("the page draws each note once", () => {
  const STOP = "(Filament: the developer stopped this turn after 2 tool calls; what was finished is above.)";
  /** @param {string} t */
  const seg = (t) => ({ kind: "block", block: { type: "text", text: t } });

  test("noteSaidElsewhere: a question or a permission while its card waits; a stop the fold says, unless it quotes the developer; every other note is the page's one drawing of it", () => {
    const ask = { kind: "ask", text: "Which?" };
    assert.equal(noteSaidElsewhere({ note: ask, paused: { kind: "ask" } }), true);
    assert.equal(noteSaidElsewhere({ note: ask, paused: null }), false, "answered: the copy is drawn again");
    assert.equal(noteSaidElsewhere({ note: { kind: "permission", text: "May I?" }, paused: { kind: "permission" } }), true);
    const stop = { kind: "stop", text: STOP };
    assert.equal(noteSaidElsewhere({ note: stop, status: "streaming" }), true, "it streams in just before the fold turns: no flash");
    assert.equal(noteSaidElsewhere({ note: stop, status: "stopped" }), true);
    assert.equal(noteSaidElsewhere({ note: stop, status: "done", stopped: { by: "harness" } }), true, "a reload reads the archived mark");
    assert.equal(noteSaidElsewhere({ note: stop, status: "done" }), false, "a fold that says Worked does not say the stop");
    assert.equal(noteSaidElsewhere({ note: { ...stop, quoted: true }, status: "stopped" }), false, "the developer's words are said nowhere else");
    for (const kind of ["deadline", "rounds", "progress", "output", "compaction", "window"])
      assert.equal(noteSaidElsewhere({ note: { kind, text: "(Filament: …)" }, status: "stopped", stopped: { by: "harness" }, paused: { kind: "ask" } }), false, kind);
    assert.equal(noteSaidElsewhere({ note: null, paused: { kind: "ask" } }), false);
    assert.equal(noteSaidElsewhere({ note: { kind: "ask", text: "" }, paused: { kind: "ask" } }), false);
  });

  test("splitNote: an archived final that ends with the note becomes two fresh blocks; anything else comes back as it was", () => {
    const own = [{ type: "text", text: "Done." }, { type: "text", text: STOP }];
    assert.equal(splitNote(own, { text: STOP }), own, "already its own block");
    const merged = [{ type: "thinking", text: "hm" }, { type: "text", text: `Done.\n\n${STOP}`, mdCache: "<p>" }];
    const out = splitNote(merged, { text: STOP });
    assert.deepEqual(out, [{ type: "thinking", text: "hm" }, { type: "text", text: "Done." }, { type: "text", text: STOP }], "no rendering carried over");
    assert.equal(out[0], merged[0], "the blocks before are the same blocks");
    assert.deepEqual(splitNote([{ type: "text", text: `  \n${STOP}` }], { text: STOP }), [{ type: "text", text: STOP }], "only space before it: the note alone");
    const later = [{ type: "text", text: `Done.\n\n${STOP}` }, { type: "thinking", text: "after" }];
    assert.deepEqual(splitNote(later, { text: STOP }).map((b) => b.text), ["Done.", STOP, "after"], "the last text block, wherever it stands");
    const other = [{ type: "text", text: "Done." }];
    assert.equal(splitNote(other, { text: STOP }), other);
    assert.equal(splitNote(other, null), other);
    assert.deepEqual(splitNote(null, { text: STOP }), []);
  });

  test("segmentsShown: only the note's own block leaves the layout, and only while the page says it", () => {
    const turn = { status: "paused", paused: { kind: "ask" }, note: { kind: "ask", text: "Which?" }, segments: [seg("Which?"), { kind: "tool" }, seg("Before I go on, one decision."), seg("Which?")] };
    const shown = segmentsShown(turn);
    assert.deepEqual(shown, turn.segments.slice(0, 3), "the last text, the note's own block — an earlier text of the same words stays");
    assert.equal(foldSplit(shown, { live: true }).lastText, turn.segments[2], "the words before it are the answer");
    assert.equal(turn.segments.length, 4, "the turn keeps it");
    assert.equal(segmentsShown({ ...turn, paused: null, status: "done" }), turn.segments);
    assert.equal(segmentsShown({ ...turn, segments: [seg("Which?"), seg("Other words")] }).length, 2, "a last text that is not the note stays");
  });

  test("foldHeader: a finished turn with no work draws none, a stopped one draws it bare — its words, nothing to open", () => {
    assert.deepEqual(foldHeader({ status: "done" }, 0), { hidden: true, bare: false });
    assert.deepEqual(foldHeader({ status: "done" }, 2), { hidden: false, bare: false });
    assert.deepEqual(foldHeader({ status: "stopped" }, 0), { hidden: false, bare: true });
    assert.deepEqual(foldHeader({ status: "done", stopped: { by: "harness" } }, 0), { hidden: false, bare: true }, "after a reload");
    assert.deepEqual(foldHeader({ status: "stopped" }, 3), { hidden: false, bare: false });
  });

  // (fails before: yes — HarnessV3-Views V3's drive: a running turn whose work all came after its words drew an open,
  // empty fold — a stray rule under the live line, and a chevron that opened nothing)
  test("foldHeader: a running turn's fold with nothing in it is its live line, bare; work moved in opens it, unless the developer chose", () => {
    assert.deepEqual(foldHeader({ status: "streaming" }, 0), { hidden: false, bare: true });
    assert.deepEqual(foldHeader({ status: "paused" }, 0), { hidden: false, bare: true });
    assert.deepEqual(foldHeader({ status: "streaming" }, 2), { hidden: false, bare: false });
    assert.match(read("src/ui/harness/conversation/timeline.js"), /if \(head\.bare\) \/\*\* @type \{HTMLDetailsElement\} \*\/ \(v\.fold\.el\)\.open = false;\s+(\/\/[^\n]*\n\s+)*else if \(live && !turn\.foldHeld\) \/\*\* @type \{HTMLDetailsElement\} \*\/ \(v\.fold\.el\)\.open = true;/);
  });

  test("the timeline lays the turn out by these rules (pinned in the page's source: the timeline builds real DOM)", () => {
    const tl = read("src/ui/harness/conversation/timeline.js");
    assert.match(tl, /askedApart\(segmentsShown\(turn\)\);\s+const \{ lastText, lead, pictures, fold, after, closing \} = foldSplit\(rest, \{ live, note: turn\.note \}\)/, "the layout leaves the note out, and a note under the reply's last words keeps them standing");
    assert.match(tl, /\.\.\.lead\.map\(\(s\) => s\.el\), \.\.\.pictures\.map\(\(s\) => s\.el\), \.\.\.asked\.map\(\(\/\*\* @type \{any\} \*\/ s\) => s\.el\), lastText \? lastText\.el : null,/, "words alone stand above the last text, the asked agents' cards between them");
    assert.match(tl, /const head = foldHeader\(turn, wanted\.length\);\n\s+v\.fold\.el\.classList\.toggle\("hidden", head\.hidden\);\n\s+v\.fold\.el\.classList\.toggle\("bare", head\.bare\);/);
    assert.match(tl, /for \(const b of splitNote\(turn\.blocks, turn\.note\)\)/, "a reload's merged final is split");
    assert.match(tl, /turn\.note = row\.notice \|\| turn\.note \|\| null;/, "the transcript row's note");
    assert.match(tl, /turn\.stopped = row\.stopped \|\| turn\.stopped \|\| null;/, "a stop from elsewhere: the fold says it before a reload too");
    assert.match(tl, /if \(al\.note\) turn\.note = al\.note;/, "the run's notice");
    assert.match(read("src/ui/harness/conversation/turn.js"), /if \(det\.classList\.contains\("bare"\)\) return e\.preventDefault\(\);/, "a bare header opens nothing");
    assert.match(read("src/ui/harness/aqua.css"), /\.work-fold\.bare > summary \.work-chev \{ visibility: hidden; \}/);
    assert.match(read("src/ui/harness/app.js"), /last\.paused = pauseOf\(chat\.paused\);/, "a reloaded pause is made as a live one is");
    assert.equal(pauseOf({ kind: "permission", tool: "bash", question: "May I?" }).tool, "bash", "a reloaded permission names its tool");
  });

  // (fails before: yes — the live drawing took a block out of the DOM for a rebuilt view and drew every block again:
  // a note the layout leaves out was pushed once more on each redraw, and every copy but the newest was drawn — the
  // drive's S5 and S6, where the note was the reply's first block)
  test("a live drawing starts over only when the view it drew into was rebuilt: a block the layout leaves out is still the drawing's", () => {
    const drawn = {};
    const rebuilt = {};
    const leftOut = { el: { isConnected: false } };
    assert.equal(drawingStartsOver({ blockHandles: [leftOut], handlesView: drawn }, drawn), false, "the note's copy, left out of the layout, is no rebuilt view");
    assert.equal(drawingStartsOver({ blockHandles: [{ el: { isConnected: true } }], handlesView: drawn }, rebuilt), true, "a render built the turn a new view");
    assert.equal(drawingStartsOver({ blockHandles: [], handlesView: drawn }, rebuilt), false, "nothing drawn yet: nothing to start over");
    const tl = read("src/ui/harness/conversation/timeline.js");
    assert.match(tl, /const startsOver = drawingStartsOver\(live, v\);\n\s+if \(startsOver\) live\.blockHandles = \[\];\n\s+live\.handlesView = v;/, "the drawing asks, and remembers the view it draws into");
    assert.doesNotMatch(tl, /isConnected\) live\.blockHandles = \[\]/, "a node out of the DOM is no sign of a rebuilt view");
  });
});
