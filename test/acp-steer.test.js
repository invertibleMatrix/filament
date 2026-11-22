// @ts-check
// HarnessV3-ACP AC3-1 through the app: what the person types while a coding agent works goes into its running turn
// where the agent takes words there — Claude's adapter (queued at it, HarnessV3-FailurePoints §7.2, or interrupting it
// by `_session/steering`, FP-D8: fixtures/fake-acp-agent.mjs under FAKE_ACP_CLAUDE and FAKE_ACP_STEERING) and Codex
// (`turn/steer`, fixtures/fake-codex-app-server.mjs) — read on the run once the agent took it, and kept in the turn's
// archive where it did. Words a turn that has just ended hands back go as the next message: the run's end says them
// unread. Cursor's CLI, which keeps a turn it cancels, takes them at its next step
// (AC-D6): the fake, through a program named as Cursor's. Antigravity's agy, whose turn a prompt sent while it works
// takes over, takes them as a prompt of their own, never while it waits on its question: the fake, through a program
// named agy. An agent that takes none mid-turn says so on its run.
import { test, describe, before, after } from "node:test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, parseSse } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { agentTakesWords, alignEvents, canTakeBack, steerWords } from "../src/ui/harness/lib/labels.js";
import { createNextStep, nextStepPrompt } from "../src/adapters/agents/acp/next-step.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const FAKE_ACP = join(FIXTURES, "fake-acp-agent.mjs");
const FAKE_CODEX = join(FIXTURES, "fake-codex-app-server.mjs");

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

describe("a coding agent's turn takes what is typed while it works (HarnessV3-ACP AC3-1)", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-acp-steer-"));
  const projDir = join(root, "project");
  /** The file a `~askslow` turn of agy's waits for before it announces its command. */
  const agyAskGate = join(root, "agy-ask-gate");
  const logs = { steers: join(root, "steers-calls.jsonl"), steerPrompts: join(root, "steers-prompts.jsonl"), codex: join(root, "codex-calls.jsonl"), cursor: join(root, "cursor-prompts.jsonl"), agy: join(root, "agy-calls.jsonl") };
  /** The file a `~steps` turn's first step waits for: until it is written, the step runs. */
  const stepGate = join(root, "step-gate");
  /**
   * An agent as the catalogue knows it, by its program's name (`cursor-agent`, `agy`): the fake beside a shim of npm's
   * kind on Windows, whose script Filament runs with its own Node; elsewhere a script.
   * @param {string} name
   */
  const programNamed = (name) => {
    const dir = join(root, name);
    mkdirSync(dir);
    if (process.platform === "win32") {
      copyFileSync(FAKE_ACP, join(dir, "fake-acp-agent.mjs"));
      copyFileSync(join(FIXTURES, "person-words.mjs"), join(dir, "person-words.mjs"));
      writeFileSync(join(dir, `${name}.cmd`), `@"%~dp0\\node.exe" "%dp0%\\fake-acp-agent.mjs" %*\r\n`);
      return join(dir, `${name}.cmd`);
    }
    writeFileSync(join(dir, name), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_ACP}" "$@"\n`);
    chmodSync(join(dir, name), 0o755);
    return join(dir, name);
  };
  /** The file a `slowstop` turn's cancel waits for: until it is written, the turn is stopping. */
  const stopGate = join(root, "stop-gate");
  /** A `heldsteer` turn's gates: the answer to its steering, and its cancel. */
  const held = { steer: join(root, "held-steer"), stop: join(root, "held-stop") };
  /** The file a `latecmds` session's commands wait for: until it is written, the agent has said none. */
  const commandsGate = join(root, "commands-gate");
  /** The file a `nocmds` session's first words wait for: it says no commands at all. */
  const answersGate = join(root, "answers-gate");
  /** Where a test says the agent's next call comes (FAKE_ACP_TICK_DIR, FAKE_CODEX_TICK_DIR). */
  const ticks = join(root, "ticks");
  before(async () => {
    mkdirSync(projDir);
    mkdirSync(ticks);
    writeFileSync(join(projDir, "notes.txt"), "hello\n");
    /** @param {Record<string, string>} env */
    const acp = (env) => ({ command: process.execPath, args: [FAKE_ACP], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_TICK_DIR: ticks, ...env }, cwdDefault: projDir, permissions: "allow-all", hints: false });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "steers", name: "steers", type: "acp", acp: acp({ FAKE_ACP_STEERING: "1", FAKE_ACP_CALLS: logs.steers, FAKE_ACP_LATE_MS: "1500", FAKE_ACP_LOG: logs.steerPrompts }) },
          { id: "slowstop", name: "slowstop", type: "acp", acp: acp({ FAKE_ACP_STEERING: "1", FAKE_ACP_CALLS: logs.steers, FAKE_ACP_CANCEL_GATE: stopGate }) },
          { id: "heldsteer", name: "heldsteer", type: "acp", acp: acp({ FAKE_ACP_STEERING: "1", FAKE_ACP_CALLS: logs.steers, FAKE_ACP_STEER_GATE: held.steer, FAKE_ACP_CANCEL_GATE: held.stop }) },
          { id: "latecmds", name: "latecmds", type: "acp", acp: acp({ FAKE_ACP_STEERING: "1", FAKE_ACP_CALLS: logs.steers, FAKE_ACP_COMMANDS_GATE: commandsGate }) },
          { id: "nocmds", name: "nocmds", type: "acp", acp: acp({ FAKE_ACP_STEERING: "1", FAKE_ACP_CALLS: logs.steers, FAKE_ACP_COMMANDS_GATE: answersGate, FAKE_ACP_NO_COMMANDS: "1" }) },
          { id: "plainacp", name: "plainacp", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP], env: {}, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "cursorcli", name: "Cursor", type: "acp", acp: { command: programNamed("cursor-agent"), args: [], env: { FAKE_ACP_STEP_GATE: stepGate, FAKE_ACP_LOG: logs.cursor, FAKE_ACP_SLOW_MS: "1500" }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "agycli", name: "Antigravity", type: "acp", acp: { command: programNamed("agy"), args: [], env: { FAKE_ACP_AGY: "1", FAKE_ACP_AGY_STEER: "1", FAKE_ACP_TICK_DIR: ticks, FAKE_ACP_CALLS: logs.agy, FAKE_ACP_AGY_ASK_GATE: agyAskGate }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
          { id: "codex", name: "Codex", type: "codex", acp: { command: process.execPath, args: [FAKE_CODEX], env: { FAKE_CODEX_CALLS: logs.codex, FAKE_CODEX_TICK_DIR: ticks }, cwdDefault: projDir, permissions: "allow-all" } },
        ];
        cfg.routes = ["steers", "slowstop", "heldsteer", "latecmds", "nocmds", "plainacp", "cursorcli", "agycli", "codex"].map((u) => ({ match: `${u}/*`, upstream: u, upstreamModel: "{1}", enabled: true }));
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });
  /** A harness session on a model. @param {string} model @param {any} [settings] */
  const session = async (model, settings) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain", ...(settings ? { settings } : {}) } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** A harness turn, as the page sends one. @param {string} id @param {string} content */
  const turn = (id, content) => shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
  /** @param {string} runId @returns {Promise<any[]>} */
  const runEvents = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events;
  /** How the run weighed its `/word` notes, in order: the note, as what, and the word. @param {any[]} evs */
  const weighedOf = (evs) => evs.filter((e) => e.type === "steer-weighed").map((e) => [e.ids[0], e.as, e.word ?? null]);
  /** @param {string} runId @param {Record<string, unknown>} body */
  const steer = (runId, body) => shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body });
  /** @param {string} runId */
  const runOf = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}`)).json()).run;
  /** A note sent as the page sends one; the mailbox's id for it. @param {string} runId @param {string} text */
  const note = async (runId, text) => {
    const r = await steer(runId, { kind: "note", text, from: "harness" });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).message.id);
  };
  /**
   * The agent's next call: what the developer typed waits in Filament for it (HarnessV4_Tasks C34), and goes then. Its
   * agent has made it once the file is gone.
   */
  const tick = async () => {
    writeFileSync(join(ticks, "tick"), "");
    await until(() => !existsSync(join(ticks, "tick")) || null, "the agent's next call");
  };
  /** The run's steering events, as [type, ids]. @param {any[]} evs */
  const steeringOf = (evs) => evs.filter((e) => e.type.startsWith("steer")).map((e) => [e.type, e.ids || [e.id]]);
  /** A note sent to interrupt the agent (FP-D8); the mailbox's id for it. @param {string} runId @param {string} text */
  const interrupting = async (runId, text) => {
    const r = await steer(runId, { kind: "note", text, from: "harness", interrupt: true });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).message.id);
  };
  /** The run's round `n` has begun: the agent is working on it. @param {string} runId @param {number} [n] */
  const working = (runId, n = 1) => until(async () => (await runEvents(runId)).some((e) => e.type === "round-start" && e.round === n), `round ${n} to begin`);
  /**
   * The agent has published its commands in the run's session, as it does a moment after the session opens: a
   * command sent from then on is known for one. @param {string} runId
   */
  const commandsKnown = (runId) =>
    until(async () => {
      const r = await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/agent-commands`)).json();
      return (r.commands || []).some((/** @type {any} */ c) => c.name === "review") || null;
    }, "the agent to publish its commands");
  /** @param {string} file @returns {any[]} */
  const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  /** The session's last turn as the archive keeps it. @param {string} id */
  const archived = async (id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?work=1`)).json()).turns.at(-1);
  /** A message's words, its text blocks joined. @param {any} m */
  const said = (m) => `${m.role}:${(Array.isArray(m.content) ? m.content : []).filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join("|")}`;
  /** A message's blocks in order: a text by its words, anything else by its type. @param {any} m */
  const blocksOf = (m) => `${m.role}:${(Array.isArray(m.content) ? m.content : []).map((/** @type {any} */ b) => (b.type === "text" ? b.text : `[${b.type}]`)).join("|")}`;
  /** A 1×1 PNG. */
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  /**
   * A note with pictures, as the page sends one; the mailbox's id for it.
   * @param {string} runId @param {string} text @param {number} [n]  how many pictures
   */
  const pictured = async (runId, text, n = 1) => {
    const images = Array.from({ length: n }, (_, i) => ({ name: `shot-${i + 1}.png`, mediaType: "image/png", data: PNG }));
    const r = await steer(runId, { kind: "note", text, from: "harness", images });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).message.id);
  };

  // (fails before: yes — each note went by `_session/steering`, which interrupts Claude at once: HarnessV3-FailurePoints
  // §7.2)
  test("Claude: each note is queued at it while it works and goes in at its next step, in the order sent, read once Claude took it, archived where it did; nothing interrupts it", async () => {
    const id = await session("steers/haiku");
    const res = await turn(id, "~steerable");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await working(runId);
    const meta = (await runOf(runId)).meta;
    assert.deepEqual([meta.steer, meta.interrupts, meta.holds], ["queued", true, true], "the composer reads it off the run");
    const first = await note(runId, "also check the tests ~again");
    await tick();
    await until(async () => (await runEvents(runId)).some((e) => e.type === "steer-read" && e.ids.includes(first)), "Claude to take the first");
    await working(runId, 2); // its answer to the first
    const second = await note(runId, "and the docs");
    await tick();
    const frames = parseSse(await body);
    assert.equal(wordsOf(frames), "working… heard:also check the tests ~again heard:and the docs ");
    const evs = await runEvents(runId);
    assert.deepEqual(steeringOf(evs), [["steer", [first]], ["steer-sent", [first]], ["steer-read", [first]], ["steer", [second]], ["steer-sent", [second]], ["steer-read", [second]]]);
    assert.equal(evs.at(-1).status, "done");
    assert.deepEqual(
      lines(logs.steers).filter((c) => c.method === "queued prompt" || c.method === "_session/steering").map((c) => [c.method, c.words]),
      [["queued prompt", "also check the tests ~again"], ["queued prompt", "and the docs"]],
      "the words as typed, each a prompt queued at Claude",
    );
    // Claude's own conversation, the person's words where it took them.
    const t = await archived(id);
    assert.deepEqual(t.work.map(said), ["assistant:working… ", "user:also check the tests ~again", "assistant:heard:also check the tests ~again ", "user:and the docs"]);
    assert.deepEqual(t.final.content, [{ type: "text", text: "heard:and the docs " }]);
    const rec = await until(async () => {
      const r = await shim.record(runId);
      return r?.acp?.run ? r : null;
    }, "the turn's record");
    assert.equal(rec.changes.filter((/** @type {string} */ c) => c === "acp: a message sent while steers worked was queued and went in at its next step").length, 2, rec.changes.join("\n"));
  });

  // (fails before: yes — the run took words only while it ran: a note with a picture was refused, so the page held the
  // message for the turn's end, HarnessV4_Tasks C22)
  test("Claude: pictures sent while it works go in with the words, in the one prompt queued at it, and pictures with no words too; the archive keeps them", async () => {
    const id = await session("steers/haiku");
    const res = await turn(id, "~steerable");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await working(runId);
    assert.equal((await runOf(runId)).meta.steerImages, true, "the composer sends a message with pictures into the turn");
    const first = await pictured(runId, "what is wrong here ~again");
    await tick();
    await until(async () => (await runEvents(runId)).some((e) => e.type === "steer-read" && e.ids.includes(first)), "Claude to take the first");
    await working(runId, 2); // its answer to the first
    const second = await pictured(runId, "", 2);
    await tick();
    assert.equal(wordsOf(parseSse(await body)), "working… heard:what is wrong here ~again [1 picture] heard: [2 pictures] ");
    assert.deepEqual(
      lines(logs.steers).filter((c) => c.method === "queued prompt" && c.images).map((c) => [c.words, c.images]),
      [["what is wrong here ~again", 1], ["", 2]],
      "each a prompt queued at Claude, its pictures in it",
    );
    assert.deepEqual((await runEvents(runId)).filter((e) => e.type === "steer-read").flatMap((e) => e.ids), [first, second]);
    // The archive keeps each picture where Claude took it, before its words, as the page's own message holds them.
    const t = await archived(id);
    assert.deepEqual(t.work.map(blocksOf), ["assistant:working… ", "user:[image]|what is wrong here ~again", "assistant:heard:what is wrong here ~again [1 picture] ", "user:[image]|[image]"]);
    // Its words are the session's: the next message goes alone.
    assert.deepEqual(await caughtUp(id, "and now the logs"), []);
  });

  /**
   * The session's next turn, once it ended: the record's notes of turns handled elsewhere that it handed the agent so
   * it catches up — none where the session has had all of the chat.
   * @param {string} id @param {string} content @returns {Promise<string[]>}
   */
  const caughtUp = async (id, content) => {
    const res = await turn(id, content);
    const runId = String(res.headers.get("x-filament-request-id"));
    await res.text();
    const rec = await until(async () => {
      const r = await shim.record(runId);
      return r?.acp?.run ? r : null;
    }, "the next turn's record");
    return rec.changes.filter((/** @type {string} */ c) => c.includes("handled elsewhere"));
  };

  // (fails before: yes — the note went to Claude again at its next turn, as a turn handled elsewhere, with "another
  // assistant")
  test("Claude: a note it took into its running turn is its own: its next turn hands it no catch-up of that note", async () => {
    const id = await session("steers/haiku");
    const res = await turn(id, "~steerable");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await working(runId);
    const first = await note(runId, "also check the tests");
    await tick();
    await until(async () => (await runEvents(runId)).some((e) => e.type === "steer-read" && e.ids.includes(first)), "Claude to take it");
    await body;
    assert.deepEqual(await caughtUp(id, "and now the docs"), []);
    const sent = lines(logs.steerPrompts).filter((p) => String(p.text).includes("and now the docs"));
    assert.deepEqual(sent.map((p) => p.text), ["and now the docs"], "the message alone");
  });

  // (fails before: yes — the words Claude took counted as turns its session never saw: the next message handed its
  // own turn back to it as "another assistant's", from the first of them on)
  test("Claude: the words it took are its session's: the next message goes alone, its own turn never handed back as missed", async () => {
    // Whole: the words ride Filament's copy as messages of their own, which the session's count must not read as
    // turns it missed. Under Words, the default, they are lines of the turn (the test above).
    const id = await session("steers/haiku", { context: { carry: "plain" } });
    const res = await turn(id, "~steerable");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await working(runId);
    const first = await note(runId, "also check the tests ~again");
    await tick();
    await until(async () => (await runEvents(runId)).some((e) => e.type === "steer-read" && e.ids.includes(first)), "Claude to take the first");
    await working(runId, 2);
    await note(runId, "and the docs");
    await tick();
    await body;
    const next = await turn(id, "and now the changelog");
    const nextId = String(next.headers.get("x-filament-request-id"));
    await next.text();
    const sent = lines(logs.steerPrompts).at(-1);
    assert.equal(sent.text, "and now the changelog", sent.prompt);
    assert.ok(!sent.prompt.includes("Meanwhile"), sent.prompt);
    const rec = await until(async () => {
      const r = await shim.record(nextId);
      return r?.acp?.run ? r : null;
    }, "the next turn's record");
    assert.ok(rec.changes.includes("acp: 2 message(s) sent while the agent's last turn ran are in that turn: the session heard them there, so they are not handed back"), rec.changes.join("\n"));
  });

  test("Claude: a note sent to interrupt it that its turn hands back, having just ended, goes as the next message: the run's end says it unread", async () => {
    const id = await session("steers/haiku");
    const res = await turn(id, "~steerlate");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await working(runId);
    const late = await interrupting(runId, "one more thing");
    await body;
    const evs = await runEvents(runId);
    assert.deepEqual(steeringOf(evs), [["steer", [late]], ["steer-sent", [late]], ["steer-unread", [late]]], "an interrupt goes at once: nothing waits for a call");
    assert.deepEqual([evs.at(-1).status, evs.at(-1).summary.unreadSteer], ["done", 1]);
    assert.deepEqual(lines(logs.steers).filter((c) => c.words === "one more thing").map((c) => c.idle), ["promptRequired"]);
    const t = await archived(id);
    assert.ok(!JSON.stringify(t).includes("one more thing"), "never Claude's: the archive keeps no word of it");
    const rec = await until(async () => {
      const r = await shim.record(runId);
      return r?.acp?.run ? r : null;
    }, "the turn's record");
    assert.ok(rec.changes.includes("acp: steers handed back a message sent while it ran; it goes as the next message"), rec.changes.join("\n"));
  });

  // (fails before: yes — the command went into the running turn as words: Claude's adapter runs it there, and a
  // `/compact` taken so ended the turn without the answer its prompt asked for)
  test("Claude: its own command sent while it works is never sent into the turn: it waits for the turn's end and goes as the next message", async () => {
    const id = await session("steers/haiku");
    const res = await turn(id, "~steerlate");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await working(runId);
    await commandsKnown(runId);
    const held = await note(runId, "/review the diff");
    await body;
    const evs = await runEvents(runId);
    // (fails before: yes — HarnessV4_Tasks U1: the run said nothing of the held command, and its bubble on the page
    // read "Queued at Claude — goes in at its next step" until the turn ended)
    assert.deepEqual(evs.filter((e) => e.type.startsWith("steer")).map((e) => [e.type, e.ids || [e.id]]), [["steer", [held]], ["steer-weighed", [held]], ["steer-unread", [held]]]);
    assert.deepEqual(weighedOf(evs), [[held, "command", "/review"]]);
    assert.deepEqual([evs.at(-1).status, evs.at(-1).summary.unreadSteer], ["done", 1]);
    assert.deepEqual(lines(logs.steers).filter((c) => c.words === "/review the diff"), [], "never handed to the agent's turn");
    const rec = await until(async () => {
      const r = await shim.record(runId);
      return r?.acp?.run ? r : null;
    }, "the turn's record");
    assert.ok(rec.changes.includes("acp: /review is steers's own command: sent while it worked, it waits for the turn's end and goes as the next message, as typed"), rec.changes.join("\n"));
  });

  // (fails before: yes — before the agent said its commands, `/review` went into the running turn as words:
  // HarnessV3-FailurePoints, the early-command race)
  test("Claude: words that may be its own command, sent before it said its commands, wait for them: then the command waits for the turn's end, and words go in", async () => {
    const id = await session("latecmds/haiku");
    const res = await turn(id, "~steerable");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    // The agent says nothing before its commands: its turn has no round yet.
    const held = await note(runId, "/review the diff");
    const words = await note(runId, "/tidy the imports");
    const waiting = await until(async () => {
      const r = await shim.record(runId);
      return (r?.priorChanges || []).filter((/** @type {string} */ c) => / may be latecmds's own command, and latecmds has not said its commands yet: the message waits until it says them, or answers without them$/.test(c)).length === 1 ? r : null;
    }, "the first to wait for the agent's commands");
    assert.ok(waiting.priorChanges.includes("acp: /review may be latecmds's own command, and latecmds has not said its commands yet: the message waits until it says them, or answers without them"), waiting.priorChanges.join("\n"));
    assert.deepEqual(lines(logs.steers).filter((c) => /the diff|the imports/.test(String(c.words))), [], "neither went in");
    // Its prompt's first call, once it says its commands, is the next call the words waited for.
    writeFileSync(commandsGate, "");
    assert.equal(wordsOf(parseSse(await body)), "working… heard:/tidy the imports ", "words shaped like a command it has not go in");
    const evs = await runEvents(runId);
    assert.deepEqual(
      evs.filter((e) => e.type.startsWith("steer") && e.type !== "steer-weighed").map((e) => [e.type, e.ids || [e.id]]),
      [["steer", [held]], ["steer", [words]], ["steer-sent", [words]], ["steer-read", [words]], ["steer-unread", [held]]],
    );
    // (fails before: yes — HarnessV4_Tasks U1: the run said neither wait, and the bubble read as any queued note)
    assert.deepEqual(weighedOf(evs), [[held, "unsure", "/review"], [held, "command", "/review"]], "it waits for the agent's commands, then as one of them; the words behind it were never held");
    assert.deepEqual(lines(logs.steers).filter((c) => c.words === "/review the diff"), [], "never handed to the agent's turn");
    const rec = await until(async () => {
      const r = await shim.record(runId);
      return r?.acp?.run ? r : null;
    }, "the turn's record");
    assert.equal(rec.changes.filter((/** @type {string} */ c) => c === "acp: /review is latecmds's own command: sent while it worked, it waits for the turn's end and goes as the next message, as typed").length, 1, rec.changes.join("\n"));
    assert.equal(rec.changes.filter((/** @type {string} */ c) => c.startsWith("acp: /review may be")).length, 1, "said once");
  });

  // (fails before: yes — an agent that never says its commands held each `/word` note, and the notes behind it, to its
  // prompt's end: HarnessV3-FailurePoints, the early-command race)
  test("an agent that answers before it said any commands has none to say: words shaped like a command, and the words after them, go in then", async () => {
    const id = await session("nocmds/haiku");
    const res = await turn(id, "~steerable");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    const slash = await note(runId, "/tmp is full ~again");
    const after = await note(runId, "clear it");
    await until(async () => ((await shim.record(runId))?.priorChanges || []).some((/** @type {string} */ c) => c === "acp: /tmp may be nocmds's own command, and nocmds has not said its commands yet: the message waits until it says them, or answers without them") || null, "the note to wait for the agent's word");
    assert.deepEqual(lines(logs.steers).filter((c) => /tmp is full|clear it/.test(String(c.words))), [], "neither went in");
    // Its prompt's first call, once it answers, is the next call the words waited for.
    writeFileSync(answersGate, "");
    assert.equal(wordsOf(parseSse(await body)), "working… heard:/tmp is full ~again heard:clear it ", "it answered without commands: both go in, in order");
    const evs = await runEvents(runId);
    assert.deepEqual(evs.filter((e) => e.type === "steer-read").map((e) => e.ids || [e.id]), [[slash], [after]]);
    // (fails before: yes — HarnessV4_Tasks U1: nothing on the run said it waited, nor that the wait was over)
    assert.deepEqual(weighedOf(evs), [[slash, "unsure", "/tmp"], [slash, "words", null]], "it waited for the agent's commands, and is none of them");
  });

  // (fails before: yes — the command stood first in the queue and ended the deliveries there: the words sent after it
  // never reached the running turn, which went on waiting for them)
  test("Claude: words sent after its own command go into its running turn; the command waits for the turn's end, said once", async () => {
    const id = await session("steers/haiku");
    const res = await turn(id, "~steerable");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await working(runId);
    await commandsKnown(runId);
    const held = await note(runId, "/review the diff");
    const words = await note(runId, "and the docs");
    await tick();
    await until(async () => (await runEvents(runId)).some((e) => e.type === "steer-read" && e.ids.includes(words)), "Claude to take the words");
    assert.equal(wordsOf(parseSse(await body)), "working… heard:and the docs ");
    const evs = await runEvents(runId);
    assert.deepEqual(
      evs.filter((e) => e.type.startsWith("steer") && e.type !== "steer-weighed").map((e) => [e.type, e.ids || [e.id]]),
      [["steer", [held]], ["steer", [words]], ["steer-sent", [words]], ["steer-read", [words]], ["steer-unread", [held]]],
    );
    assert.deepEqual(weighedOf(evs), [[held, "command", "/review"]], "said once, and nothing of the words after it");
    assert.deepEqual([evs.at(-1).status, evs.at(-1).summary.unreadSteer], ["done", 1]);
    assert.deepEqual(lines(logs.steers).filter((c) => c.words === "/review the diff"), [], "never handed to the agent's turn");
    const rec = await until(async () => {
      const r = await shim.record(runId);
      return r?.acp?.run ? r : null;
    }, "the turn's record");
    assert.equal(rec.changes.filter((/** @type {string} */ c) => c.startsWith("acp: /review is steers's own command")).length, 1, rec.changes.join("\n"));
  });

  test("a stop ends the deliveries: a note sent with it is never handed over, and ends unread", async () => {
    const id = await session("slowstop/haiku");
    const res = await turn(id, "~steerable");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await working(runId);
    assert.equal((await steer(runId, { kind: "stop", text: "", from: "harness" })).status, 200);
    // The agent is still stopping: its cancel waits for the gate.
    const after = await note(runId, "never mind");
    writeFileSync(stopGate, "");
    await body;
    const evs = await runEvents(runId);
    assert.deepEqual(evs.at(-1).status, "stopped");
    assert.deepEqual(evs.filter((e) => e.type === "steer-unread").flatMap((e) => e.ids), [after]);
    assert.ok(!lines(logs.steers).some((c) => c.words === "never mind"), "never sent to Claude");
  });

  // (fails before: no — a guard the mutation pass asked for: no note waited behind one the agent was still taking
  // when a stop came)
  test("a stop ends the deliveries though the agent was still taking a note sent to interrupt it: the one queued behind it is never handed over", async () => {
    const id = await session("heldsteer/haiku");
    const res = await turn(id, "~steerable");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await working(runId);
    const first = await interrupting(runId, "look at b too ~again");
    await until(async () => lines(logs.steers).some((c) => c.words === "look at b too ~again"), "the agent to have the first");
    const second = await interrupting(runId, "and c");
    assert.equal((await steer(runId, { kind: "stop", text: "", from: "harness" })).status, 200);
    // The agent answers now: it took the first. The turn is still stopping.
    writeFileSync(held.steer, "");
    await until(async () => (await runEvents(runId)).some((e) => e.type === "steer-read" && e.ids.includes(first)), "the first to be read");
    writeFileSync(held.stop, "");
    await body;
    const evs = await runEvents(runId);
    assert.equal(evs.at(-1).status, "stopped");
    assert.deepEqual(evs.filter((e) => e.type === "steer-unread").flatMap((e) => e.ids), [second]);
    assert.ok(!lines(logs.steers).some((c) => c.words === "and c"), "never sent to Claude");
  });

  /** The run's tool cards begun, by their calls' ids. @param {string} runId */
  const begun = async (runId) => (await runEvents(runId)).filter((e) => e.type === "tool-start").map((e) => e.id);
  /** The turn's record, once its run is on it. @param {string} runId */
  const recordOf = (runId) =>
    until(async () => {
      const r = await shim.record(runId);
      return r?.acp?.run ? r : null;
    }, "the turn's record");

  test("Cursor: a note goes in at its next step — its turn cancelled once its call is done, then carried on with the words, keeping what it did", async () => {
    rmSync(stepGate, { force: true });
    const id = await session("cursorcli/auto");
    const res = await turn(id, "~steps");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await begun(runId)).includes("c_step1"), "its first step to run");
    const meta = (await runOf(runId)).meta;
    assert.deepEqual([meta.steer, meta.holds], ["next", undefined], "the composer reads it off the run: the words wait for its next step in Filament, as they are");
    const sent = await note(runId, "use the staging database");
    writeFileSync(stepGate, "");
    assert.equal(wordsOf(parseSse(await body)), "stepping… kept:step 1 heard:use the staging database");
    const evs = await runEvents(runId);
    assert.deepEqual(steeringOf(evs), [["steer", [sent]], ["steer-sent", [sent]], ["steer-read", [sent]]]);
    assert.deepEqual(await begun(runId), ["c_step1"], "its second step never ran");
    assert.equal(evs.at(-1).status, "done");
    assert.equal(
      lines(logs.cursor).at(-1).text,
      "The person sent this while you were working. Your turn was paused after your last step finished — no step was cut short — so it could reach you. Take it into account, then carry on with your task from where you left off, without redoing finished steps.\n\n---\nuse the staging database",
      "the words as typed, after the line that says why they come now",
    );
    // The archive: the words after the step's result, and the agent's answer to them.
    const t = await archived(id);
    assert.deepEqual(t.work.map(said), ["assistant:stepping… ", "user:use the staging database"]);
    assert.deepEqual(t.final.content, [{ type: "text", text: "kept:step 1 heard:use the staging database" }]);
    const rec = await recordOf(runId);
    assert.ok(rec.changes.includes("acp: a message sent while Cursor worked went in at its next step: its turn was cancelled after a call and went on with it"), rec.changes.join("\n"));
    assert.deepEqual([rec.status, rec.tokens.input, rec.tokens.output], ["ok", 20, 10], "both prompts' tokens");
  });

  // (fails before: yes — FabeleHelper's of 11-10: on a main chat every note was said as the person's, Filament's own
  // too — a Space sync, a team's result beside it — so Cursor read "The person sent this" above Filament's words)
  test("Cursor: Filament's own words into a main chat's turn go in at its next step as Filament's", async () => {
    rmSync(stepGate, { force: true });
    const id = await session("cursorcli/auto");
    const res = await turn(id, "~steps");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await begun(runId)).includes("c_step1"), "its first step to run");
    const r = await steer(runId, { kind: "note", text: "[Filament: the Space synced]", from: "filament" });
    assert.equal(r.status, 200, await r.clone().text());
    writeFileSync(stepGate, "");
    await body;
    assert.match(lines(logs.cursor).at(-1).text, /^Filament sent this while you were working\. Your turn was paused[^]*\n---\n\[Filament: the Space synced\]$/);
  });

  // (fails before: yes — the review of b1f4c556b: the prompts' answers were summed only once the last was in, so the
  // first prompt's 10 in and 5 out went with the second's failure, and the record kept 0)
  test("Cursor: a turn carried on at its next step whose second prompt fails keeps what its first prompt spent", async () => {
    rmSync(stepGate, { force: true });
    const id = await session("cursorcli/auto");
    const res = await turn(id, "~steps");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await begun(runId)).includes("c_step1"), "its first step to run");
    await note(runId, "~failkept use the staging database");
    writeFileSync(stepGate, "");
    await body;
    const rec = await recordOf(runId);
    assert.deepEqual([rec.status, rec.tokens.input, rec.tokens.output, rec.estimatedTokens], ["error", 10, 5, false], "the first prompt's spend");
  });

  // (fails before: yes — the note went to Cursor again at its next turn, as a turn handled elsewhere)
  test("Cursor: a note it took at its next step is its own: its next turn hands it no catch-up of that note", async () => {
    rmSync(stepGate, { force: true });
    const id = await session("cursorcli/auto");
    const res = await turn(id, "~steps");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await begun(runId)).includes("c_step1"), "its first step to run");
    const sent = await note(runId, "use the staging database");
    writeFileSync(stepGate, "");
    await body;
    assert.ok((await runEvents(runId)).some((e) => e.type === "steer-read" && e.ids.includes(sent)), "Cursor took it");
    assert.deepEqual(await caughtUp(id, "and now the docs"), []);
  });

  // (fails before: no — a guard the mutation pass asked for: a command sent while Cursor worked went in at its next
  // step as words, and passed every test)
  test("Cursor: its own command sent while it works never goes in at its next step: its turn goes on, and the command waits for its end", async () => {
    rmSync(stepGate, { force: true });
    const id = await session("cursorcli/auto");
    const res = await turn(id, "~steps");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await begun(runId)).includes("c_step1"), "its first step to run");
    await commandsKnown(runId);
    const held = await note(runId, "/review the diff");
    writeFileSync(stepGate, "");
    await body;
    const evs = await runEvents(runId);
    assert.deepEqual(evs.filter((e) => e.type.startsWith("steer")).map((e) => [e.type, e.ids || [e.id]]), [["steer", [held]], ["steer-weighed", [held]], ["steer-unread", [held]]]);
    assert.deepEqual(weighedOf(evs), [[held, "command", "/review"]]);
    assert.deepEqual(await begun(runId), ["c_step1", "c_step2"], "never cancelled for it");
    assert.ok(!lines(logs.cursor).some((l) => String(l.text).includes("/review the diff")), "never sent to the agent's turn");
    const rec = await recordOf(runId);
    assert.ok(rec.changes.includes("acp: /review is Cursor's own command: sent while it worked, it waits for the turn's end and goes as the next message, as typed"), rec.changes.join("\n"));
  });

  test("Cursor: a note its turn ended before its next step goes as the next message: the run's end says it unread", async () => {
    const id = await session("cursorcli/auto");
    const res = await turn(id, "~slowstart");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await runEvents(runId)).some((e) => e.type === "run-start"), "the run");
    const late = await note(runId, "one more thing");
    await body;
    const evs = await runEvents(runId);
    assert.deepEqual(steeringOf(evs), [["steer", [late]], ["steer-sent", [late]], ["steer-unread", [late]]]);
    assert.equal(evs.at(-1).status, "done");
    assert.ok(!lines(logs.cursor).some((l) => String(l.text).includes("one more thing")), "never sent to the agent");
    const rec = await recordOf(runId);
    assert.ok(rec.changes.includes("acp: Cursor's turn ended before its next step; a message sent while it ran goes as the next message"), rec.changes.join("\n"));
  });

  test("Cursor: a stop while a note waits for its next step ends the turn there; the note is never sent, and ends unread", async () => {
    rmSync(stepGate, { force: true });
    const id = await session("cursorcli/auto");
    const res = await turn(id, "~steps");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await begun(runId)).includes("c_step1"), "its first step to run");
    const waiting = await note(runId, "never mind");
    assert.equal((await steer(runId, { kind: "stop", text: "", from: "harness" })).status, 200);
    await body;
    const evs = await runEvents(runId);
    assert.equal(evs.at(-1).status, "stopped");
    assert.deepEqual(evs.filter((e) => e.type === "steer-unread").flatMap((e) => e.ids), [waiting]);
    assert.ok(!lines(logs.cursor).some((l) => String(l.text).includes("never mind")), "never sent to the agent");
  });

  test("an agent that takes no words mid-turn: its run says so, and a note to it is refused in words; a veto is the loop's", async () => {
    const id = await session("plainacp/fake");
    const res = await turn(id, "hang on");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await runEvents(runId)).some((e) => e.type === "run-start"), "the run");
    assert.equal((await runOf(runId)).meta.steer, "queue");
    const refused = await steer(runId, { kind: "note", text: "also this", from: "harness" });
    assert.deepEqual([refused.status, (await refused.json()).error], [400, "this agent takes no words while its turn runs; send them when it ends"]);
    assert.equal((await steer(runId, { kind: "stop", text: "", from: "harness" })).status, 200);
    await body;
    const steerId = await session("steers/haiku");
    const live = await turn(steerId, "~steerable");
    const liveRun = String(live.headers.get("x-filament-request-id"));
    const liveBody = live.text();
    await working(liveRun);
    const veto = await steer(liveRun, { kind: "veto", text: "not that", from: "harness" });
    assert.deepEqual([veto.status, (await veto.json()).error], [400, "a coding agent's turn takes a note or a stop; this was a veto"]);
    await note(liveRun, "that's all");
    await tick();
    await liveBody;
  });

  // (fails before: yes — read live on agy 1.5.14: a prompt sent while its turn runs takes the turn over, but Filament
  // took agy for an agent that takes no words mid-turn, so what was typed while it worked waited for the turn's end)
  test("Antigravity: each note goes as a prompt of its own, which takes its running turn over; the turn ends with the last one's answer, every prompt's tokens counted", async () => {
    const id = await session("agycli/gemini-3.8-flash-high");
    const res = await turn(id, "~agysteer");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await working(runId);
    assert.equal((await runOf(runId)).meta.steer, "live", "the composer reads it off the run");
    const first = await note(runId, "use the notes file ~again");
    await tick();
    await until(async () => (await runEvents(runId)).some((e) => e.type === "steer-read" && e.ids.includes(first)), "agy to take the first");
    await until(() => lines(logs.agy).some((c) => c.method === "agy prompt" && c.words === "use the notes file ~again") || null, "the first prompt");
    const second = await note(runId, "then stop");
    await tick();
    assert.equal(wordsOf(parseSse(await body)), "working… heard:use the notes file ~again heard:then stop ");
    const evs = await runEvents(runId);
    assert.deepEqual(evs.filter((e) => e.type === "steer-read").flatMap((e) => e.ids), [first, second]);
    assert.equal(evs.at(-1).status, "done", "the turn waited for the last prompt's answer");
    assert.deepEqual(lines(logs.agy).filter((c) => c.method.includes("prompt")).map((c) => [c.method, c.words]), [["agy prompt", "use the notes file ~again"], ["agy prompt", "then stop"]], "the words as typed, each a prompt");
    // The archive keeps the person's words where agy took them.
    const t = await archived(id);
    assert.deepEqual(t.work.map(said).filter((/** @type {string} */ w) => w.startsWith("user:") && w !== "user:"), ["user:use the notes file ~again", "user:then stop"]);
    const rec = await recordOf(runId);
    assert.ok(rec.changes.includes("acp: a message sent while Antigravity worked went into its running turn"), rec.changes.join("\n"));
    assert.deepEqual([rec.status, rec.tokens.input, rec.tokens.output], ["ok", 400, 40], "the two prompts it answered at once and the last");
  });

  // (fails before: yes — agy refuses a prompt sent while its question waits, and its session stalls)
  test("Antigravity: a note typed while it waits on its question goes once the question is answered, never before", async () => {
    const id = await session("agycli/gemini-3.8-flash-high", { loop: { permissions: "ask" } });
    const res = await turn(id, "~agysteer ~ask");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(async () => (await runEvents(runId)).find((e) => e.type === "ask") || null, "its question");
    const sent = await note(runId, "and keep the build");
    await tick();
    // The note is on its way, and waits for the question's answer.
    await until(async () => (await runEvents(runId)).some((e) => e.type === "steer-sent" && e.ids.includes(sent)) || null, "the note handed over");
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(lines(logs.agy).filter((c) => c.method === "prompt while asking" || (c.method === "agy prompt" && c.words === "and keep the build")), [], "nothing sent while it asks");
    const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/answer`, { method: "POST", body: { ask: "q1", outcome: "answered", answers: { permission: { chosen: ["allow"] } } } });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(wordsOf(parseSse(await body)), "working… heard:and keep the build ");
    const order = lines(logs.agy).filter((c) => ["agy answered", "agy prompt", "prompt while asking"].includes(c.method)).slice(-2).map((c) => [c.method, c.optionId ?? c.words]);
    assert.deepEqual(order, [["agy answered", "allow"], ["agy prompt", "and keep the build"]]);
    assert.equal((await runEvents(runId)).at(-1).status, "done");
  });

  // (fails before: yes — the review of the change: words that go as a call starts could reach agy after it chose to ask
  // and before its question came; refused, they failed the turn, and were said taken)
  test("Antigravity: words it refuses, its question having come first, go again once the question is answered; the turn ends well", async () => {
    rmSync(agyAskGate, { force: true });
    const id = await session("agycli/gemini-3.8-flash-high", { loop: { permissions: "ask" } });
    const res = await turn(id, "~agysteer ~askslow");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await working(runId);
    const sent = await note(runId, "and skip the docs");
    // The words wait for its next call: the command it announces, its question a moment later.
    writeFileSync(agyAskGate, "");
    await until(() => lines(logs.agy).some((c) => c.method === "prompt while asking" && c.words === "and skip the docs") || null, "agy to refuse the words");
    await until(async () => (await runEvents(runId)).find((e) => e.type === "ask") || null, "its question");
    const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/answer`, { method: "POST", body: { ask: "q1", outcome: "answered", answers: { permission: { chosen: ["allow"] } } } });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(wordsOf(parseSse(await body)), "working… heard:and skip the docs ");
    const mine = lines(logs.agy).filter((c) => (c.method.includes("prompt") && c.words === "and skip the docs") || c.method === "agy answered").slice(-3);
    assert.deepEqual(mine.map((c) => [c.method, c.optionId ?? c.words]), [["prompt while asking", "and skip the docs"], ["agy answered", "allow"], ["agy prompt", "and skip the docs"]]);
    const evs = await runEvents(runId);
    assert.ok(evs.some((e) => e.type === "steer-read" && e.ids.includes(sent)), "read once agy took them");
    assert.equal(evs.at(-1).status, "done");
    assert.equal((await recordOf(runId)).status, "ok");
  });

  test("Codex: each note goes into its running turn, naming it (turn/steer), read once Codex took it, archived where it did", async () => {
    const id = await session("codex/gpt-6-astra");
    const res = await turn(id, "~steer");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await working(runId);
    const meta = (await runOf(runId)).meta;
    assert.deepEqual([meta.steer, meta.holds], ["live", true]);
    const first = await note(runId, "use the notes file ~again");
    await tick();
    await until(async () => (await runEvents(runId)).some((e) => e.type === "steer-read" && e.ids.includes(first)), "Codex to take the first");
    await working(runId, 2); // its answer to the first
    const second = await note(runId, "then stop");
    await tick();
    assert.equal(wordsOf(parseSse(await body)), "Working on it…heard:use the notes file ~againheard:then stop");
    const evs = await runEvents(runId);
    assert.deepEqual(evs.filter((e) => e.type === "steer-read").flatMap((e) => e.ids), [first, second]);
    const steered = lines(logs.codex).filter((c) => c.method === "turn/steer");
    const started = lines(logs.codex).filter((c) => c.method === "turn/start").at(-1);
    assert.equal(steered.length, 2);
    for (const s of steered) assert.deepEqual([s.params.threadId, s.params.input], [started.params.threadId, [{ type: "text", text: s.params.input[0].text, text_elements: [] }]]);
    assert.ok(steered.every((s) => /^turn_/.test(s.params.expectedTurnId)) && steered[0].params.expectedTurnId === steered[1].params.expectedTurnId, "the running turn, named");
    // The archive keeps them after the round Codex took them in.
    const t = await archived(id);
    assert.deepEqual(t.work.map(said), ["assistant:Working on it…", "user:use the notes file ~again", "assistant:heard:use the notes file ~again", "user:then stop"]);
    assert.deepEqual(t.final.content, [{ type: "text", text: "heard:then stop" }]);
  });

  // (fails before: yes — the run took words only while it ran: a note with a picture was refused, HarnessV4_Tasks C22)
  test("Codex: pictures sent while it works go into its running turn with the words (turn/steer), and the archive keeps them", async () => {
    const id = await session("codex/gpt-6-astra");
    const res = await turn(id, "~steer");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await working(runId);
    assert.equal((await runOf(runId)).meta.steerImages, true);
    const sent = await pictured(runId, "look at this one");
    await tick();
    assert.equal(wordsOf(parseSse(await body)), "Working on it…heard:look at this one [1 picture]");
    assert.ok((await runEvents(runId)).some((e) => e.type === "steer-read" && e.ids.includes(sent)), "Codex took it");
    const steered = lines(logs.codex).filter((c) => c.method === "turn/steer").at(-1);
    assert.deepEqual(steered.params.input, [{ type: "text", text: "look at this one", text_elements: [] }, { type: "image", url: `data:image/png;base64,${PNG}` }]);
    // After the results of the round they came in (its call, the tick), the picture before the words.
    const t = await archived(id);
    assert.deepEqual(t.work.map(blocksOf), ["assistant:Working on it…|[tool_use]", "user:[tool_result]|[image]|look at this one"]);
  });

  // (fails before: yes — the note went to Codex again at its next turn, as a turn handled elsewhere)
  test("Codex: a note it took into its running turn is its own: its next turn hands it no catch-up of that note", async () => {
    const id = await session("codex/gpt-6-astra");
    const res = await turn(id, "~steer");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await working(runId);
    const sent = await note(runId, "then stop");
    await tick();
    await body;
    assert.ok((await runEvents(runId)).some((e) => e.type === "steer-read" && e.ids.includes(sent)), "Codex took it");
    assert.deepEqual(await caughtUp(id, "and now the docs"), []);
  });

  test("Codex: a turn it keeps to itself (a review) hands the note back; it stays for the next message, unread at the end", async () => {
    const id = await session("codex/gpt-6-astra");
    const res = await turn(id, "~review");
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await working(runId);
    const kept = await note(runId, "check the docs too");
    await tick();
    await until(() => lines(logs.codex).some((c) => c.method === "turn/steer" && c.params.input[0].text === "check the docs too"), "Codex to be asked");
    assert.equal((await steer(runId, { kind: "stop", text: "", from: "harness" })).status, 200);
    await body;
    const evs = await runEvents(runId);
    assert.deepEqual(evs.filter((e) => e.type.startsWith("steer") && e.kinds?.[0] !== "stop" && e.kind !== "stop").map((e) => [e.type, e.ids || [e.id]]), [["steer", [kept]], ["steer-sent", [kept]], ["steer-unread", [kept]]]);
    assert.equal(evs.at(-1).status, "stopped");
    const rec = await until(async () => {
      const r = await shim.record(runId);
      return r?.acp?.run ? r : null;
    }, "the turn's record");
    assert.ok(rec.changes.includes("acp: Codex handed back a message sent while it ran; it goes as the next message"), rec.changes.join("\n"));
  });
});

// The page's half (no DOM here): the pins it rests on, and the bubble's words.
describe("the next step on its own (adapters/agents/acp/next-step.js, HarnessV3-ACP AC-D6)", () => {
  /** A turn's next step, watched: the cancels it sent, and the calls it sees running. */
  const watched = () => {
    const at = { running: 0, cancels: 0, seen: 0 };
    const next = createNextStep({ cancel: () => at.cancels++, running: () => at.running > 0 });
    const sink = next.watch(() => at.seen++);
    return { at, next, sink };
  };

  test("words wait for a call to end with none still running; the turn is cancelled there once, and goes on with them", async () => {
    const { at, next, sink } = watched();
    const took = next.send("also the docs");
    sink({ type: "text", text: "thinking" });
    sink({ type: "tool", status: "in_progress" });
    assert.equal(at.cancels, 0, "never mid-call, nor on words");
    at.running = 1;
    sink({ type: "tool", status: "completed" });
    assert.equal(at.cancels, 0, "another call still runs");
    at.running = 0;
    sink({ type: "tool", status: "failed" });
    sink({ type: "tool", status: "completed" });
    assert.equal(at.cancels, 1, "the step, once");
    assert.deepEqual(next.take(), [{ text: "also the docs", by: "person" }]);
    assert.equal(await took, true);
    assert.equal(next.take(), null, "the words go once");
    assert.equal(at.seen, 5, "every event still reaches the turn");
  });

  test("a turn cancelled for no words, or over before its step: nothing goes in, and the words go as the next message", async () => {
    const { at, next, sink } = watched();
    assert.equal(next.take(), null, "a stop's cancel carries no words");
    const took = next.send("later");
    next.end();
    assert.equal(await took, false);
    assert.equal(await next.send("as it ends"), false, "a note that comes as the turn ends");
    sink({ type: "tool", status: "completed" });
    assert.equal(at.cancels, 0, "nothing waits: no cancel");
  });

  test("the prompt that carries the turn on: the words as typed, after the line saying why they come now", () => {
    assert.equal(
      nextStepPrompt("use b"),
      "The person sent this while you were working. Your turn was paused after your last step finished — no step was cut short — so it could reach you. Take it into account, then carry on with your task from where you left off, without redoing finished steps.\n\n---\nuse b",
    );
    assert.equal(nextStepPrompt([{ text: "use b", by: "person" }]), nextStepPrompt("use b"));
  });

  // (fails before: yes — the nudge map of 11-10: a second send took the first's place, its words lost and its wait never
  // ended; and Filament's own words — a sub-agent's report — went in as "The person sent this")
  test("two sent before the step both go, in their order, each said as whose it is; Filament's own words are Filament's", async () => {
    const { at, next, sink } = watched();
    const first = next.send("also the docs");
    const second = next.send("[Filament: sub-agent sa_1 reported …]", "filament");
    sink({ type: "tool", status: "completed" });
    assert.equal(at.cancels, 1, "one cancel for both");
    const third = next.send("and the tests");
    const went = next.take();
    assert.deepEqual(went, [
      { text: "also the docs", by: "person" },
      { text: "[Filament: sub-agent sa_1 reported …]", by: "filament" },
      { text: "and the tests", by: "person" },
    ], "every one sent by the take, in order");
    assert.deepEqual([await first, await second, await third], [true, true, true], "each one's wait ends");
    assert.equal(
      nextStepPrompt(/** @type {any} */ (went)),
      "The person and Filament sent 3 messages while you were working, in the order below. Your turn was paused after your last step finished — no step was cut short — so they could reach you. Take them into account, then carry on with your task from where you left off, without redoing finished steps.\n\n---\nThe person sent this:\nalso the docs\n\n---\nFilament sent this:\n[Filament: sub-agent sa_1 reported …]\n\n---\nThe person sent this:\nand the tests",
    );
    assert.match(nextStepPrompt([{ text: "[Filament: envelope 1, sealed …]", by: "filament" }]), /^Filament sent this while you were working\. Your turn was paused/);
    // Two waiting as the turn ends: both handed back.
    const a = next.send("one");
    const b = next.send("two");
    next.end();
    assert.deepEqual([await a, await b], [false, false]);
  });
});

describe("the page steers a coding agent's turn as its run says (HarnessV3-ACP AC3-1)", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const composer = readFileSync("src/ui/harness/composer/composer.js", "utf8");

  test("the run's start says what a note does: the composer's face and its menu follow it", () => {
    const known = app.slice(app.indexOf("function runKnown("), app.indexOf("function agentUnheard("));
    assert.match(known, /live\.steer = run\.meta\?\.steer \|\| null;/);
    assert.match(known, /const liveRun = \(live\) => \(live\?\.runKind \? \{ kind: live\.runKind, steer: live\.steer \|\| null, own: live\.own \|\| null, interrupts: !!live\.interrupts, pictures: !!live\.pictures \} : live\?\.unfollowed \? \{ kind: "", unfollowed: true \} : null\);/, "none until the run is known");
    assert.match(composer, /agentQueues = agentTurn && runKnown && !agentTakesWords\(run\?\.steer\);\s+agentQueued = agentTurn && runKnown && run\?\.steer === "queued";/);
    // The send button names the row of the ⌄ menu the send key does (the owner's of 11-09): one name for what the four
    // agents' runs do with a note, the menu's rows on the stub document in send-rows.test.js.
    assert.match(composer, /\? agentQueues \|\| unfollowed \|\| holds \? "Send when it's done" : agentTurn && !runKnown \? "Send at its next step — held until the agent is up" : "Send at its next step"/);
    // The hint names the same rows (the owner's of 11-09): no veto for an agent, and held until it is up where its run is
    // not known yet.
    assert.match(composer, /\? holds \|\| agentQueues \|\| unfollowed \? `\$\{key\} sends when it's done\$\{veto\} · the Stop button stops`\s+: steerable \? `\$\{key\} sends at its next step\$\{veto\} · the Stop button stops`\s+: agentTurn \? \(!runKnown \? `\$\{key\} sends at its next step, held until the agent is up · the Stop button stops` : `\$\{key\} sends at its next step · the Stop button stops`\)/, "no veto for an agent; no steer promised before its run says");
    const menu = composer.slice(composer.indexOf("const openMenu = (more) => {"), composer.indexOf("modBtn.onclick = (e) => {"));
    assert.match(menu, /const takesNone = agentQueues \|\| unfollowed;/, "a turn that takes no message mid-turn: Send when it's done and Stop and send");
    assert.match(menu, /\.\.\.\(takesNone \? \[whenDone, stopAndSend\] : \[nextStep, agentInterrupts \? interrupt : stopAndSend, whenDone\]\),/);
    assert.match(menu, /desc: runKnown\s+\? "It reads this once its current step is done; nothing is cut short\."\s+: agentTurn\s+\? "Held until the agent is up, [^"]+"/, "held until the agent is up, and said so");
    // (fails before: yes — HarnessV4_Tasks U1: a run that queues notes at its agent, as Claude's does, read "Steer —
    // goes into the agent's running turn", and nothing on the page could interrupt the agent)
    assert.match(composer, /agentQueued = agentTurn && runKnown && run\?\.steer === "queued";\s+agentInterrupts = agentTurn && runKnown && run\?\.interrupts === true;/);
    // (fails before: yes — the owner's of 11-09: its words said what Claude's adapter does, a compaction aborted, a
    // command sent to the background, which Filament never checked)
    assert.match(menu, /const interrupt = \{ label: "Interrupt and send", desc: "Cuts short what it's doing and gives it this now, in the same turn\.", onClick: \(\) => send\("interrupt"\) \};/);
    assert.ok(!/kbd: [^}]*send\("interrupt"\)/.test(menu), "never what a key does: the menu's alone");
    assert.match(composer, /: agentTurn && runKnown \? `The \$\{lead \? "lead" : "agent"\} is working — what you send now is read at its next step`/, "the send key's row in the box, whatever the run does with a note");
    assert.match(known, /live\.interrupts = run\.meta\?\.interrupts === true;\s+live\.agent = run\.meta\?\.agent \? String\(run\.meta\.agent\) : null;/);
    const send = app.slice(app.indexOf("if (chat.live && chat.live.runId && !chat.live.turn.paused) {"), app.indexOf("if (chat.live && !chat.live.turn.paused) {"));
    assert.match(send, /const interrupt = modifier === "interrupt" && agentTurn && chat\.live\.interrupts === true;/, "only where the run says its agent can be interrupted");
    assert.match(send, /const how = agentTurn && chat\.live\.steer === "queued" \? \{ queuedAt: chat\.live\.agent \|\| "the agent", \.\.\.\(interrupt \? \{ interrupt: true \} : \{\}\) \} : \{\};/);
    assert.match(send, /const out = await steerPost\(chat\.live\.runId, \{ kind, text: team\.words, \.\.\.\(interrupt \? \{ interrupt: true \} : \{\}\), \.\.\.\(images\.length \? \{ images \} : \{\}\), \.\.\.\(overrules\.length \? \{ overrules \} : \{\}\), \.\.\.\(kind === "note" && useTags\.length \? \{ use: useTags \} : \{\}\), \.\.\.\(kind === "note" && useKeys\.length \? \{ useTeams: useKeys \} : \{\}\), \.\.\.\(weigh \? \{ weigh: true \} : \{\}\), \.\.\.\(via \? \{ via \} : \{\}\) \}\);\s+transcript\.addSteer\(chat\.live\.turn, \{ id: out\?\.message\?\.id \|\| `local-\$\{Date\.now\(\)\}`, kind, text, read: false, unread: false, \.\.\.how, \.\.\.files, \.\.\.over \}\);/);
    assert.match(app, /body: \{ kind: m\.kind, text: m\.text, from: "harness", \.\.\.\(m\.interrupt \? \{ interrupt: true \} : \{\}\), \.\.\.\(m\.images\?\.length \? \{ images: m\.images \} : \{\}\), \.\.\.\(m\.overrules\?\.length \? \{ overrules: overrulesSent\(m\.overrules\) \} : \{\}\), \.\.\.\(m\.use\?\.length \? \{ use: m\.use \} : \{\}\), \.\.\.\(m\.useTeams\?\.length \? \{ useTeams: m\.useTeams \} : \{\}\), \.\.\.\(m\.weigh \? \{ weigh: true \} : \{\}\), \.\.\.\(m\.via \? \{ via: m\.via \} : \{\}\) \} \}\);/);
    // A run that takes words — now, or at its next step — steers; one that doesn't queues them.
    assert.deepEqual(["live", "next", "queue", null].map(agentTakesWords), [true, true, false, false]);
    assert.match(app, /if \(agentTurn && chat\.live\.runKind && !agentTakesWords\(chat\.live\.steer\)\) \{\s+toast\(agentQueuesWords\(chat\.live\.own\)\);\s+return "queue";/);
    assert.match(app, /if \(live\.runKind === "coding-agent" && !agentTakesWords\(live\.steer\)\) return requeueHeld\(/);
    assert.equal((menu.match(/Veto this round/g) || []).length, 1, "the loop's alone");
  });

  test("a note the agent's turn ended before taking goes out next, from the tab that writes the session, its bubble saying so", () => {
    const unheard = app.slice(app.indexOf("function agentUnheard("), app.indexOf("\n}\n", app.indexOf("function agentUnheard(")));
    // Filament's loop's too, since the owner's of 11-09 (send-rows.test.js runs it).
    assert.match(unheard, /if \(e\?\.type !== "steer-unread" \|\| \(live\.runKind !== "coding-agent" && live\.runKind !== "agent-turn"\) \|\| \(writing\.chainId === chat\.chainId && !writing\.you\)\) return;/);
    assert.match(unheard, /ids\.has\(s\.id\) && s\.kind === "note" && !s\.next/, "a note, once");
    assert.match(unheard, /for \(const s of list\) s\.next = true;\s+transcript\.markSteers\(live\.turn\);[\s\S]*?return unheardNext\(chat, list\.map/);
    // (fails before: yes — its pictures were left behind, HarnessV4_Tasks C22)
    assert.match(unheard, /Promise\.all\(list\.map\(steerFiles\)\)\.then\(\(files\) => unheardNext\(chat, list\.map\(\(\/\*\* @type \{any\} \*\/ s, i\) => \(\{ text: s\.text, files: files\[i\], via \}\)\), said\)\)/, "its pictures go with it");
    // Said once the events that landed are drawn (the bug report's X1): a steer the log carries first is the turn's
    // only then. The send's own turn, and a turn followed after a reload.
    assert.equal((app.match(/transcript\.applyEvents\(turn, live\.events\);\s+for \(const e of landed\) agentUnheard\(chat, live, e\);/g) || []).length, 2);
    assert.equal(
      steerWords({ kind: "note", text: "x", unread: true, next: true }).state,
      "The turn ended before the agent took this — queued as your next message",
    );
    assert.equal(steerWords({ kind: "note", text: "x", unread: true }).state, "The run ended before reading this", "one not queued as the next message: in a tab that follows the session, say");
  });

  // (fails before: yes — a note sent while a coding agent worked went to it at once, and nothing on the page could
  // change it or take it back, HarnessV4_Tasks C34)
  test("what the developer typed waits for the agent's next tool call: its bubble says so, and offers Edit and Delete until the run hands it over", () => {
    const start = { type: "run-start", kind: "coding-agent", meta: { agent: "Claude Code", steer: "queued", holds: true } };
    const typed = { type: "steer", id: "s1", kind: "note", text: "look at f", from: "harness" };
    let al = alignEvents([start, typed, { type: "steer", id: "s2", kind: "note", text: "from its lead", from: "lead" }]);
    const s1 = al.steers.get("s1");
    assert.equal(steerWords(s1).state, "Waits for Claude Code's next tool call");
    assert.equal(canTakeBack(s1, false), true);
    assert.equal(canTakeBack(al.steers.get("s2"), false), false, "only what the developer typed");
    assert.equal(canTakeBack(s1, true), false, "nothing once the turn is over");
    assert.equal(canTakeBack({ ...s1, id: "local-1" }, false), false, "a bubble the run never knew");
    // Changed: its words; handed over: queued at the agent, no longer the developer's to change.
    al = alignEvents([start, typed, { type: "steer-edit", id: "s1", text: "look at g" }, { type: "steer-sent", ids: ["s1"] }]);
    assert.equal(al.steers.get("s1").text, "look at g");
    assert.equal(steerWords(al.steers.get("s1")).state, "Queued at Claude Code — goes in at its next step");
    assert.equal(canTakeBack(al.steers.get("s1"), false), false);
    // Taken back: never sent, it leaves the chat.
    al = alignEvents([start, typed, { type: "steer-drop", ids: ["s1"] }]);
    assert.deepEqual([al.steers.has("s1"), [...al.dropped]], [false, ["s1"]]);
    // One sent to interrupt goes at once; a run that holds nothing (Cursor's, at its next step) offers nothing.
    assert.equal(steerWords(alignEvents([start, { ...typed, interrupt: true }]).steers.get("s1")).state, "Interrupting Claude Code…");
    assert.equal(canTakeBack(alignEvents([{ type: "run-start", kind: "coding-agent", meta: { agent: "Cursor", steer: "next" } }, typed]).steers.get("s1"), false), false);
    // The loop's own run reads it at its next step: until then it can be taken back too.
    assert.equal(canTakeBack(alignEvents([{ type: "run-start", kind: "agent-turn", meta: {} }, typed]).steers.get("s1"), false), true);
    // The page: Delete lets it go; Edit puts it back in the box, with its pictures, to change and send again.
    const back = app.slice(app.indexOf("async function takeBackSteer("), app.indexOf("\n}\n", app.indexOf("async function takeBackSteer(")));
    assert.match(back, /await api\(`\/runs\/\$\{encodeURIComponent\(live\.runId\)\}\/steer\/\$\{encodeURIComponent\(String\(s\.id\)\)\}`, \{ method: "DELETE" \}\);/);
    assert.match(back, /if \(edit\) composer\.takeBack\(String\(s\.text \|\| ""\), files\);/);
    assert.match(composer, /takeBack\(text, files = \[\], overrules = \[\]\) \{\s+cb\.toBox\?\.\(\);\s+backInBox\(text, files, overrules\);/);
    assert.match(composer, /const backInBox = \(text, files, overrules\) => \{\s+if \(text\) \{\s+const had = ta\.value\.replace\(\/\^\\s\+\/, ""\);\s+ta\.value = had \? `\$\{text\}\\n\\n\$\{had\}` : text;\s+\}\s+atts\.restore\(\[\.\.\.files, \.\.\.atts\.list\(\)\]\);/);
  });
});

describe("the fake agent's commands gate (FAKE_ACP_COMMANDS_GATE)", () => {
  // (fails before: yes — only a new session published its commands: under the gate, a prompt to a resumed or a loaded
  // session waited for good, and so would any test that reopens a session; HarnessV4_Tasks B7)
  test("a resumed and a loaded session publish their commands too, so a prompt waiting on the gate goes on", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-fake-gate-"));
    const gate = join(dir, "gate");
    const child = spawn(process.execPath, [FAKE_ACP], { env: { ...process.env, FAKE_ACP_COMMANDS_GATE: gate, FAKE_ACP_ALLOW_LOAD: "1" }, stdio: ["pipe", "pipe", "inherit"] });
    /** @type {any[]} */
    const got = [];
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      buf += d;
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) got.push(JSON.parse(line));
      }
    });
    const send = (/** @type {number} */ id, /** @type {string} */ method, /** @type {any} */ params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    const answered = (/** @type {number} */ id) => got.find((m) => m.id === id && !m.method);
    const answer = (/** @type {number} */ id) => until(() => answered(id), `the fake agent's answer to request ${id}`);
    try {
      send(1, "initialize", { protocolVersion: 1, clientCapabilities: {} });
      await answer(1);
      send(2, "session/resume", { sessionId: "sess_resumed", cwd: dir, mcpServers: [] });
      send(3, "session/load", { sessionId: "sess_loaded", cwd: dir, mcpServers: [] });
      await answer(2);
      await answer(3);
      send(4, "session/prompt", { sessionId: "sess_resumed", prompt: [{ type: "text", text: "hello" }] });
      send(5, "session/prompt", { sessionId: "sess_loaded", prompt: [{ type: "text", text: "hello" }] });
      await new Promise((r) => setTimeout(r, 150));
      assert.ok(!answered(4) && !answered(5), "both prompts wait for the gate");
      writeFileSync(gate, "");
      assert.equal((await answer(4)).result?.stopReason, "end_turn", "the resumed session's prompt went on");
      assert.equal((await answer(5)).result?.stopReason, "end_turn", "and the loaded one's");
      const told = got.filter((m) => m.method === "session/update" && m.params?.update?.sessionUpdate === "available_commands_update").map((m) => m.params.sessionId);
      assert.deepEqual(told.sort(), ["sess_loaded", "sess_resumed"], "each said its commands, as Claude's adapter does after a resume and a load");
    } finally {
      child.kill();
      await removeDirs(dir);
    }
  });
});
