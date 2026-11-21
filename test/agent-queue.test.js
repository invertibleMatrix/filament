// @ts-check
// HarnessV3-FailurePoints §7.2 through the app: what the person types while Claude works is queued at it, as Claude
// Code takes what is typed — at its next step, or as its next prompt when the turn ended first — and nothing is
// aborted. "Interrupt and send" is a note that asks to (FP-D8). The fake agent in Claude's shape queues a prompt sent
// while its `~queue` turn runs and folds it in at the gates of its steps (fixtures/fake-acp-agent.mjs, FAKE_ACP_CLAUDE,
// FAKE_ACP_QUEUE_GATE).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, parseSse } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { createQueued } from "../src/adapters/agents/acp/queued.js";
import { agentTakesWords } from "../src/ui/harness/lib/labels.js";

const FAKE_ACP = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");

/** The words of a reply's text blocks, rebuilt from its stream. @param {{ event?: string | null, data: any }[]} frames */
const wordsOf = (frames) => {
  /** @type {string[]} */
  const texts = [];
  for (const { event, data } of frames) {
    if (event === "filament_run") continue;
    if (data?.type === "content_block_start" && data.content_block.type === "text") texts[data.index] = data.content_block.text || "";
    else if (data?.type === "content_block_delta" && data.delta.type === "text_delta") texts[data.index] += data.delta.text;
  }
  return texts.filter((t) => t !== undefined).join("");
};

describe("Claude takes what is typed while it works as Claude Code does (HarnessV3-FailurePoints §7.2)", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-agent-queue-"));
  const projDir = join(root, "project");
  const calls = join(root, "calls.jsonl");
  const gates = join(root, "gates");
  before(async () => {
    mkdirSync(projDir);
    mkdirSync(gates);
    /** @param {Record<string, string>} env */
    const acp = (env) => ({ command: process.execPath, args: [FAKE_ACP], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_CALLS: calls, FAKE_ACP_QUEUE_GATE: gates, ...env }, cwdDefault: projDir, permissions: "allow-all", hints: false });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "claude", name: "claude", type: "acp", acp: acp({ FAKE_ACP_STEERING: "1", FAKE_ACP_SLOW_MS: "1500", FAKE_ACP_BG_PAUSE_MS: "300" }) },
          // Claude's adapter before live steering: words queue, and nothing interrupts it.
          { id: "queues", name: "queues", type: "acp", acp: acp({}) },
          // An agent that queues prompts as Qoder's CLI declares it, and sends none of its raw messages.
          { id: "qoderq", name: "qoderq", type: "acp", acp: acp({ FAKE_ACP_CLAUDE: "", FAKE_ACP_QODER_QUEUE: "1" }) },
        ];
        cfg.routes = ["claude", "queues", "qoderq"].map((u) => ({ match: `${u}/*`, upstream: u, upstreamModel: "{1}", enabled: true }));
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });
  /** A `~queue` turn's gates, all shut. */
  const shut = () => {
    rmSync(gates, { recursive: true, force: true });
    mkdirSync(gates);
  };
  /** Lets a `~queue` turn's step (`q1`, `q2`) or its result (`end`) come. @param {string} step */
  const open = (step) => writeFileSync(join(gates, step), "");
  /** A harness session on a model. @param {string} model */
  const session = async (model) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** A harness turn, as the page sends one: its run's id and its reply's body. @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
    return { runId: String(res.headers.get("x-filament-request-id")), body: res.text() };
  };
  /** @param {string} runId @returns {Promise<any[]>} */
  const runEvents = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events;
  /** @param {string} runId */
  const runOf = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}`)).json()).run;
  /** @param {string} runId @param {Record<string, unknown>} body */
  const steer = (runId, body) => shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body });
  /** A note sent as the page sends one; the mailbox's id for it. @param {string} runId @param {string} text @param {boolean} [interrupt] */
  const note = async (runId, text, interrupt = false) => {
    const r = await steer(runId, { kind: "note", text, from: "harness", ...(interrupt ? { interrupt: true } : {}) });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).message.id);
  };
  /** @returns {any[]} */
  const callsMade = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  /** The words the agent was sent while it worked, and how. @param {string} text */
  const sentWhileWorking = (text) => callsMade().filter((c) => c.words === text && (c.method === "queued prompt" || c.method === "_session/steering")).map((c) => c.method);
  /** Until the agent has `text` queued. @param {string} text */
  const queuedAt = (text) => until(() => sentWhileWorking(text).includes("queued prompt") || null, `"${text}" queued at the agent`);
  /** Until the run began the call `id`. @param {string} runId @param {string} id */
  const began = (runId, id) => until(async () => (await runEvents(runId)).some((e) => e.type === "tool-start" && e.id === id) || null, `the call ${id} to begin`);
  /** Until the run ended the call `id`. @param {string} runId @param {string} id */
  const ended = (runId, id) => until(async () => (await runEvents(runId)).some((e) => e.type === "tool-end" && e.id === id) || null, `the call ${id} to end`);
  /** The run's steering events, as [type, ids]. @param {string} runId */
  const steering = async (runId) => (await runEvents(runId)).filter((e) => e.type.startsWith("steer")).map((e) => [e.type, e.ids || [e.id]]);
  /** The turn's record, once its run is on it. @param {string} runId */
  const recordOf = (runId) =>
    until(async () => {
      const r = await shim.record(runId);
      return r?.acp?.run ? r : null;
    }, "the turn's record");
  /** The session's last turn as the archive keeps it. @param {string} id */
  const archived = async (id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?work=1`)).json()).turns.at(-1);
  /** A message's words, its text blocks joined. @param {any} m */
  const said = (m) => `${m.role}:${(Array.isArray(m.content) ? m.content : []).filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join("|")}`;

  // (fails before: yes — the note went by `_session/steering`, which interrupts Claude at once; then, before
  // HarnessV4_Tasks C34, it was queued at Claude the moment it was sent, past the developer's reach)
  test("a note sent while Claude runs a tool waits in Filament for its next tool call, then is queued at it and goes in at its next step: nothing is interrupted, and the note is read once Claude took it, where it took it", async () => {
    shut();
    const id = await session("claude/haiku");
    const { runId, body } = await turn(id, "~queue");
    await began(runId, "q1");
    const meta = (await runOf(runId)).meta;
    assert.deepEqual([meta.steer, meta.interrupts], ["queued", true], "the composer reads it off the run");
    const sent = await note(runId, "also check the tests");
    // Its call still runs: the note waits in Filament, the developer's to change until Claude's next call begins.
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(sentWhileWorking("also check the tests"), [], "not at Claude yet");
    assert.deepEqual(await steering(runId), [["steer", [sent]]]);
    open("q1");
    await queuedAt("also check the tests");
    assert.deepEqual(await steering(runId), [["steer", [sent]], ["steer-sent", [sent]]], "handed over as Claude's next call began");
    open("q2");
    await until(async () => (await runEvents(runId)).some((e) => e.type === "steer-read" && e.ids.includes(sent)) || null, "Claude to take it");
    open("end");
    assert.equal(wordsOf(parseSse(await body)), "working… heard:also check the tests done ");
    assert.deepEqual(await steering(runId), [["steer", [sent]], ["steer-sent", [sent]], ["steer-read", [sent]]]);
    assert.equal((await runEvents(runId)).at(-1).status, "done");
    assert.deepEqual(sentWhileWorking("also check the tests"), ["queued prompt"], "a prompt queued at Claude; nothing interrupted it");
    assert.ok(!callsMade().some((c) => c.method === "session/cancel"), "nothing cancelled");
    const t = await archived(id);
    const work = t.work.map(said);
    assert.ok(work.indexOf("user:also check the tests") > work.indexOf("assistant:working… ") && work.indexOf("user:also check the tests") < work.indexOf("assistant:heard:also check the tests "), work.join("\n"));
    assert.deepEqual(t.final.content, [{ type: "text", text: "done " }]);
    const rec = await recordOf(runId);
    assert.ok(rec.changes.includes("acp: a message sent while claude worked was queued and went in at its next step"), rec.changes.join("\n"));
  });

  // (fails before: yes — the note went by `_session/steering`, which Claude's adapter takes as a new turn's start once
  // the turn has ended, or hands back; then, before HarnessV4_Tasks C34, it was queued at Claude and ran as its next
  // prompt in the same run)
  test("a note sent while Claude writes its last answer waits for its next tool call, and none comes: the run ends with it unread, and it goes as the next message", async () => {
    shut();
    const id = await session("claude/haiku");
    const { runId, body } = await turn(id, "~queue");
    open("q1");
    open("q2");
    await ended(runId, "q2");
    const sent = await note(runId, "one more thing");
    open("end");
    assert.equal(wordsOf(parseSse(await body)), "working… done ");
    assert.deepEqual(await steering(runId), [["steer", [sent]], ["steer-unread", [sent]]]);
    assert.deepEqual(sentWhileWorking("one more thing"), [], "never at Claude: it is the next message");
    assert.ok(!JSON.stringify(await archived(id)).includes("one more thing"), "no word of it in this turn");
    const rec = await recordOf(runId);
    assert.ok(rec.changes.includes("acp: a message sent while claude worked waited for its next tool call, and its turn ended first: it goes as the next message"), rec.changes.join("\n"));
    assert.deepEqual([rec.tokens.input, rec.tokens.output], [10, 5], "one prompt's spend");
  });

  test("two notes sent close together are handed over together at Claude's next tool call and go in together at its next step, in the order sent", async () => {
    shut();
    const id = await session("claude/haiku");
    const { runId, body } = await turn(id, "~queue");
    await began(runId, "q1");
    const first = await note(runId, "look at a");
    const second = await note(runId, "and b");
    open("q1");
    await queuedAt("and b");
    assert.deepEqual(await steering(runId), [["steer", [first]], ["steer", [second]], ["steer-sent", [first]], ["steer-sent", [second]]], "both at Claude before it took either");
    open("q2");
    open("end");
    assert.equal(wordsOf(parseSse(await body)), "working… heard:look at a heard:and b done ");
    assert.deepEqual(await steering(runId), [["steer", [first]], ["steer", [second]], ["steer-sent", [first]], ["steer-sent", [second]], ["steer-read", [first]], ["steer-read", [second]]]);
  });

  // (fails before: no — a guard the mutation pass asked for: every turn here took its notes at one step, so a note
  // taken that stopped the deliveries for the rest went unseen)
  test("notes sent at different steps each go at the tool call after them and are taken at the step after that, in one turn", async () => {
    shut();
    const id = await session("claude/haiku");
    const { runId, body } = await turn(id, "~queue3");
    await began(runId, "q1");
    const first = await note(runId, "look at d");
    open("q1");
    await queuedAt("look at d");
    // Sent while q2 runs, which began before it: it waits for q3.
    const second = await note(runId, "and e");
    open("q2");
    await queuedAt("and e");
    open("q3");
    open("end");
    assert.equal(wordsOf(parseSse(await body)), "working… heard:look at d heard:and e done ");
    assert.deepEqual(await steering(runId), [["steer", [first]], ["steer-sent", [first]], ["steer", [second]], ["steer-read", [first]], ["steer-sent", [second]], ["steer-read", [second]]]);
  });

  // (fails before: yes — words Claude runs after its turn's result each run a cycle of their own, and one that fails leaves
  // the answers before it unread, so the turn keeps what those cycles spent by their results; where the turn's answer
  // and those cycles reach Filament in one read, the newest answer's count was taken once the cycles had been read too,
  // and the record kept 10/5, the turn's own cycle alone)
  test("words Claude runs after its turn's result, the last of them failing, leave the turn with what every cycle spent", async () => {
    shut();
    const id = await session("claude/haiku");
    const { runId, body } = await turn(id, "~queue");
    open("q1");
    open("q2");
    await ended(runId, "q2");
    // Filament's own words go at once; the developer's would wait for a next call that never comes (HarnessV4_Tasks C34).
    for (const text of ["list the files", "~failqueued then the tests"]) assert.equal((await steer(runId, { kind: "note", text, from: "filament" })).status, 200);
    await queuedAt("~failqueued then the tests");
    open("end");
    await body;
    const rec = await until(async () => {
      const r = await shim.record(runId);
      return r?.status === "error" ? r : null;
    }, "the failed turn's record");
    assert.deepEqual([rec.tokens.input, rec.tokens.output], [30, 15], "the turn's cycle and both words' cycles");
  });

  test("a stop with a note queued: Claude drops it, the turn ends stopped, and the note goes as the next message, unread", async () => {
    shut();
    const id = await session("claude/haiku");
    const { runId, body } = await turn(id, "~queue");
    await began(runId, "q1");
    const sent = await note(runId, "never mind that");
    open("q1");
    await queuedAt("never mind that");
    assert.equal((await steer(runId, { kind: "stop", text: "", from: "harness" })).status, 200);
    await body;
    const evs = await runEvents(runId);
    assert.equal(evs.at(-1).status, "stopped");
    assert.deepEqual(evs.filter((e) => e.type === "steer-unread").flatMap((e) => e.ids), [sent]);
    assert.ok(!evs.some((e) => e.type === "steer-read" && e.ids.includes(sent)), "never read");
    const t = await archived(id);
    assert.ok(!JSON.stringify(t).includes("never mind that"), "never Claude's: the archive keeps no word of it");
    const rec = await recordOf(runId);
    assert.ok(rec.changes.includes("acp: claude never took a message queued while it worked — its turn ended or stopped first, or it refused the message; it goes as the next message"), rec.changes.join("\n"));
  });

  test("a note sent to interrupt Claude goes by its steering, into the running turn at once; where Claude can't be interrupted, such a note is refused in words and a plain one is queued", async () => {
    shut();
    const id = await session("claude/haiku");
    const { runId, body } = await turn(id, "~steerable");
    await until(async () => (await runEvents(runId)).some((e) => e.type === "round-start") || null, "the turn to begin");
    const sent = await note(runId, "stop and look at c", true);
    assert.equal(wordsOf(parseSse(await body)), "working… heard:stop and look at c ");
    assert.deepEqual(await steering(runId), [["steer", [sent]], ["steer-sent", [sent]], ["steer-read", [sent]]], "it goes at once: nothing waits for a call");
    assert.deepEqual(sentWhileWorking("stop and look at c"), ["_session/steering"]);
    const rec = await recordOf(runId);
    assert.ok(rec.changes.includes("acp: a message sent while claude worked interrupted it and went into its running turn"), rec.changes.join("\n"));

    shut();
    const other = await session("queues/haiku");
    const q = await turn(other, "~queue");
    await began(q.runId, "q1");
    const meta = (await runOf(q.runId)).meta;
    assert.deepEqual([meta.steer, meta.interrupts], ["queued", undefined]);
    const refused = await steer(q.runId, { kind: "note", text: "now", from: "harness", interrupt: true });
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).error, "only a note to a coding agent that can be interrupted interrupts it; send it without `interrupt` to queue it");
    await note(q.runId, "then this");
    open("q1");
    await queuedAt("then this");
    open("q2");
    open("end");
    assert.equal(wordsOf(parseSse(await q.body)), "working… heard:then this done ");
  });

  // (fails before: no — a guard the mutation pass asked for: no note Claude ran as its next prompt had a background
  // task end in it, so Claude's answer to that task, which comes after the prompt's, went unread)
  test("a note Claude runs as its next prompt is read to its end: Claude's answer to a background task that ended in it is the turn's too", async () => {
    const id = await session("claude/haiku");
    // Its one call launches a sub-agent in the background and the prompt ends: the note, handed over at that call,
    // waits in Claude's queue and runs after it.
    const { runId, body } = await turn(id, "~slowstart ~background-idle");
    // Once the prompt is out: a note sent before goes with it.
    await until(async () => (await runEvents(runId)).some((e) => e.type === "turn-state" && e.to === "sent") || null, "the prompt to go out");
    // Its answer to the task takes Claude 4 s to begin: the turn ends after it, not at the prompt's answer.
    const sent = await note(runId, "~background-slow please");
    await queuedAt("~background-slow please");
    const words = wordsOf(parseSse(await body));
    assert.ok(words.endsWith("The sub-agent found it: README.md says hello."), words);
    assert.deepEqual(await steering(runId), [["steer", [sent]], ["steer-sent", [sent]], ["steer-read", [sent]]]);
    const rec = await recordOf(runId);
    assert.ok(rec.changes.includes("acp: a message sent while claude worked was queued and ran as its next prompt: its turn had ended first"), rec.changes.join("\n"));
  });

  // (fails before: no — a guard the mutation pass asked for: no turn failed with a note queued at Claude, which would
  // have run it unseen)
  test("a turn that fails with a note queued at Claude lets it go: Claude's queue drops it, and it goes as the next message, unread", async () => {
    shut();
    const id = await session("claude/haiku");
    const { runId, body } = await turn(id, "~queue");
    await began(runId, "q1");
    const sent = await note(runId, "and the docs");
    open("q1");
    await queuedAt("and the docs");
    open("fail");
    await body;
    const evs = await runEvents(runId);
    assert.equal(evs.at(-1).status, "error");
    assert.deepEqual(evs.filter((e) => e.type === "steer-unread").flatMap((e) => e.ids), [sent]);
    const rec = await recordOf(runId);
    // A failed turn's record keeps what happened before the failure apart (`priorChanges`).
    const notes = [...(rec.priorChanges || []), ...(rec.changes || [])];
    assert.ok(notes.includes("acp: claude never took a message queued while it worked — its turn ended or stopped first, or it refused the message; it goes as the next message"), notes.join("\n"));
    assert.ok(!JSON.stringify(await archived(id)).includes("and the docs"), "Claude never ran it");
  });

  // (fails before: yes — a note was queued at Claude the moment it was sent, so nothing could change it)
  test("a note that waits for Claude's next tool call can be changed or taken back: Claude gets the new words, or nothing; once handed over, both are refused in words", async () => {
    shut();
    const id = await session("claude/haiku");
    const { runId, body } = await turn(id, "~queue");
    await began(runId, "q1");
    const kept = await note(runId, "look at f");
    const gone = await note(runId, "and g");
    /** @param {string} sid */
    const at = (sid) => `/api/runs/${encodeURIComponent(runId)}/steer/${encodeURIComponent(sid)}`;
    const edited = await shim.api(at(kept), { method: "PATCH", body: { text: "look at h instead" } });
    assert.equal(edited.status, 200, await edited.clone().text());
    assert.equal((await edited.json()).message.text, "look at h instead");
    const empty = await shim.api(at(kept), { method: "PATCH", body: { text: "  " } });
    assert.deepEqual([empty.status, (await empty.json()).error], [400, "a message needs words: Delete takes it back"]);
    assert.equal((await shim.api(at(gone), { method: "DELETE" })).status, 200);
    open("q1");
    await queuedAt("look at h instead");
    const late = await shim.api(at(kept), { method: "PATCH", body: { text: "too late" } });
    assert.deepEqual([late.status, (await late.json()).error], [409, "claude has it already: it goes in at its next step"]);
    const twice = await shim.api(at(gone), { method: "DELETE" });
    assert.deepEqual([twice.status, (await twice.json()).error], [409, "that message no longer waits: the agent has it, or it was taken back"]);
    open("q2");
    open("end");
    assert.equal(wordsOf(parseSse(await body)), "working… heard:look at h instead done ");
    assert.deepEqual([sentWhileWorking("and g"), sentWhileWorking("look at f")], [[], []], "only the new words went to Claude");
    const evs = await runEvents(runId);
    assert.deepEqual(evs.filter((e) => e.type === "steer-edit").map((e) => [e.id, e.text]), [[kept, "look at h instead"]]);
    assert.deepEqual(evs.filter((e) => e.type === "steer-drop").flatMap((e) => e.ids), [gone]);
    assert.ok(!evs.some((e) => e.type === "steer-unread"), "nothing left unread: the one taken back is gone");
    const whole = JSON.stringify(await archived(id));
    assert.ok(whole.includes("look at h instead") && !whole.includes("look at f") && !whole.includes("and g"), "the archive keeps the words Claude got");
  });

  // (fails before: no — a guard the mutation pass asked for: no agent here declared prompt queueing without its raw
  // messages, where no echo would ever say it took the words)
  test("an agent that queues prompts but sends none of its raw messages (Qoder's CLI) takes no words while it works: they wait for its turn's end", async () => {
    const id = await session("qoderq/haiku");
    const { runId, body } = await turn(id, "hang on");
    await until(async () => (await runEvents(runId)).some((e) => e.type === "tool-end") || null, "its read to end");
    assert.equal((await runOf(runId)).meta.steer, "queue", "the composer holds what is typed for the turn's end");
    const refused = await steer(runId, { kind: "note", text: "also this", from: "harness" });
    assert.deepEqual([refused.status, (await refused.json()).error], [400, "this agent takes no words while its turn runs; send them when it ends"]);
    assert.equal((await steer(runId, { kind: "stop", text: "", from: "harness" })).status, 200);
    await body;
    assert.deepEqual(sentWhileWorking("also this"), [], "nothing reached the agent");
  });
});

describe("the prompts a turn queues at the agent (adapters/agents/acp/queued.js)", () => {
  /**
   * A queue whose prompts the test answers: each prompt's text, and how to answer or fail it.
   * @returns {{ q: ReturnType<typeof createQueued>, sent: { text: string, answer: (r: any) => void, fail: (e: Error) => void }[] }}
   */
  const queue = () => {
    /** @type {{ text: string, answer: (r: any) => void, fail: (e: Error) => void }[]} */
    const sent = [];
    const q = createQueued(
      (text) =>
        new Promise((answer, fail) => {
          sent.push({ text, answer, fail });
        }),
    );
    return { q, sent };
  };
  /** Claude's echo of a prompt's words. @param {string} text */
  const echo = (text) => ({ type: "user", parent_tool_use_id: null, isReplay: true, message: { role: "user", content: [{ type: "text", text }] } });
  const result = { type: "result", subtype: "success" };

  test("taken at its echo: into the running work, or after a cycle ended; the echo of other words, a sub-agent's message or a tool's result takes nothing", async () => {
    const { q, sent } = queue();
    const a = q.send("look at a");
    const b = q.send("and b");
    q.heard(echo("someone else's words"));
    q.heard({ type: "user", parent_tool_use_id: "toolu_1", message: { role: "user", content: [{ type: "text", text: "look at a" }] } });
    q.heard({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "look at a" }] } });
    q.heard(echo("look at a"));
    assert.equal(await a, true, "into the running work");
    q.heard(result);
    q.heard({ type: "user", parent_tool_use_id: null, message: { role: "user", content: "and b" } });
    assert.equal(await b, "after", "a cycle ended before it: it ran after");
    const c = q.send("and c");
    q.heard(echo("and c"));
    assert.equal(await c, true, "the cycle the last one began runs: taken into it");
    for (const s of sent) s.answer({ stopReason: "end_turn" });
    assert.deepEqual(
      (await q.drained()).map((t) => t.took),
      [true, "after", true],
    );
  });

  test("answered with no echo: never taken; its failure is no failure of the turn's; one taken that fails fails the drain", async () => {
    const { q, sent } = queue();
    const dropped = q.send("never mind");
    const refused = q.send("nope");
    sent[0].answer({ stopReason: "cancelled" });
    sent[1].fail(new Error("refused"));
    assert.equal(await dropped, false);
    assert.equal(await refused, false);
    assert.deepEqual(await q.drained(), [], "nothing taken");
    const { q: q2, sent: sent2 } = queue();
    const took = q2.send("go on");
    q2.heard(echo("go on"));
    assert.equal(await took, true);
    sent2[0].fail(new Error("overloaded"));
    await assert.rejects(q2.drained(), /overloaded/);
  });

  test("the drain waits for prompts queued while it waits, then takes no more: words sent after are handed back at once", async () => {
    const { q, sent } = queue();
    void q.send("first");
    q.heard(echo("first"));
    let drained = false;
    const done = q.drained().then((answers) => {
      drained = true;
      return answers;
    });
    const second = q.send("second");
    sent[0].answer({ stopReason: "end_turn" });
    await new Promise((r) => setImmediate(r));
    assert.equal(drained, false, "the second still waits");
    q.heard(echo("second"));
    sent[1].answer({ stopReason: "end_turn", usage: { inputTokens: 5 } });
    assert.equal(await second, true);
    assert.deepEqual((await done).map((t) => t.answer.stopReason), ["end_turn", "end_turn"]);
    assert.equal(await q.send("too late"), false, "handed back at once");
    assert.equal(sent.length, 2, "never sent");
  });

  test("let go: nothing waiting asks nothing; prompts still waiting are cancelled, and it settles once they are answered", async () => {
    const { q } = queue();
    let cancels = 0;
    await q.letGo(() => cancels++);
    assert.equal(cancels, 0);
    const { q: q2, sent } = queue();
    const waiting = q2.send("pending");
    let settled = false;
    const going = q2.letGo(() => cancels++).then(() => (settled = true));
    assert.equal(cancels, 1);
    await new Promise((r) => setImmediate(r));
    assert.equal(settled, false, "until the agent answers it");
    sent[0].answer({ stopReason: "cancelled" });
    await going;
    assert.equal(await waiting, false);
    assert.equal(await q2.send("after"), false, "closed");
  });

  test("the page sends a note to a run whose agent queues words; it holds one only where the agent takes none mid-turn", () => {
    assert.deepEqual(["queued", "live", "next", "queue", null].map(agentTakesWords), [true, true, true, false, false]);
  });
});
